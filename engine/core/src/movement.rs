//! Port of logic/engine/movement.ts (RULES.md §4): Chebyshev neighbours, a
//! budget of movement points, road-to-road steps cost 0.5, others 1. A unit may
//! keep stepping from any tile reached below its budget. Entering forest (unless
//! road-to-road) or mountain, any tile next to an enemy (zone of control), an own
//! port (embark) or land from a boat (disembark) ends the move. Unexplored tiles
//! cannot be entered.
//! Functions returning a unit return its index into `s.units`.
use crate::data::unit_def;
use crate::diplomacy::{at_peace, friendly};
use crate::grid::{idx, in_bounds, is_water, tile_at};
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
        // the first unit of u's body (no Vec: this runs for every unit search)
        None => s.units.iter().position(|o| o.body_of == Some(u.id)),
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
    let ctx = MoveCtx::new(s, u.owner);
    let mut out = Vec::with_capacity(32);
    with_bufs(|bufs| search_with(s, u, &ctx, bufs, |t| out.push(t)));
    out
}

/// The path unit u takes to `to` (tiles after its start, ending at `to`), as the
/// mover plans it: hidden enemies it cannot see count as empty tiles.
pub fn path_to(s: &GameState, u: &Unit, to: Coord) -> Vec<Coord> {
    let ctx = MoveCtx::new(s, u.owner);
    with_bufs(|bufs| {
    search_with(s, u, &ctx, bufs, |_| {});
    let n = s.map_size;
    let start = idx(n, u.x, u.y);
    let mut out = Vec::new();
    let mut cur = idx(n, to.x, to.y);
    let mut guard = 0;
    while cur != start && guard < n * n {
        out.push(Coord { x: cur as i32 % n, y: cur as i32 / n });
        // no parent (also after a search that returned early): the direct step
        match bufs.parent.get(cur).copied().filter(|&p| p != NONE) {
            None => return vec![to],
            Some(p) => cur = p as usize,
        }
        guard += 1;
    }
    out.reverse();
    out
    })
}

const NONE: u32 = u32::MAX;

/// What search() looks up per tile that depends only on the moving player, not
/// on the unit: built once and shared by every unit of that player while the
/// state does not change (legal_actions builds one for all its units).
pub(crate) struct MoveCtx {
    owner: i32,
    /// the unit the mover knows about on each tile (later units overwrite
    /// earlier ones, like Map.set), NONE for none
    occupied: Vec<u32>,
    /// zone of control: a tile next to a unit the mover knows about that is an
    /// enemy's, not hidden, not led and no peace partner's
    zoc: Vec<bool>,
    /// road-network tile for the owner (§4.4): road, bridge, village, city; in
    /// own, neutral or allied territory. Per tile on first use: 0 not yet, 1 no, 2 yes
    road: Vec<std::cell::Cell<u8>>,
    cities: crate::state::CityOwners,
    /// (head id, index of its first body unit), first unit of each chain in s.units order
    heads: Vec<(Id, u32)>,
}

impl MoveCtx {
    pub(crate) fn new(s: &GameState, owner: i32) -> MoveCtx {
        let n = s.map_size;
        let nn = (n * n) as usize;
        let mut occupied = vec![NONE; nn];
        for (i, o) in s.units.iter().enumerate() {
            if !o.hidden || can_see(s, owner, o) {
                occupied[idx(n, o.x, o.y)] = i as u32;
            }
        }
        // zone of control around every tile whose known unit (occupied) exerts it on `owner`
        let mut zoc = vec![false; nn];
        for (i, o) in s.units.iter().enumerate() {
            if occupied[idx(n, o.x, o.y)] != i as u32 {
                continue;
            }
            if o.owner != owner && !o.hidden && !is_led(o) && !at_peace(s, owner, o.owner) {
                crate::grid::for_around(n, Coord { x: o.x, y: o.y }, 1, false, |c| zoc[idx(n, c.x, c.y)] = true);
            }
        }
        let mut heads: Vec<(Id, u32)> = Vec::new();
        for (i, o) in s.units.iter().enumerate() {
            if let Some(h) = o.body_of {
                if !heads.iter().any(|e| e.0 == h) {
                    heads.push((h, i as u32));
                }
            }
        }
        MoveCtx { owner, occupied, zoc, road: vec![std::cell::Cell::new(0); nn], cities: crate::state::CityOwners::new(s), heads }
    }
    #[inline]
    fn road_at(&self, s: &GameState, i: usize) -> bool {
        match self.road[i].get() {
            0 => {
                let t = &s.tiles[i];
                let r = (t.road || t.building == Some(Build::Bridge) || t.village || t.city_id.is_some()) && {
                    let o = self.cities.owner(t.territory);
                    o.is_none() || friendly(s, self.owner, o)
                };
                self.road[i].set(if r { 2 } else { 1 });
                r
            }
            v => v == 2,
        }
    }
}

