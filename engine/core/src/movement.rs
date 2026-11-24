//! Port of logic/engine/movement.ts. STUB: agent B fills the bodies; keep the signatures.
//! Functions returning a unit return its index into `s.units`.
#![allow(unused)]
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
pub fn territory_owner(s: &GameState, t: &Tile) -> Option<i32> {
    todo!()
}
/// indices of the units with bodyOf == head_id, in s.units order
pub fn chain_body(s: &GameState, head_id: Id) -> Vec<usize> {
    todo!()
}
#[inline]
pub fn is_led(u: &Unit) -> bool {
    u.body_of.is_some()
}
pub fn leader_of(s: &GameState, u: &Unit) -> Option<usize> {
    todo!()
}
pub fn follower_of(s: &GameState, u: &Unit) -> Option<usize> {
    todo!()
}
pub fn movement_range(s: &GameState, u: &Unit) -> i32 {
    todo!()
}
pub fn unit_at(s: &GameState, x: i32, y: i32) -> Option<usize> {
    todo!()
}
pub fn can_see(s: &GameState, player: i32, u: &Unit) -> bool {
    todo!()
}
pub fn enter_kind(s: &GameState, u: &Unit, t: &Tile) -> Option<StepKind> {
    todo!()
}
pub fn reachable(s: &GameState, u: &Unit) -> Vec<MoveTarget> {
    todo!()
}
pub fn path_to(s: &GameState, u: &Unit, to: Coord) -> Vec<Coord> {
    todo!()
}
pub fn sight_radius(s: &GameState, u: &Unit) -> i32 {
    todo!()
}
