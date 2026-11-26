/**
 * opinion.ts on the Rust engine (see logic/engine/rust.ts): what bots think of other tribes, the
 * real game's opinion model (engine/core/src/opinion.rs; docs/RULES.md §10.3).
 */
import { call, engineConstant } from "./rust";
import type { GameState } from "./types";

/** the game's relation reasons (signed terms of the opinion) */
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

/** the factors that raise an opinion (the others lower it) */
export const POSITIVE_FACTORS: OpinionFactor[] = engineConstant("POSITIVE_FACTORS");
/** engine/core/src/opinion.rs PEACEFUL_TURNS (a number cannot be fetched lazily; __tests__/engine/rust-constants.test.ts checks it) */
export const PEACEFUL_TURNS: number = 4;

/** the factors the game shows (larger than 0.1 either way), the largest first */
export const opinionFactors = (s: GameState, bot: number, other: number): OpinionFactor[] =>
  call("opinionFactors", s, bot, other);
/** the shown factors with their signed values, the largest first */
export const opinionReasons = (s: GameState, bot: number, other: number): { factor: OpinionFactor; value: number }[] =>
  call("opinionReasons", s, bot, other);
/** the opinion's value: the sum of its terms (0 for a tribe the bot has not met) */
export const opinionScore = (s: GameState, bot: number, other: number): number => call("opinionScore", s, bot, other);
/** great above 2, decent above 0.5, poor below -0.5, horrible below -2, else indifferent */
export const opinionLevel = (score: number): OpinionLevel => call("opinionLevel", score);
export const opinionOf = (s: GameState, bot: number, other: number): OpinionLevel => call("opinionOf", s, bot, other);
