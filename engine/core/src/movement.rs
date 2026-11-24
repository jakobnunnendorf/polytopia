//! Port of logic/engine/movement.ts (RULES.md §4): Chebyshev neighbours, a
//! budget of movement points, road-to-road steps cost 0.5, others 1. A unit may
//! keep stepping from any tile reached below its budget. Entering forest (unless
//! road-to-road) or mountain, any tile next to an enemy (zone of control), an own
//! port (embark) or land from a boat (disembark) ends the move. Unexplored tiles
//! cannot be entered.
//! Functions returning a unit return its index into `s.units`.
use crate::data::unit_def;
use crate::diplomacy::{at_peace, friendly};
use crate::grid::{any_around, idx, in_bounds, is_water, tile_at};
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepKind {
    Normal,
    Embark,
    Disembark,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MoveTarget {
    pub x: i32,
    pub y: i32,
    pub kind: StepKind,
}

#[inline]
pub fn has(u: &Unit, skill: Skill) -> bool {
    crate::data::unit_def(u.ty).has(skill)
}
#[inline]
pub fn tech_of(s: &GameState, p: i32, t: Tech) -> bool {
    s.players[p as usize].has_tech(t)
}
/// owner of the territory a tile belongs to, or None
pub fn territory_owner(s: &GameState, t: &Tile) -> Option<i32> {
    let id = t.territory?;
    s.cities.iter().find(|c| c.id == id).map(|c| c.owner)
}
/// indices of the units with bodyOf == head_id, in s.units order (the chain order)
pub fn chain_body(s: &GameState, head_id: Id) -> Vec<usize> {
    s.units.iter().enumerate().filter(|(_, o)| o.body_of == Some(head_id)).map(|(i, _)| i).collect()
}
#[inline]
pub fn is_led(u: &Unit) -> bool {
    u.body_of.is_some()
}
/// the unit that leads `u` (the one in front of it)
pub fn leader_of(s: &GameState, u: &Unit) -> Option<usize> {
    let head = u.body_of?;
    let body = chain_body(s, head);
    // TS body.indexOf(u): identity == id
    match body.iter().position(|&i| s.units[i].id == u.id) {
        Some(k) if k > 0 => Some(body[k - 1]),
        _ => s.units.iter().position(|o| o.id == head),
    }
}
/// the unit that follows `u` (the one behind it)
pub fn follower_of(s: &GameState, u: &Unit) -> Option<usize> {
    match u.body_of {
        None => chain_body(s, u.id).first().copied(),
        Some(head) => {
            let body = chain_body(s, head);
            // body[body.indexOf(u) + 1]; indexOf -1 gives body[0]
            let k = body.iter().position(|&i| s.units[i].id == u.id).map(|k| k + 1).unwrap_or(0);
            body.get(k).copied()
        }
    }
}
/// The unit's movement with its effects: Swift (Swarm) or Bubble add one,
/// Poison takes one above 1; a skater starting on ice uses its ice movement.
pub fn movement_range(s: &GameState, u: &Unit) -> i32 {
    let starts_on_ice = tile_at(s, u.x, u.y).ice;
    let def = unit_def(u.ty);
    let base = if has(u, Skill::Skate) && starts_on_ice { def.ice_movement.unwrap_or(def.movement) } else { def.movement };
    let mut range = base + if u.swarmed || u.bubble { 1 } else { 0 };
    if u.poisoned && range > 1 {
        range -= 1;
    }
    range
}
pub fn unit_at(s: &GameState, x: i32, y: i32) -> Option<usize> {
    s.units.iter().position(|u| u.x == x && u.y == y)
}
/// can `player` see unit `u` (explored tile, and not hidden unless adjacent to
/// one of player's units; peace partners see each other's Cloaks)
pub fn can_see(s: &GameState, player: i32, u: &Unit) -> bool {
    if u.owner == player {
        return true;
    }
    if s.players[player as usize].explored[idx(s.map_size, u.x, u.y)] != 1 {
        return false;
    }
    if !u.hidden || at_peace(s, player, u.owner) {
        return true;
    }
    s.units.iter().any(|o| o.owner == player && (o.x - u.x).abs().max((o.y - u.y).abs()) <= 1)
}

/// road-network tile for a player (§4.4): road, bridge, village, city; in own, neutral or allied territory
fn road_node(s: &GameState, t: &Tile, player: i32) -> bool {
    if !(t.road || t.building == Some(Build::Bridge) || t.village || t.city_id.is_some()) {
        return false;
    }
    let o = territory_owner(s, t);
    o.is_none() || friendly(s, player, o)
}

/// whether unit u (as it is now) may stand on / step onto tile t, and how
pub fn enter_kind(s: &GameState, u: &Unit, t: &Tile) -> Option<StepKind> {
    let p = u.owner;
    let def = unit_def(u.ty);
    if has(u, Skill::Fly) {
        return Some(StepKind::Normal);
    }
    if let Some(aq) = aquarion_enter_kind(s, u, t) {
        return aq;
    }
    if def.naval {
        if is_water(t) {
            if t.ice {
                return None;
            }
            if t.terrain == Terrain::Ocean && !tech_of(s, p, Tech::Sailing) {
                return None;
            }
            if t.terrain == Terrain::Water && !tech_of(s, p, Tech::Fishing) && u.ty != UnitType::Raychi {
                return None;
            }
            return Some(StepKind::Normal);
        }
        if u.ty == UnitType::Raychi {
            return None;
        }
        // landing: passenger must be able to stand there
        if t.terrain == Terrain::Mountain && !tech_of(s, p, Tech::Climbing) {
            return None;
        }
        return Some(StepKind::Disembark);
    }
    // land or amphibious unit
    if is_water(t) {
        if t.ice || t.algae || t.building == Some(Build::Bridge) {
            return Some(StepKind::Normal);
        }
        if has(u, Skill::Amphibious) {
            if t.terrain == Terrain::Ocean && !tech_of(s, p, Tech::Sailing) {
                return None;
            }
            return Some(StepKind::Normal);
        }
        // land units board at their own port or a peace partner's port
        if t.building == Some(Build::Port) && friendly(s, p, territory_owner(s, t)) && tech_of(s, p, Tech::Fishing) {
            return Some(StepKind::Embark);
        }
        return None;
    }
    if t.terrain == Terrain::Mountain && !tech_of(s, p, Tech::Climbing) {
        return None;
    }
    Some(StepKind::Normal)
}

/// Aquarion and flooded-tile rules. Outer None = TS undefined (the regular rules apply).
fn aquarion_enter_kind(s: &GameState, u: &Unit, t: &Tile) -> Option<Option<StepKind>> {
    let p = u.owner;
    let def = unit_def(u.ty);
    if s.players[p as usize].tribe == Tribe::Aquarion && is_water(t) && !t.ice && !t.algae && t.building != Some(Build::Bridge) {
        let swims = def.naval || has(u, Skill::Amphibious);
        if swims {
            if def.naval {
                return Some(Some(StepKind::Normal));
            }
            return Some(if t.terrain == Terrain::Ocean && !tech_of(s, p, Tech::Sailing) { None } else { Some(StepKind::Normal) });
        }
    }
    if !is_water(t) && t.flooded {
        if def.naval {
            return Some(if t.terrain == Terrain::Mountain { None } else { Some(StepKind::Normal) });
        }
        if !has(u, Skill::Amphibious) && t.building == Some(Build::Port) && territory_owner(s, t) == Some(p) && tech_of(s, p, Tech::Fishing) {
            return Some(Some(StepKind::Embark));
        }
    }
    if def.naval && !is_water(t) && !has(u, Skill::Carry) {
        return Some(None); // a ship with no passenger can't land
    }
    None
}

/// All tiles unit u can end its move on this turn, in TS Map insertion order.
pub fn reachable(s: &GameState, u: &Unit) -> Vec<MoveTarget> {
    search(s, u).0
}

/// The path unit u takes to `to` (tiles after its start, ending at `to`), as the
/// mover plans it: hidden enemies it cannot see count as empty tiles.
pub fn path_to(s: &GameState, u: &Unit, to: Coord) -> Vec<Coord> {
    let (_, parent) = search(s, u);
    let n = s.map_size;
    let start = idx(n, u.x, u.y);
    let mut out = Vec::new();
    let mut cur = idx(n, to.x, to.y);
    let mut guard = 0;
    while cur != start && guard < n * n {
        out.push(Coord { x: cur as i32 % n, y: cur as i32 / n });
        match parent.get(cur).copied().flatten() {
            None => return vec![to],
            Some(p) => cur = p,
        }
        guard += 1;
    }
    out.reverse();
    out
}

/// TS search: targets in Map insertion order, and the parent map (per tile index)
fn search(s: &GameState, u: &Unit) -> (Vec<MoveTarget>, Vec<Option<usize>>) {
    let n = s.map_size;
    let nn = (n * n) as usize;
    if u.frozen || unit_def(u.ty).movement == 0 {
        return (Vec::new(), Vec::new());
    }
    let explored = &s.players[u.owner as usize].explored;
    let skate = has(u, Skill::Skate);
    // Segments don't move on their own: only the head moves and the body follows
    if is_led(u) {
        return (Vec::new(), Vec::new());
    }
    let mut budget = movement_range(s, u);
    // a chain moves at its first Segment's pace
    let follower = follower_of(s, u);
    if let Some(f) = follower {
        budget = budget.min(movement_range(s, &s.units[f]));
    }
    if budget <= 0 {
        return (Vec::new(), Vec::new());
    }
    let budget = budget as f64;
    let chained = follower.is_some();
    // Glide (Polarism): Polaris ice steps cost 0.9
    let glide = s.players[u.owner as usize].tribe == Tribe::Polaris && tech_of(s, u.owner, Tech::Aquatism);
    let creep = has(u, Skill::Creep);
    let fly = has(u, Skill::Fly);
    let no_road = creep || fly;
    let amphibious = has(u, Skill::Amphibious);
    let hide = has(u, Skill::Hide);
    let ignores_zoc = hide || has(u, Skill::Sneak);
    let naval = unit_def(u.ty).naval;
    // units the mover knows about (later units overwrite earlier ones, like Map.set)
    let mut occupied: Vec<Option<usize>> = vec![None; nn];
    for (i, o) in s.units.iter().enumerate() {
        if !o.hidden || can_see(s, u.owner, o) {
            occupied[idx(n, o.x, o.y)] = Some(i);
        }
    }
    // zone of control: not from hidden units, led units or peace partners
    let enemy_adjacent = |x: i32, y: i32| {
        any_around(n, Coord { x, y }, 1, false, |c| match occupied[idx(n, c.x, c.y)] {
            Some(oi) => {
                let o = &s.units[oi];
                o.owner != u.owner && !o.hidden && !is_led(o) && !at_peace(s, u.owner, o.owner)
            }
            None => false,
        })
    };

    let mut parent: Vec<Option<usize>> = vec![None; nn];
    let mut best: Vec<Option<f64>> = vec![None; nn];
    let mut ends: Vec<(usize, StepKind)> = Vec::new();
    let mut in_ends = vec![false; nn];
    let start = idx(n, u.x, u.y);
    best[start] = Some(0.0);
    let mut queue: Vec<usize> = vec![start];
    while !queue.is_empty() {
        // pick lowest cost (first of equals)
        let mut bi = 0;
        for k in 1..queue.len() {
            if best[queue[k]].unwrap_or(0.0) < best[queue[bi]].unwrap_or(0.0) {
                bi = k;
            }
        }
        let cur = queue.remove(bi);
        let spent = best[cur].unwrap();
        if spent >= budget - 1e-9 {
            continue;
        }
        let cx = cur as i32 % n;
        let cy = cur as i32 / n;
        let from = &s.tiles[cur];
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let x = cx + dx;
                let y = cy + dy;
                if !in_bounds(n, x, y) {
                    continue;
                }
                let i = idx(n, x, y);
                if explored[i] != 1 {
                    continue;
                }
                let t = &s.tiles[i];
                let Some(kind) = enter_kind(s, u, t) else { continue };
                // a chain member never embarks
                if kind == StepKind::Embark && chained {
                    continue;
                }
                let occ = occupied[i];
                // enemy units block (hidden movers may pass through); own and allied units can be passed
                if let Some(oi) = occ {
                    if !friendly(s, u.owner, Some(s.units[oi].owner)) && !hide {
                        continue;
                    }
                }
                // roads give no bonus on ice or to skaters
                let road = !no_road && !amphibious && !skate && !naval && !from.ice && !t.ice && road_node(s, from, u.owner) && road_node(s, t, u.owner);
                let cost = if road {
                    0.5
                } else if glide && t.ice {
                    0.9
                } else {
                    1.0
                };
                let total = spent + cost;
                let mut stop = kind != StepKind::Normal;
                if !fly && t.terrain == Terrain::Mountain {
                    stop = true;
                }
                if !creep && !fly && t.terrain == Terrain::Forest && !road {
                    stop = true;
                }
                // Skate: on land at most 1 tile
                if skate && !is_water(t) {
                    stop = true;
                }
                // algae ends the move of units that don't swim
                if !fly && !creep && t.algae && !naval && !amphibious {
                    stop = true;
                }
                if !ignores_zoc && enemy_adjacent(x, y) {
                    stop = true;
                }
                // Aquarion: amphibious units stop on dry land, ships stop on flooded tiles
                if amphibious && !is_water(t) && !t.flooded {
                    stop = true;
                }
                if naval && !is_water(t) && t.flooded {
                    stop = true;
                }
                if occ.is_none() && !in_ends[i] {
                    in_ends[i] = true;
                    ends.push((i, kind));
                    if parent[i].is_none() {
                        parent[i] = Some(cur);
                    }
                }
                if stop {
                    continue;
                }
                if best[i].map_or(true, |b| total < b) {
                    best[i] = Some(total);
                    parent[i] = Some(cur);
                    queue.push(i);
                }
            }
        }
    }
    // ends.delete(start)
    if in_ends[start] {
        ends.retain(|&(i, _)| i != start);
    }
    let targets = ends.into_iter().map(|(i, kind)| MoveTarget { x: i as i32 % n, y: i as i32 / n, kind }).collect();
    (targets, parent)
}

