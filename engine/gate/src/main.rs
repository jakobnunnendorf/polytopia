//! rl-gate: the RL project's quality gate (agreed on issue #166, 25 Nov 2026; sign-test rule the same day).
//!
//! The candidate and the base each play seat 0 of the same N evaluation seeds (Perfection, 16x16 Continents,
//! learner tribe fixed, opponents' tribes fixed per seed, the same opponent bot in every other seat). For each
//! seed d = score(candidate) - score(base) of seat 0's final raw Perfection score (`score_of`). Seat 0 is created as
//! the game's only human seat (`humans: [0]`): it gets the human capital income (+1 star) instead of the
//! difficulty's bot bonus, as in the real app, and the game ends when it is eliminated. N is fixed in advance:
//! there is no early stopping.
//!
//! Decision rule (reliability first, Jakob, 25 Nov 2026): the candidate must be better on more seeds, not better by
//! more points on a few.
//!   * Main test, a paired SIGN test: seeds with d = 0 are dropped; among the others count better (d > 0) and worse
//!     (d < 0). PASS needs the exact one-sided binomial test of H0 "P(better) = 0.5" to reject at alpha (default 0.01).
//!   * Guards, both must also hold: (a) the one-sided (1 - alpha) UPPER confidence bound of mean(d) is >= 0 (we
//!     cannot conclude the mean got worse); (b) the candidate's 10th-percentile score is >= the base's.
//! Everything else (means, median, 10th/90th percentile, win rates, best score, best-of-k) is reported, not decided.
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

/// The seat the learner plays. It is the game's only human seat.
const LEARNER_SEAT: i64 = 0;

/// createGame options for one seed, the same for candidate and base. The learner seat is human (human capital
/// income; the game ends when it is eliminated); every other seat is a bot with the difficulty's capital bonus.
fn game_opts(seed: i64, tribes: &[String], s: &Setup) -> Value {
    json!({"mapSize": MAP_SIZE, "players": s.players, "mode": MODE, "seed": seed, "humans": [LEARNER_SEAT],
           "mapType": MAP_TYPE, "difficulty": s.difficulty, "clans": tribes})
}

