/**
 * Special-tribe parity, second audit (docs/RULES_PARITY.md, "2.18 data corrections: special tribes",
 * audit 2): Centipede chains, Kiton, Swarm, Creep, Tentacles, Polaris freezing and ice breaking,
 * skater Escape, conversion, Polaris starting land and Aqua Crops, as polybots-engine (S1) has them.
 * One test per audit item.
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { BUILDS, CLAN_BY_ID, UNITS } from "@/logic/engine/data";
import { computeDamageRounded } from "@/logic/engine/combat";
import { tileAt } from "@/logic/engine/grid";
import { generateMap } from "@/logic/engine/mapgen";
import { reachable } from "@/logic/engine/movement";
import { createRng } from "@/logic/engine/rng";
import { claimTerritory, createGame, makeUnit, resourceVisible } from "@/logic/engine/state";
import type { Action, GameState, Tile, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12×12 all-field map, everything explored, capitals at (1,1) and (10,10), no units */
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
    claimTerritory(s, c, 1);
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
const unitIn = (s: GameState, id: number) => s.units.find((u) => u.id === id);
const optionsOf = (s: GameState, u: Unit) => legalActions(s).filter((a: Action) => "unitId" in a && a.unitId === u.id);

/** a Centipede at `at` with Segments on the given tiles, in chain order */
function chain(s: GameState, owner: number, head: [number, number], segs: [number, number][]) {
  const h = put(s, "centipede", owner, head[0], head[1]);
  const body = segs.map(([x, y]) => {
    const g = put(s, "segment", owner, x, y);
    g.bodyOf = h.id;
    return g;
  });
  return { h, body };
}

describe("Cymanti: Centipede chains (S1 cymanti.rs, step.rs, attack.rs, linked.rs)", () => {
  it("1. exploding a body part sets off the tail behind it; the part in front lets go", () => {
    const s = blank(["cymanti", "imperius"]);
    const { h, body } = chain(s, 0, [6, 5], [[5, 5], [4, 5], [3, 5]]);
    const e = put(s, "warrior", 1, 4, 6);
    const st = applyAction(s, { type: "explode", unitId: body[1].id });
    expect(unitIn(st, body[1].id)).toBeUndefined();
    expect(unitIn(st, body[2].id)).toBeUndefined();
    expect(unitIn(st, h.id)).toBeDefined();
    expect(unitIn(st, body[0].id)!.bodyOf).toBe(h.id);
    // the enemy next to both exploding parts took two blasts
    expect(unitIn(st, e.id)!.hp).toBeLessThan(10 - computeDamageRounded(s, body[1], e).damage / 2);
  });

  it("2. Segments don't act alone; the body follows the head at the first Segment's pace", () => {
    const s = blank(["cymanti", "imperius"], [["freeSpirit"], []]);
    const { h, body } = chain(s, 0, [5, 5], [[4, 5], [3, 5], [2, 5]]);
    set(s, 4, 5, { ruin: true });
    body[0].hp = 5;
    put(s, "warrior", 1, 4, 6);
    const kinds = optionsOf(s, body[0]).map((a) => a.type);
    for (const k of ["move", "attack", "capture", "examine", "recover", "disband"]) expect(kinds).not.toContain(k);
    // the chain's speed is its first Segment's: 1, or 2 when that Segment is Swift
    const far = (st: GameState) => Math.max(...reachable(st, unitIn(st, h.id)!).map((q) => Math.abs(q.x - 5)));
    expect(far(s)).toBe(1);
    body[0].swarmed = true;
    expect(far(s)).toBe(2);
    const st = applyAction(s, { type: "move", unitId: h.id, to: { x: 7, y: 5 } });
    expect([unitIn(st, body[0].id)!.x, unitIn(st, body[1].id)!.x, unitIn(st, body[2].id)!.x]).toEqual([5, 4, 3]);
    expect(unitIn(st, body[0].id)!.moved).toBe(true);
  });

  it("3. killing a middle Segment splits the body: the one behind becomes a Centipede", () => {
    const s = blank(["cymanti", "imperius"]);
    const { h, body } = chain(s, 0, [5, 5], [[4, 5], [3, 5], [2, 5]]);
    body[1].hp = 1;
    body[1].moved = true;
    body[2].hp = 6;
    s.current = 1;
    const k = put(s, "swordsman", 1, 3, 6);
    const st = applyAction(s, { type: "attack", unitId: k.id, targetId: body[1].id });
    expect(unitIn(st, body[1].id)).toBeUndefined();
    const lead = unitIn(st, body[2].id)!;
    expect(lead.type).toBe("centipede");
    expect(lead.bodyOf).toBeUndefined();
    expect(lead.hp).toBe(UNITS.centipede.hp! - 4); // keeps its 4 missing HP
    expect(lead.moved).toBe(true); // the dead Segment's spent flags
    expect(unitIn(st, body[0].id)!.bodyOf).toBe(h.id);
  });

  it("4. a new Segment goes behind the tail, by the tail's own facing", () => {
    const s = blank(["cymanti", "imperius"]);
    const { h, body } = chain(s, 0, [5, 5], [[5, 6]]);
    body[0].lastDir = { x: 1, y: 0 }; // the tail faces east
    set(s, 5, 4, { terrain: "mountain" }); // no advance onto the mountain
    const e = put(s, "warrior", 1, 5, 4);
    e.hp = 1;
    const st = applyAction(s, { type: "attack", unitId: h.id, targetId: e.id });
    const segs = st.units.filter((u) => u.bodyOf === h.id);
    expect(segs).toHaveLength(2);
    expect(segs[1]).toMatchObject({ x: 4, y: 6 }); // west of the tail, not south (opposite of the head's north)
  });
});

