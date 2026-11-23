/**
 * Model-vs-model arena: plays configured models against each other, records
 * every game into data/games/ and updates data/ratings.json.
 *
 *   npm run arena -- --models greedy-v1,random-v1 --games 20
 *   npm run arena -- --models greedy-v1,qwen3-coder-lmstudio --games 2 --size 11 --mode perfection
 *
 * Seats rotate every game so each model plays from every seat (first-move advantage evens out).
 */
import { applyAction } from "../logic/engine/actions";
import { createGame } from "../logic/engine/state";
import type { GameMode } from "../logic/engine/types";
import type { MapType } from "../logic/engine/mapgen";
import { createAgent, directChat } from "../logic/agents/registry";
import { finishRecord, recordStep, startRecord, type Seat } from "../logic/arena/record";
import { listModels, readRatings, saveGame } from "./lib/store";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

async function main() {
  const all = listModels();
  const ids = arg("models", "greedy-v1,random-v1").split(",").map((x) => x.trim()).filter(Boolean);
  const specs = ids.map((id) => {
    const m = all.find((x) => x.id === id);
    if (!m) throw new Error(`No model "${id}" in models/. Known: ${all.map((x) => x.id).join(", ")}`);
    return m;
  });
  const games = Number(arg("games", "10"));
  const size = Number(arg("size", "11"));
  const mode = arg("mode", "perfection") as GameMode;
  const mapType = arg("map", "drylands") as MapType;
  const seed0 = Number(arg("seed", String(Date.now() % 1_000_000)));
  const maxTurns = Number(arg("max-turns", "60"));

  for (let g = 0; g < games; g++) {
    const order = specs.map((_, i) => specs[(i + g) % specs.length]);
    const agents = order.map((m) => createAgent(m, directChat, all));
    const seats: Seat[] = order.map((m) => ({ kind: "model", modelId: m.id }));
    let s = createGame({ mapSize: size, players: order.length, mode, seed: seed0 + g, humans: [], mapType });
    const rec = startRecord(s, seats, "arena", mapType);
    let perTurn = 0;
    let lastKey = "";
    while (!s.over && s.turn <= maxTurns) {
      const key = `${s.turn}:${s.current}`;
      perTurn = key === lastKey ? perTurn + 1 : 0;
      lastKey = key;
      const a = perTurn > 300 ? { type: "endTurn" as const } : await agents[s.current].act(s);
      const next = applyAction(s, a);
      recordStep(rec, s, a, next);
      s = next;
    }
    finishRecord(rec, s);
    const out = saveGame(rec);
    const line = order
      .map((m, i) => `${m.id}${s.winner === i ? " (won)" : ""} ${rec.result!.scores[i]} ${out.deltas[i] >= 0 ? "+" : ""}${out.deltas[i]}`)
      .join("  |  ");
    console.log(`game ${g + 1}/${games}  turns ${s.turn}  ${line}  -> ${out.file}`);
    agents.forEach((ag) => ag.stats && console.log(`  ${ag.spec.id}: ${ag.stats.byModel}/${ag.stats.decisions} decisions by the model, ${ag.stats.fallbacks} fallbacks${ag.stats.lastError ? ` (last: ${ag.stats.lastError})` : ""}`));
  }

  const ratings = readRatings();
  console.log("\nElo");
  Object.entries(ratings)
    .sort((a, b) => b[1].rating - a[1].rating)
    .forEach(([k, r]) => console.log(`  ${k.padEnd(36)} ${r.rating.toFixed(0).padStart(5)}  games ${r.games}  wins ${r.wins}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
