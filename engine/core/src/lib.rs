//! Shardlands rules engine: a bit-exact Rust port of logic/engine.
//!
//! Module map (Rust module <- TypeScript file):
//! data_gen (generated) + data <- data.ts, rng <- rng.ts, grid <- grid.ts,
//! names <- names.ts, mapgen <- mapgen.ts, diplomacy <- diplomacy.ts,
//! combat <- combat.ts, movement <- movement.ts, opinion <- opinion.ts,
//! state <- state.ts, actions <- actions.ts, bot <- bot.ts, observe <- observe.ts.
//! json and canon convert to and from the TypeScript JSON shape.

pub mod canon;
pub mod data_gen;
pub mod grid;
pub mod json;
pub mod rng;
pub mod types;