describe("Cymanti: Kiton, Swarm, Creep", () => {
  it("5. Kiton has plain poison: its attacks and retaliation poison, a ranged attacker is not poisoned", () => {
    expect(UNITS.kiton.skills).toContain("poison");
    const s = blank(["cymanti", "imperius"]);
    const k = put(s, "kiton", 0, 5, 5);
    const w = put(s, "warrior", 1, 6, 5);
    expect(unitIn(applyAction(s, { type: "attack", unitId: k.id, targetId: w.id }), w.id)!.poisoned).toBe(true);
    const t = blank(["imperius", "cymanti"]);
    const ar = put(t, "archer", 0, 5, 5);
    const k2 = put(t, "kiton", 1, 7, 5);
    expect(unitIn(applyAction(t, { type: "attack", unitId: ar.id, targetId: k2.id }), ar.id)!.poisoned).toBeFalsy();
    const sw = put(t, "swordsman", 0, 8, 5);
    expect(unitIn(applyAction(t, { type: "attack", unitId: sw.id, targetId: k2.id }), sw.id)!.poisoned).toBe(true);
  });

  it("6. Swarm: needs only that the Shaman can move; skips Swift units and Segments; Swift is lost on retaliation", () => {
    const s = blank(["cymanti", "imperius"], [["meditation"], []]);
    const sh = put(s, "shaman", 0, 5, 5);
    sh.attacked = true; // has acted, but can still move
    const m = put(s, "mantis", 0, 5, 6);
    const fast = put(s, "hexapod", 0, 4, 4);
    fast.swarmed = true;
    const { body } = chain(s, 0, [7, 5], [[6, 5]]);
    const a = legalActions(s).find((x) => x.type === "swarm" && x.unitId === sh.id);
    expect(a).toBeTruthy();
    let st = applyAction(s, a!);
    expect(unitIn(st, m.id)!.swarmed).toBe(true);
    expect(unitIn(st, body[0].id)!.swarmed).toBeFalsy();
    // a Swift unit loses Swift when the defender strikes back
    const e = put(st, "defender", 1, 5, 7);
    const mm = unitIn(st, m.id)!;
    mm.canAttack = true;
    st = applyAction(st, { type: "attack", unitId: mm.id, targetId: e.id });
    expect(unitIn(st, m.id)!.swarmed).toBe(false);
  });

  it("7. Creep: algae don't stop a creeping unit", () => {
    const s = blank(["cymanti", "imperius"]);
    for (let x = 2; x <= 9; x++) for (let y = 2; y <= 9; y++) if (y !== 5) tileAt(s, x, y).terrain = "mountain";
    set(s, 5, 5, { terrain: "water", algae: true });
    const hx = put(s, "hexapod", 0, 4, 5);
    expect(reachable(s, hx).some((q) => q.x === 6 && q.y === 5)).toBe(true);
  });
});

