/**
 * The simplest learning bot: hill climbing on the greedy bot's scoring weights.
 *
 * Each round makes a challenger by nudging a few weights of the champion (each multiplied by
 * e^(sigma * a random normal number)) and tests it on fresh maps, each map played once from each
 * seat. Games run in the Rust engine on a pool of worker threads (--workers, default all cores but two).
 *
 * Acceptance test (--test):
 *   margin (default) a sequential test on score margins: each map pair gives the challenger's share
 *          of all points minus 0.5; keep once the evidence says the mean margin is --margin1 (1 point
 *          of share) rather than 0, reject once it says 0, reject at --max-games. Points are a much
 *          finer signal than wins, so a decision needs far fewer games. logic/arena/sprt.ts.
 *   sprt   the same sequential test on results (win 1, loss 0), with --elo0/--elo1
 *   fixed  the rule v1-v3 trained with: --games games, keep at --accept of all points and half the wins
 *
 * Opponents (--league, default "self"): who the challenger is compared against, map pair by map pair
 * in turn. "self" plays the challenger against the champion. "past" plays it against a random
 * earlier champion of this run. A model id (e.g. greedy-v1) plays the challenger and the champion
 * against that model on the same map and seats, and compares their shares. A mix keeps the climb
 * from going in circles (beating the last champion but losing to older play).
 *
 * Step size: --sigma (0.5) shrinks by --sigma-decay (0.85) after every --sigma-patience (50) rounds
 * without a kept challenger, down to --sigma-min (0.15), and grows by 1.25 on a keep, up to --sigma.
 * With --resume, --reset-sigma X starts the step at X again;
 * every resume and its options are recorded in the checkpoint and the model file.
 *
 * Learning curve: at the start, every --curve-every training games and at the end, the champion
 * plays a fixed panel (--panel) on the same held-out maps (--curve-games each). With --average K
 * (default 4) the geometric mean of the last K kept champions is tested as well; the better of the
 * two counts. Written to models/<id>/curve.jsonl and to the log as lines starting with "curve".
 *
 * Early stop: converged once the curve metric (--curve-metric share: mean share of points against
 * the panel, the default; or win: mean win rate) has not beaten its best by --min-gain for
 * --patience curve points in a row. The champion of the best curve point is saved, not the last one.
 *
 * Milestones (--milestones 3600,36000,...): when training passes each count, the champion is
 * saved to models/<id>/milestones/<count>-games.json, a complete model file.
 *
 * Stop any time (Ctrl-C, kill) and continue with the same command plus --resume.
 *
 *   npm run train-hill -- --id greedy-hill-v5 --budget 30000
 *   npm run train-hill -- --id greedy-hill-v5 --from greedy-hill-v4 --league self,past,greedy-v1
 *
 * Games: --mode (default domination), --players (4, even), --size, --map-type (drylands),
 * --max-turns (150); see scripts/lib/train-greedy.ts. Training games are not recorded and do not
 * touch the Elo table. The result is models/<id>/model.json (kind "greedy").
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { eloFromScore, marginVerdict, sprtBounds, sprtVerdict } from "../logic/arena/sprt";
import {
  MAP_TYPE,
  MILESTONES,
  MODE,
  PLAYERS,
  SIZE,
  arg,
  averageIn,
  anyWeightsOf,
  type AnyWeights,
  changes,
  closePool,
  count,
  dur,
  loadPanel,
  mapPair,
  match,
  meanShare,
  meanWin,
  normal,
  panelLine,
  panelTest,
  pct,
  progress,
  saveMilestone,
  setPhase,
  signed,
  startPool,
  startProgress,
  spaceOf,
  changesIn,
} from "./lib/train-greedy";

const SPACE = spaceOf(arg("space", "greedy")); // greedy: the greedy bot's weights; full: the full-action-space bot
const FULL = SPACE.name === "full";
const ID = arg("id", FULL ? "greedy-full-v1" : "greedy-hill-v1");
const BUDGET = Number(arg("budget", "0")); // training games in total; 0 = stop after --rounds
const ROUNDS = Number(arg("rounds", BUDGET ? "Infinity" : "60"));
const SIGMA = Number(arg("sigma", "0.5"));
// the floor must stay large enough for the test to see a change: at 0.05 (±5% on 3 knobs) the
// margin test almost never reaches +1 point of share, and the climb stalls (greedy-hill-v5, 24 Nov)
const SIGMA_MIN = Number(arg("sigma-min", "0.15"));
const SIGMA_DECAY = Number(arg("sigma-decay", "0.85"));
const SIGMA_PATIENCE = Number(arg("sigma-patience", "50")); // rounds without a keep before sigma shrinks
// --resume only: start the step size again at this value (also lifts it to a new --sigma-min)
const RESET_SIGMA = Number(arg("reset-sigma", "0"));
const PICK = Number(arg("pick", FULL ? "4" : "3")); // knobs nudged per round (of ~20 greedy, ~200 full)
const FROM = arg("from", ""); // fine-tune: start from this model's weights
const RESUME = process.argv.includes("--resume");
const ARGS = process.argv.slice(2).filter((a) => a !== "--resume").join(" ");
let seed = Number(arg("seed", "1000"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));

const TEST = (["margin", "sprt", "fixed"] as const).find((t) => t === arg("test", "margin")) ?? "margin";
const GAMES = Number(arg("games", "60")); // --test fixed: per round
const ACCEPT = Number(arg("accept", "0.52")); // --test fixed: share of all points to keep
const ELO0 = Number(arg("elo0", "0")); // --test sprt
const ELO1 = Number(arg("elo1", "25"));
const M0 = Number(arg("margin0", "0")); // --test margin: share of points above one half
const M1 = Number(arg("margin1", "0.01"));
const BATCH = Number(arg("batch", "10")); // map pairs between two looks at the evidence
const MAX_GAMES = Number(arg("max-games", "400")); // give up (reject) after this many games
const LEAGUE = arg("league", "self").split(",").filter(Boolean);

const PANEL_IDS = arg("panel", "greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4")
  .split(",")
  .filter((x) => x && x !== ID);
const CURVE_GAMES = Number(arg("curve-games", "200")); // per panel opponent
const CURVE_EVERY = Number(arg("curve-every", String(BUDGET ? Math.round(BUDGET / 40) : 20000))); // training games
const FINAL_GAMES = Number(arg("final", "400")); // per panel opponent
const CURVE_METRIC = arg("curve-metric", "share") === "win" ? "win" : "share";
const PATIENCE = Number(arg("patience", "8")); // curve points; 0 = never stop early
const MIN_GAIN = Number(arg("min-gain", CURVE_METRIC === "share" ? "0.003" : "0.01"));
const AVERAGE = Number(arg("average", "4")); // also test the mean of the last K kept champions
// learning from losses (both off by default; see proposeChallenger):
// --mirror: after a clearly lost round, test the opposite nudge of the same knobs next
// --credit: learn each knob's effect on the margin from every round, and pick knobs and
//           directions by Thompson sampling from that estimate
const MIRROR = process.argv.includes("--mirror");
const MIRROR_BELOW = Number(arg("mirror-below", "-0.01")); // mean margin (share of points) that counts as a clear loss
const CREDIT = process.argv.includes("--credit");
const CREDIT_PRIOR = Number(arg("credit-prior", "0.1")); // prior sd of a knob's effect (margin per unit of log change)
const CREDIT_EXPLORE = Number(arg("credit-explore", "0.25")); // share of credit rounds that nudge random knobs anyway
const CREDIT_FORGET = Number(arg("credit-forget", "0.5")); // evidence kept after a keep (the champion moved)
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;

type Best = { score: number; point: number; champ: AnyWeights; round: number; trainingGames: number; kept: number; averaged: boolean };
type Checkpoint = {
  args: string;
  startedAt: string;
  seconds: number;
  savedAt: string;
  round: number;
  trainingGames: number;
  accepted: number;
  capped: number;
  seed: number;
  nextCurve: number;
  curveAt: number;
  points: number;
  converged: boolean;
  sigma: number;
  sinceKeep: number;
  past: AnyWeights[];
  milestone: number;
  /** every resume: when, and the options it ran with from then on */
  resumes?: { at: string; round: number; trainingGames: number; args: string; sigma: number }[];
  best: Best;
  weights: AnyWeights;
  /** --credit: per knob, the weighted sums of x*margin and x*x (x = log change of the knob) */
  credit?: Record<string, { xy: number; xx: number; n: number }>;
  /** --credit: running weighted sums for the margin noise (per 90 games) */
  noise?: { w: number; y2: number };
  /** --mirror: the nudge to undo next round (knob -> factor applied) */
  pendingMirror?: Record<string, number> | null;
};

