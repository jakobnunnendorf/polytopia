/**
 * Rules data, matching The Battle of Polytopia 2.18 (regular tribes) as
 * documented in docs/shardlands/RULES.md. Section numbers (§) refer to it.
 * Ids are plain words; display names are in names.ts.
 */

export type Skill =
  | "dash"
  | "escape"
  | "persist"
  | "fortify"
  | "carry"
  | "water"
  | "stiff"
  | "static"
  | "scout"
  | "splash"
  | "stomp"
  | "surprise"
  | "independent"
  | "hide"
  | "infiltrate"
  | "creep"
  | "heal"
  | "convert";

export type UnitDef = {
  id: string;
  /** stars to train (land) or to upgrade a raft to it (naval); also the base of score (5×cost) and disband refund */
  cost: number;
  /** can be trained in a city */
  trainable: boolean;
  /** max HP; null for boats whose HP is the passenger's */
  hp: number | null;
  attack: number;
  defence: number;
  movement: number;
  range: number;
  skills: Skill[];
  /** tech that unlocks training / upgrading; null = none needed */
  tech: string | null;
  naval: boolean;
};

const u = (
  id: string,
  cost: number,
  trainable: boolean,
  hp: number | null,
  attack: number,
  defence: number,
  movement: number,
  range: number,
  skills: Skill[],
  tech: string | null,
  naval = false,
): UnitDef => ({ id, cost, trainable, hp, attack, defence, movement, range, skills, tech, naval });

/** §2.1, §2.2 */
export const UNITS: Record<string, UnitDef> = {
  warrior: u("warrior", 2, true, 10, 2, 2, 1, 1, ["dash", "fortify"], null),
  rider: u("rider", 3, true, 10, 2, 1, 2, 1, ["dash", "escape", "fortify"], "riding"),
  archer: u("archer", 3, true, 10, 2, 1, 1, 2, ["dash", "fortify"], "archery"),
  defender: u("defender", 3, true, 15, 1, 3, 1, 1, ["fortify"], "strategy"),
  swordsman: u("swordsman", 5, true, 15, 3, 3, 1, 1, ["dash"], "smithery"),
  mindBender: u("mindBender", 5, true, 10, 0, 1, 1, 1, ["heal", "convert", "stiff"], "philosophy"),
  catapult: u("catapult", 8, true, 10, 4, 0, 1, 3, ["stiff"], "mathematics"),
  knight: u("knight", 8, true, 10, 3.5, 1, 3, 1, ["dash", "persist", "fortify"], "chivalry"),
  cloak: u("cloak", 8, true, 5, 0, 0.5, 2, 1, ["hide", "infiltrate", "dash", "scout", "creep", "stiff", "static"], "diplomacy"),
  dagger: u("dagger", 2, false, 10, 2, 2, 1, 1, ["dash", "surprise", "independent", "static"], null),
  giant: u("giant", 10, false, 40, 5, 4, 1, 1, ["static"], null),
  // boats: HP = passenger's (null) unless they carry their own
  raft: u("raft", 0, false, null, 0, 1, 2, 0, ["water", "carry", "stiff", "static"], "fishing", true),
  scout: u("scout", 5, false, null, 2, 1, 3, 2, ["water", "carry", "dash", "scout", "static"], "sailing", true),
  rammer: u("rammer", 5, false, null, 3, 3, 3, 1, ["water", "carry", "dash", "static"], "ramming", true),
  bomber: u("bomber", 15, false, null, 3, 2, 2, 3, ["water", "carry", "splash", "stiff", "static"], "navigation", true),
  juggernaut: u("juggernaut", 0, false, 40, 4, 4, 2, 1, ["water", "carry", "stomp", "stiff", "static"], null, true),
  dinghy: u("dinghy", 0, false, 5, 0, 0.5, 2, 1, ["water", "carry", "hide", "infiltrate", "dash", "scout", "stiff", "static"], null, true),
  pirate: u("pirate", 0, false, 10, 2, 2, 2, 1, ["water", "carry", "dash", "surprise", "independent", "static"], null, true),
};

