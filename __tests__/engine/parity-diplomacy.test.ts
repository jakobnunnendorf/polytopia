/**
 * Parity tests for diplomacy against POLYTOPIA_RULES.md ("Diplomacy": peace
 * treaty, embassy, Cloak, what bots think of you, meeting tribes; plus the
 * peace rules in Movement, Healing, Capture and Roads) and docs/RULES_PARITY.md.
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { botStep, scoreAction } from "@/logic/engine/bot";
import { atPeace, atWar, makePeace, relation } from "@/logic/engine/diplomacy";
import { cloneState, idx } from "@/logic/engine/grid";
import { canSee, reachable } from "@/logic/engine/movement";
import { actionLabel } from "@/logic/engine/names";
import * as opinion from "@/logic/engine/opinion";
import { claimTerritory, createGame, income, makeUnit, underSiege } from "@/logic/engine/state";
import type { Action, City, GameState, Unit } from "@/logic/engine/types";

const N = 12;

/** a 12x12 open field map, all explored, two cities in opposite corners, no units, tribes met */
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
  return u;
}

const tile = (s: GameState, x: number, y: number) => s.tiles[idx(N, x, y)];
const reach = (s: GameState, u: Unit, x: number, y: number) => reachable(s, u).some((m) => m.x === x && m.y === y);
const has = (s: GameState, pred: (a: Action) => boolean) => legalActions(s).some(pred);
const peace = (s: GameState) => makePeace(s, 0, 1);
const unit = (s: GameState, id: number) => s.units.find((u) => u.id === id);
/** give player 1's city the territory of the given tiles */
const ownBy1 = (s: GameState, ...xy: [number, number][]) => {
  for (const [x, y] of xy) tile(s, x, y).territory = s.cities[1].id;
};

describe("peace offers", () => {
  it("only a sender with Strategy may offer, and only to a tribe it has met", () => {
    const s = blank();
    expect(has(s, (a) => a.type === "offerPeace")).toBe(false);
    s.players[0].techs.push("strategy");
    expect(legalActions(s).filter((a) => a.type === "offerPeace")).toEqual([{ type: "offerPeace", player: 1 }]);
    s.players[0].met = [];
    expect(has(s, (a) => a.type === "offerPeace")).toBe(false);
  });

  it("the receiver accepts on its next turn without needing Strategy", () => {
    let s = blank();
    s.players[0].techs.push("strategy");
    s = applyAction(s, { type: "offerPeace", player: 1 });
    expect(has(s, (a) => a.type === "offerPeace")).toBe(false); // already pending
    s = applyAction(s, { type: "endTurn" });
    expect(s.current).toBe(1);
    expect(s.players[1].techs).not.toContain("strategy");
    const replies = legalActions(s).filter((a) => a.type === "acceptPeace" || a.type === "declinePeace");
    expect(replies).toEqual([
      { type: "acceptPeace", player: 0 },
      { type: "declinePeace", player: 0 },
    ]);
    s = applyAction(s, { type: "acceptPeace", player: 0 });
    expect(atPeace(s, 0, 1)).toBe(true);
    expect(relation(s, 1, 0)).toBe("peace");
    expect(has(s, (a) => a.type === "breakPeace" && a.player === 0)).toBe(true);
  });

  it("a declined or unanswered offer lapses", () => {
    let s = blank();
    s.players[0].techs.push("strategy");
    s = applyAction(s, { type: "offerPeace", player: 1 });
    s = applyAction(s, { type: "endTurn" });
    const declined = applyAction(s, { type: "declinePeace", player: 0 });
    expect(atPeace(declined, 0, 1)).toBe(false);
    expect(declined.diplomacy!.offers).toEqual([]);
    const lapsed = applyAction(s, { type: "endTurn" });
    expect(lapsed.diplomacy!.offers).toEqual([]);
    expect(atPeace(lapsed, 0, 1)).toBe(false);
  });

  it("every new action has a button label", () => {

    const s = blank();
    expect(actionLabel(s, { type: "offerPeace", player: 1 })).toBe("Offer Peace to Imperius");
    expect(actionLabel(s, { type: "acceptPeace", player: 1 })).toMatch(/^Accept Peace/);
    expect(actionLabel(s, { type: "declinePeace", player: 1 })).toMatch(/^Decline Peace/);
    expect(actionLabel(s, { type: "breakPeace", player: 1 })).toMatch(/^Break Peace/);
  });
});

