//! Port of logic/engine/diplomacy.ts. STUB: agent B fills the bodies; keep the signatures.
#![allow(unused)]
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation {
    SelfRel,
    Peace,
    War,
    Hostile,
    Neutral,
}

/// read-only view (EMPTY when the state has none)
pub fn dip(s: &GameState) -> &Diplomacy {
    todo!()
}
/// mutable view, created when missing
pub fn dip_mut(s: &mut GameState) -> &mut Diplomacy {
    todo!()
}
pub fn ordinal(s: &GameState) -> i32 {
    todo!()
}
pub fn at_peace(s: &GameState, a: i32, b: i32) -> bool {
    todo!()
}
pub fn at_war(s: &GameState, a: i32, b: i32) -> bool {
    todo!()
}
pub fn in_ceasefire(s: &GameState, a: i32, b: i32) -> bool {
    todo!()
}
pub fn relation(s: &GameState, a: i32, b: i32) -> Relation {
    todo!()
}
pub fn can_harm(s: &GameState, a: i32, b: i32) -> bool {
    todo!()
}
pub fn friendly(s: &GameState, a: i32, b: Option<i32>) -> bool {
    todo!()
}
pub fn has_offer(s: &GameState, from: i32, to: i32) -> bool {
    todo!()
}
pub fn broke_treaty_with(s: &GameState, breaker: i32, victim: i32) -> bool {
    todo!()
}
pub fn last_attack_turn(s: &GameState, by: i32, on: i32) -> Option<i32> {
    todo!()
}
pub fn record_attack(s: &mut GameState, by: i32, on: i32) {
    todo!()
}
pub fn make_peace(s: &mut GameState, a: i32, b: i32) {
    todo!()
}
