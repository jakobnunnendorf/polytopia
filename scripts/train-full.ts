/**
 * Hill climbing on the full-action-space greedy bot (logic/engine/botFull.ts,
 * model kind "greedy-full"): the same climber as scripts/train-hill.ts, over
 * every knob of FullWeights (the greedy feature weights, one multiplier and one
 * "open" knob per action type, one weight per tech, unit type, build/ability and
 * city reward, and the centre heuristic).
 *
 * Each round nudges --pick (default 4) randomly chosen knobs of the champion
 * (each multiplied by e^(sigma * a random normal number)) and tests the
 * challenger against the champion with an SPRT on fresh maps (see
 * train-hill.ts and logic/arena/sprt.ts). A learning curve against a fixed
 * panel of models (greedy or greedy-full) on held-out maps decides the early
 * stop and which champion is saved.
 *
 * Games: --mode (default domination), --players (default 4, even), --size
 * (default the game's suggestion for mode and players: 16 for 4-player
 * Domination), --map-type (default drylands). With more than two players the
 * challenger and the champion take alternate seats (C H C H, and on the same
 * map H C H C), every player for itself; the side whose player wins takes the
 * game; a game stopped by --max-moves goes to the highest-scoring seat.
 *
 *   node -r sucrase/register scripts/train-full.ts --id greedy-full-v1 --budget 3600000 --workers 4
 *   ... --from greedy-full-v1   # fine-tune a saved greedy-full model
 *
 * The result is saved as models/<id>/model.json (kind "greedy-full", weights
 * under "full"), so the app, the arena and the arena server can play it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { applyAction } from "../logic/engine/actions";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "../logic/engine/bot";
import { DEFAULT_FULL_WEIGHTS, fullBotStep, fullWeights, type FullWeights } from "../logic/engine/botFull";
import { createGame, mapSizeFor } from "../logic/engine/state";
import { scoreOf } from "../logic/engine";
import type { GameMode, GameState } from "../logic/engine/types";
import type { MapType } from "../logic/engine/mapgen";
import { eloFromScore, sprtVerdict } from "../logic/arena/sprt";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

const ID = arg("id", "greedy-full-v1");
const BUDGET = Number(arg("budget", "0")); // training games in total; 0 = stop after --rounds
const ROUNDS = Number(arg("rounds", BUDGET ? "Infinity" : "60"));
const SIGMA = Number(arg("sigma", "0.5"));
const PICK = Number(arg("pick", "4")); // knobs nudged per round (of about 200)
const MODE = arg("mode", "domination") as GameMode;
const PLAYERS = Number(arg("players", "4"));
if (PLAYERS < 2 || PLAYERS % 2 !== 0) throw new Error("--players must be even: the two sides take alternate seats");
const SIZE = Number(arg("size", String(mapSizeFor(MODE, PLAYERS - 1) ?? 16)));
const MAP_TYPE = arg("map-type", "drylands") as MapType;
const FROM = arg("from", "");
const MAX_MOVES = Number(arg("max-moves", "20000"));
let seed = Number(arg("seed", "1000"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));

const ELO0 = Number(arg("elo0", "0"));
const ELO1 = Number(arg("elo1", "25"));
const BATCH = Number(arg("batch", "20")); // map pairs between two looks at the evidence
const MAX_GAMES = Number(arg("max-games", "1000")); // give up (reject) after this many games

const PANEL_IDS = arg("panel", "greedy-v1,greedy-hill-v3,greedy-hill-v4")
  .split(",")
  .filter((x) => x && x !== ID);
const CURVE_GAMES = Number(arg("curve-games", "200")); // per panel opponent
const CURVE_EVERY = Number(arg("curve-every", String(BUDGET ? Math.round(BUDGET / 40) : 20000))); // training games
const FINAL_GAMES = Number(arg("final", "400")); // per panel opponent
const PATIENCE = Number(arg("patience", "8")); // curve points; 0 = never stop early
const MIN_GAIN = Number(arg("min-gain", "0.01"));
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;

// ---------- knobs: dotted paths into FullWeights ----------
type Group = "greedy" | "type" | "open" | "tech" | "unit" | "build" | "reward";
const GROUPS: Group[] = ["greedy", "type", "open", "tech", "unit", "build", "reward"];
// noise (tie-break randomness) stays fixed; greedy.rewards are covered by the reward group
const KNOBS: string[] = [
  ...GROUPS.flatMap((g) =>
    Object.keys(DEFAULT_FULL_WEIGHTS[g])
      .filter((k) => !(g === "greedy" && (k === "noise" || k === "rewards")))
      .map((k) => `${g}.${k}`),
  ),
  "centre",
];
const WHOLE = new Set(["greedy.richAt", "greedy.unitsPerCity"]);

function getKnob(w: FullWeights, k: string): number {
  if (k === "centre") return w.centre;
  const [g, key] = k.split(".") as [Group, string];
  return (w[g] as Record<string, number>)[key];
}
function setKnob(w: FullWeights, k: string, v: number) {
  if (k === "centre") w.centre = v;
  else {
    const [g, key] = k.split(".") as [Group, string];
    (w[g] as Record<string, number>)[key] = v;
  }
}
const clone = (w: FullWeights): FullWeights => ({
  greedy: { ...w.greedy, rewards: { ...w.greedy.rewards } },
  type: { ...w.type },
  open: { ...w.open },
  tech: { ...w.tech },
  unit: { ...w.unit },
  build: { ...w.build },
  reward: { ...w.reward },
  centre: w.centre,
});

function normal(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function mutate(w: FullWeights): { next: FullWeights; nudged: string } {
  const next = clone(w);
  const keys = [...KNOBS].sort(() => Math.random() - 0.5).slice(0, PICK);
  for (const k of keys) {
    const v = getKnob(w, k) * Math.exp(SIGMA * normal());
    setKnob(next, k, WHOLE.has(k) ? Math.max(1, Math.round(v)) : Math.round(v * 1000) / 1000);
  }
  return { next, nudged: keys.map((k) => `${k} ${getKnob(w, k)}→${getKnob(next, k)}`).join(", ") };
}

// ---------- games ----------
type Policy = { kind: "greedy"; w: GreedyWeights } | { kind: "full"; w: FullWeights };
const step = (s: GameState, p: Policy) => (p.kind === "full" ? fullBotStep(s, p.w) : botStep(s, p.w));

/** one free-for-all game; side 0 (p0) on the even seats, side 1 on the odd ones */
function play(p0: Policy, p1: Policy, gameSeed: number, size = SIZE): { winner: number; scores: [number, number] } {
  let s: GameState = createGame({ mapSize: size, players: PLAYERS, mode: MODE, seed: gameSeed, humans: [], mapType: MAP_TYPE });
  const ps = [p0, p1];
  let moves = 0;
  while (!s.over && moves < MAX_MOVES) {
    s = applyAction(s, step(s, ps[s.current % 2]));
    moves++;
  }
  const seatScores = s.players.map((p) => scoreOf(s, p.id));
  const scores: [number, number] = [0, 0];
  seatScores.forEach((v, i) => (scores[i % 2] += v));
  // unfinished (move cap): the highest-scoring seat wins; a tie goes to the later seat
  let top = 0;
  seatScores.forEach((v, i) => v >= seatScores[top] && (top = i));
  const winner = s.winner ?? top;
  return { winner: winner % 2, scores };
}