fn play_seed(l: &Learner, seed: i64, tribes: &[String], s: &Setup) -> R<Game> {
    match l {
        Learner::Bot { policy, .. } => {
            // playGames drives every seat by its policy, whether the seat is human or bot
            let mut ps = vec![policy.clone()];
            ps.extend((1..s.players).map(|_| s.opp.clone()));
            let spec = json!([{ "opts": game_opts(seed, tribes, s), "policies": ps, "maxTurn": MAX_TURN, "maxMoves": MAX_MOVES }]);
            let r = polyapi::call("playGames", &[spec])?;
            let r = &r[0];
            let score = r["scores"][LEARNER_SEAT as usize].as_i64().ok_or("playGames: no score for seat 0")?;
            Ok(Game { score, won: r["winner"].as_i64() == Some(LEARNER_SEAT) })
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

/// Scores sorted ascending (scores are integers, so there is no NaN).
fn sorted(x: &[f64]) -> Vec<f64> {
    let mut v = x.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v
}

/// Quantile of an ascending sample by linear interpolation between order statistics (Hyndman-Fan type 7, the
/// default of R and numpy): h = (n - 1) p, result = s[floor h] + (h - floor h) * (s[ceil h] - s[floor h]).
/// p = 0.5 is the median.
fn quantile_sorted(s: &[f64], p: f64) -> f64 {
    let h = (s.len() - 1) as f64 * p;
    let (lo, hi) = (h.floor() as usize, h.ceil() as usize);
    s[lo] + (h - lo as f64) * (s[hi] - s[lo])
}

/// Expected maximum of k independent games, estimated from the empirical score distribution: draw k scores with
/// replacement from the n observed ones. With the sample sorted ascending x_(1) <= ... <= x_(n),
/// P(max = x_(i)) = (i/n)^k - ((i-1)/n)^k, so E[max] = sum_i x_(i) ((i/n)^k - ((i-1)/n)^k). Exact for that
/// resampling model (ties just add their weights); k = 1 is the mean. It never exceeds the sample maximum, so
/// best-of-k is only trustworthy while k is small against n (k <= 100 at n = 10,000).
fn expected_max_of_k(s: &[f64], k: i32) -> f64 {
    let n = s.len() as f64;
    s.iter().enumerate().map(|(i, x)| x * (((i + 1) as f64 / n).powi(k) - (i as f64 / n).powi(k))).sum()
}

/// ln(i!) for i = 0..=n.
fn ln_factorials(n: usize) -> Vec<f64> {
    let mut lf = vec![0.0; n + 1];
    for i in 1..=n {
        lf[i] = lf[i - 1] + (i as f64).ln();
    }
    lf
}

/// Binomial upper tail P(X >= k) for X ~ Binomial(n, p), summed exactly in log space (`lf` = ln_factorials(>= n)).
/// No normal approximation: at N = 10,000 the sum has at most 10,000 terms.
fn binom_upper_tail(lf: &[f64], n: usize, k: usize, p: f64) -> f64 {
    if k == 0 {
        return 1.0;
    }
    if k > n || p <= 0.0 {
        return 0.0;
    }
    if p >= 1.0 {
        return 1.0;
    }
    let (lp, lq) = (p.ln(), (1.0 - p).ln());
    let terms: Vec<f64> = (k..=n).map(|i| lf[n] - lf[i] - lf[n - i] + i as f64 * lp + (n - i) as f64 * lq).collect();
    let m = terms.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    (m + terms.iter().map(|t| (t - m).exp()).sum::<f64>().ln()).exp().min(1.0)
}

/// Clopper-Pearson one-sided lower (1 - alpha) bound for a binomial share, k successes in n: the p at which the
/// upper tail P(X >= k | n, p) equals alpha (bisection; the tail grows with p). It exceeds 0.5 exactly when the
/// exact one-sided sign test at alpha rejects P = 0.5, so the test and the bound always agree.
fn share_lower_bound(lf: &[f64], n: usize, k: usize, alpha: f64) -> f64 {
    if k == 0 {
        return 0.0;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..100 {
        let mid = 0.5 * (lo + hi);
        if binom_upper_tail(lf, n, k, mid) < alpha {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// The k of the best-of-k figures.
const BEST_OF_K: [i32; 3] = [1, 10, 100];

/// Descriptive statistics of one version's N seat-0 scores (reported, not decided, except `p10` in guard b).
struct Dist {
    mean: f64,
    sd: f64,
    median: f64,
    p10: f64,
    p90: f64,
    best: f64,
    /// (k, expected best score of k games)
    best_of: Vec<(i32, f64)>,
}

impl Dist {
    fn of(x: &[f64]) -> Dist {
        let s = sorted(x);
        Dist {
            mean: mean(x),
            sd: sd(x),
            median: quantile_sorted(&s, 0.5),
            p10: quantile_sorted(&s, 0.1),
            p90: quantile_sorted(&s, 0.9),
            best: *s.last().unwrap(),
            best_of: BEST_OF_K.iter().map(|&k| (k, expected_max_of_k(&s, k))).collect(),
        }
    }
    fn json(&self) -> Value {
        let mut best_of = serde_json::Map::new();
        for (k, v) in &self.best_of {
            best_of.insert(k.to_string(), json!(v));
        }
        json!({"mean": self.mean, "sd": self.sd, "median": self.median, "p10": self.p10, "p90": self.p90,
               "best": self.best, "bestOfK": best_of})
    }
}

/// Everything the gate decides and reports about one candidate-vs-base comparison.
struct Decision {
    cand: Dist,
    base: Dist,
    better: usize,
    worse: usize,
    ties: usize,
    /// better / (better + worse); None when every seed is a tie
    share: Option<f64>,
    /// one-sided (1 - alpha) Clopper-Pearson lower bound of the better share
    share_lower: f64,
    /// exact one-sided binomial p-value of H0 P(better) = 0.5 against "better"
    p_value: f64,
    sign_reject: bool,
    mean_d: f64,
    sd_d: f64,
    se_d: f64,
    z: f64,
    t: f64,
    lower_z: f64,
    upper_z: f64,
    lower_t: f64,
    upper_t: f64,
    guard_mean_ok: bool,
    guard_tail_ok: bool,
    pass: bool,
    /// why the gate failed (empty on PASS)
    reasons: Vec<String>,
}

/// The gate's decision from the per-seed scores (same seeds, same order). PASS iff the sign test rejects at `alpha`
/// AND guard (a) mean(d) + z_{1-alpha} se(d) >= 0 AND guard (b) candidate p10 >= base p10. The guard bound uses z
/// (not t) because it is the narrower, stricter one.
fn decide(cs: &[f64], bs: &[f64], alpha: f64) -> Decision {
    let d: Vec<f64> = cs.iter().zip(bs).map(|(c, b)| c - b).collect();
    let n = d.len();
    let (better, worse) = (d.iter().filter(|x| **x > 0.0).count(), d.iter().filter(|x| **x < 0.0).count());
    let ties = n - better - worse;
    let n_eff = better + worse;
    let lf = ln_factorials(n_eff);
    let p_value = binom_upper_tail(&lf, n_eff, better, 0.5);
    let sign_reject = n_eff > 0 && p_value < alpha;
    let share = if n_eff > 0 { Some(better as f64 / n_eff as f64) } else { None };
    let share_lower = share_lower_bound(&lf, n_eff, better, alpha);

    let (m, s) = (mean(&d), sd(&d));
    let nf = n as f64;
    let (z, t) = (norm_inv(1.0 - alpha), t_inv(1.0 - alpha, nf - 1.0));
    let se = s / nf.sqrt();
    let (cand, base) = (Dist::of(cs), Dist::of(bs));
    let upper_z = m + z * se;
    // identical players: mean 0, se 0, upper bound 0 -> "not significantly worse" holds (the sign test fails them)
    let guard_mean_ok = upper_z >= 0.0;
    let guard_tail_ok = cand.p10 >= base.p10;

    let mut reasons = Vec::new();
    if n_eff == 0 {
        reasons.push(format!("sign test: no seed differs (all {n} ties), nothing to reject"));
    } else if !sign_reject {
        reasons.push(format!(
            "sign test not rejected: {better} better vs {worse} worse (ties dropped: {ties}), exact one-sided p = {p_value:.3e} >= alpha {alpha}"
        ));
    }
    if !guard_mean_ok {
        reasons.push(format!("guard (a): the mean got significantly worse: mean(d) = {m:.3}, one-sided upper bound {upper_z:.3} < 0"));
    }
    if !guard_tail_ok {
        reasons.push(format!("guard (b): the lower tail got worse: candidate 10th percentile {:.2} < base {:.2}", cand.p10, base.p10));
    }
    let pass = sign_reject && guard_mean_ok && guard_tail_ok;
    Decision {
        cand, base, better, worse, ties, share, share_lower, p_value, sign_reject, mean_d: m, sd_d: s, se_d: se, z, t,
        lower_z: m - z * se, upper_z, lower_t: m - t * se, upper_t: m + t * se, guard_mean_ok, guard_tail_ok, pass, reasons,
    }
}

const RULE: &str = "paired sign test on d = seat-0 Perfection score (candidate - base) per seed, ties dropped: PASS iff the exact \
one-sided binomial test of P(better) = 0.5 rejects at alpha AND guard (a) the one-sided (1 - alpha) upper bound \
mean(d) + z * sd(d) / sqrt(N) >= 0 AND guard (b) candidate 10th-percentile score >= base 10th-percentile score \
(linear-interpolation quantile, Hyndman-Fan type 7)";

// ---------------------------------------------------------------- command line

const USAGE: &str = "usage: rl-gate --candidate <model id|path> --base <model id|path> [--opp greedy-full-probe] [--n 10000]
               [--alpha 0.01] [--seed-start 1000000000] [--threads 0] [--tribe xinxi] [--players 4]
               [--difficulty crazy] [--out <dir>]
Seat 0 (the learner) is the human seat; every other seat is a bot playing --opp.
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
        players: num("--players", get("--players"), 4)?,
        difficulty: get("--difficulty").unwrap_or("crazy".into()),
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
    let v = decide(&cs, &bs, a.alpha);
    let r = corr(&cs, &bs);
    let win = |f: &dyn Fn(&(i64, Vec<String>, Game, Game)) -> bool| rows.iter().filter(|x| f(x)).count() as f64 / rows.len() as f64;
    let (cw, bw) = (win(&|x| x.2.won), win(&|x| x.3.won));
    let label = if v.pass { "PASS" } else { "FAIL" };

    let summary = json!({
        "tool": "rl-gate", "verdict": label, "pass": v.pass, "rule": RULE, "failReasons": v.reasons,
        "candidate": cand.label(), "base": base.label(), "opp": a.opp,
        "setup": {"mode": MODE, "mapSize": MAP_SIZE, "mapType": MAP_TYPE, "difficulty": a.difficulty, "players": a.players,
                  "learnerSeat": LEARNER_SEAT, "humans": [LEARNER_SEAT], "learnerTribe": a.tribe, "maxTurn": MAX_TURN},
        "n": a.n, "alpha": a.alpha, "seedStart": a.seed_start, "seedEnd": a.seed_start + a.n - 1,
        "signTest": {
            "test": "exact one-sided binomial, H0 P(better) = 0.5, ties dropped",
            "better": v.better, "worse": v.worse, "ties": v.ties, "nEffective": v.better + v.worse,
            "betterShare": v.share, "betterShareLowerBound": v.share_lower, "pValue": v.p_value, "reject": v.sign_reject,
        },
        "guards": {
            "meanNotWorse": {"rule": "mean(d) + z * se >= 0", "upperBound": v.upper_z, "ok": v.guard_mean_ok},
            "lowerTailNotWorse": {"rule": "candidate p10 >= base p10 (type 7 quantile)", "candidateP10": v.cand.p10,
                                  "baseP10": v.base.p10, "ok": v.guard_tail_ok},
        },
        "candidateStats": v.cand.json(), "baseStats": v.base.json(),
        "meanCandidate": v.cand.mean, "meanBase": v.base.mean, "sdCandidate": v.cand.sd, "sdBase": v.base.sd,
        "meanD": v.mean_d, "sdD": v.sd_d, "seD": v.se_d, "correlation": r,
        "z": v.z, "lowerBound": v.lower_z, "upperBound": v.upper_z,
        "t": v.t, "lowerBoundT": v.lower_t, "upperBoundT": v.upper_t,
        "seedsBetter": v.better, "seedsWorse": v.worse, "seedsEqual": v.ties,
        "winRateCandidate": cw, "winRateBase": bw,
        "threads": pool.current_num_threads(), "wallSeconds": wall,
    });

    println!("rl-gate  {} (candidate) vs {} (base), opponents {}", cand.label(), base.label(), a.opp);
    println!(
        "setup    {MODE}, {MAP_SIZE}x{MAP_SIZE} {MAP_TYPE}, difficulty {}, {} players, seat 0 = {} (human seat)",
        a.difficulty, a.players, a.tribe
    );
    println!("seeds    N = {} ({}..{}), alpha = {} one-sided", a.n, a.seed_start, a.seed_start + a.n - 1, a.alpha);
    println!("rule     paired sign test (ties dropped) must reject P(better) = 0.5, AND guards (a) mean not worse, (b) 10th percentile not worse");
    println!("score    {:<10} {:>10} {:>10} {:>10} {:>10} {:>10} {:>10}", "", "mean", "sd", "p10", "median", "p90", "best");
    for (name, x) in [("candidate", &v.cand), ("base", &v.base)] {
        println!("         {:<10} {:>10.1} {:>10.1} {:>10.1} {:>10.1} {:>10.1} {:>10.0}", name, x.mean, x.sd, x.p10, x.median, x.p90, x.best);
    }
    println!("best-of  {:<10} {:>10} {:>10} {:>10}   (expected best score of k games, from the empirical distribution; k = 1 is the mean)", "", "k = 1", "k = 10", "k = 100");
    for (name, x) in [("candidate", &v.cand), ("base", &v.base)] {
        println!("         {:<10} {:>10.1} {:>10.1} {:>10.1}", name, x.best_of[0].1, x.best_of[1].1, x.best_of[2].1);
    }
    println!("wins     candidate {:.1}%, base {:.1}%", cw * 100.0, bw * 100.0);
    println!(
        "d        mean {:.3}, sd {:.3}, one-sided {:.0}% bounds [{:.3}, {:.3}] (paired t: [{:.3}, {:.3}]), corr(c, b) {}",
        v.mean_d,
        v.sd_d,
        (1.0 - a.alpha) * 100.0,
        v.lower_z,
        v.upper_z,
        v.lower_t,
        v.upper_t,
        r.map_or("n/a".into(), |x| format!("{x:.3}"))
    );
    println!("seeds    better {}, worse {}, equal (dropped from the sign test) {}", v.better, v.worse, v.ties);
    match v.share {
        Some(s) => println!(
            "sign     better share {:.2}% of {} differing seeds, {:.0}% lower bound {:.2}%, exact one-sided p = {:.3e} -> {}",
            s * 100.0,
            v.better + v.worse,
            (1.0 - a.alpha) * 100.0,
            v.share_lower * 100.0,
            v.p_value,
            if v.sign_reject { "rejects P(better) = 0.5" } else { "does not reject P(better) = 0.5" }
        ),
        None => println!("sign     no seed differs: nothing to test"),
    }
    println!("guard a  mean(d) upper bound {:.3} >= 0: {}", v.upper_z, if v.guard_mean_ok { "ok" } else { "VIOLATED" });
    println!("guard b  candidate p10 {:.1} >= base p10 {:.1}: {}", v.cand.p10, v.base.p10, if v.guard_tail_ok { "ok" } else { "VIOLATED" });
    println!("verdict  {label}");
    for reason in &v.reasons {
        println!("reason   {reason}");
    }
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

    /// Base scores 100, 101, ..., 100 + n - 1; the candidate is base + d[i].
    fn pair(d: &[f64]) -> (Vec<f64>, Vec<f64>) {
        let bs: Vec<f64> = (0..d.len()).map(|i| 100.0 + i as f64).collect();
        let cs: Vec<f64> = bs.iter().zip(d).map(|(b, x)| b + x).collect();
        (cs, bs)
    }

    #[test]
    fn quantile_type7() {
        let s = [1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(quantile_sorted(&s, 0.0), 1.0);
        assert_eq!(quantile_sorted(&s, 0.5), 3.0);
        assert_eq!(quantile_sorted(&s, 1.0), 5.0);
        assert!((quantile_sorted(&s, 0.1) - 1.4).abs() < 1e-12); // numpy.quantile([1..5], 0.1) = 1.4
        assert!((quantile_sorted(&s, 0.9) - 4.6).abs() < 1e-12);
        assert_eq!(quantile_sorted(&[7.0], 0.1), 7.0);
        assert_eq!(quantile_sorted(&[2.0, 4.0], 0.5), 3.0);
        assert_eq!(quantile_sorted(&sorted(&[5.0, 1.0, 3.0]), 0.5), 3.0);
    }

    #[test]
    fn best_of_k_estimator() {
        let s = [0.0, 1.0];
        assert!((expected_max_of_k(&s, 1) - 0.5).abs() < 1e-12); // k = 1 is the mean
        assert!((expected_max_of_k(&s, 2) - 0.75).abs() < 1e-12); // P(max = 1) = 1 - (1/2)^2
        assert!((expected_max_of_k(&[4.0; 50], 100) - 4.0).abs() < 1e-9); // constant sample
        let x: Vec<f64> = (1..=1000).map(|i| i as f64).collect();
        let sx = sorted(&x);
        assert!((expected_max_of_k(&sx, 1) - mean(&x)).abs() < 1e-9);
        let (k10, k100) = (expected_max_of_k(&sx, 10), expected_max_of_k(&sx, 100));
        // uniform on 1..1000: E[max of k] ~ 1000 k / (k + 1)
        assert!((k10 - 1000.0 * 10.0 / 11.0).abs() < 5.0, "{k10}");
        assert!((k100 - 1000.0 * 100.0 / 101.0).abs() < 5.0, "{k100}");
        assert!(mean(&x) < k10 && k10 < k100 && k100 < 1000.0);
        // sample order does not matter after sorting; ties are handled
        assert!((expected_max_of_k(&sorted(&[3.0, 3.0, 9.0]), 2) - (3.0 * (4.0 / 9.0) + 9.0 * (5.0 / 9.0))).abs() < 1e-12);
    }

    #[test]
    fn binomial_tail_is_exact() {
        let lf = ln_factorials(100);
        assert!((binom_upper_tail(&lf, 10, 9, 0.5) - 11.0 / 1024.0).abs() < 1e-12);
        assert!((binom_upper_tail(&lf, 5, 5, 0.5) - 1.0 / 32.0).abs() < 1e-12);
        assert!((binom_upper_tail(&lf, 20, 15, 0.5) - 21700.0 / 1_048_576.0).abs() < 1e-12);
        assert_eq!(binom_upper_tail(&lf, 7, 0, 0.5), 1.0);
        assert_eq!(binom_upper_tail(&lf, 7, 8, 0.5), 0.0);
        assert!((binom_upper_tail(&lf, 100, 50, 0.5) - 0.539_79).abs() < 1e-4); // P(X >= 50) = 0.5398
        // the normal approximation with continuity correction agrees at a few hundred seeds
        let lf = ln_factorials(1000);
        for k in [520usize, 540, 560] {
            let z_cc = (k as f64 - 0.5 - 500.0) / (1000f64.sqrt() / 2.0);
            let p_exact = binom_upper_tail(&lf, 1000, k, 0.5);
            assert!((norm_inv(1.0 - p_exact) - z_cc).abs() < 0.03, "k {k}: exact z {} vs {z_cc}", norm_inv(1.0 - p_exact));
        }
    }

    #[test]
    fn share_bound_matches_test() {
        // all n better: bound is alpha^(1/n)
        let lf = ln_factorials(10);
        assert!((share_lower_bound(&lf, 10, 10, 0.01) - 0.01f64.powf(0.1)).abs() < 1e-9);
        assert_eq!(share_lower_bound(&lf, 10, 0, 0.01), 0.0);
        // the bound exceeds 0.5 exactly when the exact test rejects
        let lf = ln_factorials(300);
        for k in 150..=250 {
            let rejects = binom_upper_tail(&lf, 300, k, 0.5) < 0.01;
            assert_eq!(share_lower_bound(&lf, 300, k, 0.01) > 0.5, rejects, "k {k}");
        }
    }

    #[test]
    fn identical_players_fail_with_all_ties() {
        let (cs, bs) = pair(&vec![0.0; 100]);
        let v = decide(&cs, &bs, 0.01);
        assert_eq!((v.better, v.worse, v.ties), (0, 0, 100));
        assert!(v.share.is_none());
        assert_eq!(v.p_value, 1.0);
        assert!(!v.sign_reject);
        assert!(v.guard_mean_ok && v.guard_tail_ok); // identical players violate no guard
        assert!(!v.pass);
        assert!(v.reasons[0].contains("all 100 ties"), "{:?}", v.reasons);
    }

    #[test]
    fn consistent_small_wins_pass() {
        let d: Vec<f64> = (0..1000).map(|i| 5.0 + (i % 7) as f64 - 3.0).collect();
        let (cs, bs) = pair(&d);
        let v = decide(&cs, &bs, 0.01);
        assert_eq!((v.better, v.worse), (1000 - v.ties, 0));
        assert!(v.sign_reject && v.guard_mean_ok && v.guard_tail_ok && v.pass, "{:?}", v.reasons);
        assert!(v.reasons.is_empty());
        let neg: Vec<f64> = d.iter().map(|x| -x).collect();
        let (cs, bs) = pair(&neg);
        assert!(!decide(&cs, &bs, 0.01).pass);
    }

    /// 999 seeds better by 1 and one seed lost by 5000: a reliability win. The sign test passes; the mean guard
    /// holds (one outlier makes the mean's bound wide, we cannot conclude the mean got worse); the tail guard holds.
    #[test]
    fn many_small_wins_beat_one_huge_loss() {
        let mut d = vec![1.0; 999];
        d.push(-5000.0);
        let (cs, bs) = pair(&d);
        let v = decide(&cs, &bs, 0.01);
        assert_eq!((v.better, v.worse), (999, 1));
        assert!(v.sign_reject, "p = {}", v.p_value);
        assert!(v.mean_d < 0.0, "the mean of d is negative: {}", v.mean_d);
        assert!(v.guard_mean_ok, "upper bound {}", v.upper_z);
        assert!(v.guard_tail_ok);
        assert!(v.pass, "{:?}", v.reasons);
        assert!(v.share_lower > 0.99, "lower bound of the better share {}", v.share_lower);
    }

    /// One seed won by 100000 and 999 lost by 1: the mean of d is positive but the candidate is almost never better.
    #[test]
    fn one_huge_win_does_not_beat_many_small_losses() {
        let mut d = vec![-1.0; 999];
        d.push(100_000.0);
        let (cs, bs) = pair(&d);
        let v = decide(&cs, &bs, 0.01);
        assert_eq!((v.better, v.worse), (1, 999));
        assert!(v.mean_d > 0.0);
        assert!(!v.sign_reject, "p = {}", v.p_value);
        assert!(!v.pass);
        assert!(v.reasons.iter().any(|r| r.contains("sign test not rejected")), "{:?}", v.reasons);
    }

    /// Better on 60% of the seeds but by 1, worse on 40% by 10: the sign test passes, the mean guard fails.
    #[test]
    fn guard_a_blocks_a_worse_mean() {
        let d: Vec<f64> = (0..1000).map(|i| if i % 5 < 3 { 1.0 } else { -10.0 }).collect();
        let (cs, bs) = pair(&d);
        let v = decide(&cs, &bs, 0.01);
        assert!(v.sign_reject);
        assert!(!v.guard_mean_ok, "upper bound {}", v.upper_z);
        assert!(!v.pass);
        assert!(v.reasons.iter().any(|r| r.contains("guard (a)")), "{:?}", v.reasons);
    }

    /// Better on 85% of the seeds with a positive mean, but the lowest-scoring seeds got worse: the tail guard fails.
    #[test]
    fn guard_b_blocks_a_worse_lower_tail() {
        // base scores 100..1099; the 150 lowest base seeds lose 2, the top 100 win 100, the rest win 1
        let d: Vec<f64> = (0..1000).map(|i| if i < 150 { -2.0 } else if i >= 900 { 100.0 } else { 1.0 }).collect();
        let (cs, bs) = pair(&d);
        let v = decide(&cs, &bs, 0.01);
        assert!(v.sign_reject);
        assert!(v.guard_mean_ok && v.mean_d > 0.0);
        assert!(v.cand.p10 < v.base.p10, "{} vs {}", v.cand.p10, v.base.p10);
        assert!(!v.guard_tail_ok);
        assert!(!v.pass);
        assert!(v.reasons.iter().any(|r| r.contains("guard (b)")), "{:?}", v.reasons);
    }

    #[test]
    fn distributions_are_reported() {
        let d: Vec<f64> = (0..1000).map(|i| (i % 3) as f64).collect();
        let (cs, bs) = pair(&d);
        let v = decide(&cs, &bs, 0.01);
        assert_eq!(v.base.best, 1099.0);
        assert_eq!(v.base.median, 599.5);
        assert!((v.base.best_of[0].1 - v.base.mean).abs() < 1e-9);
        assert!(v.cand.best >= v.base.best);
        assert_eq!(v.cand.best_of.iter().map(|x| x.0).collect::<Vec<_>>(), vec![1, 10, 100]);
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

    /// The learner seat earns the human capital income (level-1 capital: 1 + 1 = 2 stars); a Crazy bot's capital
    /// earns 1 + 4 = 5 (engine/core/src/data.rs HUMAN_CAPITAL_BONUS, bot_capital_bonus).
    #[test]
    fn learner_seat_gets_human_income_on_crazy() {
        let setup = Setup { players: 4, tribe: "xinxi".into(), difficulty: "crazy".into(), opp: json!({"kind": "random"}) };
        for seed in EVAL_SEED_START..EVAL_SEED_START + 5 {
            let tribes = tribes_for(seed, &setup.tribe, setup.players);
            let s = polyapi::call("createGame", &[game_opts(seed, &tribes, &setup)]).unwrap();
            let players = s["players"].as_array().unwrap();
            assert_eq!(players.len(), 4);
            for p in players {
                assert_eq!(p["bot"].as_bool(), Some(p["id"].as_i64() != Some(LEARNER_SEAT)), "seat {}", p["id"]);
            }
            let caps: Vec<&Value> = s["cities"].as_array().unwrap().iter().filter(|c| c["capital"].as_bool() == Some(true)).collect();
            assert_eq!(caps.len(), 4, "seed {seed}: one capital per seat");
            for c in caps {
                assert_eq!(c["level"].as_i64(), Some(1));
                let income = polyapi::call("cityIncome", &[s.clone(), (*c).clone()]).unwrap().as_i64().unwrap();
                let want = if c["owner"].as_i64() == Some(LEARNER_SEAT) { 2 } else { 5 };
                assert_eq!(income, want, "seed {seed}, capital of seat {}", c["owner"]);
            }
        }
    }
}
