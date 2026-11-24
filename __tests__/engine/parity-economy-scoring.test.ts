/**
 * Rules parity (POLYTOPIA_RULES.md, docs/RULES_PARITY.md): economy, cities,
 * scoring, game setup and modes. Each block names the rule it pins down.
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { CLAN_BY_ID } from "@/logic/engine/data";
import {
  checkMeetings,
  cityIncome,
  cityScore,
  claimTerritory,
  createGame,
  income,
  makeUnit,
  mapSizeFor,
  newCity,
  perfectionRating,
  perfectionStars,
  scoreOf,
  updateConnections,
} from "@/logic/engine/state";
import { initialState, startRecord } from "@/logic/arena/record";
import type { City, Difficulty, GameMode, GameState } from "@/logic/engine/types";

/** a 16x16 all-field map with no cities or units; every player has explored everything and met everyone */
function blank(players = 2, opts: { humans?: number[]; mode?: GameMode; difficulty?: Difficulty } = {}): GameState {
  const s = createGame({
    mapSize: 16,
    players,
    mode: opts.mode ?? "domination",
    difficulty: opts.difficulty,
    seed: 1,
    clans: Array(players).fill("imperius"),
    humans: opts.humans ?? [],
  });
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
    });
  }
  s.units = [];
  s.cities = [];
  for (const p of s.players) {
    p.explored = p.explored.map(() => 1);
    p.met = s.players.filter((o) => o.id !== p.id).map((o) => o.id);
    p.stars = 100;
  }
  return s;
}

function city(s: GameState, owner: number, x: number, y: number, capital = false): City {
  const c = newCity(s, { x, y }, owner);
  claimTerritory(s, c, 1);
  if (capital) {
    c.capital = true;
    c.originalCapitalOf = owner;
    s.players[owner].capitalId = c.id;
  }
  return c;
}

function freshUnit(s: GameState, type: string, owner: number, x: number, y: number) {
  const u = makeUnit(s, type, owner, { x, y }, null);
  Object.assign(u, { done: false, canMove: true, canAttack: true, moved: false, attacked: false });
  return u;
}

const get = (s: GameState, id: number) => s.cities.find((c) => c.id === id)!;

describe("capturing cities (Cities: Capturing; The capital and connections)", () => {
  it("recapturing your starting city makes it your capital again, with the capital income and connections", () => {
    const s = blank(2);
    const cap0 = city(s, 0, 2, 2, true);
    const other0 = city(s, 0, 5, 2);
    city(s, 1, 12, 12, true);
    s.tiles[2 * 16 + 3].road = true;
    s.tiles[2 * 16 + 4].road = true;
    cap0.owner = 1;
    cap0.capital = false;
    updateConnections(s, 0);
    expect(other0.connected).toBe(false);
    freshUnit(s, "warrior", 0, 2, 2);
    s.current = 0;
    const after = applyAction(s, { type: "capture", unitId: s.units[0].id });
    const c = get(after, cap0.id);
    expect(c.owner).toBe(0);
    expect(c.capital).toBe(true);
    expect(cityIncome(after, c)).toBe(c.level + 1);
    expect(get(after, other0.id).connected).toBe(true);
  });

  it("capturing a connected city takes the connection's population from it and the old capital (may go negative)", () => {
    const s = blank(2);
    const cap0 = city(s, 0, 2, 2, true);
    const b = city(s, 0, 5, 2);
    city(s, 1, 12, 12, true);
    s.tiles[2 * 16 + 3].road = true;
    s.tiles[2 * 16 + 4].road = true;
    updateConnections(s, 0);
    expect(b.connected).toBe(true);
    expect(b.pop).toBe(1);
    expect(cap0.pop).toBe(1);
    cap0.pop = 0; // the capital spent that point on nothing else; losing the link takes it below zero
    freshUnit(s, "warrior", 1, 5, 2);
    s.current = 1;
    const after = applyAction(s, { type: "capture", unitId: s.units[0].id });
    expect(get(after, b.id).owner).toBe(1);
    expect(get(after, b.id).pop).toBe(0);
    expect(get(after, b.id).connected).toBe(false);
    expect(get(after, cap0.id).pop).toBe(-1);
  });

  it("capturing a capital cuts all its connections: each linked city and the capital lose the point", () => {
    const s = blank(2);
    const cap0 = city(s, 0, 2, 2, true);
    const b = city(s, 0, 5, 2);
    city(s, 0, 9, 9);
    city(s, 1, 12, 12, true);
    s.tiles[2 * 16 + 3].road = true;
    s.tiles[2 * 16 + 4].road = true;
    updateConnections(s, 0);
    freshUnit(s, "warrior", 1, 2, 2);
    s.current = 1;
    const after = applyAction(s, { type: "capture", unitId: s.units[0].id });
    expect(get(after, cap0.id).capital).toBe(false);
    expect(get(after, cap0.id).pop).toBe(0);
    expect(get(after, b.id).pop).toBe(0);
    expect(get(after, b.id).connected).toBe(false);
  });

  it("a captured city keeps its waiting level-up rewards for the captor to choose", () => {
    const s = blank(2);
    city(s, 0, 2, 2, true);
    const b = city(s, 0, 8, 8);
    b.level = 2;
    b.pendingRewards = [2];
    city(s, 1, 12, 12, true);
    freshUnit(s, "warrior", 1, 8, 8);
    s.current = 1;
    const after = applyAction(s, { type: "capture", unitId: s.units[0].id });
    expect(get(after, b.id).pendingRewards).toEqual([2]);
    expect(legalActions(after).every((a) => a.type === "reward")).toBe(true);
  });
});

