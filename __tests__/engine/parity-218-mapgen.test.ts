/**
 * Map generation parity with Polytopia 2.18 (algorithm from polybots-engine,
 * Apache-2.0). Our random generator differs from the game's, so these tests
 * check the rules and the distributions, not exact maps.
 */
import { CLAN_BY_ID } from "@/logic/engine/data";
import { dist } from "@/logic/engine/grid";
import { generateMap, inequality, MAP_SETTINGS, ruinCount, WETNESS, type MapType } from "@/logic/engine/mapgen";
import { createRng } from "@/logic/engine/rng";
import { createGame } from "@/logic/engine/state";
import type { Coord } from "@/logic/engine/types";

const at = (n: number, i: number): Coord => ({ x: i % n, y: Math.floor(i / n) });
const isWater = (t: string) => t === "water" || t === "ocean";
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe("2.18 map settings", () => {
  it("wetness per map type", () => {
    expect(WETNESS).toEqual({ drylands: 0, lakes: 0.3, continents: 0.5, pangea: 0.5, archipelago: 0.65, waterworld: 0.85 });
    expect(MAP_SETTINGS.drylands).toMatchObject({ preTerrainCityDensity: 0, minSuburbs: 0, maxSuburbs: 0 });
    expect(MAP_SETTINGS.waterworld).toMatchObject({ preTerrainCityDensity: 0.1, maxSuburbs: 0 });
    expect(MAP_SETTINGS.lakes).toMatchObject({ preTerrainCityDensity: 0.3, minSuburbs: 1, maxSuburbs: 2 });
  });

  it("ruins: tiles/40 + 1", () => {
    expect([11, 14, 16, 18, 20, 30].map(ruinCount)).toEqual([4, 5, 7, 9, 11, 23]);
  });
});

