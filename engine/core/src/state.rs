//! Port of logic/engine/state.ts: game setup and the shared bookkeeping rules
//! (exploration, territory, population and levels, income, score, city
//! connections, tasks, meetings, elimination, game end).
//! Functions returning a city or unit return its index into `s.cities` / `s.units`.
use crate::data::*;
use crate::diplomacy::{at_peace, at_war};
use crate::grid::{around, dist, idx, in_bounds, is_water, tile_at, tile_at_mut};
use crate::mapgen::{generate_map, MapOptions, MapType, Mods};
use crate::movement::{can_see, follower_of, leader_of};
use crate::rng::{shuffle, Rng};
use crate::types::*;
use std::collections::{HashSet, VecDeque};

const CITY_NAMES: [&str; 35] = [
    "Ashford", "Brightwater", "Cinderholm", "Dunmere", "Elderglen", "Fallowmark", "Greystone",
    "Hollowell", "Ironbrook", "Juniper", "Kestrel", "Larkspur", "Mistvale", "Northwatch",
    "Oakhaven", "Pinecrest", "Quarrytown", "Redcliff", "Saltmarsh", "Thornbury", "Umberfield",
    "Valewick", "Westerby", "Yarrowby", "Zephyr Hill", "Amberleigh", "Briarwood", "Coldharbour",
    "Duskwater", "Emberly", "Foxhollow", "Glimmerdale", "Harrowgate", "Ivydown", "Kingsmoor",
];

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

