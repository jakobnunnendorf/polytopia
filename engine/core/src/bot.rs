//! Port of logic/engine/bot.ts: the greedy bot. It only picks from
//! legal_actions(), scoring each action by a hand-written heuristic, and ends
//! its turn when nothing scores above 0. Every number in the heuristic is a
//! named weight (models/<name>/model.json "weights").
//!
//! Scores are f64 and every expression keeps the TS evaluation order, so the
//! comparisons in bot_step pick exactly the action TS picks.
use crate::actions::apply_action;
use crate::combat::compute_damage_rounded;
use crate::data::{build_def, tech_def, unit_def};
use crate::diplomacy::at_peace;
use crate::grid::{dist, idx};
use crate::opinion::{accepts_peace, aggression_of, break_peace_score, offers_peace, opinion_value};
use crate::state::{city_by_id, tech_cost};
use crate::types::*;

/// bot.ts GreedyWeights; `rewards` indexed by Reward (None = key absent: TS `?? 1`)
#[derive(Clone, Debug, PartialEq)]
pub struct GreedyWeights {
    pub capture: f64,
    pub examine: f64,
    pub promote: f64,
    pub harvest_starfish: f64,
    pub monument: f64,
    pub kill: f64,
    pub hit: f64,
    pub special: f64,
    pub grow_base: f64,
    pub grow_per_pop: f64,
    pub other_build: f64,
    pub rich_at: f64,
    pub research: f64,
    pub train: f64,
    pub units_per_city: f64,
    pub move_: f64,
    pub recover: f64,
    pub heal_others: f64,
    pub upgrade: f64,
    pub noise: f64,
    pub rewards: [Option<f64>; Reward::COUNT],
}

impl GreedyWeights {
    /// bot.ts DEFAULT_WEIGHTS
    pub fn default_weights() -> GreedyWeights {
        let mut rewards = [None; Reward::COUNT];
        for (r, v) in [
            (Reward::Workshop, 5.0),
            (Reward::Explorer, 3.0),
            (Reward::Resources, 5.0),
            (Reward::CityWall, 2.0),
            (Reward::PopulationGrowth, 5.0),
            (Reward::BorderGrowth, 3.0),
            (Reward::SuperUnit, 6.0),
            (Reward::Park, 4.0),
        ] {
            rewards[r as usize] = Some(v);
        }
        GreedyWeights {
            capture: 100.0,
            examine: 60.0,
            promote: 90.0,
            harvest_starfish: 40.0,
            monument: 70.0,
            kill: 80.0,
            hit: 20.0,
            special: 30.0,
            grow_base: 25.0,
            grow_per_pop: 6.0,
            other_build: 8.0,
            rich_at: 10.0,
            research: 18.0,
            train: 12.0,
            units_per_city: 3.0,
            move_: 10.0,
            recover: 15.0,
            heal_others: 15.0,
            upgrade: 6.0,
            noise: 1.0,
            rewards,
        }
    }

    /// from the JSON shape of GreedyWeights (model.json "weights"). Every number
    /// field is required (TS would compute NaN without it); `rewards` may be
    /// absent or partial, and reward keys that are no Reward id are ignored
    /// (TS never looks them up).
    pub fn from_json(v: &serde_json::Value) -> Result<GreedyWeights, String> {
        let o = v.as_object().ok_or("weights: expected an object")?;
        let num = |k: &str| -> Result<f64, String> {
            o.get(k).and_then(|x| x.as_f64()).ok_or_else(|| format!("weights.{k}: expected a number"))
        };
        let mut rewards = [None; Reward::COUNT];
        match o.get("rewards") {
            None | Some(serde_json::Value::Null) => {}
            Some(r) => {
                let ro = r.as_object().ok_or("weights.rewards: expected an object")?;
                for (k, x) in ro {
                    let n = x.as_f64().ok_or_else(|| format!("weights.rewards.{k}: expected a number"))?;
                    if let Some(id) = Reward::from_id(k) {
                        rewards[id as usize] = Some(n);
                    }
                }
            }
        }
        Ok(GreedyWeights {
            capture: num("capture")?,
            examine: num("examine")?,
            promote: num("promote")?,
            harvest_starfish: num("harvestStarfish")?,
            monument: num("monument")?,
            kill: num("kill")?,
            hit: num("hit")?,
            special: num("special")?,
            grow_base: num("growBase")?,
            grow_per_pop: num("growPerPop")?,
            other_build: num("otherBuild")?,
            rich_at: num("richAt")?,
            research: num("research")?,
            train: num("train")?,
            units_per_city: num("unitsPerCity")?,
            move_: num("move")?,
            recover: num("recover")?,
            heal_others: num("healOthers")?,
            upgrade: num("upgrade")?,
            noise: num("noise")?,
            rewards,
        })
    }
}