describe("ports (The capital and connections: range 5, ocean links need Sailing)", () => {
  function portsAt(gap: number, ocean: boolean) {
    const s = blank(2);
    city(s, 0, 1, 1, true);
    const b = city(s, 0, 3 + gap, 1);
    city(s, 1, 12, 12, true);
    for (let x = 2; x <= 2 + gap; x++) s.tiles[16 + x].terrain = ocean && x === 4 ? "ocean" : "water";
    s.tiles[16 + 2].building = "port";
    s.tiles[16 + 2 + gap].building = "port";
    return { s, b };
  }
  it("links ports 5 tiles apart", () => {
    const { s, b } = portsAt(5, false);
    updateConnections(s, 0);
    expect(b.connected).toBe(true);
  });
  it("does not link ports 6 tiles apart", () => {
    const { s, b } = portsAt(6, false);
    updateConnections(s, 0);
    expect(b.connected).toBe(false);
  });
  it("needs Sailing to link across ocean", () => {
    const { s, b } = portsAt(4, true);
    updateConnections(s, 0);
    expect(b.connected).toBe(false);
    s.players[0].techs.push("sailing");
    updateConnections(s, 0);
    expect(b.connected).toBe(true);
  });
});

describe("setup and stars", () => {
  it("Luxidoor starts with a level-3 capital and 2 stars (2.14)", () => {
    expect(CLAN_BY_ID.luxidoor.capitalLevel).toBe(3);
    const s = createGame({ mapSize: 11, players: 2, mode: "domination", seed: 3, clans: ["luxidoor", "imperius"] });
    expect(s.cities.find((c) => c.owner === 0)!.level).toBe(3);
  });

  it("meeting a tribe pays 1 + 2 per 1,000 of its score, with no extra stars in 2-player games", () => {
    const s = blank(2);
    city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    s.players[0].met = [];
    s.players[0].stars = 0;
    const expected = 1 + 2 * Math.min(Math.ceil(scoreOf(s, 1) / 1000), 5);
    checkMeetings(s);
    expect(s.players[0].stars).toBe(expected);
  });
});

