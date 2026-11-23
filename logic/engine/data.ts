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
  | "convert"
  // Special tribe skills
  | "amphibious"
  | "fly"
  | "freeze"
  | "freezeArea"
  | "autoFreeze"
  | "skate"
  | "poison"
  | "boost"
  | "explode"
  | "eat"
  | "grow";

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
  dinghy: u("dinghy", 0, false, 5, 0, 0.5, 2, 1, ["water", "carry", "hide", "creep", "infiltrate", "stiff"], null, true),
  pirate: u("pirate", 0, false, 10, 2, 2, 2, 1, ["water", "carry", "dash", "surprise", "independent", "static"], null, true),

  // ---- Special tribe units (exact Polytopia 2.18 stats) ----
  // Aquarion (2.10 rework)
  mermaid: u("mermaid", 2, true, 10, 2, 2, 1, 1, ["dash", "fortify", "amphibious"], null),
  amphibian: u("amphibian", 3, true, 10, 2, 1, 2, 1, ["dash", "escape", "fortify", "amphibious"], "riding"),
  shark: u("shark", 8, true, 10, 3.5, 2, 3, 1, ["dash", "surprise", "water"], "sailing", true),
  jelly: u("jelly", 8, true, 20, 2, 2, 2, 1, ["water", "stiff", "static"], "navigation", true),
  puffer: u("puffer", 8, true, 10, 4, 0, 2, 3, ["water", "stiff"], "mathematics", true),
  tridention: u("tridention", 8, true, 10, 2.5, 1, 2, 2, ["dash", "persist", "amphibious"], "chivalry"),
  crab: u("crab", 10, false, 40, 4, 4, 1, 1, ["escape", "static", "amphibious"], null),

  // Elyrion (2.15 balance pass)
  polytaur: u("polytaur", 3, false, 15, 3, 1, 1, 1, ["dash", "fortify", "independent", "static"], null),
  dragonEgg: u("dragonEgg", 10, false, 10, 0, 2, 1, 0, ["fortify", "stiff", "static", "grow"], null),
  babyDragon: u("babyDragon", 10, false, 15, 3, 3, 2, 1, ["dash", "escape", "fly", "scout", "static", "grow"], null),
  fireDragon: u("fireDragon", 10, false, 20, 4, 3, 3, 2, ["dash", "splash", "fly", "scout", "static"], null),

  // Polaris (2.15 balance pass)
  mooni: u("mooni", 5, true, 10, 0, 1, 1, 1, ["autoFreeze", "freezeArea", "skate", "stiff", "static"], "fishing"),
  iceArcher: u("iceArcher", 3, true, 10, 1, 1, 1, 2, ["dash", "fortify", "freeze", "stiff"], "archery"),
  battleSled: u("battleSled", 5, true, 15, 3, 2, 2, 1, ["dash", "escape", "skate"], "sailing"),
  iceFortress: u("iceFortress", 15, true, 20, 4, 3, 1, 2, ["escape", "scout", "skate", "static"], "navigation"),
  gaami: u("gaami", 10, false, 30, 4, 3, 1, 1, ["autoFreeze", "freezeArea", "static"], null),

  // Cymanti (2.15 rework)
  shaman: u("shaman", 5, true, 10, 1, 1, 1, 1, ["convert", "boost", "stiff"], "meditation"),
  hexapod: u("hexapod", 3, true, 5, 3, 1, 2, 1, ["dash", "escape", "creep", "hide"], "riding"),
  kiton: u("kiton", 3, true, 15, 1, 3, 1, 1, ["creep", "poison"], "strategy"),
  phychi: u("phychi", 3, true, 5, 0.7, 1, 2, 2, ["dash", "fly", "poison", "surprise"], "archery"),
  mantis: u("mantis", 5, true, 15, 3, 3, 1, 1, ["dash", "creep"], "smithery"),
  moth: u("moth", 5, true, 10, 0, 0.1, 2, 1, ["fly", "dash", "infiltrate", "poison", "static", "stiff"], "diplomacy"),
  raychi: u("raychi", 5, true, 10, 3, 2, 3, 1, ["water", "dash"], "sailing", true),
  boomchi: u("boomchi", 5, true, 10, 3, 3, 1, 1, ["dash", "explode", "stiff", "amphibious"], "ramming"),
  exida: u("exida", 8, true, 10, 3, 1, 2, 3, ["creep", "splash", "poison"], "mathematics"),
  doomux: u("doomux", 10, true, 20, 3.5, 2, 3, 1, ["dash", "creep", "explode", "static"], "chivalry"),
  livingIsland: u("livingIsland", 20, true, 20, 4, 4, 2, 1, ["water", "stomp", "poison", "static"], "navigation", true),
  centipede: u("centipede", 10, false, 20, 4, 3, 2, 1, ["dash", "creep", "eat", "static"], null),
  segment: u("segment", 2, false, 10, 2, 2, 1, 1, ["creep", "dash", "explode", "independent", "stiff", "static"], null),
};

