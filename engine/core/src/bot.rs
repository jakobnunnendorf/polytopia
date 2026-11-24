//! Port of logic/engine/bot.ts. STUB: agent E fills the bodies; keep the signatures.
#![allow(unused)]
use crate::types::*;

/// bot.ts GreedyWeights; `rewards` indexed by Reward (None = key absent: TS `?? 1`)
#[derive(Clone, Debug, PartialEq)]
pub struct GreedyWeights {
    pub capture: f64,
    pub examine: f64,
    pub promote: f64,
    pub harvest_starfish: f64,
    pub monument: f64,
    pub kill: f64,
    pub hit: f64,
    pub special: f64,
    pub grow_base: f64,
    pub grow_per_pop: f64,
    pub other_build: f64,
    pub rich_at: f64,
    pub research: f64,
    pub train: f64,
    pub units_per_city: f64,
    pub move_: f64,
    pub recover: f64,
    pub heal_others: f64,
    pub upgrade: f64,
    pub noise: f64,
    pub rewards: [Option<f64>; Reward::COUNT],
}

impl GreedyWeights {
    /// bot.ts DEFAULT_WEIGHTS
    pub fn default_weights() -> GreedyWeights {
        todo!()
    }
    /// from the JSON shape of GreedyWeights (model.json "weights")
    pub fn from_json(v: &serde_json::Value) -> Result<GreedyWeights, String> {
        todo!()
    }
}

pub fn score_action(s: &GameState, a: &Action, w: &GreedyWeights) -> f64 {
    todo!()
}
pub fn bot_step(s: &GameState, w: &GreedyWeights) -> Action {
    todo!()
}
/// bot.ts playBotTurn, in place
pub fn play_bot_turn(s: &mut GameState, max_actions: i32, w: &GreedyWeights) {
    todo!()
}
