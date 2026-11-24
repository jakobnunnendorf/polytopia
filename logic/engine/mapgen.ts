/**
 * Map generation for Polytopia 2.18. The algorithm follows polybots-engine
 * (Apache-2.0, src/mapgen*.rs), which replays the game's own generator:
 *
 *  Noise path (Drylands, Lakes, Archipelago, Water World, and the fallback of
 *  Continents/Pangea):
 *   1. capitals: one per domain (ceil(sqrt(players))² domains), weighted
 *      towards the domain centre by cubic peaks
 *   2. suburbs (1-2 per capital on Lakes/Archipelago/Continents/Pangea, none
 *      on Drylands/Water World) at ring 3+, joined to the capital by a land
 *      corridor; then pre-terrain villages (density 0.3, Water World 0.1,
 *      Drylands 0)
 *   3. land/water: one noise sample per tile (cities, corridors and the
 *      capitals' neighbours biased to land), smoothed, the water share is the
 *      map type's wetness quantile (Drylands 0, Lakes 0.3, Continents/Pangea
 *      0.5, Archipelago 0.65, Water World 0.85)
 *   4. post-terrain villages on land: budget floor(0.33·width)² − players
 *      minus the pre-terrain budget, no other city within 2, not on the edge
 *  Island path (Continents, Pangea): continents grown from seeds (Pangea: the
 *  centre), villages on them, capitals picked among the villages as far apart
 *  as possible, open-water villages (wetness·tiles/50).
 *  Then for both:
 *   5. climates: each tribe's climate grows from its capital, round robin,
 *      land first (Polaris grows none: "alien climate")
 *   6. terrain per climate in exact quotas of field 0.5 : mountain 0.15 :
 *      forest 0.4, times the tribe's terrain modifiers
 *   7. resources: every tile next to a city or village rolls (richness 1),
 *      the ring at distance 2 with chance 1/3, nothing further out; each
 *      resource passes on its own chance (fruit/crop/game/fish 0.5, metal
 *      0.8, aqua crop 0.3, times the tribe's modifiers) and one of those that
 *      fit the terrain is kept
 *   8. the tribe's starting resources around the capital (2 game, 2 fruit,
 *      2 fish for Kickoo/Aquarion, 2 spores for Cymanti, ...), turning a tile's
 *      terrain if needed
 *   9. Aquarion floods every field and forest of its home climate; ruins
 *      (tiles/40 + 1); starfish (wetness·tiles/25); Polaris freezes the water
 *      next to its capital
 *  The map is drawn up to 50 times and the fairest kept (turf inequality
 *  below 1.01 stops early), as the game does.
 *
 * Our random generator is not the game's, so maps differ seed by seed but
 * follow the same distributions.
 */
import type { Rng } from "./rng";
import { createRng } from "./rng";
import type { Coord, ResourceId, Terrain, Tile } from "./types";

export type MapType =
  | "drylands"
  | "lakes"
  | "continents"
  | "pangea"
  | "archipelago"
  | "waterworld";

/** the game's MapGeneratorSettings per preset (polybots-engine mapgen.rs) */
export type MapSettings = {
  wetness: number;
  richness: number;
  smoothIterations: number;
  preTerrainCityDensity: number;
  postTerrainCityDensity: number;
  minSuburbs: number;
  maxSuburbs: number;
  surroundingSpace: number;
  equalityIterations: number;
  equalityLimit: number;
};

const BASE: MapSettings = {
  wetness: 0.45,
  richness: 1,
  smoothIterations: 2,
  preTerrainCityDensity: 0.3,
  postTerrainCityDensity: 1,
  minSuburbs: 1,
  maxSuburbs: 2,
  surroundingSpace: 0.5,
  equalityIterations: 50,
  equalityLimit: 1.01,
};

export const MAP_SETTINGS: Record<MapType, MapSettings> = {
  drylands: { ...BASE, wetness: 0, smoothIterations: 0, preTerrainCityDensity: 0, minSuburbs: 0, maxSuburbs: 0 },
  lakes: { ...BASE, wetness: 0.3, surroundingSpace: 1 },
  continents: { ...BASE, wetness: 0.5, surroundingSpace: 1, smoothIterations: 1 },
  pangea: { ...BASE, wetness: 0.5, surroundingSpace: 0, smoothIterations: 1 },
  archipelago: { ...BASE, wetness: 0.65, smoothIterations: 0 },
  waterworld: { ...BASE, wetness: 0.85, preTerrainCityDensity: 0.1, minSuburbs: 0, maxSuburbs: 0 },
};

/** the generator's wetness per map type (share of the noise quantile that is water) */
export const WETNESS: Record<MapType, number> = Object.fromEntries(
  Object.entries(MAP_SETTINGS).map(([k, v]) => [k, v.wetness]),
) as Record<MapType, number>;

/** ruins: tiles / 40, and the placement loop places one more (11: 4, 16: 7, 30: 23) */
export function ruinCount(size: number): number {
  return Math.floor((size * size) / 40) + 1;
}

/** base terrain weights of a climate (field, mountain, forest) */
export const TERRAIN_WEIGHTS = { field: 0.5, mountain: 0.15, forest: 0.4 };
/** base resource chances of a climate; aqua crop 0.3 once a tribe owns the climate */
export const RESOURCE_CHANCES = { animal: 0.5, crop: 0.5, fish: 0.5, metal: 0.8, fruit: 0.5, spores: 0, aquaCrop: 0 };

export type GeneratedMap = {
  tiles: Tile[];
  capitals: Coord[];
  villages: Coord[];
};

