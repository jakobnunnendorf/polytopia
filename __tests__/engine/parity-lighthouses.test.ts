/**
 * Corner lighthouses (2.8 Path of the Ocean):
 * - Every tribe that uncovers a lighthouse gets +1 population in its capital (or oldest city without one).
 * - Finding all 4 completes the Explorer task (unlocking the Eye of God).
 * - Lighthouses always start under clouds at turn 0.
 */
import { applyAction } from "@/logic/engine/actions";
import { idx } from "@/logic/engine/grid";
import { claimTerritory, createGame, makeUnit } from "@/logic/engine/state";
import type { GameState, Unit } from "@/logic/engine/types";

const N = 12;

function blankWithCornerLighthouses(): GameState {
  const s = createGame({ mapSize: N, players: 2, mode: "domination", seed: 5, clans: ["imperius", "imperius"] });
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
  const corners = [
    { x: 0, y: 0 },
    { x: N - 1, y: 0 },
    { x: 0, y: N - 1 },
    { x: N - 1, y: N - 1 },
  ];
  for (const c of corners) s.tiles[idx(N, c.x, c.y)].lighthouse = true;

  // Put both capitals in the middle, away from corners
  s.cities = s.cities.slice(0, 2);
  const caps = [
    { x: 4, y: 5 },
    { x: 7, y: 5 },
  ];
  s.cities.forEach((c, i) => {
    c.x = caps[i].x;
    c.y = caps[i].y;
    c.capital = true;
    c.level = 1;
    c.pop = 0;
    c.pendingRewards = [];
    s.tiles[idx(N, c.x, c.y)].cityId = c.id;
    claimTerritory(s, c, 1);
  });
  for (const pl of s.players) {
    pl.explored = new Array(N * N).fill(1);
    for (const c of corners) pl.explored[idx(N, c.x, c.y)] = 0;
    pl.lighthouses = [];
    pl.tasks = [];
    pl.met = s.players.filter((o) => o.id !== pl.id).map((o) => o.id);
    pl.stars = 50;
  }
  s.units = [];
  s.current = 0;
  delete s.diplomacy;
  return s;
}

function put(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  Object.assign(u, { done: false, canMove: true, canAttack: true, moved: false, attacked: false });
  return u;
}

describe("corner lighthouses", () => {
  it("each tribe that uncovers the same lighthouse gets +1 capital population and records it", () => {
    let s = blankWithCornerLighthouses();
    const cornerIdx = idx(N, 0, 0);
    const u0 = put(s, "warrior", 0, 2, 1);
    const u1 = put(s, "warrior", 1, 1, 2);

    // Player 0 moves adjacent to (0,0) -> uncovers corner lighthouse
    s = applyAction(s, { type: "move", unitId: u0.id, to: { x: 1, y: 1 } });
    expect(s.players[0].lighthouses).toContain(cornerIdx);
    expect(s.cities.find((c) => c.owner === 0 && c.capital)!.pop).toBe(1);
    expect(s.players[1].lighthouses).not.toContain(cornerIdx);
    expect(s.cities.find((c) => c.owner === 1 && c.capital)!.pop).toBe(0);

    // End player 0's turn; player 1 moves adjacent to (0,0) -> also gets +1 capital pop
    s = applyAction(s, { type: "endTurn" });
    s = applyAction(s, { type: "move", unitId: u1.id, to: { x: 0, y: 1 } });
    expect(s.players[1].lighthouses).toContain(cornerIdx);
    expect(s.cities.find((c) => c.owner === 1 && c.capital)!.pop).toBe(1);
    // Both players still have it recorded
    expect(s.players[0].lighthouses).toContain(cornerIdx);
  });

  it("a tribe with no capital gets +1 population in its first (oldest) city", () => {
    let s = blankWithCornerLighthouses();
    // Player 0 lost their capital (no city has capital=true) and owns two regular cities
    const cap0 = s.cities.find((c) => c.owner === 0)!;
    cap0.capital = false;
    cap0.pop = 0;
    const secondCity = {
      ...cap0,
      id: 99,
      x: 4,
      y: 8,
      capital: false,
      pop: 0,
      pendingRewards: [],
    };
    s.cities.push(secondCity);
    s.tiles[idx(N, secondCity.x, secondCity.y)].cityId = secondCity.id;

    const u0 = put(s, "warrior", 0, 2, 1);
    s = applyAction(s, { type: "move", unitId: u0.id, to: { x: 1, y: 1 } });

    expect(s.players[0].lighthouses).toContain(idx(N, 0, 0));
    expect(s.cities.find((c) => c.id === cap0.id)!.pop).toBe(1);
    expect(s.cities.find((c) => c.id === secondCity.id)!.pop).toBe(0);
  });

  it("finding all 4 lighthouses completes the Explorer task", () => {
    let s = blankWithCornerLighthouses();
    const u0 = put(s, "warrior", 0, 2, 1);
    const u1 = put(s, "warrior", 0, N - 3, 1);
    const u2 = put(s, "warrior", 0, 2, N - 2);
    const u3 = put(s, "warrior", 0, N - 3, N - 2);

    s = applyAction(s, { type: "move", unitId: u0.id, to: { x: 1, y: 1 } });
    s = applyAction(s, { type: "move", unitId: u1.id, to: { x: N - 2, y: 1 } });
    s = applyAction(s, { type: "move", unitId: u2.id, to: { x: 1, y: N - 2 } });
    expect(s.players[0].lighthouses).toHaveLength(3);
    expect(s.players[0].tasks).not.toContain("explorer");

    s = applyAction(s, { type: "move", unitId: u3.id, to: { x: N - 2, y: N - 2 } });
    expect(s.players[0].lighthouses).toHaveLength(4);
    expect(s.players[0].tasks).toContain("explorer");
  });

  // Known engine gap (issue #200): capitals spawned within radius 2 of a corner reveal
  // that corner's lighthouse at turn 0 instead of keeping all 4 lighthouses under clouds.
  it.failing("at turn 0 no player starts with a lighthouse already uncovered", () => {
    const cases: { mapSize: number; players: number; seed: number }[] = [
      { mapSize: 11, players: 2, seed: 1 },
      { mapSize: 11, players: 4, seed: 7 },
      { mapSize: 14, players: 4, seed: 42 },
      { mapSize: 16, players: 6, seed: 99 },
      { mapSize: 18, players: 8, seed: 123 },
    ];
    for (const cfg of cases) {
      const s = createGame({ ...cfg, mode: "perfection" });
      const n = s.mapSize;
      const corners = [0, n - 1, (n - 1) * n, n * n - 1];
      for (const c of corners) {
        expect(s.tiles[c].lighthouse).toBe(true);
      }
      for (const pl of s.players) {
        expect(pl.lighthouses).toEqual([]);
        for (const c of corners) {
          expect(pl.explored[c]).toBe(0);
        }
      }
    }
  });
});
