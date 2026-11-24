/**
 * Core engine types. Everything here is plain JSON-serialisable data so a game
 * state can be cloned, stored, diffed, sent to Python, or replayed.
 *
 * Ids are plain descriptive words ("warrior", "climbing"); the Polytopia
 * display names live in names.ts and never influence the rules.
 */

export type Terrain = "field" | "forest" | "mountain" | "water" | "ocean";

export type ResourceId =
  | "fruit"
  | "crop"
  | "animal"
  | "fish"
  | "metal"
  | "starfish"
  /** Aquarion: crop on water, seen only by Aquarion (Aqua Farm) */
  | "aquaCrop"
  /** Cymanti: replaces crops in Cymanti areas */
  | "spores";

export type Coord = { x: number; y: number };

export type Tile = {
  terrain: Terrain;
  resource: ResourceId | null;
  /** building id from data.BUILDS (farm, port, temple, monument ids, ...) */
  building: string | null;
  /** level of a leveling building (windmill, sawmill, forge) */
  buildingLevel: number;
  /** turn the building was built (temples level up from it) */
  builtTurn: number;
  road: boolean;
  /** city standing on this tile */
  cityId: number | null;
  /** neutral, uncaptured village */
  village: boolean;
  ruin: boolean;
  lighthouse: boolean;
  /** id of the city whose territory this tile belongs to */
  territory: number | null;
  /** Polaris: frozen water tile (ice) */
  ice?: boolean;
  /** Polaris: land turned into Polaris terrain by Freeze Area */
  polar?: boolean;
  /** Cymanti: walkable algae on water */
  algae?: boolean;
  /** Aquarion: flooded land tile (land and water units move on it; ships stop on it) */
  flooded?: boolean;
  /** Aquarion Lost City: this village becomes a level-3 walled city when captured */
  lostCity?: boolean;
  /** Cymanti Decompose: the building is refunded and removed at the end of its owner's turn */
  decomposing?: boolean;
};

export type Unit = {
  id: number;
  /** unit type; for boats the boat type */
  type: string;
  /** passenger type when this is a boat, else null */
  carried: string | null;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  kills: number;
  veteran: boolean;
  /** city that supports this unit (counts toward its unit cap) */
  homeCity: number | null;
  canMove: boolean;
  canAttack: boolean;
  /** has moved this turn */
  moved: boolean;
  /** has attacked this turn */
  attacked: boolean;
  /** turn over for this unit (trained, captured, recovered, embarked, ...) */
  done: boolean;
  /** did nothing at all this turn (for the automatic end-of-turn heal) */
  idle: boolean;
  /** hide skill: invisible to enemies that are not adjacent */
  hidden: boolean;
  /** direction of the last move/attack, for forced pushes */
  lastDir: Coord | null;
  /** Polaris: frozen until owner's next turn ends */
  frozen?: boolean;
  /** Cymanti: poisoned (loses defence bonuses) */
  poisoned?: boolean;
  /** Cymanti: Swarm from a Shaman (+1 movement until attacked) */
  swarmed?: boolean;
  /** Aquarion Bubbles: +1 movement after entering a flooded tile; lost when attacked or on dry land */
  bubble?: boolean;
  /** Double Attack: the second attack of this turn is used */
  secondAttack?: boolean;
  /** Centipede segment: id of the Centipede head it belongs to */
  bodyOf?: number;
  /** Elyrion: turns lived (for Dragon Egg -> Baby Dragon -> Fire Dragon) */
  age?: number;
  /** was hidden when its owner's turn began (a Cloak that hides this turn can't infiltrate) */
  startedHidden?: boolean;
};

export type City = {
  id: number;
  name: string;
  owner: number;
  x: number;
  y: number;
  level: number;
  /** population toward the next level; can be negative */
  pop: number;
  capital: boolean;
  /** player whose starting capital this was (embassies, capital vision) */
  originalCapitalOf: number | null;
  walls: boolean;
  workshop: boolean;
  parks: number;
  connected: boolean;
  /** infiltrated: produces nothing on its owner's next turn */
  riot: boolean;
  /** level-up rewards waiting for a choice (the new levels) */
  pendingRewards: number[];
};

