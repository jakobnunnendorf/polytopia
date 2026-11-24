//! Port of logic/engine/actions.ts: legalActions lists every action the current
//! player may take; applyAction applies one (in place here).
//!
//! Units are handled by id inside the effects: any removal (death, disband,
//! push failure, explosion) shifts the indices into `s.units`, so every helper
//! re-finds its unit by id. Where TS keeps using a unit object after it left
//! `s.units`, writes to it are dropped (they have no effect on the state) and
//! reads use a copy taken before the removal.
use crate::combat::{compute_damage_rounded, half_damage};
use crate::data::*;
use crate::diplomacy::{at_peace, can_harm, dip_mut, friendly, has_offer, make_peace, ordinal, record_attack};
use crate::grid::{around, any_around, dist, idx, in_bounds, is_water, tile_at, trim_log};
use crate::movement::{search_with, with_bufs, MoveCtx, can_see, chain_body, enter_kind, follower_of, has, is_led, sight_radius, territory_owner, StepKind};
use crate::state::{
    add_pop, can_research, capital_of, check_elimination, check_game_end, check_meetings, check_tasks, cities_of, city_by_id, claim_territory, explore, grow_units, log, make_unit,
    meet, new_city, pending_reward, push_unit, start_turn, tech_cost, tech_cost_for, unit_capacity, units_homed_in, update_connections, with_rng,
};
use crate::types::*;

/* ---------- helpers ---------- */

/// unitById: index of the unit with this id
#[inline]
fn uidx(s: &GameState, id: Id) -> Option<usize> {
    s.units.iter().position(|u| u.id == id)
}
/// s.units.includes(u)
#[inline]
fn alive(s: &GameState, id: Id) -> bool {
    s.units.iter().any(|u| u.id == id)
}
/// occupant: the first unit on (x,y)
#[inline]
fn occupant(s: &GameState, x: i32, y: i32) -> Option<usize> {
    s.units.iter().position(|u| u.x == x && u.y == y)
}
#[inline]
fn cidx(s: &GameState, id: Id) -> Option<usize> {
    city_by_id(s, Some(id))
}
#[inline]
fn tidx(s: &GameState, x: i32, y: i32) -> usize {
    idx(s.map_size, x, y)
}
#[inline]
fn pos(u: &Unit) -> Coord {
    Coord::new(u.x, u.y)
}
#[inline]
fn udist(a: &Unit, b: &Unit) -> i32 {
    dist(a.x, a.y, b.x, b.y)
}

/// tile owned (territory) by player p
fn own_tile(s: &GameState, p: i32, x: i32, y: i32) -> bool {
    territory_owner(s, tile_at(s, x, y)) == Some(p)
}

/// tile in p's own or a peace partner's territory
fn friendly_tile(s: &GameState, p: i32, x: i32, y: i32) -> bool {
    friendly(s, p, territory_owner(s, tile_at(s, x, y)))
}

/// whether `u` may attack at all (the unit checks of attack_targets)
#[inline]
fn may_attack(u: &Unit) -> bool {
    let def = unit_def(u.ty);
    // a unit led in a chain (Centipede segment) has no attack options; Infiltrate units only target cities
    u.can_attack && def.range != 0 && !is_led(u) && !(def.attack == 0.0 && !has(u, Skill::Convert)) && !has(u, Skill::Infiltrate)
}

/// indices of the units `u` may attack
fn attack_targets(s: &GameState, u: &Unit) -> Vec<usize> {
    let def = unit_def(u.ty);
    if !u.can_attack || def.range == 0 {
        return Vec::new();
    }
    // a unit led in a chain (Centipede segment) has no attack options
    if is_led(u) {
        return Vec::new();
    }
    if def.attack == 0.0 && !has(u, Skill::Convert) {
        return Vec::new();
    }
    // Infiltrate units only target cities
    if has(u, Skill::Infiltrate) {
        return Vec::new();
    }
    s.units
        .iter()
        .enumerate()
        .filter(|(_, t)| udist(u, t) <= def.range && can_harm(s, u.owner, t.owner) && can_see(s, u.owner, t))
        .map(|(i, _)| i)
        .collect()
}

/// indices of the cities `u` may infiltrate
fn infiltrate_targets(s: &GameState, u: &Unit) -> Vec<usize> {
    if !has(u, Skill::Infiltrate) || u.done || u.attacked || u.frozen || (u.moved && !has(u, Skill::Dash)) {
        return Vec::new();
    }
    s.cities
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            can_harm(s, u.owner, c.owner)
                && dist(u.x, u.y, c.x, c.y) == 1
                && !c.riot
                && !s.units.iter().any(|o| o.x == c.x && o.y == c.y && o.owner != c.owner)
        })
        .map(|(i, _)| i)
        .collect()
}


/// the part of can_build that does not depend on the tile: tribe, tech or
/// earned monument, and enough stars
pub(crate) fn player_may_build(s: &GameState, p: i32, b: Build) -> bool {
    let pl = &s.players[p as usize];
    may_build(pl, b, tech_mask(pl))
}

/// the player's techs as a set of Tech indices
#[inline]
pub(crate) fn tech_mask(pl: &Player) -> u64 {
    pl.techs.iter().fold(0u64, |m, &t| m | 1u64 << t.idx())
}

/// player_may_build with the player's tech_mask
#[inline]
pub(crate) fn may_build(pl: &Player, b: Build, techs: u64) -> bool {
    let def = build_def(b);
    let has = |t: Tech| techs & (1u64 << t.idx()) != 0;
    // (every check is a condition of the result: the cheap star check goes first)
    if pl.stars < def.cost || !build_allowed_for(pl.tribe, b) {
        return false;
    }
    if def.kind == BuildKind::Monument {
        let earned = MONUMENTS.iter().any(|&(k, m)| m == b && pl.tasks.contains(&k));
        if !earned || pl.monuments.contains(&b) {
            return false;
        }
    } else {
        match def.tech {
            Some(tech) if has(tech) => {}
            _ => return false,
        }
    }
    if b == Build::Fish && pl.tribe == Tribe::Polaris && !has(Tech::Ramming) {
        return false;
    }
    if b == Build::MountainTemple && pl.tribe == Tribe::Cymanti && !has(Tech::Philosophy) {
        return false;
    }
    true
}

/// can p build a Canal on tile (x,y)? (actions.ts canBuild for Canal: built by an
/// own unit standing on the tile; the occupant is the first unit there)
/// `may`: player_may_build(s, p, Canal)
fn can_build_canal(s: &GameState, p: i32, x: i32, y: i32, may: bool) -> bool {
    if !may {
        return false;
    }
    let t = tile_at(s, x, y);
    let Some(ui) = occupant(s, x, y) else { return false };
    let u = &s.units[ui];
    if u.owner != p || u.done || u.moved || !u.can_attack || u.frozen {
        return false;
    }
    !is_water(t) && !t.flooded && (t.terrain == Terrain::Field || t.terrain == Terrain::Forest)
}

/// what can_build_on looks up across tiles, computed once per legal_actions
pub(crate) struct BuildCtx {
    /// territory_owner of every tile
    cities: crate::state::CityOwners,
    /// per territory id: the set of buildings (bit = Build index) on its tiles, built on first use
    terr_builds: Option<Vec<(Id, u64)>>,
    /// some tile in p's territory has an Ice Bank (built on first use)
    own_ice_bank: Option<bool>,
}

impl BuildCtx {
    pub(crate) fn new(s: &GameState) -> BuildCtx {
        BuildCtx { cities: crate::state::CityOwners::new(s), terr_builds: None, own_ice_bank: None }
    }
    #[inline]
    fn own(&self, s: &GameState, p: i32, x: i32, y: i32) -> bool {
        self.owner(&s.tiles[tidx(s, x, y)]) == Some(p)
    }
    /// territory_owner(s, t)
    #[inline]
    fn owner(&self, t: &Tile) -> Option<i32> {
        self.cities.owner(t.territory)
    }
    /// s.tiles.some((o) => o.territory === terr && o.building === b), terr a city id
    fn territory_has(&mut self, s: &GameState, terr: Id, b: Build) -> bool {
        let tb = self.terr_builds.get_or_insert_with(|| {
            let mut v: Vec<(Id, u64)> = Vec::new();
            for t in &s.tiles {
                let (Some(id), Some(tb)) = (t.territory, t.building) else { continue };
                match v.iter_mut().find(|e| e.0 == id) {
                    Some(e) => e.1 |= 1u64 << tb.idx(),
                    None => v.push((id, 1u64 << tb.idx())),
                }
            }
            v
        });
        tb.iter().find(|e| e.0 == terr).map_or(false, |e| e.1 & (1u64 << b.idx()) != 0)
    }
}

/// sets of Build indices for tile_builds (they depend on the data only)
struct BuildMasks {
    neutral: u64,
    built: u64,
    empty: u64,
    /// [Aquarion or not][terrain * (Resource::COUNT + 1) + resource (0 none, r + 1)]:
    /// the builds that are not simple_build or whose terrain and resource checks pass
    by_tile: [[u64; Terrain::COUNT * (Resource::COUNT + 1)]; 2],
}

fn build_masks() -> &'static BuildMasks {
    static M: std::sync::OnceLock<BuildMasks> = std::sync::OnceLock::new();
    M.get_or_init(|| {
        let of = |f: &dyn Fn(Build) -> bool| Build::ALL.iter().filter(|&&b| f(b)).fold(0u64, |m, &b| m | 1u64 << b.idx());
        let mut by_tile = [[0u64; Terrain::COUNT * (Resource::COUNT + 1)]; 2];
        for (ai, tribe) in [Tribe::Bardur, Tribe::Aquarion].into_iter().enumerate() {
            for terrain in Terrain::ALL {
                for r in 0..=Resource::COUNT {
                    let res = if r == 0 { None } else { Some(Resource::ALL[r - 1]) };
                    by_tile[ai][terrain.idx() * (Resource::COUNT + 1) + r] = of(&|b| {
                        !simple_build(tribe, b) || {
                            let d = build_def(b);
                            d.allows(terrain) && d.resource.map_or(true, |rr| res == Some(rr))
                        }
                    });
                }
            }
        }
        BuildMasks {
            neutral: of(&|b| matches!(build_def(b).kind, BuildKind::Road | BuildKind::Bridge)),
            built: of(&|b| matches!(build_def(b).kind, BuildKind::Road | BuildKind::Destroy) || b == Build::Algae),
            empty: !of(&|b| build_def(b).kind == BuildKind::Destroy),
            by_tile,
        }
    })
}

/// a building that can_build_on allows on an own empty tile only if
/// def.allows(terrain) and the tile has the def's resource (if it names one):
/// none of the special cases before that check applies to it
fn simple_build(tribe: Tribe, b: Build) -> bool {
    let def = build_def(b);
    if matches!(def.kind, BuildKind::Road | BuildKind::Bridge | BuildKind::Embassy | BuildKind::Destroy) {
        return false;
    }
    if matches!(b, Build::Fertilize | Build::Port | Build::Algae | Build::Atoll | Build::Mycelium | Build::Canal) {
        return false;
    }
    !(tribe == Tribe::Aquarion && matches!(b, Build::Windmill | Build::Sawmill | Build::Forge | Build::Market))
}