/** nudge PICK randomly chosen weights by e^(sigma N(0,1)); the rest stay as they are */
function mutate(w: AnyWeights, sigma: number): { next: AnyWeights; nudged: string } {
  const next = SPACE.clone(w);
  const keys = [...SPACE.knobs].sort(() => Math.random() - 0.5).slice(0, PICK);
  for (const k of keys) SPACE.set(next, k, SPACE.round(k, SPACE.get(w, k) * Math.exp(sigma * normal())));
  return { next, nudged: keys.map((k) => `${k} ${SPACE.get(w, k)}→${SPACE.get(next, k)}`).join(", ") };
}

type Test = { keep: boolean; games: number; wins: number; share: number; llr?: number; capped?: boolean };

type Credit = Record<string, { xy: number; xx: number; n: number }>;
type Proposal = { next: AnyWeights; nudged: string; source: "random" | "mirror" | "credit"; x: Record<string, number> };

/** the factors actually applied (after rounding), as log changes per knob */
function logChanges(from: AnyWeights, to: AnyWeights, keys: string[]): Record<string, number> {
  const x: Record<string, number> = {};
  for (const k of keys) {
    const a = SPACE.get(from, k), b = SPACE.get(to, k);
    if (a > 0 && b > 0 && a !== b) x[k] = Math.log(b / a);
  }
  return x;
}
function describe(from: AnyWeights, to: AnyWeights, keys: string[]) {
  return keys.map((k) => `${k} ${SPACE.get(from, k)}→${SPACE.get(to, k)}`).join(", ");
}

