//! The strategic-action learner of David's track (issue #166), shared by `rl-value` and `rl-gate`.
//!
//! State: six exact integers of the learner seat, read at the start of each of its turns
//! (turn, cities, income, units, sum of city levels, techs).
//! Action: one of five strategic actions, chosen at the start of a learner turn and held for that turn. An action
//! multiplies the base bot's move-type factors (`FullWeights::ty`) of its move types by the boost; action 0 is the
//! base bot unchanged.
//! Policy: a table state -> action (`rl-value fit-vi` writes it); a state without an entry plays action 0.
use polycore::actions::apply_action;
use polycore::bot_full::full_bot_step;
pub use polycore::bot_full::{full_weights, FullWeights};
use polycore::state::{self as st, NewGameOptions};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};

pub type R<T> = Result<T, String>;

/// The learner's state: turn, cities, income, units, sum of city levels, techs.
pub type State = [i32; 6];
pub const FEATURES: [&str; 6] = ["turn", "cities", "income", "units", "levels", "techs"];

pub const ACTION_NAMES: [&str; 5] = ["bot", "expand", "economy", "army", "research"];
pub const NA: usize = ACTION_NAMES.len();
/// move types boosted by each action (indices into bot_full::FULL_ACTION_TYPES)
pub const BOOSTED: [&[usize]; NA] = [
    &[],      // bot: unchanged
    &[3, 5],  // expand: capture, examine
    &[13],    // economy: build
    &[12, 2], // army: train, attack
    &[0],     // research: research
];

/// The base weights under each strategic action; index 0 is the base unchanged.
pub fn action_weights(base: &FullWeights, boost: f64) -> Vec<FullWeights> {
    BOOSTED
        .iter()
        .map(|types| {
            let mut w = base.clone();
            for &t in *types {
                w.ty[t] *= boost;
            }
            w
        })
        .collect()
}

/// The state of seat `p` now.
pub fn features(s: &polycore::types::GameState, p: i32) -> State {
    let mut cities = 0;
    let mut levels = 0;
    for c in s.cities.iter().filter(|c| c.owner == p) {
        cities += 1;
        levels += c.level;
    }
    let units = s.units.iter().filter(|u| u.owner == p).count() as i32;
    [s.turn, cities, st::income(s, p), units, levels, s.players[p as usize].techs.len() as i32]
}

pub fn repo_root() -> PathBuf {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    p.canonicalize().unwrap_or(p)
}

/// A file path as given (from the working directory), else from the repo root.
pub fn resolve(path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.exists() {
        p.to_path_buf()
    } else {
        repo_root().join(path)
    }
}

/// greedy-full weights of a model id under models/, a model folder or a model.json path
pub fn model_weights(id: &str) -> R<FullWeights> {
    let p = Path::new(id);
    let f = if p.is_file() {
        p.to_path_buf()
    } else if p.join("model.json").is_file() {
        p.join("model.json")
    } else {
        repo_root().join("models").join(id).join("model.json")
    };
    let text = std::fs::read_to_string(&f).map_err(|e| format!("{}: {e}", f.display()))?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", f.display()))?;
    if v["kind"].as_str() != Some("greedy-full") {
        return Err(format!("{}: only greedy-full models are supported", f.display()));
    }
    full_weights(&v["full"])
}

/// A policy file: an optional `# {json}` header line (fit-vi writes the base model and the boost there), a column
/// header, then one row per state: turn, cities, income, units, levels, techs, action, and further columns that are
/// ignored.
pub fn read_table(path: &str) -> R<(Value, HashMap<State, u8>)> {
    let f = resolve(path);
    let file = std::fs::File::open(&f).map_err(|e| format!("{}: {e}", f.display()))?;
    let mut meta = Value::Null;
    let mut t = HashMap::new();
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Some(m) = line.strip_prefix("# ") {
            meta = serde_json::from_str(m).map_err(|e| format!("{path}: header: {e}"))?;
            continue;
        }
        if line.starts_with("turn") || line.starts_with('#') || line.is_empty() {
            continue;
        }
        let v: Vec<&str> = line.split('\t').collect();
        if v.len() < 7 {
            return Err(format!("{path}: bad row {line:?}"));
        }
        let n = |i: usize| v[i].parse::<i32>().map_err(|_| format!("{path}: bad row {line:?}"));
        let a = n(6)?;
        if a < 0 || a as usize >= NA {
            return Err(format!("{path}: action {a} out of range 0..{}", NA - 1));
        }
        t.insert([n(0)?, n(1)?, n(2)?, n(3)?, n(4)?, n(5)?], a as u8);
    }
    Ok((meta, t))
}

/// A value-iteration policy ready to play: the table, the base bot and its weights under each action.
#[derive(Clone)]
pub struct StrategicPolicy {
    pub path: String,
    pub model: String,
    pub boost: f64,
    pub table: HashMap<State, u8>,
    /// the base weights under each action (action_weights)
    pub weights: Vec<FullWeights>,
}

impl std::fmt::Debug for StrategicPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "StrategicPolicy({}, base {}, boost {}, {} states)", self.path, self.model, self.boost, self.table.len())
    }
}

