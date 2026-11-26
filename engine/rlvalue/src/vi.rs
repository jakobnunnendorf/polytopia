//! Strategic actions and value iteration on the full integer state (experiment 15).
//!
//! A strategic action is chosen at the start of each learner turn and holds for that whole turn: it multiplies
//! the bot's weights of some move types (`FullWeights::ty`, the factor on every scored move of that type) by
//! `boost`. Action 0 leaves the model unchanged, so the bot itself is one of the choices.
//!
//! `fit-vi` learns P̂(s'|s,a) and r̂ from games with a random action per turn and runs finite-horizon value
//! iteration: Q(s,a) = mean over the transitions (s,a,r,s') of r + V(s'), V(s) = max over the actions seen at
//! least `min-count` times, V(terminal) = 0. A state with no such action keeps the mean over all its transitions
//! and has no policy entry; the policy then plays action 0 there, as in any state never seen.
use crate::{get, play, read, setup, splitmix64, State, Traj, EVAL_SEED_START, R, TERM};
use rl_value::strategic::{read_table, ACTION_NAMES, NA};
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

pub enum Driver {
    /// action 0 every turn: the model itself
    Bot,
    /// a uniformly random action each turn, fixed by seed and turn
    Random,
    Fixed(usize),
    /// the action of a value-iteration policy; action 0 in a state it has no entry for
    Policy(HashMap<State, u8>, String),
}

impl Driver {
    pub fn parse(s: &str) -> R<Driver> {
        Ok(match s {
            "bot" => Driver::Bot,
            "random" => Driver::Random,
            _ if s.starts_with("fixed:") => {
                let k: usize = s[6..].parse().map_err(|_| format!("--driver {s:?}"))?;
                if k >= NA {
                    return Err(format!("--driver {s:?}: action 0..{}", NA - 1));
                }
                Driver::Fixed(k)
            }
            _ if s.starts_with("policy:") => Driver::Policy(read_table(&s[7..])?.1, s[7..].to_string()),
            _ => return Err(format!("--driver {s:?}: bot, random, fixed:K or policy:<file>")),
        })
    }
    pub fn label(&self) -> String {
        match self {
            Driver::Bot => "bot".into(),
            Driver::Random => "random".into(),
            Driver::Fixed(k) => format!("fixed:{}", ACTION_NAMES[*k]),
            Driver::Policy(_, p) => format!("policy:{p}"),
        }
    }
    pub fn pick(&self, seed: i64, f: &State) -> usize {
        match self {
            Driver::Bot => 0,
            Driver::Random => (splitmix64((seed as u64).wrapping_mul(64) ^ (f[0] as u64 + 1).wrapping_mul(0x9E37_79B9)) % NA as u64) as usize,
            Driver::Fixed(k) => *k,
            Driver::Policy(t, _) => t.get(f).copied().unwrap_or(0) as usize,
        }
    }
}

// ---------------------------------------------------------------- statistics

fn mean(x: &[f64]) -> f64 {
    x.iter().sum::<f64>() / x.len() as f64
}
fn sd(x: &[f64]) -> f64 {
    let m = mean(x);
    (x.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (x.len() as f64 - 1.0)).sqrt()
}
/// linear-interpolation quantile (Hyndman-Fan type 7), as rl-gate
fn quantile(x: &[f64], p: f64) -> f64 {
    let mut v = x.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let h = (v.len() as f64 - 1.0) * p;
    let lo = h.floor() as usize;
    let hi = (lo + 1).min(v.len() - 1);
    v[lo] + (h - lo as f64) * (v[hi] - v[lo])
}
/// one-sided exact sign test: P(X >= better), X ~ Bin(better + worse, 1/2), summed in log space
fn sign_p(better: usize, worse: usize) -> f64 {
    let n = better + worse;
    if n == 0 {
        return 1.0;
    }
    let mut lf = vec![0.0f64; n + 1];
    for i in 1..=n {
        lf[i] = lf[i - 1] + (i as f64).ln();
    }
    let ln2n = n as f64 * std::f64::consts::LN_2;
    let terms: Vec<f64> = (better..=n).map(|k| lf[n] - lf[k] - lf[n - k] - ln2n).collect();
    let mx = terms.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    (mx + terms.iter().map(|t| (t - mx).exp()).sum::<f64>().ln()).exp().min(1.0)
}
fn stats(x: &[f64]) -> Value {
    json!({"mean": mean(x), "sd": sd(x), "p10": quantile(x, 0.1), "median": quantile(x, 0.5), "p90": quantile(x, 0.9)})
}