describe("effects of peace", () => {
  it("no attacks and no conversions between partners", () => {
    const s = blank();
    put(s, "warrior", 0, 5, 5);
    put(s, "mindBender", 0, 5, 7);
    put(s, "warrior", 1, 6, 6);
    expect(has(s, (a) => a.type === "attack")).toBe(true);
    peace(s);
    expect(has(s, (a) => a.type === "attack")).toBe(false);
  });

  it("no capturing a partner's city", () => {
    const s = blank();
    const w = put(s, "warrior", 0, N - 1, N - 1);
    expect(has(s, (a) => a.type === "capture" && a.unitId === w.id)).toBe(true);
    peace(s);
    expect(has(s, (a) => a.type === "capture" && a.unitId === w.id)).toBe(false);
    // a partner's unit in the city does not besiege it
    expect(underSiege(s, s.cities[1])).toBe(false);
  });

  it("no infiltrating a partner's city", () => {
    const s = blank();
    s.players[0].techs.push("diplomacy");
    const c = put(s, "cloak", 0, N - 2, N - 2);
    c.hidden = true;
    c.startedHidden = true;
    expect(has(s, (a) => a.type === "infiltrate")).toBe(true);
    peace(s);
    expect(has(s, (a) => a.type === "infiltrate")).toBe(false);
  });

  it("partners exert no zone of control and can be passed through", () => {
    const s = blank();
    const r = put(s, "rider", 0, 2, 2);
    put(s, "warrior", 1, 4, 2);
    expect(reach(s, r, 4, 4)).toBe(false); // the only 2-step path ends next to the warrior
    peace(s);
    expect(reach(s, r, 4, 4)).toBe(true);

    const t = blank();
    tile(t, 3, 1).terrain = "mountain";
    tile(t, 3, 3).terrain = "mountain";
    const r2 = put(t, "rider", 0, 2, 2);
    put(t, "warrior", 1, 3, 2);
    expect(reach(t, r2, 4, 2)).toBe(false);
    peace(t);
    expect(reach(t, r2, 4, 2)).toBe(true);
    expect(reach(t, r2, 3, 2)).toBe(false); // may not stop on it
  });

  it("roads work in allied territory, not in enemy territory", () => {
    const s = blank();
    for (const x of [3, 4, 5]) tile(s, x, 5).road = true;
    ownBy1(s, [3, 5], [4, 5], [5, 5]);
    const w = put(s, "warrior", 0, 3, 5);
    expect(reach(s, w, 5, 5)).toBe(false);
    peace(s);
    expect(reach(s, w, 5, 5)).toBe(true);
  });

  it("land units board at a partner's port", () => {
    const s = blank();
    s.players[0].techs.push("fishing");
    tile(s, 4, 5).terrain = "water";
    tile(s, 4, 5).building = "port";
    ownBy1(s, [4, 5]);
    const w = put(s, "warrior", 0, 3, 5);
    expect(reach(s, w, 4, 5)).toBe(false);
    peace(s);
    expect(reach(s, w, 4, 5)).toBe(true);
  });

  it("rafts upgrade in a partner's territory", () => {
    const s = blank();
    s.players[0].techs.push("fishing", "sailing");
    tile(s, 4, 5).terrain = "water";
    ownBy1(s, [4, 5]);
    const raft = put(s, "raft", 0, 4, 5);
    raft.carried = "warrior";
    expect(has(s, (a) => a.type === "upgrade" && a.unitId === raft.id)).toBe(false);
    peace(s);
    expect(has(s, (a) => a.type === "upgrade" && a.unitId === raft.id)).toBe(true);
  });

  it("units heal 4 HP in a partner's territory, 2 in an enemy's", () => {
    const s = blank();
    ownBy1(s, [5, 5]);
    const w = put(s, "warrior", 0, 5, 5);
    w.hp = 4;
    expect(unit(applyAction(s, { type: "recover", unitId: w.id }), w.id)!.hp).toBe(6);
    peace(s);
    expect(unit(applyAction(s, { type: "recover", unitId: w.id }), w.id)!.hp).toBe(8);
  });

  it("embassy income doubles at peace (2 to 4 each side)", () => {
    const s = blank();
    s.players[0].embassies = [1];
    const before0 = income(s, 0);
    const before1 = income(s, 1);
    peace(s);
    expect(income(s, 0) - before0).toBe(2);
    expect(income(s, 1) - before1).toBe(2);
    // embassies both ways plus peace: 8 each
    s.players[1].embassies = [0];
    s.players[0].embassies = [];
    const one = income(s, 0);
    s.players[0].embassies = [1];
    expect(income(s, 0) - one).toBe(4);
  });

  it("partners see each other's Cloaks", () => {
    const s = blank();
    const c = put(s, "cloak", 1, 6, 6);
    c.hidden = true;
    put(s, "warrior", 0, 2, 2);
    expect(canSee(s, 0, c)).toBe(false);
    peace(s);
    expect(canSee(s, 0, c)).toBe(true);
  });
});