impl GreedyWeights {
    /// `{ ...self, ...v, rewards: { ...self.rewards, ...v.rewards } }`: a partial
    /// weights object (botFull.ts fullWeights, the agent registry) on top of `self`.
    /// Keys that are no weight are ignored; a present key must be a number.
    pub fn merged_json(&self, v: &serde_json::Value) -> Result<GreedyWeights, String> {
        let o = v.as_object().ok_or("weights: expected an object")?;
        let mut w = self.clone();
        for (k, x) in o {
            if k == "rewards" {
                if x.is_null() {
                    continue;
                }
                let ro = x.as_object().ok_or("weights.rewards: expected an object")?;
                for (rk, rx) in ro {
                    let n = rx.as_f64().ok_or_else(|| format!("weights.rewards.{rk}: expected a number"))?;
                    if let Some(id) = Reward::from_id(rk) {
                        w.rewards[id as usize] = Some(n);
                    }
                }
                continue;
            }
            let slot = match k.as_str() {
                "capture" => &mut w.capture,
                "examine" => &mut w.examine,
                "promote" => &mut w.promote,
                "harvestStarfish" => &mut w.harvest_starfish,
                "monument" => &mut w.monument,
                "kill" => &mut w.kill,
                "hit" => &mut w.hit,
                "special" => &mut w.special,
                "growBase" => &mut w.grow_base,
                "growPerPop" => &mut w.grow_per_pop,
                "otherBuild" => &mut w.other_build,
                "richAt" => &mut w.rich_at,
                "research" => &mut w.research,
                "train" => &mut w.train,
                "unitsPerCity" => &mut w.units_per_city,
                "move" => &mut w.move_,
                "recover" => &mut w.recover,
                "healOthers" => &mut w.heal_others,
                "upgrade" => &mut w.upgrade,
                "noise" => &mut w.noise,
                _ => continue,
            };
            *slot = x.as_f64().ok_or_else(|| format!("weights.{k}: expected a number"))?;
        }
        Ok(w)
    }
}

/// JS ToInt32 of an integer-valued number (wraps modulo 2^32)
#[inline]
fn to_i32(x: i64) -> i32 {
    x as i32
}

/// bot.ts noise: deterministic small noise so bots don't all behave identically.
/// `(s.seed ^ (s.turn * 7919) ^ (k * 104729)) >>> 0`, then
/// `Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0`, then `(h % 1000) / 1000`.
pub fn noise(s: &GameState, k: i64) -> f64 {
    let mut h = (to_i32(s.seed) ^ to_i32(s.turn as i64 * 7919) ^ to_i32(k * 104729)) as u32;
    h = ((h ^ (h >> 13)) as i32).wrapping_mul(0x5bd1e995u32 as i32) as u32;
    (h % 1000) as f64 / 1000.0
}

