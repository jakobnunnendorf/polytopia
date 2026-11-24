//! Port of logic/engine/botFull.ts: the full-action-space greedy bot (model kind
//! "greedy-full").
//!
//! It scores every legal action with the greedy heuristic (bot.rs score_action,
//! weights in `greedy`), then scales a positive score by one knob per action
//! type and one per id (tech, unit type, build, city reward). Actions the
//! heuristic rejects (score <= 0) score `open[type] * id - 1` instead. Moves add
//! `centre` points per tile of Chebyshev distance to the map centre removed.
//! With centre 0, every multiplier 1 and every open knob 0 it plays exactly like
//! bot_step with the same greedy weights.
use crate::actions::{apply_action, legal_actions};
use crate::bot::{cached_goal, find_unit, noise, score_with, GoalCache, GreedyWeights};
use crate::grid::dist;
use crate::types::*;

/// botFull.ts FULL_ACTION_TYPES (every action type but endTurn), in order;
/// `FullWeights::ty` and `open` are indexed by this order
pub const FULL_ACTION_TYPES: [&str; 25] = [
    "research",
    "move",
    "attack",
    "capture",
    "recover",
    "examine",
    "disband",
    "upgrade",
    "promote",
    "healOthers",
    "harvestStarfish",
    "infiltrate",
    "train",
    "build",
    "reward",
    "freezeArea",
    "swarm",
    "explode",
    "breakIce",
    "drain",
    "decompose",
    "offerPeace",
    "acceptPeace",
    "declinePeace",
    "breakPeace",
];

/// index of the action's type in FULL_ACTION_TYPES (None for endTurn)
pub fn full_type_index(a: &Action) -> Option<usize> {
    use Action::*;
    Some(match a {
        EndTurn => return None,
        Research { .. } => 0,
        Move { .. } => 1,
        Attack { .. } => 2,
        Capture { .. } => 3,
        Recover { .. } => 4,
        Examine { .. } => 5,
        Disband { .. } => 6,
        Upgrade { .. } => 7,
        Promote { .. } => 8,
        HealOthers { .. } => 9,
        HarvestStarfish { .. } => 10,
        Infiltrate { .. } => 11,
        Train { .. } => 12,
        Build { .. } => 13,
        Reward { .. } => 14,
        FreezeArea { .. } => 15,
        Swarm { .. } => 16,
        Explode { .. } => 17,
        BreakIce { .. } => 18,
        Drain { .. } => 19,
        Decompose { .. } => 20,
        OfferPeace { .. } => 21,
        AcceptPeace { .. } => 22,
        DeclinePeace { .. } => 23,
        BreakPeace { .. } => 24,
    })
}

/// botFull.ts FullWeights. The per-id tables hold every id (the TS defaults
/// list them all, so the TS `?? 1` fallback never applies to a known id).
#[derive(Clone, Debug, PartialEq)]
pub struct FullWeights {
    pub greedy: GreedyWeights,
    /// TS `type`: multiplier on a positive score, by FULL_ACTION_TYPES index
    pub ty: [f64; 25],
    /// score of a rejected action: open * id weight - 1, by FULL_ACTION_TYPES index
    pub open: [f64; 25],
    pub tech: [f64; Tech::COUNT],
    pub unit: [f64; UnitType::COUNT],
    pub build: [f64; Build::COUNT],
    /// REWARD_IDS order == Reward::ALL order
    pub reward: [f64; Reward::COUNT],
    pub centre: f64,
}

/// botFull.ts DEFAULT_FULL_WEIGHTS
pub fn default_full_weights() -> FullWeights {
    FullWeights {
        greedy: GreedyWeights::default_weights(),
        ty: [1.0; 25],
        open: [0.5; 25],
        tech: [1.0; Tech::COUNT],
        unit: [1.0; UnitType::COUNT],
        build: [1.0; Build::COUNT],
        reward: [1.0; Reward::COUNT],
        centre: 1.0,
    }
}

/// `{ ...table, ...v }` for a table keyed by ids; keys that are no id are ignored
fn merge_table(table: &mut [f64], v: Option<&serde_json::Value>, what: &str, index: impl Fn(&str) -> Option<usize>) -> Result<(), String> {
    let Some(v) = v else { return Ok(()) };
    if v.is_null() {
        return Ok(());
    }
    let o = v.as_object().ok_or_else(|| format!("full.{what}: expected an object"))?;
    for (k, x) in o {
        let n = x.as_f64().ok_or_else(|| format!("full.{what}.{k}: expected a number"))?;
        if let Some(i) = index(k) {
            table[i] = n;
        }
    }
    Ok(())
}