/** Special-tribe-only trainable units (filtered by tribe in legalActions) */
export const TRIBE_ONLY_UNITS = new Set([
  "mermaid", "amphibian", "shark", "jelly", "puffer", "tridention",
  "mooni", "iceArcher", "battleSled", "iceFortress",
  "shaman", "hexapod", "kiton", "phychi", "mantis", "moth", "raychi", "boomchi", "exida", "doomux", "livingIsland",
]);

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
  { id: "riding", tier: 1, parent: null, unlocks: "Rider" },
  { id: "roads", tier: 2, parent: "riding", unlocks: "Roads, Bridges" },
  { id: "trade", tier: 3, parent: "roads", unlocks: "Market" },
  { id: "freeSpirit", tier: 2, parent: "riding", unlocks: "Temple, Disband" },
  { id: "chivalry", tier: 3, parent: "freeSpirit", unlocks: "Knight, Destroy" },

  { id: "organization", tier: 1, parent: null, unlocks: "Harvest Fruit, Crop" },
  { id: "farming", tier: 2, parent: "organization", unlocks: "Farm" },
  { id: "construction", tier: 3, parent: "farming", unlocks: "Windmill, Burn Forest" },
  { id: "strategy", tier: 2, parent: "organization", unlocks: "Defender" },
  { id: "diplomacy", tier: 3, parent: "strategy", unlocks: "Cloak, Embassy, capital vision" },

  { id: "climbing", tier: 1, parent: null, unlocks: "Mountain movement & defence, Metal" },
  { id: "mining", tier: 2, parent: "climbing", unlocks: "Mine" },
  { id: "smithery", tier: 3, parent: "mining", unlocks: "Swordsman, Forge" },
  { id: "meditation", tier: 2, parent: "climbing", unlocks: "Mountain Temple, Pacifist task" },
  { id: "philosophy", tier: 3, parent: "meditation", unlocks: "Mind Bender, -33% tech cost" },

  { id: "hunting", tier: 1, parent: null, unlocks: "Hunt Animal" },
  { id: "archery", tier: 2, parent: "hunting", unlocks: "Archer, Forest defence" },
  { id: "spiritualism", tier: 3, parent: "archery", unlocks: "Forest Temple, Grow Forest" },
  { id: "forestry", tier: 2, parent: "hunting", unlocks: "Lumber Hut, Clear Forest" },
  { id: "mathematics", tier: 3, parent: "forestry", unlocks: "Catapult, Sawmill" },

  { id: "fishing", tier: 1, parent: null, unlocks: "Fish, Port, Raft, Water" },
  { id: "sailing", tier: 2, parent: "fishing", unlocks: "Scout, Ocean" },
  { id: "navigation", tier: 3, parent: "sailing", unlocks: "Bomber, Starfish" },
  { id: "ramming", tier: 2, parent: "fishing", unlocks: "Rammer" },
  { id: "aquatism", tier: 3, parent: "ramming", unlocks: "Water Temple, Water defence" },
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
  fish: { id: "fish", cost: 2, tech: "fishing", kind: "harvest", terrain: ["water", "ocean"], resource: "fish", pop: 1 },
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

  // ---- Special tribe builds & buildings ----
  // Elyrion
  enchantAnimal: { id: "enchantAnimal", cost: 3, tech: "hunting", kind: "harvest", terrain: ["forest"], resource: "animal", pop: 0 },
  sanctuary: { id: "sanctuary", cost: 5, tech: "forestry", kind: "building", terrain: ["field", "forest"], pop: 0, onePerCity: true },
  // Polaris
  outpost: { id: "outpost", cost: 5, tech: "fishing", kind: "building", terrain: ["water", "ocean"], pop: 1 },
  iceBank: { id: "iceBank", cost: 20, tech: "trade", kind: "building", terrain: ["field"], pop: 0, onePerCity: true },
  // Cymanti
  fungi: { id: "fungi", cost: 5, tech: "farming", kind: "building", terrain: ["field"], resource: "crop", pop: 3 },
  mycelium: { id: "mycelium", cost: 5, tech: "construction", kind: "building", terrain: ["field"], pop: 0, onePerCity: true },
  clathrus: { id: "clathrus", cost: 5, tech: "trade", kind: "building", terrain: ["field"], pop: 0, onePerCity: true },
};

