//! The strategic-action learner of David's track (issue #166), shared by `rl-value` and `rl-gate`.
//!
//! State: six exact integers of the learner seat, read at the start of each of its turns
//! (turn, cities, income, units, sum of city levels, techs).
//! Action: one action of an action set (`ActionSet`), chosen at the start of a learner turn and held for that turn.
//! An action multiplies the base bot's move-type factors (`FullWeights::ty`) of its move types by the boost.
//! `strategic5` (experiments 15, 21, 22): bot, expand, economy, army, research, where action 0 is the base bot
//! unchanged; `spend3` (experiment 23): economy, army, research; `spend4` (experiment 26): bot, economy, army,
//! research.
//! Policy: a table state -> action (`rl-value fit-vi` writes it), keyed on a subset of the six features
//! (`FeatureMask`; dropped features are 0 in the table). A state without an entry plays the action set's default:
//! action 0 for strategic5, the base bot unchanged for spend3.
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

/// An action set: the actions' names, the move types each one boosts, and what a state without a policy entry
/// plays (`default`: an action of the set, or None for the base bot unchanged).
#[derive(Debug, PartialEq)]
pub struct ActionSet {
    pub id: &'static str,
    pub names: &'static [&'static str],
    pub boosted: &'static [&'static [usize]],
    pub default: Option<usize>,
}

/// The five strategic actions of experiments 15, 21 and 22; action 0 is the base bot unchanged.
pub const STRATEGIC5: ActionSet = ActionSet { id: "strategic5", names: &ACTION_NAMES, boosted: &BOOSTED, default: Some(0) };
/// Spending only (experiment 23, David): build, train and attack, research; expansion stays at the base weights.
pub const SPEND3: ActionSet = ActionSet { id: "spend3", names: &["economy", "army", "research"], boosted: &[&[13], &[12, 2], &[0]], default: None };
/// Spending with the bot unchanged as an action (experiment 26, David): bot, build, train and attack, research;
/// action 0 is also the default, so a state without an entry plays the bot unchanged.
pub const SPEND4: ActionSet =
    ActionSet { id: "spend4", names: &["bot", "economy", "army", "research"], boosted: &[&[], &[13], &[12, 2], &[0]], default: Some(0) };
pub const ACTION_SETS: [&ActionSet; 3] = [&STRATEGIC5, &SPEND3, &SPEND4];

impl ActionSet {
    pub fn len(&self) -> usize {
        self.names.len()
    }
    /// By id; a missing id (files from before the field) is strategic5.
    pub fn by_id(id: Option<&str>) -> R<&'static ActionSet> {
        let id = id.unwrap_or(STRATEGIC5.id);
        ACTION_SETS.iter().copied().find(|a| a.id == id).ok_or(format!("unknown action set {id:?} (one of {})", ACTION_SETS.map(|a| a.id).join(", ")))
    }
    /// The base weights under each action of the set.
    pub fn weights(&self, base: &FullWeights, boost: f64) -> Vec<FullWeights> {
        self.boosted
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
}

/// The base weights under each strategic action of strategic5; index 0 is the base unchanged.
pub fn action_weights(base: &FullWeights, boost: f64) -> Vec<FullWeights> {
    STRATEGIC5.weights(base, boost)
}

/// Which of the six features a policy keys on; a dropped feature is set to 0 before the lookup.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FeatureMask(pub [bool; 6]);

