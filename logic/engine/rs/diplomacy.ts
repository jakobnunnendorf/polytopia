/** diplomacy.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { Diplomacy, GameState } from "../types";
import { mutate } from "./sync";

export type Relation = "self" | "peace" | "war" | "hostile" | "neutral";

const EMPTY: Diplomacy = { peace: [], offers: [], attacks: [], ceasefires: [], broken: [] };

// views on the state's own data (no rules), as in diplomacy.ts
export function dip(s: GameState): Diplomacy {
  return s.diplomacy ?? EMPTY;
}
export function dipMut(s: GameState): Diplomacy {
  if (!s.diplomacy) s.diplomacy = { peace: [], offers: [], attacks: [], ceasefires: [], broken: [] };
  return s.diplomacy;
}
export function cloneDiplomacy(d: Diplomacy | undefined): Diplomacy | undefined {
  if (!d) return undefined;
  return {
    peace: d.peace.map((p) => [p[0], p[1]] as [number, number]),
    offers: d.offers.map((o) => ({ ...o })),
    attacks: d.attacks.map((a) => ({ ...a })),
    ceasefires: d.ceasefires.map((c) => ({ ...c })),
    broken: d.broken.map((b) => [b[0], b[1]] as [number, number]),
  };
}

export const ordinal = (s: GameState): number => call("ordinal", s);
export const atPeace = (s: GameState, a: number, b: number): boolean => call("atPeace", s, a, b);
export const atWar = (s: GameState, a: number, b: number): boolean => call("atWar", s, a, b);
export const inCeasefire = (s: GameState, a: number, b: number): boolean => call("inCeasefire", s, a, b);
export const relation = (s: GameState, a: number, b: number): Relation => call("relation", s, a, b);
export const canHarm = (s: GameState, a: number, b: number): boolean => call("canHarm", s, a, b);
export const friendly = (s: GameState, a: number, b: number | null): boolean => call("friendly", s, a, b);
export const hasOffer = (s: GameState, from: number, to: number): boolean => call("hasOffer", s, from, to);
export const brokeTreatyWith = (s: GameState, breaker: number, victim: number): boolean =>
  call("brokeTreatyWith", s, breaker, victim);
export const lastAttackTurn = (s: GameState, by: number, on: number): number | null => call("lastAttackTurn", s, by, on);
export const recordAttack = (s: GameState, by: number, on: number): void => mutate("recordAttack", s, by, on);
export const makePeace = (s: GameState, a: number, b: number): void => mutate("makePeace", s, a, b);