/// can_build without the player checks (player_may_build), for any building but
/// Canal, with the tile's occupant (first unit there), whether that occupant blocks
/// the tile (a visible enemy not at peace) and the territory owner already looked up
fn can_build_on(s: &GameState, p: i32, b: Build, x: i32, y: i32, occ: Option<usize>, blocked: bool, o: Option<i32>, ctx: &mut BuildCtx) -> bool {
    debug_assert!(b != Build::Canal);
    let def = build_def(b);
    let pl = &s.players[p as usize];
    let t = tile_at(s, x, y);
    if blocked {
        return false; // blocked_by_enemy
    }
    if def.kind == BuildKind::Road {
        if t.road || t.city_id.is_some() || t.village || t.building == Some(Build::Bridge) {
            return false;
        }
        return (o.is_none() || o == Some(p)) && def.allows(t.terrain);
    }
    if t.city_id.is_some() || t.village || t.ruin || t.lighthouse {
        return false;
    }
    if def.kind == BuildKind::Embassy {
        return false; // embassies are built inside cities, see legal_actions
    }
    let own = o == Some(p);
    if def.kind == BuildKind::Bridge {
        if !(o.is_none() || o == Some(p)) || t.terrain != Terrain::Water || t.building.is_some() {
            return false;
        }
        let land = |dx: i32, dy: i32| {
            let xx = x + dx;
            let yy = y + dy;
            if xx < 0 || yy < 0 || xx >= s.map_size || yy >= s.map_size {
                return false;
            }
            !is_water(tile_at(s, xx, yy))
        };
        return (land(0, -1) && land(0, 1)) || (land(-1, 0) && land(1, 0));
    }
    if !own {
        return false;
    }
    let wetland = (t.flooded || t.algae) && t.terrain != Terrain::Forest;
    if b == Build::Fertilize {
        return wetland && t.building.is_none() && t.resource != Some(Resource::Crop);
    }
    if b == Build::Port && t.flooded && !is_water(t) {
        return t.terrain != Terrain::Mountain && t.building.is_none() && t.resource.is_none();
    }
    if def.kind == BuildKind::Destroy {
        return t.building.is_some() && !(t.building == Some(Build::Bridge) && occ.is_some());
    }
    if b == Build::Algae {
        return is_water(t) && !t.ice && !t.algae && t.resource != Some(Resource::Fruit);
    }
    if t.building.is_some() {
        return false;
    }
    let extra_terrain = ((b == Build::Atoll || b == Build::Mycelium) && wetland)
        || (pl.tribe == Tribe::Aquarion && is_water(t) && !t.ice && matches!(b, Build::Windmill | Build::Sawmill | Build::Forge | Build::Market));
    if !extra_terrain && !def.allows(t.terrain) {
        return false;
    }
    if b == Build::IceBank && is_water(t) && !t.ice {
        return false;
    }
    if (b == Build::Atoll || b == Build::AquaFarm) && t.ice {
        return false;
    }
    if b == Build::IceBank && pl.built_unique.as_ref().map_or(false, |v| v.contains(&b)) {
        return false;
    }
    if let Some(nt) = def.next_to_terrain {
        let ok = any_around(s.map_size, Coord::new(x, y), 1, false, |q| tile_at(s, q.x, q.y).terrain == nt && ctx.own(s, p, q.x, q.y));
        if !ok {
            return false;
        }
    }
    if let Some(r) = def.resource {
        if t.resource != Some(r) {
            return false;
        }
    }
    if (b == Build::Outpost || b == Build::IceTemple) && !t.ice {
        return false;
    }
    if b == Build::IceBank {
        let cities = &ctx.cities;
        let any = *ctx.own_ice_bank.get_or_insert_with(|| s.tiles.iter().any(|o| o.building == Some(Build::IceBank) && cities.owner(o.territory) == Some(p)));
        if any {
            return false;
        }
    }
    if !def.next_to.is_empty() {
        let ok = any_around(s.map_size, Coord::new(x, y), 1, false, |q| {
            let n = tile_at(s, q.x, q.y);
            match n.building {
                Some(nb) => def.next_to.contains(&nb) && ctx.own(s, p, q.x, q.y),
                None => false,
            }
        });
        if !ok {
            return false;
        }
    }
    if def.one_per_city {
        // own: the territory is a city id
        if ctx.territory_has(s, t.territory.expect("own tile has a territory"), b) {
            return false;
        }
    }
    true
}

/// legal_actions' tile builds (and Cymanti Decompose), in tile order
#[inline(never)]
pub(crate) fn tile_builds(s: &GameState, p: i32, out: &mut Vec<Action>) {
    let pl = &s.players[p as usize];
    // tile builds: every tile in own territory, plus neutral tiles for roads/bridges
    let n = s.map_size;
    // builds the player can afford and has unlocked (the tile-independent part
    // of can_build) as a set of Build indices: visiting the bits from the lowest
    // keeps Build::ALL order, so the legal list keeps its order
    debug_assert!(Build::ALL.iter().enumerate().all(|(i, b)| b.idx() == i) && Build::COUNT <= 64);
    let mut candidates: u64 = 0;
    let techs = tech_mask(pl);
    for b in Build::ALL {
        // Canal: unit-built, listed with the units below
        if b != Build::Canal && may_build(pl, b, techs) {
            candidates |= 1u64 << b.idx();
        }
    }
    // Cymanti Decompose (Recycling)
    let decompose = pl.tribe == Tribe::Cymanti && pl.has_tech(Tech::Construction);
    if candidates == 0 && !decompose {
        return;
    }
    // neutral tiles: roads and bridges only. can_build_on is false for every
    // other building: on a built tile only roads, Destroy and Algae; Destroy
    // only on a built tile
    let masks = build_masks();
    let neutral = candidates & masks.neutral;
    let built = candidates & masks.built;
    let empty = candidates & masks.empty;
    // empty own tiles: the candidates that can pass can_build_on's terrain and
    // resource checks, by (terrain, resource)
    let by_tile = &masks.by_tile[(pl.tribe == Tribe::Aquarion) as usize];
    // first unit on each tile, as occupant() finds it
    const NO: u32 = u32::MAX;
    let mut occupants: Vec<u32> = vec![NO; s.tiles.len()];
    for (ui, u) in s.units.iter().enumerate().rev() {
        if in_bounds(n, u.x, u.y) {
            occupants[idx(n, u.x, u.y)] = ui as u32;
        }
    }
    let mut bctx = BuildCtx::new(s);
    let mut last_terr: (Option<Id>, Option<i32>) = (None, None);
    for (i, (t, &e)) in s.tiles.iter().zip(pl.explored.iter()).enumerate() {
        if e != 1 {
            continue;
        }
        // territory_owner, the last territory's owner kept
        let o = match t.territory {
            None => None,
            terr if terr == last_terr.0 => last_terr.1,
            terr => {
                last_terr = (terr, bctx.owner(t));
                last_terr.1
            }
        };
        if o.is_some() && o != Some(p) {
            continue;
        }
        let mut list = if o.is_none() {
            neutral
        } else if t.building.is_some() {
            built
        } else {
            empty & by_tile[t.terrain.idx() * (Resource::COUNT + 1) + t.resource.map_or(0, |r| r.idx() + 1)]
        };
        let decomposable = decompose && o == Some(p) && t.building.is_some() && !t.decomposing;
        if list == 0 && !decomposable {
            continue;
        }
        let x = i as i32 % n;
        let y = i as i32 / n;
        let occ = if occupants[i] == NO { None } else { Some(occupants[i] as usize) };
        // the first unit there, a visible enemy not at peace, blocks building
        let blocked = match occ {
            Some(oi) => {
                let u = &s.units[oi];
                u.owner != p && can_see(s, p, u) && !at_peace(s, p, u.owner)
            }
            None => false,
        };
        if !blocked {
            while list != 0 {
                let b = Build::ALL[list.trailing_zeros() as usize];
                list &= list - 1;
                if can_build_on(s, p, b, x, y, occ, false, o, &mut bctx) {
                    out.push(Action::Build { at: Coord::new(x, y), building: b });
                }
            }
        }
        if decomposable && !blocked && !(t.building == Some(Build::Bridge) && occ.is_some()) {
            out.push(Action::Decompose { at: Coord::new(x, y) });
        }
    }
}

/* ---------- legal actions ---------- */

/// actions.ts legalActions, same actions in the same order
pub fn legal_actions(s: &GameState) -> Vec<Action> {
    let mut out = Vec::with_capacity(256);
    legal_into(s, &mut out, |_, _| true);
    out
}

