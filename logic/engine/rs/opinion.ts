/** opinion.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { GameState } from "../types";

export type { OpinionFactor, OpinionLevel } from "../opinion";
import type { OpinionFactor, OpinionLevel } from "../opinion";

export const POSITIVE_FACTORS: OpinionFactor[] = call("POSITIVE_FACTORS");
export const PEACEFUL_TURNS: number = call("PEACEFUL_TURNS");

export const opinionFactors = (s: GameState, bot: number, other: number): OpinionFactor[] =>
  call("opinionFactors", s, bot, other);
export const opinionScore = (s: GameState, bot: number, other: number): number => call("opinionScore", s, bot, other);
export const opinionLevel = (score: number): OpinionLevel => call("opinionLevel", score);
export const opinionOf = (s: GameState, bot: number, other: number): OpinionLevel => call("opinionOf", s, bot, other);