describe("Aquarion: Tentacles (S1 aquarion.rs strike, attack.rs area_damage, units.rs train)", () => {
  it("8. only the healthiest Jelly strikes a mover, once; a Jelly spares peace partners; a trained Jelly strikes", () => {
    const s = blank(["aquarion", "imperius", "imperius"], [["navigation"], [], []]);
    for (const [x, y] of [[4, 4], [6, 4], [5, 6], [4, 6]]) set(s, x, y, { terrain: "water" });
    const j1 = put(s, "jelly", 0, 4, 4);
    const j2 = put(s, "jelly", 0, 6, 4);
    j1.hp = 10;
    s.current = 1;
    const w = put(s, "defender", 1, 5, 6);
    const probe = { ...w, x: 5, y: 5 };
    const once = computeDamageRounded(s, j2, probe).damage;
    let st = applyAction(s, { type: "move", unitId: w.id, to: { x: 5, y: 5 } });
    expect(unitIn(st, w.id)!.hp).toBe(15 - once);
    // peace partner: a Jelly moving next to it does nothing
    const t = blank(["aquarion", "imperius"], [["navigation"], []]);
    t.diplomacy = { peace: [[0, 1]], offers: [], attacks: [], ceasefires: [], broken: [] };
    set(t, 5, 5, { terrain: "water" });
    set(t, 6, 5, { terrain: "water" });
    const j = put(t, "jelly", 0, 5, 5);
    const friend = put(t, "warrior", 1, 7, 5);
    st = applyAction(t, { type: "move", unitId: j.id, to: { x: 6, y: 5 } });
    expect(unitIn(st, friend.id)!.hp).toBe(10);
    // training a Jelly strikes the enemy next to the city
    const r = blank(["aquarion", "imperius"], [["navigation"], []]);
    const foe = put(r, "warrior", 1, 2, 2);
    st = applyAction(r, { type: "train", cityId: r.cities[0].id, unit: "jelly" });
    expect(unitIn(st, foe.id)!.hp).toBeLessThan(10);
  });

  it("9. Stomp, Tentacles, Auto Freeze and Auto Flood also fire on the advance after a kill", () => {
    const s = blank(["polaris", "imperius"]);
    const g = put(s, "gaami", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 5);
    e.hp = 1;
    set(s, 7, 5, { terrain: "water" });
    const st = applyAction(s, { type: "attack", unitId: g.id, targetId: e.id });
    expect(unitIn(st, g.id)).toMatchObject({ x: 6, y: 5 });
    expect(tileAt(st, 7, 5).ice).toBe(true);
    // a Jelly advancing on a kill strikes its new neighbours
    const t = blank(["aquarion", "imperius"], [["navigation"], []]);
    for (const x of [4, 5, 6]) set(t, x, 5, { terrain: "water" });
    const j = put(t, "jelly", 0, 4, 5);
    const v = put(t, "warrior", 1, 5, 5);
    v.hp = 1;
    const other = put(t, "warrior", 1, 6, 6);
    const after = applyAction(t, { type: "attack", unitId: j.id, targetId: v.id });
    expect(unitIn(after, j.id)).toMatchObject({ x: 5, y: 5 });
    expect(unitIn(after, other.id)!.hp).toBeLessThan(10);
  });
});

