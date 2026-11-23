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
 *  6. fish on 50% of shallow water and ocean near a city/village; ruins
 *     (count by map size); starfish (about one per 25 water tiles)
 *
 * Map-type steps from the rules doc (POLYTOPIA_RULES.md, "How the map is
 * generated"): suburbs and an early village batch on Lakes/Archipelago/Water
 * World, capitals picked among villages on Continents/Pangea, land only around
 * cities on Water World, a land ring on Lakes.
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

/** "Extra island villages (Continents, Pangea)" per map width (rules doc, Map sizes) */
export const EXTRA_ISLAND_VILLAGES: Record<number, number> = { 11: 0, 14: 1, 16: 2, 18: 3, 20: 4, 30: 9 };

/** early (pre-terrain) village coefficient per map type (rules doc, How the map is generated) */
export const EARLY_VILLAGE_COEF: Partial<Record<MapType, number>> = { lakes: 0.3, archipelago: 0.3, waterworld: 0.1 };

export type MapOptions = {
  /** per player: the capital gets 2 water tiles with fish next to it (Kickoo, Aquarion), on every map type */
  waterStart?: boolean[];
  /** per player: the land of its area is flooded (Aquarion) */
  flooded?: boolean[];
  /** per player: spores instead of crops in its area, at least 2 next to the capital (Cymanti) */
  spores?: boolean[];
  /** Aqua Crops on shallow water (only when an Aquarion plays; only Aquarion sees them) */
  aquaCrops?: boolean;
};

export function generateMap(
  rng: Rng,
  n: number,
  players: number,
  mapType: MapType = "drylands",
  /** per-player spawn modifiers (§6.3), applied in the area nearest each capital */
  mods: Partial<Record<string, number>>[] = [],
  opts: MapOptions = {},
): GeneratedMap {
  const notEdge = (p: Coord) => p.x >= 1 && p.y >= 1 && p.x <= n - 2 && p.y <= n - 2;
  const capitalsFromVillages = mapType === "continents" || mapType === "pangea";
  const allCoords = Array.from({ length: n * n }, (_, i) => ({ x: i % n, y: Math.floor(i / n) }));

  // 1. capitals in distinct quadrants (Drylands, Lakes, Archipelago, Water World)
  let capitals: Coord[] = [];
  if (!capitalsFromVillages) {
    const domains = domainsFor(players);
    const span = n / domains;
    const cells = shuffle(
      rng,
      Array.from({ length: domains * domains }, (_, i) => i),
    ).slice(0, players);
    capitals = cells.map((c) => {
      const col = c % domains;
      const row = Math.floor(c / domains);
      const pad = span >= 5 ? 1 : 0;
      const minX = Math.max(1, Math.floor(col * span) + pad);
      const maxX = Math.min(n - 2, Math.ceil((col + 1) * span) - 1 - pad);
      const minY = Math.max(1, Math.floor(row * span) + pad);
      const maxY = Math.min(n - 2, Math.ceil((row + 1) * span) - 1 - pad);
      return { x: rng.int(minX, Math.max(minX, maxX)), y: rng.int(minY, Math.max(minY, maxY)) };
    });
  }

  // 2. pre-terrain villages: suburbs (Lakes, Archipelago), then the early batch
  const villages: Coord[] = [];
  const centres = () => [...capitals, ...villages];
  // no village within 2 tiles of another village or city, and none on the edge
  const villageFits = (p: Coord) => notEdge(p) && centres().every((c) => dist(c, p) >= 3);
  let suburbs = 0;
  if (mapType === "lakes" || mapType === "archipelago") {
    for (const cap of capitals.slice()) {
      const want = rng.int(0, 2);
      let placed = 0;
      for (const p of shuffle(rng, allCoords.filter((q) => dist(q, cap) === 3))) {
        if (placed >= want) break;
        if (!villageFits(p)) continue;
        villages.push(p);
        placed++;
      }
      suburbs += placed;
    }
  }
  const coef = EARLY_VILLAGE_COEF[mapType] ?? 0;
  if (coef > 0) {
    let early = Math.round((Math.floor(n / 3) ** 2 - capitals.length - suburbs) * coef);
    for (const p of shuffle(rng, allCoords)) {
      if (early <= 0) break;
      if (!villageFits(p)) continue;
      villages.push(p);
      early--;
    }
  }

  // 3a. land / water. A capital and its 8 neighbours are land; a pre-terrain
  // village is land on its own tile (an island on Archipelago and Water World)
  const forcedLand = () => [
    ...capitals.flatMap((c) => around(n, c, 1, true).map((p) => idx(n, p.x, p.y))),
    ...villages.map((v) => idx(n, v.x, v.y)),
  ];
  const land = new Array<boolean>(n * n).fill(true);
  if (mapType === "waterworld") {
    // land only where cities stand
    land.fill(false);
  } else {
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
    if (mapType === "lakes") {
      // inland lakes inside a ring of land at the edge
      for (let i = 0; i < height.length; i++) if (!notEdge(allCoords[i])) height[i] += 10;
    }
    // reserve the forced land first so the water share still comes out exact
    for (const i of forcedLand()) height[i] += 10;
    const waterCount = Math.round(wetness * n * n);
    const waterMods = capitals.map((_, k) => mods[k]?.water ?? 1);
    if (!capitalsFromVillages && waterMods.some((w) => w !== 1)) {
      // tribe water multipliers: each capital's area gets wetness × its multiplier,
      // scaled down together if the map total would leave the map type's range
      const areaAt = (i: number) => {
        let best = 0;
        for (let k = 1; k < capitals.length; k++)
          if (dist(capitals[k], allCoords[i]) < dist(capitals[best], allCoords[i])) best = k;
        return best;
      };
      const areas = capitals.map(() => [] as number[]);
      for (let i = 0; i < n * n; i++) areas[areaAt(i)].push(i);
      const want = (c: number) => areas.map((a, k) => Math.min(a.length, Math.round(c * wetness * waterMods[k] * a.length)));
      const sum = (c: number) => want(c).reduce((x, y) => x + y, 0);
      const lo = Math.round(wLo * n * n);
      const hi = Math.round(wHi * n * n);
      let c = 1;
      if (sum(1) > hi || sum(1) < lo) {
        const target = sum(1) > hi ? hi : lo;
        let a = sum(1) > hi ? 0 : 1;
        let b = sum(1) > hi ? 1 : 1 / Math.max(wetness, 1e-6);
        for (let it = 0; it < 40; it++) {
          const mid = (a + b) / 2;
          if (sum(mid) > target) b = mid;
          else a = mid;
        }
        c = a;
      }
      const counts = want(c);
      areas.forEach((a, k) => {
        const order = a.map((i) => [height[i], i] as const).sort((x, y) => x[0] - y[0]);
        for (let j = 0; j < counts[k]; j++) land[order[j][1]] = false;
      });
    } else if (waterCount > 0) {
      const order = height.map((h, i) => [h, i] as const).sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < waterCount; k++) land[order[k][1]] = false;
    }
  }
  for (const i of forcedLand()) land[i] = true;

  // 3b. post-terrain villages: random land tiles until no valid tile is left
  for (const p of shuffle(rng, allCoords)) {
    if (land[idx(n, p.x, p.y)] && villageFits(p)) villages.push(p);
  }

  // Continents and Pangea: extra villages on small islands, then the capitals
  // are picked among the villages, as far apart as possible and near the coast
  if (capitalsFromVillages) {
    let extra = EXTRA_ISLAND_VILLAGES[n] ?? Math.max(0, Math.round(n / 3) - 3);
    const offshore = (p: Coord) => around(n, p, 1, true).every((q) => !land[idx(n, q.x, q.y)]);
    for (const p of shuffle(rng, allCoords)) {
      if (extra <= 0) break;
      if (!villageFits(p) || !offshore(p)) continue;
      land[idx(n, p.x, p.y)] = true;
      villages.push(p);
      extra--;
    }
    const coastal = (p: Coord) => around(n, p, 2).some((q) => !land[idx(n, q.x, q.y)]);
    const pool = shuffle(rng, villages.slice());
    const ranked = [...pool.filter(coastal), ...pool.filter((p) => !coastal(p))];
    const chosen: Coord[] = [];
    while (chosen.length < players && ranked.length) {
      let best = 0;
      if (chosen.length) {
        let bestD = -1;
        ranked.forEach((p, i) => {
          const d = Math.min(...chosen.map((c) => dist(c, p)));
          // a coastal village wins any tie
          if (d > bestD || (d === bestD && coastal(p) && !coastal(ranked[best]))) {
            bestD = d;
            best = i;
          }
        });
      }
      chosen.push(ranked.splice(best, 1)[0]);
    }
    capitals = chosen;
    for (const c of capitals) villages.splice(villages.indexOf(c), 1);
    for (const c of capitals) for (const p of around(n, c, 1, true)) land[idx(n, p.x, p.y)] = true;
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
    const p = allCoords[i];
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
  // Kickoo and Aquarion capitals get 2 water tiles with fish next to them (even on Drylands)
  const forcedFish = new Set<number>();
  {
    capitals.forEach((c, p) => {
      if (!opts.waterStart?.[p]) return;
      const ring = shuffle(rng, around(n, c, 1)).map((q) => idx(n, q.x, q.y));
      const water = ring.filter((i) => !land[i]);
      for (const i of ring) {
        if (water.length >= 2) break;
        if (!land[i] || settlement.has(i)) continue;
        land[i] = false;
        water.push(i);
      }
      for (const i of water.slice(0, 2)) forcedFish.add(i);
    });
  }
  // water next to land is shallow, the rest is deep ocean
  for (let i = 0; i < tiles.length; i++) {
    if (land[i]) continue;
    const nearLand = around(n, allCoords[i], 1).some((q) => land[idx(n, q.x, q.y)]);
    tiles[i].terrain = nearLand ? "water" : "ocean";
  }
  for (const v of villages) tiles[idx(n, v.x, v.y)].village = true;
  // Aquarion: the land of its area is flooded (fields and forests; not settlements)
  if (opts.flooded?.some(Boolean)) {
    for (let i = 0; i < tiles.length; i++) {
      if (!land[i] || settlement.has(i) || tiles[i].terrain === "mountain") continue;
      if (opts.flooded[areaOf(i)]) tiles[i].flooded = true;
    }
  }

  // 5. resources only within 2 tiles of a city or village
  const nearest = (p: Coord) => Math.min(...centres().map((c) => dist(c, p)));
  for (let i = 0; i < tiles.length; i++) {
    if (settlement.has(i)) continue;
    const t = tiles[i];
    if (forcedFish.has(i)) {
      t.resource = "fish";
      continue;
    }
    const d = nearest(allCoords[i]);
    if (d > 2) continue;
    const r = d === 1 ? RESOURCE_RATES.inner : RESOURCE_RATES.outer;
    const a = areaOf(i);
    const m = (k: string) => modOf(a, k);
    const roll = rng.next();
    if (t.terrain === "field") {
      const share = LAND_SHARE.field;
      const fruit = (r.fruit * m("fruit")) / share;
      const crop = (r.crop * m("crop")) / share;
      if (roll < fruit) t.resource = "fruit";
      else if (roll < fruit + crop) t.resource = opts.spores?.[a] ? "spores" : "crop";
    } else if (t.terrain === "forest") {
      if (roll < (r.animal * m("animal")) / LAND_SHARE.forest) t.resource = "animal";
    } else if (t.terrain === "mountain") {
      if (roll < (r.metal * m("metal")) / LAND_SHARE.mountain) t.resource = "metal";
    } else {
      // fish on half the shallow water, and on ocean too since 2.8
      if (roll < FISH_RATE * m("fish")) t.resource = "fish";
      // Aqua Crops on shallow water without fish, at the crop rate (engine choice)
      else if (opts.aquaCrops && t.terrain === "water" && rng.next() < r.crop / LAND_SHARE.field) t.resource = "aquaCrop";
    }
  }
  // Cymanti: at least 2 spores next to the capital
  capitals.forEach((c, p) => {
    if (!opts.spores?.[p]) return;
    const ring = around(n, c, 1).map((q) => idx(n, q.x, q.y)).filter((i) => land[i] && !settlement.has(i));
    let have = ring.filter((i) => tiles[i].resource === "spores").length;
    const rank = (i: number) => (tiles[i].terrain === "field" ? 0 : 2) + (tiles[i].resource ? 1 : 0);
    for (const i of ring.slice().sort((x, y) => rank(x) - rank(y))) {
      if (have >= 2) break;
      if (tiles[i].resource === "spores") continue;
      tiles[i].terrain = "field";
      tiles[i].resource = "spores";
      have++;
    }
  });

  // lighthouses in the four corners (§6.4)
  const lighthouses: Coord[] = [
    { x: 0, y: 0 },
    { x: n - 1, y: 0 },
    { x: 0, y: n - 1 },
    { x: n - 1, y: n - 1 },
  ];
  for (const c of lighthouses) tiles[idx(n, c.x, c.y)].lighthouse = true;

  // 6. ruins on fields, forests, mountains or deep ocean; never next to a ruin,
  // a capital or a village; on Lakes at most a third of them on water
  const ruinSpots = shuffle(rng, tiles.map((_, i) => i)).filter((i) => {
    const t = tiles[i];
    return t.terrain !== "water" && !settlement.has(i) && t.resource === null && !t.lighthouse;
  });
  const ruinTotal = ruinCount(n);
  let ruins = ruinTotal;
  let waterRuinsLeft = mapType === "lakes" ? Math.floor(ruinTotal / 3) : Infinity;
  const ruinCoords: Coord[] = [];
  for (const i of ruinSpots) {
    if (ruins === 0) break;
    const p = allCoords[i];
    if (centres().some((c) => dist(c, p) <= 1)) continue;
    if (ruinCoords.some((c) => dist(c, p) <= 1)) continue;
    const onWater = tiles[i].terrain === "ocean";
    if (onWater && waterRuinsLeft <= 0) continue;
    if (onWater) waterRuinsLeft--;
    tiles[i].ruin = true;
    ruinCoords.push(p);
    ruins--;
  }

  // starfish: ~1 per 25 water tiles, never next to another starfish, a lighthouse or a city
  const waterIdx = shuffle(
    rng,
    tiles.map((_, i) => i).filter((i) => !land[i] && !tiles[i].ruin && !tiles[i].lighthouse && tiles[i].resource === null),
  );
  let starfish = Math.floor((n * n - land.filter(Boolean).length) / WATER_TILES_PER_STARFISH);
  const starCoords: Coord[] = [];
  for (const i of waterIdx) {
    if (starfish === 0) break;
    const p = allCoords[i];
    if (starCoords.some((c) => dist(c, p) <= 1)) continue;
    if (lighthouses.some((c) => dist(c, p) <= 1)) continue;
    if (centres().some((c) => dist(c, p) <= 1)) continue;
    tiles[i].resource = "starfish";
    starCoords.push(p);
    starfish--;
  }

  return { tiles, capitals, villages };
}

export { inBounds };
