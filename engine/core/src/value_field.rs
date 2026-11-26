//! Value field over tiles (issue #76): value iteration on the tile graph for the greedy-full
//! bot's moves. [EMAI RL 2.0 p.107: value iteration on a gridworld]
//!
//! The lecture's gridworld MDP: the state is a tile, the actions are the 8 king steps, rewards
//! sit at goal tiles and synchronous Bellman backups propagate them. Here the goal tiles are
//! what a land unit of player p wants to reach: claimable villages, ruins, enemy cities
//! (weighted by level), visible enemy units, own cities under threat and the frontier (explored
//! passable tiles next to fog). Edges follow passable terrain; a step costs what movement.rs
//! charges (half on a road-to-road step, plus half a tile for a step that ends the move on a
//! mountain, algae or a forest); zone of control and the Polaris ice glide are left out.
//!
//! Two engineering extensions of the lecture's unit-step gridworld:
//! - step costs: a step of cost c (in half tiles) discounts by gamma^(c/2) instead of gamma;
//! - an absorbing "collect" action: on every tile the agent may stop and take that tile's
//!   reward, so V(i) = max(R(i), max_j gamma^(c(i,j)/2) * V(j)) and rewards do not add up along
//!   a path (no cluster or frontier-strip inflation).
//!
//! The solver works in log space: with R = (1/gamma)^(B/2), phi = 2 * log_{1/gamma} V gives
//! phi(i) = max(B(i), max_j phi(j) - c(i,j)). The fixed point and the greedy policy are the same
//! as in gamma space (the map is monotone), and with integer rewards and costs in half tiles
//! every value is exact, so the result does not depend on summation order. `phi / 2` is then
//! "reward in tiles minus path length in tiles" to the best target, the same unit as goal()'s
//! progress, so one knob is sized alike for near and far units. A test runs the literal
//! gamma-space backup next to it (bot_full tests, field_matches_lab_value_iteration).
//!
//! Fog is never passable (no hidden terrain is read). The map is built once per decision and
//! player, in GoalCache, on first use with field != 0. Each thread keeps its last solved board:
//! an equal board (the whole graph and every reward compared) shares its values, which skips
//! most solves between consecutive decisions of a turn without changing a value. The solver's
//! padded buffers are per-thread scratch, reused by every solve.
use crate::bot::GoalCache;
use crate::diplomacy::{at_peace, friendly};
use crate::grid::{idx, in_bounds, is_water};
use crate::movement::{can_see, has, tech_of};
use crate::state::{city_by_id, CityOwners};
use crate::types::*;

/// at most this many synchronous backups (the issue's 10-20); the loop stops early once no
/// value changes
pub(crate) const FIELD_K: usize = 20;
/// "no target within reach" (minus infinity); never used in arithmetic
pub(crate) const UNREACH: i32 = i32::MIN / 4;
// rewards, in half tiles
/// a claimable village: 3 tiles
const B_VILLAGE: i32 = 6;
/// a ruin: 2 tiles
const B_RUIN: i32 = 4;
/// a visible hostile unit: 1 tile
const B_UNIT: i32 = 2;
/// the frontier (an explored passable tile with an unexplored neighbour): 0 tiles
const B_FRONTIER: i32 = 0;
/// an enemy city: level 1 3 tiles, level 3 5, capped at level 4 (6 tiles)
fn b_city(level: i32) -> i32 {
    2 * (2 + level.clamp(1, 4))
}
/// an own city with a hostile unit within FIELD_DEFEND_RADIUS: level 1 4 tiles .. level 3+ 6
fn b_defend(level: i32) -> i32 {
    2 * (3 + level.clamp(1, 3))
}
/// fixed, independent of the defendRadius knob
const FIELD_DEFEND_RADIUS: i32 = 2;
// step costs, in half tiles
/// road-to-road step: 0.5 tiles
const C_ROAD: i32 = 1;
/// any other step: 1 tile
const C_STEP: i32 = 2;
/// a step that ends the move (into a mountain, or a forest off the road): +0.5 tiles
const C_STOP: i32 = 1;
/// nominal discount of the gamma-space reference: R = (1/gamma)^(B/2) maps the log form to it
#[cfg(test)]
pub(crate) const FIELD_GAMMA: f64 = 0.8;

