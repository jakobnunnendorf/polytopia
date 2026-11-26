/**
 * Perturbation probe: tunes all knobs at once by a designed experiment with a significance test
 * (Jakob, 25 Nov; issue #89). [EMAI ML-13, ML 2.0 p.27: least squares as a local linear surrogate]
 *
 * Every sample draws a random sign s_k = +1 or -1 for each knob, independently, and builds the two
 * opposite variations of the current centre theta:
 *     w+ = theta * exp(+sigma s),   w- = theta * exp(-sigma s)      (knob by knob; a knob at 0 stays 0)
 * They are compared on one map, every game from both seats:
 *     self:   w+ against w-                      x_self   = w+'s margin in the metric
 *     league: w+ and w- each against the same    x_league = metric(w+) - metric(w-)
 *             opponent (cycling through --league)
 * The sample's outcome is x = x_self + x_league (6 games). Because the signs are independent, the
 * least-squares slope of x on s_k is simply mean(x * s_k): half the difference between the samples
 * where knob k was nudged up and those where it was nudged down. Its standard error is
 * sd(x * s_k) / sqrt(n), and z_k = slope / SE.
 *
 * After each round (--games training games) every knob with |z_k| >= --z moves one step
 * (theta_k *= exp(sign * sigma * --step)) and its evidence is reset; the other knobs keep
 * accumulating evidence over the rounds, so small effects become visible with time.
 *
 * Output, in models/<id>/: curve.jsonl (the centre against the panel, same maps as train-hill's
 * curve), probe.jsonl (one row per round: z, effect and value of every knob, and what moved),
 * model.json (the best curve point, with the 400-game final test), like the other trainers.
 *
 *   npm run train-probe -- --id greedy-full-probe --from greedy-full-economy --metric finish \
 *     --budget 100000 --games 10000 --sigma 0.25 --z 3 --league greedy-hill-v4,greedy-full-v1,greedy-full-economy
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { eloFromScore } from "../logic/arena/sprt";
import {
  METRIC,
  MODE,
  MAP_TYPE,
  DIFFICULTY,
  PLAYERS,
  SIZE,
  type AnyWeights,
  type PanelResult,
  arg,
  changesIn,
  closePool,
  count,
  dur,
  finishScore,
  loadPanel,
  meanFinish,
  meanMetric,
  meanShare,
  meanWin,
  panelLine,
  panelTest,
  pct,
  runJob,
  setPhase,
  signed,
  spaceOf,
  startPool,
  startProgress,
} from "./lib/train-greedy";

const SPACE = spaceOf("full");
const ID = arg("id", "");
const FROM = arg("from", "greedy-full-v1");
const BUDGET = Number(arg("budget", "100000")); // training games in all
const ROUND_GAMES = Number(arg("games", "10000")); // training games per round (6 per sample)
const SIGMA = Number(arg("sigma", "0.25")); // size of a nudge, in log units (0.25 = about +28% / -22%)
const Z = Number(arg("z", "3")); // a knob moves when |z| reaches this
const STEP = Number(arg("step", "1")); // how far it moves, in nudges
const SEED = Number(arg("seed", "4242"));
const LEAGUE_IDS = arg("league", "").split(",").filter(Boolean);
const PANEL_IDS = arg("panel", "greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4,greedy-full-v1").split(",").filter(Boolean);
const CURVE_EVERY = Number(arg("curve-every", "2")); // a curve point every this many rounds
const CURVE_GAMES = Number(arg("curve-games", "200"));
const FINAL_GAMES = Number(arg("final", "400"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));
const ONLY = arg("only", "").split(",").filter(Boolean); // probe only these knobs (default: all that are not 0)
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;
const TRAIN_SEED = 2_000_000_000 + SEED * 1000;

// a small seeded generator for the signs, so a run is reproducible
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Acc = { n: number; sum: number; sumSq: number; self: number; selfSq: number; league: number; leagueSq: number };
const emptyAcc = (): Acc => ({ n: 0, sum: 0, sumSq: 0, self: 0, selfSq: 0, league: 0, leagueSq: 0 });
/** slope (the effect of one nudge up against one nudge down, halved) and its z-score */
function stat(n: number, sum: number, sumSq: number) {
  if (n < 2) return { effect: 0, z: 0 };
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean) * (n / (n - 1)));
  return { effect: mean, z: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0 };
}

