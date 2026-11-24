# Shardlands for reinforcement learning

The game engine in `logic/engine/` is pure TypeScript with no UI and no
`Math.random`: the random generator's state is part of the game state. A game is
fully determined by its creation options (including `seed`) plus the list of
actions taken, so any game can be replayed exactly.

The phone UI, the bots, the tests and an RL agent all use the same three
functions, so an agent trains on exactly the game you play.

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
| `scoreOf(s, p)` | Score per RULES.md §7.1 (the Perfection objective). |

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
a summary with games per player won and actions per second. On the dev Mac it
reaches about 6,000 actions per second on an 11×11 map in one Node process.
`scripts/simulate.ts` is also the template for a training loop: replace
`botStep(s)` with your policy.

### Using it from Python

The engine is TypeScript. Three ways to drive it from a Python RL stack
(Gymnasium, PettingZoo, PyTorch):

1. **Subprocess with JSON lines (simplest).** A small Node server reads
   `{"cmd": "reset" | "step", ...}` on stdin and writes the observation, legal
   actions, reward and done flag on stdout. Python wraps it in a
   `gymnasium.Env`. Run one process per environment for parallelism.
2. **Batch in Node.** Roll out many games in Node, write trajectories to disk
   (`.jsonl` or `.npz`), and train offline in Python. Good for
   imitation learning from the greedy bot.
3. **Port the engine.** The rules are about 1,500 lines with no dependencies.
   A port to Python, Rust or JAX, cross-checked against this engine with the
   seeded simulation tests, gives the throughput needed for large-scale
   self-play.

## Determinism and tests

- `__tests__/engine/simulate.test.ts`:
  - 200 bot-vs-bot games with mixed player counts, modes and map types finish with no errors.
  - A 1,500-step check that every bot action is in `legalActions` and that the invariants hold (one unit per tile, HP in range, stars never negative).
- `__tests__/engine/rules-data.test.ts` checks the numbers in RULES.md: unit stats, the damage formula and rounding, and the tech cost table including Literacy.
- `__tests__/engine/mapgen.test.ts` checks determinism per seed, settlement spacing, the 48/38/14 land split, resource radius and ruin counts.

## Deviations from RULES.md (known simplifications)

- **Peace treaties** (§5.14) are not implemented, so players are always at war.
  The rest of Diplomacy is: Cloak, Embassy and Capital Vision.
- **Explorer** (§5.12): this engine walks toward the most unexplored
  surroundings, with RNG tie-breaks. RULES.md describes the game's own
  3-pass breadth-first scoring.
- **Forced pushes** (§5.13): this engine pushes toward the last move direction
  or the map centre and tries the alternatives in the same ±45° order. The
  enemy-reversal rule is not modelled.
- **Map generation** (§6) is an approximation, like every community generator.
  - Lakes/Archipelago suburbs and pre-terrain villages are not modelled.
  - Continents/Pangea capitals are placed in quadrants, not converted from villages.
- **Bot difficulty:** every capital gets the +1 bonus of Normal difficulty and
  human players. Easy, Hard and Crazy bonuses are not modelled.
- **Perfection result:** the raw score decides the winner; the difficulty
  multiplier is not applied.
