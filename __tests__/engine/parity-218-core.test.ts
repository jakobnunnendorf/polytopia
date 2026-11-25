/**
 * Parity with the game's own 2.18 rules data and the polybots-engine replay engine
 * (docs/RULES_PARITY.md, "2.18 data corrections"): core rules (group A).
 * One block per corrected rule.
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { CLAN_BY_ID, UNITS, embassyCost } from "@/logic/engine/data";
import { recordAttack } from "@/logic/engine/diplomacy";
import { idx } from "@/logic/engine/grid";
import { reachable } from "@/logic/engine/movement";
import {
  checkElimination,
  cityScore,
  claimTerritory,
  createGame,
  dominationRating,
  dominationStars,
  income,
  makeUnit,
  perfectionRating,
  scoreOf,
} from "@/logic/engine/state";
import type { Action, GameState, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12x12 open field map, all explored, two capitals in opposite corners, no units, tribes met */
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
      flooded: false,
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

function put(s: GameState, type: string, owner: number, x: number, y: number): Unit {
  const u = makeUnit(s, type, owner, { x, y }, null);
  Object.assign(u, { done: false, canMove: true, canAttack: true, moved: false, attacked: false });
  return u;
}

const tile = (s: GameState, x: number, y: number) => s.tiles[idx(N, x, y)];
const unit = (s: GameState, id: number) => s.units.find((u) => u.id === id)!;
const builds = (s: GameState, b: string) =>
  legalActions(s)
    .filter((a): a is Extract<Action, { type: "build" }> => a.type === "build" && a.building === b)
    .map((a) => a.at);

describe("healing: automatic at the end of the turn for units that did nothing", () => {
  it("an idle damaged unit heals 4 in own territory and 2 elsewhere", () => {
    let s = blank();
    const home = put(s, "warrior", 0, 1, 1);
    const away = put(s, "warrior", 0, 6, 6);
    home.hp = 3;
    away.hp = 3;
    s = applyAction(s, { type: "endTurn" });
    expect(unit(s, home.id).hp).toBe(7);
    expect(unit(s, away.id).hp).toBe(5);
  });

  it("a unit that moved or attacked does not heal; a frozen unit does not heal", () => {
    let s = blank();
    const mover = put(s, "warrior", 0, 6, 6);
    const attacker = put(s, "warrior", 0, 3, 3);
    const frozen = put(s, "warrior", 0, 1, 1);
    put(s, "warrior", 1, 3, 4).hp = 1;
    mover.hp = frozen.hp = 3;
    attacker.hp = 8;
    frozen.frozen = true;
    s = applyAction(s, { type: "move", unitId: mover.id, to: { x: 6, y: 7 } });
    const target = s.units.find((u) => u.owner === 1)!;
    s = applyAction(s, { type: "attack", unitId: attacker.id, targetId: target.id });
    s = applyAction(s, { type: "endTurn" });
    expect(unit(s, mover.id).hp).toBe(3);
    expect(unit(s, attacker.id).hp).toBe(8);
    expect(unit(s, frozen.id).hp).toBe(3);
  });

  it("an idle poisoned unit loses the poison and heals 0 HP", () => {
    let s = blank();
    const w = put(s, "warrior", 0, 1, 1);
    w.hp = 3;
    w.poisoned = true;
    s = applyAction(s, { type: "endTurn" });
    expect(unit(s, w.id)).toMatchObject({ hp: 3, poisoned: false });
  });

  it("Recover heals at once and ends the unit's turn; it does not heal again at the end of the turn", () => {
    let s = blank();
    const w = put(s, "warrior", 0, 1, 1);
    w.hp = 1;
    s = applyAction(s, { type: "recover", unitId: w.id });
    expect(unit(s, w.id).hp).toBe(5);
    s = applyAction(s, { type: "endTurn" });
    expect(unit(s, w.id).hp).toBe(5);
  });
});

