//! Port of logic/engine/opinion.ts: what bots think of other tribes. Each
//! factor that holds counts +1 (positive) or -1; a bot accepts and sends peace
//! offers only at great.
use crate::diplomacy::{at_peace, at_war, broke_treaty_with, last_attack_turn};
use crate::grid::{any_around, idx};
use crate::movement::{can_see, territory_owner};
use crate::state::{difficulty_of, score_of};
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
    pub fn id(self) -> &'static str {
        ["wise", "charming", "peaceful", "diplomatic", "powerful", "brave", "violent", "threatening", "weak", "annoying", "foolish", "intrusive", "dominating"][self as usize]
    }
    /// TS POSITIVE_FACTORS
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

/// turns without an attack on the bot after which it counts you Peaceful
pub const PEACEFUL_TURNS: i32 = 3;

/// chance a bot finds a tribe Charming, by difficulty
fn charming_chance(d: Difficulty) -> f64 {
    match d {
        Difficulty::Easy => 0.5,
        Difficulty::Normal => 0.3,
        Difficulty::Hard => 0.15,
        Difficulty::Crazy => 0.05,
    }
}

/// deterministic per game, bot and tribe (TS charmRoll: Math.imul and >>> as wrapping u32 ops;
/// `s.seed ^ ...` takes ToInt32 of the seed, its low 32 bits)
fn charm_roll(s: &GameState, bot: i32, other: i32) -> f64 {
    let seed = s.seed as u32;
    let mut h = seed ^ ((bot + 1) as u32).wrapping_mul(0x9e37_79b1) ^ ((other + 1) as u32).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    (h ^ (h >> 16)) as f64 / 4_294_967_296.0
}

pub fn opinion_factors(s: &GameState, bot: i32, other: i32) -> Vec<OpinionFactor> {
    use OpinionFactor::*;
    let mut out = Vec::new();
    let n = s.map_size;
    let rivals: Vec<i32> = s.players.iter().filter(|x| x.alive && x.id != bot && x.id != other).map(|x| x.id).collect();
    // Wise: shares a friend or an enemy with the bot
    if rivals.iter().any(|&x| (at_peace(s, bot, x) && at_peace(s, other, x)) || (at_war(s, bot, x) && at_war(s, other, x))) {
        out.push(Wise);
    }
    if charm_roll(s, bot, other) < charming_chance(difficulty_of(s)) {
        out.push(Charming);
    }
    match last_attack_turn(s, other, bot) {
        Some(last) if s.turn - last < PEACEFUL_TURNS => out.push(Violent),
        _ => out.push(Peaceful),
    }
    if s.players[bot as usize].embassies.contains(&other) || s.players[other as usize].embassies.contains(&bot) {
        out.push(Diplomatic);
    }
    let mine = s.units.iter().filter(|u| u.owner == bot).count();
    let theirs: Vec<&Unit> = s.units.iter().filter(|u| u.owner == other).collect();
    if theirs.len() > mine {
        out.push(Powerful);
    }
    // Brave: at war with the strongest tribe (other than the two); first of the highest
    let mut strongest: Option<i32> = None;
    let mut best = f64::NEG_INFINITY;
    for &x in &rivals {
        let sc = score_of(s, x) as f64;
        if sc > best {
            best = sc;
            strongest = Some(x);
        }
    }
    if let Some(st) = strongest {
        if at_war(s, other, st) {
            out.push(Brave);
        }
    }
    // Threatening: their units inside or next to the bot's land
    let bot_land = |x: i32, y: i32| territory_owner(s, &s.tiles[idx(n, x, y)]) == Some(bot);
    if theirs.iter().any(|u| bot_land(u.x, u.y) || any_around(n, Coord::new(u.x, u.y), 1, false, |q| bot_land(q.x, q.y))) {
        out.push(Threatening);
    }
    // Weak: the bot sees fewer of their units than it has
    if theirs.iter().filter(|u| can_see(s, bot, u)).count() < mine {
        out.push(Weak);
    }
    let d = difficulty_of(s);
    if d == Difficulty::Hard || d == Difficulty::Crazy {
        out.push(Annoying);
    }
    // Foolish: at war with the bot's friends or at peace with its enemies; forever after a broken treaty
    if broke_treaty_with(s, other, bot) || rivals.iter().any(|&x| (at_peace(s, bot, x) && at_war(s, other, x)) || (at_war(s, bot, x) && at_peace(s, other, x))) {
        out.push(Foolish);
    }
    // Intrusive: their borders touch the bot's
    let touches = s.tiles.iter().enumerate().any(|(i, t)| {
        if territory_owner(s, t) != Some(other) {
            return false;
        }
        let c = Coord::new(i as i32 % n, i as i32 / n);
        any_around(n, c, 1, false, |q| bot_land(q.x, q.y))
    });
    if touches {
        out.push(Intrusive);
    }
    // Dominating: half of all cities or more
    let cities = s.cities.len();
    let held = s.cities.iter().filter(|c| c.owner == other).count();
    if cities >= 4 && held * 2 >= cities {
        out.push(Dominating);
    }
    out
}

pub fn opinion_score(s: &GameState, bot: i32, other: i32) -> i32 {
    opinion_factors(s, bot, other).iter().map(|f| if f.positive() { 1 } else { -1 }).sum()
}

pub fn opinion_level(score: i32) -> OpinionLevel {
    if score <= -3 {
        OpinionLevel::Horrible
    } else if score < 0 {
        OpinionLevel::Poor
    } else if score == 0 {
        OpinionLevel::Indifferent
    } else if score < 3 {
        OpinionLevel::Decent
    } else {
        OpinionLevel::Great
    }
}

pub fn opinion_of(s: &GameState, bot: i32, other: i32) -> OpinionLevel {
    opinion_level(opinion_score(s, bot, other))
}
