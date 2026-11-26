//! rl-gate: the RL project's quality gate (agreed on issue #166, 25 Nov 2026; sign-test rule, the opponent set and
//! the 15-opponent information run decided the same day).
//!
//! The candidate and the base each play seat 0 of the same N evaluation seeds (Perfection, 16x16 Continents,
//! learner tribe fixed, opponents' tribes fixed per seed). The opponent seats are filled from an opponent list, by
//! default (Jakob, 25 Nov 2026) the current champion (registry[0] of docs/rl-project/champions.json, the base being
//! challenged), the previous champion (registry[1]) and the frozen greedy champion `greedy-full-probe-perf` (the anchor,
//! never changes; greedy-full-probe until 26 Nov 2026), shuffled over the seats per seed by a seed-derived permutation that is the same for candidate and base. For each
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
//! After the gate, an information-only run plays the same two versions with 15 opponents (16 players, the same
//! opponent list repeated to fill the seats, seeds from INFO15_SEED_START). It is reported, never decides, and never
//! changes the exit code. `rl-gate promote <id>` puts a version that passed at the top of the registry;
//! `rl-gate --benchmark <id>` appends report-only rows against fixed opponents to docs/rl-project/progress.csv.
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

// ---------------------------------------------------------------- learners and opponents

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
    /// The champions-registry kind this learner is promoted as.
    fn registry_kind(&self) -> &'static str {
        match self {
            Learner::Bot { .. } => KIND_GREEDY,
        }
    }
}

/// What sits in an opponent seat (seats 1..). Opponents are greedy bot models today (registry kind
/// "greedy-model").
///
/// EXTENSION POINT for RL opponents (decision 25 Nov 2026: two opponent seats are the current and the previous
/// champion, which will be RL policies once RL versions are promoted): add a variant here (e.g. `Rl { label, checkpoint }`),
/// build it in `opponent()` from a registry entry of kind "rl-policy", and give `play_seed` a step-by-step game
/// loop that asks the RL policy for that seat's action whenever the seat is to move. playGames only drives the
/// engine's own bot policies, so a game with any RL seat cannot go through it.
#[derive(Clone, Debug)]
enum Opponent {
    Bot { label: String, policy: Value },
}

impl Opponent {
    fn label(&self) -> &str {
        match self {
            Opponent::Bot { label, .. } => label,
        }
    }
}

/// Registry kind of a greedy bot model under models/.
const KIND_GREEDY: &str = "greedy-model";

fn repo_root() -> PathBuf {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    p.canonicalize().unwrap_or(p)
}

