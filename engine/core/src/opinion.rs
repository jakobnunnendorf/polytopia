//! What bots think of other tribes: the real game's opinion model, as documented by a community
//! decompile of a pre-February-2024 build (raphael-64/polyterra-env). Our own code, written from the
//! facts (formulas, constants, conditions) in that decompile; see POLYTOPIA_RULES.md "Diplomacy" and
//! docs/RULES_PARITY.md for what is and is not ported.
//!
//! A bot's opinion of another tribe is a sum of signed terms (`OpinionFactor`, named like the game's
//! relation reasons). The level shown is great above 2, decent above 0.5, poor below -0.5, horrible
//! below -2, indifferent otherwise. Bots accept peace above 2 (`LOVE_LIMIT`), offer it when
//! opinion x a [0, 1) roll is above 2, consider breaking it below 0, and attack harder the lower the
//! opinion (aggression = -1000 x opinion).
//!
//! The terms (bot B's opinion of tribe T; "progress" g is the game's progress, in Perfection
//! turn / turn limit):
//! - charming: T is a human player: (2 - handicap) x 2 when positive (handicap easy 0, normal 1,
//!   hard 2, crazy 4, so only easy +4 and normal +2).
//! - annoying: when B is not at peace with T, minus the share of the other living tribes B is at
//!   peace with; and -0.5 more on the tribe B already rates lowest.
//! - peaceful / violent: t = (turn - T's last attack on B - 4) / 4 (an attack before meeting, or
//!   none, counts as meeting turn - 4): t > 0 gives +0.5 x min(t, 2), else 2t (down to -2 right
//!   after an attack).
//! - diplomatic: +1 for B's embassy with T, +1 for T's embassy with B.
//! - wise / foolish: over every third tribe X: both at war with X +2, B at war with X and T at peace
//!   with X -1, B at peace with X and T at war with X -2, both at peace with X +1; minus
//!   4 / (turns since the B-T treaty was last broken + 1); capped at +2 (no floor).
//! - threatening: each T unit B sees on B's land: -1 (-0.2 while at peace), -2 more on a city; each
//!   T unit on a tile next to B's land: -0.5 unless at peace.
//! - intrusive: -0.1 per tile of T's land on or next to B's land; -2 when T holds B's first capital.
//! - powerful / weak: a = min(2, B's military / max(1, T's)) (1 when both have none), with military =
//!   sum over units of 9 defence x defence bonus + 10 attack + 7 movement + 14 (range - 1):
//!   a < 1 gives +(1 - a), a > 1 gives -(a - 1).
//! - dominating: -4 g^2 / rank^2, rank = T's place in the standings (1 = leading).
//! - brave: +g^2 when T is at war with the leader (neither T nor B).
use crate::combat::defence_bonus;
use crate::data::{unit_def, GLORY_TARGET};
use crate::diplomacy::{at_peace, first_meet_turn, last_attack_turn, last_peace_broken_turn};
use crate::grid::idx;
use crate::movement::{can_see, movement_range};
use crate::state::{difficulty_of, score_of, territory_owners};
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpinionFactor {
    Wise,
    Charming,
    Peaceful,
    Diplomatic,
    Powerful,
    Brave,
    Violent,
    Threatening,
    Weak,
    Annoying,
    Foolish,
    Intrusive,
    Dominating,
}

impl OpinionFactor {
    pub const ALL: [OpinionFactor; 13] = {
        use OpinionFactor::*;
        [Wise, Charming, Peaceful, Diplomatic, Powerful, Brave, Violent, Threatening, Weak, Annoying, Foolish, Intrusive, Dominating]
    };
    pub fn id(self) -> &'static str {
        ["wise", "charming", "peaceful", "diplomatic", "powerful", "brave", "violent", "threatening", "weak", "annoying", "foolish", "intrusive", "dominating"][self as usize]
    }
    /// the factors that raise an opinion (the others lower it)
    #[inline]
    pub fn positive(self) -> bool {
        matches!(self, OpinionFactor::Wise | OpinionFactor::Charming | OpinionFactor::Peaceful | OpinionFactor::Diplomatic | OpinionFactor::Powerful | OpinionFactor::Brave)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum OpinionLevel {
    Horrible,
    Poor,
    Indifferent,
    Decent,
    Great,
}

impl OpinionLevel {
    pub fn id(self) -> &'static str {
        ["horrible", "poor", "indifferent", "decent", "great"][self as usize]
    }
}

/// how many turns an attack is remembered: Violent fades over 4 turns, Peaceful grows over the
/// 8 after that (the game's "longsight")
pub const PEACEFUL_TURNS: i32 = 4;
/// above this a bot accepts peace (and offers it when opinion x roll is above it)
pub const LOVE_LIMIT: f64 = 2.0;
/// the level boundaries: great above 2, decent above 0.5, poor below -0.5, horrible below -2
pub const HATE_LIMIT: f64 = -2.0;