/// tile flags of FieldBoard::fl
/// a walking land unit of the player could stand here: explored, land (or ice, algae, bridge),
/// no mountain without Climbing, no non-friendly unit the player knows of
const PASS: u8 = 1;
/// road-network tile for the player (movement.rs MoveCtx::road_at), not on ice
const ROAD: u8 = 2;
/// entering ends the move whatever the road: a mountain, or algae for a unit that does not swim
const STOP: u8 = 4;
/// a forest: entering ends the move unless the step is a road step
const FOREST: u8 = 8;

/// the tile graph and the rewards of one player, as the solver reads them
#[derive(PartialEq)]
pub(crate) struct FieldBoard {
    pub(crate) n: i32,
    /// PASS | ROAD | STOP | FOREST per tile
    fl: Vec<u8>,
    /// the reward of standing on a tile (UNREACH: none)
    pub(crate) b: Vec<i32>,
    /// the rewards a unit keeps by staying: villages, ruins, threatened own cities
    pub(crate) hold: Vec<i32>,
}

impl FieldBoard {
    pub(crate) fn new(s: &GameState, p: i32) -> FieldBoard {
        let n = s.map_size;
        let nn = (n * n) as usize;
        let ex = &s.players[p as usize].explored;
        let climbing = tech_of(s, p, Tech::Climbing);
        let co = CityOwners::new(s);
        // per tile: 1 = a non-friendly unit the player knows of stands here (as MoveCtx's
        // occupied), 2 = an own unit stands here
        const BLOCKED: u8 = 1;
        const OWN: u8 = 2;
        let mut units = vec![0u8; nn];
        for o in &s.units {
            let i = idx(n, o.x, o.y);
            if o.owner == p {
                units[i] |= OWN;
            }
            if (!o.hidden || can_see(s, p, o)) && !(o.owner == p || friendly(s, p, Some(o.owner))) {
                units[i] |= BLOCKED;
            }
        }
        let mut fl = vec![0u8; nn];
        for (i, t) in s.tiles.iter().enumerate() {
            let land = !is_water(t) || t.ice || t.algae || t.building == Some(Build::Bridge);
            let pass = ex[i] == 1 && land && (t.terrain != Terrain::Mountain || climbing) && units[i] & BLOCKED == 0;
            let road = !t.ice
                && (t.road || t.building == Some(Build::Bridge) || t.village || t.city_id.is_some())
                && {
                    let o = co.owner(t.territory);
                    o.is_none() || friendly(s, p, o)
                };
            fl[i] = pass as u8 * PASS
                | road as u8 * ROAD
                | (t.terrain == Terrain::Mountain || t.algae) as u8 * STOP
                | (t.terrain == Terrain::Forest) as u8 * FOREST;
        }
        // rewards: hold (kept by staying) and the others in b (taken by arriving)
        let mut hold = vec![UNREACH; nn];
        let mut b = vec![UNREACH; nn];
        for (i, t) in s.tiles.iter().enumerate() {
            if ex[i] != 1 {
                continue;
            }
            let (x, y) = (i as i32 % n, i as i32 / n);
            if t.village {
                hold[i] = hold[i].max(B_VILLAGE);
            }
            if t.ruin {
                hold[i] = hold[i].max(B_RUIN);
            }
            if let Some(o) = co.owner(t.city_id) {
                let level = city_by_id(s, t.city_id).map(|ci| s.cities[ci].level).unwrap_or(1);
                if o == p {
                    if crate::bot_full::threatened_city_at(s, p, x, y, FIELD_DEFEND_RADIUS) {
                        hold[i] = hold[i].max(b_defend(level));
                    }
                } else if !at_peace(s, p, o) {
                    b[i] = b[i].max(b_city(level));
                }
            }
            if fl[i] & PASS != 0 {
                let fog_next = (-1..=1).any(|dy| {
                    (-1..=1).any(|dx| (dx, dy) != (0, 0) && in_bounds(n, x + dx, y + dy) && ex[idx(n, x + dx, y + dy)] != 1)
                });
                if fog_next {
                    b[i] = b[i].max(B_FRONTIER);
                }
            }
        }
        // hostile units the player can see (a hidden one only when can_see, as for blocking)
        for e in &s.units {
            let i = idx(n, e.x, e.y);
            if e.owner != p && !at_peace(s, p, e.owner) && ex[i] == 1 && (!e.hidden || can_see(s, p, e)) {
                b[i] = b[i].max(B_UNIT);
            }
        }
        // a tile an own unit holds is no target for another unit (anti-jam)
        for i in 0..nn {
            if units[i] & OWN == 0 {
                b[i] = b[i].max(hold[i]);
            }
        }
        FieldBoard { n, fl, b, hold }
    }