/** Special-tribe-only builds (filtered by tribe in canBuild) */
export const TRIBE_ONLY_BUILDS = new Set([
  "enchantAnimal", "sanctuary", "outpost", "iceBank", "fungi", "mycelium", "clathrus",
]);

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
export const EXPLORER_STEPS = 15;
export const PERFECTION_TURNS = 30;
export const STARFISH_STARS = 8;
export const RUIN_STARS = 10;
export const EMBASSY_INCOME = 2;
/** ports link to own ports within this range (rules doc, The capital and connections) */
export const PORT_RANGE = 5;
/** Glory: first to this score wins (rules doc, Modes) */
export const GLORY_TARGET = 10_000;
/**
 * Capital income bonus over a plain city of the same level (rules doc, Income per turn and AI and difficulty):
 * a human's capital +1; a bot's level-1 capital makes 1/2/3/5★ by difficulty, i.e. +0/+1/+2/+4.
 */
export const HUMAN_CAPITAL_BONUS = 1;
export const BOT_CAPITAL_BONUS = { easy: 0, normal: 1, hard: 2, crazy: 4 } as const;
/** Perfection bonus difficulty part d (rules doc, Perfection difficulty bonus) */
export const PERFECTION_DIFFICULTY_BONUS = { easy: 0, normal: 0.2, hard: 0.4, crazy: 0.8 } as const;
/** Perfection rating that earns 1, 2, 3 stars and a halo (rules doc, Modes) */
export const PERFECTION_STARS = [3_000, 10_000, 50_000, 100_000];
/** most tribes per map size (rules doc, Map sizes): Tiny 9, every other size 16 */
export const maxPlayersFor = (mapSize: number) => (mapSize <= 11 ? 9 : 16);

/** score (§7.1) */
export const SCORE = {
  perUnitCost: 5,
  superUnit: 50,
  territoryTile: 20,
  exploredTile: 5,
  city: 100,
  /** per point of population a city has gained (levels and current population; negative counts against) */
  cityPop: 5,
  /** level-up bonus by the level reached (rules doc, Scoring: 40 at level 2, 35 at level 3, "falling after") */
  cityLevelBonus: (level: number) => Math.max(0, 50 - 5 * level),
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
  /** true for the 4 special tribes (Aquarion, Elyrion, Polaris, Cymanti) */
  special?: boolean;
  /** super unit spawned by the level 5+ city reward (default: "giant") */
  superUnit?: string;
  /** trainable units replaced for this tribe (standardUnit -> specialUnit, or null to disable) */
  unitReplacements?: Record<string, string | null>;
  /** extra trainable units unique to this tribe (not replacing a standard unit) */
  extraUnits?: string[];
  /** builds replaced for this tribe (standardBuild -> specialBuild, or null to disable) */
  buildReplacements?: Record<string, string | null>;
  /** extra builds unique to this tribe */
  extraBuilds?: string[];
  /** tech tree display overrides for special tribes (techId -> { name, unlocks }) */
  techOverrides?: Record<string, { name: string; unlocks: string }>;
  /** signature tribe colour (used in UI & tribe badges) */
  color?: string;
};