/// `id` is a model id under models/, a model folder, or a model.json path (relative paths: from the working
/// directory, then from the repo root).
fn model_file(id: &str) -> R<PathBuf> {
    for p in [Path::new(id).to_path_buf(), repo_root().join(id), repo_root().join("models").join(id)] {
        if p.is_file() {
            return Ok(p);
        }
        if p.join("model.json").is_file() {
            return Ok(p.join("model.json"));
        }
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

/// An opponent from a label, a registry kind and where to load it from.
fn opponent(label: &str, kind: &str, path: &str) -> R<Opponent> {
    match kind {
        KIND_GREEDY => Ok(Opponent::Bot { label: label.to_string(), policy: bot_policy(path)? }),
        k => Err(format!(
            "opponent {label:?}: kind {k:?} cannot fill an opponent seat yet (only {KIND_GREEDY:?}; RL opponents plug in at `Opponent` in engine/gate/src/main.rs)"
        )),
    }
}

// ---------------------------------------------------------------- champions registry

/// The champions registry: promoted versions, best (newest promotion) first. The default opponents are its top
/// REGISTRY_OPPONENTS entries plus the fixed ANCHOR; older entries stay listed for history.
const REGISTRY: &str = "docs/rl-project/champions.json";
/// How many of the registry's top entries fill opponent seats (Jakob, 25 Nov 2026: the current champion, i.e.
/// the base being challenged, and the previous champion).
const REGISTRY_OPPONENTS: usize = 2;
/// The third opponent: the frozen greedy champion (app-like, uses the engine's relation model). It never changes,
/// whatever the registry says (Jakob, 25 Nov 2026). Since 26 Nov 2026 (Jakob, #166, before the first RL iteration)
/// it is greedy-full-probe tuned for Perfection on Crazy (experiment 17); greedy-full-probe before that.
const ANCHOR: &str = "greedy-full-probe-perf";
/// The anchor's label in outputs, so its seat can be told apart from a registry entry with the same model.
const ANCHOR_LABEL: &str = "greedy-full-probe-perf (anchor)";
/// Opponents in the default list: registry[0], registry[1], anchor.
const OPPONENT_COUNT: usize = REGISTRY_OPPONENTS + 1;

/// One registry entry, the fields the gate needs (the entry's other fields are history for humans).
#[derive(Clone, Debug, PartialEq)]
struct Champion {
    id: String,
    kind: String,
    path: String,
}

fn registry_path(over: Option<&str>) -> PathBuf {
    over.map(PathBuf::from).unwrap_or_else(|| repo_root().join(REGISTRY))
}

fn read_registry(f: &Path) -> R<Value> {
    let text = std::fs::read_to_string(f).map_err(|e| format!("champions registry {}: {e}", f.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("champions registry {}: {e}", f.display()))
}

/// The registry's entries, best first; every entry needs a string id, kind and path.
fn champions(reg: &Value) -> R<Vec<Champion>> {
    let list = reg["champions"].as_array().ok_or("champions registry: no \"champions\" array")?;
    list.iter()
        .enumerate()
        .map(|(i, e)| {
            let s = |k: &str| e[k].as_str().map(str::to_string).ok_or(format!("champions registry, entry {i}: no string {k:?}"));
            Ok(Champion { id: s("id")?, kind: s("kind")?, path: s("path")? })
        })
        .collect()
}

/// Insert `entry` at the top of the registry. A version is promoted once: an id already listed is an error.
fn promote_entry(reg: &mut Value, entry: Value) -> R<()> {
    let id = entry["id"].as_str().ok_or("promote: entry without id")?.to_string();
    if champions(reg)?.iter().any(|c| c.id == id) {
        return Err(format!("promote: {id:?} is already in the champions registry"));
    }
    reg["champions"].as_array_mut().ok_or("champions registry: no \"champions\" array")?.insert(0, entry);
    Ok(())
}

/// Today's date (UTC) as YYYY-MM-DD, by Howard Hinnant's days-to-civil algorithm.
fn today() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

// ---------------------------------------------------------------- seeds, seats and games

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

/// Separate random stream for the seat shuffle, so a seed's tribes stay what they were before seats were shuffled.
const SEAT_STREAM: u64 = 0x5EA7_5EA7_0000_0003;

/// Which opponent (index into the opponent list of length `k`) sits in each of the `seats` opponent seats
/// (seats 1..=seats), for one seed. The list is repeated to fill the seats (k = 3 and 15 seats: 5 copies each;
/// k = 1: every seat the same opponent, as before), then shuffled by a Fisher-Yates permutation drawn only from
/// the seed. It depends on nothing else, so candidate and base meet the same opponent in the same seat.
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

struct Setup {
    players: usize,
    tribe: String,
    difficulty: String,
    /// the opponent list; seat i (1..) plays opps[assignment[i - 1]]
    opps: Vec<Opponent>,
}

impl Setup {
    fn opp_labels(&self) -> Vec<String> {
        self.opps.iter().map(|o| o.label().to_string()).collect()
    }
    fn json(&self) -> Value {
        json!({"mode": MODE, "mapSize": MAP_SIZE, "mapType": MAP_TYPE, "difficulty": self.difficulty, "players": self.players,
               "learnerSeat": LEARNER_SEAT, "humans": [LEARNER_SEAT], "learnerTribe": self.tribe, "maxTurn": MAX_TURN,
               "opponents": self.opp_labels(),
               "seatAssignment": "opponent list repeated to fill seats 1..players-1, shuffled per seed by a Fisher-Yates \
                                  permutation from splitmix64(seed ^ SEAT_STREAM); identical for candidate and base"})
    }
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

/// playGames policies, one per seat: the learner's in seat 0, then each opponent seat's assigned opponent.
fn seat_policies(learner_policy: &Value, opps: &[Opponent], assign: &[usize]) -> Vec<Value> {
    let mut ps = vec![learner_policy.clone()];
    ps.extend(assign.iter().map(|&i| match &opps[i] {
        Opponent::Bot { policy, .. } => policy.clone(),
    }));
    ps
}

fn play_seed(l: &Learner, seed: i64, tribes: &[String], assign: &[usize], s: &Setup) -> R<Game> {
    match l {
        Learner::Bot { policy, .. } => {
            // playGames drives every seat by its policy, whether the seat is human or bot
            let ps = seat_policies(policy, &s.opps, assign);
            let spec = json!([{ "opts": game_opts(seed, tribes, s), "policies": ps, "maxTurn": MAX_TURN, "maxMoves": MAX_MOVES }]);
            let r = polyapi::call("playGames", &[spec])?;
            let r = &r[0];
            let score = r["scores"][LEARNER_SEAT as usize].as_i64().ok_or("playGames: no score for seat 0")?;
            Ok(Game { score, won: r["winner"].as_i64() == Some(LEARNER_SEAT) })
        }
    }
}

/// One seed's games: one per learner, all on the same map, tribes and seat assignment.
struct Row {
    seed: i64,
    tribes: Vec<String>,
    assign: Vec<usize>,
    games: Vec<Game>,
}

/// Play every learner on seeds seed_start..seed_start + n. Returns the rows (in seed order) and the wall time.
fn play_all(learners: &[&Learner], s: &Setup, seed_start: i64, n: i64, pool: &rayon::ThreadPool) -> R<(Vec<Row>, f64)> {
    let t0 = Instant::now();
    let rows = pool.install(|| {
        (0..n)
            .into_par_iter()
            .map(|g| {
                let seed = seed_start + g;
                let tribes = tribes_for(seed, &s.tribe, s.players);
                // computed once per seed and passed to every learner: the pairing is exact by construction
                let assign = seat_assignment(seed, s.opps.len(), s.players - 1);
                let games = learners
                    .iter()
                    .map(|l| play_seed(l, seed, &tribes, &assign, s).map_err(|e| format!("seed {seed}, {}: {e}", l.label())))
                    .collect::<R<Vec<_>>>()?;
                Ok(Row { seed, tribes, assign, games })
            })
            .collect::<R<Vec<_>>>()
    })?;
    Ok((rows, t0.elapsed().as_secs_f64()))
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

// ---------------------------------------------------------------- evaluation runs

/// First seed of the information-only 15-opponent evaluation: a fixed range of its own inside the evaluation
/// range, far from the gate's seeds (1,000,000,000 + N).
const INFO15_SEED_START: i64 = 1_500_000_000;
/// 15 opponents (Jakob, 25 Nov 2026: "a second evaluation purely for information on 15 opponents").
const INFO15_PLAYERS: usize = 16;
/// About 8 ms per 16-player game on 12 cores: 5,000 seeds x 2 versions is about 80 s, no more than the main gate.
const INFO15_N: i64 = 5_000;
/// The progress benchmark's fixed opponent, forever (report only).
const BENCHMARK_OPP: &str = ANCHOR;
const PROGRESS: &str = "docs/rl-project/progress.csv";
const PROGRESS_HEADER: &str = "date,model,players,opponents,n,seedStart,median,p10,mean,p90,winRate,wallSeconds,commit";

/// One candidate-vs-base comparison on one setup and seed range.
struct Comparison {
    rows: Vec<Row>,
    wall: f64,
    v: Decision,
    corr: Option<f64>,
    cw: f64,
    bw: f64,
}

fn compare(cand: &Learner, base: &Learner, s: &Setup, seed_start: i64, n: i64, alpha: f64, pool: &rayon::ThreadPool) -> R<Comparison> {
    let (rows, wall) = play_all(&[cand, base], s, seed_start, n, pool)?;
    let cs: Vec<f64> = rows.iter().map(|r| r.games[0].score as f64).collect();
    let bs: Vec<f64> = rows.iter().map(|r| r.games[1].score as f64).collect();
    let v = decide(&cs, &bs, alpha);
    let corr = corr(&cs, &bs);
    let win = |i: usize| rows.iter().filter(|r| r.games[i].won).count() as f64 / rows.len() as f64;
    let (cw, bw) = (win(0), win(1));
    Ok(Comparison { rows, wall, v, corr, cw, bw })
}

/// The numbers of one comparison, as in the gate JSON (also used for the info15 block).
fn comparison_json(c: &Comparison, s: &Setup, seed_start: i64, n: i64, alpha: f64) -> Value {
    let v = &c.v;
    let labels = s.opp_labels();
    let per_seed: Vec<Value> = c
        .rows
        .iter()
        .map(|r| {
            let (cg, bg) = (&r.games[0], &r.games[1]);
            let opps: Vec<&str> = r.assign.iter().map(|&i| labels[i].as_str()).collect();
            json!({"seed": r.seed, "tribes": r.tribes, "opponents": opps, "candidate": cg.score, "base": bg.score,
                   "d": cg.score - bg.score, "candidateWon": cg.won, "baseWon": bg.won})
        })
        .collect();
    json!({
        "verdict": if v.pass { "PASS" } else { "FAIL" }, "pass": v.pass, "rule": RULE, "failReasons": v.reasons,
        "opp": labels, "setup": s.json(),
        "n": n, "alpha": alpha, "seedStart": seed_start, "seedEnd": seed_start + n - 1,
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
        "meanD": v.mean_d, "sdD": v.sd_d, "seD": v.se_d, "correlation": c.corr,
        "z": v.z, "lowerBound": v.lower_z, "upperBound": v.upper_z,
        "t": v.t, "lowerBoundT": v.lower_t, "upperBoundT": v.upper_t,
        "seedsBetter": v.better, "seedsWorse": v.worse, "seedsEqual": v.ties,
        "winRateCandidate": c.cw, "winRateBase": c.bw, "wallSeconds": c.wall,
        "perSeed": per_seed,
    })
}

/// The terminal summary of one comparison. `info` marks the information-only run: its "verdict" is printed as what
/// the rule would say, never as the gate's verdict.
fn print_comparison(c: &Comparison, s: &Setup, seed_start: i64, n: i64, alpha: f64, info: bool) {
    let v = &c.v;
    let p = if info { "  " } else { "" };
    println!(
        "{p}setup    {MODE}, {MAP_SIZE}x{MAP_SIZE} {MAP_TYPE}, difficulty {}, {} players, seat 0 = {} (human seat)",
        s.difficulty, s.players, s.tribe
    );
    println!("{p}opps     {} (shuffled over seats 1..{} per seed, the same for both versions)", s.opp_labels().join(", "), s.players - 1);
    println!("{p}seeds    N = {} ({}..{}), alpha = {} one-sided", n, seed_start, seed_start + n - 1, alpha);
    if !info {
        println!("rule     paired sign test (ties dropped) must reject P(better) = 0.5, AND guards (a) mean not worse, (b) 10th percentile not worse");
    }
    println!("{p}score    {:<10} {:>10} {:>10} {:>10} {:>10} {:>10} {:>10}", "", "mean", "sd", "p10", "median", "p90", "best");
    for (name, x) in [("candidate", &v.cand), ("base", &v.base)] {
        println!("{p}         {:<10} {:>10.1} {:>10.1} {:>10.1} {:>10.1} {:>10.1} {:>10.0}", name, x.mean, x.sd, x.p10, x.median, x.p90, x.best);
    }
    println!("{p}best-of  {:<10} {:>10} {:>10} {:>10}   (expected best score of k games, from the empirical distribution; k = 1 is the mean)", "", "k = 1", "k = 10", "k = 100");
    for (name, x) in [("candidate", &v.cand), ("base", &v.base)] {
        println!("{p}         {:<10} {:>10.1} {:>10.1} {:>10.1}", name, x.best_of[0].1, x.best_of[1].1, x.best_of[2].1);
    }
    println!("{p}wins     candidate {:.1}%, base {:.1}%", c.cw * 100.0, c.bw * 100.0);
    println!(
        "{p}d        mean {:.3}, sd {:.3}, one-sided {:.0}% bounds [{:.3}, {:.3}] (paired t: [{:.3}, {:.3}]), corr(c, b) {}",
        v.mean_d,
        v.sd_d,
        (1.0 - alpha) * 100.0,
        v.lower_z,
        v.upper_z,
        v.lower_t,
        v.upper_t,
        c.corr.map_or("n/a".into(), |x| format!("{x:.3}"))
    );
    println!("{p}seeds    better {}, worse {}, equal (dropped from the sign test) {}", v.better, v.worse, v.ties);
    match v.share {
        Some(sh) => println!(
            "{p}sign     better share {:.2}% of {} differing seeds, {:.0}% lower bound {:.2}%, exact one-sided p = {:.3e} -> {}",
            sh * 100.0,
            v.better + v.worse,
            (1.0 - alpha) * 100.0,
            v.share_lower * 100.0,
            v.p_value,
            if v.sign_reject { "rejects P(better) = 0.5" } else { "does not reject P(better) = 0.5" }
        ),
        None => println!("{p}sign     no seed differs: nothing to test"),
    }
    println!("{p}guard a  mean(d) upper bound {:.3} >= 0: {}", v.upper_z, if v.guard_mean_ok { "ok" } else { "VIOLATED" });
    println!("{p}guard b  candidate p10 {:.1} >= base p10 {:.1}: {}", v.cand.p10, v.base.p10, if v.guard_tail_ok { "ok" } else { "VIOLATED" });
    let label = if v.pass { "PASS" } else { "FAIL" };
    if info {
        println!("  rule says {label} here (information only, does not decide)");
    } else {
        println!("verdict  {label}");
        for reason in &v.reasons {
            println!("reason   {reason}");
        }
    }
    println!("{p}wall     {:.1} s", c.wall);
}

// ---------------------------------------------------------------- command line

const USAGE: &str = "usage:
  rl-gate --candidate <model> --base <model> [--opp a,b,c] [--registry <champions.json>] [--n 10000] [--alpha 0.01]
          [--seed-start 1000000000] [--threads 0] [--tribe xinxi] [--players 4] [--difficulty crazy]
          [--info15-n 5000] [--no-info15] [--out <dir>]
  rl-gate --benchmark <model> [--n 10000] [--info15-n 5000] [--no-info15] [--progress <progress.csv>] [--threads 0]
  rl-gate promote <model> --gate <gate json> [--experiment NN-rl-slug] [--pr N] [--date YYYY-MM-DD] [--registry <file>]
Gate: seat 0 (the learner) is the human seat. The opponent seats are filled from --opp (one entry: every seat;
several: repeated to fill the seats and shuffled per seed, identically for candidate and base); without --opp,
the current and previous champion (top two of docs/rl-project/champions.json) and the fixed anchor
greedy-full-probe-perf. After the gate an information-only
run with 15 opponents (16 players, seeds from 1500000000) follows; it never changes the verdict or exit code.
Benchmark (report only): the model against copies of greedy-full-probe-perf, 3 (and 15) opponents, appended to
docs/rl-project/progress.csv. Promote: after a PASS, put the candidate at the top of the registry.
Exit code: gate 0 = PASS, 1 = FAIL, 2 = error; benchmark and promote 0 = done, 2 = error.";

enum Mode {
    Gate,
    Benchmark(String),
    Promote(String),
}

struct Args {
    mode: Mode,
    candidate: Option<String>,
    base: Option<String>,
    opp: Option<String>,
    registry: Option<String>,
    n: i64,
    alpha: f64,
    seed_start: i64,
    threads: usize,
    tribe: String,
    players: usize,
    difficulty: String,
    info15_n: i64,
    no_info15: bool,
    out: PathBuf,
    progress: PathBuf,
    gate: Option<String>,
    experiment: Option<String>,
    pr: Option<String>,
    date: Option<String>,
}

const VALUE_FLAGS: [&str; 19] = [
    "--candidate", "--base", "--opp", "--registry", "--n", "--alpha", "--seed-start", "--threads", "--tribe", "--players",
    "--difficulty", "--info15-n", "--out", "--benchmark", "--progress", "--gate", "--experiment", "--pr", "--date",
];
const BOOL_FLAGS: [&str; 1] = ["--no-info15"];

fn parse_args(a: &[String]) -> R<Args> {
    if a.iter().any(|x| x == "--help" || x == "-h") {
        println!("{USAGE}");
        std::process::exit(0);
    }
    let (promote, rest) = match a.first().map(String::as_str) {
        Some("promote") => (Some(a.get(1).filter(|x| !x.starts_with("--")).ok_or(format!("promote needs a model id\n{USAGE}"))?.clone()), &a[2..]),
        _ => (None, a),
    };
    let mut vals: std::collections::HashMap<&str, String> = Default::default();
    let mut bools: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < rest.len() {
        let k = rest[i].as_str();
        if let Some(f) = BOOL_FLAGS.iter().find(|f| **f == k) {
            bools.push(f);
            i += 1;
        } else if let Some(f) = VALUE_FLAGS.iter().find(|f| **f == k) {
            let v = rest.get(i + 1).ok_or(format!("{k} needs a value"))?;
            vals.insert(f, v.clone());
            i += 2;
        } else {
            return Err(format!("unknown argument {k:?}\n{USAGE}"));
        }
    }
    let get = |k: &str| vals.get(k).cloned();
    fn num<T: std::str::FromStr>(k: &str, v: Option<String>, d: T) -> R<T> {
        match v {
            None => Ok(d),
            Some(s) => s.parse().map_err(|_| format!("{k}: cannot parse {s:?}")),
        }
    }
    let mode = match (promote, get("--benchmark")) {
        (Some(_), Some(_)) => return Err("promote and --benchmark cannot be combined".into()),
        (Some(id), None) => Mode::Promote(id),
        (None, Some(m)) => Mode::Benchmark(m),
        (None, None) => Mode::Gate,
    };
    let only = |allowed: &[&str], what: &str| -> R<()> {
        for k in vals.keys().chain(bools.iter()) {
            if !allowed.contains(k) {
                return Err(format!("{k} does not apply to {what}\n{USAGE}"));
            }
        }
        Ok(())
    };
    match &mode {
        Mode::Promote(_) => only(&["--gate", "--experiment", "--pr", "--date", "--registry"], "promote")?,
        // the benchmark's setup is fixed forever, so its rows stay comparable
        Mode::Benchmark(_) => only(&["--benchmark", "--n", "--info15-n", "--no-info15", "--progress", "--threads"], "--benchmark (its setup is fixed)")?,
        Mode::Gate => only(
            &["--candidate", "--base", "--opp", "--registry", "--n", "--alpha", "--seed-start", "--threads", "--tribe", "--players",
              "--difficulty", "--info15-n", "--no-info15", "--out"],
            "the gate",
        )?,
    }
    let args = Args {
        candidate: get("--candidate"),
        base: get("--base"),
        opp: get("--opp"),
        registry: get("--registry"),
        n: num("--n", get("--n"), 10_000)?,
        alpha: num("--alpha", get("--alpha"), 0.01)?,
        seed_start: num("--seed-start", get("--seed-start"), EVAL_SEED_START)?,
        threads: num("--threads", get("--threads"), 0)?,
        tribe: get("--tribe").unwrap_or("xinxi".into()),
        players: num("--players", get("--players"), 4)?,
        difficulty: get("--difficulty").unwrap_or("crazy".into()),
        info15_n: num("--info15-n", get("--info15-n"), INFO15_N)?,
        no_info15: bools.contains(&"--no-info15"),
        out: get("--out").map(PathBuf::from).unwrap_or_else(|| repo_root().join("engine/target/rl-gate")),
        progress: get("--progress").map(PathBuf::from).unwrap_or_else(|| repo_root().join(PROGRESS)),
        gate: get("--gate"),
        experiment: get("--experiment"),
        pr: get("--pr"),
        date: get("--date"),
        mode,
    };
    if let Mode::Promote(_) = args.mode {
        if args.gate.is_none() {
            return Err(format!("promote needs --gate <the PASS gate JSON>\n{USAGE}"));
        }
        return Ok(args);
    }
    if let Mode::Gate = args.mode {
        if args.candidate.is_none() || args.base.is_none() {
            return Err(format!("--candidate and --base are required\n{USAGE}"));
        }
    }
    if args.n < 2 || (!args.no_info15 && args.info15_n < 2) {
        return Err("--n and --info15-n must be at least 2".into());
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
    if !args.no_info15 && args.seed_start + args.n > INFO15_SEED_START {
        return Err(format!("the gate's seeds would reach the 15-opponent seed range ({INFO15_SEED_START}..); lower --n or --seed-start"));
    }
    Ok(args)
}

fn safe(s: &str) -> String {
    let base = Path::new(s).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or(s.to_string());
    let base = base.trim_end_matches(".json").to_string();
    base.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

/// The default opponent list from a registry: its top REGISTRY_OPPONENTS entries (current and previous champion)
/// and the fixed anchor, as (label, kind, path).
fn default_opponent_specs(reg: &Value) -> R<Vec<(String, String, String)>> {
    let top: Vec<Champion> = champions(reg)?.into_iter().take(REGISTRY_OPPONENTS).collect();
    if top.len() < REGISTRY_OPPONENTS {
        return Err(format!("champions registry: needs at least {REGISTRY_OPPONENTS} entries (current and previous champion)"));
    }
    let mut v: Vec<(String, String, String)> = top.into_iter().map(|c| (c.id, c.kind, c.path)).collect();
    v.push((ANCHOR_LABEL.to_string(), KIND_GREEDY.to_string(), ANCHOR.to_string()));
    debug_assert_eq!(v.len(), OPPONENT_COUNT);
    Ok(v)
}

/// The gate's opponent list: `--opp a,b,c`, or else registry[0], registry[1] and the anchor.
fn gate_opponents(a: &Args, seats: usize) -> R<(Vec<Opponent>, String)> {
    let (opps, source) = match &a.opp {
        Some(list) => {
            let ids: Vec<&str> = list.split(',').map(str::trim).filter(|x| !x.is_empty()).collect();
            if ids.is_empty() {
                return Err("--opp: empty list".into());
            }
            (ids.iter().map(|id| opponent(id, KIND_GREEDY, id)).collect::<R<Vec<_>>>()?, "--opp".to_string())
        }
        None => {
            let f = registry_path(a.registry.as_deref());
            let specs = default_opponent_specs(&read_registry(&f)?).map_err(|e| format!("{}: {e}", f.display()))?;
            let opps = specs.iter().map(|(l, k, p)| opponent(l, k, p)).collect::<R<Vec<_>>>()?;
            (opps, format!("champions registry {} (top {REGISTRY_OPPONENTS}) + anchor {ANCHOR}", f.display()))
        }
    };
    if opps.len() > seats {
        return Err(format!("{} opponents listed but only {seats} opponent seats", opps.len()));
    }
    Ok((opps, source))
}

fn run_gate(a: &Args) -> R<bool> {
    let cand = learner(a.candidate.as_deref().unwrap())?;
    let base = learner(a.base.as_deref().unwrap())?;
    let (opps, source) = gate_opponents(a, a.players - 1)?;
    let setup = Setup { players: a.players, tribe: a.tribe.clone(), difficulty: a.difficulty.clone(), opps: opps.clone() };
    let pool = rayon::ThreadPoolBuilder::new().num_threads(a.threads).build().map_err(|e| e.to_string())?;
    eprintln!(
        "rl-gate: {} vs {} on {} seeds from {}, opponents {} ({} threads) ...",
        cand.label(),
        base.label(),
        a.n,
        a.seed_start,
        setup.opp_labels().join(", "),
        pool.current_num_threads()
    );
    let c = compare(&cand, &base, &setup, a.seed_start, a.n, a.alpha, &pool)?;
    println!("rl-gate  {} (candidate) vs {} (base), opponents {} (from {source})", cand.label(), base.label(), setup.opp_labels().join(", "));
    print_comparison(&c, &setup, a.seed_start, a.n, a.alpha, false);

    let mut out = comparison_json(&c, &setup, a.seed_start, a.n, a.alpha);
    out["tool"] = json!("rl-gate");
    out["candidate"] = json!(cand.label());
    out["base"] = json!(base.label());
    out["opponentSource"] = json!(source);
    out["threads"] = json!(pool.current_num_threads());

    // information only: 15 opponents; whatever happens here, the verdict above stands
    if !a.no_info15 {
        let s15 = Setup { players: INFO15_PLAYERS, tribe: a.tribe.clone(), difficulty: a.difficulty.clone(), opps };
        eprintln!("rl-gate: information-only run, {} opponents, {} seeds from {INFO15_SEED_START} ...", INFO15_PLAYERS - 1, a.info15_n);
        println!("info15   information only, does not decide: the same versions with {} opponents", INFO15_PLAYERS - 1);
        out["info15"] = match compare(&cand, &base, &s15, INFO15_SEED_START, a.info15_n, a.alpha, &pool) {
            Ok(c15) => {
                print_comparison(&c15, &s15, INFO15_SEED_START, a.info15_n, a.alpha, true);
                let mut j = comparison_json(&c15, &s15, INFO15_SEED_START, a.info15_n, a.alpha);
                j["informationOnly"] = json!(true);
                j["note"] = json!("information only, does not decide: the gate's verdict is the top-level `verdict` (3 opponents)");
                // the field names say what the rule would give, so nobody reads it as the gate's verdict
                j["ruleWouldSay"] = j["verdict"].take();
                j["ruleWouldPass"] = j["pass"].take();
                if let Some(o) = j.as_object_mut() {
                    o.remove("verdict");
                    o.remove("pass");
                }
                j
            }
            Err(e) => {
                eprintln!("rl-gate: warning: the information-only 15-opponent run failed (the verdict stands): {e}");
                json!({"informationOnly": true, "error": e})
            }
        };
    }

    std::fs::create_dir_all(&a.out).map_err(|e| format!("{}: {e}", a.out.display()))?;
    let f = a.out.join(format!("gate-{}-vs-{}-n{}.json", safe(cand.label()), safe(base.label()), a.n));
    std::fs::write(&f, serde_json::to_string_pretty(&out).unwrap()).map_err(|e| format!("{}: {e}", f.display()))?;
    println!("verdict  {} (3-opponent gate; the 15-opponent numbers are information only)", if c.v.pass { "PASS" } else { "FAIL" });
    println!("json     {}", f.display());
    Ok(c.v.pass)
}

fn git_commit() -> String {
    std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root())
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// One progress row: the model's seat-0 distribution on one fixed benchmark setup.
fn progress_row(model: &str, s: &Setup, seed_start: i64, n: i64, scores: &[f64], win: f64, wall: f64, commit: &str) -> String {
    let d = Dist::of(scores);
    let opps = format!("{}x {}", s.players - 1, s.opp_labels().join("+"));
    format!(
        "{},{},{},{},{},{},{:.1},{:.1},{:.1},{:.1},{:.4},{:.1},{}",
        today(),
        model,
        s.players,
        opps,
        n,
        seed_start,
        d.median,
        d.p10,
        d.mean,
        d.p90,
        win,
        wall,
        commit
    )
}

fn append_progress(f: &Path, rows: &[String]) -> R<()> {
    use std::io::Write;
    let new = !f.is_file();
    let mut h = std::fs::OpenOptions::new().create(true).append(true).open(f).map_err(|e| format!("{}: {e}", f.display()))?;
    let mut text = String::new();
    if new {
        text.push_str(PROGRESS_HEADER);
        text.push('\n');
    }
    for r in rows {
        text.push_str(r);
        text.push('\n');
    }
    h.write_all(text.as_bytes()).map_err(|e| format!("{}: {e}", f.display()))
}

/// Report only: the model in seat 0 against copies of the frozen champion, the same fixed seeds every time.
fn run_benchmark(a: &Args, model: &str) -> R<()> {
    let l = learner(model)?;
    let pool = rayon::ThreadPoolBuilder::new().num_threads(a.threads).build().map_err(|e| e.to_string())?;
    let champ = opponent(BENCHMARK_OPP, KIND_GREEDY, BENCHMARK_OPP)?;
    let mut runs = vec![(4usize, EVAL_SEED_START, a.n)];
    if !a.no_info15 {
        runs.push((INFO15_PLAYERS, INFO15_SEED_START, a.info15_n));
    }
    let commit = git_commit();
    let mut lines = Vec::new();
    for (players, start, n) in runs {
        let s = Setup { players, tribe: "xinxi".into(), difficulty: "crazy".into(), opps: vec![champ.clone()] };
        eprintln!("rl-gate benchmark: {model}, {} opponents {BENCHMARK_OPP}, {n} seeds from {start} ...", players - 1);
        let (rows, wall) = play_all(&[&l], &s, start, n, &pool)?;
        let scores: Vec<f64> = rows.iter().map(|r| r.games[0].score as f64).collect();
        let win = rows.iter().filter(|r| r.games[0].won).count() as f64 / rows.len() as f64;
        let d = Dist::of(&scores);
        println!(
            "benchmark {model}: {} opponents {BENCHMARK_OPP}, N = {n} from {start}: median {:.1}, p10 {:.1}, mean {:.1}, p90 {:.1}, win {:.1}% ({wall:.1} s)",
            players - 1,
            d.median,
            d.p10,
            d.mean,
            d.p90,
            win * 100.0
        );
        lines.push(progress_row(model, &s, start, n, &scores, win, wall, &commit));
    }
    append_progress(&a.progress, &lines)?;
    println!("progress {} (+{} rows; report only, decides nothing)", a.progress.display(), lines.len());
    Ok(())
}

/// Put a candidate that passed the gate at the top of the champions registry. Explicit, never automatic.
fn run_promote(a: &Args, id: &str) -> R<()> {
    let l = learner(id)?;
    let gf = a.gate.as_deref().unwrap();
    let g: Value = serde_json::from_str(&std::fs::read_to_string(gf).map_err(|e| format!("{gf}: {e}"))?).map_err(|e| format!("{gf}: {e}"))?;
    if g["tool"].as_str() != Some("rl-gate") || g["pass"].as_bool() != Some(true) {
        return Err(format!("{gf}: not a PASS of rl-gate; only a version that passed the gate is promoted"));
    }
    let gc = g["candidate"].as_str().unwrap_or("");
    if safe(gc) != safe(id) {
        return Err(format!("{gf}: the gate's candidate is {gc:?}, not {id:?}"));
    }
    let folder = model_file(id)?.parent().map(Path::to_path_buf).ok_or("model folder")?;
    let folder = folder.canonicalize().unwrap_or(folder);
    let rel = folder.strip_prefix(repo_root()).map(|p| p.to_string_lossy().to_string()).unwrap_or(folder.to_string_lossy().to_string());
    let entry = json!({
        "id": id, "path": rel, "kind": l.registry_kind(), "date": a.date.clone().unwrap_or_else(today),
        "experiment": a.experiment, "pr": a.pr,
        "gate": {"file": gf, "verdict": g["verdict"], "base": g["base"], "opponents": g["opp"], "n": g["n"],
                 "betterShare": g["signTest"]["betterShare"], "meanD": g["meanD"],
                 "candidateMedian": g["candidateStats"]["median"], "baseMedian": g["baseStats"]["median"]},
    });
    let f = registry_path(a.registry.as_deref());
    let mut reg = read_registry(&f)?;
    promote_entry(&mut reg, entry)?;
    std::fs::write(&f, serde_json::to_string_pretty(&reg).unwrap() + "\n").map_err(|e| format!("{}: {e}", f.display()))?;
    let top: Vec<String> = default_opponent_specs(&reg)?.into_iter().map(|s| s.0).collect();
    println!("promoted {id} to the top of {}; the gate's opponents are now {}", f.display(), top.join(", "));
    println!("next: commit the registry and run `npm run rl:gate -- --benchmark {id}` for the progress curve");
    Ok(())
}

fn run() -> R<bool> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let a = parse_args(&argv)?;
    match &a.mode {
        Mode::Gate => run_gate(&a),
        Mode::Benchmark(m) => run_benchmark(&a, m).map(|_| true),
        Mode::Promote(id) => run_promote(&a, id).map(|_| true),
    }
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
        let setup = Setup { players: 4, tribe: "xinxi".into(), difficulty: "crazy".into(), opps: vec![random_opp("random")] };
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

    fn random_opp(label: &str) -> Opponent {
        Opponent::Bot { label: label.into(), policy: json!({"kind": "random"}) }
    }

    #[test]
    fn seat_assignment_is_a_deterministic_seed_permutation() {
        let mut seen = std::collections::HashSet::new();
        for seed in EVAL_SEED_START..EVAL_SEED_START + 300 {
            let a = seat_assignment(seed, 3, 3);
            assert_eq!(a, seat_assignment(seed, 3, 3), "seed {seed}: deterministic");
            let mut s = a.clone();
            s.sort();
            assert_eq!(s, vec![0, 1, 2], "seed {seed}: each opponent exactly once");
            seen.insert(a);
        }
        assert_eq!(seen.len(), 6, "all 3! seatings occur over 300 seeds");
        // 15 seats from 3 opponents: 5 copies each
        for seed in INFO15_SEED_START..INFO15_SEED_START + 50 {
            let a = seat_assignment(seed, 3, 15);
            assert_eq!(a.len(), 15);
            for k in 0..3 {
                assert_eq!(a.iter().filter(|x| **x == k).count(), 5);
            }
        }
    }

    #[test]
    fn candidate_and_base_meet_the_same_seating() {
        let greedy = Opponent::Bot { label: "b".into(), policy: json!({"kind": "greedy", "weights": null}) };
        let opps = vec![random_opp("a"), greedy, random_opp("c")];
        let (pc, pb) = (json!({"kind": "cand"}), json!({"kind": "base"}));
        for seed in EVAL_SEED_START..EVAL_SEED_START + 100 {
            let assign = seat_assignment(seed, opps.len(), 3);
            let (c, b) = (seat_policies(&pc, &opps, &assign), seat_policies(&pb, &opps, &assign));
            assert_eq!(c.len(), 4);
            assert_eq!((&c[0], &b[0]), (&pc, &pb));
            assert_eq!(c[1..], b[1..], "seed {seed}: opponent seats identical");
        }
    }

    #[test]
    fn one_opponent_fills_every_seat_as_before() {
        let w = json!({"kind": "full", "weights": {"a": 1}});
        let opp = Opponent::Bot { label: "x".into(), policy: w.clone() };
        let pl = json!({"kind": "learner"});
        for seed in EVAL_SEED_START..EVAL_SEED_START + 20 {
            let assign = seat_assignment(seed, 1, 3);
            assert_eq!(assign, vec![0, 0, 0]);
            // the old gate: [learner, opp, opp, opp]
            assert_eq!(seat_policies(&pl, std::slice::from_ref(&opp), &assign), vec![pl.clone(), w.clone(), w.clone(), w.clone()]);
        }
    }

    #[test]
    fn registry_parse_and_promote() {
        let mut reg = json!({"champions": [
            {"id": "a", "kind": "greedy-model", "path": "models/a"},
            {"id": "b", "kind": "greedy-model", "path": "models/b"},
            {"id": "c", "kind": "greedy-model", "path": "models/c", "note": "kept"},
        ]});
        let ids = |r: &Value| champions(r).unwrap().into_iter().map(|c| c.id).collect::<Vec<_>>();
        assert_eq!(ids(&reg), vec!["a", "b", "c"]);
        promote_entry(&mut reg, json!({"id": "new", "kind": "greedy-model", "path": "models/new"})).unwrap();
        assert_eq!(ids(&reg), vec!["new", "a", "b", "c"], "the new version goes on top, the oldest stays for history");
        // opponents: current champion, previous champion, the fixed anchor
        let opps: Vec<String> = default_opponent_specs(&reg).unwrap().into_iter().map(|s| s.0).collect();
        assert_eq!(opps, vec!["new", "a", ANCHOR_LABEL]);
        assert_eq!(default_opponent_specs(&reg).unwrap()[2].2, ANCHOR, "the anchor never moves");
        assert!(default_opponent_specs(&json!({"champions": [{"id": "a", "kind": "greedy-model", "path": "p"}]})).is_err());
        assert_eq!(reg["champions"][3]["note"], "kept");
        assert!(promote_entry(&mut reg, json!({"id": "a", "kind": "greedy-model", "path": "models/a"})).is_err(), "promoted once");
        assert!(champions(&json!({"champions": [{"id": "x"}]})).is_err(), "kind and path are required");
        assert!(champions(&json!({})).is_err());
        assert!(opponent("r", "rl-policy", "x").is_err(), "RL opponents are an extension point, not built yet");
    }

    #[test]
    fn the_tracked_registry_loads() {
        let reg = read_registry(&registry_path(None)).unwrap();
        let specs = default_opponent_specs(&reg).unwrap();
        assert_eq!(specs.len(), OPPONENT_COUNT);
        for (l, k, p) in &specs {
            opponent(l, k, p).unwrap();
        }
    }

    #[test]
    fn args_modes() {
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let a = parse_args(&v(&["--candidate", "x", "--base", "y"])).unwrap();
        assert!(matches!(a.mode, Mode::Gate) && a.opp.is_none() && !a.no_info15 && a.info15_n == INFO15_N);
        let a = parse_args(&v(&["--candidate", "x", "--base", "y", "--opp", "p", "--no-info15"])).unwrap();
        assert!(a.no_info15 && a.opp.as_deref() == Some("p"));
        assert!(matches!(parse_args(&v(&["--benchmark", "m"])).unwrap().mode, Mode::Benchmark(_)));
        assert!(parse_args(&v(&["--benchmark", "m", "--opp", "x"])).is_err(), "benchmark setup is fixed");
        let a = parse_args(&v(&["promote", "m", "--gate", "g.json", "--pr", "12"])).unwrap();
        assert!(matches!(a.mode, Mode::Promote(ref id) if id == "m"));
        assert!(parse_args(&v(&["promote", "m"])).is_err(), "promote needs the gate JSON");
        assert!(parse_args(&v(&["promote", "m", "--gate", "g", "--n", "5"])).is_err());
        assert!(parse_args(&v(&["--candidate", "x"])).is_err());
    }

    #[test]
    fn today_is_a_date() {
        let d = today();
        assert_eq!(d.len(), 10);
        assert!(d.as_str() >= "2026-01-01", "{d}");
    }
}