export type Player = {
  id: number;
  clan: string;
  stars: number;
  techs: string[];
  /** explored tiles, row-major, 1 = seen */
  explored: number[];
  alive: boolean;
  bot: boolean;
  kills: number;
  losses: number;
  /** other players this player has met */
  met: number[];
  /** completed tasks (pacifist, genius, ...) */
  tasks: string[];
  /** monuments built (ids) */
  monuments: string[];
  /** consecutive own turns without attacking (counted while Meditation is owned) */
  pacifistTurns: number;
  attackedThisTurn: boolean;
  /** lighthouses discovered, as tile indices */
  lighthouses: number[];
  /** hosts this player built an embassy with */
  embassies: number[];
  /** the city this player started with */
  capitalId: number;
  /** Cymanti: enemy units converted by Shamans (the convert task, which replaces the pacifist task) */
  conversions?: number;
  /** "unique" buildings this player has ever built (Polaris Ice Bank): never again */
  builtUnique?: string[];
};

export type GameMode = "perfection" | "domination" | "creative" | "glory" | "might";

/** bot difficulty (rules doc, AI and difficulty): bot capital income and the Perfection bonus */
export type Difficulty = "easy" | "normal" | "hard" | "crazy";

/** tribe relations (rules doc, Diplomacy); see diplomacy.ts */
export type Diplomacy = {
  /** pairs at peace, [low id, high id] */
  peace: [number, number][];
  /** pending peace offers; the receiver answers on its next turn */
  offers: { from: number; to: number }[];
  /** last turn number in which `by` attacked `on` (war = an attack either way this turn or the last) */
  attacks: { by: number; on: number; turn: number }[];
  /** after a broken treaty: no attacks between the two while ordinal(state) < until */
  ceasefires: { breaker: number; victim: number; until: number }[];
  /** [victim, breaker]: treaties broken, remembered forever */
  broken: [number, number][];
};

export type GameState = {
  seed: number;
  rng: number;
  mapSize: number;
  mode: GameMode;
  /** bot difficulty; missing in states saved before it existed (read as "normal") */
  difficulty?: Difficulty;
  /** turn limit for perfection mode */
  maxTurns: number;
  turn: number;
  current: number;
  tiles: Tile[];
  units: Unit[];
  cities: City[];
  players: Player[];
  nextId: number;
  winner: number | null;
  over: boolean;
  log: string[];
  /** missing in states saved before diplomacy existed (read as no relations) */
  diplomacy?: Diplomacy;
};

export type Action =
  | { type: "endTurn" }
  | { type: "research"; tech: string }
  | { type: "move"; unitId: number; to: Coord }
  | { type: "attack"; unitId: number; targetId: number }
  | { type: "capture"; unitId: number }
  | { type: "recover"; unitId: number }
  | { type: "examine"; unitId: number }
  | { type: "disband"; unitId: number }
  | { type: "upgrade"; unitId: number; to: string }
  | { type: "promote"; unitId: number }
  | { type: "healOthers"; unitId: number }
  | { type: "harvestStarfish"; unitId: number }
  | { type: "infiltrate"; unitId: number; cityId: number }
  | { type: "train"; cityId: number; unit: string }
  | { type: "build"; at: Coord; building: string }
  | { type: "reward"; cityId: number; reward: string }
  | { type: "freezeArea"; unitId: number }
  | { type: "swarm"; unitId: number }
  | { type: "explode"; unitId: number }
  | { type: "breakIce"; unitId: number; at: Coord }
  /** clear a tile effect under the unit (2.18 "drain": Flooded, or Algae); free, ends the unit's turn */
  | { type: "drain"; unitId: number; effect: "flooded" | "algae" }
  /** Cymanti Recycling: mark an own building; refunded and removed at the end of the turn */
  | { type: "decompose"; at: Coord }
  | { type: "offerPeace"; player: number }
  | { type: "acceptPeace"; player: number }
  | { type: "declinePeace"; player: number }
  | { type: "breakPeace"; player: number };