/// bot.ts goal: where should this unit go? nearest claimable village/enemy city,
/// else enemies, else fog. First candidate with the smallest distance wins.
pub fn goal(s: &GameState, u: &Unit) -> Option<Coord> {
    let n = s.map_size;
    let pl = &s.players[u.owner as usize];
    let mut best: Option<Coord> = None;
    // dist + bias are small integers; i32::MAX stands for Infinity (never reached by a real distance)
    let mut best_d = i32::MAX;
    let mut consider = |c: Coord, bias: i32, best: &mut Option<Coord>| {
        let d = dist(u.x, u.y, c.x, c.y) + bias;
        if d < best_d {
            best_d = d;
            *best = Some(c);
        }
    };
    for (i, (t, &e)) in s.tiles.iter().zip(pl.explored.iter()).enumerate() {
        if e != 1 || !(t.village || t.ruin || t.city_id.is_some()) {
            continue;
        }
        let c = Coord::new(i as i32 % n, i as i32 / n);
        if t.village {
            consider(c, 0, &mut best);
        }
        if t.ruin {
            consider(c, 1, &mut best);
        }
        let city_owner = city_by_id(s, t.city_id).map(|ci| s.cities[ci].owner);
        if let Some(o) = city_owner {
            if o != u.owner && !at_peace(s, u.owner, o) {
                consider(c, 1, &mut best);
            }
        }
    }
    for e in &s.units {
        if e.owner != u.owner && !at_peace(s, u.owner, e.owner) && pl.explored[idx(n, e.x, e.y)] == 1 {
            consider(Coord::new(e.x, e.y), 2, &mut best);
        }
    }
    if best.is_some() {
        return best;
    }
    // frontier: the nearest unexplored tile
    for i in 0..s.tiles.len() {
        if pl.explored[i] == 1 {
            continue;
        }
        consider(Coord::new(i as i32 % n, i as i32 / n), 0, &mut best);
    }
    best
}

/// goal() per unit id within one bot_step: goal is a pure function of the
/// state and the unit, and the state does not change while bot_step scores
/// the legal actions, so the cached value equals a fresh call. The candidate
/// tiles goal() weighs depend only on the unit's owner and are listed once.
#[derive(Default)]
pub(crate) struct GoalCache {
    goals: Vec<(Id, Option<Coord>)>,
    /// (id, index into s.units) of the last unit looked up: legal actions come grouped by unit
    last_unit: Option<(Id, usize)>,
    opinion: crate::opinion::OpinionCache,
    /// (units, cities) of the current player
    counts: Option<(usize, usize)>,
    /// per owner: goal()'s candidates (coord, bias) in its order
    targets: Vec<(i32, Vec<(Coord, i32)>)>,
    /// the economy plan's context for this decision (bot_full, plan != 0), built on first use
    pub(crate) plan: Option<crate::econ_plan::PlanCtx>,
    /// the value field of this decision's player (bot_full, field != 0), built on first use
    pub(crate) field: Option<crate::value_field::FieldMap>,
}

/// goal()'s candidates for units of `owner`, in the order goal() considers them
pub(crate) fn goal_targets(s: &GameState, owner: i32) -> Vec<(Coord, i32)> {
    let n = s.map_size;
    let pl = &s.players[owner as usize];
    let co = crate::state::CityOwners::new(s);
    let mut out = Vec::with_capacity(32);
    for (i, t) in s.tiles.iter().enumerate() {
        if pl.explored[i] != 1 {
            continue;
        }
        let c = Coord::new(i as i32 % n, i as i32 / n);
        if t.village {
            out.push((c, 0));
        }
        if t.ruin {
            out.push((c, 1));
        }
        if let Some(o) = co.owner(t.city_id) {
            if o != owner && !at_peace(s, owner, o) {
                out.push((c, 1));
            }
        }
    }
    for e in &s.units {
        if e.owner != owner && !at_peace(s, owner, e.owner) && pl.explored[idx(n, e.x, e.y)] == 1 {
            out.push((Coord::new(e.x, e.y), 2));
        }
    }
    out
}