describe("improvements", () => {
  it("fish can be harvested on ocean as well as shallow water", () => {
    const s = blank(2);
    city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    s.players[0].techs.push("fishing");
    s.tiles[3 * 16 + 3].terrain = "ocean";
    s.tiles[3 * 16 + 3].resource = "fish";
    const builds = legalActions(s).filter((a) => a.type === "build" && a.building === "fish");
    expect(builds).toContainEqual({ type: "build", at: { x: 3, y: 3 }, building: "fish" });
  });

  it("a Forge may stand on a tile with an unharvested resource (2.18 game data)", () => {
    const s = blank(2);
    city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    s.players[0].techs.push("smithery");
    s.tiles[1 * 16 + 1].terrain = "mountain";
    s.tiles[1 * 16 + 1].building = "mine";
    s.tiles[1 * 16 + 2].terrain = "forest";
    s.tiles[1 * 16 + 2].resource = "animal";
    s.tiles[2 * 16 + 1].terrain = "forest";
    const forges = legalActions(s)
      .filter((a) => a.type === "build" && a.building === "forge")
      .map((a) => (a as { at: { x: number; y: number } }).at);
    expect(forges).toContainEqual({ x: 1, y: 2 }); // forest without a resource
    expect(forges).toContainEqual({ x: 2, y: 1 }); // forest with an animal
  });

  it("an upgrade building's level is recounted from its adjacent feeders", () => {
    const s = blank(2);
    const cap = city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    s.players[0].techs.push("farming");
    s.tiles[1 * 16 + 2].building = "windmill";
    s.tiles[1 * 16 + 2].buildingLevel = 5; // stale level, e.g. after farms were lost with captured land
    s.tiles[1 * 16 + 1].building = "farm";
    s.tiles[1 * 16 + 3].resource = "crop";
    cap.level = 9; // no level-up in between
    const after = applyAction(s, { type: "build", at: { x: 3, y: 1 }, building: "farm" });
    expect(after.tiles[1 * 16 + 2].buildingLevel).toBe(2);
    expect(get(after, cap.id).pop).toBe(2 - 3); // farm +2; windmill level 5 -> 2 takes 3
  });
});

