//! rl-value: the RL project's full-state value function (David's track, issue #166).
//!
//! The state of the learner seat is six exact integers, read at the start of each of its turns:
//! (turn, cities, income, units, sum of city levels, techs). The reward of a step is the change in the learner's
//! Perfection score (`score_of`) until its next turn; the last step runs to the final score. No bins, no caps.
//!
//! `collect` plays games and writes one row per learner turn plus one terminal row per game.
//! `fit` learns from the training rows, for each training-set size:
//!   * a tabular model: for every visited state the observed transitions (reward, next state); V by backward
//!     induction from the last turn, V(s) = mean over the transitions out of s of (r + V(s')), V(terminal) = 0.
//!     This is the certainty-equivalence (maximum-likelihood model) estimate, the one batch TD(0) converges to.
//!   * a Monte Carlo table: V(s) = mean return-to-go of the training visits to s.
//!   * a turn-only baseline: V(t) = mean return-to-go at turn t.
//! It evaluates them on held-out games (return-to-go = final score - score now) and reports state counts,
//! coverage and errors. A held-out state never seen in training gets the turn baseline as its prediction.
use rl_value::strategic::{self as sg, model_weights, repo_root, FullWeights, FEATURES};
pub(crate) use rl_value::strategic::State;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufWriter, Write};
use std::path::PathBuf;
use std::time::Instant;

mod vi;

type R<T> = Result<T, String>;

/// Seeds from here up are the gate's evaluation seeds (engine/gate); training and held-out data stay below.
const EVAL_SEED_START: i64 = 1_000_000_000;
const MODE: &str = "perfection";
const MAP_SIZE: i64 = 16;
const MAP_TYPE: &str = "continents";
const MAX_TURN: i32 = 60;
const MAX_MOVES: i64 = 1_000_000;
/// The engine's tribe ids, in its order (as in engine/gate).
const TRIBES: [&str; 16] = [
    "xinxi", "imperius", "bardur", "oumaji", "kickoo", "hoodrick", "luxidoor", "vengir", "zebasi", "aimo", "quetzali",
    "yadakk", "aquarion", "elyrion", "polaris", "cymanti",
];
pub(crate) const TERM: u32 = u32::MAX;


// ---------------------------------------------------------------- command line

fn args() -> (String, HashMap<String, String>) {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let cmd = a.first().cloned().unwrap_or_default();
    let mut m = HashMap::new();
    let mut i = 1;
    while i < a.len() {
        let k = a[i].trim_start_matches("--").to_string();
        let v = a.get(i + 1).cloned().unwrap_or_default();
        m.insert(k, v);
        i += 2;
    }
    (cmd, m)
}

pub(crate) fn get<T: std::str::FromStr>(m: &HashMap<String, String>, k: &str, d: T) -> R<T> {
    match m.get(k) {
        None => Ok(d),
        Some(s) => s.parse().map_err(|_| format!("--{k}: cannot parse {s:?}")),
    }
}

pub(crate) fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// seat 0 gets `tribe`, the opponents distinct other tribes drawn from the seed (the same rule as engine/gate)
fn tribes_for(seed: i64, tribe: &str, players: usize) -> Vec<String> {
    let mut pool: Vec<&str> = TRIBES.iter().copied().filter(|t| *t != tribe).collect();
    let mut out = vec![tribe.to_string()];
    let mut h = seed as u64;
    for _ in 1..players {
        h = splitmix64(h);
        let i = (h % pool.len() as u64) as usize;
        out.push(pool.remove(i).to_string());
    }
    out
}

// ---------------------------------------------------------------- collect

pub(crate) struct Setup {
    pub players: usize,
    pub tribe: String,
    pub difficulty: String,
    pub human: bool,
    /// the action set (--actions, default strategic5)
    pub actions: &'static sg::ActionSet,
    /// the learner's weights under each action of the set
    pub learner: Vec<FullWeights>,
    /// the base bot's weights (what the set's default None plays)
    pub base: FullWeights,
    /// the opponent list (rl-gate's default: champions registry entries 0 and 1, then the anchor); seat i (1..)
    /// plays opps[seat_assignment(seed, opps.len(), players - 1)[i - 1]]
    pub opps: Vec<FullWeights>,
}

