# polyengine: the Rust engine for Python

A PyO3 extension module (crate `polypy`, module `polyengine`, abi3 for Python 3.9 and later)
with the engine/api JSON entry point and `VecEnv`, a vectorised reinforcement-learning
environment that runs n games in Rust, in parallel (rayon, GIL released).

## Build and test

```sh
engine/py/build.sh                       # cargo build --release -p polypy, copies the dylib to engine/py/polyengine.so
python3 -m venv engine/py/.venv && engine/py/.venv/bin/pip install numpy   # once
engine/py/.venv/bin/python engine/py/test_env.py
```

Import with `engine/py` on `sys.path` (`sys.path.insert(0, "engine/py"); import polyengine`).

## Module functions

- `call(name: str, args_json: str) -> str`: engine/api `call_json`. `name` is the TypeScript
  function name, `args_json` a JSON array of its arguments; returns `{"ok": value}` or
  `{"error": message}` as JSON text. Example: `call("createGame", '[{"mode":"perfection","players":2,"seed":1}]')`.
- `channels() -> list[str]`: observation plane names, in plane order (observe.ts CHANNELS).
- `scalar_names(players: int) -> list[str]`: the scalar feature names in `VecEnv.scalars()` order:
  `turn, max_turns, stars, income, score, cities, opponents_alive`, then `tech:<id>` for every tech
  (1 if researched), `tech_cost:<id>` for every tech, `relation:<p>` for every player
  (self 0, peace 1, neutral 0, war -1, hostile -2), `peace_offer:<p>` (1 if p offers peace to the learner).

## VecEnv

```python
VecEnv(n, options_json, seed, learner=0, opponent_weights_json=None, max_turns=None, shaping=False)
```

- `options_json`: state.ts NewGameOptions as JSON, without `seed`, e.g.
  `{"mode":"perfection","mapSize":11,"players":2,"mapType":"drylands","difficulty":"crazy"}`.
  Its `humans` field is ignored: VecEnv always sets `humans` to `[learner]` (since 25 Nov 2026), so
  the learner seat is the game's only human seat, as in the real app. It gets the human capital
  income (+1 star) instead of the difficulty's bot bonus (Easy 0, Normal 1, Hard 2, Crazy 4), and the
  engine ends the game when the learner is eliminated. Before, `"humans":[]` gave the learner the
  bot bonus too.
- Seeds: env `i`'s `k`-th episode uses `seed + i + n*k` (so env 0's first game is `seed`, all
  episodes differ, and everything is deterministic for a fixed seed and choices). A game that
  ends before the learner's first move is skipped (the next seed is used).
- The learner plays player `learner` (the human seat); every other player is the greedy bot (`bot_step` with
  `opponent_weights_json`, GreedyWeights JSON, default weights if None) until it is the learner's
  turn again or the episode ends.
- An episode ends when the game is over, the learner is eliminated, or (with `max_turns`) the
  round counter `turn` reaches `max_turns`.
- Reward per step: +1 when the game is over with the learner as winner, -1 when it is over with
  another winner or the learner is eliminated, else 0; with `shaping=True` plus
  (learner score after the step and the opponents' moves - before) / 1000.

Methods and properties:

- `reset() -> bytes`: restarts every env at episode 0; float32 little-endian observations of the
  learner, `np.frombuffer(b, np.float32).reshape(n, C, N, N)` (C = `num_channels`, N = `map_size`).
- `obs() -> bytes`: the current observations (same layout) without stepping.
- `scalars() -> bytes`: float32 `(n, S)` of the current observations' scalars (S = `num_scalars`,
  order `scalar_names()`).
- `legal_actions(i) -> list[str]`: env i's legal actions as JSON strings, in engine order
  (types.ts Action shape); `legal_counts() -> list[int]`.
- `step(choices: list[int]) -> (obs: bytes, rewards: list[float], dones: list[bool])`: env i applies
  its learner's legal action number `choices[i]`, the opponents play, finished envs auto-reset (the
  returned obs is then the new episode's first observation and done is True).
- `bot_choices() -> list[int]`: the greedy bot's choice (default weights) for the learner in each
  env, as an index into its legal list (a baseline or imitation target).
- `state_json(i) -> str`: env i's current state (types.ts GameState JSON).
- `terminal_state_json(i) -> str | None`: the state env i's previous episode ended in.
- `episode_seed(i) -> int`: the seed of env i's current episode.
- Properties: `n`, `map_size`, `num_channels`, `num_scalars`, `players`; `scalar_names()`.

All envs share one options object, so they share map size and player count. An opponent turn is
cut off with endTurn after 5000 actions (a safety net the bot never reaches).