/// the #171 rule (rl-gate), computed here for a learner rl-gate cannot play yet: PASS iff the sign test rejects
/// at alpha and both guards hold (mean(d) not significantly below 0; candidate p10 >= base p10)
fn gate_rule(cand: &[f64], base: &[f64], alpha: f64) -> Value {
    let d: Vec<f64> = cand.iter().zip(base).map(|(c, b)| c - b).collect();
    let better = d.iter().filter(|x| **x > 0.0).count();
    let worse = d.iter().filter(|x| **x < 0.0).count();
    let p = sign_p(better, worse);
    let upper = mean(&d) + 2.326347874 * sd(&d) / (d.len() as f64).sqrt();
    let (pc, pb) = (quantile(cand, 0.1), quantile(base, 0.1));
    let sign = p < alpha;
    let ga = upper >= 0.0;
    let gb = pc >= pb;
    let pass = sign && ga && gb;
    json!({"rule": "#171: sign test (one-sided exact, ties dropped) at alpha, mean(d) upper bound >= 0, p10(candidate) >= p10(base); computed by rl-value, not rl-gate",
           "pass": pass, "verdict": if pass {"PASS"} else {"FAIL"},
           "better": better, "worse": worse, "ties": d.len() - better - worse,
           "betterShare": if better + worse > 0 { better as f64 / (better + worse) as f64 } else { f64::NAN },
           "signP": p, "signPass": sign, "meanD": mean(&d), "sdD": sd(&d), "meanDUpper": upper, "guardMean": ga,
           "p10Candidate": pc, "p10Base": pb, "guardP10": gb})
}

// ---------------------------------------------------------------- check: does each action change the game?

pub fn check(m: &HashMap<String, String>) -> R<()> {
    let games: i64 = get(m, "games", 2000)?;
    let seed_start: i64 = get(m, "seed-start", 600_000_000)?;
    if seed_start + games > EVAL_SEED_START {
        return Err("check seeds must stay below the evaluation range".into());
    }
    let (su, model, opp) = setup(m)?;
    let out = PathBuf::from(m.get("out").ok_or("--out <file.json> is required")?);
    let t0 = Instant::now();
    // per action, per seed: final score and final state
    let res: Vec<Vec<(f64, [i32; 6])>> = (0..NA)
        .map(|k| {
            (seed_start..seed_start + games)
                .into_par_iter()
                .map(|seed| {
                    let rows = play(seed, &su, &Driver::Fixed(k))?;
                    let last = rows.last().unwrap();
                    Ok((last[6] as f64, [last[0], last[1], last[2], last[3], last[4], last[5]]))
                })
                .collect::<R<Vec<_>>>()
        })
        .collect::<R<_>>()?;
    let base: Vec<f64> = res[0].iter().map(|x| x.0).collect();
    let mut rows = Vec::new();
    println!("action      mean score  median    p10   cities income  units levels  techs   better/worse vs bot");
    for k in 0..NA {
        let sc: Vec<f64> = res[k].iter().map(|x| x.0).collect();
        let feat = |j: usize| res[k].iter().map(|x| x.1[j] as f64).sum::<f64>() / res[k].len() as f64;
        let g = gate_rule(&sc, &base, 0.01);
        println!(
            "{:<10} {:>10.0} {:>8.0} {:>6.0} {:>8.2} {:>6.2} {:>6.2} {:>6.2} {:>6.2}   {}/{}",
            ACTION_NAMES[k],
            mean(&sc),
            quantile(&sc, 0.5),
            quantile(&sc, 0.1),
            feat(1),
            feat(2),
            feat(3),
            feat(4),
            feat(5),
            g["better"],
            g["worse"]
        );
        rows.push(json!({"action": ACTION_NAMES[k], "score": stats(&sc), "final": {"cities": feat(1), "income": feat(2), "units": feat(3), "levels": feat(4), "techs": feat(5)}, "vsBot": g}));
    }
    let summary = json!({"tool": "rl-value check", "model": model, "opp": opp, "players": su.players, "difficulty": su.difficulty,
                         "humanLearner": su.human, "boost": get(m, "boost", 2.0)?, "games": games, "seedStart": seed_start,
                         "wallSeconds": t0.elapsed().as_secs_f64(), "actions": rows});
    std::fs::write(&out, serde_json::to_string_pretty(&summary).unwrap()).map_err(|e| e.to_string())?;
    println!("json  {}", out.display());
    Ok(())
}

