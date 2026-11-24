//! Port of logic/engine/state.ts. STUB: agent C fills the bodies; keep the signatures.
//! Functions returning a city or unit return its index into `s.cities` / `s.units`.
#![allow(unused)]
use crate::mapgen::MapType;
use crate::rng::Rng;
use crate::types::*;

/// state.ts NewGameOptions; None = not given
#[derive(Clone, Debug)]
pub struct NewGameOptions {
    pub map_size: Option<i32>,
    pub players: i32,
    pub mode: GameMode,
    pub difficulty: Option<Difficulty>,
    pub seed: i64,
    pub humans: Option<Vec<i32>>,
    pub map_type: Option<MapType>,
    pub clans: Option<Vec<Tribe>>,
    pub turn_limit: Option<i32>,
}

impl NewGameOptions {
    /// from the JSON shape of state.ts NewGameOptions
    pub fn from_json(v: &serde_json::Value) -> Result<NewGameOptions, String> {
        let o = v.as_object().ok_or("options: expected an object")?;
        let int = |k: &str| -> Result<Option<i64>, String> {
            match o.get(k) {
                None | Some(serde_json::Value::Null) => Ok(None),
                Some(x) => match x.as_f64() {
                    Some(f) if f.fract() == 0.0 => Ok(Some(f as i64)),
                    _ => Err(format!("{k}: expected an integer")),
                },
            }
        };
        let s = |k: &str| o.get(k).and_then(|x| x.as_str());
        Ok(NewGameOptions {
            map_size: int("mapSize")?.map(|x| x as i32),
            players: int("players")?.ok_or("players missing")? as i32,
            mode: GameMode::from_id(s("mode").ok_or("mode missing")?).ok_or("unknown mode")?,
            difficulty: match s("difficulty") {
                None => None,
                Some(d) => Some(Difficulty::from_id(d).ok_or("unknown difficulty")?),
            },
            seed: int("seed")?.ok_or("seed missing")?,
            humans: match o.get("humans") {
                None | Some(serde_json::Value::Null) => None,
                Some(a) => Some(a.as_array().ok_or("humans: array")?.iter().map(|x| x.as_i64().unwrap_or(-1) as i32).collect()),
            },
            map_type: match s("mapType") {
                None => None,
                Some(m) => Some(MapType::from_id(m).ok_or("unknown map type")?),
            },
            clans: match o.get("clans") {
                None | Some(serde_json::Value::Null) => None,
                Some(a) => Some(
                    a.as_array()
                        .ok_or("clans: array")?
                        .iter()
                        .map(|x| x.as_str().and_then(Tribe::from_id).ok_or_else(|| format!("unknown clan {x}")))
                        .collect::<Result<_, _>>()?,
                ),
            },
            turn_limit: int("turnLimit")?.map(|x| x as i32),
        })
    }
}

pub fn map_size_for(mode: GameMode, opponents: i32) -> Option<i32> {
    todo!()
}
pub fn map_size_allowed(mode: GameMode, map_size: i32) -> bool {
    todo!()
}
#[inline]
pub fn difficulty_of(s: &GameState) -> Difficulty {
    s.difficulty.unwrap_or(Difficulty::Normal)
}
/// state.ts withRng: draw from the state's generator and store it back
#[inline]
pub fn with_rng<T>(s: &mut GameState, f: impl FnOnce(&mut Rng) -> T) -> T {
    let mut r = Rng::from_state(s.rng);
    let out = f(&mut r);
    s.rng = r.state();
    out
}
/// state.ts log: `T${turn} P${current}: ${msg}`, at most 200 lines
pub fn log(s: &mut GameState, msg: &str) {
    s.log.push(format!("T{} P{}: {}", s.turn, s.current, msg));
    if s.log.len() > 200 {
        let cut = s.log.len() - 200;
        s.log.drain(..cut);
    }
}
pub fn city_by_id(s: &GameState, id: Option<Id>) -> Option<usize> {
    todo!()
}
pub fn cities_of(s: &GameState, p: i32) -> Vec<usize> {
    todo!()
}
pub fn capital_of(s: &GameState, p: i32) -> Option<usize> {
    todo!()
}
pub fn explore(s: &mut GameState, p: i32, c: Coord, r: i32) {
    todo!()
}
pub fn claim_territory(s: &mut GameState, ci: usize, r: i32) {
    todo!()
}
pub fn add_pop(s: &mut GameState, ci: usize, n: i32) {
    todo!()
}
pub fn units_homed_in(s: &GameState, city: &City) -> i32 {
    todo!()
}
pub fn unit_capacity(city: &City) -> i32 {
    todo!()
}
pub fn city_income(s: &GameState, c: &City) -> i32 {
    todo!()
}
pub fn under_siege(s: &GameState, c: &City) -> bool {
    todo!()
}
pub fn ice_bank_level(s: &GameState) -> i32 {
    todo!()
}
pub fn resource_visible(s: &GameState, p: i32, r: Resource) -> bool {
    todo!()
}
pub fn income(s: &GameState, p: i32) -> i32 {
    todo!()
}
pub fn tech_cost(s: &GameState, p: i32, tech: Tech) -> i32 {
    todo!()
}
pub fn can_research(s: &GameState, p: i32, tech: Tech) -> bool {
    todo!()
}
pub fn score_of(s: &GameState, p: i32) -> i32 {
    todo!()
}
pub fn city_score(c: &City) -> i32 {
    todo!()
}
pub fn perfection_rating(s: &GameState, p: i32) -> f64 {
    todo!()
}
pub fn domination_rating(s: &GameState, p: i32) -> f64 {
    todo!()
}
pub fn domination_stars(rating: f64) -> i32 {
    todo!()
}
pub fn perfection_stars(rating: f64) -> i32 {
    todo!()
}
pub fn update_connections(s: &mut GameState, p: i32) {
    todo!()
}
pub fn check_tasks(s: &mut GameState, p: i32) {
    todo!()
}
pub fn check_meetings(s: &mut GameState) {
    todo!()
}
pub fn meet(s: &mut GameState, p: i32, other: i32) {
    todo!()
}
/// pushes the new unit onto s.units and returns its index
pub fn make_unit(s: &mut GameState, ty: UnitType, owner: i32, at: Coord, home_city: Option<Id>) -> usize {
    todo!()
}
/// state.ts pushUnit(s, u, spawner); `ui` indexes s.units. Returns false when the unit was removed.
pub fn push_unit(s: &mut GameState, ui: usize, spawner: i32) -> bool {
    todo!()
}
pub fn check_elimination(s: &mut GameState) {
    todo!()
}
pub fn leader(s: &GameState) -> Option<i32> {
    todo!()
}
pub fn check_game_end(s: &mut GameState, turn_ended: bool) {
    todo!()
}
/// pushes the new city onto s.cities and returns its index
pub fn new_city(s: &mut GameState, at: Coord, owner: i32) -> usize {
    todo!()
}
pub fn create_game(opts: &NewGameOptions) -> Result<GameState, String> {
    todo!()
}
pub fn start_turn(s: &mut GameState) {
    todo!()
}
pub fn grow_units(s: &mut GameState, p: i32) {
    todo!()
}
/// (city index, its two reward options)
pub fn pending_reward(s: &GameState) -> Option<(usize, [Reward; 2])> {
    todo!()
}
