//! Economy plan (issue #68): a finite-horizon dynamic programme over one representative
//! city's economy, solved exactly by backward induction (RL lecture 2, slides 63-64), and the
//! advantage it gives an economy purchase, in discounted stars.
//!
//! Abstract state x = (h, p, k, s): rounds left, the city's cumulative population (levels
//! reached plus current pop), the pop supply still buildable in the city with owned techs, and
//! the bank per city. Actions within a round: BUY one pop for PI stars (one site less, the
//! level-up rewards the greedy bot would pick on the way), CONSUME one star (army or anything
//! else, worth 1), END the round (income inc[p] arrives, discounted by GAMMA). V(0, .) = s.
//! Every constant is derived from the engine tables (data.rs, data_gen.rs): PI from the pop
//! builds, the rewards from REWARD_RESOURCES_STARS, REWARD_POP_GROWTH and the super unit's
//! cost, the growth path from a mirror of state::add_pop.
//!
//! The table depends only on PI, the reward picks and the super-unit cost (one per model per
//! process, built on first use when `plan` != 0, cached in PLAN_TABLES). Per decision the bot
//! builds a PlanCtx (one pass over the map: each own city's p and k, and the supply each
//! researchable tech would add), then the advantage of a purchase is a few table lookups:
//!
//! Every purchase is priced as the value of buying it now rather than one round later,
//! (1 - GAMMA) * (its value against never buying it - lambda * cost), so research and builds
//! sit on one scale (issue #68 review: the never-baseline alone put builds 10-20x above
//! research and piled a quarter of the positive build advantages at the cap):
//!
//! - pop build (harvest, building, leveling building; a feeder's credit to an adjacent
//!   leveling building goes to that building's city): value = sum of dV over the cities + M *
//!   the market income it adds (a leveling building next to an own market, or a feeder that
//!   raises such a building's level). dV compares the city with the pop against the city
//!   without it, both with the site removed from the supply k (build now vs never): with the
//!   site left in the baseline's k the DP buys that same pop there at PI, and dV reduces to
//!   lambda * PI * pop whatever the level-up it finishes. So A is large when the city's other
//!   supply cannot finish the level the pop completes. A city with negative pop (a captured
//!   city) first repays it: those pops reach no level and no reward, +1 income each (M each).
//!   Ports and outposts are not priced and not supply: their value is naval access.
//! - market: value = M * star gain, M = lambda * sum_{j=1..h} GAMMA^j (+1 star a round)
//! - research: value = U, the value of the sites the tech opens in every city (the DP with
//!   the extra supply against without it) plus, for Trade, each city's best market (M * gain -
//!   lambda * cost, at least 0)
//!
//! lambda = the marginal value of a star (dV/ds over PI stars, mean over our cities), >= 1.
//! Every advantage is clamped to +-PLAN_A_CAP. Train, Upgrade and all other actions get none.
//!
//! Known gaps: Philosophy's cheaper research is not priced; the capital bonus, embassies and
//! road connections are not in inc; the city count is fixed (no captures); the bank is pooled
//! but split evenly across cities, and Trade's markets are valued as if all were built at
//! once (the cap bounds it in empires of many cities); one generic PI prices future pop; a
//! once-per-city building and another build may both count the same free tile in k; a
//! feeder's level credit to a leveling building of another city is not that city's supply;
//! a captured city's negative pop is not in its income or in the research value of its sites;
//! Polaris' ice bank and Cymanti's clathrus are not markets here; points (data.rs SCORE: pop,
//! levels, tech tiers) are not modelled, only stars, so pop that finishes no level within the
//! horizon is worth nothing although it scores points; cities above level 12 (p > P_MAX) are
//! clamped. The table is stored in f64 (15.8 MB) rather than f32, so that the slope-in-s
//! invariant holds to 1e-6.
use crate::bot::GoalCache;
use crate::bot_full::FullWeights;
use crate::data::*;
use crate::data_gen::{BUILDS, FEEDS};
use crate::grid::{idx, is_water};
use crate::state::{can_research, tech_cost};
use crate::types::*;
use std::sync::{Arc, Mutex, OnceLock};