export type MapOptions = {
  /** per player: the tribe's starting resources around the capital (default: none) */
  startResources?: ResourceId[][];
  /** shorthand for tests: the player starts with 2 fish (Kickoo, Aquarion) */
  waterStart?: boolean[];
  /** per player: the home climate's fields and forests start flooded (Aquarion) */
  flooded?: boolean[];
  /** shorthand for tests: Cymanti spawns (spores 0.3, crop 0, 2 starting spores) */
  spores?: boolean[];
  /** per player: alien climate (Polaris): grows no climate; the water next to the capital freezes */
  polaris?: boolean[];
  /** per player: the climate's identity (the tribe id); two players of one tribe share a climate */
  climates?: string[];
  /** Aqua Crops stay on the map (only when an Aquarion plays; only Aquarion sees them) */
  aquaCrops?: boolean;
  /** map candidates drawn for the fairness pick (default: the preset's 50) */
  candidates?: number;
};

type Res = ResourceId | null;
type Imp = null | "city" | "ruin" | "lighthouse";

/** a climate ("continent" in the game's data): terrain weights and resource chances */
type Climate = {
  player: number;
  tiles: number[];
  field: number;
  mountain: number;
  forest: number;
  chance: Record<"animal" | "crop" | "fish" | "metal" | "fruit" | "spores" | "aquaCrop", number>;
};

const DEFAULT_CLIMATE = -2;

/** resource kinds in the game's id order, with the terrains they need */
const KINDS: [keyof Climate["chance"], Terrain[]][] = [
  ["animal", ["forest"]],
  ["crop", ["field"]],
  ["fish", ["water", "ocean"]],
  ["metal", ["mountain"]],
  ["fruit", ["field"]],
  ["spores", ["field", "forest"]],
  ["aquaCrop", ["water", "ocean"]],
];
const TERRAINS_OF: Record<string, Terrain[]> = Object.fromEntries(KINDS);

const isWaterT = (t: Terrain) => t === "water" || t === "ocean";
/** the game's modifier rule: a positive default is multiplied, a zero default is replaced */
const modify = (base: number, m: number | undefined) => (m === undefined ? base : base > 0 ? base * m : m);

function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

class Gen {
  n: number;
  total: number;
  terrain: Terrain[];
  alt: number[];
  imp: Imp[];
  /** player owning the tile (capital territory), -1 none */
  owner: number[];
  /** climate index (player index), -1 none, DEFAULT_CLIMATE for an untouched island */
  cont: (number | null)[];
  /** climate identity for flooding (the tribe id), "" none */
  climKey: string[];
  resource: Res[];
  capital: number[];
  climates: Climate[] = [];
  /** island continents (island path) */
  islands: number[][] = [];

  constructor(
    public rng: Rng,
    n: number,
    public players: number,
    public s: MapSettings,
    public mapType: MapType,
    public mods: Partial<Record<string, number>>[],
    public opts: MapOptions,
  ) {
    this.n = n;
    this.total = n * n;
    this.terrain = new Array(this.total).fill("water");
    this.alt = new Array(this.total).fill(-1);
    this.imp = new Array(this.total).fill(null);
    this.owner = new Array(this.total).fill(-1);
    this.cont = new Array(this.total).fill(null);
    this.climKey = new Array(this.total).fill("");
    this.resource = new Array(this.total).fill(null);
    this.capital = [];
  }

  clear() {
    this.terrain.fill("water");
    this.alt.fill(-1);
    this.imp.fill(null);
    this.owner.fill(-1);
    this.cont.fill(null);
    this.climKey.fill("");
    this.resource.fill(null);
    this.capital = [];
    this.islands = [];
  }

  // ---- random helpers (the game's stream shapes, our generator) ----
  range(min: number, max: number): number {
    return min + Math.floor(this.rng.next() * (max - min));
  }
  float(min = 0, max = 1): number {
    return min + this.rng.next() * (max - min);
  }
  shuffle<T>(a: T[]): T[] {
    for (let i = 0; i < a.length - 1; i++) {
      const j = this.range(i, a.length);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- geometry ----
  x(i: number) {
    return i % this.n;
  }
  y(i: number) {
    return Math.floor(i / this.n);
  }
  cheb(a: number, b: number) {
    return Math.max(Math.abs(this.x(a) - this.x(b)), Math.abs(this.y(a) - this.y(b)));
  }
  edge(i: number) {
    const x = this.x(i);
    const y = this.y(i);
    return Math.min(x, y, this.n - 1 - x, this.n - 1 - y);
  }
  /** the square of `r` around i without i, in-bounds */
  area(i: number, r: number): number[] {
    const cx = this.x(i);
    const cy = this.y(i);
    const out: number[] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < this.n && y < this.n) out.push(y * this.n + x);
      }
    return out;
  }
  side() {
    return Math.ceil(Math.sqrt(this.players));
  }
  minCapitalDistance() {
    return 3 + (Math.floor((this.n - 1) / this.side()) > 4 ? 1 : 0);
  }
  isCity(i: number) {
    return this.imp[i] === "city";
  }
  setCity(i: number) {
    this.owner[i] = -1;
    this.terrain[i] = "field";
    this.resource[i] = null;
    this.imp[i] = "city";
  }
  key(p: number) {
    return this.opts.climates?.[p] ?? `p${p}`;
  }
  setCapital(p: number, i: number) {
    this.capital[p] = i;
    this.terrain[i] = "field";
    this.alt[i] = 1;
    this.resource[i] = null;
    this.imp[i] = "city";
    this.cont[i] = p;
    this.climKey[i] = this.key(p);
    // its border (radius 1) is its territory
    for (const j of [i, ...this.area(i, 1)]) if (this.owner[j] === -1) this.owner[j] = p;
    this.owner[i] = p;
  }

