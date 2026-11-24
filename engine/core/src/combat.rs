//! Port of logic/engine/combat.ts. STUB: agent B fills the bodies; keep the signatures.
#![allow(unused)]
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CombatResult {
    /// whole HP
    pub damage: i32,
    pub retaliation: i32,
}

pub fn has_skill(u: &Unit, skill: Skill) -> bool {
    todo!()
}
pub fn defence_bonus(s: &GameState, u: &Unit) -> f64 {
    todo!()
}
pub fn compute_damage(attack: f64, attacker_hp: i32, attacker_max_hp: i32, defence: f64, defender_hp: i32, defender_max_hp: i32, bonus: f64) -> CombatResult {
    todo!()
}
pub fn half_damage(damage: i32) -> i32 {
    todo!()
}
pub fn compute_damage_rounded(s: &GameState, attacker: &Unit, defender: &Unit) -> CombatResult {
    todo!()
}
