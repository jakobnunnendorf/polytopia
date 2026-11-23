/**
 * The simplest learning bot: hill climbing on the greedy bot's scoring weights.
 *
 * Each round makes a challenger by nudging a few weights of the champion
 * (each multiplied by e^(sigma * a random normal number)), lets the two play
 * a match on fresh maps from both seats, and keeps the challenger if it took
 * at least --accept of all points scored and won at least half the games.
 * The only feedback is the final score of each game.
 *
 * A round's games run in parallel on a pool of worker threads (--workers,
 * default: all cores but two). The champion is checkpointed every 100 rounds
 * to models/<id>/checkpoint.json.
 *
 *   npm run train-hill                                   # 60 rounds of 60 games, under a minute
 *   npm run train-hill -- --rounds 6000 --id greedy-hill-v3
 *
 * Training games are not recorded and do not touch the Elo table. The result
 * is saved as models/<id>/model.json (kind "greedy"), so it appears in the
 * game's model list; rate it with
 *   npm run arena -- --models <id>,greedy-v1 --games 20
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { applyAction } from "../logic/engine/actions";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "../logic/engine/bot";
import { createGame } from "../logic/engine/state";
import { scoreOf } from "../logic/engine";
import type { GameState } from "../logic/engine/types";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

const ROUNDS = Number(arg("rounds", "60"));
const GAMES = Number(arg("games", "60")); // per round; seats swap every game
const SIGMA = Number(arg("sigma", "0.5"));
const PICK = Number(arg("pick", "3")); // weights nudged per round
const ACCEPT = Number(arg("accept", "0.52")); // share of all points the challenger must take
const SIZE = Number(arg("size", "11"));
const ID = arg("id", "greedy-hill-v1");
const FINAL_GAMES = Number(arg("final", "100")); // games in the last test against greedy-v1
let seed = Number(arg("seed", "1000"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));

// weights the climber may change; noise (tie-break randomness) stays fixed
const KNOBS = (Object.keys(DEFAULT_WEIGHTS) as (keyof GreedyWeights)[]).filter((k) => k !== "noise" && k !== "rewards");
const WHOLE = new Set<keyof GreedyWeights>(["richAt", "unitsPerCity"]);

function normal(): number {
  // Box-Muller
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** nudge PICK randomly chosen weights; the rest stay as they are */
function mutate(w: GreedyWeights): { next: GreedyWeights; nudged: string } {
  const next: GreedyWeights = { ...w, rewards: { ...w.rewards } };
  const keys = [...KNOBS].sort(() => Math.random() - 0.5).slice(0, PICK);
  for (const k of keys) {
    const v = (w[k] as number) * Math.exp(SIGMA * normal());
    (next as Record<string, unknown>)[k] = WHOLE.has(k) ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100;
  }
  return { next, nudged: keys.map((k) => `${k} ${w[k]}→${next[k]}`).join(", ") };
}

/** one 2-player game; returns the winner's seat and both scores */
function play(w0: GreedyWeights, w1: GreedyWeights, gameSeed: number, size = SIZE): { winner: number; scores: [number, number] } {
  let s: GameState = createGame({ mapSize: size, players: 2, mode: "perfection", seed: gameSeed, humans: [], mapType: "drylands" });
  const ws = [w0, w1];
  let moves = 0;
  while (!s.over && moves < 20000) {
    s = applyAction(s, botStep(s, ws[s.current]));
    moves++;
  }
  return { winner: s.winner ?? 0, scores: [scoreOf(s, 0), scoreOf(s, 1)] };
}

// ---------- worker pool: each worker runs this file and plays one game per message ----------
type Job = { w0: GreedyWeights; w1: GreedyWeights; seed: number; size: number };
type Result = { winner: number; scores: [number, number] };

class Pool {
  private idle: Worker[] = [];
  private queue: { job: Job; done: (r: Result) => void }[] = [];
  private all: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      // eval'd CommonJS so the TypeScript require hook (-r sucrase/register, inherited) loads this file
      const w = new Worker(`require(${JSON.stringify(__filename)})`, { eval: true, workerData: { trainWorker: true } });
      w.unref();
      this.all.push(w);
      this.idle.push(w);
    }
  }
  run(job: Job): Promise<Result> {
    return new Promise((done) => {
      this.queue.push({ job, done });
      this.pump();
    });
  }
  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, done } = this.queue.shift()!;
      w.once("message", (r: Result) => {
        this.idle.push(w);
        done(r);
        this.pump();
      });
      w.postMessage(job);
    }
  }
  close() {
    this.all.forEach((w) => w.terminate());
  }
}