/// a bot's opinion of one tribe: the total and its terms (signed, one entry per factor, in the
/// game's order of adding them)
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Opinion {
    pub total: f64,
    pub reasons: Vec<(OpinionFactor, f64)>,
}

impl Opinion {
    fn add(&mut self, f: OpinionFactor, v: f64) {
        self.total += v;
        match self.reasons.iter_mut().find(|r| r.0 == f) {
            Some(r) => r.1 += v,
            None => self.reasons.push((f, v)),
        }
    }
    /// the terms the game lists: larger than 0.1 either way, the largest first
    pub fn shown(&self) -> Vec<(OpinionFactor, f64)> {
        let mut r: Vec<(OpinionFactor, f64)> = self.reasons.iter().copied().filter(|r| r.1.abs() > 0.1).collect();
        r.sort_by(|a, b| b.1.abs().total_cmp(&a.1.abs()));
        r
    }
}

/// the game's handicap per difficulty
pub fn handicap(d: Difficulty) -> i32 {
    match d {
        Difficulty::Easy => 0,
        Difficulty::Normal => 1,
        Difficulty::Hard => 2,
        Difficulty::Crazy => 4,
    }
}

/// has seat `p` already played the current turn number? (seats play in id order)
#[inline]
fn has_played_this_turn(s: &GameState, p: i32) -> bool {
    p < s.current
}

/// `by` attacked `on` this turn, or last turn and has not played since
fn attacked_lately(s: &GameState, by: i32, on: i32) -> bool {
    let d = s.turn - last_attack_turn(s, by, on).unwrap_or(-100);
    d < 1 || (d == 1 && !has_played_this_turn(s, by))
}

/// at war in the opinion's sense: not at peace, and an attack either way since the attacker's last turn
pub fn opinion_war(s: &GameState, a: i32, b: i32) -> bool {
    a != b && !at_peace(s, a, b) && (attacked_lately(s, a, b) || attacked_lately(s, b, a))
}

fn capitals(s: &GameState, p: i32) -> usize {
    s.cities.iter().filter(|c| c.owner == p && c.original_capital_of.is_some()).count()
}

/// players by standing: the living by the mode's measure (score; cities in Domination; capitals
/// in Might), highest first, ties in seat order; then the eliminated in seat order
fn standings(s: &GameState) -> Vec<i32> {
    let key = |p: i32| -> i64 {
        match s.mode {
            GameMode::Domination => s.cities.iter().filter(|c| c.owner == p).count() as i64,
            GameMode::Might => capitals(s, p) as i64,
            _ => score_of(s, p) as i64,
        }
    };
    let mut alive: Vec<(i64, i32)> = s.players.iter().filter(|p| p.alive).map(|p| (key(p.id), p.id)).collect();
    alive.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut out: Vec<i32> = alive.into_iter().map(|x| x.1).collect();
    out.extend(s.players.iter().filter(|p| !p.alive).map(|p| p.id));
    out
}

/// the game's progress as the opinion sees it, for tribe `t` (Perfection: turn / turn limit)
fn progress(s: &GameState, t: i32, leader: i32) -> f64 {
    let np = s.players.len().max(1) as f64;
    match s.mode {
        GameMode::Perfection => {
            if s.max_turns > 0 {
                s.turn as f64 / s.max_turns as f64
            } else {
                0.0
            }
        }
        // whole multiples of the target only (the game divides two integers)
        GameMode::Glory => (score_of(s, t) / GLORY_TARGET) as f64,
        GameMode::Might => capitals(s, t) as f64 / np,
        GameMode::Domination => capitals(s, leader) as f64 / np,
        GameMode::Creative => 0.0,
    }
}

/// one tribe's military strength as the opinion weighs it
fn military(s: &GameState, p: i32) -> f64 {
    s.units
        .iter()
        .filter(|u| u.owner == p)
        .map(|u| {
            let d = unit_def(u.ty);
            9.0 * d.defence * defence_bonus(s, u) + 10.0 * d.attack + 7.0 * movement_range(s, u) as f64 + 14.0 * (d.range - 1) as f64
        })
        .sum()
}

