/**
 * Model-only games run here, on the arena server, not in a browser tab:
 * a tab that is closed or navigated away would silently stop the game.
 * Moves are paced (PACE_MS each) and saved one by one, so the live view in the
 * app shows them at an even, watchable rhythm.
 */
import { applyAction } from "../../logic/engine/actions";
import { createGame } from "../../logic/engine/state";
import type { Difficulty, GameMode } from "../../logic/engine/types";
import type { MapType } from "../../logic/engine/mapgen";
import { createAgent, directChat } from "../../logic/agents/registry";
import { finishRecord, recordStep, replayStates, startRecord, type GameRecord, type Seat } from "../../logic/arena/record";
import { findGame, listModels, saveGame } from "./store";

const running = new Set<string>();
/** running games asked to stop: the loop ends after the move in progress */
const stopRequests = new Set<string>();

/** every move takes at least this long, so fast bots and a thinking LLM look the same to a watcher */
// one move per second: the live view (app/analyse.tsx FOLLOW_MS) plays them back at the same pace
export const PACE_MS = Number(process.env.SHARDLANDS_PACE_MS ?? 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isRunning(id: string): boolean {
  return running.has(id);
}

async function run(rec: GameRecord): Promise<void> {
  if (running.has(rec.id)) return;
  running.add(rec.id);
  try {
    const all = listModels();
    const agents = rec.seats.map((seat) => {
      if (seat.kind !== "model") throw new Error("Only model seats can run on the server");
      const spec = all.find((m) => m.id === seat.modelId);
      if (!spec || spec.kind === "external") throw new Error(`Model ${seat.modelId} cannot play on the server`);
      return createAgent(spec, directChat, all);
    });
    let s = replayStates(rec).pop()!;
    let perTurn = 0;
    while (!s.over && !stopRequests.has(rec.id)) {
      const t0 = Date.now();
      const a = perTurn++ > 300 ? { type: "endTurn" as const } : await agents[s.current].act(s);
      await sleep(Math.max(0, PACE_MS - (Date.now() - t0)));
      const next = applyAction(s, a);
      recordStep(rec, s, a, next);
      const turnEnded = next.current !== s.current || next.turn !== s.turn;
      if (turnEnded) perTurn = 0;
      s = next;
      // saved after every move: the live view reads this file
      saveGame({ ...rec, endedAt: null, result: null });
      void turnEnded;
    }
    if (!s.over) {
      // stopped: keep the moves so far, no winner, no Elo (saveGame rates only finished games)
      rec.stoppedAt = new Date().toISOString();
      saveGame(finishRecord(rec, s));
      console.log(`match ${rec.id} stopped at turn ${s.turn}`);
      return;
    }
    const out = saveGame(finishRecord(rec, s));
    console.log(`match ${rec.id} finished: winner seat ${s.winner}, Elo ${out.deltas.join(", ")}`);
    agents.forEach((ag) => ag.stats && console.log(`  ${ag.spec.id}: ${ag.stats.byModel}/${ag.stats.decisions} decisions by the model, ${ag.stats.fallbacks} fallbacks${ag.stats.lastError ? ` (last: ${ag.stats.lastError})` : ""}`));
  } catch (e) {
    console.error(`match ${rec.id} stopped: ${(e as Error).message}`);
  } finally {
    running.delete(rec.id);
    stopRequests.delete(rec.id);
  }
}

export function startMatch(opts: {
  mapSize: number;
  mode: GameMode;
  difficulty?: Difficulty;
  seed: number;
  mapType?: MapType;
  seats: Seat[];
}): GameRecord {
  if (opts.seats.length < 2 || opts.seats.some((s) => s.kind !== "model")) throw new Error("A server match needs two or more model seats");
  const s = createGame({ mapSize: opts.mapSize, players: opts.seats.length, mode: opts.mode, difficulty: opts.difficulty, seed: opts.seed, humans: [], mapType: opts.mapType });
  const rec = startRecord(s, opts.seats, "arena", opts.mapType);
  saveGame(rec);
  void run(rec);
  return rec;
}

/** stop a model-only game: a running one ends after its current move; an unfinished idle one is marked stopped */
export function stopMatch(id: string): { ok: boolean; reason?: string } {
  if (running.has(id)) {
    stopRequests.add(id);
    return { ok: true };
  }
  const rec = findGame(id);
  if (!rec) return { ok: false, reason: "no such game" };
  if (rec.result?.over) return { ok: false, reason: "finished" };
  if (rec.stoppedAt) return { ok: true, reason: "already stopped" };
  rec.stoppedAt = new Date().toISOString();
  saveGame(finishRecord(rec, replayStates(rec).pop()!));
  return { ok: true };
}

/** continue an unfinished model-only game (no-op when it is running, finished or stopped) */
export function resumeMatch(id: string): { ok: boolean; reason?: string } {
  if (running.has(id)) return { ok: true, reason: "already running" };
  const rec = findGame(id);
  if (!rec) return { ok: false, reason: "no such game" };
  if (rec.result?.over) return { ok: false, reason: "finished" };
  if (rec.stoppedAt) return { ok: false, reason: "stopped" };
  if (rec.seats.some((s) => s.kind !== "model")) return { ok: false, reason: "has human seats" };
  // a record left by a browser may carry an unfinished result; the run sets it at the end
  rec.result = null;
  rec.endedAt = null;
  void run(rec);
  return { ok: true };
}