/// discount per round (fixed): stars bind over about 20 rounds
pub const GAMMA: f64 = 0.95;
pub const H_MAX: usize = 50;
/// cumulative pop of level 12 (the engine has no level cap; LEVEL_CAP caps building levels)
pub const P_MAX: usize = 77;
pub const K_MAX: usize = 15;
pub const S_MAX: usize = 30;
/// the advantage is clamped to +- this many stars: at the largest sweep value (8) the term
/// stays below 80, under a train (~95) or a farm (~127). Pop builds reach about 6, markets 7,
/// research 5 (Trade in an empire of many cities more)
pub const PLAN_A_CAP: f64 = 10.0;

const NH: usize = H_MAX + 1;
const NP: usize = P_MAX + 1;
const NK: usize = K_MAX + 1;
const NS: usize = S_MAX + 1;

/// stars per pop: round(sum cost / sum pop) over the generic (not tribe-only) pop harvests and
/// buildings that need a tech (26 / 9 -> 3)
pub fn pi() -> i32 {
    let (mut cost, mut pop) = (0, 0);
    for b in BUILDS.iter() {
        if matches!(b.kind, BuildKind::Harvest | BuildKind::Building) && b.pop > 0 && b.tech.is_some() && !tribe_only_build(b.id) {
            cost += b.cost;
            pop += b.pop;
        }
    }
    js_round(cost as f64 / pop as f64) as i32
}

/// the reward the full bot picks at a level-up to `level`: the first maximum of the score
/// score_full_with gives Action::Reward (base * ty * id when the base is positive, else
/// open * id - 1, with base = greedy.rewards[r] and id = reward[r]). full_best_of keeps an
/// action only when it scores above 0; when neither option does, it answers with the first
/// legal action, which is opts[0].
pub fn reward_pick(w: &FullWeights, level: i32) -> Reward {
    let opts = reward_options(level);
    let t = crate::bot_full::full_type_index(&Action::Reward { city: 0, reward: opts[0] }).unwrap();
    let v = |r: Reward| {
        let base = w.greedy.rewards[r as usize].unwrap_or(1.0);
        let id = w.reward[r as usize];
        if base > 0.0 {
            base * w.ty[t] * id
        } else {
            w.open[t] * id - 1.0
        }
    };
    let (v0, v1) = (v(opts[0]), v(opts[1]));
    if v1 > v0 && v1 > 0.0 {
        opts[1]
    } else {
        opts[0]
    }
}

/// state::add_pop on (level, pop): (level', pop', levels gained)
pub fn sim_add_pop(level: i32, pop: i32, n: i32) -> (i32, i32, i32) {
    let (mut level, mut pop, mut gained) = (level, pop + n, 0);
    while pop >= level + 1 {
        pop -= level + 1;
        level += 1;
        gained += 1;
    }
    (level, pop, gained)
}

/// cumulative pop of a city at (level, pop): sum over l = 1..level-1 of (l + 1), plus pop
pub fn cumulative_pop(level: i32, pop: i32) -> i32 {
    (level - 1) * (level + 2) / 2 + pop
}

