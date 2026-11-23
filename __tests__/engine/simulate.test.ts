/**
 * Bot-vs-bot simulations: every action a bot picks must be legal, the engine
 * must never throw, and every game must end (perfection after 30 turns,
 * domination by elimination or a safety cap).
 */
import { applyAction, createGame, legalActions, playBotTurn } from "@/logic/engine";
import { botStep } from "@/logic/engine/bot";
import type { GameState } from "@/logic/engine/types";
import type { MapType } from "@/logic/engine/mapgen";

const MAP_TYPES: MapType[] = ["drylands", "lakes", "continents", "pangea", "archipelago"];

function playOut(s: GameState, turnCap: number): GameState {
  let guard = 0;
  while (!s.over && s.turn <= turnCap) {
    s = playBotTurn(s);
    if (++guard > 5000) throw new Error("no progress");
  }
  return s;
}

function checkInvariants(s: GameState) {
  const n = s.mapSize;
  const seen = new Set<string>();
  for (const u of s.units) {
    expect(u.x >= 0 && u.y >= 0 && u.x < n && u.y < n).toBe(true);
    const k = `${u.x},${u.y}`;
    expect(seen.has(k)).toBe(false); // one unit per tile
    seen.add(k);
    expect(u.hp).toBeGreaterThan(0);
    expect(u.hp).toBeLessThanOrEqual(u.maxHp);
  }
  for (const p of s.players) expect(p.stars).toBeGreaterThanOrEqual(0);
}

describe("bot-vs-bot simulation", () => {
  it("bots only pick legal actions (checked step by step)", () => {
    let s = createGame({ mapSize: 11, players: 2, mode: "perfection", seed: 5, humans: [] });
    for (let step = 0; step < 1500 && !s.over; step++) {
      const a = botStep(s);
      const legal = legalActions(s).map((x) => JSON.stringify(x));
      expect(legal).toContain(JSON.stringify(a));
      s = applyAction(s, a);
      checkInvariants(s);
    }
  });

  it("200 games run to the end without errors", () => {
    const results: { winner: number | null; turn: number }[] = [];
    for (let g = 0; g < 200; g++) {
      const players = 2 + (g % 3);
      const mode = g % 2 === 0 ? "perfection" : "domination";
      let s = createGame({
        mapSize: players <= 2 ? 11 : 14,
        players,
        mode,
        seed: 1000 + g,
        humans: [],
        mapType: MAP_TYPES[g % MAP_TYPES.length],
      });
      s = playOut(s, mode === "perfection" ? 31 : 40);
      checkInvariants(s);
      if (mode === "perfection") {
        expect(s.over).toBe(true);
        expect(s.winner).not.toBeNull();
      }
      results.push({ winner: s.winner, turn: s.turn });
    }
    expect(results).toHaveLength(200);
  }, 600_000);
});