/**
 * The next challenger. Default: PICK random knobs, each times e^(sigma N(0,1)) (mutate).
 * --mirror: right after a clear loss, the same knobs moved the other way (each by the inverse factor).
 * --credit: Thompson sampling on a per-knob linear model of the margin. Each knob's effect has a
 *   normal posterior (prior sd CREDIT_PRIOR, evidence sum x*margin / sum x*x weighted by games);
 *   draw one effect per knob, nudge the PICK knobs with the largest |draw| in the draw's direction
 *   by e^(sigma |N(0,1)|). Knobs never tried keep the wide prior and so still get picked; knobs
 *   that never matter collect evidence of "no effect" and fade out. A share CREDIT_EXPLORE of
 *   rounds stays purely random so the model keeps getting unbiased data.
 */
function proposeChallenger(w: AnyWeights, sigma: number, credit: Credit, noiseSd: number, mirror: Record<string, number> | null): Proposal {
  if (MIRROR && mirror) {
    const next = SPACE.clone(w);
    const keys = Object.keys(mirror);
    for (const k of keys) SPACE.set(next, k, SPACE.round(k, SPACE.get(w, k) / mirror[k]));
    return { next, nudged: describe(w, next, keys), source: "mirror", x: logChanges(w, next, keys) };
  }
  if (CREDIT && Math.random() >= CREDIT_EXPLORE) {
    const s2 = noiseSd * noiseSd, p0 = 1 / (CREDIT_PRIOR * CREDIT_PRIOR);
    const draws = SPACE.knobs.map((k) => {
      const c = credit[k] ?? { xy: 0, xx: 0, n: 0 };
      const prec = p0 + c.xx / s2;
      const mean = c.xy / s2 / prec;
      return { k, d: mean + normal() / Math.sqrt(prec) };
    });
    draws.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const pick = draws.slice(0, PICK);
    const next = SPACE.clone(w);
    for (const { k, d } of pick) SPACE.set(next, k, SPACE.round(k, SPACE.get(w, k) * Math.exp(Math.sign(d) * sigma * Math.abs(normal()))));
    const keys = pick.map((p) => p.k);
    return { next, nudged: describe(w, next, keys), source: "credit", x: logChanges(w, next, keys) };
  }
  const { next, nudged } = mutate(w, sigma);
  const keys = SPACE.knobs.filter((k) => SPACE.get(next, k) !== SPACE.get(w, k));
  return { next, nudged, source: "random", x: logChanges(w, next, keys) };
}

