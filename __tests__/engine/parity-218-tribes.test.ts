/**
 * Special tribes at 2.18 (research spec, "Special tribes (group B)"): Aquarion, Cymanti, Polaris
 * and Elyrion as the game's 2.18 data and the polybots-engine reference rules give them
 * (docs/RULES_PARITY.md, "2.18 data corrections").
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { BUILDS, CLAN_BY_ID, buildAllowedFor, trainableUnitsFor } from "@/logic/engine/data";
import { tileAt } from "@/logic/engine/grid";
import { reachable } from "@/logic/engine/movement";
import { CHANNELS, observe } from "@/logic/engine/observe";
import { claimTerritory, createGame, iceBankLevel, income, makeUnit } from "@/logic/engine/state";
import type { Action, GameState, Tile, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12×12 all-field map, everything explored, capitals at (1,1) and (10,10) with radius-2 borders, no units */
function blank(clans: string[], techs: string[][] = []): GameState {
  const s = createGame({ mapSize: N, players: clans.length, mode: "domination", seed: 3, clans });
  for (const t of s.tiles) {
    Object.assign(t, {
      terrain: "field", resource: null, building: null, buildingLevel: 0, road: false, cityId: null,
      village: false, ruin: false, lighthouse: false, territory: null, ice: false, algae: false, polar: false,
      flooded: false,
    });
  }
  const spots = [{ x: 1, y: 1 }, { x: 10, y: 10 }, { x: 10, y: 1 }, { x: 1, y: 10 }];
  s.cities.forEach((c, k) => {
    c.x = spots[k].x;
    c.y = spots[k].y;
    tileAt(s, c.x, c.y).cityId = c.id;
    claimTerritory(s, c, 2);
  });
  s.units = [];
  for (const p of s.players) {
    p.explored = new Array(N * N).fill(1);
    p.stars = 100;
    p.techs = techs[p.id] ?? [];
    p.met = s.players.map((o) => o.id).filter((id) => id !== p.id);
  }
  s.current = 0;
  return s;
}

function put(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  u.done = false;
  u.canMove = true;
  u.canAttack = true;
  return u;
}
const set = (s: GameState, x: number, y: number, extra: Partial<Tile>) => Object.assign(tileAt(s, x, y), extra);
const acts = (s: GameState, pred: (a: Action) => boolean) => legalActions(s).filter(pred);
const canBuildAt = (s: GameState, b: string, x: number, y: number) =>
  legalActions(s).some((a) => a.type === "build" && a.building === b && a.at.x === x && a.at.y === y);
const unitIn = (s: GameState, id: number) => s.units.find((u) => u.id === id);
const canReach = (s: GameState, u: Unit, x: number, y: number) => reachable(s, u).some((m) => m.x === x && m.y === y);
/** end turns until it is player 0's turn again (one round) */
function round(s: GameState): GameState {
  let st = applyAction(s, { type: "endTurn" });
  while (st.current !== 0) st = applyAction(st, { type: "endTurn" });
  return st;
}

