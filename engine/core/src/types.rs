//! Game state and actions: a field-for-field mirror of logic/engine/types.ts.
//!
//! Ids from data.ts are enums (data_gen.rs). Every number in the TypeScript
//! state is an integer, so numbers are i32 here; json.rs refuses a JSON state
//! with a fractional number rather than rounding it. Optional TypeScript
//! booleans are plain bools (absent == false in the canonical form); optional
//! numbers and arrays are Options, so "absent" survives a round trip.

pub use crate::data_gen::*;

pub type Id = i32;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Coord {
    pub x: i32,
    pub y: i32,
}

impl Coord {
    #[inline]
    pub const fn new(x: i32, y: i32) -> Coord {
        Coord { x, y }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tile {
    pub terrain: Terrain,
    pub resource: Option<Resource>,
    pub building: Option<Build>,
    pub building_level: i32,
    pub built_turn: i32,
    pub road: bool,
    pub city_id: Option<Id>,
    pub village: bool,
    pub ruin: bool,
    pub lighthouse: bool,
    pub territory: Option<Id>,
    pub ice: bool,
    pub polar: bool,
    pub algae: bool,
    pub flooded: bool,
    pub lost_city: bool,
    pub decomposing: bool,
}

impl Tile {
    pub fn new(terrain: Terrain) -> Tile {
        Tile {
            terrain,
            resource: None,
            building: None,
            building_level: 0,
            built_turn: 0,
            road: false,
            city_id: None,
            village: false,
            ruin: false,
            lighthouse: false,
            territory: None,
            ice: false,
            polar: false,
            algae: false,
            flooded: false,
            lost_city: false,
            decomposing: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Unit {
    pub id: Id,
    /// TS `type`
    pub ty: UnitType,
    pub carried: Option<UnitType>,
    pub owner: i32,
    pub x: i32,
    pub y: i32,
    pub hp: i32,
    pub max_hp: i32,
    pub kills: i32,
    pub veteran: bool,
    pub home_city: Option<Id>,
    pub can_move: bool,
    pub can_attack: bool,
    pub moved: bool,
    pub attacked: bool,
    pub done: bool,
    pub idle: bool,
    pub hidden: bool,
    pub last_dir: Option<Coord>,
    pub frozen: bool,
    pub poisoned: bool,
    pub swarmed: bool,
    pub bubble: bool,
    pub second_attack: bool,
    pub body_of: Option<Id>,
    pub created_turn: Option<i32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct City {
    pub id: Id,
    pub name: String,
    pub owner: i32,
    pub x: i32,
    pub y: i32,
    pub level: i32,
    pub pop: i32,
    pub capital: bool,
    pub original_capital_of: Option<i32>,
    pub walls: bool,
    pub workshop: bool,
    pub parks: i32,
    pub connected: bool,
    pub riot: bool,
    pub pending_rewards: Vec<i32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Player {
    pub id: i32,
    /// TS `clan`
    pub tribe: Tribe,
    pub stars: i32,
    pub techs: Vec<Tech>,
    /// row-major, 1 = seen
    pub explored: Vec<u8>,
    pub alive: bool,
    pub bot: bool,
    pub kills: i32,
    pub losses: i32,
    pub met: Vec<i32>,
    /// turn number on which each tribe in `met` was met (same order; shorter in states saved before it existed)
    pub met_turns: Vec<i32>,
    pub tasks: Vec<Task>,
    pub monuments: Vec<Build>,
    pub pacifist_turns: i32,
    pub attacked_this_turn: bool,
    pub lighthouses: Vec<i32>,
    pub embassies: Vec<i32>,
    pub capital_id: Id,
    pub conversions: Option<i32>,
    pub built_unique: Option<Vec<Build>>,
}

impl Player {
    #[inline]
    pub fn has_tech(&self, t: Tech) -> bool {
        self.techs.contains(&t)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameMode {
    Perfection,
    Domination,
    Creative,
    Glory,
    Might,
}

impl GameMode {
    pub const ALL: [GameMode; 5] = [GameMode::Perfection, GameMode::Domination, GameMode::Creative, GameMode::Glory, GameMode::Might];
    pub fn id(self) -> &'static str {
        ["perfection", "domination", "creative", "glory", "might"][self as usize]
    }
    pub fn from_id(s: &str) -> Option<GameMode> {
        GameMode::ALL.into_iter().find(|m| m.id() == s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Difficulty {
    Easy,
    Normal,
    Hard,
    Crazy,
}

impl Difficulty {
    pub const ALL: [Difficulty; 4] = [Difficulty::Easy, Difficulty::Normal, Difficulty::Hard, Difficulty::Crazy];
    pub fn id(self) -> &'static str {
        ["easy", "normal", "hard", "crazy"][self as usize]
    }
    pub fn from_id(s: &str) -> Option<Difficulty> {
        Difficulty::ALL.into_iter().find(|m| m.id() == s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Offer {
    pub from: i32,
    pub to: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AttackRecord {
    pub by: i32,
    pub on: i32,
    pub turn: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ceasefire {
    pub breaker: i32,
    pub victim: i32,
    pub until: i32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Diplomacy {
    /// pairs at peace, [low id, high id]
    pub peace: Vec<[i32; 2]>,
    pub offers: Vec<Offer>,
    pub attacks: Vec<AttackRecord>,
    pub ceasefires: Vec<Ceasefire>,
    /// [victim, breaker]
    pub broken: Vec<[i32; 2]>,
    /// [low id, high id, turn]: the last turn on which a treaty between the two was broken (bot opinion)
    pub broken_turns: Vec<[i32; 3]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GameState {
    pub seed: i64,
    /// the generator's 32-bit state (rng.rs)
    pub rng: u32,
    pub map_size: i32,
    pub mode: GameMode,
    pub difficulty: Option<Difficulty>,
    pub max_turns: i32,
    pub turn: i32,
    pub current: i32,
    pub tiles: Vec<Tile>,
    pub units: Vec<Unit>,
    pub cities: Vec<City>,
    pub players: Vec<Player>,
    pub next_id: Id,
    pub winner: Option<i32>,
    pub over: bool,
    pub log: Vec<String>,
    pub diplomacy: Option<Diplomacy>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DrainEffect {
    Flooded,
    Algae,
}

/// logic/engine/types.ts Action; JSON field names in json.rs
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    EndTurn,
    Research { tech: Tech },
    Move { unit: Id, to: Coord },
    Attack { unit: Id, target: Id },
    Capture { unit: Id },
    Recover { unit: Id },
    Examine { unit: Id },
    Disband { unit: Id },
    Upgrade { unit: Id, to: UnitType },
    Promote { unit: Id },
    HealOthers { unit: Id },
    HarvestStarfish { unit: Id },
    Infiltrate { unit: Id, city: Id },
    Train { city: Id, unit: UnitType },
    Build { at: Coord, building: Build },
    Reward { city: Id, reward: Reward },
    FreezeArea { unit: Id },
    Swarm { unit: Id },
    Explode { unit: Id },
    BreakIce { unit: Id },
    Drain { unit: Id, effect: DrainEffect },
    Decompose { at: Coord },
    OfferPeace { player: i32 },
    AcceptPeace { player: i32 },
    DeclinePeace { player: i32 },
    BreakPeace { player: i32 },
}
