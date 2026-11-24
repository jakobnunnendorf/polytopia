/**
 * Shared machinery for the greedy-weight trainers (train-hill.ts, train-es.ts).
 *
 * - play(): one whole game in the Rust engine, two sides of greedy weights on alternate seats
 * - a worker-thread pool (each worker loads this module and plays one game per message)
 * - progress lines every --progress-every seconds: the phase with its ETA, the results so far,
 *   the game rate and the whole run's ETA
 * - paired matches: every map played from both seats, scored on points (margin) and wins
 * - the held-out panel the learning curve and the final test play against
 *
 * Game options come from the command line (both trainers and their workers read the same argv):
 * --mode (domination), --players (4, even), --size (the game's suggestion), --map-type (drylands),
 * --max-moves (20000), --max-turns (150: a game still running then is decided on score).
 */
import fs from "node:fs";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { DEFAULT_WEIGHTS, type GreedyWeights } from "../../logic/engine/bot";
import { DEFAULT_FULL_WEIGHTS, fullWeights, type FullWeights } from "../../logic/engine/botFull";
import { mapSizeFor } from "../../logic/engine/state";
import { call } from "../../logic/engine/rust";
import type { GameMode } from "../../logic/engine/types";
import type { MapType } from "../../logic/engine/mapgen";
import { eloFromScore } from "../../logic/arena/sprt";

export function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

export const MODE = arg("mode", "domination") as GameMode;
export const PLAYERS = Number(arg("players", "4"));
if (PLAYERS < 2 || PLAYERS % 2 !== 0) throw new Error("--players must be even: the two sides take alternate seats");
export const SIZE = Number(arg("size", String(mapSizeFor(MODE, PLAYERS - 1) ?? 16)));
export const MAP_TYPE = arg("map-type", "drylands") as MapType;
export const MAX_MOVES = Number(arg("max-moves", "20000"));
export const MAX_TURNS = Number(arg("max-turns", "150"));

// weights a trainer may change; noise (tie-break randomness) stays fixed
export const KNOBS = (Object.keys(DEFAULT_WEIGHTS) as (keyof GreedyWeights)[]).filter((k) => k !== "noise" && k !== "rewards");
export const WHOLE = new Set<keyof GreedyWeights>(["richAt", "unitsPerCity"]);

export const copyWeights = (w: GreedyWeights): GreedyWeights => ({ ...w, rewards: { ...w.rewards } });

/** a knob value as models store it: whole numbers stay whole (at least 1), the rest 2 decimals */
export function roundKnob(k: keyof GreedyWeights, v: number): number {
  return WHOLE.has(k) ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100;
}