/// goal()'s frontier pick: of the tiles `u`'s owner has not explored, the first
/// in tile order with the smallest distance to u
fn nearest_unexplored(s: &GameState, u: &Unit) -> Option<Coord> {
    let n = s.map_size;
    let explored = &s.players[u.owner as usize].explored;
    let far = (u.x).max(n - 1 - u.x).max(u.y).max(n - 1 - u.y);
    for d in 0..=far {
        for y in (u.y - d).max(0)..=(u.y + d).min(n - 1) {
            let edge_row = (y - u.y).abs() == d;
            let mut x = (u.x - d).max(0);
            let x1 = (u.x + d).min(n - 1);
            while x <= x1 {
                // on a middle row only the two ends are on the ring
                if !edge_row && (x - u.x).abs() != d {
                    x = if x < u.x + d { u.x + d } else { x + 1 };
                    continue;
                }
                if explored[idx(n, x, y)] != 1 {
                    return Some(Coord::new(x, y));
                }
                x += 1;
            }
        }
    }
    None
}

/// goal(s, u) through the per-step cache (None = no cache)
pub(crate) fn cached_goal(s: &GameState, u: &Unit, cache: &mut Option<GoalCache>) -> Option<Coord> {
    let Some(c) = cache else { return goal(s, u) };
    // legal actions come grouped by unit: the last goal first
    if let Some(&(id, g)) = c.goals.last() {
        if id == u.id {
            return g;
        }
    }
    if let Some(&(_, g)) = c.goals.iter().find(|(id, _)| *id == u.id) {
        return g;
    }
    let k = match c.targets.iter().position(|e| e.0 == u.owner) {
        Some(k) => k,
        None => {
            let t = goal_targets(s, u.owner);
            c.targets.push((u.owner, t));
            c.targets.len() - 1
        }
    };
    let targets = &c.targets[k].1;
    // first candidate with the smallest dist + bias (i32::MAX: Infinity)
    let mut best: Option<Coord> = None;
    let mut best_d = i32::MAX;
    if !targets.is_empty() {
        for &(t, bias) in targets {
            let d = dist(u.x, u.y, t.x, t.y) + bias;
            if d < best_d {
                best_d = d;
                best = Some(t);
            }
        }
    } else {
        // the nearest unexplored tile, first in tile order: the first one on the
        // smallest ring around u, the ring's tiles visited in tile (row-major) order
        best = nearest_unexplored(s, u);
    }
    c.goals.push((u.id, best));
    best
}

/// find_unit through the cache's last lookup
#[inline]
fn find_unit_cached<'a>(s: &'a GameState, id: Id, cache: &mut Option<GoalCache>) -> &'a Unit {
    let Some(c) = cache else { return find_unit(s, id) };
    if let Some((lid, li)) = c.last_unit {
        if lid == id {
            return &s.units[li];
        }
    }
    let i = s.units.iter().position(|x| x.id == id).expect("bot: unit of a legal action not found");
    c.last_unit = Some((id, i));
    &s.units[i]
}

#[inline]
pub(crate) fn find_unit<'a>(s: &'a GameState, id: Id) -> &'a Unit {
    s.units.iter().find(|x| x.id == id).expect("bot: unit of a legal action not found")
}

/// opinion_value(s, bot, other), through the per-step cache
fn opinion(s: &GameState, bot: i32, other: i32, cache: &mut Option<GoalCache>) -> f64 {
    match cache {
        None => opinion_value(s, bot, other),
        Some(c) => c.opinion.total(s, bot, other),
    }
}

pub fn score_action(s: &GameState, a: &Action, w: &GreedyWeights) -> f64 {
    score_with(s, a, w, &mut None)
}

