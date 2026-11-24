/**
 * Helpers for the facade: the TypeScript engine mutates its state argument in
 * place, the Rust engine returns the mutated state as JSON. `mutate` copies that
 * result back INTO the caller's object, keeping object identity (tests and the
 * UI hold references to units, cities, players and tiles across calls).
 */
import { call } from "../rust";
import type { City, GameState, Unit } from "../types";

type Obj = Record<string, unknown>;

/** replace an array's contents in place (TS pushes into these arrays) */
function refill(dst: unknown[], src: unknown[]) {
  dst.length = src.length;
  for (let i = 0; i < src.length; i++) dst[i] = src[i];
}

/** make `dst` field-equal to `src`, keeping the object and its nested arrays */
function assignInto(dst: Obj, src: Obj) {
  for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
  for (const k of Object.keys(src)) {
    const v = src[k];
    const d = dst[k];
    if (Array.isArray(v) && Array.isArray(d) && d !== v) refill(d, v);
    else dst[k] = v;
  }
}

/** sync a list of objects with ids: reuse the caller's object per id, Rust's order */
function syncById<T extends { id: number }>(dst: T[], src: T[]) {
  const byId = new Map<number, T>();
  for (const o of dst) byId.set(o.id, o);
  const out = src.map((o) => {
    const mine = byId.get(o.id);
    if (!mine) return o;
    byId.delete(o.id); // a duplicate id takes a fresh object
    assignInto(mine as unknown as Obj, o as unknown as Obj);
    return mine;
  });
  refill(dst, out);
}

/** copy the state `src` (fresh from Rust) into the caller's state `dst` */
export function syncState(dst: GameState, src: GameState) {
  const d = dst as unknown as Obj;
  const s = src as unknown as Obj;
  for (const k of Object.keys(d)) if (!(k in s)) delete d[k];
  for (const k of Object.keys(s)) {
    switch (k) {
      case "tiles": {
        const tiles = dst.tiles;
        if (!Array.isArray(tiles)) {
          dst.tiles = src.tiles;
          break;
        }
        for (let i = 0; i < src.tiles.length; i++) {
          if (tiles[i]) assignInto(tiles[i] as unknown as Obj, src.tiles[i] as unknown as Obj);
          else tiles[i] = src.tiles[i];
        }
        tiles.length = src.tiles.length;
        break;
      }
      case "units":
      case "cities":
      case "players": {
        const mine = d[k];
        if (Array.isArray(mine)) syncById(mine as { id: number }[], s[k] as { id: number }[]);
        else d[k] = s[k];
        break;
      }
      case "diplomacy":
      case "log": {
        const mine = d[k];
        const theirs = s[k];
        if (k === "log" && Array.isArray(mine) && Array.isArray(theirs)) refill(mine, theirs);
        else if (k === "diplomacy" && mine && typeof mine === "object" && theirs && typeof theirs === "object")
          assignInto(mine as Obj, theirs as Obj);
        else d[k] = theirs;
        break;
      }
      default:
        d[k] = s[k];
    }
  }
}

/** call a mutating engine function: sync the state into `s`, return Rust's `ret` */
export function mutate<R = unknown>(name: string, s: GameState, ...args: unknown[]): R {
  const out = call<{ state: GameState; ret: R }>(name, s, ...args);
  syncState(s, out.state);
  return out.ret;
}

export const unitAtIndex = (s: GameState, r: { unitIndex: number | null }): Unit | undefined =>
  r.unitIndex === null || r.unitIndex === undefined ? undefined : s.units[r.unitIndex];

export const cityAtIndex = (s: GameState, r: { cityIndex: number | null }): City | undefined =>
  r.cityIndex === null || r.cityIndex === undefined ? undefined : s.cities[r.cityIndex];
