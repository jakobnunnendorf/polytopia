/** opinion.ts on the Rust engine (see logic/engine/rust.ts) */
import { call, engineConstant } from "./rust";
import type { GameState } from "./types";

export type OpinionFactor =
  | "wise"
  | "charming"
  | "peaceful"
  | "diplomatic"
  | "powerful"
  | "brave"
  | "violent"
  | "threatening"
  | "weak"
  | "annoying"
  | "foolish"
  | "intrusive"
  | "dominating";

export type OpinionLevel = "horrible" | "poor" | "indifferent" | "decent" | "great";

export const POSITIVE_FACTORS: OpinionFactor[] = engineConstant("POSITIVE_FACTORS");
/** engine/core/src/opinion.rs PEACEFUL_TURNS (a number cannot be fetched lazily; __tests__/engine/rust-constants.test.ts checks it) */
export const PEACEFUL_TURNS: number = 3;

export const opinionFactors = (s: GameState, bot: number, other: number): OpinionFactor[] =>
  call("opinionFactors", s, bot, other);
export const opinionScore = (s: GameState, bot: number, other: number): number => call("opinionScore", s, bot, other);
export const opinionLevel = (score: number): OpinionLevel => call("opinionLevel", score);
export const opinionOf = (s: GameState, bot: number, other: number): OpinionLevel => call("opinionOf", s, bot, other);