let pool: Pool | null = null;

/** the challenger's share of wins and of all points over `games` games, each map played from both seats */
async function match(champ: GreedyWeights, chall: GreedyWeights, games = GAMES): Promise<{ wins: number; share: number }> {
  const jobs = Array.from({ length: games }, (_, g) => {
    const mapSeed = seed + Math.floor(g / 2);
    const challFirst = g % 2 === 0;
    const job: Job = challFirst ? { w0: chall, w1: champ, seed: mapSeed, size: SIZE } : { w0: champ, w1: chall, seed: mapSeed, size: SIZE };
    const run = pool ? pool.run(job) : Promise.resolve(play(job.w0, job.w1, job.seed, job.size));
    return run.then((r) => ({ r, me: challFirst ? 0 : 1 }));
  });
  seed += Math.ceil(games / 2); // fresh maps every round
  let wins = 0;
  let mine = 0;
  let total = 0;
  for (const { r, me } of await Promise.all(jobs)) {
    if (r.winner === me) wins++;
    mine += r.scores[me];
    total += r.scores[0] + r.scores[1];
  }
  return { wins: wins / games, share: total ? mine / total : 0.5 };
}

function changes(w: GreedyWeights): string {
  return KNOBS.filter((k) => w[k] !== DEFAULT_WEIGHTS[k])
    .map((k) => `${k} ${DEFAULT_WEIGHTS[k]}→${w[k]}`)
    .join(", ");
}

async function main() {
  pool = WORKERS > 1 ? new Pool(WORKERS) : null;
  console.log(`${WORKERS} worker${WORKERS > 1 ? "s" : ""}`);
  let champ: GreedyWeights = { ...DEFAULT_WEIGHTS, rewards: { ...DEFAULT_WEIGHTS.rewards } };
  let accepted = 0;
  const t0 = Date.now();
  for (let r = 1; r <= ROUNDS; r++) {
    const { next: chall, nudged } = mutate(champ);
    const m = await match(champ, chall);
    const keep = m.share >= ACCEPT && m.wins >= 0.5;
    if (keep) {
      champ = chall;
      accepted++;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `round ${String(r).padStart(4)}/${ROUNDS}  won ${(m.wins * 100).toFixed(0).padStart(3)}%  points ${(m.share * 100).toFixed(1)}%  ${keep ? "KEPT" : "    "}  (${accepted} kept, ${secs}s)${keep ? `  ${nudged}` : ""}`,
    );
    if (r % 100 === 0) {
      const dir = path.join(process.cwd(), "models", ID);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "checkpoint.json"), JSON.stringify({ round: r, accepted, seed, weights: champ }, null, 2) + "\n");
    }
  }

  // final check: the champion against the original greedy bot on maps it never trained on
  seed = 900_000;
  const fm = await match(DEFAULT_WEIGHTS, champ, FINAL_GAMES);
  const final = fm.wins;
  console.log(`\nfinal: ${ID} won ${(final * 100).toFixed(0)}% of ${FINAL_GAMES} fresh games against greedy-v1 and took ${(fm.share * 100).toFixed(1)}% of the points`);
  console.log(`changed: ${changes(champ) || "nothing"}`);

  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const spec = {
    id: ID,
    name: ID.replace(/^greedy-hill-v(\d+)$/, "Hill climber v$1"),
    kind: "greedy",
    description: `The greedy bot with weights tuned by hill climbing (scripts/train-hill.ts): ${ROUNDS} rounds of ${GAMES} self-play games on ${SIZE}x${SIZE} maps, ${accepted} challengers kept. Won ${(final * 100).toFixed(0)}% against greedy-v1 on unseen maps at save time.`,
    created: new Date().toISOString().slice(0, 10),
    weights: champ,
    training: { method: "hill-climbing", rounds: ROUNDS, gamesPerRound: GAMES, sigma: SIGMA, weightsPerNudge: PICK, acceptPointShare: ACCEPT, mapSize: SIZE, accepted, finalWinRateVsGreedyV1: final, finalPointShareVsGreedyV1: Math.round(fm.share * 1000) / 1000 },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  fs.rmSync(path.join(dir, "checkpoint.json"), { force: true });
  console.log(`saved models/${ID}/model.json`);
  pool?.close();
}

if (!isMainThread && workerData?.trainWorker) {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(play(j.w0, j.w1, j.seed, j.size)));
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
