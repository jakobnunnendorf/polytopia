/**
 * Aquarion rules and tribe spawn multipliers (POLYTOPIA_RULES.md: Aquarion
 * units, Tribes > Aquarion, Unit skills, Movement rules, Tribes table).
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { CLAN_BY_ID, UNITS, buildAllowedFor, trainableUnitsFor } from "@/logic/engine/data";
import { dist } from "@/logic/engine/grid";
import { generateMap } from "@/logic/engine/mapgen";
import { reachable } from "@/logic/engine/movement";
import { createRng } from "@/logic/engine/rng";
import { claimTerritory, createGame, makeUnit, newCity, resourceVisible, updateConnections } from "@/logic/engine/state";
import type { Coord, GameState, Terrain, Tile, Unit } from "@/logic/engine/types";

/* ---------- a blank 11×11 world: two cities in the corners, no units ---------- */

function world(clans: string[], techs: string[][] = [[], []]): GameState {
  const s = createGame({ mapSize: 11, players: 2, mode: "domination", seed: 5, clans });
  for (const t of s.tiles) {
    Object.assign(t, {
      terrain: "field", resource: null, building: null, buildingLevel: 0, road: false, cityId: null,
      village: false, ruin: false, lighthouse: false, territory: null, flooded: false, ice: false, algae: false,
      lostCity: false,
    });
  }
  const spots = [{ x: 1, y: 1 }, { x: 9, y: 9 }];
  s.cities.forEach((c, k) => {
    c.x = spots[k].x;
    c.y = spots[k].y;
    s.tiles[c.y * 11 + c.x].cityId = c.id;
    claimTerritory(s, c, 1);
  });
  s.units = [];
  for (const p of s.players) {
    p.explored.fill(1);
    p.techs = techs[p.id] ?? [];
    p.stars = 100;
  }
  return s;
}

const tile = (s: GameState, x: number, y: number) => s.tiles[y * s.mapSize + x];
function set(s: GameState, x: number, y: number, terrain: Terrain, extra: Partial<Tile> = {}) {
  Object.assign(tile(s, x, y), { terrain, ...extra });
}
function put(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  u.done = false;
  u.canMove = true;
  u.canAttack = true;
  return u;
}
const canReach = (s: GameState, u: Unit, x: number, y: number) => reachable(s, u).some((m) => m.x === x && m.y === y);
const unit = (s: GameState, id: number) => s.units.find((u) => u.id === id);

/* ---------- units and tech replacements ---------- */

describe("Aquarion units (rules doc, Aquarion units table)", () => {
  it.each([
    ["mermaidArcher", 3, 10, 2, 1, 1, 2, ["dash", "fortify", "amphibious"], "archery"],
    ["mermaidDefender", 3, 15, 1, 3, 1, 1, ["fortify", "amphibious"], "strategy"],
    ["swordsmaid", 5, 15, 3, 3, 1, 1, ["dash", "amphibious"], "smithery"],
    ["siren", 8, 10, 0, 1, 1, 1, ["heal", "convert", "amphibious", "stiff"], "philosophy"],
    ["scuba", 8, 5, 0, 0.5, 2, 1, ["hide", "infiltrate", "dash", "scout", "creep", "stiff", "static", "amphibious"], "diplomacy"],
    ["jelly", 8, 20, 2, 2, 2, 1, ["tentacles", "water", "stiff", "static"], "navigation"],
    ["puffer", 8, 10, 4, 0, 2, 3, ["drench", "water", "stiff"], "mathematics"],
    ["crab", 10, 40, 4, 4, 1, 1, ["escape", "static", "amphibious", "autoFlood"], null],
  ] as const)("%s", (id, cost, hp, atk, def, mov, range, skills, tech) => {
    const d = UNITS[id];
    expect([d.cost, d.hp, d.attack, d.defence, d.movement, d.range, d.tech]).toEqual([cost, hp, atk, def, mov, range, tech]);
    expect([...d.skills].sort()).toEqual([...skills].sort());
  });

  it("every Aquarion land unit is amphibious and replaces the regular one", () => {
    const ids = trainableUnitsFor("aquarion").map((u) => u.id);
    for (const gone of ["warrior", "rider", "archer", "defender", "swordsman", "mindBender", "catapult", "knight", "cloak"])
      expect(ids).not.toContain(gone);
    for (const id of ["mermaid", "amphibian", "mermaidArcher", "mermaidDefender", "swordsmaid", "siren", "scuba", "puffer", "tridention", "shark", "jelly"])
      expect(ids).toContain(id);
    for (const def of trainableUnitsFor("aquarion")) {
      if (!def.naval) expect(def.skills).toContain("amphibious");
    }
    expect(trainableUnitsFor("romans").map((u) => u.id)).not.toContain("swordsmaid");
  });

  it("no roads, bridges or Burn Forest for Aquarion; Atoll, Fertilize, Flood and Aqua Farm instead; Landfill for the others", () => {
    for (const b of ["road", "bridge", "burnForest", "landfill"]) expect(buildAllowedFor("aquarion", b)).toBe(false);
    for (const b of ["atoll", "fertilize", "flood", "aquaFarm"]) expect(buildAllowedFor("aquarion", b)).toBe(true);
    expect(buildAllowedFor("romans", "landfill")).toBe(true);
    for (const b of ["atoll", "fertilize", "flood", "aquaFarm"]) expect(buildAllowedFor("romans", b)).toBe(false);
  });
});

