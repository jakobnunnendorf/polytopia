//! Shardlands rules engine: a bit-exact Rust port of logic/engine.
//!
//! Module map (Rust module <- TypeScript file):
//! data_gen (generated) + data <- data.ts, rng <- rng.ts, grid <- grid.ts,
//! mapgen <- mapgen.ts, diplomacy <- diplomacy.ts, combat <- combat.ts,
//! movement <- movement.ts, opinion <- opinion.ts, state <- state.ts,
//! actions <- actions.ts, bot <- bot.ts, observe <- observe.ts.
//! json and canon convert to and from the TypeScript JSON shape.
//! names.ts is display text for the app and stays in TypeScript.

pub mod actions;
pub mod bot;
pub mod bot_full;
pub mod canon;
pub mod combat;
pub mod data;
pub mod data_gen;
pub mod diplomacy;
pub mod grid;
pub mod json;
pub mod mapgen;
pub mod movement;
pub mod observe;
pub mod opinion;
pub mod rng;
pub mod state;
pub mod types;