/// legal_actions into `out` (empty on entry), except the Move actions of the
/// units for which `want_moves(unit, actions listed so far)` is false (a
/// caller that knows none of them can matter, see bot_step)
pub(crate) fn legal_into(s: &GameState, out: &mut Vec<Action>, mut want_moves: impl FnMut(&Unit, &[Action]) -> bool) {
    if s.over {
        return;
    }
    let p = s.current;
    let pl = &s.players[p as usize];
    if let Some((ci, options)) = pending_reward(s) {
        let city = s.cities[ci].id;
        out.extend(options.iter().map(|&reward| Action::Reward { city, reward }));
        return;
    }
    out.push(Action::EndTurn);

    let my_cities = s.cities.iter().filter(|c| c.owner == p).count() as i32;
    let literacy = pl.has_tech(Tech::Philosophy);
    for t in Tech::ALL {
        if pl.stars >= tech_cost_for(t, my_cities, literacy) && can_research(s, p, t) {
            out.push(Action::Research { tech: t });
        }
    }

    for c in s.cities.iter().filter(|c| c.owner == p) {
        if occupant(s, c.x, c.y).is_some() {
            continue;
        }
        if units_homed_in(s, c) >= unit_capacity(c) {
            continue;
        }
        for &ut in trainable_units_for(pl.tribe) {
            let def = unit_def(ut);
            if let Some(tech) = def.tech {
                if !pl.has_tech(tech) {
                    continue;
                }
            }
            // Raychi: only from cities next to (open) water
            if ut == UnitType::Raychi
                && !any_around(s.map_size, Coord::new(c.x, c.y), 1, false, |q| {
                    let t = tile_at(s, q.x, q.y);
                    is_water(t) && !t.ice
                })
            {
                continue;
            }
            if pl.stars < def.cost {
                continue;
            }
            out.push(Action::Train { city: c.id, unit: ut });
        }
    }

    tile_builds(s, p, out);

    // embassies (2.18)
    if pl.has_tech(Tech::Diplomacy) && pl.stars >= embassy_cost(pl.embassies.len() as i32) {
        for c in &s.cities {
            let Some(oc) = c.original_capital_of else { continue };
            if c.owner == p || oc != c.owner {
                continue;
            }
            if !pl.met.contains(&c.owner) || pl.embassies.contains(&c.owner) {
                continue;
            }
            out.push(Action::Build { at: Coord::new(c.x, c.y), building: Build::Embassy });
        }
    }

    // diplomacy
    for q in &s.players {
        if q.id == p || !q.alive {
            continue;
        }
        if has_offer(s, q.id, p) {
            out.push(Action::AcceptPeace { player: q.id });
            out.push(Action::DeclinePeace { player: q.id });
        } else if at_peace(s, p, q.id) {
            out.push(Action::BreakPeace { player: q.id });
        } else if pl.has_tech(Tech::Strategy) && pl.met.contains(&q.id) && !has_offer(s, p, q.id) {
            out.push(Action::OfferPeace { player: q.id });
        }
    }

    // shared by every unit's search (built for the first unit that moves)
    let mut move_ctx: Option<MoveCtx> = None;
    // the units p can harm and see, in s.units order (built for the first attacker)
    let mut harmable: Option<Vec<usize>> = None;
    let canal_ok = player_may_build(s, p, Build::Canal);
    let mut any_ice: Option<bool> = None;
    for u in &s.units {
        if u.owner != p {
            continue;
        }
        if u.can_move && !u.done && want_moves(u, out) {
            let ctx = move_ctx.get_or_insert_with(|| MoveCtx::new(s, p));
            with_bufs(|bufs| search_with(s, u, ctx, bufs, |m| out.push(Action::Move { unit: u.id, to: Coord::new(m.x, m.y) })));
        }
        if !u.done {
            // attack_targets(s, u), with the owner checks (can_harm, can_see) done once per unit for all attackers
            if may_attack(u) {
                let range = unit_def(u.ty).range;
                let harmable = harmable.get_or_insert_with(|| (0..s.units.len()).filter(|&i| can_harm(s, p, s.units[i].owner) && can_see(s, p, &s.units[i])).collect::<Vec<usize>>());
                for &ti in harmable.iter() {
                    let t = &s.units[ti];
                    if udist(u, t) <= range {
                        out.push(Action::Attack { unit: u.id, target: t.id });
                    }
                }
            }
        }
        let fresh = !u.done && !u.moved && !u.attacked;
        let tile = tile_at(s, u.x, u.y);
        let leads = !is_led(u);
        if fresh {
            let city_owner = match tile.city_id {
                Some(cid) => cidx(s, cid).map(|ci| s.cities[ci].owner),
                None => None,
            };
            if leads && (tile.village || matches!(city_owner, Some(co) if co != p && !at_peace(s, p, co))) {
                out.push(Action::Capture { unit: u.id });
            }
            if leads && tile.ruin {
                out.push(Action::Examine { unit: u.id });
            }
            if leads && (u.hp < u.max_hp || u.poisoned) {
                out.push(Action::Recover { unit: u.id });
            }
            if tile.resource == Some(Resource::Starfish) && pl.has_tech(Tech::Navigation) && tile.building.is_none() {
                out.push(Action::HarvestStarfish { unit: u.id });
            }
            if leads && pl.has_tech(Tech::FreeSpirit) {
                out.push(Action::Disband { unit: u.id });
            }
            if has(u, Skill::Heal) {
                let hurt = s.units.iter().any(|o| o.owner == p && o.id != u.id && udist(o, u) == 1 && (o.hp < o.max_hp || o.poisoned));
                if hurt {
                    out.push(Action::HealOthers { unit: u.id });
                }
            }
            if has(u, Skill::FreezeArea) && any_around(s.map_size, pos(u), 1, true, |q| freezable(s, p, q)) {
                out.push(Action::FreezeArea { unit: u.id });
            }
        }
        // Swarm
        if has(u, Skill::Swarm) && u.can_move && !u.done && !u.frozen && !swarm_targets(s, u).is_empty() {
            out.push(Action::Swarm { unit: u.id });
        }
        // Explode
        if has(u, Skill::Explode) && !u.frozen && (u.created_turn != Some(s.turn) || is_led(u)) {
            out.push(Action::Explode { unit: u.id });
        }
        for ci in infiltrate_targets(s, u) {
            out.push(Action::Infiltrate { unit: u.id, city: s.cities[ci].id });
        }
        // Break Ice
        if !u.done
            && !u.frozen
            && leads
            && !u.attacked
            && (!u.moved || has(u, Skill::Dash))
            && !has(u, Skill::AutoFreeze)
            && *any_ice.get_or_insert_with(|| s.tiles.iter().any(|t| t.ice)) // (breakable_ice needs an ice tile)
            && any_around(s.map_size, pos(u), 1, false, |q| breakable_ice(s, q, p))
        {
            out.push(Action::BreakIce { unit: u.id });
        }
        // Canal (Waterways): built by this unit on its own tile
        if can_build_canal(s, p, u.x, u.y, canal_ok) {
            out.push(Action::Build { at: pos(u), building: Build::Canal });
        }
        // Clear Tile Effect ("drain")
        if !u.done && !u.frozen {
            let swims = unit_def(u.ty).naval || has(u, Skill::Water);
            if tile.algae && (u.can_move || u.can_attack) && (has(u, Skill::Amphibious) || swims || has(u, Skill::Fly)) {
                out.push(Action::Drain { unit: u.id, effect: DrainEffect::Algae });
            }
            if tile.flooded && !is_water(tile) && u.can_move && u.can_attack && pl.tribe != Tribe::Aquarion && (has(u, Skill::Amphibious) || !swims) {
                out.push(Action::Drain { unit: u.id, effect: DrainEffect::Flooded });
            }
        }
        if u.kills >= 3 && !u.veteran && !has(u, Skill::Static) {
            out.push(Action::Promote { unit: u.id });
        }
        // upgrades only in own or an ally's territory
        if u.ty == UnitType::Raft && friendly_tile(s, p, u.x, u.y) {
            for &b in RAFT_UPGRADES {
                let def = unit_def(b);
                if let Some(tech) = def.tech {
                    if pl.has_tech(tech) && pl.stars >= def.cost {
                        out.push(Action::Upgrade { unit: u.id, to: b });
                    }
                }
            }
        }
    }
}

/* ---------- apply ---------- */

/// the unit id an action names (TS `"unitId" in a`)
fn acting_unit(a: &Action) -> Option<Id> {
    match *a {
        Action::Move { unit, .. }
        | Action::Attack { unit, .. }
        | Action::Capture { unit }
        | Action::Recover { unit }
        | Action::Examine { unit }
        | Action::Disband { unit }
        | Action::Upgrade { unit, .. }
        | Action::Promote { unit }
        | Action::HealOthers { unit }
        | Action::HarvestStarfish { unit }
        | Action::Infiltrate { unit, .. }
        | Action::FreezeArea { unit }
        | Action::Swarm { unit }
        | Action::Explode { unit }
        | Action::BreakIce { unit }
        | Action::Drain { unit, .. } => Some(unit),
        _ => None,
    }
}

/// the checks whose failure makes TS throw (a `!` on a missing unit, city or tile);
/// done before any change so an Err leaves `s` untouched
fn validate(s: &GameState, a: &Action) -> Result<(), String> {
    if let Some(id) = acting_unit(a) {
        if uidx(s, id).is_none() {
            return Err(format!("no unit {id}"));
        }
    }
    match *a {
        Action::Attack { target, .. } => {
            if uidx(s, target).is_none() {
                return Err(format!("no unit {target}"));
            }
        }
        Action::Infiltrate { city, .. } | Action::Train { city, .. } | Action::Reward { city, .. } => {
            if cidx(s, city).is_none() {
                return Err(format!("no city {city}"));
            }
        }
        Action::Build { at, building } => {
            if !in_bounds(s.map_size, at.x, at.y) {
                return Err(format!("tile {},{} off the map", at.x, at.y));
            }
            if building == Build::Embassy && city_by_id(s, tile_at(s, at.x, at.y).city_id).is_none() {
                return Err("embassy outside a city".into());
            }
        }
        Action::Decompose { at } | Action::Move { to: at, .. } => {
            if !in_bounds(s.map_size, at.x, at.y) {
                return Err(format!("tile {},{} off the map", at.x, at.y));
            }
        }
        _ => {}
    }
    Ok(())
}

/// actions.ts applyAction, in place: `s` becomes the state TS returns.
/// The TS version clones first (cutting the log to 50 lines); this does the same cut.
/// Err for an action TS would reject (throw).
pub fn apply_action(s: &mut GameState, a: &Action) -> Result<(), String> {
    validate(s, a)?;
    trim_log(s);
    let p = s.current;
    let pu = p as usize;
    match *a {
        Action::EndTurn => {
            end_turn(s);
            return Ok(());
        }
        Action::Research { tech } => {
            let cost = tech_cost(s, p, tech);
            s.players[pu].stars -= cost;
            s.players[pu].techs.push(tech);
            log(s, &format!("researched {}", tech.id()));
        }
        Action::Train { city, unit } => {
            let ci = cidx(s, city).unwrap();
            let def = unit_def(unit);
            s.players[pu].stars -= def.cost;
            let at = Coord::new(s.cities[ci].x, s.cities[ci].y);
            let ni = make_unit(s, unit, p, at, Some(city));
            let nid = s.units[ni].id;
            // a trained Jelly strikes its neighbours at once
            if has(&s.units[ni], Skill::Tentacles) {
                area_damage(s, nid);
            }
            let ni = uidx(s, nid).unwrap();
            let nu = s.units[ni].clone();
            let r = sight_radius(s, &nu);
            explore(s, p, pos(&nu), r);
        }
        Action::Build { at, building } => do_build(s, p, building, at),
        Action::Move { unit, to } => do_move(s, unit, to),
        Action::Attack { unit, target } => do_attack(s, unit, target),
        Action::Capture { unit } => do_capture(s, unit),
        Action::Recover { unit } => {
            let ui = uidx(s, unit).unwrap();
            heal(s, ui);
            end_unit(&mut s.units[ui]);
        }
        Action::Examine { unit } => do_examine(s, unit),
        Action::Disband { unit } => {
            // a Centipede's body goes with it, each part paid
            let ui = uidx(s, unit).unwrap();
            let mut gone = vec![ui];
            gone.extend(chain_body(s, unit));
            let mut gain = 0;
            for &gi in &gone {
                let o = &s.units[gi];
                let total = unit_def(o.ty).cost + o.carried.map_or(0, |c| unit_def(c).cost);
                if total > 1 {
                    gain += total / 2;
                }
            }
            s.players[pu].stars += gain;
            let ids: Vec<Id> = gone.iter().map(|&gi| s.units[gi].id).collect();
            s.units.retain(|x| !ids.contains(&x.id));
        }
        Action::Promote { unit } => {
            let ui = uidx(s, unit).unwrap();
            let u = &mut s.units[ui];
            u.veteran = true;
            u.max_hp += 5;
            u.hp = u.max_hp;
        }
        Action::HealOthers { unit } => {
            let ui = uidx(s, unit).unwrap();
            let (ux, uy) = (s.units[ui].x, s.units[ui].y);
            for o in s.units.iter_mut() {
                if o.owner == p && o.id != unit && dist(o.x, o.y, ux, uy) == 1 {
                    heal_by(o, 4);
                }
            }
            end_unit(&mut s.units[ui]);
        }
        Action::HarvestStarfish { unit } => {
            let ui = uidx(s, unit).unwrap();
            let ti = tidx(s, s.units[ui].x, s.units[ui].y);
            s.tiles[ti].resource = None;
            s.players[pu].stars += STARFISH_STARS;
            let u = &mut s.units[ui];
            u.hidden = false; // harvesting reveals a Cloak
            end_unit(u);
        }
        Action::Infiltrate { unit, city } => do_infiltrate(s, unit, city),
        Action::Upgrade { unit, to } => {
            let ui = uidx(s, unit).unwrap();
            s.players[pu].stars -= unit_def(to).cost;
            s.units[ui].ty = to;
            let u = s.units[ui].clone();
            let r = sight_radius(s, &u);
            explore(s, p, pos(&u), r);
        }
        Action::Reward { city, reward } => {
            let ci = cidx(s, city).unwrap();
            do_reward(s, ci, reward);
        }
        Action::FreezeArea { unit } => {
            freeze_area(s, unit);
            let ui = uidx(s, unit).unwrap();
            end_unit(&mut s.units[ui]);
        }
        Action::BreakIce { unit } => {
            let ui = uidx(s, unit).unwrap();
            {
                let u = &mut s.units[ui];
                u.hidden = false;
                end_unit(u);
                u.moved = true;
                u.attacked = true;
            }
            break_ice_area(s, unit, p);
        }
        Action::Drain { unit, effect } => {
            let ui = uidx(s, unit).unwrap();
            let ti = tidx(s, s.units[ui].x, s.units[ui].y);
            match effect {
                DrainEffect::Algae => s.tiles[ti].algae = false,
                DrainEffect::Flooded => s.tiles[ti].flooded = false,
            }
            let u = &mut s.units[ui];
            u.hidden = false;
            end_unit(u);
            u.moved = true;
            u.attacked = true;
        }
        Action::Decompose { at } => {
            let ti = tidx(s, at.x, at.y);
            s.tiles[ti].decomposing = true;
        }
        Action::Swarm { unit } => {
            let ui = uidx(s, unit).unwrap();
            let u = s.units[ui].clone();
            for oi in swarm_targets(s, &u) {
                s.units[oi].swarmed = true;
            }
            let u = &mut s.units[ui];
            end_unit(u);
            u.moved = true;
            u.attacked = true;
        }
        Action::Explode { unit } => do_explode(s, unit),
        Action::OfferPeace { player } => {
            dip_mut(s).offers.push(Offer { from: p, to: player });
            log(s, &format!("offered peace to player {player}"));
        }
        Action::AcceptPeace { player } => {
            make_peace(s, player, p);
            log(s, &format!("accepted peace with player {player}"));
        }
        Action::DeclinePeace { player } => {
            let d = dip_mut(s);
            d.offers.retain(|o| !(o.from == player && o.to == p));
            log(s, &format!("declined peace from player {player}"));
        }
        Action::BreakPeace { player } => break_peace(s, p, player),
    }
    let acting = acting_unit(a);
    let canal_at = match *a {
        Action::Build { at, building: Build::Canal } => Some(at),
        _ => None,
    };
    for u in s.units.iter_mut() {
        if u.owner == p && (acting == Some(u.id) || canal_at.map_or(false, |at| u.x == at.x && u.y == at.y)) {
            u.idle = false;
        }
    }
    update_connections(s, p);
    check_meetings(s);
    check_tasks(s, p);
    check_elimination(s);
    Ok(())
}

