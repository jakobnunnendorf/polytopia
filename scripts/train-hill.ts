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
 * Step size: --sigma (0.5) shrinks by --sigma-decay (0.85) after every --sigma-patience (20) rounds
 * without a kept challenger, down to --sigma-min (0.05), and grows by 1.25 on a keep, up to --sigma.
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
import { DEFAULT_WEIGHTS, type GreedyWeights } from "../logic/engine/bot";
import { eloFromScore, marginVerdict, sprtBounds, sprtVerdict } from "../logic/arena/sprt";
import {
  KNOBS,
  MAP_TYPE,
  MILESTONES,
  MODE,
  PLAYERS,
  SIZE,
  arg,
  averageWeights,
  changes,
  closePool,
  copyWeights,
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
  roundKnob,
  saveMilestone,
  setPhase,
  signed,
  startPool,
  startProgress,
  weightsOf,
} from "./lib/train-greedy";

const ID = arg("id", "greedy-hill-v1");
const BUDGET = Number(arg("budget", "0")); // training games in total; 0 = stop after --rounds
const ROUNDS = Number(arg("rounds", BUDGET ? "Infinity" : "60"));
const SIGMA = Number(arg("sigma", "0.5"));
const SIGMA_MIN = Number(arg("sigma-min", "0.05"));
const SIGMA_DECAY = Number(arg("sigma-decay", "0.85"));
const SIGMA_PATIENCE = Number(arg("sigma-patience", "20")); // rounds without a keep before sigma shrinks
const PICK = Number(arg("pick", "3")); // weights nudged per round
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
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;

type Best = { score: number; point: number; champ: GreedyWeights; round: number; trainingGames: number; kept: number; averaged: boolean };
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
  past: GreedyWeights[];
  milestone: number;
  best: Best;
  weights: GreedyWeights;
};

/** nudge PICK randomly chosen weights by e^(sigma N(0,1)); the rest stay as they are */
function mutate(w: GreedyWeights, sigma: number): { next: GreedyWeights; nudged: string } {
  const next = copyWeights(w);
  const keys = [...KNOBS].sort(() => Math.random() - 0.5).slice(0, PICK);
  for (const k of keys) (next as Record<string, unknown>)[k] = roundKnob(k, (w[k] as number) * Math.exp(sigma * normal()));
  return { next, nudged: keys.map((k) => `${k} ${w[k]}→${next[k]}`).join(", ") };
}

type Test = { keep: boolean; games: number; wins: number; share: number; llr?: number; capped?: boolean };

