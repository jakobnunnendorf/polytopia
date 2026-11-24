/** movement.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { Coord, GameState, Tile, Unit } from "../types";
import { unitAtIndex } from "./sync";

export type StepKind = "normal" | "embark" | "disembark";
export type MoveTarget = Coord & { kind: StepKind };

export const has = (u: Unit, skill: string): boolean => call("has", u, skill);
export const techOf = (s: GameState, p: number, t: string): boolean => call("techOf", s, p, t);
export const territoryOwner = (s: GameState, t: Tile): number | null => call("territoryOwner", s, t);
export const chainBody = (s: GameState, headId: number): Unit[] =>
  call<{ unitIndices: number[] }>("chainBody", s, headId).unitIndices.map((i) => s.units[i]);
/** a field test on the unit itself */
export const isLed = (u: Unit) => u.bodyOf !== undefined;
export const leaderOf = (s: GameState, u: Unit): Unit | undefined => unitAtIndex(s, call("leaderOf", s, u));
export const followerOf = (s: GameState, u: Unit): Unit | undefined => unitAtIndex(s, call("followerOf", s, u));
export const movementRange = (s: GameState, u: Unit): number => call("movementRange", s, u);
export const unitAt = (s: GameState, x: number, y: number): Unit | undefined => unitAtIndex(s, call("unitAt", s, x, y));
export const canSee = (s: GameState, player: number, u: Unit): boolean => call("canSee", s, player, u);
export const enterKind = (s: GameState, u: Unit, t: Tile): StepKind | null => call("enterKind", s, u, t);
export const reachable = (s: GameState, u: Unit): MoveTarget[] => call("reachable", s, u);
export const pathTo = (s: GameState, u: Unit, to: Coord): Coord[] => call("pathTo", s, u, to);
export const sightRadius = (s: GameState, u: Unit): number => call("sightRadius", s, u);