/** boat form a land unit takes when it enters an own port (§4.2); default raft */
export const EMBARK_AS: Record<string, string> = {
  giant: "juggernaut",
  cloak: "dinghy",
  dagger: "pirate",
};

/** raft upgrades (§2.2): only an own raft in own territory, full price of the boat */
export const RAFT_UPGRADES = ["scout", "rammer", "bomber"] as const;

export type TechDef = {
  id: string;
  tier: 1 | 2 | 3;
  parent: string | null;
  /** short description of what it unlocks (shown in the tech screen) */
  unlocks: string;
};

/** §1.2 */
export const TECHS: TechDef[] = [
  { id: "riding", tier: 1, parent: null, unlocks: "Outrider" },
  { id: "roads", tier: 2, parent: "riding", unlocks: "roads, bridges" },
  { id: "trade", tier: 3, parent: "roads", unlocks: "Bazaar" },
  { id: "freeSpirit", tier: 2, parent: "riding", unlocks: "Shrine, disband" },
  { id: "chivalry", tier: 3, parent: "freeSpirit", unlocks: "Lancer, destroy" },

  { id: "organization", tier: 1, parent: null, unlocks: "gather berries, see grain" },
  { id: "farming", tier: 2, parent: "organization", unlocks: "Field Plot" },
  { id: "construction", tier: 3, parent: "farming", unlocks: "Grainmill, burn forest" },
  { id: "strategy", tier: 2, parent: "organization", unlocks: "Shieldbearer" },
  { id: "diplomacy", tier: 3, parent: "strategy", unlocks: "Shade, Envoy Lodge, capital vision" },

  { id: "climbing", tier: 1, parent: null, unlocks: "crag moves, crag defence, see ore" },
  { id: "mining", tier: 2, parent: "climbing", unlocks: "Delve" },
  { id: "smithery", tier: 3, parent: "mining", unlocks: "Blademaster, Smeltery" },
  { id: "meditation", tier: 2, parent: "climbing", unlocks: "Peak Shrine, pacifist task" },
  { id: "philosophy", tier: 3, parent: "meditation", unlocks: "Whisperer, -33% lore cost" },

  { id: "hunting", tier: 1, parent: null, unlocks: "hunt deer" },
  { id: "archery", tier: 2, parent: "hunting", unlocks: "Slinger, woods defence" },
  { id: "spiritualism", tier: 3, parent: "archery", unlocks: "Grove Shrine, grow forest" },
  { id: "forestry", tier: 2, parent: "hunting", unlocks: "Woodcutter, clear forest" },
  { id: "mathematics", tier: 3, parent: "forestry", unlocks: "Trebuchet, Timberyard" },

  { id: "fishing", tier: 1, parent: null, unlocks: "fish, Harbor, Skiff, shallows" },
  { id: "sailing", tier: 2, parent: "fishing", unlocks: "Sloop, deep sea" },
  { id: "navigation", tier: 3, parent: "sailing", unlocks: "Mortar Barge, sea shards" },
  { id: "ramming", tier: 2, parent: "fishing", unlocks: "Ironprow" },
  { id: "aquatism", tier: 3, parent: "ramming", unlocks: "Tide Shrine, sea defence" },
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(
  TECHS.map((t) => [t.id, t]),
);

/** §1.1: price = ceil((4 + tier × cities) × m), m = 1 or 0.66666 with Literacy */
export function techCostFor(tier: number, cities: number, literacy: boolean): number {
  const base = 4 + tier * cities;
  return literacy ? Math.ceil(base * Math.fround(0.66666) - 1e-9) : base;
}

/**
 * Tile actions and buildings (§5.4, §5.5, §4.4). "harvest" kinds consume a
 * resource or change terrain and leave no building.
 */
export type BuildDef = {
  id: string;
  cost: number;
  tech: string;
  kind: "building" | "harvest" | "road" | "bridge" | "temple" | "monument" | "destroy" | "embassy";
  /** allowed terrain */
  terrain: ("field" | "forest" | "mountain" | "water" | "ocean")[];
  /** required resource on the tile */
  resource?: string;
  /** population given to the tile's city */
  pop: number;
  /** stars gained (negative cost) */
  gain?: number;
  /** adjacency requirement: an own neighbour with this building */
  nextTo?: string[];
  /** at most one per city territory */
  onePerCity?: boolean;
};

export const BUILDS: Record<string, BuildDef> = {
  harvestFruit: { id: "harvestFruit", cost: 2, tech: "organization", kind: "harvest", terrain: ["field"], resource: "fruit", pop: 1 },
  hunt: { id: "hunt", cost: 2, tech: "hunting", kind: "harvest", terrain: ["forest"], resource: "animal", pop: 1 },
  fish: { id: "fish", cost: 2, tech: "fishing", kind: "harvest", terrain: ["water"], resource: "fish", pop: 1 },
  clearForest: { id: "clearForest", cost: 0, gain: 1, tech: "forestry", kind: "harvest", terrain: ["forest"], pop: 0 },
  burnForest: { id: "burnForest", cost: 3, tech: "construction", kind: "harvest", terrain: ["forest"], pop: 0 },
  growForest: { id: "growForest", cost: 5, tech: "spiritualism", kind: "harvest", terrain: ["field"], pop: 0 },

  farm: { id: "farm", cost: 5, tech: "farming", kind: "building", terrain: ["field"], resource: "crop", pop: 2 },
  mine: { id: "mine", cost: 5, tech: "mining", kind: "building", terrain: ["mountain"], resource: "metal", pop: 2 },
  lumberHut: { id: "lumberHut", cost: 3, tech: "forestry", kind: "building", terrain: ["forest"], pop: 1 },
  windmill: { id: "windmill", cost: 5, tech: "construction", kind: "building", terrain: ["field"], pop: 0, nextTo: ["farm"], onePerCity: true },
  sawmill: { id: "sawmill", cost: 5, tech: "mathematics", kind: "building", terrain: ["field"], pop: 0, nextTo: ["lumberHut"], onePerCity: true },
  forge: { id: "forge", cost: 5, tech: "smithery", kind: "building", terrain: ["field", "forest"], pop: 0, nextTo: ["mine"], onePerCity: true },
  market: { id: "market", cost: 5, tech: "trade", kind: "building", terrain: ["field"], pop: 0, nextTo: ["windmill", "sawmill", "forge"], onePerCity: true },
  port: { id: "port", cost: 7, tech: "fishing", kind: "building", terrain: ["water"], pop: 1 },

  temple: { id: "temple", cost: 20, tech: "freeSpirit", kind: "temple", terrain: ["field"], pop: 1 },
  mountainTemple: { id: "mountainTemple", cost: 20, tech: "meditation", kind: "temple", terrain: ["mountain"], pop: 1 },
  forestTemple: { id: "forestTemple", cost: 15, tech: "spiritualism", kind: "temple", terrain: ["forest"], pop: 1 },
  waterTemple: { id: "waterTemple", cost: 20, tech: "aquatism", kind: "temple", terrain: ["water", "ocean"], pop: 1 },

  road: { id: "road", cost: 3, tech: "roads", kind: "road", terrain: ["field", "forest"], pop: 0 },
  bridge: { id: "bridge", cost: 5, tech: "roads", kind: "bridge", terrain: ["water"], pop: 0 },
  destroy: { id: "destroy", cost: 0, tech: "chivalry", kind: "destroy", terrain: ["field", "forest", "mountain", "water", "ocean"], pop: 0 },
  embassy: { id: "embassy", cost: 5, tech: "diplomacy", kind: "embassy", terrain: ["field"], pop: 0 },
};

/** feeder -> leveling building it raises, and population per level (§5.5) */
export const FEEDS: Record<string, { building: string; popPerLevel: number }> = {
  farm: { building: "windmill", popPerLevel: 1 },
  lumberHut: { building: "sawmill", popPerLevel: 1 },
  mine: { building: "forge", popPerLevel: 2 },
};
export const LEVEL_CAP = 8;
export const MARKET_CAP = 8;

/** monuments (§7.3): task id -> monument building id */
export const MONUMENTS: Record<string, string> = {
  pacifist: "altarOfPeace",
  genius: "towerOfWisdom",
  wealth: "emperorsTomb",
  killer: "gateOfPower",
  metropolis: "parkOfFortune",
  network: "grandBazaar",
  explorer: "eyeOfGod",
};
for (const m of Object.values(MONUMENTS)) {
  BUILDS[m] = { id: m, cost: 0, tech: "", kind: "monument", terrain: ["field", "water"], pop: 3 };
}

/** level-up rewards (§5.3): new level -> [option A, option B] */
export function rewardOptions(level: number): [string, string] {
  if (level === 2) return ["workshop", "explorer"];
  if (level === 3) return ["cityWall", "resources"];
  if (level === 4) return ["populationGrowth", "borderGrowth"];
  return ["park", "superUnit"];
}

export const START_STARS = 5;
export const EXPLORER_STEPS = 12;
export const PERFECTION_TURNS = 30;
export const STARFISH_STARS = 8;
export const RUIN_STARS = 10;
export const EMBASSY_INCOME = 2;

/** score (§7.1) */
export const SCORE = {
  perUnitCost: 5,
  superUnit: 50,
  territoryTile: 20,
  exploredTile: 5,
  city: 100,
  cityLevel: 50,
  park: 250,
  monument: 400,
  templeLevel: 100,
  templeMaxLevel: 5,
  techTier: 100,
};

/**
 * Clans (§8): each mirrors one regular tribe's mechanics (starting tech,
 * starting unit, starting stars, terrain spawn modifiers from §6.3), named
 * after the historical people that best fits that mechanic.
 */
export type ClanDef = {
  id: string;
  startTech: string | null;
  startUnit: string;
  startStars: number;
  capitalLevel: number;
  mod: Partial<Record<"mountain" | "forest" | "fruit" | "crop" | "animal" | "fish" | "metal", number>>;
};

export const CLANS: ClanDef[] = [
  { id: "inca", startTech: "climbing", startUnit: "warrior", startStars: 7, capitalLevel: 1, mod: { mountain: 1.5, metal: 1.5 } },
  { id: "romans", startTech: "organization", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { animal: 0.5, fruit: 2 } },
  { id: "norse", startTech: "hunting", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { forest: 0.8, crop: 0 } },
  { id: "mongols", startTech: "riding", startUnit: "rider", startStars: 6, capitalLevel: 1, mod: { forest: 0.2, animal: 0.2, mountain: 0.5 } },
  { id: "polynesians", startTech: "fishing", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { mountain: 0.5, fish: 1.5 } },
  { id: "welsh", startTech: "archery", startUnit: "archer", startStars: 7, capitalLevel: 1, mod: { mountain: 0.5, forest: 1.5 } },
  { id: "lydians", startTech: null, startUnit: "warrior", startStars: 2, capitalLevel: 3, mod: {} },
  { id: "hittites", startTech: "smithery", startUnit: "swordsman", startStars: 5, capitalLevel: 1, mod: { metal: 2, animal: 0.1, fruit: 0.1, fish: 0.1 } },
  { id: "sumerians", startTech: "farming", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { mountain: 0.5, forest: 0.5, fruit: 0.5 } },
  { id: "tibetans", startTech: "philosophy", startUnit: "mindBender", startStars: 5, capitalLevel: 1, mod: { mountain: 1.5, crop: 0.1 } },
  { id: "spartans", startTech: "strategy", startUnit: "defender", startStars: 7, capitalLevel: 1, mod: { fruit: 2, crop: 0.1 } },
  { id: "persians", startTech: "roads", startUnit: "warrior", startStars: 7, capitalLevel: 1, mod: { mountain: 0.5, forest: 0.5, fruit: 1.5 } },
];

export const CLAN_BY_ID: Record<string, ClanDef> = Object.fromEntries(CLANS.map((c) => [c.id, c]));