#[inline]
fn end_unit(u: &mut Unit) {
    u.done = true;
    u.can_move = false;
    u.can_attack = false;
}

/// any heal: a poisoned unit loses the poison and gains no HP
#[inline]
fn heal_by(u: &mut Unit, amount: i32) {
    if u.poisoned {
        u.poisoned = false;
        return;
    }
    u.hp = u.max_hp.min(u.hp + amount);
}

/// Recover: 4 HP in own or a peace partner's territory, 2 elsewhere
fn heal(s: &mut GameState, ui: usize) {
    let u = &s.units[ui];
    let amount = if friendly_tile(s, u.owner, u.x, u.y) { 4 } else { 2 };
    heal_by(&mut s.units[ui], amount);
}

/// Breaking peace: the breaker's units inside the victim's borders are destroyed,
/// a cease-fire holds until the breaker's next turn, the victim remembers it.
fn break_peace(s: &mut GameState, breaker: i32, victim: i32) {
    let ord = ordinal(s);
    let until = ord + s.players.len() as i32;
    {
        let d = dip_mut(s);
        d.peace.retain(|x| !((x[0] == breaker && x[1] == victim) || (x[0] == victim && x[1] == breaker)));
        d.ceasefires.retain(|c| ord < c.until);
        d.ceasefires.push(Ceasefire { breaker, victim, until });
        if !d.broken.iter().any(|b| b[0] == victim && b[1] == breaker) {
            d.broken.push([victim, breaker]);
        }
    }
    let lost: Vec<Id> = s
        .units
        .iter()
        .filter(|u| u.owner == breaker && territory_owner(s, tile_at(s, u.x, u.y)) == Some(victim))
        .map(|u| u.id)
        .collect();
    s.units.retain(|u| !lost.contains(&u.id));
    for u in s.units.iter_mut() {
        if u.owner != breaker {
            continue;
        }
        end_unit(u);
        u.moved = true;
        u.attacked = true;
    }
    s.players[breaker as usize].losses += lost.len() as i32;
    log(s, &format!("broke peace with player {victim}"));
}

fn end_turn(s: &mut GameState) {
    let p = s.current;
    let pu = p as usize;
    // automatic heal, then frozen units thaw
    for i in 0..s.units.len() {
        if s.units[i].owner != p {
            continue;
        }
        let u = &s.units[i];
        let idle = !u.done && !u.moved && !u.attacked && !u.frozen && u.body_of.is_none();
        if idle && (u.hp < u.max_hp || u.poisoned) {
            heal(s, i);
        }
        if s.units[i].frozen {
            s.units[i].frozen = false;
        }
    }
    grow_units(s, p);
    improvement_upkeep(s, p);
    if s.players[pu].has_tech(Tech::Meditation) {
        let pl = &mut s.players[pu];
        pl.pacifist_turns = (if pl.attacked_this_turn { 0 } else { pl.pacifist_turns }) + 1;
    }
    check_tasks(s, p);
    // offers this player did not answer on its turn lapse
    if let Some(d) = s.diplomacy.as_mut() {
        d.offers.retain(|o| o.to != p);
    }
    // next alive player; a new round increments the turn
    let len = s.players.len() as i32;
    let mut next = p;
    loop {
        next = (next + 1) % len;
        if next == 0 {
            s.turn += 1;
        }
        if !(!s.players[next as usize].alive && next != p) {
            break;
        }
    }
    s.current = next;
    check_game_end(s, true);
    if s.over {
        return;
    }
    start_turn(s);
}

/// End-of-turn upkeep of p's own buildings: Mycelium heals, decomposing buildings pay back and go.
fn improvement_upkeep(s: &mut GameState, p: i32) {
    let n = s.map_size;
    for i in 0..s.tiles.len() {
        let t = &s.tiles[i];
        let Some(b) = t.building else { continue };
        if territory_owner(s, t) != Some(p) {
            continue;
        }
        let at = Coord::new(i as i32 % n, i as i32 / n);
        if b == Build::Mycelium {
            for u in s.units.iter_mut() {
                if u.owner == p && dist(u.x, u.y, at.x, at.y) <= 1 {
                    heal_by(u, 4);
                }
            }
        }
        let t = &s.tiles[i];
        if t.decomposing && !(t.building == Some(Build::Bridge) && occupant(s, at.x, at.y).is_some()) {
            s.players[p as usize].stars += build_def(b).cost;
            remove_building(s, p, at);
        }
    }
}

/// Remove the building on `at` (Decompose)
fn remove_building(s: &mut GameState, p: i32, at: Coord) {
    let ti = tidx(s, at.x, at.y);
    let old = s.tiles[ti].building;
    let level = s.tiles[ti].building_level;
    if let Some(ci) = city_by_id(s, s.tiles[ti].territory) {
        let lost = old.map_or(0, |b| build_def(b).pop) + if old.and_then(feeds).is_some() { 0 } else { level_pop(old, level) };
        s.cities[ci].pop -= lost;
    }
    let t = &mut s.tiles[ti];
    if let Some(r) = old.and_then(|b| build_def(b).resource) {
        t.resource = Some(r);
    }
    t.building = None;
    t.building_level = 0;
    t.decomposing = false;
    unfeed(s, p, at, old);
}

/* ---------- moves ---------- */

/// A hidden enemy the mover could not see on the move's destination: the move becomes a Reveal.
fn reveal_at_destination(s: &mut GameState, uid: Id, to: Coord) -> bool {
    let Some(oi) = occupant(s, to.x, to.y) else { return false };
    let ui = uidx(s, uid).unwrap();
    let (occ, u) = (&s.units[oi], &s.units[ui]);
    if occ.id == uid || friendly(s, u.owner, Some(occ.owner)) || !occ.hidden || can_see(s, u.owner, occ) {
        return false;
    }
    s.units[oi].hidden = false;
    log(s, &format!("ran into a hidden unit at {},{}", to.x, to.y));
    true
}

fn do_move(s: &mut GameState, uid: Id, to: Coord) {
    if reveal_at_destination(s, uid, to) {
        return;
    }
    let ui = uidx(s, uid).unwrap();
    let u = s.units[ui].clone();
    let kind = crate::movement::reachable_kind(s, &u, to).unwrap_or(StepKind::Normal);
    let origin = pos(&u);
    s.units[ui].last_dir = Some(Coord::new(js_sign(to.x - u.x), js_sign(to.y - u.y)));
    // explore the straight-line path's tiles
    let steps = dist(u.x, u.y, to.x, to.y);
    if steps > 0 {
        for k in 0..=steps {
            let x = js_round(u.x as f64 + ((to.x - u.x) * k) as f64 / steps as f64) as i32;
            let y = js_round(u.y as f64 + ((to.y - u.y) * k) as f64 / steps as f64) as i32;
            // Algae (Living Island): leaves algae on the water tiles it passes
            if k < steps && has(&u, Skill::Algae) {
                let ti = tidx(s, x, y);
                let pt = &mut s.tiles[ti];
                if is_water(pt) && !pt.ice {
                    pt.algae = true;
                }
            }
            if k > 0 {
                explore(s, u.owner, Coord::new(x, y), if has(&u, Skill::Scout) { 2 } else { 1 });
            }
        }
    }
    {
        let m = &mut s.units[ui];
        m.x = to.x;
        m.y = to.y;
        m.moved = true;
        m.can_move = false;
        if !has(m, Skill::Dash) {
            m.can_attack = false;
        }
        if has(m, Skill::Hide) {
            m.hidden = true;
        }
    }
    let cur = s.units[ui].clone();
    let r = sight_radius(s, &cur);
    explore(s, u.owner, to, r);
    // Skate: a move ending on land allows no attack
    if has(&cur, Skill::Skate) && !is_water(tile_at(s, to.x, to.y)) {
        s.units[ui].can_attack = false;
    }
    after_move(s, uid, kind, origin);
    // moving onto another tribe's city is an act of war
    if let Some(cid) = tile_at(s, to.x, to.y).city_id {
        if let Some(ci) = cidx(s, cid) {
            let host = s.cities[ci].owner;
            if host != u.owner {
                war_act(s, u.owner, host);
            }
        }
    }
}

/// What a move sets off: poison buildings, Bubbles, the Tentacles strike on the mover, Stomp,
/// embark/disembark, Auto Freeze, a Jelly's strike, Auto Flood; then the chain follows.
fn after_move(s: &mut GameState, uid: Id, kind: StepKind, origin: Coord) {
    let u = s.units[uidx(s, uid).unwrap()].clone();
    let follower = follower_of(s, &u).map(|i| s.units[i].id);
    let dest = pos(&u);
    poison_tile(s, uid);
    bubble_after_move(s, uid);
    tentacle_strike(s, uid);
    if alive(s, uid) {
        let cu = |s: &GameState| s.units[uidx(s, uid).unwrap()].clone();
        let stomps_leaving = kind == StepKind::Disembark && has(&cu(s), Skill::Stomp);
        if stomps_leaving {
            stomp(s, uid);
        }
        if let Some(ui) = uidx(s, uid) {
            if kind == StepKind::Embark {
                embark(&mut s.units[ui]);
            } else if kind == StepKind::Disembark {
                disembark(&mut s.units[ui]);
            }
        }
        if alive(s, uid) && !stomps_leaving && has(&cu(s), Skill::Stomp) {
            stomp(s, uid);
        }
        if alive(s, uid) && has(&cu(s), Skill::AutoFreeze) {
            freeze_area(s, uid);
        }
        if alive(s, uid) {
            let c = cu(s);
            if has(&c, Skill::Tentacles) && !c.frozen {
                area_damage(s, uid);
            }
        }
        if alive(s, uid) {
            let c = cu(s);
            if has(&c, Skill::AutoFlood) {
                flood_at(s, c.owner, c.x, c.y);
            }
        }
    }
    if let Some(fid) = follower {
        if let Some(fi) = uidx(s, fid) {
            let f = &s.units[fi];
            if dist(f.x, f.y, dest.x, dest.y) >= 2 {
                follow_step(s, fid, origin);
            }
        }
    }
}

/// A push out of the way (pushUnit), then what it sets off on the new tile; a train
/// onto an occupied tile pushes again until the tile is free.
fn push_aside(s: &mut GameState, uid: Id, spawner: i32, depth: usize) {
    let ui = uidx(s, uid).unwrap();
    let u = s.units[ui].clone();
    let origin = pos(&u);
    let follower = follower_of(s, &u).map(|i| s.units[i].id);
    if depth > s.units.len() {
        s.units.remove(ui);
        return;
    }
    push_unit(s, ui, spawner);
    let Some(ui) = uidx(s, uid) else { return };
    let now = pos(&s.units[ui]);
    if now == origin {
        return;
    }
    s.units[ui].last_dir = Some(Coord::new(now.x - origin.x, now.y - origin.y));
    poison_tile(s, uid);
    bubble_after_move(s, uid);
    tentacle_strike(s, uid);
    if let Some(fid) = follower {
        if let Some(fi) = uidx(s, fid) {
            let f = &s.units[fi];
            // dist(follower, u): u's position is `now` (a struck unit does not move)
            if dist(f.x, f.y, now.x, now.y) >= 2 {
                follow_step(s, fid, origin);
            }
        }
    }
    if let Some(bi) = occupant(s, origin.x, origin.y) {
        let bid = s.units[bi].id;
        push_aside(s, bid, spawner, depth + 1);
    }
}

