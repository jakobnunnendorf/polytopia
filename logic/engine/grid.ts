/** grid helpers: the pure coordinate helpers are TypeScript, the state copy goes through the Rust engine */
import { call } from "./rust";
import type { Coord, GameState, Tile } from "./types";

export const idx = (size: number, x: number, y: number) => y * size + x;

export const inBounds = (size: number, x: number, y: number) =>
  x >= 0 && y >= 0 && x < size && y < size;

export const tileAt = (s: GameState, x: number, y: number): Tile =>
  s.tiles[idx(s.mapSize, x, y)];

/** Chebyshev distance: the game uses 8-directional movement. */
export const dist = (a: Coord, b: Coord) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** All in-bounds coords within `r` (Chebyshev) of `c`, excluding c itself unless includeSelf. */
export function around(
  size: number,
  c: Coord,
  r: number,
  includeSelf = false,
): Coord[] {
  const out: Coord[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!includeSelf && dx === 0 && dy === 0) continue;
      const x = c.x + dx;
      const y = c.y + dy;
      if (inBounds(size, x, y)) out.push({ x, y });
    }
  }
  return out;
}

export const isWater = (t: Tile) => t.terrain === "water" || t.terrain === "ocean";

/** deep copy of a game state (through the Rust engine's state) */
export const cloneState = (s: GameState): GameState => call("cloneState", s);