/// rl-gate's champions registry and fixed anchor (engine/gate/src/main.rs, decision of 25 Nov 2026 on #166)
const REGISTRY: &str = "docs/rl-project/champions.json";
const ANCHOR: &str = "greedy-full-probe-perf";
/// rl-gate's random stream for the seat shuffle
const SEAT_STREAM: u64 = 0x5EA7_5EA7_0000_0003;

/// rl-gate's seat_assignment, copied exactly: the opponent list repeated to fill the seats, then a Fisher-Yates
/// permutation drawn only from the seed
fn seat_assignment(seed: i64, k: usize, seats: usize) -> Vec<usize> {
    let mut v: Vec<usize> = (0..seats).map(|i| i % k).collect();
    let mut h = (seed as u64) ^ SEAT_STREAM;
    for i in (1..seats).rev() {
        h = splitmix64(h);
        let j = (h % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
    v
}

/// rl-gate's default opponent list: registry entries 0 and 1 (current and previous champion), then the anchor
fn default_opponents() -> R<Vec<String>> {
    let f = repo_root().join(REGISTRY);
    let text = std::fs::read_to_string(&f).map_err(|e| format!("{}: {e}", f.display()))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", f.display()))?;
    let c = v["champions"].as_array().ok_or("champions registry: no champions array")?;
    if c.len() < 2 {
        return Err("champions registry: needs at least 2 entries".into());
    }
    let mut out = Vec::new();
    for e in &c[..2] {
        if e["kind"].as_str() != Some("greedy-model") {
            return Err(format!("champions registry: {} is not a greedy model; rl-value can only play greedy models", e["id"]));
        }
        out.push(e["id"].as_str().ok_or("champions registry: entry without id")?.to_string());
    }
    out.push(ANCHOR.to_string());
    Ok(out)
}

/// the setup from the command line (shared by collect, check and eval)
pub(crate) fn setup(m: &HashMap<String, String>) -> R<(Setup, String, String)> {
    let model = m.get("model").cloned().unwrap_or("greedy-full-probe-perf-r15".into());
    let opp_ids: Vec<String> = match m.get("opp") {
        Some(l) => l.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
        None => default_opponents()?,
    };
    let opp = opp_ids.join(",");
    let base = model_weights(&model)?;
    let actions = sg::ActionSet::by_id(m.get("actions").map(|x| x.as_str()))?;
    let su = Setup {
        players: get(m, "players", 4)?,
        tribe: m.get("tribe").cloned().unwrap_or("xinxi".into()),
        difficulty: m.get("difficulty").cloned().unwrap_or("crazy".into()),
        human: get::<i32>(m, "human", 1)? != 0,
        actions,
        learner: actions.weights(&base, get(m, "boost", 2.0)?),
        base: base.clone(),
        opps: opp_ids.iter().map(|id| model_weights(id)).collect::<R<_>>()?,
    };
    if su.opps.is_empty() || su.opps.len() > su.players - 1 {
        return Err(format!("{} opponents for {} opponent seats", su.opps.len(), su.players - 1));
    }
    Ok((su, model, opp))
}

/// one row per learner turn: state, score, terminal flag 0, the strategic action taken; then the terminal row
/// (final turn and score, flag 1, and 1 in the action column if the learner won). `drive` picks the learner's action at the start of each of its turns.
pub(crate) fn play(seed: i64, su: &Setup, drive: &vi::Driver) -> R<Vec<[i32; 9]>> {
    let tribes = tribes_for(seed, &su.tribe, su.players);
    let opts = sg::game_opts(seed, su.players, &su.difficulty, &tribes, su.human, MODE, MAP_SIZE, MAP_TYPE);
    let assign = seat_assignment(seed, su.opps.len(), su.players - 1);
    let opps: Vec<&FullWeights> = assign.iter().map(|&i| &su.opps[i]).collect();
    let mut pick = |f: &State| drive.pick(seed, f, su.actions);
    Ok(sg::play_game(&opts, &su.learner, &su.base, &mut pick, &opps, MAX_TURN, MAX_MOVES)?.rows)
}

fn collect(m: &HashMap<String, String>) -> R<()> {
    let games: i64 = get(m, "games", 1000)?;
    let seed_start: i64 = get(m, "seed-start", 1)?;
    if seed_start < 0 || seed_start + games > EVAL_SEED_START {
        return Err(format!("seeds {seed_start}..{} reach the gate's evaluation range ({EVAL_SEED_START}..)", seed_start + games));
    }
    let (su, model, opp) = setup(m)?;
    let drive = vi::Driver::parse(m.get("driver").map(|x| x.as_str()).unwrap_or("bot"))?;
    drive.check(su.actions)?;
    let out = PathBuf::from(m.get("out").ok_or("--out <file.tsv> is required")?);
    let threads: usize = get(m, "threads", 0)?;
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().map_err(|e| e.to_string())?;
    eprintln!(
        "rl-value collect: {games} games from seed {seed_start}, {model} ({}) vs {opp}, {} players, {}, human learner {}, {} threads",
        drive.label(su.actions),
        su.players,
        su.difficulty,
        su.human,
        pool.current_num_threads()
    );
    let t0 = Instant::now();
    let all: Vec<(i64, Vec<[i32; 9]>)> = pool.install(|| {
        (seed_start..seed_start + games)
            .into_par_iter()
            .map(|seed| play(seed, &su, &drive).map(|r| (seed, r)).map_err(|e| format!("seed {seed}: {e}")))
            .collect::<R<Vec<_>>>()
    })?;
    let wall = t0.elapsed().as_secs_f64();
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut w = BufWriter::new(std::fs::File::create(&out).map_err(|e| format!("{}: {e}", out.display()))?);
    let meta = json!({"model": model, "opp": opp, "players": su.players, "tribe": su.tribe, "difficulty": su.difficulty,
                      "humanLearner": su.human, "mode": MODE, "mapSize": MAP_SIZE, "mapType": MAP_TYPE,
                      "seedStart": seed_start, "games": games, "driver": drive.label(su.actions), "actions": su.actions.names, "actionSet": su.actions.id,
                      "boost": get(m, "boost", 2.0)?});
    writeln!(w, "# {meta}").unwrap();
    writeln!(w, "seed\tturn\tcities\tincome\tunits\tlevels\ttechs\tscore\tterminal\taction").unwrap();
    let mut rows = 0;
    for (seed, rs) in &all {
        for r in rs {
            writeln!(w, "{seed}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}", r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]).unwrap();
            rows += 1;
        }
    }
    w.flush().map_err(|e| e.to_string())?;
    eprintln!("rl-value collect: {rows} rows in {wall:.1} s -> {}", out.display());
    Ok(())
}

// ---------------------------------------------------------------- fit

pub(crate) struct Traj {
    pub states: Vec<State>,
    pub scores: Vec<i32>,
    /// the strategic action taken at each learner turn (0 in files without an action column)
    pub actions: Vec<u8>,
    pub fin: i32,
    /// the learner won (files from before the won flag: false)
    pub won: bool,
}

pub(crate) fn read(path: &str) -> R<(Value, Vec<Traj>)> {
    let f = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
    let mut meta = Value::Null;
    let mut out: Vec<Traj> = Vec::new();
    let mut cur: Option<(i64, Traj)> = None;
    for line in std::io::BufReader::new(f).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Some(m) = line.strip_prefix("# ") {
            meta = serde_json::from_str(m).unwrap_or(Value::Null);
            continue;
        }
        if line.starts_with("seed") || line.is_empty() {
            continue;
        }
        let v: Vec<i64> = line.split('\t').map(|x| x.parse().map_err(|_| format!("{path}: bad row {line:?}"))).collect::<R<_>>()?;
        let seed = v[0];
        let t = cur.get_or_insert_with(|| (seed, Traj { states: vec![], scores: vec![], actions: vec![], fin: 0, won: false }));
        if t.0 != seed {
            return Err(format!("{path}: seed {} has no terminal row", t.0));
        }
        if v[8] == 1 {
            let (_, mut tr) = cur.take().unwrap();
            tr.fin = v[7] as i32;
            tr.won = v.get(9).copied() == Some(1);
            out.push(tr);
        } else {
            t.1.states.push([v[1] as i32, v[2] as i32, v[3] as i32, v[4] as i32, v[5] as i32, v[6] as i32]);
            t.1.scores.push(v[7] as i32);
            // -1: a turn played by the base bot as the action set's default
            t.1.actions.push(match v.get(9).copied().unwrap_or(0) { -1 => vi::DEFAULT_ACTION, a => a as u8 });
        }
    }
    Ok((meta, out))
}

