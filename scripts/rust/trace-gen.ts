// The oracle is the TypeScript engine at commit 5d2846d (git checkout it to regenerate a corpus); logic/engine is now the Rust engine.
/**
 * Writes the parity corpus: games played by the TypeScript engine (the oracle)
 * with a policy that mixes the greedy bot and random legal actions. For every
 * step it records the action, a hash of the legal-action list before it, a
 * hash of the canonical state after it and a hash of the game log after it.
 * The Rust engine replays the corpus and must give the same hashes
 * (engine/cli: `polyengine replay`).
 *
 *   node -r sucrase/register scripts/rust/trace-gen.ts --games 2000 --out engine/corpus/full
 *   node -r sucrase/register scripts/rust/trace-gen.ts --games 60 --out engine/corpus/smoke
 *
 * Game settings come from the game index alone, so a corpus is reproducible.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { applyAction, legalActions } from "../../logic/engine/actions";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "../../logic/engine/bot";
import { CLANS } from "../../logic/engine/data";
import { createGame, type NewGameOptions } from "../../logic/engine/state";
import { observe } from "../../logic/engine/observe";
import type { Action, GameState } from "../../logic/engine/types";
import { actionsHash, canon, md5, stateHash } from "./canon";

const ROOT = path.resolve(__dirname, "../..");

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

export const logHash = (s: GameState) => md5(s.log.join("\n")).slice(0, 16);

/** xorshift32, seeded; independent of the game's own generator */
export function policyRng(seed: number) {
  let r = (seed * 2654435761 + 1) >>> 0 || 1;
  return () => {
    r ^= r << 13;
    r >>>= 0;
    r ^= r >>> 17;
    r ^= r << 5;
    r >>>= 0;
    return r / 4294967296;
  };
}

export const WEIGHT_SETS: Record<string, GreedyWeights> = {
  default: DEFAULT_WEIGHTS,
  v4: JSON.parse(fs.readFileSync(path.join(ROOT, "models/greedy-hill-v4/model.json"), "utf8")).weights,
};

export type GameSpec = {
  id: number;
  opts: NewGameOptions;
  weights: keyof typeof WEIGHT_SETS;
  /** chance that a step takes a random legal action instead of the bot's */
  pRandom: number;
  policySeed: number;
  maxSteps: number;
};

const MODES = ["perfection", "domination", "creative", "glory", "might"] as const;
const MAPS = ["drylands", "lakes", "continents", "pangea", "archipelago", "waterworld"] as const;
const DIFFS = ["easy", "normal", "hard", "crazy"] as const;
const P_RANDOM = [0, 0.05, 0.2, 0.5, 1];

/** settings of game `id`, from the id alone */
export function specFor(id: number): GameSpec {
  const r = policyRng(id + 7919);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const mode = MODES[id % MODES.length];
  const tribes = CLANS.map((c) => c.id);
  const players = r() < 0.7 ? 2 + Math.floor(r() * 2) : 2 + Math.floor(r() * 7);
  let mapSize: number | undefined;
  if (mode === "domination") mapSize = undefined;
  else if (mode === "perfection") mapSize = r() < 0.5 ? undefined : pick([11, 14, 16]);
  else mapSize = pick([11, 14, 16, 18]);
  const size = mapSize ?? (mode === "domination" ? [11, 11, 14, 16, 18][Math.min(players - 1, 4)] : 16);
  const n = Math.min(players, size <= 11 ? 9 : 16);
  // player 0 cycles through every tribe; the others are random (sometimes left to createGame)
  let clans: string[] | undefined;
  if (r() < 0.85) {
    clans = [tribes[Math.floor(id / MODES.length) % tribes.length]];
    while (clans.length < n) clans.push(pick(tribes));
  }
  const opts: NewGameOptions = {
    mapSize,
    players: n,
    mode,
    difficulty: pick(DIFFS),
    seed: 100_000 + id * 37,
    humans: r() < 0.25 ? [0] : [],
    mapType: pick(MAPS),
    clans,
    turnLimit: mode === "perfection" && r() < 0.3 ? 20 : undefined,
  };
  return {
    id,
    opts,
    weights: r() < 0.5 ? "default" : "v4",
    pRandom: pick(P_RANDOM),
    policySeed: id * 101 + 3,
    maxSteps: 2500,
  };
}

/** observation hash every OBS_EVERY steps (of the player to move after the step), else "" */
export const OBS_EVERY = 25;
export const obsHash = (s: GameState) => md5(canon(observe(s, s.current))).slice(0, 16);

export type Step = [Action, string, string, string, number, string];

/** play one corpus game; each step: [action, legal hash before, state hash after, log hash after, 1 if the bot chose it, observation hash after (every OBS_EVERY steps)] */
export function playSpec(spec: GameSpec): { init: [string, string]; steps: Step[]; final: { over: boolean; winner: number | null; turn: number } } {
  let s = createGame(spec.opts);
  const init: [string, string] = [stateHash(s), logHash(s)];
  const rand = policyRng(spec.policySeed);
  const w = WEIGHT_SETS[spec.weights];
  const steps: Step[] = [];
  while (!s.over && steps.length < spec.maxSteps) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    let a: Action;
    let bot = 0;
    if (rand() < spec.pRandom) a = legal[Math.floor(rand() * legal.length)];
    else {
      a = botStep(s, w);
      bot = 1;
    }
    const lh = actionsHash(legal);
    s = applyAction(s, a);
    steps.push([a, lh, stateHash(s), logHash(s), bot, steps.length % OBS_EVERY === 0 ? obsHash(s) : ""]);
  }
  return { init, steps, final: { over: s.over, winner: s.winner, turn: s.turn } };
}

function runWorker(ids: number[], file: string) {
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(file);
  gz.pipe(out);
  for (const id of ids) {
    const spec = specFor(id);
    let line: string;
    try {
      const g = playSpec(spec);
      // plain JSON: the spec must keep empty arrays (humans: [] differs from no humans)
      line = JSON.stringify({ spec, ...g });
    } catch (e) {
      // a game the oracle itself cannot create or play is recorded as such, never silently dropped
      line = JSON.stringify({ spec, error: String((e as Error).message ?? e) });
    }
    gz.write(line + "\n");
  }
  gz.end();
  return new Promise<void>((res) => out.on("finish", () => res()));
}

if (isMainThread && require.main === module) {
  const games = Number(arg("games", "60"));
  const first = Number(arg("first", "0"));
  const outDir = path.resolve(arg("out", "engine/corpus/smoke"));
  const workers = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  let done = 0;
  for (let w = 0; w < workers; w++) {
    const ids: number[] = [];
    for (let i = first + w; i < first + games; i += workers) ids.push(i);
    if (!ids.length) continue;
    const file = path.join(outDir, `part-${String(w).padStart(2, "0")}.jsonl.gz`);
    const wk = new Worker(`require(${JSON.stringify(__filename)})`, { eval: true, workerData: { ids, file } });
    wk.on("exit", () => {
      done++;
      if (done === Math.min(workers, games)) {
        const meta = { games, first, seconds: (Date.now() - t0) / 1000, oracle: process.env.ORACLE_COMMIT ?? null };
        fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 1));
        console.log(JSON.stringify(meta));
      }
    });
    wk.on("error", (e) => {
      console.error(e);
      process.exitCode = 1;
    });
  }
} else if (!isMainThread && workerData?.ids) {
  runWorker(workerData.ids, workerData.file);
}
