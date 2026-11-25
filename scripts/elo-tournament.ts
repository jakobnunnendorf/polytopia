/**
 * Elo tournament: a round robin of every bot model against every other, in every game mode, in the
 * Rust engine. Each pair plays the same map seeds in every mode, every map from both seatings (the
 * two models take alternate seats of a free-for-all, as in training). Ratings are fitted from all
 * games at once (scripts/lib/elo-fit.ts).
 *
 *   npm run elo-tournament                         # everything, into elo/<today>/
 *   npm run elo-tournament -- --out elo/2026-11-25 # resume a run: finished pairs are skipped
 *   npm run elo-tournament -- --report             # no games: refit ratings.json and README.md
 *   npm run elo-tournament -- --agents a,b,c --modes domination --games 40 --workers 5
 *
 * Writes into --out:
 *   results.jsonl  line 1 the run's meta (agents, setups, first seed), then one line per finished
 *                  pair in one mode with every game (appended as pairs finish; this is the resume state)
 *   progress.json  the live state the dashboard reads (rewritten every few seconds)
 *   ratings.json   the fit: per mode and overall, with intervals and the pairwise matrix
 *   README.md      the method and the ranking tables
 * Nothing under data/ is written. The dashboard: npm run elo-dashboard.
 *
 * Agents: every models/<id>/model.json of kind greedy, greedy-full or random. LLM-backed and
 * external agents are left out (they cost money or need a local server).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { call } from "../logic/engine/rust";
import { anyWeightsOf, arg, dur, isFull } from "./lib/train-greedy";
import { ANCHOR_ID, ANCHOR_RATING, fitAll, pairKey, parseResults, type Agent, type Fit, type GameRow, type Meta, type PairRow, type Ratings, type Setup } from "./lib/elo-fit";

/**
 * The setup per mode. 4 players on 16x16 drylands is what the models were trained on; a game still
 * running at maxTurns is decided on score (the highest-scoring seat wins).
 *   perfection  the engine ends it after 30 turns, highest score wins (16x16 is the mode's own size)
 *   glory       first to 10,000 points
 *   might       hold every capital
 *   domination  last player standing
 *   creative    domination's rules with free settings: here the big format, 8 players on 20x20
 * maxMoves is set far above what a game needs, so only the turn cap stops a game.
 */
const SETUPS: Record<string, Setup> = {
  perfection: { players: 4, size: 16, mapType: "drylands", maxTurns: 40, maxMoves: 1_000_000, turnLimit: 30, games: 200 },
  glory: { players: 4, size: 16, mapType: "drylands", maxTurns: 150, maxMoves: 1_000_000, games: 200 },
  might: { players: 4, size: 16, mapType: "drylands", maxTurns: 150, maxMoves: 1_000_000, games: 200 },
  domination: { players: 4, size: 16, mapType: "drylands", maxTurns: 150, maxMoves: 1_000_000, games: 200 },
  creative: { players: 8, size: 20, mapType: "drylands", maxTurns: 150, maxMoves: 1_000_000, games: 50 },
};
/**
 * Seconds per game on 5 workers, measured on 2026-11-25 with 15 agents (the big games are 18 times
 * a perfection game). Only their ratios are used, for the ETA of modes that have not started yet.
 */
const COST: Record<string, number> = { perfection: 0.0063, glory: 0.0066, might: 0.018, domination: 0.021, creative: 0.135 };

const today = () => new Date().toLocaleDateString("sv-SE");
const OUT = path.resolve(arg("out", path.join("elo", today())));
const WORKERS = Math.max(1, Number(arg("workers", "5")));
const MODES = arg("modes", Object.keys(SETUPS).join(",")).split(",").filter(Boolean);
const FIRST_SEED = Number(arg("seed", "1800000000")); // away from the trainers' seeds (1.0e9 curve, 1.5e9 final test)
const REPORT_ONLY = process.argv.includes("--report");
const RESULTS = path.join(OUT, "results.jsonl");
const PROGRESS = path.join(OUT, "progress.json");