/// a chain member steps into the tile its leader left
fn follow_step(s: &mut GameState, fid: Id, to: Coord) {
    if occupant(s, to.x, to.y).is_some() {
        return;
    }
    let fi = uidx(s, fid).unwrap();
    let origin = pos(&s.units[fi]);
    {
        let f = &mut s.units[fi];
        f.last_dir = Some(Coord::new(js_sign(to.x - f.x), js_sign(to.y - f.y)));
        f.x = to.x;
        f.y = to.y;
        f.moved = true;
        f.can_move = false;
        if !has(f, Skill::Dash) {
            f.can_attack = false;
        }
    }
    let f = s.units[fi].clone();
    let r = sight_radius(s, &f);
    explore(s, f.owner, to, r);
    after_move(s, fid, StepKind::Normal, origin);
}

/// An act of war: record the attack and end the embassies between the two.
fn war_act(s: &mut GameState, p: i32, q: i32) {
    if p == q {
        return;
    }
    record_attack(s, p, q);
    s.players[p as usize].embassies.retain(|&h| h != q);
    s.players[q as usize].embassies.retain(|&h| h != p);
}

/// Cymanti poison buildings (Fungi, Clathrus) poison a unit stepping onto them.
fn poison_tile(s: &mut GameState, uid: Id) {
    let Some(ui) = uidx(s, uid) else { return };
    let u = &s.units[ui];
    let t = tile_at(s, u.x, u.y);
    if t.building != Some(Build::Fungi) && t.building != Some(Build::Clathrus) {
        return;
    }
    if s.players[u.owner as usize].tribe == Tribe::Cymanti || has(u, Skill::Fly) {
        return;
    }
    s.units[ui].poisoned = true;
}

/* ---------- Aquarion: flooding, Bubbles, Tentacles ---------- */

#[inline]
fn has_bubble(s: &GameState, p: i32) -> bool {
    let pl = &s.players[p as usize];
    pl.tribe == Tribe::Aquarion && pl.has_tech(Tech::Roads)
}

/// Flood a floodable tile; an amphibious unit on it gains Bubble when the flooder has the ability.
fn flood_at(s: &mut GameState, actor: i32, x: i32, y: i32) {
    let ti = tidx(s, x, y);
    let t = &s.tiles[ti];
    if is_water(t) || t.terrain == Terrain::Mountain || t.flooded {
        return;
    }
    s.tiles[ti].flooded = true;
    if let Some(oi) = occupant(s, x, y) {
        if has(&s.units[oi], Skill::Amphibious) && has_bubble(s, actor) {
            s.units[oi].bubble = true;
        }
    }
}

fn bubble_after_move(s: &mut GameState, uid: Id) {
    let Some(ui) = uidx(s, uid) else { return };
    let u = &s.units[ui];
    if !has(u, Skill::Amphibious) {
        return;
    }
    let t = tile_at(s, u.x, u.y);
    if !is_water(t) && t.flooded {
        if has_bubble(s, u.owner) {
            s.units[ui].bubble = true;
        }
    } else if !is_water(t) && !t.algae {
        s.units[ui].bubble = false;
    }
}

/// Tentacles strike: a unit next to an unfrozen hostile Jelly is hit by the healthiest one.
fn tentacle_strike(s: &mut GameState, uid: Id) {
    let Some(ui) = uidx(s, uid) else { return };
    let u = s.units[ui].clone();
    let mut best: Option<usize> = None;
    for dx in -1..=1 {
        for dy in -1..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let Some(ji) = occupant(s, u.x + dx, u.y + dy) else { continue };
            let j = &s.units[ji];
            if !can_harm(s, u.owner, j.owner) || j.frozen || !has(j, Skill::Tentacles) {
                continue;
            }
            if best.map_or(true, |bi| j.hp > s.units[bi].hp) {
                best = Some(ji);
            }
        }
    }
    if let Some(bi) = best {
        let b = s.units[bi].clone();
        let d = compute_damage_rounded(s, &b, &u).damage;
        damage(s, uid, d, Some(&b), None);
    }
}

/// A Jelly's own strike: full damage to every hostile neighbour, no retaliation.
fn area_damage(s: &mut GameState, uid: Id) {
    let mut u = s.units[uidx(s, uid).unwrap()].clone();
    for dx in -1..=1 {
        for dy in -1..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            if let Some(ui) = uidx(s, uid) {
                u = s.units[ui].clone();
            }
            let Some(ei) = occupant(s, u.x + dx, u.y + dy) else { continue };
            let e = s.units[ei].clone();
            if !can_harm(s, u.owner, e.owner) {
                continue;
            }
            let dealt = compute_damage_rounded(s, &u, &e).damage;
            if dealt > 0 && !e.hidden {
                war_act(s, u.owner, e.owner);
                s.players[u.owner as usize].attacked_this_turn = true;
            }
            damage(s, e.id, dealt, Some(&u), None);
        }
    }
}

/* ---------- Polaris: freezing and breaking ice ---------- */

/// whether `actor` can freeze tile q
fn freezable(s: &GameState, actor: i32, q: Coord) -> bool {
    if s.players[actor as usize].explored[idx(s.map_size, q.x, q.y)] != 1 {
        return false;
    }
    let t = tile_at(s, q.x, q.y);
    if if is_water(t) { !t.ice } else { t.flooded || !t.polar } {
        return true;
    }
    match occupant(s, q.x, q.y) {
        Some(oi) => {
            let o = &s.units[oi];
            can_harm(s, actor, o.owner) && !o.frozen && can_see(s, actor, o)
        }
        None => false,
    }
}

/// Freeze Area: every freezable tile around freezes, every hostile unit around freezes.
fn freeze_area(s: &mut GameState, uid: Id) {
    let u = s.units[uidx(s, uid).unwrap()].clone();
    let p = u.owner;
    for q in around(s.map_size, pos(&u), 1, false) {
        if freezable(s, p, q) {
            let ti = tidx(s, q.x, q.y);
            let t = &mut s.tiles[ti];
            if is_water(t) {
                t.ice = true;
            } else {
                t.polar = true;
            }
        }
        if let Some(oi) = occupant(s, q.x, q.y) {
            if can_harm(s, p, s.units[oi].owner) && !s.units[oi].frozen {
                s.units[oi].frozen = true;
                s.players[p as usize].attacked_this_turn = true;
            }
        }
    }
}

/// ice that is empty, holds a swimmer or flyer or a hidden enemy, or has algae or a bridge
fn breakable_ice(s: &GameState, q: Coord, viewer: i32) -> bool {
    let t = tile_at(s, q.x, q.y);
    if !t.ice {
        return false;
    }
    if t.algae || t.building == Some(Build::Bridge) {
        return true;
    }
    let Some(oi) = occupant(s, q.x, q.y) else { return true };
    let o = &s.units[oi];
    let swims = unit_def(o.ty).naval || has(o, Skill::Water) || has(o, Skill::Amphibious);
    swims || has(o, Skill::Fly) || (o.hidden && o.owner != viewer && !at_peace(s, viewer, o.owner))
}

/// Break Ice: every breakable ice tile around breaks; a hidden enemy on one is revealed instead.
fn break_ice_area(s: &mut GameState, uid: Id, p: i32) {
    let u = s.units[uidx(s, uid).unwrap()].clone();
    let n = s.map_size;
    for q in around(n, pos(&u), 1, false) {
        if !breakable_ice(s, q, p) {
            continue;
        }
        if let Some(oi) = occupant(s, q.x, q.y) {
            let o = &s.units[oi];
            if o.hidden && o.owner != p && !at_peace(s, p, o.owner) {
                s.units[oi].hidden = false;
                continue;
            }
        }
        let land = [Coord::new(q.x - 1, q.y), Coord::new(q.x, q.y - 1), Coord::new(q.x, q.y + 1), Coord::new(q.x + 1, q.y)]
            .iter()
            .any(|d| d.x >= 0 && d.y >= 0 && d.x < n && d.y < n && !is_water(tile_at(s, d.x, d.y)));
        let ti = tidx(s, q.x, q.y);
        let t = &mut s.tiles[ti];
        t.ice = false;
        t.terrain = if land { Terrain::Water } else { Terrain::Ocean };
    }
}

/* ---------- Cymanti: Swarm, Explode, Centipede ---------- */

/// own neighbours not Swift yet and not led in a chain
fn swarm_targets(s: &GameState, u: &Unit) -> Vec<usize> {
    s.units
        .iter()
        .enumerate()
        .filter(|(_, o)| o.owner == u.owner && o.id != u.id && udist(o, u) == 1 && !o.swarmed && !is_led(o))
        .map(|(i, _)| i)
        .collect()
}

/// spores (and algae on open water) where a poisoned unit died or a unit exploded
fn leave_spores_or_algae(s: &mut GameState, x: i32, y: i32) {
    let ti = tidx(s, x, y);
    let t = &mut s.tiles[ti];
    if t.city_id.is_some() || t.village {
        return;
    }
    t.resource = Some(Resource::Spores);
    if is_water(t) && !t.ice {
        t.algae = true;
    }
}

/// Explode: half damage to every hostile neighbour, survivors poisoned; the follower explodes too.
fn do_explode(s: &mut GameState, uid: Id) {
    let ui = uidx(s, uid).unwrap();
    let u = s.units[ui].clone();
    let p = u.owner;
    let at = pos(&u);
    let follower = follower_of(s, &u).map(|i| s.units[i].id);
    s.units.remove(ui);
    leave_spores_or_algae(s, at.x, at.y);
    let snapshot: Vec<Id> = s.units.iter().map(|o| o.id).collect();
    for eid in snapshot {
        let Some(ei) = uidx(s, eid) else { continue };
        let e = s.units[ei].clone();
        if !can_harm(s, p, e.owner) || dist(e.x, e.y, at.x, at.y) != 1 {
            continue;
        }
        let r = compute_damage_rounded(s, &u, &e);
        war_act(s, p, e.owner);
        s.players[p as usize].attacked_this_turn = true;
        damage(s, eid, half_damage(r.damage), Some(&u), None);
        if let Some(ei) = uidx(s, eid) {
            s.units[ei].poisoned = true;
        }
    }
    if let Some(fid) = follower {
        if alive(s, fid) {
            do_explode(s, fid);
        }
    }
}

fn embark(u: &mut Unit) {
    let boat = embark_as(u.ty).unwrap_or(UnitType::Raft);
    u.carried = Some(u.ty);
    u.ty = boat;
    end_unit(u);
}

fn disembark(u: &mut Unit) {
    let Some(c) = u.carried else { return };
    u.ty = c;
    u.carried = None;
    end_unit(u);
}

fn stomp(s: &mut GameState, uid: Id) {
    let snapshot: Vec<Id> = s.units.iter().map(|o| o.id).collect();
    let mut u = s.units[uidx(s, uid).unwrap()].clone();
    for eid in snapshot {
        if let Some(ui) = uidx(s, uid) {
            u = s.units[ui].clone();
        }
        let Some(ei) = uidx(s, eid) else { continue };
        let e = s.units[ei].clone();
        if !can_harm(s, u.owner, e.owner) || udist(&e, &u) != 1 {
            continue;
        }
        let r = compute_damage_rounded(s, &u, &e);
        if r.damage > 0 && !e.hidden {
            war_act(s, u.owner, e.owner);
            s.players[u.owner as usize].attacked_this_turn = true;
        }
        damage(s, eid, half_damage(r.damage), Some(&u), None);
    }
}

