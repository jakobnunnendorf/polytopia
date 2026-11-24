/** combat.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { GameState, Unit } from "../types";

export type CombatResult = { damage: number; retaliation: number };

export const hasSkill = (u: Unit, skill: string): boolean => call("hasSkill", u, skill);
export const defenceBonus = (s: GameState, u: Unit): number => call("defenceBonus", s, u);
export function computeDamage(
  attack: number,
  attackerHp: number,
  attackerMaxHp: number,
  defence: number,
  defenderHp: number,
  defenderMaxHp: number,
  bonus: number,
): CombatResult {
  return call("computeDamage", attack, attackerHp, attackerMaxHp, defence, defenderHp, defenderMaxHp, bonus);
}
export const halfDamage = (damage: number): number => call("halfDamage", damage);
export const computeDamageRounded = (s: GameState, attacker: Unit, defender: Unit): CombatResult =>
  call("computeDamageRounded", s, attacker, defender);
