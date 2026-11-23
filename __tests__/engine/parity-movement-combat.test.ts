/**
 * Parity tests for generic movement, combat and healing against POLYTOPIA_RULES.md
 * ("Unit skills and movement", "Combat", "Explorer") and docs/RULES_PARITY.md.
 */
import { applyAction, legalActions, runExplorer } from "@/logic/engine/actions";
import { EXPLORER_STEPS, UNITS } from "@/logic/engine/data";
import { idx } from "@/logic/engine/grid";
import { reachable } from "@/logic/engine/movement";
import { claimTerritory, createGame, makeUnit, pushUnit } from "@/logic/engine/state";
import type { Action, GameState, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12x12 open field map, all explored, two cities in opposite corners, no units */
function blank(): GameState {
  const s = createGame({ mapSize: N, players: 2, mode: "domination", seed: 3, clans: ["romans", "romans"] });
  for (const t of s.tiles) {
    Object.assign(t, {
      terrain: "field",
      resource: null,
      building: null,
      buildingLevel: 0,
      road: false,
      cityId: null,
      village: false,
      ruin: false,
      lighthouse: false,
      territory: null,
      ice: false,
      algae: false,
    });
  }
  s.cities = s.cities.slice(0, 2);
  const corners = [
    { x: 0, y: 0 },
    { x: N - 1, y: N - 1 },
  ];
  s.cities.forEach((c, i) => {
    c.x = corners[i].x;
    c.y = corners[i].y;
    s.tiles[idx(N, c.x, c.y)].cityId = c.id;
    claimTerritory(s, c, 1);
  });
  for (const pl of s.players) pl.explored = new Array(N * N).fill(1);
  s.units = [];
  s.current = 0;
  return s;
}

function put(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  u.canMove = true;
  u.canAttack = true;
  u.done = false;
  return u;
}

const tile = (s: GameState, x: number, y: number) => s.tiles[idx(N, x, y)];
const reach = (s: GameState, u: Unit, x: number, y: number) => reachable(s, u).some((m) => m.x === x && m.y === y);
const find = (s: GameState, pred: (a: Action) => boolean) => legalActions(s).find(pred);
const unit = (s: GameState, id: number) => s.units.find((u) => u.id === id)!;

// test-only unit types isolating one generic skill each
const base = { cost: 0, trainable: false, hp: 10, attack: 2, defence: 2, movement: 3, range: 1, tech: null, naval: false };
beforeAll(() => {
  Object.assign(UNITS, {
    tCreep: { ...base, id: "tCreep", skills: ["creep"] },
    tFly: { ...base, id: "tFly", skills: ["fly"] },
    tSneak: { ...base, id: "tSneak", skills: ["sneak"] },
    tHide: { ...base, id: "tHide", skills: ["hide"] },
    tPlain: { ...base, id: "tPlain", skills: [] },
    tSplash: { ...base, id: "tSplash", range: 3, skills: ["splash", "stiff"] },
    tExplode: { ...base, id: "tExplode", skills: ["explode"] },
  });
});

describe("Escape: move, attack, move", () => {
  it("a Rider that moved and attacked may move again, but not attack again", () => {
    let s = blank();
    const r = put(s, "rider", 0, 5, 4);
    put(s, "warrior", 1, 5, 7);
    s = applyAction(s, { type: "move", unitId: r.id, to: { x: 5, y: 6 } });
    const atk = find(s, (a) => a.type === "attack" && a.unitId === r.id)!;
    expect(atk).toBeTruthy();
    s = applyAction(s, atk);
    expect(unit(s, r.id).hp).toBeGreaterThan(0);
    expect(find(s, (a) => a.type === "move" && a.unitId === r.id)).toBeTruthy();
    expect(find(s, (a) => a.type === "attack" && a.unitId === r.id)).toBeUndefined();
    const mv = find(s, (a) => a.type === "move" && a.unitId === r.id)!;
    s = applyAction(s, mv);
    expect(find(s, (a) => (a.type === "move" || a.type === "attack") && a.unitId === r.id)).toBeUndefined();
  });

  it("a unit without Escape can't move after attacking", () => {
    let s = blank();
    const w = put(s, "warrior", 0, 5, 6);
    put(s, "warrior", 1, 5, 7);
    s = applyAction(s, find(s, (a) => a.type === "attack" && a.unitId === w.id)!);
    expect(find(s, (a) => a.type === "move" && a.unitId === w.id)).toBeUndefined();
  });
});

describe("zone of control", () => {
  // enemy at (5,7); (5,8) behind it can only be reached by passing a controlled tile
  const setup = (type: string) => {
    const s = blank();
    const u = put(s, type, 0, 5, 5);
    put(s, "warrior", 1, 5, 7);
    return { s, u };
  };
  it("Creep does not ignore zone of control", () => {
    const { s, u } = setup("tCreep");
    expect(reach(s, u, 5, 8)).toBe(false);
    expect(reach(s, u, 5, 6)).toBe(true);
  });
  it("Air does not ignore zone of control", () => {
    const { s, u } = setup("tFly");
    expect(reach(s, u, 5, 8)).toBe(false);
  });
  it("a plain unit is stopped", () => {
    const { s, u } = setup("tPlain");
    expect(reach(s, u, 5, 8)).toBe(false);
  });
  it("Sneak and Hide ignore it", () => {
    const sn = setup("tSneak");
    expect(reach(sn.s, sn.u, 5, 8)).toBe(true);
    const h = setup("tHide");
    expect(reach(h.s, h.u, 5, 8)).toBe(true);
  });
  it("Infiltrate alone does not ignore it", () => {
    const s = blank();
    UNITS.tInf = { ...base, id: "tInf", skills: ["infiltrate"] } as never;
    const u = put(s, "tInf", 0, 5, 5);
    put(s, "warrior", 1, 5, 7);
    expect(reach(s, u, 5, 8)).toBe(false);
  });
});

describe("Creep and Air on terrain", () => {
  const wall = (terrain: "mountain" | "forest") => {
    const s = blank();
    for (let x = 0; x < N; x++) tile(s, x, 6).terrain = terrain;
    s.players[0].techs.push("climbing");
    return s;
  };
  it("mountains stop Creep (since 2.15)", () => {
    const s = wall("mountain");
    const u = put(s, "tCreep", 0, 5, 5);
    expect(reach(s, u, 5, 6)).toBe(true);
    expect(reach(s, u, 5, 7)).toBe(false);
  });
  it("Air ignores the mountain stop", () => {
    const s = wall("mountain");
    const u = put(s, "tFly", 0, 5, 5);
    expect(reach(s, u, 5, 7)).toBe(true);
  });
  it("forests don't stop Creep but stop a plain unit", () => {
    const s = wall("forest");
    expect(reach(s, put(s, "tCreep", 0, 5, 5), 5, 7)).toBe(true);
    const s2 = wall("forest");
    expect(reach(s2, put(s2, "tPlain", 0, 5, 5), 5, 7)).toBe(false);
  });
});

describe("healing", () => {
  it("Recover on a poisoned unit removes the poison and adds no HP", () => {
    let s = blank();
    const w = put(s, "warrior", 0, 5, 5);
    w.hp = 5;
    w.poisoned = true;
    s = applyAction(s, find(s, (a) => a.type === "recover" && a.unitId === w.id)!);
    expect(unit(s, w.id).hp).toBe(5);
    expect(unit(s, w.id).poisoned).toBe(false);
  });

  it("Recover is offered to a poisoned unit at full HP", () => {
    const s = blank();
    const w = put(s, "warrior", 0, 5, 5);
    w.poisoned = true;
    expect(find(s, (a) => a.type === "recover" && a.unitId === w.id)).toBeTruthy();
  });

  it("Recover heals 4 in own territory and 2 elsewhere", () => {
    let s = blank();
    const a = put(s, "warrior", 0, 1, 1);
    const b = put(s, "warrior", 0, 5, 5);
    a.hp = 3;
    b.hp = 3;
    s = applyAction(s, { type: "recover", unitId: a.id });
    s = applyAction(s, { type: "recover", unitId: b.id });
    expect(unit(s, a.id).hp).toBe(7);
    expect(unit(s, b.id).hp).toBe(5);
  });

  it("a Mind Bender heal cures a poisoned neighbour but restores no HP to it", () => {
    let s = blank();
    const mb = put(s, "mindBender", 0, 5, 5);
    const p = put(s, "warrior", 0, 5, 6);
    const h = put(s, "warrior", 0, 4, 5);
    p.hp = 4;
    p.poisoned = true;
    h.hp = 4;
    s = applyAction(s, find(s, (a) => a.type === "healOthers" && a.unitId === mb.id)!);
    expect(unit(s, p.id)).toMatchObject({ hp: 4, poisoned: false });
    expect(unit(s, h.id).hp).toBe(8);
  });

  it("idle units are not healed automatically at the end of the turn", () => {
    let s = blank();
    const w = put(s, "warrior", 0, 1, 1);
    w.hp = 3;
    s = applyAction(s, { type: "endTurn" });
    expect(unit(s, w.id).hp).toBe(3);
  });
});

describe("splash and explosions: half the damage, unrounded", () => {
  it("splash gives neighbours of the target half the damage, .5 possible", () => {
    let s = blank();
    const a = put(s, "tSplash", 0, 5, 3);
    const t = put(s, "warrior", 1, 5, 6);
    const n = put(s, "warrior", 1, 6, 6);
    s = applyAction(s, { type: "attack", unitId: a.id, targetId: t.id });
    // attack 2 vs warrior: 5 damage; neighbour 2.5
    expect(unit(s, t.id).hp).toBe(5);
    expect(unit(s, n.id).hp).toBe(7.5);
  });

  it("an explosion deals half its damage, unrounded", () => {
    let s = blank();
    const e = put(s, "tExplode", 0, 5, 5);
    const t = put(s, "warrior", 1, 5, 6);
    s = applyAction(s, find(s, (a) => a.type === "explode" && a.unitId === e.id)!);
    expect(unit(s, t.id).hp).toBe(7.5);
  });

  it("a unit at fractional HP dies when it reaches 0 or below", () => {
    let s = blank();
    const a = put(s, "tSplash", 0, 5, 3);
    const t = put(s, "warrior", 1, 5, 6);
    const n = put(s, "warrior", 1, 6, 6);
    n.hp = 2.5;
    s = applyAction(s, { type: "attack", unitId: a.id, targetId: t.id });
    expect(s.units.find((u) => u.id === n.id)).toBeUndefined();
  });
});

describe("pushing", () => {
  it("a friendly occupant is pushed the way it faces", () => {
    const s = blank();
    const u = put(s, "warrior", 0, 5, 5);
    u.lastDir = { x: 1, y: 0 };
    pushUnit(s, u, 0);
    expect([u.x, u.y]).toEqual([6, 5]);
  });
  it("an enemy occupant is pushed the opposite way", () => {
    const s = blank();
    const u = put(s, "warrior", 1, 5, 5);
    u.lastDir = { x: 1, y: 0 };
    pushUnit(s, u, 0);
    expect([u.x, u.y]).toEqual([4, 5]);
  });
});

describe("naval units", () => {
  it("Dinghy skills are exactly Water, Carry, Hide, Creep, Infiltrate, Stiff", () => {
    expect([...UNITS.dinghy.skills].sort()).toEqual(["carry", "creep", "hide", "infiltrate", "stiff", "water"]);
  });

  it("a Juggernaut leaving the water stomps adjacent enemies", () => {
    let s = blank();
    s.players[0].techs.push("fishing");
    tile(s, 5, 5).terrain = "water";
    const j = put(s, "juggernaut", 0, 5, 5);
    j.carried = "giant";
    const e = put(s, "warrior", 1, 5, 7);
    s = applyAction(s, { type: "move", unitId: j.id, to: { x: 5, y: 6 } });
    expect(unit(s, j.id).type).toBe("giant");
    expect(unit(s, e.id).hp).toBeLessThan(10);
  });
});

describe("Explorer", () => {
  it("makes 15 moves", () => {
    expect(EXPLORER_STEPS).toBe(15);
  });

  it.each([
    [10, 2],
    [2, 10],
    [10, 10],
  ])("heads for an unfound lighthouse at (%i,%i) when steps uncover equally", (lx, ly) => {
    const s = blank();
    const pl = s.players[0];
    pl.explored = new Array(N * N).fill(0);
    tile(s, lx, ly).lighthouse = true;
    runExplorer(s, 0, { x: 6, y: 6 });
    expect(pl.lighthouses).toContain(idx(N, lx, ly));
  });

  it("walks toward the nearest fog when no step uncovers anything", () => {
    const s = blank();
    const pl = s.players[0];
    for (let y = 0; y < N; y++) pl.explored[idx(N, N - 1, y)] = 0;
    runExplorer(s, 0, { x: 1, y: 6 });
    expect(pl.explored.some((e, i) => i % N === N - 1 && e === 1)).toBe(true);
  });
});
