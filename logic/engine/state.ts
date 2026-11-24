/** state.ts on the Rust engine (see logic/engine/rust.ts) */
import { call } from "./rust";
import { createRng, type Rng } from "./rng";
import type { City, Coord, Difficulty, GameMode, GameState, Unit } from "./types";
import { cityAtIndex, mutate, unitAtIndex } from "./sync";
import type { MapType } from "./mapgen";

export type NewGameOptions = {
  /** default: the size the mode forces (see mapSizeFor), Normal otherwise */
  mapSize?: number;
  players: number;
  mode: GameMode;
  /** bot difficulty, default "normal" */
  difficulty?: Difficulty;
  seed: number;
  /** player ids controlled by humans (others are bots) */
  humans?: number[];
  mapType?: MapType;
  /** clan per player; default: random distinct clans */
  clans?: string[];
  /**
   * Perfection turn limit (default 30, turns 0..29). The Weekly Challenge is
   * Perfection with turnLimit 20 and a fixed seed.
   */
  turnLimit?: number;
};

export const mapSizeFor = (mode: GameMode, opponents: number): number | null => call("mapSizeFor", mode, opponents);
export const mapSizeAllowed = (mode: GameMode, mapSize: number): boolean => call("mapSizeAllowed", mode, mapSize);
export const difficultyOf = (s: GameState): Difficulty => call("difficultyOf", s);

/** runs a TypeScript callback, so it stays TypeScript: the rng lives in s.rng */
export function withRng<T>(s: GameState, f: (rng: Rng) => T): T {
  const rng = createRng(s.rng);
  const out = f(rng);
  s.rng = rng.state();
  return out;
}

export const log = (s: GameState, msg: string): void => mutate("log", s, msg);

export const cityById = (s: GameState, id: number | null): City | undefined => cityAtIndex(s, call("cityById", s, id));
export const citiesOf = (s: GameState, p: number): City[] =>
  call<{ cityIndices: number[] }>("citiesOf", s, p).cityIndices.map((i) => s.cities[i]);
export const capitalOf = (s: GameState, p: number): City | undefined => cityAtIndex(s, call("capitalOf", s, p));

export const explore = (s: GameState, p: number, c: Coord, r: number): void => mutate("explore", s, p, c, r);
export const claimTerritory = (s: GameState, city: City, r: number): void => mutate("claimTerritory", s, city, r);
export const addPop = (s: GameState, city: City, n: number): void => mutate("addPop", s, city, n);

export const unitsHomedIn = (s: GameState, city: City): number => call("unitsHomedIn", s, city);
export const unitCapacity = (city: City): number => call("unitCapacity", city);
export const cityIncome = (s: GameState, c: City): number => call("cityIncome", s, c);
export const underSiege = (s: GameState, c: City): boolean => call("underSiege", s, c);
export const iceBankLevel = (s: GameState): number => call("iceBankLevel", s);
export const resourceVisible = (s: GameState, p: number, r: string): boolean => call("resourceVisible", s, p, r);
export const income = (s: GameState, p: number): number => call("income", s, p);
export const techCost = (s: GameState, p: number, tech: string): number => call("techCost", s, p, tech);
export const canResearch = (s: GameState, p: number, tech: string): boolean => call("canResearch", s, p, tech);
export const scoreOf = (s: GameState, p: number): number => call("scoreOf", s, p);
export const cityScore = (c: City): number => call("cityScore", c);
export const perfectionRating = (s: GameState, p: number): number => call("perfectionRating", s, p);
export const dominationRating = (s: GameState, p: number): number => call("dominationRating", s, p);
export const dominationStars = (rating: number): number => call("dominationStars", rating);
export const perfectionStars = (rating: number): number => call("perfectionStars", rating);

export const updateConnections = (s: GameState, p: number): void => mutate("updateConnections", s, p);
export const checkTasks = (s: GameState, p: number): void => mutate("checkTasks", s, p);
export const checkMeetings = (s: GameState): void => mutate("checkMeetings", s);
export const meet = (s: GameState, p: number, other: number): void => mutate("meet", s, p, other);

export function makeUnit(s: GameState, type: string, owner: number, at: Coord, homeCity: number | null): Unit {
  return unitAtIndex(s, mutate("makeUnit", s, type, owner, at, homeCity ?? null))!;
}

export function pushUnit(s: GameState, u: Unit, spawner: number = u.owner): void {
  mutate("pushUnit", s, u, spawner);
}
export const checkElimination = (s: GameState): void => mutate("checkElimination", s);
export const leader = (s: GameState): number | null => call("leader", s);
export const checkGameEnd = (s: GameState, turnEnded: boolean): void => mutate("checkGameEnd", s, turnEnded);

export function newCity(s: GameState, at: Coord, owner: number): City {
  return cityAtIndex(s, mutate("newCity", s, at, owner))!;
}

export const createGame = (opts: NewGameOptions): GameState => call("createGame", opts);
export const startTurn = (s: GameState): void => mutate("startTurn", s);
export const growUnits = (s: GameState, p: number): void => mutate("growUnits", s, p);

export function pendingReward(s: GameState): { city: City; options: [string, string] } | null {
  const r = call<{ cityIndex: number; options: [string, string] } | null>("pendingReward", s);
  return r ? { city: s.cities[r.cityIndex], options: r.options } : null;
}