// ---------------------------------------------------------------- value iteration

pub struct ViResult {
    pub keys: Vec<State>,
    pub n: Vec<[u32; NA]>,
    pub q: Vec<[f64; NA]>,
    pub v: Vec<f64>,
    /// argmax action, or None when no action reaches min_count
    pub pi: Vec<Option<u8>>,
}

pub fn value_iteration(train: &[Traj], min_count: u32) -> ViResult {
    let mut idx: HashMap<State, u32> = HashMap::new();
    let mut keys: Vec<State> = Vec::new();
    let mut flat: Vec<(u32, u8, f32, u32)> = Vec::new();
    for tr in train {
        let ids: Vec<u32> = tr
            .states
            .iter()
            .map(|s| {
                *idx.entry(*s).or_insert_with(|| {
                    keys.push(*s);
                    (keys.len() - 1) as u32
                })
            })
            .collect();
        for k in 0..ids.len() {
            let (r, next) = if k + 1 < ids.len() {
                (tr.scores[k + 1] - tr.scores[k], ids[k + 1])
            } else {
                (tr.fin - tr.scores[k], TERM)
            };
            flat.push((ids[k], tr.actions[k], r as f32, next));
        }
    }
    flat.sort_unstable_by_key(|x| x.0);
    let mut start = vec![0usize; keys.len() + 1];
    for x in &flat {
        start[x.0 as usize + 1] += 1;
    }
    for i in 0..keys.len() {
        start[i + 1] += start[i];
    }
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by(|a, b| keys[*b][0].cmp(&keys[*a][0]));
    let mut v = vec![0.0f64; keys.len()];
    let mut q = vec![[f64::NAN; NA]; keys.len()];
    let mut n = vec![[0u32; NA]; keys.len()];
    let mut pi = vec![None; keys.len()];
    for &i in &order {
        let mut sum = [0.0f64; NA];
        for &(_, a, r, nx) in &flat[start[i]..start[i + 1]] {
            let vn = if nx == TERM { 0.0 } else { v[nx as usize] };
            sum[a as usize] += r as f64 + vn;
            n[i][a as usize] += 1;
        }
        let mut best: Option<(f64, usize)> = None;
        for a in 0..NA {
            if n[i][a] > 0 {
                q[i][a] = sum[a] / n[i][a] as f64;
            }
            if n[i][a] >= min_count.max(1) && best.map_or(true, |(b, _)| q[i][a] > b) {
                best = Some((q[i][a], a));
            }
        }
        match best {
            Some((b, a)) => {
                v[i] = b;
                pi[i] = Some(a as u8);
            }
            None => {
                let tot: u32 = n[i].iter().sum();
                v[i] = sum.iter().sum::<f64>() / tot as f64;
            }
        }
    }
    ViResult { keys, n, q, v, pi }
}