    /// a walking land unit of the player could stand on tile i
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn pass(&self, i: usize) -> bool {
        self.fl[i] & PASS != 0
    }

    /// (solve() inlines this and neighbours() on a padded grid; the tests use both directly)
    /// cost in half tiles of the step from i to its neighbour j, as movement.rs search_until
    /// charges a walking unit: road to road (neither on ice) 0.5, else 1; +0.5 when the step
    /// ends the move (a mountain, algae, or a forest unless the step is a road step).
    /// Left out on purpose: zone of control (units move every turn), the Polaris ice glide (0.9)
    /// and the Creep skill (creep units are no walkers here, see walks()).
    #[cfg_attr(not(test), allow(dead_code))]
    #[inline]
    pub(crate) fn cost(&self, i: usize, j: usize) -> i32 {
        step(self.fl[i], self.fl[j])
    }

    /// in-bounds 8-neighbours of tile i, in a fixed dy, dx order
    #[cfg_attr(not(test), allow(dead_code))]
    #[inline]
    pub(crate) fn neighbours(&self, i: usize, mut f: impl FnMut(usize)) {
        let n = self.n;
        let (x, y) = (i as i32 % n, i as i32 / n);
        for dy in -1..=1 {
            for dx in -1..=1 {
                if (dx, dy) != (0, 0) && in_bounds(n, x + dx, y + dy) {
                    f(idx(n, x + dx, y + dy));
                }
            }
        }
    }

    /// value iteration in log space (Jacobi, two buffers): phi_0 = B,
    /// phi_{k+1}(i) = max(B(i), max_j phi_k(j) - c(i,j)) on passable tiles, B(i) elsewhere
    /// (targets on enemy-held tiles are terminal). [EMAI RL 2.0 p.107: value iteration on a gridworld]
    /// Returns (phi, backups run); fewer than FIELD_K backups means it converged.
    pub(crate) fn solve(&self) -> (Vec<i32>, usize) {
        SCRATCH.with(|sc| self.solve_in(&mut sc.borrow_mut()))
    }

    fn solve_in(&self, sc: &mut Scratch) -> (Vec<i32>, usize) {
        // a grid padded by one impassable UNREACH ring: neighbours at fixed offsets, no bounds tests
        let n = self.n as usize;
        let m = n + 2;
        let pad = |i: usize| (i / n + 1) * m + i % n + 1;
        let Scratch { fl, b, cur, stamp, dirty, changed } = sc;
        for (v, x) in [(&mut *fl, 0u8), (&mut *stamp, 0u8)] {
            v.clear();
            v.resize(m * m, x);
        }
        b.clear();
        b.resize(m * m, UNREACH);
        dirty.clear();
        for i in 0..self.b.len() {
            let q = pad(i);
            b[q] = self.b[i];
            fl[q] = self.fl[i];
            if self.fl[i] & PASS != 0 {
                dirty.push(q as u32);
            }
        }
        let mi = m as isize;
        // the neighbours in neighbours()' dy, dx order
        let off: [isize; 8] = [-mi - 1, -mi, -mi + 1, -1, 1, mi - 1, mi, mi + 1];
        // Jacobi backups: every new value is computed from the previous sweep's values, then all
        // are written at once. A tile none of whose neighbours changed in the last sweep would
        // compute its own value again, so each sweep after the first only visits the passable
        // neighbours of the tiles that changed (the same values, fewer reads).
        // Impassable tiles keep B; B >= UNREACH, and UNREACH - c < UNREACH never wins the max.
        cur.clear();
        cur.extend_from_slice(b);
        let mut iters = FIELD_K;
        for k in 0..FIELD_K {
            changed.clear();
            for &q in dirty.iter() {
                let q = q as usize;
                let fi = fl[q];
                let mut best = b[q];
                for &d in &off {
                    let j = (q as isize + d) as usize;
                    best = best.max(cur[j] - step(fi, fl[j]));
                }
                if best != cur[q] {
                    changed.push((q as u32, best));
                }
            }
            if changed.is_empty() {
                iters = k + 1;
                break;
            }
            dirty.clear();
            let mark = (k + 1) as u8;
            for &(q, v) in changed.iter() {
                let q = q as usize;
                cur[q] = v;
                for &d in &off {
                    let j = (q as isize + d) as usize;
                    if fl[j] & PASS != 0 && stamp[j] != mark {
                        stamp[j] = mark;
                        dirty.push(j as u32);
                    }
                }
            }
        }
        ((0..self.b.len()).map(|i| cur[pad(i)]).collect(), iters)
    }
}

