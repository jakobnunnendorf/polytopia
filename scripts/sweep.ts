/**
 * Strength sweep: measures one mechanism at a few hand-set strengths, with no training in between.
 * Every point is the base model plus the given knob values; it plays the fixed panel on the same
 * held-out maps as train-hill's curve points (--games each), so "point at 0 games" of any training
 * run is directly comparable. The best point (mean share of points) then plays the final test
 * (--final unseen games against each panel model, the same maps as train-hill's final test) and,
 * with --id, is saved as models/<id>/model.json. With --id, models/<id>/sweep.jsonl gets one row
 * per point as soon as it is measured (then one "final" row), so the training dashboard shows
 * the sweep live.
 *
 *   npm run sweep -- --id greedy-full-front --from greedy-full-v1 --knob front --values 0.5,1,2,4
 *   npm run sweep -- --from greedy-full-v1 --points "techUse=0.3,techUseless=2|techUse=1,techUseless=5"
 *
 * The base itself (no change) is always measured first, on the same maps.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { eloFromScore } from "../logic/arena/sprt";
import {
  MODE,
  PLAYERS,
  SIZE,
  arg,
  type AnyWeights,
  closePool,
  dur,
  loadPanel,
  meanShare,
  meanFinish,
  meanMetric,
  METRIC,
  meanWin,
  panelLine,
  panelTest,
  pct,
  signed,
  startPool,
  startProgress,
  setPhase,
  spaceOf,
  type PanelResult,
} from "./lib/train-greedy";

const SPACE = spaceOf("full");
const FROM = arg("from", "greedy-full-v1");
const ID = arg("id", "");
const KNOB = arg("knob", "");
const VALUES = arg("values", "").split(",").filter(Boolean).map(Number);
const POINTS: [string, number][][] = KNOB
  ? VALUES.map((v) => [[KNOB, v]])
  : arg("points", "")
      .split("|")
      .filter(Boolean)
      .map((p) => p.split(",").map((kv) => [kv.split("=")[0].trim(), Number(kv.split("=")[1])] as [string, number]));
const PANEL_IDS = arg("panel", "greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4,greedy-full-v1").split(",").filter(Boolean);
const GAMES = Number(arg("games", "200")); // per panel opponent and point
const FINAL_GAMES = Number(arg("final", "400"));
const WORKERS = Number(arg("workers", String(Math.max(1, os.cpus().length - 2))));
// the seeds of train-hill's curve points and final test: same maps, comparable numbers
const CURVE_SEED = 1_000_000_000;
const FINAL_SEED = 1_500_000_000;

const label = (p: [string, number][]) => (p.length ? p.map(([k, v]) => `${k}=${v}`).join(",") : "base");

async function main() {
  // no points: measure the base alone (its panel row and its final test)
  const base = SPACE.load(FROM);
  if (!base) throw new Error(`--from ${FROM}: no greedy-full model`);
  for (const [k] of POINTS.flat()) if (!SPACE.knobs.includes(k)) throw new Error(`unknown knob ${k} (names as in KEPT lines, e.g. front, unit.giant)`);
  startPool(WORKERS);
  startProgress();
  const t0 = Date.now();
  const panel = loadPanel(PANEL_IDS);
  console.log(`sweep from ${FROM}: ${POINTS.length} points + base, ${GAMES} games against each of ${panel.map((p) => p.id).join(", ")}`);

  const dir = ID ? path.join(process.cwd(), "models", ID) : "";
  const sweepFile = ID ? path.join(dir, "sweep.jsonl") : "";
  const write = (row: object) => ID && fs.appendFileSync(sweepFile, JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n");
  if (ID) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sweepFile, "");
    write({ start: true, from: FROM, points: ["base", ...POINTS.map(label)], panel: panel.map((p) => p.id), games: GAMES, final: FINAL_GAMES });
  }
  const rows: { point: string; values: Record<string, number>; w: AnyWeights; vs: PanelResult }[] = [];
  for (const p of [[], ...POINTS] as [string, number][][]) {
    const w = SPACE.clone(base);
    for (const [k, v] of p) SPACE.set(w, k, v);
    setPhase(`point ${label(p)}`, panel.length * GAMES);
    const vs = await panelTest(panel, w, GAMES, CURVE_SEED);
    rows.push({ point: label(p), values: Object.fromEntries(p), w, vs });
    write({ point: label(p), values: Object.fromEntries(p), meanShare: meanShare(vs), meanWin: meanWin(vs), meanFinish: meanFinish(vs), vs });
    console.log(`point  ${label(p).padEnd(28)} | ${panelLine(vs)}`);
  }
  // ranked by --metric (share: points; finish: the finish score of #124)
  const best = rows.length > 1 ? rows.slice(1).reduce((a, r) => (meanMetric(r.vs) > meanMetric(a.vs) ? r : a)) : rows[0];
  const unit = METRIC === "finish" ? "finish" : "pts";
  console.log(`\nbest: ${best.point}, mean ${(meanMetric(best.vs) * 100).toFixed(1)}% ${unit} (base ${(meanMetric(rows[0].vs) * 100).toFixed(1)}%)`);

  setPhase("final test (vs panel)", panel.length * FINAL_GAMES);
  const final = await panelTest(panel, best.w, FINAL_GAMES, FINAL_SEED);
  console.log(`\nfinal (${FINAL_GAMES} unseen games against each):`);
  for (const [id, v] of Object.entries(final)) {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    console.log(`  vs ${id.padEnd(16)} won ${pct(v.winRate).padStart(4)} ± ${(ci * 100).toFixed(0)}%  (${signed(eloFromScore(v.winRate, v.games))} Elo)  points ${(v.pointShare * 100).toFixed(1)}%  finish ${((v.finish ?? 0.5) * 100).toFixed(1)}%  conquest ${pct(v.conquest ?? 0)}  ${(v.turns ?? 0).toFixed(0)} turns`);
  }
  console.log(`changed against ${FROM}: ${best.point}`);
  write({ final: true, point: best.point, games: FINAL_GAMES, meanShare: meanShare(final), meanWin: meanWin(final), meanFinish: meanFinish(final), vs: final });

  if (ID) {
    const spec = {
      id: ID,
      name: `${FROM} + ${best.point}`,
      kind: SPACE.kind,
      description: `${FROM} with ${best.point}, the best of a strength sweep (${rows.length - 1} points, ${GAMES} games against each panel model). Not trained further.`,
      created: new Date().toISOString().slice(0, 10),
      [SPACE.field]: best.w,
      training: { method: "strength-sweep", from: FROM, points: rows.map((r) => r.point), chosen: best.point, gamesPerPoint: GAMES, panel: PANEL_IDS, mode: MODE, players: PLAYERS, mapSize: SIZE, seconds: Math.round((Date.now() - t0) / 1000), final, sweep: "sweep.jsonl" },
    };
    fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
    console.log(`saved models/${ID}/model.json and sweep.jsonl`);
  }
  console.log(`sweep took ${dur((Date.now() - t0) / 1000)}`);
  closePool();
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
