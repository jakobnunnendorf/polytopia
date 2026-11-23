/**
 * Rules data, matching The Battle of Polytopia (current version, standard
 * tribes) as documented in docs/shardlands/RULES.md. Ids are plain words;
 * display names are in names.ts.
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
  /** stars to train (land) or to upgrade a raft to it (naval); null = cannot be trained */
  cost: number | null;
  /** max HP; null for naval units, whose HP is that of the unit they carry */
  hp: number | null;
  attack: number;
  defence: number;
  movement: number;
  range: number;
  skills: Skill[];
  /** tech that unlocks it; null = available from the start */
  tech: string | null;
  naval: boolean;
};

export const UNITS: Record<string, UnitDef> = {
  warrior: { id: "warrior", cost: 2, hp: 10, attack: 2, defence: 2, movement: 1, range: 1, skills: ["dash", "fortify"], tech: null, naval: false },
  rider: { id: "rider", cost: 3, hp: 10, attack: 2, defence: 1, movement: 2, range: 1, skills: ["dash", "escape", "fortify"], tech: "riding", naval: false },
  archer: { id: "archer", cost: 3, hp: 10, attack: 2, defence: 1, movement: 1, range: 2, skills: ["dash", "fortify"], tech: "archery", naval: false },
  defender: { id: "defender", cost: 3, hp: 15, attack: 1, defence: 3, movement: 1, range: 1, skills: ["fortify"], tech: "strategy", naval: false },
  swordsman: { id: "swordsman", cost: 5, hp: 15, attack: 3, defence: 3, movement: 1, range: 1, skills: ["dash"], tech: "smithery", naval: false },
  catapult: { id: "catapult", cost: 8, hp: 10, attack: 4, defence: 0, movement: 1, range: 3, skills: ["stiff"], tech: "mathematics", naval: false },
  knight: { id: "knight", cost: 8, hp: 10, attack: 3.5, defence: 1, movement: 3, range: 1, skills: ["dash", "persist", "fortify"], tech: "chivalry", naval: false },
  mindBender: { id: "mindBender", cost: 5, hp: 10, attack: 0, defence: 1, movement: 1, range: 1, skills: ["heal", "convert", "stiff"], tech: "philosophy", naval: false },
  cloak: { id: "cloak", cost: 8, hp: 5, attack: 2, defence: 0.5, movement: 2, range: 1, skills: ["hide", "infiltrate", "dash", "scout", "creep", "stiff", "static"], tech: "diplomacy", naval: false },
  // not trainable
  giant: { id: "giant", cost: null, hp: 40, attack: 5, defence: 4, movement: 1, range: 1, skills: ["static"], tech: null, naval: false },
  dagger: { id: "dagger", cost: null, hp: 10, attack: 2, defence: 2, movement: 1, range: 1, skills: ["dash", "surprise", "independent", "static"], tech: null, naval: false },
  // naval: a land unit entering a port becomes a raft; rafts can be upgraded
  raft: { id: "raft", cost: null, hp: null, attack: 0, defence: 1, movement: 2, range: 0, skills: ["water", "carry", "stiff", "static"], tech: "fishing", naval: true },
  scout: { id: "scout", cost: 5, hp: null, attack: 2, defence: 1, movement: 3, range: 2, skills: ["water", "dash", "carry", "scout", "static"], tech: "sailing", naval: true },
  rammer: { id: "rammer", cost: 5, hp: null, attack: 3, defence: 3, movement: 3, range: 1, skills: ["water", "dash", "carry", "static"], tech: "ramming", naval: true },
  bomber: { id: "bomber", cost: 15, hp: null, attack: 3, defence: 2, movement: 2, range: 3, skills: ["water", "carry", "splash", "stiff", "static"], tech: "navigation", naval: true },
  // naval forms of special land units (giant, cloak, dagger)
  juggernaut: { id: "juggernaut", cost: null, hp: 40, attack: 4, defence: 4, movement: 2, range: 1, skills: ["water", "carry", "stiff", "stomp", "static"], tech: null, naval: true },
  dinghy: { id: "dinghy", cost: null, hp: 5, attack: 2, defence: 0.5, movement: 2, range: 1, skills: ["water", "carry", "hide", "infiltrate", "dash", "scout", "static", "stiff"], tech: null, naval: true },
  pirate: { id: "pirate", cost: null, hp: 10, attack: 2, defence: 2, movement: 2, range: 1, skills: ["water", "carry", "dash", "surprise", "independent", "static"], tech: null, naval: true },
};

/** naval form a land unit takes when it enters a port */
export const EMBARK_AS: Record<string, string> = {
  giant: "juggernaut",
  cloak: "dinghy",
  dagger: "pirate",
};

/** raft upgrades: target unit -> tech (cost from UNITS[target].cost) */
export const RAFT_UPGRADES = ["scout", "rammer", "bomber"] as const;

export type TechDef = {
  id: string;
  tier: 1 | 2 | 3;
  parent: string | null;
  /** short description of what it unlocks (shown in the tech screen) */
  unlocks: string;
};

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
  { id: "diplomacy", tier: 3, parent: "strategy", unlocks: "Shade, Envoy Lodge" },

  { id: "climbing", tier: 1, parent: null, unlocks: "crag moves, crag defence, see ore" },
  { id: "mining", tier: 2, parent: "climbing", unlocks: "Delve" },
  { id: "smithery", tier: 3, parent: "mining", unlocks: "Blademaster, Smeltery" },
  { id: "meditation", tier: 2, parent: "climbing", unlocks: "Peak Shrine" },
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

/** research cost: tier × cities + 4; Literacy (philosophy) makes it ceil(2/3 of that) */
export function techCostFor(tier: number, cities: number, literacy: boolean): number {
  const base = tier * cities + 4;
  return literacy ? Math.ceil((base * 2) / 3 - 1e-9) : base;
}
