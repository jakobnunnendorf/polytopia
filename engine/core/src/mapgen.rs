//! Port of logic/engine/mapgen.ts. STUB: agent A fills the bodies; keep the signatures.
#![allow(unused)]
use crate::rng::Rng;
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapType {
    Drylands,
    Lakes,
    Continents,
    Pangea,
    Archipelago,
    Waterworld,
}

impl MapType {
    pub const ALL: [MapType; 6] = [MapType::Drylands, MapType::Lakes, MapType::Continents, MapType::Pangea, MapType::Archipelago, MapType::Waterworld];
    pub fn id(self) -> &'static str {
        ["drylands", "lakes", "continents", "pangea", "archipelago", "waterworld"][self as usize]
    }
    pub fn from_id(s: &str) -> Option<MapType> {
        MapType::ALL.into_iter().find(|m| m.id() == s)
    }
}

pub struct GeneratedMap {
    pub tiles: Vec<Tile>,
    pub capitals: Vec<Coord>,
    pub villages: Vec<Coord>,
}

/// mapgen.ts MapOptions; None = option not given
#[derive(Clone, Debug, Default)]
pub struct MapOptions {
    pub start_resources: Option<Vec<Vec<Resource>>>,
    pub water_start: Option<Vec<bool>>,
    pub flooded: Option<Vec<bool>>,
    pub spores: Option<Vec<bool>>,
    pub polaris: Option<Vec<bool>>,
    /// the climate's identity (the tribe id string)
    pub climates: Option<Vec<String>>,
}

/// per-player tribe modifiers, indexed by ModKey (None = key absent)
pub type Mods = [Option<f64>; ModKey::COUNT];

pub fn ruin_count(size: i32) -> i32 {
    todo!()
}
pub fn generate_map(rng: &mut Rng, n: i32, players: i32, map_type: MapType, mods: &[Mods], opts: &MapOptions) -> GeneratedMap {
    todo!()
}
