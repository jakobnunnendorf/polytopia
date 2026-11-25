//! Conversion between the Rust state and the JSON shape of logic/engine/types.ts.
//!
//! `state_to_json` writes every field (optional booleans as false, absent
//! Options as left out); `state_from_json` accepts states saved by the
//! TypeScript engine, including older ones that leave optional fields out.
//! A fractional or out-of-range number is an error, never rounded.

use crate::types::*;
use serde_json::{json, Map, Value};

type R<T> = Result<T, String>;

fn int(v: &Value, what: &str) -> R<i32> {
    match v.as_f64() {
        Some(f) if f.fract() == 0.0 && f >= i32::MIN as f64 && f <= i32::MAX as f64 => Ok(f as i32),
        _ => Err(format!("{what}: expected an integer, got {v}")),
    }
}
fn int64(v: &Value, what: &str) -> R<i64> {
    match v.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 => Ok(f as i64),
        _ => Err(format!("{what}: expected an integer, got {v}")),
    }
}
fn get<'a>(o: &'a Map<String, Value>, k: &str) -> &'a Value {
    o.get(k).unwrap_or(&Value::Null)
}
fn req_int(o: &Map<String, Value>, k: &str) -> R<i32> {
    int(get(o, k), k)
}
fn opt_int(o: &Map<String, Value>, k: &str) -> R<Option<i32>> {
    match get(o, k) {
        Value::Null => Ok(None),
        v => int(v, k).map(Some),
    }
}
fn flag(o: &Map<String, Value>, k: &str) -> R<bool> {
    match get(o, k) {
        Value::Null => Ok(false),
        Value::Bool(b) => Ok(*b),
        v => Err(format!("{k}: expected a boolean, got {v}")),
    }
}
fn req_str<'a>(o: &'a Map<String, Value>, k: &str) -> R<&'a str> {
    get(o, k).as_str().ok_or_else(|| format!("{k}: expected a string"))
}
fn obj<'a>(v: &'a Value, what: &str) -> R<&'a Map<String, Value>> {
    v.as_object().ok_or_else(|| format!("{what}: expected an object"))
}
fn arr<'a>(o: &'a Map<String, Value>, k: &str) -> R<&'a [Value]> {
    match get(o, k) {
        Value::Null => Ok(&[]),
        Value::Array(a) => Ok(a),
        _ => Err(format!("{k}: expected an array")),
    }
}
fn ints(o: &Map<String, Value>, k: &str) -> R<Vec<i32>> {
    arr(o, k)?.iter().map(|v| int(v, k)).collect()
}
fn ids<T>(o: &Map<String, Value>, k: &str, f: fn(&str) -> Option<T>) -> R<Vec<T>> {
    arr(o, k)?
        .iter()
        .map(|v| v.as_str().and_then(f).ok_or_else(|| format!("{k}: unknown id {v}")))
        .collect()
}
fn id_of<T>(v: &Value, what: &str, f: fn(&str) -> Option<T>) -> R<T> {
    v.as_str().and_then(f).ok_or_else(|| format!("{what}: unknown id {v}"))
}
fn opt_id<T>(o: &Map<String, Value>, k: &str, f: fn(&str) -> Option<T>) -> R<Option<T>> {
    match get(o, k) {
        Value::Null => Ok(None),
        v => id_of(v, k, f).map(Some),
    }
}
fn coord(v: &Value, what: &str) -> R<Coord> {
    let o = obj(v, what)?;
    Ok(Coord { x: req_int(o, "x")?, y: req_int(o, "y")? })
}
fn opt_v<T: Into<Value>>(x: Option<T>) -> Value {
    x.map(Into::into).unwrap_or(Value::Null)
}
fn cj(c: Coord) -> Value {
    json!({"x": c.x, "y": c.y})
}

pub fn tile_to_json(t: &Tile) -> Value {
    json!({
        "terrain": t.terrain.id(),
        "resource": opt_v(t.resource.map(|r| r.id())),
        "building": opt_v(t.building.map(|b| b.id())),
        "buildingLevel": t.building_level,
        "builtTurn": t.built_turn,
        "road": t.road,
        "cityId": opt_v(t.city_id),
        "village": t.village,
        "ruin": t.ruin,
        "lighthouse": t.lighthouse,
        "territory": opt_v(t.territory),
        "ice": t.ice,
        "polar": t.polar,
        "algae": t.algae,
        "flooded": t.flooded,
        "lostCity": t.lost_city,
        "decomposing": t.decomposing,
    })
}