type Job = { p0: Policy; p1: Policy; seed: number; size: number };
type Result = { winner: number; scores: [number, number] };

class Pool {
  private idle: Worker[] = [];
  private queue: { job: Job; done: (r: Result) => void }[] = [];
  private all: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
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
// ---------- progress: a line every --progress-every seconds (default 60) while games run ----------
const PROGRESS_EVERY = Number(arg("progress-every", "60"));
const progress = { phase: "starting", phaseGames: 0, phaseTotal: 0, done: 0, lastDone: 0, startedAt: Date.now() };
function setPhase(phase: string, total = 0) {
  progress.phase = phase;
  progress.phaseGames = 0;
  progress.phaseTotal = total;
}
if (isMainThread && PROGRESS_EVERY > 0) {
  setInterval(() => {
    const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const recent = progress.done - progress.lastDone;
    progress.lastDone = progress.done;
    const mins = (Date.now() - progress.startedAt) / 60000;
    const of = progress.phaseTotal ? `/${progress.phaseTotal}` : "";
    console.log(`  [${now}] ${progress.phase}: ${progress.phaseGames}${of} games; ${progress.done} games in all, ${recent} in the last ${PROGRESS_EVERY}s (${(progress.done / Math.max(mins, 1e-9)).toFixed(1)}/min)`);
  }, PROGRESS_EVERY * 1000).unref();
}
const runJob = (job: Job): Promise<Result> =>
  (pool ? pool.run(job) : Promise.resolve(play(job.p0, job.p1, job.seed, job.size))).then((r) => {
    progress.done++;
    progress.phaseGames++;
    return r;
  });

/** b's share of wins and points against a, each map played from both sides */
async function match(a: Policy, b: Policy, games: number, firstSeed: number): Promise<{ wins: number; share: number }> {
  const jobs = Array.from({ length: games }, (_, g) => {
    const mapSeed = firstSeed + Math.floor(g / 2);
    const bFirst = g % 2 === 0;
    const job: Job = bFirst ? { p0: b, p1: a, seed: mapSeed, size: SIZE } : { p0: a, p1: b, seed: mapSeed, size: SIZE };
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

async function sprtTest(champ: Policy, chall: Policy): Promise<Test> {
  setPhase("testing a challenger");
  const pairs: number[] = [];
  let wins = 0;
  let mine = 0;
  let total = 0;
  for (;;) {
    const batch = Array.from({ length: BATCH }, () => {
      const s = seed++;
      return Promise.all([runJob({ p0: chall, p1: champ, seed: s, size: SIZE }), runJob({ p0: champ, p1: chall, seed: s, size: SIZE })]);
    });
    for (const [a, b] of await Promise.all(batch)) {
      const w = (a.winner === 0 ? 1 : 0) + (b.winner === 1 ? 1 : 0);
      wins += w;
      pairs.push(w / 2);
      mine += a.scores[0] + b.scores[1];
      total += a.scores[0] + a.scores[1] + b.scores[0] + b.scores[1];
    }
    const { verdict, llr } = sprtVerdict(pairs, ELO0, ELO1);
    console.log(`    look: ${pairs.length * 2} games, challenger won ${((wins / (pairs.length * 2)) * 100).toFixed(0)}%, LLR ${llr.toFixed(2)} (keep at ${Math.log(19).toFixed(2)}, reject at ${(-Math.log(19)).toFixed(2)})`);
    const games = pairs.length * 2;
    const out = { games, wins: wins / games, share: total ? mine / total : 0.5, llr };
    if (verdict === "accept") return { ...out, keep: true };
    if (verdict === "reject") return { ...out, keep: false };
    if (games >= MAX_GAMES) return { ...out, keep: false, capped: true };
  }
}

// ---------- panel ----------
function policyOf(id: string): Policy | null {
  if (id === "greedy-v1") return { kind: "greedy", w: DEFAULT_WEIGHTS };
  const f = path.join(process.cwd(), "models", id, "model.json");
  if (!fs.existsSync(f)) return null;
  const spec = JSON.parse(fs.readFileSync(f, "utf8"));
  if (spec.kind === "greedy-full") return { kind: "full", w: fullWeights(spec.full) };
  if (spec.kind !== "greedy" || !spec.weights) return null;
  return { kind: "greedy", w: { ...DEFAULT_WEIGHTS, ...spec.weights, rewards: { ...DEFAULT_WEIGHTS.rewards, ...(spec.weights.rewards ?? {}) } } };
}

type PanelResult = Record<string, { winRate: number; pointShare: number; games: number }>;

async function panelTest(panel: { id: string; p: Policy }[], champ: Policy, games: number, firstSeed: number): Promise<PanelResult> {
  const res = await Promise.all(panel.map(async (p) => [p.id, await match(p.p, champ, games, firstSeed)] as const));
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

function changes(w: FullWeights): string {
  return KNOBS.filter((k) => getKnob(w, k) !== getKnob(DEFAULT_FULL_WEIGHTS, k))
    .map((k) => `${k} ${getKnob(DEFAULT_FULL_WEIGHTS, k)}→${getKnob(w, k)}`)
    .join(", ");
}

async function main() {
  pool = WORKERS > 1 ? new Pool(WORKERS) : null;
  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const panel = PANEL_IDS.map((id) => ({ id, p: policyOf(id) })).filter((x): x is { id: string; p: Policy } => {
    if (!x.p) console.log(`panel: skipping ${x.id} (no greedy or greedy-full model.json)`);
    return !!x.p;
  });
  console.log(`${WORKERS} worker${WORKERS > 1 ? "s" : ""}; ${KNOBS.length} knobs, ${PICK} nudged per round; test: SPRT elo0 ${ELO0} elo1 ${ELO1}, ${BATCH} map pairs per look, at most ${MAX_GAMES} games; ${BUDGET ? `budget ${count(BUDGET)} training games` : `${ROUNDS} rounds`}`);
  console.log(`panel: ${panel.map((p) => p.id).join(", ")}; ${CURVE_GAMES} games each every ${count(CURVE_EVERY)} training games`);

  const curvePath = path.join(dir, "curve.jsonl");
  fs.writeFileSync(curvePath, "");
  let start: FullWeights | null = null;
  // the source model's own training time (counted into a fine-tune's total)
  const fromSeconds: number | undefined = FROM
    ? (() => {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(process.cwd(), "models", FROM, "model.json"), "utf8")).training ?? {};
          return t.totalSecondsIncludingFrom ?? t.seconds;
        } catch {
          return undefined;
        }
      })()
    : undefined;
  if (FROM) {
    const p = policyOf(FROM);
    if (!p || p.kind !== "full") throw new Error(`--from ${FROM}: no greedy-full model.json in models/${FROM}`);
    start = p.w;
  }
  let champ: FullWeights = clone(start ?? DEFAULT_FULL_WEIGHTS);
  console.log(`mode ${MODE}, ${PLAYERS} players (the two sides on alternate seats), ${MAP_TYPE} ${SIZE}x${SIZE}; ${FROM ? `fine-tuning from ${FROM}` : "starting from the default full weights"}`);
  const asPolicy = (w: FullWeights): Policy => ({ kind: "full", w });
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
  const eta = () => {
    const s = (Date.now() - t0) / 1000;
    const done = BUDGET ? trainGames / BUDGET : Number.isFinite(ROUNDS) ? rounds / ROUNDS : 0;
    if (done <= 0 || s < 1) return "ETA …";
    const left = (s * (1 - done)) / done;
    const at = new Date(Date.now() + left * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `ETA ${at}, ${dur(left)} left`;
  };

  let points = 0;
  let best = { mean: -1, point: 0, champ, round: 0, trainingGames: 0, kept: 0 };
  let converged = false;

  const curvePoint = async () => {
    setPhase(`curve point ${points + 1} (vs panel)`, panel.length * CURVE_GAMES);
    const vs = await panelTest(panel, asPolicy(champ), CURVE_GAMES, CURVE_SEED);
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
    const m = await sprtTest(asPolicy(champ), asPolicy(chall));
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
      fs.writeFileSync(path.join(dir, "checkpoint.json"), JSON.stringify({ round: rounds, trainingGames: trainGames, accepted, seed, full: champ }, null, 2) + "\n");
    }
    if (trainGames >= nextCurve) await curvePoint();
  }
  if (!converged && trainGames + CURVE_EVERY > nextCurve) await curvePoint();
  if (converged) console.log(`\nconverged: no gain of ${pct(MIN_GAIN)} on the panel for ${PATIENCE} curve points; stopped at ${count(trainGames)} of ${BUDGET ? count(BUDGET) : "∞"} games`);
  const lastChamp = champ;
  champ = best.champ;
  if (champ !== lastChamp) console.log(`saving the champion of the best curve point (round ${best.round}, ${count(best.trainingGames)} games, mean ${pct(best.mean)})`);

  setPhase("final test (vs panel)", panel.length * FINAL_GAMES);
  const final = await panelTest(panel, asPolicy(champ), FINAL_GAMES, FINAL_SEED);
  console.log(`\nfinal (${FINAL_GAMES} unseen games against each):`);
  for (const [id, v] of Object.entries(final)) {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    console.log(`  vs ${id.padEnd(16)} won ${pct(v.winRate).padStart(4)} ± ${(ci * 100).toFixed(0)}%  (${signed(eloFromScore(v.winRate, v.games))} Elo)  points ${(v.pointShare * 100).toFixed(1)}%`);
  }
  console.log(`changed: ${changes(champ) || "nothing"}`);

  const name = ID.replace(/^greedy-full-v(\d+)$/, "Full greedy climber v$1");
  const strongest = panel[panel.length - 1]?.id;
  const spec = {
    id: ID,
    name,
    kind: "greedy-full",
    description:
      `The full-action-space greedy bot (logic/engine/botFull.ts) with ${KNOBS.length} knobs tuned by hill climbing (scripts/train-full.ts): ${rounds} challengers tested with an SPRT (${count(trainGames)} self-play games) in ${PLAYERS}-player ${MODE} on ${MAP_TYPE} ${SIZE}x${SIZE} maps${FROM ? `, fine-tuned from ${FROM}` : ""}, ${accepted} challengers kept.` +
      (best.round !== rounds ? ` Saved the champion of the best learning-curve point (round ${best.round}, ${count(best.trainingGames)} games, ${best.kept} kept).` : "") +
      (final["greedy-v1"] ? ` Won ${pct(final["greedy-v1"].winRate)} against greedy-v1` : "") +
      (strongest && strongest !== "greedy-v1" ? ` and ${pct(final[strongest].winRate)} against ${strongest}` : "") +
      " on unseen maps at save time.",
    created: new Date().toISOString().slice(0, 10),
    full: champ,
    training: {
      method: "hill-climbing",
      test: "sprt",
      sprt: { elo0: ELO0, elo1: ELO1, alpha: 0.05, beta: 0.05, mapPairsPerLook: BATCH, maxGames: MAX_GAMES },
      budget: BUDGET || undefined,
      rounds,
      trainingGames: trainGames,
      // every run records how long it took; a fine-tune also adds the source model's training time
      startedAt: new Date(t0).toISOString(),
      endedAt: new Date().toISOString(),
      seconds: secs(),
      duration: dur(secs()),
      ...(FROM ? { totalSecondsIncludingFrom: secs() + (fromSeconds ?? 0), totalDurationIncludingFrom: dur(secs() + (fromSeconds ?? 0)) } : {}),
      sigma: SIGMA,
      knobs: KNOBS.length,
      weightsPerNudge: PICK,
      mode: MODE,
      players: PLAYERS,
      mapType: MAP_TYPE,
      from: FROM || undefined,
      mapSize: SIZE,
      accepted,
      capped,
      curve: "curve.jsonl",
      earlyStop: { patience: PATIENCE, minGain: MIN_GAIN, converged, savedRound: best.round, savedAtTrainingGames: best.trainingGames, savedKept: best.kept, savedCurveMean: Math.round(best.mean * 1000) / 1000 },
      final,
      finalWinRateVsGreedyV1: final["greedy-v1"]?.winRate,
    },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  fs.rmSync(path.join(dir, "checkpoint.json"), { force: true });
  console.log(`saved models/${ID}/model.json and curve.jsonl`);
  console.log(`training took ${dur(secs())} (${new Date(t0).toISOString()} to ${new Date().toISOString()})${FROM ? `; with ${FROM}'s own training ${dur(secs() + (fromSeconds ?? 0))} in total` : ""}`);
  pool?.close();
}

if (!isMainThread && workerData?.trainWorker) {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(play(j.p0, j.p1, j.seed, j.size)));
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
