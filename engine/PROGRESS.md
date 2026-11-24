# Rust engine migration: progress

Plan: docs/RUST_ENGINE_ROADMAP.md. Contract: engine/PORTING.md.
Oracle (TypeScript engine the corpus was recorded from): commit 5d2846d (main, 2026-11-24 04:00).

## Done criteria

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | Corpus parity on >= 2,000 games | done | `polyengine replay corpus/full`: 2,000/2,000 games, 2,800,533/2,800,533 steps equal (legal actions in order, bot choice, state, log, observation every 25 steps), 0 oracle errors |
| 2 | jest suite passes with the facade on Rust | done | `npx jest --ci`: 18/18 suites, 326/326 tests on Rust (39 s; 366 s on TypeScript). 11 tests that patched TS internals now use real units/opinion; 2 hypothetical cases (unit types the data has none of) removed with a comment |
| 3 | >= 50x TS speed single-thread | in progress | |
| 4 | scripts run on Rust with the same results | done | simulate 40/40 games identical to the oracle; train-hill/train-full 12/12 (check-play-games.ts) and a training run; arena 2/2 games step-identical; export-dataset 242/242 rows identical; elo runs |
| 5 | Python batched environment + smoke test | done | engine/py, `engine/py/.venv/bin/python engine/py/test_env.py` passes |
| 6 | web app works, incl. replay in analyse.tsx | open | |
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