  // ---- placement (mapgen_placement.rs) ----
  removeNear(list: number[], site: number, r: number) {
    const cx = this.x(site);
    const cy = this.y(site);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        // flattened without clamping, as the game does
        const k = list.indexOf(y * this.n + x);
        if (k >= 0) list.splice(k, 1);
      }
  }

  capitalPositions(count: number): number[] {
    const w = this.n;
    const side = Math.ceil(Math.sqrt(count));
    const domain = Math.floor(w / side);
    const rem = w % side;
    const table = new Array<number>(w * w).fill(0);
    const offset = (v: number) => Math.min(rem, Math.max(1, Math.min(rem, v) - 1));
    for (let dy = 0; dy < side; dy++)
      for (let dx = 0; dx < side; dx++) {
        const cx = domain * dx + Math.floor(domain / 2) + offset(dx);
        const cy = domain * dy + Math.floor(domain / 2) + offset(dy);
        for (let i = 0; i < table.length; i++) {
          const d = Math.max(Math.abs(this.x(i) - cx), Math.abs(this.y(i) - cy));
          const peak = Math.max(1, Math.floor(domain / 2) - d);
          table[i] = Math.max(table[i], peak * peak * peak);
        }
      }
    const domains = Array.from({ length: side * side }, (_, i) => i);
    const out: number[] = [];
    const inset = domain < 5 ? 1 : 2;
    for (let k = 0; k < count; k++) {
      const d = domains.splice(this.range(0, domains.length), 1)[0];
      const sx = domain * (d % side) + offset(d % side);
      const sy = domain * Math.floor(d / side) + offset(Math.floor(d / side));
      let r = {
        x0: Math.max(2, sx + inset),
        x1: Math.min(w - 2, sx + domain - inset),
        y0: Math.max(2, sy + inset),
        y1: Math.min(w - 2, sy + domain - inset),
      };
      // engine extension for many players on small maps: widen an empty range
      if (r.x0 >= r.x1 || r.y0 >= r.y1)
        r = { x0: Math.max(1, sx), x1: Math.min(w - 1, sx + domain), y0: Math.max(1, sy), y1: Math.min(w - 1, sy + domain) };
      const cells: number[] = [];
      for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) cells.push(y * w + x);
      const free = cells.filter((c) => !out.includes(c));
      if (!free.length) {
        out.push(Math.floor(w / 2) * w + Math.floor(w / 2));
        continue;
      }
      let sum = 0;
      for (const c of free) sum += Math.max(1, table[c]);
      const v = this.range(0, sum);
      let acc = 0;
      for (const c of free) {
        acc += Math.max(1, table[c]);
        if (v < acc) {
          out.push(c);
          break;
        }
      }
    }
    return out;
  }

  landCorridor(from: Coord, to: number, land: number[]) {
    const w = this.n;
    const tx = this.x(to);
    const ty = this.y(to);
    const cur = { ...from };
    for (let it = 0; it < 1000; it++) {
      if (cur.x === tx && cur.y === ty) return;
      const i = cur.y * w + cur.x;
      if (!land.includes(i)) land.push(i);
      const dx = tx - cur.x;
      const dy = ty - cur.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) return;
      const mask = this.range(1, 4);
      if (mask & 1) {
        let sign = Math.sign(dx);
        if (sign === 0) sign = this.rng.next() > 0.5 ? 1 : -1;
        cur.x = Math.min(w - 1, Math.max(0, cur.x + sign));
      }
      if (mask & 2) {
        let sign = Math.sign(dy);
        if (sign === 0) sign = this.rng.next() > 0.5 ? 1 : -1;
        cur.y = Math.min(w - 1, Math.max(0, cur.y + sign));
      }
    }
  }

  suburbs(capitals: number[], count: number, land: number[]): number[] {
    const w = this.n;
    const sites: number[] = [];
    if (count <= 0) return sites;
    const per: number[][] = capitals.map(() => []);
    const within = (c: number, list: number[], r: number) => list.some((v) => this.cheb(c, v) <= r);
    for (let k = 0; k < count; k++) {
      capitals.forEach((cap, p) => {
        const cx = this.x(cap);
        const cy = this.y(cap);
        for (let radius = 3; radius < w * 0.6; radius++) {
          const cands: number[] = [];
          for (let y = cy - radius; y <= cy + radius; y++) {
            if (y >= w - 1) break;
            if (y <= 0) continue;
            for (let x = cx - radius; x <= cx + radius; x++) {
              if (x >= w - 1) break;
              if (x <= 0) continue;
              if (x !== cx - radius && x !== cx + radius && y !== cy - radius && y !== cy + radius) continue;
              const c = y * w + x;
              if (!within(c, capitals, 2) && !within(c, sites, 2) && !within(c, per[p], 2)) cands.push(c);
            }
          }
          if (cands.length) {
            const site = cands[this.range(0, cands.length)];
            per[p].push(site);
            sites.push(site);
            break;
          }
        }
      });
    }
    capitals.forEach((cap, p) => {
      if (per[p].length !== count) {
        for (let k = 0; k < count; k++) {
          let nearest = -1;
          let best = w;
          for (const c of [...sites, ...capitals]) {
            if (c === cap || per[p].includes(c)) continue;
            const d = this.cheb(cap, c);
            if (d < best) {
              best = d;
              nearest = c;
            }
          }
          if (nearest < 0) break;
          per[p].push(nearest);
        }
      }
      let sx = this.x(cap);
      let sy = this.y(cap);
      for (const s of per[p]) {
        sx += this.x(s);
        sy += this.y(s);
      }
      const centroid = { x: Math.trunc(sx / (per[p].length + 1)), y: Math.trunc(sy / (per[p].length + 1)) };
      this.landCorridor(centroid, cap, land);
      for (const s of per[p]) this.landCorridor(centroid, s, land);
    });
    return sites;
  }

  preterrainCities(cities: number[], count: number) {
    const w = this.n;
    const cands: number[] = [];
    for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) cands.push(y * w + x);
    for (const c of cities) this.removeNear(cands, c, 2);
    for (let k = 0; k < count; k++) {
      if (!cands.length) return;
      const site = cands[this.range(0, cands.length)];
      cities.push(site);
      this.removeNear(cands, site, 2);
    }
  }

  postterrainCities(budget: number) {
    const w = this.n;
    const cands: number[] = [];
    for (let i = 0; i < this.total; i++) {
      const x = this.x(i);
      const y = this.y(i);
      if (isWaterT(this.terrain[i]) || x < 1 || y < 1 || x >= w - 1 || y >= w - 1 || this.imp[i]) continue;
      if (this.area(i, 2).every((j) => !this.imp[j])) cands.push(i);
    }
    for (let k = 0; k < budget; k++) {
      if (!cands.length) break;
      const site = cands[this.range(0, cands.length)];
      this.setCity(site);
      this.removeNear(cands, site, 2);
    }
  }

  smooth(noise: number[], protect: Set<number>, iterations: number, surrounding: number) {
    const w = this.n;
    for (let it = 0; it < iterations; it++) {
      const next = new Array<number>(noise.length);
      for (let y = 0; y < w; y++)
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let ny = y - 1; ny <= y + 1; ny++)
            for (let nx = x - 1; nx <= x + 1; nx++)
              sum += nx >= 0 && ny >= 0 && nx < w && ny < w ? noise[ny * w + nx] : surrounding;
          next[y * w + x] = sum / 9;
        }
      for (const i of protect) next[i] = noise[i];
      for (let i = 0; i < noise.length; i++) noise[i] = next[i];
    }
  }

  // ---- noise path ----
  noiseMap() {
    const s = this.s;
    const w = this.n;
    const capitals = this.capitalPositions(this.players);
    const axis = Math.floor(w * 0.33);
    const available = axis * axis - capitals.length;
    const maxCities = Math.floor(available * s.postTerrainCityDensity);
    const suburbCount = Math.max(s.minSuburbs, Math.min(s.maxSuburbs, Math.trunc(maxCities / this.players)));
    const land: number[] = [];
    const suburbs = this.suburbs(capitals, suburbCount, land);
    const cities = [...capitals, ...suburbs];
    const preBudget = Math.floor((available - suburbs.length) * s.preTerrainCityDensity);
    this.preterrainCities(cities, preBudget);
    land.push(...cities);
    const landSet = new Set(land);
    const seeds = new Set(land);
    for (const c of capitals) for (const d of [1, -1, w, -w]) seeds.add(c + d);
    const noise: number[] = [];
    for (let i = 0; i < this.total; i++) {
      const v = this.rng.next();
      noise.push(seeds.has(i) ? v * (1 - s.wetness) + s.wetness : v);
    }
    this.smooth(noise, landSet, s.smoothIterations, s.surroundingSpace);
    const sorted = noise.slice().sort((a, b) => a - b);
    const waterline = sorted[roundHalfEven((noise.length - 1) * s.wetness)];
    const citySet = new Set(cities);
    for (let i = 0; i < this.total; i++) {
      if (citySet.has(i)) {
        const seat = capitals.indexOf(i);
        if (seat >= 0) this.setCapital(seat, i);
        else this.setCity(i);
      } else if (waterline <= noise[i]) {
        this.terrain[i] = "field";
        this.alt[i] = 1;
      } else {
        this.terrain[i] = "ocean";
        this.alt[i] = -2;
      }
    }
    for (const i of land) {
      this.terrain[i] = "field";
      this.alt[i] = 1;
    }
    this.postterrainCities(maxCities - preBudget);
    this.growClimates();
  }

  // ---- island path (mapgen_candidate_islands.rs) ----
  islandMap(): boolean {
    const s = this.s;
    const w = this.n;
    const noise: number[] = [];
    for (let i = 0; i < this.total; i++) noise.push(this.rng.next());
    this.smooth(noise, new Set(), s.smoothIterations, s.surroundingSpace);
    let seeds: number[];
    if (this.mapType === "pangea") seeds = [Math.floor(w / 2) * w + Math.floor(w / 2)];
    else {
      const counts: number[] = [];
      for (let c = 2; c <= 7; c++) {
        const size = (1 - s.wetness) * Math.floor(this.total / c);
        if (size >= 30 && size <= 200) counts.push(c);
      }
      const count = counts.length ? counts[this.range(0, counts.length)] : 2;
      seeds = this.capitalPositions(count);
    }
    let populated = seeds.length;
    while (populated > 1) {
      const ratio = Math.max(1, this.players / populated);
      if (ratio >= 2 || ratio === 1) break;
      populated--;
    }
    this.addContinents(seeds, noise, populated);
    this.fillIslandVillages();
    if (!this.islandCapitals(populated)) {
      if (!this.tightCapitals()) return false;
      this.fillIslandVillages();
    }
    this.openWaterVillages();
    this.growClimates();
    return true;
  }

  addContinents(seeds: number[], noise: number[], populated: number) {
    const caps = seeds.map(() => 0);
    this.islands = seeds.map(() => []);
    seeds.forEach((i, id) => {
      this.cont[i] = 100 + id;
      this.alt[i] = 1;
      this.terrain[i] = "field";
      this.islands[id].push(i);
    });
    const count = seeds.length;
    let target = this.total * (1 - this.s.wetness);
    if (count > 1) target *= 0.5 / count + 1;
    const capitalShare = (0.5 * target) / this.players;
    const baseShare = (target - 0.5 * target) / count;
    for (let p = 0; p < this.players; p++) caps[p % populated]++;
    const blocked = new Array<boolean>(this.total).fill(false);
    for (let id = 0; id < count; id++) {
      let attempts = 0;
      while (caps[id] * capitalShare + baseShare > this.islands[id].length && attempts < 1000) {
        attempts++;
        this.expandContinent(id, noise, blocked);
      }
    }
  }

  expandContinent(id: number, noise: number[], blocked: boolean[]): boolean {
    const w = this.n;
    const origins = this.shuffle(this.islands[id].slice());
    for (const origin of origins) {
      if (blocked[origin]) continue;
      const ox = this.x(origin);
      const oy = this.y(origin);
      const cands = this.shuffle(
        [
          [-1, 0],
          [0, -1],
          [0, 1],
          [1, 0],
        ]
          .map(([dx, dy]) => [ox + dx, oy + dy])
          .filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < w)
          .map(([x, y]) => y * w + x),
      );
      let bestScore = 0;
      let best = -1;
      for (const c of cands) {
        if (this.cont[c] !== null) continue;
        let score = noise[c] + 1;
        const e = this.edge(c);
        if (this.mapType === "continents") score += e / -5;
        else if (this.mapType === "pangea") score += -1 / e;
        for (const nb of this.area(c, 1)) {
          const other = this.cont[nb];
          if (other === null || other === 100 + id) continue;
          if (this.alt[nb] >= 0) {
            score -= this.float(0.5, 3);
            if (this.x(nb) === this.x(c) || this.y(nb) === this.y(c)) score += -10;
          } else score -= this.float(0, 0.5);
        }
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best >= 0) {
        this.cont[best] = 100 + id;
        this.alt[best] = 1;
        this.terrain[best] = "field";
        this.resource[best] = null;
        this.islands[id].push(best);
        return true;
      }
      blocked[origin] = true;
    }
    return false;
  }

  fillIslandVillages() {
    let misses = 0;
    let c = 0;
    if (!this.islands.length) return;
    while (misses < this.islands.length) {
      misses = this.addIslandVillage(c) ? 0 : misses + 1;
      c = (c + 1) % this.islands.length;
    }
  }

  addIslandVillage(id: number): boolean {
    const sites = this.islands[id].slice();
    if (sites.length < 2) return false;
    this.shuffle(sites);
    for (const forced of [false, true]) {
      for (const i of sites) {
        const ex = Math.min(this.x(i), this.n - 1 - this.x(i));
        const ey = Math.min(this.y(i), this.n - 1 - this.y(i));
        if (Math.min(ex, ey) < 1 || this.imp[i] || this.area(i, 2).some((j) => this.imp[j])) continue;
        if (forced) {
          let same = false;
          let foreign = false;
          for (const j of this.area(i, 1)) {
            if (this.alt[j] < 0) continue;
            if (this.cont[j] === this.cont[i]) same = true;
            else foreign = true;
          }
          if (!same || foreign) continue;
        } else if (isWaterT(this.terrain[i]) || Math.min(ex, ey) < 2 || ex === 3 || ey === 3) continue;
        this.setCity(i);
        return !forced;
      }
    }
    return false;
  }

  /** None (null) excludes the tile, true marks a strict site */
  capitalEligibility(i: number, radius: number): boolean | null {
    const ex = Math.min(this.x(i), this.n - 1 - this.x(i));
    const ey = Math.min(this.y(i), this.n - 1 - this.y(i));
    if (Math.min(ex, ey) < 2 || this.imp[i]) return null;
    for (const j of this.area(i, radius)) {
      if (this.imp[j] && (this.cheb(i, j) <= 2 || (this.owner[j] >= 0 && this.imp[j] === "city"))) return null;
    }
    return ex !== 3 && ey !== 3 && !isWaterT(this.terrain[i]);
  }

  emergencyCityPosition(): number | null {
    const radius = this.minCapitalDistance() - 1;
    const strict: number[] = [];
    let first: number | null = null;
    for (let i = 0; i < this.total; i++) {
      const e = this.capitalEligibility(i, radius);
      if (e === null) continue;
      if (first === null) first = i;
      if (e) strict.push(i);
    }
    if (!strict.length) return first;
    return strict[this.range(0, strict.length)];
  }

  reserveIslandCapital(id: number | null, player: number, sites: number[]): boolean {
    const minimum = this.minCapitalDistance();
    let best: number | null = null;
    let bestScore = 0;
    for (const c of id === null ? [] : this.islands[id] ?? []) {
      if (this.owner[c] >= 0 || !this.isCity(c)) continue;
      const distance = sites.reduce((m, o) => Math.min(m, this.cheb(c, o)), 20);
      if (distance < minimum) continue;
      if (this.edge(c) <= 1) continue;
      const water = this.area(c, 1).filter((j) => isWaterT(this.terrain[j])).length;
      const score = distance + (water >= 2 && water <= 6 ? 1 : 0);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    const site = best ?? this.emergencyCityPosition();
    if (site === null) return false;
    this.setCity(site);
    this.owner[site] = player;
    sites.push(site);
    return true;
  }

  islandCapitals(populated: number): boolean {
    const sites: number[] = [];
    for (let p = 0; p < this.players; p++) if (!this.reserveIslandCapital(p % populated, p, sites)) return false;
    for (const original of sites.slice()) {
      const c = this.cont[original];
      if (c === null) continue;
      const id = this.owner[original];
      this.owner[original] = -1;
      sites.splice(sites.indexOf(original), 1);
      if (!this.reserveIslandCapital(c - 100, id, sites)) return false;
    }
    this.finalizeCapitals(sites);
    return true;
  }

  finalizeCapitals(sites: number[]) {
    const owners = sites.map((i) => this.owner[i]);
    sites.forEach((i) => (this.owner[i] = -1));
    sites.forEach((i, k) => this.setCapital(owners[k], i));
  }

  tightCapitals(): boolean {
    const radius = this.minCapitalDistance() - 1;
    this.imp.fill(null);
    this.owner.fill(-1);
    let index = 0;
    const sites: number[] = [];
    for (let p = 0; p < this.players; p++) {
      while (index < this.total && this.capitalEligibility(index, radius) !== true) index++;
      if (index >= this.total) return false;
      this.setCity(index);
      this.owner[index] = p;
      sites.push(index);
    }
    this.finalizeCapitals(sites);
    return true;
  }

  openWaterVillages() {
    const target = Math.floor((this.s.wetness * this.total) / 50);
    const order = this.shuffle(Array.from({ length: this.total }, (_, i) => i));
    let placed = 0;
    for (const i of order) {
      if (this.imp[i] || !isWaterT(this.terrain[i]) || this.edge(i) <= 0) continue;
      if (this.area(i, 1).some((j) => !isWaterT(this.terrain[j]))) continue;
      if (this.area(i, 2).some((j) => this.isCity(j))) continue;
      this.setCity(i);
      placed++;
      if (placed >= target) break;
    }
  }

  // ---- climates, terrain, resources (mapgen_candidate.rs) ----
  growClimates() {
    const P = this.players;
    const alien = (p: number) => !!this.opts.polaris?.[p];
    const fallback = Array.from({ length: P }, (_, p) => alien(p)).every(Boolean);
    this.climates = [];
    for (let p = 0; p < P; p++) {
      const m = this.mods[p] ?? {};
      const c: Climate = {
        player: p,
        tiles: [this.capital[p]],
        field: modify(TERRAIN_WEIGHTS.field, m.field),
        mountain: modify(TERRAIN_WEIGHTS.mountain, m.mountain),
        forest: modify(TERRAIN_WEIGHTS.forest, m.forest),
        chance: {
          animal: modify(RESOURCE_CHANCES.animal, m.animal),
          crop: modify(RESOURCE_CHANCES.crop, m.crop),
          fish: modify(RESOURCE_CHANCES.fish, m.fish),
          metal: modify(RESOURCE_CHANCES.metal, m.metal),
          fruit: modify(RESOURCE_CHANCES.fruit, m.fruit),
          spores: modify(RESOURCE_CHANCES.spores, m.spores),
          aquaCrop: modify(0.3, m.aquaCrop),
        },
      };
      if (this.s.wetness === 0) c.chance.fish = 0;
      this.climates.push(c);
    }
    // island continents the climates do not reach keep the default climate
    for (let i = 0; i < this.total; i++) if (this.cont[i] !== null && this.cont[i]! >= 100) this.cont[i] = DEFAULT_CLIMATE;
    let assigned = P;
    let budget = this.total * 10;
    let id = 0;
    while (assigned < this.total && budget > 0) {
      const c = this.climates[id];
      if (!c.tiles.length || (alien(id) && !fallback)) budget--;
      else {
        const src = this.range(0, c.tiles.length);
        const origin = c.tiles[src];
        const around = this.area(origin, 1);
        let cands = around.filter((i) => this.climKey[i] === "" && this.alt[i] >= 0);
        if (!cands.length) cands = around.filter((i) => this.climKey[i] === "");
        if (!cands.length) {
          c.tiles.splice(origin === c.tiles[0] ? 0 : src, 1);
          budget--;
          continue;
        }
        const chosen = cands[this.range(0, cands.length)];
        this.climKey[chosen] = fallback ? "imperius" : this.key(id);
        this.cont[chosen] = id;
        if (this.alt[chosen] >= 0) {
          this.alt[chosen] = 1;
          this.terrain[chosen] = "field";
          this.resource[chosen] = null;
        }
        c.tiles.push(chosen);
        assigned++;
      }
      id = (id + 1) % P;
    }
  }

  assignTerrain() {
    this.climates.forEach((c, id) => {
      const tiles: number[] = [];
      let land = 0;
      for (let i = 0; i < this.total; i++) {
        if (this.cont[i] !== id) continue;
        tiles.push(i);
        if (!isWaterT(this.terrain[i]) && !this.imp[i]) land++;
      }
      const total = c.forest + c.field + c.mountain;
      const counts = [c.field, c.mountain, c.forest].map((wt) => {
        const q = (wt / total) * land;
        return q > 0 ? Math.ceil(q) : 0;
      });
      for (const i of tiles) {
        if (isWaterT(this.terrain[i]) || this.imp[i]) continue;
        this.resource[i] = null;
        const remaining = counts[0] + counts[1] + counts[2];
        if (remaining === 0) break;
        const pick = this.range(0, remaining);
        const g = pick < counts[0] ? 0 : pick < counts[0] + counts[1] ? 1 : 2;
        counts[g]--;
        this.terrain[i] = (["field", "mountain", "forest"] as const)[g];
        this.alt[i] = g === 1 ? 2 : 1;
      }
    });
  }

  makeOcean() {
    const w = this.n;
    const water = (i: number) => isWaterT(this.terrain[i]);
    const next = this.terrain.slice();
    for (let i = 0; i < this.total; i++) {
      if (!water(i)) continue;
      const nearLand =
        (i + w < this.total && !water(i + w)) ||
        (i >= w && !water(i - w)) ||
        (i % w !== 0 && !water(i - 1)) ||
        ((i % w) + 1 < w && !water(i + 1));
      next[i] = nearLand ? "water" : "ocean";
    }
    this.terrain = next;
  }

  corners() {
    const m = this.n - 1;
    return [m * this.n + m, 0, m * this.n, m];
  }

  lighthouses() {
    for (const i of this.corners()) {
      this.imp[i] = "lighthouse";
      if (!isWaterT(this.terrain[i])) this.terrain[i] = "field";
    }
  }

  chanceAt(i: number): Climate["chance"] {
    const c = this.cont[i];
    if (c !== null && c >= 0) return this.climates[c].chance;
    return { ...RESOURCE_CHANCES };
  }

  addResource(i: number) {
    if (this.imp[i]) return;
    const chance = this.chanceAt(i);
    const t = this.terrain[i];
    const passed: ResourceId[] = [];
    for (const [kind, terrains] of KINDS) {
      const p = chance[kind];
      if (p === 0 || !(this.rng.next() <= p)) continue;
      if (terrains.includes(t)) passed.push(kind);
    }
    if (!passed.length) return;
    this.resource[i] = passed[this.range(0, passed.length)];
  }

  resources() {
    const cities: number[] = [];
    for (let i = 0; i < this.total; i++) if (this.isCity(i)) cities.push(i);
    const visited = new Array<boolean>(this.total).fill(false);
    const richness = this.s.richness;
    for (const c of cities)
      for (const i of this.area(c, 1)) {
        if (this.rng.next() < richness && !visited[i] && this.resource[i] === null && !this.imp[i]) this.addResource(i);
        visited[i] = true;
      }
    for (const c of cities)
      for (const i of this.area(c, 2)) {
        if (!this.imp[i] && this.rng.next() < richness / 3 && !visited[i] && this.resource[i] === null) this.addResource(i);
        visited[i] = true;
      }
  }

  startingResources(p: number, wanted: ResourceId[]) {
    const requests = wanted.slice();
    if (!requests.length) return;
    let cands = this.shuffle(this.area(this.capital[p], 1));
    cands = cands.filter((i) => {
      const k = this.resource[i] === null ? -1 : requests.indexOf(this.resource[i]!);
      if (k >= 0) {
        requests.splice(k, 1);
        return false;
      }
      return true;
    });
    const placements: [number, Terrain, ResourceId][] = [];
    for (let pass = 0; pass < 3; pass++) {
      let k = 0;
      while (k < requests.length) {
        const kind = requests[k];
        const choices = TERRAINS_OF[kind] ?? ["field"];
        const terrain = choices[this.range(0, choices.length)];
        const at = cands.findIndex((i) =>
          pass === 0 ? this.terrain[i] === terrain : pass === 1 ? !isWaterT(this.terrain[i]) : true,
        );
        if (at >= 0) placements.push([cands.splice(at, 1)[0], terrain, requests.splice(k, 1)[0]]);
        else k++;
      }
    }
    for (const [i, terrain, kind] of placements) {
      this.terrain[i] = terrain;
      this.resource[i] = kind;
    }
  }

  ruins(amount: number) {
    const order = this.shuffle(Array.from({ length: this.total }, (_, i) => i));
    const corners = this.corners();
    let placed = 0;
    let water = 0;
    for (const i of order) {
      const wet = isWaterT(this.terrain[i]);
      if (corners.includes(i) || (wet && water > amount)) continue;
      if (wet && (this.owner[i] >= 0 || this.terrain[i] !== "ocean" || this.edge(i) <= 0)) continue;
      const blocked = [...this.area(i, 2), i].some((j) => {
        if (this.imp[j] === "ruin") return true;
        if (this.imp[j] === "city") return wet || this.owner[j] >= 0 || this.cheb(i, j) <= 1;
        return false;
      });
      if (blocked) continue;
      this.imp[i] = "ruin";
      placed++;
      if (wet) water++;
      if (placed > amount) break;
    }
  }

  starfish(amount: number) {
    if (amount <= 0) return;
    let placed = 0;
    for (let k = 0; k < this.total; k++) {
      const i = this.range(0, this.total);
      if (!isWaterT(this.terrain[i]) || this.imp[i]) continue;
      if (this.area(i, 1).some((j) => this.resource[j] === "starfish" || this.isCity(j))) continue;
      this.resource[i] = "starfish";
      placed++;
      if (amount <= placed) break;
    }
  }

  draw(): GeneratedMap {
    const islands = this.mapType === "continents" || this.mapType === "pangea";
    if (!(islands && this.islandMap())) {
      if (islands) this.clear();
      this.noiseMap();
    }
    // populate
    this.assignTerrain();
    this.makeOcean();
    this.lighthouses();
    this.resources();
    const starts = this.startList();
    const ice = new Set<number>();
    const polar = new Set<number>();
    for (let p = 0; p < this.players; p++) {
      this.startingResources(p, starts[p]);
      for (const i of this.area(this.capital[p], 1)) this.climKey[i] = this.key(p);
    }
    this.makeOcean();
    const flooded = new Set<number>();
    for (let p = 0; p < this.players; p++) {
      if (!this.opts.flooded?.[p]) continue;
      const key = this.climKey[this.capital[p]];
      for (let i = 0; i < this.total; i++)
        if (this.climKey[i] === key && (this.terrain[i] === "field" || this.terrain[i] === "forest")) flooded.add(i);
    }
    this.ruins(Math.floor(this.total / 40));
    this.starfish((this.total * this.s.wetness) / 25);
    for (let p = 0; p < this.players; p++) {
      if (!this.opts.polaris?.[p]) continue;
      for (const i of [this.capital[p], ...this.area(this.capital[p], 1)]) {
        if (isWaterT(this.terrain[i])) ice.add(i);
        else if (!this.imp[i]) polar.add(i);
      }
    }
    return this.output(flooded, ice, polar);
  }

  startList(): ResourceId[][] {
    return Array.from({ length: this.players }, (_, p) => {
      if (this.opts.startResources?.[p]) return this.opts.startResources[p];
      if (this.opts.waterStart?.[p]) return ["fish", "fish"];
      if (this.opts.spores?.[p]) return ["spores", "spores"];
      return [];
    });
  }

  output(flooded: Set<number>, ice: Set<number>, polar: Set<number>): GeneratedMap {
    const capitals = new Set(this.capital);
    const tiles: Tile[] = [];
    const villages: Coord[] = [];
    for (let i = 0; i < this.total; i++) {
      let resource = this.resource[i];
      if (resource === "aquaCrop" && !this.opts.aquaCrops) resource = null;
      const village = this.imp[i] === "city" && !capitals.has(i);
      if (village) villages.push({ x: this.x(i), y: this.y(i) });
      const t: Tile = {
        terrain: this.terrain[i],
        resource,
        building: null,
        buildingLevel: 0,
        builtTurn: 0,
        road: false,
        cityId: null,
        village,
        ruin: this.imp[i] === "ruin",
        lighthouse: this.imp[i] === "lighthouse",
        territory: null,
      };
      if (flooded.has(i)) t.flooded = true;
      if (ice.has(i)) t.ice = true;
      if (polar.has(i)) t.polar = true;
      tiles.push(t);
    }
    return { tiles, capitals: this.capital.map((i) => ({ x: this.x(i), y: this.y(i) })), villages };
  }
}