async function main() {
  startPool(WORKERS);
  startProgress();
  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const panel = loadPanel(PANEL_IDS);
  const league = LEAGUE.map((x) => (x === "self" || x === "past" ? { id: x, w: null } : { id: x, w: weightsOf(x) })).filter((o) => {
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
  const ckPath = path.join(dir, "checkpoint.json");
  const resumed: Checkpoint | null = RESUME ? (fs.existsSync(ckPath) ? JSON.parse(fs.readFileSync(ckPath, "utf8")) : null) : null;
  if (RESUME && !resumed) throw new Error(`--resume: no checkpoint at ${ckPath}`);
  if (resumed && resumed.args !== ARGS) console.log(`note: resuming with other options than the run was started with:\n  then: ${resumed.args}\n  now:  ${ARGS}`);
  if (!resumed) fs.writeFileSync(curvePath, "");
  const start = FROM ? weightsOf(FROM) : null;
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
  let champ: GreedyWeights = start ?? copyWeights(DEFAULT_WEIGHTS);
  console.log(`mode ${MODE}, ${PLAYERS} players (the two sides on alternate seats), ${MAP_TYPE} ${SIZE}x${SIZE}; ${FROM ? `fine-tuning from ${FROM}` : "starting from the greedy defaults"}`);

  let accepted = 0;
  let capped = 0;
  let trainGames = 0;
  let rounds = 0;
  let nextCurve = 0;
  let curveAt = -1; // training games at the last curve point
  let sigma = SIGMA;
  let sinceKeep = 0;
  let past: GreedyWeights[] = [champ]; // kept champions, newest last (for "past" and averaging)
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
      const leftMin = (BUDGET - trainGames) / perMin;
      return `ETA ~${new Date(Date.now() + leftMin * 60000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}, ~${dur(leftMin * 60)} left at most`;
    }
    const left = (s * (1 - done)) / done;
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
    seed = resumed.seed;
    console.log(`resumed at round ${rounds}, ${count(trainGames)} games, ${accepted} kept, ${points} curve points, ${dur(secondsBefore)} trained so far`);
  }
  const save = () => {
    const ck: Checkpoint = { args: ARGS, startedAt: runStart, seconds: secs(), savedAt: new Date().toISOString(), round: rounds, trainingGames: trainGames, accepted, capped, seed, nextCurve, curveAt, points, converged, sigma, sinceKeep, past, milestone, best, weights: champ };
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

  const name = (games: number, provisional: boolean) => `${ID.replace(/^greedy-hill-v(\d+)$/, "Hill climber v$1")}${provisional ? ` (training, ${count(games)} games)` : ""}`;
  const modelSpec = (w: GreedyWeights, games: number, note: string) => ({
    id: ID,
    name: name(games, true),
    kind: "greedy",
    description: note,
    created: new Date().toISOString().slice(0, 10),
    weights: w,
    training: { provisional: true, method: "hill-climbing", test: TEST, mode: MODE, players: PLAYERS, mapSize: SIZE, round: rounds, trainingGames: games, kept: accepted, startedAt: runStart, seconds: secs(), duration: dur(secs()) },
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
    const avg = AVERAGE > 1 && past.length > 1 ? averageWeights(past.slice(-AVERAGE)) : null;
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
  const sample = async (o: (typeof league)[number], champ: GreedyWeights, chall: GreedyWeights, s: number) => {
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

  const sequentialTest = async (champ: GreedyWeights, chall: GreedyWeights): Promise<Test> => {
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
  const fixedTest = async (champ: GreedyWeights, chall: GreedyWeights): Promise<Test> => {
    setPhase(`testing challenger (${GAMES} games)`);
    const m = await match(champ, chall, GAMES, seed, "challenger vs champion");
    seed += Math.ceil(GAMES / 2);
    return { keep: m.share >= ACCEPT && m.wins >= 0.5, games: GAMES, wins: m.wins, share: m.share };
  };

  if (points === 0) await curvePoint();
  while (!converged && rounds < ROUNDS && (!BUDGET || trainGames < BUDGET)) {
    rounds++;
    const { next: chall, nudged } = mutate(champ, sigma);
    const m = TEST === "fixed" ? await fixedTest(champ, chall) : await sequentialTest(champ, chall);
    trainGames += m.games;
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
        `${m.llr !== undefined ? `  LLR ${m.llr.toFixed(2).padStart(6)}` : ""}  ${m.keep ? "KEPT" : m.capped ? "cap " : "    "}  (${accepted} kept, sigma ${sigma.toFixed(2)}, ${done}, ${dur(secs())}, ${eta()})${m.keep ? `  ${nudged}` : ""}`,
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
  console.log(`changed: ${changes(champ) || "nothing"}`);

  const strongest = panel[panel.length - 1]?.id;
  const spec = {
    id: ID,
    name: name(trainGames, false),
    kind: "greedy",
    description:
      `The greedy bot with weights tuned by hill climbing (scripts/train-hill.ts, ${TEST} test, opponents ${league.map((o) => o.id).join("+")}): ${rounds} challengers, ${count(trainGames)} training games in ${PLAYERS}-player ${MODE} on ${MAP_TYPE} ${SIZE}x${SIZE} maps${FROM ? `, fine-tuned from ${FROM}` : ""}, ${accepted} kept.` +
      (best.round !== rounds || best.averaged ? ` Saved the ${best.averaged ? "averaged champion" : "champion"} of the best learning-curve point (round ${best.round}, ${count(best.trainingGames)} games).` : "") +
      (final["greedy-v1"] ? ` Won ${pct(final["greedy-v1"].winRate)} against greedy-v1` : "") +
      (strongest && strongest !== "greedy-v1" ? ` and ${pct(final[strongest].winRate)} against ${strongest}` : "") +
      " on unseen maps at save time.",
    created: new Date().toISOString().slice(0, 10),
    weights: champ,
    training: {
      method: "hill-climbing",
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
      weightsPerNudge: PICK,
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