export const CLANS: ClanDef[] = [
  // ---- 12 Regular Tribes ----
  { id: "inca", startTech: "climbing", startUnit: "warrior", startStars: 7, capitalLevel: 1, mod: { mountain: 1.5, metal: 1.5 }, color: "#e63946" },
  { id: "romans", startTech: "organization", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { animal: 0.5, fruit: 2 }, color: "#2589f5" },
  { id: "norse", startTech: "hunting", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { forest: 0.8, crop: 0 }, color: "#3b4252" },
  { id: "mongols", startTech: "riding", startUnit: "rider", startStars: 6, capitalLevel: 1, mod: { forest: 0.2, animal: 0.2, mountain: 0.5 }, color: "#f4c430" },
  { id: "polynesians", startTech: "fishing", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { mountain: 0.5, fish: 1.5 }, color: "#2db84d" },
  { id: "welsh", startTech: "archery", startUnit: "archer", startStars: 7, capitalLevel: 1, mod: { mountain: 0.5, forest: 1.5 }, color: "#8c6239" },
  { id: "lydians", startTech: null, startUnit: "warrior", startStars: 2, capitalLevel: 2, mod: {}, color: "#9b5de5" },
  { id: "hittites", startTech: "smithery", startUnit: "swordsman", startStars: 5, capitalLevel: 1, mod: { metal: 2, animal: 0.1, fruit: 0.1, fish: 0.1 }, color: "#4a4e69" },
  { id: "sumerians", startTech: "farming", startUnit: "warrior", startStars: 5, capitalLevel: 1, mod: { mountain: 0.5, forest: 0.5, fruit: 0.5 }, color: "#f97316" },
  { id: "tibetans", startTech: "philosophy", startUnit: "mindBender", startStars: 5, capitalLevel: 1, mod: { mountain: 1.5, crop: 0.1 }, color: "#14b8a6" },
  { id: "spartans", startTech: "strategy", startUnit: "defender", startStars: 7, capitalLevel: 1, mod: { fruit: 2, crop: 0.1 }, color: "#0d9488" },
  { id: "persians", startTech: "roads", startUnit: "warrior", startStars: 7, capitalLevel: 1, mod: { mountain: 0.5, forest: 0.5, fruit: 1.5 }, color: "#b91c1c" },

  // ---- 4 Special Tribes ----
  {
    id: "aquarion",
    special: true,
    startTech: null,
    startUnit: "mermaid",
    startStars: 5,
    capitalLevel: 1,
    mod: { forest: 0.5, fish: 1.5 },
    superUnit: "crab",
    unitReplacements: { warrior: "mermaid", rider: "amphibian", catapult: "puffer", knight: "tridention" },
    extraUnits: ["shark", "jelly"],
    techOverrides: {
      riding: { name: "Riding", unlocks: "Amphibian (amphibious)" },
      roads: { name: "Waterways", unlocks: "Flooding land, Bubbles" },
      ramming: { name: "Aquaculture", unlocks: "Aqua Farm, Atoll" },
      sailing: { name: "Marine Life", unlocks: "Shark" },
      freeSpirit: { name: "Free Diving", unlocks: "Temple, ocean movement, Disband" },
      chivalry: { name: "Spearing", unlocks: "Tridention, Destroy" },
      mathematics: { name: "Mathematics", unlocks: "Puffer, Sawmill" },
      navigation: { name: "Navigation", unlocks: "Jelly, Starfish" },
    },
    color: "#ff6b6b",
  },
  {
    id: "elyrion",
    special: true,
    startTech: "hunting",
    startUnit: "warrior",
    startStars: 5,
    capitalLevel: 1,
    mod: { crop: 1.5, mountain: 0.5 },
    superUnit: "dragonEgg",
    buildReplacements: {
      hunt: "enchantAnimal",
      sawmill: "sanctuary",
      clearForest: null,
      burnForest: null,
    },
    techOverrides: {
      hunting: { name: "Forest Magic", unlocks: "Enchant Animal -> Polytaur (3★)" },
      forestry: { name: "Forestry", unlocks: "Lumber Hut, Sanctuary (+★ per animal)" },
    },
    color: "#e84393",
  },
  {
    id: "polaris",
    special: true,
    startTech: "fishing",
    startUnit: "mooni",
    startStars: 5,
    capitalLevel: 1,
    mod: { forest: 0.8, fish: 1.2 },
    superUnit: "gaami",
    unitReplacements: {
      archer: "iceArcher",
      catapult: "iceFortress",
    },
    extraUnits: ["mooni", "battleSled"],
    buildReplacements: {
      port: "outpost",
      market: "iceBank",
    },
    techOverrides: {
      fishing: { name: "Frostwork", unlocks: "Mooni, Outpost, shallow water" },
      ramming: { name: "Ice Fishing", unlocks: "Fishing" },
      sailing: { name: "Sledding", unlocks: "Battle Sled (skates on Ice)" },
      aquatism: { name: "Polarism", unlocks: "Ice Temple, Glide" },
      navigation: { name: "Polar Warfare", unlocks: "Ice Fortress, Starfish" },
      archery: { name: "Archery", unlocks: "Ice Archer (freezes enemies)" },
      trade: { name: "Trade", unlocks: "Ice Bank (+2★ per 20 frozen tiles)" },
    },
    color: "#38bdf8",
  },
  {
    id: "cymanti",
    special: true,
    startTech: "farming",
    startUnit: "shaman",
    startStars: 5,
    capitalLevel: 1,
    mod: { mountain: 1.2, crop: 1.5 },
    superUnit: "centipede",
    unitReplacements: {
      rider: "hexapod",
      defender: "kiton",
      archer: "phychi",
      swordsman: "mantis",
      knight: "doomux",
      catapult: "exida",
      mindBender: "shaman",
      cloak: "moth",
    },
    extraUnits: ["raychi", "boomchi", "livingIsland"],
    buildReplacements: {
      farm: "fungi",
      windmill: "mycelium",
      market: "clathrus",
    },
    techOverrides: {
      farming: { name: "Farming", unlocks: "Fungi (+3 pop, poisons enemies)" },
      riding: { name: "Riding", unlocks: "Hexapod (creep, sneak, escape)" },
      roads: { name: "Network", unlocks: "Mycelium (links & heals bugs)" },
      strategy: { name: "Strategy", unlocks: "Kiton (poisons attackers)" },
      diplomacy: { name: "Synergy", unlocks: "Moth, Embassy, Capital Vision" },
      archery: { name: "Archery", unlocks: "Phychi (flying, poison)" },
      smithery: { name: "Smithery", unlocks: "Mantis, Forge" },
      meditation: { name: "Rituals", unlocks: "Shaman (Swarm, Parasite)" },
      philosophy: { name: "Mysticism", unlocks: "Mountain Temple, Deep Insight" },
      chivalry: { name: "Shock Tactics", unlocks: "Doomux (explodes)" },
      mathematics: { name: "Mathematics", unlocks: "Exida (splash poison)" },
      fishing: { name: "Hydrology", unlocks: "Algae, Fishing, water movement" },
      ramming: { name: "Inflation", unlocks: "Boomchi (amphibious, explodes)" },
      sailing: { name: "Pescetism", unlocks: "Raychi, ocean movement" },
      navigation: { name: "Oceanology", unlocks: "Living Island, Starfish" },
      construction: { name: "Recycling", unlocks: "Decompose, Microbes" },
      trade: { name: "Trade", unlocks: "Clathrus (+★ per Algae/Fungi)" },
    },
    color: "#84cc16",
  },
];