thread_local! {
    static BUFS: std::cell::RefCell<SearchBufs> = std::cell::RefCell::new(SearchBufs::default());
}

/// runs `f` with this thread's search buffers (fresh ones if they are in use)
pub(crate) fn with_bufs<T>(f: impl FnOnce(&mut SearchBufs) -> T) -> T {
    BUFS.with(|b| match b.try_borrow_mut() {
        Ok(mut g) => f(&mut g),
        Err(_) => f(&mut SearchBufs::default()),
    })
}

/// search() buffers, reusable between calls (every call resets them)
#[derive(Default)]
pub(crate) struct SearchBufs {
    parent: Vec<u32>,
    best: Vec<f64>,
    in_ends: Vec<bool>,
    /// enter_kind per tile for the current unit: 0 not computed yet, else kind_code
    kind: Vec<u8>,
    ends: Vec<(u32, StepKind)>,
    queue: Vec<u32>,
    /// tiles whose entries above were changed by the last search
    touched: Vec<u32>,
}

impl SearchBufs {
    fn reset(&mut self, nn: usize) {
        if self.parent.len() != nn {
            self.parent = vec![NONE; nn];
            self.best = vec![f64::INFINITY; nn];
            self.in_ends = vec![false; nn];
            self.kind = vec![0; nn];
        } else {
            for &i in &self.touched {
                let i = i as usize;
                self.parent[i] = NONE;
                self.best[i] = f64::INFINITY;
                self.in_ends[i] = false;
                self.kind[i] = 0;
            }
        }
        self.touched.clear();
        self.ends.clear();
        self.queue.clear();
    }
}

#[inline]
fn kind_code(k: Option<StepKind>) -> u8 {
    match k {
        None => 1,
        Some(StepKind::Normal) => 2,
        Some(StepKind::Embark) => 3,
        Some(StepKind::Disembark) => 4,
    }
}
#[inline]
fn kind_of_code(c: u8) -> Option<StepKind> {
    match c {
        2 => Some(StepKind::Normal),
        3 => Some(StepKind::Embark),
        4 => Some(StepKind::Disembark),
        _ => None,
    }
}

/// TS search: calls `emit` with the targets in Map insertion order and leaves
/// the parent map (per tile index, NONE for none) in `bufs.parent`.
/// `ctx` must be MoveCtx::new(s, u.owner) of this same state.
#[inline(never)]
pub(crate) fn search_with(s: &GameState, u: &Unit, ctx: &MoveCtx, bufs: &mut SearchBufs, emit: impl FnMut(MoveTarget)) {
    search_until(s, u, ctx, bufs, usize::MAX, emit)
}

/// The kind of the step onto `to` if it is one of reachable(s, u), without
/// finishing the search once `to` is found.
pub(crate) fn reachable_kind(s: &GameState, u: &Unit, to: Coord) -> Option<StepKind> {
    let n = s.map_size;
    if !in_bounds(n, to.x, to.y) || (to.x == u.x && to.y == u.y) {
        // (the start tile is never a target)
        return None;
    }
    let ctx = MoveCtx::new(s, u.owner);
    let mut found = None;
    with_bufs(|bufs| search_until(s, u, &ctx, bufs, idx(n, to.x, to.y), |t| found = Some(t.kind)));
    found
}

