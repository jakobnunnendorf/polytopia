/** botFull.ts on the Rust engine (see logic/engine/rust.ts) */
import { call, engineConstant } from "./rust";
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
  /** city defence: + into an empty threatened city of ours, - for leaving one (0 = off) */
  defend: number;
  /** tiles within which an enemy unit makes a city threatened */
  defendRadius: number;
  /** research bonus per thing the tech would let us use right now (0 = off) */
  techUse: number;
  /** research penalty for a tech we could not use at all right now (0 = off) */
  techUseless: number;
  /** move bonus per tile closer to the nearest known enemy city or unit (0 = off) */
  front: number;
  /** share of a move's progress measured in road-aware travel cost, roads counting half (0 = off) */
  roads: number;
  /** break peace in the endgame (every rival a peace partner) at this ratio of our cities to the partner's (0 = never) */
  breakPeace: number;
  /**
   * weight of the economy plan's advantage (issue #68, engine/core/src/econ_plan.rs) on research,
   * pop builds, leveling buildings and markets (0 = off). Only the Rust bot implements it; the
   * TypeScript reference bot the parity tests compare with predates it, and they run at plan 0.
   */
  plan: number;
  /** saving: a purchase that would leave us unable to afford next turn's best purchase loses reserve times that purchase's score (0 = off) */
  reserve: number;
  /** half-width of a zero-mean random term on every move; also lets stuck units step sideways (0 = off) */
  moveNoise: number;
  /** bonus per own neighbouring unit fewer at a move's target than now: crowds thin out (0 = off) */
  spread: number;
  /**
   * score per tile of the value-iteration field's progress on land moves, added after the move
   * gate like `front` (issue #76, engine/core/src/value_field.rs; 0 = off). Only the Rust bot implements it; the TypeScript
   * reference bot predates it and the parity tests run at field 0.
   */
  field: number;
};

export type PartialFullWeights = { [K in keyof FullWeights]?: FullWeights[K] extends number ? number : Partial<FullWeights[K]> };

export const FULL_ACTION_TYPES: FullActionType[] = engineConstant("FULL_ACTION_TYPES");
export const REWARD_IDS: string[] = engineConstant("REWARD_IDS");

/** the greedy part is the bot facade's DEFAULT_WEIGHTS object itself, as in botFull.ts */
export const DEFAULT_FULL_WEIGHTS: FullWeights = engineConstant<FullWeights>("DEFAULT_FULL_WEIGHTS", (v) => ({ ...v, greedy: DEFAULT_WEIGHTS }));

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
