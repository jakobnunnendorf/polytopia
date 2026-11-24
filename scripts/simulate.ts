/**
 * Headless Shardlands runner: plays bot-vs-bot games with the engine and
 * prints one JSON line per game plus a summary. Also the template for an RL
 * loop: swap botStep() for your policy's choice among legalActions().
 *
 *   node -r sucrase/register scripts/simulate.ts --games 20 --players 2 --size 11 --mode perfection
 *   node -r sucrase/register scripts/simulate.ts --games 5 --random   # random legal actions for player 0
 */
import { createGame } from "../logic/engine/state";
import { applyAction, legalActions } from "../logic/engine/actions";
import { botStep } from "../logic/engine/bot";
import { observe } from "../logic/engine/observe";
import { scoreOf } from "../logic/engine/state";
import { call } from "../logic/engine/rust";
import type { GameMode, GameState } from "../logic/engine/types";
import type { MapType } from "../logic/engine/mapgen";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const games = Number(arg("games", "10"));
const players = Number(arg("players", "2"));
const size = Number(arg("size", "11"));
const mode = arg("mode", "perfection") as GameMode;
const mapType = arg("map", "drylands") as MapType;
const seed0 = Number(arg("seed", "1"));
const randomP0 = flag("random");

const wins = new Array(players).fill(0);
const t0 = Date.now();
let totalActions = 0;

/** a bot-only game in one call into the Rust engine (the step loop below, without the JSON per action) */
function playInRust(g: number): { s: GameState; actions: number } {
  const [r] = call<{ state: GameState; moves: number }[]>("playGames", [
    {
      opts: { mapSize: size, players, mode, seed: seed0 + g, humans: [], mapType },
      policies: [{ kind: "greedy", weights: null }],
      maxTurn: 60,
      maxMoves: Number.MAX_SAFE_INTEGER,
      returnState: true,
    },
  ]);
  return { s: r.state, actions: r.moves };
}

for (let g = 0; g < games; g++) {
  if (!randomP0) {
    const { s, actions } = playInRust(g);
    report(g, s, actions);
    continue;
  }
  let s = createGame({ mapSize: size, players, mode, seed: seed0 + g, humans: [], mapType });
  let actions = 0;
  // simple xorshift for the random policy, seeded per game
  let r = (seed0 + g) * 2654435761;
  const rand = () => {
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    return ((r >>> 0) % 1_000_000) / 1_000_000;
  };
  while (!s.over && s.turn <= 60) {
    let a;
    if (randomP0 && s.current === 0) {
      const legal = legalActions(s);
      a = legal[Math.floor(rand() * legal.length)];
    } else {
      a = botStep(s);
    }
    s = applyAction(s, a);
    actions++;
  }
  report(g, s, actions);
}

function report(g: number, s: GameState, actions: number) {
  totalActions += actions;
  if (s.winner !== null) wins[s.winner]++;
  const obs = observe(s, 0);
  console.log(
    JSON.stringify({
      game: g,
      seed: seed0 + g,
      turns: s.turn,
      winner: s.winner,
      actions,
      scores: s.players.map((p) => scoreOf(s, p.id)),
      clans: s.players.map((p) => p.clan),
      obsShape: [obs.channels.length, obs.mapSize, obs.mapSize],
    }),
  );
}
const secs = (Date.now() - t0) / 1000;
console.log(
  JSON.stringify({
    summary: true,
    games,
    wins,
    seconds: secs,
    actionsPerSecond: Math.round(totalActions / secs),
  }),
);
