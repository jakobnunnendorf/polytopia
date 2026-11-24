import { createRng } from "@/logic/engine/rng";
import { generateMap, ruinCount, type MapType } from "@/logic/engine/mapgen";
import { dist } from "@/logic/engine/grid";
import { spawnCapitals } from "@/logic/spawn";

describe("map generation", () => {
  it("is deterministic for a seed", () => {
    const a = generateMap(createRng(42), 16, 4, "lakes");
    const b = generateMap(createRng(42), 16, 4, "lakes");
    expect(a).toEqual(b);
    const c = generateMap(createRng(43), 16, 4, "lakes");
    expect(c).not.toEqual(a);
  });

  it.each<[number, number, MapType]>([
    [11, 2, "drylands"],
    [14, 3, "lakes"],
    [16, 4, "continents"],
    [18, 5, "pangea"],
    [20, 9, "archipelago"],
    [30, 16, "waterworld"],
  ])("size %i, %i players, %s: capitals on land fields, spaced settlements", (n, players, type) => {
    for (let seed = 1; seed <= 5; seed++) {
      const m = generateMap(createRng(seed), n, players, type);
      expect(m.capitals).toHaveLength(players);
      for (const c of m.capitals) {
        expect(m.tiles[c.y * n + c.x].terrain).toBe("field");
      }
      const all = [...m.capitals, ...m.villages];
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) expect(dist(all[i], all[j])).toBeGreaterThanOrEqual(2);
      for (const v of m.villages) {
        expect(dist(v, v)).toBe(0);
        for (const c of all) if (c !== v) expect(dist(c, v)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses the 2.18 land split field 0.5 : mountain 0.15 : forest 0.4 on drylands", () => {
    const n = 30;
    const m = generateMap(createRng(7), n, 4, "drylands");
    const land = m.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "ocean");
    const share = (k: string) => land.filter((t) => t.terrain === k).length / land.length;
    expect(share("mountain")).toBeCloseTo(0.15 / 1.05, 1);
    expect(share("forest")).toBeCloseTo(0.4 / 1.05, 1);
    expect(share("field")).toBeCloseTo(0.5 / 1.05, 1);
  });

  it("puts resources only within 2 tiles of a settlement (except starfish)", () => {
    const n = 18;
    const m = generateMap(createRng(9), n, 4, "lakes");
    const all = [...m.capitals, ...m.villages];
    m.tiles.forEach((t, i) => {
      if (!t.resource || t.resource === "starfish") return;
      const p = { x: i % n, y: Math.floor(i / n) };
      expect(Math.min(...all.map((c) => dist(c, p)))).toBeLessThanOrEqual(2);
    });
  });

  it("places the wiki ruin count", () => {
    expect(ruinCount(11)).toBe(4);
    expect(ruinCount(16)).toBe(7);
    expect(ruinCount(30)).toBe(23);
    const m = generateMap(createRng(3), 16, 2, "drylands");
    expect(m.tiles.filter((t) => t.ruin).length).toBe(7);
  });
});

describe("spawnCapitals", () => {
  it("works for player counts that are not perfect squares", () => {
    for (const players of [2, 3, 5, 7, 10]) {
      const caps = spawnCapitals({ players, mapSize: 20, rng: createRng(players) });
      expect(caps).toHaveLength(players);
      const keys = new Set(caps.map((c) => `${c.x},${c.y}`));
      expect(keys.size).toBe(players);
    }
  });
});
