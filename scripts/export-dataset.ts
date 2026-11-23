/**
 * Turn recorded games into a training dataset (one JSON line per decision):
 *   { game, step, player, seat, obs: observe(state, player), legal: legalActions(state),
 *     action, actionIndex, finalScore, won }
 *
 *   npm run export-dataset -- --out data/datasets/all.jsonl [--only-humans]
 *
 * Observations are recomputed by replaying each record through the engine, so a
 * dataset always matches the current observe() channels.
 */
import fs from "node:fs";
import path from "node:path";
import { legalActions } from "../logic/engine/actions";
import { observe } from "../logic/engine/observe";
import { replayStates, seatKey } from "../logic/arena/record";
import { listGameFiles, readGame, ROOT } from "./lib/store";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const out = path.resolve(ROOT, arg("out", "data/datasets/all.jsonl"));
const onlyHumans = process.argv.includes("--only-humans");
fs.mkdirSync(path.dirname(out), { recursive: true });
const fd = fs.openSync(out, "w");
let rows = 0;
let games = 0;
for (const file of listGameFiles()) {
  const rec = readGame(file);
  if (!rec.result) continue;
  games++;
  const states = replayStates(rec);
  rec.steps.forEach(({ p, a }, k) => {
    const seat = rec.seats[p];
    if (onlyHumans && seat.kind !== "human") return;
    const s = states[k];
    const legal = legalActions(s);
    const key = JSON.stringify(a);
    fs.writeSync(
      fd,
      JSON.stringify({
        game: rec.id,
        step: k,
        player: p,
        seat: seatKey(seat),
        obs: observe(s, p),
        legal,
        action: a,
        actionIndex: legal.findIndex((x) => JSON.stringify(x) === key),
        finalScore: rec.result!.scores[p],
        won: rec.result!.winner === p,
      }) + "\n",
    );
    rows++;
  });
}
fs.closeSync(fd);
console.log(`${rows} decisions from ${games} games -> ${path.relative(ROOT, out)}`);
