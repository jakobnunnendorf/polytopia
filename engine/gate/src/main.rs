//! rl-gate: the RL project's quality gate (agreed on issue #166, 25 Nov 2026).
//!
//! The candidate and the base each play seat 0 of the same N evaluation seeds (Perfection, 16x16 Continents,
//! learner tribe fixed, opponents' tribes fixed per seed, the same opponent bot in every other seat). For each
//! seed d = score(candidate) - score(base) of seat 0's final raw Perfection score (`score_of`). The gate PASSES
//! iff the one-sided lower confidence bound mean(d) - z_{1-alpha} * sd(d) / sqrt(N) is above 0. N is fixed in
//! advance: there is no early stopping.
//!
//! Evaluation seeds start at EVAL_SEED_START (1,000,000,000) and run upwards. Training must never use them.
//!
//! Exit code: 0 PASS, 1 FAIL, 2 error.
use rayon::prelude::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// First evaluation seed. Seeds EVAL_SEED_START.. are reserved for evaluation; training must stay below it.
const EVAL_SEED_START: i64 = 1_000_000_000;
const MODE: &str = "perfection";
const MAP_SIZE: i64 = 16;
const MAP_TYPE: &str = "continents";
/// Perfection ends by itself at turn 30; these only guard against a stuck game.
const MAX_TURN: i64 = 60;
const MAX_MOVES: i64 = 1_000_000;
/// The engine's tribe ids, in its order (engine/core/src/data_gen.rs Tribe::ALL).
const TRIBES: [&str; 16] = [
    "xinxi", "imperius", "bardur", "oumaji", "kickoo", "hoodrick", "luxidoor", "vengir", "zebasi", "aimo", "quetzali",
    "yadakk", "aquarion", "elyrion", "polaris", "cymanti",
];
const DIFFICULTIES: [&str; 4] = ["easy", "normal", "hard", "crazy"];

type R<T> = Result<T, String>;

// ---------------------------------------------------------------- learners

/// What sits in seat 0. Seam for later learner kinds: an RL agent becomes a new variant here plus a branch in
/// `play_seed` that runs the game step by step and asks the agent for seat 0's action (playGames only drives
/// the engine's own bot policies).
#[derive(Clone, Debug)]
enum Learner {
    /// a bot model from models/<id>/model.json, played through polyapi "playGames"
    Bot { label: String, policy: Value },
}

impl Learner {
    fn label(&self) -> &str {
        match self {
            Learner::Bot { label, .. } => label,
        }
    }
}

fn repo_root() -> PathBuf {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    p.canonicalize().unwrap_or(p)
}

/// `id` is a model id under models/, a model folder, or a model.json path.
fn model_file(id: &str) -> R<PathBuf> {
    let p = Path::new(id);
    if p.is_file() {
        return Ok(p.to_path_buf());
    }
    if p.join("model.json").is_file() {
        return Ok(p.join("model.json"));
    }
    let f = repo_root().join("models").join(id).join("model.json");
    if f.is_file() {
        return Ok(f);
    }
    Err(format!("model {id:?}: not a model.json, a model folder, or an id under models/"))
}

/// The polyapi policy for a bot model.
fn bot_policy(id: &str) -> R<Value> {
    let f = model_file(id)?;
    let text = std::fs::read_to_string(&f).map_err(|e| format!("{}: {e}", f.display()))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", f.display()))?;
    match v["kind"].as_str() {
        Some("greedy-full") => Ok(json!({"kind": "full", "weights": v["full"]})),
        Some("greedy") => {
            // greedy-v1 stores `{}`: the default weights
            let w = &v["weights"];
            let empty = w.is_null() || w.as_object().map_or(false, |o| o.is_empty());
            Ok(json!({"kind": "greedy", "weights": if empty { Value::Null } else { w.clone() }}))
        }
        Some("random") => Ok(json!({"kind": "random"})),
        k => Err(format!("{}: model kind {k:?} cannot be played by the engine", f.display())),
    }
}

fn learner(id: &str) -> R<Learner> {
    Ok(Learner::Bot { label: id.to_string(), policy: bot_policy(id)? })
}

// ---------------------------------------------------------------- seeds and games

fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Seat 0 gets `tribe`; the opponents get distinct other tribes drawn from the seed (the same for candidate and base).
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

struct Setup {
    players: usize,
    tribe: String,
    difficulty: String,
    opp: Value,
}

struct Game {
    score: i64,
    won: bool,
}

