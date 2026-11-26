/**
 * Parity tests for generic movement, combat and healing against docs/RULES.md
 * (§2.4 skills, §3 combat, §4 movement, §5.12 Explorer) and docs/RULES_PARITY.md.
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
  const s = createGame({ mapSize: N, players: 2, mode: "domination", seed: 3, clans: ["imperius", "imperius"] });
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

/*
 * Real unit types stand in for one generic skill each (their other skills don't
 * touch the asserted outcome):
 *   Creep: doomux (movement 3; dash, explode, static act only on attacks)
 *   Air:   fireDragon (movement 3; dash, splash, scout, static don't change where it may go)
 *   plain: knight (movement 3; dash, persist, fortify are combat skills)
 *   Sneak: hexapod, Hide: cloak (movement 2, so they start one tile nearer; see setup)
 *   Splash: fireDragon at 4 of 20 HP (range 2: 5 damage to a warrior, as the old test unit)
 *   Explode: segment (attack 2, like the old test unit)
 */
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
  // enemy at (5,7); (5,8) behind it can only be reached by passing a controlled tile.
  // Movement-3 units start at (5,5), movement-2 ones at (5,6): still only controlled
  // tiles, (4,7) and (6,7), lie between them and (5,8) (a Rider from there is stopped).
  const setup = (type: string, y = 5) => {
    const s = blank();
    const u = put(s, type, 0, 5, y);
    put(s, "warrior", 1, 5, 7);
    return { s, u };
  };
  it("Creep does not ignore zone of control", () => {
    const { s, u } = setup("doomux");
    expect(reach(s, u, 5, 8)).toBe(false);
    expect(reach(s, u, 5, 6)).toBe(true);
  });
  it("Air does not ignore zone of control", () => {
    const { s, u } = setup("fireDragon");
    expect(reach(s, u, 5, 8)).toBe(false);
  });
  it("a plain unit is stopped", () => {
    const { s, u } = setup("knight");
    expect(reach(s, u, 5, 8)).toBe(false);
  });
  it("Sneak and Hide ignore it", () => {
    const sn = setup("hexapod", 6);
    expect(reach(sn.s, sn.u, 5, 8)).toBe(true);
    const h = setup("cloak", 6);
    expect(reach(h.s, h.u, 5, 8)).toBe(true);
  });
  // "Infiltrate alone does not ignore it": removed in the Rust migration: needs a unit type the
  // game data has no instance of (Infiltrate without Hide or Sneak); the Rust engine's unit table
  // is fixed at compile time
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
    const u = put(s, "doomux", 0, 5, 5);
    expect(reach(s, u, 5, 6)).toBe(true);
    expect(reach(s, u, 5, 7)).toBe(false);
  });
  it("Air ignores the mountain stop", () => {
    const s = wall("mountain");
    const u = put(s, "fireDragon", 0, 5, 5);
    expect(reach(s, u, 5, 7)).toBe(true);
  });
  it("forests don't stop Creep but stop a plain unit", () => {
    const s = wall("forest");
    expect(reach(s, put(s, "doomux", 0, 5, 5), 5, 7)).toBe(true);
    const s2 = wall("forest");
    expect(reach(s2, put(s2, "knight", 0, 5, 5), 5, 7)).toBe(false);
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

  it("idle units heal automatically at the end of the turn (2.18; overturns the doc-only reading)", () => {
    let s = blank();
    const w = put(s, "warrior", 0, 1, 1);
    w.hp = 3;
    s = applyAction(s, { type: "endTurn" });
    expect(unit(s, w.id).hp).toBe(7);
  });
});