struct Model {
    idx: HashMap<State, u32>,
    keys: Vec<State>,
    n: Vec<u32>,
    v_ce: Vec<f64>,
    v_mc: Vec<f64>,
    /// mean return-to-go per turn (the baseline), indexed by turn
    v_turn: Vec<f64>,
    samples: usize,
    /// per state: distinct successors (states with n >= 2 only)
    succ_ratio: f64,
}

fn fit(train: &[Traj]) -> Model {
    let mut idx: HashMap<State, u32> = HashMap::new();
    let mut keys: Vec<State> = Vec::new();
    let mut n: Vec<u32> = Vec::new();
    let mut gsum: Vec<f64> = Vec::new();
    let mut trans: Vec<Vec<(f64, u32)>> = Vec::new();
    let mut tsum: Vec<(f64, f64)> = Vec::new();
    let mut samples = 0;
    let mut id = |s: State, keys: &mut Vec<State>, n: &mut Vec<u32>, gsum: &mut Vec<f64>, trans: &mut Vec<Vec<(f64, u32)>>| -> u32 {
        *idx.entry(s).or_insert_with(|| {
            keys.push(s);
            n.push(0);
            gsum.push(0.0);
            trans.push(Vec::new());
            (keys.len() - 1) as u32
        })
    };
    for tr in train {
        let ids: Vec<u32> = tr.states.iter().map(|&s| id(s, &mut keys, &mut n, &mut gsum, &mut trans)).collect();
        for k in 0..ids.len() {
            let i = ids[k] as usize;
            let g = (tr.fin - tr.scores[k]) as f64;
            let (r, next) = if k + 1 < ids.len() {
                ((tr.scores[k + 1] - tr.scores[k]) as f64, ids[k + 1])
            } else {
                ((tr.fin - tr.scores[k]) as f64, TERM)
            };
            n[i] += 1;
            gsum[i] += g;
            trans[i].push((r, next));
            let t = tr.states[k][0] as usize;
            if tsum.len() <= t {
                tsum.resize(t + 1, (0.0, 0.0));
            }
            tsum[t].0 += g;
            tsum[t].1 += 1.0;
            samples += 1;
        }
    }
    // backward induction: a successor is always a later turn, so later turns first
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by(|a, b| keys[*b][0].cmp(&keys[*a][0]));
    let mut v_ce = vec![0.0; keys.len()];
    for &i in &order {
        let mut sum = 0.0;
        for &(r, nx) in &trans[i] {
            let vn = if nx == TERM {
                0.0
            } else {
                debug_assert!(keys[nx as usize][0] > keys[i][0]);
                v_ce[nx as usize]
            };
            sum += r + vn;
        }
        v_ce[i] = sum / trans[i].len() as f64;
    }
    let v_mc: Vec<f64> = gsum.iter().zip(&n).map(|(g, c)| g / *c as f64).collect();
    let v_turn: Vec<f64> = tsum.iter().map(|(g, c)| if *c > 0.0 { g / c } else { 0.0 }).collect();
    let (mut rs, mut rc) = (0.0, 0.0);
    for t in &trans {
        if t.len() >= 2 {
            let mut d: Vec<u32> = t.iter().map(|x| x.1).collect();
            d.sort();
            d.dedup();
            rs += d.len() as f64 / t.len() as f64;
            rc += 1.0;
        }
    }
    Model { idx, keys, n, v_ce, v_mc, v_turn, samples, succ_ratio: if rc > 0.0 { rs / rc } else { f64::NAN } }
}