fn play_seed(l: &Learner, seed: i64, tribes: &[String], s: &Setup) -> R<Game> {
    match l {
        Learner::Bot { policy, .. } => {
            let mut ps = vec![policy.clone()];
            ps.extend((1..s.players).map(|_| s.opp.clone()));
            let spec = json!([{
                "opts": {"mapSize": MAP_SIZE, "players": s.players, "mode": MODE, "seed": seed, "humans": [],
                         "mapType": MAP_TYPE, "difficulty": s.difficulty, "clans": tribes},
                "policies": ps, "maxTurn": MAX_TURN, "maxMoves": MAX_MOVES }]);
            let r = polyapi::call("playGames", &[spec])?;
            let r = &r[0];
            let score = r["scores"][0].as_i64().ok_or("playGames: no score for seat 0")?;
            Ok(Game { score, won: r["winner"].as_i64() == Some(0) })
        }
    }
}

// ---------------------------------------------------------------- statistics

/// Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9).
fn norm_inv(p: f64) -> f64 {
    let a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
    let b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    let c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    let d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    let pl = 0.02425;
    if p < pl {
        let q = (-2.0 * p.ln()).sqrt();
        (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    } else if p <= 1.0 - pl {
        let q = p - 0.5;
        let r = q * q;
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
            / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1.0)
    } else {
        -norm_inv(1.0 - p)
    }
}

/// Student t quantile by the Cornish-Fisher expansion around z (accurate to ~1e-4 for df >= 30).
fn t_inv(p: f64, df: f64) -> f64 {
    let z = norm_inv(p);
    let (z3, z5, z7) = (z.powi(3), z.powi(5), z.powi(7));
    z + (z3 + z) / (4.0 * df) + (5.0 * z5 + 16.0 * z3 + 3.0 * z) / (96.0 * df * df)
        + (3.0 * z7 + 19.0 * z5 + 17.0 * z3 - 15.0 * z) / (384.0 * df.powi(3))
}

fn mean(x: &[f64]) -> f64 {
    x.iter().sum::<f64>() / x.len() as f64
}
/// sample standard deviation (n - 1)
fn sd(x: &[f64]) -> f64 {
    let m = mean(x);
    (x.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (x.len() as f64 - 1.0)).sqrt()
}
fn corr(x: &[f64], y: &[f64]) -> Option<f64> {
    let (mx, my) = (mean(x), mean(y));
    let sxy: f64 = x.iter().zip(y).map(|(a, b)| (a - mx) * (b - my)).sum();
    let sxx: f64 = x.iter().map(|a| (a - mx).powi(2)).sum();
    let syy: f64 = y.iter().map(|b| (b - my).powi(2)).sum();
    if sxx == 0.0 || syy == 0.0 {
        None
    } else {
        Some(sxy / (sxx * syy).sqrt())
    }
}

struct Verdict {
    mean_d: f64,
    sd_d: f64,
    z: f64,
    t: f64,
    lower_z: f64,
    lower_t: f64,
    pass: bool,
}

/// PASS iff mean(d) - z_{1-alpha} * sd(d) / sqrt(N) > 0. Identical players (d = 0 everywhere) give a bound of 0: FAIL.
fn verdict(d: &[f64], alpha: f64) -> Verdict {
    let n = d.len() as f64;
    let (m, s) = (mean(d), sd(d));
    let z = norm_inv(1.0 - alpha);
    let t = t_inv(1.0 - alpha, n - 1.0);
    let se = s / n.sqrt();
    let lower_z = m - z * se;
    Verdict { mean_d: m, sd_d: s, z, t, lower_z, lower_t: m - t * se, pass: lower_z > 0.0 }
}

// ---------------------------------------------------------------- command line

const USAGE: &str = "usage: rl-gate --candidate <model id|path> --base <model id|path> [--opp greedy-full-probe] [--n 10000]
               [--alpha 0.01] [--seed-start 1000000000] [--threads 0] [--tribe xinxi] [--players 3]
               [--difficulty normal] [--out <dir>]
Exit code 0 = PASS, 1 = FAIL, 2 = error.";

struct Args {
    candidate: String,
    base: String,
    opp: String,
    n: i64,
    alpha: f64,
    seed_start: i64,
    threads: usize,
    tribe: String,
    players: usize,
    difficulty: String,
    out: PathBuf,
}