pub fn tile_from_json(v: &Value) -> R<Tile> {
    let o = obj(v, "tile")?;
    Ok(Tile {
        terrain: id_of(get(o, "terrain"), "terrain", Terrain::from_id)?,
        resource: opt_id(o, "resource", Resource::from_id)?,
        building: opt_id(o, "building", Build::from_id)?,
        building_level: opt_int(o, "buildingLevel")?.unwrap_or(0),
        built_turn: opt_int(o, "builtTurn")?.unwrap_or(0),
        road: flag(o, "road")?,
        city_id: opt_int(o, "cityId")?,
        village: flag(o, "village")?,
        ruin: flag(o, "ruin")?,
        lighthouse: flag(o, "lighthouse")?,
        territory: opt_int(o, "territory")?,
        ice: flag(o, "ice")?,
        polar: flag(o, "polar")?,
        algae: flag(o, "algae")?,
        flooded: flag(o, "flooded")?,
        lost_city: flag(o, "lostCity")?,
        decomposing: flag(o, "decomposing")?,
    })
}

pub fn unit_to_json(u: &Unit) -> Value {
    let mut v = json!({
        "id": u.id,
        "type": u.ty.id(),
        "carried": opt_v(u.carried.map(|c| c.id())),
        "owner": u.owner,
        "x": u.x,
        "y": u.y,
        "hp": u.hp,
        "maxHp": u.max_hp,
        "kills": u.kills,
        "veteran": u.veteran,
        "homeCity": opt_v(u.home_city),
        "canMove": u.can_move,
        "canAttack": u.can_attack,
        "moved": u.moved,
        "attacked": u.attacked,
        "done": u.done,
        "idle": u.idle,
        "hidden": u.hidden,
        "lastDir": u.last_dir.map(cj).unwrap_or(Value::Null),
        "frozen": u.frozen,
        "poisoned": u.poisoned,
        "swarmed": u.swarmed,
        "bubble": u.bubble,
        "secondAttack": u.second_attack,
    });
    let m = v.as_object_mut().unwrap();
    if let Some(b) = u.body_of {
        m.insert("bodyOf".into(), b.into());
    }
    if let Some(t) = u.created_turn {
        m.insert("createdTurn".into(), t.into());
    }
    v
}

pub fn unit_from_json(v: &Value) -> R<Unit> {
    let o = obj(v, "unit")?;
    Ok(Unit {
        id: req_int(o, "id")?,
        ty: id_of(get(o, "type"), "unit type", UnitType::from_id)?,
        carried: opt_id(o, "carried", UnitType::from_id)?,
        owner: req_int(o, "owner")?,
        x: req_int(o, "x")?,
        y: req_int(o, "y")?,
        hp: req_int(o, "hp")?,
        max_hp: req_int(o, "maxHp")?,
        kills: opt_int(o, "kills")?.unwrap_or(0),
        veteran: flag(o, "veteran")?,
        home_city: opt_int(o, "homeCity")?,
        can_move: flag(o, "canMove")?,
        can_attack: flag(o, "canAttack")?,
        moved: flag(o, "moved")?,
        attacked: flag(o, "attacked")?,
        done: flag(o, "done")?,
        idle: flag(o, "idle")?,
        hidden: flag(o, "hidden")?,
        last_dir: match get(o, "lastDir") {
            Value::Null => None,
            c => Some(coord(c, "lastDir")?),
        },
        frozen: flag(o, "frozen")?,
        poisoned: flag(o, "poisoned")?,
        swarmed: flag(o, "swarmed")?,
        bubble: flag(o, "bubble")?,
        second_attack: flag(o, "secondAttack")?,
        body_of: opt_int(o, "bodyOf")?,
        created_turn: opt_int(o, "createdTurn")?,
    })
}

pub fn city_to_json(c: &City) -> Value {
    json!({
        "id": c.id, "name": c.name, "owner": c.owner, "x": c.x, "y": c.y, "level": c.level, "pop": c.pop,
        "capital": c.capital, "originalCapitalOf": opt_v(c.original_capital_of), "walls": c.walls,
        "workshop": c.workshop, "parks": c.parks, "connected": c.connected, "riot": c.riot,
        "pendingRewards": c.pending_rewards,
    })
}