/**
 * The fairness measure (polybots-engine mapgen/select.rs): every tile goes to
 * the capital that reaches it most cheaply; the result is the richest turf's
 * score over the poorest's.
 */
export function inequality(map: GeneratedMap, n: number): number {
  const seats = map.capitals.length;
  const starts = new Set(map.capitals.map((c) => c.y * n + c.x));
  const cityAt = new Set([...map.capitals, ...map.villages].map((c) => c.y * n + c.x));
  const water = map.tiles.map((t) => (t.terrain === "water" || t.terrain === "ocean") && !t.ice);
  const mountain = map.tiles.map((t) => t.terrain === "mountain");
  const turf = (i: number, cost: number) => {
    const factor = Math.min(1, Math.max(0, (cost - 3) / (n * 0.8 - 3)));
    let score: number;
    if (cityAt.has(i)) {
      const base = -90 * factor + 100 + 0.1;
      score = cost === 3 ? base + 40 : cost === 4 ? base + 20 : base;
    } else if (map.tiles[i].ruin) {
      const base = -3 * factor + 5 + 0.1;
      score = cost < 5 ? base + 5 : base;
    } else score = 0.1;
    if (!water[i]) score += 1.5 - factor;
    return score;
  };
  const scores = new Array<number>(seats).fill(0);
  const visited = new Array<boolean>(n * n).fill(false);
  // entry per tile: [cost, seat, order]
  const entry: ([number, number, number] | null)[] = new Array(n * n).fill(null);
  // binary heap of [cost, order, index]
  const heap: [number, number, number][] = [];
  const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (v: [number, number, number]) => {
    heap.push(v);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!less(heap[k], heap[p])) break;
      [heap[k], heap[p]] = [heap[p], heap[k]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]];
        k = m;
      }
    }
    return top;
  };
  let added = 0;
  const expand = (index: number, seat: number, cost: number) => {
    const cx = index % n;
    const cy = Math.floor(index / n);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const j = y * n + x;
        if (visited[j] || j === index) continue;
        const step = mountain[j]
          ? 4
          : !water[j]
            ? 1
            : water[index]
              ? 4
              : !cityAt.has(index)
                ? 1000
                : starts.has(index)
                  ? 8
                  : 16;
        const next = cost + step;
        const prev = entry[j];
        if (prev) {
          if (next < prev[0] || (next === prev[0] && seat < prev[1])) {
            if (next < prev[0]) push([next, prev[2], j]);
            prev[0] = next;
            prev[1] = seat;
          }
        } else {
          entry[j] = [next, seat, added];
          push([next, added, j]);
          added++;
        }
      }
  };
  map.capitals.forEach((c, seat) => {
    const i = c.y * n + c.x;
    visited[i] = true;
    scores[seat] = turf(i, 0);
  });
  map.capitals.forEach((c, seat) => expand(c.y * n + c.x, seat, 0));
  while (heap.length) {
    const [cost, , index] = pop();
    const e = entry[index];
    if (!e || e[0] !== cost || visited[index]) continue;
    entry[index] = null;
    visited[index] = true;
    scores[e[1]] += turf(index, cost);
    expand(index, e[1], cost);
  }
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  return hi / (lo > 0 ? lo : 0.001);
}

