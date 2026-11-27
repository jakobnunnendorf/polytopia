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
//!
//! Road-aware moves (issue #34): with `roads` > 0 a move's progress toward its goal is measured
//! partly in travel cost, where a step between two road tiles (road, bridge, village or city on
//! own, peace-partner or unclaimed land, as in movement.rs) costs half. Progress =
//! tiles gained + roads * (road-aware gain - tiles gained). Default 0 (off).
//!
//! Endgame peace break (issue #124): the greedy bot never breaks peace, so a game
//! whose last players are at peace can never end. With `breakPeace` > 0 the bot breaks peace with a
//! partner when every other living player is at peace with it too (nobody left to fight) and it
//! has at least `breakPeace` times that partner's cities. Default 0 (off).
//! Economy plan (issue #68): econ_plan.rs solves a finite-horizon DP over one representative
//! city's economy (rounds left, cumulative pop, buildable pop supply, stars per city) once per
//! process and model. Research, pop builds, leveling buildings and markets then add
//! `plan * A`, where A = (1 - gamma) * (value of buying against never buying - lambda * cost),
//! i.e. buy now rather than next round, in stars, clamped to +-10 (PLAN_A_CAP); the term is added whether the base score is positive or not, as front's is.
//! Default 0 (off).
//!
//! Unjamming moves (issue #130: armies jammed by their own units). Both default 0 (off), and with
//! both at 0 moves score exactly as before. With either on, a move that gains nothing toward the
//! goal (sideways, back) is no longer ruled out: it scores its gain (0 or less) plus the terms
//! below and is taken when that is positive.
//! - `moveNoise`: a zero-mean random term, uniform in [-moveNoise, +moveNoise], seeded by game,
//!   turn, unit and target, so a stuck unit sometimes steps aside; on average every move keeps
//!   its score.
//! - `spread`: `spread` per own unit fewer next to the target than next to the unit now, so
//!   crowds thin out.
//!
//! Value field (issue #76): value_field.rs runs value iteration on the tile graph of the moving
//! player [EMAI RL 2.0 p.107: value iteration on a gridworld]: rewards at claimable villages,
//! ruins, enemy cities (by level), visible enemy units, threatened own cities and the frontier,
//! steps priced by terrain and roads, once per decision and player. A walking land unit's move
//! score then adds `field * dphi`, dphi = the field's gain in tiles (phi(to) - phi(here)) / 2,
//! after the gate that rules out moves without progress toward goal(), like `front`: the score
//! is continuous in field. A small field re-ranks moves by a few points; once field * dphi
//! exceeds 1 - open.move a move goal() rules out scores above 0, and once it exceeds the move
//! base (greedy move, about 25) the field outweighs goal()'s single nearest target. Default 0
//! (off): no field is built and every score keeps its bits.
use crate::actions::{apply_action, legal_actions};
use crate::bot::{cached_goal, find_unit, noise, score_with, GoalCache, GreedyWeights};
use crate::diplomacy::at_peace;
use crate::grid::{dist, idx};
use crate::data::{build_def, unit_def};
use crate::state::{city_by_id, income, tech_cost};
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
    /// share of a move's progress measured in road-aware travel cost (0 = off, 1 = all)
    pub roads: f64,
    /// break peace in the endgame at this ratio of our cities to the partner's (0 = never)
    pub break_peace: f64,
    /// weight of the economy plan's advantage on research and economy builds (0 = off)
    pub plan: f64,
    /// saving: a purchase that would leave us unable to afford next turn's best purchase loses
    /// `reserve` times that purchase's score (0 = off)
    pub reserve: f64,
    /// half-width of a zero-mean random term on every move (0 = off)
    pub move_noise: f64,
    /// bonus per own neighbouring unit fewer at the target than now (0 = off)
    pub spread: f64,
    /// score per tile of the value-iteration field's progress, added after the move gate like
    /// front (0 = off)
    /// [EMAI RL 2.0 p.107: value iteration on a gridworld]
    pub field: f64,
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
        roads: 0.0,
        break_peace: 0.0,
        plan: 0.0,
        reserve: 0.0,
        move_noise: 0.0,
        spread: 0.0,
        field: 0.0,
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
    for (key, slot) in [("centre", &mut w.centre), ("defend", &mut w.defend), ("defendRadius", &mut w.defend_radius), ("techUse", &mut w.tech_use), ("techUseless", &mut w.tech_useless), ("front", &mut w.front), ("roads", &mut w.roads), ("breakPeace", &mut w.break_peace), ("plan", &mut w.plan), ("reserve", &mut w.reserve), ("moveNoise", &mut w.move_noise), ("spread", &mut w.spread), ("field", &mut w.field)] {
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
    let tiles = (dist(u.x, u.y, g.x, g.y) - dist(to.x, to.y, g.x, g.y)) as f64;
    let gain = if w.roads == 0.0 {
        tiles
    } else {
        let (from, at) = road_dist(s, u.owner, g, Coord::new(u.x, u.y), to);
        tiles + w.roads * ((from - at) - tiles)
    };
    let unjam = if w.move_noise == 0.0 && w.spread == 0.0 {
        0.0
    } else {
        let k = u.id as i64 * 7907 + to.x as i64 * 131 + to.y as i64;
        let z = w.move_noise * (2.0 * noise(s, k) - 1.0);
        let crowd = |c: Coord| s.units.iter().filter(|o| o.owner == u.owner && o.id != u.id && dist(o.x, o.y, c.x, c.y) <= 1).count() as f64;
        let thin = if w.spread == 0.0 { 0.0 } else { w.spread * (crowd(Coord::new(u.x, u.y)) - crowd(to)) };
        z + thin
    };
    if gain <= 0.0 {
        // ruled out unless the unjamming terms make a sideways step worth it
        let side = gain + unjam;
        return if unjam != 0.0 && side > 0.0 { side } else { -1.0 };
    }
    let to_centre = centre_dist(s.map_size, Coord::new(u.x, u.y)) - centre_dist(s.map_size, to);
    w.greedy.move_ + gain + w.centre * to_centre + w.greedy.noise * noise(s, u.id as i64 * 13 + to.x as i64 + to.y as i64) + unjam
}

thread_local! {
    /// the last road-distance map: (owner, goal, road tiles) -> half-steps from every tile to the goal
    static ROAD_MAP: std::cell::RefCell<(i32, Coord, Vec<bool>, Vec<u32>)> = std::cell::RefCell::new((-1, Coord::new(-1, -1), Vec::new(), Vec::new()));
}

/// road-aware distances (in tiles, roads count half) to `goal` from `a` and from `b`: a Dijkstra
/// over Chebyshev neighbours from the goal, cached until the owner, the goal or the roads change
fn road_dist(s: &GameState, owner: i32, goal: Coord, a: Coord, b: Coord) -> (f64, f64) {
    let n = s.map_size;
    let road: Vec<bool> = s
        .tiles
        .iter()
        .map(|t| {
            (t.road || t.building == Some(Build::Bridge) || t.village || t.city_id.is_some()) && {
                let o = city_by_id(s, t.territory).map(|i| s.cities[i].owner);
                o.is_none() || crate::diplomacy::friendly(s, owner, o)
            }
        })
        .collect();
    ROAD_MAP.with(|m| {
        let mut m = m.borrow_mut();
        if !(m.0 == owner && m.1 == goal && m.2 == road) {
            let mut d = vec![u32::MAX; (n * n) as usize];
            let mut heap = std::collections::BinaryHeap::new();
            let gi = idx(n, goal.x, goal.y);
            d[gi] = 0;
            heap.push(std::cmp::Reverse((0u32, gi)));
            while let Some(std::cmp::Reverse((c, i))) = heap.pop() {
                if c > d[i] {
                    continue;
                }
                let (x, y) = ((i as i32) % n, (i as i32) / n);
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        let (nx, ny) = (x + dx, y + dy);
                        if (dx == 0 && dy == 0) || nx < 0 || ny < 0 || nx >= n || ny >= n {
                            continue;
                        }
                        let j = idx(n, nx, ny);
                        let nc = c + if road[i] && road[j] { 1 } else { 2 };
                        if nc < d[j] {
                            d[j] = nc;
                            heap.push(std::cmp::Reverse((nc, j)));
                        }
                    }
                }
            }
            *m = (owner, goal, road, d);
        }
        (m.3[idx(n, a.x, a.y)] as f64 / 2.0, m.3[idx(n, b.x, b.y)] as f64 / 2.0)
    })
}

/// break peace with `partner` now: every other living player is a peace partner too (nobody left to
/// fight) and we hold at least break_peace times the partner's cities
fn endgame_break(s: &GameState, partner: i32, w: &FullWeights) -> bool {
    if w.break_peace <= 0.0 {
        return false;
    }
    let me = s.current;
    let rivals_at_war = s.players.iter().any(|q| q.alive && q.id != me && !at_peace(s, me, q.id));
    if rivals_at_war {
        return false;
    }
    let cities = |o: i32| s.cities.iter().filter(|c| c.owner == o).count() as f64;
    cities(me) >= w.break_peace * cities(partner)
}