describe("splash and explosions: half the damage, rounded down (S1 attack::half_damage)", () => {
  it("splash gives neighbours of the target half the damage, rounded down", () => {
    let s = blank();
    const a = put(s, "fireDragon", 0, 5, 4);
    a.hp = 4;
    const t = put(s, "warrior", 1, 5, 6);
    const n = put(s, "warrior", 1, 6, 6);
    s = applyAction(s, { type: "attack", unitId: a.id, targetId: t.id });
    // a Fire Dragon at 4 HP vs warrior: 5 damage; neighbour floor(5 / 2) = 2
    expect(unit(s, t.id).hp).toBe(5);
    expect(unit(s, n.id).hp).toBe(8);
  });

  it("an explosion deals half its damage, rounded down", () => {
    let s = blank();
    const e = put(s, "segment", 0, 5, 5);
    e.createdTurn = s.turn - 1; // no Explode in the turn of creation
    const t = put(s, "warrior", 1, 5, 6);
    s = applyAction(s, find(s, (a) => a.type === "explode" && a.unitId === e.id)!);
    expect(unit(s, t.id).hp).toBe(8);
  });

  // HP is a whole number in the state; the splash on each neighbour is half the attack's damage
  // against that neighbour (computed at its own HP), rounded down
  it("a unit dies when it reaches exactly 0 HP", () => {
    let s = blank();
    const a = put(s, "fireDragon", 0, 5, 4);
    a.hp = 4;
    const t = put(s, "warrior", 1, 5, 6);
    const n = put(s, "warrior", 1, 6, 6);
    n.hp = 4; // 9 damage against it: a splash of 4 leaves exactly 0
    s = applyAction(s, { type: "attack", unitId: a.id, targetId: t.id });
    expect(s.units.find((u) => u.id === n.id)).toBeUndefined();
  });

  it("a unit dies when it falls below 0 HP", () => {
    let s = blank();
    const a = put(s, "fireDragon", 0, 5, 4);
    a.hp = 4;
    const t = put(s, "warrior", 1, 5, 6);
    const n = put(s, "warrior", 1, 6, 6);
    n.hp = 3; // 10 damage against it: a splash of 5 leaves -2
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
  it("Dinghy skills are exactly the game data's: Water, Carry, Hide, Infiltrate, Dash, Scout, Stiff, Static (no Creep)", () => {
    expect([...UNITS.dinghy.skills].sort()).toEqual(["carry", "dash", "hide", "infiltrate", "scout", "static", "stiff", "water"]);
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

  // "A melee attacker moves into the tile if it can stand there": a ship can land, so a kill
  // on the shore moves it in and it turns back into the unit it carries, ending its turn
  it("a Rammer that kills a unit in a coastal enemy city lands in the city as its passenger", () => {
    let s = blank();
    s.players[0].techs.push("fishing");
    tile(s, 5, 5).terrain = "water";
    const city = s.cities[1];
    tile(s, city.x, city.y).cityId = null;
    city.x = 5;
    city.y = 6;
    tile(s, 5, 6).cityId = city.id;
    const r = put(s, "rammer", 0, 5, 5);
    r.carried = "warrior";
    const e = put(s, "warrior", 1, 5, 6);
    e.hp = 1;
    s = applyAction(s, { type: "attack", unitId: r.id, targetId: e.id });
    expect(s.units.find((u) => u.id === e.id)).toBeUndefined();
    expect(unit(s, r.id)).toMatchObject({ x: 5, y: 6, type: "warrior", carried: null, done: true });
  });

  // swimming super units advance like the ships that carry a unit
  it("a Juggernaut that kills a unit on the shore lands as its Giant and stomps", () => {
    let s = blank();
    s.players[0].techs.push("fishing");
    tile(s, 5, 5).terrain = "water";
    const j = put(s, "juggernaut", 0, 5, 5);
    j.carried = "giant";
    const e = put(s, "warrior", 1, 5, 6);
    e.hp = 1;
    const n = put(s, "warrior", 1, 5, 7);
    s = applyAction(s, { type: "attack", unitId: j.id, targetId: e.id });
    expect(unit(s, j.id)).toMatchObject({ x: 5, y: 6, type: "giant", carried: null, done: true });
    expect(s.units.find((u) => u.id === n.id)?.hp ?? 0).toBeLessThan(10);
  });

  it("a Crab (amphibious super unit) that kills a unit on the shore moves in as a Crab", () => {
    let s = blank();
    s.players[0].techs.push("fishing");
    tile(s, 5, 5).terrain = "water";
    const c = put(s, "crab", 0, 5, 5);
    const e = put(s, "warrior", 1, 5, 6);
    e.hp = 1;
    s = applyAction(s, { type: "attack", unitId: c.id, targetId: e.id });
    expect(unit(s, c.id)).toMatchObject({ x: 5, y: 6, type: "crab" });
  });

  it("a Shark (a ship with no passenger) that kills a unit on the shore stays on the water", () => {
    let s = blank();
    s.players[0].techs.push("fishing", "sailing");
    tile(s, 5, 5).terrain = "water";
    const sh = put(s, "shark", 0, 5, 5);
    const e = put(s, "warrior", 1, 5, 6);
    e.hp = 1;
    s = applyAction(s, { type: "attack", unitId: sh.id, targetId: e.id });
    expect(s.units.find((u) => u.id === e.id)).toBeUndefined();
    expect(unit(s, sh.id)).toMatchObject({ x: 5, y: 5, type: "shark" });
  });

  // checked in the real game: a Raft that has waited a turn can be upgraded, move into range and shoot
  it("a Raft upgraded to a Scout can move and shoot in the same turn", () => {
    let s = blank();
    s.players[0].techs.push("fishing", "sailing");
    s.players[0].stars = 20;
    for (const [x, y] of [[1, 1], [2, 1], [3, 1]]) tile(s, x, y).terrain = "water";
    const r = put(s, "raft", 0, 1, 1); // own territory (the city at (0,0) claims radius 1)
    r.carried = "warrior";
    r.canAttack = false; // as start_turn leaves a Raft: attack 0
    const e = put(s, "warrior", 1, 5, 1);
    s = applyAction(s, { type: "upgrade", unitId: r.id, to: "scout" });
    expect(unit(s, r.id)).toMatchObject({ type: "scout", canAttack: true });
    s = applyAction(s, { type: "move", unitId: r.id, to: { x: 3, y: 1 } });
    expect(find(s, (a) => a.type === "attack" && a.unitId === r.id && a.targetId === e.id)).toBeDefined();
  });

  // a Bomber has no Dash: it shoots from where it stands, never after a move
  describe("a Raft upgraded to a Bomber (no Dash)", () => {
    function setup() {
      const s = blank();
      s.players[0].techs.push("fishing", "sailing", "navigation");
      s.players[0].stars = 30;
      for (const [x, y] of [[1, 1], [1, 0], [2, 1], [3, 1]]) tile(s, x, y).terrain = "water";
      const r = put(s, "raft", 0, 1, 1);
      r.carried = "warrior";
      r.canAttack = false; // as start_turn leaves a Raft: attack 0
      return { s, r };
    }
    const canShoot = (s: GameState, id: number) => !!find(s, (a) => a.type === "attack" && a.unitId === id);

    it("shoots without moving in the turn of the upgrade", () => {
      let { s, r } = setup();
      const e = put(s, "warrior", 1, 4, 1); // 3 tiles away, Bomber range 3
      s = applyAction(s, { type: "upgrade", unitId: r.id, to: "bomber" });
      expect(find(s, (a) => a.type === "attack" && a.unitId === r.id && a.targetId === e.id)).toBeDefined();
    });

    it("can't shoot after upgrading and then moving", () => {
      let { s, r } = setup();
      put(s, "warrior", 1, 5, 1);
      s = applyAction(s, { type: "upgrade", unitId: r.id, to: "bomber" });
      s = applyAction(s, { type: "move", unitId: r.id, to: { x: 2, y: 1 } });
      expect(canShoot(s, r.id)).toBe(false);
    });

    it("can't shoot after moving as a Raft and then upgrading", () => {
      let { s, r } = setup();
      put(s, "warrior", 1, 4, 0);
      s = applyAction(s, { type: "move", unitId: r.id, to: { x: 1, y: 0 } }); // still own territory
      s = applyAction(s, { type: "upgrade", unitId: r.id, to: "bomber" });
      expect(unit(s, r.id).canAttack).toBe(false);
      expect(canShoot(s, r.id)).toBe(false);
    });
  });

  it("a Raft that moved and is then upgraded to a Scout (Dash) can still shoot", () => {
    let s = blank();
    s.players[0].techs.push("fishing", "sailing");
    s.players[0].stars = 20;
    for (const [x, y] of [[1, 1], [1, 0]]) tile(s, x, y).terrain = "water";
    const r = put(s, "raft", 0, 1, 1);
    r.carried = "warrior";
    r.canAttack = false;
    const e = put(s, "warrior", 1, 3, 0);
    s = applyAction(s, { type: "move", unitId: r.id, to: { x: 1, y: 0 } });
    s = applyAction(s, { type: "upgrade", unitId: r.id, to: "scout" });
    expect(find(s, (a) => a.type === "attack" && a.unitId === r.id && a.targetId === e.id)).toBeDefined();
  });

  it("a Raft that is done for the turn stays done after an upgrade", () => {
    let s = blank();
    s.players[0].techs.push("fishing", "sailing");
    s.players[0].stars = 20;
    tile(s, 1, 1).terrain = "water";
    const r = put(s, "raft", 0, 1, 1);
    r.carried = "warrior";
    Object.assign(r, { canAttack: false, canMove: false, done: true, moved: true });
    s = applyAction(s, { type: "upgrade", unitId: r.id, to: "scout" });
    expect(unit(s, r.id)).toMatchObject({ type: "scout", canAttack: false, done: true });
  });

  it("a Scout (ranged, it shoots) that kills a unit next to it stays on the water", () => {
    let s = blank();
    s.players[0].techs.push("fishing", "sailing");
    tile(s, 5, 5).terrain = "water";
    const sc = put(s, "scout", 0, 5, 5);
    sc.carried = "warrior";
    const e = put(s, "warrior", 1, 5, 6);
    e.hp = 1;
    s = applyAction(s, { type: "attack", unitId: sc.id, targetId: e.id });
    expect(s.units.find((u) => u.id === e.id)).toBeUndefined();
    expect(unit(s, sc.id)).toMatchObject({ x: 5, y: 5, type: "scout", carried: "warrior" });
  });

  it("a Rammer that kills a unit on a mountain without Climbing stays on the water", () => {
    let s = blank();
    s.players[0].techs.push("fishing");
    tile(s, 5, 5).terrain = "water";
    tile(s, 5, 6).terrain = "mountain";
    const r = put(s, "rammer", 0, 5, 5);
    r.carried = "warrior";
    const e = put(s, "warrior", 1, 5, 6);
    e.hp = 1;
    s = applyAction(s, { type: "attack", unitId: r.id, targetId: e.id });
    expect(s.units.find((u) => u.id === e.id)).toBeUndefined();
    expect(unit(s, r.id)).toMatchObject({ x: 5, y: 5, type: "rammer", carried: "warrior" });
  });
});

describe("Explorer", () => {
  it("makes 12 moves (S1 reward::scout)", () => {
    expect(EXPLORER_STEPS).toBe(12);
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