describe("Aquarion (2.18)", () => {
  it("tribe data: Shark replaces the Rammer, Jelly the Bomber; Waterways, Aquafishing and Marine Life", () => {
    const clan = CLAN_BY_ID.aquarion;
    expect(clan.unitReplacements).toMatchObject({ rammer: "shark", bomber: "jelly", dagger: "mermaidDagger" });
    expect(clan.techOverrides!.roads.name).toBe("Waterways");
    expect(clan.techOverrides!.fishing.name).toBe("Aquafishing");
    expect(clan.techOverrides!.sailing.name).toBe("Marine Life");
    expect(trainableUnitsFor("aquarion").map((u) => u.id)).toEqual(expect.arrayContaining(["shark", "jelly"]));
    expect(BUILDS.fertilize.cost).toBe(5);
    expect(BUILDS.canal.cost).toBe(0);
    expect(BUILDS.atoll.pop).toBe(0);
    expect(BUILDS.landfill).toBeUndefined();
  });

  it("Aquarion ships swim ocean and flooded land with no tech", () => {
    const s = blank(["aquarion", "imperius"]);
    set(s, 5, 5, { terrain: "water" });
    set(s, 6, 5, { terrain: "ocean" });
    const shark = put(s, "shark", 0, 5, 5);
    expect(canReach(s, shark, 6, 5)).toBe(true);
  });

  it("Canal: any territory, not on a flooded tile, needs a unit that has not moved and can attack", () => {
    const s = blank(["aquarion", "imperius"], [["roads"], []]);
    // neutral and enemy land
    const a = put(s, "mermaid", 0, 6, 6);
    const b = put(s, "mermaid", 0, 9, 9);
    expect(canBuildAt(s, "canal", 6, 6)).toBe(true);
    expect(canBuildAt(s, "canal", 9, 9)).toBe(true);
    set(s, 9, 9, { flooded: true });
    expect(canBuildAt(s, "canal", 9, 9)).toBe(false);
    a.moved = true;
    expect(canBuildAt(s, "canal", 6, 6)).toBe(false);
    void b;
    // no Waterways, no Canal
    const t = blank(["aquarion", "imperius"]);
    put(t, "mermaid", 0, 6, 6);
    expect(canBuildAt(t, "canal", 6, 6)).toBe(false);
  });

  it("a tile's flooding gives the amphibious unit on it a Bubble (with Waterways)", () => {
    const s = blank(["aquarion", "imperius"], [["roads"], []]);
    const m = put(s, "mermaid", 0, 2, 2);
    const next = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "canal" });
    expect(tileAt(next, 2, 2).flooded).toBe(true);
    expect(unitIn(next, m.id)!.bubble).toBe(true);
  });

  it("drain: Aquarion can't; other land units and amphibious units can; algae need a swimmer, flyer or amphibian", () => {
    const s = blank(["aquarion", "imperius"]);
    set(s, 2, 2, { flooded: true });
    put(s, "mermaid", 0, 2, 2);
    expect(acts(s, (a) => a.type === "drain")).toHaveLength(0);
    const r = blank(["imperius", "aquarion"]);
    set(r, 2, 2, { flooded: true });
    const w = put(r, "warrior", 0, 2, 2);
    expect(acts(r, (a) => a.type === "drain")).toEqual([{ type: "drain", unitId: w.id, effect: "flooded" }]);
    w.moved = true;
    w.canMove = false;
    expect(acts(r, (a) => a.type === "drain")).toHaveLength(0);
    // algae: a land unit standing on it can't clear it, a ship can
    const c = blank(["imperius", "cymanti"], [["sailing"], []]);
    set(c, 5, 5, { terrain: "water", algae: true });
    put(c, "warrior", 0, 5, 5);
    expect(acts(c, (a) => a.type === "drain")).toHaveLength(0);
    c.units = [];
    const ship = put(c, "raychi", 0, 5, 5);
    const clear = acts(c, (a) => a.type === "drain");
    expect(clear).toEqual([{ type: "drain", unitId: ship.id, effect: "algae" }]);
    expect(tileAt(applyAction(c, clear[0]), 5, 5).algae).toBe(false);
  });

  it("Fertilize (5★) needs wetland without a crop; Atoll goes on flooded land and water", () => {
    const s = blank(["aquarion", "imperius"], [["construction", "ramming"], []]);
    expect(canBuildAt(s, "fertilize", 2, 2)).toBe(false);
    set(s, 2, 2, { flooded: true });
    expect(canBuildAt(s, "fertilize", 2, 2)).toBe(true);
    expect(canBuildAt(s, "atoll", 2, 2)).toBe(true);
    set(s, 2, 2, { resource: "crop" });
    expect(canBuildAt(s, "fertilize", 2, 2)).toBe(false);
    set(s, 2, 2, { terrain: "forest", resource: null });
    expect(canBuildAt(s, "fertilize", 2, 2)).toBe(false); // a flooded forest is no wetland
    const stars = s.players[0].stars;
    set(s, 3, 3, { flooded: true });
    const next = applyAction(s, { type: "build", at: { x: 3, y: 3 }, building: "fertilize" });
    expect(next.players[0].stars).toBe(stars - 5);
    expect(tileAt(next, 3, 3).resource).toBe("crop");
  });

  it("Windmills count Aqua Farms; Pontoon lets Aquarion build field buildings on water", () => {
    const s = blank(["aquarion", "imperius"], [["construction", "ramming"], []]);
    s.cities[0].level = 9; // no level-up reward in between
    set(s, 2, 2, { terrain: "water", resource: "aquaCrop" });
    let next = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "aquaFarm" });
    set(next, 3, 2, { terrain: "water" });
    expect(canBuildAt(next, "windmill", 3, 2)).toBe(true);
    next = applyAction(next, { type: "build", at: { x: 3, y: 2 }, building: "windmill" });
    expect(tileAt(next, 3, 2).buildingLevel).toBe(1);
    // no Pontoon for others
    const r = blank(["imperius", "aquarion"], [["construction"], []]);
    set(r, 2, 2, { terrain: "water" });
    set(r, 2, 1, { building: "farm" });
    expect(canBuildAt(r, "windmill", 2, 2)).toBe(false);
  });

  it("a city captured by Aquarion floods; captured by another tribe it drains", () => {
    const s = blank(["aquarion", "imperius"]);
    const c = s.cities[1];
    const m = put(s, "mermaid", 0, c.x, c.y);
    const after = applyAction(s, { type: "capture", unitId: m.id });
    expect(tileAt(after, c.x, c.y).flooded).toBe(true);
    const r = blank(["imperius", "aquarion"]);
    const d = r.cities[1];
    set(r, d.x, d.y, { flooded: true });
    const w = put(r, "warrior", 0, d.x, d.y);
    expect(tileAt(applyAction(r, { type: "capture", unitId: w.id }), d.x, d.y).flooded).toBe(false);
  });
});