/* ---------- movement ---------- */

describe("Aquarion movement", () => {
  it("amphibious units stop on dry land and get no road bonus", () => {
    const s = world(["aquarion", "romans"], [["riding"], []]);
    for (let x = 2; x <= 8; x++) tile(s, x, 5).road = true;
    const a = put(s, "amphibian", 0, 4, 5);
    expect(canReach(s, a, 5, 5)).toBe(true);
    expect(canReach(s, a, 6, 5)).toBe(false);
    // over flooded land it keeps going
    set(s, 5, 5, "field", { flooded: true });
    expect(canReach(s, a, 6, 5)).toBe(true);
  });

  it("Riding gives shallow water, Free Spirit (Free Diving) ocean", () => {
    const s = world(["aquarion", "romans"]);
    set(s, 6, 5, "water");
    set(s, 6, 6, "ocean");
    const m = put(s, "mermaid", 0, 5, 5);
    expect(canReach(s, m, 6, 5)).toBe(false);
    s.players[0].techs = ["riding"];
    expect(canReach(s, m, 6, 5)).toBe(true);
    expect(canReach(s, m, 6, 6)).toBe(false);
    s.players[0].techs = ["riding", "freeSpirit"];
    expect(canReach(s, m, 6, 6)).toBe(true);
  });

  it("ships may enter flooded tiles but stop there; never dry land", () => {
    const s = world(["aquarion", "romans"], [["sailing"], []]);
    set(s, 5, 5, "water");
    set(s, 6, 5, "field", { flooded: true });
    set(s, 7, 5, "field", { flooded: true });
    const shark = put(s, "shark", 0, 5, 5);
    expect(canReach(s, shark, 6, 5)).toBe(true);
    expect(canReach(s, shark, 7, 5)).toBe(false);
    expect(canReach(s, shark, 5, 6)).toBe(false);
  });

  it("Bubbles: +1 movement after entering a flooded tile (with Waterways), lost on dry land or when attacked", () => {
    const s = world(["aquarion", "romans"], [["riding", "roads"], []]);
    for (let x = 4; x <= 9; x++) set(s, x, 5, "field", { flooded: true });
    const a = put(s, "amphibian", 0, 3, 5);
    let next = applyAction(s, { type: "move", unitId: a.id, to: { x: 4, y: 5 } });
    const b = unit(next, a.id)!;
    expect(b.bubble).toBe(true);
    Object.assign(b, { done: false, canMove: true, moved: false });
    expect(canReach(next, b, 7, 5)).toBe(true);
    expect(canReach(next, b, 8, 5)).toBe(false);
    next = applyAction(next, { type: "move", unitId: a.id, to: { x: 4, y: 6 } });
    expect(unit(next, a.id)!.bubble).toBe(false);
    // being attacked pops it
    const s2 = world(["aquarion", "romans"], [["riding", "roads"], []]);
    const v = put(s2, "amphibian", 0, 5, 5);
    v.bubble = true;
    s2.current = 1;
    const w = put(s2, "warrior", 1, 6, 5);
    const after = applyAction(s2, { type: "attack", unitId: w.id, targetId: v.id });
    expect(unit(after, v.id)!.bubble).toBe(false);
  });
});

