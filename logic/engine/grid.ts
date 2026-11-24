import { cloneDiplomacy } from "./diplomacy";
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

/** Deep copy of a game state (plain JSON data, so this is safe and fast enough). */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    tiles: s.tiles.map((t) => ({ ...t })),
    units: s.units.map((u) => ({ ...u, lastDir: u.lastDir ? { ...u.lastDir } : null })),
    cities: s.cities.map((c) => ({ ...c, pendingRewards: c.pendingRewards.slice() })),
    players: s.players.map((p) => ({
      ...p,
      techs: p.techs.slice(),
      explored: p.explored.slice(),
      met: p.met.slice(),
      tasks: p.tasks.slice(),
      monuments: p.monuments.slice(),
      lighthouses: p.lighthouses.slice(),
      embassies: p.embassies.slice(),
    })),
    log: s.log.slice(-50),
    ...(s.diplomacy ? { diplomacy: cloneDiplomacy(s.diplomacy) } : {}),
  };
}
