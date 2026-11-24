/** opinion.ts on the Rust engine (see logic/engine/rust.ts) */
import { call } from "./rust";
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

export const POSITIVE_FACTORS: OpinionFactor[] = call("POSITIVE_FACTORS");
export const PEACEFUL_TURNS: number = call("PEACEFUL_TURNS");

export const opinionFactors = (s: GameState, bot: number, other: number): OpinionFactor[] =>
  call("opinionFactors", s, bot, other);
export const opinionScore = (s: GameState, bot: number, other: number): number => call("opinionScore", s, bot, other);
export const opinionLevel = (score: number): OpinionLevel => call("opinionLevel", score);
export const opinionOf = (s: GameState, bot: number, other: number): OpinionLevel => call("opinionOf", s, bot, other);