#[inline(never)]
pub(crate) fn score_with(s: &GameState, a: &Action, w: &GreedyWeights, cache: &mut Option<GoalCache>) -> f64 {
    let p = s.current;
    let pl = &s.players[p as usize];
    match *a {
        Action::Reward { reward, .. } => w.rewards[reward as usize].unwrap_or(1.0),
        Action::Capture { .. } => w.capture,
        Action::Examine { .. } => w.examine,
        Action::Promote { .. } => w.promote,
        Action::HarvestStarfish { .. } => w.harvest_starfish,
        Action::Attack { unit, target } => {
            let u = find_unit(s, unit);
            let t = find_unit(s, target);
            if unit_def(u.ty).attack == 0.0 {
                return w.special;
            }
            let r = compute_damage_rounded(s, u, t);
            let base = if r.damage >= t.hp { w.kill + unit_def(t.ty).cost as f64 } else { w.hit + r.damage as f64 - r.retaliation as f64 };
            // the real AI's aggression: a worthwhile attack counts (1 + aggression / 1000) times,
            // i.e. (1 - opinion of the target's tribe) times (opinion.rs)
            if base > 0.0 {
                base * (1.0 + aggression_of(opinion(s, p, t.owner, cache)) as f64 * 0.001)
            } else {
                base
            }
        }
        Action::Build { at, building } => {
            let def = build_def(building);
            if def.kind == BuildKind::Monument {
                return w.monument;
            }
            if def.kind == BuildKind::Destroy || building == Build::GrowForest || building == Build::BurnForest {
                return -1.0;
            }
            if def.kind == BuildKind::Road || def.kind == BuildKind::Bridge || def.kind == BuildKind::Embassy {
                return if pl.stars > 15 { 3.0 } else { -1.0 };
            }
            if def.kind == BuildKind::Temple {
                return if pl.stars > 30 { 4.0 } else { -1.0 };
            }
            if building == Build::ClearForest {
                return -1.0;
            }
            // Canal (unit-built, free): only when the unit has nothing better to do
            if building == Build::Canal {
                return 1.0;
            }
            if def.pop > 0 {
                return w.grow_base + w.grow_per_pop * def.pop as f64 - def.cost as f64
                    + w.noise * noise(s, at.x as i64 * 31 + at.y as i64);
            }
            if pl.stars as f64 > w.rich_at {
                w.other_build
            } else {
                -1.0
            }
        }
        Action::Research { tech } => {
            let cost = tech_cost(s, p, tech);
            let tier = tech_def(tech).tier;
            if pl.stars - cost >= 2 {
                // noise(s, a.tech.length): the length of the TS tech id
                w.research - cost as f64 - tier as f64 + w.noise * noise(s, tech.id().len() as i64) * 4.0
            } else {
                -1.0
            }
        }
        Action::Train { city, unit } => {
            let def = unit_def(unit);
            let count = || (s.units.iter().filter(|x| x.owner == p).count(), s.cities.iter().filter(|c| c.owner == p).count());
            let (units, cities) = match cache {
                None => count(),
                Some(c) => *c.counts.get_or_insert_with(count),
            };
            if units as f64 > cities as f64 * w.units_per_city {
                return -1.0;
            }
            let strength = def.attack + def.defence + def.hp.unwrap_or(10.0) / 5.0;
            w.train + strength - def.cost as f64 / 2.0 + w.noise * noise(s, city as i64 + unit.id().len() as i64)
        }
        Action::Move { unit, to } => {
            let u = find_unit_cached(s, unit, cache);
            let g = cached_goal(s, u, cache);
            let Some(g) = g else { return -1.0 };
            let gain = dist(u.x, u.y, g.x, g.y) - dist(to.x, to.y, g.x, g.y);
            if gain > 0 {
                w.move_ + gain as f64 + w.noise * noise(s, u.id as i64 * 13 + to.x as i64 + to.y as i64)
            } else {
                -1.0
            }
        }
        Action::Recover { unit } => {
            let u = find_unit(s, unit);
            // idle damaged units heal at the end of the turn anyway; recover early when badly hurt
            if (u.hp as f64) < u.max_hp as f64 / 2.0 && !u.poisoned {
                return w.recover;
            }
            if u.hp < u.max_hp || u.poisoned {
                1.0
            } else {
                -1.0
            }
        }
        Action::HealOthers { .. } => w.heal_others,
        Action::FreezeArea { .. } | Action::Swarm { .. } => w.special,
        Action::Explode { unit } => {
            let u = find_unit(s, unit);
            let adj = s.units.iter().filter(|e| e.owner != p && dist(e.x, e.y, u.x, u.y) == 1).count();
            if adj >= 2 {
                w.hit + (adj * 10) as f64
            } else {
                -1.0
            }
        }
        Action::Upgrade { .. } => {
            if pl.stars > 20 {
                w.upgrade
            } else {
                -1.0
            }
        }
        // drain an Aquarion flood in own territory when the unit has nothing better; never decompose
        Action::Drain { unit, effect } => {
            let u = find_unit(s, unit);
            let terr = s.tiles[idx(s.map_size, u.x, u.y)].territory;
            // s.cities.find((c) => c.id === territory)?.owner === p (a null territory matches no city)
            let own = terr.and_then(|id| s.cities.iter().find(|c| c.id == id)).map(|c| c.owner) == Some(p);
            if effect == DrainEffect::Flooded && own {
                1.0
            } else {
                -1.0
            }
        }
        Action::Decompose { .. } => -1.0,
        // diplomacy, as the real AI decides it (opinion.rs): accept above an opinion of 2, else
        // decline (every offer is answered first); offer when opinion x a [0, 1) roll is above 2;
        // break below 0 when -500 x opinion - 200 per own unit inside their borders is above 0
        Action::AcceptPeace { player } => {
            if accepts_peace(opinion(s, p, player, cache)) {
                1000.0
            } else {
                -1.0
            }
        }
        Action::DeclinePeace { player } => {
            if accepts_peace(opinion(s, p, player, cache)) {
                -1.0
            } else {
                1000.0
            }
        }
        Action::OfferPeace { player } => {
            if offers_peace(s, p, player, opinion(s, p, player, cache)) {
                1000.0
            } else {
                -1.0
            }
        }
        Action::BreakPeace { player } => {
            let v = break_peace_score(s, p, player, opinion(s, p, player, cache));
            if v > 0.0 {
                v
            } else {
                -1.0
            }
        }
        // endTurn, disband, infiltrate, breakIce: TS default
        _ => -1.0,
    }
}