impl StrategicPolicy {
    pub fn new(path: &str, model: &str, boost: f64, table: HashMap<State, u8>) -> R<Self> {
        if !(boost > 0.0) {
            return Err(format!("{path}: boost must be positive, got {boost}"));
        }
        let weights = action_weights(&model_weights(model)?, boost);
        Ok(StrategicPolicy { path: path.to_string(), model: model.to_string(), boost, table, weights })
    }
    /// Load a policy file. Its header must name the base model ("model") and the boost ("boost").
    pub fn load(path: &str) -> R<Self> {
        let (meta, table) = read_table(path)?;
        let model = meta["model"].as_str().ok_or(format!("{path}: no base model in the header (a `# {{\"model\": .., \"boost\": ..}}` line; rl-value fit-vi writes it)"))?;
        let boost = meta["boost"].as_f64().ok_or(format!("{path}: no boost in the header"))?;
        Self::new(path, model, boost, table)
    }
    pub fn action(&self, s: &State) -> usize {
        self.table.get(s).copied().unwrap_or(0) as usize
    }
}

/// One game, played move by move as polyapi `playGames` plays it (same stop rule: game over, `max_moves` moves or
/// past `max_turn`). The learner seat plays `learner[a]`, with the action `a` picked by `pick` at the start of each
/// of its turns; seat i (other than the learner) plays `opps[i - 1]` (the learner is seat 0).
pub struct Outcome {
    /// one row per learner turn: state, score, 0, action; then the terminal row: state, final score, 1, won (0/1)
    pub rows: Vec<[i32; 9]>,
    pub score: i32,
    pub winner: Option<i32>,
}

pub fn play_game(opts: &Value, learner: &[FullWeights], pick: &mut dyn FnMut(&State) -> usize, opps: &[&FullWeights], max_turn: i32, max_moves: i64) -> R<Outcome> {
    const LEARNER: i32 = 0;
    let mut s = st::create_game(&NewGameOptions::from_json(opts)?)?;
    if opps.len() + 1 != s.players.len() {
        return Err(format!("{} opponent weights for {} players", opps.len(), s.players.len()));
    }
    let mut rows = Vec::with_capacity(32);
    let mut last = (-1, -1);
    let mut moves = 0;
    let mut act = 0usize;
    while !s.over && moves < max_moves && s.turn <= max_turn {
        if s.current == LEARNER && last != (s.turn, s.current) {
            let f = features(&s, LEARNER);
            act = pick(&f);
            if act >= learner.len() {
                return Err(format!("action {act} out of range 0..{}", learner.len() - 1));
            }
            rows.push([f[0], f[1], f[2], f[3], f[4], f[5], st::score_of(&s, LEARNER), 0, act as i32]);
        }
        last = (s.turn, s.current);
        let w = if s.current == LEARNER { &learner[act] } else { opps[s.current as usize - 1] };
        let a = full_bot_step(&s, w);
        apply_action(&mut s, &a)?;
        moves += 1;
    }
    let f = features(&s, LEARNER);
    let score = st::score_of(&s, LEARNER);
    rows.push([f[0], f[1], f[2], f[3], f[4], f[5], score, 1, (s.winner == Some(LEARNER)) as i32]);
    Ok(Outcome { rows, score, winner: s.winner })
}

/// polyapi-style createGame options with the learner (seat 0) as the human seat or not.
pub fn game_opts(seed: i64, players: usize, difficulty: &str, tribes: &[String], human: bool, mode: &str, map_size: i64, map_type: &str) -> Value {
    json!({"mapSize": map_size, "players": players, "mode": mode, "seed": seed,
           "humans": if human { json!([0]) } else { json!([]) },
           "mapType": map_type, "difficulty": difficulty, "clans": tribes})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_file_round_trip() {
        let dir = std::env::temp_dir().join(format!("rl-value-policy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("p.tsv");
        std::fs::write(&f, "# {\"model\": \"greedy-full-probe-perf\", \"boost\": 2}\nturn\tcities\tincome\tunits\tlevels\ttechs\taction\tv\n3\t1\t4\t2\t2\t3\t4\t100.0\n").unwrap();
        let p = StrategicPolicy::load(f.to_str().unwrap()).unwrap();
        assert_eq!((p.model.as_str(), p.boost, p.table.len()), ("greedy-full-probe-perf", 2.0, 1));
        assert_eq!(p.action(&[3, 1, 4, 2, 2, 3]), 4);
        assert_eq!(p.action(&[3, 1, 4, 2, 2, 4]), 0); // unknown state: the bot
        assert_eq!(p.weights.len(), NA);
        assert_eq!(p.weights[4].ty[0], 2.0 * p.weights[0].ty[0]);
        std::fs::write(&f, "turn\tcities\tincome\tunits\tlevels\ttechs\taction\n3\t1\t4\t2\t2\t3\t4\n").unwrap();
        assert!(StrategicPolicy::load(f.to_str().unwrap()).unwrap_err().contains("no base model"));
        std::fs::write(&f, "# {\"model\": \"greedy-full-probe-perf\", \"boost\": 2}\n3\t1\t4\t2\t2\t3\t9\n").unwrap();
        assert!(StrategicPolicy::load(f.to_str().unwrap()).unwrap_err().contains("out of range"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
