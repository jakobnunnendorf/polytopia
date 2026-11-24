/**
 * The full-action-space greedy bot (logic/engine/botFull.ts, kind "greedy-full"):
 * it only plays legal actions, its centre heuristic prefers moves toward the map
 * centre, and the plain greedy bot (and the saved greedy models) still play exactly
 * as before it existed.
 */
import { applyAction, createGame, legalActions } from "@/logic/engine";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "@/logic/engine/bot";
import { DEFAULT_FULL_WEIGHTS, FULL_ACTION_TYPES, centreDist, fullBotStep, fullWeights, scoreFull, type FullWeights } from "@/logic/engine/botFull";
import { makeUnit } from "@/logic/engine/state";
import { createAgent, directChat } from "@/logic/agents/registry";
import type { ModelSpec } from "@/logic/agents/types";
import type { Action, GameState } from "@/logic/engine/types";
import type { MapType } from "@/logic/engine/mapgen";
import v4 from "../../models/greedy-hill-v4/model.json";

function hashActions(s: GameState, step: (s: GameState) => Action, n: number): { h: number; moves: number; state: GameState } {
  let h = 2166136261 >>> 0;
  let moves = 0;
  while (!s.over && moves < n) {
    const str = JSON.stringify(step(s));
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    s = applyAction(s, JSON.parse(str));
    moves++;
  }
  return { h, moves, state: s };
}

const domination = (seed: number, mapType: MapType = "drylands") => createGame({ mapSize: 16, players: 4, mode: "domination", seed, humans: [], mapType });

describe("greedy-full bot", () => {
  // a variant that unlocks every action the heuristic rejects, so disband, breakPeace,
  // infiltrate, roads, ... are played too
  const wild: FullWeights = fullWeights({ open: Object.fromEntries(FULL_ACTION_TYPES.map((t) => [t, 3])), centre: 2, tech: { mathematics: 5 }, unit: { catapult: 4 } });

  it.each([
    ["drylands", DEFAULT_FULL_WEIGHTS, 11],
    ["lakes", wild, 12],
    ["archipelago", DEFAULT_FULL_WEIGHTS, 13],
    ["continents", wild, 14],
  ] as [MapType, FullWeights, number][])("plays only legal actions in 4-player Domination on %s", (mapType, w, seed) => {
    let s = domination(seed, mapType);
    let steps = 0;
    while (!s.over && s.turn <= 25 && steps < 4000) {
      const a = fullBotStep(s, w);
      expect(legalActions(s).map((x) => JSON.stringify(x))).toContain(JSON.stringify(a));
      s = applyAction(s, a);
      steps++;
    }
    expect(s.turn).toBeGreaterThan(5);
  });

  it("covers every action type, tech, unit and build with a knob", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(DEFAULT_FULL_WEIGHTS.type)).toEqual(keys(DEFAULT_FULL_WEIGHTS.open));
    expect(DEFAULT_FULL_WEIGHTS.type).toHaveProperty("breakPeace");
    expect(DEFAULT_FULL_WEIGHTS.tech).toHaveProperty("mathematics");
    expect(DEFAULT_FULL_WEIGHTS.unit).toHaveProperty("catapult");
    expect(DEFAULT_FULL_WEIGHTS.build).toHaveProperty("road");
  });

  it("the centre heuristic prefers the move toward the centre", () => {
    let s = domination(21);
    s = { ...s, units: [], tiles: s.tiles.map((t) => ({ ...t, village: false, ruin: false, cityId: null })) };
    s.players = s.players.map((p) => ({ ...p, explored: p.explored.map(() => 1) as typeof p.explored }));
    s.current = 0;
    const u = makeUnit(s, "warrior", 0, { x: 2, y: 2 }, null);
    s.tiles[8 * 16 + 2].village = true; // the goal, straight down: both moves below gain one tile toward it
    const edge: Action = { type: "move", unitId: u.id, to: { x: 1, y: 3 } };
    const centre: Action = { type: "move", unitId: u.id, to: { x: 3, y: 3 } };
    expect(centreDist(16, { x: 3, y: 3 })).toBeLessThan(centreDist(16, { x: 1, y: 3 }));
    const w = fullWeights({ greedy: { noise: 0 } });
    expect(scoreFull(s, centre, w)).toBeGreaterThan(scoreFull(s, edge, w));
    // exactly centre points per tile closer to the centre
    expect(scoreFull(s, centre, w) - scoreFull(s, edge, w)).toBeCloseTo(2 * w.centre);
    const flat = fullWeights({ greedy: { noise: 0 }, centre: 0 });
    expect(scoreFull(s, centre, flat)).toBe(scoreFull(s, edge, flat));
  });

  it("with neutral knobs plays exactly like the greedy bot", () => {
    const neutral = fullWeights({ centre: 0, open: Object.fromEntries(FULL_ACTION_TYPES.map((t) => [t, 0])) });
    const a = hashActions(domination(4242), (s) => botStep(s, DEFAULT_WEIGHTS), 600);
    const b = hashActions(domination(4242), (s) => fullBotStep(s, neutral), 600);
    expect(b).toEqual(a);
  });

  it("a greedy-full model file plays through the registry", async () => {
    const spec: ModelSpec = { id: "t", name: "t", kind: "greedy-full", description: "", created: "", full: { centre: 3, unit: { catapult: 2 } } };
    const agent = createAgent(spec, directChat);
    const s = domination(5);
    expect(await agent.act(s)).toEqual(fullBotStep(s, fullWeights(spec.full)));
  });
});

describe("greedy bots are unchanged", () => {
  // action-sequence hashes recorded on origin/main before botFull.ts existed (1500 actions, seed 4242)
  it.each([
    ["greedy-v1 (DEFAULT_WEIGHTS)", DEFAULT_WEIGHTS, 3830730974],
    ["greedy-hill-v4", { ...DEFAULT_WEIGHTS, ...v4.weights, rewards: { ...DEFAULT_WEIGHTS.rewards, ...v4.weights.rewards } }, 715102172],
  ] as [string, GreedyWeights, number][])("%s plays the same actions as before", (_name, w, expected) => {
    expect(hashActions(domination(4242), (s) => botStep(s, w), 1500).h).toBe(expected);
  });

  it("greedy-hill-v4 through the registry plays its weights", async () => {
    const agent = createAgent(v4 as ModelSpec, directChat);
    const s = domination(9);
    const w = { ...DEFAULT_WEIGHTS, ...v4.weights, rewards: { ...DEFAULT_WEIGHTS.rewards, ...v4.weights.rewards } };
    expect(await agent.act(s)).toEqual(botStep(s, w));
  });
});