describe("poison and movement (polybots-engine movement_range)", () => {
  it("poison takes 1 movement only above 1: a poisoned Rider moves 1, a poisoned Warrior still moves 1", () => {
    const s = blank();
    const r = put(s, "rider", 0, 5, 5);
    const w = put(s, "warrior", 0, 8, 2);
    r.poisoned = true;
    w.poisoned = true;
    const far = (u: Unit) => Math.max(...reachable(s, u).map((m) => Math.max(Math.abs(m.x - u.x), Math.abs(m.y - u.y))));
    expect(far(r)).toBe(1);
    expect(far(w)).toBe(1);
  });
});

describe("tribe setup (2.14 balance patch, game tribe data)", () => {
  it("Luxidoor starts with a level-3 capital and 2 stars", () => {
    expect(CLAN_BY_ID.luxidoor).toMatchObject({ capitalLevel: 3, startStars: 2 });
    const s = createGame({ mapSize: 11, players: 2, mode: "domination", seed: 3, clans: ["luxidoor", "imperius"] });
    expect(s.cities.find((c) => c.owner === 0)!.level).toBe(3);
    expect(s.players[0].stars).toBe(2);
  });

  it("starting stars: Xin-xi, Hoodrick, Quetzali, Yadakk 7; Oumaji 6; Luxidoor 2; the rest 5", () => {
    const want: Record<string, number> = { xinxi: 7, hoodrick: 7, quetzali: 7, yadakk: 7, oumaji: 6, luxidoor: 2 };
    for (const c of Object.values(CLAN_BY_ID)) expect([c.id, c.startStars]).toEqual([c.id, want[c.id] ?? 5]);
    expect(CLAN_BY_ID.aimo).toMatchObject({ startTech: "philosophy", startUnit: "mindBender" });
  });
});

describe("buildings on unharvested resources (game data: terrain requirements only)", () => {
  it("a Lumber Hut may go on a forest with wild animals, a Temple on a field with fruit, a Port on fish", () => {
    const s = blank();
    s.players[0].techs.push("forestry", "freeSpirit", "fishing");
    s.players[0].stars = 100;
    Object.assign(tile(s, 1, 0), { terrain: "forest", resource: "animal" });
    Object.assign(tile(s, 0, 1), { terrain: "field", resource: "fruit" });
    Object.assign(tile(s, 1, 1), { terrain: "water", resource: "fish" });
    expect(builds(s, "lumberHut")).toContainEqual({ x: 1, y: 0 });
    expect(builds(s, "temple")).toContainEqual({ x: 0, y: 1 });
    expect(builds(s, "port")).toContainEqual({ x: 1, y: 1 });
  });

  it("the resource stays underneath and can't be harvested while the building stands", () => {
    let s = blank();
    s.players[0].techs.push("forestry", "hunting");
    Object.assign(tile(s, 1, 0), { terrain: "forest", resource: "animal" });
    s = applyAction(s, { type: "build", at: { x: 1, y: 0 }, building: "lumberHut" });
    expect(tile(s, 1, 0)).toMatchObject({ building: "lumberHut", resource: "animal" });
    expect(builds(s, "hunt")).not.toContainEqual({ x: 1, y: 0 });
  });
});

describe("embassies (game data 2.18)", () => {
  it("cost 4★ plus 2★ per embassy already built", () => {
    expect([0, 1, 2].map(embassyCost)).toEqual([4, 6, 8]);
    const s = blank();
    s.players[0].techs.push("diplomacy");
    const a = legalActions(s).find((x) => x.type === "build" && x.building === "embassy")!;
    expect(applyAction(s, a).players[0].stars).toBe(50 - 4);
    s.players[0].embassies = [5]; // one elsewhere already (an absent player id)
    expect(applyAction(s, a).players[0].stars).toBe(50 - 6);
  });

  it("may be built at war, but pays nothing on either side while at war", () => {
    const s = blank();
    s.players[0].techs.push("diplomacy");
    recordAttack(s, 1, 0);
    expect(legalActions(s).some((x) => x.type === "build" && x.building === "embassy")).toBe(true);
    const before0 = income(s, 0);
    const before1 = income(s, 1);
    s.players[0].embassies = [1];
    expect(income(s, 0)).toBe(before0);
    expect(income(s, 1)).toBe(before1);
    s.turn += 2; // war is over: neutral
    expect(income(s, 0) - before0).toBe(2);
  });
});

