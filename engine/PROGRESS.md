# Rust engine migration: progress

Contract: engine/PORTING.md (deleted after the migration; in git history, commit bb6ed13). (The migration plan, docs/RUST_ENGINE_ROADMAP.md, was deleted once all seven done criteria below held; it is in git history.)
Oracle (TypeScript engine the corpus was recorded from): commit 5d2846d (main, 2026-11-24 04:00).

## Done criteria

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | Corpus parity on >= 2,000 games | done | `polyengine replay corpus/full`: 2,000/2,000 games, 2,800,533/2,800,533 steps equal (legal actions in order, bot choice, state, log, observation every 25 steps), 0 oracle errors |
| 2 | jest suite passes with the facade on Rust | done | `npx jest --ci`: 18/18 suites, 326/326 tests on Rust (39 s; 366 s on TypeScript). 11 tests that patched TS internals now use real units/opinion; 2 hypothetical cases (unit types the data has none of) removed with a comment |
| 3 | >= 50x TS speed single-thread | done | scripts/rust/bench-compare.sh, 40 greedy bot games per setting, best of 3, 40/40 games identical to the oracle in every setting (M3 Pro, machine loaded by other jobs, load 24-36). One thread: 89x (11x11, 2 players), 61x (11x11, 4), 148x (16x16, 2), 131x (16x16, 4); against the idle TS baseline (3,450 actions/s) at least 57x. All 12 cores: 0.73-1.19 M actions/s, 333-737x one TS thread. See the table below |
| 4 | scripts run on Rust with the same results | done | simulate 40/40 games identical to the oracle; train-hill/train-full 12/12 (check-play-games.ts, deleted; in git history at bb6ed13) and a training run; arena 2/2 games step-identical; export-dataset 242/242 rows identical; elo runs |
| 5 | Python batched environment + smoke test | done | engine/py, `engine/py/.venv/bin/python engine/py/test_env.py` passes |
| 6 | web app works, incl. replay in analyse.tsx | done | Chrome on `expo start --web`: home page, new game (map, fog, rider, move tiles), a move, end turn with the bot's reply, tech tree and research, analyse rankings, replay of a 4-player arena game stepped forward; no console errors. Fix needed for it: constants are fetched lazily in the browser (`engineConstant`), and the server-side render finds the addon from the working directory |
| 7 | TS rules code deleted, thin facade | done | logic/engine 6,289 -> 1,899 lines; kept data.ts, types.ts, names.ts, rng.ts + rust.ts (loader), sync.ts; oracle = commit 5d2846d |

## Log

- Phase 0: corpus format (scripts/rust/trace-gen.ts), canonical hash (canon.ts / canon.rs), TS baseline 3,450 actions/s (40 games, 11x11, 2 players, one thread, M3 Pro, Node 25.9).
- Phases 1-4: generated data tables (scripts/rust/gen-data.ts), rng, JSON conversion, all rule modules ported by parallel agents, each verified against TS reference values (movement 898k checks, state 290k, bot 373k scores, bot_full 430k scores, observe 2.7k): 0 differences.
- Corpus fix: lines are written with JSON.stringify, since canon() dropped `humans: []` from the game settings.
- Observations keep exact f64 values (`planes_f32()` for RL); canon writes numbers like JavaScript; serde_json float_roundtrip.
- Bindings: engine/api (JSON `call(name, args)`), engine/node (N-API), engine/wasm (C ABI), engine/py (PyO3 VecEnv).
- Speed: tile-build checks hoisted out of the tile loop, occupant/owner looked up once per tile: 43% fewer instructions (3.74 G -> 2.13 G for the 40-game bench).
- Facade (logic/engine/*.ts over engine/api), jest on Rust, swap of the TS rules (cee0b9e).
- Scripts: train-hill, train-full and simulate play whole games with one Rust call (playGames); per-call facade costs ~3 ms per action (JSON of the full state both ways), so hot loops must use bulk calls.
- Engine line coverage by the 2,000-game corpus (TypeScript, jest --coverage, scripts/rust/coverage.sh): 96.4% of the rules code (actions 99.6%, state 96.2%, movement 92.1%, bot 93.9%; botFull 0% in the corpus but checked separately on 430k scores).
- Web: public/polyengine.wasm (680 KB, 232 KB gzipped) via `npm run engine:build`; app/_layout.tsx loads it before rendering. Native (Hermes) has no WebAssembly: iOS/Android builds show a notice; the app is web-only now.
- Final benchmark (2026-11-24, scripts/rust/bench-compare.sh, actions/s, one thread unless noted):

  | Map | Players | TypeScript | Rust | Speed-up | Rust, all 12 cores | vs one TS thread |
  |---|---|---|---|---|---|---|
  | 11x11 | 2 | 2,197 | 196,933 | 89x | 764,973 | 348x |
  | 11x11 | 4 | 3,579 | 221,868 | 61x | 1,193,937 | 333x |
  | 16x16 | 2 | 986 | 145,986 | 148x | 726,853 | 737x |
  | 16x16 | 4 | 1,161 | 152,288 | 131x | 806,544 | 694x |

- Web app: module-level engine constants (DEFAULT_WEIGHTS, CHANNELS, ...) were called at import time, before the browser had loaded the WebAssembly; they are now `engineConstant()` stand-ins that fetch on first use (PEACEFUL_TURNS is a literal, checked by a test). The addon loader also tries `<cwd>/engine/node/polyengine.node`, for the bundled server-side render.