pub fn fit_vi_cmd(m: &HashMap<String, String>) -> R<()> {
    let (meta, train) = read(m.get("train").ok_or("--train <file.tsv> is required")?)?;
    let out = PathBuf::from(m.get("out").ok_or("--out <dir> is required")?);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let counts: Vec<u32> = m
        .get("min-count")
        .map(|s| s.split(',').map(|x| x.parse().map_err(|_| format!("--min-count {x:?}"))).collect::<R<Vec<_>>>())
        .transpose()?
        .unwrap_or(vec![1, 5, 20, 50]);
    let mut rows = Vec::new();
    for &mc in &counts {
        let t0 = Instant::now();
        let r = value_iteration(&train, mc);
        // the start state: the most visited turn-0 state
        let s0 = (0..r.keys.len()).filter(|&i| r.keys[i][0] == 0).max_by_key(|&i| r.n[i].iter().sum::<u32>());
        let visits: Vec<u32> = r.n.iter().map(|x| x.iter().sum()).collect();
        let mut by_action = [0u64; NA];
        let mut none = 0u64;
        for i in 0..r.keys.len() {
            match r.pi[i] {
                Some(a) => by_action[a as usize] += visits[i] as u64,
                None => none += visits[i] as u64,
            }
        }
        let total: u64 = visits.iter().map(|&x| x as u64).sum();
        let f = out.join(format!("policy-m{mc}.tsv"));
        let mut w = BufWriter::new(std::fs::File::create(&f).map_err(|e| e.to_string())?);
        // the header names the base bot and the boost, so the file plays on its own (rl-gate --candidate rl-policy:<file>)
        let head = json!({"tool": "rl-value fit-vi", "model": meta["model"], "boost": meta["boost"].as_f64().unwrap_or(2.0), "minCount": mc,
                          "actions": ACTION_NAMES, "train": m.get("train"), "trainGames": train.len(), "opp": meta["opp"], "players": meta["players"],
                          "difficulty": meta["difficulty"], "humanLearner": meta["humanLearner"]});
        writeln!(w, "# {head}").unwrap();
        writeln!(w, "turn\tcities\tincome\tunits\tlevels\ttechs\taction\tv\tvisits\t{}", ACTION_NAMES.map(|a| format!("q_{a}")).join("\t")).unwrap();
        let mut order: Vec<usize> = (0..r.keys.len()).filter(|&i| r.pi[i].is_some()).collect();
        order.sort_by_key(|&i| r.keys[i]);
        for i in order {
            let k = r.keys[i];
            let qs: Vec<String> = (0..NA).map(|a| if r.q[i][a].is_nan() { String::new() } else { format!("{:.1}", r.q[i][a]) }).collect();
            writeln!(w, "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.1}\t{}\t{}", k[0], k[1], k[2], k[3], k[4], k[5], r.pi[i].unwrap(), r.v[i], visits[i], qs.join("\t")).unwrap();
        }
        w.flush().map_err(|e| e.to_string())?;
        let s0j = s0.map(|i| json!({"state": r.keys[i], "visits": visits[i], "v": r.v[i], "q": r.q[i].iter().map(|x| if x.is_nan() { Value::Null } else { json!(x) }).collect::<Vec<_>>(), "action": r.pi[i].map(|a| ACTION_NAMES[a as usize])}));
        let share: serde_json::Map<String, Value> = (0..NA).map(|a| (ACTION_NAMES[a].to_string(), json!(by_action[a] as f64 / total as f64))).collect();
        println!(
            "min-count {mc:>3}: {} states, policy entries cover {:.1}% of visits; by visits {}; V(start) {:.0}  -> {}",
            r.keys.len(),
            100.0 * (total - none) as f64 / total as f64,
            (0..NA).map(|a| format!("{} {:.1}%", ACTION_NAMES[a], 100.0 * by_action[a] as f64 / total as f64)).collect::<Vec<_>>().join(", "),
            s0.map_or(f64::NAN, |i| r.v[i]),
            f.display()
        );
        rows.push(json!({"minCount": mc, "states": r.keys.len(), "visits": total, "policyCoverage": (total - none) as f64 / total as f64,
                         "actionShareByVisits": share, "start": s0j, "seconds": t0.elapsed().as_secs_f64(), "policy": f.display().to_string()}));
    }
    let summary = json!({"tool": "rl-value fit-vi", "actions": ACTION_NAMES, "trainSetup": meta, "trainGames": train.len(), "runs": rows});
    let f = out.join("vi-summary.json");
    std::fs::write(&f, serde_json::to_string_pretty(&summary).unwrap()).map_err(|e| e.to_string())?;
    println!("json  {}", f.display());
    Ok(())
}