pub fn city_from_json(v: &Value) -> R<City> {
    let o = obj(v, "city")?;
    Ok(City {
        id: req_int(o, "id")?,
        name: req_str(o, "name")?.to_string(),
        owner: req_int(o, "owner")?,
        x: req_int(o, "x")?,
        y: req_int(o, "y")?,
        level: req_int(o, "level")?,
        pop: req_int(o, "pop")?,
        capital: flag(o, "capital")?,
        original_capital_of: opt_int(o, "originalCapitalOf")?,
        walls: flag(o, "walls")?,
        workshop: flag(o, "workshop")?,
        parks: opt_int(o, "parks")?.unwrap_or(0),
        connected: flag(o, "connected")?,
        riot: flag(o, "riot")?,
        pending_rewards: ints(o, "pendingRewards")?,
    })
}

pub fn player_to_json(p: &Player) -> Value {
    let mut v = json!({
        "id": p.id,
        "clan": p.tribe.id(),
        "stars": p.stars,
        "techs": p.techs.iter().map(|t| t.id()).collect::<Vec<_>>(),
        "explored": p.explored,
        "alive": p.alive,
        "bot": p.bot,
        "kills": p.kills,
        "losses": p.losses,
        "met": p.met,
        "tasks": p.tasks.iter().map(|t| t.id()).collect::<Vec<_>>(),
        "monuments": p.monuments.iter().map(|t| t.id()).collect::<Vec<_>>(),
        "pacifistTurns": p.pacifist_turns,
        "attackedThisTurn": p.attacked_this_turn,
        "lighthouses": p.lighthouses,
        "embassies": p.embassies,
        "capitalId": p.capital_id,
    });
    let m = v.as_object_mut().unwrap();
    if let Some(c) = p.conversions {
        m.insert("conversions".into(), c.into());
    }
    if !p.met_turns.is_empty() {
        m.insert("metTurns".into(), p.met_turns.clone().into());
    }
    if let Some(b) = &p.built_unique {
        m.insert("builtUnique".into(), b.iter().map(|t| t.id()).collect::<Vec<_>>().into());
    }
    v
}

pub fn player_from_json(v: &Value) -> R<Player> {
    let o = obj(v, "player")?;
    Ok(Player {
        id: req_int(o, "id")?,
        tribe: id_of(get(o, "clan"), "clan", Tribe::from_id)?,
        stars: req_int(o, "stars")?,
        techs: ids(o, "techs", Tech::from_id)?,
        explored: arr(o, "explored")?
            .iter()
            .map(|v| int(v, "explored").map(|x| x as u8))
            .collect::<R<Vec<u8>>>()?,
        alive: flag(o, "alive")?,
        bot: flag(o, "bot")?,
        kills: opt_int(o, "kills")?.unwrap_or(0),
        losses: opt_int(o, "losses")?.unwrap_or(0),
        met: ints(o, "met")?,
        met_turns: ints(o, "metTurns")?,
        tasks: ids(o, "tasks", Task::from_id)?,
        monuments: ids(o, "monuments", Build::from_id)?,
        pacifist_turns: opt_int(o, "pacifistTurns")?.unwrap_or(0),
        attacked_this_turn: flag(o, "attackedThisTurn")?,
        lighthouses: ints(o, "lighthouses")?,
        embassies: ints(o, "embassies")?,
        capital_id: req_int(o, "capitalId")?,
        conversions: opt_int(o, "conversions")?,
        built_unique: match get(o, "builtUnique") {
            Value::Null => None,
            _ => Some(ids(o, "builtUnique", Build::from_id)?),
        },
    })
}

pub fn diplomacy_to_json(d: &Diplomacy) -> Value {
    let mut v = json!({
        "peace": d.peace,
        "offers": d.offers.iter().map(|x| json!({"from": x.from, "to": x.to})).collect::<Vec<_>>(),
        "attacks": d.attacks.iter().map(|x| json!({"by": x.by, "on": x.on, "turn": x.turn})).collect::<Vec<_>>(),
        "ceasefires": d.ceasefires.iter().map(|x| json!({"breaker": x.breaker, "victim": x.victim, "until": x.until})).collect::<Vec<_>>(),
        "broken": d.broken,
    });
    if !d.broken_turns.is_empty() {
        v.as_object_mut().unwrap().insert("brokenTurns".into(), json!(d.broken_turns));
    }
    v
}

fn pairs(o: &Map<String, Value>, k: &str) -> R<Vec<[i32; 2]>> {
    arr(o, k)?
        .iter()
        .map(|v| match v.as_array() {
            Some(a) if a.len() == 2 => Ok([int(&a[0], k)?, int(&a[1], k)?]),
            _ => Err(format!("{k}: expected a pair")),
        })
        .collect()
}