describe("Cymanti (2.18)", () => {
  it("tribe data: Algae replaces the Port; no Windmill, Burn Forest or Bridge; Fungi +1 population", () => {
    expect(buildAllowedFor("cymanti", "port")).toBe(false);
    expect(buildAllowedFor("cymanti", "algae")).toBe(true);
    for (const b of ["windmill", "burnForest", "bridge"]) expect(buildAllowedFor("cymanti", b)).toBe(false);
    expect(BUILDS.fungi.pop).toBe(1);
    expect(BUILDS.mycelium.onePerCity).toBe(true);
  });

  it("Mycelium heals the own unit on it and next to it at the end of the turn (a poisoned one is cured)", () => {
    const s = blank(["cymanti", "imperius"]);
    set(s, 2, 2, { building: "mycelium" });
    const on = put(s, "kiton", 0, 2, 2);
    const next = put(s, "kiton", 0, 3, 3);
    const far = put(s, "kiton", 0, 5, 5);
    const sick = put(s, "kiton", 0, 2, 3);
    const idle = put(s, "kiton", 0, 1, 1);
    for (const u of [on, next, far, sick, idle]) u.hp = 5;
    // these acted this turn, so only the Mycelium heals them (no end-of-turn recover)
    for (const u of [on, next, far, sick]) u.moved = true;
    sick.poisoned = true;
    const after = applyAction(s, { type: "endTurn" });
    // an idle unit next to the Mycelium gets both heals (reference turns.rs end_command)
    expect(unitIn(after, idle.id)!.hp).toBeGreaterThan(9);
    expect(unitIn(after, on.id)!.hp).toBe(9);
    expect(unitIn(after, next.id)!.hp).toBe(9);
    expect(unitIn(after, far.id)!.hp).toBe(5);
    expect(unitIn(after, sick.id)!.hp).toBe(5);
    expect(unitIn(after, sick.id)!.poisoned).toBe(false);
  });

  it("Fungi: +1 population, one level (+1) a turn later, a second with Microbes (Recycling)", () => {
    const s = blank(["cymanti", "imperius"], [["farming"], []]);
    set(s, 2, 2, { resource: "spores" });
    const cap = s.cities[0];
    const pop0 = cap.level * 100 + cap.pop;
    let st = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "fungi" });
    const popOf = (g: GameState) => {
      const c = g.cities.find((x) => x.id === cap.id)!;
      return c.level * 100 + c.pop;
    };
    expect(popOf(st)).toBe(pop0 + 1);
    st = round(st);
    expect(tileAt(st, 2, 2).buildingLevel).toBe(1);
    st = round(st);
    expect(tileAt(st, 2, 2).buildingLevel).toBe(1);
    st.players[0].techs.push("construction");
    st = round(st);
    expect(tileAt(st, 2, 2).buildingLevel).toBe(2);
  });

  it("Fungi poison every non-Cymanti unit that steps on them, unless it flies", () => {
    const s = blank(["imperius", "cymanti"]);
    set(s, 9, 9, { building: "fungi" });
    set(s, 9, 8, { building: "fungi" });
    const w = put(s, "warrior", 0, 8, 8);
    const after = applyAction(s, { type: "move", unitId: w.id, to: { x: 9, y: 9 } });
    expect(unitIn(after, w.id)!.poisoned).toBe(true);
    const c = blank(["cymanti", "imperius"]);
    set(c, 2, 2, { building: "fungi" });
    const k = put(c, "kiton", 0, 2, 3);
    expect(unitIn(applyAction(c, { type: "move", unitId: k.id, to: { x: 2, y: 2 } }), k.id)!.poisoned).toBeFalsy();
  });

  it("Clathrus needs an adjacent own Fungi, goes on any terrain, one per city, 8★ at most", () => {
    const s = blank(["cymanti", "imperius"], [["trade"], []]);
    set(s, 2, 2, { terrain: "water" });
    expect(canBuildAt(s, "clathrus", 2, 2)).toBe(false);
    set(s, 2, 3, { building: "fungi" });
    expect(canBuildAt(s, "clathrus", 2, 2)).toBe(true);
    const base = income(s, 0);
    let st = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "clathrus" });
    expect(canBuildAt(st, "clathrus", 3, 3)).toBe(false);
    for (const [x, y] of [[1, 1], [1, 2], [1, 3], [2, 1], [3, 1], [3, 2], [3, 3]]) set(st, x, y, { building: "fungi" });
    expect(income(st, 0) - base).toBe(8);
    void st;
  });

  it("Decompose (Recycling): refunds the full cost at turn end, removes the building and its population", () => {
    const s = blank(["cymanti", "imperius"], [["construction", "farming"], []]);
    set(s, 2, 2, { resource: "spores" });
    let st = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "fungi" });
    const stars = st.players[0].stars;
    const popAfterBuild = st.cities[0].level * 100 + st.cities[0].pop;
    const dec = acts(st, (a) => a.type === "decompose");
    expect(dec).toContainEqual({ type: "decompose", at: { x: 2, y: 2 } });
    st = applyAction(st, { type: "decompose", at: { x: 2, y: 2 } });
    expect(tileAt(st, 2, 2).decomposing).toBe(true);
    expect(observe(st, 0).planes[CHANNELS.indexOf("decomposing") * N * N + 2 * N + 2]).toBe(1);
    expect(acts(st, (a) => a.type === "decompose" && a.at.x === 2 && a.at.y === 2)).toHaveLength(0);
    st = applyAction(st, { type: "endTurn" });
    expect(st.players[0].stars).toBe(stars + 5);
    expect(tileAt(st, 2, 2).building).toBeNull();
    expect(tileAt(st, 2, 2).resource).toBe("spores");
    expect(st.cities[0].level * 100 + st.cities[0].pop).toBe(popAfterBuild - 1);
    // no Recycling, no Decompose
    const r = blank(["cymanti", "imperius"]);
    set(r, 2, 2, { building: "mycelium" });
    expect(acts(r, (a) => a.type === "decompose")).toHaveLength(0);
  });

  it("a poisoned unit killed on water leaves spores and algae", () => {
    const s = blank(["cymanti", "imperius"], [[], ["sailing"]]);
    set(s, 5, 5, { terrain: "water" });
    const e = put(s, "scout", 1, 5, 5);
    e.carried = "warrior";
    e.hp = 1;
    e.poisoned = true;
    const k = put(s, "mantis", 0, 5, 4);
    const after = applyAction(s, { type: "attack", unitId: k.id, targetId: e.id });
    expect(tileAt(after, 5, 5).resource).toBe("spores");
    expect(tileAt(after, 5, 5).algae).toBe(true);
  });

  it("Centipede: a kill grows a Segment even without advancing; when the head dies the first Segment leads", () => {
    const s = blank(["cymanti", "imperius"]);
    const c = put(s, "centipede", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 5);
    e.hp = 1;
    put(s, "kiton", 0, 6, 4);
    let st = applyAction(s, { type: "attack", unitId: c.id, targetId: e.id });
    const segs = st.units.filter((u) => u.bodyOf === c.id);
    expect(segs).toHaveLength(1);
    // the second segment
    const head = unitIn(st, c.id)!;
    const seg2 = makeUnit(st, "segment", 0, { x: 2, y: 8 }, null);
    seg2.bodyOf = head.id;
    // the head dies
    st.current = 1;
    head.hp = 1;
    const killer = put(st, "swordsman", 1, head.x + 1, head.y + 1);
    st = applyAction(st, { type: "attack", unitId: killer.id, targetId: head.id });
    expect(unitIn(st, c.id)).toBeUndefined();
    const lead = unitIn(st, segs[0].id)!;
    expect(lead.type).toBe("centipede");
    expect(lead.bodyOf).toBeUndefined();
    expect(unitIn(st, seg2.id)!.bodyOf).toBe(lead.id);
  });

  it("Algae (Fishing): open water, algae with a fruit", () => {
    const s = blank(["cymanti", "imperius"], [["fishing"], []]);
    set(s, 2, 2, { terrain: "water" });
    expect(canBuildAt(s, "algae", 2, 2)).toBe(true);
    const st = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "algae" });
    expect(tileAt(st, 2, 2).algae).toBe(true);
    expect(tileAt(st, 2, 2).resource).toBe("fruit");
    expect(canBuildAt(st, "algae", 2, 2)).toBe(false);
  });
});