/// our city on (x, y) when an enemy unit we know of is within `radius` tiles of it
pub(crate) fn threatened_city_at(s: &GameState, owner: i32, x: i32, y: i32, radius: i32) -> bool {
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

/// the value-field term of a walking unit's move: field per tile of the field's progress
/// [EMAI RL 2.0 p.107: value iteration on a gridworld]
fn field_term(s: &GameState, unit: Id, to: Coord, w: &FullWeights, cache: &mut Option<GoalCache>) -> f64 {
    w.field * crate::value_field::field_dphi(s, find_unit(s, unit), to, cache)
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
    let out = match *a {
        Action::Move { unit, to } => {
            let out = score + defend_term(s, unit, to, w) + front_term(s, unit, to, w);
            // the value field (issue #76), after the gate like front: field 0 keeps the bits
            if w.field != 0.0 && crate::value_field::walks(find_unit(s, unit)) {
                out + field_term(s, unit, to, w, cache)
            } else {
                out
            }
        }
        Action::Research { tech } => score + research_term(s, tech, w),
        Action::BreakPeace { player } if endgame_break(s, player, w) => 100.0,
        _ => score,
    };
    // guarded: with plan 0 (or an advantage of 0) the score keeps its exact bits
    if w.plan != 0.0 && crate::econ_plan::is_purchase(a) {
        let adv = crate::econ_plan::advantage(s, a, w, cache);
        if adv != 0.0 {
            return out + w.plan * adv;
        }
    }
    out
}

/// the stars an action spends: research, train, build and upgrade (0 for everything else)
fn purchase_cost(s: &GameState, a: &Action) -> i32 {
    match *a {
        Action::Research { tech } => tech_cost(s, s.current, tech),
        Action::Train { unit, .. } => unit_def(unit).cost,
        Action::Upgrade { to, .. } => unit_def(to).cost,
        Action::Build { building, .. } if building != Build::Embassy => build_def(building).cost,
        _ => 0,
    }
}

/// the saving plan: the best purchase we cannot afford now but could next turn (stars + income),
/// as (its cost, its score). legal_actions only lists affordable actions, so they are listed on a
/// copy of the state that holds next turn's stars.
fn reserve_reference(s: &GameState, w: &FullWeights, stars: i32, next: i32) -> Option<(i32, f64)> {
    let mut later = s.clone();
    later.players[s.current as usize].stars = next;
    let mut cache: Option<GoalCache> = Some(GoalCache::default());
    let mut best: Option<(i32, f64)> = None;
    for a in legal_actions(&later) {
        let cost = purchase_cost(&later, &a);
        if cost <= stars || cost > next {
            continue;
        }
        let sc = score_full_with(&later, &a, w, &mut cache);
        if sc > 0.0 && best.is_none_or(|(_, b)| sc > b) {
            best = Some((cost, sc));
        }
    }
    best
}

/// botFull.ts fullBotStep
pub fn full_bot_step(s: &GameState, w: &FullWeights) -> Action {
    full_best_of(s, &legal_actions(s), w)
}

/// the choice of full_bot_step among `actions` (the legal actions of `s`, in order).
/// goal() is cached per unit for this call: it is a pure function of the unchanged state.
pub fn full_best_of(s: &GameState, actions: &[Action], w: &FullWeights) -> Action {
    let mut best = Action::EndTurn;
    let mut best_score = 0.0f64;
    let mut cache: Option<GoalCache> = Some(GoalCache::default());
    // saving (reserve): only when something affordable would be bought at all
    let stars = s.players[s.current as usize].stars;
    let next = stars + income(s, s.current);
    let saving = if w.reserve > 0.0 && actions.iter().any(|a| purchase_cost(s, a) > 0) {
        reserve_reference(s, w, stars, next)
    } else {
        None
    };
    for a in actions {
        if *a == Action::EndTurn {
            continue;
        }
        let mut sc = score_full_with(s, a, w, &mut cache);
        if let Some((ref_cost, ref_score)) = saving {
            let cost = purchase_cost(s, a);
            // spending that leaves next turn's stars short of the planned purchase, on something worth less
            if cost > 0 && sc > 0.0 && sc < ref_score && next - cost < ref_cost {
                sc -= w.reserve * ref_score;
            }
        }
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
    use crate::bot::tests::{from_bits, guarded, opinion_dependent};

    /// the champion's raw weights JSON (models/greedy-full-front)
    pub(crate) fn champion_json() -> serde_json::Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../models/greedy-full-front/model.json");
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        v["full"].clone()
    }

    /// a seeded 4-player 16x16 drylands domination game, as the trainer starts it
    pub(crate) fn test_game(seed: i64) -> GameState {
        crate::state::create_game(&crate::state::NewGameOptions {
            map_size: Some(16),
            players: 4,
            mode: GameMode::Domination,
            difficulty: None,
            seed,
            humans: Some(vec![]),
            map_type: Some(crate::mapgen::MapType::Drylands),
            clans: None,
            turn_limit: None,
        })
        .unwrap()
    }

    /// FNV-1a over the action sequences of `seeds` played with full_bot_step for `rounds` rounds
    pub(crate) fn play_hash(w: &FullWeights, seeds: &[i64], rounds: i32) -> (u64, usize) {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut n = 0;
        for &seed in seeds {
            let mut s = test_game(seed);
            let mut moves = 0;
            while !s.over && s.turn < rounds && moves < 20000 {
                let a = full_bot_step(&s, w);
                for b in format!("{a:?};").bytes() {
                    h ^= b as u64;
                    h = h.wrapping_mul(0x100000001b3);
                }
                apply_action(&mut s, &a).unwrap();
                moves += 1;
            }
            n += moves;
        }
        (h, n)
    }

    /// play_hash of the champion over seeds 11, 22, 33 for 60 rounds, recorded at the base
    /// commit ab56662 before the economy plan existed (0xf413bd635d505e7d, 7009), and again
    /// when the bots' opinions became the game's decompiled model (opinion.rs), and again when a
    /// melee ship that kills a unit on the shore lands there (the advance after a kill)
    const GOLDEN: (u64, usize) = (0x08c73b4fe33151d5, 8092);

    #[test]
    fn plan_off_is_identity() {
        let j = champion_json();
        assert!(j.get("plan").is_none());
        let absent = full_weights(&j).unwrap();
        let mut j0 = j.clone();
        j0["plan"] = serde_json::json!(0);
        let zero = full_weights(&j0).unwrap();
        assert_eq!(default_full_weights().plan, 0.0);
        assert_eq!(absent, zero);
        for w in [&absent, &zero] {
            assert_eq!(play_hash(w, &[11, 22, 33], 60), GOLDEN);
        }
        // the defaults play as before too (plan 0 there as well)
        let d = default_full_weights();
        let mut d0 = d.clone();
        d0.plan = 0.0;
        assert_eq!(play_hash(&d, &[11], 30), play_hash(&d0, &[11], 30));
        // score_full bits on visited states
        let mut s = test_game(11);
        let mut checked = 0;
        while s.turn < 30 {
            for a in legal_actions(&s) {
                assert_eq!(score_full(&s, &a, &absent).to_bits(), score_full(&s, &a, &zero).to_bits());
                checked += 1;
            }
            let a = full_bot_step(&s, &absent);
            apply_action(&mut s, &a).unwrap();
        }
        assert!(checked > 1000);
    }

    #[test]
    fn plan_sim_add_pop_mirrors_engine() {
        use crate::econ_plan::sim_add_pop;
        let base = test_game(5);
        let ci = base.cities.iter().position(|c| c.owner == base.current).unwrap();
        for l in 1..=8 {
            for p in 0..=l {
                for n in 1..=6 {
                    let mut s = base.clone();
                    s.cities[ci].level = l;
                    s.cities[ci].pop = p;
                    s.cities[ci].pending_rewards.clear();
                    crate::state::add_pop(&mut s, ci, n);
                    let (l2, p2, g) = sim_add_pop(l, p, n);
                    let c = &s.cities[ci];
                    assert_eq!((c.level, c.pop), (l2, p2), "L{l} p{p} +{n}");
                    assert_eq!(c.pending_rewards, ((l + 1)..=l2).collect::<Vec<_>>());
                    assert_eq!(g, l2 - l);
                }
            }
        }
    }

    #[test]
    fn plan_constants_from_engine() {
        use crate::econ_plan::*;
        assert_eq!(pi(), 3);
        assert!((2..=4).contains(&pi()));
        assert_eq!(crate::data::REWARD_RESOURCES_STARS, 5);
        assert_eq!(crate::data::REWARD_POP_GROWTH, 3);
        let w = full_weights(&champion_json()).unwrap();
        let mut s = test_game(5);
        let p = s.current;
        let key = PlanKey::new(&w, s.players[p as usize].tribe);
        assert_eq!(key.super_cost, 10);
        let t = PlanTable::solve(key);
        let ci = s.cities.iter().position(|c| c.owner == p).unwrap();
        let cid = s.cities[ci].id;
        // a synthetic non-capital city at every cumulative pop, rewards set as the picks give
        for q in 0..=P_MAX {
            let (l, pop) = level_pop_of(q as i32);
            let mut c = s.cities[ci].clone();
            c.capital = false;
            c.level = l;
            c.pop = pop;
            c.workshop = l >= 2 && reward_pick(&w, 2) == Reward::Workshop;
            c.parks = (5..=l).filter(|&lv| reward_pick(&w, lv) == Reward::Park).count() as i32;
            assert_eq!(t.inc[q], crate::state::city_income(&s, &c), "p {q}");
            assert_eq!(cumulative_pop(l, pop), q as i32);
        }
        // grow the city along the path through the engine: add_pop, then the picked rewards
        {
            let c = &mut s.cities[ci];
            c.capital = false;
            c.level = 1;
            c.pop = 0;
            c.workshop = false;
            c.parks = 0;
            c.pending_rewards.clear();
        }
        let mut q = 0usize;
        let mut steps = 0;
        while q < P_MAX {
            let stars0 = s.players[p as usize].stars;
            let units0: i32 = s.units.iter().filter(|u| u.owner == p).map(|u| crate::data::unit_def(u.ty).cost).sum();
            crate::state::add_pop(&mut s, ci, 1);
            while let Some(&lv) = s.cities[ci].pending_rewards.first() {
                apply_action(&mut s, &Action::Reward { city: cid, reward: reward_pick(&w, lv) }).unwrap();
            }
            let c = &s.cities[ci];
            let q2 = cumulative_pop(c.level, c.pop) as usize;
            assert_eq!(t.next[q], q2.min(P_MAX), "next at p {q}");
            assert_eq!(t.stars_on[q], s.players[p as usize].stars - stars0, "stars at p {q}");
            let units1: i32 = s.units.iter().filter(|u| u.owner == p).map(|u| crate::data::unit_def(u.ty).cost).sum();
            assert_eq!(t.cons_on[q], units1 - units0, "consumption at p {q}");
            assert_eq!(t.inc[q2.min(P_MAX)], crate::state::city_income(&s, &s.cities[ci]));
            q = q2;
            steps += 1;
        }
        // the champion: workshop, resources, population growth, super units; the free pop skips 10, 11
        assert_eq!(t.next[8], 12);
        assert_eq!(t.stars_on[4], 5);
        assert_eq!(t.cons_on[13], 10);
        assert!(steps < P_MAX);
    }

    #[test]
    fn plan_reward_pick_matches_bot() {
        use crate::econ_plan::reward_pick;
        let w = full_weights(&champion_json()).unwrap();
        let want = [(2, Reward::Workshop), (3, Reward::Resources), (4, Reward::PopulationGrowth), (5, Reward::SuperUnit), (6, Reward::SuperUnit)];
        for (lv, r) in want {
            let mut s = test_game(5);
            let ci = s.cities.iter().position(|c| c.owner == s.current).unwrap();
            s.cities[ci].level = lv;
            s.cities[ci].pop = 0;
            s.cities[ci].pending_rewards = vec![lv];
            let pick = full_bot_step(&s, &w);
            assert_eq!(pick, Action::Reward { city: s.cities[ci].id, reward: reward_pick(&w, lv) }, "level {lv}");
            assert_eq!(reward_pick(&w, lv), r);
        }
        // non-positive base weights: the bot scores open * id - 1, and so must the mirror
        for lv in [2, 3, 4, 5] {
            let opts = crate::data::reward_options(lv);
            let mut wn = w.clone();
            wn.greedy.rewards[opts[0] as usize] = Some(-2.0);
            wn.greedy.rewards[opts[1] as usize] = Some(-1.0);
            wn.reward[opts[0] as usize] = 3.0;
            wn.reward[opts[1] as usize] = 1.0;
            let t = full_type_index(&Action::Reward { city: 0, reward: opts[0] }).unwrap();
            wn.open[t] = 1.0;
            let mut s = test_game(5);
            let ci = s.cities.iter().position(|c| c.owner == s.current).unwrap();
            s.cities[ci].level = lv;
            s.cities[ci].pop = 0;
            s.cities[ci].pending_rewards = vec![lv];
            assert_eq!(full_bot_step(&s, &wn), Action::Reward { city: s.cities[ci].id, reward: reward_pick(&wn, lv) }, "negative, level {lv}");
            assert_eq!(reward_pick(&wn, lv), opts[0]);
            // both options at or below 0, the second higher: the bot keeps neither and answers
            // with the first legal action, opts[0] (issue #68 review)
            let mut wz = w.clone();
            wz.greedy.rewards[opts[0] as usize] = Some(-1.0);
            wz.greedy.rewards[opts[1] as usize] = Some(-1.0);
            wz.reward[opts[0] as usize] = 0.5;
            wz.reward[opts[1] as usize] = 1.5;
            wz.open[t] = 0.5;
            assert_eq!(full_bot_step(&s, &wz), Action::Reward { city: s.cities[ci].id, reward: opts[0] }, "non-positive, level {lv}");
            assert_eq!(reward_pick(&wz, lv), opts[0], "non-positive, level {lv}");
        }
    }

    #[test]
    fn plan_table_invariants() {
        use crate::econ_plan::*;
        let w = full_weights(&champion_json()).unwrap();
        let key = PlanKey::new(&w, Tribe::Imperius);
        // the best of three solves: the other tests run in parallel and share the cores
        let mut ms = f64::MAX;
        for _ in 0..3 {
            let t0 = std::time::Instant::now();
            std::hint::black_box(PlanTable::solve(key));
            ms = ms.min(t0.elapsed().as_secs_f64() * 1000.0);
        }
        let t = PlanTable::solve(key);
        eprintln!("plan table solved in {ms:.1} ms");
        if !cfg!(debug_assertions) {
            assert!(ms < 20.0, "solve took {ms} ms");
        }
        for p in 0..=P_MAX {
            for k in 0..=K_MAX {
                for s in 0..=S_MAX {
                    assert_eq!(t.value(0, p, k, s as f64), s as f64);
                }
            }
        }
        for h in 1..=H_MAX {
            for p in 0..=P_MAX {
                for k in 0..=K_MAX {
                    for s in 0..=S_MAX {
                        let v = t.value(h, p, k, s as f64);
                        if s > 0 {
                            assert!(v - t.value(h, p, k, (s - 1) as f64) >= 1.0 - 1e-6, "slope h{h} p{p} k{k} s{s}");
                        }
                        if k > 0 {
                            assert!(v >= t.value(h, p, k - 1, s as f64) - 1e-9, "k h{h} p{p} k{k} s{s}");
                        }
                        assert!(v >= t.value(h - 1, p, k, s as f64) - 1e-9, "h h{h} p{p} k{k} s{s}");
                        assert!(t.lambda(h, p, k, s as f64) >= 1.0 - 1e-9);
                    }
                    if k == 0 {
                        for s in 0..=S_MAX {
                            let want = s as f64 + t.inc[p] as f64 * t.annuity[h];
                            assert!((t.value(h, p, 0, s as f64) - want).abs() < 1e-3, "k=0 h{h} p{p} s{s}");
                            assert!((t.lambda(h, p, 0, s as f64) - 1.0).abs() < 1e-9);
                        }
                    }
                }
            }
        }
        // fractional banks interpolate, and above S_MAX the slope is 1
        let mid = t.value(50, 3, 4, 7.5);
        assert!((mid - (t.value(50, 3, 4, 7.0) + t.value(50, 3, 4, 8.0)) / 2.0).abs() < 1e-9);
        assert_eq!(t.value(50, 3, 4, 40.0), t.value(50, 3, 4, 30.0) + 10.0);
        // stars are worth more than consumption while there are sites to buy
        assert!(t.lambda(50, 0, 4, 3.0) > 1.5, "lambda {}", t.lambda(50, 0, 4, 3.0));
    }

    /// a seeded game whose current player's capital (index, returned) sits at least 2 tiles from
    /// the edge, its territory cleared to bare fields, its units reduced to one spent unit on
    /// the capital (no moves, attacks or training), the given techs and stars
    fn plan_position(techs: &[Tech], stars: i32) -> (GameState, usize) {
        for seed in 1.. {
            let mut s = test_game(seed);
            let p = s.current;
            let ci = s.cities.iter().position(|c| c.owner == p && c.capital).unwrap();
            let (cx, cy, cid) = (s.cities[ci].x, s.cities[ci].y, s.cities[ci].id);
            let n = s.map_size;
            if cx < 2 || cy < 2 || cx > n - 3 || cy > n - 3 {
                continue;
            }
            for (i, t) in s.tiles.iter_mut().enumerate() {
                let (x, y) = (i as i32 % n, i as i32 / n);
                if t.territory == Some(cid) && (x, y) != (cx, cy) {
                    t.terrain = Terrain::Field;
                    t.resource = None;
                    t.building = None;
                    t.building_level = 0;
                    t.road = false;
                    t.village = false;
                    t.ruin = false;
                }
            }
            let keep = s.units.iter().position(|u| u.owner == p).unwrap();
            let mut u = s.units[keep].clone();
            s.units.retain(|x| x.owner != p);
            u.x = cx;
            u.y = cy;
            u.done = true;
            u.moved = true;
            u.attacked = true;
            u.hp = u.max_hp;
            s.units.push(u);
            s.players[p as usize].techs = techs.to_vec();
            s.players[p as usize].stars = stars;
            return (s, ci);
        }
        unreachable!()
    }

    fn set_tile(s: &mut GameState, x: i32, y: i32, terrain: Terrain, resource: Option<Resource>, building: Option<Build>, level: i32) {
        let n = s.map_size;
        let t = &mut s.tiles[crate::grid::idx(n, x, y)];
        t.terrain = terrain;
        t.resource = resource;
        t.building = building;
        t.building_level = level;
    }

    #[test]
    fn plan_constructed_positions() {
        use crate::econ_plan::*;
        let w0 = full_weights(&champion_json()).unwrap();
        let mut w1 = w0.clone();
        w1.plan = 1.0;
        let build = |x: i32, y: i32, b: Build| Action::Build { at: Coord::new(x, y), building: b };

        // (a) a forge next to 2 own mines, stars below richAt: off it waits, on it builds
        let (mut s, ci) = plan_position(&Tech::ALL, 10);
        let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
        set_tile(&mut s, cx + 1, cy - 1, Terrain::Mountain, None, Some(Build::Mine), 0);
        set_tile(&mut s, cx + 1, cy + 1, Terrain::Mountain, None, Some(Build::Mine), 0);
        assert!((s.players[s.current as usize].stars as f64) <= w0.greedy.rich_at);
        let forge = build(cx + 1, cy, Build::Forge);
        assert!(legal_actions(&s).contains(&forge));
        let ctx = PlanCtx::new(&s, &w1);
        let a_forge = ctx.advantage(&s, &forge);
        eprintln!("(a) forge A {a_forge:.3} lambda {:.3} [p,k] {:?}", ctx.lambda, ctx.cities.iter().map(|c| (c.p, c.k)).collect::<Vec<_>>());
        assert!(a_forge > 0.0);
        let off = full_bot_step(&s, &w0);
        assert!(matches!(off, Action::EndTurn | Action::Build { building: Build::Road, .. }), "plan 0 picked {off:?}");
        let on = full_bot_step(&s, &w1);
        assert!(matches!(on, Action::Build { building: Build::Forge, .. }), "plan 1 picked {on:?}");
        assert_eq!(on, forge, "the forge next to both mines");

        // (b) a lumber hut that completes a level-up beats one in a city 3 pop short
        let (mut s, ci) = plan_position(&[Tech::Hunting, Tech::Forestry], 10);
        let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
        set_tile(&mut s, cx + 1, cy, Terrain::Forest, None, None, 0);
        let hut = build(cx + 1, cy, Build::LumberHut);
        assert!(legal_actions(&s).contains(&hut));
        s.cities[ci].level = 2;
        s.cities[ci].pop = 2;
        let a_done = PlanCtx::new(&s, &w1).advantage(&s, &hut);
        s.cities[ci].pop = 0;
        let a_short = PlanCtx::new(&s, &w1).advantage(&s, &hut);
        eprintln!("(b) lumber hut A completing {a_done:.3}, 3 short {a_short:.3}");
        // the hut is the city's only site: finishing level 3 pays +1 star a round and Resources
        // (clearly positive: a round's delay costs about a star); 3 pop short it finishes
        // nothing (minus a round's interest on its cost)
        assert!(a_done > 0.5 && a_short < 0.0, "{a_done} {a_short}");
        // with 3 more sites the city could finish the level without the hut: then the hut
        // saves only a generic purchase, about lambda * (PI - cost), and the level is not its own
        for (dx, dy) in [(-1, 0), (0, -1), (0, 1)] {
            set_tile(&mut s, cx + dx, cy + dy, Terrain::Forest, None, None, 0);
        }
        s.cities[ci].pop = 2;
        let ctx = PlanCtx::new(&s, &w1);
        let a_sub = ctx.advantage(&s, &hut);
        eprintln!("(b) with 3 more forest sites: A {a_sub:.3} k {}", ctx.cities[0].k);
        assert!(a_sub < a_done && a_sub.abs() < 0.15);

        // (c) a tech that opens nothing is slightly negative; one that opens 2 fruit tiles positive
        let (mut s, ci) = plan_position(&[], 8);
        let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
        set_tile(&mut s, cx - 1, cy, Terrain::Field, Some(Resource::Fruit), None, 0);
        set_tile(&mut s, cx, cy - 1, Terrain::Field, Some(Resource::Fruit), None, 0);
        let ctx = PlanCtx::new(&s, &w1);
        let a_riding = ctx.advantage(&s, &Action::Research { tech: Tech::Riding });
        let a_org = ctx.advantage(&s, &Action::Research { tech: Tech::Organization });
        eprintln!("(c) research A riding {a_riding:.3}, organization (2 fruit) {a_org:.3}");
        assert!(a_riding < 0.0 && a_riding.abs() < 1.0);
        assert!(a_org > 0.0);
        assert_eq!(ctx.cities[0].tech_k[Tech::Organization as usize], 2);

        // (d) a farm in city X next to a windmill in city Y: the windmill's level goes to Y
        let (mut s, ci) = plan_position(&[Tech::Organization, Tech::Farming], 10);
        let p = s.current;
        let (cx, cy, xid) = (s.cities[ci].x, s.cities[ci].y, s.cities[ci].id);
        let yi = s.cities.iter().position(|c| c.owner != p).unwrap();
        s.cities[yi].owner = p;
        s.cities[yi].capital = false;
        let yid = s.cities[yi].id;
        set_tile(&mut s, cx + 1, cy, Terrain::Field, Some(Resource::Crop), None, 0);
        set_tile(&mut s, cx + 2, cy, Terrain::Field, None, Some(Build::Windmill), 0);
        let n = s.map_size;
        s.tiles[crate::grid::idx(n, cx + 2, cy)].territory = Some(yid);
        let farm = build(cx + 1, cy, Build::Farm);
        assert!(legal_actions(&s).contains(&farm));
        let ctx = PlanCtx::new(&s, &w1);
        let cr = ctx.build_credits(&s, Build::Farm, Coord::new(cx + 1, cy));
        let named: Vec<(Id, i32, i32)> = cr.e[..cr.n].iter().map(|&(c, d, u)| (ctx.cities[c].id, d, u)).collect();
        assert_eq!(named, vec![(xid, 2, 2), (yid, 1, 0)]);
        // X's supply is the farm's own 2 pop: the windmill's level goes to Y (issue #68 review)
        assert_eq!(ctx.cities.iter().find(|c| c.id == xid).unwrap().k, 2);
        let cum = |s: &GameState, id: Id| {
            let c = s.cities.iter().find(|c| c.id == id).unwrap();
            cumulative_pop(c.level, c.pop)
        };
        let (x0, y0) = (cum(&s, xid), cum(&s, yid));
        let mut after = s.clone();
        apply_action(&mut after, &farm).unwrap();
        assert_eq!((cum(&after, xid) - x0, cum(&after, yid) - y0), (2, 1));

        // (e) a market's gain is the income it adds
        let (mut s, ci) = plan_position(&[Tech::Riding, Tech::Roads, Tech::Trade], 10);
        let p = s.current;
        let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
        set_tile(&mut s, cx + 1, cy - 1, Terrain::Field, None, Some(Build::Forge), 2);
        set_tile(&mut s, cx + 1, cy + 1, Terrain::Field, None, Some(Build::Sawmill), 1);
        let market = build(cx + 1, cy, Build::Market);
        assert!(legal_actions(&s).contains(&market));
        let ctx = PlanCtx::new(&s, &w1);
        let gain = ctx.market_gain(&s, Coord::new(cx + 1, cy));
        let before = crate::state::income(&s, p);
        let mut after = s.clone();
        apply_action(&mut after, &market).unwrap();
        assert_eq!(gain, crate::state::income(&after, p) - before);
        assert_eq!(gain, 3);
        let a_market = ctx.advantage(&s, &market);
        eprintln!("(e) market gain {gain} A {a_market:.3} M {:.3}", ctx.m);
        assert!(a_market > 0.0);

        // (g) a lumber hut that raises a sawmill next to a market, and a windmill next to a market,
        // add the market income the engine pays (city at level 5: no level-up on the way)
        let (mut s, ci) = plan_position(&Tech::ALL, 10);
        let p = s.current;
        let (cx, cy, cid) = (s.cities[ci].x, s.cities[ci].y, s.cities[ci].id);
        s.cities[ci].level = 5;
        s.cities[ci].pop = 0;
        let n = s.map_size;
        {
            let t = &mut s.tiles[crate::grid::idx(n, cx + 2, cy + 2)];
            t.territory = Some(cid);
            t.village = false;
            t.ruin = false;
            t.lighthouse = false;
            t.city_id = None;
        }
        s.units.retain(|u| (u.x, u.y) != (cx + 2, cy + 2));
        set_tile(&mut s, cx + 1, cy, Terrain::Field, None, Some(Build::Market), 0);
        set_tile(&mut s, cx + 1, cy + 1, Terrain::Field, None, Some(Build::Sawmill), 1);
        set_tile(&mut s, cx, cy + 1, Terrain::Forest, None, Some(Build::LumberHut), 0);
        set_tile(&mut s, cx, cy - 1, Terrain::Field, None, Some(Build::Farm), 0);
        set_tile(&mut s, cx + 2, cy + 2, Terrain::Forest, None, None, 0);
        set_tile(&mut s, cx + 1, cy - 1, Terrain::Field, None, None, 0);
        let ctx = PlanCtx::new(&s, &w1);
        for act in [build(cx + 2, cy + 2, Build::LumberHut), build(cx + 1, cy - 1, Build::Windmill)] {
            assert!(legal_actions(&s).contains(&act), "{act:?}");
            let Action::Build { at, building } = act else { unreachable!() };
            let md = ctx.market_delta(&s, building, at);
            let mut after = s.clone();
            apply_action(&mut after, &act).unwrap();
            let lv = |s: &GameState| s.cities[ci].level;
            assert_eq!(lv(&after), lv(&s));
            let d_income = crate::state::income(&after, p) - crate::state::income(&s, p);
            eprintln!("(g) {building:?}: market delta {md}, income +{d_income}, A {:.3}", ctx.advantage(&s, &act));
            assert_eq!((md, d_income), (1, 1));
        }


        // (h) Aquarion builds windmills on water (can_build_on's extra terrain): a site for it
        let mut ks = Vec::new();
        for (tribe, water) in [(Tribe::Aquarion, true), (Tribe::Aquarion, false), (Tribe::Imperius, true)] {
            let (mut s, ci) = plan_position(&[Tech::Construction], 10);
            let p = s.current;
            s.players[p as usize].tribe = tribe;
            let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
            set_tile(&mut s, cx + 1, cy, Terrain::Field, Some(Resource::Crop), Some(Build::Farm), 0);
            for (dx, dy) in [(0, -1), (0, 1), (1, -1)] {
                set_tile(&mut s, cx + dx, cy + dy, Terrain::Mountain, None, None, 0);
            }
            set_tile(&mut s, cx + 1, cy + 1, if water { Terrain::Water } else { Terrain::Mountain }, None, None, 0);
            s.tiles[crate::grid::idx(s.map_size, cx + 1, cy + 1)].ice = false;
            let mill = build(cx + 1, cy + 1, Build::Windmill);
            let legal = legal_actions(&s).contains(&mill);
            let k = PlanCtx::new(&s, &w1).cities[0].k;
            eprintln!("(h) {tribe:?} water {water}: windmill legal {legal}, k {k}");
            assert_eq!(legal, k == 1, "{tribe:?} {water}");
            ks.push(k);
        }
        assert_eq!(ks, vec![1, 0, 0]);

        // (i) a captured city with pop -1: the pop only repays the deficit (+1 income, no level)
        let (mut s, ci) = plan_position(&[Tech::Organization], 10);
        let p = s.current;
        let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
        set_tile(&mut s, cx - 1, cy, Terrain::Field, Some(Resource::Fruit), None, 0);
        s.cities[ci].level = 4;
        s.cities[ci].pop = -1;
        let fruit = build(cx - 1, cy, Build::HarvestFruit);
        assert!(legal_actions(&s).contains(&fruit));
        let ctx = PlanCtx::new(&s, &w1);
        assert_eq!((ctx.cities[0].p, ctx.cities[0].deficit), (cumulative_pop(4, 0) as usize, 1));
        let a_fruit = ctx.advantage(&s, &fruit);
        let want = (1.0 - GAMMA) * (ctx.m - ctx.lambda * crate::data::build_def(Build::HarvestFruit).cost as f64);
        eprintln!("(i) fruit in a city at pop -1: A {a_fruit:.4}, want {want:.4}");
        assert!((a_fruit - want).abs() < 1e-9);
        let mut after = s.clone();
        apply_action(&mut after, &fruit).unwrap();
        let (c0, c1) = (&s.cities[ci], &after.cities[ci]);
        assert_eq!((c1.level, c1.pop, c1.pending_rewards.len()), (4, 0, 0));
        assert_eq!(crate::state::city_income(&after, c1) - crate::state::city_income(&s, c0), 1);
        let _ = p;

        // (j) Trade with a level-3 sawmill beside a free tile: the market it opens is priced
        let mut a_trade = Vec::new();
        for with_mill in [true, false] {
            let (mut s, ci) = plan_position(&[Tech::Riding, Tech::Roads], 10);
            let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
            if with_mill {
                set_tile(&mut s, cx + 1, cy + 1, Terrain::Field, None, Some(Build::Sawmill), 3);
            }
            let ctx = PlanCtx::new(&s, &w1);
            assert_eq!(ctx.cities[0].market, if with_mill { 3 } else { 0 });
            let a = ctx.advantage(&s, &Action::Research { tech: Tech::Trade });
            a_trade.push((a, ctx.m, ctx.lambda));
        }
        let ((a1, m, l), (a0, _, l0)) = (a_trade[0], a_trade[1]);
        eprintln!("(j) Trade A with a level-3 sawmill {a1:.3}, without {a0:.3}");
        assert_eq!(l, l0);
        assert!(a0 < 0.0 && a1 > 0.0);
        assert!((a1 - a0 - (1.0 - GAMMA) * (m * 3.0 - l * crate::data::build_def(Build::Market).cost as f64)).abs() < 1e-9);

        // (k) ports and outposts are not priced (their value is naval access)
        for b in [Build::Port, Build::Outpost] {
            let a = build(cx, cy, b);
            assert!(!is_purchase(&a) && !priced_build(b));
            assert_eq!(PlanCtx::new(&s, &w1).advantage(&s, &a), 0.0);
        }

        // (f) every advantage within the cap; non-purchase actions keep their bits at plan 4
        let mut w4 = w0.clone();
        w4.plan = 4.0;
        let (mut checked, mut priced) = (0, 0);
        for seed in [7, 8] {
            let mut s = test_game(seed);
            let mut moves = 0;
            while !s.over && s.turn < 50 && moves < 20000 {
                let legal = legal_actions(&s);
                let ctx = PlanCtx::new(&s, &w4);
                let mut c0: Option<crate::bot::GoalCache> = Some(Default::default());
                let mut c4: Option<crate::bot::GoalCache> = Some(Default::default());
                for a in &legal {
                    let adv = ctx.advantage(&s, a);
                    assert!(adv.abs() <= PLAN_A_CAP);
                    let (s0, s4) = (score_full_with(&s, a, &w0, &mut c0), score_full_with(&s, a, &w4, &mut c4));
                    if is_purchase(a) {
                        priced += 1;
                        assert_eq!(s4.to_bits(), if adv != 0.0 { (s0 + 4.0 * adv).to_bits() } else { s0.to_bits() });
                    } else {
                        assert_eq!(adv, 0.0);
                        assert_eq!(s0.to_bits(), s4.to_bits(), "{a:?}");
                    }
                    checked += 1;
                }
                let a = full_best_of(&s, &legal, &w4);
                apply_action(&mut s, &a).unwrap();
                moves += 1;
            }
        }
        assert!(checked > 10000 && priced > 1000, "{checked} {priced}");
    }

    #[test]
    fn plan_json() {
        let w = full_weights(&serde_json::json!({"plan": 0.5})).unwrap();
        assert_eq!(w.plan, 0.5);
        assert!(full_weights(&serde_json::json!({"plan": "x"})).is_err());
        assert_eq!(full_weights(&serde_json::json!({})).unwrap().plan, 0.0);
    }

    /// decisions per second at plan 1 within +30% of plan 0: on the same recorded states (the
    /// scoring cost alone) and on-policy (whole games)
    #[test]
    fn plan_speed() {
        let w0 = full_weights(&champion_json()).unwrap();
        let mut w1 = w0.clone();
        w1.plan = 1.0;
        let seeds = [11, 22, 33];
        let mut states = Vec::new();
        for &seed in &seeds {
            let mut s = test_game(seed);
            while !s.over && s.turn < 60 {
                states.push(s.clone());
                let a = full_bot_step(&s, &w0);
                apply_action(&mut s, &a).unwrap();
            }
        }
        let time = |w: &FullWeights| {
            let t = std::time::Instant::now();
            let mut k = 0usize;
            for s in &states {
                k += matches!(full_bot_step(s, w), Action::EndTurn) as usize;
            }
            std::hint::black_box(k);
            t.elapsed().as_secs_f64()
        };
        let _ = time(&w1); // the table
        let (mut t0, mut t1) = (f64::MAX, f64::MAX);
        for _ in 0..5 {
            t0 = t0.min(time(&w0));
            t1 = t1.min(time(&w1));
        }
        let on_policy = |w: &FullWeights| {
            let t = std::time::Instant::now();
            let (_, n) = play_hash(w, &seeds, 60);
            n as f64 / t.elapsed().as_secs_f64()
        };
        let (mut r0, mut r1) = (0.0f64, 0.0f64);
        for _ in 0..3 {
            r0 = r0.max(on_policy(&w0));
            r1 = r1.max(on_policy(&w1));
        }
        eprintln!(
            "plan speed: same {} states {:.1} ms at plan 0, {:.1} ms at plan 1 ({:+.1}%); on-policy {:.0} vs {:.0} decisions/s ({:+.1}% time)",
            states.len(),
            t0 * 1e3,
            t1 * 1e3,
            (t1 / t0 - 1.0) * 100.0,
            r0,
            r1,
            (r0 / r1 - 1.0) * 100.0
        );
        if !cfg!(debug_assertions) {
            assert!(t1 <= 1.3 * t0, "plan 1 scoring {:.1}% slower", (t1 / t0 - 1.0) * 100.0);
            assert!(r1 * 1.3 >= r0, "plan 1 games {:.1}% slower", (r0 / r1 - 1.0) * 100.0);
        }
    }

    /// a short label of an action for the flip table
    fn kind(a: &Action) -> String {
        match *a {
            Action::EndTurn => "endTurn".into(),
            Action::Build { building, .. } => building.id().into(),
            Action::Research { .. } => "research".into(),
            _ => FULL_ACTION_TYPES[full_type_index(a).unwrap()].into(),
        }
    }

    /// on-policy flip count: games played at plan = x, each decision compared with the plan-0
    /// argmax on the same state. The primary number is flips per 1000 decisions; also printed:
    /// the share of decisions whose legal actions include a priced purchase (A != 0), the flips
    /// per such decision, and the advantage distribution of the priced candidates (with the
    /// share at the cap). POLY_PLAN_VALUES, POLY_PLAN_SEEDS (count), POLY_PLAN_ROUNDS,
    /// POLY_PLAN_SHOW (extra flip kinds to print an example of).
    #[test]
    #[ignore]
    fn plan_fire_rate() {
        use crate::econ_plan::{is_purchase, PlanCtx, PLAN_A_CAP};
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
        let values: Vec<f64> = env("POLY_PLAN_VALUES", "0.5,1,2,4").split(',').map(|x| x.parse().unwrap()).collect();
        let games: i64 = env("POLY_PLAN_SEEDS", "6").parse().unwrap();
        let rounds: i32 = env("POLY_PLAN_ROUNDS", "100").parse().unwrap();
        let w0 = full_weights(&champion_json()).unwrap();
        for &x in &values {
            let mut wx = w0.clone();
            wx.plan = x;
            let (mut decisions, mut priced, mut flips, mut research_flips) = (0usize, 0usize, 0usize, 0usize);
            // advantages of the priced candidates: pop builds, markets, research
            let mut advs: [Vec<f64>; 3] = Default::default();
            let mut kinds = std::collections::BTreeMap::<String, usize>::new();
            let mut examples = Vec::new();
            // the largest advantage of each class, with its state
            let mut top: [(f64, String); 3] = Default::default();
            for g in 0..games {
                let mut s = test_game(1000 + g);
                let mut moves = 0;
                while !s.over && s.turn < rounds && moves < 20000 {
                    let legal = legal_actions(&s);
                    let ax = full_best_of(&s, &legal, &wx);
                    let a0 = full_best_of(&s, &legal, &w0);
                    decisions += 1;
                    let ctx = PlanCtx::new(&s, &wx);
                    let mut any = false;
                    for a in &legal {
                        if !is_purchase(a) {
                            continue;
                        }
                        let adv = ctx.advantage(&s, a);
                        if adv == 0.0 {
                            continue;
                        }
                        any = true;
                        let cls = match *a {
                            Action::Research { .. } => 2,
                            Action::Build { building: Build::Market, .. } => 1,
                            _ => 0,
                        };
                        advs[cls].push(adv);
                        if adv > top[cls].0 {
                            top[cls] = (adv, format!(
                                "game {g} turn {} p{} stars {} cities {} lambda {:.3} M {:.2} [p,k,market]={:?}: {a:?}",
                                s.turn,
                                s.current,
                                s.players[s.current as usize].stars,
                                ctx.cities.len(),
                                ctx.lambda,
                                ctx.m,
                                ctx.cities.iter().map(|c| (c.p, c.k, c.market)).collect::<Vec<_>>()
                            ));
                        }
                    }
                    priced += any as usize;
                    if ax != a0 {
                        flips += 1;
                        research_flips += (matches!(a0, Action::Research { .. }) || matches!(ax, Action::Research { .. })) as usize;
                        let fk = format!("{}->{}", kind(&a0), kind(&ax));
                        *kinds.entry(fk.clone()).or_default() += 1;
                        if s.turn >= 5 && !examples.iter().any(|(k, _)| *k == fk) {
                            let pl = &s.players[s.current as usize];
                            let desc = |a: &Action| {
                                let b = score_full(&s, a, &w0);
                                let adv = if is_purchase(a) { ctx.advantage(&s, a) } else { 0.0 };
                                format!("{a:?} base {b:.2} A {adv:.3} term {:.2} total {:.2}", x * adv, b + x * adv)
                            };
                            examples.push((fk, format!(
                                "game {g} turn {} p{} {:?} stars {} cities {} lambda {:.3} sbar {:.1} M {:.2} [p,k,deficit]={:?}: plan0 {} | plan{x} {}",
                                s.turn,
                                s.current,
                                pl.tribe,
                                pl.stars,
                                ctx.cities.len(),
                                ctx.lambda,
                                ctx.sbar,
                                ctx.m,
                                ctx.cities.iter().map(|c| (c.p, c.k, c.deficit)).collect::<Vec<_>>(),
                                desc(&a0),
                                desc(&ax)
                            )));
                        }
                    }
                    apply_action(&mut s, &ax).unwrap();
                    moves += 1;
                }
            }
            eprintln!(
                "plan {x}: {flips} flips in {decisions} decisions = {:.1} per 1000 decisions; {priced} decisions ({:.1}%) have a priced purchase, {:.2}% of those flip; research in {:.0}% of the flips",
                flips as f64 * 1000.0 / decisions as f64,
                priced as f64 * 100.0 / decisions.max(1) as f64,
                flips as f64 * 100.0 / priced.max(1) as f64,
                research_flips as f64 * 100.0 / flips.max(1) as f64
            );
            for (name, v) in ["pop builds", "markets", "research"].iter().zip(advs.iter_mut()) {
                if v.is_empty() {
                    continue;
                }
                v.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let q = |f: f64| v[((v.len() - 1) as f64 * f) as usize];
                let share = |f: &dyn Fn(f64) -> bool| v.iter().filter(|&&a| f(a)).count() as f64 * 100.0 / v.len() as f64;
                eprintln!(
                    "  A {name}: n {}, min {:.3} p10 {:.3} p50 {:.3} p90 {:.3} max {:.3}; > 0 {:.1}%, |A| >= 0.5 {:.1}%, at the cap {:.2}%",
                    v.len(),
                    v[0],
                    q(0.1),
                    q(0.5),
                    q(0.9),
                    v[v.len() - 1],
                    share(&|a| a > 0.0),
                    share(&|a| a.abs() >= 0.5),
                    share(&|a| a.abs() >= PLAN_A_CAP - 1e-9)
                );
            }
            for (name, (v, d)) in ["pop build", "market", "research"].iter().zip(top.iter()) {
                eprintln!("  largest A {name} {v:.3}: {d}");
            }
            let mut kv: Vec<_> = kinds.into_iter().collect();
            kv.sort_by(|a, b| b.1.cmp(&a.1));
            eprintln!("  flips: {:?}", &kv[..kv.len().min(14)]);
            let show = env("POLY_PLAN_SHOW", "");
            for (k, _) in kv.iter().take(5).chain(kv.iter().filter(|(k, _)| show.split(',').any(|x| x == k))) {
                if let Some((_, e)) = examples.iter().find(|(fk, _)| fk == k) {
                    eprintln!("  e.g. {k}: {e}");
                }
            }
        }
    }

    /// skill step 3 on real positions: a recorded game (data/games, gunzipped, POLY_PLAN_GAME),
    /// the champion's weights in the seat POLY_PLAN_SEAT (default: the winner) at the start of
    /// the rounds POLY_PLAN_AT. Prints every priced purchase (base score, A, the term at each of
    /// POLY_PLAN_VALUES) and the argmax at plan 0 against each value, then plays the rest of
    /// that turn with the plan-0 champion and counts the changed picks. Last, over every stored
    /// turn start of every seat, the changed picks per 1000.
    #[test]
    #[ignore]
    fn plan_replay_sanity() {
        use crate::econ_plan::{is_purchase, PlanCtx};
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.into());
        let Ok(path) = std::env::var("POLY_PLAN_GAME") else {
            eprintln!("POLY_PLAN_GAME not set: skipped");
            return;
        };
        let rec: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let values: Vec<f64> = env("POLY_PLAN_VALUES", "1,2,4,8").split(',').map(|x| x.parse().unwrap()).collect();
        let at: Vec<i32> = env("POLY_PLAN_AT", "5,15,30,45").split(',').map(|x| x.parse().unwrap()).collect();
        let seat: i32 = env("POLY_PLAN_SEAT", &rec["result"]["winner"].as_i64().unwrap_or(0).to_string()).parse().unwrap();
        // records of older engines may hold states this one cannot read (e.g. fractional hp)
        let stored = rec["turnStates"].as_array().unwrap();
        let states: Vec<GameState> = stored.iter().filter_map(|v| crate::json::state_from_json(v).ok()).collect();
        eprintln!("game {} seats {} seat {seat} ({} turn states, {} unreadable)", rec["id"], rec["seats"], states.len(), stored.len() - states.len());
        let w0 = full_weights(&champion_json()).unwrap();
        let wv: Vec<FullWeights> = values.iter().map(|&x| FullWeights { plan: x, ..w0.clone() }).collect();
        for &r in &at {
            let Some(s0) = states.iter().find(|s| s.turn == r && s.current == seat) else {
                eprintln!("\nround {r}: no turn start of seat {seat}");
                continue;
            };
            let ctx = PlanCtx::new(s0, &wv[0]);
            let pl = &s0.players[seat as usize];
            eprintln!(
                "\nround {r}: {:?} stars {} income {} cities {} h {} lambda {:.3} sbar {:.2} M {:.2} [p,k,deficit,market]={:?}",
                pl.tribe,
                pl.stars,
                crate::state::income(s0, seat),
                ctx.cities.len(),
                ctx.h,
                ctx.lambda,
                ctx.sbar,
                ctx.m,
                ctx.cities.iter().map(|c| (c.p, c.k, c.deficit, c.market)).collect::<Vec<_>>()
            );
            let legal = legal_actions(s0);
            let mut rows: Vec<(f64, String)> = Vec::new();
            for a in legal.iter().filter(|a| is_purchase(a)) {
                let base = score_full(s0, a, &w0);
                let adv = ctx.advantage(s0, a);
                let terms: Vec<String> = values.iter().map(|x| format!("{:+.2}", x * adv)).collect();
                rows.push((adv, format!("  {a:?}: base {base:.2} A {adv:+.3} term@{values:?} [{}]", terms.join(" "))));
            }
            rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
            for (_, l) in &rows {
                eprintln!("{l}");
            }
            let a0 = full_bot_step(s0, &w0);
            for (x, w) in values.iter().zip(&wv) {
                let ax = full_bot_step(s0, w);
                eprintln!("  argmax plan 0 {a0:?} | plan {x} {ax:?}{}", if ax != a0 { "  CHANGED" } else { "" });
            }
            // the rest of the turn with the plan-0 champion
            let mut s = s0.clone();
            let mut changed = vec![0usize; values.len()];
            let mut n = 0;
            while !s.over && s.current == seat && n < 400 {
                let legal = legal_actions(&s);
                let a0 = full_best_of(&s, &legal, &w0);
                for (i, w) in wv.iter().enumerate() {
                    let ax = full_best_of(&s, &legal, w);
                    if ax != a0 {
                        changed[i] += 1;
                        if i == values.len() / 2 {
                            eprintln!("    step {n}: plan 0 {} -> plan {} {}", kind(&a0), values[i], kind(&ax));
                        }
                    }
                }
                apply_action(&mut s, &a0).unwrap();
                n += 1;
            }
            eprintln!("  rest of the turn: {n} decisions, changed at {values:?}: {changed:?}");
        }
        let mut changed = vec![0usize; values.len()];
        for s in &states {
            if s.over {
                continue;
            }
            let legal = legal_actions(s);
            let a0 = full_best_of(s, &legal, &w0);
            for (i, w) in wv.iter().enumerate() {
                changed[i] += (full_best_of(s, &legal, w) != a0) as usize;
            }
        }
        eprintln!(
            "\nall {} turn starts: changed picks per 1000 at {values:?}: {:?}",
            states.len(),
            changed.iter().map(|&c| format!("{:.0}", c as f64 * 1000.0 / states.len() as f64)).collect::<Vec<_>>()
        );
    }

    // ---- value field (issue #76) ----

    /// the current champion's raw weights JSON (models/greedy-full-combo: plan 2, moveNoise 2)
    fn combo_json() -> serde_json::Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../models/greedy-full-combo/model.json");
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        v["full"].clone()
    }

    /// play_hash of greedy-full-combo over seeds 11, 22, 33 for 60 rounds, recorded on dev
    /// (before the merge of #143) without the value field, re-recorded when a melee ship that kills on the shore lands there and when an upgraded Raft
    /// may attack in the turn of the upgrade; re-record it when the engine's rules change
    const COMBO_GOLDEN: (u64, usize) = (0xdf3852a243d606fb, 8715);

    /// the states full_bot_step visits on `seed` below `rounds` with `w`
    fn visited(seed: i64, rounds: i32, w: &FullWeights) -> Vec<GameState> {
        let mut s = test_game(seed);
        let mut out = Vec::new();
        let mut moves = 0;
        while !s.over && s.turn < rounds && moves < 20000 {
            out.push(s.clone());
            let a = full_bot_step(&s, w);
            apply_action(&mut s, &a).unwrap();
            moves += 1;
        }
        out
    }

    fn with_field(w: &FullWeights, x: f64) -> FullWeights {
        FullWeights { field: x, ..w.clone() }
    }

    #[test]
    fn field_off_is_identity() {
        assert_eq!(default_full_weights().field, 0.0);
        for (j, golden) in [(champion_json(), GOLDEN), (combo_json(), COMBO_GOLDEN)] {
            assert!(j.get("field").is_none());
            let absent = full_weights(&j).unwrap();
            let mut j0 = j.clone();
            j0["field"] = serde_json::json!(0);
            let zero = full_weights(&j0).unwrap();
            assert_eq!(absent, zero);
            for w in [&absent, &zero] {
                assert_eq!(play_hash(w, &[11, 22, 33], 60), golden);
            }
        }
        // score_full bits on visited states
        let absent = full_weights(&combo_json()).unwrap();
        let zero = with_field(&absent, 0.0);
        let mut checked = 0;
        for s in visited(11, 30, &absent) {
            for a in legal_actions(&s) {
                assert_eq!(score_full(&s, &a, &absent).to_bits(), score_full(&s, &a, &zero).to_bits());
                checked += 1;
            }
        }
        assert!(checked > 1000);
    }

    /// the lecture's backup, literally, in gamma space: R = gamma^(-B/2) (0 for no reward), the
    /// step factor gamma^(c/2), V_0 = R, V_{k+1}(i) = max(R(i), max_j f_ij V_k(j)), FIELD_K backups
    fn lab_value_iteration(b: &crate::value_field::FieldBoard) -> Vec<f64> {
        use crate::value_field::{FIELD_GAMMA, FIELD_K, UNREACH};
        let g = FIELD_GAMMA;
        let r: Vec<f64> = b.b.iter().map(|&x| if x > UNREACH { g.powf(-(x as f64) / 2.0) } else { 0.0 }).collect();
        let mut v = r.clone();
        for _ in 0..FIELD_K {
            let mut nv = vec![0.0; v.len()];
            for i in 0..v.len() {
                if !b.pass(i) {
                    nv[i] = r[i];
                    continue;
                }
                let mut best = r[i];
                b.neighbours(i, |j| best = best.max(g.powf(b.cost(i, j) as f64 / 2.0) * v[j]));
                nv[i] = best;
            }
            v = nv;
        }
        v
    }

    /// multi-source Dijkstra: max over targets g of B(g) - path cost, paths through passable
    /// tiles (the target itself may be impassable), the value of an impassable tile is its B
    fn field_dijkstra(b: &crate::value_field::FieldBoard) -> Vec<i32> {
        use crate::value_field::UNREACH;
        let mut val = b.b.clone();
        let mut heap = std::collections::BinaryHeap::new();
        for (i, &v) in val.iter().enumerate() {
            if v > UNREACH {
                heap.push((v, i));
            }
        }
        while let Some((v, j)) = heap.pop() {
            if v < val[j] {
                continue;
            }
            b.neighbours(j, |i| {
                if b.pass(i) {
                    let c = v - b.cost(i, j);
                    if c > val[i] {
                        val[i] = c;
                        heap.push((c, i));
                    }
                }
            });
        }
        val
    }

    /// test 4's board: seed 11, every tile a bare explored field, no cities; one player-0 warrior
    /// at (8,8), a village at (5,8) and a level-3 player-1 city at (12,8)
    fn field_board() -> GameState {
        let mut s = test_game(11);
        let n = s.map_size;
        let city = s.cities.iter().find(|c| c.owner == 1).unwrap().clone();
        for t in s.tiles.iter_mut() {
            *t = Tile::new(Terrain::Field);
        }
        s.cities.clear();
        for e in s.players[0].explored.iter_mut() {
            *e = 1;
        }
        s.players[0].techs.clear();
        s.players[0].stars = 0;
        let keep = s.units.iter().position(|u| u.owner == 0).unwrap();
        let mut u = s.units[keep].clone();
        u.ty = UnitType::Warrior;
        (u.x, u.y) = (8, 8);
        (u.moved, u.attacked, u.done, u.frozen, u.hidden, u.can_move, u.can_attack) = (false, false, false, false, false, true, true);
        u.body_of = None;
        u.carried = None;
        s.units = vec![u];
        s.current = 0;
        s.tiles[idx(n, 5, 8)].village = true;
        let mut c = city;
        (c.x, c.y, c.level) = (12, 8, 3);
        s.tiles[idx(n, 12, 8)].city_id = Some(c.id);
        s.cities.push(c);
        s
    }

    fn mv(s: &GameState, x: i32, y: i32) -> Action {
        Action::Move { unit: s.units[0].id, to: Coord::new(x, y) }
    }

    /// the hand boards of tests 4-6 (positions, for the solver tests)
    fn field_hand_boards() -> Vec<GameState> {
        let mut out = vec![field_board()];
        let n = 16;
        for terrain in [Terrain::Water, Terrain::Mountain] {
            let mut s = field_board();
            let c = s.cities.pop().unwrap();
            s.tiles[idx(n, 12, 8)].city_id = None;
            let _ = c;
            s.tiles[idx(n, 5, 8)].village = false;
            s.tiles[idx(n, 8, 4)].village = true;
            for x in 7..=9 {
                for y in 5..=6 {
                    s.tiles[idx(n, x, y)].terrain = terrain;
                }
            }
            out.push(s.clone());
            s.players[0].explored[idx(n, 10, 6)] = 0;
            out.push(s);
        }
        let mut s = field_board();
        let mut o = s.units[0].clone();
        o.id = s.next_id;
        s.next_id += 1;
        (o.x, o.y) = (5, 8);
        s.units.push(o);
        out.push(s);
        out
    }

    #[test]
    fn field_matches_lab_value_iteration() {
        use crate::value_field::{FieldBoard, FieldMap, FIELD_GAMMA, UNREACH};
        let w = full_weights(&combo_json()).unwrap();
        let mut states = visited(11, 30, &w);
        states.extend(field_hand_boards());
        let mut tiles = 0;
        for s in &states {
            let b = FieldBoard::new(s, s.current);
            let f = FieldMap::new(s, s.current);
            let v = lab_value_iteration(&b);
            for i in 0..v.len() {
                assert_eq!(f.phi()[i] == UNREACH, v[i] == 0.0, "tile {i}");
                if v[i] > 0.0 {
                    let lv = v[i].ln() / (1.0 / FIELD_GAMMA).ln();
                    assert!((lv - f.phi()[i] as f64 / 2.0).abs() < 1e-9, "tile {i}: lab {lv} log form {}", f.phi()[i] as f64 / 2.0);
                }
                tiles += 1;
            }
        }
        eprintln!("field = lab value iteration on {} states, {tiles} tiles", states.len());
    }

    #[test]
    fn field_solver_matches_dijkstra() {
        use crate::value_field::{FieldBoard, FIELD_K};
        let w = full_weights(&combo_json()).unwrap();
        let mut states = visited(11, 30, &w);
        states.extend(visited(22, 60, &w).into_iter().step_by(7));
        let hand = field_hand_boards();
        let n_hand = hand.len();
        states.extend(hand);
        let (mut converged, mut iters) = (0, Vec::new());
        for (k, s) in states.iter().enumerate() {
            let b = FieldBoard::new(s, s.current);
            let (phi, it) = b.solve();
            iters.push(it);
            if it < FIELD_K {
                converged += 1;
                assert_eq!(phi, field_dijkstra(&b), "state {k}");
            } else {
                assert!(k < states.len() - n_hand, "a hand board did not converge");
            }
        }
        iters.sort();
        eprintln!(
            "field solver: {converged} of {} states converged (= Dijkstra); backups median {} max {}",
            states.len(),
            iters[iters.len() / 2],
            iters[iters.len() - 1]
        );
        assert!(converged * 10 >= states.len() * 9);
    }

    /// the required hand position: goal() pulls to the near village (3 tiles, worth 3), the field
    /// to the far level-3 city (4 tiles, worth 5): phi(8,8) = max(6-6, 10-8) = 2, east phi 4 (+1),
    /// west phi 2 (0). The score is continuous in field: east gains exactly field * 1, west keeps
    /// its bits, and the pick turns east once field passes the gap goal()'s pull opens.
    #[test]
    fn field_far_rich_beats_near_poor() {
        use crate::value_field::FieldMap;
        let s = field_board();
        let n = s.map_size;
        let mut w = default_full_weights();
        (w.greedy.noise, w.centre, w.move_noise, w.front) = (0.0, 0.0, 0.0, 0.0);
        let f = FieldMap::new(&s, 0);
        let phi = |x: i32, y: i32| f.phi()[idx(n, x, y)];
        assert_eq!((phi(8, 8), phi(9, 8), phi(7, 8)), (2, 4, 2));
        let u = &s.units[0];
        assert_eq!(f.dphi(&s, u, Coord::new(9, 8)), 1.0);
        assert_eq!(f.dphi(&s, u, Coord::new(7, 8)), 0.0);
        let (west, east) = (mv(&s, 7, 8), mv(&s, 9, 8));
        let legal = legal_actions(&s);
        assert!(legal.contains(&west) && legal.contains(&east));
        let sc = |x: f64, a: &Action| score_full(&s, a, &with_field(&w, x));
        let (we0, ea0) = (sc(0.0, &west), sc(0.0, &east));
        eprintln!("field 0: west {we0} east {ea0}");
        assert!(we0 > 0.0 && ea0 <= 0.0);
        for x in [0.01, 0.1, 1.0, 4.0, 16.0] {
            assert!((sc(x, &east) - ea0 - x).abs() < 1e-9, "field {x}");
            assert_eq!(sc(x, &west).to_bits(), we0.to_bits(), "field {x}");
        }
        // the bot's pick: west below the crossing field we0 - ea0, east above it (diagonals tie
        // with the straight step)
        let to_x = |x: f64| match full_bot_step(&s, &with_field(&w, x)) {
            Action::Move { to, .. } => to.x,
            a => panic!("picked {a:?}"),
        };
        let cross = we0 - ea0;
        for (x, want) in [(0.0, 7), (0.01, 7), (cross - 0.5, 7), (cross + 0.5, 9)] {
            assert_eq!(to_x(x), want, "field {x}");
        }
    }

    #[test]
    fn field_routes_around_water() {
        use crate::value_field::{FieldBoard, FieldMap, UNREACH};
        let boards = field_hand_boards();
        let n = 16;
        // boards 1 and 3: the lake, the mountain block (no Climbing); 2 and 4 with (10,6) in fog
        for k in [1, 3] {
            let s = &boards[k];
            let f = FieldMap::new(s, 0);
            let phi = |x: i32, y: i32| f.phi()[idx(n, x, y)];
            assert_eq!((phi(8, 8), phi(8, 7), phi(9, 7)), (-4, -4, -2), "board {k}");
            let u = &s.units[0];
            assert_eq!(f.dphi(s, u, Coord::new(8, 7)), 0.0);
            assert_eq!(f.dphi(s, u, Coord::new(9, 7)), 1.0);
            // goal() says +1 for the step north
            assert_eq!(crate::bot::goal(s, u), Some(Coord::new(8, 4)));
        }
        for k in [2, 4] {
            let s = &boards[k];
            let b = FieldBoard::new(s, 0);
            let f = FieldMap::new(s, 0);
            let fog = idx(n, 10, 6);
            assert!(!b.pass(fog));
            assert_eq!(f.phi()[fog], UNREACH);
            // every value comes over explored tiles only: the Dijkstra on the passable graph
            assert_eq!(f.phi(), &field_dijkstra(&b)[..]);
            // the fog's neighbours are frontier now (0 tiles beats the village's -2 there)
            assert_eq!(f.phi()[idx(n, 9, 7)], 0);
        }
    }

    #[test]
    fn field_own_occupied() {
        use crate::value_field::{FieldBoard, FieldMap, UNREACH};
        let s = field_hand_boards().pop().unwrap();
        let n = s.map_size;
        let vil = idx(n, 5, 8);
        assert_eq!(FieldBoard::new(&s, 0).b[vil], UNREACH);
        // the first unit sees the city-only field: the same as without the village
        let mut city_only = field_board();
        city_only.tiles[vil].village = false;
        let f = FieldMap::new(&s, 0);
        assert_eq!(f.phi(), FieldMap::new(&city_only, 0).phi());
        assert_eq!(f.phi()[idx(n, 8, 8)], 2);
        // the occupant holds 6 and every neighbour is worth less
        let occ = s.units[1].clone();
        let mut moves = 0;
        for a in legal_actions(&s) {
            if let Action::Move { unit, to } = a {
                if unit == occ.id {
                    assert!(f.dphi(&s, &occ, to) < 0.0, "{a:?}");
                    moves += 1;
                }
            }
        }
        assert!(moves >= 3, "{moves}");
    }

    #[test]
    fn field_non_walkers_unchanged() {
        let w0 = full_weights(&combo_json()).unwrap();
        let w2 = with_field(&w0, 2.0);
        let mut checked = 0;
        for seed in [11, 22] {
            for s in visited(seed, 60, &w0) {
                for a in legal_actions(&s) {
                    let Action::Move { unit, .. } = a else { continue };
                    if crate::value_field::walks(find_unit(&s, unit)) {
                        continue;
                    }
                    assert_eq!(score_full(&s, &a, &w0).to_bits(), score_full(&s, &a, &w2).to_bits(), "{a:?}");
                    checked += 1;
                }
            }
        }
        eprintln!("field: {checked} moves of non-walking units keep their bits at field 2");
    }

    #[test]
    fn field_cache_matches_fresh() {
        let w2 = with_field(&full_weights(&combo_json()).unwrap(), 2.0);
        let mut checked = 0;
        for s in visited(11, 20, &w2) {
            let mut cache: Option<crate::bot::GoalCache> = Some(Default::default());
            for a in legal_actions(&s) {
                assert_eq!(score_full_with(&s, &a, &w2, &mut cache).to_bits(), score_full(&s, &a, &w2).to_bits(), "{a:?}");
                checked += 1;
            }
        }
        assert!(checked > 1000);
        // the thread's last-board memo returns what a fresh solve returns
        for s in visited(22, 20, &w2) {
            let fresh = crate::value_field::FieldBoard::new(&s, s.current).solve();
            for _ in 0..2 {
                let f = crate::value_field::FieldMap::new(&s, s.current);
                assert_eq!((f.phi().to_vec(), f.iters()), fresh);
            }
        }
        let h = play_hash(&w2, &[11, 22], 40);
        assert_eq!(h, play_hash(&w2, &[11, 22], 40));
        let w = w2.clone();
        assert_eq!(h, std::thread::spawn(move || play_hash(&w, &[11, 22], 40)).join().unwrap());
        assert_ne!(h, play_hash(&with_field(&w2, 0.0), &[11, 22], 40), "field 2 never changed a choice");
    }

    #[test]
    fn field_hidden_algae_creep() {
        use crate::value_field::{walks, FieldBoard, UNREACH};
        let n = 16;
        // a hidden enemy the player cannot see is no reward (and no obstacle); a visible one is
        let mut s = field_board();
        let mut e = s.units[0].clone();
        (e.id, e.owner, e.x, e.y, e.hidden) = (s.next_id, 1, 2, 2, true);
        s.next_id += 1;
        s.units.push(e);
        let at = idx(n, 2, 2);
        assert!(!crate::movement::can_see(&s, 0, &s.units[1]));
        let b = FieldBoard::new(&s, 0);
        assert_eq!(b.b[at], UNREACH);
        assert!(b.pass(at));
        s.units[1].hidden = false;
        let b = FieldBoard::new(&s, 0);
        assert_eq!(b.b[at], 2);
        assert!(!b.pass(at));
        // algae ends a walker's move: a step onto it costs 1.5 tiles, road or not
        let mut s = field_board();
        let (a, j) = (idx(n, 8, 8), idx(n, 9, 8));
        assert_eq!(FieldBoard::new(&s, 0).cost(a, j), 2);
        s.tiles[j].terrain = Terrain::Water;
        s.tiles[j].algae = true;
        let b = FieldBoard::new(&s, 0);
        assert!(b.pass(j));
        assert_eq!(b.cost(a, j), 3);
        // creep units take no road discount and no forest stop: no walkers for the field
        let mut u = s.units[0].clone();
        assert!(walks(&u));
        u.ty = UnitType::Hexapod;
        assert!(crate::movement::has(&u, Skill::Creep) && !walks(&u));
    }

    #[test]
    fn field_json() {
        assert_eq!(full_weights(&serde_json::json!({"field": 0.5})).unwrap().field, 0.5);
        assert!(full_weights(&serde_json::json!({"field": "x"})).is_err());
        assert_eq!(full_weights(&serde_json::json!({})).unwrap().field, 0.0);
    }

    /// decisions on the same recorded states at field 1 against field 0 (best of 5); prints the
    /// overhead (budget +30%), fails only beyond 2x
    #[test]
    fn field_speed() {
        let w0 = full_weights(&combo_json()).unwrap();
        let w1 = with_field(&w0, 1.0);
        let states = visited(11, 60, &w0);
        let time = |w: &FullWeights| {
            let t = std::time::Instant::now();
            let mut k = 0usize;
            for s in &states {
                k += matches!(full_bot_step(s, w), Action::EndTurn) as usize;
            }
            std::hint::black_box(k);
            t.elapsed().as_secs_f64()
        };
        let (mut t0, mut t1) = (f64::MAX, f64::MAX);
        for _ in 0..5 {
            t0 = t0.min(time(&w0));
            t1 = t1.min(time(&w1));
        }
        eprintln!(
            "field speed: {} states {:.1} ms at field 0, {:.1} ms at field 1 ({:+.1}%); {:.0} vs {:.0} us per decision",
            states.len(),
            t0 * 1e3,
            t1 * 1e3,
            (t1 / t0 - 1.0) * 100.0,
            t0 * 1e6 / states.len() as f64,
            t1 * 1e6 / states.len() as f64
        );
        let mut tf = f64::MAX;
        for _ in 0..5 {
            let t = std::time::Instant::now();
            for s in &states {
                std::hint::black_box(crate::value_field::FieldMap::new(s, s.current));
            }
            tf = tf.min(t.elapsed().as_secs_f64());
        }
        let boards: Vec<_> = states.iter().map(|s| crate::value_field::FieldBoard::new(s, s.current)).collect();
        let (mut tb, mut ts) = (f64::MAX, f64::MAX);
        for _ in 0..5 {
            let t = std::time::Instant::now();
            for s in &states {
                std::hint::black_box(crate::value_field::FieldBoard::new(s, s.current));
            }
            tb = tb.min(t.elapsed().as_secs_f64());
            let t = std::time::Instant::now();
            for b in &boards {
                std::hint::black_box(b.solve());
            }
            ts = ts.min(t.elapsed().as_secs_f64());
        }
        let per = |x: f64| x * 1e6 / states.len() as f64;
        eprintln!("field speed: FieldMap::new alone {:.1} us per state (board {:.1}, solve {:.1})", per(tf), per(tb), per(ts));
        // the issue's budget is +30%; under a loaded machine (the full suite, a sweep's workers)
        // the ratio swings by 20 points, so the suite only guards against a gross regression
        if !cfg!(debug_assertions) {
            assert!(t1 <= 2.0 * t0, "field 1 scoring {:.1}% slower", (t1 / t0 - 1.0) * 100.0);
        }
    }

    /// the solver's time per call on 20x20 8-player states (rounds 10, 30, 60 of a combo game)
    #[test]
    #[ignore]
    fn field_solver_time() {
        use crate::value_field::FieldMap;
        let w = full_weights(&combo_json()).unwrap();
        let mut s = crate::state::create_game(&crate::state::NewGameOptions {
            map_size: Some(20),
            players: 8,
            mode: GameMode::Domination,
            difficulty: None,
            seed: 7,
            humans: Some(vec![]),
            map_type: Some(crate::mapgen::MapType::Drylands),
            clans: None,
            turn_limit: None,
        })
        .unwrap();
        for at in [10, 30, 60] {
            while !s.over && s.turn < at {
                let a = full_bot_step(&s, &w);
                apply_action(&mut s, &a).unwrap();
            }
            let reps = 2000;
            let mut best = f64::MAX;
            let mut iters = 0;
            for _ in 0..5 {
                let t = std::time::Instant::now();
                for _ in 0..reps {
                    iters = std::hint::black_box(FieldMap::new(&s, s.current)).iters();
                }
                best = best.min(t.elapsed().as_secs_f64() / reps as f64);
            }
            let (mut tb, mut ts) = (f64::MAX, f64::MAX);
            for _ in 0..5 {
                let t = std::time::Instant::now();
                for _ in 0..reps {
                    std::hint::black_box(crate::value_field::FieldBoard::new(&s, s.current));
                }
                tb = tb.min(t.elapsed().as_secs_f64() / reps as f64);
                let b = crate::value_field::FieldBoard::new(&s, s.current);
                let t = std::time::Instant::now();
                for _ in 0..reps {
                    std::hint::black_box(b.solve());
                }
                ts = ts.min(t.elapsed().as_secs_f64() / reps as f64);
            }
            eprintln!("  board {:.1} us, solve {:.1} us", tb * 1e6, ts * 1e6);
            let t = std::time::Instant::now();
            let reps2 = 200;
            for _ in 0..reps2 {
                std::hint::black_box(full_bot_step(&s, &w));
            }
            let dec = t.elapsed().as_secs_f64() / reps2 as f64;
            eprintln!(
                "20x20, 8 players, round {}: FieldMap::new {:.1} us ({iters} backups, {} units); full_bot_step at field 0 {:.0} us",
                s.turn,
                best * 1e6,
                s.units.len(),
                dec * 1e6
            );
        }
    }

    /// skill step 4 on a real game: POLY_FIELD_GAME (a gunzipped data/games record). Over every
    /// readable turn start, the walking units' moves: dphi range and distribution, scoreFull at
    /// field 0 and 2 for a few, and the argmax flips at field 2 (and POLY_FIELD_VALUES).
    #[test]
    #[ignore]
    fn field_replay_sanity() {
        use crate::value_field::{walks, FieldMap};
        let Ok(path) = std::env::var("POLY_FIELD_GAME") else {
            eprintln!("POLY_FIELD_GAME not set: skipped");
            return;
        };
        let rec: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let stored = rec["turnStates"].as_array().unwrap();
        let states: Vec<GameState> = stored.iter().filter_map(|v| crate::json::state_from_json(v).ok()).collect();
        eprintln!("game {} seats {} ({} turn states, {} unreadable)", rec["id"], rec["seats"], states.len(), stored.len() - states.len());
        let w0 = full_weights(&combo_json()).unwrap();
        let values: Vec<f64> = std::env::var("POLY_FIELD_VALUES").unwrap_or_else(|_| "0.5,1,2,4".into()).split(',').map(|x| x.parse().unwrap()).collect();
        let (mut dmin, mut dmax, mut nz, mut nmoves) = (f64::MAX, f64::MIN, 0usize, 0usize);
        let mut hist = std::collections::BTreeMap::<i32, usize>::new();
        let mut flips = vec![0usize; values.len()];
        let mut decisions = 0;
        let mut shown = 0;
        for s in states.iter().filter(|s| !s.over) {
            let legal = legal_actions(s);
            let f = FieldMap::new(s, s.current);
            for a in &legal {
                let Action::Move { unit, to } = *a else { continue };
                let u = find_unit(s, unit);
                if !walks(u) {
                    continue;
                }
                let d = f.dphi(s, u, to);
                nmoves += 1;
                nz += (d != 0.0) as usize;
                dmin = dmin.min(d);
                dmax = dmax.max(d);
                *hist.entry((d * 2.0) as i32).or_default() += 1;
                if shown < 12 && d != 0.0 && s.turn >= 5 && (to.x + to.y + s.turn) % 9 == 0 {
                    shown += 1;
                    eprintln!(
                        "  round {} p{} {a:?} at ({},{}): dphi {d:+.1}, scoreFull field 0 {:.2}, field 2 {:.2}",
                        s.turn,
                        s.current,
                        u.x,
                        u.y,
                        score_full(s, a, &w0),
                        score_full(s, a, &with_field(&w0, 2.0))
                    );
                }
            }
            let a0 = full_best_of(s, &legal, &w0);
            for (i, &x) in values.iter().enumerate() {
                flips[i] += (full_best_of(s, &legal, &with_field(&w0, x)) != a0) as usize;
            }
            decisions += 1;
        }
        eprintln!(
            "{nmoves} walking moves, {nz} with dphi != 0; dphi range [{dmin}, {dmax}]; histogram (half tiles: count) {hist:?}"
        );
        eprintln!("argmax flips over {decisions} turn starts at field {values:?}: {flips:?}");
    }

    #[test]
    fn type_order_matches_actions() {
        // every Action variant but EndTurn maps to its own FULL_ACTION_TYPES name
        let a = crate::json::action_from_json(&serde_json::json!({"type": "breakPeace", "player": 1})).unwrap();
        assert_eq!(FULL_ACTION_TYPES[full_type_index(&a).unwrap()], "breakPeace");
        assert_eq!(centre_dist(16, Coord::new(3, 3)), 4.5);
    }

    /// reserve: off by default, and when on it only ever turns a purchase into something else
    #[test]
    fn reserve_saves_instead_of_a_cheap_purchase() {
        use crate::state::{create_game, NewGameOptions};
        let off = default_full_weights();
        assert_eq!(off.reserve, 0.0);
        let mut on = off.clone();
        on.reserve = 1.0;
        let (mut steps, mut saved, mut other) = (0, 0, 0);
        for seed in 1..=6 {
            let opts = NewGameOptions { map_size: Some(16), players: 4, mode: GameMode::Domination, difficulty: None, seed, humans: None, map_type: None, clans: None, turn_limit: None };
            let mut s = create_game(&opts).unwrap();
            while !s.over && s.turn < 12 {
                let a0 = full_bot_step(&s, &off);
                let a1 = full_bot_step(&s, &on);
                steps += 1;
                if a0 != a1 {
                    // only a purchase can be given up; the replacement is a free action or the end of the turn
                    assert!(purchase_cost(&s, &a0) > 0, "reserve changed a non-purchase {a0:?} into {a1:?}");
                    let stars = s.players[s.current as usize].stars;
                    let next = stars + income(&s, s.current);
                    eprintln!("  seed {seed} turn {} p{}: stars {stars} income {} | bought {a0:?} (cost {}, score {:.1}) -> {a1:?} | saving for {:?}", s.turn, s.current, next - stars, purchase_cost(&s, &a0), score_full(&s, &a0, &off), reserve_reference(&s, &on, stars, next));
                    if a1 == Action::EndTurn { saved += 1 } else { other += 1 }
                }
                apply_action(&mut s, &a0).unwrap();
            }
        }
        eprintln!("reserve: {steps} steps, {saved} purchases replaced by ending the turn, {other} by another action");
        assert!(saved + other > 0, "reserve never changed a choice");
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
        let mut skipped = 0usize;
        for l in lines {
            let row: serde_json::Value = serde_json::from_str(l).unwrap();
            rows += 1;
            let s = crate::json::state_from_json(&row["state"]).unwrap();
            let legal: Vec<Action> = row["legal"].as_array().unwrap().iter().map(|a| crate::json::action_from_json(a).unwrap()).collect();
            let opinion_row = legal.iter().any(opinion_dependent);
            for (name, w) in &sets {
                let scores = row["scores"][name].as_array().unwrap();
                for (i, a) in legal.iter().enumerate() {
                    if opinion_dependent(a) {
                        skipped += 1;
                        continue;
                    }
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
                if opinion_row {
                    skipped += 1;
                    continue;
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
            "bot_full over {rows} states, {} weight sets: score_full {ok} equal, {bad} different, {gated} gated; choice among TS legal actions {pick_ok} equal, {pick_bad} different; full_bot_step {step_ok} equal, {step_bad} different, {step_gated} gated; {skipped} opinion-dependent scores and choices skipped",
            sets.len()
        );
        assert_eq!(bad, 0);
        assert_eq!(pick_bad, 0);
        assert_eq!(step_bad, 0);
    }
}
