//! Strategic actions and value iteration (experiments 15, 21, 22, 23).
//!
//! A strategic action is chosen at the start of each learner turn and holds for that whole turn: it multiplies
//! the bot's weights of some move types (`FullWeights::ty`, the factor on every scored move of that type) by
//! `boost`. The action set (`rl_value::strategic::ActionSet`, `--actions`) is strategic5 (bot, expand, economy,
//! army, research; action 0 is the bot unchanged) or spend3 (economy, army, research; the bot unchanged is only the
//! default for states without a policy entry).
//!
//! `fit-vi` learns P̂(s'|s,a) and r̂ from games and runs value iteration: Q(s,a) = mean over the transitions
//! (s,a,r,s') of r + V(s'), V(s) = max over the actions seen at least `min-count` times, V(terminal) = 0. A state with
//! no such action keeps the mean over all its transitions and has no policy entry; the policy then plays the action
//! set's default there, as in any state never seen. The state may be a subset of the six features (`--features`):
//! with the turn, one backward sweep from the last turn is exact; without it, the sweeps repeat until the values
//! settle, at most HORIZON times (the game's length in learner turns).
use crate::{get, play, read, setup, splitmix64, State, Traj, EVAL_SEED_START, R, TERM};
use rl_value::strategic::{level_bucket, level_key, read_table, ActionSet, FeatureMask, NA};
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

/// the action column of a turn played by the base bot as the action set's default (None): -1 in the files, this in
/// a Traj
pub const DEFAULT_ACTION: u8 = u8::MAX;
/// the most sweeps without the turn in the state: a game has at most 30 learner turns
pub const HORIZON: usize = 30;

/// A policy file ready for lookups: the table, the features it keys on and its action set.
pub struct Table {
    pub t: HashMap<State, u8>,
    pub path: String,
    pub features: FeatureMask,
    pub actions: &'static ActionSet,
    /// a level policy (experiment 29): the income bucket of its key (`level_key`)
    pub level: Option<i32>,
}

impl Table {
    pub fn load(path: &str) -> R<Table> {
        let (meta, t) = read_table(path)?;
        let actions = ActionSet::by_id(meta["actions"].as_str()).map_err(|e| format!("{path}: {e}"))?;
        let features = FeatureMask::from_json(&meta["features"]).map_err(|e| format!("{path}: {e}"))?;
        if let Some((_, a)) = t.iter().find(|(_, a)| **a as usize >= actions.len()) {
            return Err(format!("{path}: action {a} out of range for {}", actions.id));
        }
        let level = level_bucket(&meta).map_err(|e| format!("{path}: {e}"))?;
        if level.is_some() != actions.is_level() {
            return Err(format!("{path}: a levelKey goes with a level action set and only with one"));
        }
        Ok(Table { t, path: path.to_string(), features, actions, level })
    }
    pub fn has(&self, f: &State) -> bool {
        self.t.contains_key(&self.features.project(f))
    }
    pub fn get(&self, f: &State) -> Option<usize> {
        self.t.get(&self.features.project(f)).map(|a| *a as usize).or(self.actions.default)
    }
}

pub enum Driver {
    /// the model itself: the action set's default every turn (strategic5: action 0; spend3: the base bot)
    Bot,
    /// a uniformly random action of the set each turn, fixed by seed and turn
    Random,
    Fixed(usize),
    /// the action of a value-iteration policy; the set's default in a state it has no entry for
    Policy(Table),
    /// the policy's action, but with probability eps a uniformly random action instead (fixed by seed and turn, a
    /// stream separate from `Random`): the data of a round of play and refit (experiment 22)
    EpsPolicy(Table, f64),
    /// a level set's random walk (experiment 29): from the default level, each turn one step down, stay or one step
    /// up with probability 1/3 each (fixed by seed and turn), held at the ends
    Walk,
}

/// the random walk's stream (separate from Random's and EpsPolicy's)
const WALK_STREAM: u64 = 0x57A1_4000_0000_0029;