/// Map size a mode forces: Perfection always 16; Domination by opponent count
/// 1 -> 11, 2 -> 14, 3 -> 16, 4+ -> 18. None when the mode lets the player choose.
pub fn map_size_for(mode: GameMode, opponents: i32) -> Option<i32> {
    match mode {
        GameMode::Perfection => Some(16),
        GameMode::Domination => Some(if opponents <= 1 {
            11
        } else if opponents == 2 {
            14
        } else if opponents == 3 {
            16
        } else {
            18
        }),
        _ => None,
    }
}
/// Huge (20) and Massive (30) maps exist only in Creative and the multiplayer modes
pub fn map_size_allowed(mode: GameMode, map_size: i32) -> bool {
    map_size <= 18 || matches!(mode, GameMode::Creative | GameMode::Glory | GameMode::Might)
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
    let id = id?;
    s.cities.iter().position(|c| c.id == id)
}
#[inline]
fn city_owner(s: &GameState, id: Option<Id>) -> Option<i32> {
    city_by_id(s, id).map(|ci| s.cities[ci].owner)
}
pub fn cities_of(s: &GameState, p: i32) -> Vec<usize> {
    (0..s.cities.len()).filter(|&i| s.cities[i].owner == p).collect()
}
pub fn capital_of(s: &GameState, p: i32) -> Option<usize> {
    s.cities.iter().position(|c| c.owner == p && c.capital)
}
/// reveal tiles around a coord for a player (§4.6)
pub fn explore(s: &mut GameState, p: i32, c: Coord, r: i32) {
    for q in around(s.map_size, c, r, true) {
        let i = idx(s.map_size, q.x, q.y);
        if s.players[p as usize].explored[i] == 1 {
            continue;
        }
        s.players[p as usize].explored[i] = 1;
        // lighthouse discovery: +1 population to the capital (§5.11)
        if s.tiles[i].lighthouse && !s.players[p as usize].lighthouses.contains(&(i as i32)) {
            s.players[p as usize].lighthouses.push(i as i32);
            let cap = capital_of(s, p).or_else(|| cities_of(s, p).first().copied());
            if let Some(ci) = cap {
                add_pop(s, ci, 1);
            }
        }
    }
}
/// claim unowned tiles within radius r of the city (§5.7)
pub fn claim_territory(s: &mut GameState, ci: usize, r: i32) {
    let (cx, cy, id) = (s.cities[ci].x, s.cities[ci].y, s.cities[ci].id);
    for q in around(s.map_size, Coord::new(cx, cy), r, true) {
        let t = tile_at_mut(s, q.x, q.y);
        if t.territory.is_none() || t.territory == Some(id) {
            t.territory = Some(id);
        }
    }
}
pub fn add_pop(s: &mut GameState, ci: usize, n: i32) {
    let city = &mut s.cities[ci];
    city.pop += n;
    while city.pop >= city.level + 1 {
        city.pop -= city.level + 1;
        city.level += 1;
        city.pending_rewards.push(city.level);
    }
}
pub fn units_homed_in(s: &GameState, city: &City) -> i32 {
    s.units.iter().filter(|u| u.home_city == Some(city.id) && u.owner == city.owner).count() as i32
}
pub fn unit_capacity(city: &City) -> i32 {
    city.level + 1
}
/// stars per turn of one city (§5.2), ignoring siege
pub fn city_income(s: &GameState, c: &City) -> i32 {
    let bonus = if !c.capital {
        0
    } else if s.players.get(c.owner as usize).map_or(false, |p| p.bot) {
        bot_capital_bonus(difficulty_of(s))
    } else {
        HUMAN_CAPITAL_BONUS
    };
    let neg = if c.pop < 0 { -c.pop } else { 0 };
    0.max(c.level + if c.workshop { 1 } else { 0 } + c.parks + bonus - neg)
}
/// an enemy unit stands in the city (a peace partner's unit does not besiege it)
pub fn under_siege(s: &GameState, c: &City) -> bool {
    s.units.iter().any(|u| u.x == c.x && u.y == c.y && u.owner != c.owner && !at_peace(s, u.owner, c.owner))
}
/// market stars: sum of adjacent own windmill/sawmill/forge levels (a level-0 one counts 1), capped (§5.5)
fn market_income(s: &GameState, p: i32) -> i32 {
    let n = s.map_size;
    let mut total = 0;
    for (i, t) in s.tiles.iter().enumerate() {
        if t.building != Some(Build::Market) {
            continue;
        }
        if city_owner(s, t.territory) != Some(p) {
            continue;
        }
        let pos = Coord::new(i as i32 % n, i as i32 / n);
        let mut sum = 0;
        for q in around(n, pos, 1, false) {
            let nt = tile_at(s, q.x, q.y);
            if city_owner(s, nt.territory) == Some(p) && matches!(nt.building, Some(Build::Windmill | Build::Sawmill | Build::Forge)) {
                sum += 1.max(nt.building_level);
            }
        }
        total += MARKET_CAP.min(sum);
    }
    total
}
/// Ice Bank level: one level per 20 tiles of ice or Polaris-climate land over the whole board, at most 30
pub fn ice_bank_level(s: &GameState) -> i32 {
    let count = s.tiles.iter().filter(|t| t.ice || (t.polar && !is_water(t))).count() as i32;
    30.min(count / 20)
}
/// Sanctuary 1★ per adjacent own tile with a wild animal and no building (at most 8);
/// Clathrus 1★ per adjacent own Fungi (at most 8); Ice Bank 2★ per level.
fn special_building_income(s: &GameState, p: i32) -> i32 {
    let n = s.map_size;
    let mut total = 0;
    for (i, t) in s.tiles.iter().enumerate() {
        let Some(b) = t.building else { continue };
        if city_owner(s, t.territory) != Some(p) {
            continue;
        }
        let pos = Coord::new(i as i32 % n, i as i32 / n);
        let own_around = || {
            around(n, pos, 1, false)
                .into_iter()
                .map(|q| tile_at(s, q.x, q.y))
                .filter(|nt| city_owner(s, nt.territory) == Some(p))
        };
        match b {
            Build::Sanctuary => {
                let k = own_around()
                    .filter(|nt| nt.resource == Some(Resource::Animal) && nt.building.is_none() && nt.city_id.is_none() && !nt.village)
                    .count() as i32;
                total += 8.min(k);
            }
            Build::IceBank => total += 2 * ice_bank_level(s),
            Build::Clathrus => {
                let k = own_around().filter(|nt| nt.building == Some(Build::Fungi)).count() as i32;
                total += 8.min(k);
            }
            _ => {}
        }
    }
    total
}
/// crops show only with Organization, metal only with Climbing, aqua crops only to Aquarion
pub fn resource_visible(s: &GameState, p: i32, r: Resource) -> bool {
    let pl = &s.players[p as usize];
    match r {
        Resource::AquaCrop => pl.tribe == Tribe::Aquarion,
        Resource::Crop => pl.has_tech(Tech::Organization),
        Resource::Metal => pl.has_tech(Tech::Climbing),
        _ => true,
    }
}
/// expected income for player p at the start of their next turn
pub fn income(s: &GameState, p: i32) -> i32 {
    let mut total = 0;
    for c in s.cities.iter().filter(|c| c.owner == p) {
        if under_siege(s, c) || c.riot {
            continue;
        }
        total += city_income(s, c);
    }
    total += market_income(s, p);
    total += special_building_income(s, p);
    // embassies pay both builder and host, double between peace partners, nothing while at war (2.18)
    for pl in &s.players {
        if !pl.alive {
            continue;
        }
        for &host in &pl.embassies {
            let host_alive = host >= 0 && s.players.get(host as usize).map_or(false, |h| h.alive);
            if !host_alive || at_war(s, pl.id, host) {
                continue;
            }
            let pay = if at_peace(s, pl.id, host) { 2 * EMBASSY_INCOME } else { EMBASSY_INCOME };
            if pl.id == p {
                total += pay;
            }
            if host == p {
                total += pay;
            }
        }
    }
    total
}
pub fn tech_cost(s: &GameState, p: i32, tech: Tech) -> i32 {
    let t = tech_def(tech);
    let cities = s.cities.iter().filter(|c| c.owner == p).count() as i32;
    let literacy = s.players[p as usize].has_tech(Tech::Philosophy);
    let base = 4 + t.tier * cities;
    // state.ts: Math.ceil(base * Math.fround(0.66666)) (no epsilon, unlike data.ts techCostFor)
    if literacy {
        ((base as f64) * (0.66666f32 as f64)).ceil() as i32
    } else {
        base
    }
}
/// a tech is researchable if its parent is owned, or one of its children (§1.1)
pub fn can_research(s: &GameState, p: i32, tech: Tech) -> bool {
    let pl = &s.players[p as usize];
    if pl.has_tech(tech) {
        return false;
    }
    let t = tech_def(tech);
    match t.parent {
        None => return true,
        Some(par) if pl.has_tech(par) => return true,
        _ => {}
    }
    TECHS.iter().any(|c| c.parent == Some(tech) && pl.has_tech(c.id))
}
/// unit score value: 5 × (cost + the passenger's cost)
fn unit_score(u: &Unit) -> i32 {
    SCORE.per_unit_cost * (unit_def(u.ty).cost + u.carried.map_or(0, |c| unit_def(c).cost))
}
/// every term is an integer, so the score is too
pub fn score_of(s: &GameState, p: i32) -> i32 {
    let pl = &s.players[p as usize];
    let mut score = 0;
    score += pl.explored.iter().map(|&b| b as i32).sum::<i32>() * SCORE.explored_tile;
    for &t in &pl.techs {
        score += SCORE.tech_tier * tech_def(t).tier;
    }
    for u in &s.units {
        if u.owner == p {
            score += unit_score(u);
        }
    }
    let mine: HashSet<Id> = s.cities.iter().filter(|c| c.owner == p).map(|c| c.id).collect();
    for c in s.cities.iter().filter(|c| c.owner == p) {
        score += city_score(c);
    }
    for t in &s.tiles {
        match t.territory {
            Some(id) if mine.contains(&id) => {}
            _ => continue,
        }
        score += SCORE.territory_tile;
        let Some(b) = t.building else { continue };
        match build_def(b).kind {
            BuildKind::Temple => {
                // Math.floor((turn - builtTurn) / 2)
                let lvl = SCORE.temple_max_level.min(1 + (((s.turn - t.built_turn) as f64) / 2.0).floor() as i32);
                score += SCORE.temple_level * lvl;
            }
            BuildKind::Monument => score += SCORE.monument,
            _ => {}
        }
    }
    score
}
/// 50 × (level + 1) + 5 per population point; negative population costs 105 per point,
/// the city part never below 0; parks 250 each
pub fn city_score(c: &City) -> i32 {
    let mut score = SCORE.city_per_level * (c.level + 1) + SCORE.city_pop * c.pop;
    if c.pop < 0 {
        score = 0.max(score + SCORE.city_negative_pop * c.pop);
    }
    score + SCORE.park * c.parks
}
/// score × (1 + bonus), bonus = round(handicap/5 + ln(opponents)/ln(11.4), 2)
pub fn perfection_rating(s: &GameState, p: i32) -> f64 {
    let opponents = s.players.len() as i32 - 1;
    let raw = perfection_difficulty_bonus(difficulty_of(s))
        + if opponents > 0 { libm::log(opponents as f64) / libm::log(11.4) } else { 0.0 };
    let bonus = 1.0 + js_round(raw * 100.0) / 100.0;
    js_round(score_of(s, p) as f64 * bonus)
}
/// mean of speed, battle, destroyed tribes / opponents and the difficulty part
pub fn domination_rating(s: &GameState, p: i32) -> f64 {
    let pl = &s.players[p as usize];
    let opponents = s.players.len() as i32 - 1;
    if opponents <= 0 {
        return 1.0;
    }
    let speed = if s.turn > 0 { 1f64.min((10.0 * opponents as f64) / s.turn as f64) } else { 1.0 };
    let battle = (pl.kills as f64 + 1.0) / (pl.losses as f64 + pl.kills as f64 + 1.0);
    let destroyed = s.players.iter().filter(|o| o.id != p && !o.alive).count() as f64 / opponents as f64;
    (speed + battle + destroyed + domination_difficulty(difficulty_of(s))) / 4.0
}
pub fn domination_stars(rating: f64) -> i32 {
    DOMINATION_STARS.iter().filter(|&&t| rating >= t - 1e-9).count() as i32
}
pub fn perfection_stars(rating: f64) -> i32 {
    PERFECTION_STARS.iter().filter(|&&t| rating >= t).count() as i32
}

