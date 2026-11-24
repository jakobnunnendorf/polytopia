/** bot.ts on the Rust engine (see logic/engine/rust.ts) */
import { call, engineConstant } from "./rust";
import type { Action, Coord, GameState, Unit } from "./types";
import { reachable } from "./movement";
import { capitalOf } from "./state";

export type GreedyWeights = {
  capture: number;
  examine: number;
  promote: number;
  harvestStarfish: number;
  monument: number;
  /** score of a killing blow, plus the victim's cost */
  kill: number;
  /** base score of a non-lethal hit, plus damage minus retaliation */
  hit: number;
  /** attack with a 0-attack unit (convert, etc.) */
  special: number;
  /** pop-giving build: base + perPop * pop - cost */
  growBase: number;
  growPerPop: number;
  /** other buildings when stars > richAt */
  otherBuild: number;
  richAt: number;
  /** research: base - cost - tier, only if 2 stars remain afterwards */
  research: number;
  /** train: base + strength - cost/2, while units <= cities * unitsPerCity */
  train: number;
  unitsPerCity: number;
  /** move: base + distance gained toward the unit's goal */
  move: number;
  recover: number;
  healOthers: number;
  upgrade: number;
  /** random tie-break spread */
  noise: number;
  rewards: Record<string, number>;
};

export const DEFAULT_WEIGHTS: GreedyWeights = engineConstant("DEFAULT_WEIGHTS");

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
