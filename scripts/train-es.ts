/**
 * Evolution strategies (ES) on the greedy bot's scoring weights: the second optimizer next to the
 * hill climber (train-hill.ts), on the same engine, games, panel and curve, so the two compare directly.
 *
 * The weights are optimized in log space (they are scale-like: 2x as much matters, not +1).
 * Each iteration draws --pop random directions e_i. For each direction the two opposite variations
 * w+ = exp(theta + sigma e_i) and w- = exp(theta - sigma e_i) play each other on --pairs map pairs
 * (every map from both seats), and the same maps are used for every direction in the iteration
 * (common random numbers: map luck cancels between directions). d_i is the mean score margin of w+
 * over w- (its share of all points minus 0.5). The gradient estimate
 *   g = sum_i d_i e_i / (pop sigma)
 * uses every game played; there is no accept or reject. theta moves along g with Adam (--lr).
 * With --league <model ids> the two variations also play those models on the same maps and seats
 * and d_i adds the difference of their shares.
 *
 * sigma shrinks from --sigma (0.15) by --sigma-decay per iteration (0.998) down to --sigma-min (0.03).
 * An exponential moving average of theta (--ema 0.95) is kept as well; at every curve point both the
 * current weights and the average play the panel and the better one counts.
 *
 * Learning curve, early stop (--patience, --min-gain on the mean share of points), milestones
 * (--milestones), checkpoints and --resume work as in train-hill.ts.
 *
 *   npm run train-es -- --id greedy-es-v1 --budget 30000
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { DEFAULT_WEIGHTS, type GreedyWeights } from "../logic/engine/bot";
import { eloFromScore } from "../logic/arena/sprt";
import {
  KNOBS,
  MAP_TYPE,
  MILESTONES,
  MODE,
  PLAYERS,
  SIZE,
  arg,
  changes,
  closePool,
  copyWeights,
  count,
  dur,
  loadPanel,
  mapPair,
  meanShare,
  meanWin,
  normal,
  panelLine,
  panelTest,
  pct,
  progress,
  roundKnob,
  saveMilestone,
  setPhase,
  signed,
  startPool,
  startProgress,
  weightsOf,
} from "./lib/train-greedy";

const ID = arg("id", "greedy-es-v1");
const BUDGET = Number(arg("budget", "30000"));
const POP = Number(arg("pop", "12")); // directions per iteration (each played as + and -)
const PAIRS = Number(arg("pairs", "2")); // map pairs per direction
const LR = Number(arg("lr", "0.03"));
const SIGMA0 = Number(arg("sigma", "0.15"));
const SIGMA_MIN = Number(arg("sigma-min", "0.03"));
const SIGMA_DECAY = Number(arg("sigma-decay", "0.998"));
const EMA = Number(arg("ema", "0.95"));
const FROM = arg("from", "");
const RESUME = process.argv.includes("--resume");
const ARGS = process.argv.slice(2).filter((a) => a !== "--resume").join(" ");
let seed = Number(arg("seed", "1000"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));
const LEAGUE = arg("league", "self").split(",").filter(Boolean);
const PANEL_IDS = arg("panel", "greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4")
  .split(",")
  .filter((x) => x && x !== ID);
const CURVE_GAMES = Number(arg("curve-games", "200"));
const CURVE_EVERY = Number(arg("curve-every", String(Math.round(BUDGET / 40))));
const FINAL_GAMES = Number(arg("final", "400"));
const PATIENCE = Number(arg("patience", "8"));
const MIN_GAIN = Number(arg("min-gain", "0.003"));
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;

const toTheta = (w: GreedyWeights) => KNOBS.map((k) => Math.log(Math.max(w[k] as number, 1e-6)));
function toWeights(theta: number[]): GreedyWeights {
  const w = copyWeights(DEFAULT_WEIGHTS);
  KNOBS.forEach((k, i) => ((w as Record<string, unknown>)[k] = roundKnob(k, Math.exp(theta[i]))));
  return w;
}

type Best = { score: number; point: number; theta: number[]; iteration: number; trainingGames: number; averaged: boolean };
type Checkpoint = {
  args: string;
  startedAt: string;
  seconds: number;
  savedAt: string;
  iteration: number;
  trainingGames: number;
  seed: number;
  nextCurve: number;
  curveAt: number;
  points: number;
  converged: boolean;
  sigma: number;
  theta: number[];
  ema: number[];
  adam: { m: number[]; v: number[]; t: number };
  milestone: number;
  best: Best;
};

async function main() {
  startPool(WORKERS);
  startProgress();
  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const panel = loadPanel(PANEL_IDS);
  const league = LEAGUE.filter((x) => x !== "self").map((id) => ({ id, w: weightsOf(id) })).filter((o): o is { id: string; w: GreedyWeights } => {
    if (!o.w) console.log(`league: skipping ${o.id} (no greedy model.json)`);
    return !!o.w;
  });
  const selfPlay = LEAGUE.includes("self") || league.length === 0;
  const gamesPerIt = POP * PAIRS * 2 * ((selfPlay ? 1 : 0) + 2 * league.length);
  console.log(`${WORKERS} workers; ES: ${POP} directions x ${PAIRS} map pairs (${gamesPerIt} games per iteration), lr ${LR}, sigma ${SIGMA0}→${SIGMA_MIN}; opponents: ${[...(selfPlay ? ["self"] : []), ...league.map((o) => o.id)].join(", ")}; budget ${count(BUDGET)} training games`);
  console.log(`panel: ${panel.map((p) => p.id).join(", ")}; ${CURVE_GAMES} games each every ${count(CURVE_EVERY)} training games; early stop on points share`);
  if (MILESTONES.length) console.log(`milestones: ${MILESTONES.map(count).join(", ")} training games`);

  const curvePath = path.join(dir, "curve.jsonl");
  const ckPath = path.join(dir, "checkpoint.json");
  const resumed: Checkpoint | null = RESUME ? (fs.existsSync(ckPath) ? JSON.parse(fs.readFileSync(ckPath, "utf8")) : null) : null;
  if (RESUME && !resumed) throw new Error(`--resume: no checkpoint at ${ckPath}`);
  if (!resumed) fs.writeFileSync(curvePath, "");
  const start = FROM ? weightsOf(FROM) : null;
  if (FROM && !start) throw new Error(`--from ${FROM}: no greedy model.json in models/${FROM}`);
  console.log(`mode ${MODE}, ${PLAYERS} players (the two sides on alternate seats), ${MAP_TYPE} ${SIZE}x${SIZE}; ${FROM ? `starting from ${FROM}` : "starting from the greedy defaults"}`);

  let theta = toTheta(start ?? DEFAULT_WEIGHTS);
  let ema = [...theta];
  let adam = { m: theta.map(() => 0), v: theta.map(() => 0), t: 0 };
  let sigma = SIGMA0;
  let iteration = 0;
  let trainGames = 0;
  let nextCurve = 0;
  let curveAt = -1; // training games at the last curve point
  let points = 0;
  let converged = false;
  let milestone = 0;
  let best: Best = { score: -1, point: 0, theta, iteration: 0, trainingGames: 0, averaged: false };
  const t0 = Date.now();
  const runStart = resumed?.startedAt ?? new Date(t0).toISOString();
  const secondsBefore = resumed?.seconds ?? 0;
  const secs = () => secondsBefore + Math.round((Date.now() - t0) / 1000);
  if (resumed) {
    ({ iteration, trainingGames: trainGames, nextCurve, curveAt, points, converged, sigma, theta, ema, adam, milestone, best } = resumed);
    seed = resumed.seed;
    console.log(`resumed at iteration ${iteration}, ${count(trainGames)} games, ${points} curve points, ${dur(secondsBefore)} trained so far`);
  }
  const eta = () => {
    const s = secs();
    const done = trainGames / BUDGET;
    if (done <= 0 || s < 1) return "ETA …";
    const left = (s * (1 - done)) / done;
    return `ETA ${new Date(Date.now() + left * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}, ${dur(left)} left at most`;
  };
  progress.runEta = () => `iteration ${iteration}, ${count(trainGames)} of ${count(BUDGET)} training games, sigma ${sigma.toFixed(3)}, ${eta()}`;
  const save = () => {
    const ck: Checkpoint = { args: ARGS, startedAt: runStart, seconds: secs(), savedAt: new Date().toISOString(), iteration, trainingGames: trainGames, seed, nextCurve, curveAt, points, converged, sigma, theta, ema, adam, milestone, best };
    fs.writeFileSync(ckPath + ".tmp", JSON.stringify(ck) + "\n");
    fs.renameSync(ckPath + ".tmp", ckPath);
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`\nstopped (${sig}) at iteration ${iteration}, ${count(trainGames)} games, ${dur(secs())} trained; checkpoint ${ckPath}\nresume: the same command plus --resume`);
      process.exit(0);
    });
  }
  if (!resumed) save();

  const name = (games: number, provisional: boolean) => `${ID.replace(/^greedy-es-v(\d+)$/, "ES climber v$1")}${provisional ? ` (training, ${count(games)} games)` : ""}`;
  const modelSpec = (w: GreedyWeights, games: number, note: string) => ({
    id: ID,
    name: name(games, true),
    kind: "greedy",
    description: note,
    created: new Date().toISOString().slice(0, 10),
    weights: w,
    training: { provisional: true, method: "evolution-strategies", mode: MODE, players: PLAYERS, mapSize: SIZE, iteration, trainingGames: games, startedAt: runStart, seconds: secs(), duration: dur(secs()) },
  });
  const provisional = () => {
    const text = JSON.stringify(modelSpec(toWeights(best.theta), best.trainingGames, `Provisional: the best weights so far of a training run in progress (curve point ${best.point + 1}, ${count(best.trainingGames)} games).`), null, 2) + "\n";
    fs.writeFileSync(path.join(dir, "model.json"), text);
    fs.mkdirSync(path.join(dir, "snapshots"), { recursive: true });
    fs.writeFileSync(path.join(dir, "snapshots", `point-${String(points).padStart(3, "0")}-${trainGames}-games.json`), text);
  };

  const curvePoint = async () => {
    const candidates = [{ theta, averaged: false }, { theta: ema, averaged: true }];
    setPhase(`curve point ${points + 1} (vs panel, current and average)`, 2 * panel.length * CURVE_GAMES);
    const results = [];
    for (const c of candidates) results.push({ ...c, vs: await panelTest(panel, toWeights(c.theta), CURVE_GAMES, CURVE_SEED) });
    const top = results.reduce((a, b) => (meanShare(b.vs) > meanShare(a.vs) ? b : a));
    const s = meanShare(top.vs);
    const improved = s > best.score + MIN_GAIN || best.score < 0;
    if (improved) best = { score: s, point: points, theta: [...top.theta], iteration, trainingGames: trainGames, averaged: top.averaged };
    const since = points - best.point;
    for (const r of results) {
      fs.appendFileSync(curvePath, JSON.stringify({ trainingGames: trainGames, iteration, sigma, seconds: secs(), averaged: r.averaged, meanWinRate: Math.round(meanWin(r.vs) * 1000) / 1000, meanPointShare: Math.round(meanShare(r.vs) * 1000) / 1000, best: improved && r === top, vs: r.vs }) + "\n");
      console.log(`curve  ${count(trainGames).padStart(6)} games  iteration ${iteration}  ${r.averaged ? "avg  " : "now  "} | ${panelLine(r.vs)}  ${improved && r === top ? "BEST" : ""}`);
    }
    console.log(`       ${improved ? "new best" : `best ${(best.score * 100).toFixed(1)}% pts at point ${best.point + 1}, ${since}/${PATIENCE || "∞"} without gain`}  ${eta()}`);
    points++;
    nextCurve += CURVE_EVERY;
    curveAt = trainGames;
    if (PATIENCE && since >= PATIENCE) converged = true;
    save();
    provisional();
  };

  /** the score margin of w+ over w- on one map (both seats), head to head and against the league */
  const contrast = async (wp: GreedyWeights, wm: GreedyWeights, s: number) => {
    let d = 0;
    if (selfPlay) d += (await mapPair(wm, wp, s, "+ vs -")).margin;
    for (const o of league) {
      const [a, b] = await Promise.all([mapPair(o.w, wp, s, `vs ${o.id}`), mapPair(o.w, wm, s)]);
      d += a.share - b.share;
    }
    return d;
  };

  if (points === 0) await curvePoint();
  while (!converged && trainGames < BUDGET) {
    iteration++;
    setPhase(`iteration ${iteration} (${gamesPerIt} games)`, gamesPerIt);
    const eps = Array.from({ length: POP }, () => theta.map(() => normal()));
    const seeds = Array.from({ length: PAIRS }, () => seed++); // the same maps for every direction
    const ds = await Promise.all(
      eps.map(async (e) => {
        const wp = toWeights(theta.map((x, i) => x + sigma * e[i]));
        const wm = toWeights(theta.map((x, i) => x - sigma * e[i]));
        const per = await Promise.all(seeds.map((s) => contrast(wp, wm, s)));
        return per.reduce((a, x) => a + x, 0) / per.length;
      }),
    );
    trainGames += gamesPerIt;
    // gradient estimate, then an Adam step (ascent)
    const g = theta.map((_, j) => ds.reduce((a, d, i) => a + d * eps[i][j], 0) / (POP * sigma));
    adam.t++;
    const b1 = 0.9;
    const b2 = 0.999;
    theta = theta.map((x, j) => {
      adam.m[j] = b1 * adam.m[j] + (1 - b1) * g[j];
      adam.v[j] = b2 * adam.v[j] + (1 - b2) * g[j] ** 2;
      const mh = adam.m[j] / (1 - b1 ** adam.t);
      const vh = adam.v[j] / (1 - b2 ** adam.t);
      return x + (LR * mh) / (Math.sqrt(vh) + 1e-8);
    });
    ema = ema.map((x, j) => EMA * x + (1 - EMA) * theta[j]);
    sigma = Math.max(SIGMA_MIN, sigma * SIGMA_DECAY);
    const meanD = ds.reduce((a, x) => a + Math.abs(x), 0) / ds.length;
    const gNorm = Math.sqrt(g.reduce((a, x) => a + x * x, 0));
    console.log(`iteration ${String(iteration).padStart(5)}  ${gamesPerIt} games  mean |margin| ${(meanD * 100).toFixed(2)} pts  |g| ${gNorm.toFixed(3)}  sigma ${sigma.toFixed(3)}  (${((trainGames / BUDGET) * 100).toFixed(1)}%, ${dur(secs())}, ${eta()})`);
    while (milestone < MILESTONES.length && trainGames >= MILESTONES[milestone]) {
      saveMilestone(dir, MILESTONES[milestone], modelSpec(toWeights(theta), trainGames, `Milestone: the weights of ${ID} after ${count(trainGames)} training games (iteration ${iteration}).`));
      console.log(`milestone: saved the weights at ${count(trainGames)} games (models/${ID}/milestones/${MILESTONES[milestone]}-games.json)`);
      milestone++;
    }
    save();
    if (trainGames >= nextCurve) await curvePoint();
  }
  if (!converged && curveAt !== trainGames) await curvePoint();
  if (converged) console.log(`\nconverged: no gain of ${(MIN_GAIN * 100).toFixed(1)} points of share on the panel for ${PATIENCE} curve points; stopped at ${count(trainGames)} of ${count(BUDGET)} games`);
  const champ = toWeights(best.theta);
  console.log(`saving the ${best.averaged ? "averaged weights" : "weights"} of the best curve point (iteration ${best.iteration}, ${count(best.trainingGames)} games)`);

  setPhase("final test (vs panel)", panel.length * FINAL_GAMES);
  const final = await panelTest(panel, champ, FINAL_GAMES, FINAL_SEED);
  console.log(`\nfinal (${FINAL_GAMES} unseen games against each):`);
  for (const [id, v] of Object.entries(final)) {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    console.log(`  vs ${id.padEnd(16)} won ${pct(v.winRate).padStart(4)} ± ${(ci * 100).toFixed(0)}%  (${signed(eloFromScore(v.winRate, v.games))} Elo)  points ${(v.pointShare * 100).toFixed(1)}%`);
  }
  console.log(`changed: ${changes(champ) || "nothing"}`);
  const spec = {
    id: ID,
    name: name(trainGames, false),
    kind: "greedy",
    description:
      `The greedy bot with weights tuned by evolution strategies (scripts/train-es.ts): ${iteration} iterations, ${count(trainGames)} training games in ${PLAYERS}-player ${MODE} on ${MAP_TYPE} ${SIZE}x${SIZE} maps${FROM ? `, starting from ${FROM}` : ""}.` +
      ` Saved the ${best.averaged ? "averaged weights" : "weights"} of the best learning-curve point (iteration ${best.iteration}, ${count(best.trainingGames)} games).` +
      (final["greedy-v1"] ? ` Won ${pct(final["greedy-v1"].winRate)} against greedy-v1 on unseen maps at save time.` : ""),
    created: new Date().toISOString().slice(0, 10),
    weights: champ,
    training: {
      method: "evolution-strategies",
      engine: "rust",
      es: { pop: POP, pairs: PAIRS, lr: LR, sigma: { start: SIGMA0, end: sigma, min: SIGMA_MIN, decay: SIGMA_DECAY }, ema: EMA, optimizer: "adam" },
      league: [...(selfPlay ? ["self"] : []), ...league.map((o) => o.id)],
      budget: BUDGET,
      iterations: iteration,
      trainingGames: trainGames,
      startedAt: runStart,
      endedAt: new Date().toISOString(),
      seconds: secs(),
      duration: dur(secs()),
      mode: MODE,
      players: PLAYERS,
      mapType: MAP_TYPE,
      mapSize: SIZE,
      from: FROM || undefined,
      curve: "curve.jsonl",
      milestones: MILESTONES.length ? MILESTONES : undefined,
      earlyStop: { metric: "share", patience: PATIENCE, minGain: MIN_GAIN, converged, savedIteration: best.iteration, savedAtTrainingGames: best.trainingGames, savedAveraged: best.averaged, savedCurveScore: Math.round(best.score * 1000) / 1000 },
      final,
      finalWinRateVsGreedyV1: final["greedy-v1"]?.winRate,
    },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  fs.rmSync(ckPath, { force: true });
  console.log(`saved models/${ID}/model.json and curve.jsonl`);
  console.log(`training took ${dur(secs())} (${runStart} to ${new Date().toISOString()}${resumed ? ", resumed" : ""})`);
  closePool();
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
