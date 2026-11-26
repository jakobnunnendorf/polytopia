/**
 * What each level-up reward does, for the "city leveled up" dialog.
 * Numbers follow docs/shardlands/RULES.md §5.3 and the engine (do_reward in
 * engine/core/src/actions.rs; REWARD_RESOURCES_STARS and REWARD_POP_GROWTH in
 * engine/core/src/data.rs).
 */
import { CLAN_BY_ID, EXPLORER_STEPS, SCORE, UNITS } from "./data";
import { name } from "./names";

export function rewardDescription(reward: string, clan?: string): string {
  switch (reward) {
    case "workshop":
      return "+1★ income from this city every turn.";
    case "explorer":
      return `An explorer walks ${EXPLORER_STEPS} steps from the city and reveals the map around its path.`;
    case "cityWall":
      return "Units that fortify in this city defend ×4 instead of ×1.5.";
    case "resources":
      return "+5★ right away.";
    case "populationGrowth":
      return "+3 population right away, which can level the city up again.";
    case "borderGrowth":
      return "The city's territory grows to a 5×5 area, claiming free tiles and revealing them.";
    case "park":
      return "+1★ income every turn and +250 score.";
    case "superUnit": {
      const unit = (clan && CLAN_BY_ID[clan]?.superUnit) || "giant";
      const def = UNITS[unit];
      const stats = def && def.hp !== null ? ` (${def.hp} HP, ${def.attack} ATK, ${def.defence} DEF)` : "";
      const grows = unit === "dragonEgg" ? " It hatches into a Baby Dragon and then a Fire Dragon." : "";
      return `A ${name("unit", unit)}${stats} appears on the city tile, +${SCORE.superUnit} score.${grows} A unit already there is pushed aside.`;
    }
    default:
      return "";
  }
}
