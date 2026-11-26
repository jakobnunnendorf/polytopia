/**
 * The Elo tournament's pieces (scripts/elo-tournament.ts): the rating fit of scripts/lib/elo-fit.ts
 * and the Rust engine's "random" policy, which must play the same games as the TypeScript random
 * agent (models/random-v1).
 */
import { applyAction } from "@/logic/engine/actions";
import { createGame, scoreOf } from "@/logic/engine/state";
import { call } from "@/logic/engine/rust";
import { createAgent, directChat } from "@/logic/agents/registry";
import type { ModelSpec } from "@/logic/agents/types";
import type { GameMode } from "@/logic/engine/types";
import { ANCHOR_ID, ANCHOR_RATING, fit, fitAll, modeWeights, parseResults, readGame, solve, type Agent, type GameRow, type Meta, type PairRow, type Setup } from "../../scripts/lib/elo-fit";
import greedyV1 from "../../models/greedy-v1/model.json";
import randomV1 from "../../models/random-v1/model.json";

const SETUP: Setup = { players: 4, size: 16, mapType: "drylands", maxTurns: 150, maxMoves: 1_000_000, games: 4 };
const AGENTS: Agent[] = [
  { id: "greedy-v1", kind: "greedy" },
  { id: "strong", kind: "greedy" },
  { id: "weak", kind: "random" },
];

/** games in which `a` wins `aWins` of `n`, two per seed (one per seating), ended by the mode's rule */
function pairRow(a: string, b: string, aWins: number, n: number, mode = "domination"): PairRow {
  const games: GameRow[] = [];
  for (let k = 0; k < n; k++) {
    const seating = k % 2;
    const aSeat = seating; // a's first seat
    const winner = k < aWins ? aSeat : 1 - aSeat;
    games.push([Math.floor(k / 2), seating, winner, 1, 40, 900, 10, 10, 10, 10]);
  }
  return { mode, a, b, games, seconds: 1, at: "" };
}

describe("readGame", () => {
  it("gives the game to the engine's winner seat, from side a's view", () => {
    // seating 1: a sits on the odd seats; seat 3 won
    const g = readGame([7, 1, 3, 1, 50, 1000, 100, 300, 100, 500], SETUP);
    expect(g).toMatchObject({ seed: 7, aWon: true, byRule: true, turn: 50 });
    expect(g.aShare).toBeCloseTo(0.8);
    // a win by the rule a third of the way to the cap: 0.75 + 0.25 * (100 / 150)
    expect(g.aFinish).toBeCloseTo(0.75 + 0.25 * (100 / 150));
  });
  it("decides a game stopped at the cap on the highest-scoring seat, a tie going to the later seat", () => {
    expect(readGame([0, 0, -1, 0, 150, 5000, 400, 300, 100, 200], SETUP).aWon).toBe(true);
    const tie = readGame([0, 0, -1, 0, 150, 5000, 400, 400, 100, 100], SETUP);
    expect(tie.aWon).toBe(false);
    expect(tie.byRule).toBe(false);
    expect(tie.aFinish).toBeCloseTo(0.25 + 0.5 * 0.5);
  });
});

