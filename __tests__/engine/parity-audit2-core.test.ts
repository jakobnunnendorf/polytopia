/**
 * Parity tests for the second core-rules audit (docs/RULES_PARITY.md, "2.18 data corrections:
 * second core audit"). Every rule follows polybots-engine (Apache-2.0); one test per audit item.
 */
import { applyAction, legalActions, runExplorer } from "@/logic/engine/actions";
import { computeDamage, computeDamageRounded, defenceBonus, halfDamage } from "@/logic/engine/combat";
import { EXPLORER_STEPS, GLORY_TARGET, UNITS } from "@/logic/engine/data";
import { atWar, makePeace } from "@/logic/engine/diplomacy";
import { cloneState, idx } from "@/logic/engine/grid";
import { reachable } from "@/logic/engine/movement";
import { claimTerritory, createGame, makeUnit, meet, scoreOf } from "@/logic/engine/state";
import type { Action, City, GameState, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12x12 open field map, all explored, two cities in opposite corners, no units, tribes met */
function blank(mode: GameState["mode"] = "domination"): GameState {
  const s = createGame({ mapSize: N, players: 2, mode, seed: 3, clans: ["imperius", "imperius"] });
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
      flooded: false,
    });
  }
  s.cities = s.cities.slice(0, 2);
  const corners = [
    { x: 0, y: 0 },
    { x: N - 1, y: N - 1 },
  ];
  s.cities.forEach((c, i) => placeCity(s, c, corners[i].x, corners[i].y));
  for (const pl of s.players) {
    pl.explored = new Array(N * N).fill(1);
    pl.met = s.players.filter((o) => o.id !== pl.id).map((o) => o.id);
    pl.stars = 50;
  }
  s.units = [];
  s.current = 0;
  delete s.diplomacy;
  return s;
}

function placeCity(s: GameState, c: City, x: number, y: number) {
  for (const t of s.tiles) {
    if (t.cityId === c.id) t.cityId = null;
    if (t.territory === c.id) t.territory = null;
  }
  c.x = x;
  c.y = y;
  s.tiles[idx(N, x, y)].cityId = c.id;
  claimTerritory(s, c, 1);
}

function put(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  u.canMove = true;
  u.canAttack = true;
  u.done = false;
  u.createdTurn = s.turn - 1;
  return u;
}

const tile = (s: GameState, x: number, y: number) => s.tiles[idx(N, x, y)];
const has = (s: GameState, pred: (a: Action) => boolean) => legalActions(s).some(pred);
const unit = (s: GameState, id: number) => s.units.find((u) => u.id === id);
/** end turns until it is player p's turn again */
function untilTurnOf(s: GameState, p: number): GameState {
  let t = applyAction(s, { type: "endTurn" });
  while (t.current !== p && !t.over) t = applyAction(t, { type: "endTurn" });
  return t;
}

