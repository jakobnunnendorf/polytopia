/**
 * Core engine types. Everything here is plain JSON-serialisable data so a game
 * state can be cloned, stored, diffed, sent to Python, or replayed.
 *
 * Ids are plain descriptive words ("warrior", "climbing"); the Shardlands
 * display names live in names.ts and never influence the rules.
 */

export type Terrain = "field" | "forest" | "mountain" | "water" | "ocean";

export type ResourceId = "fruit" | "crop" | "animal" | "fish" | "metal" | "starfish";

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
  | { type: "promote"; unitId: number }
  | { type: "healOthers"; unitId: number }
  | { type: "harvestStarfish"; unitId: number }
  | { type: "infiltrate"; unitId: number; cityId: number }
  | { type: "train"; cityId: number; unit: string }
  | { type: "build"; at: Coord; building: string }
  | { type: "reward"; cityId: number; reward: string };