impl FeatureMask {
    pub const ALL: FeatureMask = FeatureMask([true; 6]);
    /// From feature names (a subset of FEATURES, any order).
    pub fn from_names<S: AsRef<str>>(names: &[S]) -> R<FeatureMask> {
        let mut m = [false; 6];
        for n in names {
            let i = FEATURES.iter().position(|f| *f == n.as_ref()).ok_or(format!("unknown feature {:?} (one of {})", n.as_ref(), FEATURES.join(", ")))?;
            m[i] = true;
        }
        if !m.iter().any(|x| *x) {
            return Err("no features".into());
        }
        Ok(FeatureMask(m))
    }
    /// From a header's "features" field; missing = all six.
    pub fn from_json(v: &Value) -> R<FeatureMask> {
        match v {
            Value::Null => Ok(FeatureMask::ALL),
            Value::Array(a) => FeatureMask::from_names(&a.iter().map(|x| x.as_str().unwrap_or("?").to_string()).collect::<Vec<_>>()),
            _ => Err("\"features\" must be a list of feature names".into()),
        }
    }
    pub fn names(&self) -> Vec<&'static str> {
        (0..6).filter(|&i| self.0[i]).map(|i| FEATURES[i]).collect()
    }
    pub fn has_turn(&self) -> bool {
        self.0[0]
    }
    pub fn project(&self, s: &State) -> State {
        let mut o = *s;
        for i in 0..6 {
            if !self.0[i] {
                o[i] = 0;
            }
        }
        o
    }
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
    pub actions: &'static ActionSet,
    pub features: FeatureMask,
    /// the base bot's weights (what the set's default None plays)
    pub base: FullWeights,
    /// the base weights under each action of the set
    pub weights: Vec<FullWeights>,
}

impl std::fmt::Debug for StrategicPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "StrategicPolicy({}, base {}, boost {}, {}, features {:?}, {} states)", self.path, self.model, self.boost, self.actions.id, self.features.names(), self.table.len())
    }
}

impl StrategicPolicy {
    /// A strategic5 policy on all six features.
    pub fn new(path: &str, model: &str, boost: f64, table: HashMap<State, u8>) -> R<Self> {
        Self::with(path, model, boost, table, &STRATEGIC5, FeatureMask::ALL)
    }
    pub fn with(path: &str, model: &str, boost: f64, table: HashMap<State, u8>, actions: &'static ActionSet, features: FeatureMask) -> R<Self> {
        if !(boost > 0.0) {
            return Err(format!("{path}: boost must be positive, got {boost}"));
        }
        if let Some((_, a)) = table.iter().find(|(_, a)| **a as usize >= actions.len()) {
            return Err(format!("{path}: action {a} out of range for {} (0..{})", actions.id, actions.len() - 1));
        }
        let base = model_weights(model)?;
        let weights = actions.weights(&base, boost);
        Ok(StrategicPolicy { path: path.to_string(), model: model.to_string(), boost, table, actions, features, base, weights })
    }
    /// Load a policy file. Its header must name the base model ("model") and the boost ("boost"); "actions" (the
    /// action set's id) and "features" (the feature names it keys on) default to strategic5 and all six.
    pub fn load(path: &str) -> R<Self> {
        let (meta, table) = read_table(path)?;
        let model = meta["model"].as_str().ok_or(format!("{path}: no base model in the header (a `# {{\"model\": .., \"boost\": ..}}` line; rl-value fit-vi writes it)"))?;
        let boost = meta["boost"].as_f64().ok_or(format!("{path}: no boost in the header"))?;
        let actions = ActionSet::by_id(meta["actions"].as_str()).map_err(|e| format!("{path}: {e}"))?;
        let features = FeatureMask::from_json(&meta["features"]).map_err(|e| format!("{path}: {e}"))?;
        Self::with(path, model, boost, table, actions, features)
    }
    /// The action in state `s` (looked up on the policy's features), or the set's default.
    pub fn action(&self, s: &State) -> Option<usize> {
        self.table.get(&self.features.project(s)).map(|a| *a as usize).or(self.actions.default)
    }
}

/// One game, played move by move as polyapi `playGames` plays it (same stop rule: game over, `max_moves` moves or
/// past `max_turn`). The learner seat plays `learner[a]`, with the action `a` picked by `pick` at the start of each
/// of its turns, or `base` when `pick` gives None; seat i (other than the learner) plays `opps[i - 1]` (the learner
/// is seat 0). The action column of a row is -1 for a turn played by `base`.
pub struct Outcome {
    /// one row per learner turn: state, score, 0, action; then the terminal row: state, final score, 1, won (0/1)
    pub rows: Vec<[i32; 9]>,
    pub score: i32,
    pub winner: Option<i32>,
}

