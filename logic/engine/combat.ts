/**
 * Combat, per the wiki "Combat" page:
 *
 *   attackForce  = attacker.attack * (attacker.hp / attacker.maxHp)
 *   defenseForce = defender.defence * (defender.hp / defender.maxHp) * defenceBonus
 *   total        = attackForce + defenseForce
 *   attackResult  = round(attackForce  / total * attacker.attack  * 4.5)
 *   defenceResult = round(defenseForce / total * defender.defence * 4.5)
 *
 * defenceBonus: 1 normally; 1.5 on forest (archery), mountain (climbing),
 * water/ocean (aquatism), or in a friendly city for fortify units; 4 in a
 * friendly city with a wall (fortify units only). Splash damage to units
 * adjacent to the target is attackResult / 2, not rounded.
 *
 * No retaliation if the defender dies, the attacker is outside the defender's
 * range, the defender is stiff, or the attacker has surprise.
 */
import { UNITS } from "./data";
import { dist, tileAt } from "./grid";
import type { GameState, Unit } from "./types";

export function unitDef(u: Unit) {
  return UNITS[u.type];
}

export function hasSkill(u: Unit, skill: string): boolean {
  return (UNITS[u.type].skills as string[]).includes(skill);
}

export function hasTech(s: GameState, player: number, tech: string): boolean {
  return s.players[player].techs.includes(tech);
}

/** defence multiplier for a unit standing where it stands */
export function defenceBonus(s: GameState, u: Unit): number {
  const t = tileAt(s, u.x, u.y);
  if (t.cityId !== null) {
    const city = s.cities.find((c) => c.id === t.cityId);
    if (city && city.owner === u.owner && hasSkill(u, "fortify")) {
      return city.walls ? 4 : 1.5;
    }
  }
  const tech = (k: string) => hasTech(s, u.owner, k);
  if (t.terrain === "forest" && tech("archery")) return 1.5;
  if (t.terrain === "mountain" && tech("climbing")) return 1.5;
  if ((t.terrain === "water" || t.terrain === "ocean") && tech("aquatism")) return 1.5;
  return 1;
}

export type CombatResult = { damage: number; retaliation: number };

/** pure damage calculation (no state changes) */
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
  const defenseForce = defence * (defenderHp / defenderMaxHp) * bonus;
  const total = attackForce + defenseForce;
  if (total === 0) return { damage: 0, retaliation: 0 };
  return {
    damage: Math.round((attackForce / total) * attack * 4.5),
    retaliation: Math.round((defenseForce / total) * defence * 4.5),
  };
}

export function previewAttack(s: GameState, attacker: Unit, defender: Unit): CombatResult {
  const a = unitDef(attacker);
  const d = unitDef(defender);
  const r = computeDamage(
    a.attack,
    attacker.hp,
    attacker.maxHp,
    d.defence,
    defender.hp,
    defender.maxHp,
    defenceBonus(s, defender),
  );
  const killed = defender.hp - r.damage <= 0;
  const noRetaliation =
    killed ||
    hasSkill(defender, "stiff") ||
    hasSkill(attacker, "surprise") ||
    dist(attacker, defender) > d.range ||
    // defender cannot see the attacker (attacker's tile still in its fog)
    s.players[defender.owner].explored[attacker.y * s.mapSize + attacker.x] !== 1;
  return { damage: r.damage, retaliation: noRetaliation ? 0 : r.retaliation };
}
