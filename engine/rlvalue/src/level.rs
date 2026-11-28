//! Value iteration over a lasting level (experiment 29, David, issue #166).
//!
//! The action set is a level set (`econ5`: the base bot's build factor x0.25 .. x1.5). The level carries over from
//! turn to turn and moves one step at most, so the state is (turn, level before the turn) and, optionally, the
//! learner's income in buckets of `--income-bucket` (`level_key`). The action is the level played this turn (one of
//! the level before and its neighbours); the data come from a random walk over the levels (`--driver walk`).
//!
//! Certainty-equivalence model as in `vi::value_iteration`: Q(s, a) = mean over the observed transitions of
//! r + V(s'), with r the score gained during the turn; V(s) = max over the actions with at least `min-count`
//! samples, else the mean over all of s's transitions and the level is kept. The turn is in the state, so one
//! backward sweep from the last turn is exact; gamma = 1. Alongside, the same model evaluates "keep x1 all game"
//! (the base bot) for the predicted gain.
use crate::vi::DEFAULT_ACTION;
use crate::{read, Traj, R};
use rl_value::strategic::{level_key, ActionSet, State, NA};
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

/// one state's transitions, by action (the level played): count, summed reward, successors (None: game over)
#[derive(Default)]
struct Cell {
    n: [u32; NA],
    r: [f64; NA],
    next: [HashMap<Option<State>, u32>; NA],
}

pub struct LevelVi {
    pub keys: Vec<State>,
    pub n: Vec<[u32; NA]>,
    pub q: Vec<[f64; NA]>,
    pub v: Vec<f64>,
    /// the level chosen in each state (the level before when no action has min-count samples)
    pub pi: Vec<usize>,
    /// "keep the default level" evaluated on the same model
    pub v_stay: Vec<f64>,
    /// start states (first learner turn at the default level) with their counts
    pub starts: Vec<(usize, u32)>,
}

pub fn level_vi(train: &[Traj], set: &ActionSet, bucket: i32, min_count: u32) -> R<LevelVi> {
    let start = set.default.ok_or("a level set needs a default level")?;
    let mut cells: HashMap<State, Cell> = HashMap::new();
    let mut starts: HashMap<State, u32> = HashMap::new();
    for tr in train {
        let mut prev = start;
        for i in 0..tr.states.len() {
            let a = tr.actions[i];
            if a == DEFAULT_ACTION || a as usize >= set.len() {
                return Err(format!("action {a} in the data: not a level of {}", set.id));
            }
            let a = a as usize;
            if set.step(prev, a) != a {
                return Err(format!("level {prev} -> {a}: more than one step (data not from a level walk?)"));
            }
            let k = level_key(&tr.states[i], prev, bucket);
            if i == 0 {
                *starts.entry(k).or_default() += 1;
            }
            let (r, nx) = match tr.states.get(i + 1) {
                Some(s1) => (tr.scores[i + 1] - tr.scores[i], Some(level_key(s1, a, bucket))),
                None => (tr.fin - tr.scores[i], None),
            };
            let c = cells.entry(k).or_default();
            c.n[a] += 1;
            c.r[a] += r as f64;
            *c.next[a].entry(nx).or_default() += 1;
            prev = a;
        }
    }
    let mut keys: Vec<State> = cells.keys().copied().collect();
    // later turns first: every successor is a later turn, so its value is known when it is needed
    keys.sort_by(|a, b| b.cmp(a));
    let idx: HashMap<State, usize> = keys.iter().enumerate().map(|(i, k)| (*k, i)).collect();
    let m = keys.len();
    let (mut v, mut v_stay, mut pi) = (vec![0.0; m], vec![0.0; m], vec![0; m]);
    let mut q = vec![[f64::NAN; NA]; m];
    let mut n = vec![[0u32; NA]; m];
    let val = |vals: &[f64], nx: &Option<State>| -> R<f64> {
        match nx {
            None => Ok(0.0),
            Some(s) => idx.get(s).map(|&j| vals[j]).ok_or(format!("successor {s:?} has no transitions")),
        }
    };
    for (i, k) in keys.iter().enumerate() {
        let c = &cells[k];
        n[i] = c.n;
        let prev = k[1] as usize;
        // Q under the optimal values and under "keep the level" values
        let (mut tot, mut tot_s, mut cnt) = (0.0, 0.0, 0u32);
        let mut q_stay = f64::NAN;
        for a in 0..set.len() {
            if c.n[a] == 0 {
                continue;
            }
            let (mut sv, mut ss) = (c.r[a], c.r[a]);
            for (nx, &w) in &c.next[a] {
                if let Some(s) = nx {
                    if s[0] <= k[0] {
                        return Err(format!("successor {s:?} of {k:?} is not a later turn"));
                    }
                }
                sv += w as f64 * val(&v, nx)?;
                ss += w as f64 * val(&v_stay, nx)?;
            }
            q[i][a] = sv / c.n[a] as f64;
            if a == prev {
                q_stay = ss / c.n[a] as f64;
            }
            tot += sv;
            tot_s += ss;
            cnt += c.n[a];
        }
        let best = (0..set.len()).filter(|&a| c.n[a] >= min_count).max_by(|&a, &b| q[i][a].total_cmp(&q[i][b]));
        (v[i], pi[i]) = match best {
            Some(a) => (q[i][a], a),
            None => (tot / cnt as f64, prev),
        };
        v_stay[i] = if q_stay.is_nan() { tot_s / cnt as f64 } else { q_stay };
    }
    let starts = starts.into_iter().map(|(k, c)| (idx[&k], c)).collect();
    Ok(LevelVi { keys, n, q, v, pi, v_stay, starts })
}