pub fn play_game(opts: &Value, learner: &[FullWeights], base: &FullWeights, pick: &mut dyn FnMut(&State) -> Option<usize>, opps: &[&FullWeights], max_turn: i32, max_moves: i64) -> R<Outcome> {
    const LEARNER: i32 = 0;
    let mut s = st::create_game(&NewGameOptions::from_json(opts)?)?;
    if opps.len() + 1 != s.players.len() {
        return Err(format!("{} opponent weights for {} players", opps.len(), s.players.len()));
    }
    let mut rows = Vec::with_capacity(32);
    let mut last = (-1, -1);
    let mut moves = 0;
    let mut act: Option<usize> = None;
    while !s.over && moves < max_moves && s.turn <= max_turn {
        if s.current == LEARNER && last != (s.turn, s.current) {
            let f = features(&s, LEARNER);
            act = pick(&f);
            if let Some(a) = act.filter(|a| *a >= learner.len()) {
                return Err(format!("action {a} out of range 0..{}", learner.len() - 1));
            }
            rows.push([f[0], f[1], f[2], f[3], f[4], f[5], st::score_of(&s, LEARNER), 0, act.map_or(-1, |a| a as i32)]);
        }
        last = (s.turn, s.current);
        let w = if s.current == LEARNER { act.map_or(base, |a| &learner[a]) } else { opps[s.current as usize - 1] };
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
        assert_eq!(p.action(&[3, 1, 4, 2, 2, 3]), Some(4));
        assert_eq!(p.action(&[3, 1, 4, 2, 2, 4]), Some(0)); // unknown state: strategic5's default, the bot
        assert_eq!((p.actions.id, p.features), ("strategic5", FeatureMask::ALL), "missing fields: the old defaults");
        assert_eq!(p.weights.len(), NA);
        assert_eq!(p.weights[4].ty[0], 2.0 * p.weights[0].ty[0]);
        std::fs::write(&f, "turn\tcities\tincome\tunits\tlevels\ttechs\taction\n3\t1\t4\t2\t2\t3\t4\n").unwrap();
        assert!(StrategicPolicy::load(f.to_str().unwrap()).unwrap_err().contains("no base model"));
        std::fs::write(&f, "# {\"model\": \"greedy-full-probe-perf\", \"boost\": 2}\n3\t1\t4\t2\t2\t3\t9\n").unwrap();
        assert!(StrategicPolicy::load(f.to_str().unwrap()).unwrap_err().contains("out of range"));
        // spend3 on four features: the table keys have 0 in the dropped columns; unknown states play the base bot
        std::fs::write(
            &f,
            "# {\"model\": \"greedy-full-probe-perf\", \"boost\": 2, \"actions\": \"spend3\", \"features\": [\"cities\", \"income\", \"units\", \"techs\"]}\n0\t1\t4\t2\t0\t3\t2\n",
        )
        .unwrap();
        let p = StrategicPolicy::load(f.to_str().unwrap()).unwrap();
        assert_eq!((p.actions.id, p.features.names()), ("spend3", vec!["cities", "income", "units", "techs"]));
        assert_eq!(p.action(&[17, 1, 4, 2, 9, 3]), Some(2), "turn and levels are ignored");
        assert_eq!(p.action(&[17, 1, 4, 2, 9, 4]), None, "unknown: the base bot");
        assert_eq!(p.weights.len(), 3);
        assert_eq!(p.weights[2].ty[0], 2.0 * p.base.ty[0]);
        assert_eq!(p.weights[1].ty[12], 2.0 * p.base.ty[12]);
        assert_eq!(p.weights[0].ty[13], 2.0 * p.base.ty[13]);
        std::fs::write(&f, "# {\"model\": \"greedy-full-probe-perf\", \"boost\": 2, \"actions\": \"spend3\"}\n0\t1\t4\t2\t0\t3\t3\n").unwrap();
        assert!(StrategicPolicy::load(f.to_str().unwrap()).unwrap_err().contains("out of range for spend3"));
        assert!(FeatureMask::from_names(&["cities", "gold"]).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn spend4_is_the_bot_plus_spend3() {
        let base = model_weights("greedy-full-probe-perf-r15").unwrap();
        let (w4, w3) = (SPEND4.weights(&base, 2.0), SPEND3.weights(&base, 2.0));
        assert_eq!(w4[0], base, "action 0 is the base bot unchanged");
        assert_eq!(&w4[1..], &w3[..], "actions 1-3 are spend3's");
        assert_eq!((SPEND4.default, ActionSet::by_id(Some("spend4")).unwrap().len()), (Some(0), 4));
    }
}