type Policy = { kind: "greedy" | "full" | "random"; weights?: unknown };
type Job = { mode: string; setup: Setup; a: string; b: string; seed: number };

// ---------- the worker: one map, both seatings ----------
function playMap(policies: Record<string, Policy>, j: Job): GameRow[] {
  const { setup } = j;
  const specs = [0, 1].map((seating) => ({
    opts: { mapSize: setup.size, players: setup.players, mode: j.mode, seed: FIRST_SEED + j.seed, humans: [], mapType: setup.mapType, ...(setup.turnLimit ? { turnLimit: setup.turnLimit } : {}) },
    policies: Array.from({ length: setup.players }, (_, i) => policies[i % 2 === seating ? j.a : j.b]),
    maxMoves: setup.maxMoves,
    maxTurns: setup.maxTurns,
  }));
  const out = call<{ winner: number | null; over: boolean; turn: number; moves: number; scores: number[] }[]>("playGames", specs);
  return out.map((s, seating) => [j.seed, seating, s.winner ?? -1, s.over ? 1 : 0, s.turn, s.moves, ...s.scores]);
}

if (!isMainThread && workerData?.eloWorker) {
  parentPort!.on("message", (j: Job) => {
    try {
      parentPort!.postMessage({ rows: playMap(workerData.policies, j) });
    } catch (e) {
      parentPort!.postMessage({ error: String((e as Error).message ?? e) });
    }
  });
}

class Pool {
  private idle: Worker[] = [];
  private all: Worker[] = [];
  private queue: { job: Job; done: (r: GameRow[]) => void; fail: (e: Error) => void }[] = [];
  constructor(n: number, policies: Record<string, Policy>) {
    for (let i = 0; i < n; i++) {
      // eval'd CommonJS so the TypeScript require hook (-r sucrase/register, inherited) loads this file
      const w = new Worker(`require(${JSON.stringify(__filename)})`, { eval: true, workerData: { eloWorker: true, policies } });
      w.unref();
      this.all.push(w);
      this.idle.push(w);
    }
  }
  run(job: Job): Promise<GameRow[]> {
    return new Promise((done, fail) => {
      this.queue.push({ job, done, fail });
      this.pump();
    });
  }
  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, done, fail } = this.queue.shift()!;
      w.once("message", (m: { rows?: GameRow[]; error?: string }) => {
        this.idle.push(w);
        if (m.rows) done(m.rows);
        else fail(new Error(`${job.mode} ${job.a} vs ${job.b}, seed ${job.seed}: ${m.error}`));
        this.pump();
      });
      w.postMessage(job);
    }
  }
  close() {
    this.all.forEach((w) => w.terminate());
  }
}

// ---------- agents ----------
function loadAgents(): { agents: Agent[]; policies: Record<string, Policy>; excluded: Meta["excluded"] } {
  const dir = path.join(process.cwd(), "models");
  const only = arg("agents", "").split(",").filter(Boolean);
  const agents: Agent[] = [];
  const policies: Record<string, Policy> = {};
  const excluded: Meta["excluded"] = [];
  for (const id of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, id, "model.json");
    if (!fs.existsSync(f)) continue; // a measurement record (sweep, big-map test), not an agent
    const spec = JSON.parse(fs.readFileSync(f, "utf8"));
    if (only.length && !only.includes(id)) continue;
    if (spec.kind === "random") policies[id] = { kind: "random" };
    else if (spec.kind === "greedy" || spec.kind === "greedy-full") {
      const w = anyWeightsOf(id);
      if (!w) {
        excluded.push({ id, why: `kind ${spec.kind} without weights` });
        continue;
      }
      policies[id] = { kind: isFull(w) ? "full" : "greedy", weights: w };
    } else {
      excluded.push({ id, why: spec.kind === "llm" ? "LLM agent: needs a local model server" : spec.kind === "external" ? "external agent: every move is a paid model call" : `kind ${spec.kind}: the Rust engine cannot play it` });
      continue;
    }
    agents.push({ id, kind: spec.kind, name: spec.name, created: spec.created });
  }
  return { agents, policies, excluded };
}