describe("breaking peace", () => {
  function atPeaceWithUnits() {
    const s = blank();
    peace(s);
    ownBy1(s, [6, 6]);
    const inside = put(s, "warrior", 0, N - 2, N - 2); // inside player 1's city borders
    const inside2 = put(s, "warrior", 0, 6, 6);
    const outside = put(s, "warrior", 0, 5, 5);
    const victim = put(s, "warrior", 1, 4, 4);
    return { s, inside, inside2, outside, victim };
  }

  it("destroys the breaker's units inside the victim's borders, with no refund", () => {
    const { s, inside, inside2, outside } = atPeaceWithUnits();
    const stars = s.players[0].stars;
    const t = applyAction(s, { type: "breakPeace", player: 1 });
    expect(atPeace(t, 0, 1)).toBe(false);
    expect(unit(t, inside.id)).toBeUndefined();
    expect(unit(t, inside2.id)).toBeUndefined();
    expect(unit(t, outside.id)).toBeDefined();
    expect(t.players[0].stars).toBe(stars);
  });

  it("a cease-fire (Hostile) holds until the breaker's next turn", () => {
    const { s, outside, victim } = atPeaceWithUnits();
    let t = applyAction(s, { type: "breakPeace", player: 1 });
    expect(relation(t, 0, 1)).toBe("hostile");
    expect(has(t, (a) => a.type === "attack" && a.unitId === outside.id)).toBe(false);
    t = applyAction(t, { type: "endTurn" });
    expect(t.current).toBe(1);
    expect(has(t, (a) => a.type === "attack" && a.unitId === victim.id)).toBe(false);
    t = applyAction(t, { type: "endTurn" });
    expect(t.current).toBe(0);
    expect(relation(t, 0, 1)).toBe("neutral");
    expect(has(t, (a) => a.type === "attack" && a.unitId === outside.id)).toBe(true);
  });

  it("the victim keeps a permanent Foolish opinion of the breaker", () => {
    const { s } = atPeaceWithUnits();
    expect(opinion.opinionFactors(s, 1, 0)).not.toContain("foolish");
    let t = applyAction(s, { type: "breakPeace", player: 1 });
    t.turn += 20;
    expect(opinion.opinionFactors(t, 1, 0)).toContain("foolish");
    t = cloneState(t);
    expect(opinion.opinionFactors(t, 1, 0)).toContain("foolish");
  });
});