pub fn diplomacy_from_json(v: &Value) -> R<Diplomacy> {
    let o = obj(v, "diplomacy")?;
    Ok(Diplomacy {
        peace: pairs(o, "peace")?,
        offers: arr(o, "offers")?
            .iter()
            .map(|v| {
                let m = obj(v, "offer")?;
                Ok(Offer { from: req_int(m, "from")?, to: req_int(m, "to")? })
            })
            .collect::<R<_>>()?,
        attacks: arr(o, "attacks")?
            .iter()
            .map(|v| {
                let m = obj(v, "attack")?;
                Ok(AttackRecord { by: req_int(m, "by")?, on: req_int(m, "on")?, turn: req_int(m, "turn")? })
            })
            .collect::<R<_>>()?,
        ceasefires: arr(o, "ceasefires")?
            .iter()
            .map(|v| {
                let m = obj(v, "ceasefire")?;
                Ok(Ceasefire { breaker: req_int(m, "breaker")?, victim: req_int(m, "victim")?, until: req_int(m, "until")? })
            })
            .collect::<R<_>>()?,
        broken: pairs(o, "broken")?,
        broken_turns: arr(o, "brokenTurns")?
            .iter()
            .map(|v| match v.as_array() {
                Some(a) if a.len() == 3 => Ok([int(&a[0], "brokenTurns")?, int(&a[1], "brokenTurns")?, int(&a[2], "brokenTurns")?]),
                _ => Err("brokenTurns: expected [low, high, turn]".to_string()),
            })
            .collect::<R<_>>()?,
    })
}

pub fn state_to_json(s: &GameState) -> Value {
    let mut v = json!({
        "seed": s.seed,
        "rng": s.rng,
        "mapSize": s.map_size,
        "mode": s.mode.id(),
        "maxTurns": s.max_turns,
        "turn": s.turn,
        "current": s.current,
        "tiles": s.tiles.iter().map(tile_to_json).collect::<Vec<_>>(),
        "units": s.units.iter().map(unit_to_json).collect::<Vec<_>>(),
        "cities": s.cities.iter().map(city_to_json).collect::<Vec<_>>(),
        "players": s.players.iter().map(player_to_json).collect::<Vec<_>>(),
        "nextId": s.next_id,
        "winner": opt_v(s.winner),
        "over": s.over,
        "log": s.log,
    });
    let m = v.as_object_mut().unwrap();
    if let Some(d) = s.difficulty {
        m.insert("difficulty".into(), d.id().into());
    }
    if let Some(d) = &s.diplomacy {
        m.insert("diplomacy".into(), diplomacy_to_json(d));
    }
    v
}

pub fn state_from_json(v: &Value) -> R<GameState> {
    let o = obj(v, "state")?;
    let rng = int64(get(o, "rng"), "rng")?;
    Ok(GameState {
        seed: int64(get(o, "seed"), "seed")?,
        rng: u32::try_from(rng).map_err(|_| format!("rng out of range: {rng}"))?,
        map_size: req_int(o, "mapSize")?,
        mode: GameMode::from_id(req_str(o, "mode")?).ok_or("unknown mode")?,
        difficulty: match get(o, "difficulty") {
            Value::Null => None,
            d => Some(Difficulty::from_id(d.as_str().unwrap_or("")).ok_or("unknown difficulty")?),
        },
        max_turns: req_int(o, "maxTurns")?,
        turn: req_int(o, "turn")?,
        current: req_int(o, "current")?,
        tiles: arr(o, "tiles")?.iter().map(tile_from_json).collect::<R<_>>()?,
        units: arr(o, "units")?.iter().map(unit_from_json).collect::<R<_>>()?,
        cities: arr(o, "cities")?.iter().map(city_from_json).collect::<R<_>>()?,
        players: arr(o, "players")?.iter().map(player_from_json).collect::<R<_>>()?,
        next_id: req_int(o, "nextId")?,
        winner: opt_int(o, "winner")?,
        over: flag(o, "over")?,
        log: arr(o, "log")?.iter().map(|x| x.as_str().map(String::from).ok_or_else(|| "log: expected strings".to_string())).collect::<R<_>>()?,
        diplomacy: match get(o, "diplomacy") {
            Value::Null => None,
            d => Some(diplomacy_from_json(d)?),
        },
    })
}