/// bot.ts botStep: the first legal action with the highest score above 0, else endTurn
/// (or the pending reward, which must be answered)
pub fn bot_step(s: &GameState, w: &GreedyWeights) -> Action {
    // best_of(s, &legal_actions(s), w), scoring while the list is built: a
    // unit's Move actions are not even searched when none of them can score
    // above the best so far (a later action replaces the best only with a
    // higher score, so they could not change the pick)
    let mut best = Action::EndTurn;
    let mut best_score = 0.0f64;
    let mut cache: Option<GoalCache> = Some(GoalCache::default());
    let mut scored = 0usize;
    let mut feed = |actions: &[Action], best: &mut Action, best_score: &mut f64, cache: &mut Option<GoalCache>| {
        for a in &actions[scored..] {
            if *a == Action::EndTurn {
                continue;
            }
            let sc = score_with(s, a, w, cache);
            if sc > *best_score {
                *best_score = sc;
                *best = *a;
            }
        }
        scored = actions.len();
    };
    let mut out = Vec::with_capacity(256);
    crate::actions::legal_into(s, &mut out, |u, so_far| {
        feed(so_far, &mut best, &mut best_score, &mut cache);
        // (NaN: search)
        !(move_bound(s, u, w) <= best_score)
    });
    feed(&out, &mut best, &mut best_score, &mut cache);
    if best == Action::EndTurn {
        if let Some(a0 @ Action::Reward { .. }) = out.first() {
            return *a0;
        }
    }
    best
}

