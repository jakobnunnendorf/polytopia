/**
 * Rules parity for Polaris, Cymanti and Elyrion (POLYTOPIA_RULES.md, Units,
 * Unit skills and movement, Tribes > Special tribes, Temples, Monuments).
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { BUILDS, UNITS, buildAllowedFor, trainableUnitsFor } from "@/logic/engine/data";
import { computeDamageRounded } from "@/logic/engine/combat";
import { idx, tileAt } from "@/logic/engine/grid";
import { reachable } from "@/logic/engine/movement";
import { observe, CHANNELS } from "@/logic/engine/observe";
import { claimTerritory, createGame, income, makeUnit, updateConnections } from "@/logic/engine/state";
import type { Action, GameState, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12×12 all-field map, everything explored, capitals at (1,1) and (10,10), no units */
function blank(clans: string[]): GameState {
  const s = createGame({ mapSize: N, players: clans.length, mode: "domination", seed: 3, clans });
  for (const t of s.tiles) {
    Object.assign(t, {
      terrain: "field", resource: null, building: null, buildingLevel: 0, road: false, cityId: null,
      village: false, ruin: false, lighthouse: false, territory: null, ice: false, algae: false, polar: false,
    });
  }
  const spots = [{ x: 1, y: 1 }, { x: 10, y: 10 }, { x: 10, y: 1 }, { x: 1, y: 10 }];
  s.cities.forEach((c, k) => {
    c.x = spots[k].x;
    c.y = spots[k].y;
    tileAt(s, c.x, c.y).cityId = c.id;
    claimTerritory(s, c, 1);
  });
  s.units = [];
  for (const p of s.players) {
    p.explored = new Array(N * N).fill(1);
    p.stars = 100;
    p.met = s.players.map((o) => o.id).filter((id) => id !== p.id);
  }
  s.current = 0;
  return s;
}

function unit(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  u.done = false;
  u.canMove = true;
  u.canAttack = true;
  return u;
}

const water = (s: GameState, x: number, y: number, ice = false) => {
  const t = tileAt(s, x, y);
  t.terrain = "water";
  t.ice = ice;
};
const find = (s: GameState, pred: (a: Action) => boolean) => legalActions(s).find(pred);
const reach = (s: GameState, u: Unit) => reachable(s, u).map((m) => `${m.x},${m.y}`);