/* ---------- flooding skills, Tentacles ---------- */

describe("Auto Flood, Drench and Tentacles", () => {
  it("the Crab floods each tile it moves onto", () => {
    const s = world(["aquarion", "romans"]);
    const c = put(s, "crab", 0, 5, 5);
    const next = applyAction(s, { type: "move", unitId: c.id, to: { x: 6, y: 5 } });
    expect(tile(next, 6, 5).flooded).toBe(true);
  });

  it("the Puffer floods the tile it attacks", () => {
    const s = world(["aquarion", "romans"], [["mathematics"], []]);
    set(s, 4, 5, "water");
    const p = put(s, "puffer", 0, 4, 5);
    const e = put(s, "defender", 1, 6, 5);
    const next = applyAction(s, { type: "attack", unitId: p.id, targetId: e.id });
    expect(tile(next, 6, 5).flooded).toBe(true);
  });

  it("a Jelly damages enemies it moves next to, and enemies that move next to it, unless frozen", () => {
    const s = world(["aquarion", "romans"], [["navigation"], []]);
    set(s, 5, 5, "water");
    set(s, 6, 5, "water");
    const j = put(s, "jelly", 0, 5, 5);
    const e = put(s, "defender", 1, 8, 5);
    let next = applyAction(s, { type: "move", unitId: j.id, to: { x: 6, y: 5 } });
    expect(unit(next, e.id)!.hp).toBe(15); // not adjacent
    // enemy moves next to the Jelly
    next.current = 1;
    Object.assign(unit(next, e.id)!, { done: false, canMove: true, moved: false });
    next = applyAction(next, { type: "move", unitId: e.id, to: { x: 7, y: 5 } });
    expect(unit(next, e.id)!.hp).toBeLessThan(15);
    // Jelly moving next to an enemy
    const s2 = world(["aquarion", "romans"], [["navigation"], []]);
    set(s2, 5, 5, "water");
    set(s2, 6, 5, "water");
    const j2 = put(s2, "jelly", 0, 5, 5);
    const e2 = put(s2, "defender", 1, 7, 5);
    const n2 = applyAction(s2, { type: "move", unitId: j2.id, to: { x: 6, y: 5 } });
    expect(unit(n2, e2.id)!.hp).toBeLessThan(15);
    // frozen Jelly: no tentacles
    const s3 = world(["aquarion", "romans"], [["navigation"], []]);
    set(s3, 6, 5, "water");
    const j3 = put(s3, "jelly", 0, 6, 5);
    j3.frozen = true;
    s3.current = 1;
    const e3 = put(s3, "defender", 1, 8, 5);
    const n3 = applyAction(s3, { type: "move", unitId: e3.id, to: { x: 7, y: 5 } });
    expect(unit(n3, e3.id)!.hp).toBe(15);
  });
});

/* ---------- builds and connections ---------- */