/* ---------- combat ---------- */

/// Deal damage to the unit `tid` (in s.units). A kill counts for `by`'s player, or for
/// `killer` when there is no attacking unit. `by` is the attacker as it is now (it may
/// already be gone from s.units: then its own kill count is not kept).
fn damage(s: &mut GameState, tid: Id, amount: i32, by: Option<&Unit>, killer: Option<i32>) -> bool {
    let ti = uidx(s, tid).unwrap();
    {
        let t = &mut s.units[ti];
        t.hp -= amount;
        // Swarm (Swift) is lost whenever the unit is hit
        t.swarmed = false;
        if t.hp > 0 {
            return false;
        }
    }
    let target = s.units[ti].clone();
    let follower = follower_of(s, &target).map(|i| s.units[i].id);
    s.units.remove(ti);
    if target.poisoned {
        leave_spores_or_algae(s, target.x, target.y);
    }
    if let Some(fid) = follower {
        split_chain(s, &target, fid);
    }
    s.players[target.owner as usize].losses += 1;
    if let Some(b) = by {
        s.players[b.owner as usize].kills += 1;
        if !has(b, Skill::Static) && !has(b, Skill::Carry) {
            if let Some(bi) = uidx(s, b.id) {
                s.units[bi].kills += 1;
            }
        }
    } else if let Some(k) = killer {
        s.players[k as usize].kills += 1;
    }
    true
}

/// A killed chain member: its follower grows into a Centipede and leads the rest behind it.
fn split_chain(s: &mut GameState, dead: &Unit, next_id: Id) {
    let ni = uidx(s, next_id).unwrap();
    let nb = s.units[ni].body_of;
    let rest: Vec<usize> = s.units.iter().enumerate().filter(|(_, o)| o.body_of == nb).map(|(i, _)| i).collect();
    let k = rest.iter().position(|&i| i == ni).map_or(0, |k| k + 1);
    let behind: Vec<usize> = rest[k..].to_vec();
    {
        let next = &mut s.units[ni];
        let missing = next.max_hp - next.hp;
        next.ty = UnitType::Centipede;
        next.max_hp = unit_def(UnitType::Centipede).hp.unwrap() as i32 + if next.veteran { 5 } else { 0 };
        next.hp = next.max_hp - missing.min(next.max_hp - 1);
        next.body_of = None;
        next.moved = dead.moved;
        next.attacked = dead.attacked;
        next.can_move = dead.can_move;
        next.can_attack = dead.can_attack;
        next.done = dead.done;
    }
    for i in behind {
        s.units[i].body_of = Some(next_id);
    }
}

/// the 8 directions clockwise from north-west (S1 linked::FAN order)
const FAN: [Coord; 8] = [
    Coord::new(-1, -1),
    Coord::new(-1, 0),
    Coord::new(-1, 1),
    Coord::new(0, 1),
    Coord::new(1, 1),
    Coord::new(1, 0),
    Coord::new(1, -1),
    Coord::new(0, -1),
];

/// a new unit's facing: toward the middle of the board
fn facing_of(s: &GameState, u: &Unit) -> Coord {
    if let Some(d) = u.last_dir {
        if d.x != 0 || d.y != 0 {
            return d;
        }
    }
    let half = s.map_size / 2;
    let dx = half - u.x;
    let dy = half - u.y;
    let mut best = FAN[0];
    let mut score = 0;
    for d in FAN {
        let next = (d.x * dx + d.y * dy) * if d.x * d.x + d.y * d.y == 1 { 1393 } else { 985 };
        if score < next {
            best = d;
            score = next;
        }
    }
    best
}

/// Eat: a Segment is placed behind the body's tail on the first free tile it may stand on.
fn grow_segment(s: &mut GameState, head_id: Id) {
    let head = s.units[uidx(s, head_id).unwrap()].clone();
    let body = chain_body(s, head_id);
    let tail = match body.last() {
        Some(&i) => s.units[i].clone(),
        None => head.clone(),
    };
    let facing = facing_of(s, &tail);
    let dir = FAN.iter().position(|d| d.x == facing.x && d.y == facing.y).map_or(-1, |i| i as i32);
    let opposite = ((if dir < 0 { 7 } else { dir }) + 4) % 8;
    let mut probe = tail.clone();
    probe.ty = UnitType::Segment;
    probe.carried = None;
    for i in 1..=8i32 {
        let offset = if (i - 1) % 2 == 0 { i / 2 } else { -(i >> 1) };
        let d = FAN[((((offset + opposite) % 8) + 8) % 8) as usize];
        let x = tail.x + d.x;
        let y = tail.y + d.y;
        if x < 0 || y < 0 || x >= s.map_size || y >= s.map_size || occupant(s, x, y).is_some() {
            continue;
        }
        if enter_kind(s, &probe, tile_at(s, x, y)) != Some(StepKind::Normal) {
            continue;
        }
        let si = make_unit(s, UnitType::Segment, head.owner, Coord::new(x, y), None);
        s.units[si].body_of = Some(head_id);
        explore(s, head.owner, Coord::new(x, y), 1);
        return;
    }
}

fn do_attack(s: &mut GameState, uid: Id, tid: Id) {
    let ui = uidx(s, uid).unwrap();
    let p = s.units[ui].owner;
    let t0 = s.units[uidx(s, tid).unwrap()].clone();
    {
        let u = &mut s.units[ui];
        u.hidden = false;
        u.last_dir = Some(Coord::new(js_sign(t0.x - u.x), js_sign(t0.y - u.y)));
    }
    war_act(s, p, t0.owner);

    let u = s.units[uidx(s, uid).unwrap()].clone();
    if has(&u, Skill::Convert) {
        let head_id = t0.body_of.or(if t0.ty == UnitType::Centipede { Some(t0.id) } else { None });
        let group: Vec<usize> = match head_id {
            None => vec![uidx(s, tid).unwrap()],
            Some(h) => s.units.iter().enumerate().filter(|(_, o)| o.id == h || o.body_of == Some(h)).map(|(i, _)| i).collect(),
        };
        let cap = capital_of(s, p).or_else(|| cities_of(s, p).first().copied()).map(|ci| s.cities[ci].id);
        for gi in group {
            let o = &mut s.units[gi];
            o.owner = p;
            if !has(o, Skill::Independent) {
                o.home_city = cap;
            }
            o.can_move = false;
            o.can_attack = false;
            o.done = true;
        }
        if u.ty == UnitType::Shaman {
            let pl = &mut s.players[p as usize];
            pl.conversions = Some(pl.conversions.unwrap_or(0) + 1);
        }
        let ui = uidx(s, uid).unwrap();
        end_unit(&mut s.units[ui]);
        s.units[ui].attacked = true;
        return;
    }
    let target = s.units[uidx(s, tid).unwrap()].clone();
    let r = compute_damage_rounded(s, &u, &target);
    if r.damage > 0 && !target.hidden {
        s.players[p as usize].attacked_this_turn = true;
    }
    let from = pos(&target);
    let killed = damage(s, tid, r.damage, Some(&u), None);
    if let Some(ti) = uidx(s, tid) {
        s.units[ti].bubble = false;
    }
    if has(&u, Skill::Drench) {
        flood_at(s, p, from.x, from.y);
    }
    if !killed && has(&u, Skill::Freeze) {
        if let Some(ti) = uidx(s, tid) {
            s.units[ti].frozen = true;
        }
    }
    if !killed && has(&u, Skill::Poison) {
        if let Some(ti) = uidx(s, tid) {
            s.units[ti].poisoned = true;
        }
    }
    // splash (ranged units only)
    if has(&u, Skill::Splash) && unit_def(u.ty).range > 1 {
        let snapshot: Vec<Id> = s.units.iter().map(|o| o.id).collect();
        for eid in snapshot {
            let Some(ei) = uidx(s, eid) else { continue };
            let e = s.units[ei].clone();
            if !can_harm(s, p, e.owner) || dist(e.x, e.y, from.x, from.y) != 1 || e.id == uid {
                continue;
            }
            if has(&u, Skill::Poison) {
                s.units[ei].poisoned = true;
                continue;
            }
            let cur = uidx(s, uid).map_or(u.clone(), |i| s.units[i].clone());
            let d = half_damage(compute_damage_rounded(s, &cur, &e).damage);
            damage(s, eid, d, Some(&cur), None);
        }
    }
    if !killed {
        let ti = uidx(s, tid).unwrap();
        let tg = s.units[ti].clone();
        let cur = s.units[uidx(s, uid).unwrap()].clone();
        let retaliates = !tg.frozen
            && !has(&cur, Skill::Surprise)
            && !has(&tg, Skill::Stiff)
            && udist(&cur, &tg) <= unit_def(tg.ty).range
            && s.players[tg.owner as usize].explored[idx(s.map_size, cur.x, cur.y)] == 1
            && r.retaliation > 0;
        if retaliates {
            damage(s, uid, r.retaliation, Some(&tg), None);
            if let Some(ui) = uidx(s, uid) {
                if has(&tg, Skill::Poison) {
                    s.units[ui].poisoned = true;
                }
            }
        }
    }
    let Some(ui) = uidx(s, uid) else { return };
    s.units[ui].attacked = true;
    s.units[ui].can_attack = false;
    // Double Attack: a second attack this turn
    if has(&s.units[ui], Skill::DoubleAttack) && !s.units[ui].second_attack {
        s.units[ui].second_attack = true;
        s.units[ui].can_attack = true;
    }
    // melee advance into the killed unit's tile
    let cur = s.units[ui].clone();
    if killed && unit_def(cur.ty).range < 2 && occupant(s, from.x, from.y).is_none() {
        let kind = enter_kind(s, &cur, tile_at(s, from.x, from.y));
        if kind == Some(StepKind::Normal) || kind == Some(StepKind::Embark) {
            let origin = pos(&cur);
            s.units[ui].x = from.x;
            s.units[ui].y = from.y;
            let moved = s.units[ui].clone();
            let rr = sight_radius(s, &moved);
            explore(s, p, from, rr);
            after_move(s, uid, kind.unwrap(), origin);
        }
    }
    let Some(ui) = uidx(s, uid) else { return };
    let cur = s.units[ui].clone();
    // Escape: may move again after attacking; a skater only while it ends on ice
    let escape = has(&cur, Skill::Escape) && !(has(&cur, Skill::Skate) && !tile_at(s, cur.x, cur.y).ice);
    s.units[ui].can_move = escape && !cur.frozen && !cur.done;
    // Cymanti Centipede Eat
    if killed && has(&cur, Skill::Eat) {
        grow_segment(s, uid);
    }
    if killed && has(&cur, Skill::Persist) {
        let ui = uidx(s, uid).unwrap();
        let mut probe = s.units[ui].clone();
        probe.can_attack = true;
        if !attack_targets(s, &probe).is_empty() {
            s.units[ui].can_attack = true;
        }
    }
}

/* ---------- capture, ruins, infiltration ---------- */

