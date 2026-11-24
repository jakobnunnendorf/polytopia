//! Port of logic/engine/observe.ts. RL observation: what player `p` can know,
//! as numeric planes over the map (channel-major, each plane mapSize×mapSize,
//! row-major) plus scalar features. Unexplored tiles are all-zero except the
//! "explored" plane; hidden enemy units are omitted unless adjacent to one of
//! p's units (can_see). Plane values are computed in f64 like TS and stored
//! as f32.
use crate::diplomacy::{has_offer, relation, Relation};
use crate::movement::can_see;
use crate::state::{city_by_id, income, resource_visible, score_of, tech_cost};
use crate::types::*;
use serde_json::{json, Value};
use std::sync::OnceLock;

// channel offsets, in observe.ts CHANNELS order
const CH_EXPLORED: usize = 0;
const CH_TERRAIN: usize = 1; // + Terrain index (TERRAINS == Terrain::ALL order)
const CH_RESOURCE: usize = CH_TERRAIN + Terrain::COUNT; // + Resource index (RESOURCES == Resource::ALL order)
const CH_BUILDING: usize = CH_RESOURCE + Resource::COUNT;
const CH_ROAD: usize = CH_BUILDING + 1;
const CH_VILLAGE: usize = CH_ROAD + 1;
const CH_RUIN: usize = CH_VILLAGE + 1;
const CH_FLOODED: usize = CH_RUIN + 1;
const CH_DECOMPOSING: usize = CH_FLOODED + 1;
const CH_TERRITORY_OWN: usize = CH_DECOMPOSING + 1;
const CH_TERRITORY_ENEMY: usize = CH_TERRITORY_OWN + 1;
const CH_CITY_OWN_LEVEL: usize = CH_TERRITORY_ENEMY + 1;
const CH_CITY_ENEMY_LEVEL: usize = CH_CITY_OWN_LEVEL + 1;
const CH_UNIT_OWN: usize = CH_CITY_ENEMY_LEVEL + 1;
const CH_UNIT_ENEMY: usize = CH_UNIT_OWN + 1;
const CH_UNIT_HP_FRAC: usize = CH_UNIT_ENEMY + 1;
const CH_UNIT_CAN_ACT: usize = CH_UNIT_HP_FRAC + 1;
const CH_UNIT_TYPE: usize = CH_UNIT_CAN_ACT + 1; // + UnitType index (Object.keys(UNITS) order)
const CH_COUNT: usize = CH_UNIT_TYPE + UnitType::COUNT;

/// observe.ts CHANNELS, in order
pub fn channels() -> &'static [&'static str] {
    static C: OnceLock<Vec<&'static str>> = OnceLock::new();
    C.get_or_init(|| {
        let mut v: Vec<String> = vec!["explored".into()];
        v.extend(Terrain::ALL.iter().map(|t| format!("terrain:{}", t.id())));
        v.extend(Resource::ALL.iter().map(|r| format!("resource:{}", r.id())));
        for c in [
            "building",
            "road",
            "village",
            "ruin",
            "flooded",
            "decomposing",
            "territory:own",
            "territory:enemy",
            "city:own_level",
            "city:enemy_level",
            "unit:own",
            "unit:enemy",
            "unit:hp_frac",
            "unit:can_act",
        ] {
            v.push(c.into());
        }
        v.extend(UnitType::ALL.iter().map(|u| format!("unit_type:{}", u.id())));
        debug_assert_eq!(v.len(), CH_COUNT);
        v.into_iter().map(|s| &*Box::leak(s.into_boxed_str())).collect()
    })
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
    let n = s.map_size;
    let nn = (n * n) as usize;
    let mut planes = vec![0f32; CH_COUNT * nn];
    let mut set = |ch: usize, i: usize, v: f64| planes[ch * nn + i] = v as f32;
    let pl = &s.players[p as usize];
    for i in 0..nn {
        // Elyrion see ruins through clouds
        if pl.explored[i] != 1 {
            if pl.tribe == Tribe::Elyrion && s.tiles[i].ruin {
                set(CH_RUIN, i, 1.0);
            }
            continue;
        }
        let t = &s.tiles[i];
        set(CH_EXPLORED, i, 1.0);
        set(CH_TERRAIN + t.terrain.idx(), i, 1.0);
        if let Some(r) = t.resource {
            if resource_visible(s, p, r) {
                set(CH_RESOURCE + r.idx(), i, 1.0);
            }
        }
        if t.building.is_some() {
            set(CH_BUILDING, i, 1.0);
        }
        if t.road {
            set(CH_ROAD, i, 1.0);
        }
        if t.village {
            set(CH_VILLAGE, i, 1.0);
        }
        if t.ruin {
            set(CH_RUIN, i, 1.0);
        }
        if t.flooded {
            set(CH_FLOODED, i, 1.0);
        }
        if t.decomposing {
            set(CH_DECOMPOSING, i, 1.0);
        }
        match city_by_id(s, t.territory).map(|ci| s.cities[ci].owner) {
            Some(o) if o == p => set(CH_TERRITORY_OWN, i, 1.0),
            Some(_) => set(CH_TERRITORY_ENEMY, i, 1.0),
            None => {}
        }
        if t.city_id.is_some() {
            // TS asserts the city exists (cityById(...)!)
            let c = &s.cities[city_by_id(s, t.city_id).expect("observe: tile city not found")];
            set(if c.owner == p { CH_CITY_OWN_LEVEL } else { CH_CITY_ENEMY_LEVEL }, i, c.level as f64);
        }
    }
    for u in &s.units {
        if !can_see(s, p, u) {
            continue;
        }
        let i = (u.y * n + u.x) as usize;
        set(if u.owner == p { CH_UNIT_OWN } else { CH_UNIT_ENEMY }, i, 1.0);
        set(CH_UNIT_HP_FRAC, i, u.hp as f64 / u.max_hp as f64);
        if u.owner == p {
            set(CH_UNIT_CAN_ACT, i, if u.can_move || u.can_attack { 1.0 } else { 0.0 });
        }
        set(CH_UNIT_TYPE + u.ty.idx(), i, 1.0);
    }
    let relation_code = |r: Relation| match r {
        Relation::SelfRel => 0.0,
        Relation::Peace => 1.0,
        Relation::Neutral => 0.0,
        Relation::War => -1.0,
        Relation::Hostile => -2.0,
    };
    Observation {
        player: p,
        map_size: n,
        planes,
        scalars: Scalars {
            turn: s.turn,
            max_turns: s.max_turns,
            stars: pl.stars,
            income: income(s, p),
            score: score_of(s, p),
            cities: s.cities.iter().filter(|c| c.owner == p).count() as i32,
            techs: Tech::ALL.iter().map(|&t| if pl.techs.contains(&t) { 1.0 } else { 0.0 }).collect(),
            tech_costs: Tech::ALL.iter().map(|&t| tech_cost(s, p, t) as f64).collect(),
            opponents_alive: s.players.iter().filter(|o| o.alive && o.id != p).count() as i32,
            relations: s.players.iter().map(|o| relation_code(relation(s, p, o.id))).collect(),
            peace_offers: s.players.iter().map(|o| if has_offer(s, o.id, p) { 1.0 } else { 0.0 }).collect(),
        },
    }
}