export function normal(): number {
  // Box-Muller
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

export type Result = { winner: number; scores: [number, number] };

/** a side's weights: the greedy bot's, or the full-action-space bot's (logic/engine/botFull.ts) */
export type AnyWeights = GreedyWeights | FullWeights;
export const isFull = (w: AnyWeights): w is FullWeights => "centre" in w && "greedy" in w;

/**
 * One free-for-all game of PLAYERS players. Side 0 (weights w0) takes the even seats, side 1 the odd
 * ones; every player still plays for itself. Returns the winning side and each side's total score.
 */
export function play(w0: AnyWeights, w1: AnyWeights, gameSeed: number, size = SIZE): Result {
  const sides = [w0, w1].map((w) => ({ kind: isFull(w) ? "full" : "greedy", weights: w }));
  const [s] = call<{ winner: number | null; scores: number[] }[]>("playGames", [
    {
      opts: { mapSize: size, players: PLAYERS, mode: MODE, seed: gameSeed, humans: [], mapType: MAP_TYPE },
      policies: Array.from({ length: PLAYERS }, (_, i) => sides[i % 2]),
      maxMoves: MAX_MOVES,
      maxTurns: MAX_TURNS,
    },
  ]);
  const scores: [number, number] = [0, 0];
  s.scores.forEach((v, i) => (scores[i % 2] += v));
  // unfinished (turn or move cap): the highest-scoring seat wins; a tie goes to the later seat
  let top = 0;
  s.scores.forEach((v, i) => v >= s.scores[top] && (top = i));
  return { winner: (s.winner ?? top) % 2, scores };
}

// ---------- worker pool ----------
export type Job = { w0: AnyWeights; w1: AnyWeights; seed: number; size: number };

class Pool {
  private idle: Worker[] = [];
  private queue: { job: Job; done: (r: Result) => void }[] = [];
  private all: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      // eval'd CommonJS so the TypeScript require hook (-r sucrase/register, inherited) loads this module
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

if (!isMainThread && workerData?.trainWorker) {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(play(j.w0, j.w1, j.seed, j.size)));
}

let pool: Pool | null = null;
export function startPool(workers: number) {
  pool = workers > 1 ? new Pool(workers) : null;
}
export function closePool() {
  pool?.close();
}

// ---------- progress ----------
export const PROGRESS_EVERY = Number(arg("progress-every", "60"));
export const progress = {
  phase: "starting",
  phaseGames: 0,
  phaseTotal: 0,
  phaseStart: Date.now(),
  // results so far in this phase: label -> [points share sum, games, wins]
  tally: {} as Record<string, [number, number, number]>,
  done: 0,
  lastDone: 0,
  startedAt: Date.now(),
  /** the whole run's state and ETA, set by the trainer */
  runEta: () => "",
};
export function setPhase(phase: string, total = 0) {
  progress.phase = phase;
  progress.phaseGames = 0;
  progress.phaseTotal = total;
  progress.phaseStart = Date.now();
  progress.tally = {};
}
let ticker: NodeJS.Timeout | null = null;
export function startProgress() {
  if (!isMainThread || PROGRESS_EVERY <= 0 || ticker) return;
  ticker = setInterval(() => {
    const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const recent = progress.done - progress.lastDone;
    progress.lastDone = progress.done;
    const mins = (Date.now() - progress.startedAt) / 60000;
    const phaseMin = (Date.now() - progress.phaseStart) / 60000;
    const of = progress.phaseTotal ? `/${progress.phaseTotal}` : "";
    const rate = progress.phaseGames / Math.max(phaseMin, 1e-9);
    const left = progress.phaseTotal - progress.phaseGames;
    const phaseEta = progress.phaseTotal && progress.phaseGames ? `, done in ~${Math.max(1, Math.ceil(left / Math.max(rate, 1e-9)))} min` : "";
    const results = Object.entries(progress.tally)
      .map(([label, [share, n, wins]]) => `${label} ${((share / n) * 100).toFixed(1)}% of points, won ${wins}/${n}`)
      .join("; ");
    console.log(
      `  [${now}] ${progress.phase}: ${progress.phaseGames}${of} games${phaseEta}` +
        (results ? ` | so far: ${results}` : "") +
        ` | ${recent} games in the last ${PROGRESS_EVERY}s, ${(progress.done / Math.max(mins, 1e-9)).toFixed(0)}/min overall | run: ${progress.runEta()}`,
    );
  }, PROGRESS_EVERY * 1000);
  ticker.unref();
}

/** play one game; `me` (the side we report on) and `label` add it to the phase's results so far */
export function runJob(job: Job, me?: number, label = ""): Promise<Result> {
  return (pool ? pool.run(job) : Promise.resolve(play(job.w0, job.w1, job.seed, job.size))).then((r) => {
    progress.done++;
    progress.phaseGames++;
    if (me !== undefined && label) {
      const t = (progress.tally[label] ??= [0, 0, 0]);
      const total = r.scores[0] + r.scores[1];
      t[0] += total ? r.scores[me] / total : 0.5;
      t[1]++;
      if (r.winner === me) t[2]++;
    }
    return r;
  });
}

/**
 * One map played from both seats: b against a. Returns b's margin (its share of all points over
 * the two games minus 0.5) and its wins (0, 1 or 2).
 */
export async function mapPair(a: AnyWeights, b: AnyWeights, mapSeed: number, label = ""): Promise<{ margin: number; wins: number; share: number }> {
  const [x, y] = await Promise.all([runJob({ w0: b, w1: a, seed: mapSeed, size: SIZE }, 0, label), runJob({ w0: a, w1: b, seed: mapSeed, size: SIZE }, 1, label)]);
  const mine = x.scores[0] + y.scores[1];
  const total = x.scores[0] + x.scores[1] + y.scores[0] + y.scores[1];
  const share = total ? mine / total : 0.5;
  return { margin: share - 0.5, share, wins: (x.winner === 0 ? 1 : 0) + (y.winner === 1 ? 1 : 0) };
}

/** b against a on games/2 map pairs from firstSeed on: b's win rate and share of all points */
export async function match(a: AnyWeights, b: AnyWeights, games: number, firstSeed: number, label = ""): Promise<{ wins: number; share: number }> {
  const pairs = await Promise.all(Array.from({ length: Math.ceil(games / 2) }, (_, i) => mapPair(a, b, firstSeed + i, label)));
  const n = pairs.length * 2;
  return { wins: pairs.reduce((s, p) => s + p.wins, 0) / n, share: pairs.reduce((s, p) => s + p.share, 0) / pairs.length };
}

// ---------- models and the panel ----------
export function weightsOf(id: string): GreedyWeights | null {
  if (id === "greedy-v1") return copyWeights(DEFAULT_WEIGHTS);
  const f = path.join(process.cwd(), "models", id, "model.json");
  if (!fs.existsSync(f)) return null;
  const spec = JSON.parse(fs.readFileSync(f, "utf8"));
  if (spec.kind !== "greedy" || !spec.weights) return null;
  return { ...DEFAULT_WEIGHTS, ...spec.weights, rewards: { ...DEFAULT_WEIGHTS.rewards, ...(spec.weights.rewards ?? {}) } };
}

/** a saved model of either kind: "greedy" (weights) or "greedy-full" (full), null for anything else */
export function anyWeightsOf(id: string): AnyWeights | null {
  const f = path.join(process.cwd(), "models", id, "model.json");
  if (id !== "greedy-v1" && fs.existsSync(f)) {
    const spec = JSON.parse(fs.readFileSync(f, "utf8"));
    if (spec.kind === "greedy-full" && spec.full) return fullWeights(spec.full);
  }
  return weightsOf(id);
}

export type Panel = { id: string; w: AnyWeights }[];
export type PanelResult = Record<string, { winRate: number; pointShare: number; games: number }>;

export function loadPanel(ids: string[]): Panel {
  return ids
    .map((id) => ({ id, w: anyWeightsOf(id) }))
    .filter((p): p is { id: string; w: AnyWeights } => {
      if (!p.w) console.log(`panel: skipping ${p.id} (no greedy or greedy-full model.json)`);
      return !!p.w;
    });
}

export const short = (id: string) => (id === "greedy-v1" ? "greedy" : id.replace(/^greedy-(hill|full|es)-/, (_, g) => (g === "hill" ? "" : `${g}-`)));

/** the champion against every panel opponent on the same held-out maps */
export async function panelTest(panel: Panel, champ: AnyWeights, games: number, firstSeed: number): Promise<PanelResult> {
  const res = await Promise.all(panel.map(async (p) => [p.id, await match(p.w, champ, games, firstSeed, `vs ${short(p.id)}`)] as const));
  return Object.fromEntries(res.map(([id, m]) => [id, { winRate: m.wins, pointShare: Math.round(m.share * 1000) / 1000, games }]));
}

// ---------- formatting ----------
export const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
export const signed = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x)}`;
export const meanWin = (r: PanelResult) => Object.values(r).reduce((a, v) => a + v.winRate, 0) / Math.max(1, Object.keys(r).length);
export const meanShare = (r: PanelResult) => Object.values(r).reduce((a, v) => a + v.pointShare, 0) / Math.max(1, Object.keys(r).length);
export const panelLine = (r: PanelResult) =>
  Object.entries(r)
    .map(([id, v]) => `${short(id)} ${pct(v.winRate)} won, ${(v.pointShare * 100).toFixed(1)}% pts (${signed(eloFromScore(v.winRate, v.games))})`)
    .join("  ") + `  | mean ${pct(meanWin(r))} won, ${(meanShare(r) * 100).toFixed(1)}% pts`;
export const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export const dur = (sec: number) => {
  const s = Math.round(sec);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

export function changes(w: GreedyWeights): string {
  return KNOBS.filter((k) => w[k] !== DEFAULT_WEIGHTS[k])
    .map((k) => `${k} ${DEFAULT_WEIGHTS[k]}→${w[k]}`)
    .join(", ");
}

/** the geometric mean of several weight sets, knob by knob (weights are scale-like) */
export function averageWeights(ws: GreedyWeights[]): GreedyWeights {
  const out = copyWeights(ws[ws.length - 1]);
  for (const k of KNOBS) {
    const logs = ws.map((w) => Math.log(Math.max(w[k] as number, 1e-6)));
    (out as Record<string, unknown>)[k] = roundKnob(k, Math.exp(logs.reduce((a, x) => a + x, 0) / logs.length));
  }
  return out;
}

// ---------- weight spaces: what a trainer tunes ----------
/**
 * A weight space: the knobs a trainer may change (dotted names), how to read and set them, the
 * defaults, how a --from model loads into it and how a model file stores it.
 *   greedy  the greedy bot's ~20 scoring weights (kind "greedy", stored under "weights")
 *   full    the full-action-space bot's ~200 knobs (kind "greedy-full", stored under "full"):
 *           its greedy part plus one multiplier and one "open" knob per action type, one weight per
 *           tech, unit, build/ability and city reward, and the centre pull. A greedy model given as
 *           --from becomes the greedy part on top of the full defaults.
 */
export type Space = {
  name: "greedy" | "full";
  kind: "greedy" | "greedy-full";
  field: "weights" | "full";
  knobs: string[];
  get(w: AnyWeights, k: string): number;
  set(w: AnyWeights, k: string, v: number): void;
  clone(w: AnyWeights): AnyWeights;
  defaults(): AnyWeights;
  load(id: string): AnyWeights | null;
  round(k: string, v: number): number;
};

const GREEDY_SPACE: Space = {
  name: "greedy",
  kind: "greedy",
  field: "weights",
  knobs: KNOBS as string[],
  get: (w, k) => (w as unknown as Record<string, number>)[k],
  set: (w, k, v) => ((w as unknown as Record<string, number>)[k] = v),
  clone: (w) => copyWeights(w as GreedyWeights),
  defaults: () => copyWeights(DEFAULT_WEIGHTS),
  load: weightsOf,
  round: (k, v) => roundKnob(k as keyof GreedyWeights, v),
};

type FullGroup = "greedy" | "type" | "open" | "tech" | "unit" | "build" | "reward";
const FULL_GROUPS: FullGroup[] = ["greedy", "type", "open", "tech", "unit", "build", "reward"];
const cloneFull = (w: FullWeights): FullWeights => ({
  greedy: copyWeights(w.greedy),
  type: { ...w.type },
  open: { ...w.open },
  tech: { ...w.tech },
  unit: { ...w.unit },
  build: { ...w.build },
  reward: { ...w.reward },
  centre: w.centre,
  defend: w.defend,
  defendRadius: w.defendRadius,
  techUse: w.techUse,
  techUseless: w.techUseless,
  front: w.front,
});
let fullSpace: Space | null = null;
function fullSpaceOf(): Space {
  // built on first use: DEFAULT_FULL_WEIGHTS comes from the Rust engine
  if (fullSpace) return fullSpace;
  const knobs = [
    // noise stays fixed; greedy.rewards are covered by the reward group
    ...FULL_GROUPS.flatMap((g) =>
      Object.keys(DEFAULT_FULL_WEIGHTS[g])
        .filter((k) => !(g === "greedy" && (k === "noise" || k === "rewards")))
        .map((k) => `${g}.${k}`),
    ),
    "centre",
    "defend",
    "defendRadius",
    "techUse",
    "techUseless",
    "front",
  ];
  const whole = new Set(["greedy.richAt", "greedy.unitsPerCity", "defendRadius"]);
  const SCALARS = new Set(["centre", "defend", "defendRadius", "techUse", "techUseless", "front"]);
  const get = (w: AnyWeights, k: string) => {
    const f = w as FullWeights;
    if (SCALARS.has(k)) return (f as unknown as Record<string, number>)[k];
    const [g, key] = k.split(".") as [FullGroup, string];
    return (f[g] as unknown as Record<string, number>)[key];
  };
  const set = (w: AnyWeights, k: string, v: number) => {
    const f = w as FullWeights;
    if (SCALARS.has(k)) (f as unknown as Record<string, number>)[k] = v;
    else {
      const [g, key] = k.split(".") as [FullGroup, string];
      (f[g] as unknown as Record<string, number>)[key] = v;
    }
  };
  fullSpace = {
    name: "full",
    kind: "greedy-full",
    field: "full",
    knobs,
    get,
    set,
    clone: (w) => cloneFull(w as FullWeights),
    defaults: () => cloneFull(DEFAULT_FULL_WEIGHTS),
    load: (id) => {
      const w = anyWeightsOf(id);
      if (!w) return null;
      return isFull(w) ? cloneFull(w) : { ...cloneFull(DEFAULT_FULL_WEIGHTS), greedy: copyWeights(w) };
    },
    round: (k, v) => (whole.has(k) ? Math.max(1, Math.round(v)) : Math.round(v * 1000) / 1000),
  };
  return fullSpace;
}

export const spaceOf = (name: string): Space => (name === "full" ? fullSpaceOf() : GREEDY_SPACE);

/** the knobs that differ from the space's defaults */
export function changesIn(space: Space, w: AnyWeights): string {
  const d = space.defaults();
  return space.knobs
    .filter((k) => space.get(w, k) !== space.get(d, k))
    .map((k) => `${k} ${space.get(d, k)}→${space.get(w, k)}`)
    .join(", ");
}

/** the geometric mean of several weight sets of one space, knob by knob (weights are scale-like) */
export function averageIn(space: Space, ws: AnyWeights[]): AnyWeights {
  const out = space.clone(ws[ws.length - 1]);
  for (const k of space.knobs) {
    const logs = ws.map((w) => Math.log(Math.max(space.get(w, k), 1e-6)));
    space.set(out, k, space.round(k, Math.exp(logs.reduce((a, x) => a + x, 0) / logs.length)));
  }
  return out;
}

/** milestones: --milestones 3600,36000 saves the champion when training passes each count */
export const MILESTONES = arg("milestones", "")
  .split(",")
  .map(Number)
  .filter((n) => n > 0)
  .sort((a, b) => a - b);

export function saveMilestone(dir: string, games: number, spec: object) {
  fs.mkdirSync(path.join(dir, "milestones"), { recursive: true });
  fs.writeFileSync(path.join(dir, "milestones", `${games}-games.json`), JSON.stringify(spec, null, 2) + "\n");
}