pub fn action_to_json(a: &Action) -> Value {
    use Action::*;
    match *a {
        EndTurn => json!({"type": "endTurn"}),
        Research { tech } => json!({"type": "research", "tech": tech.id()}),
        Move { unit, to } => json!({"type": "move", "unitId": unit, "to": cj(to)}),
        Attack { unit, target } => json!({"type": "attack", "unitId": unit, "targetId": target}),
        Capture { unit } => json!({"type": "capture", "unitId": unit}),
        Recover { unit } => json!({"type": "recover", "unitId": unit}),
        Examine { unit } => json!({"type": "examine", "unitId": unit}),
        Disband { unit } => json!({"type": "disband", "unitId": unit}),
        Upgrade { unit, to } => json!({"type": "upgrade", "unitId": unit, "to": to.id()}),
        Promote { unit } => json!({"type": "promote", "unitId": unit}),
        HealOthers { unit } => json!({"type": "healOthers", "unitId": unit}),
        HarvestStarfish { unit } => json!({"type": "harvestStarfish", "unitId": unit}),
        Infiltrate { unit, city } => json!({"type": "infiltrate", "unitId": unit, "cityId": city}),
        Train { city, unit } => json!({"type": "train", "cityId": city, "unit": unit.id()}),
        Build { at, building } => json!({"type": "build", "at": cj(at), "building": building.id()}),
        Reward { city, reward } => json!({"type": "reward", "cityId": city, "reward": reward.id()}),
        FreezeArea { unit } => json!({"type": "freezeArea", "unitId": unit}),
        Swarm { unit } => json!({"type": "swarm", "unitId": unit}),
        Explode { unit } => json!({"type": "explode", "unitId": unit}),
        BreakIce { unit } => json!({"type": "breakIce", "unitId": unit}),
        Drain { unit, effect } => json!({"type": "drain", "unitId": unit, "effect": match effect { DrainEffect::Flooded => "flooded", DrainEffect::Algae => "algae" }}),
        Decompose { at } => json!({"type": "decompose", "at": cj(at)}),
        OfferPeace { player } => json!({"type": "offerPeace", "player": player}),
        AcceptPeace { player } => json!({"type": "acceptPeace", "player": player}),
        DeclinePeace { player } => json!({"type": "declinePeace", "player": player}),
        BreakPeace { player } => json!({"type": "breakPeace", "player": player}),
    }
}

pub fn action_from_json(v: &Value) -> R<Action> {
    use Action::*;
    let o = obj(v, "action")?;
    let unit = || req_int(o, "unitId");
    let player = || req_int(o, "player");
    Ok(match req_str(o, "type")? {
        "endTurn" => EndTurn,
        "research" => Research { tech: id_of(get(o, "tech"), "tech", Tech::from_id)? },
        "move" => Move { unit: unit()?, to: coord(get(o, "to"), "to")? },
        "attack" => Attack { unit: unit()?, target: req_int(o, "targetId")? },
        "capture" => Capture { unit: unit()? },
        "recover" => Recover { unit: unit()? },
        "examine" => Examine { unit: unit()? },
        "disband" => Disband { unit: unit()? },
        "upgrade" => Upgrade { unit: unit()?, to: id_of(get(o, "to"), "to", UnitType::from_id)? },
        "promote" => Promote { unit: unit()? },
        "healOthers" => HealOthers { unit: unit()? },
        "harvestStarfish" => HarvestStarfish { unit: unit()? },
        "infiltrate" => Infiltrate { unit: unit()?, city: req_int(o, "cityId")? },
        "train" => Train { city: req_int(o, "cityId")?, unit: id_of(get(o, "unit"), "unit", UnitType::from_id)? },
        "build" => Build { at: coord(get(o, "at"), "at")?, building: id_of(get(o, "building"), "building", crate::types::Build::from_id)? },
        "reward" => Reward { city: req_int(o, "cityId")?, reward: id_of(get(o, "reward"), "reward", crate::types::Reward::from_id)? },
        "freezeArea" => FreezeArea { unit: unit()? },
        "swarm" => Swarm { unit: unit()? },
        "explode" => Explode { unit: unit()? },
        "breakIce" => BreakIce { unit: unit()? },
        "drain" => Drain {
            unit: unit()?,
            effect: match req_str(o, "effect")? {
                "flooded" => DrainEffect::Flooded,
                "algae" => DrainEffect::Algae,
                e => return Err(format!("unknown drain effect {e}")),
            },
        },
        "decompose" => Decompose { at: coord(get(o, "at"), "at")? },
        "offerPeace" => OfferPeace { player: player()? },
        "acceptPeace" => AcceptPeace { player: player()? },
        "declinePeace" => DeclinePeace { player: player()? },
        "breakPeace" => BreakPeace { player: player()? },
        t => return Err(format!("unknown action type {t}")),
    })
}