describe("Polaris (S1 polaris.rs)", () => {
  it("10. Freeze Area claims land in enemy territory too", () => {
    const s = blank(["polaris", "imperius"]);
    const g = put(s, "gaami", 0, 8, 8); // (9,9) is inside the enemy capital's territory
    const st = applyAction(s, legalActions(s).find((a) => a.type === "freezeArea" && a.unitId === g.id)!);
    expect(tileAt(st, 9, 9).polar).toBe(true);
  });

  it("11. Auto Freeze is a full Freeze Area: land around a moving Mooni turns into Polaris land", () => {
    const s = blank(["polaris", "imperius"]);
    const m = put(s, "mooni", 0, 4, 5);
    set(s, 6, 5, { terrain: "water" });
    const st = applyAction(s, { type: "move", unitId: m.id, to: { x: 5, y: 5 } });
    expect(tileAt(st, 4, 5).polar).toBe(true);
    expect(tileAt(st, 6, 5).ice).toBe(true);
  });

  it("12. Break Ice: any unit, Polaris too; every breakable ice tile around at once; ocean or shallow water", () => {
    const s = blank(["polaris", "imperius"]);
    for (let x = 3; x <= 9; x++) for (let y = 3; y <= 7; y++) set(s, x, y, { terrain: "ocean", ice: true });
    set(s, 5, 5, { terrain: "field", ice: false });
    const w = put(s, "warrior", 0, 5, 5);
    put(s, "warrior", 0, 6, 6); // a land unit on ice: that tile stays
    const swim = put(s, "mermaid", 1, 4, 4);
    swim.canMove = false;
    const a = legalActions(s).find((x) => x.type === "breakIce" && x.unitId === w.id);
    expect(a).toEqual({ type: "breakIce", unitId: w.id });
    const st = applyAction(s, a!);
    expect(tileAt(st, 6, 6).ice).toBe(true);
    for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6]]) expect(tileAt(st, x, y).ice).toBe(false);
    expect(tileAt(st, 5, 4).terrain).toBe("water"); // orthogonally next to the land tile
    expect(tileAt(st, 4, 4).terrain).toBe("ocean"); // only diagonally next to it
    expect(unitIn(st, w.id)!.done).toBe(true);
    // no Break Ice for an Auto Freeze unit, a unit that moved without Dash, or a Segment
    const t = blank(["cymanti", "polaris"]);
    set(t, 6, 5, { terrain: "water", ice: true });
    const moved = put(t, "kiton", 0, 5, 5); // no Dash
    moved.moved = true;
    expect(optionsOf(t, moved).some((x) => x.type === "breakIce")).toBe(false);
    moved.moved = false;
    const { body } = chain(t, 0, [7, 4], [[7, 5]]);
    expect(optionsOf(t, body[0]).some((x) => x.type === "breakIce")).toBe(false);
    t.current = 1;
    const mo = put(t, "mooni", 1, 6, 6);
    expect(optionsOf(t, mo).some((x) => x.type === "breakIce")).toBe(false);
  });

  it("13. Escape for skaters reads the final tile: an advance off the ice spends the Battle Sled", () => {
    const s = blank(["polaris", "imperius"], [["sailing"], []]);
    set(s, 5, 5, { terrain: "water", ice: true });
    const sled = put(s, "battleSled", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 5);
    e.hp = 1;
    let st = applyAction(s, { type: "attack", unitId: sled.id, targetId: e.id });
    expect(unitIn(st, sled.id)).toMatchObject({ x: 6, y: 5, canMove: false });
    const t = blank(["polaris", "imperius"], [["sailing"], []]);
    set(t, 5, 5, { terrain: "water", ice: true });
    set(t, 6, 5, { terrain: "water", ice: true });
    const sl = put(t, "battleSled", 0, 5, 5);
    const v = put(t, "warrior", 1, 6, 5);
    v.hp = 1;
    st = applyAction(t, { type: "attack", unitId: sl.id, targetId: v.id });
    expect(unitIn(st, sl.id)).toMatchObject({ x: 6, y: 5, canMove: true });
  });
});