/// bot's opinion of every player, by player id (None for itself, the eliminated, and tribes it
/// has neither met nor been attacked by: those read as 0, indifferent)
pub fn opinions(s: &GameState, bot: i32) -> Vec<Option<Opinion>> {
    use OpinionFactor::*;
    let np = s.players.len();
    let n = s.map_size;
    let mut out: Vec<Option<Opinion>> = vec![None; np];
    let ranked = standings(s);
    let leader = ranked[0];
    let owners = territory_owners(s);
    // B's land and the ring of tiles around it
    let mut near = vec![false; owners.len()];
    for (i, &o) in owners.iter().enumerate() {
        if o == Some(bot) {
            let (x, y) = (i as i32 % n, i as i32 / n);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx >= 0 && ny >= 0 && nx < n && ny < n {
                        near[idx(n, nx, ny)] = true;
                    }
                }
            }
        }
    }
    let start_owner = s.cities.iter().find(|c| c.original_capital_of == Some(bot)).and_then(|c| owners[idx(n, c.x, c.y)]);
    let charm = 2 - handicap(difficulty_of(s));
    let mine = military(s, bot);
    for other in s.players.iter().filter(|p| p.alive && p.id != bot) {
        let t = other.id;
        let met = first_meet_turn(s, bot, t).unwrap_or(-100);
        let last = last_attack_turn(s, t, bot).unwrap_or(-100);
        if met < 0 && last < 0 {
            continue;
        }
        let mut terms = Opinion::default();
        let g = progress(s, t, leader);
        // brave: at war with the leader
        let brave = if leader != t && leader != bot && opinion_war(s, t, leader) { g * g } else { 0.0 };
        // dominating: by standing
        let rank = (ranked.iter().position(|&p| p == t).unwrap_or(np) + 1) as f64;
        let dominating = g * g * 4.0 / (rank * rank);
        // wise / foolish: friends and enemies in common, and a broken treaty
        let mut rel = 0.0;
        for x in s.players.iter().map(|p| p.id).filter(|&x| x != bot && x != t) {
            if opinion_war(s, bot, x) {
                if opinion_war(s, t, x) {
                    rel += 2.0;
                }
                if at_peace(s, t, x) {
                    rel -= 1.0;
                }
            }
            if at_peace(s, bot, x) {
                if opinion_war(s, t, x) {
                    rel -= 2.0;
                }
                if at_peace(s, t, x) {
                    rel += 1.0;
                }
            }
        }
        if let Some(b) = last_peace_broken_turn(s, bot, t) {
            if b > 0 {
                rel -= PEACEFUL_TURNS as f64 / ((s.turn - b) as f64 + 1.0);
            }
        }
        let rel = rel.min(2.0);
        // peaceful / violent
        let since = if last < met { met - PEACEFUL_TURNS } else { last };
        let calm = (s.turn - since - PEACEFUL_TURNS) as f64 / PEACEFUL_TURNS as f64;
        // diplomatic
        let embassies = s.players[bot as usize].embassies.contains(&t) as i32 + other.embassies.contains(&bot) as i32;
        // threatening and intrusive, over B's land and the ring around it
        let peace = at_peace(s, bot, t);
        let mut threat = 0.0;
        for u in s.units.iter().filter(|u| u.owner == t) {
            let i = idx(n, u.x, u.y);
            if !near[i] || !can_see(s, bot, u) {
                continue;
            }
            if owners[i] == Some(bot) {
                threat += if peace { 0.2 } else { 1.0 };
                if s.tiles[i].city_id.is_some() {
                    threat += 2.0;
                }
            } else if !peace {
                threat += 0.5;
            }
        }
        let mut intrusive = near.iter().zip(&owners).filter(|(&m, &o)| m && o == Some(t)).count() as f64 * 0.1;
        if start_owner == Some(t) {
            intrusive += 2.0;
        }
        // powerful / weak
        let theirs = military(s, t);
        let adv = if mine == 0.0 && theirs == 0.0 { 1.0 } else { (mine / theirs.max(1.0)).min(2.0) };
        // the terms, in the game's order
        terms.add(Brave, brave);
        if !other.bot && charm > 0 {
            terms.add(Charming, charm as f64 * 2.0);
        }
        terms.add(Diplomatic, embassies as f64);
        if calm > 0.0 {
            terms.add(Peaceful, calm.min(2.0) * 0.5);
        }
        if rel > 0.0 {
            terms.add(Wise, rel);
        }
        if adv < 1.0 {
            terms.add(Powerful, 1.0 - adv);
        }
        terms.add(Threatening, -threat);
        if calm <= 0.0 {
            terms.add(Violent, calm * 2.0);
        }
        if rel < 0.0 {
            terms.add(Foolish, rel);
        }
        if adv > 1.0 {
            terms.add(Weak, -(adv - 1.0));
        }
        terms.add(Dominating, -dominating);
        terms.add(Intrusive, -intrusive);
        out[t as usize] = Some(terms);
    }
    // annoying: dislike of everyone not at peace, by the share of tribes the bot is at peace with,
    // and a little more for the one it already likes least
    let others: Vec<i32> = s.players.iter().filter(|p| p.alive && p.id != bot).map(|p| p.id).collect();
    let share = others.iter().filter(|&&x| at_peace(s, bot, x)).count() as f64 / (others.len() as f64).max(1.0);
    let mut lowest: Option<(usize, f64)> = None;
    for (i, slot) in out.iter_mut().enumerate() {
        let Some(o) = slot.as_mut() else { continue };
        if !at_peace(s, bot, i as i32) {
            o.add(Annoying, -share);
        }
        if lowest.is_none_or(|l| o.total < l.1) {
            lowest = Some((i, o.total));
        }
    }
    let lowest = lowest.map(|l| l.0);
    if let Some(l) = lowest {
        out[l].as_mut().unwrap().add(Annoying, -0.5);
    }
    out
}