async function main() {
  startPool(WORKERS);
  startProgress();
  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const panel = loadPanel(PANEL_IDS);
  const league = LEAGUE.map((x) => (x === "self" || x === "past" ? { id: x, w: null } : { id: x, w: anyWeightsOf(x) })).filter((o) => {
    if (o.id !== "self" && o.id !== "past" && !o.w) console.log(`league: skipping ${o.id} (no greedy model.json)`);
    return o.id === "self" || o.id === "past" || !!o.w;
  });
  if (!league.length) league.push({ id: "self", w: null });
  const test =
    TEST === "margin"
      ? `margin test (mean share ${M0} vs +${M1}), ${BATCH} map pairs per look, at most ${MAX_GAMES} games`
      : TEST === "sprt"
        ? `SPRT elo0 ${ELO0} elo1 ${ELO1}, ${BATCH} map pairs per look, at most ${MAX_GAMES} games`
        : `fixed ${GAMES} games, keep at ${ACCEPT} of the points`;
  console.log(`${WORKERS} worker${WORKERS > 1 ? "s" : ""}; test: ${test}; opponents: ${league.map((o) => o.id).join(", ")}; ${BUDGET ? `budget ${count(BUDGET)} training games` : `${ROUNDS} rounds`}`);
  console.log(`panel: ${panel.map((p) => p.id).join(", ")}; ${CURVE_GAMES} games each every ${count(CURVE_EVERY)} training games; early stop on ${CURVE_METRIC === "share" ? "points share" : "win rate"}`);
  if (MILESTONES.length) console.log(`milestones: ${MILESTONES.map(count).join(", ")} training games`);

  const curvePath = path.join(dir, "curve.jsonl");
  const roundsPath = path.join(dir, "rounds.jsonl"); // every challenger: source, knobs moved, result
  const ckPath = path.join(dir, "checkpoint.json");
  const resumed: Checkpoint | null = RESUME ? (fs.existsSync(ckPath) ? JSON.parse(fs.readFileSync(ckPath, "utf8")) : null) : null;
  if (RESUME && !resumed) throw new Error(`--resume: no checkpoint at ${ckPath}`);
  if (resumed && resumed.args !== ARGS) console.log(`note: resuming with other options than the run was started with:\n  then: ${resumed.args}\n  now:  ${ARGS}`);
  if (!resumed) fs.writeFileSync(curvePath, "");
  if (!resumed) fs.writeFileSync(roundsPath, "");
  if (MIRROR || CREDIT) console.log(`learning from losses: ${[MIRROR ? `mirror after margins ≤ ${(MIRROR_BELOW * 100).toFixed(1)} pts` : "", CREDIT ? `credit (prior sd ${CREDIT_PRIOR}, ${pct(CREDIT_EXPLORE)} random rounds, keep ${CREDIT_FORGET} of the evidence after a keep)` : ""].filter(Boolean).join("; ")}`);
  const start = FROM ? SPACE.load(FROM) : null;
  if (FROM && !start) throw new Error(`--from ${FROM}: no greedy model.json in models/${FROM}`);
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
  let champ: AnyWeights = start ?? SPACE.defaults();
  console.log(`mode ${MODE}, ${PLAYERS} players (the two sides on alternate seats), ${MAP_TYPE} ${SIZE}x${SIZE}; ${FROM ? `fine-tuning from ${FROM}` : "starting from the greedy defaults"}`);

  let accepted = 0;
  let capped = 0;
  let trainGames = 0;
  let rounds = 0;
  let nextCurve = 0;
  let curveAt = -1; // training games at the last curve point
  let sigma = SIGMA;
  let sinceKeep = 0;
  let credit: Credit = {};
  let noise = { w: 0, y2: 0 };
  let pendingMirror: Record<string, number> | null = null;
  let resumes: NonNullable<Checkpoint["resumes"]> = [];
  let past: AnyWeights[] = [champ]; // kept champions, newest last (for "past" and averaging)
  let milestone = 0; // index of the next milestone
  const t0 = Date.now();
  const runStart = resumed?.startedAt ?? new Date(t0).toISOString();
  const secondsBefore = resumed?.seconds ?? 0;
  const secs = () => secondsBefore + Math.round((Date.now() - t0) / 1000);
  const eta = () => {
    const s = secs();
    const done = BUDGET ? trainGames / BUDGET : Number.isFinite(ROUNDS) ? rounds / ROUNDS : 0;
    if (done <= 0 || s < 1) {
      // no training games yet: estimate from the game rate so far
      const perMin = progress.done / Math.max((Date.now() - progress.startedAt) / 60000, 1e-9);
      if (!BUDGET || progress.done < 5) return "ETA …";
      const leftMin = Math.max(0, BUDGET - trainGames) / perMin;
      return `ETA ~${new Date(Date.now() + leftMin * 60000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}, ~${dur(leftMin * 60)} left at most`;
    }
    const left = Math.max(0, (s * (1 - done)) / done);
    const at = new Date(Date.now() + left * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return `ETA ${at}, ${dur(left)} left at most`;
  };
  progress.runEta = () => `round ${rounds}, ${count(trainGames)} of ${BUDGET ? count(BUDGET) : "∞"} training games, ${accepted} kept, sigma ${sigma.toFixed(2)}, ${eta()}`;

  let points = 0;
  let best: Best = { score: -1, point: 0, champ, round: 0, trainingGames: 0, kept: 0, averaged: false };
  let converged = false;
  if (resumed) {
    champ = resumed.weights;
    best = resumed.best;
    ({ accepted, capped, trainingGames: trainGames, round: rounds, nextCurve, curveAt, points, converged, sigma, sinceKeep, past, milestone } = resumed);
    credit = resumed.credit ?? {};
    noise = resumed.noise ?? { w: 0, y2: 0 };
    pendingMirror = resumed.pendingMirror ?? null;
    seed = resumed.seed;
    console.log(`resumed at round ${rounds}, ${count(trainGames)} games, ${accepted} kept, ${points} curve points, ${dur(secondsBefore)} trained so far`);
    if (RESET_SIGMA > 0) {
      console.log(`step size reset: sigma ${sigma.toFixed(2)} → ${RESET_SIGMA} (floor ${SIGMA_MIN}, shrinks after ${SIGMA_PATIENCE} rounds without a keep)`);
      sigma = RESET_SIGMA;
      sinceKeep = 0;
    }
    sigma = Math.max(sigma, SIGMA_MIN);
    resumes = [...(resumed.resumes ?? []), { at: new Date().toISOString(), round: rounds, trainingGames: trainGames, args: process.argv.slice(2).join(" "), sigma }];
  }
  const save = () => {
    const ck: Checkpoint = { args: ARGS, startedAt: runStart, seconds: secs(), savedAt: new Date().toISOString(), round: rounds, trainingGames: trainGames, accepted, capped, seed, nextCurve, curveAt, points, converged, sigma, sinceKeep, past, milestone, resumes, best, weights: champ, credit, noise, pendingMirror };
    fs.writeFileSync(ckPath + ".tmp", JSON.stringify(ck) + "\n");
    fs.renameSync(ckPath + ".tmp", ckPath);
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`\nstopped (${sig}) at round ${rounds}, ${count(trainGames)} games, ${dur(secs())} trained; checkpoint ${ckPath}\nresume: the same command plus --resume`);
      process.exit(0);
    });
  }
  if (!resumed) save();

  const name = (games: number, provisional: boolean) => `${(FULL ? ID.replace(/^greedy-full-v(\d+)$/, "Full greedy climber v$1") : ID.replace(/^greedy-hill-v(\d+)$/, "Hill climber v$1"))}${provisional ? ` (training, ${count(games)} games)` : ""}`;
  const modelSpec = (w: AnyWeights, games: number, note: string) => ({
    id: ID,
    name: name(games, true),
    kind: SPACE.kind,
    description: note,
    created: new Date().toISOString().slice(0, 10),
    [SPACE.field]: w,
    training: { provisional: true, method: "hill-climbing", space: SPACE.name, test: TEST, mode: MODE, players: PLAYERS, mapSize: SIZE, round: rounds, trainingGames: games, kept: accepted, startedAt: runStart, seconds: secs(), duration: dur(secs()) },
  });
  // the best champion so far as a playable model while training runs (the final save overwrites it)
  const provisional = () => {
    const text = JSON.stringify(modelSpec(best.champ, best.trainingGames, `Provisional: the best champion so far of a training run in progress (curve point ${best.point + 1}, ${count(best.trainingGames)} games).`), null, 2) + "\n";
    fs.writeFileSync(path.join(dir, "model.json"), text);
    fs.mkdirSync(path.join(dir, "snapshots"), { recursive: true });
    fs.writeFileSync(path.join(dir, "snapshots", `point-${String(points).padStart(3, "0")}-${trainGames}-games.json`), text);
  };
  const score = (r: Parameters<typeof meanShare>[0]) => (CURVE_METRIC === "share" ? meanShare(r) : meanWin(r));

  const curvePoint = async () => {
    const avg = AVERAGE > 1 && past.length > 1 ? averageIn(SPACE, past.slice(-AVERAGE)) : null;
    const candidates = [{ w: champ, averaged: false }, ...(avg && JSON.stringify(avg) !== JSON.stringify(champ) ? [{ w: avg, averaged: true }] : [])];
    setPhase(`curve point ${points + 1} (vs panel${candidates.length > 1 ? ", champion and average" : ""})`, candidates.length * panel.length * CURVE_GAMES);
    const results = [];
    for (const c of candidates) results.push({ ...c, vs: await panelTest(panel, c.w, CURVE_GAMES, CURVE_SEED) });
    const top = results.reduce((a, b) => (score(b.vs) > score(a.vs) ? b : a));
    const s = score(top.vs);
    const improved = s > best.score + MIN_GAIN || best.score < 0;
    if (improved) best = { score: s, point: points, champ: top.w, round: rounds, trainingGames: trainGames, kept: accepted, averaged: top.averaged };
    const since = points - best.point;
    for (const r of results) {
      const row = { trainingGames: trainGames, round: rounds, kept: accepted, sigma, seconds: secs(), averaged: r.averaged, meanWinRate: Math.round(meanWin(r.vs) * 1000) / 1000, meanPointShare: Math.round(meanShare(r.vs) * 1000) / 1000, best: improved && r === top, vs: r.vs };
      fs.appendFileSync(curvePath, JSON.stringify(row) + "\n");
      console.log(`curve  ${count(trainGames).padStart(6)} games  round ${rounds}  ${accepted} kept  ${r.averaged ? "avg  " : "champ"} | ${panelLine(r.vs)}  ${improved && r === top ? "BEST" : ""}`);
    }
    console.log(`       ${improved ? "new best" : `best ${CURVE_METRIC === "share" ? `${(best.score * 100).toFixed(1)}% pts` : pct(best.score)} at point ${best.point + 1}, ${since}/${PATIENCE || "∞"} without gain`}  ${eta()}`);
    points++;
    nextCurve += CURVE_EVERY;
    curveAt = trainGames;
    if (PATIENCE && since >= PATIENCE) converged = true;
    save();
    provisional();
  };

  /** one map pair against league opponent `o`: the challenger's margin over the champion */
  const sample = async (o: (typeof league)[number], champ: AnyWeights, chall: AnyWeights, s: number) => {
    if (o.id === "self" || (o.id === "past" && past.length < 2)) {
      const p = await mapPair(champ, chall, s, "challenger vs champion");
      return { margin: p.margin, wins: p.wins, games: 2, share: p.share };
    }
    const opp = o.id === "past" ? past[Math.floor(Math.random() * (past.length - 1))] : o.w!;
    const label = o.id === "past" ? "past champions" : o.id;
    const [a, b] = await Promise.all([mapPair(opp, chall, s, `challenger vs ${label}`), mapPair(opp, champ, s)]);
    // both against the same opponent on the same map and seats: the difference in their shares
    return { margin: a.share - b.share, wins: a.wins, games: 4, share: 0.5 + (a.share - b.share) };
  };

  const sequentialTest = async (champ: AnyWeights, chall: AnyWeights): Promise<Test> => {
    setPhase(`testing challenger (at most ${MAX_GAMES} games)`);
    const margins: number[] = [];
    const results: number[] = [];
    let games = 0;
    let wins = 0;
    let shares = 0;
    let k = 0;
    for (;;) {
      const batch = await Promise.all(Array.from({ length: BATCH }, () => sample(league[k++ % league.length], champ, chall, seed++)));
      for (const b of batch) {
        margins.push(b.margin);
        results.push(b.wins / 2);
        games += b.games;
        wins += b.wins;
        shares += b.share;
      }
      const { verdict, llr } = TEST === "margin" ? marginVerdict(margins, M0, M1) : sprtVerdict(results, ELO0, ELO1);
      const { upper, lower } = sprtBounds();
      const meanMargin = margins.reduce((a, x) => a + x, 0) / margins.length;
      console.log(`    look: ${games} games, margin ${meanMargin >= 0 ? "+" : ""}${(meanMargin * 100).toFixed(2)} pts, won ${pct(wins / (margins.length * 2))}, LLR ${llr.toFixed(2)} (keep at ${upper.toFixed(2)}, reject at ${lower.toFixed(2)})`);
      const out = { games, wins: wins / (margins.length * 2), share: shares / margins.length, llr };
      if (verdict === "accept") return { ...out, keep: true };
      if (verdict === "reject") return { ...out, keep: false };
      if (games >= MAX_GAMES) return { ...out, keep: false, capped: true };
    }
  };
  const fixedTest = async (champ: AnyWeights, chall: AnyWeights): Promise<Test> => {
    setPhase(`testing challenger (${GAMES} games)`);
    const m = await match(champ, chall, GAMES, seed, "challenger vs champion");
    seed += Math.ceil(GAMES / 2);
    return { keep: m.share >= ACCEPT && m.wins >= 0.5, games: GAMES, wins: m.wins, share: m.share };
  };

  if (points === 0) await curvePoint();
  while (!converged && rounds < ROUNDS && (!BUDGET || trainGames < BUDGET)) {
    rounds++;
    // margin noise per 90 games, from the rounds so far (most challengers are no different)
    const noiseSd = Math.max(0.005, noise.w > 0 ? Math.sqrt(noise.y2 / noise.w) : 0.02);
    const prop = proposeChallenger(champ, sigma, credit, noiseSd, pendingMirror);
    const { next: chall, nudged } = prop;
    pendingMirror = null;
    const m = TEST === "fixed" ? await fixedTest(champ, chall) : await sequentialTest(champ, chall);
    trainGames += m.games;
    // learn from every round, kept or not: margin = the challenger's share above one half
    const margin = m.share - 0.5;
    const wt = m.games / 90;
    for (const [k, x] of Object.entries(prop.x)) {
      const c = (credit[k] ??= { xy: 0, xx: 0, n: 0 });
      c.xy += wt * x * margin;
      c.xx += wt * x * x;
      c.n++;
    }
    noise.w += 1;
    noise.y2 += wt * margin * margin;
    if (MIRROR && !m.keep && prop.source !== "mirror" && margin <= MIRROR_BELOW && Object.keys(prop.x).length) {
      pendingMirror = Object.fromEntries(Object.entries(prop.x).map(([k, x]) => [k, Math.exp(x)]));
    }
    fs.appendFileSync(
      roundsPath,
      JSON.stringify({ round: rounds, source: prop.source, x: prop.x, games: m.games, margin: Math.round(margin * 1e5) / 1e5, llr: m.llr, keep: m.keep, capped: !!m.capped, sigma, trainingGames: trainGames }) + "\n",
    );
    if (m.keep && CREDIT) {
      // the champion moved: older evidence describes the old champion, so weaken it
      for (const c of Object.values(credit)) {
        c.xy *= CREDIT_FORGET;
        c.xx *= CREDIT_FORGET;
      }
    }
    if (m.keep) {
      champ = chall;
      accepted++;
      past.push(champ);
      if (past.length > 50) past = past.slice(-50);
      sigma = Math.min(SIGMA, sigma * 1.25);
      sinceKeep = 0;
    } else if (++sinceKeep >= SIGMA_PATIENCE) {
      sigma = Math.max(SIGMA_MIN, sigma * SIGMA_DECAY);
      sinceKeep = 0;
    }
    if (m.capped) capped++;
    const done = BUDGET ? `${((trainGames / BUDGET) * 100).toFixed(1)}%` : `${count(trainGames)} games`;
    console.log(
      `round ${String(rounds).padStart(5)}  ${String(m.games).padStart(4)} games  won ${pct(m.wins).padStart(4)}  points ${(m.share * 100).toFixed(1)}%` +
        `${m.llr !== undefined ? `  LLR ${m.llr.toFixed(2).padStart(6)}` : ""}  ${m.keep ? "KEPT" : m.capped ? "cap " : "    "}  (${accepted} kept, sigma ${sigma.toFixed(2)}, ${done}, ${dur(secs())}, ${eta()})${m.keep ? `  ${nudged}` : ""}${(MIRROR || CREDIT) && m.keep ? `  [${prop.source}]` : ""}`,
    );
    while (milestone < MILESTONES.length && trainGames >= MILESTONES[milestone]) {
      saveMilestone(dir, MILESTONES[milestone], modelSpec(champ, trainGames, `Milestone: the champion of ${ID} after ${count(trainGames)} training games (round ${rounds}, ${accepted} kept).`));
      console.log(`milestone: saved the champion at ${count(trainGames)} games (models/${ID}/milestones/${MILESTONES[milestone]}-games.json)`);
      milestone++;
    }
    save();
    if (trainGames >= nextCurve) await curvePoint();
  }
  if (!converged && curveAt !== trainGames) await curvePoint();
  if (converged) console.log(`\nconverged: no gain of ${CURVE_METRIC === "share" ? `${(MIN_GAIN * 100).toFixed(1)} points of share` : pct(MIN_GAIN)} on the panel for ${PATIENCE} curve points; stopped at ${count(trainGames)} of ${BUDGET ? count(BUDGET) : "∞"} games`);
  const lastChamp = champ;
  champ = best.champ;
  if (champ !== lastChamp) console.log(`saving the ${best.averaged ? "averaged champion" : "champion"} of the best curve point (round ${best.round}, ${count(best.trainingGames)} games)`);

  setPhase("final test (vs panel)", panel.length * FINAL_GAMES);
  const final = await panelTest(panel, champ, FINAL_GAMES, FINAL_SEED);
  console.log(`\nfinal (${FINAL_GAMES} unseen games against each):`);
  for (const [id, v] of Object.entries(final)) {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    console.log(`  vs ${id.padEnd(16)} won ${pct(v.winRate).padStart(4)} ± ${(ci * 100).toFixed(0)}%  (${signed(eloFromScore(v.winRate, v.games))} Elo)  points ${(v.pointShare * 100).toFixed(1)}%`);
  }
  console.log(`changed: ${changesIn(SPACE, champ) || "nothing"}`);

  const strongest = panel[panel.length - 1]?.id;
  const spec = {
    id: ID,
    name: name(trainGames, false),
    kind: SPACE.kind,
    description:
      `${FULL ? `The full-action-space greedy bot (logic/engine/botFull.ts) with ${SPACE.knobs.length} knobs` : "The greedy bot with weights"} tuned by hill climbing (scripts/train-hill.ts --space ${SPACE.name}, ${TEST} test, opponents ${league.map((o) => o.id).join("+")}): ${rounds} challengers, ${count(trainGames)} training games in ${PLAYERS}-player ${MODE} on ${MAP_TYPE} ${SIZE}x${SIZE} maps${FROM ? `, fine-tuned from ${FROM}` : ""}, ${accepted} kept.` +
      (best.round !== rounds || best.averaged ? ` Saved the ${best.averaged ? "averaged champion" : "champion"} of the best learning-curve point (round ${best.round}, ${count(best.trainingGames)} games).` : "") +
      (final["greedy-v1"] ? ` Won ${pct(final["greedy-v1"].winRate)} against greedy-v1` : "") +
      (strongest && strongest !== "greedy-v1" ? ` and ${pct(final[strongest].winRate)} against ${strongest}` : "") +
      " on unseen maps at save time.",
    created: new Date().toISOString().slice(0, 10),
    [SPACE.field]: champ,
    training: {
      method: "hill-climbing",
      space: SPACE.name,
      knobs: SPACE.knobs.length,
      test: TEST,
      ...(TEST === "margin" ? { margin: { m0: M0, m1: M1, alpha: 0.05, beta: 0.05, mapPairsPerLook: BATCH, maxGames: MAX_GAMES } } : TEST === "sprt" ? { sprt: { elo0: ELO0, elo1: ELO1, alpha: 0.05, beta: 0.05, mapPairsPerLook: BATCH, maxGames: MAX_GAMES } } : { gamesPerRound: GAMES, acceptPointShare: ACCEPT }),
      league: league.map((o) => o.id),
      budget: BUDGET || undefined,
      rounds,
      trainingGames: trainGames,
      startedAt: runStart,
      endedAt: new Date().toISOString(),
      seconds: secs(),
      duration: dur(secs()),
      ...(FROM ? { totalSecondsIncludingFrom: secs() + (fromSeconds ?? 0), totalDurationIncludingFrom: dur(secs() + (fromSeconds ?? 0)) } : {}),
      sigma: { start: SIGMA, end: sigma, min: SIGMA_MIN, decay: SIGMA_DECAY, patience: SIGMA_PATIENCE },
      resumes: resumes.length ? resumes : undefined,
      weightsPerNudge: PICK,
      ...(MIRROR || CREDIT ? { learnFromLosses: { mirror: MIRROR ? { below: MIRROR_BELOW } : undefined, credit: CREDIT ? { prior: CREDIT_PRIOR, explore: CREDIT_EXPLORE, forget: CREDIT_FORGET } : undefined } } : {}),
      engine: "rust",
      mode: MODE,
      players: PLAYERS,
      mapType: MAP_TYPE,
      from: FROM || undefined,
      mapSize: SIZE,
      accepted,
      capped: TEST === "fixed" ? undefined : capped,
      curve: "curve.jsonl",
      milestones: MILESTONES.length ? MILESTONES : undefined,
      earlyStop: { metric: CURVE_METRIC, patience: PATIENCE, minGain: MIN_GAIN, converged, savedRound: best.round, savedAtTrainingGames: best.trainingGames, savedKept: best.kept, savedAveraged: best.averaged, savedCurveScore: Math.round(best.score * 1000) / 1000 },
      final,
      finalWinRateVsGreedyV1: final["greedy-v1"]?.winRate,
    },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  fs.rmSync(ckPath, { force: true });
  console.log(`saved models/${ID}/model.json and curve.jsonl`);
  console.log(`training took ${dur(secs())} (${runStart} to ${new Date().toISOString()}${resumed ? ", resumed" : ""})${FROM ? `; with ${FROM}'s own training ${dur(secs() + (fromSeconds ?? 0))} in total` : ""}`);
  closePool();
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
