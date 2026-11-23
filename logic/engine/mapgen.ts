/**
 * Map generation, following the Polytopia wiki "Map Generation" page
 * (see docs/shardlands/RULES.md, section Map generation):
 *
 *  1. capitals, one per quadrant/domain (4 domains for 1-4 players,
 *     9 for 5-9, 16 for 10-16)
 *  2. land/water from smoothed noise, with the water share set by map type
 *  3. villages ("post-terrain"): random land tiles, at least 3 apart
 *     (2 empty tiles between) and away from the edge, until none fit
 *  4. land terrain in exact proportions: 48% field, 38% forest, 14% mountain
 *  5. resources only within 2 tiles of a city/village, with "inner"
 *     (adjacent) and "outer" (distance 2) rates
 *  6. fish on 50% of shallow water near a city/village; ruins (count by map
 *     size); starfish (about one per 25 water tiles)
 */
import type { Rng } from "./rng";
import { shuffle } from "./rng";
import { around, dist, idx, inBounds } from "./grid";
import type { Coord, Terrain, Tile } from "./types";

export type MapType =
  | "drylands"
  | "lakes"
  | "continents"
  | "pangea"
  | "archipelago"
  | "waterworld";

/** water share range per map type (wiki "Water Amount" table) */
export const WETNESS: Record<MapType, [number, number]> = {
  drylands: [0, 0.1],
  lakes: [0.25, 0.3],
  continents: [0.4, 0.7],
  pangea: [0.4, 0.6],
  archipelago: [0.6, 0.8],
  waterworld: [0.9, 1.0],
};

/** ruins per map width (wiki table) */
export const RUINS_BY_SIZE: Record<number, number> = {
  11: 4,
  14: 5,
  16: 7,
  18: 9,
  20: 11,
  30: 23,
};

export function ruinCount(size: number): number {
  if (RUINS_BY_SIZE[size] !== undefined) return RUINS_BY_SIZE[size];
  // interpolate for non-standard sizes: about one ruin per 37 tiles
  return Math.max(1, Math.round((size * size) / 37));
}

/** land spawn rates (wiki "Spawn Rates" table), base tribe */
export const LAND_SHARE = { field: 0.48, forest: 0.38, mountain: 0.14 };
export const RESOURCE_RATES = {
  inner: { fruit: 0.18, crop: 0.18, animal: 0.19, metal: 0.11 },
  outer: { fruit: 0.06, crop: 0.06, animal: 0.06, metal: 0.03 },
};
export const FISH_RATE = 0.5;
export const WATER_TILES_PER_STARFISH = 25;

export function domainsFor(players: number): number {
  if (players <= 4) return 2;
  if (players <= 9) return 3;
  return 4;
}

function emptyTile(terrain: Terrain): Tile {
  return {
    terrain,
    resource: null,
    building: null,
    buildingLevel: 0,
    builtTurn: 0,
    road: false,
    cityId: null,
    village: false,
    ruin: false,
    lighthouse: false,
    territory: null,
  };
}

/** smoothed value noise in [0,1] */
function noiseField(rng: Rng, n: number, cell: number): number[] {
  const g = Math.ceil(n / cell) + 2;
  const grid = Array.from({ length: g * g }, () => rng.next());
  const at = (gx: number, gy: number) => grid[gy * g + gx];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out: number[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      out.push(a * (1 - ty) + b * ty);
    }
  }
  return out;
}

export type GeneratedMap = {
  tiles: Tile[];
  capitals: Coord[];
  villages: Coord[];
};