describe("Polaris (2.18)", () => {
  it("Ice Bank: 2★ per level, a level per 20 ice or Polaris-land tiles, at most 30 levels", () => {
    const s = blank(["polaris", "imperius"], [["trade"], []]);
    for (let i = 0; i < 45; i++) s.tiles[i + 40].polar = true;
    expect(iceBankLevel(s)).toBe(2);
    const base = income(s, 0);
    set(s, 2, 2, { building: "iceBank" });
    expect(income(s, 0) - base).toBe(4);
    for (const t of s.tiles) t.polar = true;
    expect(iceBankLevel(s)).toBe(Math.min(30, Math.floor((N * N) / 20)));
  });

  it("Ice Bank on field or ice, once per player even after it is gone", () => {
    const s = blank(["polaris", "imperius"], [["trade"], []]);
    set(s, 2, 2, { terrain: "water", ice: true });
    set(s, 3, 3, { terrain: "water" });
    expect(canBuildAt(s, "iceBank", 2, 2)).toBe(true);
    expect(canBuildAt(s, "iceBank", 3, 3)).toBe(false);
    const st = applyAction(s, { type: "build", at: { x: 2, y: 1 }, building: "iceBank" });
    set(st, 2, 1, { building: null });
    expect(canBuildAt(st, "iceBank", 2, 2)).toBe(false);
  });

  it("a new game marks the land of the Polaris area as Polaris land", () => {
    const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed: 7, clans: ["polaris", "imperius"] });
    const cap = s.cities[0];
    expect(tileAt(s, cap.x, cap.y).polar).toBe(true);
    const other = s.cities[1];
    expect(tileAt(s, other.x, other.y).polar).toBeFalsy();
  });
});