/// the cost in half tiles of a step from a tile with flags fi to one with flags fj
#[inline]
fn step(fi: u8, fj: u8) -> i32 {
    let road_step = fi & fj & ROAD != 0;
    let stop = fj & STOP != 0 || (fj & FOREST != 0 && !road_step);
    (if road_step { C_ROAD } else { C_STEP }) + if stop { C_STOP } else { 0 }
}

/// the solver's padded work buffers, reused by every solve of a thread
#[derive(Default)]
struct Scratch {
    fl: Vec<u8>,
    b: Vec<i32>,
    cur: Vec<i32>,
    stamp: Vec<u8>,
    dirty: Vec<u32>,
    changed: Vec<(u32, i32)>,
}

/// a solved board: the board, its values and the backups run
struct Solved {
    board: FieldBoard,
    phi: Vec<i32>,
    iters: usize,
}

thread_local! {
    /// the last board this thread solved, with its values (shared with the FieldMaps built on it)
    static LAST: std::cell::RefCell<Option<std::rc::Rc<Solved>>> = const { std::cell::RefCell::new(None) };
    static SCRATCH: std::cell::RefCell<Scratch> = std::cell::RefCell::new(Scratch::default());
}

/// the solved field of one player
pub(crate) struct FieldMap {
    pub(crate) owner: i32,
    solved: std::rc::Rc<Solved>,
}

impl FieldMap {
    pub(crate) fn new(s: &GameState, owner: i32) -> FieldMap {
        let board = FieldBoard::new(s, owner);
        // solve is a pure function of the board: the last solved board of this thread is kept,
        // and an equal board (consecutive decisions of a turn often build one) reuses its values
        let solved = LAST.with(|last| {
            let mut last = last.borrow_mut();
            if let Some(prev) = last.as_ref() {
                if prev.board == board {
                    return prev.clone();
                }
            }
            let (phi, iters) = board.solve();
            let solved = std::rc::Rc::new(Solved { board, phi, iters });
            *last = Some(solved.clone());
            solved
        });
        FieldMap { owner, solved }
    }

    /// the value of every tile, in half tiles (UNREACH: no target within reach); read by the tests
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn phi(&self) -> &[i32] {
        &self.solved.phi
    }

    /// backups run (FIELD_K: did not converge); read by the tests and the timing bench
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn iters(&self) -> usize {
        self.solved.iters
    }

    /// progress in tiles of moving u to `to`: (phi[to] - max(phi[u], hold[u])) / 2, where hold
    /// is what u gives up by leaving; 0 when either side is UNREACH
    pub(crate) fn dphi(&self, s: &GameState, u: &Unit, to: Coord) -> f64 {
        let n = s.map_size;
        let a = idx(n, u.x, u.y);
        let phi = &self.solved.phi;
        let here = phi[a].max(self.solved.board.hold[a]);
        let there = phi[idx(n, to.x, to.y)];
        if here <= UNREACH || there <= UNREACH {
            return 0.0;
        }
        (there - here) as f64 / 2.0
    }
}

/// walking land units only: no ships, flyers, amphibious units, skaters or creepers (creep
/// units take no road discount and no forest or algae stop, which the field's costs assume)
pub(crate) fn walks(u: &Unit) -> bool {
    !crate::data::unit_def(u.ty).naval
        && !has(u, Skill::Fly)
        && !has(u, Skill::Amphibious)
        && !has(u, Skill::Skate)
        && !has(u, Skill::Creep)
}

/// FieldMap::dphi through the per-decision cache (None: a map built for this call only)
pub(crate) fn field_dphi(s: &GameState, u: &Unit, to: Coord, cache: &mut Option<GoalCache>) -> f64 {
    match cache {
        Some(c) => {
            if c.field.as_ref().is_none_or(|f| f.owner != u.owner) {
                c.field = Some(FieldMap::new(s, u.owner));
            }
            c.field.as_ref().unwrap().dphi(s, u, to)
        }
        None => FieldMap::new(s, u.owner).dphi(s, u, to),
    }
}