describe("second core audit (S1 = polybots-engine)", () => {
  it("1. Perfection ends right after the wrap into turn maxTurns (turns 0..maxTurns-1)", () => {
    const s = blank("perfection");
    s.maxTurns = 30;
    s.current = 1;
    s.turn = 28;
    const a = applyAction(s, { type: "endTurn" });
    expect(a.over).toBe(false);
    expect(a.turn).toBe(29);
    a.current = 1;
    const b = applyAction(a, { type: "endTurn" });
    expect(b.turn).toBe(30);
    expect(b.over).toBe(true);
    // the Weekly Challenge limit works the same way
    expect(createGame({ players: 2, mode: "perfection", seed: 1, turnLimit: 20 }).maxTurns).toBe(20);
  });

  it("2. splash, stomp and explosions deal half damage rounded down to whole HP", () => {
    expect(halfDamage(5)).toBe(2);
    expect(halfDamage(4)).toBe(2);
    // splash (Fire Dragon, range 2)
    const s = blank();
    const d = put(s, "fireDragon", 0, 3, 3);
    const target = put(s, "warrior", 1, 5, 3);
    const side = put(s, "warrior", 1, 6, 3);
    const expected = side.hp - halfDamage(computeDamageRounded(s, d, side).damage);
    const t = applyAction(s, { type: "attack", unitId: d.id, targetId: target.id });
    expect(unit(t, side.id)!.hp).toBe(expected);
    expect(Number.isInteger(unit(t, side.id)!.hp)).toBe(true);
    // explosion (Boomchi)
    const e = blank();
    const bo = put(e, "boomchi", 0, 4, 4);
    const w = put(e, "defender", 1, 5, 4);
    const exp = w.hp - halfDamage(computeDamageRounded(e, bo, w).damage);
    const after = applyAction(e, { type: "explode", unitId: bo.id });
    expect(unit(after, w.id)!.hp).toBe(exp);
    expect(Number.isInteger(exp)).toBe(true);
  });

  it("3. a poisoning splash (Exida) only poisons the neighbours; splash needs range > 1", () => {
    const s = blank();
    const x = put(s, "exida", 0, 2, 3);
    const target = put(s, "warrior", 1, 5, 3);
    const side = put(s, "warrior", 1, 6, 3);
    const t = applyAction(s, { type: "attack", unitId: x.id, targetId: target.id });
    expect(unit(t, side.id)!.hp).toBe(side.hp);
    expect(unit(t, side.id)!.poisoned).toBe(true);
    // a splash unit with range 1 does not splash
    const range = UNITS.fireDragon.range;
    try {
      (UNITS.fireDragon as { range: number }).range = 1;
      const m = blank();
      const d = put(m, "fireDragon", 0, 4, 3);
      const tt = put(m, "warrior", 1, 5, 3);
      const sd = put(m, "warrior", 1, 6, 3);
      const after = applyAction(m, { type: "attack", unitId: d.id, targetId: tt.id });
      expect(unit(after, sd.id)!.hp).toBe(sd.hp);
    } finally {
      (UNITS.fireDragon as { range: number }).range = range;
    }
  });

  it("4. breaking peace spends every other unit of the breaker", () => {
    const s = blank();
    makePeace(s, 0, 1);
    const inside = put(s, "warrior", 0, N - 2, N - 2);
    const home = put(s, "warrior", 0, 3, 3);
    const t = applyAction(s, { type: "breakPeace", player: 1 });
    expect(unit(t, inside.id)).toBeUndefined();
    const h = unit(t, home.id)!;
    expect(h.moved && h.attacked && !h.canMove && !h.canAttack).toBe(true);
  });

  it("5. roads may go on farms, other buildings and ruins, not on a city, village or bridge", () => {
    const s = blank();
    s.players[0].techs.push("roads", "farming", "construction");
    const road = (x: number, y: number) =>
      has(s, (a) => a.type === "build" && a.building === "road" && a.at.x === x && a.at.y === y);
    tile(s, 1, 1).building = "farm";
    expect(road(1, 1)).toBe(true);
    tile(s, 3, 3).ruin = true;
    expect(road(3, 3)).toBe(true);
    expect(road(0, 0)).toBe(false); // own city
    tile(s, 5, 5).village = true;
    expect(road(5, 5)).toBe(false);
    tile(s, 1, 1).road = true;
    expect(road(1, 1)).toBe(false);
  });

  it("6. Grow units grow at the end of the owner's turn when turn - created reaches the rate", () => {
    const s = blank();
    s.turn = 5;
    const egg = makeUnit(s, "dragonEgg", 0, { x: 4, y: 4 }, null);
    expect(egg.createdTurn).toBe(5);
    let t = s;
    for (let k = 0; k < 2; k++) t = untilTurnOf(t, 0); // ends of turns 5, 6 -> now turn 7
    expect(t.turn).toBe(7);
    t = untilTurnOf(t, 0); // end of turn 7: 2 < 3
    expect(unit(t, egg.id)!.type).toBe("dragonEgg");
    const end8 = applyAction(t, { type: "endTurn" }); // end of turn 8: 8 - 5 >= 3
    expect(unit(end8, egg.id)!.type).toBe("babyDragon");
    expect(unit(end8, egg.id)!.createdTurn).toBe(8); // the next stage counts again
    // Insect Egg -> Larva after one turn
    const c = blank();
    const ie = makeUnit(c, "insectEgg", 0, { x: 4, y: 4 }, null);
    expect(unit(applyAction(c, { type: "endTurn" }), ie.id)!.type).toBe("insectEgg");
    const next = untilTurnOf(c, 0);
    expect(unit(applyAction(next, { type: "endTurn" }), ie.id)!.type).toBe("larva");
  });

  it("7. a Cloak may move and then infiltrate in the same turn (Dash)", () => {
    const s = blank();
    s.players[0].techs.push("diplomacy");
    const c = put(s, "cloak", 0, N - 4, N - 2);
    const t = applyAction(s, { type: "move", unitId: c.id, to: { x: N - 2, y: N - 2 } });
    expect(unit(t, c.id)!.hidden).toBe(true);
    expect(has(t, (a) => a.type === "infiltrate" && a.unitId === c.id)).toBe(true);
  });

  it("8. a ship scores 5 x (boat + passenger cost); disband pays floor(total / 2) when above 1", () => {
    const s = blank();
    const before = scoreOf(s, 0);
    const b = put(s, "scout", 0, 4, 4);
    b.carried = "warrior";
    expect(scoreOf(s, 0) - before).toBe(5 * (UNITS.scout.cost + UNITS.warrior.cost));
    s.players[0].techs.push("freeSpirit");
    const stars = s.players[0].stars;
    const t = applyAction(s, { type: "disband", unitId: b.id });
    expect(t.players[0].stars - stars).toBe(Math.floor((UNITS.scout.cost + UNITS.warrior.cost) / 2));
  });

  it("9. Pacifist: a damaging attack on a visible unit resets the count, every end of turn adds 1", () => {
    const s = blank();
    s.players[0].techs.push("meditation");
    s.players[0].pacifistTurns = 3;
    const a = put(s, "warrior", 0, 4, 4);
    const e = put(s, "warrior", 1, 5, 4);
    const quiet = applyAction(s, { type: "endTurn" });
    expect(quiet.players[0].pacifistTurns).toBe(4);
    const hit = applyAction(s, { type: "attack", unitId: a.id, targetId: e.id });
    expect(applyAction(hit, { type: "endTurn" }).players[0].pacifistTurns).toBe(1);
  });

  it("10. capturing a city, moving onto one and infiltrating start war and end embassies", () => {
    const s = blank();
    s.players[0].embassies = [1];
    s.players[1].embassies = [0];
    const w = put(s, "warrior", 0, N - 2, N - 1);
    const moved = applyAction(s, { type: "move", unitId: w.id, to: { x: N - 1, y: N - 1 } });
    expect(atWar(moved, 0, 1)).toBe(true);
    expect(moved.players[0].embassies).toEqual([]);
    expect(moved.players[1].embassies).toEqual([]);
    // capture
    const c = blank();
    const cw = put(c, "warrior", 0, N - 1, N - 1);
    const cap = applyAction(c, { type: "capture", unitId: cw.id });
    expect(atWar(cap, 0, 1)).toBe(true);
    // infiltration
    const i = blank();
    i.players[0].techs.push("diplomacy");
    const cl = put(i, "cloak", 0, N - 2, N - 2);
    const inf = applyAction(i, { type: "infiltrate", unitId: cl.id, cityId: i.cities[1].id });
    expect(atWar(inf, 0, 1)).toBe(true);
  });

  it("11. a hidden unit on the destination is revealed and the move is not spent; passing one is silent", () => {
    const s = blank();
    const r = put(s, "rider", 0, 2, 2);
    const c = put(s, "cloak", 1, 4, 2);
    c.hidden = true;
    // destination holds the hidden Cloak
    const t = applyAction(s, { type: "move", unitId: r.id, to: { x: 4, y: 2 } });
    const rr = unit(t, r.id)!;
    expect([rr.x, rr.y]).toEqual([2, 2]);
    expect(rr.moved).toBe(false);
    expect(rr.canMove).toBe(true);
    expect(unit(t, c.id)!.hidden).toBe(false);
    // passing through: a Cloak in the middle of a straight 2-step move is not seen
    const p = blank();
    const r2 = put(p, "rider", 0, 2, 2);
    const c2 = put(p, "cloak", 1, 3, 2);
    c2.hidden = true;
    for (const t2 of p.tiles) t2.terrain = "field";
    const moved = applyAction(p, { type: "move", unitId: r2.id, to: { x: 4, y: 2 } });
    expect([unit(moved, r2.id)!.x, unit(moved, r2.id)!.y]).toEqual([4, 2]);
  });

  it("12. the Explorer takes 12 steps and walks explored tiles only on terrain the player can move on", () => {
    expect(EXPLORER_STEPS).toBe(12);
    const s = blank();
    // a wall of explored shallow water between the start and the fog
    for (let y = 0; y < N; y++) {
      tile(s, 6, y).terrain = "water";
      for (let x = 8; x < N; x++) s.players[0].explored[idx(N, x, y)] = 0;
    }
    const explored = (t: GameState) => t.players[0].explored.reduce((a, b) => a + b, 0);
    const before = explored(s);
    runExplorer(s, 0, { x: 2, y: 5 });
    expect(explored(s)).toBe(before); // no Fishing: it can't cross the water
    const f = blank();
    f.players[0].techs.push("fishing");
    for (let y = 0; y < N; y++) {
      tile(f, 6, y).terrain = "water";
      for (let x = 8; x < N; x++) f.players[0].explored[idx(N, x, y)] = 0;
    }
    const fb = explored(f);
    runExplorer(f, 0, { x: 2, y: 5 });
    expect(explored(f)).toBeGreaterThan(fb);
  });

  it("13. ruin rewards: water needs ocean movement for the boat, population always, explorer on mountains", () => {
    const seen = (setup: (s: GameState) => void) => {
      const out = new Set<string>();
      const base = blank();
      for (let seed = 1; seed < 120; seed++) {
        const s = cloneState(base);
        s.rng = seed * 7919;
        setup(s);
        const u = s.units[0];
        const t = applyAction(s, { type: "examine", unitId: u.id });
        out.add(t.log.filter((l) => l.includes("ruin: ")).pop()!.split("ruin: ")[1]);
      }
      return out;
    };
    const water = seen((s) => {
      tile(s, 5, 5).terrain = "ocean";
      tile(s, 5, 5).ruin = true;
      put(s, "rammer", 0, 5, 5).carried = "warrior";
    });
    expect(water.has("newFriends")).toBe(false);
    const sailing = seen((s) => {
      s.players[0].techs.push("sailing");
      tile(s, 5, 5).terrain = "ocean";
      tile(s, 5, 5).ruin = true;
      put(s, "rammer", 0, 5, 5).carried = "warrior";
    });
    expect(sailing.has("newFriends")).toBe(true);
    const mountain = seen((s) => {
      s.players[0].techs.push("climbing");
      tile(s, 5, 5).terrain = "mountain";
      tile(s, 5, 5).ruin = true;
      for (let x = 8; x < N; x++) s.players[0].explored[idx(N, x, 5)] = 0;
      s.players[0].explored[idx(N, 7, 5)] = 0;
      put(s, "warrior", 0, 5, 5);
    });
    expect(mountain.has("explorer")).toBe(true);
    // a free tech may be the unknown parent of a known tech
    const parent = seen((s) => {
      s.players[0].techs = ["roads"]; // parent Riding unknown; tier-1 techs open too
      tile(s, 5, 5).ruin = true;
      put(s, "warrior", 0, 5, 5);
    });
    expect(parent.has("population")).toBe(true);
    expect(parent.has("scroll")).toBe(true);
  });

  it("14. the damage formula is S1's integer arithmetic (tenths of HP, truncating, round_damage)", () => {
    // [attack, hp, maxHp, defence, hp, maxHp, bonus, damage, retaliation] from the reference battle()
    const cases: number[][] = [
      [3.5, 3, 20, 1, 5, 5, 1, 5, 3],
      [3.5, 2, 5, 4, 3, 40, 1, 13, 3],
      [4, 1, 5, 3, 9, 10, 0.5, 7, 8],
      [0.7, 5, 5, 4, 1, 10, 0.7, 2, 5],
      [4, 9, 10, 0.5, 2, 5, 4, 15, 0],
      [4, 37, 40, 1, 3, 5, 0.7, 16, 0],
      [2, 13, 40, 0.5, 24, 40, 1, 6, 1],
      [1, 2, 5, 4, 32, 40, 2, 0, 17],
      [4, 15, 20, 2, 24, 40, 4, 7, 6],
      [2.5, 10, 10, 1, 3, 5, 0.7, 10, 1],
      [5, 20, 20, 2, 2, 15, 1, 21, 0],
      [4, 15, 15, 1, 8, 10, 0.5, 16, 0],
      [0.7, 21, 40, 0.5, 22, 40, 2, 1, 1],
      [3.5, 15, 20, 4, 5, 40, 1, 13, 3],
      [3, 3, 5, 3, 5, 5, 2, 3, 10],
      [5, 1, 20, 2, 8, 15, 4, 1, 9],
      [2, 1, 5, 4, 7, 20, 4, 1, 17],
      [2, 16, 20, 1, 3, 20, 1.5, 8, 1],
      [5, 9, 40, 3, 14, 15, 0.5, 10, 7],
      [3, 4, 15, 3, 5, 20, 1, 7, 7],
      [2, 1, 10, 1, 8, 10, 0.7, 2, 3],
      [2, 3, 15, 2, 4, 5, 0.7, 2, 7],
      [3.5, 9, 40, 4, 12, 15, 0.7, 4, 13],
      [0.7, 26, 40, 3, 13, 20, 0.5, 1, 9],
      [1, 7, 20, 3, 1, 5, 1.5, 1, 10],
      [5, 5, 5, 1, 1, 15, 1, 22, 0],
      [0.7, 2, 10, 4, 24, 40, 0.7, 0, 17],
      [0.7, 7, 10, 0.5, 10, 40, 2, 2, 1],
      [3, 31, 40, 2, 2, 15, 1, 12, 1],
      [5, 10, 20, 3, 3, 20, 1.5, 18, 3],
      [1, 14, 15, 2, 6, 20, 0.7, 3, 3],
      [0.7, 10, 40, 1, 12, 15, 0.7, 1, 3],
      [0.7, 12, 15, 4, 3, 5, 0.7, 1, 14],
      [3.5, 9, 15, 1, 9, 10, 0.7, 12, 1],
      [3.5, 16, 40, 1, 7, 10, 2, 8, 2],
      [2.5, 23, 40, 1, 1, 20, 1, 11, 0],
      [3, 12, 15, 3, 10, 10, 4, 2, 11],
      [5, 4, 15, 2, 1, 5, 1.5, 16, 3],
      [5, 8, 15, 1, 10, 10, 0.7, 18, 1],
      [0.7, 14, 15, 3, 1, 5, 0.5, 2, 4],
      // warrior vs warrior at full health: 4.5 rounds up to 5 both ways
      [2, 10, 10, 2, 10, 10, 1, 5, 5],
    ];
    for (const [a, ah, am, d, dh, dm, b, dmg, ret] of cases) {
      expect([a, ah, am, d, dh, dm, b, computeDamage(a, ah, am, d, dh, dm, b)]).toEqual([
        a, ah, am, d, dh, dm, b, { damage: dmg, retaliation: ret },
      ]);
    }
    // every stat combination gives whole HP
    for (const a of [0.7, 1, 2, 2.5, 3, 3.5, 4, 5])
      for (const d of [0.5, 1, 2, 3, 4])
        for (const b of [0.5, 0.7, 1, 1.5, 2, 4])
          for (let hp = 1; hp <= 15; hp++) {
            const r = computeDamage(a, hp, 15, d, 16 - hp, 15, b);
            expect(Number.isInteger(r.damage) && Number.isInteger(r.retaliation)).toBe(true);
          }
  });

  it("15. no build on a tile with a visible enemy unit not at peace; no Destroy of a bridge with a unit on it", () => {
    const s = blank();
    s.players[0].techs.push("organization");
    tile(s, 1, 1).resource = "fruit";
    const fruit = (t: GameState) =>
      legalActions(t).some((a) => a.type === "build" && a.building === "harvestFruit" && a.at.x === 1 && a.at.y === 1);
    const before = fruit(s);
    put(s, "warrior", 1, 1, 1);
    const blocked = fruit(s);
    makePeace(s, 0, 1);
    const atPeace = fruit(s);
    expect([before, blocked, atPeace]).toEqual([true, false, true]);
    const b = blank();
    b.players[0].techs.push("chivalry");
    tile(b, 1, 0).terrain = "water";
    tile(b, 1, 0).building = "bridge";
    const destroy = (t: GameState) =>
      legalActions(t).some((a) => a.type === "build" && a.building === "destroy" && a.at.x === 1 && a.at.y === 0);
    const free = destroy(b);
    put(b, "warrior", 0, 1, 0);
    expect([free, destroy(b)]).toEqual([true, false]);
  });

  it("16. Explode: any time except the turn of creation or while frozen; no target needed", () => {
    const s = blank();
    const bo = put(s, "boomchi", 0, 4, 4);
    const ex = (t: GameState) => has(t, (a) => a.type === "explode" && a.unitId === bo.id);
    expect(ex(s)).toBe(true); // no enemy around
    bo.moved = true;
    bo.canMove = false;
    expect(ex(s)).toBe(true);
    bo.createdTurn = s.turn;
    expect(ex(s)).toBe(false);
    bo.createdTurn = s.turn - 1;
    bo.frozen = true;
    expect(ex(s)).toBe(false);
  });

  it("17. Aquatism gives no defence bonus on ice", () => {
    const s = blank();
    s.players[1].techs.push("aquatism");
    tile(s, 5, 5).terrain = "water";
    const u = put(s, "warrior", 1, 5, 5);
    tile(s, 5, 5).ice = true;
    expect(defenceBonus(s, u)).toBe(1);
    tile(s, 5, 5).ice = false;
    expect(defenceBonus(s, u)).toBe(1.5);
  });

  it("18. algae stops only units that don't swim: amphibious units pass it", () => {
    const s = blank();
    for (let x = 3; x < N; x++)
      for (let y = 0; y < N; y++) {
        tile(s, x, y).terrain = "water";
        tile(s, x, y).algae = true;
      }
    const w = put(s, "rider", 0, 2, 3);
    const a = put(s, "amphibian", 0, 2, 4);
    a.x = 2;
    a.y = 3;
    s.units = s.units.filter((u) => u !== w);
    const amph = reachable(s, a).some((m) => m.x === 4 && m.y === 3);
    s.units = s.units.filter((u) => u !== a).concat([w]);
    const rider = reachable(s, w).some((m) => m.x === 4 && m.y === 3);
    expect([amph, rider]).toEqual([true, false]);
  });

  it("19. city connections cross peace partners' land and need no explored tiles", () => {
    const s = blank();
    const own = s.cities[0];
    // a second city of player 0 at (6,0), a road (0..6, 0) through player 1's land at x = 3
    const second = { ...own, id: 999, name: "B", x: 6, y: 0, capital: false, originalCapitalOf: null, pendingRewards: [] };
    s.cities.push(second);
    tile(s, 6, 0).cityId = 999;
    for (let x = 1; x < 6; x++) tile(s, x, 0).road = true;
    // own land on both sides of player 1's road tile: a direct step onto and off a non-partner's land
    tile(s, 2, 0).territory = own.id;
    tile(s, 3, 0).territory = s.cities[1].id;
    tile(s, 4, 0).territory = own.id;
    for (let x = 1; x < 6; x++) s.players[0].explored[idx(N, x, 0)] = 0;
    const w = put(s, "warrior", 0, 8, 8);
    const war = applyAction(s, { type: "recover", unitId: w.id });
    expect(war.cities.find((c) => c.id === 999)!.connected).toBe(false);
    makePeace(s, 0, 1);
    const peace = applyAction(s, { type: "recover", unitId: w.id });
    expect(peace.cities.find((c) => c.id === 999)!.connected).toBe(true);
  });

  it("20. meeting seat 0 in a 2-player game pays base 3; Glory ends after any action; infiltration kills count", () => {
    const s = blank();
    s.players[1].met = [];
    const sc = scoreOf(s, 0);
    const stars = s.players[1].stars;
    meet(s, 1, 0);
    expect(s.players[1].stars - stars).toBe(3 + 2 * Math.min(Math.ceil(sc / 1000), 5));
    s.players[0].met = [];
    const st0 = s.players[0].stars;
    const sc1 = scoreOf(s, 1);
    meet(s, 0, 1);
    expect(s.players[0].stars - st0).toBe(1 + 2 * Math.min(Math.ceil(sc1 / 1000), 5));
    // Glory: over right after the action that reaches the target
    const g = blank("glory");
    g.cities[0].level = Math.ceil(GLORY_TARGET / 50);
    const w = put(g, "warrior", 0, 4, 4);
    const t = applyAction(g, { type: "recover", unitId: w.id });
    expect(t.over).toBe(true);
    expect(t.winner).toBe(0);
    // infiltration: a killed defender counts for the infiltrating player
    const i = blank();
    i.players[0].techs.push("diplomacy");
    const cl = put(i, "cloak", 0, N - 2, N - 2);
    const def = put(i, "warrior", 1, N - 1, N - 1);
    def.hp = 1;
    const after = applyAction(i, { type: "infiltrate", unitId: cl.id, cityId: i.cities[1].id });
    expect(unit(after, def.id)).toBeUndefined();
    expect(after.players[0].kills).toBe(1);
  });
});