/** every pair once, in round-robin rounds (circle method): each agent has played early in the run */
function roundRobin(ids: string[]): [string, string][] {
  const list: (string | null)[] = ids.length % 2 ? [...ids, null] : [...ids];
  const m = list.length;
  const out: [string, string][] = [];
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const x = list[i];
      const y = list[m - 1 - i];
      if (x && y) out.push(x < y ? [x, y] : [y, x]);
    }
    list.splice(1, 0, list.pop()!);
  }
  return out;
}

// ---------- the report ----------
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
function table(f: Fit, previous: Record<string, { rating: number }>): string {
  const head = "| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |\n|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|";
  const rows = f.ranking.map((r, i) => `| ${i + 1} | ${r.id} | ${r.wins ? r.rating : `at most ${r.rating}`} | ${r.wins ? `${r.lo} to ${r.hi}` : "never won"} | ${r.games} | ${pct(r.winRate)} | ${pct(r.pointShare)} | ${pct(r.finish)} | ${pct(r.outright)} | ${r.turns.toFixed(0)} | ${previous[r.id] ? Math.round(previous[r.id].rating) : ""} |`);
  return [head, ...rows].join("\n");
}

function previousRatings(): Record<string, { rating: number; lo?: number; hi?: number; games: number }> {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "ratings.json"), "utf8"));
    return Object.fromEntries(Object.entries(old).filter(([k]) => k.startsWith("model:")).map(([k, v]) => [k.slice(6), v])) as never;
  } catch {
    return {};
  }
}