export function generateMap(
  rng: Rng,
  n: number,
  players: number,
  mapType: MapType = "drylands",
  /** per-player spawn modifiers (§6.3), applied in the area nearest each capital */
  mods: Partial<Record<string, number>>[] = [],
): GeneratedMap {
  // 1. capitals in distinct domains
  const domains = domainsFor(players);
  const span = n / domains;
  const cells = shuffle(
    rng,
    Array.from({ length: domains * domains }, (_, i) => i),
  ).slice(0, players);
  const capitals: Coord[] = cells.map((c) => {
    const col = c % domains;
    const row = Math.floor(c / domains);
    const pad = span >= 5 ? 1 : 0;
    const minX = Math.max(1, Math.floor(col * span) + pad);
    const maxX = Math.min(n - 2, Math.ceil((col + 1) * span) - 1 - pad);
    const minY = Math.max(1, Math.floor(row * span) + pad);
    const maxY = Math.min(n - 2, Math.ceil((row + 1) * span) - 1 - pad);
    return { x: rng.int(minX, Math.max(minX, maxX)), y: rng.int(minY, Math.max(minY, maxY)) };
  });

  // 2. land / water: noise thresholded to the exact water share
  const [wLo, wHi] = WETNESS[mapType];
  const wetness = wLo + rng.next() * (wHi - wLo);
  const coarse = noiseField(rng, n, mapType === "archipelago" ? 2.5 : 4);
  const fine = noiseField(rng, n, 2);
  const height = coarse.map((v, i) => 0.7 * v + 0.3 * fine[i]);
  if (mapType === "pangea") {
    const c = (n - 1) / 2;
    for (let i = 0; i < height.length; i++) {
      const d = dist({ x: i % n, y: Math.floor(i / n) }, { x: c, y: c }) / c;
      height[i] -= 0.6 * d;
    }
  }
  const land = new Array<boolean>(n * n).fill(true);
  const waterCount = Math.round(wetness * n * n);
  if (waterCount > 0) {
    const order = height.map((h, i) => [h, i] as const).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < waterCount; k++) land[order[k][1]] = false;
  }
  // capitals and their neighbours are land
  for (const c of capitals) {
    for (const p of around(n, c, 1, true)) land[idx(n, p.x, p.y)] = true;
  }

  // 3. villages, at least 3 apart from each other and the capitals, not on the edge
  const villages: Coord[] = [];
  const centres = () => [...capitals, ...villages];
  const candidates = shuffle(
    rng,
    Array.from({ length: n * n }, (_, i) => ({ x: i % n, y: Math.floor(i / n) })),
  ).filter((p) => land[idx(n, p.x, p.y)] && p.x >= 1 && p.y >= 1 && p.x <= n - 2 && p.y <= n - 2);
  for (const p of candidates) {
    if (centres().every((c) => dist(c, p) >= 3)) villages.push(p);
  }

  // 4. terrain on land in exact proportions; settlements stand on fields
  const tiles: Tile[] = land.map((l) => emptyTile(l ? "field" : "water"));
  const settlement = new Set(centres().map((c) => idx(n, c.x, c.y)));
  const landIdx = shuffle(
    rng,
    tiles.map((_, i) => i).filter((i) => land[i] && !settlement.has(i)),
  );
  // each land tile belongs to the area of its nearest capital (ties: lower index)
  const areaOf = (i: number) => {
    const p = { x: i % n, y: Math.floor(i / n) };
    let best = 0;
    for (let k = 1; k < capitals.length; k++)
      if (dist(capitals[k], p) < dist(capitals[best], p)) best = k;
    return best;
  };
  const modOf = (area: number, key: string) => mods[area]?.[key] ?? 1;
  const byArea = new Map<number, number[]>();
  for (const i of landIdx) {
    const a = areaOf(i);
    if (!byArea.has(a)) byArea.set(a, []);
    byArea.get(a)!.push(i);
  }
  for (const [a, idxs] of byArea) {
    // §6.3: mountain modifier rescales forest and field; then forest takes from field
    let mShare = LAND_SHARE.mountain * modOf(a, "mountain");
    const rest = 1 - mShare;
    let fShare = (LAND_SHARE.forest / (1 - LAND_SHARE.mountain)) * rest * modOf(a, "forest");
    if (mShare + fShare > 1) fShare = 1 - mShare;
    mShare = Math.max(0, mShare);
    const total = idxs.length;
    const mountains = Math.round(total * mShare);
    const forests = Math.round(total * fShare);
    idxs.forEach((i, k) => {
      tiles[i].terrain = k < mountains ? "mountain" : k < mountains + forests ? "forest" : "field";
    });
  }
  // water next to land is shallow, the rest is deep ocean
  for (let i = 0; i < tiles.length; i++) {
    if (land[i]) continue;
    const p = { x: i % n, y: Math.floor(i / n) };
    const nearLand = around(n, p, 1).some((q) => land[idx(n, q.x, q.y)]);
    tiles[i].terrain = nearLand ? "water" : "ocean";
  }
  for (const v of villages) tiles[idx(n, v.x, v.y)].village = true;

  // 5. resources near settlements
  const nearest = (p: Coord) => Math.min(...centres().map((c) => dist(c, p)));
  for (let i = 0; i < tiles.length; i++) {
    if (settlement.has(i)) continue;
    const p = { x: i % n, y: Math.floor(i / n) };
    const d = nearest(p);
    if (d > 2) continue;
    const r = d === 1 ? RESOURCE_RATES.inner : RESOURCE_RATES.outer;
    const t = tiles[i];
    const a = areaOf(i);
    const m = (k: string) => modOf(a, k);
    const roll = rng.next();
    if (t.terrain === "field") {
      const share = LAND_SHARE.field;
      const fruit = (r.fruit * m("fruit")) / share;
      const crop = (r.crop * m("crop")) / share;
      if (roll < fruit) t.resource = "fruit";
      else if (roll < fruit + crop) t.resource = "crop";
    } else if (t.terrain === "forest") {
      if (roll < (r.animal * m("animal")) / LAND_SHARE.forest) t.resource = "animal";
    } else if (t.terrain === "mountain") {
      if (roll < (r.metal * m("metal")) / LAND_SHARE.mountain) t.resource = "metal";
    } else if (t.terrain === "water") {
      if (roll < FISH_RATE * m("fish")) t.resource = "fish";
    }
  }

  // lighthouses in the four corners (§6.4)
  for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]]) {
    tiles[idx(n, x, y)].lighthouse = true;
  }

  // 6. ruins: land or deep ocean, not next to a village/ruin/settlement
  const ruinSpots = shuffle(rng, tiles.map((_, i) => i)).filter((i) => {
    const t = tiles[i];
    return t.terrain !== "water" && !settlement.has(i) && t.resource === null && !t.lighthouse;
  });
  let ruins = ruinCount(n);
  const ruinCoords: Coord[] = [];
  for (const i of ruinSpots) {
    if (ruins === 0) break;
    const p = { x: i % n, y: Math.floor(i / n) };
    if (centres().some((c) => dist(c, p) <= 1)) continue;
    if (ruinCoords.some((c) => dist(c, p) <= 1)) continue;
    tiles[i].ruin = true;
    ruinCoords.push(p);
    ruins--;
  }

  // starfish: ~1 per 25 water tiles, not adjacent to another starfish or a settlement
  const waterIdx = shuffle(
    rng,
    tiles.map((_, i) => i).filter((i) => !land[i] && !tiles[i].ruin && !tiles[i].lighthouse && tiles[i].resource === null),
  );
  let starfish = Math.floor((n * n - land.filter(Boolean).length) / WATER_TILES_PER_STARFISH);
  const starCoords: Coord[] = [];
  for (const i of waterIdx) {
    if (starfish === 0) break;
    const p = { x: i % n, y: Math.floor(i / n) };
    if (starCoords.some((c) => dist(c, p) <= 1)) continue;
    if (centres().some((c) => dist(c, p) <= 1)) continue;
    tiles[i].resource = "starfish";
    starCoords.push(p);
    starfish--;
  }

  return { tiles, capitals, villages };
}

export { inBounds };