impl Driver {
    pub fn parse(s: &str) -> R<Driver> {
        Ok(match s {
            "bot" => Driver::Bot,
            "random" => Driver::Random,
            "walk" => Driver::Walk,
            _ if s.starts_with("fixed:") => Driver::Fixed(s[6..].parse().map_err(|_| format!("--driver {s:?}"))?),
            _ if s.starts_with("policy:") => Driver::Policy(Table::load(&s[7..])?),
            _ if s.starts_with("eps:") => {
                // eps:<eps>:<policy file>
                let (e, f) = s[4..].split_once(':').ok_or(format!("--driver {s:?}: eps:<eps>:<policy file>"))?;
                let eps: f64 = e.parse().map_err(|_| format!("--driver {s:?}: eps {e:?}"))?;
                if !(0.0..=1.0).contains(&eps) {
                    return Err(format!("--driver {s:?}: eps must be in [0, 1]"));
                }
                Driver::EpsPolicy(Table::load(f)?, eps)
            }
            _ => return Err(format!("--driver {s:?}: bot, random, walk, fixed:K, policy:<file> or eps:<eps>:<file>")),
        })
    }
    /// the driver fits the action set it plays with
    pub fn check(&self, set: &ActionSet) -> R<()> {
        match self {
            Driver::Fixed(k) if *k >= set.len() => Err(format!("fixed:{k}: {} has actions 0..{}", set.id, set.len() - 1)),
            Driver::Policy(t) | Driver::EpsPolicy(t, _) if t.actions.id != set.id => {
                Err(format!("{}: a {} policy, but the setup plays {} (--actions)", t.path, t.actions.id, set.id))
            }
            Driver::Walk if !set.is_level() => Err(format!("walk: {} is not a level action set", set.id)),
            Driver::EpsPolicy(t, _) if t.level.is_some() => Err(format!("{}: eps: is not defined for a level policy", t.path)),
            _ => Ok(()),
        }
    }
    pub fn label(&self, set: &ActionSet) -> String {
        match self {
            Driver::Bot => "bot".into(),
            Driver::Random => "random".into(),
            Driver::Fixed(k) => format!("fixed:{}", set.names.get(*k).unwrap_or(&"?")),
            Driver::Policy(t) => format!("policy:{}", t.path),
            Driver::EpsPolicy(t, e) => format!("eps:{e}:{}", t.path),
            Driver::Walk => "walk".into(),
        }
    }
    /// A fresh chooser for one game. Walk and level policies keep the level between turns, from the set's default;
    /// every other driver picks each turn on its own (`pick`).
    pub fn picker<'a>(&'a self, seed: i64, set: &'a ActionSet) -> Box<dyn FnMut(&State) -> Option<usize> + 'a> {
        let level = match self {
            Driver::Walk => true,
            Driver::Policy(t) => t.level.is_some(),
            _ => false,
        };
        if !level {
            return Box::new(move |f: &State| self.pick(seed, f, set));
        }
        let mut prev = set.default.expect("a level set has a default level");
        Box::new(move |f: &State| {
            let want = match self {
                Driver::Walk => {
                    let h = splitmix64((seed as u64).wrapping_mul(64) ^ (f[0] as u64 + 1).wrapping_mul(0x9E37_79B9) ^ WALK_STREAM);
                    (prev + (h % 3) as usize).saturating_sub(1)
                }
                Driver::Policy(t) => t.t.get(&level_key(f, prev, t.level.unwrap())).map_or(prev, |a| *a as usize),
                _ => unreachable!(),
            };
            prev = set.step(prev, want);
            Some(prev)
        })
    }
    pub fn pick(&self, seed: i64, f: &State, set: &ActionSet) -> Option<usize> {
        let na = set.len() as u64;
        match self {
            Driver::Bot => set.default,
            Driver::Random => Some((splitmix64((seed as u64).wrapping_mul(64) ^ (f[0] as u64 + 1).wrapping_mul(0x9E37_79B9)) % na) as usize),
            Driver::Fixed(k) => Some(*k),
            Driver::Walk => unreachable!("walk keeps a level: use picker"),
            Driver::Policy(t) => t.get(f),
            Driver::EpsPolicy(t, eps) => {
                let h = splitmix64((seed as u64).wrapping_mul(64) ^ (f[0] as u64 + 1).wrapping_mul(0x9E37_79B9) ^ 0xE95E_0000_0000_0022);
                if ((h >> 11) as f64 / (1u64 << 53) as f64) < *eps {
                    Some((splitmix64(h) % na) as usize)
                } else {
                    t.get(f)
                }
            }
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
    let set = su.actions;
    let out = PathBuf::from(m.get("out").ok_or("--out <file.json> is required")?);
    let t0 = Instant::now();
    // the bot (the set's default), then every action of the set that is not the default
    let mut drivers: Vec<(&str, Driver)> = vec![("bot", Driver::Bot)];
    for k in 0..set.len() {
        if set.default != Some(k) {
            drivers.push((set.names[k], Driver::Fixed(k)));
        }
    }
    // per driver, per seed: final score and final state
    let res: Vec<Vec<(f64, [i32; 6])>> = drivers
        .iter()
        .map(|(_, d)| {
            (seed_start..seed_start + games)
                .into_par_iter()
                .map(|seed| {
                    let rows = play(seed, &su, d)?;
                    let last = rows.last().unwrap();
                    Ok((last[6] as f64, [last[0], last[1], last[2], last[3], last[4], last[5]]))
                })
                .collect::<R<Vec<_>>>()
        })
        .collect::<R<_>>()?;
    let base: Vec<f64> = res[0].iter().map(|x| x.0).collect();
    let mut rows = Vec::new();
    println!("action      mean score  median    p10   cities income  units levels  techs   better/worse vs bot");
    for (k, (name, _)) in drivers.iter().enumerate() {
        let sc: Vec<f64> = res[k].iter().map(|x| x.0).collect();
        let feat = |j: usize| res[k].iter().map(|x| x.1[j] as f64).sum::<f64>() / res[k].len() as f64;
        let g = gate_rule(&sc, &base, 0.01);
        println!(
            "{:<10} {:>10.0} {:>8.0} {:>6.0} {:>8.2} {:>6.2} {:>6.2} {:>6.2} {:>6.2}   {}/{}",
            name,
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
        rows.push(json!({"action": name, "score": stats(&sc), "final": {"cities": feat(1), "income": feat(2), "units": feat(3), "levels": feat(4), "techs": feat(5)}, "vsBot": g}));
    }
    let summary = json!({"tool": "rl-value check", "model": model, "opp": opp, "players": su.players, "difficulty": su.difficulty,
                         "humanLearner": su.human, "boost": get(m, "boost", 2.0)?, "actionSet": set.id, "games": games, "seedStart": seed_start,
                         "wallSeconds": t0.elapsed().as_secs_f64(), "actions": rows});
    std::fs::write(&out, serde_json::to_string_pretty(&summary).unwrap()).map_err(|e| e.to_string())?;
    println!("json  {}", out.display());
    Ok(())
}

// ---------------------------------------------------------------- value iteration

pub struct ViResult {
    /// the states, projected on the features (dropped features are 0)
    pub keys: Vec<State>,
    pub n: Vec<[u32; NA]>,
    pub q: Vec<[f64; NA]>,
    pub v: Vec<f64>,
    /// argmax action, or None when no action reaches min_count
    pub pi: Vec<Option<u8>>,
    /// the most common start state (projected), if any
    pub start: Option<usize>,
    pub sweeps: usize,
    /// the largest change of V in the last sweep (0 for the exact backward sweep)
    pub last_change: f64,
}

/// Value iteration on the learned model. `na`: the action set's size (actions 0..na); transitions played by the
/// default (DEFAULT_ACTION) count only in a state's fallback mean. With the turn in `features`, one backward sweep;
/// without it, Jacobi sweeps from V = 0 until the largest change is below 1e-6 or HORIZON sweeps.
pub fn value_iteration(train: &[Traj], min_count: u32, features: FeatureMask, na: usize) -> ViResult {
    assert!(na <= NA);
    let mut idx: HashMap<State, u32> = HashMap::new();
    let mut keys: Vec<State> = Vec::new();
    let mut flat: Vec<(u32, u8, f32, u32)> = Vec::new();
    let mut starts: HashMap<u32, u32> = HashMap::new();
    for tr in train {
        let ids: Vec<u32> = tr
            .states
            .iter()
            .map(|s| {
                let p = features.project(s);
                *idx.entry(p).or_insert_with(|| {
                    keys.push(p);
                    (keys.len() - 1) as u32
                })
            })
            .collect();
        if let Some(&i0) = ids.first() {
            *starts.entry(i0).or_default() += 1;
        }
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
    let ns = keys.len();
    let mut off = vec![0usize; ns + 1];
    for x in &flat {
        off[x.0 as usize + 1] += 1;
    }
    for i in 0..ns {
        off[i + 1] += off[i];
    }
    let mut n = vec![[0u32; NA]; ns];
    for &(i, a, _, _) in &flat {
        if (a as usize) < na {
            n[i as usize][a as usize] += 1;
        }
    }
    let m = min_count.max(1);
    // one backup of state i from the values `v`: Q, then V and the policy entry
    let backup = |i: usize, v: &[f64], q: &mut [f64; NA]| -> (f64, Option<u8>) {
        let mut sum = [0.0f64; NA];
        let mut all = 0.0f64;
        for &(_, a, r, nx) in &flat[off[i]..off[i + 1]] {
            let x = r as f64 + if nx == TERM { 0.0 } else { v[nx as usize] };
            all += x;
            if (a as usize) < na {
                sum[a as usize] += x;
            }
        }
        let mut best: Option<(f64, usize)> = None;
        for a in 0..na {
            if n[i][a] > 0 {
                q[a] = sum[a] / n[i][a] as f64;
            }
            if n[i][a] >= m && best.map_or(true, |(b, _)| q[a] > b) {
                best = Some((q[a], a));
            }
        }
        match best {
            Some((b, a)) => (b, Some(a as u8)),
            None => (all / (off[i + 1] - off[i]) as f64, None),
        }
    };
    let mut v = vec![0.0f64; ns];
    let mut q = vec![[f64::NAN; NA]; ns];
    let mut pi = vec![None; ns];
    let (sweeps, last_change) = if features.has_turn() {
        // successors are at a later turn: from the last turn down, every successor is final before it is used
        let mut order: Vec<usize> = (0..ns).collect();
        order.sort_by(|a, b| keys[*b][0].cmp(&keys[*a][0]));
        for &i in &order {
            let (x, p) = backup(i, &v, &mut q[i]);
            v[i] = x;
            pi[i] = p;
        }
        (1, 0.0)
    } else {
        let mut done = 0;
        let mut change = f64::INFINITY;
        while done < HORIZON && change >= 1e-6 {
            let old = v.clone();
            change = 0.0;
            for i in 0..ns {
                let (x, p) = backup(i, &old, &mut q[i]);
                change = change.max((x - old[i]).abs());
                v[i] = x;
                pi[i] = p;
            }
            done += 1;
        }
        (done, change)
    };
    let start = starts.into_iter().max_by_key(|&(i, c)| (c, std::cmp::Reverse(i))).map(|(i, _)| i as usize);
    ViResult { keys, n, q, v, pi, start, sweeps, last_change }
}

pub fn fit_vi_cmd(m: &HashMap<String, String>) -> R<()> {
    // --train a.tsv,b.tsv,...: all games together (off-policy is fine: Q conditions on the action taken); the
    // first file's setup is the policy header's, and every file must share the base bot, boost, opponents and actions
    let files: Vec<&str> = m.get("train").ok_or("--train <file.tsv>[,<file.tsv>...] is required")?.split(',').filter(|x| !x.is_empty()).collect();
    let (meta, mut train) = read(files[0])?;
    let set = ActionSet::by_id(meta["actionSet"].as_str())?;
    for f in &files[1..] {
        let (mt, tr) = read(f)?;
        for k in ["model", "opp", "players", "difficulty", "humanLearner"] {
            if mt[k] != meta[k] {
                return Err(format!("{f}: {k} {} differs from {}'s {}", mt[k], files[0], meta[k]));
            }
        }
        // files from before the boost and the action set were recorded used boost 2 and strategic5
        let boost = |v: &Value| v["boost"].as_f64().unwrap_or(2.0);
        if boost(&mt) != boost(&meta) {
            return Err(format!("{f}: boost {} differs from {}'s {}", boost(&mt), files[0], boost(&meta)));
        }
        if ActionSet::by_id(mt["actionSet"].as_str())?.id != set.id {
            return Err(format!("{f}: another action set than {}'s {}", files[0], set.id));
        }
        train.extend(tr);
    }
    let features = match m.get("features") {
        None => FeatureMask::ALL,
        Some(l) => FeatureMask::from_names(&l.split(',').map(|x| x.trim()).filter(|x| !x.is_empty()).collect::<Vec<_>>())?,
    };
    let na = set.len();
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
        let r = value_iteration(&train, mc, features, na);
        let visits: Vec<u32> = (0..r.keys.len()).map(|i| r.n[i].iter().sum()).collect();
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
        // the header names the base bot, the boost, the action set and the features, so the file plays on its own
        // (rl-gate --candidate rl-policy:<file>)
        let head = json!({"tool": "rl-value fit-vi", "model": meta["model"], "boost": meta["boost"].as_f64().unwrap_or(2.0), "minCount": mc,
                          "actions": set.id, "actionNames": set.names, "features": features.names(),
                          "train": files, "trainGames": train.len(), "opp": meta["opp"], "players": meta["players"],
                          "difficulty": meta["difficulty"], "humanLearner": meta["humanLearner"], "sweeps": r.sweeps, "lastChange": r.last_change});
        writeln!(w, "# {head}").unwrap();
        writeln!(w, "turn\tcities\tincome\tunits\tlevels\ttechs\taction\tv\tvisits\t{}", set.names.iter().map(|a| format!("q_{a}")).collect::<Vec<_>>().join("\t")).unwrap();
        let mut order: Vec<usize> = (0..r.keys.len()).filter(|&i| r.pi[i].is_some()).collect();
        order.sort_by_key(|&i| r.keys[i]);
        for i in order {
            let k = r.keys[i];
            let qs: Vec<String> = (0..na).map(|a| if r.q[i][a].is_nan() { String::new() } else { format!("{:.1}", r.q[i][a]) }).collect();
            writeln!(w, "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.1}\t{}\t{}", k[0], k[1], k[2], k[3], k[4], k[5], r.pi[i].unwrap(), r.v[i], visits[i], qs.join("\t")).unwrap();
        }
        w.flush().map_err(|e| e.to_string())?;
        let s0j = r.start.map(|i| {
            json!({"state": r.keys[i], "visits": visits[i], "v": r.v[i],
                   "q": (0..na).map(|a| if r.q[i][a].is_nan() { Value::Null } else { json!(r.q[i][a]) }).collect::<Vec<_>>(),
                   "action": r.pi[i].map(|a| set.names[a as usize])})
        });
        let share: serde_json::Map<String, Value> = (0..na).map(|a| (set.names[a].to_string(), json!(by_action[a] as f64 / total as f64))).collect();
        println!(
            "min-count {mc:>3}: {} states, policy entries cover {:.1}% of visits; by visits {}; V(start) {:.0}; {} sweep(s), last change {:.3}  -> {}",
            r.keys.len(),
            100.0 * (total - none) as f64 / total as f64,
            (0..na).map(|a| format!("{} {:.1}%", set.names[a], 100.0 * by_action[a] as f64 / total as f64)).collect::<Vec<_>>().join(", "),
            r.start.map_or(f64::NAN, |i| r.v[i]),
            r.sweeps,
            r.last_change,
            f.display()
        );
        rows.push(json!({"minCount": mc, "states": r.keys.len(), "visits": total, "policyCoverage": (total - none) as f64 / total as f64,
                         "actionShareByVisits": share, "start": s0j, "sweeps": r.sweeps, "lastChange": r.last_change,
                         "seconds": t0.elapsed().as_secs_f64(), "policy": f.display().to_string()}));
    }
    let summary = json!({"tool": "rl-value fit-vi", "actions": set.id, "actionNames": set.names, "features": features.names(),
                         "trainSetup": meta, "trainFiles": files, "trainGames": train.len(), "runs": rows});
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
    let set = su.actions;
    let pol = m.get("policy").ok_or("--policy <policy.tsv> is required")?;
    let cand = Driver::Policy(Table::load(pol)?);
    cand.check(set)?;
    let based = Driver::parse(m.get("base-driver").map(|x| x.as_str()).unwrap_or("bot"))?;
    based.check(set)?;
    let out = PathBuf::from(m.get("out").ok_or("--out <file.json> is required")?);
    let na = set.len();
    let t0 = Instant::now();
    // per seed: candidate and base final score, the candidate's actions (index na: the default) and turns in a policy state
    let res: Vec<(i64, f64, f64, [u32; NA + 1], u32, Vec<(i32, usize)>)> = (seed_start..seed_start + n)
        .into_par_iter()
        .map(|seed| {
            let c = play(seed, &su, &cand)?;
            let b = play(seed, &su, &based)?;
            let mut used = [0u32; NA + 1];
            let mut known = 0;
            let Driver::Policy(t) = &cand else { unreachable!() };
            // a level policy keys on the level before the turn: the previous row's action, the default at first
            let mut prev = set.default.unwrap_or(0);
            let mut levels = Vec::new();
            for r in &c[..c.len() - 1] {
                used[if r[8] < 0 { na } else { r[8] as usize }] += 1;
                let f = [r[0], r[1], r[2], r[3], r[4], r[5]];
                if match t.level { Some(b) => t.t.contains_key(&level_key(&f, prev, b)), None => t.has(&f) } {
                    known += 1;
                }
                if r[8] >= 0 {
                    prev = r[8] as usize;
                    levels.push((r[0], prev));
                }
            }
            Ok((seed, c.last().unwrap()[6] as f64, b.last().unwrap()[6] as f64, used, known, levels))
        })
        .collect::<R<_>>()?;
    let cs: Vec<f64> = res.iter().map(|r| r.1).collect();
    let bs: Vec<f64> = res.iter().map(|r| r.2).collect();
    let g = gate_rule(&cs, &bs, 0.01);
    let mut used = [0u64; NA + 1];
    let mut known = 0u64;
    for r in &res {
        for a in 0..=na {
            used[a] += r.3[a] as u64;
        }
        known += r.4 as u64;
    }
    let turns: u64 = used.iter().sum();
    let mut names: Vec<String> = set.names.iter().map(|s| s.to_string()).collect();
    if set.default.is_none() {
        names.push("bot (default)".into());
    }
    let shown = names.len();
    println!("eval   {} vs {} ({model}, {}), opponents {opp}, {} players, {}, seeds {seed_start}..{}", cand.label(set), based.label(set), set.id, su.players, su.difficulty, seed_start + n - 1);
    println!("score  policy mean {:.0} median {:.0} p10 {:.0} | base mean {:.0} median {:.0} p10 {:.0}", mean(&cs), quantile(&cs, 0.5), quantile(&cs, 0.1), mean(&bs), quantile(&bs, 0.5), quantile(&bs, 0.1));
    println!("seeds  better {} worse {} ties {}, sign p {:.3e}, mean d {:.1} (upper {:.1})", g["better"], g["worse"], g["ties"], g["signP"].as_f64().unwrap_or(f64::NAN), g["meanD"].as_f64().unwrap_or(0.0), g["meanDUpper"].as_f64().unwrap_or(0.0));
    println!("turns  in a policy state {:.1}%; actions {}", 100.0 * known as f64 / turns as f64, (0..shown).map(|a| format!("{} {:.1}%", names[a], 100.0 * used[a] as f64 / turns as f64)).collect::<Vec<_>>().join(", "));
    // a level set: the mean factor the candidate played, by turn
    let mut by_turn = serde_json::Map::new();
    if let Some(sc) = set.scale {
        let mut acc: std::collections::BTreeMap<i32, (f64, u32)> = Default::default();
        for r in &res {
            for &(t, l) in &r.5 {
                let e = acc.entry(t).or_default();
                e.0 += sc[l];
                e.1 += 1;
            }
        }
        println!("level  mean factor by turn: {}", acc.iter().map(|(t, (s, c))| format!("{t}:{:.2}", s / *c as f64)).collect::<Vec<_>>().join(" "));
        by_turn = acc.iter().map(|(t, (s, c))| (t.to_string(), json!(s / *c as f64))).collect();
    }
    println!("rule   {} ({:.1} s)", g["verdict"], t0.elapsed().as_secs_f64());
    let per: Vec<Value> = res.iter().map(|r| json!({"seed": r.0, "candidate": r.1, "base": r.2, "d": r.1 - r.2})).collect();
    let summary = json!({"tool": "rl-value eval", "policy": pol, "baseDriver": based.label(set), "model": model, "opp": opp, "players": su.players, "difficulty": su.difficulty,
                         "humanLearner": su.human, "boost": get(m, "boost", 2.0)?, "actionSet": set.id, "n": n, "seedStart": seed_start,
                         "candidate": stats(&cs), "base": stats(&bs), "gate": g, "policyStateShare": known as f64 / turns as f64,
                         "actionShare": (0..shown).map(|a| (names[a].clone(), json!(used[a] as f64 / turns as f64))).collect::<serde_json::Map<_, _>>(),
                         "levelFactorByTurn": by_turn, "wallSeconds": t0.elapsed().as_secs_f64(), "perSeed": per});
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
        let r = value_iteration(&games, 1, FeatureMask::ALL, 5);
        let i = r.keys.iter().position(|k| *k == s0).unwrap();
        assert_eq!(r.pi[i], Some(1));
        assert_eq!(r.v[i], 105.0);
        assert_eq!(r.q[i][3], 15.0);
        // with min-count 3 no action qualifies: no policy entry, V = mean over all transitions
        let r = value_iteration(&games, 3, FeatureMask::ALL, 5);
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
        assert_eq!(su.actions.id, "strategic5", "the default action set");
        assert!(rows[..rows.len() - 1].iter().all(|r| r[8] == 0));
        let a = play(11, &su, &Driver::Random).unwrap();
        assert_eq!(a, play(11, &su, &Driver::Random).unwrap());
        let used: std::collections::HashSet<i32> = a.iter().take(a.len() - 1).map(|r| r[8]).collect();
        assert!(used.len() >= 3, "random driver should use several actions: {used:?}");
    }

    fn table(t: HashMap<State, u8>, set: &'static ActionSet, features: FeatureMask) -> Table {
        Table { t, path: "t".into(), features, actions: set, level: None }
    }

    #[test]
    fn walk_moves_one_step_and_level_policies_keep_their_level() {
        use rl_value::strategic::ECON5;
        let f = |turn: i32| [turn, 1, 5, 1, 1, 1];
        let mut seen = std::collections::HashSet::new();
        for seed in 0..200 {
            let mut p = Driver::Walk.picker(seed, &ECON5);
            let mut prev = 3;
            let path: Vec<usize> = (0..30).map(|t| p(&f(t)).unwrap()).collect();
            for &l in &path {
                assert!(l.abs_diff(prev) <= 1 && l < 5, "seed {seed}: {prev} -> {l}");
                prev = l;
                seen.insert(l);
            }
            let mut again = Driver::Walk.picker(seed, &ECON5);
            assert_eq!(path, (0..30).map(|t| again(&f(t)).unwrap()).collect::<Vec<_>>(), "reproducible");
        }
        assert_eq!(seen.len(), 5, "the walk reaches every level");
        assert!(Driver::Walk.check(&rl_value::strategic::SPEND4).is_err());
        // a level policy: turn 0 at x1 wants x0.25 (two steps away): one step to x0.75; turn 1 at x0.75 has no entry:
        // keep x0.75; turn 2 at x0.75 -> x0.5
        let t: HashMap<State, u8> = [([0, 3, 0, 0, 0, 0], 0u8), ([2, 2, 0, 0, 0, 0], 1u8)].into_iter().collect();
        let d = Driver::Policy(Table { level: Some(0), ..table(t, &ECON5, FeatureMask::ALL) });
        let mut p = d.picker(1, &ECON5);
        assert_eq!((0..4).map(|t| p(&f(t)).unwrap()).collect::<Vec<_>>(), vec![2, 2, 1, 1]);
    }

    #[test]
    fn eps_policy_explores_at_the_given_rate() {
        use rl_value::strategic::{SPEND3, STRATEGIC5};
        let t: HashMap<State, u8> = (0..30).map(|turn| ([turn, 1, 2, 1, 1, 1], 4u8)).collect();
        let at = |eps: f64| Driver::EpsPolicy(table(t.clone(), &STRATEGIC5, FeatureMask::ALL), eps);
        let (d0, d1, d2) = (at(0.0), at(1.0), at(0.2));
        let mut off = 0;
        let mut counts = [0usize; NA];
        let n = 20_000;
        for seed in 0..n / 30 {
            for turn in 0..30 {
                let f = [turn, 1, 2, 1, 1, 1];
                assert_eq!(d0.pick(seed, &f, &STRATEGIC5), Some(4), "eps 0 is the policy");
                counts[d1.pick(seed, &f, &STRATEGIC5).unwrap()] += 1;
                let a = d2.pick(seed, &f, &STRATEGIC5);
                assert_eq!(a, d2.pick(seed, &f, &STRATEGIC5), "reproducible");
                off += (a != Some(4)) as usize;
            }
        }
        let total = (n / 30 * 30) as f64;
        // eps 0.2: a random action 20% of the time, of which 4 in 5 differ from the policy's
        assert!((off as f64 / total - 0.16).abs() < 0.015, "{}", off as f64 / total);
        assert!(counts.iter().all(|&c| (c as f64 / total - 0.2).abs() < 0.02), "eps 1 is uniform: {counts:?}");
        assert_eq!(at(0.0).pick(3, &[5, 9, 9, 9, 9, 9], &STRATEGIC5), Some(0), "unknown state: strategic5's bot");
        // spend3: random actions are 0..3, the bot is the base (None), and an unknown state plays the base
        let r: std::collections::HashSet<Option<usize>> = (0..300).map(|s| Driver::Random.pick(s, &[3, 1, 1, 1, 1, 1], &SPEND3)).collect();
        assert_eq!(r, [Some(0), Some(1), Some(2)].into_iter().collect());
        assert_eq!(Driver::Bot.pick(1, &[3, 1, 1, 1, 1, 1], &SPEND3), None);
        let p = Driver::Policy(table([([0, 1, 2, 1, 0, 1], 2u8)].into_iter().collect(), &SPEND3, FeatureMask::from_names(&["cities", "income", "units", "techs"]).unwrap()));
        assert_eq!(p.pick(1, &[17, 1, 2, 1, 8, 1], &SPEND3), Some(2), "turn and levels ignored");
        assert_eq!(p.pick(1, &[17, 1, 2, 1, 8, 2], &SPEND3), None);
        assert!(p.check(&STRATEGIC5).is_err() && p.check(&SPEND3).is_ok());
        assert!(Driver::Fixed(3).check(&SPEND3).is_err());
    }

    /// Without the turn, the same projected state recurs; the sweeps repeat until the values settle.
    #[test]
    fn value_iteration_without_the_turn_sweeps_to_a_fixed_point() {
        let no_turn = FeatureMask::from_names(&["cities", "income", "units", "techs"]).unwrap();
        let (a, b) = ([0, 1, 2, 1, 0, 1], [2, 1, 2, 1, 0, 2]);
        // a (turn 0) -> a (turn 1, +10) -> b (+20) -> end (+5): a recurs at turns 0 and 1 once projected
        let g = vec![tr(&[a, [1, 1, 2, 1, 0, 1], b], &[0, 0, 2], &[0, 10, 30], 35)];
        let r = value_iteration(&g, 1, no_turn, 3);
        let ia = r.keys.iter().position(|k| *k == no_turn.project(&a)).unwrap();
        let ib = r.keys.iter().position(|k| *k == no_turn.project(&b)).unwrap();
        assert_eq!(r.keys.len(), 2, "turn dropped: a at turns 0 and 1 is one state");
        assert_eq!(r.v[ib], 5.0);
        // a: half its transitions loop (+10 back to a), half go to b (+20 then b's 5): V = 0.5 (10 + V) + 0.5 (25), so
        // V = 35 at the fixed point; the self-loop halves the error each sweep, so it settles in about 26 sweeps
        assert!((r.v[ia] - 35.0).abs() < 1e-5, "{}", r.v[ia]);
        assert!(r.sweeps > 1 && r.sweeps < HORIZON && r.last_change < 1e-6, "{} sweeps, change {}", r.sweeps, r.last_change);
        assert_eq!(r.start, Some(ia));
        // with the turn: one exact backward sweep, a at turn 0 is worth 35 (10 + 20 + 5)
        let r = value_iteration(&g, 1, FeatureMask::ALL, 3);
        let i0 = r.keys.iter().position(|k| *k == a).unwrap();
        assert_eq!((r.sweeps, r.v[i0]), (1, 35.0));
        // turns played by the default count in the fallback mean only
        let g = vec![tr(&[a], &[DEFAULT_ACTION], &[0], 7)];
        let r = value_iteration(&g, 1, FeatureMask::ALL, 3);
        assert_eq!((r.pi[0], r.v[0], r.n[0].iter().sum::<u32>()), (None, 7.0, 0));
    }
}