/// squared-error accumulators of one group of held-out samples
#[derive(Clone, Default)]
struct Acc {
    n: f64,
    g: f64,
    g2: f64,
    covered: f64,
    covered10: f64,
    // all samples (unseen states fall back to the turn baseline)
    base: f64,
    ce: f64,
    mc: f64,
    // covered samples only
    c_base: f64,
    c_ce: f64,
    c_mc: f64,
    // covered with at least 10 training visits
    c10_base: f64,
    c10_ce: f64,
    c10_mc: f64,
}

impl Acc {
    fn add(&mut self, g: f64, base: f64, seen: Option<(u32, f64, f64)>) {
        self.n += 1.0;
        self.g += g;
        self.g2 += g * g;
        let e = |p: f64| (g - p) * (g - p);
        self.base += e(base);
        match seen {
            None => {
                self.ce += e(base);
                self.mc += e(base);
            }
            Some((cnt, ce, mc)) => {
                self.ce += e(ce);
                self.mc += e(mc);
                self.covered += 1.0;
                self.c_base += e(base);
                self.c_ce += e(ce);
                self.c_mc += e(mc);
                if cnt >= 10 {
                    self.covered10 += 1.0;
                    self.c10_base += e(base);
                    self.c10_ce += e(ce);
                    self.c10_mc += e(mc);
                }
            }
        }
    }
    fn json(&self) -> Value {
        let rm = |s: f64, c: f64| if c > 0.0 { json!(((s / c).sqrt() * 10.0).round() / 10.0) } else { Value::Null };
        let var = if self.n > 0.0 { self.g2 / self.n - (self.g / self.n).powi(2) } else { 0.0 };
        json!({
            "samples": self.n, "meanReturn": if self.n > 0.0 { self.g / self.n } else { 0.0 }, "sdReturn": var.max(0.0).sqrt(),
            "coverage": if self.n > 0.0 { self.covered / self.n } else { 0.0 },
            "coverage10": if self.n > 0.0 { self.covered10 / self.n } else { 0.0 },
            "rmseAll": {"turn": rm(self.base, self.n), "model": rm(self.ce, self.n), "mc": rm(self.mc, self.n)},
            "rmseCovered": {"turn": rm(self.c_base, self.covered), "model": rm(self.c_ce, self.covered), "mc": rm(self.c_mc, self.covered)},
            "rmseCovered10": {"turn": rm(self.c10_base, self.covered10), "model": rm(self.c10_ce, self.covered10), "mc": rm(self.c10_mc, self.covered10)},
        })
    }
}