describe("scoring", () => {
  // overturned (S1 units::unit_score): the boat's own cost counts too
  it("a ship scores 5 per star of boat and passenger", () => {
    const s = blank(2);
    city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    const base = scoreOf(s, 0);
    const scout = makeUnit(s, "scout", 0, { x: 6, y: 6 }, null);
    scout.carried = "warrior";
    expect(scoreOf(s, 0) - base).toBe(35); // Scout 5 + Warrior 2
  });

  it("a city scores 50 x (level + 1) + 5 per population point; negative population costs 105 per point, floor 0", () => {
    const s = blank(2);
    const c = city(s, 0, 2, 2, true);
    expect(cityScore(c)).toBe(100);
    c.pop = 1;
    expect(cityScore(c)).toBe(105);
    c.pop = -2;
    expect(cityScore(c)).toBe(0);
    c.pop = 0;
    c.level = 2;
    expect(cityScore(c)).toBe(150); // 2 population (10) + 40
    c.level = 3;
    expect(cityScore(c)).toBe(200); // + 3 population (15) + 35
  });

  it("Perfection rating = score x (1 + round(handicap/5 + ln(opponents)/ln(11.4), 2)) with the star thresholds", () => {
    const s = blank(4, { mode: "perfection", difficulty: "hard" });
    city(s, 0, 2, 2, true);
    expect(perfectionRating(s, 0)).toBe(Math.round(scoreOf(s, 0) * (1 + 0.85)));
    expect([2_999, 3_000, 10_000, 50_000, 100_000].map(perfectionStars)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("difficulty (AI and difficulty)", () => {
  it.each([
    ["easy", 1],
    ["normal", 2],
    ["hard", 3],
    ["crazy", 5],
  ] as const)("a %s bot's level-1 capital makes %i stars; a human's makes 2", (d, stars) => {
    const s = blank(2, { humans: [0], difficulty: d });
    city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    expect(income(s, 0)).toBe(2);
    expect(income(s, 1)).toBe(stars);
  });

  it("defaults to normal, and records without it replay as normal", () => {
    const s = createGame({ mapSize: 11, players: 2, mode: "perfection", seed: 4, humans: [] });
    expect(s.difficulty).toBe("normal");
    const old = { ...s } as GameState;
    delete old.difficulty;
    const rec = startRecord(old, [], "arena");
    delete rec.options.difficulty;
    expect(initialState(rec).difficulty).toBe("normal");
    rec.turnStates = [];
    expect(initialState(rec).difficulty).toBe("normal");
  });
});

describe("game setup, modes and victory", () => {
  it("map size is forced by mode: Perfection 16, Domination by opponent count", () => {
    expect(mapSizeFor("perfection", 5)).toBe(16);
    expect([1, 2, 3, 4, 9].map((o) => mapSizeFor("domination", o))).toEqual([11, 14, 16, 18, 18]);
    expect(mapSizeFor("creative", 3)).toBeNull();
    expect(createGame({ players: 2, mode: "perfection", seed: 1 }).mapSize).toBe(16);
    expect(createGame({ players: 3, mode: "domination", seed: 1 }).mapSize).toBe(14);
  });

  it("a Tiny map holds at most 9 tribes", () => {
    expect(() => createGame({ mapSize: 11, players: 10, mode: "creative", seed: 1 })).toThrow();
  });

  it("Perfection: the winner is the best alive player, never an eliminated one", () => {
    const s = blank(3, { mode: "perfection" });
    city(s, 1, 2, 2, true);
    city(s, 2, 12, 12, true);
    s.players[0].alive = false;
    s.players[0].techs = ["riding", "roads", "trade", "chivalry", "freeSpirit"]; // a dead player's high score
    s.turn = s.maxTurns;
    s.current = 2;
    const after = applyAction(s, { type: "endTurn" });
    expect(after.over).toBe(true);
    expect([1, 2]).toContain(after.winner);
  });

  it("single player: the only human losing every city ends the game as a loss", () => {
    const s = blank(3, { humans: [0] });
    const c0 = city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    city(s, 2, 12, 2, true);
    freshUnit(s, "warrior", 1, c0.x, c0.y);
    s.current = 1;
    const after = applyAction(s, { type: "capture", unitId: s.units[0].id });
    expect(after.players[0].alive).toBe(false);
    expect(after.over).toBe(true);
    expect(after.winner).not.toBe(0);
  });

  it("Creative has no turn limit", () => {
    const s = blank(2, { mode: "creative" });
    city(s, 0, 2, 2, true);
    city(s, 1, 12, 12, true);
    s.turn = 40;
    s.current = 1;
    expect(applyAction(s, { type: "endTurn" }).over).toBe(false);
  });

  // overturned (S1 step::add_score): Glory ends right after the action that reaches the target
  it("Glory: reaching 10,000 points ends the game at once; the highest score wins", () => {
    const s = blank(3, { mode: "glory" });
    const a = city(s, 0, 2, 2, true);
    const b = city(s, 1, 12, 12, true);
    city(s, 2, 12, 2, true);
    a.parks = 40; // 10,000 points
    b.parks = 44;
    const after = applyAction(s, { type: "research", tech: "riding" });
    expect(after.over).toBe(true);
    expect(after.winner).toBe(1);
  });

  it("Might: holding every tribe's capital wins, even while others keep cities", () => {
    const s = blank(3, { mode: "might" });
    city(s, 0, 2, 2, true);
    const cap1 = city(s, 1, 12, 12, true);
    city(s, 1, 8, 12);
    const cap2 = city(s, 2, 12, 2, true);
    city(s, 2, 8, 2);
    cap2.owner = 0;
    cap2.capital = false;
    freshUnit(s, "warrior", 0, cap1.x, cap1.y);
    s.current = 0;
    const after = applyAction(s, { type: "capture", unitId: s.units[0].id });
    expect(after.players.every((p) => p.alive)).toBe(true);
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
  });
});
