# Shardlands for reinforcement learning

The rules engine is Rust (`engine/core`), with no UI and no hidden randomness: the random
generator's state is part of the game state. A game is fully determined by its creation options
(including `seed`) plus the list of actions taken, so any game can be replayed exactly.

TypeScript reaches it through a thin typed facade in `logic/engine/` (the Node addon in scripts and
tests, WebAssembly in the browser); Python through the `polyengine` module (`engine/py`). The web
app, the bots, the tests and an RL agent all call the same functions, so an agent trains on exactly
the game you play.

## API

```ts
import { createGame, legalActions, applyAction, observe, playBotTurn, botStep, scoreOf } from "@/logic/engine";

let s = createGame({
  mapSize: 11,          // 11, 14, 16, 18, 20, 30 (wiki sizes)
  players: 2,           // 2..16
  mode: "perfection",   // or "domination"
  seed: 123,
  humans: [0],          // players NOT played by the built-in bot ([] = all bots)
  mapType: "drylands",  // drylands | lakes | continents | pangea | archipelago | waterworld
  clans: ["imperius", "bardur"], // optional; default random distinct clans
});

const actions = legalActions(s);   // every legal action for s.current
s = applyAction(s, actions[0]);    // returns a NEW state (input is not mutated)
const obs = observe(s, 0);          // what player 0 can know (fog of war applied)
```

| Function | Purpose |
|---|---|
| `createGame(opts)` | New game. Player 0 moves first, turn 0. |
| `legalActions(s)` | All actions the **current** player may take, as plain JSON objects. When a city has a pending level-up reward, only the two reward choices are legal. `[]` once `s.over`. |
| `applyAction(s, a)` | Next state. `a` must be one of `legalActions(s)`. `{type: "endTurn"}` passes play to the next player (and increments `s.turn` after the last one). |
| `observe(s, p)` | Observation for player `p` (below). |
| `botStep(s)` / `playBotTurn(s)` | The built-in greedy bot: one action, or a whole turn. Use as opponent or baseline. |
| `scoreOf(s, p)` | Score per docs/RULES.md §7.1 (the Perfection objective). |

Episode end: `s.over === true`; `s.winner` is the winning player id
(Perfection: highest score after turn 30; Domination: last player with a city).

### Actions

```ts
{ type: "endTurn" }
{ type: "research", tech }                 // e.g. "climbing"
{ type: "train", cityId, unit }            // e.g. "warrior"
{ type: "build", at: {x, y}, building }    // farm, port, road, harvestFruit, hunt, clearForest, temple, monuments, embassy, destroy, ...
{ type: "move", unitId, to: {x, y} }
{ type: "attack", unitId, targetId }
{ type: "capture" | "recover" | "examine" | "disband" | "promote" | "healOthers" | "harvestStarfish", unitId }
{ type: "infiltrate", unitId, cityId }
{ type: "upgrade", unitId, to }            // raft -> scout | rammer | bomber
{ type: "reward", cityId, reward }         // level-up choice
{ type: "offerPeace" | "acceptPeace" | "declinePeace" | "breakPeace", player }  // diplomacy (logic/engine/diplomacy.ts)
```

The action set is variable-sized and state-dependent. Two common ways to feed it
to a policy network:

1. **Masked fixed action space:** enumerate a fixed index space, for example
   `(unit or tile) × verb × target`, and mask out everything not in
   `legalActions(s)`.
2. **Scoring the candidates:** encode each legal action as a feature vector and
   let the network output one logit per candidate (pointer-network style). This
   is simpler with this API, because `legalActions` already gives you the
   candidates.

### Observation

`observe(s, p)` returns:

- `planes`: `channels.length × mapSize × mapSize` numbers, channel-major and
  row-major. The 42 channels for an 11×11 map are listed in `CHANNELS`
  (`logic/engine/observe.ts`):
  - explored
  - terrain (one-hot)
  - resources (one-hot)
  - building, road, village, ruin
  - own/enemy territory
  - own/enemy city level
  - own/enemy unit, HP fraction, can-act
  - unit type (one-hot)
- `scalars`: turn, max turns, stars, income, score, cities, owned techs (25 flags), tech costs (25), opponents alive, relations per player (1 peace, 0 neutral/self, -1 war, -2 hostile), pending peace offers to you per player.

Unexplored tiles are zero except for the `explored` plane. Hidden enemy units
(cloaks) appear only when they are adjacent to one of `p`'s units. This makes
the observation the honest "what a human sees" view. For a cheating oracle
critic, read `s` directly.

### Reward ideas

| Reward | Formula | Notes |
|---|---|---|
| Sparse | +1 win / −1 loss at `s.over` | Pure, but hard to learn from. |
| Score shaping | `scoreOf(s, p)` difference per own turn | Matches the Perfection objective; dense. |
| Economy shaping | Δ income, Δ cities | Teaches expansion early. Anneal it away later. |

## Headless runner

```bash
npm run simulate -- --games 20 --players 2 --size 11 --mode perfection
npm run simulate -- --games 5 --random      # player 0 plays uniformly random legal actions
```

It prints one JSON line per game (winner, scores, clans, observation shape) and
a summary with games per player won and actions per second. Every facade call crosses into Rust
with the whole state as JSON, so a per-action loop in Node is slow; for training use Python's
`VecEnv` or the bulk engine call `playGames` (`engine/api`, used by the trainers and the Elo tournament). The Rust engine itself plays 146,000 to 222,000 actions
per second on one thread (`engine/PROGRESS.md`).

### Using it from Python

`engine/py` builds the `polyengine` module (PyO3): `VecEnv` runs n games in Rust in parallel and
returns observation tensors, scalar features and legal-action lists per game, with the opponents
played by the greedy bot. Build, API and an example are in `engine/py/README.md`; the RL project's
value-function agent and `rl-gate` use it (`docs/rl-project/README.md`).

## Determinism and tests

- `__tests__/engine/simulate.test.ts`:
  - 200 bot-vs-bot games with mixed player counts, modes and map types finish with no errors.
  - A 1,500-step check that every bot action is in `legalActions` and that the invariants hold (one unit per tile, HP in range, stars never negative).
- `__tests__/engine/rules-data.test.ts` checks the numbers in docs/RULES.md: unit stats, the damage formula and rounding, and the tech cost table including Literacy.
- `__tests__/engine/mapgen.test.ts` checks determinism per seed, settlement spacing, the 48/38/14 land split, resource radius and ruin counts.

## Deviations from the rules (known simplifications)

- **Explorer** (§5.12): this engine walks toward the most unexplored
  surroundings, with RNG tie-breaks. docs/RULES.md describes the game's own
  3-pass breadth-first scoring.
- **Forced pushes** (§5.13): this engine pushes toward the last move direction
  or the map centre and tries the alternatives in the same ±45° order. The
  enemy-reversal rule is not modelled.
- **Map generation** (§6) is an approximation, like every community generator.
  - Lakes/Archipelago suburbs and pre-terrain villages are not modelled.
  - Continents/Pangea capitals are placed in quadrants, not converted from villages.
- **Bot difficulty** (Rust engine, `engine/core/src/data.rs`): a human seat's
  capital gets +1 star; a bot seat's capital gets the difficulty's bonus
  (Easy 0, Normal 1, Hard 2, Crazy 4), as in the real game. Which seats are
  human comes from `humans`; `humans: []` makes every seat a bot, so an RL
  learner should be listed there. The Python `VecEnv` and `rl-gate` always make
  the learner seat the only human seat.
- **Perfection result:** the raw score decides the winner; the difficulty
  multiplier is not applied.
