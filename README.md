# Polytopia AI research (Shardlands)

A research project: a turn-based 4X game whose **rules and balance numbers match The
Battle of Polytopia** (tech tree, costs, unit stats, combat, economy, map generation, game
modes) under its own name, built so that bots and reinforcement-learning agents can be
trained and measured on exactly the game a person plays.

What is in the repository:

- **The engine**, written in Rust (`engine/`), exposed to Node (a native addon), to the browser
  (WebAssembly) and to Python (a vectorised environment). A game is a pure function of its seed
  and its list of actions, so every game can be replayed exactly.
- **The game**, an Expo web app (`app/`, `components/`) with a map, fog of war, tech tree, bots,
  hot-seat play, an Analyse page (Elo rankings, game replay, live viewing).
- **Bots and models** (`models/`): a hand-written greedy bot, a random bot, an LLM opponent,
  and bots whose scoring weights were tuned by hill climbing, evolution strategies and
  strength sweeps.
- **The arena**: model-vs-model games, recordings, and an Elo leaderboard
  (Bradley-Terry fit with confidence intervals).
- **Training tools**: hill climbing, evolution strategies, strength sweeps, a live dashboard,
  and a lab notebook of experiments (LaTeX reports).
- **Lecture notes** (`lecture-notes/`): Org-mode pages in the manner of Olivier Danvy that turn
  concepts from the EMAI course into tested OCaml programs about Polytopia situations, built
  with Emacs.

Everything below is run from the repository root unless it says otherwise. The commands were
checked against the scripts in this repository; where a number is an example it says so.

**The command blocks can be pasted as they are.** They hold commands only, without `#`
comments, because an interactive zsh does not treat `#` as a comment unless
`setopt interactivecomments` is set: the words after it would be passed to the command. What
each command does is said in the text or table next to the block. Words in angle brackets
(`<id>`, `<base>`) are placeholders to replace before running.

## Contents