/* ---------- city connections (§5.6) ---------- */

/// a tile that carries a land connection (explored or not)
fn network_node(s: &GameState, i: usize) -> bool {
    let t = &s.tiles[i];
    t.road || t.village || t.city_id.is_some() || matches!(t.building, Some(Build::Bridge | Build::Port | Build::Outpost | Build::Mycelium))
}
/// a connection step from tile `a` onto tile `b`
fn owners_allow(s: &GameState, a: &Tile, b: &Tile) -> bool {
    let from = city_owner(s, a.territory);
    let to = city_owner(s, b.territory);
    match (from, to) {
        (_, None) => true,
        (Some(f), Some(t)) if f == t => true,
        (None, _) => true,
        (Some(f), Some(t)) => at_peace(s, f, t),
    }
}
/// recompute which of p's cities are connected to its capital; adjust population
pub fn update_connections(s: &mut GameState, p: i32) {
    let cap = capital_of(s, p);
    let n = s.map_size;
    let mut connected: HashSet<Id> = HashSet::new();
    if let Some(capi) = cap {
        let (capx, capy) = (s.cities[capi].x, s.cities[capi].y);
        let len = s.tiles.len();
        let mut seen = vec![false; len];
        let start = idx(n, capx, capy);
        seen[start] = true;
        let mut queue: VecDeque<usize> = VecDeque::from([start]);
        let cymanti = s.players[p as usize].tribe == Tribe::Cymanti;
        while let Some(cur) = queue.pop_front() {
            let c = Coord::new(cur as i32 % n, cur as i32 / n);
            let t = &s.tiles[cur];
            if let Some(id) = t.city_id {
                connected.insert(id);
            }
            for q in around(n, c, 1, false) {
                let i = idx(n, q.x, q.y);
                if seen[i] {
                    continue;
                }
                if network_node(s, i) && owners_allow(s, t, &s.tiles[i]) {
                    seen[i] = true;
                    queue.push_back(i);
                }
            }
            // Mycelium links cities and other Mycelium within 3 tiles
            let t_myc = t.building == Some(Build::Mycelium);
            if t_myc || (t.city_id.is_some() && cymanti) {
                let explored = &s.players[p as usize].explored;
                for q in around(n, c, 3, false) {
                    let j = idx(n, q.x, q.y);
                    let tj = &s.tiles[j];
                    if seen[j] || explored[j] != 1 {
                        continue;
                    }
                    if !(tj.building == Some(Build::Mycelium) || (t_myc && tj.city_id.is_some())) {
                        continue;
                    }
                    if city_owner(s, tj.territory) != Some(p) && tj.city_id.is_none() {
                        continue;
                    }
                    if tj.city_id.is_some() && city_owner(s, tj.city_id) != Some(p) {
                        continue;
                    }
                    seen[j] = true;
                    queue.push_back(j);
                }
            }
            // port-to-port links within range 5 over friendly water; ocean only with Sailing
            // (Polaris: outposts link like ports)
            if matches!(t.building, Some(Build::Port | Build::Outpost)) {
                for j in 0..len {
                    if seen[j] || s.tiles[j].building != t.building {
                        continue;
                    }
                    let q = Coord::new(j as i32 % n, j as i32 / n);
                    if dist(c.x, c.y, q.x, q.y) > PORT_RANGE {
                        continue;
                    }
                    if city_owner(s, s.tiles[j].territory) != Some(p) {
                        continue;
                    }
                    if water_path(s, p, c, q) {
                        seen[j] = true;
                        queue.push_back(j);
                    }
                }
            }
            // Aquarion Atolls link own cities and atolls within 3 tiles
            let t_atoll = t.building == Some(Build::Atoll);
            if t_atoll || t.city_id.is_some() {
                for j in 0..len {
                    let o = &s.tiles[j];
                    if seen[j] || dist(c.x, c.y, j as i32 % n, j as i32 / n) > 3 {
                        continue;
                    }
                    if !(o.building == Some(Build::Atoll) || (t_atoll && o.city_id.is_some())) {
                        continue;
                    }
                    if city_owner(s, o.city_id.or(o.territory)) != Some(p) {
                        continue;
                    }
                    seen[j] = true;
                    queue.push_back(j);
                }
            }
        }
    }
    for ci in cities_of(s, p) {
        if s.cities[ci].capital {
            continue;
        }
        let now = connected.contains(&s.cities[ci].id);
        if now != s.cities[ci].connected {
            s.cities[ci].connected = now;
            let d = if now { 1 } else { -1 };
            add_pop(s, ci, d);
            if let Some(capi) = cap {
                add_pop(s, capi, d);
            }
        }
    }
}
fn water_path(s: &GameState, p: i32, a: Coord, b: Coord) -> bool {
    let n = s.map_size;
    let mut seen = vec![false; s.tiles.len()];
    seen[idx(n, a.x, a.y)] = true;
    let mut queue: VecDeque<Coord> = VecDeque::from([a]);
    let sailing = s.players[p as usize].has_tech(Tech::Sailing);
    while let Some(c) = queue.pop_front() {
        if c.x == b.x && c.y == b.y {
            return true;
        }
        for q in around(n, c, 1, false) {
            let i = idx(n, q.x, q.y);
            if seen[i] || dist(a.x, a.y, q.x, q.y) > PORT_RANGE {
                continue;
            }
            let t = &s.tiles[i];
            if !is_water(t) && !t.flooded {
                continue;
            }
            if t.terrain == Terrain::Ocean && !sailing {
                continue;
            }
            // own, neutral or a peace partner's water
            if let Some(o) = city_owner(s, t.territory) {
                if o != p && !at_peace(s, p, o) {
                    continue;
                }
            }
            seen[i] = true;
            queue.push_back(q);
        }
    }
    false
}