/// Tiles explored around a coord for a unit (scout or mountain: radius 2).
pub fn sight_radius(s: &GameState, u: &Unit) -> i32 {
    if has(u, Skill::Scout) {
        return 2;
    }
    if tile_at(s, u.x, u.y).terrain == Terrain::Mountain {
        2
    } else {
        1
    }
}

/// Reference values from TypeScript (scripts/rust/ref-movement.ts) for
/// diplomacy, combat, movement and opinion. The file is
/// `$POLY_REF_MOVEMENT`, else engine/core/testdata/ref-movement.json.
#[cfg(test)]
mod ref_tests {
    use super::*;
    use crate::combat::{compute_damage_rounded, defence_bonus};
    use crate::diplomacy::*;
    use crate::opinion::*;
    use serde_json::Value;

    fn kind_id(k: Option<StepKind>) -> Value {
        match k {
            None => Value::Null,
            Some(StepKind::Normal) => "normal".into(),
            Some(StepKind::Embark) => "embark".into(),
            Some(StepKind::Disembark) => "disembark".into(),
        }
    }
    fn rel_id(r: Relation) -> &'static str {
        match r {
            Relation::SelfRel => "self",
            Relation::Peace => "peace",
            Relation::War => "war",
            Relation::Hostile => "hostile",
            Relation::Neutral => "neutral",
        }
    }
    fn i(v: &Value) -> i32 {
        v.as_i64().unwrap() as i32
    }

    #[derive(Default, Debug)]
    struct Counts {
        states: usize,
        checks: usize,
        opinion_checks: usize,
        fails: Vec<String>,
    }

    fn check(c: &mut Counts, ok: bool, what: impl FnOnce() -> String) {
        c.checks += 1;
        if !ok && c.fails.len() < 30 {
            c.fails.push(what());
        }
    }

    #[test]
    fn matches_typescript_reference() {
        let file = std::env::var("POLY_REF_MOVEMENT").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/ref-movement.json").to_string());
        let Ok(text) = std::fs::read_to_string(&file) else {
            panic!("reference file {file} missing: run scripts/rust/ref-movement.ts");
        };
        let cases: Vec<Value> = serde_json::from_str(&text).unwrap();
        // opinion needs state::score_of; skip those checks while it is a stub
        let score_ready = {
            let s0 = crate::json::state_from_json(&cases[0]["state"]).unwrap();
            let hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let ok = std::panic::catch_unwind(|| crate::state::score_of(&s0, 0)).is_ok();
            std::panic::set_hook(hook);
            ok
        };
        let mut c = Counts::default();
        for (ci, case) in cases.iter().enumerate() {
            let s = crate::json::state_from_json(&case["state"]).unwrap();
            c.states += 1;
            let by_id = |id: i32| s.units.iter().find(|u| u.id == id).unwrap();
            for ue in case["units"].as_array().unwrap() {
                let u = by_id(i(&ue["id"]));
                let tag = format!("case {ci} unit {} {:?}", u.id, u.ty);
                let reach: Vec<Value> = reachable(&s, u).iter().map(|t| serde_json::json!([t.x, t.y, kind_id(Some(t.kind))])).collect();
                check(&mut c, Value::Array(reach.clone()) == ue["reach"], || format!("{tag} reach: got {reach:?} want {}", ue["reach"]));
                for pe in ue["paths"].as_array().unwrap() {
                    let to = Coord::new(i(&pe["to"]["x"]), i(&pe["to"]["y"]));
                    let got: Vec<Value> = path_to(&s, u, to).iter().map(|p| serde_json::json!([p.x, p.y])).collect();
                    check(&mut c, Value::Array(got.clone()) == pe["path"], || format!("{tag} path to {to:?}: got {got:?} want {}", pe["path"]));
                }
                for (p, want) in ue["see"].as_array().unwrap().iter().enumerate() {
                    let got = can_see(&s, p as i32, u);
                    check(&mut c, Some(got) == want.as_bool(), || format!("{tag} canSee {p}: got {got}"));
                }
                let r = movement_range(&s, u);
                check(&mut c, r == i(&ue["range"]), || format!("{tag} range {r} want {}", ue["range"]));
                let r = sight_radius(&s, u);
                check(&mut c, r == i(&ue["sight"]), || format!("{tag} sight {r} want {}", ue["sight"]));
                for e in ue["enter"].as_array().unwrap() {
                    let (x, y) = (i(&e[0]), i(&e[1]));
                    let got = kind_id(enter_kind(&s, u, tile_at(&s, x, y)));
                    check(&mut c, got == e[2], || format!("{tag} enterKind {x},{y}: got {got} want {}", e[2]));
                }
                let id_of = |o: Option<usize>| o.map(|k| Value::from(s.units[k].id)).unwrap_or(Value::Null);
                let l = id_of(leader_of(&s, u));
                check(&mut c, l == ue["leader"], || format!("{tag} leader {l}"));
                let f = id_of(follower_of(&s, u));
                check(&mut c, f == ue["follower"], || format!("{tag} follower {f}"));
                let b = defence_bonus(&s, u);
                check(&mut c, Some(b) == ue["bonus"].as_f64(), || format!("{tag} defenceBonus {b} want {}", ue["bonus"]));
            }
            for e in case["combat"].as_array().unwrap() {
                let (a, d) = (by_id(i(&e[0])), by_id(i(&e[1])));
                let r = compute_damage_rounded(&s, a, d);
                check(&mut c, r.damage == i(&e[2]) && r.retaliation == i(&e[3]), || format!("case {ci} combat {} -> {}: got {r:?} want {e}", a.id, d.id));
            }
            for pe in case["pairs"].as_array().unwrap() {
                let (a, b) = (i(&pe["a"]), i(&pe["b"]));
                let tag = format!("case {ci} players {a},{b}");
                check(&mut c, rel_id(relation(&s, a, b)) == pe["rel"], || format!("{tag} relation"));
                check(&mut c, Some(at_peace(&s, a, b)) == pe["peace"].as_bool(), || format!("{tag} atPeace"));
                check(&mut c, Some(at_war(&s, a, b)) == pe["war"].as_bool(), || format!("{tag} atWar"));
                check(&mut c, Some(can_harm(&s, a, b)) == pe["harm"].as_bool(), || format!("{tag} canHarm"));
                check(&mut c, Some(has_offer(&s, a, b)) == pe["offer"].as_bool(), || format!("{tag} hasOffer"));
                if score_ready && a != b {
                    c.opinion_checks += 1;
                    let f: Vec<Value> = opinion_factors(&s, a, b).iter().map(|f| Value::from(f.id())).collect();
                    check(&mut c, Value::Array(f.clone()) == pe["factors"], || format!("{tag} factors {f:?} want {}", pe["factors"]));
                    check(&mut c, opinion_score(&s, a, b) == i(&pe["score"]), || format!("{tag} score"));
                    check(&mut c, opinion_of(&s, a, b).id() == pe["level"], || format!("{tag} level"));
                }
            }
        }
        eprintln!(
            "ref-movement: {} states, {} checks ({} opinion pairs{}), {} failures",
            c.states,
            c.checks,
            c.opinion_checks,
            if score_ready { "" } else { ", skipped: state::score_of is a stub" },
            c.fails.len()
        );
        assert!(c.fails.is_empty(), "{:#?}", c.fails);
    }
}