// ---------------------------------------------------------------- eval: policy vs the bot on the same seeds

pub fn eval(m: &HashMap<String, String>) -> R<()> {
    let n: i64 = get(m, "n", 10_000)?;
    let seed_start: i64 = get(m, "seed-start", EVAL_SEED_START)?;
    let (su, model, opp) = setup(m)?;
    let pol = m.get("policy").ok_or("--policy <policy.tsv> is required")?;
    let cand = Driver::Policy(read_table(pol)?.1, pol.clone());
    let based = Driver::parse(m.get("base-driver").map(|x| x.as_str()).unwrap_or("bot"))?;
    let out = PathBuf::from(m.get("out").ok_or("--out <file.json> is required")?);
    let t0 = Instant::now();
    let res: Vec<(i64, f64, f64, [u32; NA], u32)> = (seed_start..seed_start + n)
        .into_par_iter()
        .map(|seed| {
            let c = play(seed, &su, &cand)?;
            let b = play(seed, &su, &based)?;
            let mut used = [0u32; NA];
            let mut known = 0;
            let Driver::Policy(t, _) = &cand else { unreachable!() };
            for r in &c[..c.len() - 1] {
                used[r[8] as usize] += 1;
                if t.contains_key(&[r[0], r[1], r[2], r[3], r[4], r[5]]) {
                    known += 1;
                }
            }
            Ok((seed, c.last().unwrap()[6] as f64, b.last().unwrap()[6] as f64, used, known))
        })
        .collect::<R<_>>()?;
    let cs: Vec<f64> = res.iter().map(|r| r.1).collect();
    let bs: Vec<f64> = res.iter().map(|r| r.2).collect();
    let g = gate_rule(&cs, &bs, 0.01);
    let mut used = [0u64; NA];
    let mut known = 0u64;
    for r in &res {
        for a in 0..NA {
            used[a] += r.3[a] as u64;
        }
        known += r.4 as u64;
    }
    let turns: u64 = used.iter().sum();
    println!("eval   {} vs {} ({model}), opponents {opp}, {} players, {}, seeds {seed_start}..{}", cand.label(), based.label(), su.players, su.difficulty, seed_start + n - 1);
    println!("score  policy mean {:.0} median {:.0} p10 {:.0} | base mean {:.0} median {:.0} p10 {:.0}", mean(&cs), quantile(&cs, 0.5), quantile(&cs, 0.1), mean(&bs), quantile(&bs, 0.5), quantile(&bs, 0.1));
    println!("seeds  better {} worse {} ties {}, sign p {:.3e}, mean d {:.1} (upper {:.1})", g["better"], g["worse"], g["ties"], g["signP"].as_f64().unwrap_or(f64::NAN), g["meanD"].as_f64().unwrap_or(0.0), g["meanDUpper"].as_f64().unwrap_or(0.0));
    println!("turns  in a policy state {:.1}%; actions {}", 100.0 * known as f64 / turns as f64, (0..NA).map(|a| format!("{} {:.1}%", ACTION_NAMES[a], 100.0 * used[a] as f64 / turns as f64)).collect::<Vec<_>>().join(", "));
    println!("rule   {} ({:.1} s)", g["verdict"], t0.elapsed().as_secs_f64());
    let per: Vec<Value> = res.iter().map(|r| json!({"seed": r.0, "candidate": r.1, "base": r.2, "d": r.1 - r.2})).collect();
    let summary = json!({"tool": "rl-value eval", "policy": pol, "baseDriver": based.label(), "model": model, "opp": opp, "players": su.players, "difficulty": su.difficulty,
                         "humanLearner": su.human, "boost": get(m, "boost", 2.0)?, "n": n, "seedStart": seed_start,
                         "candidate": stats(&cs), "base": stats(&bs), "gate": g, "policyStateShare": known as f64 / turns as f64,
                         "actionShare": (0..NA).map(|a| (ACTION_NAMES[a].to_string(), json!(used[a] as f64 / turns as f64))).collect::<serde_json::Map<_, _>>(),
                         "wallSeconds": t0.elapsed().as_secs_f64(), "perSeed": per});
    if let Some(d) = out.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&out, serde_json::to_string_pretty(&summary).unwrap()).map_err(|e| e.to_string())?;
    println!("json   {}", out.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tr(states: &[State], acts: &[u8], scores: &[i32], fin: i32) -> Traj {
        Traj { states: states.to_vec(), scores: scores.to_vec(), actions: acts.to_vec(), fin, won: false }
    }

    #[test]
    fn value_iteration_takes_the_better_action() {
        let s0 = [0, 1, 2, 1, 1, 1];
        let (good, bad) = ([1, 2, 4, 2, 2, 1], [1, 1, 2, 2, 1, 1]);
        // action 1 from s0 leads to `good` (then +100), action 3 to `bad` (then +10); both give +5 on the way
        let games = vec![
            tr(&[s0, good], &[1, 0], &[0, 5], 105),
            tr(&[s0, good], &[1, 0], &[0, 5], 105),
            tr(&[s0, bad], &[3, 0], &[0, 5], 15),
        ];
        let r = value_iteration(&games, 1);
        let i = r.keys.iter().position(|k| *k == s0).unwrap();
        assert_eq!(r.pi[i], Some(1));
        assert_eq!(r.v[i], 105.0);
        assert_eq!(r.q[i][3], 15.0);
        // with min-count 3 no action qualifies: no policy entry, V = mean over all transitions
        let r = value_iteration(&games, 3);
        let i = r.keys.iter().position(|k| *k == s0).unwrap();
        assert_eq!(r.pi[i], None);
        assert_eq!(r.v[i], (105.0 + 105.0 + 15.0) / 3.0);
    }

    #[test]
    fn sign_test_and_quantile() {
        // 60 of 100: P(X >= 60) = 0.02844
        assert!((sign_p(60, 40) - 0.028444).abs() < 1e-5);
        assert_eq!(sign_p(0, 0), 1.0);
        assert!((quantile(&[1.0, 2.0, 3.0, 4.0], 0.1) - 1.3).abs() < 1e-12);
    }

    #[test]
    fn bot_driver_is_action_zero_and_random_is_reproducible() {
        let (su, _, _) = setup(&HashMap::new()).unwrap();
        let rows = play(11, &su, &Driver::Bot).unwrap();
        assert!(rows[..rows.len() - 1].iter().all(|r| r[8] == 0));
        let a = play(11, &su, &Driver::Random).unwrap();
        assert_eq!(a, play(11, &su, &Driver::Random).unwrap());
        let used: std::collections::HashSet<i32> = a.iter().take(a.len() - 1).map(|r| r[8]).collect();
        assert!(used.len() >= 3, "random driver should use several actions: {used:?}");
    }
}