async function main() {
  if (!ID) throw new Error("--id is required");
  const start = SPACE.load(FROM);
  if (!start) throw new Error(`--from ${FROM}: no greedy-full model`);
  const league = loadPanel(LEAGUE_IDS);
  if (!league.length) throw new Error("--league needs at least one model (the base and one or two panel models)");
  const panel = loadPanel(PANEL_IDS);
  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const curvePath = path.join(dir, "curve.jsonl");
  const probePath = path.join(dir, "probe.jsonl");
  fs.writeFileSync(curvePath, "");
  fs.writeFileSync(probePath, "");
  startPool(WORKERS);
  startProgress();
  const runStart = new Date().toISOString();
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);

  let theta = SPACE.clone(start);
  const knobs = SPACE.knobs.filter((k) => SPACE.get(theta, k) !== 0 && (!ONLY.length || ONLY.includes(k)));
  const off = SPACE.knobs.filter((k) => SPACE.get(theta, k) === 0);
  const acc = new Map<string, Acc>(knobs.map((k) => [k, emptyAcc()]));
  const moves: { round: number; knob: string; from: number; to: number; z: number }[] = [];
  const samplesPerRound = Math.max(1, Math.round(ROUND_GAMES / 6));
  const rounds = Math.max(1, Math.round(BUDGET / (samplesPerRound * 6)));
  const rand = rng(SEED);
  console.log(`perturbation probe from ${FROM}: ${knobs.length} knobs probed at once (${off.length} are 0 and stay off: ${off.join(", ") || "none"})`);
  console.log(`${rounds} rounds of ${samplesPerRound} samples (6 games each: w+ against w-, and both against one of ${league.map((o) => o.id).join(", ")}); nudge ${SIGMA} in log units, a knob moves at |z| >= ${Z}; metric ${METRIC}`);
  console.log(`${WORKERS} workers; panel: ${panel.map((p) => p.id).join(", ")}; ${CURVE_GAMES} games each every ${CURVE_EVERY} rounds`);

  const metricOf = (r: Awaited<ReturnType<typeof runJob>>, me: number) => {
    if (METRIC === "finish") return finishScore(r, me);
    const total = r.scores[0] + r.scores[1];
    return total ? r.scores[me] / total : 0.5;
  };
  const vary = (signs: number[], dir: 1 | -1) => {
    const w = SPACE.clone(theta);
    knobs.forEach((k, i) => SPACE.set(w, k, SPACE.round(k, SPACE.get(theta, k) * Math.exp(dir * SIGMA * signs[i]))));
    return w;
  };
  async function sample(index: number) {
    const signs = knobs.map(() => (rand() < 0.5 ? -1 : 1));
    const plus = vary(signs, 1);
    const minus = vary(signs, -1);
    const seed = TRAIN_SEED + index;
    const opp = league[index % league.length].w;
    const job = (w0: AnyWeights, w1: AnyWeights) => runJob({ w0, w1, seed, size: SIZE });
    const [a, b, c, d, e, f] = await Promise.all([job(plus, minus), job(minus, plus), job(plus, opp), job(opp, plus), job(minus, opp), job(opp, minus)]);
    const xSelf = (metricOf(a, 0) + metricOf(b, 1)) / 2 - 0.5;
    const xLeague = (metricOf(c, 0) + metricOf(d, 1)) / 2 - (metricOf(e, 0) + metricOf(f, 1)) / 2;
    const x = xSelf + xLeague;
    knobs.forEach((k, i) => {
      const s = signs[i];
      const q = acc.get(k)!;
      q.n++;
      q.sum += x * s;
      q.sumSq += x * x;
      q.self += xSelf * s;
      q.selfSq += xSelf * xSelf;
      q.league += xLeague * s;
      q.leagueSq += xLeague * xLeague;
    });
    return x;
  }

  type Point = { round: number; trainingGames: number; w: AnyWeights; vs: PanelResult };
  const points: Point[] = [];
  let trainGames = 0;
  async function curvePoint(round: number) {
    setPhase(`curve point after round ${round}`, panel.length * CURVE_GAMES);
    const vs = await panelTest(panel, theta, CURVE_GAMES, CURVE_SEED);
    points.push({ round, trainingGames: trainGames, w: SPACE.clone(theta), vs });
    const best = points.reduce((p, q) => (meanMetric(q.vs) > meanMetric(p.vs) ? q : p));
    const row = { trainingGames: trainGames, round, kept: moves.length, sigma: SIGMA, seconds: secs(), averaged: false, meanWinRate: meanWin(vs), meanPointShare: meanShare(vs), meanFinish: meanFinish(vs), best: best === points[points.length - 1], vs };
    fs.appendFileSync(curvePath, JSON.stringify(row) + "\n");
    console.log(`curve  ${count(trainGames).padStart(6)} games  round ${round}  ${moves.length} moved  champ | ${panelLine(vs)}  ${row.best ? "BEST" : ""}`);
  }
  await curvePoint(0);

  let index = 0;
  for (let round = 1; round <= rounds; round++) {
    setPhase(`round ${round} of ${rounds}`, samplesPerRound * 6);
    const xs = await Promise.all(Array.from({ length: samplesPerRound }, () => sample(index++)));
    trainGames += samplesPerRound * 6;
    const spread = Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
    const table = knobs.map((k) => {
      const q = acc.get(k)!;
      return { knob: k, value: SPACE.get(theta, k), n: q.n, ...stat(q.n, q.sum, q.sumSq), zSelf: stat(q.n, q.self, q.selfSq).z, zLeague: stat(q.n, q.league, q.leagueSq).z };
    });
    const moved: typeof moves = [];
    for (const t of table) {
      if (Math.abs(t.z) < Z) continue;
      const to = SPACE.round(t.knob, t.value * Math.exp(Math.sign(t.z) * SIGMA * STEP));
      if (to === t.value) continue;
      SPACE.set(theta, t.knob, to);
      acc.set(t.knob, emptyAcc()); // new centre for this knob: its evidence starts again
      moved.push({ round, knob: t.knob, from: t.value, to, z: t.z });
    }
    moves.push(...moved);
    fs.appendFileSync(probePath, JSON.stringify({ round, trainingGames: trainGames, samples: samplesPerRound, sdOutcome: spread, z: Z, sigma: SIGMA, knobs: table, moved, at: new Date().toISOString() }) + "\n");
    const top = [...table].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 6);
    console.log(`round ${String(round).padStart(2)}  ${count(trainGames).padStart(6)} games  outcome spread ${(spread * 100).toFixed(1)} pts | strongest: ${top.map((t) => `${t.knob} z=${t.z >= 0 ? "+" : ""}${t.z.toFixed(1)}`).join("  ")}`);
    console.log(moved.length ? `  MOVED ${moved.map((m) => `${m.knob} ${m.from}→${m.to} (z ${m.z >= 0 ? "+" : ""}${m.z.toFixed(1)})`).join(", ")}` : "  nothing reached the threshold");
    if (round % CURVE_EVERY === 0 || round === rounds) await curvePoint(round);
  }

  const best = points.reduce((p, q) => (meanMetric(q.vs) > meanMetric(p.vs) ? q : p));
  console.log(`\nsaving the centre of the best curve point (round ${best.round}, ${count(best.trainingGames)} games)`);
  setPhase("final test (vs panel)", panel.length * FINAL_GAMES);
  const final = await panelTest(panel, best.w, FINAL_GAMES, FINAL_SEED);
  console.log(`\nfinal (${FINAL_GAMES} unseen games against each):`);
  for (const [id, v] of Object.entries(final)) {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    console.log(`  vs ${id.padEnd(16)} won ${pct(v.winRate).padStart(4)} ± ${(ci * 100).toFixed(0)}%  (${signed(eloFromScore(v.winRate, v.games))} Elo)  points ${(v.pointShare * 100).toFixed(1)}%  finish ${((v.finish ?? 0.5) * 100).toFixed(1)}%`);
  }
  console.log(`changed: ${changesIn(SPACE, best.w) || "nothing"}`);
  const spec = {
    id: ID,
    name: `${FROM} + perturbation probe`,
    kind: SPACE.kind,
    description: `${FROM} tuned by a perturbation probe: all knobs nudged up or down at random in every game, each knob moved only when the difference between its up and down games reached z ${Z} (${moves.length} moves in ${rounds} rounds, ${count(trainGames)} training games).`,
    created: new Date().toISOString().slice(0, 10),
    [SPACE.field]: best.w,
    training: {
      method: "perturbation-probe",
      space: SPACE.name,
      from: FROM,
      metric: METRIC,
      mode: MODE,
      mapType: MAP_TYPE,
      difficulty: DIFFICULTY,
      players: PLAYERS,
      mapSize: SIZE,
      sigma: SIGMA,
      z: Z,
      step: STEP,
      league: LEAGUE_IDS,
      panel: PANEL_IDS,
      rounds,
      samplesPerRound,
      trainingGames: trainGames,
      knobsProbed: knobs.length,
      moves,
      bestRound: best.round,
      startedAt: runStart,
      endedAt: new Date().toISOString(),
      seconds: secs(),
      duration: dur(secs()),
      final,
      curve: "curve.jsonl",
      probe: "probe.jsonl",
    },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  console.log(`saved models/${ID}/model.json, curve.jsonl and probe.jsonl`);
  console.log(`training took ${dur(secs())} (${runStart} to ${new Date().toISOString()})`);
  closePool();
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