/// search_with; with `stop_at` a tile index other than the start: emit only
/// that tile, when it becomes a target (its kind is final then), and stop
fn search_until(s: &GameState, u: &Unit, ctx: &MoveCtx, bufs: &mut SearchBufs, stop_at: usize, mut emit: impl FnMut(MoveTarget)) {
    debug_assert_eq!(ctx.owner, u.owner);
    let n = s.map_size;
    let nn = (n * n) as usize;
    bufs.reset(nn);
    if u.frozen || unit_def(u.ty).movement == 0 {
        return;
    }
    let explored = &s.players[u.owner as usize].explored;
    let skate = has(u, Skill::Skate);
    // Segments don't move on their own: only the head moves and the body follows
    if is_led(u) {
        return;
    }
    let mut budget = movement_range(s, u);
    // a chain moves at its first Segment's pace
    // follower_of(s, u) of a unit that is not led: its body's first unit
    let follower = ctx.heads.iter().find(|e| e.0 == u.id).map(|e| e.1 as usize);
    if let Some(f) = follower {
        budget = budget.min(movement_range(s, &s.units[f]));
    }
    if budget <= 0 {
        return;
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
    // roads give no bonus on ice or to skaters
    let roads_count = !no_road && !amphibious && !skate && !naval;
    let occupied = &ctx.occupied;

    let SearchBufs { parent, best, in_ends, kind: kinds, ends, queue, touched } = bufs;
    let start = idx(n, u.x, u.y);
    best[start] = 0.0;
    touched.push(start as u32);
    queue.push(start as u32);
    while !queue.is_empty() {
        // pick lowest cost (first of equals)
        let mut bi = 0;
        let mut bv = best[queue[0] as usize];
        for k in 1..queue.len() {
            let v = best[queue[k] as usize];
            if v < bv {
                bi = k;
                bv = v;
            }
        }
        let cur = queue.remove(bi) as usize;
        let spent = best[cur];
        if spent >= budget - 1e-9 {
            continue;
        }
        let cx = cur as i32 % n;
        let cy = cur as i32 / n;
        let from_road = roads_count && !s.tiles[cur].ice && ctx.road_at(s, cur);
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
                let kc = kinds[i];
                let kind = if kc != 0 {
                    kind_of_code(kc)
                } else {
                    // enter_kind is a pure function of (s, u, t): compute it once per tile
                    let k = enter_kind(s, u, t);
                    kinds[i] = kind_code(k);
                    touched.push(i as u32);
                    k
                };
                let Some(kind) = kind else { continue };
                // a chain member never embarks
                if kind == StepKind::Embark && chained {
                    continue;
                }
                let occ = occupied[i];
                // enemy units block (hidden movers may pass through); own and allied units can be passed
                if occ != NONE && !hide && !friendly(s, u.owner, Some(s.units[occ as usize].owner)) {
                    continue;
                }
                let road = from_road && !t.ice && ctx.road_at(s, i);
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
                if !ignores_zoc && ctx.zoc[i] {
                    stop = true;
                }
                // Aquarion: amphibious units stop on dry land, ships stop on flooded tiles
                if amphibious && !is_water(t) && !t.flooded {
                    stop = true;
                }
                if naval && !is_water(t) && t.flooded {
                    stop = true;
                }
                if occ == NONE && !in_ends[i] {
                    if i == stop_at {
                        emit(MoveTarget { x, y, kind });
                        return;
                    }
                    in_ends[i] = true;
                    ends.push((i as u32, kind));
                    if parent[i] == NONE {
                        parent[i] = cur as u32;
                    }
                }
                if stop {
                    continue;
                }
                if total < best[i] {
                    best[i] = total;
                    parent[i] = cur as u32;
                    queue.push(i as u32);
                }
            }
        }
    }
    // ends.delete(start)
    for &(i, kind) in ends.iter() {
        if i as usize != start {
            emit(MoveTarget { x: i as i32 % n, y: i as i32 / n, kind });
        }
    }
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
/// diplomacy, combat and movement. The file is
/// `$POLY_REF_MOVEMENT`, else engine/core/testdata/ref-movement.json.
#[cfg(test)]
mod ref_tests {
    use super::*;
    use crate::combat::{compute_damage_rounded, defence_bonus};
    use crate::diplomacy::*;
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
        // the file's opinion fields (factors, score, level) are the old TypeScript model's: opinions
        // now follow the game's decompiled model and are tested in opinion.rs
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
            }
        }
        eprintln!(
            "ref-movement: {} states, {} checks, {} failures",
            c.states,
            c.checks,
            c.fails.len()
        );
        assert!(c.fails.is_empty(), "{:#?}", c.fails);
    }
}