describe("the rating fit", () => {
  it("recovers the gap that a win rate implies and puts the anchor at its rating", () => {
    // strong wins 3 of 4 against greedy-v1: 3:1 odds = 400 * log10(3) = 191 points
    const rows = [pairRow("greedy-v1", "strong", 250, 1000)];
    const f = fit(rows, AGENTS.slice(0, 2), { domination: SETUP }, 0);
    const [first, second] = f.ranking;
    expect(first.id).toBe("strong");
    expect(second.id).toBe(ANCHOR_ID);
    expect(second.rating).toBe(ANCHOR_RATING);
    expect(Math.abs(first.rating - ANCHOR_RATING - 400 * Math.log10(3))).toBeLessThan(2);
    expect(first.winRate).toBeCloseTo(0.75);
    expect(f.matrix.strong["greedy-v1"]).toMatchObject({ games: 1000, wins: 750 });
  });

  it("does not depend on the order of the rows or of the games", () => {
    const rows = [pairRow("greedy-v1", "strong", 30, 100), pairRow("greedy-v1", "weak", 90, 100), pairRow("strong", "weak", 97, 100)];
    const shuffled = [...rows].reverse().map((r) => ({ ...r, games: [...r.games].reverse() }));
    const a = fit(rows, AGENTS, { domination: SETUP }, 50);
    const b = fit(shuffled, AGENTS, { domination: SETUP }, 50);
    const key = (f: typeof a) => f.ranking.map((r) => [r.id, r.rating, r.lo, r.hi, r.aboveNext, r.games, r.wins]);
    expect(key(b)).toEqual(key(a));
    b.ranking.forEach((r, i) => expect(r.finish).toBeCloseTo(a.ranking[i].finish, 9));
    expect(a.ranking.map((r) => r.id)).toEqual(["strong", "greedy-v1", "weak"]);
    for (const r of a.ranking) {
      expect(r.lo).toBeLessThanOrEqual(r.rating);
      expect(r.hi).toBeGreaterThanOrEqual(r.rating);
    }
  });

  it("keeps an agent that never won at a finite rating, below everyone", () => {
    const rows = [pairRow("greedy-v1", "weak", 100, 100), pairRow("strong", "weak", 100, 100), pairRow("greedy-v1", "strong", 40, 100)];
    const f = fit(rows, AGENTS, { domination: SETUP }, 0);
    const weak = f.ranking[2];
    expect(weak.id).toBe("weak");
    expect(weak.wins).toBe(0);
    expect(Number.isFinite(weak.rating)).toBe(true);
    expect(weak.rating).toBeLessThan(ANCHOR_RATING - 400);
  });

  it("starts a refit from an earlier solution without changing the answer", () => {
    const wins = [
      [0, 30, 80],
      [70, 0, 95],
      [20, 5, 0],
    ];
    const cold = solve(wins);
    const warm = solve(wins, [300, -200, 50]);
    cold.forEach((x, i) => expect(warm[i]).toBeCloseTo(x, 2));
    expect(cold.reduce((a, x) => a + x, 0)).toBeCloseTo(0, 6);
  });

  it("counts every mode the same in the pooled fit, whatever its number of games", () => {
    const modes = { domination: { ...SETUP, games: 200 }, creative: { ...SETUP, games: 50 } };
    expect(modeWeights(modes)).toEqual({ domination: 1, creative: 4 });
    // strong wins 80% in domination and 20% in creative: pooled with equal weight that is even
    const meta: Meta = { start: true, at: "", firstSeed: 1, agents: AGENTS.slice(0, 2), modes, excluded: [] };
    const rows = [pairRow("greedy-v1", "strong", 40, 200, "domination"), pairRow("greedy-v1", "strong", 40, 50, "creative")];
    const r = fitAll(meta, rows, 0);
    expect(r.modes.domination.ranking[0].id).toBe("strong");
    expect(r.modes.creative.ranking[0].id).toBe("greedy-v1");
    const strong = r.overall.ranking.find((x) => x.id === "strong")!;
    expect(Math.abs(strong.rating - ANCHOR_RATING)).toBeLessThan(2);
    expect(strong.winRate).toBeCloseTo(0.5);
    expect(strong.games).toBe(250);
  });
});

describe("parseResults", () => {
  it("takes the last meta line and the last row of a pair, and skips a half-written line", () => {
    const meta = (n: number) => JSON.stringify({ start: true, at: "", firstSeed: n, agents: AGENTS, modes: { domination: SETUP }, excluded: [] });
    const text = [meta(1), JSON.stringify(pairRow("greedy-v1", "strong", 1, 2)), meta(2), JSON.stringify(pairRow("greedy-v1", "strong", 3, 4)), '{"mode":"domination","a":"gre'].join("\n");
    const { meta: m, rows } = parseResults(text);
    expect(m?.firstSeed).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].games).toHaveLength(4);
  });
});

describe("the Rust engine's random policy", () => {
  // the loop of scripts/arena.ts, with its guard (300 actions a turn) on the random seats only, as in Rust
  async function inTypeScript(seed: number, ids: string[], mode: GameMode, size: number, maxTurn: number) {
    const specs: Record<string, ModelSpec> = { "greedy-v1": greedyV1 as ModelSpec, "random-v1": randomV1 as ModelSpec };
    const agents = ids.map((id) => createAgent(specs[id], directChat, []));
    let s = createGame({ mapSize: size, players: ids.length, mode, seed, humans: [], mapType: "drylands" });
    let perTurn = 0;
    let lastKey = "";
    let moves = 0;
    while (!s.over && s.turn <= maxTurn) {
      const key = `${s.turn}:${s.current}`;
      perTurn = key === lastKey ? perTurn + 1 : 0;
      lastKey = key;
      const a = ids[s.current] === "random-v1" && perTurn > 300 ? ({ type: "endTurn" } as const) : await agents[s.current].act(s);
      s = applyAction(s, a);
      moves++;
    }
    return { winner: s.winner, over: s.over, turn: s.turn, moves, scores: ids.map((_, i) => scoreOf(s, i)) };
  }
  function inRust(seed: number, ids: string[], mode: GameMode, size: number, maxTurn: number) {
    const [r] = call<{ winner: number | null; over: boolean; turn: number; moves: number; scores: number[] }[]>("playGames", [
      { opts: { mapSize: size, players: ids.length, mode, seed, humans: [], mapType: "drylands" }, policies: ids.map((id) => (id === "random-v1" ? { kind: "random" } : { kind: "greedy", weights: null })), maxMoves: 10_000_000, maxTurn },
    ]);
    return { winner: r.winner, over: r.over, turn: r.turn, moves: r.moves, scores: r.scores };
  }

  it.each([
    [11, ["random-v1", "greedy-v1"], "perfection", 11, 12],
    [13, ["random-v1", "random-v1"], "domination", 11, 12],
    [14, ["greedy-v1", "random-v1", "random-v1"], "glory", 11, 10],
  ] as [number, string[], GameMode, number, number][])("plays seed %i (%j, %s) like the TypeScript random agent", async (seed, ids, mode, size, maxTurn) => {
    expect(inRust(seed, ids, mode, size, maxTurn)).toEqual(await inTypeScript(seed, ids, mode, size, maxTurn));
  });
});