fn parse_args() -> R<Args> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    if a.iter().any(|x| x == "--help" || x == "-h") {
        println!("{USAGE}");
        std::process::exit(0);
    }
    let known = ["--candidate", "--base", "--opp", "--n", "--alpha", "--seed-start", "--threads", "--tribe", "--players", "--difficulty", "--out"];
    let mut i = 0;
    while i < a.len() {
        if !known.contains(&a[i].as_str()) {
            return Err(format!("unknown argument {:?}\n{USAGE}", a[i]));
        }
        if i + 1 >= a.len() {
            return Err(format!("{} needs a value", a[i]));
        }
        i += 2;
    }
    let get = |k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].clone());
    fn num<T: std::str::FromStr>(k: &str, v: Option<String>, d: T) -> R<T> {
        match v {
            None => Ok(d),
            Some(s) => s.parse().map_err(|_| format!("{k}: cannot parse {s:?}")),
        }
    }
    let args = Args {
        candidate: get("--candidate").ok_or(format!("--candidate is required\n{USAGE}"))?,
        base: get("--base").ok_or(format!("--base is required\n{USAGE}"))?,
        opp: get("--opp").unwrap_or("greedy-full-probe".into()),
        n: num("--n", get("--n"), 10_000)?,
        alpha: num("--alpha", get("--alpha"), 0.01)?,
        seed_start: num("--seed-start", get("--seed-start"), EVAL_SEED_START)?,
        threads: num("--threads", get("--threads"), 0)?,
        tribe: get("--tribe").unwrap_or("xinxi".into()),
        players: num("--players", get("--players"), 3)?,
        difficulty: get("--difficulty").unwrap_or("normal".into()),
        out: get("--out").map(PathBuf::from).unwrap_or_else(|| repo_root().join("engine/target/rl-gate")),
    };
    if args.n < 2 {
        return Err("--n must be at least 2".into());
    }
    if !(args.alpha > 0.0 && args.alpha < 0.5) {
        return Err("--alpha must be in (0, 0.5)".into());
    }
    if !TRIBES.contains(&args.tribe.as_str()) {
        return Err(format!("--tribe {:?}: one of {}", args.tribe, TRIBES.join(", ")));
    }
    if !DIFFICULTIES.contains(&args.difficulty.as_str()) {
        return Err(format!("--difficulty {:?}: one of {}", args.difficulty, DIFFICULTIES.join(", ")));
    }
    if args.players < 2 || args.players > TRIBES.len() {
        return Err("--players must be between 2 and 16".into());
    }
    if args.seed_start < EVAL_SEED_START {
        eprintln!("warning: --seed-start {} is below the evaluation range ({EVAL_SEED_START}..); it may overlap training seeds", args.seed_start);
    }
    Ok(args)
}