fn evaluate(md: &Model, test: &[Traj]) -> (Acc, Vec<Acc>) {
    let mut all = Acc::default();
    let mut per: Vec<Acc> = Vec::new();
    for tr in test {
        for (k, s) in tr.states.iter().enumerate() {
            let g = (tr.fin - tr.scores[k]) as f64;
            let t = s[0] as usize;
            let base = md.v_turn.get(t).copied().unwrap_or(0.0);
            let seen = md.idx.get(s).map(|&i| (md.n[i as usize], md.v_ce[i as usize], md.v_mc[i as usize]));
            all.add(g, base, seen);
            if per.len() <= t {
                per.resize(t + 1, Acc::default());
            }
            per[t].add(g, base, seen);
        }
    }
    (all, per)
}

fn state_stats(md: &Model) -> Value {
    let distinct = md.keys.len();
    let once = md.n.iter().filter(|c| **c == 1).count();
    let lt10 = md.n.iter().filter(|c| **c < 10).count();
    let visits_once = once as f64 / md.samples as f64;
    let visits_lt10: f64 = md.n.iter().filter(|c| **c < 10).map(|c| *c as f64).sum::<f64>() / md.samples as f64;
    let mut ranges = serde_json::Map::new();
    for (j, f) in FEATURES.iter().enumerate() {
        let lo = md.keys.iter().map(|k| k[j]).min().unwrap_or(0);
        let hi = md.keys.iter().map(|k| k[j]).max().unwrap_or(0);
        ranges.insert(f.to_string(), json!([lo, hi]));
    }
    json!({"samples": md.samples, "distinctStates": distinct, "statesSeenOnce": once, "statesSeenUnder10": lt10,
           "shareOfVisitsInStatesSeenOnce": visits_once, "shareOfVisitsInStatesSeenUnder10": visits_lt10,
           "meanVisitsPerState": md.samples as f64 / distinct as f64,
           "distinctSuccessorsPerVisit": md.succ_ratio, "ranges": ranges})
}