describe("a wiped tribe", () => {
  it("losing the last city disbands every unit and ends every embassy to or from it", () => {
    const s = blank();
    s.players[0].embassies = [1];
    s.players[1].embassies = [0];
    put(s, "warrior", 1, 6, 6);
    s.cities = s.cities.filter((c) => c.owner !== 1);
    checkElimination(s);
    expect(s.players[1].alive).toBe(false);
    expect(s.units.filter((u) => u.owner === 1)).toEqual([]);
    expect(s.players[0].embassies).toEqual([]);
    expect(s.players[1].embassies).toEqual([]);
  });
});

describe("scoring (game data 2.18)", () => {
  it("a city scores 50 × (level + 1) + 5 per population point at every level", () => {
    const s = blank();
    const c = s.cities[0];
    c.parks = 0;
    for (const [level, pop, want] of [
      [1, 0, 100],
      [1, 1, 105],
      [3, 2, 210],
      [11, 0, 600],
      [12, 3, 665],
    ]) {
      c.level = level;
      c.pop = pop;
      expect(cityScore(c)).toBe(want);
    }
  });

  it("negative population costs 105 per point and the city part floors at 0", () => {
    const c = blank().cities[0];
    c.level = 3;
    c.pop = -1;
    expect(cityScore(c)).toBe(200 - 105);
    c.level = 1;
    c.pop = -2;
    expect(cityScore(c)).toBe(0);
    c.parks = 1;
    expect(cityScore(c)).toBe(250);
  });

  it("Perfection bonus = 100% + difficulty part (0/20/40/80) + opponent part, from the app's setup-screen table", () => {
    // 3 opponents: the opponent part is +30%
    for (const [difficulty, percent] of [["easy", 130], ["normal", 150], ["hard", 170], ["crazy", 210]] as const) {
      const s = createGame({ mapSize: 16, players: 4, mode: "perfection", difficulty, seed: 1, clans: ["imperius", "imperius", "imperius", "imperius"] });
      expect(perfectionRating(s, 0)).toBe(Math.round(scoreOf(s, 0) * (percent / 100)));
    }
  });

  it("Perfection bonus at 15 opponents is 165 / 185 / 205 / 245% for Easy / Normal / Hard / Crazy (setup screen, 25 Nov 2026)", () => {
    for (const [difficulty, percent] of [["easy", 165], ["normal", 185], ["hard", 205], ["crazy", 245]] as const) {
      const s = createGame({ mapSize: 16, players: 16, mode: "perfection", difficulty, seed: 1, clans: Array(16).fill("imperius") });
      expect(perfectionRating(s, 0)).toBe(Math.round(scoreOf(s, 0) * (percent / 100)));
    }
  });

  it("Perfection bonus on Crazy for 1..15 opponents reads 180, 200, 210, 217, ... 245% (setup screen, 25 Nov 2026)", () => {
    const shown = [180, 200, 210, 217, 222, 226, 229, 232, 234, 237, 239, 240, 242, 244, 245];
    shown.forEach((percent, i) => {
      const s = createGame({ mapSize: 16, players: i + 2, mode: "perfection", difficulty: "crazy", seed: 1, clans: Array(i + 2).fill("imperius") });
      expect(perfectionRating(s, 0)).toBe(Math.round(scoreOf(s, 0) * (percent / 100)));
    });
  });
});

describe("Domination end rating (2.18 end screen)", () => {
  it("is the mean of speed, battle, destroyed tribes and difficulty", () => {
    const s = blank();
    s.difficulty = "hard";
    s.turn = 20;
    s.players[0].kills = 3;
    s.players[0].losses = 1;
    s.players[1].alive = false;
    const speed = Math.min(1, 10 / 20);
    const battle = 4 / 5;
    expect(dominationRating(s, 0)).toBeCloseTo((speed + battle + 1 + 0.75) / 4);
  });

  it("stars at 20%, 70%, 95%; a halo at 100%", () => {
    expect([0.19, 0.2, 0.7, 0.95, 0.99, 1].map(dominationStars)).toEqual([0, 1, 2, 3, 3, 4]);
    const s = blank();
    s.difficulty = "crazy";
    s.turn = 5;
    s.players[1].alive = false;
    expect(dominationRating(s, 0)).toBe(1);
  });
});

