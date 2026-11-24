# Rust engine migration: progress

Plan: docs/RUST_ENGINE_ROADMAP.md. Contract: engine/PORTING.md.
Oracle (TypeScript engine the corpus was recorded from): commit 5d2846d (main, 2026-11-24 04:00).

## Done criteria

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | Corpus parity on >= 2,000 games | done | `polyengine replay corpus/full`: 2,000/2,000 games, 2,800,533/2,800,533 steps equal (legal actions in order, bot choice, state, log, observation every 25 steps), 0 oracle errors |
| 2 | jest suite passes with the facade on Rust | in progress | |
| 3 | >= 50x TS speed single-thread | in progress | |
| 4 | scripts run on Rust with the same results | in progress | |
| 5 | Python batched environment + smoke test | done | engine/py, `engine/py/.venv/bin/python engine/py/test_env.py` passes |
| 6 | web app works, incl. replay in analyse.tsx | open | |
| 7 | TS rules code deleted, thin facade | open | |

## Log

- Phase 0: corpus format (scripts/rust/trace-gen.ts), canonical hash (canon.ts / canon.rs), TS baseline 3,450 actions/s (40 games, 11x11, 2 players, one thread, M3 Pro, Node 25.9).
- Phases 1-4: generated data tables (scripts/rust/gen-data.ts), rng, JSON conversion, all rule modules ported by parallel agents, each verified against TS reference values (movement 898k checks, state 290k, bot 373k scores, bot_full 430k scores, observe 2.7k): 0 differences.
- Corpus fix: lines are written with JSON.stringify, since canon() dropped `humans: []` from the game settings.
- Observations keep exact f64 values (`planes_f32()` for RL); canon writes numbers like JavaScript; serde_json float_roundtrip.
- Bindings: engine/api (JSON `call(name, args)`), engine/node (N-API), engine/wasm (C ABI), engine/py (PyO3 VecEnv).
- Speed: tile-build checks hoisted out of the tile loop, occupant/owner looked up once per tile: 43% fewer instructions (3.74 G -> 2.13 G for the 40-game bench).
