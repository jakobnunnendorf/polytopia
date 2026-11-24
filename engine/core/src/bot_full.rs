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
//!
//! City defence (issue #28): a city of ours is threatened when a known enemy unit (not at
//! peace) is within `defend_radius` tiles. A move into an empty threatened city of ours adds
//! `defend`; a move that leaves one empty subtracts it. With defend 0 (the default, and every
//! model trained before) nothing changes.
//!
//! Research usefulness (issue #29): `tech_uses` counts what a tech would let us do right now
//! (free tiles in our territory where one of its builds fits, plus trainable unit types it
//! unlocks). Research adds `tech_use * uses` and subtracts `tech_useless` when uses is 0.
//! Both default to 0 (off).
//!
//! Front pull (issue #30): a move adds `front` per tile it brings the unit closer to the nearest
//! known enemy city or unit (not at peace), also for moves the goal logic rejects, so idle units
//! drift toward the action. Default 0 (off).
use crate::actions::{apply_action, legal_actions};
use crate::bot::{cached_goal, find_unit, noise, score_with, GoalCache, GreedyWeights};
use crate::diplomacy::at_peace;
use crate::grid::{dist, idx};
use crate::state::city_by_id;
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
    /// city defence bonus / penalty (0 = off)
    pub defend: f64,
    /// how near (tiles) an enemy makes a city threatened
    pub defend_radius: f64,
    /// research bonus per thing the tech unlocks that we could use now (0 = off)
    pub tech_use: f64,
    /// research penalty for a tech we could not use at all right now (0 = off)
    pub tech_useless: f64,
    /// move bonus per tile closer to the nearest known enemy (0 = off)
    pub front: f64,
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
        defend: 0.0,
        defend_radius: 2.0,
        tech_use: 0.0,
        tech_useless: 0.0,
        front: 0.0,
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
    for (key, slot) in [("centre", &mut w.centre), ("defend", &mut w.defend), ("defendRadius", &mut w.defend_radius), ("techUse", &mut w.tech_use), ("techUseless", &mut w.tech_useless), ("front", &mut w.front)] {
        match o.get(key) {
            None | Some(serde_json::Value::Null) => {}
            Some(c) => *slot = c.as_f64().ok_or_else(|| format!("full.{key}: expected a number"))?,
        }
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

/// our city on (x, y) when an enemy unit we know of is within `radius` tiles of it
fn threatened_city_at(s: &GameState, owner: i32, x: i32, y: i32, radius: i32) -> bool {
    let n = s.map_size;
    let t = &s.tiles[idx(n, x, y)];
    let Some(ci) = city_by_id(s, t.city_id) else { return false };
    if s.cities[ci].owner != owner {
        return false;
    }
    let explored = &s.players[owner as usize].explored;
    s.units.iter().any(|e| {
        e.owner != owner && !at_peace(s, owner, e.owner) && explored[idx(n, e.x, e.y)] == 1 && dist(x, y, e.x, e.y) <= radius
    })
}

/// the city-defence term of a move: +defend into an empty threatened city of ours,
/// -defend for leaving one (one unit per tile, so leaving empties it)
fn defend_term(s: &GameState, unit: Id, to: Coord, w: &FullWeights) -> f64 {
    if w.defend == 0.0 {
        return 0.0;
    }
    let u = find_unit(s, unit);
    let r = w.defend_radius.round().max(1.0) as i32;
    let mut d = 0.0;
    if threatened_city_at(s, u.owner, to.x, to.y, r) && !s.units.iter().any(|o| o.x == to.x && o.y == to.y) {
        d += w.defend;
    }
    if threatened_city_at(s, u.owner, u.x, u.y, r) {
        d -= w.defend;
    }
    d
}

/// what researching `tech` would let `p` use right now: free tiles in p's territory where one of
/// its builds fits (terrain, resource and next-to rules; once-per-city buildings once per city),
/// plus 1 when it unlocks a trainable unit
pub fn tech_uses(s: &GameState, p: i32, tech: Tech) -> i32 {
    let mut uses = 0;
    let builds: Vec<&crate::data_gen::BuildDef> = crate::data_gen::BUILDS
        .iter()
        .filter(|b| b.tech == Some(tech) && matches!(b.kind, BuildKind::Building | BuildKind::Harvest | BuildKind::Temple))
        .collect();
    if !builds.is_empty() {
        let n = s.map_size;
        // once-per-city buildings count at most once per city
        let mut per_city: Vec<(Id, Build)> = Vec::new();
        for (i, t) in s.tiles.iter().enumerate() {
            let Some(ci) = city_by_id(s, t.territory) else { continue };
            if s.cities[ci].owner != p || t.building.is_some() || t.city_id.is_some() {
                continue;
            }
            let (x, y) = (i as i32 % n, i as i32 / n);
            let near = |ok: &dyn Fn(&Tile) -> bool| {
                (-1..=1).any(|dy| {
                    (-1..=1).any(|dx| {
                        let (nx, ny) = (x + dx, y + dy);
                        (dx, dy) != (0, 0) && nx >= 0 && ny >= 0 && nx < n && ny < n && ok(&s.tiles[idx(n, nx, ny)])
                    })
                })
            };
            let fits = builds.iter().find(|b| {
                b.allows(t.terrain)
                    && (b.resource.is_none() || b.resource == t.resource)
                    && (b.next_to.is_empty() || near(&|o: &Tile| o.building.is_some_and(|ob| b.next_to.contains(&ob))))
                    && b.next_to_terrain.is_none_or(|tt| near(&|o: &Tile| o.terrain == tt))
            });
            if let Some(b) = fits {
                if b.one_per_city {
                    let city = s.cities[ci].id;
                    if per_city.contains(&(city, b.id)) {
                        continue;
                    }
                    per_city.push((city, b.id));
                }
                uses += 1;
            }
        }
    }
    // a new unit counts once (the unit table holds tribe variants of the same unit)
    uses + crate::data_gen::UNITS.iter().any(|u| u.trainable && u.tech == Some(tech)) as i32
}

fn research_term(s: &GameState, tech: Tech, w: &FullWeights) -> f64 {
    if w.tech_use == 0.0 && w.tech_useless == 0.0 {
        return 0.0;
    }
    let uses = tech_uses(s, s.current, tech);
    w.tech_use * uses as f64 - if uses == 0 { w.tech_useless } else { 0.0 }
}

/// Chebyshev distance from (x, y) to the nearest enemy city or unit `owner` knows of (explored
/// tile, not at peace); None when it knows of none
fn enemy_dist(s: &GameState, owner: i32, x: i32, y: i32) -> Option<i32> {
    let n = s.map_size;
    let explored = &s.players[owner as usize].explored;
    let hostile = |o: i32| o != owner && o >= 0 && !at_peace(s, owner, o);
    let units = s.units.iter().filter(|e| hostile(e.owner) && explored[idx(n, e.x, e.y)] == 1).map(|e| dist(x, y, e.x, e.y));
    let cities = s.cities.iter().filter(|c| hostile(c.owner) && explored[idx(n, c.x, c.y)] == 1).map(|c| dist(x, y, c.x, c.y));
    units.chain(cities).min()
}

/// the front-pull term of a move: front per tile closer to the nearest known enemy
fn front_term(s: &GameState, unit: Id, to: Coord, w: &FullWeights) -> f64 {
    if w.front == 0.0 {
        return 0.0;
    }
    let u = find_unit(s, unit);
    match (enemy_dist(s, u.owner, u.x, u.y), enemy_dist(s, u.owner, to.x, to.y)) {
        (Some(a), Some(b)) => w.front * (a - b) as f64,
        _ => 0.0,
    }
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
    let score = if base > 0.0 { base * w.ty[t] * id } else { w.open[t] * id - 1.0 };
    match *a {
        Action::Move { unit, to } => score + defend_term(s, unit, to, w) + front_term(s, unit, to, w),
        Action::Research { tech } => score + research_term(s, tech, w),
        _ => score,
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
