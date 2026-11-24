/**
 * Tribe relations (rules doc, Diplomacy): peace treaties, pending peace
 * offers, war (an attack either way this turn or the last), the cease-fire and
 * Hostile status after a broken treaty, and the victims' permanent grudge.
 *
 * Everything lives in the optional GameState.diplomacy, so states saved before
 * it existed load as "nobody at peace, no offers, no recent attacks". This file
 * imports only types so movement, state and actions can all use it.
 */
import type { Diplomacy, GameState } from "./types";

export type Relation = "self" | "peace" | "war" | "hostile" | "neutral";

const EMPTY: Diplomacy = { peace: [], offers: [], attacks: [], ceasefires: [], broken: [] };

/** read-only view (never mutates the state, so legalActions stays pure) */
export function dip(s: GameState): Diplomacy {
  return s.diplomacy ?? EMPTY;
}

/** writable view; call only on a cloned state (applyAction) */
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

/** position of the current player-turn in play order (grows by players.length per turn) */
export function ordinal(s: GameState): number {
  return s.turn * s.players.length + s.current;
}

export function atPeace(s: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  return dip(s).peace.some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
}

/** at war: either attacked the other within the last turn (this turn number or the previous one) */
export function atWar(s: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  return dip(s).attacks.some(
    (x) => ((x.by === a && x.on === b) || (x.by === b && x.on === a)) && s.turn - x.turn <= 1,
  );
}

/** cease-fire after a broken treaty: no attacks either way until the breaker's next turn */
export function inCeasefire(s: GameState, a: number, b: number): boolean {
  const now = ordinal(s);
  return dip(s).ceasefires.some(
    (c) => ((c.breaker === a && c.victim === b) || (c.breaker === b && c.victim === a)) && now < c.until,
  );
}

export function relation(s: GameState, a: number, b: number): Relation {
  if (a === b) return "self";
  if (atPeace(s, a, b)) return "peace";
  if (inCeasefire(s, a, b)) return "hostile";
  if (atWar(s, a, b)) return "war";
  return "neutral";
}

/** may a's units attack, convert, capture from or infiltrate b's? (not partners, not in a cease-fire) */
export function canHarm(s: GameState, a: number, b: number): boolean {
  return a !== b && !atPeace(s, a, b) && !inCeasefire(s, a, b);
}

/** b's units, territory and buildings count as friendly for a (own or peace partner) */
export function friendly(s: GameState, a: number, b: number | null): boolean {
  return b !== null && (a === b || atPeace(s, a, b));
}

export function hasOffer(s: GameState, from: number, to: number): boolean {
  return dip(s).offers.some((o) => o.from === from && o.to === to);
}

/** the victim never forgives a broken treaty (bots' permanent Foolish opinion) */
export function brokeTreatyWith(s: GameState, breaker: number, victim: number): boolean {
  return dip(s).broken.some((b) => b[0] === victim && b[1] === breaker);
}

/** turn number of the last attack by `by` on `on`, or null */
export function lastAttackTurn(s: GameState, by: number, on: number): number | null {
  const x = dip(s).attacks.find((a) => a.by === by && a.on === on);
  return x ? x.turn : null;
}

/** record an attack (also a conversion): starts war and ends any pending offers between them */
export function recordAttack(s: GameState, by: number, on: number) {
  if (by === on) return;
  const d = dipMut(s);
  const x = d.attacks.find((a) => a.by === by && a.on === on);
  if (x) x.turn = s.turn;
  else d.attacks.push({ by, on, turn: s.turn });
}

export function makePeace(s: GameState, a: number, b: number) {
  const d = dipMut(s);
  d.offers = d.offers.filter((o) => !((o.from === a && o.to === b) || (o.from === b && o.to === a)));
  if (!atPeace(s, a, b)) d.peace.push(a < b ? [a, b] : [b, a]);
}
