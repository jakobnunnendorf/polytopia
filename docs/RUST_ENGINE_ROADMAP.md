# Rust engine migration roadmap

Plan for moving the game engine (`logic/engine`, about 5,900 lines of
TypeScript) to Rust. Written for an agent that runs the migration to
completion on its own. It fixes the decisions and the gates; the details are
yours to work out. Read `docs/RULES_PARITY.md` and `logic/engine/types.ts`
first.

## Why

The main purpose of this project is reinforcement learning; the Expo app only
lets Jakob look at and play the results. Self-play speed is the limit today.
Baseline on 2026-11-24 (commit ac513d0, Node 25.9, Apple M3 Pro, one thread,
`npm run simulate -- --games 40 --players 2 --size 11`): about 1,760 actions
per second. `botStep` takes 78% of the time, `legalActions` 50%,
`applyAction` 11%. Re-measure at the start; the engine has changed since.

## Definition of done

All of these hold on the migration branch, each checked by a command that
exits non-zero on failure:

1. **Same rules.** For a corpus of at least 2,000 games (every tribe, every
   mode, every map type, 2 to the maximum number of players, random and greedy
   policies), the Rust engine gives the same legal actions in the same order
   and the same state after every action as the TypeScript engine.
2. **Existing tests pass on Rust.** The whole jest suite (`npm run test:ci`)
   passes with the engine facade backed by Rust.
3. **Fast.** Single-thread greedy self-play on 11x11 reaches at least 50 times
   the re-measured TypeScript baseline. Stretch: 200 times.
4. **Training runs on it.** `train-hill`, `arena`, `elo`, `simulate` and
   `export-dataset` run on the Rust engine, and a fixed seed gives the same
   winners and scores as before.
5. **Python can train on it.** A Python package exposes a batched environment
   (reset, step, observation tensor, legal-action mask) with a smoke test.
6. **The app works.** The web app plays, replays (`app/analyse.tsx`) and shows
   arena games on the Rust engine.
7. **One engine.** The TypeScript rules code is deleted; only a thin typed
   facade remains.

## Decisions already made

- **Language: Rust.** Safe Rust by default. `unsafe` only in hot loops, only
  after a profile shows the check costs something, each with a comment that
  says why it is sound.
- **The TypeScript engine is the oracle,** pinned at one commit at the start.
  Do not change rules during the migration. A bug found in the oracle is
  recorded in `docs/RULES_PARITY.md` and ported as it is; fix it afterwards.
  If `main` gains rule changes, rebase, re-pin and regenerate the corpus.
- **Bit-exact randomness.** Port `rng.ts` (mulberry32, 32-bit wrapping
  arithmetic) exactly, so a seed gives the same map tile for tile and recorded
  games in `data/games` replay unchanged.
- **One source of rules data.** Units, techs, buildings and tribes are
  exported once from `data.ts` to a data file that the Rust build turns into
  enums and tables. No hand-copied tables.
- **A facade keeps the app's API.** `logic/engine/index.ts` and the other
  modules the app imports keep their function names and types and forward to
  Rust. In the browser the engine is WebAssembly, whose calls are synchronous,
  so no screen needs to become asynchronous. In Node the same facade loads the
  native addon. A native phone build is out of scope: Hermes has no
  WebAssembly. Check how Jakob runs the app before relying on this; if he uses
  a phone build, serve the engine from `scripts/arena-server.ts` instead.
- **State stays plain data** that converts to and from the current JSON shape
  of `GameState`, so saved games, the dataset export and the app keep working.

## Architecture

A Cargo workspace in `engine/`:

| Crate | Purpose |
| --- | --- |
| `core` | Rules, state, map generation, legal actions, observation. No I/O, no allocation in the hot path. |
| `bots` | Greedy policy and scoring, ported exactly. |
| `cli` | Self-play, benchmark, trace replay. Parallel over games with rayon. |
| `node` | Node addon (napi-rs) for the scripts and jest. |
| `wasm` | WebAssembly build (wasm-bindgen) for the web app. |
| `py` | Python module (PyO3, maturin) with the batched environment. |

Design the core for speed from the start, not as a line-by-line port:

- Integer ids everywhere (enums for unit, tech, building, tribe, terrain); no
  strings in the state.