fn fit_cmd(m: &HashMap<String, String>) -> R<()> {
    let (meta, train) = read(m.get("train").ok_or("--train <file.tsv> is required")?)?;
    let (meta_test, test) = read(m.get("test").ok_or("--test <file.tsv> is required")?)?;
    let out = PathBuf::from(m.get("out").ok_or("--out <dir> is required")?);
    let sizes: Vec<usize> = match m.get("sizes") {
        Some(s) => s.split(',').map(|x| x.parse().map_err(|_| format!("--sizes: {x:?}"))).collect::<R<_>>()?,
        None => vec![train.len()],
    };
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let mut curve = Vec::new();
    let mut last: Option<(Model, Vec<Acc>)> = None;
    for &size in &sizes {
        let size = size.min(train.len());
        let t0 = Instant::now();
        let md = fit(&train[..size]);
        let (all, per) = evaluate(&md, &test);
        let row = json!({"trainGames": size, "fitSeconds": t0.elapsed().as_secs_f64(), "states": state_stats(&md), "test": all.json()});
        let a = &row["test"];
        println!(
            "train {size:>7} games: {:>8} states ({:.0}% seen once), test coverage {:.1}%, RMSE all: turn {} model {} mc {}; covered: turn {} model {} mc {}",
            md.keys.len(),
            100.0 * md.n.iter().filter(|c| **c == 1).count() as f64 / md.keys.len() as f64,
            100.0 * a["coverage"].as_f64().unwrap_or(0.0),
            a["rmseAll"]["turn"],
            a["rmseAll"]["model"],
            a["rmseAll"]["mc"],
            a["rmseCovered"]["turn"],
            a["rmseCovered"]["model"],
            a["rmseCovered"]["mc"],
        );
        curve.push(row);
        last = Some((md, per));
    }
    let (md, per) = last.ok_or("no sizes")?;
    let per_turn: Vec<Value> = per.iter().enumerate().filter(|(_, a)| a.n > 0.0).map(|(t, a)| {
        let mut v = a.json();
        v["turn"] = json!(t);
        v
    }).collect();
    let mut fins: Vec<f64> = test.iter().map(|t| t.fin as f64).collect();
    fins.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |p: f64| {
        let h = (fins.len() as f64 - 1.0) * p;
        let lo = h.floor() as usize;
        let hi = (lo + 1).min(fins.len() - 1);
        fins[lo] + (h - lo as f64) * (fins[hi] - fins[lo])
    };
    let nt = test.len() as f64;
    let mean_f = fins.iter().sum::<f64>() / nt;
    let sd_f = (fins.iter().map(|x| (x - mean_f).powi(2)).sum::<f64>() / (nt - 1.0)).sqrt();
    let wins = test.iter().filter(|t| t.won).count() as f64;
    let early = test.iter().filter(|t| t.states.len() < 30).count();
    // Wilson 95% interval of the win rate
    let (pw, z) = (wins / nt, 1.959964);
    let centre = (pw + z * z / (2.0 * nt)) / (1.0 + z * z / nt);
    let half = z * (pw * (1.0 - pw) / nt + z * z / (4.0 * nt * nt)).sqrt() / (1.0 + z * z / nt);
    let outcome = json!({"games": test.len(), "meanFinal": mean_f, "meanFinalCI95": [mean_f - z * sd_f / nt.sqrt(), mean_f + z * sd_f / nt.sqrt()],
                         "sdFinal": sd_f, "p10Final": q(0.1), "medianFinal": q(0.5), "p90Final": q(0.9),
                         "winRate": pw, "winRateCI95": [centre - half, centre + half], "gamesEndedBeforeTurn30": early});
    println!("test games: mean final {mean_f:.0} (sd {sd_f:.0}), median {:.0}, p10 {:.0}, win rate {:.2}% [{:.2}, {:.2}], ended early {early}",
             q(0.5), q(0.1), 100.0 * pw, 100.0 * (centre - half), 100.0 * (centre + half));
    let summary = json!({"tool": "rl-value fit", "features": FEATURES, "testOutcome": outcome, "trainSetup": meta, "testSetup": meta_test,
                         "trainGamesAvailable": train.len(), "testGames": test.len(), "curve": curve, "perTurn": per_turn});
    let f = out.join("value-summary.json");
    std::fs::write(&f, serde_json::to_string_pretty(&summary).unwrap()).map_err(|e| e.to_string())?;
    // the value table of the largest model, for value iteration later
    let mut order: Vec<usize> = (0..md.keys.len()).collect();
    order.sort_by(|a, b| md.keys[*a].cmp(&md.keys[*b]));
    let vt = out.join("value-table.tsv");
    let mut w = BufWriter::new(std::fs::File::create(&vt).map_err(|e| e.to_string())?);
    writeln!(w, "turn\tcities\tincome\tunits\tlevels\ttechs\tvisits\tv_model\tv_mc").unwrap();
    for i in order {
        let k = md.keys[i];
        writeln!(w, "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{:.1}\t{:.1}", k[0], k[1], k[2], k[3], k[4], k[5], md.n[i], md.v_ce[i], md.v_mc[i]).unwrap();
    }
    w.flush().map_err(|e| e.to_string())?;
    println!("json  {}\ntable {}", f.display(), vt.display());
    Ok(())
}

