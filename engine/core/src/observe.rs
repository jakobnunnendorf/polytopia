//! Port of logic/engine/observe.ts. STUB: agent E fills the bodies; keep the signatures.
#![allow(unused)]
use crate::types::*;

/// observe.ts CHANNELS, in order
pub fn channels() -> &'static [&'static str] {
    todo!()
}

#[derive(Clone, Debug, PartialEq)]
pub struct Scalars {
    pub turn: i32,
    pub max_turns: i32,
    pub stars: i32,
    pub income: i32,
    pub score: i32,
    pub cities: i32,
    pub techs: Vec<f64>,
    pub tech_costs: Vec<f64>,
    pub opponents_alive: i32,
    pub relations: Vec<f64>,
    pub peace_offers: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub player: i32,
    pub map_size: i32,
    /// channels().len() × map_size × map_size values, channel-major like observe.ts
    pub planes: Vec<f32>,
    pub scalars: Scalars,
}

pub fn observe(s: &GameState, p: i32) -> Observation {
    todo!()
}

/// the JSON shape of observe.ts Observation (for parity checks against TypeScript)
pub fn observation_to_json(o: &Observation) -> serde_json::Value {
    todo!()
}