fn do_capture(s: &mut GameState, uid: Id) {
    let ui = uidx(s, uid).unwrap();
    let u = s.units[ui].clone();
    let p = u.owner;
    let ti = tidx(s, u.x, u.y);
    s.units[ui].hidden = false;
    if s.tiles[ti].village {
        let ci = new_city(s, pos(&u), p);
        claim_territory(s, ci, 1);
        let c = &s.cities[ci];
        let (cpos, cid, name) = (Coord::new(c.x, c.y), c.id, c.name.clone());
        explore(s, p, cpos, 1);
        if !has(&u, Skill::Independent) {
            s.units[ui].home_city = Some(cid);
        }
        log(s, &format!("captured village -> {name}"));
    } else {
        let Some(ci) = city_by_id(s, s.tiles[ti].city_id) else {
            end_unit(&mut s.units[ui]);
            return;
        };
        let cid = s.cities[ci].id;
        let old = s.cities[ci].owner;
        war_act(s, p, old);
        if s.cities[ci].capital {
            for oi in cities_of(s, old) {
                if oi == ci || !s.cities[oi].connected {
                    continue;
                }
                s.cities[oi].connected = false;
                s.cities[oi].pop -= 1;
                s.cities[ci].pop -= 1;
            }
        } else if s.cities[ci].connected {
            let old_cap = capital_of(s, old);
            s.cities[ci].pop -= 1;
            if let Some(oc) = old_cap {
                s.cities[oc].pop -= 1;
            }
        }
        // a captured Polaris city's land changes to the captor's style
        if s.players[old as usize].tribe == Tribe::Polaris && s.players[p as usize].tribe != Tribe::Polaris {
            for tt in s.tiles.iter_mut() {
                if tt.territory == Some(cid) {
                    tt.polar = false;
                }
            }
        }
        {
            let c = &mut s.cities[ci];
            c.owner = p;
            c.capital = c.original_capital_of == Some(p);
            c.connected = false;
        }
        for o in s.units.iter_mut() {
            if o.owner == old && o.home_city == Some(cid) {
                o.home_city = None;
            }
        }
        // reveal the whole old territory
        let n = s.map_size;
        for i in 0..s.tiles.len() {
            if s.tiles[i].territory == Some(cid) {
                explore(s, p, Coord::new(i as i32 % n, i as i32 / n), 0);
            }
        }
        if let Some(oc) = s.cities[ci].original_capital_of {
            for o in s.players.iter_mut() {
                o.embassies.retain(|&h| h != oc);
            }
        }
        if !has(&u, Skill::Independent) {
            let ui = uidx(s, uid).unwrap();
            s.units[ui].home_city = Some(cid);
        }
        update_connections(s, old);
        update_connections(s, p);
        let name = s.cities[ci].name.clone();
        log(s, &format!("captured {name} from player {old}"));
    }
    // the city tile becomes field, flooded by Aquarion and drained by any other
    let aquarion = s.players[p as usize].tribe == Tribe::Aquarion;
    let t = &mut s.tiles[ti];
    t.terrain = Terrain::Field;
    if aquarion {
        t.flooded = true;
    } else if t.flooded {
        t.flooded = false;
    }
    let ui = uidx(s, uid).unwrap();
    end_unit(&mut s.units[ui]);
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuinPick {
    Resources,
    Population,
    NewFriends,
    Scroll,
    Explorer,
    LostCity,
}

impl RuinPick {
    fn id(self) -> &'static str {
        match self {
            RuinPick::Resources => "resources",
            RuinPick::Population => "population",
            RuinPick::NewFriends => "newFriends",
            RuinPick::Scroll => "scroll",
            RuinPick::Explorer => "explorer",
            RuinPick::LostCity => "lostCity",
        }
    }
}

fn do_examine(s: &mut GameState, uid: Id) {
    let ui = uidx(s, uid).unwrap();
    let u = s.units[ui].clone();
    let p = u.owner;
    let pu = p as usize;
    let n = s.map_size;
    let ti = tidx(s, u.x, u.y);
    s.tiles[ti].ruin = false;
    s.units[ui].hidden = false;
    end_unit(&mut s.units[ui]);
    let mut options = vec![RuinPick::Resources, RuinPick::Population];
    if !is_water(&s.tiles[ti]) || s.players[pu].has_tech(Tech::Sailing) {
        options.push(RuinPick::NewFriends);
    }
    let researchable: Vec<Tech> = Tech::ALL.into_iter().filter(|&t| can_research(s, p, t)).collect();
    if !researchable.is_empty() {
        options.push(RuinPick::Scroll);
    }
    let fog_near = any_around(n, pos(&u), 2, false, |q| s.players[pu].explored[idx(n, q.x, q.y)] != 1);
    let enterable = any_around(n, pos(&u), 1, false, |q| explorer_can_enter(s, p, tile_at(s, q.x, q.y)));
    if enterable && fog_near {
        options.push(RuinPick::Explorer);
    }
    let pick = if s.players[pu].tribe == Tribe::Aquarion && valid_lost_city(s, pos(&u)) {
        RuinPick::LostCity
    } else {
        with_rng(s, |r| r.pick(&options))
    };
    match pick {
        RuinPick::Resources => s.players[pu].stars += RUIN_STARS,
        RuinPick::Scroll => {
            let tech = with_rng(s, |r| r.pick(&researchable));
            s.players[pu].techs.push(tech);
        }
        RuinPick::Population => {
            if let Some(cap) = capital_of(s, p) {
                add_pop(s, cap, 3);
            }
        }
        RuinPick::Explorer => run_explorer(s, p, pos(&u)),
        RuinPick::LostCity => raise_lost_city(s, uid),
        RuinPick::NewFriends => {
            let water = is_water(&s.tiles[ti]);
            push_aside(s, uid, p, 0);
            // spawn on the ruin tile itself
            let at = Coord::new(ti as i32 % n, ti as i32 / n);
            let ni = make_unit(s, if water { UnitType::Rammer } else { UnitType::Swordsman }, p, at, None);
            let nu = &mut s.units[ni];
            if water {
                nu.carried = Some(UnitType::Warrior);
                nu.hp = 15;
                nu.max_hp = 15;
            } else {
                nu.hp = unit_def(UnitType::Swordsman).hp.unwrap() as i32 + 5;
                nu.max_hp = nu.hp;
            }
            nu.veteran = true;
            explore(s, p, at, 1);
        }
    }
    log(s, &format!("ruin: {}", pick.id()));
}

/// an unowned ocean tile off the board's edge with no city, village or ruin within two tiles
fn valid_lost_city(s: &GameState, at: Coord) -> bool {
    let t = tile_at(s, at.x, at.y);
    let n = s.map_size;
    if at.x <= 0 || at.y <= 0 || at.x >= n - 1 || at.y >= n - 1 {
        return false;
    }
    if t.terrain != Terrain::Ocean || t.territory.is_some() {
        return false;
    }
    !any_around(n, at, 2, false, |q| {
        let o = tile_at(s, q.x, q.y);
        o.city_id.is_some() || o.village || o.ruin
    })
}

/// Aquarion Lost City: shallow water around, a level-1 city on a flooded field
fn raise_lost_city(s: &mut GameState, uid: Id) {
    let ui = uidx(s, uid).unwrap();
    let u = s.units[ui].clone();
    let p = u.owner;
    let at = pos(&u);
    for q in around(s.map_size, at, 1, false) {
        let qi = tidx(s, q.x, q.y);
        let o = &mut s.tiles[qi];
        if !o.ice && o.city_id.is_none() && !o.village {
            o.terrain = Terrain::Water;
        }
    }
    let ti = tidx(s, at.x, at.y);
    {
        let t = &mut s.tiles[ti];
        t.terrain = Terrain::Field;
        t.resource = None;
        t.flooded = true;
    }
    let ci = new_city(s, at, p);
    claim_territory(s, ci, 1);
    let cid = s.cities[ci].id;
    explore(s, p, at, 1);
    let ui = uidx(s, uid).unwrap();
    if !has(&u, Skill::Independent) {
        s.units[ui].home_city = Some(cid);
    }
    // a water-only unit can't stand on the new land
    let cur = s.units[ui].clone();
    if unit_def(cur.ty).naval && !has(&cur, Skill::Carry) && enter_kind(s, &cur, &s.tiles[ti]).is_none() {
        push_aside(s, uid, p, 0);
    }
}

/// terrain player p's techs let it move on
fn explorer_can_enter(s: &GameState, p: i32, t: &Tile) -> bool {
    let pl = &s.players[p as usize];
    if t.city_id.is_some() || t.building == Some(Build::Bridge) || t.ice || t.algae {
        return true;
    }
    match t.terrain {
        Terrain::Mountain => pl.has_tech(Tech::Climbing),
        Terrain::Water => pl.has_tech(Tech::Fishing) || pl.tribe == Tribe::Aquarion,
        Terrain::Ocean => pl.has_tech(Tech::Sailing),
        _ => true,
    }
}

/// actions.ts runExplorer: EXPLORER_STEPS automatic moves into the fog
pub fn run_explorer(s: &mut GameState, p: i32, from: Coord) {
    let pu = p as usize;
    let n = s.map_size;
    const INF: i64 = i64::MAX;
    let mut cur = from;
    let passable = |s: &GameState, q: Coord| -> bool {
        if s.players[pu].explored[idx(n, q.x, q.y)] != 1 {
            return true; // may walk into fog
        }
        explorer_can_enter(s, p, tile_at(s, q.x, q.y))
    };
    let sight = |s: &GameState, q: Coord| if tile_at(s, q.x, q.y).terrain == Terrain::Mountain { 2 } else { 1 };
    let uncovers = |s: &GameState, q: Coord| -> i64 {
        let mut c = 0;
        crate::grid::for_around(n, q, 1, true, |r| {
            if s.players[pu].explored[idx(n, r.x, r.y)] != 1 {
                c += 1;
            }
        });
        c
    };
    let lighthouse_dist = |s: &GameState, q: Coord| -> i64 {
        let mut best = INF;
        for (i, t) in s.tiles.iter().enumerate() {
            if !t.lighthouse || s.players[pu].lighthouses.contains(&(i as i32)) {
                continue;
            }
            best = best.min(dist(q.x, q.y, i as i32 % n, i as i32 / n) as i64);
        }
        best
    };
    let fog_distance = |s: &GameState| -> Vec<i64> {
        let nn = (n * n) as usize;
        let mut d = vec![INF; nn];
        let mut queue: Vec<usize> = Vec::new();
        for i in 0..nn {
            if s.players[pu].explored[i] != 1 {
                d[i] = 0;
                queue.push(i);
            }
        }
        let mut h = 0;
        while h < queue.len() {
            let i = queue[h];
            h += 1;
            for q in around(n, Coord::new(i as i32 % n, i as i32 / n), 1, false) {
                let j = idx(n, q.x, q.y);
                if d[j] != INF || !passable(s, q) {
                    continue;
                }
                d[j] = d[i] + 1;
                queue.push(j);
            }
        }
        d
    };
    let lowest = |cands: &[(Coord, i64)]| -> Vec<Coord> {
        let top = cands.iter().map(|c| c.1).min().unwrap_or(INF);
        cands.iter().filter(|c| c.1 == top).map(|c| c.0).collect()
    };
    explore(s, p, cur, 1);
    for _ in 0..EXPLORER_STEPS {
        let options: Vec<Coord> = around(n, cur, 1, false).into_iter().filter(|&q| passable(s, q)).collect();
        if options.is_empty() {
            break;
        }
        let gains: Vec<(Coord, i64)> = options.iter().map(|&q| (q, -uncovers(s, q))).collect();
        let mut cands: Vec<Coord> = if gains.iter().map(|g| g.1).min().unwrap() < 0 {
            lowest(&gains)
        } else {
            let d = fog_distance(s);
            let near: Vec<(Coord, i64)> = options.iter().map(|&q| (q, d[idx(n, q.x, q.y)])).collect();
            if near.iter().all(|c| c.1 == INF) {
                break;
            }
            lowest(&near)
        };
        if cands.len() > 1 {
            let keyed: Vec<(Coord, i64)> = cands.iter().map(|&q| (q, lighthouse_dist(s, q))).collect();
            cands = lowest(&keyed);
        }
        let choice = if cands.len() == 1 { cands[0] } else { with_rng(s, |r| r.pick(&cands)) };
        cur = choice;
        let r = sight(s, cur);
        explore(s, p, cur, r);
    }
}