describe("conversion, starting land, Aqua Crops", () => {
  it("14. a converted Independent unit keeps its home city; a converted boat brings its passenger", () => {
    const s = blank(["imperius", "cymanti"], [["philosophy"], []]);
    const mb = put(s, "mindBender", 0, 5, 5);
    const larva = put(s, "larva", 1, 6, 5);
    larva.homeCity = s.cities[1].id;
    let st = applyAction(s, { type: "attack", unitId: mb.id, targetId: larva.id });
    expect(unitIn(st, larva.id)).toMatchObject({ owner: 0, homeCity: s.cities[1].id });
    const t = blank(["imperius", "imperius"], [["philosophy"], ["fishing"]]);
    set(t, 6, 5, { terrain: "water" });
    const mb2 = put(t, "mindBender", 0, 5, 5);
    const boat = put(t, "raft", 1, 6, 5);
    boat.carried = "warrior";
    st = applyAction(t, { type: "attack", unitId: mb2.id, targetId: boat.id });
    expect(unitIn(st, boat.id)).toMatchObject({ owner: 0, carried: "warrior", homeCity: t.cities[0].id });
  });

  it("15. Polaris starting land is only map generation's 3×3 around the capital", () => {
    const s = createGame({ mapSize: 16, players: 2, mode: "domination", seed: 7, clans: ["polaris", "imperius"] });
    const cap = s.cities[0];
    s.tiles.forEach((t, i) => {
      const x = i % 16;
      const y = Math.floor(i / 16);
      if (Math.max(Math.abs(x - cap.x), Math.abs(y - cap.y)) > 1) expect(t.polar).toBeFalsy();
    });
    const ring = s.tiles.filter((t, i) => {
      const x = i % 16;
      const y = Math.floor(i / 16);
      const d = Math.max(Math.abs(x - cap.x), Math.abs(y - cap.y));
      return d === 1 && !t.village && !t.ruin && t.terrain !== "water" && t.terrain !== "ocean";
    });
    expect(ring.length).toBeGreaterThan(0);
    for (const t of ring) expect(t.polar).toBe(true);
  });

  it("16. Aqua Crops stay on maps without Aquarion, hidden from other tribes", () => {
    const plain = generateMap(createRng(4), 16, 4, "lakes");
    expect(plain.tiles.some((t) => t.resource === "aquaCrop")).toBe(true);
    const s = blank(["imperius", "aquarion"]);
    expect(resourceVisible(s, 0, "aquaCrop")).toBe(false);
    expect(resourceVisible(s, 1, "aquaCrop")).toBe(true);
  });
});

describe("settled by the reference", () => {
  it("Fertilize may replace a non-crop resource on wetland; no Harvest Spores; Quetzali start with Strategy", () => {
    const s = blank(["aquarion", "imperius"], [["construction"], []]);
    set(s, 2, 1, { flooded: true, resource: "fruit" });
    const fert = legalActions(s).find((a) => a.type === "build" && a.building === "fertilize" && a.at.x === 2 && a.at.y === 1);
    expect(fert).toBeTruthy();
    expect(tileAt(applyAction(s, fert!), 2, 1).resource).toBe("crop");
    set(s, 2, 1, { resource: "crop" });
    expect(legalActions(s).some((a) => a.type === "build" && a.building === "fertilize" && a.at.x === 2 && a.at.y === 1)).toBe(false);
    expect(Object.keys(BUILDS)).not.toContain("harvestSpores");
    // S1's "shields" is the tech that unlocks the Defender: our "strategy"
    expect(CLAN_BY_ID.quetzali.startTech).toBe("strategy");
    expect(UNITS.defender.tech).toBe("strategy");
  });
});
