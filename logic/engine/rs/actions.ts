/** actions.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { TECH_BY_ID } from "../data";
import { call } from "../rust";
import type { Action, Coord, GameState } from "../types";
import { mutate } from "./sync";

export const legalActions = (s: GameState): Action[] => call("legalActions", s);
/** returns a new state; `prev` is left unchanged */
export const applyAction = (prev: GameState, a: Action): GameState => call("applyAction", prev, a);
export const runExplorer = (s: GameState, p: number, from: Coord): void => mutate("runExplorer", s, p, from);

export { TECH_BY_ID };