/// an upper bound of score_with for every Move of unit `u`: w.move_ + gain + w.noise * noise
/// with gain <= dist(u, to) <= 2 * movement_range (a step costs 0.5 or more and starts
/// below the budget) and noise <= 0.999, or -1. Rounding is monotonic, so each f64
/// operation on larger operands gives a result at least as large.
fn move_bound(s: &GameState, u: &Unit, w: &GreedyWeights) -> f64 {
    let g = 2 * crate::movement::movement_range(s, u).max(0);
    let noise_max = (w.noise * (999u32 as f64 / 1000.0)).max(0.0);
    (w.move_ + g as f64 + noise_max).max(-1.0)
}

/// the choice of bot_step among `actions` (the legal actions of `s`, in order):
/// (unfused; the tests check it against the choices recorded in TS)
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn best_of(s: &GameState, actions: &[Action], w: &GreedyWeights) -> Action {
    let mut best = Action::EndTurn;
    let mut best_score = 0.0f64;
    let mut cache: Option<GoalCache> = Some(GoalCache::default());
    for a in actions {
        if *a == Action::EndTurn {
            continue;
        }
        let sc = score_with(s, a, w, &mut cache);
        if sc > best_score {
            best_score = sc;
            best = *a;
        }
    }
    if best == Action::EndTurn {
        if let Some(a0 @ Action::Reward { .. }) = actions.first() {
            return *a0;
        }
    }
    best
}