describe("2.18 map generation", () => {
  it("Drylands: all land, villages within the budget, spaced and off the edge", () => {
    const n = 16;
    let villages = 0;
    for (const seed of SEEDS) {
      const m = generateMap(createRng(seed), n, 4, "drylands", [], { candidates: 1 });
      expect(m.tiles.every((t) => !isWater(t.terrain))).toBe(true);
      // floor(0.33 * 16)^2 - 4 = 21
      expect(m.villages.length).toBeLessThanOrEqual(21);
      const all = [...m.capitals, ...m.villages];
      for (const v of m.villages) {
        expect(v.x >= 1 && v.y >= 1 && v.x <= n - 2 && v.y <= n - 2).toBe(true);
        for (const c of all) if (c !== v) expect(dist(c, v)).toBeGreaterThanOrEqual(3);
      }
      villages += m.villages.length;
    }
    const mean = villages / SEEDS.length;
    expect(mean).toBeGreaterThanOrEqual(11);
    expect(mean).toBeLessThanOrEqual(17);
  });

  it("water share follows the wetness quantile", () => {
    const n = 16;
    for (const type of ["lakes", "archipelago", "waterworld", "continents", "pangea"] as MapType[]) {
      let water = 0;
      for (const seed of SEEDS) {
        const m = generateMap(createRng(seed), n, 4, type, [], { candidates: 1 });
        water += m.tiles.filter((t) => isWater(t.terrain)).length;
      }
      const share = water / SEEDS.length / (n * n);
      // forced land (cities, corridors) only lowers it
      expect(share).toBeLessThanOrEqual(WETNESS[type] + 0.03);
      expect(share).toBeGreaterThanOrEqual(WETNESS[type] - 0.12);
    }
  });

  it("resources: the inner ring always rolls, ring 2 at a third, nothing further out", () => {
    const n = 16;
    const ring = { 1: [0, 0], 2: [0, 0] } as Record<1 | 2, [number, number]>;
    for (const seed of SEEDS) {
      const m = generateMap(createRng(seed), n, 4, "drylands", [], { candidates: 1 });
      const all = [...m.capitals, ...m.villages];
      m.tiles.forEach((t, i) => {
        if (t.village || t.lighthouse || all.some((c) => c.x === at(n, i).x && c.y === at(n, i).y)) return;
        const d = Math.min(...all.map((c) => dist(c, at(n, i))));
        if (d > 2) {
          expect(t.resource).toBeNull();
          return;
        }
        if (t.terrain !== "field") return;
        const r = ring[d as 1 | 2];
        r[0]++;
        if (t.resource) r[1]++;
      });
    }
    // a field passes fruit 0.5 or crop 0.5: 0.75 inner, 0.25 in ring 2
    expect(ring[1][1] / ring[1][0]).toBeGreaterThan(0.68);
    expect(ring[1][1] / ring[1][0]).toBeLessThan(0.82);
    expect(ring[2][1] / ring[2][0]).toBeGreaterThan(0.18);
    expect(ring[2][1] / ring[2][0]).toBeLessThan(0.32);
  });

  it("terrain quotas per climate follow the tribe's modifiers", () => {
    const n = 16;
    let mountains = 0;
    let land = 0;
    for (const seed of SEEDS) {
      const m = generateMap(createRng(seed), n, 2, "drylands", [{ mountain: 1.5 }, { mountain: 1.5 }], { candidates: 1 });
      const tiles = m.tiles.filter((t) => !t.village && !t.lighthouse);
      mountains += tiles.filter((t) => t.terrain === "mountain").length;
      land += tiles.length;
    }
    // 0.225 / (0.5 + 0.225 + 0.4)
    expect(mountains / land).toBeCloseTo(0.2, 1);
  });

  it("ruins: the count, never next to a village nor within 2 of a capital, water ruins only on ocean", () => {
    const n = 16;
    for (const seed of SEEDS.slice(0, 6)) {
      const m = generateMap(createRng(seed), n, 4, "lakes", [], { candidates: 1 });
      const ruins = m.tiles.map((t, i) => [t, at(n, i)] as const).filter(([t]) => t.ruin);
      expect(ruins.length).toBeLessThanOrEqual(ruinCount(n));
      expect(ruins.length).toBeGreaterThanOrEqual(ruinCount(n) - 2);
      for (const [t, p] of ruins) {
        for (const v of m.villages) expect(dist(v, p)).toBeGreaterThanOrEqual(isWater(t.terrain) ? 3 : 2);
        for (const c of m.capitals) expect(dist(c, p)).toBeGreaterThanOrEqual(3);
        if (isWater(t.terrain)) expect(t.terrain).toBe("ocean");
        for (const [, q] of ruins) if (q !== p) expect(dist(p, q)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("starfish: about wetness x tiles / 25, never next to a city; none on Drylands", () => {
    const n = 16;
    for (const seed of SEEDS.slice(0, 6)) {
      const dry = generateMap(createRng(seed), n, 4, "drylands", [], { candidates: 1 });
      expect(dry.tiles.some((t) => t.resource === "starfish")).toBe(false);
      const m = generateMap(createRng(seed), n, 4, "archipelago", [], { candidates: 1 });
      const stars = m.tiles.map((t, i) => [t, at(n, i)] as const).filter(([t]) => t.resource === "starfish");
      expect(stars.length).toBeLessThanOrEqual(Math.ceil((n * n * 0.65) / 25));
      for (const [, p] of stars) for (const c of [...m.capitals, ...m.villages]) expect(dist(c, p)).toBeGreaterThanOrEqual(2);
    }
  });

  it("Continents and Pangea: capitals far apart, on land", () => {
    const n = 16;
    for (const type of ["continents", "pangea"] as MapType[])
      for (const seed of SEEDS.slice(0, 6)) {
        const m = generateMap(createRng(seed), n, 4, type, [], { candidates: 1 });
        expect(m.capitals).toHaveLength(4);
        for (const c of m.capitals) expect(m.tiles[c.y * n + c.x].terrain).toBe("field");
        for (const a of m.capitals) for (const b of m.capitals) if (a !== b) expect(dist(a, b)).toBeGreaterThanOrEqual(3);
      }
  });

  it("the fairness pick lowers the turf inequality", () => {
    const n = 16;
    let one = 0;
    let picked = 0;
    for (const seed of SEEDS.slice(0, 6)) {
      one += inequality(generateMap(createRng(seed), n, 4, "lakes", [], { candidates: 1 }), n);
      picked += inequality(generateMap(createRng(seed), n, 4, "lakes"), n);
    }
    expect(picked).toBeLessThan(one);
  });
});

describe("2.18 tribe map features", () => {
  const ring = (n: number, c: Coord) =>
    Array.from({ length: n * n }, (_, i) => i).filter((i) => dist(c, at(n, i)) === 1);

  it("starting resources: Bardur 2 game, Luxidoor 8 resources next to the capital", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed, clans: ["norse", "lydians"] });
      const caps = [0, 1].map((p) => s.cities.find((c) => c.owner === p && c.capital)!);
      const near = (p: number, r: string) => ring(16, caps[p]).filter((i) => s.tiles[i].resource === r).length;
      expect(near(0, "animal")).toBeGreaterThanOrEqual(2);
      expect(ring(16, caps[1]).filter((i) => s.tiles[i].resource).length).toBe(8);
      for (const r of ["animal", "fruit", "fish"]) expect(near(1, r)).toBeGreaterThanOrEqual(2);
    }
  });

  it("Kickoo starts with 2 fish even on Drylands", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed, mapType: "drylands", clans: ["polynesians", "romans"] });
      const cap = s.cities.find((c) => c.owner === 0 && c.capital)!;
      const fish = ring(16, cap).filter((i) => s.tiles[i].resource === "fish" && s.tiles[i].terrain === "water");
      expect(fish.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("Aquarion: its home climate's fields and forests start flooded, never mountains or water", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed, clans: ["aquarion", "romans"] });
      const cap = s.cities.find((c) => c.owner === 0 && c.capital)!;
      const other = s.cities.find((c) => c.owner === 1 && c.capital)!;
      const flooded = s.tiles.map((t, i) => [t, at(16, i)] as const).filter(([t]) => t.flooded);
      expect(flooded.length).toBeGreaterThan(20);
      for (const [t] of flooded) expect(["field", "forest"]).toContain(t.terrain);
      // the capital and its dry neighbours are in the home climate
      expect(s.tiles[cap.y * 16 + cap.x].flooded).toBe(true);
      for (const i of ring(16, cap)) if (["field", "forest"].includes(s.tiles[i].terrain)) expect(s.tiles[i].flooded).toBe(true);
      for (const i of ring(16, other)) expect(s.tiles[i].flooded).toBeFalsy();
    }
  });

  it("Cymanti: 2 starting spores; no spores without Cymanti", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed, clans: ["cymanti", "romans"] });
      const cap = s.cities.find((c) => c.owner === 0 && c.capital)!;
      expect(ring(16, cap).filter((i) => s.tiles[i].resource === "spores").length).toBeGreaterThanOrEqual(2);
      const plain = createGame({ mapSize: 16, players: 2, mode: "domination", seed, clans: ["romans", "norse"] });
      expect(plain.tiles.some((t) => t.resource === "spores")).toBe(false);
    }
    expect(CLAN_BY_ID.cymanti.mod).toMatchObject({ spores: 0.3, crop: 0 });
  });

  it("Polaris: the water next to its capital is ice, its dry neighbours Polaris land", () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed, mapType: "archipelago", clans: ["polaris", "romans"] });
      const cap = s.cities.find((c) => c.owner === 0 && c.capital)!;
      for (const i of ring(16, cap)) {
        const t = s.tiles[i];
        if (isWater(t.terrain)) expect(t.ice).toBe(true);
        else expect(t.polar).toBe(true);
      }
    }
  });
});
