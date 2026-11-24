/** bot.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { Action, Coord, GameState, Unit } from "../types";
import { reachable } from "./movement";
import { capitalOf } from "./state";

export type { GreedyWeights } from "../bot";
import type { GreedyWeights } from "../bot";

export const DEFAULT_WEIGHTS: GreedyWeights = call("DEFAULT_WEIGHTS");

/** the default weights travel as null (Rust has its own copy) */
const w8 = (w: GreedyWeights) => (w === DEFAULT_WEIGHTS ? null : w);

export const noise = (s: GameState, k: number): number => call("noise", s, k);
export const goal = (s: GameState, u: Unit): Coord | null => call("goal", s, u);
export const scoreAction = (s: GameState, a: Action, w: GreedyWeights = DEFAULT_WEIGHTS): number =>
  call("scoreAction", s, a, w8(w));
export const botStep = (s: GameState, w: GreedyWeights = DEFAULT_WEIGHTS): Action => call("botStep", s, w8(w));

/** play the current player's whole turn with the bot policy (returns a new state) */
export function playBotTurn(s: GameState, maxActions = 300, w: GreedyWeights = DEFAULT_WEIGHTS): GameState {
  if (s.over) return s;
  return call("playBotTurn", s, maxActions, w8(w));
}

export { capitalOf, reachable };