/// botFull.ts fullWeights: a model file's (partial) weights on top of the defaults
pub fn full_weights(p: &serde_json::Value) -> Result<FullWeights, String> {
    let mut w = default_full_weights();
    if p.is_null() {
        return Ok(w);
    }
    let o = p.as_object().ok_or("full: expected an object")?;
    if let Some(g) = o.get("greedy") {
        if !g.is_null() {
            w.greedy = w.greedy.merged_json(g)?;
        }
    }
    let ty_index = |k: &str| FULL_ACTION_TYPES.iter().position(|&t| t == k);
    merge_table(&mut w.ty, o.get("type"), "type", ty_index)?;
    merge_table(&mut w.open, o.get("open"), "open", ty_index)?;
    merge_table(&mut w.tech, o.get("tech"), "tech", |k| Tech::from_id(k).map(|t| t as usize))?;
    merge_table(&mut w.unit, o.get("unit"), "unit", |k| UnitType::from_id(k).map(|t| t as usize))?;
    merge_table(&mut w.build, o.get("build"), "build", |k| Build::from_id(k).map(|t| t as usize))?;
    merge_table(&mut w.reward, o.get("reward"), "reward", |k| Reward::from_id(k).map(|t| t as usize))?;
    match o.get("centre") {
        None | Some(serde_json::Value::Null) => {}
        Some(c) => w.centre = c.as_f64().ok_or("full.centre: expected a number")?,
    }
    Ok(w)
}

impl FullWeights {
    /// the JSON shape of (partial) FullWeights, merged onto the defaults like fullWeights
    pub fn from_json(v: &serde_json::Value) -> Result<FullWeights, String> {
        full_weights(v)
    }
}

/// botFull.ts centreDist: Chebyshev distance to the map centre ((n-1)/2, (n-1)/2)
pub fn centre_dist(n: i32, c: Coord) -> f64 {
    let m = (n - 1) as f64 / 2.0;
    (c.x as f64 - m).abs().max((c.y as f64 - m).abs())
}

fn move_score(s: &GameState, unit: Id, to: Coord, w: &FullWeights, cache: &mut Option<GoalCache>) -> f64 {
    let u = find_unit(s, unit);
    let Some(g) = cached_goal(s, u, cache) else { return -1.0 };
    let gain = dist(u.x, u.y, g.x, g.y) - dist(to.x, to.y, g.x, g.y);
    if gain <= 0 {
        return -1.0;
    }
    let to_centre = centre_dist(s.map_size, Coord::new(u.x, u.y)) - centre_dist(s.map_size, to);
    w.greedy.move_ + gain as f64 + w.centre * to_centre + w.greedy.noise * noise(s, u.id as i64 * 13 + to.x as i64 + to.y as i64)
}

fn id_weight(a: &Action, w: &FullWeights) -> f64 {
    match *a {
        Action::Research { tech } => w.tech[tech as usize],
        Action::Train { unit, .. } => w.unit[unit as usize],
        Action::Upgrade { to, .. } => w.unit[to as usize],
        Action::Build { building, .. } => w.build[building as usize],
        Action::Reward { reward, .. } => w.reward[reward as usize],
        _ => 1.0,
    }
}

pub fn score_full(s: &GameState, a: &Action, w: &FullWeights) -> f64 {
    score_full_with(s, a, w, &mut None)
}

fn score_full_with(s: &GameState, a: &Action, w: &FullWeights, cache: &mut Option<GoalCache>) -> f64 {
    let Some(t) = full_type_index(a) else { return 0.0 };
    let base = match *a {
        Action::Move { unit, to } => move_score(s, unit, to, w, cache),
        _ => score_with(s, a, &w.greedy, cache),
    };
    let id = id_weight(a, w);
    if base > 0.0 {
        base * w.ty[t] * id
    } else {
        w.open[t] * id - 1.0
    }
}

/// botFull.ts fullBotStep
pub fn full_bot_step(s: &GameState, w: &FullWeights) -> Action {
    full_best_of(s, &legal_actions(s), w)
}

/// the choice of full_bot_step among `actions` (the legal actions of `s`, in order).
/// goal() is cached per unit for this call: it is a pure function of the unchanged state.
fn full_best_of(s: &GameState, actions: &[Action], w: &FullWeights) -> Action {
    let mut best = Action::EndTurn;
    let mut best_score = 0.0f64;
    let mut cache: Option<GoalCache> = Some(GoalCache::default());
    for a in actions {
        if *a == Action::EndTurn {
            continue;
        }
        let sc = score_full_with(s, a, w, &mut cache);
        if sc > best_score {
            best_score = sc;
            best = *a;
        }
    }
    // a pending reward must be answered
    if best == Action::EndTurn {
        if let Some(a0 @ Action::Reward { .. }) = actions.first() {
            return *a0;
        }
    }
    best
}