/// bot.ts playBotTurn, in place
pub fn play_bot_turn(s: &mut GameState, max_actions: i32, w: &GreedyWeights) {
    let p = s.current;
    let mut i = 0;
    while i < max_actions && !s.over && s.current == p {
        let a = bot_step(s, w);
        apply_action(s, &a).unwrap_or_else(|e| panic!("bot chose an illegal action {a:?}: {e}"));
        i += 1;
    }
    if !s.over && s.current == p {
        apply_action(s, &Action::EndTurn).unwrap_or_else(|e| panic!("endTurn rejected: {e}"));
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn model_weights_parse() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../models/greedy-hill-v4/model.json");
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(root).unwrap()).unwrap();
        let w = GreedyWeights::from_json(&v["weights"]).unwrap();
        assert_eq!(w.capture, 357.52);
        assert_eq!(w.move_, 24.89);
        assert_eq!(w.units_per_city, 12.0);
        assert_eq!(w.rewards[Reward::CityWall as usize], Some(2.0));
        let d = GreedyWeights::default_weights();
        assert_eq!(d.rewards, w.rewards);
    }

    /// TS reference rows from bot-ref.ts (see the report of this port): set
    /// POLY_BOT_REF to the .jsonl it wrote; skipped when the file is missing.
    pub(crate) fn ref_rows() -> Option<Vec<serde_json::Value>> {
        let path = std::env::var("POLY_BOT_REF").unwrap_or_else(|_| "/Users/jakobnunnendorf/.claude/jobs/ae4f4234/tmp/bot-ref.jsonl".into());
        let text = std::fs::read_to_string(&path).ok()?;
        Some(text.lines().filter(|l| !l.is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect())
    }

    /// actions whose score depends on the bot's opinions, which follow the game's decompiled model
    /// since the TypeScript reference rows were recorded (attacks scale with aggression, peace
    /// decisions by opinion): the reference tests skip them, and the choices of rows that list one
    pub(crate) fn opinion_dependent(a: &Action) -> bool {
        matches!(a, Action::Attack { .. } | Action::AcceptPeace { .. } | Action::DeclinePeace { .. } | Action::OfferPeace { .. } | Action::BreakPeace { .. })
    }

    pub(crate) fn from_bits(v: &serde_json::Value) -> f64 {
        f64::from_bits(u64::from_str_radix(v.as_str().unwrap(), 16).unwrap())
    }

    /// Ok(value), or Err(true) for a todo!() in a module not ported yet, Err(false) for another panic
    pub(crate) fn guarded<T>(f: impl FnOnce() -> T) -> Result<T, bool> {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).map_err(|e| {
            let msg = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            if msg.contains("not yet implemented") {
                true
            } else {
                eprintln!("panic: {msg}");
                false
            }
        })
    }

    #[test]
    fn scores_and_steps_match_typescript() {
        let Some(rows) = ref_rows() else {
            eprintln!("bot reference data missing: skipped");
            return;
        };
        let model = concat!(env!("CARGO_MANIFEST_DIR"), "/../../models/greedy-hill-v4/model.json");
        let mv: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(model).unwrap()).unwrap();
        let wv4 = GreedyWeights::from_json(&mv["weights"]).unwrap();
        let wdef = GreedyWeights::default_weights();
        let actions_ported = !include_str!("actions.rs").contains("todo!()");
        let (mut ok, mut gated, mut bad) = (0usize, 0usize, 0usize);
        let (mut step_ok, mut step_gated, mut step_bad) = (0usize, 0usize, 0usize);
        let (mut pick_ok, mut pick_bad) = (0usize, 0usize);
        let mut skipped = 0usize;
        let mut kinds = std::collections::BTreeMap::<String, usize>::new();
        for row in &rows {
            let s = crate::json::state_from_json(&row["state"]).unwrap();
            let legal: Vec<Action> = row["legal"].as_array().unwrap().iter().map(|a| crate::json::action_from_json(a).unwrap()).collect();
            let opinion_row = legal.iter().any(opinion_dependent);
            for (i, a) in legal.iter().enumerate() {
                *kinds.entry(row["legal"][i]["type"].as_str().unwrap().to_string()).or_default() += 1;
                if opinion_dependent(a) {
                    skipped += 1;
                    continue;
                }
                for (w, key) in [(&wdef, "sDef"), (&wv4, "sV4")] {
                    let want = from_bits(&row[key][i]);
                    match guarded(|| score_action(&s, a, w)) {
                        Ok(got) if got.to_bits() == want.to_bits() => ok += 1,
                        Ok(got) => {
                            bad += 1;
                            if bad <= 10 {
                                eprintln!("game {} step {} {key} {a:?}: rust {got} ts {want}", row["game"], row["step"]);
                            }
                        }
                        Err(true) => gated += 1,
                        Err(false) => bad += 1,
                    }
                }
            }
            for (w, key) in [(&wdef, "botDef"), (&wv4, "botV4")] {
                if opinion_row {
                    skipped += 1;
                    continue;
                }
                // the choice among the recorded TS legal actions (needs no Rust legal_actions)
                let want = crate::json::action_from_json(&row[key]).unwrap();
                match guarded(|| best_of(&s, &legal, w)) {
                    Ok(got) if got == want => pick_ok += 1,
                    _ => pick_bad += 1,
                }
                if !actions_ported {
                    step_gated += 1;
                    continue;
                }
                let want = crate::json::action_from_json(&row[key]).unwrap();
                match guarded(|| bot_step(&s, w)) {
                    Ok(got) if got == want => step_ok += 1,
                    Ok(got) => {
                        step_bad += 1;
                        if step_bad <= 10 {
                            eprintln!("game {} step {} {key}: rust {got:?} ts {want:?}", row["game"], row["step"]);
                        }
                    }
                    Err(true) => step_gated += 1,
                    Err(false) => step_bad += 1,
                }
            }
        }
        eprintln!("score_action: {ok} equal, {bad} different, {gated} gated (todo!); bot_step: {step_ok} equal, {step_bad} different, {step_gated} gated");
        eprintln!("bot choice among the TS legal actions: {pick_ok} equal, {pick_bad} different; {skipped} opinion-dependent scores and choices skipped");
        eprintln!("legal action kinds: {kinds:?}");
        assert_eq!(bad, 0);
        assert_eq!(step_bad, 0);
        assert_eq!(pick_bad, 0);
    }
}
