/**
 * Checks that the Rust bulk call playGames gives the same games as the
 * TypeScript loop in scripts/train-hill.ts / train-full.ts `play`:
 *   node -r sucrase/register scripts/rust/check-play-games.ts [games]
 * Uses the TypeScript engine as the oracle, so it runs only while
 * logic/engine/*.ts still holds the rules.
 */
import { applyAction } from "../../logic/engine/actions";
import { DEFAULT_WEIGHTS, botStep } from "../../logic/engine/bot";
import { DEFAULT_FULL_WEIGHTS, fullBotStep, fullWeights } from "../../logic/engine/botFull";
import { createGame, mapSizeFor, scoreOf } from "../../logic/engine/state";
import type { GameState } from "../../logic/engine/types";
import { call } from "../../logic/engine/rust";

const GAMES = Number(process.argv[2] ?? "12");
const PLAYERS = 4;
const MAX_MOVES = 20000;
const MAX_TURNS = 150;
const wild = fullWeights({ centre: 2, tech: { mathematics: 5 }, unit: { catapult: 4 } } as never);
const greedyB = { ...DEFAULT_WEIGHTS, move: DEFAULT_WEIGHTS.move * 1.7, noise: 0.3 };

type Pol = { kind: "greedy" | "full"; weights: unknown };
const tsStep = (s: GameState, p: Pol) => (p.kind === "full" ? fullBotStep(s, p.weights as never) : botStep(s, p.weights as never));

let same = 0;
for (let g = 0; g < GAMES; g++) {
  const policies: Pol[] = g % 2 === 0
    ? [{ kind: "greedy", weights: DEFAULT_WEIGHTS }, { kind: "greedy", weights: greedyB }]
    : [{ kind: "full", weights: DEFAULT_FULL_WEIGHTS }, { kind: "full", weights: wild }];
  const opts = { mapSize: mapSizeFor("domination", PLAYERS - 1) ?? undefined, players: PLAYERS, mode: "domination" as const, seed: 1000 + g, humans: [], mapType: "drylands" as const };
  let s = createGame(opts);
  let moves = 0;
  while (!s.over && moves < MAX_MOVES && s.turn < MAX_TURNS) {
    s = applyAction(s, tsStep(s, policies[s.current % 2]));
    moves++;
  }
  const ts = { winner: s.winner, turn: s.turn, moves, scores: s.players.map((p) => scoreOf(s, p.id)) };
  // seats alternate the two sides like the scripts: policies[current % 2]
  const [r] = call<{ winner: number | null; turn: number; moves: number; scores: number[] }[]>("playGames", [
    { opts, policies: [policies[0], policies[1], policies[0], policies[1]], maxMoves: MAX_MOVES, maxTurns: MAX_TURNS },
  ]);
  const rs = { winner: r.winner, turn: r.turn, moves: r.moves, scores: r.scores };
  const eq = JSON.stringify(ts) === JSON.stringify(rs);
  if (eq) same++;
  else console.log("DIFF", g, JSON.stringify(ts), JSON.stringify(rs));
}
console.log(JSON.stringify({ games: GAMES, identical: same }));
process.exit(same === GAMES ? 0 : 1);