/// botFull.ts playFullBotTurn, in place
pub fn play_full_bot_turn(s: &mut GameState, max_actions: i32, w: &FullWeights) {
    let p = s.current;
    let mut i = 0;
    while i < max_actions && !s.over && s.current == p {
        let a = full_bot_step(s, w);
        apply_action(s, &a).unwrap_or_else(|e| panic!("full bot chose an illegal action {a:?}: {e}"));
        i += 1;
    }
    if !s.over && s.current == p {
        apply_action(s, &Action::EndTurn).unwrap_or_else(|e| panic!("endTurn rejected: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bot::tests::{from_bits, guarded};

    #[test]
    fn type_order_matches_actions() {
        // every Action variant but EndTurn maps to its own FULL_ACTION_TYPES name
        let a = crate::json::action_from_json(&serde_json::json!({"type": "breakPeace", "player": 1})).unwrap();
        assert_eq!(FULL_ACTION_TYPES[full_type_index(&a).unwrap()], "breakPeace");
        assert_eq!(centre_dist(16, Coord::new(3, 3)), 4.5);
    }

    /// TS reference rows from bot-full-ref.ts: POLY_BOT_FULL_REF or the default path; skipped when missing
    #[test]
    fn full_scores_and_steps_match_typescript() {
        let path = std::env::var("POLY_BOT_FULL_REF").unwrap_or_else(|_| "/Users/jakobnunnendorf/.claude/jobs/ae4f4234/tmp/bot-full-ref.jsonl".into());
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!("bot-full reference data missing: skipped");
            return;
        };
        let mut lines = text.lines();
        // first line: the weight sets as partial FullWeights JSON, keyed by name
        let head: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        let sets: Vec<(String, FullWeights)> = head["sets"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), full_weights(v).unwrap())).collect();
        let actions_ported = !include_str!("actions.rs").contains("todo!()");
        let (mut ok, mut bad, mut gated) = (0usize, 0usize, 0usize);
        let (mut pick_ok, mut pick_bad) = (0usize, 0usize);
        let (mut step_ok, mut step_bad, mut step_gated) = (0usize, 0usize, 0usize);
        let mut rows = 0;
        for l in lines {
            let row: serde_json::Value = serde_json::from_str(l).unwrap();
            rows += 1;
            let s = crate::json::state_from_json(&row["state"]).unwrap();
            let legal: Vec<Action> = row["legal"].as_array().unwrap().iter().map(|a| crate::json::action_from_json(a).unwrap()).collect();
            for (name, w) in &sets {
                let scores = row["scores"][name].as_array().unwrap();
                for (i, a) in legal.iter().enumerate() {
                    let want = from_bits(&scores[i]);
                    match guarded(|| score_full(&s, a, w)) {
                        Ok(got) if got.to_bits() == want.to_bits() => ok += 1,
                        Ok(got) => {
                            bad += 1;
                            if bad <= 10 {
                                eprintln!("game {} step {} {name} {a:?}: rust {got} ts {want}", row["game"], row["step"]);
                            }
                        }
                        Err(true) => gated += 1,
                        Err(false) => bad += 1,
                    }
                }
                let want = crate::json::action_from_json(&row["step_"][name]).unwrap();
                match guarded(|| full_best_of(&s, &legal, w)) {
                    Ok(got) if got == want => pick_ok += 1,
                    _ => pick_bad += 1,
                }
                if !actions_ported {
                    step_gated += 1;
                    continue;
                }
                match guarded(|| full_bot_step(&s, w)) {
                    Ok(got) if got == want => step_ok += 1,
                    Ok(_) | Err(false) => step_bad += 1,
                    Err(true) => step_gated += 1,
                }
            }
        }
        eprintln!(
            "bot_full over {rows} states, {} weight sets: score_full {ok} equal, {bad} different, {gated} gated; choice among TS legal actions {pick_ok} equal, {pick_bad} different; full_bot_step {step_ok} equal, {step_bad} different, {step_gated} gated",
            sets.len()
        );
        assert_eq!(bad, 0);
        assert_eq!(pick_bad, 0);
        assert_eq!(step_bad, 0);
    }
}
