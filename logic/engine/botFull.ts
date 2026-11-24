/** botFull.ts on the Rust engine (see logic/engine/rust.ts) */
import { call } from "./rust";
import type { Action, Coord, GameState } from "./types";
import { DEFAULT_WEIGHTS, type GreedyWeights } from "./bot";

export type FullActionType = Exclude<Action["type"], "endTurn">;

export type FullWeights = {
  /** the greedy bot's feature weights (bot.ts) */
  greedy: GreedyWeights;
  /** multiplier on a positive score, per action type */
  type: Record<FullActionType, number>;
  /** score of an action the heuristic rejects: open * id weight - 1 (chosen only when above 0) */
  open: Record<FullActionType, number>;
  /** per tech id (research) */
  tech: Record<string, number>;
  /** per unit type (train, upgrade to) */
  unit: Record<string, number>;
  /** per build or ability id (build) */
  build: Record<string, number>;
  /** per city reward (reward) */
  reward: Record<string, number>;
  /** move score per tile of distance to the map centre removed */
  centre: number;
};

export type PartialFullWeights = { [K in keyof FullWeights]?: FullWeights[K] extends number ? number : Partial<FullWeights[K]> };

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