function report(meta: Meta, rows: PairRow[], seconds?: number): Ratings {
  const ratings = fitAll(meta, rows);
  const previous = previousRatings();
  const setupLine = (m: string, s: Setup) => `| ${m} | ${s.players} | ${s.size}x${s.size} | ${s.mapType} | ${s.turnLimit ? `${s.turnLimit} (the mode's own end)` : s.maxTurns} | ${s.games} | ${ratings.modes[m]?.games ?? 0} |`;
  const modes = Object.keys(meta.modes).filter((m) => ratings.modes[m]);
  fs.writeFileSync(
    path.join(OUT, "ratings.json"),
    JSON.stringify({ at: new Date().toISOString(), anchor: { id: ANCHOR_ID, rating: ANCHOR_RATING }, firstSeed: meta.firstSeed, commit: meta.commit, seconds, agents: meta.agents, excluded: meta.excluded, setups: meta.modes, previous, overall: ratings.overall, modes: ratings.modes }, null, 1) + "\n",
  );
  const md = `# Elo tournament ${path.basename(OUT)}

Every bot model against every other, in every game mode, in the Rust engine. ${ratings.overall.games} games, ${meta.agents.length} agents${seconds ? `, ${dur(seconds)} on ${WORKERS} workers` : ""}. Made by \`scripts/elo-tournament.ts\`${meta.commit ? ` at commit ${meta.commit}` : ""}; reproduce with \`npm run elo-tournament -- --out <new folder>\` (the same seeds give the same games).

## Method

- Round robin: every pair of agents plays the same map seeds (${meta.firstSeed} upward) in every mode. Every map is played twice, the two models swapping seats. In a game the two models take alternate seats of a free-for-all and every seat plays for itself, as in training.
- Who won: the side of the seat the engine declares winner; a game still running at the turn cap goes to the side of the highest-scoring seat.
- Rating: Bradley-Terry maximum likelihood over all games of a mode at once, so the order of games does not matter. Elo scale (400 points = 10:1 odds), ${ANCHOR_ID} = ${ANCHOR_RATING} in every table (where data/ratings.json puts it), so a rating says how far an agent is from ${ANCHOR_ID} in that mode. "Overall" is one fit over the games of all modes, every mode counting the same (a game of a mode with fewer games per pair weighs more); its other columns are averaged the same way.
- Interval: 95%, from 1000 refits on map seeds drawn with replacement (all games on a map go in or out together), each centred on the mean of the learned agents.
- Points: the agent's share of all points in its games. Finish: the finish score of training (#124). Won by the mode's rule: games it won that ended by the mode's own rule (conquest in domination), not at the turn cap, as a share of all its games.
- An agent that never won is held at a finite rating only by the fit's prior (one virtual win and one virtual loss per agent, spread over the others); its rating is an upper bound and is marked "at most".

## Setup

| mode | players | map | map type | turn cap | games per pair | games played |
|---|--:|---|---|--:|--:|--:|
${Object.entries(meta.modes).map(([m, s]) => setupLine(m, s)).join("\n")}

Left out: ${meta.excluded.map((e) => `${e.id} (${e.why})`).join("; ") || "nobody"}.

## Rating by mode

Rating, with the place in that mode in brackets. Every column is its own fit with ${ANCHOR_ID} at ${ANCHOR_RATING}: compare places and gaps across columns, not levels.

| agent | overall | ${modes.join(" | ")} |
|---|--:|${modes.map(() => "--:|").join("")}
${ratings.overall.ranking.map((r) => `| ${r.id} | ${[ratings.overall, ...modes.map((m) => ratings.modes[m])].map((f) => { const k = f.ranking.findIndex((x) => x.id === r.id); return k < 0 ? "" : `${f.ranking[k].wins ? "" : "at most "}${f.ranking[k].rating} (${k + 1})`; }).join(" | ")} |`).join("\n")}

## Overall

${table(ratings.overall, previous)}

${modes.map((m) => `## ${m}\n\n${table(ratings.modes[m], previous)}`).join("\n\n")}

The last column is the rating in data/ratings.json when this run was made (mostly 2-player games on 11x11, another method of counting; see scripts/elo.ts). The pairwise results are in ratings.json (\`matrix\`) and on the dashboard (\`npm run elo-dashboard\`).
`;
  fs.writeFileSync(path.join(OUT, "README.md"), md);
  return ratings;
}

// ---------- the run ----------
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prior = fs.existsSync(RESULTS) ? parseResults(fs.readFileSync(RESULTS, "utf8")) : { meta: null, rows: [] };
  if (REPORT_ONLY) {
    if (!prior.meta) throw new Error(`${RESULTS}: no results to report on`);
    // the run's time, when it was played in one go
    let seconds: number | undefined;
    try {
      const p = JSON.parse(fs.readFileSync(PROGRESS, "utf8"));
      if (!p.running && p.playedThisRun >= p.games) seconds = p.seconds;
    } catch {
      // no progress file (it is not kept in git): the time of the last fit, if there is one
      try {
        seconds = JSON.parse(fs.readFileSync(path.join(OUT, "ratings.json"), "utf8")).seconds;
      } catch {
        // no earlier fit either: the time stays unknown
      }
    }
    const r = report(prior.meta, prior.rows, seconds);
    console.log(`refitted ${r.overall.games} games: ${path.join(OUT, "ratings.json")}, README.md`);
    return;
  }
  for (const m of MODES) if (!SETUPS[m]) throw new Error(`unknown mode ${m} (known: ${Object.keys(SETUPS).join(", ")})`);
  const { agents, policies, excluded } = loadAgents();
  if (agents.length < 2) throw new Error("fewer than two agents");
  const games = arg("games", "");
  const modes: Record<string, Setup> = Object.fromEntries(MODES.map((m) => [m, { ...SETUPS[m], games: Number(arg(`games-${m}`, games || String(SETUPS[m].games))) }]));
  let commit = "";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // not a git checkout
  }
  const meta: Meta = { start: true, at: new Date().toISOString(), firstSeed: FIRST_SEED, agents, modes, excluded, commit };
  if (prior.meta) {
    // a resumed run must play the same games: same seeds, and a mode's setup may not change
    if (prior.meta.firstSeed !== FIRST_SEED) throw new Error(`${RESULTS} was started with --seed ${prior.meta.firstSeed}; use another --out`);
    for (const [m, s] of Object.entries(modes)) {
      const old = prior.meta.modes[m];
      if (old && JSON.stringify({ ...old, games: 0 }) !== JSON.stringify({ ...s, games: 0 })) throw new Error(`${RESULTS}: the setup of ${m} differs from this run's; use another --out`);
    }
    // modes and agents of the earlier run stay in the meta, so its rows still count
    meta.modes = { ...prior.meta.modes, ...modes };
    meta.agents = [...agents, ...prior.meta.agents.filter((a) => !agents.some((x) => x.id === a.id))];
  }
  fs.appendFileSync(RESULTS, JSON.stringify(meta) + "\n");

  const done = new Set(prior.rows.filter((r) => r.games.length >= (modes[r.mode]?.games ?? Infinity)).map((r) => pairKey(r.mode, r.a, r.b)));
  const pairs = roundRobin(agents.map((a) => a.id));
  type Todo = { mode: string; a: string; b: string };
  const todo: Todo[] = MODES.flatMap((mode) => pairs.filter(([a, b]) => !done.has(pairKey(mode, a, b))).map(([a, b]) => ({ mode, a, b })));
  // per mode: pairs and games in all, done so far (earlier runs included), and this run's games and wall time
  const perMode = Object.fromEntries(
    MODES.map((m) => {
      const donePairs = pairs.length - todo.filter((t) => t.mode === m).length;
      return [m, { pairs: pairs.length, donePairs, games: pairs.length * modes[m].games, doneGames: donePairs * modes[m].games, played: 0, seconds: 0 }];
    }),
  );
  const skipped = MODES.length * pairs.length - todo.length;
  console.log(`elo tournament -> ${OUT}`);
  console.log(`${agents.length} agents: ${agents.map((a) => a.id).join(", ")}`);
  if (excluded.length) console.log(`left out: ${excluded.map((e) => `${e.id} (${e.why})`).join("; ")}`);
  for (const m of MODES) console.log(`  ${m.padEnd(11)} ${modes[m].players} players, ${modes[m].size}x${modes[m].size} ${modes[m].mapType}, turn cap ${modes[m].turnLimit ?? modes[m].maxTurns}, ${modes[m].games} games per pair`);
  console.log(`${pairs.length} pairs x ${MODES.length} modes = ${MODES.length * pairs.length} pairings, ${skipped} already done; ${WORKERS} workers`);

  const t0 = Date.now();
  let played = 0;
  let current = todo[0]?.mode ?? "";
  let modeSince = Date.now();
  const recent: [number, number][] = []; // [time, games played] samples for the rate
  const state = (running: boolean) => {
    const now = Date.now();
    recent.push([now, played]);
    while (recent.length > 2 && now - recent[0][0] > 120_000) recent.shift();
    const rate = recent.length > 1 ? ((played - recent[0][1]) / Math.max(1, now - recent[0][0])) * 60_000 : 0;
    // ETA: a mode's own pace once it has games, else its rough cost scaled by the modes measured so far
    const spent = (m: string) => perMode[m].seconds + (m === current ? (now - modeSince) / 1000 : 0);
    const paced = MODES.filter((m) => perMode[m].played >= 20);
    const perCost = paced.reduce((s, m) => s + spent(m) / perMode[m].played / COST[m], 0) / Math.max(1, paced.length);
    let eta = 0;
    for (const m of MODES) {
      const left = perMode[m].games - perMode[m].doneGames;
      if (left > 0) eta += left * (paced.includes(m) ? spent(m) / perMode[m].played : perCost * COST[m]);
    }
    return {
      pid: process.pid,
      running,
      out: OUT,
      startedAt: new Date(t0).toISOString(),
      updatedAt: new Date(now).toISOString(),
      seconds: Math.round((now - t0) / 1000),
      workers: WORKERS,
      agents: agents.length,
      pairs: MODES.length * pairs.length,
      donePairs: MODES.reduce((s, m) => s + perMode[m].donePairs, 0),
      games: MODES.reduce((s, m) => s + perMode[m].games, 0),
      doneGames: MODES.reduce((s, m) => s + perMode[m].doneGames, 0),
      playedThisRun: played,
      gamesPerMinute: Math.round(rate),
      etaSeconds: running && paced.length ? Math.round(eta) : null,
      current: running ? current : "",
      modes: Object.fromEntries(MODES.map((m) => [m, { pairs: perMode[m].pairs, donePairs: perMode[m].donePairs, games: perMode[m].games, doneGames: perMode[m].doneGames }])),
    };
  };
  const writeProgress = (running: boolean) => {
    const s = state(running);
    fs.writeFileSync(PROGRESS + ".tmp", JSON.stringify(s) + "\n");
    fs.renameSync(PROGRESS + ".tmp", PROGRESS);
    return s;
  };
  const beat = setInterval(() => writeProgress(true), 5000);
  const talk = setInterval(() => {
    const s = state(true);
    const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    console.log(`  [${now}] ${current}: ${perMode[current]?.donePairs}/${perMode[current]?.pairs} pairs | all: ${s.donePairs}/${s.pairs} pairs, ${s.doneGames}/${s.games} games, ${s.gamesPerMinute}/min${s.etaSeconds !== null ? `, about ${dur(s.etaSeconds)} left` : ""}`);
  }, 60_000);
  writeProgress(true);

  const pool = new Pool(WORKERS, policies);
  // a few pairs at a time: an interrupted run loses little, and pairs finish in order
  const AHEAD = Math.max(2, Math.ceil(WORKERS / 2));
  let next = 0;
  const runPair = async (t: Todo) => {
    const setup = modes[t.mode];
    const started = Date.now();
    const maps = await Promise.all(
      Array.from({ length: Math.ceil(setup.games / 2) }, (_, seed) =>
        pool.run({ mode: t.mode, setup, a: t.a, b: t.b, seed }).then((r) => {
          played += r.length;
          perMode[t.mode].doneGames += r.length;
          perMode[t.mode].played += r.length;
          return r;
        }),
      ),
    );
    const row: PairRow = { mode: t.mode, a: t.a, b: t.b, games: maps.flat(), seconds: Math.round((Date.now() - started) / 100) / 10, at: new Date().toISOString() };
    fs.appendFileSync(RESULTS, JSON.stringify(row) + "\n");
    perMode[t.mode].donePairs++;
  };
  const lane = async () => {
    while (next < todo.length) {
      const t = todo[next++];
      if (t.mode !== current) {
        perMode[current].seconds += (Date.now() - modeSince) / 1000;
        current = t.mode;
        modeSince = Date.now();
      }
      await runPair(t);
    }
  };
  await Promise.all(Array.from({ length: AHEAD }, lane));
  clearInterval(beat);
  clearInterval(talk);
  pool.close();

  const seconds = Math.round((Date.now() - t0) / 1000);
  const all = parseResults(fs.readFileSync(RESULTS, "utf8"));
  const earlier = prior.rows.length ? undefined : seconds; // a resumed run's time is not the whole run's
  const ratings = report(all.meta!, all.rows, earlier);
  writeProgress(false);
  console.log(`\n${played} games in ${dur(seconds)} (${Math.round((played / Math.max(1, seconds)) * 60)}/min)`);
  for (const [name, f] of [["overall", ratings.overall], ...Object.entries(ratings.modes)] as [string, Fit][]) {
    console.log(`\n${name} (${f.games} games)`);
    f.ranking.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.id.padEnd(28)} ${String(r.rating).padStart(5)}  ${(r.wins ? `${r.lo} to ${r.hi}` : "at most").padEnd(13)} won ${pct(r.winRate).padStart(6)}  points ${pct(r.pointShare).padStart(6)}`));
  }
  console.log(`\nwrote ${path.join(OUT, "ratings.json")} and README.md`);
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
