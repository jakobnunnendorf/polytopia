/**
 * Play one seat of a recorded game from the command line, one move per call.
 * Built for agents (e.g. a Claude subagent) and humans in a terminal. The
 * opponents' turns are played automatically by their models in between.
 *
 *   npm run play -- new --me claude-sonnet-agent --opponent qwen3-coder-lmstudio [--size 11] [--mode perfection] [--seed 5]
 *   npm run play -- state --game <id>          position + numbered legal moves
 *   npm run play -- move --game <id> <n>       play move n, then let opponents move
 *
 * The game lives in data/games/ like every other recording and is Elo-rated when it ends.
 */
import { applyAction, legalActions } from "../logic/engine/actions";
import { createGame, scoreOf } from "../logic/engine/state";
import type { GameMode } from "../logic/engine/types";
import type { MapType } from "../logic/engine/mapgen";
import { createAgent, directChat } from "../logic/agents/registry";
import { candidates, describe, labelFor } from "../logic/agents/llm";
import { finishRecord, recordStep, replayStates, startRecord, type GameRecord, type Seat } from "../logic/arena/record";
import { findGame, listModels, saveGame } from "./lib/store";

function arg(name: string, def = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

/** the moves shown to the player: all legal moves, best-first by the greedy heuristic, end turn as 0 */
function menu(s: ReturnType<typeof createGame>) {
  return candidates(s, legalActions(s).length + 1);
}

function printState(rec: GameRecord, me: number) {
  const s = replayStates(rec).pop()!;
  if (s.over || rec.result?.over) {
    const scores = s.players.map((p) => `seat ${p.id} ${scoreOf(s, p.id)}`).join(", ");
    console.log(`GAME OVER after turn ${s.turn}. Winner: seat ${s.winner} (${s.winner === me ? "you" : "opponent"}).`);
    console.log(`Final scores: ${scores}`);
    return;
  }
  if (s.current !== me) {
    console.log("It is not your turn (opponents are still moving).");
    return;
  }
  const m = menu(s);
  console.log(describe(s));
  console.log(`\nLegal moves (${m.length}):`);
  m.forEach((a, i) => console.log(`${i}. ${labelFor(s, a)}`));
  console.log(`\nAnswer with: npm run play -- move --game ${rec.id} <number>`);
}

async function opponentsMove(rec: GameRecord, me: number): Promise<GameRecord> {
  const all = listModels();
  let s = replayStates(rec).pop()!;
  const agents = rec.seats.map((seat) => {
    if (seat.kind !== "model") return null;
    const spec = all.find((m) => m.id === seat.modelId);
    return spec && spec.kind !== "external" ? createAgent(spec, directChat, all) : null;
  });
  let guard = 0;
  while (!s.over && s.current !== me && guard++ < 5000) {
    const agent = agents[s.current];
    const a = agent ? await agent.act(s) : { type: "endTurn" as const };
    const next = applyAction(s, a);
    recordStep(rec, s, a, next);
    s = next;
  }
  agents.forEach((ag) => ag?.stats && ag.stats.fallbacks > 0 && console.log(`(${ag.spec.id}: ${ag.stats.fallbacks} fallback moves${ag.stats.lastError ? `, last: ${ag.stats.lastError}` : ""})`));
  if (s.over) finishRecord(rec, s);
  return rec;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "new") {
    const meId = arg("me", "claude-sonnet-agent");
    const opp = arg("opponent", "qwen3-coder-lmstudio").split(",");
    const models = listModels();
    for (const id of [meId, ...opp]) if (!models.some((m) => m.id === id)) throw new Error(`No model "${id}" in models/`);
    const seats: Seat[] = [{ kind: "model", modelId: meId }, ...opp.map((id) => ({ kind: "model", modelId: id }) as Seat)];
    const mapType = arg("map", "drylands") as MapType;
    const s = createGame({
      mapSize: Number(arg("size", "11")),
      players: seats.length,
      mode: arg("mode", "perfection") as GameMode,
      seed: Number(arg("seed", String(Date.now() % 1_000_000))),
      humans: [0],
      mapType,
    });
    const rec = startRecord(s, seats, "play", mapType);
    saveGame(rec);
    console.log(`New game ${rec.id}. You are seat 0.`);
    printState(rec, 0);
    return;
  }
  const id = arg("game");
  const rec = id ? findGame(id) : null;
  if (!rec) throw new Error(`No game "${id}". Start one with: npm run play -- new`);
  const me = 0;
  if (cmd === "state") return printState(rec, me);
  if (cmd === "move") {
    const n = Number(process.argv[process.argv.length - 1]);
    let s = replayStates(rec).pop()!;
    if (s.over) return printState(rec, me);
    if (s.current !== me) throw new Error("Not your turn.");
    const m = menu(s);
    if (!Number.isInteger(n) || n < 0 || n >= m.length) throw new Error(`Pick a move number from 0 to ${m.length - 1}.`);
    const a = m[n];
    console.log(`You: ${labelFor(s, a)}`);
    const next = applyAction(s, a);
    recordStep(rec, s, a, next);
    s = next;
    if (s.over) finishRecord(rec, s);
    else if (s.current !== me) {
      console.log("Opponents are moving...");
      await opponentsMove(rec, me);
    }
    const out = saveGame(rec);
    if (rec.result?.over) console.log(`Recorded ${out.file}. Elo change: ${out.deltas.join(", ")}`);
    console.log("");
    return printState(rec, me);
  }
  throw new Error("Commands: new, state, move");
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