const USAGE: &str = "usage:
  rl-value collect --out <file.tsv> [--games 1000] [--seed-start 1] [--driver bot] [--model greedy-full-probe-perf-r15] [--opp a,b,c]
                   [--players 4] [--difficulty crazy] [--tribe xinxi] [--human 1] [--threads 0]
  rl-value fit --train <file.tsv> --test <file.tsv> --out <dir> [--sizes 1000,10000,...]
  rl-value check --games 2000 --seed-start 600000000 --out <file.json>     (each action played every turn)
  rl-value fit-vi --train <file.tsv>[,<file.tsv>...] --out <dir> [--min-count 1,5,20] [--features turn,cities,...]
                                                                          (value iteration -> policy-mN.tsv)
  rl-value eval --policy <policy.tsv> [--n 10000] [--seed-start 1000000000] --out <file.json>
collect, check and eval take the setup flags; --driver bot|random|fixed:K|policy:<file> picks the strategic
action of the learner each turn; --boost 2 is the weight multiplier of an action; --actions strategic5|spend3|spend4
the action set (spend3: economy, army, research; states without a policy entry play the bot unchanged;
spend4: bot, economy, army, research).
Seeds must stay below 1,000,000,000 (the gate's evaluation seeds).";

fn main() {
    let (cmd, m) = args();
    let r = match cmd.as_str() {
        "collect" => collect(&m),
        "fit" => fit_cmd(&m),
        "check" => vi::check(&m),
        "fit-vi" => vi::fit_vi_cmd(&m),
        "eval" => vi::eval(&m),
        _ => {
            println!("{USAGE}");
            Ok(())
        }
    };
    if let Err(e) = r {
        eprintln!("rl-value: error: {e}");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tr(states: &[State], scores: &[i32], fin: i32) -> Traj {
        Traj { states: states.to_vec(), scores: scores.to_vec(), actions: vec![0; states.len()], fin, won: false }
    }

    #[test]
    fn backward_induction_pools_successors() {
        // two games share the turn-1 state; their turn-0 states differ.
        // game A: s0a (score 0) -> s1 (score 10) -> end 30; game B: s0b (0) -> s1 (20) -> end 60
        let s1 = [1, 1, 2, 1, 1, 1];
        let a = tr(&[[0, 1, 2, 1, 1, 0], s1], &[0, 10], 30);
        let b = tr(&[[0, 1, 3, 1, 1, 0], s1], &[0, 20], 60);
        let md = fit(&[a, b]);
        let i1 = md.idx[&s1] as usize;
        // V(s1) = mean(20, 40) = 30 for both estimators
        assert_eq!(md.v_ce[i1], 30.0);
        assert_eq!(md.v_mc[i1], 30.0);
        // turn 0, game A: MC = 30 (its own return), model = r + V(s1) = 10 + 30 = 40
        let ia = md.idx[&[0, 1, 2, 1, 1, 0]] as usize;
        assert_eq!(md.v_mc[ia], 30.0);
        assert_eq!(md.v_ce[ia], 40.0);
        assert_eq!(md.v_turn[0], 45.0);
    }

    #[test]
    fn collect_rows_are_consistent() {
        let (su, _, _) = setup(&HashMap::new()).unwrap();
        let rows = play(7, &su, &vi::Driver::Bot).unwrap();
        assert_eq!(rows.last().unwrap()[7], 1);
        for (k, r) in rows.iter().enumerate().take(rows.len() - 1) {
            assert_eq!(r[0], k as i32, "one row per learner turn, from turn 0");
            assert_eq!(r[7], 0);
        }
        // the same seed gives the same game
        assert_eq!(rows, play(7, &su, &vi::Driver::Bot).unwrap());
    }
}