- Tiles as flat arrays of small integers, one array per field. Explored tiles
  and other sets as bitsets.
- Fixed-capacity unit and city stores with stable ids, plus a tile-to-unit
  index and a tile-to-owner cache kept up to date on every change. No linear
  searches for "unit at" or "owner of".
- The state is one flat value with no pointers, so a copy is one memory copy.
  Measure copy against undo before adding undo.
- Legal actions are written into a buffer the caller owns. Builds are listed
  from per-tribe, per-tech tables, never by trying every building on every
  tile.
- Every action has a fixed integer encoding, the same one the Python
  environment uses for its action space and mask.
- An incremental state hash, used for cheap comparison in tests and later for
  search.
- The game log is not part of the hot state; produce it only on request.

## Phases

Each phase ends with its gate green and one commit. Keep `engine/PROGRESS.md`
up to date: phase, gate results, open questions, measured speed.

0. **Freeze and measure.** Pin the oracle commit. Re-run the baseline. Write
   a TypeScript trace exporter: for a seed and policy, it writes the options,
   every action, the legal-action list before it and a canonical state after
   it. Generate the corpus. Measure which engine lines the corpus executes and
   add games until at least 95% of the lines in `logic/engine` are covered;
   list what is not.
   *Gate: corpus exists, coverage report committed.*
1. **Skeleton and data.** Workspace, data export and generated tables, state
   types, conversion to and from the JSON state.
   *Gate: every state in the corpus converts to Rust and back unchanged.*
2. **Randomness and map generation.**
   *Gate: `createGame` gives the same first state for every corpus game.*
3. **Applying actions.** Replay the corpus actions and compare the state after
   each one. Order: movement and combat, cities and economy, technology,
   diplomacy, then one special tribe at a time.
   *Gate: every corpus trace replays with equal states.*
4. **Legal actions, observation, scoring, greedy bot.**
   *Gate: equal legal-action lists in equal order at every step; Rust
   self-play from a seed gives the same game as TypeScript, action for
   action.*
5. **Speed.** Benchmark command, profile, fix the largest cost, repeat. Then
   link-time and profile-guided optimisation. Phases 3 and 4 stay green.
   *Gate: done criterion 3.*
6. **Node addon and scripts.** Move the scripts and their worker pool onto
   Rust.
   *Gate: done criterion 4.*
7. **Python environment.**
   *Gate: done criterion 5.*
8. **Facade and app.** Back the facade with Rust, run jest against it, check
   the app in a browser by playing a game and opening a replay.
   *Gate: done criteria 2 and 6.*
9. **Remove the TypeScript rules.** Keep the trace corpus as a permanent
   regression test. Update `README.md` and `docs/RULES_PARITY.md`.
   *Gate: done criterion 7, every earlier gate still green.*

## Traps

- **Order is behaviour.** The greedy bot takes the first best action, so the
  order of legal actions, of units, of cities and of object keys in `data.ts`
  must match exactly. So must sort stability.
- **Numbers.** JavaScript numbers are 64-bit floats. Combat damage and score
  rounding must reproduce `Math.round`, `Math.floor` and float division
  exactly; `Math.round` rounds halves up, also for negative numbers.
- **Missing versus false.** Optional fields (`frozen`, `flooded`, `diplomacy`,
  `difficulty`) may be absent in the JSON. The canonical form must treat
  absent and the default as equal, in both directions.
- **Old saves.** Records in `data/games` come from older rules; see how
  `app/analyse.tsx` stops at a divergence and keep that behaviour.
- **The log** is cut to its last 50 lines on every action; compare it
  separately from the state or leave it out of the comparison.

## Working rules

- One branch, `feat/rust-engine`, from `main`; one draft pull request; never
  push to `main`.
- Never weaken, skip or narrow a gate to make it pass. If a gate cannot be
  met, stop and write down why.
- A difference between the engines is always investigated to its cause in the
  rules, never patched in the comparison.
- Speed figures in commits and in `PROGRESS.md` are measured, with the command
  and the machine.

## Goal for the executing agent

> Carry out `docs/RUST_ENGINE_ROADMAP.md` phase by phase on branch
> `feat/rust-engine`. You are done when all seven points under "Definition of
> done" hold, each shown by its command exiting zero, and
> `engine/PROGRESS.md` lists the result of every gate.