describe("Polaris", () => {
  it("Mooni has Skate, Auto Freeze, Stiff (not Static: game data) and no Freeze Area", () => {
    expect(UNITS.mooni.skills.sort()).toEqual(["autoFreeze", "skate", "stiff"]);
    expect(UNITS.gaami.skills).toContain("freezeArea");
  });

  it("Auto Freeze turns adjacent water to ice (not land) and freezes enemies; freezing counts as an attack", () => {
    const s = blank(["polaris", "imperius"]);
    water(s, 5, 5, true);
    water(s, 6, 5);
    water(s, 6, 6);
    const m = unit(s, "mooni", 0, 4, 5);
    const e = unit(s, "warrior", 1, 6, 4);
    const next = applyAction(s, { type: "move", unitId: m.id, to: { x: 5, y: 5 } });
    expect(tileAt(next, 6, 5).ice).toBe(true);
    expect(tileAt(next, 6, 6).ice).toBe(true);
    expect(tileAt(next, 4, 5).ice).toBeFalsy();
    expect(tileAt(next, 4, 5).polar).toBeFalsy();
    expect(next.units.find((u) => u.id === e.id)!.frozen).toBe(true);
    expect(next.players[0].attackedThisTurn).toBe(true);
  });

  it("Freeze Area turns water to ice and land to Polaris terrain, never inside enemy territory", () => {
    const s = blank(["polaris", "imperius"]);
    const g = unit(s, "gaami", 0, 8, 8); // (9,9) is inside the enemy capital's territory
    water(s, 7, 7);
    const a = find(s, (x) => x.type === "freezeArea" && x.unitId === g.id)!;
    const next = applyAction(s, a);
    expect(tileAt(next, 7, 7).ice).toBe(true);
    expect(tileAt(next, 8, 7).polar).toBe(true);
    expect(tileAt(next, 9, 9).polar).toBeFalsy();
    expect(tileAt(next, 9, 9).ice).toBeFalsy();
  });

  it("Skate: ice steps cost 1, Battle Sled moves 3 from ice, Glide (Polarism) adds about one tile", () => {
    const s = blank(["polaris", "imperius"]);
    for (let x = 2; x <= 9; x++) water(s, x, 5, true);
    for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) if (y !== 5) tileAt(s, x, y).terrain = "mountain";
    const sled = unit(s, "battleSled", 0, 2, 5);
    const far = () => Math.max(...reachable(s, sled).filter((m) => m.y === 5).map((m) => m.x));
    expect(far()).toBe(5);
    s.players[0].techs.push("aquatism");
    expect(far()).toBe(6);
  });

  it("Skate: on land at most 1 tile, no attack after ending on land, no road bonus", () => {
    const s = blank(["polaris", "imperius"]);
    for (let x = 3; x <= 8; x++) tileAt(s, x, 5).road = true;
    const sled = unit(s, "battleSled", 0, 4, 5);
    const r = reachable(s, sled);
    expect(Math.max(...r.map((m) => Math.abs(m.x - 4)))).toBe(1);
    unit(s, "warrior", 1, 6, 6);
    const next = applyAction(s, { type: "move", unitId: sled.id, to: { x: 5, y: 5 } });
    expect(next.units.find((u) => u.id === sled.id)!.canAttack).toBe(false);
  });

  it("roads give no bonus on ice", () => {
    const s = blank(["imperius", "polaris"]);
    // bridge on frozen water between two road tiles: a rider can't chain road steps through it
    for (let x = 2; x <= 9; x++) tileAt(s, x, 5).road = true;
    water(s, 5, 5, true);
    tileAt(s, 5, 5).road = false;
    tileAt(s, 5, 5).building = "bridge";
    for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) if (y !== 5) tileAt(s, x, y).terrain = "mountain";
    const r = unit(s, "rider", 0, 3, 5);
    const far = Math.max(...reachable(s, r).map((m) => m.x));
    // 3->4 road 0.5, 4->5 ice 1 (total 1.5), 5->6 ice 1 (2.5): stops at 6
    expect(far).toBe(6);
  });

  it("Ice Temple replaces the Water Temple and needs ice; Outpost needs ice; one Ice Bank per tribe", () => {
    expect(buildAllowedFor("polaris", "iceTemple")).toBe(true);
    expect(buildAllowedFor("polaris", "waterTemple")).toBe(false);
    expect(buildAllowedFor("imperius", "iceTemple")).toBe(false);
    expect(BUILDS.iceTemple).toMatchObject({ cost: 20, tech: "aquatism", kind: "temple", pop: 1 });
    const s = blank(["polaris", "imperius"]);
    s.players[0].techs.push("aquatism", "roads", "trade");
    water(s, 2, 1, true);
    water(s, 2, 2);
    const builds = legalActions(s).filter((a) => a.type === "build") as Extract<Action, { type: "build" }>[];
    const at = (b: string) => builds.filter((a) => a.building === b).map((a) => `${a.at.x},${a.at.y}`);
    expect(at("iceTemple")).toEqual(["2,1"]);
    expect(at("outpost")).toEqual(["2,1"]);
    expect(at("iceBank").length).toBeGreaterThan(0);
    const next = applyAction(s, find(s, (a) => a.type === "build" && a.building === "iceBank")!);
    expect(legalActions(next).some((a) => a.type === "build" && a.building === "iceBank")).toBe(false);
  });

  it("Polaris fish with Ice Fishing (ramming); keeps the Catapult; Ice Fortress from Polar Warfare", () => {
    const s = blank(["polaris", "imperius"]);
    water(s, 2, 2, true);
    tileAt(s, 2, 2).resource = "fish";
    const canFish = (st: GameState) => legalActions(st).some((a) => a.type === "build" && a.building === "fish");
    expect(canFish(s)).toBe(false);
    s.players[0].techs.push("ramming");
    expect(canFish(s)).toBe(true);
    const roster = trainableUnitsFor("polaris").map((u) => u.id);
    expect(roster).toContain("catapult");
    expect(roster).toContain("iceFortress");
    expect(UNITS.iceFortress.tech).toBe("navigation");
  });

  it("Outposts link cities like ports", () => {
    const s = blank(["polaris", "imperius", "imperius"]);
    // third city at (10,1) belongs to Polaris; frozen sea between the two
    const c = s.cities[2];
    c.owner = 0;
    c.capital = false;
    for (let x = 2; x <= 6; x++) water(s, x, 1, true);
    tileAt(s, 2, 1).building = "outpost";
    tileAt(s, 2, 1).territory = s.cities[0].id;
    tileAt(s, 6, 1).building = "outpost";
    tileAt(s, 6, 1).territory = c.id;
    for (let x = 7; x <= 9; x++) tileAt(s, x, 1).road = true;
    updateConnections(s, 0);
    expect(c.connected).toBe(true);
  });

  it("Dash breaks ice; a captured Polaris city's land loses the Polaris style", () => {
    const s = blank(["imperius", "polaris"]);
    water(s, 6, 5, true);
    const w = unit(s, "warrior", 0, 5, 5);
    const a = find(s, (x) => x.type === "breakIce" && x.unitId === w.id)!;
    expect(a).toBeTruthy();
    const next = applyAction(s, a);
    expect(tileAt(next, 6, 5).ice).toBe(false);

    const t = blank(["imperius", "polaris"]);
    const pc = t.cities[1];
    tileAt(t, 9, 9).polar = true;
    const cap = unit(t, "warrior", 0, pc.x, pc.y);
    const after = applyAction(t, { type: "capture", unitId: cap.id });
    expect(tileAt(after, 9, 9).polar).toBe(false);
  });
});