/* ---------- tasks and meetings ---------- */

pub fn check_tasks(s: &mut GameState, p: i32) {
    let pu = p as usize;
    let complete = |s: &mut GameState, t: Task| {
        if !s.players[pu].tasks.contains(&t) {
            s.players[pu].tasks.push(t);
            log(s, &format!("task {} complete: monument {} available", t.id(), monument_for(t).id()));
        }
    };
    let done = |s: &GameState, t: Task| s.players[pu].tasks.contains(&t);
    if !done(s, Task::Genius) && TECHS.iter().all(|t| s.players[pu].has_tech(t.id)) {
        complete(s, Task::Genius);
    }
    if !done(s, Task::Wealth) && s.players[pu].has_tech(Tech::Trade) && s.players[pu].stars >= 100 {
        complete(s, Task::Wealth);
    }
    if !done(s, Task::Killer) && s.players[pu].kills >= 10 {
        complete(s, Task::Killer);
    }
    if !done(s, Task::Metropolis) && s.cities.iter().any(|c| c.owner == p && c.level >= 5) {
        complete(s, Task::Metropolis);
    }
    if !done(s, Task::Network) && s.cities.iter().filter(|c| c.owner == p && c.connected).count() >= 5 {
        complete(s, Task::Network);
    }
    if !done(s, Task::Explorer) && s.players[pu].lighthouses.len() >= 4 {
        complete(s, Task::Explorer);
    }
    // Cymanti: the convert task replaces the pacifist task (2.18 data)
    if s.players[pu].tribe == Tribe::Cymanti {
        if !done(s, Task::Convert) && s.players[pu].conversions.unwrap_or(0) >= 3 {
            complete(s, Task::Convert);
        }
    } else if !done(s, Task::Pacifist) && s.players[pu].pacifist_turns >= 5 {
        complete(s, Task::Pacifist);
    }
}
/// meeting reward (§5.9) and Capital Vision; checked after every action
pub fn check_meetings(s: &mut GameState) {
    for pi in 0..s.players.len() {
        if !s.players[pi].alive {
            continue;
        }
        let plid = s.players[pi].id;
        for oi in 0..s.players.len() {
            let oid = s.players[oi].id;
            if oid == plid || !s.players[oi].alive || s.players[pi].met.contains(&oid) {
                continue;
            }
            let sees_unit = s.units.iter().any(|u| u.owner == oid && can_see(s, plid, u));
            let sees_city = || {
                let pl = &s.players[pi];
                s.cities.iter().any(|c| c.owner == oid && pl.explored[idx(s.map_size, c.x, c.y)] == 1)
            };
            if !sees_unit && !sees_city() {
                continue;
            }
            meet(s, plid, oid);
        }
        if s.players[pi].has_tech(Tech::Diplomacy) {
            let met = s.players[pi].met.clone();
            for m in met {
                if let Some(cap) = s.cities.iter().find(|c| c.original_capital_of == Some(m)) {
                    let i = idx(s.map_size, cap.x, cap.y);
                    s.players[pi].explored[i] = 1;
                }
            }
        }
    }
}
/// player p meets `other`: stars of 1 + 2 per 1,000 of their score (rounded up, at most 5 tiers);
/// the base is 3 when meeting the first seat in a 2-player game
pub fn meet(s: &mut GameState, p: i32, other: i32) {
    if p == other || s.players[p as usize].met.contains(&other) {
        return;
    }
    s.players[p as usize].met.push(other);
    let sc = score_of(s, other);
    let base = if s.players.len() == 2 && other == 0 { 3 } else { 1 };
    let tiers = 5.min(((sc as f64) / 1000.0).ceil() as i32);
    s.players[p as usize].stars += base + 2 * tiers;
}

/* ---------- units ---------- */

/// pushes the new unit onto s.units and returns its index
pub fn make_unit(s: &mut GameState, ty: UnitType, owner: i32, at: Coord, home_city: Option<Id>) -> usize {
    let def = unit_def(ty);
    let hp = def.hp.unwrap_or(10.0) as i32;
    let id = s.next_id;
    s.next_id += 1;
    s.units.push(Unit {
        id,
        ty,
        carried: None,
        owner,
        x: at.x,
        y: at.y,
        hp,
        max_hp: hp,
        kills: 0,
        veteran: false,
        home_city: if def.has(Skill::Independent) { None } else { home_city },
        can_move: false,
        can_attack: false,
        moved: false,
        attacked: false,
        done: true,
        idle: true,
        hidden: false,
        last_dir: None,
        frozen: false,
        poisoned: false,
        swarmed: false,
        bubble: false,
        second_attack: false,
        body_of: None,
        created_turn: Some(s.turn),
    });
    s.units.len() - 1
}