describe("Aquarion builds", () => {
  const has = (s: GameState, b: string, at: Coord) =>
    legalActions(s).some((a) => a.type === "build" && a.building === b && a.at.x === at.x && a.at.y === at.y);

  it("Waterways floods own land; Fertilize grows a crop on a flooded field; others Landfill it", () => {
    const s = world(["aquarion", "romans"], [["roads", "construction"], ["construction"]]);
    expect(has(s, "flood", { x: 2, y: 1 })).toBe(true);
    expect(has(s, "fertilize", { x: 2, y: 1 })).toBe(false);
    let next = applyAction(s, { type: "build", at: { x: 2, y: 1 }, building: "flood" });
    expect(tile(next, 2, 1).flooded).toBe(true);
    next = applyAction(next, { type: "build", at: { x: 2, y: 1 }, building: "fertilize" });
    expect(tile(next, 2, 1).resource).toBe("crop");
    expect(has(s, "road", { x: 2, y: 1 })).toBe(false);
    expect(has(s, "burnForest", { x: 2, y: 1 })).toBe(false);
    // Landfill for the other tribe
    const r = world(["aquarion", "romans"], [[], ["construction"]]);
    r.current = 1;
    set(r, 8, 8, "field", { flooded: true });
    expect(has(r, "landfill", { x: 8, y: 8 })).toBe(true);
    const dry = applyAction(r, { type: "build", at: { x: 8, y: 8 }, building: "landfill" });
    expect(tile(dry, 8, 8).flooded).toBe(false);
  });

  it("ports go on flooded tiles, and land units entering one embark", () => {
    const s = world(["romans", "aquarion"], [["fishing"], []]);
    set(s, 2, 2, "field", { flooded: true });
    expect(has(s, "port", { x: 2, y: 2 })).toBe(true);
    const next = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "port" });
    const w = put(next, "warrior", 0, 2, 1);
    const moved = applyAction(next, { type: "move", unitId: w.id, to: { x: 2, y: 2 } });
    expect(unit(moved, w.id)!.type).toBe("raft");
  });

  it("Aqua Crops: only Aquarion sees them; Aqua Farm (Aquaculture) gives +2 population", () => {
    const s = world(["aquarion", "romans"], [["ramming"], []]);
    set(s, 2, 2, "water", { resource: "aquaCrop" });
    expect(resourceVisible(s, 0, "aquaCrop")).toBe(true);
    expect(resourceVisible(s, 1, "aquaCrop")).toBe(false);
    const cap = s.cities[0];
    const before = cap.pop + cap.level * 10;
    const next = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "aquaFarm" });
    const c = next.cities[0];
    expect(c.pop + c.level * 10).toBeGreaterThan(before);
    expect(tile(next, 2, 2).building).toBe("aquaFarm");
  });

  it("an Atoll links cities within 3 tiles over water", () => {
    const s = world(["aquarion", "romans"], [["ramming"], []]);
    const c2 = newCity(s, { x: 5, y: 1 }, 0);
    claimTerritory(s, c2, 1);
    set(s, 3, 1, "water");
    updateConnections(s, 0);
    expect(s.cities.find((c) => c.id === c2.id)!.connected).toBe(false);
    expect(has(s, "atoll", { x: 2, y: 2 })).toBe(false); // field
    set(s, 2, 2, "water");
    const next = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "atoll" });
    expect(next.cities.find((c) => c.id === c2.id)!.connected).toBe(true);
  });
});

/* ---------- Lost City ---------- */

describe("Lost City ruin reward", () => {
  it("an Aquarion ocean ruin can become a capturable level-3 walled city with 4 shallow-water tiles", () => {
    let found: GameState | null = null;
    let mid = 0;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const s = world(["aquarion", "romans"], [["riding", "freeSpirit"], []]);
      for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) set(s, x, y, "ocean");
      tile(s, 5, 5).ruin = true;
      const m = put(s, "mermaid", 0, 5, 5);
      mid = m.id;
      s.rng = seed;
      const next = applyAction(s, { type: "examine", unitId: m.id });
      if (next.log.some((l) => l.includes("ruin: lostCity"))) found = next;
    }
    expect(found).not.toBeNull();
    const s = found!;
    expect(tile(s, 5, 5)).toMatchObject({ terrain: "field", village: true, lostCity: true });
    for (const [x, y] of [[5, 4], [6, 5], [5, 6], [4, 5]]) expect(tile(s, x, y).terrain).toBe("water");
    expect(tile(s, 6, 6).terrain).toBe("ocean");
    const m = unit(s, mid)!;
    Object.assign(m, { done: false, moved: false, attacked: false, canMove: true });
    const after = applyAction(s, { type: "capture", unitId: m.id });
    const city = after.cities.find((c) => c.x === 5 && c.y === 5)!;
    expect(city.level).toBe(3);
    expect(city.walls).toBe(true);
  });

  it("other tribes never get it", () => {
    for (let seed = 1; seed < 100; seed++) {
      const s = world(["romans", "aquarion"], [["sailing"], []]);
      set(s, 5, 5, "ocean", { ruin: true });
      const b = put(s, "scout", 0, 5, 5);
      b.carried = "warrior";
      s.rng = seed;
      const next = applyAction(s, { type: "examine", unitId: b.id });
      expect(next.log.some((l) => l.includes("ruin: lostCity"))).toBe(false);
    }
  });
});