describe("Cymanti", () => {
  it("unit skills follow the unit table", () => {
    expect(UNITS.hexapod.skills).toContain("sneak");
    expect(UNITS.hexapod.skills).not.toContain("hide");
    expect(UNITS.moth.skills).toContain("sneak");
    expect(UNITS.shaman.skills).not.toContain("stiff");
    expect(UNITS.phychi.skills).toContain("doubleAttack");
    expect(UNITS.kiton.skills).not.toContain("poison");
    expect(UNITS.insectEgg).toMatchObject({ hp: 10, attack: 2, defence: 3, movement: 0 });
    expect(UNITS.larva).toMatchObject({ hp: 10, attack: 2, defence: 2, movement: 1 });
  });

  it("Swarm gives +1 movement, no attack bonus, and ends when the unit is attacked", () => {
    const s = blank(["cymanti", "imperius"]);
    s.players[0].techs.push("meditation");
    const sh = unit(s, "shaman", 0, 5, 5);
    const m = unit(s, "mantis", 0, 5, 6);
    const e = unit(s, "warrior", 1, 8, 8);
    const before = computeDamageRounded(s, m, e).damage;
    let next = applyAction(s, find(s, (a) => a.type === "swarm" && a.unitId === sh.id)!);
    const mm = next.units.find((u) => u.id === m.id)!;
    expect(mm.swarmed).toBe(true);
    expect(computeDamageRounded(next, mm, e).damage).toBe(before);
    expect(Math.max(...reachable(next, mm).map((q) => Math.abs(q.y - 6)))).toBe(2);
    next.current = 1;
    const ee = next.units.find((u) => u.id === e.id)!;
    ee.x = 5;
    ee.y = 7;
    ee.canAttack = true;
    ee.done = false;
    next = applyAction(next, { type: "attack", unitId: ee.id, targetId: m.id });
    expect(next.units.find((u) => u.id === m.id)!.swarmed).toBe(false);
  });

  it("conversions don't count as attacks; Cymanti complete the convert task (Cult of Ciru) by 3 Shaman conversions", () => {
    const s = blank(["cymanti", "imperius"]);
    let st = s;
    for (let k = 0; k < 3; k++) {
      const sh = unit(st, "shaman", 0, 5, 5 + k);
      const e = unit(st, "warrior", 1, 6, 5 + k);
      st = applyAction(st, { type: "attack", unitId: sh.id, targetId: e.id });
    }
    expect(st.players[0].attackedThisTurn).toBe(false);
    expect(st.players[0].conversions).toBe(3);
    expect(st.players[0].tasks).toContain("convert");
  });

  it("Mycelium replaces roads and links cities within 3 tiles", () => {
    expect(buildAllowedFor("cymanti", "road")).toBe(false);
    expect(buildAllowedFor("cymanti", "mycelium")).toBe(true);
    // 2.18 (S1): Recycling replaces Construction, so no Windmill
    expect(buildAllowedFor("cymanti", "windmill")).toBe(false);
    expect(BUILDS.mycelium.tech).toBe("roads");
    const s = blank(["cymanti", "imperius", "imperius"]);
    const c = s.cities[2];
    c.owner = 0;
    c.capital = false;
    c.x = 6;
    c.y = 1;
    tileAt(s, 10, 1).cityId = null;
    tileAt(s, 6, 1).cityId = c.id;
    tileAt(s, 3, 1).building = "mycelium";
    tileAt(s, 3, 1).territory = s.cities[0].id;
    updateConnections(s, 0);
    expect(c.connected).toBe(true);
  });

  // 2.18 (S1): Clathrus needs no spores; it earns 1★ per adjacent own Fungi (max 8), not per algae
  it("Clathrus earns +1★ per adjacent own Fungi; algae earn nothing", () => {
    expect(BUILDS.clathrus.resource).toBeUndefined();
    expect(BUILDS.fungi.resource).toBe("spores");
    const s = blank(["cymanti", "imperius"]);
    claimTerritory(s, s.cities[0], 2);
    const base = income(s, 0);
    tileAt(s, 2, 2).building = "clathrus";
    for (const [x, y] of [[3, 3], [3, 2]]) {
      water(s, x, y);
      tileAt(s, x, y).algae = true;
    }
    tileAt(s, 1, 2).building = "fungi";
    tileAt(s, 2, 1).building = "fungi";
    expect(income(s, 0) - base).toBe(2);
  });

  // 2.18 (S1 Poison reward): the city rebels (no income next turn) but pays no stars
  it("Moth infiltration poisons the defender, lays Insect Eggs, the city rebels, no stars; eggs grow into Larva then Moth", () => {
    const s = blank(["cymanti", "imperius"]);
    const ec = s.cities[1];
    ec.level = 2;
    const moth = unit(s, "moth", 0, 9, 8);
    const def = unit(s, "warrior", 1, ec.x, ec.y);
    const stars = s.players[0].stars;
    let st = applyAction(s, { type: "infiltrate", unitId: moth.id, cityId: ec.id });
    expect(st.players[0].stars).toBe(stars);
    expect(st.cities[1].riot).toBe(true);
    expect(st.units.find((u) => u.id === def.id)!.poisoned).toBe(true);
    const eggs = st.units.filter((u) => u.type === "insectEgg" && u.owner === 0);
    expect(eggs).toHaveLength(2);
    expect(st.units.some((u) => u.type === "dagger")).toBe(false);
    const id = eggs[0].id;
    const round = () => {
      st = applyAction(st, { type: "endTurn" });
      while (st.current !== 0) st = applyAction(st, { type: "endTurn" });
    };
    round();
    expect(st.units.find((u) => u.id === id)?.type).toBe("larva");
    round();
    round();
    expect(st.units.find((u) => u.id === id)?.type).toBe("larva");
    round();
    expect(st.units.find((u) => u.id === id)?.type).toBe("moth");
  });

  it("Phychi attacks twice per turn", () => {
    const s = blank(["cymanti", "imperius"]);
    const ph = unit(s, "phychi", 0, 5, 5);
    const e = unit(s, "giant", 1, 6, 6);
    let st = applyAction(s, { type: "attack", unitId: ph.id, targetId: e.id });
    expect(st.units.find((u) => u.id === ph.id)!.canAttack).toBe(true);
    st = applyAction(st, { type: "attack", unitId: ph.id, targetId: e.id });
    expect(st.units.find((u) => u.id === ph.id)!.canAttack).toBe(false);
    expect(legalActions(st).some((a) => a.type === "attack" && a.unitId === ph.id)).toBe(false);
  });

  it("Kiton poisons units that attack it, ranged ones too", () => {
    const s = blank(["imperius", "cymanti"]);
    const ar = unit(s, "archer", 0, 5, 5);
    const k = unit(s, "kiton", 1, 7, 5);
    const st = applyAction(s, { type: "attack", unitId: ar.id, targetId: k.id });
    expect(st.units.find((u) => u.id === ar.id)!.poisoned).toBe(true);
  });

  it("Centipede: segments belong to the body, it moves 1 tile with segments, segments exert no ZoC, converting one converts all", () => {
    const s = blank(["cymanti", "imperius"]);
    const c = unit(s, "centipede", 0, 5, 5);
    const e = unit(s, "warrior", 1, 6, 5);
    e.hp = 1;
    let st = applyAction(s, { type: "attack", unitId: c.id, targetId: e.id });
    const seg = st.units.find((u) => u.type === "segment")!;
    expect(seg.bodyOf).toBe(c.id);
    const head = st.units.find((u) => u.id === c.id)!;
    head.canMove = true;
    head.done = false;
    head.moved = false;
    expect(Math.max(...reachable(st, head).map((q) => Math.max(Math.abs(q.x - head.x), Math.abs(q.y - head.y))))).toBe(1);
    // a Mind Bender converting the segment converts the whole Centipede
    st.players[1].techs.push("philosophy");
    const mb = unit(st, "mindBender", 1, seg.x, seg.y + 1);
    st = applyAction(st, { type: "attack", unitId: mb.id, targetId: seg.id });
    expect(st.units.find((u) => u.id === c.id)!.owner).toBe(1);
    expect(st.units.find((u) => u.id === seg.id)!.owner).toBe(1);
  });

  it("Centipede segments exert no zone of control", () => {
    const s = blank(["imperius", "cymanti"]);
    for (let x = 2; x <= 9; x++) for (let y = 2; y <= 9; y++) if (y !== 5) tileAt(s, x, y).terrain = "mountain";
    const r = unit(s, "rider", 0, 3, 5);
    const seg = unit(s, "segment", 1, 5, 6);
    expect(reach(s, r)).toContain("5,5");
    seg.type = "warrior";
    expect(reach(s, r)).not.toContain("5,5");
  });

  it("algae ends a land unit's move; a poisoned unit's death leaves spores on land", () => {
    const s = blank(["imperius", "cymanti"]);
    for (let x = 2; x <= 9; x++) for (let y = 2; y <= 9; y++) if (y !== 5) tileAt(s, x, y).terrain = "mountain";
    water(s, 5, 5);
    tileAt(s, 5, 5).algae = true;
    const r = unit(s, "rider", 0, 4, 5);
    expect(reach(s, r)).toContain("5,5");
    expect(reach(s, r)).not.toContain("6,5");

    const t = blank(["imperius", "cymanti"]);
    const sw = unit(t, "swordsman", 0, 5, 5);
    const v = unit(t, "phychi", 1, 6, 5);
    v.poisoned = true;
    const after = applyAction(t, { type: "attack", unitId: sw.id, targetId: v.id });
    expect(after.units.some((u) => u.id === v.id)).toBe(false);
    expect(tileAt(after, 6, 5).resource).toBe("spores");
  });

  it("Living Island leaves algae on the water it passes", () => {
    const s = blank(["cymanti", "imperius"]);
    for (let x = 3; x <= 7; x++) water(s, x, 5);
    s.players[0].techs.push("fishing");
    const li = unit(s, "livingIsland", 0, 3, 5);
    const st = applyAction(s, { type: "move", unitId: li.id, to: { x: 5, y: 5 } });
    expect(tileAt(st, 3, 5).algae).toBe(true);
    expect(tileAt(st, 4, 5).algae).toBe(true);
  });

  it("Raychi trains only in cities next to water; Mountain Temple needs Mysticism", () => {
    const s = blank(["cymanti", "imperius"]);
    s.players[0].techs.push("sailing", "meditation", "climbing");
    const trains = (st: GameState) => legalActions(st).some((a) => a.type === "train" && a.unit === "raychi");
    expect(trains(s)).toBe(false);
    water(s, 2, 2);
    expect(trains(s)).toBe(true);
    tileAt(s, 0, 0).terrain = "mountain";
    const mt = (st: GameState) => legalActions(st).some((a) => a.type === "build" && a.building === "mountainTemple");
    expect(mt(s)).toBe(false);
    s.players[0].techs.push("philosophy");
    expect(mt(s)).toBe(true);
  });
});