fn do_infiltrate(s: &mut GameState, uid: Id, cid: Id) {
    let ui = uidx(s, uid).unwrap();
    let u = s.units.remove(ui);
    let p = u.owner;
    let ci = cidx(s, cid).unwrap();
    war_act(s, p, s.cities[ci].owner);
    if u.ty == UnitType::Moth {
        moth_infiltrate(s, &u, ci);
        return;
    }
    let (cx, cy) = (s.cities[ci].x, s.cities[ci].y);
    if let Some(oi) = occupant(s, cx, cy) {
        if s.units[oi].owner != p {
            let mut dagger = u.clone();
            dagger.ty = UnitType::Dagger;
            dagger.hp = 10;
            dagger.max_hp = 10;
            let occ = s.units[oi].clone();
            let r = compute_damage_rounded(s, &dagger, &occ);
            damage(s, occ.id, r.damage, None, Some(p));
        }
    }
    let c = s.cities[ci].clone();
    let stolen = if c.capital { c.level + 1 } else { c.level };
    s.players[p as usize].stars += stolen + if c.workshop { 1 } else { 0 } + c.parks;
    s.cities[ci].riot = true;
    let count = c.level.min(5);
    // spawn order: the city, then defensive tiles, then other land inside the borders, then water
    let climbing = s.players[p as usize].has_tech(Tech::Climbing);
    let n = s.map_size;
    let mut spots: Vec<(usize, i32)> = s
        .tiles
        .iter()
        .enumerate()
        .filter(|(_, t)| t.territory == Some(c.id) && (t.terrain != Terrain::Mountain || climbing))
        .map(|(i, t)| {
            let (x, y) = (i as i32 % n, i as i32 / n);
            let sc = (if x == c.x && y == c.y { 100 } else { 0 })
                + (if is_water(t) { 0 } else { 10 })
                + (if t.terrain == Terrain::Forest || t.terrain == Terrain::Mountain { 20 } else { 0 })
                + (if t.resource.is_some() { 1 } else { 0 });
            (i, sc)
        })
        .collect();
    spots.sort_by(|a, b| b.1.cmp(&a.1)); // stable, like Array.prototype.sort
    let mut made = 0;
    let aqua = s.players[p as usize].tribe == Tribe::Aquarion; // Scuba: amphibious Mermaid Daggers
    for (i, _) in spots {
        if made >= count {
            break;
        }
        let (x, y) = (i as i32 % n, i as i32 / n);
        if occupant(s, x, y).is_some() {
            continue;
        }
        let water = is_water(&s.tiles[i]);
        let ty = if aqua {
            UnitType::MermaidDagger
        } else if water {
            UnitType::Pirate
        } else {
            UnitType::Dagger
        };
        let ni = make_unit(s, ty, p, Coord::new(x, y), None);
        if water && !aqua {
            s.units[ni].carried = Some(UnitType::Dagger);
        }
        made += 1;
    }
    log(s, &format!("infiltrated {}", c.name));
}

/// Moth: poisons the defender and lays Insect Eggs on free land; steals no stars
fn moth_infiltrate(s: &mut GameState, u: &Unit, ci: usize) {
    let p = u.owner;
    s.cities[ci].riot = true;
    let c = s.cities[ci].clone();
    if let Some(oi) = occupant(s, c.x, c.y) {
        if s.units[oi].owner != p {
            let occ = s.units[oi].clone();
            let d = compute_damage_rounded(s, u, &occ).damage;
            let killed = damage(s, occ.id, d, None, Some(p));
            if !killed {
                let oi = uidx(s, occ.id).unwrap();
                s.units[oi].poisoned = true;
            }
        }
    }
    let count = c.level.min(5);
    let mut made = 0;
    let n = s.map_size;
    for i in 0..s.tiles.len() {
        let (x, y) = (i as i32 % n, i as i32 / n);
        let t = &s.tiles[i];
        if made >= count || t.territory != Some(c.id) || is_water(t) || occupant(s, x, y).is_some() {
            continue;
        }
        if t.terrain == Terrain::Mountain && !s.players[p as usize].has_tech(Tech::Climbing) {
            continue;
        }
        make_unit(s, UnitType::InsectEgg, p, Coord::new(x, y), None);
        made += 1;
    }
    log(s, &format!("moth infiltrated {}", c.name));
}

/* ---------- builds ---------- */

fn do_build(s: &mut GameState, p: i32, b: Build, at: Coord) {
    let pu = p as usize;
    let def = build_def(b);
    let ti = tidx(s, at.x, at.y);
    let cost = if b == Build::Embassy { embassy_cost(s.players[pu].embassies.len() as i32) } else { def.cost };
    s.players[pu].stars -= cost;
    if let Some(g) = def.gain {
        s.players[pu].stars += g;
    }
    let city = city_by_id(s, s.tiles[ti].territory);
    match def.kind {
        BuildKind::Harvest => {
            if b == Build::Fertilize {
                s.tiles[ti].resource = Some(Resource::Crop);
                return;
            }
            if b == Build::Canal {
                // the builder is spent (a hidden one revealed), then the tile floods
                if let Some(ui) = occupant(s, at.x, at.y) {
                    let u = &mut s.units[ui];
                    u.hidden = false;
                    end_unit(u);
                    u.moved = true;
                    u.attacked = true;
                }
                flood_at(s, p, at.x, at.y);
                return;
            }
            if b == Build::Algae {
                let t = &mut s.tiles[ti];
                t.algae = true;
                if t.resource.is_none() {
                    t.resource = Some(Resource::Fruit);
                }
                return;
            }
            if b == Build::EnchantAnimal {
                s.tiles[ti].resource = None;
                if let Some(oi) = occupant(s, at.x, at.y) {
                    let oid = s.units[oi].id;
                    push_aside(s, oid, p, 0);
                }
                make_unit(s, UnitType::Polytaur, p, at, None);
                explore(s, p, at, 1);
                return;
            }
            if b == Build::ClearForest {
                s.tiles[ti].terrain = Terrain::Field;
            } else if b == Build::BurnForest {
                s.tiles[ti].terrain = Terrain::Field;
                s.tiles[ti].resource = Some(Resource::Crop);
                return;
            } else if b == Build::GrowForest {
                s.tiles[ti].terrain = Terrain::Forest;
                s.tiles[ti].resource = None;
                return;
            }
            if def.resource.is_some() {
                s.tiles[ti].resource = None;
            }
            if let Some(ci) = city {
                if def.pop != 0 {
                    add_pop(s, ci, def.pop);
                }
            }
            if b == Build::ClearForest {
                s.tiles[ti].resource = None;
            }
        }
        BuildKind::Road => s.tiles[ti].road = true,
        BuildKind::Bridge => s.tiles[ti].building = Some(Build::Bridge),
        BuildKind::Embassy => {
            let hc = city_by_id(s, s.tiles[ti].city_id).unwrap();
            let host = s.cities[hc].owner;
            s.players[pu].embassies.push(host);
            explore(s, p, at, 1);
            meet(s, host, p); // receiving an embassy makes the host meet the sender
        }
        BuildKind::Destroy => {
            let old = s.tiles[ti].building;
            let level = s.tiles[ti].building_level;
            if let Some(ci) = city {
                let lost = old.map_or(0, |o| build_def(o).pop) + if old.and_then(feeds).is_some() { 0 } else { level_pop(old, level) };
                s.cities[ci].pop -= lost;
            }
            let t = &mut s.tiles[ti];
            t.building = None;
            t.building_level = 0;
            t.decomposing = false;
            unfeed(s, p, at, old);
        }
        _ => {
            {
                let turn = s.turn;
                let t = &mut s.tiles[ti];
                t.building = Some(b);
                t.built_turn = turn;
                t.building_level = 0;
                t.decomposing = false;
            }
            if b == Build::IceBank {
                let pl = &mut s.players[pu];
                let mut v = pl.built_unique.clone().unwrap_or_default();
                v.push(b);
                pl.built_unique = Some(v);
            }
            if def.kind == BuildKind::Monument {
                s.players[pu].monuments.push(b);
            }
            if let Some(ci) = city {
                if def.pop != 0 {
                    add_pop(s, ci, def.pop);
                }
            }
            // leveling buildings (§5.5)
            if let Some(&(_, _, per_level)) = FEEDS.iter().find(|f| f.1 == b) {
                let feeders: Vec<Build> = FEEDS.iter().filter(|f| f.1 == b).map(|f| f.0).collect();
                let mut count = 0;
                crate::grid::for_around(s.map_size, at, 1, false, |q| {
                    if let Some(qb) = tile_at(s, q.x, q.y).building {
                        if feeders.contains(&qb) && own_tile(s, p, q.x, q.y) {
                            count += 1;
                        }
                    }
                });
                let lvl = LEVEL_CAP.min(count);
                s.tiles[ti].building_level = lvl;
                if let Some(ci) = city {
                    add_pop(s, ci, lvl * per_level);
                }
            }
            if feeds(b).is_some() {
                feed(s, p, at, b);
            }
        }
    }
}

fn level_pop(building: Option<Build>, level: i32) -> i32 {
    let Some(b) = building else { return 0 };
    if b == Build::Fungi {
        return level; // +1 population per growth level
    }
    match FEEDS.iter().find(|f| f.1 == b) {
        Some(f) => f.2 * level,
        None => 0,
    }
}

/// a feeder (farm/lumber hut/mine) was built or removed: adjust adjacent leveling buildings
fn feed(s: &mut GameState, p: i32, at: Coord, feeder: Build) {
    let (to, per_level) = feeds(feeder).unwrap();
    let n = s.map_size;
    let feeders: Vec<Build> = FEEDS.iter().filter(|f| f.1 == to).map(|f| f.0).collect();
    for q in around(n, at, 1, false) {
        let qi = tidx(s, q.x, q.y);
        if s.tiles[qi].building != Some(to) || !own_tile(s, p, q.x, q.y) {
            continue;
        }
        let before = s.tiles[qi].building_level;
        let mut count = 0;
        crate::grid::for_around(n, q, 1, false, |r| {
            if let Some(rb) = tile_at(s, r.x, r.y).building {
                if feeders.contains(&rb) && own_tile(s, p, r.x, r.y) {
                    count += 1;
                }
            }
        });
        s.tiles[qi].building_level = LEVEL_CAP.min(count);
        let gained = (s.tiles[qi].building_level - before) * per_level;
        if let Some(ci) = city_by_id(s, s.tiles[qi].territory) {
            if gained != 0 {
                if gained > 0 {
                    add_pop(s, ci, gained);
                } else {
                    s.cities[ci].pop += gained;
                }
            }
        }
    }
}

fn unfeed(s: &mut GameState, p: i32, at: Coord, old: Option<Build>) {
    if let Some(o) = old {
        if feeds(o).is_some() {
            feed(s, p, at, o);
        }
    }
}

/* ---------- rewards ---------- */

fn do_reward(s: &mut GameState, ci: usize, reward: Reward) {
    let p = s.cities[ci].owner;
    if !s.cities[ci].pending_rewards.is_empty() {
        s.cities[ci].pending_rewards.remove(0);
    }
    let at = Coord::new(s.cities[ci].x, s.cities[ci].y);
    match reward {
        Reward::Workshop => s.cities[ci].workshop = true,
        Reward::Explorer => run_explorer(s, p, at),
        Reward::CityWall => s.cities[ci].walls = true,
        Reward::Resources => s.players[p as usize].stars += REWARD_RESOURCES_STARS,
        Reward::PopulationGrowth => add_pop(s, ci, REWARD_POP_GROWTH),
        Reward::BorderGrowth => {
            claim_territory(s, ci, 2);
            explore(s, p, at, 2);
        }
        Reward::Park => s.cities[ci].parks += 1,
        Reward::SuperUnit => {
            if let Some(oi) = occupant(s, at.x, at.y) {
                let oid = s.units[oi].id;
                push_aside(s, oid, p, 0);
            }
            let su = super_unit_for(s.players[p as usize].tribe);
            let cid = s.cities[ci].id;
            make_unit(s, su, p, at, Some(cid));
            explore(s, p, at, 1);
        }
    }
}
