/**
 * The simplest learning bot: hill climbing on the greedy bot's scoring weights.
 *
 * Each round makes a challenger by nudging a few weights of the champion
 * (each multiplied by e^(sigma * a random normal number)), lets the two play
 * a match on fresh maps from both seats, and keeps the challenger if it took
 * at least --accept of all points scored and won at least half the games.
 * The only feedback is the final score of each game.
 *
 *   npm run train-hill                                   # 60 rounds of 60 games, ~2-3 minutes
 *   npm run train-hill -- --rounds 200 --games 20 --id greedy-hill-v2
 *
 * Training games are not recorded and do not touch the Elo table. The result
 * is saved as models/<id>/model.json (kind "greedy"), so it appears in the
 * game's model list; rate it with
 *   npm run arena -- --models <id>,greedy-v1 --games 20
 */
import fs from "node:fs";
import path from "node:path";
import { applyAction } from "../logic/engine/actions";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "../logic/engine/bot";
import { createGame } from "../logic/engine/state";
import { scoreOf } from "../logic/engine";
import type { GameState } from "../logic/engine/types";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

const ROUNDS = Number(arg("rounds", "60"));
const GAMES = Number(arg("games", "60")); // per round; seats swap every game
const SIGMA = Number(arg("sigma", "0.5"));
const PICK = Number(arg("pick", "3")); // weights nudged per round
const ACCEPT = Number(arg("accept", "0.52")); // share of all points the challenger must take
const SIZE = Number(arg("size", "11"));
const ID = arg("id", "greedy-hill-v1");
const FINAL_GAMES = Number(arg("final", "100")); // games in the last test against greedy-v1
let seed = Number(arg("seed", "1000"));

// weights the climber may change; noise (tie-break randomness) stays fixed
const KNOBS = (Object.keys(DEFAULT_WEIGHTS) as (keyof GreedyWeights)[]).filter((k) => k !== "noise" && k !== "rewards");
const WHOLE = new Set<keyof GreedyWeights>(["richAt", "unitsPerCity"]);

function normal(): number {
  // Box-Muller
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

/** nudge PICK randomly chosen weights; the rest stay as they are */
function mutate(w: GreedyWeights): { next: GreedyWeights; nudged: string } {
  const next: GreedyWeights = { ...w, rewards: { ...w.rewards } };
  const keys = [...KNOBS].sort(() => Math.random() - 0.5).slice(0, PICK);
  for (const k of keys) {
    const v = (w[k] as number) * Math.exp(SIGMA * normal());
    (next as Record<string, unknown>)[k] = WHOLE.has(k) ? Math.max(1, Math.round(v)) : Math.round(v * 100) / 100;
  }
  return { next, nudged: keys.map((k) => `${k} ${w[k]}→${next[k]}`).join(", ") };
}

/** one 2-player game; returns the winner's seat and both scores */
function play(w0: GreedyWeights, w1: GreedyWeights, gameSeed: number): { winner: number; scores: [number, number] } {
  let s: GameState = createGame({ mapSize: SIZE, players: 2, mode: "perfection", seed: gameSeed, humans: [], mapType: "drylands" });
  const ws = [w0, w1];
  let moves = 0;
  while (!s.over && moves < 20000) {
    s = applyAction(s, botStep(s, ws[s.current]));
    moves++;
  }
  return { winner: s.winner ?? 0, scores: [scoreOf(s, 0), scoreOf(s, 1)] };
}

/** the challenger's share of wins and of all points over `games` games, each map played from both seats */
function match(champ: GreedyWeights, chall: GreedyWeights, games = GAMES): { wins: number; share: number } {
  let wins = 0;
  let mine = 0;
  let total = 0;
  for (let g = 0; g < games; g++) {
    const mapSeed = seed + Math.floor(g / 2);
    const challFirst = g % 2 === 0;
    const r = challFirst ? play(chall, champ, mapSeed) : play(champ, chall, mapSeed);
    const me = challFirst ? 0 : 1;
    if (r.winner === me) wins++;
    mine += r.scores[me];
    total += r.scores[0] + r.scores[1];
  }
  seed += Math.ceil(games / 2); // fresh maps every round
  return { wins: wins / games, share: total ? mine / total : 0.5 };
}

function changes(w: GreedyWeights): string {
  return KNOBS.filter((k) => w[k] !== DEFAULT_WEIGHTS[k])
    .map((k) => `${k} ${DEFAULT_WEIGHTS[k]}→${w[k]}`)
    .join(", ");
}

function main() {
  let champ: GreedyWeights = { ...DEFAULT_WEIGHTS, rewards: { ...DEFAULT_WEIGHTS.rewards } };
  let accepted = 0;
  const t0 = Date.now();
  for (let r = 1; r <= ROUNDS; r++) {
    const { next: chall, nudged } = mutate(champ);
    const m = match(champ, chall);
    const keep = m.share >= ACCEPT && m.wins >= 0.5;
    if (keep) {
      champ = chall;
      accepted++;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `round ${String(r).padStart(3)}/${ROUNDS}  won ${(m.wins * 100).toFixed(0).padStart(3)}%  points ${(m.share * 100).toFixed(1)}%  ${keep ? "KEPT" : "    "}  (${accepted} kept, ${secs}s)${keep ? `  ${nudged}` : ""}`,
    );
  }

  // final check: the champion against the original greedy bot on maps it never trained on
  seed = 900_000;
  const fm = match(DEFAULT_WEIGHTS, champ, FINAL_GAMES);
  const final = fm.wins;
  console.log(`\nfinal: ${ID} won ${(final * 100).toFixed(0)}% of ${FINAL_GAMES} fresh games against greedy-v1 and took ${(fm.share * 100).toFixed(1)}% of the points`);
  console.log(`changed: ${changes(champ) || "nothing"}`);

  const dir = path.join(process.cwd(), "models", ID);
  fs.mkdirSync(dir, { recursive: true });
  const spec = {
    id: ID,
    name: ID.replace(/^greedy-hill-v(\d+)$/, "Hill climber v$1"),
    kind: "greedy",
    description: `The greedy bot with weights tuned by hill climbing (scripts/train-hill.ts): ${ROUNDS} rounds of ${GAMES} self-play games on ${SIZE}x${SIZE} maps, ${accepted} challengers kept. Won ${(final * 100).toFixed(0)}% against greedy-v1 on unseen maps at save time.`,
    created: new Date().toISOString().slice(0, 10),
    weights: champ,
    training: { method: "hill-climbing", rounds: ROUNDS, gamesPerRound: GAMES, sigma: SIGMA, weightsPerNudge: PICK, acceptPointShare: ACCEPT, mapSize: SIZE, accepted, finalWinRateVsGreedyV1: final, finalPointShareVsGreedyV1: Math.round(fm.share * 1000) / 1000 },
  };
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(spec, null, 2) + "\n");
  console.log(`saved models/${ID}/model.json`);
}

main();