describe("Elyrion", () => {
  it("Sanctuary: +1★ per adjacent wild animal, a new animal every 2 turns, Sawmill kept", () => {
    expect(buildAllowedFor("elyrion", "sawmill")).toBe(true);
    expect(buildAllowedFor("elyrion", "sanctuary")).toBe(true);
    const s = blank(["elyrion", "imperius"]);
    // 2.18 (S1): only own tiles count and receive animals
    claimTerritory(s, s.cities[0], 2);
    const base = income(s, 0);
    tileAt(s, 2, 2).building = "sanctuary";
    tileAt(s, 2, 2).builtTurn = s.turn;
    for (const [x, y] of [[3, 3], [3, 2], [2, 3]]) tileAt(s, x, y).terrain = "forest";
    tileAt(s, 3, 3).resource = "animal";
    expect(income(s, 0) - base).toBe(1);
    let st = s;
    const animals = () => [[3, 2], [2, 3]].filter(([x, y]) => tileAt(st, x, y).resource === "animal").length;
    const round = () => {
      st = applyAction(st, { type: "endTurn" });
      while (st.current !== 0) st = applyAction(st, { type: "endTurn" });
    };
    round();
    expect(animals()).toBe(0);
    round();
    expect(animals()).toBe(1);
  });

  it("Elyrion see ruins through clouds in the observation", () => {
    const s = blank(["elyrion", "imperius"]);
    for (const p of s.players) p.explored = new Array(N * N).fill(0);
    tileAt(s, 6, 6).ruin = true;
    const plane = (p: number) => observe(s, p).planes[CHANNELS.indexOf("ruin") * N * N + idx(N, 6, 6)];
    expect(plane(0)).toBe(1);
    expect(plane(1)).toBe(0);
  });

  it("grown dragons keep their damage", () => {
    const s = blank(["elyrion", "imperius"]);
    const egg = unit(s, "dragonEgg", 0, 5, 5);
    egg.hp = 6;
    egg.age = 2;
    egg.moved = true; // no end-of-turn heal
    let st = applyAction(s, { type: "endTurn" });
    while (st.current !== 0) st = applyAction(st, { type: "endTurn" });
    const d = st.units.find((u) => u.id === egg.id)!;
    expect(d.type).toBe("babyDragon");
    expect(d.hp).toBe(UNITS.babyDragon.hp! - 4);
  });
});
