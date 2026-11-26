//! Port of logic/engine/diplomacy.ts: peace treaties, pending offers, war (an
//! attack either way this turn or the last), the cease-fire and Hostile status
//! after a broken treaty, and the victims' permanent grudge.
//!
//! Everything lives in the optional GameState.diplomacy, so states without it
//! read as "nobody at peace, no offers, no recent attacks".
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation {
    SelfRel,
    Peace,
    War,
    Hostile,
    Neutral,
}

static EMPTY: Diplomacy = Diplomacy { peace: Vec::new(), offers: Vec::new(), attacks: Vec::new(), ceasefires: Vec::new(), broken: Vec::new(), broken_turns: Vec::new() };

/// read-only view (EMPTY when the state has none)
#[inline]
pub fn dip(s: &GameState) -> &Diplomacy {
    s.diplomacy.as_ref().unwrap_or(&EMPTY)
}
/// mutable view, created when missing
#[inline]
pub fn dip_mut(s: &mut GameState) -> &mut Diplomacy {
    s.diplomacy.get_or_insert_with(Diplomacy::default)
}
/// position of the current player-turn in play order (grows by players.length per turn)
#[inline]
pub fn ordinal(s: &GameState) -> i32 {
    s.turn * s.players.len() as i32 + s.current
}
pub fn at_peace(s: &GameState, a: i32, b: i32) -> bool {
    if a == b {
        return false;
    }
    dip(s).peace.iter().any(|p| (p[0] == a && p[1] == b) || (p[0] == b && p[1] == a))
}
/// at war: either attacked the other within the last turn (this turn number or the previous one)
pub fn at_war(s: &GameState, a: i32, b: i32) -> bool {
    if a == b {
        return false;
    }
    dip(s).attacks.iter().any(|x| ((x.by == a && x.on == b) || (x.by == b && x.on == a)) && s.turn - x.turn <= 1)
}
/// cease-fire after a broken treaty: no attacks either way until the breaker's next turn
pub fn in_ceasefire(s: &GameState, a: i32, b: i32) -> bool {
    let now = ordinal(s);
    dip(s)
        .ceasefires
        .iter()
        .any(|c| ((c.breaker == a && c.victim == b) || (c.breaker == b && c.victim == a)) && now < c.until)
}
pub fn relation(s: &GameState, a: i32, b: i32) -> Relation {
    if a == b {
        return Relation::SelfRel;
    }
    if at_peace(s, a, b) {
        return Relation::Peace;
    }
    if in_ceasefire(s, a, b) {
        return Relation::Hostile;
    }
    if at_war(s, a, b) {
        return Relation::War;
    }
    Relation::Neutral
}
/// may a's units attack, convert, capture from or infiltrate b's? (not partners, not in a cease-fire)
pub fn can_harm(s: &GameState, a: i32, b: i32) -> bool {
    a != b && !at_peace(s, a, b) && !in_ceasefire(s, a, b)
}
/// b's units, territory and buildings count as friendly for a (own or peace partner)
#[inline]
pub fn friendly(s: &GameState, a: i32, b: Option<i32>) -> bool {
    match b {
        None => false,
        Some(b) => a == b || at_peace(s, a, b),
    }
}
pub fn has_offer(s: &GameState, from: i32, to: i32) -> bool {
    dip(s).offers.iter().any(|o| o.from == from && o.to == to)
}
/// the victim never forgives a broken treaty (bots' permanent Foolish opinion)
pub fn broke_treaty_with(s: &GameState, breaker: i32, victim: i32) -> bool {
    dip(s).broken.iter().any(|b| b[0] == victim && b[1] == breaker)
}
/// the last turn on which a treaty between a and b was broken (either side), if any
pub fn last_peace_broken_turn(s: &GameState, a: i32, b: i32) -> Option<i32> {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    dip(s).broken_turns.iter().find(|x| x[0] == lo && x[1] == hi).map(|x| x[2])
}
/// turn number on which `p` met `other` (None if not met; 0 when the
/// turns are out of step with `met`, e.g. a state saved before they were kept)
pub fn first_meet_turn(s: &GameState, p: i32, other: i32) -> Option<i32> {
    let pl = &s.players[p as usize];
    let i = pl.met.iter().position(|&m| m == other)?;
    if pl.met_turns.len() != pl.met.len() {
        return Some(0);
    }
    Some(pl.met_turns[i])
}
/// turn number of the last attack by `by` on `on` (the first matching record, like TS find)
pub fn last_attack_turn(s: &GameState, by: i32, on: i32) -> Option<i32> {
    dip(s).attacks.iter().find(|a| a.by == by && a.on == on).map(|a| a.turn)
}
/// record an attack (also a conversion)
pub fn record_attack(s: &mut GameState, by: i32, on: i32) {
    if by == on {
        return;
    }
    let turn = s.turn;
    let d = dip_mut(s);
    if let Some(x) = d.attacks.iter_mut().find(|a| a.by == by && a.on == on) {
        x.turn = turn;
    } else {
        d.attacks.push(AttackRecord { by, on, turn });
    }
}
pub fn make_peace(s: &mut GameState, a: i32, b: i32) {
    let d = dip_mut(s);
    d.offers.retain(|o| !((o.from == a && o.to == b) || (o.from == b && o.to == a)));
    if !at_peace(s, a, b) {
        dip_mut(s).peace.push(if a < b { [a, b] } else { [b, a] });
    }
}