/// S1's direction vectors, by S1 direction index
const S1_DIRS: [Coord; 8] = [
    Coord::new(-1, -1),
    Coord::new(-1, 0),
    Coord::new(-1, 1),
    Coord::new(0, 1),
    Coord::new(1, 1),
    Coord::new(1, 0),
    Coord::new(1, -1),
    Coord::new(0, -1),
];
/// the S1 direction with the strictly greatest weighted dot product with (x, y), the first on a tie
fn s1_nearest(x: i32, y: i32) -> usize {
    let mut best = 0;
    let mut score = 0;
    for (i, d) in S1_DIRS.iter().enumerate() {
        let dot = (d.x * x + d.y * y) * if d.x * d.x + d.y * d.y == 1 { 1393 } else { 985 };
        if score < dot {
            score = dot;
            best = i;
        }
    }
    best
}
/// S1 step::facing_direction from `a` toward `b` (8 = the same tile)
fn s1_facing(a: Coord, b: Coord) -> usize {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if dx.abs().max(dy.abs()) <= 1 {
        return S1_DIRS.iter().position(|d| d.x == dx && d.y == dy).unwrap_or(8);
    }
    s1_nearest(dx, dy)
}
/// opposite directions give the first turned a quarter, else the nearest to the sum
fn s1_average(first: usize, second: usize) -> usize {
    let a = S1_DIRS.get(first).copied().unwrap_or(Coord::new(0, 0));
    let b = S1_DIRS.get(second).copied().unwrap_or(Coord::new(0, 0));
    let x = a.x + b.x;
    let y = a.y + b.y;
    if x == 0 && y == 0 {
        return (first + 2) % 8;
    }
    s1_nearest(x, y)
}
/// state.ts pushUnit(s, u, spawner); `ui` indexes s.units. Returns false when the unit was removed.
pub fn push_unit(s: &mut GameState, ui: usize, spawner: i32) -> bool {
    let n = s.map_size;
    let u = s.units[ui].clone();
    let c = (n - 1) as f64 / 2.0;
    let sgn = |v: f64| if v > 0.0 { 1 } else if v < 0.0 { -1 } else { 0 };
    let mut dir = u.last_dir.unwrap_or(Coord::new(sgn(c - u.x as f64), sgn(c - u.y as f64)));
    if dir.x == 0 && dir.y == 0 {
        dir = Coord::new(0, 1);
    }
    if spawner != u.owner {
        dir = Coord::new(-dir.x, -dir.y);
    }
    let lead = leader_of(s, &u);
    let follow = follower_of(s, &u);
    let here = Coord::new(u.x, u.y);
    // leaderOf/followerOf return units of s.units, so `s.units.includes(o)` always holds
    let toward = |o: usize| s1_facing(here, Coord::new(s.units[o].x, s.units[o].y));
    let chain_dir: i32 = match (lead, follow) {
        (Some(l), Some(f)) => s1_average(toward(l), toward(f)) as i32,
        (Some(l), None) => toward(l) as i32,
        (None, Some(f)) => toward(f) as i32,
        (None, None) => -1,
    };
    if chain_dir >= 0 {
        dir = S1_DIRS.get(chain_dir as usize).copied().unwrap_or(S1_DIRS[0]);
    }
    const DIRS8: [Coord; 8] = [
        Coord::new(0, -1),
        Coord::new(1, -1),
        Coord::new(1, 0),
        Coord::new(1, 1),
        Coord::new(0, 1),
        Coord::new(-1, 1),
        Coord::new(-1, 0),
        Coord::new(-1, -1),
    ];
    let k = DIRS8.iter().position(|d| d.x == dir.x.signum() && d.y == dir.y.signum()).map_or(-1, |k| k as i32);
    let def = unit_def(u.ty);
    let naval = def.naval;
    let amphibious = def.has(Skill::Amphibious);
    for o in [0, 1, -1, 2, -2, 3, -3, 4] {
        let d = DIRS8[((k + o + 8) % 8) as usize];
        let x = u.x + d.x;
        let y = u.y + d.y;
        if !in_bounds(n, x, y) {
            continue;
        }
        if s.units.iter().any(|v| v.x == x && v.y == y) {
            continue;
        }
        let t = tile_at(s, x, y);
        if !amphibious && (if naval { !is_water(t) && !t.flooded } else { is_water(t) && t.building != Some(Build::Bridge) }) {
            continue;
        }
        s.units[ui].x = x;
        s.units[ui].y = y;
        return true;
    }
    s.units.remove(ui);
    false
}
/// remove a player who lost their last city (§5.8)
pub fn check_elimination(s: &mut GameState) {
    for pi in 0..s.players.len() {
        if !s.players[pi].alive {
            continue;
        }
        let id = s.players[pi].id;
        if !s.cities.iter().any(|c| c.owner == id) {
            // a wiped tribe: every unit disbanded, every embassy to or from it ended
            s.players[pi].alive = false;
            s.units.retain(|u| u.owner != id);
            s.players[pi].embassies.clear();
            for o in s.players.iter_mut() {
                o.embassies.retain(|&h| h != id);
            }
            log(s, &format!("player {id} eliminated"));
        }
    }
    check_game_end(s, false);
}
/// the alive player with the highest score; ties go to the lower player index
pub fn leader(s: &GameState) -> Option<i32> {
    let mut best: Option<(i32, i32)> = None;
    for o in &s.players {
        if !o.alive {
            continue;
        }
        let sc = score_of(s, o.id);
        if best.map_or(true, |(_, b)| sc > b) {
            best = Some((o.id, sc));
        }
    }
    best.map(|(id, _)| id)
}
/// game end by mode, after every action and (turn_ended) after every player's turn
pub fn check_game_end(s: &mut GameState, turn_ended: bool) {
    if s.over {
        return;
    }
    fn end(s: &mut GameState, w: Option<i32>) {
        s.over = true;
        s.winner = w;
    }
    let alive: Vec<i32> = s.players.iter().filter(|p| p.alive).map(|p| p.id).collect();
    if alive.len() == 1 {
        return end(s, Some(alive[0]));
    }
    let humans: Vec<&Player> = s.players.iter().filter(|p| !p.bot).collect();
    if humans.len() == 1 && !humans[0].alive {
        let w = leader(s);
        return end(s, w);
    }
    if s.mode == GameMode::Might {
        let capitals: Vec<&City> = s.cities.iter().filter(|c| c.original_capital_of.is_some()).collect();
        if capitals.len() > 1 {
            let holder = capitals[0].owner;
            if capitals.iter().all(|c| c.owner == holder) {
                return end(s, Some(holder));
            }
        }
    }
    // Glory: over as soon as a score reaches the target, after any action
    if s.mode == GameMode::Glory && s.players.iter().any(|o| o.alive && score_of(s, o.id) >= GLORY_TARGET) {
        let w = leader(s);
        return end(s, w);
    }
    if !turn_ended {
        return;
    }
    // Perfection: over when the round counter reaches the limit, so turns 0..limit-1
    if s.mode == GameMode::Perfection && s.turn >= s.max_turns {
        let w = leader(s);
        end(s, w);
    }
}