fn safe(s: &str) -> String {
    let base = Path::new(s).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or(s.to_string());
    let base = base.trim_end_matches(".json").to_string();
    base.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

fn run() -> R<bool> {
    let a = parse_args()?;
    let cand = learner(&a.candidate)?;
    let base = learner(&a.base)?;
    let setup = Setup { players: a.players, tribe: a.tribe.clone(), difficulty: a.difficulty.clone(), opp: bot_policy(&a.opp)? };
    let pool = rayon::ThreadPoolBuilder::new().num_threads(a.threads).build().map_err(|e| e.to_string())?;
    eprintln!(
        "rl-gate: {} vs {} on {} seeds from {} ({} threads) ...",
        cand.label(),
        base.label(),
        a.n,
        a.seed_start,
        pool.current_num_threads()
    );
    let t0 = Instant::now();
    let rows: Vec<(i64, Vec<String>, Game, Game)> = pool.install(|| {
        (0..a.n)
            .into_par_iter()
            .map(|g| {
                let seed = a.seed_start + g;
                let tribes = tribes_for(seed, &setup.tribe, setup.players);
                let c = play_seed(&cand, seed, &tribes, &setup).map_err(|e| format!("seed {seed}, candidate: {e}"))?;
                let b = play_seed(&base, seed, &tribes, &setup).map_err(|e| format!("seed {seed}, base: {e}"))?;
                Ok((seed, tribes, c, b))
            })
            .collect::<R<Vec<_>>>()
    })?;
    let wall = t0.elapsed().as_secs_f64();

    let cs: Vec<f64> = rows.iter().map(|r| r.2.score as f64).collect();
    let bs: Vec<f64> = rows.iter().map(|r| r.3.score as f64).collect();
    let d: Vec<f64> = cs.iter().zip(&bs).map(|(c, b)| c - b).collect();
    let v = verdict(&d, a.alpha);
    let r = corr(&cs, &bs);
    let win = |f: &dyn Fn(&(i64, Vec<String>, Game, Game)) -> bool| rows.iter().filter(|x| f(x)).count() as f64 / rows.len() as f64;
    let (cw, bw) = (win(&|x| x.2.won), win(&|x| x.3.won));
    let (better, worse) = (d.iter().filter(|x| **x > 0.0).count(), d.iter().filter(|x| **x < 0.0).count());
    let label = if v.pass { "PASS" } else { "FAIL" };

    let summary = json!({
        "tool": "rl-gate", "verdict": label, "pass": v.pass,
        "rule": "PASS iff mean(d) - z_{1-alpha} * sd(d) / sqrt(N) > 0, d = seat-0 Perfection score (candidate - base) per seed",
        "candidate": cand.label(), "base": base.label(), "opp": a.opp,
        "setup": {"mode": MODE, "mapSize": MAP_SIZE, "mapType": MAP_TYPE, "difficulty": a.difficulty, "players": a.players,
                  "learnerSeat": 0, "learnerTribe": a.tribe, "maxTurn": MAX_TURN},
        "n": a.n, "alpha": a.alpha, "seedStart": a.seed_start, "seedEnd": a.seed_start + a.n - 1,
        "meanCandidate": mean(&cs), "meanBase": mean(&bs), "sdCandidate": sd(&cs), "sdBase": sd(&bs),
        "meanD": v.mean_d, "sdD": v.sd_d, "seD": v.sd_d / (a.n as f64).sqrt(), "correlation": r,
        "z": v.z, "lowerBound": v.lower_z, "t": v.t, "lowerBoundT": v.lower_t, "passT": v.lower_t > 0.0,
        "seedsBetter": better, "seedsWorse": worse, "seedsEqual": rows.len() - better - worse,
        "winRateCandidate": cw, "winRateBase": bw,
        "threads": pool.current_num_threads(), "wallSeconds": wall,
    });

    println!("rl-gate  {} (candidate) vs {} (base), opponents {}", cand.label(), base.label(), a.opp);
    println!(
        "setup    {MODE}, {MAP_SIZE}x{MAP_SIZE} {MAP_TYPE}, difficulty {}, {} players, seat 0 = {}",
        a.difficulty, a.players, a.tribe
    );
    println!("seeds    N = {} ({}..{}), alpha = {} one-sided", a.n, a.seed_start, a.seed_start + a.n - 1, a.alpha);
    println!("score    candidate {:.2} (sd {:.2}), base {:.2} (sd {:.2})", mean(&cs), sd(&cs), mean(&bs), sd(&bs));
    println!("wins     candidate {:.1}%, base {:.1}%", cw * 100.0, bw * 100.0);
    println!(
        "d        mean {:.3}, sd {:.3}, corr(c, b) {}, seeds better/worse/equal {}/{}/{}",
        v.mean_d,
        v.sd_d,
        r.map_or("n/a".into(), |x| format!("{x:.3}")),
        better,
        worse,
        rows.len() - better - worse
    );
    println!("bound    mean(d) - {:.3} * se = {:.3} (paired t: {:.3})", v.z, v.lower_z, v.lower_t);
    println!("verdict  {label}");
    println!("wall     {wall:.1} s");

    let per_seed: Vec<Value> = rows
        .iter()
        .map(|(seed, tribes, c, b)| {
            json!({"seed": seed, "tribes": tribes, "candidate": c.score, "base": b.score, "d": c.score - b.score,
                   "candidateWon": c.won, "baseWon": b.won})
        })
        .collect();
    let mut out = summary;
    out["perSeed"] = Value::Array(per_seed);
    std::fs::create_dir_all(&a.out).map_err(|e| format!("{}: {e}", a.out.display()))?;
    let f = a.out.join(format!("gate-{}-vs-{}-n{}.json", safe(&a.candidate), safe(&a.base), a.n));
    std::fs::write(&f, serde_json::to_string_pretty(&out).unwrap()).map_err(|e| format!("{}: {e}", f.display()))?;
    println!("json     {}", f.display());
    Ok(v.pass)
}

fn main() {
    let code = match run() {
        Ok(true) => 0,
        Ok(false) => 1,
        Err(e) => {
            eprintln!("rl-gate: error: {e}");
            2
        }
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantiles() {
        assert!((norm_inv(0.99) - 2.326348).abs() < 1e-5);
        assert!((norm_inv(0.5)).abs() < 1e-9);
        assert!((t_inv(0.99, 9999.0) - 2.326_5).abs() < 1e-3);
        assert!((t_inv(0.99, 30.0) - 2.457).abs() < 2e-3);
    }

    #[test]
    fn identical_players_fail() {
        let v = verdict(&vec![0.0; 100], 0.01);
        assert_eq!(v.lower_z, 0.0);
        assert!(!v.pass);
    }

    #[test]
    fn clear_improvement_passes() {
        let d: Vec<f64> = (0..1000).map(|i| 5.0 + (i % 7) as f64 - 3.0).collect();
        assert!(verdict(&d, 0.01).pass);
        let d: Vec<f64> = d.iter().map(|x| -x).collect();
        assert!(!verdict(&d, 0.01).pass);
    }

    #[test]
    fn tribes_are_fixed_per_seed_and_distinct() {
        for seed in EVAL_SEED_START..EVAL_SEED_START + 200 {
            let t = tribes_for(seed, "xinxi", 3);
            assert_eq!(t, tribes_for(seed, "xinxi", 3));
            assert_eq!(t[0], "xinxi");
            let mut u = t.clone();
            u.sort();
            u.dedup();
            assert_eq!(u.len(), 3);
        }
    }
}
