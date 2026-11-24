/** observe.ts on the Rust engine (see logic/engine/rust.ts) */
import { UNITS } from "./data";
import { call, engineConstant } from "./rust";
import type { GameState } from "./types";

export type Observation = {
  player: number;
  mapSize: number;
  channels: string[];
  /** CHANNELS.length × mapSize × mapSize values */
  planes: number[];
  scalars: {
    turn: number;
    maxTurns: number;
    stars: number;
    income: number;
    score: number;
    cities: number;
    techs: number[];
    techCosts: number[];
    opponentsAlive: number;
    /** per player id: 1 peace, 0 neutral or self, -1 war, -2 hostile (cease-fire after a broken treaty) */
    relations: number[];
    /** per player id: 1 if that player's peace offer to p awaits an answer */
    peaceOffers: number[];
  };
};

/** pure data (the unit table stays in data.ts) */
export const UNIT_TYPES = Object.keys(UNITS);
export const CHANNELS: string[] = engineConstant("CHANNELS");

export function observe(s: GameState, p: number): Observation {
  const o = call<Observation>("observe", s, p);
  o.channels = CHANNELS;
  return o;
}