export function generateMap(
  rng: Rng,
  n: number,
  players: number,
  mapType: MapType = "drylands",
  /** per-player tribe modifiers (terrain: field/mountain/forest; resources: fruit/crop/animal/fish/metal/spores/aquaCrop) */
  mods: Partial<Record<string, number>>[] = [],
  opts: MapOptions = {},
): GeneratedMap {
  const settings = MAP_SETTINGS[mapType];
  const effMods = Array.from({ length: players }, (_, p) => {
    const m = { ...(mods[p] ?? {}) };
    // shorthand: Cymanti spawns (2.18 data: spores 0.3, crop 0)
    if (opts.spores?.[p]) {
      m.spores ??= 0.3;
      m.crop ??= 0;
    }
    return m;
  });
  const candidates = Math.max(1, opts.candidates ?? settings.equalityIterations);
  let best: GeneratedMap | null = null;
  let bestScore = Infinity;
  for (let k = 0; k < candidates; k++) {
    const seed = Math.floor(rng.next() * 0x7fffffff);
    const map = new Gen(createRng(seed), n, players, settings, mapType, effMods, opts).draw();
    if (candidates === 1) return map;
    const score = inequality(map, n);
    if (score < bestScore) {
      best = map;
      bestScore = score;
    }
    if (score < settings.equalityLimit) return map;
  }
  return best!;
}
