//! Port of logic/engine/combat.ts (2.18; integer arithmetic in tenths of HP
//! with truncating divisions, done in f64 exactly as the TS expressions).
//!
//!   atk = attack×10 ×10, def = defence×10 × bonus×10
//!   af  = trunc(hp_att×10 × atk × 100 / maxhp_att×10)
//!   df  = trunc(def × hp_def×10 × 100 / maxhp_def×10)
//!   damage      = round_damage(trunc(atk × af × 450 / ((af + df) × 1000)))
//!   retaliation = round_damage(trunc(df × def × 4500 / ((af + df) × 1000 × bonus)))
use crate::data::{js_round, unit_def};
use crate::grid::{is_water, tile_at};
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CombatResult {
    /// whole HP
    pub damage: i32,
    pub retaliation: i32,
}

#[inline]
pub fn has_skill(u: &Unit, skill: Skill) -> bool {
    unit_def(u.ty).has(skill)
}

/// defence multiplier for a unit where it stands (§3.3); Poison halves it (1->0.5, 1.5->0.7, 4->2)
pub fn defence_bonus(s: &GameState, u: &Unit) -> f64 {
    let t = tile_at(s, u.x, u.y);
    let p = &s.players[u.owner as usize];
    let mut bonus = 1.0;
    // ice is its own terrain: Aquatism gives nothing there
    if is_water(t) {
        bonus = if p.has_tech(Tech::Aquatism) && !t.ice { 1.5 } else { 1.0 };
    } else if t.terrain == Terrain::Forest {
        bonus = if p.has_tech(Tech::Archery) { 1.5 } else { 1.0 };
    } else if t.terrain == Terrain::Mountain {
        bonus = if p.has_tech(Tech::Climbing) { 1.5 } else { 1.0 };
    } else if t.city_id.is_some() && has_skill(u, Skill::Fortify) {
        if let Some(city) = s.cities.iter().find(|c| Some(c.id) == t.city_id) {
            if city.owner == u.owner {
                bonus = if city.walls { 4.0 } else { 1.5 };
            }
        }
    }
    if u.poisoned {
        return if bonus == 4.0 {
            2.0
        } else if bonus == 1.5 {
            0.7
        } else {
            0.5
        };
    }
    bonus
}

/// BattleHelpers.Round: tenths of HP to whole HP×10, halves up
#[inline]
fn round_damage(v: f64) -> f64 {
    let base = (v / 10.0).trunc() * 10.0;
    if v % 10.0 >= 10.0 - (v % 10.0) {
        base + 10.0
    } else {
        base
    }
}

/// the pure formula, in whole HP
pub fn compute_damage(attack: f64, attacker_hp: i32, attacker_max_hp: i32, defence: f64, defender_hp: i32, defender_max_hp: i32, bonus: f64) -> CombatResult {
    let ah = js_round(attacker_max_hp as f64 * 10.0);
    let dh = js_round(defender_max_hp as f64 * 10.0);
    if ah < 1.0 || dh < 1.0 {
        return CombatResult { damage: 0, retaliation: 0 };
    }
    let atk = js_round(attack * 10.0) * 10.0;
    let b = js_round(bonus * 10.0);
    let def = js_round(defence * 10.0) * b;
    let af = ((js_round(attacker_hp as f64 * 10.0) * atk * 100.0) / ah).trunc();
    let df = ((def * js_round(defender_hp as f64 * 10.0) * 100.0) / dh).trunc();
    let total = af + df;
    if total <= 0.0 {
        return CombatResult { damage: 0, retaliation: 0 };
    }
    let den = total * 1000.0;
    let dealt = round_damage(((atk * af * 450.0) / den).trunc());
    let back = if b > 0.0 { round_damage(((df * def * 4500.0) / (den * b)).trunc()) } else { 0.0 };
    // TS divides a multiple of 10 by 10: always a whole number
    CombatResult { damage: (dealt / 10.0) as i32, retaliation: (back / 10.0) as i32 }
}

/// half of a damage in whole HP, rounded down: splash, stomp, explosions
#[inline]
pub fn half_damage(damage: i32) -> i32 {
    (damage as f64 / 2.0).floor() as i32
}

/// formula applied to two units in a game state (no retaliation conditions)
pub fn compute_damage_rounded(s: &GameState, attacker: &Unit, defender: &Unit) -> CombatResult {
    compute_damage(
        unit_def(attacker.ty).attack,
        attacker.hp,
        attacker.max_hp,
        unit_def(defender.ty).defence,
        defender.hp,
        defender.max_hp,
        defence_bonus(s, defender),
    )
}
