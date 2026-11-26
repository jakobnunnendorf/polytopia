/**
 * Short tribe descriptions for the new-game screen. The start (tech, unit,
 * stars, capital) is read from CLANS, so it always matches the engine; the
 * one-line character of each tribe follows POLYTOPIA_RULES.md ("Tribes") and
 * docs/shardlands/RULES.md §8.
 */
import { CLAN_BY_ID } from "./data";
import { name } from "./names";

const CHARACTER: Record<string, string> = {
  xinxi: "Mountain tribe: lots of mountains and metal, so mining comes early.",
  imperius: "Fruit-rich land (few animals); can grow its capital on turn 0 by foraging.",
  bardur: "Hunters in the forest; no crops grow on its land.",
  oumaji: "Wide open plains with few forests, animals or mountains; riders spread fast.",
  kickoo: "Coastal tribe: twice the water, more fish, and fish next to the capital.",
  hoodrick: "Forest archers: dense forests, few mountains.",
  luxidoor: "Starts rich: a level 3 capital with every kind of resource around it, but no tech and 2 stars.",
  vengir: "Warlike start with Smithery and a Swordsman; plenty of metal, almost no food.",
  zebasi: "Farmers on open land: few mountains, forests or fruit.",
  aimo: "Calm mountain monks: starts with Philosophy and a Mind Bender; almost no crops.",
  quetzali: "Starts with Strategy and a Defender; lots of fruit, almost no crops.",
  yadakk: "Traders: starts with Roads, lots of fruit, few mountains and forests.",
  aquarion:
    "Special water tribe: every land unit is amphibious, its land floods, and it uses Atolls and Aqua Farms instead of roads and farms.",
  elyrion:
    "Special forest tribe: enchants wild animals into Polytaurs instead of hunting, builds Sanctuaries, and its super unit is a dragon. Sees ruins through clouds.",
  polaris:
    "Special ice tribe: freezes land and water around it, walks and skates on ice, and has no ports or navy. Frozen enemies can't act.",
  cymanti:
    "Special bug tribe: grows Fungi on spores, links cities with Mycelium, and many units poison enemies, halving their defence.",
};

/** "Starts with Climbing, a Warrior and 7★." plus the tribe's character */
export function tribeDescription(id: string): { start: string; character: string } {
  const c = CLAN_BY_ID[id];
  if (!c) return { start: "", character: "" };
  const tech = c.startTech ? (c.techOverrides?.[c.startTech]?.name ?? name("tech", c.startTech)) : null;
  const unit = name("unit", c.startUnit);
  const parts = [
    tech ?? "no tech",
    `${/^[AEIOU]/.test(unit) ? "an" : "a"} ${unit}`,
    `${c.startStars}★`,
    ...(c.capitalLevel > 1 ? [`a level ${c.capitalLevel} capital`] : []),
  ];
  const start = `Starts with ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
  return { start, character: CHARACTER[id] ?? "" };
}