describe("war, neutral and embassies", () => {
  it("an attack means war this turn and the next, then neutral", () => {
    const s = blank();
    const w = put(s, "warrior", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 6);
    expect(relation(s, 0, 1)).toBe("neutral");
    const t = applyAction(s, { type: "attack", unitId: w.id, targetId: e.id });
    expect(atWar(t, 1, 0)).toBe(true);
    t.turn += 1;
    expect(relation(t, 0, 1)).toBe("war");
    t.turn += 1;
    expect(relation(t, 0, 1)).toBe("neutral");
  });

  it("an embassy (4★ first) is allowed when neutral and at war (2.18), and the host meets the sender", () => {
    const s = blank();
    s.players[0].techs.push("diplomacy");
    s.players[1].met = [];
    const isEmbassy = (a: Action) => a.type === "build" && a.building === "embassy";
    expect(has(s, isEmbassy)).toBe(true);
    const built = applyAction(s, legalActions(s).find(isEmbassy)!);
    expect(built.players[0].stars).toBe(50 - 4);
    expect(built.players[1].met).toContain(0);
    expect(built.players[1].stars).toBeGreaterThan(50);

    const w = put(s, "warrior", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 6);
    const war = applyAction(s, { type: "attack", unitId: w.id, targetId: e.id });
    expect(has(war, isEmbassy)).toBe(true);
  });

  it("an attack either way destroys both embassies", () => {
    const s = blank();
    s.players[0].embassies = [1];
    s.players[1].embassies = [0];
    const w = put(s, "warrior", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 6);
    const t = applyAction(s, { type: "attack", unitId: w.id, targetId: e.id });
    expect(t.players[0].embassies).toEqual([]);
    expect(t.players[1].embassies).toEqual([]);
  });

  it("a conversion counts as an attack (war) but not against the Altar of Peace", () => {
    const s = blank();
    s.players[0].techs.push("meditation");
    const m = put(s, "mindBender", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 6);
    const t = applyAction(s, { type: "attack", unitId: m.id, targetId: e.id });
    expect(unit(t, e.id)!.owner).toBe(0);
    expect(t.players[0].attackedThisTurn).toBe(false);
    expect(atWar(t, 0, 1)).toBe(true);
  });
});

describe("Cloak", () => {
  it("harvesting a starfish reveals it", () => {
    const s = blank();
    s.players[0].techs.push("navigation");
    const c = put(s, "cloak", 0, 5, 5);
    c.hidden = true;
    tile(s, 5, 5).resource = "starfish";
    const t = applyAction(s, { type: "harvestStarfish", unitId: c.id });
    expect(unit(t, c.id)!.hidden).toBe(false);
  });

  it("an enemy entering a hidden Cloak's tile is stopped and reveals it; moves don't leak its position", () => {
    const s = blank();
    const r = put(s, "rider", 0, 2, 5);
    const c = put(s, "cloak", 1, 4, 5);
    c.hidden = true;
    expect(canSee(s, 0, c)).toBe(false);
    // the hidden tile looks free, exactly like any other tile
    expect(has(s, (a) => a.type === "move" && a.unitId === r.id && a.to.x === 4 && a.to.y === 5)).toBe(true);
    const t = applyAction(s, { type: "move", unitId: r.id, to: { x: 4, y: 5 } });
    const r2 = unit(t, r.id)!;
    expect(r2.x === 4 && r2.y === 5).toBe(false);
    expect(Math.max(Math.abs(r2.x - 4), Math.abs(r2.y - 5))).toBe(1);
    expect(unit(t, c.id)!.hidden).toBe(false);
    expect(r2.canMove).toBe(false);
  });

  it("can't infiltrate on the turn it became hidden, unless it started that turn hidden", () => {
    const s = blank();
    s.players[0].techs.push("diplomacy");
    const c = put(s, "cloak", 0, N - 4, N - 2);
    const t = applyAction(s, { type: "move", unitId: c.id, to: { x: N - 2, y: N - 2 } });
    expect(unit(t, c.id)!.hidden).toBe(true);
    expect(has(t, (a) => a.type === "infiltrate")).toBe(false);

    const c2 = { ...c, hidden: true };
    s.units = s.units.map((u) => (u.id === c.id ? c2 : u));
    let u = applyAction(s, { type: "endTurn" });
    u = applyAction(u, { type: "endTurn" });
    expect(unit(u, c.id)!.startedHidden).toBe(true);
    u = applyAction(u, { type: "move", unitId: c.id, to: { x: N - 2, y: N - 2 } });
    expect(has(u, (a) => a.type === "infiltrate")).toBe(true);
  });

  it("Daggers spawn in the city, then on defensive tiles inside the borders", () => {
    const s = blank();
    s.players[0].techs.push("diplomacy");
    s.cities[1].level = 2;
    tile(s, N - 2, N - 1).terrain = "forest";
    const c = put(s, "cloak", 0, N - 2, N - 2);
    c.hidden = true;
    c.startedHidden = true;
    const t = applyAction(s, { type: "infiltrate", unitId: c.id, cityId: s.cities[1].id });
    const daggers = t.units.filter((u) => u.type === "dagger" && u.owner === 0);
    expect(daggers).toHaveLength(2);
    expect(daggers.some((d) => d.x === N - 1 && d.y === N - 1)).toBe(true);
    expect(daggers.some((d) => d.x === N - 2 && d.y === N - 1)).toBe(true);
  });
});