impl LevelVi {
    fn start_mean(&self, vals: &[f64]) -> f64 {
        let t: u32 = self.starts.iter().map(|s| s.1).sum();
        self.starts.iter().map(|&(i, c)| vals[i] * c as f64).sum::<f64>() / t as f64
    }
    /// without income in the state the policy is one path: the level per turn from the start
    fn path(&self) -> Vec<(i32, usize)> {
        let idx: HashMap<State, usize> = self.keys.iter().enumerate().map(|(i, k)| (*k, i)).collect();
        let Some(&(mut i, _)) = self.starts.iter().max_by_key(|s| s.1) else { return vec![] };
        let mut out = vec![];
        loop {
            let (k, a) = (self.keys[i], self.pi[i]);
            out.push((k[0], a));
            match idx.get(&[k[0] + 1, a as i32, k[2], 0, 0, 0]) {
                Some(&j) => i = j,
                None => break,
            }
        }
        out
    }
}

pub fn fit_level_cmd(m: &HashMap<String, String>) -> R<()> {
    let files: Vec<&str> = m.get("train").ok_or("--train <file.tsv>[,<file.tsv>...] is required")?.split(',').filter(|x| !x.is_empty()).collect();
    let (meta, mut train) = read(files[0])?;
    let set = ActionSet::by_id(meta["actionSet"].as_str())?;
    if !set.is_level() {
        return Err(format!("{}: action set {} is not a level set (collect --actions econ5 --driver walk)", files[0], set.id));
    }
    for f in &files[1..] {
        let (mt, tr) = read(f)?;
        for k in ["model", "opp", "players", "difficulty", "humanLearner", "actionSet"] {
            if mt[k] != meta[k] {
                return Err(format!("{f}: {k} {} differs from {}'s {}", mt[k], files[0], meta[k]));
            }
        }
        train.extend(tr);
    }
    let bucket: i32 = crate::get(m, "income-bucket", 0)?;
    let out = PathBuf::from(m.get("out").ok_or("--out <dir> is required")?);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let counts: Vec<u32> = m
        .get("min-count")
        .map(|s| s.split(',').map(|x| x.parse().map_err(|_| format!("--min-count {x:?}"))).collect::<R<Vec<_>>>())
        .transpose()?
        .unwrap_or(vec![20, 100, 500]);
    let na = set.len();
    let mut runs = vec![];
    for &mc in &counts {
        let r = level_vi(&train, set, bucket, mc)?;
        let visits: Vec<u32> = r.n.iter().map(|x| x.iter().sum()).collect();
        let total: u64 = visits.iter().map(|&x| x as u64).sum();
        let mut share = [0u64; NA];
        for i in 0..r.keys.len() {
            share[r.pi[i]] += visits[i] as u64;
        }
        let (v0, vs0) = (r.start_mean(&r.v), r.start_mean(&r.v_stay));
        let f = out.join(format!("policy-b{bucket}-m{mc}.tsv"));
        let mut w = BufWriter::new(std::fs::File::create(&f).map_err(|e| e.to_string())?);
        let head = json!({"tool": "rl-value fit-level", "model": meta["model"], "boost": 1.0, "actions": set.id, "actionNames": set.names,
                          "levelKey": {"incomeBucket": bucket}, "minCount": mc, "train": files, "trainGames": train.len(),
                          "opp": meta["opp"], "players": meta["players"], "difficulty": meta["difficulty"], "humanLearner": meta["humanLearner"],
                          "vStart": v0, "vKeepDefaultStart": vs0});
        writeln!(w, "# {head}").unwrap();
        writeln!(
            w,
            "turn\tlevel\tincomeBucket\t-\t-\t-\taction\tv\tvisits\t{}\t{}",
            set.names.iter().map(|a| format!("n_{a}")).collect::<Vec<_>>().join("\t"),
            set.names.iter().map(|a| format!("q_{a}")).collect::<Vec<_>>().join("\t")
        )
        .unwrap();
        let mut order: Vec<usize> = (0..r.keys.len()).collect();
        order.sort_by_key(|&i| r.keys[i]);
        for i in order {
            let k = r.keys[i];
            let ns: Vec<String> = (0..na).map(|a| r.n[i][a].to_string()).collect();
            let qs: Vec<String> = (0..na).map(|a| if r.q[i][a].is_nan() { String::new() } else { format!("{:.1}", r.q[i][a]) }).collect();
            writeln!(w, "{}\t{}\t{}\t0\t0\t0\t{}\t{:.1}\t{}\t{}\t{}", k[0], k[1], k[2], r.pi[i], r.v[i], visits[i], ns.join("\t"), qs.join("\t")).unwrap();
        }
        w.flush().map_err(|e| e.to_string())?;
        let path = if bucket == 0 { r.path() } else { vec![] };
        let path_s = path.iter().map(|(t, a)| format!("{t}:{}", set.names[*a])).collect::<Vec<_>>().join(" ");
        println!(
            "income bucket {bucket}, min-count {mc:>3}: {} states; chosen levels by visits {}; V(start) {v0:.0}, keep x1 {vs0:.0}, predicted gain {:+.0}  -> {}",
            r.keys.len(),
            (0..na).map(|a| format!("{} {:.1}%", set.names[a], 100.0 * share[a] as f64 / total as f64)).collect::<Vec<_>>().join(", "),
            v0 - vs0,
            f.display()
        );
        if !path.is_empty() {
            println!("  path {path_s}");
        }
        runs.push(json!({"minCount": mc, "states": r.keys.len(), "visits": total, "vStart": v0, "vKeepDefaultStart": vs0, "predictedGain": v0 - vs0,
                         "chosenShareByVisits": (0..na).map(|a| (set.names[a].to_string(), json!(share[a] as f64 / total as f64))).collect::<serde_json::Map<_, _>>(),
                         "path": path.iter().map(|(t, a)| json!([t, set.names[*a]])).collect::<Vec<_>>(), "policy": f.display().to_string()}));
    }
    let summary = json!({"tool": "rl-value fit-level", "actions": set.id, "actionNames": set.names, "incomeBucket": bucket,
                         "trainSetup": meta, "trainFiles": files, "trainGames": train.len(), "runs": runs});
    let f = out.join(format!("level-summary-b{bucket}.json"));
    std::fs::write(&f, serde_json::to_string_pretty(&summary).unwrap()).map_err(|e| e.to_string())?;
    println!("json  {}", f.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rl_value::strategic::ECON5;

    fn tr(levels: &[u8], scores: &[i32], fin: i32) -> Traj {
        let states = (0..levels.len()).map(|t| [t as i32, 1, 5, 1, 1, 1]).collect();
        Traj { states, scores: scores.to_vec(), actions: levels.to_vec(), fin, won: false }
    }

    #[test]
    fn level_vi_follows_the_better_path() {
        // from x1 (3): down to 2 then 1 gains 10 + 30; staying gains 10 + 10; up to 4 then 4 gains 5 + 5
        let g = vec![tr(&[2, 1], &[0, 10], 40), tr(&[3, 3], &[0, 10], 20), tr(&[4, 4], &[0, 5], 10)];
        let r = level_vi(&g, &ECON5, 0, 1).unwrap();
        let at = |k: State| r.keys.iter().position(|x| *x == k).unwrap();
        let s0 = at([0, 3, 0, 0, 0, 0]);
        assert_eq!((r.pi[s0], r.v[s0], r.v_stay[s0]), (2, 40.0, 20.0));
        assert_eq!(r.path(), vec![(0, 2), (1, 1)]);
        // at (1, x0.75) only "down to x0.5" was seen; with min-count 2 nothing qualifies: keep the level, mean value
        let r2 = level_vi(&g, &ECON5, 0, 2).unwrap();
        let s1 = r2.keys.iter().position(|x| *x == [1, 2, 0, 0, 0, 0]).unwrap();
        assert_eq!((r2.pi[s1], r2.v[s1]), (2, 30.0));
        // more than one step is not a level walk
        assert!(level_vi(&[tr(&[1], &[0], 0)], &ECON5, 0, 1).is_err());
    }

    #[test]
    fn income_buckets_split_the_state() {
        let mut a = tr(&[3], &[0], 10);
        a.states[0][2] = 7;
        let mut b = tr(&[3], &[0], 20);
        b.states[0][2] = 2;
        let r = level_vi(&[a, b], &ECON5, 3, 1).unwrap();
        assert_eq!(r.keys.len(), 2, "income 7 and 2 fall in buckets 2 and 0");
        assert!(r.keys.contains(&[0, 3, 2, 0, 0, 0]) && r.keys.contains(&[0, 3, 0, 0, 0, 0]));
    }
}
