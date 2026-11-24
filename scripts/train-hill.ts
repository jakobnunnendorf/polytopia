/**
 * The simplest learning bot: hill climbing on the greedy bot's scoring weights.
 *
 * Each round makes a challenger by nudging a few weights of the champion
 * (each multiplied by e^(sigma * a random normal number)) and tests it against
 * the champion on fresh maps, each map played once from each seat. The only
 * feedback is who won each game.
 *
 * Acceptance test (--test):
 *   sprt  (default) a sequential probability ratio test, as chess engines use to
 *         keep a change: play batches of map pairs until the evidence says the
 *         challenger is --elo1 stronger (keep) or no stronger (reject), with 5%
 *         error rates; give up and reject at --max-games. Challengers that play
 *         exactly like the champion are rejected after one batch. See
 *         logic/arena/sprt.ts.
 *   fixed the rule v1-v3 trained with: --games games, keep at --accept of all
 *         points and at least half the wins.
 *
 * Learning curve: at the start, every --curve-every training games and at the
 * end, the champion plays a fixed panel (--panel, default the original greedy
 * bot and the earlier hill climbers) on the same held-out maps each time, so
 * the points are comparable. Written to models/<id>/curve.jsonl and to the log
 * as lines starting with "curve".
 *
 * Early stop: training has converged once the mean win rate against the panel
 * has not beaten its best by --min-gain (1 point) for --patience (8) curve
 * points in a row. Either way the champion of the best curve point is saved,
 * not the last one.
 *
 * Games run in parallel on a pool of worker threads (--workers, default: all
 * cores but two). The champion is checkpointed every 100 rounds to
 * models/<id>/checkpoint.json.
 *
 *   npm run train-hill                                          # 60 rounds, about a minute
 *   npm run train-hill -- --id greedy-hill-v4 --budget 3600000  # stop after 3.6M training games
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
import { eloFromScore, sprtVerdict } from "../logic/arena/sprt";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

const ID = arg("id", "greedy-hill-v1");
const BUDGET = Number(arg("budget", "0")); // training games in total; 0 = stop after --rounds
const ROUNDS = Number(arg("rounds", BUDGET ? "Infinity" : "60"));
const SIGMA = Number(arg("sigma", "0.5"));
const PICK = Number(arg("pick", "3")); // weights nudged per round
const SIZE = Number(arg("size", "11"));
let seed = Number(arg("seed", "1000"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));

const TEST = arg("test", "sprt") === "fixed" ? "fixed" : "sprt";
// --test fixed
const GAMES = Number(arg("games", "60")); // per round; seats swap every game
const ACCEPT = Number(arg("accept", "0.52")); // share of all points the challenger must take
// --test sprt
const ELO0 = Number(arg("elo0", "0"));
const ELO1 = Number(arg("elo1", "25"));
const BATCH = Number(arg("batch", "20")); // map pairs between two looks at the evidence
const MAX_GAMES = Number(arg("max-games", "1000")); // give up (reject) after this many games

// learning curve and final test: the same held-out maps every time, far from the training seeds
const PANEL_IDS = arg("panel", "greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3")
  .split(",")
  .filter((x) => x && x !== ID);
const CURVE_GAMES = Number(arg("curve-games", "200")); // per panel opponent
const CURVE_EVERY = Number(arg("curve-every", String(BUDGET ? Math.round(BUDGET / 40) : 20000))); // training games
const FINAL_GAMES = Number(arg("final", "400")); // per panel opponent
// early stop: converged once the mean win rate against the panel has not beaten its best by
// --min-gain for --patience curve points in a row; the champion of the best point is saved
const PATIENCE = Number(arg("patience", "8")); // curve points; 0 = never stop early
const MIN_GAIN = Number(arg("min-gain", "0.01"));
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;

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
const runJob = (job: Job): Promise<Result> => (pool ? pool.run(job) : Promise.resolve(play(job.w0, job.w1, job.seed, job.size)));

/** b's share of wins and of all points against a over `games` games from firstSeed on, each map played from both seats */
async function match(a: GreedyWeights, b: GreedyWeights, games: number, firstSeed: number): Promise<{ wins: number; share: number }> {
  const jobs = Array.from({ length: games }, (_, g) => {
    const mapSeed = firstSeed + Math.floor(g / 2);
    const bFirst = g % 2 === 0;
    const job: Job = bFirst ? { w0: b, w1: a, seed: mapSeed, size: SIZE } : { w0: a, w1: b, seed: mapSeed, size: SIZE };
    return runJob(job).then((r) => ({ r, me: bFirst ? 0 : 1 }));
  });
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

type Test = { keep: boolean; games: number; wins: number; share: number; llr?: number; capped?: boolean };

/** the v1-v3 rule: a fixed number of games, keep on points share and wins */
async function fixedTest(champ: GreedyWeights, chall: GreedyWeights): Promise<Test> {
  const m = await match(champ, chall, GAMES, seed);
  seed += Math.ceil(GAMES / 2); // fresh maps every round
  return { keep: m.share >= ACCEPT && m.wins >= 0.5, games: GAMES, wins: m.wins, share: m.share };
}

/** batches of map pairs until the SPRT decides, or --max-games is reached (reject) */
async function sprtTest(champ: GreedyWeights, chall: GreedyWeights): Promise<Test> {
  const pairs: number[] = [];
  let wins = 0;
  let mine = 0;
  let total = 0;
  for (;;) {
    const batch = Array.from({ length: BATCH }, () => {
      const s = seed++;
      return Promise.all([runJob({ w0: chall, w1: champ, seed: s, size: SIZE }), runJob({ w0: champ, w1: chall, seed: s, size: SIZE })]);
    });
    for (const [a, b] of await Promise.all(batch)) {
      const w = (a.winner === 0 ? 1 : 0) + (b.winner === 1 ? 1 : 0);
      wins += w;
      pairs.push(w / 2);
      mine += a.scores[0] + b.scores[1];
      total += a.scores[0] + a.scores[1] + b.scores[0] + b.scores[1];
    }
    const { verdict, llr } = sprtVerdict(pairs, ELO0, ELO1);
    const games = pairs.length * 2;
    const out = { games, wins: wins / games, share: total ? mine / total : 0.5, llr };
    if (verdict === "accept") return { ...out, keep: true };
    if (verdict === "reject") return { ...out, keep: false };
    if (games >= MAX_GAMES) return { ...out, keep: false, capped: true };
  }
}

// ---------- the panel the learning curve and the final test play against ----------
function weightsOf(id: string): GreedyWeights | null {
  if (id === "greedy-v1") return DEFAULT_WEIGHTS;
  const f = path.join(process.cwd(), "models", id, "model.json");
  if (!fs.existsSync(f)) return null;
  const spec = JSON.parse(fs.readFileSync(f, "utf8"));
  if (spec.kind !== "greedy" || !spec.weights) return null;
  return { ...DEFAULT_WEIGHTS, ...spec.weights, rewards: { ...DEFAULT_WEIGHTS.rewards, ...(spec.weights.rewards ?? {}) } };
}

type PanelResult = Record<string, { winRate: number; pointShare: number; games: number }>;

async function panelTest(panel: { id: string; w: GreedyWeights }[], champ: GreedyWeights, games: number, firstSeed: number): Promise<PanelResult> {
  // every opponent on the same maps
  const res = await Promise.all(panel.map(async (p) => [p.id, await match(p.w, champ, games, firstSeed)] as const));
  return Object.fromEntries(res.map(([id, m]) => [id, { winRate: m.wins, pointShare: Math.round(m.share * 1000) / 1000, games }]));
}

const short = (id: string) => (id === "greedy-v1" ? "greedy" : id.replace(/^greedy-hill-/, ""));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x)}`;
const meanWin = (r: PanelResult) => Object.values(r).reduce((a, v) => a + v.winRate, 0) / Math.max(1, Object.keys(r).length);
const panelLine = (r: PanelResult) =>
  Object.entries(r)
    .map(([id, v]) => `${short(id)} ${pct(v.winRate)} (${signed(eloFromScore(v.winRate, v.games))})`)
    .join("  ") + `  | mean ${pct(meanWin(r))}`;
const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function changes(w: GreedyWeights): string {
  return KNOBS.filter((k) => w[k] !== DEFAULT_WEIGHTS[k])
    .map((k) => `${k} ${DEFAULT_WEIGHTS[k]}→${w[k]}`)
    .join(", ");
}

async function main() {
  pool = WORKERS > 1 ? new Pool(WORKERS) : null;
  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const panel = PANEL_IDS.map((id) => ({ id, w: weightsOf(id) })).filter((p): p is { id: string; w: GreedyWeights } => {
    if (!p.w) console.log(`panel: skipping ${p.id} (no greedy model.json)`);
    return !!p.w;
  });
  const test = TEST === "sprt" ? `SPRT elo0 ${ELO0} elo1 ${ELO1}, ${BATCH} map pairs per look, at most ${MAX_GAMES} games` : `fixed ${GAMES} games, keep at ${ACCEPT} of the points`;
  console.log(`${WORKERS} worker${WORKERS > 1 ? "s" : ""}; test: ${test}; ${BUDGET ? `budget ${count(BUDGET)} training games` : `${ROUNDS} rounds`}`);
  console.log(`panel: ${panel.map((p) => p.id).join(", ")}; ${CURVE_GAMES} games each every ${count(CURVE_EVERY)} training games`);

  const curvePath = path.join(dir, "curve.jsonl");
  fs.writeFileSync(curvePath, "");
  let champ: GreedyWeights = { ...DEFAULT_WEIGHTS, rewards: { ...DEFAULT_WEIGHTS.rewards } };
  let accepted = 0;
  let capped = 0;
  let trainGames = 0;
  let rounds = 0;
  let nextCurve = 0;
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);
  const dur = (sec: number) => {
    const s = Math.round(sec);
    return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
  };
  // when the budget (or --rounds) runs out at the pace so far; an early stop can come sooner
  const eta = () => {
    const s = (Date.now() - t0) / 1000;
    const done = BUDGET ? trainGames / BUDGET : Number.isFinite(ROUNDS) ? rounds / ROUNDS : 0;
    if (done <= 0 || s < 1) return "ETA …";
    const left = (s * (1 - done)) / done;
    const at = new Date(Date.now() + left * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `ETA ${at}, ${dur(left)} left`;
  };

  // the best curve point so far (early stopping keeps its champion)
  let points = 0;
  let best = { mean: -1, point: 0, champ, round: 0, trainingGames: 0, kept: 0 };
  let converged = false;

  const curvePoint = async () => {
    const vs = await panelTest(panel, champ, CURVE_GAMES, CURVE_SEED);
    const mean = meanWin(vs);
    const improved = mean > best.mean + MIN_GAIN || best.mean < 0;
    if (improved) best = { mean, point: points, champ, round: rounds, trainingGames: trainGames, kept: accepted };
    const since = points - best.point;
    const row = { trainingGames: trainGames, round: rounds, kept: accepted, seconds: secs(), meanWinRate: Math.round(mean * 1000) / 1000, best: improved, vs };
    fs.appendFileSync(curvePath, JSON.stringify(row) + "\n");
    console.log(
      `curve  ${count(trainGames).padStart(6)} games  round ${rounds}  ${accepted} kept  | ${panelLine(vs)}  ${improved ? "BEST" : `(best ${pct(best.mean)}, ${since}/${PATIENCE || "∞"} without gain)`}  ${eta()}`,
    );
    points++;
    nextCurve += CURVE_EVERY;
    if (PATIENCE && since >= PATIENCE) converged = true;
  };

  await curvePoint();
  while (!converged && rounds < ROUNDS && (!BUDGET || trainGames < BUDGET)) {
    rounds++;
    const { next: chall, nudged } = mutate(champ);
    const m = TEST === "sprt" ? await sprtTest(champ, chall) : await fixedTest(champ, chall);
    trainGames += m.games;
    if (m.keep) {
      champ = chall;
      accepted++;
    }
    if (m.capped) capped++;
    const progress = BUDGET ? `${((trainGames / BUDGET) * 100).toFixed(1)}%` : `${count(trainGames)} games`;
    console.log(
      `round ${String(rounds).padStart(5)}  ${String(m.games).padStart(4)} games  won ${pct(m.wins).padStart(4)}  points ${(m.share * 100).toFixed(1)}%` +
        `${m.llr !== undefined ? `  LLR ${m.llr.toFixed(2).padStart(6)}` : ""}  ${m.keep ? "KEPT" : m.capped ? "cap " : "    "}  (${accepted} kept, ${progress}, ${dur(secs())}, ${eta()})${m.keep ? `  ${nudged}` : ""}`,
    );
    if (rounds % 100 === 0) {
      fs.writeFileSync(path.join(dir, "checkpoint.json"), JSON.stringify({ round: rounds, trainingGames: trainGames, accepted, seed, weights: champ }, null, 2) + "\n");
    }
    if (trainGames >= nextCurve) await curvePoint();
  }
  if (!converged && trainGames + CURVE_EVERY > nextCurve) await curvePoint(); // the last point, unless one was just taken
  if (converged) console.log(`\nconverged: no gain of ${pct(MIN_GAIN)} on the panel for ${PATIENCE} curve points; stopped at ${count(trainGames)} of ${BUDGET ? count(BUDGET) : "∞"} games`);
  // keep the champion of the best curve point; later kept challengers did not help on held-out maps
  const lastChamp = champ;
  champ = best.champ;
  if (champ !== lastChamp) console.log(`saving the champion of the best curve point (round ${best.round}, ${count(best.trainingGames)} games, mean ${pct(best.mean)})`);

  // final test: the whole panel on maps neither the climber nor the curve has seen
  const final = await panelTest(panel, champ, FINAL_GAMES, FINAL_SEED);
  console.log(`\nfinal (${FINAL_GAMES} unseen games against each):`);
  for (const [id, v] of Object.entries(final)) {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    console.log(`  vs ${id.padEnd(16)} won ${pct(v.winRate).padStart(4)} ± ${(ci * 100).toFixed(0)}%  (${signed(eloFromScore(v.winRate, v.games))} Elo)  points ${(v.pointShare * 100).toFixed(1)}%`);
  }
  console.log(`changed: ${changes(champ) || "nothing"}`);

  const name = ID.replace(/^greedy-hill-v(\d+)$/, "Hill climber v$1");
  const strongest = panel[panel.length - 1]?.id;
  const how = TEST === "sprt" ? `${rounds} challengers tested with an SPRT (${count(trainGames)} self-play games)` : `${rounds} rounds of ${GAMES} self-play games`;
  const spec = {
    id: ID,
    name,
    kind: "greedy",
    description:
      `The greedy bot with weights tuned by hill climbing (scripts/train-hill.ts): ${how} on ${SIZE}x${SIZE} maps, ${accepted} challengers kept.` +
      // early stopping may save an earlier champion than the last one: say which
      (best.round !== rounds ? ` Saved the champion of the best learning-curve point (round ${best.round}, ${count(best.trainingGames)} games, ${best.kept} kept).` : "") +
      (final["greedy-v1"] ? ` Won ${pct(final["greedy-v1"].winRate)} against greedy-v1` : "") +
      (strongest && strongest !== "greedy-v1" ? ` and ${pct(final[strongest].winRate)} against ${strongest}` : "") +
      " on unseen maps at save time.",
    created: new Date().toISOString().slice(0, 10),
    weights: champ,
    training: {
      method: "hill-climbing",
      test: TEST,
      ...(TEST === "sprt" ? { sprt: { elo0: ELO0, elo1: ELO1, alpha: 0.05, beta: 0.05, mapPairsPerLook: BATCH, maxGames: MAX_GAMES } } : { gamesPerRound: GAMES, acceptPointShare: ACCEPT }),
      budget: BUDGET || undefined,
      rounds,
      trainingGames: trainGames,
      seconds: secs(),
      sigma: SIGMA,
      weightsPerNudge: PICK,
      mapSize: SIZE,
      accepted,
      capped: TEST === "sprt" ? capped : undefined,
      curve: "curve.jsonl",
      earlyStop: { patience: PATIENCE, minGain: MIN_GAIN, converged, savedRound: best.round, savedAtTrainingGames: best.trainingGames, savedKept: best.kept, savedCurveMean: Math.round(best.mean * 1000) / 1000 },
      final,
      finalWinRateVsGreedyV1: final["greedy-v1"]?.winRate,
    },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  fs.rmSync(path.join(dir, "checkpoint.json"), { force: true });
  console.log(`saved models/${ID}/model.json and curve.jsonl`);
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
