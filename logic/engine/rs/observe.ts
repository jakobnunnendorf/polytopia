/** observe.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { UNITS } from "../data";
import { call } from "../rust";
import type { GameState } from "../types";

export type { Observation } from "../observe";
import type { Observation } from "../observe";

/** pure data (the unit table stays in data.ts) */
export const UNIT_TYPES = Object.keys(UNITS);
export const CHANNELS: string[] = call("CHANNELS");

export function observe(s: GameState, p: number): Observation {
  const o = call<Observation>("observe", s, p);
  o.channels = CHANNELS;
  return o;
}