1. [Quick start](#1-quick-start)
2. [Repository structure](#2-repository-structure)
3. [The Rust engine](#3-the-rust-engine)
4. [Running the game and its servers](#4-running-the-game-and-its-servers)
5. [Models](#5-models)
6. [Playing bots against each other](#6-playing-bots-against-each-other)
7. [Evaluating strength: Elo and panel tests](#7-evaluating-strength-elo-and-panel-tests)
8. [Training a model](#8-training-a-model)
9. [Monitoring a training run](#9-monitoring-a-training-run)
10. [Experiments and the lab notebook](#10-experiments-and-the-lab-notebook)
11. [Datasets and the Python environment](#11-datasets-and-the-python-environment)
12. [Lecture notes (Emacs)](#12-lecture-notes-emacs)
13. [Git workflow](#13-git-workflow)
14. [Tests and checks](#14-tests-and-checks)
15. [Troubleshooting](#15-troubleshooting)
16. [Further reading](#16-further-reading)

---

## 1. Quick start

### Requirements

| Tool | Used for | Version here |
|---|---|---|
| Node and npm | scripts, the app, jest | Node 25.9 |
| Rust via rustup, with the `wasm32-unknown-unknown` target (in `~/.cargo/bin`, see below) | the engine | cargo 1.97 |
| GNU Emacs with Org 9.6 or later | lecture notes | Emacs 30.2 |
| OCaml | lecture notes | 5.3 |
| Google Chrome at `/Applications/Google Chrome.app` | lecture-note pictures | |
| `tectonic` (`brew install tectonic`) | experiment report PDFs | |
| Python 3 and numpy | the Python environment (optional) | Python 3.14 |
| LM Studio (optional) | the LLM opponent | |

The Rust and shell scripts assume macOS (the Node addon is a `.dylib`) and zsh.

### First run on a fresh checkout or worktree

```bash
npm install
npm run engine:build
npm run test:ci
npm run simulate -- --games 5
npm run elo
```

| Command | What it does |
|---|---|
| `npm install` | installs the packages (or copy `node_modules` from another checkout, see below) |
| `npm run engine:build` | builds `engine/node/polyengine.node` and `public/polyengine.wasm` |
| `npm run test:ci` | the jest suite, on the Rust engine |
| `npm run simulate -- --games 5` | five bot-vs-bot games, one JSON line each plus a summary |
| `npm run elo` | the leaderboard from `data/ratings.json` |

Rust: `cargo` and `rustup` live in `~/.cargo/bin`. The build script puts that folder on the
PATH itself, so `npm run engine:build` works even when the shell does not find `cargo`. To run
`cargo` or `rustup` by hand in such a shell, first run:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

On a new machine only, if the engine build stops on the WebAssembly target, add it once:

```bash
~/.cargo/bin/rustup target add wasm32-unknown-unknown
```

`npm run engine:build` is required before anything that plays a game: the scripts load
`engine/node/polyengine.node`, which is not in git (`public/polyengine.wasm` is committed, so the
browser works without a build, but it is rebuilt with the addon). A fresh worktree has no
`engine/target/`, so the first build compiles the whole engine (minutes; later builds are
incremental).

In a git worktree, `node_modules` can be a symlink to the main checkout's
(`ln -s ../../../node_modules .claude/worktrees/<id>/node_modules`), except for the lecture-note
pictures, which need a real directory (`cp -c -R <main checkout>/node_modules node_modules`,
a copy-on-write copy that costs almost nothing).

### The ten commands you will use most

| Command | What it does |
|---|---|
| `npm run engine:build` | rebuild the engine after any change under `engine/` |
| `zsh scripts/relaunch-preview.sh` | the web game on :8090 plus the arena server on :8091 |
| `npm run arena -- --models a,b --games 20` | play models against each other, record, rate |
| `npm run elo` | print the Elo leaderboard (`-- --rebuild` refits it from all games) |
| `npm run train-full -- --id <id> --from <base> --budget N` | hill-climb the full bot |
| `npm run sweep -- --id <id> --from <base> --knob k --values 0.5,1,2,4` | measure one knob at several strengths |
| `npm run train-dashboard` | live dashboard on :8095 |
| `npm run experiment:report -- NN-slug` | build one experiment's PDF |
| `emacs --batch -l lecture-notes/build.el` | build the lecture notes |
| `npm run test:ci` | the jest suite |

---

## 2. Repository structure

```
.
├── app/                    Expo Router pages of the web game
│   ├── index.tsx             home: new game, resume, settings
│   ├── game.tsx              the game screen
│   ├── analyse.tsx           rankings, replay, live viewing of games
│   ├── rankings.tsx          Elo table
│   └── scene.tsx             page that draws one scene for the lecture notes (not a player page)
├── components/             React Native components
│   ├── game/                 GameScreen, tech tree, rankings table, arena client, watch panels
│   ├── Map/                  Map, Tile, Units, Capital
│   ├── art/                  terrain art, icons, and the sprite maps for assets/sprites/
│   ├── anim/ Settings/
├── context/                React context
├── logic/                  TypeScript side of the game
│   ├── engine/               thin facade over the Rust engine (call(name, args)), data tables, types
│   ├── agents/               model specs turned into agents (greedy, full, random, llm)
│   └── arena/                game records, Elo fit (elo.ts), SPRT (sprt.ts)
├── engine/                 Rust workspace (the rules of the game)
│   ├── core/                 polycore: rules, bots, map generation, observation, canonical hash
│   ├── api/                  JSON entry point: call(name, argsJson)
│   ├── node/                 N-API addon  -> engine/node/polyengine.node
│   ├── wasm/                 WebAssembly  -> public/polyengine.wasm
│   ├── py/                   PyO3 module polyengine with the vectorised RL environment VecEnv
│   ├── cli/                  `polyengine` binary: corpus replay (parity gate), state dumps
│   ├── PORTING.md PROGRESS.md
├── models/                 one folder per model (model.json, and training records)
├── data/                   recorded games and Elo, committed
│   ├── games/YYYY-MM-DD/<id>.json.gz   one gzipped record per game
│   ├── ratings.json          fitted Elo per "model:<id>" / "human:<profile>"
│   ├── results.jsonl         one line per rated game
│   └── profiles.json         human player profiles
├── scripts/                command-line tools (all run with `node -r sucrase/register`)
│   ├── simulate.ts arena.ts play.ts elo.ts export-dataset.ts arena-server.ts
│   ├── train-hill.ts train-full.ts train-es.ts sweep.ts train-dashboard.ts experiment-report.ts
│   ├── arena-grid.sh relaunch-preview.sh
│   ├── lib/                  store.ts (files), matches.ts, train-greedy.ts (shared trainer code)
│   ├── rust/                 build, parity, benchmark and coverage tools for the engine
│   └── dev/                  smoke.ts, mapstats.ts
├── experiments/            lab notebook: one folder per experiment, LaTeX reports
├── lecture-notes/          Org notes, build.el, serve.py, pictures.ml, notes.css, explanations/
├── docs/                   RULES (shardlands/RULES.md), ARENA.md, RL.md, PLAN.md, parity and roadmap
├── __tests__/              jest suites (engine parity, rules, arena, app)
├── .claude/skills/         instructions for Claude Code: lecture-note, model-experiment, refer-to-lecture
├── POLYTOPIA_RULES.md      the rules as compiled from the Polytopia wiki
└── public/                 static files, including polyengine.wasm
```

Ignored by git (generated or local): `node_modules/`, `engine/target/`,
`engine/node/polyengine.node`, `engine/corpus/`, `engine/py/.venv/` and `engine/py/polyengine.so`,
`lecture-notes/_build/`, `data/datasets/`, `experiments/**/*.pdf`. Committed on purpose:
`data/` (games, ratings), `models/`, and `public/polyengine.wasm`.

Not ignored, so keep them out of commits by hand: `logs/` (scratch; commit
`models/<id>/train.log` instead) and `models/<id>/checkpoint.json` (delete it when a run is done).

---

## 3. The Rust engine

The rules live in `engine/core/src/`: `state.rs` (game creation, scoring), `actions.rs` (legal
actions, applying one), `movement.rs`, `combat.rs`, `mapgen.rs`, `diplomacy.rs`, `bot.rs` and
`bot_full.rs` (the bots), `observe.rs` (what a player sees, as planes for RL), `canon.rs` (the
canonical state hash used for parity checks), `data_gen.rs` (tables generated from
`logic/engine/data.ts` by `scripts/rust/gen-data.ts`).

TypeScript reaches it through one function, `call(name, ...args)` in `logic/engine/rust.ts`:
the Node addon in scripts and jest, WebAssembly in the browser. `logic/engine/*.ts` is a thin
facade. A per-call cost of about 3 ms per action means hot loops must use bulk calls such as
`playGames`, which the trainers do.

### Build

Run this after any change under `engine/`; it builds both targets:

```bash
npm run engine:build
```

This builds `engine/node/polyengine.node` (release, `polynode`) and `public/polyengine.wasm`
(`polywasm`, about 0.8 MB). It writes to a `.new` file and renames it, because replacing a loaded
`.node` in place can crash running processes. Do not `cp` over it while a training run is going.

Set `POLYENGINE_NODE=/path/to/polyengine.node` to load a different addon.

### Test and check the engine

The Rust tests, then the type check (expect 0 errors), then the WebAssembly build compared with
the Node addon:

```bash
(cd engine && cargo test --release)
npx tsc --noEmit -p .
node -r sucrase/register scripts/rust/wasm-check.ts
```

A subset of the Rust tests, here the full bot's:

```bash
(cd engine && cargo test --release -p polycore bot_full)
```

The corpus parity gate compares the Rust engine with the TypeScript engine it replaced (the
oracle, commit `5d2846d`) on 2,000 recorded games. The first command needs the oracle checkout:

```bash
node -r sucrase/register scripts/rust/trace-gen.ts --games 2000 --out engine/corpus/full
engine/target/release/polyengine replay engine/corpus/full
```

`engine/corpus/` is not in git. See `engine/PROGRESS.md` for the done criteria, the benchmark
(Rust is 61x to 148x faster than the TypeScript engine on one thread; 0.7 to 1.2 million actions
per second on 12 cores) and `engine/PORTING.md` for the porting contract.

The speed of the TypeScript engine against the Rust engine (the number of games and of repeats
may follow the checkout as two more arguments):

```bash
scripts/rust/bench-compare.sh <oracle-checkout>
```

Line coverage of the engine by the corpus:

```bash
scripts/rust/coverage.sh 2000 10
```

### Adding a knob to the full bot

A new decision mechanism touches, in this order: `FullWeights` in `engine/core/src/bot_full.rs`
(default off), its JSON key in `full_weights` and in `engine/api/src/lib.rs`
(`full_weights_to_json`), `logic/engine/botFull.ts` (type), and `scripts/lib/train-greedy.ts`
(`cloneFull`, the knob list, `SCALARS`, and `whole` for integer knobs). Then
`npm run engine:build`. The `model-experiment` skill describes the whole routine (section 10).

---

## 4. Running the game and its servers

| Port | What | Started by |
|---|---|---|
| 8081 | Expo dev server (default) | `npm run web` |
| 8090 | the web game, cleared bundler cache | `zsh scripts/relaunch-preview.sh` |
| 8091 | arena server: models, ratings, games, matches, LLM proxy | `npm run arena-server` (the script above starts it too) |
| 8095 | training and experiment dashboard | `npm run train-dashboard` |
| 8097 | lecture notes with the "explain the syntax" button | `/usr/bin/python3 lecture-notes/serve.py` |
| 8099 | the scene page the lecture-note build photographs | started by the lecture-note build |

Expo web on its default port:

```bash
npm run web
```

The game on port 8090 and the arena server on 8091 (other ports: set `PORT` and `ARENA_PORT`):

```bash
zsh scripts/relaunch-preview.sh
```

`relaunch-preview.sh` kills whatever listens on those two ports, starts the arena server (log in
`/tmp/shardlands-arena.log`) and then Expo in the foreground with `--clear`. From a phone on the
same Wi-Fi, use `http://<mac LAN ip>:8090` (`ipconfig getifaddr en0`). The app is web only: Hermes
has no WebAssembly, so iOS and Android builds show a notice.

The arena server (`scripts/arena-server.ts`) is what lets the browser record games and reach
LM Studio, because a browser can write neither into the repository nor to the local LLM. Its
routes include `GET /api/models`, `/api/ratings` (with `?mode=&players=&size=&mapType=`),
`/api/ratings/facets`, `/api/games`, `/api/games/<id>`, `POST /api/games`, `POST /api/matches`
(a model-only game that runs on the server), and `GET /api/health`.

Keep the main checkout on a clean `main` (a live copy of the game may be served from it) and do
experiments in worktrees.

---

## 5. Models

Every opponent is a folder `models/<id>/` with a `model.json`. The kinds:

| kind | what it is | how it is configured |
|---|---|---|
| `greedy` | scores each legal action with a hand-written heuristic (about 20 weights) | `weights`: overrides on top of `DEFAULT_WEIGHTS` in `logic/engine/bot.ts` |
| `greedy-full` | the greedy bot plus a multiplier and an "open" knob per action type, one weight per tech, unit, build and city reward, and a centre pull (about 200 knobs) | `full`: overrides on top of `DEFAULT_FULL_WEIGHTS` in `logic/engine/botFull.ts` (`greedy`, `type`, `open`, `tech`, `unit`, `build`, ...) |
| `random` | uniformly random legal moves, seeded per step so games replay | none |
| `llm` | a local LLM through an OpenAI-compatible endpoint, shown a text summary and up to 24 ranked candidates | `llm.endpoint`, `llm.model`, `temperature`, `fallback` |
| `external` | an agent playing through `npm run play` (for example a Claude subagent) | none, not selectable in the app |

Agents only ever choose among `legalActions(state)`, so no model can play an illegal move.

A trained model's folder can also hold:

| File | Written by | Meaning |
|---|---|---|
| `model.json` | trainers, sweeps | the spec, with a `training` block (method, budget, rounds, kept, seconds, early stop) |
| `curve.jsonl` | `train-hill`, `train-es` | one row per learning-curve point: training games, round, kept, mean win rate, mean point share, per-opponent results |
| `checkpoint.json` | trainers | everything needed to `--resume`; delete before committing |
| `snapshots/point-NNN-<games>-games.json` | trainers | the best champion at each curve point |
| `milestones/<games>-games.json` | `--milestones` | the champion when training passed that many games |
| `sweep.jsonl` | `sweep` | one row per measured point, then a `final` row |
| `train.log` | you (copy of `logs/<id>.log`) | the training log, committed as the run's record |

A folder with only `sweep.jsonl` and `train.log` is a measurement record (a re-measure or a sweep
whose best point was not kept); it has no `model.json`, so the app does not list a duplicate.

To make a model by hand, copy a folder, change `id`, and set `weights` or `llm`. It appears in the
app's seat picker after a reload. A new kind of learned policy is a new `kind` in
`logic/agents/registry.ts`.

For the LLM model, LM Studio must be running with the model loaded:
`~/.lmstudio/bin/lms load qwen3-coder-30b-a3b-instruct-mlx`.

Naming: `greedy-hill-vN` (hill climbed greedy bot), `greedy-full-vN` (hill climbed full bot),
`greedy-full-<mechanism>` (one experiment), `greedy-es-vN` (evolution strategies).

---

## 6. Playing bots against each other

### Headless runs without recording: `simulate`

```bash
npm run simulate -- --games 20 --players 2 --size 11 --mode perfection
```

With `--random`, player 0 plays random legal actions:

```bash
npm run simulate -- --games 5 --random
```

Options: `--games` (10), `--players` (2), `--size` (11), `--mode` `perfection|domination`
(perfection), `--map` (drylands), `--seed` (1). Prints one JSON line per game (`game, seed,
turns, winner, actions, scores, clans, obsShape`) and a last line `{"summary":true, games, wins,
seconds, actionsPerSecond}`. Nothing is recorded and Elo does not change. Map types: `drylands`,
`lakes`, `continents`, `pangea`, `archipelago`, `waterworld`.

### Rated games: `arena`

```bash
npm run arena -- --models greedy-v1,random-v1 --games 20
npm run arena -- --models greedy-hill-v4,greedy-hill-v3,greedy-v1,greedy-hill-v2 --mode domination --size 14 --games 20 --max-turns 100
```

Options: `--models` (comma list, 2 or more), `--games` (10), `--size` (11), `--mode`
(perfection), `--map` (drylands), `--seed` (time based), `--max-turns` (60). Seats rotate every
game so each model plays from every seat. Every game is saved to
`data/games/<date>/<id>.json.gz`, appended to `data/results.jsonl`, and the ratings are refitted
into `data/ratings.json`. These are tracked files; a shared leaderboard changes whenever anyone
runs the arena.

To fill the leaderboard's filters (mode, player count, map size, map type) with data, play every
pairing of the six reference bots, about 400 games:

```bash
zsh scripts/arena-grid.sh
```

To rate one new model (its pairings, plus 40 games each in 1v1 perfection on 11x11):

```bash
zsh scripts/arena-grid.sh greedy-hill-v4
```

### One seat from a terminal: `play`

For people and for agents (a Claude subagent, for instance). Opponents move automatically in
between.

Start a game, then ask for the position with its numbered legal moves (`state`), then play
move `<n>` (`move`), after which the opponents move:

```bash
npm run play -- new --me claude-sonnet-agent --opponent greedy-v1 --size 11 --mode perfection
npm run play -- state --game <id>
npm run play -- move --game <id> <n>
```

The game is recorded like any other and rated when it ends.

### Replaying a recording

Records hold the options, the seats, every action and the full state at the start of every
player turn; the engine is deterministic, so `replayStates(record)` in `logic/arena/record.ts`
rebuilds the exact state after every action. The Analyse page of the app replays games and
watches running ones live. From code: `findGame(id)` in `scripts/lib/store.ts`.

---

## 7. Evaluating strength: Elo and panel tests

There are two ways to measure a model, and they answer different questions.

| | Arena and Elo | Panel test (training, sweep) |
|---|---|---|
| Games | real games, recorded | whole games in Rust, not recorded |
| Touches `data/` | yes | no |
| Opponents | the models you name | a fixed panel on fixed held-out maps |
| Answers | "where does this model stand on the leaderboard?" | "did this change help, and by how much?" |
| Speed | slow (JS loop per game) | fast (bulk Rust calls on all cores) |

### The Elo leaderboard

Print `data/ratings.json`:

```bash
npm run elo
```

Rebuild `data/results.jsonl` from every game in `data/games/` and fit the ratings again:

```bash
npm run elo -- --rebuild
```

Example (data in this repository at the time of writing):

```
Jakob (human:jakob)                           1387  1256–1525  games    2  wins 2
model:greedy-hill-v4                          1374  1324–1421  games  486  wins 317
model:greedy-hill-v3                          1340  1303–1385  games  375  wins 200
model:greedy-hill-v2                          1317  1282–1371  games  491  wins 268
model:greedy-hill-v1                          1260  1225–1313  games  473  wins 242
model:greedy-v1                               1202  1160–1250  games  509  wins 219
model:random-v1                                387   219–461  games  392  wins 1
```

How to read it:

- The ratings are a **Bradley-Terry fit** over all games at once (the method behind LMArena and
  BayesElo), so the order games were played in does not matter. Every pair of seats in a game
  counts as one match, weighted 1/(players - 1); equal placing is a draw. Everyone also plays one
  virtual game against a fixed 1200 player, which keeps players with one game near 1200.
- `lo-hi` is a 95% interval from 200 refits on games resampled with replacement. **Overlapping
  intervals mean the order of those two is not settled.** In the table above the human has two games
  and an interval of 270 points, so that place means nothing yet.
- A 200 point gap means the stronger side wins about 3 games in 4.
- Keys are `model:<id>` and `human:<profileId>`. Unfinished games and a model playing itself do not
  count.
- Filtered ratings: the arena server answers `GET /api/ratings?mode=domination&players=2&size=11`
  (any combination); Analyse > Rankings has a chip per setting. A model plays every format with
  the same weights, so the filters show where it is strong or weak.

Evaluate a new model on the leaderboard in three steps: a head to head, then every format, then
read its interval.

```bash
npm run arena -- --models <new>,greedy-hill-v4 --games 40 --mode perfection --size 11
zsh scripts/arena-grid.sh <new>
npm run elo
```

Wait until the new model's interval stops overlapping the neighbour you claim to beat.

### Panel tests (how training judges a model)

Trainers and sweeps do not use the arena. They play a **fixed panel** of reference models on the
same held-out maps every time, so numbers are comparable across runs:

- **Panel**: `greedy-v1, greedy-hill-v1, greedy-hill-v2, greedy-hill-v3, greedy-hill-v4` for the
  trainers by default; `... , greedy-full-v1` for sweeps and the experiment routine. Set it with
  `--panel`.
- **Maps**: curve points use seed base 1,000,000,000 and the final test 1,500,000,000, so a sweep's
  "base" row and a training run's "point at 0 games" are directly comparable.
- **Every map is played from both seats**, which cancels the map's advantage to one seat.
- **Metrics**: *won* (win rate), *points* (the share of all points, a much finer signal than
  wins), and with `--metric finish` the **finish score**: a conquest win scores 0.75 to 1 (the
  earlier the more), a conquest loss 0 to 0.25, and a game stopped at the turn cap 0.25 + 0.5 x
  point share. 0.5 is even.
- **Final test**: 400 unseen games against each panel model (`--final`), reported as won % with a
  +/- interval, the Elo that win rate implies, points %, finish %, conquest rate, mean turns.

A **head-to-head against the base** is the final test of a model whose panel includes its base.
Measure a base alone on the same maps with a sweep that has no points:
`npm run sweep -- --id <id>-base --from <base> --metric finish --games 2`.

Verdict rules for experiments (kept or not kept) are in the `model-experiment` skill and
summarised in section 10.

---

## 8. Training a model

Three trainers and one measuring tool, all on the Rust engine, all running games on a pool of
worker threads (`--workers`, default: all cores but two).

| Tool | What it does | When to use |
|---|---|---|
| `train-hill` | hill climbing on the greedy bot's weights | tuning the greedy bot |
| `train-full` | `train-hill --space full`: hill climbing over all about 200 knobs of the full bot | a long tuning run every 3 to 4 kept mechanisms |
| `train-es` | evolution strategies on the greedy weights (log space, Adam, common random numbers) | comparing optimisers on the same panel |
| `sweep` | one mechanism at a few hand-set strengths, no training | **the normal way to test a new mechanism** (2 to 5 minutes) |

**Sweep, do not train, for a new mechanism.** Hill climbing a round's 300 to 400 games cannot see
gains below about one point, and 100k-game runs found nothing three times. Sweep first.

### Where to run it

Not in the main checkout: the live game runs from there. Make a worktree:

```bash
git worktree add .claude/worktrees/<id> -b model/<id> main
ln -s ../../../node_modules .claude/worktrees/<id>/node_modules
cd .claude/worktrees/<id> && npm run engine:build
```

### Hill climbing, step by step

1. The champion starts as `greedy-v1`'s weights (or `--from <model>`).
2. A challenger nudges `--pick` weights (3 greedy, 4 full), each multiplied by
   `e^(sigma x N(0,1))`.
3. Challenger and champion play map pairs (every map from both seats), against the champion
   (`--league self`), a random earlier champion (`past`), or a named model (the challenger and the
   champion both play it and their shares are compared). A comma list mixes them.
4. A sequential test decides after every `--batch` map pairs (default 10):
   - `--test margin` (default): is the mean margin of point share +`--margin1` (0.01 = one point)
     rather than 0? Keep when the evidence says yes, reject when it says no, reject at
     `--max-games` (400).
   - `--test sprt`: the same on results (win 1, loss 0), with `--elo0 0 --elo1 25`.
   - `--test fixed`: `--games` games per round, keep at `--accept` (0.52) of the points and half the wins.
5. **Step size** `--sigma` (0.5) shrinks by `--sigma-decay` (0.85) after `--sigma-patience` (50)
   rounds without a keep, down to `--sigma-min` (0.15), and grows by 1.25 on a keep.
6. **Learning curve**: every `--curve-every` training games (budget / 40) the champion plays the
   panel on held-out maps (`--curve-games`, 200 per opponent). With `--average K` (4) the geometric
   mean of the last K kept champions is tested as well; the better one counts.
7. **Early stop**: converged once the curve metric (`--curve-metric share|win|finish`) has not
   beaten its best by `--min-gain` for `--patience` (8) curve points. `--patience 0` never stops
   early. The champion of the **best curve point** is saved, not the last one.
8. **Final test**: `--final` (400) unseen games against each panel model, then
   `models/<id>/model.json` and `curve.jsonl` are written, and "training took ..." with the start,
   end and duration is recorded in the log and the model file.

Training games are not recorded and do not change Elo.

### Commands

Each block below is one run; they are alternatives, not a sequence.

Hill climbing on the greedy bot (for scale: `greedy-hill-v4` had a budget of 3.6M games and
stopped early at 1.26M, after about 2 hours on 10 threads):

```bash
npm run train-hill -- --id greedy-hill-v5 --budget 30000
```

The same, starting from an earlier model and against a mixed league:

```bash
npm run train-hill -- --id greedy-hill-v5 --from greedy-hill-v4 --league self,past,greedy-v1
```

The full bot:

```bash
npm run train-full -- --id greedy-full-v1 --budget 1260160 --from greedy-hill-v4
```

The full bot with the settings of the experiment routine for a tuning run:

```bash
npm run train-full -- --id <id> --from <base> --metric finish --budget 100000 --patience 0 \
  --league self,past --batch 30 --seed 4242 --curve-every 12500 --workers 10 \
  --panel greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4,greedy-full-v1
```

Evolution strategies (its defaults are `--pop 12 --pairs 2 --lr 0.03 --sigma 0.15`):

```bash
npm run train-es -- --id greedy-es-v1 --budget 30000
```

A sweep of one knob: the base, then the knob at four strengths, then a final test of the best
point:

```bash
npm run sweep -- --id greedy-full-front --from greedy-full-v1 --knob front --values 0.5,1,2,4 --metric finish
```

A sweep of hand-set points over several knobs:

```bash
npm run sweep -- --from greedy-full-v1 --points "techUse=0.3,techUseless=2|techUse=1,techUseless=5"
```

### Options

Game options (all trainers and sweeps):

| Option | Default | Meaning |
|---|---|---|
| `--mode` | `domination` | `domination` or `perfection` |
| `--players` | 4 | must be even: two sides on alternate seats |
| `--size` | the game's suggestion for the mode and player count | map side |
| `--map-type` | `drylands` | see section 6 |
| `--max-turns` | 150 | a game still running is decided on score |
| `--max-moves` | 20000 | per game |
| `--workers` | cores - 2 | worker threads |
| `--seed` | 1000 | seed base for training maps |

Trainer options (`train-hill`, `train-full`):

| Option | Default | Meaning |
|---|---|---|
| `--id` | `greedy-hill-v1` / `greedy-full-v1` | the model id and its folder |
| `--budget` | 0 | training games in total; 0 means stop after `--rounds` (60) |
| `--from` | none | start from this model (a greedy model works for `train-full`) |
| `--resume` | off | continue from `models/<id>/checkpoint.json` |
| `--reset-sigma X` | off | with `--resume`, restart the step size at X |
| `--test`, `--batch`, `--max-games`, `--margin1`, `--elo0/1`, `--games`, `--accept` | see above | the acceptance test |
| `--sigma`, `--sigma-min`, `--sigma-decay`, `--sigma-patience`, `--pick` | 0.5, 0.15, 0.85, 50, 3 or 4 | step size and nudges per round |
| `--league` | `self` | opponents of the challenger: `self`, `past`, model ids |
| `--panel` | the five bots above | the held-out panel |
| `--curve-every`, `--curve-games`, `--final` | budget/40, 200, 400 | curve spacing and test sizes |
| `--patience`, `--min-gain`, `--average` | 8, 0.003 (0.01 for win), 4 | early stop and averaging |
| `--metric`, `--curve-metric` | `share` | `share`, `win` or `finish` |
| `--milestones 3600,36000,...` | none | save the champion when training passes each count |
| `--init "k=v,k=v"` | none | start knobs at these values (a knob at 0 can never leave 0 by multiplication) |
| `--focus "k1,k2"` | none | every round nudges one of these plus the random ones |
| `--progress-every` | 60 | seconds between progress lines (0 turns them off) |

`train-es` options: `--pop` (12), `--pairs` (2), `--lr` (0.03), `--sigma` (0.15), `--sigma-min`
(0.03), `--sigma-decay` (0.998), `--ema` (0.95); curve, panel, milestone and resume options as
above.

`sweep` options: `--from` (the base, default `greedy-full-v1`), `--id` (save the best point as
`models/<id>`), `--knob` with `--values`, or `--points "a=1,b=5|a=2,b=10"`, `--games` (200 per
opponent per point), `--final` (400), `--panel`, `--metric`. Knob names are as the trainer prints
them: scalars bare (`defend`), tables as `group.key` (`unit.giant`, `greedy.move`), never with a
`full.` prefix. With no knob and no points it measures the base alone.

### Stop and resume

Ctrl-C or `kill` (SIGINT and SIGTERM) stops a trainer cleanly; the checkpoint is written after
every round. Continue with the same command plus `--resume`. If the options changed, the trainer
prints both; every resume and its options are recorded in the checkpoint and the model file.

### Recording the run

```bash
mkdir -p logs
nohup npm run train-full -- --id <id> --from <base> <options> > logs/<id>.log 2>&1 &
```

When it has finished, `cp logs/<id>.log models/<id>/train.log` and `rm models/<id>/checkpoint.json`.

---

## 9. Monitoring a training run

### 1. The log

```bash
tail -f logs/<id>.log
```

Four kinds of line. The numbers in these examples are invented to show the layout; the layout
is what `scripts/train-hill.ts` and `scripts/lib/train-greedy.ts` print.

**Progress**, every 60 seconds (`--progress-every`):

```
  [14:32] curve point 7 (vs panel, champion and average): 640/2000 games, done in ~3 min | so far: ... | 612 games in the last 60s, 590/min overall | run: round 2210, 310k of 1.26M training games, 31 kept, sigma 0.50, ETA Tue 17:40, 2h01m left at most
```

It names the phase (a round, a curve point or the final test), its progress and ETA, the results
so far in that phase (share of points and wins per opponent), the current game rate, and the
state of the whole run.

**Round**, one per challenger:

```
round  2211   180 games  won  52%  points 50.4%  LLR   0.84        (31 kept, sigma 0.50, 24.6%, 31m12s, ETA ...)
round  2212   120 games  won  58%  points 51.9%  LLR   2.97  KEPT  (32 kept, sigma 0.50, ...)  capture 357→380, kill 27→24
```

`games` is how many games the test needed, `won` and `points` the challenger's results, `LLR` the
log-likelihood ratio (the test keeps at its upper bound and rejects at its lower one), `KEPT`
marks an accepted challenger followed by the nudged knobs (old→new), `cap` a challenger rejected
at the game cap. With `--test margin` or `sprt`, a `look:` line shows each interim look (games,
margin, LLR, and both bounds).

**Curve point**, every `--curve-every` training games (and once at the start and at the end):

```
curve   90k games  round 521  8 kept  champ | greedy 71% won, 58.6% pts (+157)  v1 62% won, 54.7% pts (+84)  ...  | mean 60% won, 55.1% pts, finish 58.0%, conquest 41%, 52 turns  BEST
       new best  ETA Tue 17:40, 2h01m left at most
```

One entry per panel opponent (won rate, point share, the Elo the win rate implies), then the panel
means. `champ` is the champion, `avg` the average of the last kept champions. `BEST` marks a new
best by more than `--min-gain`; otherwise the second line reads "best 61.6% pts at point 7, 3/8
without gain", and that count is the patience that ends the run.

**End**: `converged: ...`, `saving the champion of the best curve point`, the
`final (400 unseen games against each):` block, `changed: <knobs that moved>`,
`saved models/<id>/model.json and curve.jsonl`, and `training took <duration> (<start> to <end>)`.
A final-block row reads
`vs greedy-hill-v3  won 56% ± 5%  (+42 Elo)  points 52.9%  finish 51.0%  conquest 30%  60 turns`.

What to look for: a curve that rises against the panel, a small number of `KEPT` lines (greedy-hill-v4
kept 66 of 8,549 rounds, under 1%), and a `converged` line rather than a crash. A flat curve with
no kept challengers for hundreds of rounds means the step size or the test is too coarse: see the
comment above `SIGMA_MIN` in `scripts/train-hill.ts`, and prefer a sweep for a new mechanism.

### 2. The dashboard

The dashboard for the current folder, at http://localhost:8095:

```bash
npm run train-dashboard
```

For runs in another worktree, on a chosen port, limited to named runs:

```bash
npm run train-dashboard -- --root .claude/worktrees/<id> --port 8095 --runs <id>,<id2>
```

`--root` is the folder holding `models/` and `logs/` (default: the current folder), so one
dashboard can watch a run in another worktree. Without `--runs` it finds every `models/<id>` with a
checkpoint, every `logs/<id>.log` with a model, and sweeps (while running and for 30 minutes after
they finish). It only reads; it never writes into the run folders.

| URL | Shows |
|---|---|
| `/` | charts and insights for each run (learning curve against the panel, progress), the host's load and memory, and strength sweeps point by point |
| `/experiments` | the lab notebook index, the lineage of champions |
| `/experiment/NN-slug` | one experiment: diagram, live results, open report parts, the PDF |
| `/api/state` | the same data as JSON (`curl -s localhost:8095/api/state`) |
| `/experiments/notebook.pdf` | the whole notebook, built on the first request (`?build` rebuilds) |

Run one dashboard at a time: `pkill -f "scripts/train-dashboard.ts"` before starting another.

### 3. The files

In this order: the state of the run, the learning curve, a sweep point by point, the saved
champions.

```bash
cat models/<id>/checkpoint.json | jq '{round, trainingGames, accepted, sigma, savedAt}'
jq -c '[.trainingGames, .meanPointShare, .best]' models/<id>/curve.jsonl
tail -n 3 models/<id>/sweep.jsonl
ls models/<id>/snapshots models/<id>/milestones
```

`model.json` is rewritten at every curve point with the best champion so far, marked
`provisional`, so a run in progress is already playable in the arena. The final save overwrites it.

### 4. The process

Is a trainer running, and which one? And how loaded is the machine (compare the load average
with the core count)?

```bash
pgrep -fl "scripts/train"
uptime
```

Stop a run cleanly (resume it later with `--resume`):

```bash
pkill -f "scripts/train-full.ts"
```

A trainer uses `--workers` threads; do not start two on a machine with 12 cores unless you lower it.

---

## 10. Experiments and the lab notebook

The unit of work is one experiment: **one change**, measured against the current champion on
fixed maps, recorded in a notebook entry and on its GitHub issue. The full routine, with the
naming contract, the verdict rules and the common mistakes, is in
`.claude/skills/model-experiment/SKILL.md`; the notebook format is in `experiments/README.md`.

In short:

1. Worktree from `main` (section 8), branch `model/<id>`, log `logs/<id>.log`.
2. Open `experiments/NN-<slug>` from `experiments/TEMPLATE` **before the first run**: fill
   `experiment.json` and the first three report sections (question and hypothesis, mechanism,
   setup). The prediction is written before the result is known.
3. Code the mechanism, off by default (section 3), `npm run engine:build`,
   `cargo test --release -p polycore bot_full`, `npx tsc --noEmit -p .`.
4. Start the dashboard, then **sweep** (3 to 5 values about 2x apart, including a weak one).
5. Verdict. **Kept** when the final test against the base has a finish score and points above 50%
   with the +/-5% interval clear of 50%, and the best point's panel mean is at least the base's; or
   when the panel finish mean beats the base's by more than 1.5 points and the head to head is not
   worse. Otherwise **not kept**: the code still merges (off by default) and the next step starts
   from the unchanged base.
6. Fill the rest of the report, set `headline`, `verdict`, `status`, `result` in
   `experiment.json`, and build it.

One experiment (`generated.tex` and `report.pdf`):

```bash
npm run experiment:report -- 06-peace-break
```

Every experiment and `experiments/notebook.pdf`; with `--no-pdf` added, only the `generated.tex`
files:

```bash
npm run experiment:report -- --all
```

PDFs need `tectonic`. The dashboard rebuilds a PDF whenever its sources change. Report prose
copies its numbers from the generated tables, never from memory.

The experiments so far: `01-defend-cities` to `11-economy-plus-noise`.

---

## 11. Datasets and the Python environment

### Dataset of decisions

```bash
npm run export-dataset -- --out data/datasets/all.jsonl
```

Add `--only-humans` to keep only the decisions of human players.

One JSON line per decision: `game, step, player, seat, obs, legal, action, actionIndex,
finalScore, won`. Observations are recomputed by replaying each record through the current
`observe()`, so a dataset always matches the current channels. `data/datasets/` is not in git.

### Python

`engine/py` builds the Rust engine as a Python module `polyengine` with `VecEnv`, a vectorised
environment that runs n games in parallel with the GIL released:

Build `engine/py/polyengine.so`, make the virtual environment with numpy (once), then run the
smoke test:

```bash
engine/py/build.sh
python3 -m venv engine/py/.venv && engine/py/.venv/bin/pip install numpy
engine/py/.venv/bin/python engine/py/test_env.py
```

```python
import sys; sys.path.insert(0, "engine/py"); import polyengine
env = polyengine.VecEnv(8, '{"mode":"perfection","mapSize":11,"players":2,"mapType":"drylands"}', 1)
obs = env.reset()                       # float32 bytes, shape (n, channels, N, N)
obs, rewards, dones = env.step([0] * 8) # each env applies its learner's legal action number
```

The learner is player 0 (change with `learner=`) and always the game's human seat (human capital
income, as in the app; `humans` in the options is ignored), everyone else is the greedy bot; the reward is
+1 for a win, -1 for a loss or elimination (`shaping=True` adds a score-difference term). See
`engine/py/README.md` for every method, and `docs/shardlands/RL.md` for the action and
observation format.

---

## 12. Lecture notes (Emacs)

`lecture-notes/` holds one Org page per course concept, in the manner of Olivier Danvy's lecture
notes: the concept is stated, turned into a small OCaml program about a Polytopia situation,
unit tested, run and looked at. **Every number, table, transcript and picture on a page is
computed by the code on that page when it is built; nothing is typed in by hand.**

The worked example is `lecture-notes/rl-02_value-iteration.org`. The full authoring guide is
`.claude/skills/lecture-note/SKILL.md`.

### Requirements

GNU Emacs with Org 9.6 or later, `ocaml` on the PATH, the app's `node_modules` (a real
directory, not a symlink), Google Chrome at its macOS path. Notes are in OCaml.

### Build

```bash
emacs --batch -l lecture-notes/build.el
```

Run it from the repository root. It is the only way to build: loading `build.el` builds every
note straight away, so do not `load-file` it in a running Emacs. To run it from inside Emacs, use
`M-x compile` with the repository root as the current directory and that command.

For each note named `<course>-<NN>_<slug>.org` (course code in lower case: `as`, `rl`, `ml`,
`sr`, `nli`; `NN` the lecture number in two digits) the build:

1. deletes `_build/snippets/` and writes it afresh;
2. **tangles** the `ocaml` blocks into `_build/<name>.ml`;
3. **runs that file with `ocaml`**: the unit tests are `assert`s, so a failing test stops the
   build with `<file> does not pass its unit tests` and the OCaml message;
4. **exports** `_build/<name>.html`: every `toplevel` block is replaced by the real OCaml session
   (`# phrase;;` and the answer), every `scene` block by a PNG of the game scene.

A build takes one to two minutes, because it rebuilds every note and retakes every picture. The
first build after the app or its art changed exports the web build of the app into
`lecture-notes/_build/app` (about half a minute); delete that folder after changing
`app/scene.tsx` or the game's art so it is exported again. Pictures are taken by headless Chrome
from a small file server on port 8099, which the build starts if it is not running; leave it
alone.

Output (`lecture-notes/_build/`, ignored by git): `<name>.html`, `<name>.ml`, `<pic>.png` per
picture, `pictures.ml`, `snippets/`, `app/`. A deleted note's outputs are not removed by a build;
delete them by hand.

### Serve and read

Is the server already running? If this answers, a rebuild needs no restart:

```bash
curl -s -m 2 http://127.0.0.1:8097/explanations.json
```

Otherwise start it (this computer only; a port number may follow, the default is 8097), then
open `http://localhost:8097/<name>.html`:

```bash
/usr/bin/python3 lecture-notes/serve.py
```

Served this way every OCaml box has an "explain the syntax" button. The first click asks Claude
Sonnet once in the terminal (`claude -p`, no tools) and saves the answer to
`lecture-notes/explanations/<id>.md`, which is committed; later visits show the saved answer. An
explanation belongs to the exact code of its box: change the code and the button returns, and the
old file can be deleted. Delete a file to redo it.

To look at a page without a browser:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --virtual-time-budget=10000 --window-size=1150,3000 \
  --screenshot=/tmp/page.png "http://127.0.0.1:8097/<name>.html"
```

### The shape of a note

```org
#+TITLE: Value iteration, or how many turns to that village?
#+COURSE: Reinforcement Learning
#+UP: Lecture Notes, Week 02
#+PREVIOUS: The Bellman operator is a contraction
#+NEXT: Policy iteration
#+PROPERTY: header-args:ocaml :tangle _build/rl-02_value-iteration.ml :mkdirp yes :eval no
#+PROPERTY: header-args:toplevel :exports results :results verbatim
#+PROPERTY: header-args:scene :exports results :results raw
```

Copy the header of the example and change the title, the keywords and the file name in the
`:tangle` line (it must be `_build/<name of the note>.ml`). Three kinds of block:

| Block | On the page | Rules |
|---|---|---|
| `ocaml` | shown, and written to `_build/<name>.ml` | every phrase ends with `;;`; `:exports none` hides it (the picture helper at the end) |
| `toplevel` | replaced by the session | phrases only, each ending with `;;`; they run after the whole file is loaded |
| `scene :pic <name>` | replaced by `_build/<name>.png` | one OCaml expression that evaluates to a scene, no `;;`; start `<name>` with the note's prefix |

Write each piece in this order: the unit-test function, the function, `let () = assert (test_f f);;`,
a `toplevel` block that runs it, a paragraph starting "In words:" that says what the answer
shows, then a picture where one helps. A figure in the prose must appear in a transcript on the
same page; otherwise add the phrase that computes it, or cut the sentence.

### Pictures

A note defines a small `picture` function on top of `scene` in a hidden block at the end (see the
example), with `#use "pictures.ml";;`. `scene ?label ?path ?piece ?marks ?axes rows`:

| Argument | Meaning |
|---|---|
| `rows` | the map as a `string array`, one character per tile: `.` field, `F` forest, `M` mountain, `~` water, `V` village |
| `label` | `(x, y) -> string option`: what to write on a tile |
| `path` | tiles joined by a red line, in order |
| `piece` | a unit on a tile, `("rider", (0, 5))`; the kinds are the keys of `UNIT_SPRITES` in `components/art/Art.tsx` (`warrior`, `rider`, `archer`, `defender`, `swordsman`, `knight`, `catapult`, ...) |
| `axes` | number the columns above and the rows on the left |
| `marks` | a list of marks, below |

| Mark | Draws |
|---|---|
| `Across "width = 8"` | a two-headed arrow over all columns |
| `Down "height = 6"` | a two-headed arrow over all rows |
| `Beside ((7, 0), "village")` | an outline on the tile and an arrow to it from the right margin |
| `Below ((0, 5), "the rider")` | an outline on the tile and an arrow to it from below the map |
| `Outlined (tiles, "words")` | these tiles tinted, one arrow from the right margin |

A mark names a thing from the code and its numbers are computed
(`Across (Printf.sprintf "width = %d" width)`), never typed. Words are plain ASCII without double
quotes or backslashes. Two `Beside` or `Outlined` marks on the same row overlap, and so do two
`Below` marks in neighbouring columns: use different rows or two pictures. A tile is `(x, y)`:
column from the left, row from the top, both from 0. A new terrain letter or kind of mark goes in
`app/scene.tsx`, `pictures.ml` and `notes-scene-margin` in `build.el`.

After building, **open each new PNG** in `lecture-notes/_build/`: a picture can build and still
show the wrong thing. A picture of a few kilobytes shows "Loading the game engine..."; the build
retakes these and fails after 8 tries, so run it again.

### Editing in Emacs

An `.org` file is plain Org, so edit it in Emacs as usual. `C-c C-v t` (`org-babel-tangle`) writes
the `ocaml` blocks to `lecture-notes/_build/<name>.ml`, and
`(cd lecture-notes/_build && ocaml <name>.ml)` checks the unit tests quickly without the pictures
(it must run in `_build/`, where the build copies `pictures.ml`). The `toplevel` and `scene` blocks have no
meaning outside the batch build.

### Local only

The pictures use the game's sprites, which are official Polytopia art. They stay in
`lecture-notes/_build/` and are never committed, uploaded, published or sent to an outside service.
The same holds for the course PDFs: cite page numbers and paraphrase. The app is deployed from
`main`, so `app/scene.tsx` shows a sentence instead of a scene on any host except `127.0.0.1` and
`localhost`.

### Common errors

| Symptom | Cause and fix |
|---|---|
| `... does not pass its unit tests:` | a unit test failed; the OCaml message follows |
| `The toplevel answered N phrases out of M` | a `toplevel` block has a phrase without `;;`, or a phrase that raised; run it by hand: `cd lecture-notes/_build && ocaml -init <name>.ml` |
| "No routes found" while exporting the app | `node_modules` is a symlink: `cp -c -R <main checkout>/node_modules node_modules` |
| `No scene server at http://127.0.0.1:8099/scene/` | the picture server did not start; check that nothing else holds 8099 |
| a picture of a few KB | the game engine was still loading; run the build again |
| a note is missing | the file name does not match `<course>-<NN>_<slug>.org` |

---

## 13. Git workflow

- **One branch per model**: a new trained model or experiment lives on `model/<id>`, cut from
  `main` in its own worktree (`.claude/worktrees/<id>`), and merges into `main` by pull request.
  The model folder is committed either way, kept or not: it is the experiment's record.
- Commit the code, `models/<id>/` (with `train.log`, without `checkpoint.json`) and the notebook
  folder; the PR carries the result table and `Closes #<issue>`.
- `data/` is tracked, so arena runs show up as changes (new recordings, ratings). Commit them on
  purpose, not by accident.
- Remove the worktree when the PR is merged: `git worktree remove .claude/worktrees/<id>`.

---

## 14. Tests and checks

| Command | What it does |
|---|---|
| `npm run test:ci` | jest once, on the Rust engine (needs `npm run engine:build` first) |
| `npm test` | jest in watch mode |
| `npx jest __tests__/engine/bot-full.test.ts` | one test file |
| `npx tsc --noEmit -p .` | the type check |
| `npm run lint` | `expo lint` (the repository has no ESLint configuration yet) |
| `(cd engine && cargo test --release)` | the Rust unit tests |
| `node -r sucrase/register scripts/dev/smoke.ts` | bot games on every map type, checking that every action was legal |
| `node -r sucrase/register scripts/dev/mapstats.ts 16 4 drylands` | map density statistics |

The usual three before a pull request:

```bash
npm run test:ci
npx tsc --noEmit -p .
(cd engine && cargo test --release)
```

`__tests__/engine/` holds the parity suites (movement and combat, economy and scoring, special
tribes, diplomacy, the 2.18 rules audit) and the rules-data checks; `__tests__/logic/` the arena
and SPRT tests; `__tests__/app/` the Analyse and home page tests.

---

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module .../engine/node/polyengine.node` or a build hint from `logic/engine/rust.ts` | `npm run engine:build` |
| the browser shows the engine failing to load | `public/polyengine.wasm` is missing or old: `npm run engine:build` |
| a trainer is slow or the Mac is hot | lower `--workers`; check `uptime` against the core count |
| `--players must be even` | the trainers play two sides on alternate seats |
| `--resume: no checkpoint at ...` | the run was never started with this `--id` in this folder, or its checkpoint was deleted |
| a challenger never gets kept | sigma too small for the test to see a change (floor 0.05 stalled a climb); raise `--sigma-min`, or use a sweep instead |
| a new knob never moves in training | it started at 0 and nudges are multiplicative: `--init knob=value` and `--focus knob` |
| the dashboard shows no run | `--root` points at the wrong folder, or there is no checkpoint, log with a model, or sweep yet |
| port already in use | find it with `lsof -ti tcp:<port>`; `relaunch-preview.sh` kills 8090 and 8091 itself |
| LLM model plays like greedy-v1 | LM Studio is off or the model is not loaded; the model falls back to `greedy-v1` |
| arena results differ between runs | the default `--seed` is time based; pass `--seed` to repeat a run |
| Elo looks wrong after hand edits to `data/` | `npm run elo -- --rebuild` refits from every recorded game |

---

## 16. Further reading

| File | Content |
|---|---|
| `docs/shardlands/RULES.md` | the game rules, with section numbers to cite |
| `POLYTOPIA_RULES.md` | the rules as compiled from the Polytopia wiki |
| `docs/shardlands/ARENA.md` | models, recordings, Elo, and the hill-climbing history (v1 to v4) |
| `docs/shardlands/RL.md` | the engine API for RL: actions, observation planes, the Python environment |
| `docs/shardlands/PLAN.md` | the original build plan and standing rules |
| `docs/RUST_ENGINE_ROADMAP.md`, `engine/PROGRESS.md`, `engine/PORTING.md` | the Rust migration, its done criteria and the contract |
| `docs/RULES_PARITY.md` | rule parity with the game |
| `experiments/README.md` | the notebook format and report sections |
| `.claude/skills/model-experiment/SKILL.md` | the experiment routine, verdict rules, common mistakes |
| `.claude/skills/lecture-note/SKILL.md` | how to write and build a lecture note |
| `.claude/skills/refer-to-lecture/SKILL.md` | citing EMAI course material (the course PDFs are not in the repository) |