export const CLAN_BY_ID: Record<string, ClanDef> = Object.fromEntries(CLANS.map((c) => [c.id, c]));

/** Effective trainable unit list for a tribe (respects special tribe replacements & extras). */
export function trainableUnitsFor(clanId: string): UnitDef[] {
  const clan = CLAN_BY_ID[clanId];
  const rep = clan?.unitReplacements ?? {};
  const extras = new Set(clan?.extraUnits ?? []);
  const out: UnitDef[] = [];
  for (const def of Object.values(UNITS)) {
    if (!def.trainable) continue;
    if (TRIBE_ONLY_UNITS.has(def.id)) {
      if (extras.has(def.id) || Object.values(rep).includes(def.id)) out.push(def);
      continue;
    }
    if (def.id in rep) {
      // replaced by a special unit or disabled
      continue;
    }
    out.push(def);
  }
  return out;
}

/** Whether a build id is allowed for this tribe. */
export function buildAllowedFor(clanId: string, buildId: string): boolean {
  const clan = CLAN_BY_ID[clanId];
  const rep = clan?.buildReplacements ?? {};
  const extras = new Set(clan?.extraBuilds ?? []);
  if (TRIBE_ONLY_BUILDS.has(buildId)) {
    return extras.has(buildId) || Object.values(rep).includes(buildId);
  }
  if (buildId in rep) return false;
  return true;
}

/** Super unit id for a tribe (default: "giant"). */
export function superUnitFor(clanId: string): string {
  return CLAN_BY_ID[clanId]?.superUnit ?? "giant";
}