/* ---------- spawn multipliers and map generation ---------- */

describe("tribe spawn modifiers (2.18 data; map generation in parity-218-mapgen.test.ts)", () => {
  it("clan mods equal the 2.18 data", () => {
    expect(CLAN_BY_ID.polynesians.mod).toEqual({ water: 2, fish: 1.5, mountain: 0.5 });
    expect(CLAN_BY_ID.aquarion.mod).toEqual({ forest: 0.5, crop: 0.5, aquaCrop: 1.5 });
    expect(CLAN_BY_ID.polaris.mod).toEqual({});
    expect(CLAN_BY_ID.cymanti.mod).toEqual({ mountain: 1.2, spores: 0.3, crop: 0 });
    expect(CLAN_BY_ID.norse.mod).toEqual({ forest: 0.8, crop: 0 });
    expect(CLAN_BY_ID.aquarion.startResources).toEqual(["fish", "fish"]);
    expect(CLAN_BY_ID.cymanti.startResources).toEqual(["spores", "spores"]);
  });

  it("Kickoo and Aquarion capitals get 2 fish next to them on every map type", () => {
    for (const type of ["drylands", "lakes", "continents", "archipelago"] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        const m = generateMap(createRng(seed), 16, 2, type, [{}, {}], { waterStart: [true, false] });
        const c = m.capitals[0];
        const fish = m.tiles.filter((t, i) => t.resource === "fish" && dist(c, { x: i % 16, y: Math.floor(i / 16) }) === 1);
        expect(fish.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("Aqua Crops only when Aquarion plays", () => {
    const opts = { flooded: [true, false, false, false], aquaCrops: true };
    const m = generateMap(createRng(4), 16, 4, "lakes", [{ aquaCrop: 1.5 }, {}, {}, {}], opts);
    expect(m.tiles.some((t) => t.resource === "aquaCrop")).toBe(true);
    const plain = generateMap(createRng(4), 16, 4, "lakes");
    expect(plain.tiles.some((t) => t.resource === "aquaCrop" || t.flooded)).toBe(false);
  });

  it("createGame wires the Aquarion and Cymanti map options", () => {
    const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed: 9, clans: ["aquarion", "cymanti"] });
    expect(s.tiles.some((t) => t.flooded)).toBe(true);
    const cap = s.cities.find((c) => c.owner === 1)!;
    const spores = s.tiles.filter((t, i) => t.resource === "spores" && dist(cap, { x: i % 16, y: Math.floor(i / 16) }) === 1);
    expect(spores.length).toBeGreaterThanOrEqual(2);
  });
});

/* ---------- Scuba infiltration ---------- */

describe("Scuba", () => {
  it("infiltrating spawns amphibious Mermaid Daggers", () => {
    const s = world(["aquarion", "romans"], [["diplomacy"], []]);
    const sc = put(s, "scuba", 0, 8, 8);
    const city = s.cities[1];
    const next = applyAction(s, { type: "infiltrate", unitId: sc.id, cityId: city.id });
    const daggers = next.units.filter((u) => u.owner === 0);
    expect(daggers.length).toBeGreaterThan(0);
    expect(daggers.every((u) => u.type === "mermaidDagger")).toBe(true);
  });
});