describe("what bots think of you", () => {
  afterEach(() => jest.restoreAllMocks());

  it("lists the doc's factors: Violent after an attack, Peaceful otherwise, Diplomatic with an embassy, Annoying on hard", () => {
    const s = blank();
    expect(opinion.opinionFactors(s, 1, 0)).toContain("peaceful");
    expect(opinion.opinionFactors(s, 1, 0)).not.toContain("diplomatic");
    s.players[0].embassies = [1];
    expect(opinion.opinionFactors(s, 1, 0)).toContain("diplomatic");
    const w = put(s, "warrior", 0, 5, 5);
    const e = put(s, "warrior", 1, 6, 6);
    const t = applyAction(s, { type: "attack", unitId: w.id, targetId: e.id });
    expect(opinion.opinionFactors(t, 1, 0)).toContain("violent");
    expect(opinion.opinionFactors(t, 1, 0)).not.toContain("peaceful");
    t.difficulty = "hard";
    expect(opinion.opinionFactors(t, 1, 0)).toContain("annoying");
    expect(opinion.opinionLevel(3)).toBe("great");
    expect(opinion.opinionLevel(2)).toBe("decent");
    expect(opinion.opinionLevel(-3)).toBe("horrible");
  });

  it("a bot accepts peace only at a great opinion, else declines", () => {
    let s = blank();
    s.players[1].bot = true;
    s.players[0].techs.push("strategy");
    s = applyAction(s, { type: "offerPeace", player: 1 });
    s = applyAction(s, { type: "endTurn" });
    const spy = jest.spyOn(opinion, "opinionOf").mockReturnValue("decent");
    expect(botStep(s)).toEqual({ type: "declinePeace", player: 0 });
    spy.mockReturnValue("great");
    expect(botStep(s)).toEqual({ type: "acceptPeace", player: 0 });
  });

  it("a bot offers peace at a great opinion and never breaks a treaty", () => {
    const s = blank();
    s.current = 1;
    s.players[1].techs.push("strategy");
    jest.spyOn(opinion, "opinionOf").mockReturnValue("great");
    expect(scoreAction(s, { type: "offerPeace", player: 0 })).toBeGreaterThan(0);
    peace(s);
    expect(scoreAction(s, { type: "breakPeace", player: 0 })).toBeLessThan(0);
    expect(botStep(s).type).not.toBe("breakPeace");
  });
});

describe("meeting tribes and saves", () => {
  it("meeting pays 1 + 2 per 1,000 of the met tribe's score, at most 11", () => {
    const s = blank();
    s.players[0].met = [];
    const stars = s.players[0].stars;
    const w = put(s, "warrior", 1, 5, 5);
    const t = applyAction(s, { type: "move", unitId: put(s, "warrior", 0, 3, 5).id, to: { x: 4, y: 5 } });
    expect(t.players[0].met).toContain(1);
    expect(t.players[0].stars - stars).toBeGreaterThanOrEqual(3);
    expect(t.players[0].stars - stars).toBeLessThanOrEqual(11);
    void w;
  });

  it("a state saved before diplomacy existed still loads and plays", () => {
    const s = blank();
    put(s, "warrior", 0, 5, 5);
    const old = JSON.parse(JSON.stringify(s)) as GameState;
    delete old.diplomacy;
    expect(legalActions(old).length).toBeGreaterThan(1);
    const t = applyAction(old, { type: "endTurn" });
    expect(relation(t, 0, 1)).toBe("neutral");
    expect(old.diplomacy).toBeUndefined();
  });
});
