/**
 * Core engine types. Everything here is plain JSON-serialisable data so a game
 * state can be cloned, stored, diffed, sent to Python, or replayed.
 *
 * Ids are plain descriptive words ("warrior", "climbing"); the Shardlands
 * display names live in names.ts and never influence the rules.
 */

export type Terrain = "field" | "forest" | "mountain" | "water" | "ocean";

export type ResourceId =
  | "fruit"
  | "crop"
  | "animal"
  | "fish"
  | "metal"
  | "starfish";

export type Coord = { x: number; y: number };

export type Tile = {
  terrain: Terrain;
  resource: ResourceId | null;
  /** improvement / building id from data.IMPROVEMENTS */
  building: string | null;
  /** level of a leveling building (temples, forge, windmill, ...) */
  buildingLevel: number;
  road: boolean;
  /** city or village standing on this tile */
  cityId: number | null;
  /** neutral, uncaptured village */
  village: boolean;
  ruin: boolean;
  /** id of the city whose territory this tile belongs to */
  territory: number | null;
  /** player who built the building (temples score for their owner) */
  buildingOwner: number | null;
};

export type Unit = {
  id: number;
  type: string;
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
  /** has spent its turn on a non-move/attack action, or was just trained */
  done: boolean;
  /** has moved this turn (needed for capture / recover rules) */
  moved: boolean;
  /** has attacked this turn */
  attacked: boolean;
  /** land unit type carried by a boat; null for land units */
  carried: string | null;
  /** remaining explorer steps etc. (unused by most units) */
  extra?: Record<string, number>;
};

export type City = {
  id: number;
  name: string;
  owner: number;
  x: number;
  y: number;
  level: number;
  /** population toward the next level (can be negative after losses) */
  pop: number;
  capital: boolean;
  walls: boolean;
  workshop: boolean;
  parks: number;
  borderGrown: boolean;
  connected: boolean;
  /** level-up rewards waiting for a choice */
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
  /** score accumulated by one-off events (e.g. parks, monuments) */
  bonusScore: number;
};

export type GameMode = "perfection" | "domination";

export type GameState = {
  seed: number;
  rng: number;
  mapSize: number;
  mode: GameMode;
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
  | { type: "unitAbility"; unitId: number; ability: string; target?: Coord }
  | { type: "train"; cityId: number; unit: string }
  | { type: "build"; at: Coord; building: string }
  | { type: "reward"; cityId: number; reward: string };