/// (level, pop) of cumulative pop p
pub fn level_pop_of(p: i32) -> (i32, i32) {
    let (l, q, _) = sim_add_pop(1, 0, p.max(0));
    (l, q)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlanKey {
    pub pi: i32,
    /// the picks at levels 2, 3, 4 and 5+
    pub picks: [Reward; 4],
    pub super_cost: i32,
}

impl PlanKey {
    pub fn new(w: &FullWeights, tribe: Tribe) -> PlanKey {
        PlanKey {
            pi: pi(),
            picks: [reward_pick(w, 2), reward_pick(w, 3), reward_pick(w, 4), reward_pick(w, 5)],
            super_cost: unit_def(super_unit_for(tribe)).cost,
        }
    }
    fn pick(&self, level: i32) -> Reward {
        self.picks[(level.clamp(2, 5) - 2) as usize]
    }
}

pub struct PlanTable {
    pub key: PlanKey,
    /// income of a non-capital city at cumulative pop p
    pub inc: [i32; NP],
    /// cumulative pop after buying one pop at p (free-pop rewards cascaded), at most P_MAX
    pub next: [usize; NP],
    /// one-off stars of the step p -> next[p] (Resources)
    pub stars_on: [i32; NP],
    /// one-off consumption of that step (SuperUnit)
    pub cons_on: [i32; NP],
    /// V[h][p][k][s]
    v: Vec<f64>,
    /// sum_{j=1..h} GAMMA^j
    pub annuity: [f64; NH],
}

#[inline]
fn vi(h: usize, p: usize, k: usize, s: usize) -> usize {
    ((h * NP + p) * NK + k) * NS + s
}

impl PlanTable {
    /// the growth path and the exact backward induction
    pub fn solve(key: PlanKey) -> PlanTable {
        let mut inc = [0; NP];
        let mut next = [0; NP];
        let mut stars_on = [0; NP];
        let mut cons_on = [0; NP];
        for p in 0..NP {
            let (l, _) = level_pop_of(p as i32);
            let workshop = (l >= 2 && key.pick(2) == Reward::Workshop) as i32;
            let parks = (5..=l).filter(|&lv| key.pick(lv) == Reward::Park).count() as i32;
            inc[p] = l + workshop + parks;
            let (q0l, q0p) = level_pop_of(p as i32);
            let (mut lv, mut pop, _) = sim_add_pop(q0l, q0p, 1);
            let (mut stars, mut cons) = (0, 0);
            // levels reached in this step, in order; a free-pop reward can reach more
            let mut reached = q0l + 1;
            while reached <= lv {
                match key.pick(reached) {
                    Reward::Resources => stars += REWARD_RESOURCES_STARS,
                    Reward::PopulationGrowth => {
                        let (l2, p2, _) = sim_add_pop(lv, pop, REWARD_POP_GROWTH);
                        lv = l2;
                        pop = p2;
                    }
                    Reward::SuperUnit => cons += key.super_cost,
                    _ => {}
                }
                reached += 1;
            }
            next[p] = (cumulative_pop(lv, pop) as usize).min(P_MAX);
            stars_on[p] = stars;
            cons_on[p] = cons;
        }
        let mut annuity = [0.0; NH];
        for h in 1..NH {
            annuity[h] = annuity[h - 1] + GAMMA.powi(h as i32);
        }
        let pi = key.pi as usize;
        let mut v = vec![0.0f64; NH * NP * NK * NS];
        for h in 0..NH {
            for p in (0..NP).rev() {
                for k in 0..NK {
                    for s in 0..NS {
                        let val = if h == 0 {
                            s as f64
                        } else {
                            let mut best = GAMMA * v[vi(h - 1, p, k, (s + inc[p] as usize).min(S_MAX))];
                            if s >= 1 {
                                best = best.max(1.0 + v[vi(h, p, k, s - 1)]);
                            }
                            if k >= 1 && s >= pi {
                                let s2 = (s - pi + stars_on[p] as usize).min(S_MAX);
                                best = best.max(cons_on[p] as f64 + v[vi(h, next[p], k - 1, s2)]);
                            }
                            best
                        };
                        v[vi(h, p, k, s)] = val;
                    }
                }
            }
        }
        PlanTable { key, inc, next, stars_on, cons_on, v, annuity }
    }

    /// V(h, p, k, s) at a fractional bank s (linear between grid points, slope 1 above S_MAX)
    pub fn value(&self, h: usize, p: usize, k: usize, s: f64) -> f64 {
        let base = vi(h.min(H_MAX), p.min(P_MAX), k.min(K_MAX), 0);
        let s = s.max(0.0);
        if s >= S_MAX as f64 {
            return self.v[base + S_MAX] + (s - S_MAX as f64);
        }
        let i = s.floor() as usize;
        let f = s - i as f64;
        let a = self.v[base + i];
        if f == 0.0 {
            a
        } else {
            a + f * (self.v[base + i + 1] - a)
        }
    }

    /// the marginal value of a star: [V(s + PI) - V(s)] / PI
    pub fn lambda(&self, h: usize, p: usize, k: usize, s: f64) -> f64 {
        let pi = self.key.pi as f64;
        (self.value(h, p, k, s + pi) - self.value(h, p, k, s)) / pi
    }

    /// p after d bought pops, and the one-off (stars, consumption) collected on the way
    pub fn advance(&self, p: usize, d: i32) -> (usize, i32, i32) {
        let (mut p, mut stars, mut cons) = (p.min(P_MAX), 0, 0);
        for _ in 0..d.max(0) {
            if p >= P_MAX {
                break;
            }
            stars += self.stars_on[p];
            cons += self.cons_on[p];
            p = self.next[p];
        }
        (p, stars, cons)
    }
}

static PLAN_TABLES: OnceLock<Mutex<Vec<(PlanKey, Arc<PlanTable>)>>> = OnceLock::new();

thread_local! {
    /// the last table this thread used (saves the lock on every decision)
    static LAST_TABLE: std::cell::RefCell<Option<Arc<PlanTable>>> = const { std::cell::RefCell::new(None) };
}

/// the solved table for `key` (solved once per process)
pub fn plan_table(key: PlanKey) -> Arc<PlanTable> {
    if let Some(t) = LAST_TABLE.with(|l| l.borrow().as_ref().filter(|t| t.key == key).cloned()) {
        return t;
    }
    let t = {
        let mut all = PLAN_TABLES.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap();
        match all.iter().find(|(k, _)| *k == key) {
            Some((_, t)) => t.clone(),
            None => {
                let t = Arc::new(PlanTable::solve(key));
                all.push((key, t.clone()));
                t
            }
        }
    };
    LAST_TABLE.with(|l| *l.borrow_mut() = Some(t.clone()));
    t
}

/// rounds left in the plan: Perfection counts down to its turn cap, other modes have none
pub fn horizon(s: &GameState) -> usize {
    if s.mode == GameMode::Perfection {
        // turns 0..max_turns-1 are played and no income follows the last one (check_game_end
        // runs before start_turn): incomes still to come
        (s.max_turns - 1 - s.turn).clamp(0, H_MAX as i32) as usize
    } else {
        H_MAX
    }
}

pub struct CityPlan {
    pub id: Id,
    /// cumulative pop of the city's level and its pop above 0, 0..=P_MAX
    pub p: usize,
    /// negative pop (a captured city): the first pops only repay it, +1 income each, no level
    pub deficit: i32,
    /// owned pop supply, 0..=K_MAX
    pub k: usize,
    /// extra supply per researchable tech
    pub tech_k: [u8; Tech::COUNT],
    /// the best market income a market on a free tile of the city would earn, when the market's
    /// tech is researchable (not owned) and the city has no market yet
    pub market: i32,
}

/// the builds the plan prices and counts as supply: harvests and buildings, but not ports and
/// outposts (their value is naval access, which the plan does not model; issue #68 review)
#[inline]
pub fn priced_build(b: Build) -> bool {
    matches!(build_def(b).kind, BuildKind::Harvest | BuildKind::Building) && !matches!(b, Build::Port | Build::Outpost)
}

/// can_build_on's terrain test (actions.rs): the build's terrain, or Aquarion's windmills,
/// sawmills, forges and markets on water without ice
#[inline]
fn terrain_ok(tribe: Tribe, b: &crate::data_gen::BuildDef, t: &Tile) -> bool {
    b.allows(t.terrain) || (tribe == Tribe::Aquarion && is_water(t) && !t.ice && matches!(b.id, Build::Windmill | Build::Sawmill | Build::Forge | Build::Market))
}

/// per-city pop credits of a build: (index into PlanCtx::cities, pop, pop from own supply)
pub struct Credits {
    pub n: usize,
    pub e: [(usize, i32, i32); 9],
}

/// the per-decision context of the plan for the player to move
pub struct PlanCtx {
    pub table: Arc<PlanTable>,
    pub h: usize,
    pub sbar: f64,
    /// mean marginal value of a star over our cities
    pub lambda: f64,
    /// the value of +1 star per round
    pub m: f64,
    pub cities: Vec<CityPlan>,
    /// per tile: index into `cities` of its territory city when ours, else -1
    own: Vec<i16>,
    p: i32,
}

/// the leveling building `b` is fed by: population per level, or None
#[inline]
fn leveling(b: Build) -> Option<i32> {
    FEEDS.iter().find(|f| f.1 == b).map(|f| f.2)
}

impl PlanCtx {
    pub fn new(s: &GameState, w: &FullWeights) -> PlanCtx {
        let p = s.current;
        let pl = &s.players[p as usize];
        let table = plan_table(PlanKey::new(w, pl.tribe));
        let n = s.map_size;
        let mut cities: Vec<CityPlan> = s
            .cities
            .iter()
            .filter(|c| c.owner == p)
            .map(|c| CityPlan {
                id: c.id,
                p: (cumulative_pop(c.level, c.pop.max(0)).max(0) as usize).min(P_MAX),
                deficit: (-c.pop).max(0),
                k: 0,
                tech_k: [0; Tech::COUNT],
                market: 0,
            })
            .collect();
        let h = horizon(s);
        let c_n = cities.len();
        let sbar = if c_n > 0 { pl.stars as f64 / c_n as f64 } else { 0.0 };
        let mut own = vec![-1i16; s.tiles.len()];
        if c_n == 0 || h == 0 {
            return PlanCtx { table, h, sbar, lambda: 1.0, m: 0.0, cities, own, p };
        }
        for (i, t) in s.tiles.iter().enumerate() {
            if let Some(id) = t.territory {
                if let Some(j) = cities.iter().position(|c| c.id == id) {
                    own[i] = j as i16;
                }
            }
        }
        let owned: [bool; Tech::COUNT] = std::array::from_fn(|i| pl.has_tech(Tech::ALL[i]));
        let researchable: [bool; Tech::COUNT] = std::array::from_fn(|i| can_research(s, p, Tech::ALL[i]));
        // the builds that can add pop for this tribe
        let cands: Vec<&crate::data_gen::BuildDef> = BUILDS
            .iter()
            .filter(|b| {
                priced_build(b.id)
                    && b.id != Build::Market
                    && (b.pop > 0 || leveling(b.id).is_some())
                    && b.tech.is_some_and(|t| owned[t as usize] || researchable[t as usize])
                    && build_allowed_for(pl.tribe, b.id)
            })
            .collect();
        // once-per-city buildings: (city, build) -> best yield; the ones a city already has
        let mut uniq: Vec<(usize, Build, i32)> = Vec::new();
        for (i, t) in s.tiles.iter().enumerate() {
            if own[i] >= 0 {
                if let Some(b) = t.building {
                    if build_def(b).one_per_city {
                        uniq.push((own[i] as usize, b, -1));
                    }
                }
            }
        }
        // Trade's markets: priced in research only while the tech is researchable
        let market_def = build_def(Build::Market);
        let market_open = build_allowed_for(pl.tribe, Build::Market) && market_def.tech.is_some_and(|t| !owned[t as usize] && researchable[t as usize]);
        for (i, t) in s.tiles.iter().enumerate() {
            // can_build: no building, city, village, ruin or lighthouse on the tile
            if own[i] < 0 || t.building.is_some() || t.city_id.is_some() || t.village || t.ruin || t.lighthouse {
                continue;
            }
            let c = own[i] as usize;
            let (x, y) = (i as i32 % n, i as i32 / n);
            if market_open && terrain_ok(pl.tribe, market_def, t) && !uniq.iter().any(|e| e.0 == c && e.1 == Build::Market) {
                let gain = market_gain_at(s, &own, x, y);
                cities[c].market = cities[c].market.max(gain);
            }
            let mut best_owned = 0;
            let mut best_t = [0i32; Tech::COUNT];
            for b in &cands {
                if !terrain_ok(pl.tribe, b, t) || (b.resource.is_some() && b.resource != t.resource) || (matches!(b.id, Build::Atoll | Build::AquaFarm) && t.ice) {
                    continue;
                }
                let d = yield_at(s, &own, x, y, b);
                if d.is_none() {
                    continue;
                }
                let d = d.unwrap();
                if d <= 0 {
                    continue;
                }
                let tech = b.tech.unwrap() as usize;
                if b.one_per_city {
                    match uniq.iter_mut().find(|e| e.0 == c && e.1 == b.id) {
                        Some(e) => {
                            if e.2 >= 0 {
                                e.2 = e.2.max(d)
                            }
                        }
                        None => uniq.push((c, b.id, d)),
                    }
                    continue;
                }
                if owned[tech] {
                    best_owned = best_owned.max(d);
                } else {
                    best_t[tech] = best_t[tech].max(d);
                }
            }
            let cp = &mut cities[c];
            cp.k += best_owned as usize;
            for (ti, &d) in best_t.iter().enumerate() {
                if d > best_owned {
                    cp.tech_k[ti] = cp.tech_k[ti].saturating_add((d - best_owned).min(255) as u8);
                }
            }
        }
        for &(c, b, d) in &uniq {
            if d <= 0 {
                continue;
            }
            let tech = build_def(b).tech.unwrap() as usize;
            if owned[tech] {
                cities[c].k += d as usize;
            } else {
                cities[c].tech_k[tech] = cities[c].tech_k[tech].saturating_add(d.min(255) as u8);
            }
        }
        for cp in cities.iter_mut() {
            cp.k = cp.k.min(K_MAX);
            for x in cp.tech_k.iter_mut() {
                *x = (*x).min(K_MAX as u8);
            }
        }
        let lambda = cities.iter().map(|c| table.lambda(h, c.p, c.k, sbar)).sum::<f64>() / c_n as f64;
        let m = lambda * table.annuity[h];
        PlanCtx { table, h, sbar, lambda, m, cities, own, p }
    }

    /// dV of city c gaining d pop, `used` pop of it from the city's own supply: the city with
    /// the pop against the city without it, both without the site the pop comes from (build
    /// now vs never). Comparing against the supply that still holds the site would let the DP
    /// buy that same pop at PI in the baseline, and A would collapse to lambda * (PI * d - cost)
    /// (issue #68 review).
    /// A city with negative pop first repays it: those pops reach no level and no reward, they
    /// only raise income by 1 each (state.rs city_income), worth M each.
    fn dv(&self, c: usize, d: i32, used: i32) -> f64 {
        let cp = &self.cities[c];
        let t = &self.table;
        let k = (cp.k as i32).max(used).min(K_MAX as i32);
        let k_after = (k - used).max(0) as usize;
        let repay = d.min(cp.deficit).max(0);
        let (p2, stars, cons) = t.advance(cp.p, d - repay);
        self.m * repay as f64 + cons as f64 + t.value(self.h, p2, k_after, self.sbar + stars as f64) - t.value(self.h, cp.p, k_after, self.sbar)
    }

    /// the market income of the own market on tile `m`, uncapped (state.rs market_income)
    fn market_sum(&self, s: &GameState, m: usize) -> i32 {
        let n = s.map_size;
        let mut sum = 0;
        for_adjacent(n, m as i32 % n, m as i32 / n, |j| {
            let nt = &s.tiles[j];
            if self.own[j] >= 0 && matches!(nt.building, Some(Build::Windmill | Build::Sawmill | Build::Forge)) {
                sum += 1.max(nt.building_level);
            }
        });
        sum
    }

    /// the market income a leveling building or a feeder on `at` adds to adjacent own markets:
    /// the new building's level (a leveling building), or the level it adds to adjacent own
    /// leveling buildings below the cap (a feeder), each market capped at MARKET_CAP
    pub fn market_delta(&self, s: &GameState, b: Build, at: Coord) -> i32 {
        let n = s.map_size;
        let is_market_lev = |x: Build| matches!(x, Build::Windmill | Build::Sawmill | Build::Forge);
        // (market tile, added income) per affected market
        let mut add: [(usize, i32); 16] = [(0, 0); 16];
        let mut na = 0;
        let credit = |m: usize, g: i32, add: &mut [(usize, i32); 16], na: &mut usize| {
            if let Some(e) = add[..*na].iter_mut().find(|e| e.0 == m) {
                e.1 += g;
            } else if *na < add.len() {
                add[*na] = (m, g);
                *na += 1;
            }
        };
        if is_market_lev(b) {
            let mut count = 0;
            for_adjacent(n, at.x, at.y, |j| {
                if self.own[j] >= 0 && s.tiles[j].building.is_some_and(|qb| FEEDS.iter().any(|f| f.1 == b && f.0 == qb)) {
                    count += 1;
                }
            });
            let g = 1.max(LEVEL_CAP.min(count));
            for_adjacent(n, at.x, at.y, |j| {
                if self.own[j] >= 0 && s.tiles[j].building == Some(Build::Market) {
                    credit(j, g, &mut add, &mut na);
                }
            });
        }
        if let Some((to, _)) = feeds(b) {
            if is_market_lev(to) {
                for_adjacent(n, at.x, at.y, |q| {
                    let qt = &s.tiles[q];
                    if qt.building == Some(to) && self.own[q] >= 0 && qt.building_level < LEVEL_CAP {
                        let g = 1.max(qt.building_level + 1) - 1.max(qt.building_level);
                        if g > 0 {
                            for_adjacent(n, q as i32 % n, q as i32 / n, |m| {
                                if self.own[m] >= 0 && s.tiles[m].building == Some(Build::Market) {
                                    credit(m, g, &mut add, &mut na);
                                }
                            });
                        }
                    }
                });
            }
        }
        add[..na].iter().map(|&(m, g)| {
            let sum = self.market_sum(s, m);
            MARKET_CAP.min(sum + g) - MARKET_CAP.min(sum)
        }).sum()
    }

    /// the star gain of a market on `at`: adjacent own windmill, sawmill and forge levels (a
    /// level-0 one counts 1), capped (state.rs market_income)
    pub fn market_gain(&self, s: &GameState, at: Coord) -> i32 {
        market_gain_at(s, &self.own, at.x, at.y)
    }

    /// the pop build `b` on `at` adds to our cities, as do_build and feed() credit it:
    /// (index into `cities`, pop, pop of it taken from that city's own supply). The build's own
    /// city gets its pop, its level from adjacent own feeders (leveling building) and the levels
    /// it adds to adjacent leveling buildings of the same city (feeder); a leveling building of
    /// another city credits that city, from no site of its own.
    pub fn build_credits(&self, s: &GameState, b: Build, at: Coord) -> Credits {
        let mut out = Credits { n: 0, e: [(0, 0, 0); 9] };
        let def = build_def(b);
        let n = s.map_size;
        let ti = idx(n, at.x, at.y);
        if !priced_build(b) || b == Build::Market || self.own[ti] < 0 {
            return out;
        }
        let c = self.own[ti] as usize;
        let mut d_own = def.pop;
        if let Some(per_level) = leveling(b) {
            let mut count = 0;
            for_adjacent(n, at.x, at.y, |j| {
                if self.own[j] >= 0 && s.tiles[j].building.is_some_and(|qb| FEEDS.iter().any(|f| f.1 == b && f.0 == qb)) {
                    count += 1;
                }
            });
            d_own += LEVEL_CAP.min(count) * per_level;
        }
        out.e[0] = (c, 0, 0);
        out.n = 1;
        if let Some((to, per_level)) = feeds(b) {
            for_adjacent(n, at.x, at.y, |j| {
                let q = &s.tiles[j];
                if q.building == Some(to) && self.own[j] >= 0 && q.building_level < LEVEL_CAP {
                    let cj = self.own[j] as usize;
                    if cj == c {
                        d_own += per_level;
                    } else if let Some(e) = out.e[1..out.n].iter_mut().find(|e| e.0 == cj) {
                        e.1 += per_level;
                    } else {
                        out.e[out.n] = (cj, per_level, 0);
                        out.n += 1;
                    }
                }
            });
        }
        out.e[0] = (c, d_own, d_own);
        out
    }

    /// (1 - GAMMA) * (the build's value against never building it - lambda * cost): the value of
    /// building now rather than next round, on the scale of the research term
    fn build_advantage(&self, s: &GameState, b: Build, at: Coord) -> f64 {
        let def = build_def(b);
        if !priced_build(b) {
            return 0.0;
        }
        if b == Build::Market {
            let gain = self.market_gain(s, at);
            if gain <= 0 {
                return 0.0;
            }
            return (1.0 - GAMMA) * (self.m * gain as f64 - self.lambda * def.cost as f64);
        }
        let cr = self.build_credits(s, b, at);
        let md = self.market_delta(s, b, at);
        if md <= 0 && cr.e[..cr.n].iter().all(|e| e.1 <= 0) {
            return 0.0;
        }
        let mut a = self.m * md as f64;
        for &(c, d, used) in &cr.e[..cr.n] {
            if d > 0 {
                a += self.dv(c, d, used);
            }
        }
        (1.0 - GAMMA) * (a - self.lambda * def.cost as f64)
    }

    fn research_advantage(&self, s: &GameState, tech: Tech) -> f64 {
        let t = &self.table;
        let mut u = 0.0;
        let opens_market = build_def(Build::Market).tech == Some(tech);
        let market_cost = build_def(Build::Market).cost as f64;
        for cp in &self.cities {
            let extra = cp.tech_k[tech as usize] as usize;
            if extra > 0 {
                u += t.value(self.h, cp.p, (cp.k + extra).min(K_MAX), self.sbar) - t.value(self.h, cp.p, cp.k, self.sbar);
            }
            // the market the tech opens, net of its cost (the build term's value of it)
            if opens_market && cp.market > 0 {
                u += (self.m * cp.market as f64 - self.lambda * market_cost).max(0.0);
            }
        }
        let c = tech_cost(s, self.p, tech) as f64;
        (1.0 - GAMMA) * (u - self.lambda * c)
    }

    /// the clamped advantage of `a` (0 for actions the plan does not price)
    pub fn advantage(&self, s: &GameState, a: &Action) -> f64 {
        if self.cities.is_empty() || self.h == 0 {
            return 0.0;
        }
        let v = match *a {
            Action::Research { tech } => self.research_advantage(s, tech),
            Action::Build { at, building } => self.build_advantage(s, building, at),
            _ => 0.0,
        };
        v.clamp(-PLAN_A_CAP, PLAN_A_CAP)
    }
}

/// the market income of a market on (x, y): adjacent own windmill, sawmill and forge levels (a
/// level-0 one counts 1), capped (state.rs market_income)
fn market_gain_at(s: &GameState, own: &[i16], x: i32, y: i32) -> i32 {
    let mut sum = 0;
    for_adjacent(s.map_size, x, y, |j| {
        let nt = &s.tiles[j];
        if own[j] >= 0 && matches!(nt.building, Some(Build::Windmill | Build::Sawmill | Build::Forge)) {
            sum += 1.max(nt.building_level);
        }
    });
    MARKET_CAP.min(sum)
}

/// the pop yield to its own city of build `b` on the free own tile (x, y), or None when its
/// next-to rules fail: its pop, plus (leveling building) its level from adjacent own feeders,
/// plus (feeder) one level of each adjacent leveling building of the same city below the cap
/// (feed() credits a leveling building of another city to that city, so it is no supply here)
fn yield_at(s: &GameState, own: &[i16], x: i32, y: i32, b: &crate::data_gen::BuildDef) -> Option<i32> {
    let n = s.map_size;
    let here = own[idx(n, x, y)];
    let mut next_ok = b.next_to.is_empty();
    let mut terr_ok = b.next_to_terrain.is_none();
    let lev = leveling(b.id);
    let fd = feeds(b.id);
    let mut feeders = 0;
    let mut fed = 0;
    for_adjacent(n, x, y, |j| {
        let o = &s.tiles[j];
        if let Some(ob) = o.building {
            // can_build: the next-to building must stand on own territory
            if !next_ok && own[j] >= 0 && b.next_to.contains(&ob) {
                next_ok = true;
            }
            if own[j] >= 0 {
                if lev.is_some() && FEEDS.iter().any(|f| f.1 == b.id && f.0 == ob) {
                    feeders += 1;
                }
                if let Some((to, _)) = fd {
                    if ob == to && o.building_level < LEVEL_CAP && own[j] == here {
                        fed += 1;
                    }
                }
            }
        }
        if !terr_ok && own[j] >= 0 && b.next_to_terrain == Some(o.terrain) {
            terr_ok = true;
        }
    });
    if !next_ok || !terr_ok {
        return None;
    }
    let mut d = b.pop;
    if let Some(per) = lev {
        d += LEVEL_CAP.min(feeders) * per;
    }
    if let Some((_, per)) = fd {
        d += fed * per;
    }
    Some(d)
}

#[inline]
fn for_adjacent(n: i32, x: i32, y: i32, mut f: impl FnMut(usize)) {
    for dy in -1..=1 {
        for dx in -1..=1 {
            let (nx, ny) = (x + dx, y + dy);
            if (dx, dy) != (0, 0) && nx >= 0 && ny >= 0 && nx < n && ny < n {
                f(idx(n, nx, ny));
            }
        }
    }
}

/// the actions the plan prices: research and harvest/building builds but ports and outposts
#[inline]
pub fn is_purchase(a: &Action) -> bool {
    match *a {
        Action::Research { .. } => true,
        Action::Build { building, .. } => priced_build(building),
        _ => false,
    }
}

/// the clamped advantage of `a` for the player to move, through the per-decision cache
/// (None: a context built for this call only)
pub(crate) fn advantage(s: &GameState, a: &Action, w: &FullWeights, cache: &mut Option<GoalCache>) -> f64 {
    match cache {
        Some(c) => {
            if c.plan.is_none() {
                c.plan = Some(PlanCtx::new(s, w));
            }
            c.plan.as_ref().unwrap().advantage(s, a)
        }
        None => PlanCtx::new(s, w).advantage(s, a),
    }
}