describe("Weekly Challenge: Perfection with a turn limit", () => {
  it("turnLimit sets the last turn (default 30)", () => {
    const base = { mapSize: 16, players: 2, mode: "perfection" as const, seed: 7, clans: ["imperius", "imperius"] };
    expect(createGame(base).maxTurns).toBe(30);
    expect(createGame({ ...base, turnLimit: 20 }).maxTurns).toBe(20);
  });
});

describe("unit data (rules-124.json, build 2.18.0.16751)", () => {
  it.each([
    // id, cost, hp, attack, defence, movement, range
    ["siren", 5, 10, 0, 1, 1, 1],
    ["crab", 10, 40, 4, 4, 2, 1],
    ["mooni", 5, 10, 0, 1, 2, 1],
    ["battleSled", 5, 15, 3, 2, 3, 1],
    ["iceFortress", 15, 20, 4, 3, 2, 2],
    ["boomchi", 5, 10, 3, 3, 2, 0],
    ["insectEgg", 2, 10, 2, 3, 0, 0],
    ["larva", 2, 10, 2, 2, 1, 1],
    ["moth", 5, 10, 2, 0.1, 2, 1],
    ["cloak", 8, 5, 2, 0.5, 2, 1],
    ["scuba", 8, 5, 2, 0.5, 2, 1],
    ["phychi", 3, 5, 0.7, 1, 2, 2],
    ["jelly", 8, 20, 2, 2, 2, 1],
    ["doomux", 10, 20, 3.5, 2, 3, 1],
    ["centipede", 10, 20, 4, 3, 2, 1],
    ["segment", 2, 10, 2, 2, 1, 1],
    ["pirate", 0, 10, 2, 2, 2, 1],
  ])("%s", (id, cost, hp, attack, defence, movement, range) => {
    expect(UNITS[id as string]).toMatchObject({ cost, hp, attack, defence, movement, range });
  });

  it("skills: Amphibian has no Fortify, Mooni is not Static, Moth has Scout, Dinghy has no Creep", () => {
    expect(UNITS.amphibian.skills).not.toContain("fortify");
    expect(UNITS.mooni.skills).not.toContain("static");
    expect(UNITS.moth.skills).toContain("scout");
    expect([...UNITS.dinghy.skills].sort()).toEqual(["carry", "dash", "hide", "infiltrate", "scout", "static", "stiff", "water"]);
    expect(UNITS.pirate.skills).not.toContain("independent");
    expect(UNITS.insectEgg.skills).not.toContain("independent");
  });

  it("Infiltrate units never attack units, despite their attack value", () => {
    const s = blank();
    const c = put(s, "cloak", 0, 5, 5);
    put(s, "warrior", 1, 5, 6);
    expect(legalActions(s).some((a) => a.type === "attack" && a.unitId === c.id)).toBe(false);
  });

  it("a Boomchi (range 0) can't attack; it explodes instead", () => {
    const s = blank();
    s.players[0].clan = "cymanti";
    const b = put(s, "boomchi", 0, 5, 5);
    b.createdTurn = s.turn - 1; // no Explode in the turn of creation
    put(s, "warrior", 1, 5, 6);
    const acts = legalActions(s).filter((a) => "unitId" in a && a.unitId === b.id).map((a) => a.type);
    expect(acts).not.toContain("attack");
    expect(acts).toContain("explode");
  });
});

describe("market (game data: each adjacent upgrade building counts its level, at least 1)", () => {
  it("a level-0 windmill next to a market still adds 1★", () => {
    const s = blank();
    const before = income(s, 0);
    tile(s, 1, 0).building = "market";
    tile(s, 1, 1).building = "windmill";
    tile(s, 1, 1).buildingLevel = 0;
    expect(income(s, 0) - before).toBe(1);
  });
});
