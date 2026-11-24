/**
 * Combat (2.18; logic follows polybots-engine combat.rs:battle, integer
 * arithmetic in tenths of HP with truncating divisions):
 *
 *   atk = attack×10 ×10, def = defence×10 × bonus×10 (bonus 10/15/40, halved when poisoned)
 *   af  = trunc(hp_att×10 × atk × 100 / maxhp_att×10)
 *   df  = trunc(def × hp_def×10 × 100 / maxhp_def×10)
 *   damage      = round_damage(trunc(atk × af × 450 / ((af + df) × 1000)))
 *   retaliation = round_damage(trunc(df × def × 4500 / ((af + df) × 1000 × bonus)))
 *
 * round_damage rounds to whole HP, halves up. Both use the forces computed
 * BEFORE the damage is applied. Retaliation only happens if the defender
 * survives, is not stiff, the attacker has no surprise/convert, the attacker is
 * within the defender's range and on a tile the defender's owner has explored.
 */
import { UNITS } from "./data";
import { isWater, tileAt } from "./grid";
import type { GameState, Unit } from "./types";

export function hasSkill(u: Unit, skill: string): boolean {
  return (UNITS[u.type].skills as string[]).includes(skill);
}

/** defence multiplier for a unit where it stands (§3.3); Poison halves it (1->0.5, 1.5->0.7, 4->2) */
export function defenceBonus(s: GameState, u: Unit): number {
  const t = tileAt(s, u.x, u.y);
  const tech = (k: string) => s.players[u.owner].techs.includes(k);
  let bonus = 1;
  // ice is its own terrain: Aquatism (water, ocean) gives nothing there (S1 combat::defence_bonus)
  if (isWater(t)) bonus = tech("aquatism") && !t.ice ? 1.5 : 1;
  else if (t.terrain === "forest") bonus = tech("archery") ? 1.5 : 1;
  else if (t.terrain === "mountain") bonus = tech("climbing") ? 1.5 : 1;
  else if (t.cityId !== null && hasSkill(u, "fortify")) {
    const city = s.cities.find((c) => c.id === t.cityId);
    if (city && city.owner === u.owner) bonus = city.walls ? 4 : 1.5;
  }
  if (u.poisoned) return bonus === 4 ? 2 : bonus === 1.5 ? 0.7 : 0.5;
  return bonus;
}

export type CombatResult = { damage: number; retaliation: number };

/** BattleHelpers.Round (S1 combat::round_damage): tenths of HP to whole HP×10, halves up */
function roundDamage(v: number): number {
  const base = Math.trunc(v / 10) * 10;
  return v % 10 >= 10 - (v % 10) ? base + 10 : base;
}

/** the pure formula (S1 combat::battle), in whole HP */
export function computeDamage(
  attack: number,
  attackerHp: number,
  attackerMaxHp: number,
  defence: number,
  defenderHp: number,
  defenderMaxHp: number,
  bonus: number,
): CombatResult {
  const ah = Math.round(attackerMaxHp * 10);
  const dh = Math.round(defenderMaxHp * 10);
  if (ah < 1 || dh < 1) return { damage: 0, retaliation: 0 };
  const atk = Math.round(attack * 10) * 10;
  const b = Math.round(bonus * 10);
  const def = Math.round(defence * 10) * b;
  const af = Math.trunc((Math.round(attackerHp * 10) * atk * 100) / ah);
  const df = Math.trunc((def * Math.round(defenderHp * 10) * 100) / dh);
  const total = af + df;
  if (total <= 0) return { damage: 0, retaliation: 0 };
  const den = total * 1000;
  const dealt = roundDamage(Math.trunc((atk * af * 450) / den));
  const back = b > 0 ? roundDamage(Math.trunc((df * def * 4500) / (den * b))) : 0;
  return { damage: dealt / 10, retaliation: back / 10 };
}

/** half of a damage in whole HP, rounded down (S1 attack::half_damage): splash, stomp, explosions */
export function halfDamage(damage: number): number {
  return Math.floor(damage / 2);
}

/** formula applied to two units in a game state (no retaliation conditions) */
export function computeDamageRounded(s: GameState, attacker: Unit, defender: Unit): CombatResult {
  const atk = UNITS[attacker.type].attack;
  return computeDamage(
    atk,
    attacker.hp,
    attacker.maxHp,
    UNITS[defender.type].defence,
    defender.hp,
    defender.maxHp,
    defenceBonus(s, defender),
  );
}
