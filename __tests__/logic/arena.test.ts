import { applyAction } from "../../logic/engine/actions";
import { createGame } from "../../logic/engine/state";
import { botStep } from "../../logic/engine/bot";
import { finishRecord, recordStep, replayStates, startRecord, type GameRecord } from "../../logic/arena/record";
import { rebuild, START_RATING } from "../../logic/arena/elo";
import { BUILTIN_MODELS, createAgent } from "../../logic/agents/registry";
import { candidates, parseChoice } from "../../logic/agents/llm";

function playRecorded(seed: number, maxTurns = 12): GameRecord {
  let s = createGame({ mapSize: 11, players: 2, mode: "perfection", seed, humans: [] });
  const rec = startRecord(s, [
    { kind: "model", modelId: "greedy-v1" },
    { kind: "model", modelId: "random-v1" },
  ], "arena");
  let guard = 0;
  while (!s.over && s.turn <= maxTurns && guard++ < 5000) {
    const a = botStep(s);
    const next = applyAction(s, a);
    recordStep(rec, s, a, next);
    s = next;
  }
  return finishRecord(rec, s);
}

describe("game records", () => {
  it("replay rebuilds exactly the recorded states", () => {
    const rec = playRecorded(7);
    const states = replayStates(rec);
    expect(states.length).toBe(rec.steps.length + 1);
    // every turn snapshot appears in the replay
    const replayed = new Set(states.map((x) => JSON.stringify(x)));
    for (const t of rec.turnStates) expect(replayed.has(JSON.stringify(t))).toBe(true);
  });
  it("survives a JSON round trip (what the server stores)", () => {
    const rec = JSON.parse(JSON.stringify(playRecorded(11))) as GameRecord;
    const states = replayStates(rec);
    expect(states[states.length - 1].turn).toBe(rec.result!.turns);
  });
});

describe("Elo", () => {
  const finished = (winner: number, scores: number[], seats = ["a", "b"]): GameRecord =>
    ({
      version: 1,
      id: Math.random().toString(36),
      startedAt: "2026-11-23T00:00:00Z",
      endedAt: "2026-11-23T01:00:00Z",
      source: "arena",
      options: { mapSize: 11, players: seats.length, mode: "perfection", seed: 1, clans: [] },
      seats: seats.map((m) => ({ kind: "model", modelId: m })),
      steps: [],
      turnStates: [],
      result: { over: true, winner, turns: 30, scores, alive: seats.map(() => true) },
    }) as GameRecord;

  const many = (aWins: number, bWins: number) => [
    ...Array.from({ length: aWins }, () => finished(0, [2, 1])),
    ...Array.from({ length: bWins }, () => finished(1, [1, 2])),
  ];

  it("rates the player who won more head-to-head games higher", () => {
    const r = rebuild(many(44, 36), 0);
    expect(r["model:a"].rating).toBeGreaterThan(r["model:b"].rating);
    expect(r["model:a"].games).toBe(80);
    expect(r["model:a"].wins).toBe(44);
  });
  it("does not depend on the order games were played in", () => {
    const g = many(10, 6);
    const a = rebuild(g, 0);
    const b = rebuild([...g].reverse(), 0);
    expect(a["model:a"].rating).toBeCloseTo(b["model:a"].rating, 6);
  });
  it("keeps a player with one game near the start (the prior)", () => {
    const r = rebuild([finished(0, [2, 1])], 0);
    expect(r["model:a"].rating).toBeGreaterThan(START_RATING);
    expect(r["model:a"].rating).toBeLessThan(START_RATING + 150);
  });
  it("gives a 95% interval around the rating, narrower with more games", () => {
    const few = rebuild(many(6, 4), 200)["model:a"];
    const lots = rebuild(many(60, 40), 200)["model:a"];
    expect(few.lo!).toBeLessThanOrEqual(few.rating);
    expect(few.hi!).toBeGreaterThanOrEqual(few.rating);
    expect(lots.hi! - lots.lo!).toBeLessThan(few.hi! - few.lo!);
  });
  it("ignores unfinished games and self-play pairs", () => {
    const g = finished(0, [1, 0]);
    g.result!.over = false;
    expect(rebuild([g], 0)).toEqual({});
    expect(rebuild([finished(0, [1, 0], ["a", "a"])], 0)["model:a"].rating).toBeCloseTo(START_RATING, 6);
  });
});

describe("agents", () => {
  const s = createGame({ mapSize: 11, players: 2, mode: "perfection", seed: 3, humans: [] });
  it("every built-in model returns a legal action", async () => {
    for (const spec of BUILTIN_MODELS) {
      const agent = createAgent(spec, async () => {
        throw new Error("no LLM in tests");
      });
      const a = await agent.act(s);
      expect(a).toBeTruthy();
      applyAction(s, a); // throws on an illegal action
    }
  });
  it("the LLM menu starts with end turn and parses the chosen number", () => {
    const menu = candidates(s, 24);
    expect(menu[0].type).toBe("endTurn");
    expect(menu.length).toBeLessThanOrEqual(24);
    expect(parseChoice("<think>maybe 9</think> 2", menu.length)).toBe(2);
    expect(parseChoice("I pick move 99", 5)).toBeNull();
  });
  it("an LLM answer picks that menu entry", async () => {
    const spec = BUILTIN_MODELS.find((m) => m.kind === "llm")!;
    const agent = createAgent(spec, async () => "1");
    const a = await agent.act(s);
    expect(JSON.stringify(a)).toBe(JSON.stringify(candidates(s, spec.llm!.maxCandidates ?? 24)[1]));
    expect(agent.stats!.byModel).toBe(1);
  });
});
