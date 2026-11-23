/**
 * Combat (RULES.md §3.1-§3.3):
 *
 *   attackForce  = A_att × (hp_att / maxhp_att)
 *   defenceForce = D_def × (hp_def / maxhp_def) × defenceBonus
 *   total        = attackForce + defenceForce
 *   damage       = roundHalfUp(attackForce  / total × A_att × 4.5)
 *   retaliation  = roundHalfUp(defenceForce / total × D_def × 4.5)
 *
 * Both use the forces computed BEFORE the damage is applied. Retaliation only
 * happens if the defender survives, is not stiff, the attacker has no
 * surprise/convert, the attacker is within the defender's range and on a tile
 * the defender's owner has explored.
 */
import { UNITS } from "./data";
import { isWater, tileAt } from "./grid";
import type { GameState, Unit } from "./types";

export const roundHalfUp = (x: number) => Math.floor(x + 0.5 + 1e-6);

export function hasSkill(u: Unit, skill: string): boolean {
  return (UNITS[u.type].skills as string[]).includes(skill);
}

/** defence multiplier for a unit where it stands (§3.3) */
export function defenceBonus(s: GameState, u: Unit): number {
  const t = tileAt(s, u.x, u.y);
  const tech = (k: string) => s.players[u.owner].techs.includes(k);
  if (isWater(t)) return tech("aquatism") ? 1.5 : 1;
  if (t.terrain === "forest") return tech("archery") ? 1.5 : 1;
  if (t.terrain === "mountain") return tech("climbing") ? 1.5 : 1;
  if (t.cityId !== null && hasSkill(u, "fortify")) {
    const city = s.cities.find((c) => c.id === t.cityId);
    if (city && city.owner === u.owner) return city.walls ? 4 : 1.5;
  }
  return 1;
}

export type CombatResult = { damage: number; retaliation: number };

/** the pure formula */
export function computeDamage(
  attack: number,
  attackerHp: number,
  attackerMaxHp: number,
  defence: number,
  defenderHp: number,
  defenderMaxHp: number,
  bonus: number,
): CombatResult {
  const attackForce = attack * (attackerHp / attackerMaxHp);
  const defenceForce = defence * (defenderHp / defenderMaxHp) * bonus;
  const total = attackForce + defenceForce;
  if (total === 0) return { damage: 0, retaliation: 0 };
  return {
    damage: roundHalfUp((attackForce / total) * attack * 4.5),
    retaliation: roundHalfUp((defenceForce / total) * defence * 4.5),
  };
}

/** formula applied to two units in a game state (no retaliation conditions) */
export function computeDamageRounded(s: GameState, attacker: Unit, defender: Unit): CombatResult {
  return computeDamage(
    UNITS[attacker.type].attack,
    attacker.hp,
    attacker.maxHp,
    UNITS[defender.type].defence,
    defender.hp,
    defender.maxHp,
    defenceBonus(s, defender),
  );
}
