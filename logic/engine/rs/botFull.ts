/** botFull.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { Action, Coord, GameState } from "../types";
import { DEFAULT_WEIGHTS } from "./bot";

export type { FullActionType, FullWeights, PartialFullWeights } from "../botFull";
import type { FullActionType, FullWeights, PartialFullWeights } from "../botFull";

export const FULL_ACTION_TYPES: FullActionType[] = call("FULL_ACTION_TYPES");
export const REWARD_IDS: string[] = call("REWARD_IDS");

/** the greedy part is the bot facade's DEFAULT_WEIGHTS object itself, as in botFull.ts */
export const DEFAULT_FULL_WEIGHTS: FullWeights = { ...call<FullWeights>("DEFAULT_FULL_WEIGHTS"), greedy: DEFAULT_WEIGHTS };

/** the default weights travel as null (Rust has its own copy) */
const w8 = (w: FullWeights) => (w === DEFAULT_FULL_WEIGHTS ? null : w);

export const fullWeights = (p: PartialFullWeights = {}): FullWeights => call("fullWeights", p);
export const centreDist = (n: number, c: Coord): number => call("centreDist", n, c);
export const scoreFull = (s: GameState, a: Action, w: FullWeights = DEFAULT_FULL_WEIGHTS): number =>
  call("scoreFull", s, a, w8(w));
export const fullBotStep = (s: GameState, w: FullWeights = DEFAULT_FULL_WEIGHTS): Action => call("fullBotStep", s, w8(w));

/** play the current player's whole turn with the full bot (returns a new state) */
export function playFullBotTurn(s: GameState, maxActions = 300, w: FullWeights = DEFAULT_FULL_WEIGHTS): GameState {
  if (s.over) return s;
  return call("playFullBotTurn", s, maxActions, w8(w));
}