describe("Elyrion (2.18)", () => {
  it("Sanctuary replaces Clear Forest; needs adjacent own forest; field, forest or mountain; one per city", () => {
    expect(buildAllowedFor("elyrion", "clearForest")).toBe(false);
    const s = blank(["elyrion", "imperius"], [["forestry"], []]);
    expect(canBuildAt(s, "sanctuary", 2, 2)).toBe(false);
    set(s, 3, 3, { terrain: "forest" });
    set(s, 2, 2, { terrain: "mountain" });
    expect(canBuildAt(s, "sanctuary", 2, 2)).toBe(true);
    const st = applyAction(s, { type: "build", at: { x: 2, y: 2 }, building: "sanctuary" });
    set(st, 3, 2, { terrain: "forest" });
    expect(canBuildAt(st, "sanctuary", 2, 3)).toBe(false);
  });

  it("Sanctuary: 1★ per adjacent own animal without a building (8 at most); animals on the first free forest, x-major", () => {
    const s = blank(["elyrion", "imperius"]);
    const base = income(s, 0);
    set(s, 2, 2, { building: "sanctuary", builtTurn: s.turn });
    for (const [x, y] of [[1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3]]) set(s, x, y, { resource: "animal" });
    set(s, 3, 3, { building: "lumberHut" });
    expect(income(s, 0) - base).toBe(6);
    // spawning
    const t = blank(["elyrion", "imperius"]);
    set(t, 2, 2, { building: "sanctuary", builtTurn: t.turn });
    for (const [x, y] of [[3, 3], [2, 3], [3, 1]]) set(t, x, y, { terrain: "forest" });
    let st = round(t);
    expect([[3, 3], [2, 3], [3, 1]].filter(([x, y]) => tileAt(st, x, y).resource === "animal")).toHaveLength(0);
    st = round(st);
    expect(tileAt(st, 2, 3).resource).toBe("animal");
    st = round(round(st));
    expect(tileAt(st, 3, 1).resource).toBe("animal");
  });
});