/* ---------- setup ---------- */

/// pushes the new city onto s.cities and returns its index
pub fn new_city(s: &mut GameState, at: Coord, owner: i32) -> usize {
    // the id is taken before the name is drawn (object literal order)
    let id = s.next_id;
    s.next_id += 1;
    let name = with_rng(s, |r| r.pick(&CITY_NAMES)).to_string();
    s.cities.push(City {
        id,
        name,
        owner,
        x: at.x,
        y: at.y,
        level: 1,
        pop: 0,
        capital: false,
        original_capital_of: None,
        walls: false,
        workshop: false,
        parks: 0,
        connected: false,
        riot: false,
        pending_rewards: vec![],
    });
    let t = tile_at_mut(s, at.x, at.y);
    t.city_id = Some(id);
    t.village = false;
    s.cities.len() - 1
}
pub fn create_game(opts: &NewGameOptions) -> Result<GameState, String> {
    let n = opts.map_size.or_else(|| map_size_for(opts.mode, opts.players - 1)).unwrap_or(16);
    if opts.players > max_players_for(n) {
        return Err(format!("a {n}x{n} map holds at most {} tribes", max_players_for(n)));
    }
    let mut rng = Rng::new(opts.seed);
    let players = opts.players.max(0) as usize;
    let clan_ids: Vec<Tribe> = match &opts.clans {
        Some(c) => c.clone(),
        None => {
            let mut a = shuffle(&mut rng, &Tribe::ALL);
            a.extend(shuffle(&mut rng, &Tribe::ALL));
            a.truncate(players);
            a
        }
    };
    if clan_ids.len() < players {
        // TS reads CLAN_BY_ID[undefined] and throws
        return Err(format!("clans: {} given for {} players", clan_ids.len(), players));
    }
    let mods: Vec<Mods> = clan_ids.iter().map(|&c| tribe_def(c).mods).collect();
    let map = generate_map(
        &mut rng,
        n,
        opts.players,
        opts.map_type.unwrap_or(MapType::Drylands),
        &mods,
        &MapOptions {
            start_resources: Some(clan_ids.iter().map(|&c| tribe_def(c).start_resources.to_vec()).collect()),
            climates: Some(clan_ids.iter().map(|c| c.id().to_string()).collect()),
            flooded: Some(clan_ids.iter().map(|&c| c == Tribe::Aquarion).collect()),
            polaris: Some(clan_ids.iter().map(|&c| c == Tribe::Polaris).collect()),
            ..Default::default()
        },
    );
    let humans: Vec<i32> = opts.humans.clone().unwrap_or_else(|| vec![0]);

    let mut s = GameState {
        seed: opts.seed,
        rng: rng.state(),
        map_size: n,
        mode: opts.mode,
        difficulty: Some(opts.difficulty.unwrap_or(Difficulty::Normal)),
        max_turns: opts.turn_limit.unwrap_or(PERFECTION_TURNS),
        turn: 0,
        current: 0,
        tiles: map.tiles,
        units: vec![],
        cities: vec![],
        players: vec![],
        next_id: 1,
        winner: None,
        over: false,
        log: vec![],
        diplomacy: None,
    };

    for p in 0..opts.players {
        let clan = tribe_def(clan_ids[p as usize]);
        s.players.push(Player {
            id: p,
            tribe: clan.id,
            stars: clan.start_stars,
            techs: clan.start_tech.into_iter().collect(),
            explored: vec![0; (n * n) as usize],
            alive: true,
            bot: !humans.contains(&p),
            kills: 0,
            losses: 0,
            met: vec![],
            tasks: vec![],
            monuments: vec![],
            pacifist_turns: 0,
            attacked_this_turn: false,
            lighthouses: vec![],
            embassies: vec![],
            capital_id: -1,
            conversions: None,
            built_unique: None,
        });
        let at = map.capitals[p as usize];
        let ci = new_city(&mut s, at, p);
        s.cities[ci].capital = true;
        s.cities[ci].original_capital_of = Some(p);
        s.cities[ci].level = clan.capital_level;
        let cap_id = s.cities[ci].id;
        s.players[p as usize].capital_id = cap_id;
        claim_territory(&mut s, ci, 1);
        explore(&mut s, p, at, 2);
        let ui = make_unit(&mut s, clan.start_unit, p, at, Some(cap_id));
        // the starting unit can act on turn 0 (§8)
        s.units[ui].done = false;
    }
    start_turn(&mut s);
    check_meetings(&mut s);
    Ok(s)
}
/// start-of-turn processing for s.current (§5.2)
pub fn start_turn(s: &mut GameState) {
    let p = s.current;
    s.players[p as usize].attacked_this_turn = false;
    if s.turn > 0 {
        let inc = income(s, p);
        s.players[p as usize].stars += inc;
        for c in s.cities.iter_mut().filter(|c| c.owner == p) {
            c.riot = false;
        }
    }
    for u in s.units.iter_mut() {
        if u.owner != p {
            continue;
        }
        u.second_attack = false;
        let frozen = u.frozen;
        let def = unit_def(u.ty);
        u.can_move = !frozen;
        u.can_attack = !frozen && (def.attack > 0.0 || def.has(Skill::Convert));
        u.moved = false;
        u.attacked = false;
        u.done = frozen;
        u.idle = true;
    }
    if s.turn > 0 {
        sanctuary_animals(s, p);
        grow_fungi(s, p);
    }
    check_tasks(s, p);
}
/// Grow: unit type -> what it becomes and its growth rate
fn grows(t: UnitType) -> Option<(UnitType, i32)> {
    match t {
        UnitType::DragonEgg => Some((UnitType::BabyDragon, 3)),
        UnitType::BabyDragon => Some((UnitType::FireDragon, 3)),
        UnitType::InsectEgg => Some((UnitType::Larva, 1)),
        UnitType::Larva => Some((UnitType::Moth, 3)),
        _ => None,
    }
}
/// at the end of the owner's turn a Grow unit old enough becomes the next stage; it keeps its damage
pub fn grow_units(s: &mut GameState, p: i32) {
    let turn = s.turn;
    for u in s.units.iter_mut() {
        if u.owner != p || !unit_def(u.ty).has(Skill::Grow) {
            continue;
        }
        let Some((into, rate)) = grows(u.ty) else { continue };
        if turn - u.created_turn.unwrap_or(0) < rate {
            continue;
        }
        let lost = u.max_hp - u.hp;
        u.ty = into;
        u.max_hp = unit_def(into).hp.unwrap() as i32 + if u.veteran { 5 } else { 0 };
        u.hp = 1.max(u.max_hp - lost);
        u.created_turn = Some(turn);
    }
}
/// Elyrion Sanctuary: every 2 turns of its age it puts a wild animal on the first adjacent tile
/// (x-major from the north-west corner) that p owns, that is forest and holds no building and no resource
fn sanctuary_animals(s: &mut GameState, p: i32) {
    let n = s.map_size;
    for i in 0..s.tiles.len() {
        let t = &s.tiles[i];
        if t.building != Some(Build::Sanctuary) || city_owner(s, t.territory) != Some(p) {
            continue;
        }
        let age = s.turn - t.built_turn;
        if age % 2 != 0 {
            continue;
        }
        let cx = i as i32 % n;
        let cy = i as i32 / n;
        'outer: for x in cx - 1..=cx + 1 {
            for y in cy - 1..=cy + 1 {
                if !in_bounds(n, x, y) {
                    continue;
                }
                let qt = tile_at(s, x, y);
                if city_owner(s, qt.territory) != Some(p) {
                    continue;
                }
                if qt.terrain != Terrain::Forest || qt.resource.is_some() || qt.building.is_some() || qt.city_id.is_some() || qt.village {
                    continue;
                }
                tile_at_mut(s, x, y).resource = Some(Resource::Animal);
                break 'outer;
            }
        }
    }
}
/// Cymanti Fungi grow: level = turns since built, at most 1, 2 with Construction (Cymanti);
/// each new level gives its city +1 population
fn grow_fungi(s: &mut GameState, p: i32) {
    let pl = &s.players[p as usize];
    let cap = 1 + if pl.has_tech(Tech::Construction) && pl.tribe == Tribe::Cymanti { 1 } else { 0 };
    for i in 0..s.tiles.len() {
        if s.tiles[i].building != Some(Build::Fungi) {
            continue;
        }
        let Some(ci) = city_by_id(s, s.tiles[i].territory) else { continue };
        if s.cities[ci].owner != p {
            continue;
        }
        let level = cap.min(0.max(s.turn - s.tiles[i].built_turn));
        if level > s.tiles[i].building_level {
            add_pop(s, ci, level - s.tiles[i].building_level);
            s.tiles[i].building_level = level;
        }
    }
}
/// (city index, its two reward options)
pub fn pending_reward(s: &GameState) -> Option<(usize, [Reward; 2])> {
    for ci in cities_of(s, s.current) {
        if let Some(&lvl) = s.cities[ci].pending_rewards.first() {
            return Some((ci, reward_options(lvl)));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    //! Parity with the TypeScript engine. Reference files come from a node script
    //! (createGame hashes, and states sampled from TS-played games with the values
    //! and post-mutation hashes TS computed); the directory is $POLY_STATE_REF,
    //! default engine/corpus/state-ref. Missing files skip the test.
    use super::*;
    use crate::canon::state_hash;
    use crate::json::state_from_json;
    use serde_json::Value;
    use std::io::BufRead;

    fn ref_file(name: &str) -> Option<std::fs::File> {
        let dir = std::env::var("POLY_STATE_REF").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../corpus/state-ref").to_string());
        match std::fs::File::open(std::path::Path::new(&dir).join(name)) {
            Ok(f) => Some(f),
            Err(_) => {
                eprintln!("skipping: {dir}/{name} not found");
                None
            }
        }
    }
    fn lines(f: std::fs::File) -> impl Iterator<Item = Value> {
        std::io::BufReader::new(f).lines().filter_map(|l| l.ok()).filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(&l).unwrap())
    }
    fn mapgen_ready() -> bool {
        !include_str!("mapgen.rs").contains("todo!()")
    }

    #[test]
    fn create_game_parity() {
        let Some(f) = ref_file("create.jsonl") else { return };
        if !mapgen_ready() {
            eprintln!("skipping: mapgen.rs not ported yet");
            return;
        }
        let (mut ok, mut bad) = (0, Vec::new());
        for (k, v) in lines(f).enumerate() {
            let opts = NewGameOptions::from_json(&v["opts"]).unwrap();
            let got = create_game(&opts);
            match (&got, v.get("error")) {
                (Err(e), Some(want)) if want.as_str() == Some(e.as_str()) => ok += 1,
                (Ok(s), None) => {
                    let log: Vec<String> = v["log"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
                    if state_hash(s) == v["hash"].as_str().unwrap() && s.log == log {
                        ok += 1
                    } else {
                        bad.push(k)
                    }
                }
                _ => bad.push(k),
            }
        }
        eprintln!("createGame: {ok} match, {} differ", bad.len());
        assert!(bad.is_empty(), "createGame differs for specs {bad:?}");
    }

    /// floats are written as JS strings: serde_json's own float parsing can be 1 ULP off
    fn num(v: &Value) -> f64 {
        v.as_str().unwrap().parse().unwrap()
    }

    fn mut_sig(s: &GameState) -> String {
        format!("{}:{}:{}", state_hash(s), s.log.len(), s.log.last().map_or("", |x| x.as_str()))
    }

    #[test]
    fn state_function_parity() {
        let Some(f) = ref_file("states.jsonl") else { return };
        let (mut states, mut checks) = (0, 0);
        let mut fails: Vec<String> = Vec::new();
        let mut check = |what: String, ok: bool| {
            checks += 1;
            if !ok && fails.len() < 50 {
                fails.push(what);
            }
        };
        for v in lines(f) {
            let s = state_from_json(&v["state"]).unwrap();
            states += 1;
            for (p, pv) in v["players"].as_array().unwrap().iter().enumerate() {
                let p = p as i32;
                check(format!("s{states} income p{p}"), income(&s, p) as i64 == pv["income"].as_i64().unwrap());
                for (k, t) in Tech::ALL.iter().enumerate() {
                    check(format!("s{states} techCost p{p} {t:?}"), tech_cost(&s, p, *t) as i64 == pv["techCost"][k].as_i64().unwrap());
                    check(format!("s{states} canResearch p{p} {t:?}"), can_research(&s, p, *t) == pv["canResearch"][k].as_bool().unwrap());
                }
                check(format!("s{states} score p{p}"), score_of(&s, p) as i64 == pv["score"].as_i64().unwrap());
                check(format!("s{states} perfection p{p}"), perfection_rating(&s, p) == num(&pv["perfection"]));
                check(format!("s{states} domination p{p}"), domination_rating(&s, p) == num(&pv["domination"]));
                for (k, r) in Resource::ALL.iter().enumerate() {
                    check(format!("s{states} resourceVisible p{p} {r:?}"), resource_visible(&s, p, *r) == pv["resourceVisible"][k].as_bool().unwrap());
                }
            }
            for (ci, cv) in v["cities"].as_array().unwrap().iter().enumerate() {
                let c = &s.cities[ci];
                check(format!("s{states} cityIncome {ci}"), city_income(&s, c) as i64 == cv["income"].as_i64().unwrap());
                check(format!("s{states} underSiege {ci}"), under_siege(&s, c) == cv["siege"].as_bool().unwrap());
                check(format!("s{states} unitsHomedIn {ci}"), units_homed_in(&s, c) as i64 == cv["homed"].as_i64().unwrap());
                check(format!("s{states} cityScore {ci}"), city_score(c) as i64 == cv["score"].as_i64().unwrap());
            }
            check(format!("s{states} iceBank"), ice_bank_level(&s) as i64 == v["iceBank"].as_i64().unwrap());
            let pending = pending_reward(&s).map(|(ci, o)| (ci as i64, [o[0].id().to_string(), o[1].id().to_string()]));
            let want = v["pending"].as_array().map(|a| (a[0].as_i64().unwrap(), [a[1][0].as_str().unwrap().to_string(), a[1][1].as_str().unwrap().to_string()]));
            check(format!("s{states} pendingReward"), pending == want);
            check(format!("s{states} leader"), leader(&s).map(|x| x as i64) == v["leader"].as_i64());
            for (k, want) in v["mut"].as_object().unwrap() {
                let mut x = s.clone();
                if let Some(p) = k.strip_prefix("updateConnections") {
                    update_connections(&mut x, p.parse().unwrap());
                } else if let Some(p) = k.strip_prefix("checkTasks") {
                    check_tasks(&mut x, p.parse().unwrap());
                } else if let Some(p) = k.strip_prefix("growUnits") {
                    grow_units(&mut x, p.parse().unwrap());
                } else if let Some(p) = k.strip_prefix("flipConnections") {
                    for c in x.cities.iter_mut() {
                        c.connected = !c.connected;
                    }
                    update_connections(&mut x, p.parse().unwrap());
                } else if let Some(p) = k.strip_prefix("resetTasks") {
                    let p: i32 = p.parse().unwrap();
                    let pl = &mut x.players[p as usize];
                    pl.tasks.clear();
                    pl.stars += 100;
                    pl.pacifist_turns += 5;
                    check_tasks(&mut x, p);
                } else if let Some(p) = k.strip_prefix("oldUnits") {
                    let t = x.turn - 5;
                    for u in x.units.iter_mut() {
                        u.created_turn = Some(t);
                    }
                    grow_units(&mut x, p.parse().unwrap());
                } else if let Some(p) = k.strip_prefix("nextTurn") {
                    x.current = p.parse().unwrap();
                    x.turn += 1;
                    start_turn(&mut x);
                } else if k == "resetMet" {
                    for o in x.players.iter_mut() {
                        o.met.clear();
                    }
                    check_meetings(&mut x);
                } else if k == "eliminate1" {
                    for c in x.cities.iter_mut() {
                        if c.owner == 1 {
                            c.owner = 0;
                        }
                    }
                    check_elimination(&mut x);
                } else if k == "limitReached" {
                    x.turn = x.max_turns;
                    check_game_end(&mut x, true);
                } else if k == "checkMeetings" {
                    check_meetings(&mut x);
                } else if k == "startTurn" {
                    start_turn(&mut x);
                } else if k == "checkElimination" {
                    check_elimination(&mut x);
                } else if k == "checkGameEnd" {
                    check_game_end(&mut x, true);
                } else if let Some(rest) = k.strip_prefix("push") {
                    let (i, who) = rest.split_once(':').unwrap();
                    let i: usize = i.parse().unwrap();
                    let owner = x.units[i].owner;
                    let spawner = if who == "own" { owner } else { (owner + 1) % x.players.len() as i32 };
                    push_unit(&mut x, i, spawner);
                } else {
                    panic!("unknown mutation {k}");
                }
                check(format!("s{states} {k}"), mut_sig(&x) == want.as_str().unwrap());
            }
        }
        eprintln!("state functions: {states} states, {checks} checks, {} failed (first 50: {fails:?})", fails.len());
        assert!(states > 0);
        assert!(fails.is_empty(), "{fails:#?}");
    }

    #[test]
    fn small_helpers() {
        assert_eq!(map_size_for(GameMode::Domination, 1), Some(11));
        assert_eq!(map_size_for(GameMode::Domination, 4), Some(18));
        assert_eq!(map_size_for(GameMode::Glory, 4), None);
        assert!(!map_size_allowed(GameMode::Perfection, 20));
        assert_eq!(domination_stars(0.6999999999), 2);
        assert_eq!(perfection_stars(10_000.0), 2);
        assert_eq!(s1_facing(Coord::new(0, 0), Coord::new(0, 0)), 8);
        assert_eq!(s1_average(0, 4), 2);
    }
}