/// bot's opinion of other (0 when it has none)
pub fn opinion_value(s: &GameState, bot: i32, other: i32) -> f64 {
    if bot == other {
        return 0.0;
    }
    opinions(s, bot)[other as usize].as_ref().map_or(0.0, |o| o.total)
}

/// the terms the game shows for bot's opinion of other: larger than 0.1 either way, largest first
pub fn opinion_reasons(s: &GameState, bot: i32, other: i32) -> Vec<(OpinionFactor, f64)> {
    if bot == other {
        return vec![];
    }
    opinions(s, bot)[other as usize].as_ref().map_or(vec![], |o| o.shown())
}

/// the factors shown (opinion_reasons without the values)
pub fn opinion_factors(s: &GameState, bot: i32, other: i32) -> Vec<OpinionFactor> {
    opinion_reasons(s, bot, other).into_iter().map(|r| r.0).collect()
}

/// the opinion's value (see opinion_value)
pub fn opinion_score(s: &GameState, bot: i32, other: i32) -> f64 {
    opinion_value(s, bot, other)
}

pub fn opinion_level(score: f64) -> OpinionLevel {
    if score > LOVE_LIMIT {
        OpinionLevel::Great
    } else if score > 0.5 {
        OpinionLevel::Decent
    } else if score < HATE_LIMIT {
        OpinionLevel::Horrible
    } else if score < -0.5 {
        OpinionLevel::Poor
    } else {
        OpinionLevel::Indifferent
    }
}

pub fn opinion_of(s: &GameState, bot: i32, other: i32) -> OpinionLevel {
    opinion_level(opinion_value(s, bot, other))
}

/// the AI's aggression toward a tribe: -1000 x opinion, truncated
#[inline]
pub fn aggression_of(opinion: f64) -> i32 {
    (opinion * -1000.0) as i32
}

/// the bot's [0, 1) roll for offering peace to `other` this turn: deterministic per game seed,
/// turn, bot and tribe
pub fn peace_roll(s: &GameState, bot: i32, other: i32) -> f64 {
    let seed = s.seed as u32;
    let mut h = seed ^ ((bot + 1) as u32).wrapping_mul(0x9e37_79b1) ^ ((other + 1) as u32).wrapping_mul(0x85eb_ca6b) ^ ((s.turn + 1) as u32).wrapping_mul(0xc2b2_ae35);
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    (h ^ (h >> 16)) as f64 / 4_294_967_296.0
}

/// a bot accepts a peace offer above LOVE_LIMIT
#[inline]
pub fn accepts_peace(opinion: f64) -> bool {
    opinion > LOVE_LIMIT
}

/// a bot offers peace when opinion x its roll is above LOVE_LIMIT
pub fn offers_peace(s: &GameState, bot: i32, other: i32, opinion: f64) -> bool {
    opinion * peace_roll(s, bot, other) > LOVE_LIMIT
}

/// how much the bot wants to break its treaty with `other`: -500 x opinion minus 200 per unit of
/// its own inside other's borders (those would be lost); worth it only above 0, and only
/// considered below an opinion of 0
pub fn break_peace_score(s: &GameState, bot: i32, other: i32, opinion: f64) -> f64 {
    if opinion >= 0.0 {
        return 0.0;
    }
    let owners = territory_owners(s);
    let inside = s.units.iter().filter(|u| u.owner == bot && owners[idx(s.map_size, u.x, u.y)] == Some(other)).count();
    -opinion * 500.0 - 200.0 * inside as f64
}

/// opinions of the current state, for one bot, kept while the state does not change (bot_step)
#[derive(Default)]
pub(crate) struct OpinionCache {
    totals: Option<(i32, Vec<f64>)>,
}

impl OpinionCache {
    pub(crate) fn total(&mut self, s: &GameState, bot: i32, other: i32) -> f64 {
        if bot == other || other < 0 || other as usize >= s.players.len() {
            return 0.0;
        }
        if self.totals.as_ref().is_none_or(|t| t.0 != bot) {
            let v = opinions(s, bot).into_iter().map(|o| o.map_or(0.0, |o| o.total)).collect();
            self.totals = Some((bot, v));
        }
        self.totals.as_ref().unwrap().1[other as usize]
    }
}

#[cfg(test)]
#[path = "opinion_tests.rs"]
mod tests;
