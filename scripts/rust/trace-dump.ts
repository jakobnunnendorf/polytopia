/**
 * The TypeScript side of `polyengine dump`: replays corpus game <id> with the
 * TypeScript engine and prints the canonical state after step <k> (-1: the
 * initial state), or with --legal the legal actions before step k+1, or with
 * --log the game log. Diff it against the Rust output to find a divergence.
 *
 *   node -r sucrase/register scripts/rust/trace-dump.ts engine/corpus/smoke 12 340 > ts.txt
 *   cargo run --release -p polyengine -- dump engine/corpus/smoke 12 340 > rs.txt
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { applyAction, legalActions } from "../../logic/engine/actions";
import { createGame } from "../../logic/engine/state";
import { canon, canonState } from "./canon";

const [dir, idArg, kArg] = process.argv.slice(2);
const id = Number(idArg);
const k = Number(kArg);
let game: any = null;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl.gz"))) {
  for (const line of zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8").split("\n")) {
    if (!line) continue;
    const g = JSON.parse(line);
    if (g.spec.id === id) game = g;
  }
}
if (!game) throw new Error(`no game ${id} in ${dir}`);
let s = createGame(game.spec.opts);
for (const st of game.steps.slice(0, Math.max(0, k + 1))) s = applyAction(s, st[0]);
if (process.argv.includes("--legal")) console.log(canon(legalActions(s)));
else if (process.argv.includes("--log")) console.log(s.log.join("\n"));
else console.log(canonState(s));