/// a number as JSON.stringify writes it: integers without a fraction
fn num(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 9.0e15 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

/// the JSON shape of observe.ts Observation (for parity checks against TypeScript).
/// Plane values are the stored f32 widened to f64, so a TS fraction (unit:hp_frac)
/// matches only after rounding the TS value to f32.
pub fn observation_to_json(o: &Observation) -> Value {
    let v = |xs: &[f64]| Value::Array(xs.iter().map(|&x| num(x)).collect());
    json!({
        "player": o.player,
        "mapSize": o.map_size,
        "channels": channels(),
        "planes": Value::Array(o.planes.iter().map(|&x| num(x as f64)).collect()),
        "scalars": {
            "turn": o.scalars.turn,
            "maxTurns": o.scalars.max_turns,
            "stars": o.scalars.stars,
            "income": o.scalars.income,
            "score": o.scalars.score,
            "cities": o.scalars.cities,
            "techs": v(&o.scalars.techs),
            "techCosts": v(&o.scalars.tech_costs),
            "opponentsAlive": o.scalars.opponents_alive,
            "relations": v(&o.scalars.relations),
            "peaceOffers": v(&o.scalars.peace_offers),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bot::tests::{from_bits, guarded, ref_rows};

    #[test]
    fn observations_match_typescript() {
        let Some(rows) = ref_rows() else {
            eprintln!("bot reference data missing: skipped");
            return;
        };
        let (mut ok, mut gated, mut bad) = (0usize, 0usize, 0usize);
        let mut checked_channels = false;
        for row in &rows {
            let Some(obs) = row.get("obs").and_then(|o| o.as_array()) else { continue };
            let s = crate::json::state_from_json(&row["state"]).unwrap();
            for o in obs {
                let p = o["p"].as_i64().unwrap() as i32;
                if !checked_channels {
                    let want: Vec<&str> = o["channels"].as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
                    assert_eq!(channels(), &want[..]);
                    checked_channels = true;
                }
                let got = match guarded(|| observe(&s, p)) {
                    Ok(g) => g,
                    Err(true) => {
                        gated += 1;
                        continue;
                    }
                    Err(false) => {
                        bad += 1;
                        continue;
                    }
                };
                let mut want = vec![0f32; o["len"].as_u64().unwrap() as usize];
                for e in o["nz"].as_array().unwrap() {
                    want[e[0].as_u64().unwrap() as usize] = from_bits(&e[1]) as f32;
                }
                let j = observation_to_json(&got);
                let same = got.planes == want && j["scalars"] == o["scalars"];
                if same {
                    ok += 1;
                } else {
                    bad += 1;
                    if bad <= 5 {
                        let n = (got.map_size * got.map_size) as usize;
                        let diffs: Vec<String> = (0..want.len().max(got.planes.len()))
                            .filter(|&i| got.planes.get(i) != want.get(i))
                            .take(8)
                            .map(|i| format!("{}@{} rust {:?} ts {:?}", channels()[i / n], i % n, got.planes.get(i), want.get(i)))
                            .collect();
                        eprintln!("game {} step {} p{p}: planes {diffs:?}; scalars rust {} ts {}", row["game"], row["step"], j["scalars"], o["scalars"]);
                    }
                }
            }
        }
        eprintln!("observe: {ok} equal, {bad} different, {gated} gated (todo!)");
        assert_eq!(bad, 0);
    }
}
