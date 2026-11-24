//! One JSON entry point to the engine: `call(name, args)`, where `name` is the
//! TypeScript function name and `args` its arguments in TypeScript order, in
//! the JSON shape of logic/engine/types.ts. The TypeScript facade
//! (logic/engine/rust.ts) and the Node, WebAssembly and Python bindings all go
//! through here, so they behave the same.
//!
//! Functions that mutate their state argument in TypeScript return
//! `{"state": <the mutated state>, "ret": <their return value>}`; the facade
//! copies the state back into the caller's object. Functions returning a unit
//! or city of the state return its index as `{"unitIndex": i}` /
//! `{"cityIndex": i}` (or null), so the facade can hand back the caller's own
//! object.

use polycore::actions::{apply_action, legal_actions, run_explorer};
use polycore::bot::{bot_step, play_bot_turn, score_action, GreedyWeights};
use polycore::combat::{compute_damage, compute_damage_rounded, defence_bonus, half_damage};
use polycore::diplomacy as dip;
use polycore::json::*;
use polycore::mapgen::{self, MapOptions, MapType, Mods};
use polycore::movement::{self as mv, StepKind};
use polycore::observe::{channels, observation_to_json, observe};
use polycore::opinion;
use polycore::rng::Rng;
use polycore::state::{self as st, NewGameOptions};
use polycore::types::*;
use serde_json::{json, Value};

type R<T> = Result<T, String>;

fn arg(args: &[Value], i: usize) -> &Value {
    args.get(i).unwrap_or(&Value::Null)
}
fn state(args: &[Value], i: usize) -> R<GameState> {
    state_from_json(arg(args, i))
}
fn int(v: &Value, what: &str) -> R<i32> {
    v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i32).ok_or_else(|| format!("{what}: expected an integer"))
}
fn num(v: &Value, what: &str) -> R<f64> {
    v.as_f64().ok_or_else(|| format!("{what}: expected a number"))
}
fn coord(v: &Value) -> R<Coord> {
    Ok(Coord { x: int(&v["x"], "x")?, y: int(&v["y"], "y")? })
}
fn weights(v: &Value) -> R<GreedyWeights> {
    if v.is_null() {
        Ok(GreedyWeights::default_weights())
    } else {
        GreedyWeights::from_json(v)
    }
}
fn unit_index(s: &GameState, u: &Value) -> R<usize> {
    let id = int(&u["id"], "unit id")?;
    s.units.iter().position(|x| x.id == id).ok_or_else(|| format!("unit {id} is not in the state"))
}
fn city_index(s: &GameState, c: &Value) -> R<usize> {
    let id = int(&c["id"], "city id")?;
    s.cities.iter().position(|x| x.id == id).ok_or_else(|| format!("city {id} is not in the state"))
}
fn mutated(s: &GameState, ret: Value) -> Value {
    json!({"state": state_to_json(s), "ret": ret})
}
fn step_kind(k: StepKind) -> &'static str {
    match k {
        StepKind::Normal => "normal",
        StepKind::Embark => "embark",
        StepKind::Disembark => "disembark",
    }
}
fn tech(v: &Value) -> R<Tech> {
    v.as_str().and_then(Tech::from_id).ok_or_else(|| format!("unknown tech {v}"))
}
fn opinion_level(l: opinion::OpinionLevel) -> &'static str {
    use opinion::OpinionLevel::*;
    match l {
        Horrible => "horrible",
        Poor => "poor",
        Indifferent => "indifferent",
        Decent => "decent",
        Great => "great",
    }
}
fn relation(r: dip::Relation) -> &'static str {
    match r {
        dip::Relation::SelfRel => "self",
        dip::Relation::Peace => "peace",
        dip::Relation::War => "war",
        dip::Relation::Hostile => "hostile",
        dip::Relation::Neutral => "neutral",
    }
}

fn mods_from(v: &Value) -> R<Vec<Mods>> {
    let Some(a) = v.as_array() else { return Ok(vec![]) };
    a.iter()
        .map(|m| {
            let mut out: Mods = [None; ModKey::COUNT];
            if let Some(o) = m.as_object() {
                for (k, x) in o {
                    let key = ModKey::from_id(k).ok_or_else(|| format!("unknown modifier {k}"))?;
                    if !x.is_null() {
                        out[key as usize] = Some(num(x, k)?);
                    }
                }
            }
            Ok(out)
        })
        .collect()
}

fn bools(v: &Value) -> Option<Vec<bool>> {
    v.as_array().map(|a| a.iter().map(|x| x.as_bool().unwrap_or(false)).collect())
}

fn map_options(v: &Value) -> R<MapOptions> {
    Ok(MapOptions {
        start_resources: match v.get("startResources").and_then(|x| x.as_array()) {
            None => None,
            Some(a) => Some(
                a.iter()
                    .map(|l| {
                        l.as_array()
                            .map(|l| l.iter().map(|r| r.as_str().and_then(Resource::from_id).ok_or_else(|| format!("unknown resource {r}"))).collect::<R<Vec<_>>>())
                            .unwrap_or(Ok(vec![]))
                    })
                    .collect::<R<Vec<_>>>()?,
            ),
        },
        water_start: v.get("waterStart").and_then(bools),
        flooded: v.get("flooded").and_then(bools),
        spores: v.get("spores").and_then(bools),
        polaris: v.get("polaris").and_then(bools),
        climates: v.get("climates").and_then(|x| x.as_array()).map(|a| a.iter().map(|c| c.as_str().unwrap_or("").to_string()).collect()),
    })
}

/// one bot-vs-bot game for training scripts: like scripts/train-hill.ts `play`
fn play_greedy(spec: &Value) -> R<Value> {
    let opts = NewGameOptions::from_json(&spec["opts"])?;
    let ws: Vec<GreedyWeights> = spec["weights"].as_array().ok_or("weights: array")?.iter().map(weights).collect::<R<_>>()?;
    let max_moves = spec.get("maxMoves").and_then(|x| x.as_i64()).unwrap_or(20000);
    let max_turn = spec.get("maxTurn").and_then(|x| x.as_i64());
    let mut s = st::create_game(&opts)?;
    let mut moves = 0;
    while !s.over && moves < max_moves && max_turn.map_or(true, |t| (s.turn as i64) <= t) {
        let w = &ws[(s.current as usize) % ws.len()];
        let a = bot_step(&s, w);
        apply_action(&mut s, &a)?;
        moves += 1;
    }
    let scores: Vec<i32> = (0..s.players.len() as i32).map(|p| st::score_of(&s, p)).collect();
    Ok(json!({"winner": s.winner, "over": s.over, "turn": s.turn, "moves": moves, "scores": scores,
              "clans": s.players.iter().map(|p| p.tribe.id()).collect::<Vec<_>>()}))
}

pub fn call(name: &str, args: &[Value]) -> R<Value> {
    Ok(match name {
        // ---- actions.ts
        "legalActions" => Value::Array(legal_actions(&state(args, 0)?).iter().map(action_to_json).collect()),
        "applyAction" => {
            let mut s = state(args, 0)?;
            apply_action(&mut s, &action_from_json(arg(args, 1))?)?;
            state_to_json(&s)
        }
        "runExplorer" => {
            let mut s = state(args, 0)?;
            run_explorer(&mut s, int(arg(args, 1), "player")?, coord(arg(args, 2))?);
            mutated(&s, Value::Null)
        }
        // ---- bot.ts
        "botStep" => action_to_json(&bot_step(&state(args, 0)?, &weights(arg(args, 1))?)),
        "scoreAction" => json!(score_action(&state(args, 0)?, &action_from_json(arg(args, 1))?, &weights(arg(args, 2))?)),
        "playBotTurn" => {
            let mut s = state(args, 0)?;
            let max = arg(args, 1).as_i64().unwrap_or(300) as i32;
            play_bot_turn(&mut s, max, &weights(arg(args, 2))?);
            state_to_json(&s)
        }
        "playGreedyGames" => {
            let specs = arg(args, 0).as_array().ok_or("playGreedyGames: array of games")?;
            Value::Array(specs.iter().map(play_greedy).collect::<R<_>>()?)
        }
        // ---- observe.ts
        "observe" => observation_to_json(&observe(&state(args, 0)?, int(arg(args, 1), "player")?)),
        "CHANNELS" => json!(channels()),
        // ---- combat.ts
        "computeDamage" => {
            let n = |i: usize| num(arg(args, i), "computeDamage");
            let r = compute_damage(n(0)?, n(1)? as i32, n(2)? as i32, n(3)?, n(4)? as i32, n(5)? as i32, n(6)?);
            json!({"damage": r.damage, "retaliation": r.retaliation})
        }
        "computeDamageRounded" => {
            let s = state(args, 0)?;
            let r = compute_damage_rounded(&s, &unit_from_json(arg(args, 1))?, &unit_from_json(arg(args, 2))?);
            json!({"damage": r.damage, "retaliation": r.retaliation})
        }
        "defenceBonus" => json!(defence_bonus(&state(args, 0)?, &unit_from_json(arg(args, 1))?)),
        "halfDamage" => json!(half_damage(int(arg(args, 0), "damage")?)),
        // ---- movement.ts
        "reachable" => {
            let s = state(args, 0)?;
            let t = mv::reachable(&s, &unit_from_json(arg(args, 1))?);
            Value::Array(t.iter().map(|m| json!({"x": m.x, "y": m.y, "kind": step_kind(m.kind)})).collect())
        }
        "pathTo" => {
            let s = state(args, 0)?;
            let p = mv::path_to(&s, &unit_from_json(arg(args, 1))?, coord(arg(args, 2))?);
            Value::Array(p.iter().map(|c| json!({"x": c.x, "y": c.y})).collect())
        }
        "canSee" => json!(mv::can_see(&state(args, 0)?, int(arg(args, 1), "player")?, &unit_from_json(arg(args, 2))?)),
        "sightRadius" => json!(mv::sight_radius(&state(args, 0)?, &unit_from_json(arg(args, 1))?)),
        "movementRange" => json!(mv::movement_range(&state(args, 0)?, &unit_from_json(arg(args, 1))?)),
        "territoryOwner" => json!(mv::territory_owner(&state(args, 0)?, &tile_from_json(arg(args, 1))?)),
        "enterKind" => json!(mv::enter_kind(&state(args, 0)?, &unit_from_json(arg(args, 1))?, &tile_from_json(arg(args, 2))?).map(step_kind)),
        // ---- diplomacy.ts
        "atPeace" => json!(dip::at_peace(&state(args, 0)?, int(arg(args, 1), "a")?, int(arg(args, 2), "b")?)),
        "atWar" => json!(dip::at_war(&state(args, 0)?, int(arg(args, 1), "a")?, int(arg(args, 2), "b")?)),
        "inCeasefire" => json!(dip::in_ceasefire(&state(args, 0)?, int(arg(args, 1), "a")?, int(arg(args, 2), "b")?)),
        "relation" => json!(relation(dip::relation(&state(args, 0)?, int(arg(args, 1), "a")?, int(arg(args, 2), "b")?))),
        "canHarm" => json!(dip::can_harm(&state(args, 0)?, int(arg(args, 1), "a")?, int(arg(args, 2), "b")?)),
        "hasOffer" => json!(dip::has_offer(&state(args, 0)?, int(arg(args, 1), "from")?, int(arg(args, 2), "to")?)),
        "ordinal" => json!(dip::ordinal(&state(args, 0)?)),
        "makePeace" | "recordAttack" => {
            let mut s = state(args, 0)?;
            let (a, b) = (int(arg(args, 1), "a")?, int(arg(args, 2), "b")?);
            if name == "makePeace" {
                dip::make_peace(&mut s, a, b)
            } else {
                dip::record_attack(&mut s, a, b)
            }
            mutated(&s, Value::Null)
        }
        // ---- opinion.ts
        "opinionOf" => json!(opinion_level(opinion::opinion_of(&state(args, 0)?, int(arg(args, 1), "bot")?, int(arg(args, 2), "other")?))),
        "opinionScore" => json!(opinion::opinion_score(&state(args, 0)?, int(arg(args, 1), "bot")?, int(arg(args, 2), "other")?)),
        // ---- state.ts (pure)
        "createGame" => state_to_json(&st::create_game(&NewGameOptions::from_json(arg(args, 0))?)?),
        "mapSizeFor" => json!(st::map_size_for(GameMode::from_id(arg(args, 0).as_str().unwrap_or("")).ok_or("unknown mode")?, int(arg(args, 1), "opponents")?)),
        "mapSizeAllowed" => json!(st::map_size_allowed(GameMode::from_id(arg(args, 0).as_str().unwrap_or("")).ok_or("unknown mode")?, int(arg(args, 1), "size")?)),
        "scoreOf" => json!(st::score_of(&state(args, 0)?, int(arg(args, 1), "player")?)),
        "income" => json!(st::income(&state(args, 0)?, int(arg(args, 1), "player")?)),
        "techCost" => json!(st::tech_cost(&state(args, 0)?, int(arg(args, 1), "player")?, tech(arg(args, 2))?)),
        "canResearch" => json!(st::can_research(&state(args, 0)?, int(arg(args, 1), "player")?, tech(arg(args, 2))?)),
        "cityIncome" => json!(st::city_income(&state(args, 0)?, &city_from_json(arg(args, 1))?)),
        "underSiege" => json!(st::under_siege(&state(args, 0)?, &city_from_json(arg(args, 1))?)),
        "unitsHomedIn" => json!(st::units_homed_in(&state(args, 0)?, &city_from_json(arg(args, 1))?)),
        "unitCapacity" => json!(st::unit_capacity(&city_from_json(arg(args, 0))?)),
        "cityScore" => json!(st::city_score(&city_from_json(arg(args, 0))?)),
        "iceBankLevel" => json!(st::ice_bank_level(&state(args, 0)?)),
        "resourceVisible" => {
            let r = arg(args, 2).as_str().and_then(Resource::from_id).ok_or("unknown resource")?;
            json!(st::resource_visible(&state(args, 0)?, int(arg(args, 1), "player")?, r))
        }
        "perfectionRating" => json!(st::perfection_rating(&state(args, 0)?, int(arg(args, 1), "player")?)),
        "dominationRating" => json!(st::domination_rating(&state(args, 0)?, int(arg(args, 1), "player")?)),
        "dominationStars" => json!(st::domination_stars(num(arg(args, 0), "rating")?)),
        "perfectionStars" => json!(st::perfection_stars(num(arg(args, 0), "rating")?)),
        "leader" => json!(st::leader(&state(args, 0)?)),
        "capitalOf" => json!({"cityIndex": st::capital_of(&state(args, 0)?, int(arg(args, 1), "player")?)}),
        "cityById" => {
            let id = if arg(args, 1).is_null() { None } else { Some(int(arg(args, 1), "id")?) };
            json!({"cityIndex": st::city_by_id(&state(args, 0)?, id)})
        }
        "pendingReward" => match st::pending_reward(&state(args, 0)?) {
            None => Value::Null,
            Some((ci, opts)) => json!({"cityIndex": ci, "options": [opts[0].id(), opts[1].id()]}),
        },
        // ---- state.ts (mutating)
        "makeUnit" => {
            let mut s = state(args, 0)?;
            let ty = arg(args, 1).as_str().and_then(UnitType::from_id).ok_or("unknown unit type")?;
            let home = if arg(args, 4).is_null() { None } else { Some(int(arg(args, 4), "homeCity")?) };
            let i = st::make_unit(&mut s, ty, int(arg(args, 2), "owner")?, coord(arg(args, 3))?, home);
            mutated(&s, json!({"unitIndex": i}))
        }
        "newCity" => {
            let mut s = state(args, 0)?;
            let i = st::new_city(&mut s, coord(arg(args, 1))?, int(arg(args, 2), "owner")?);
            mutated(&s, json!({"cityIndex": i}))
        }
        "pushUnit" => {
            let mut s = state(args, 0)?;
            let ui = unit_index(&s, arg(args, 1))?;
            let spawner = if arg(args, 2).is_null() { s.units[ui].owner } else { int(arg(args, 2), "spawner")? };
            let kept = st::push_unit(&mut s, ui, spawner);
            mutated(&s, json!(kept))
        }
        "claimTerritory" | "addPop" => {
            let mut s = state(args, 0)?;
            let ci = city_index(&s, arg(args, 1))?;
            let n = int(arg(args, 2), "n")?;
            if name == "claimTerritory" {
                st::claim_territory(&mut s, ci, n)
            } else {
                st::add_pop(&mut s, ci, n)
            }
            mutated(&s, Value::Null)
        }
        "explore" => {
            let mut s = state(args, 0)?;
            st::explore(&mut s, int(arg(args, 1), "player")?, coord(arg(args, 2))?, int(arg(args, 3), "r")?);
            mutated(&s, Value::Null)
        }
        "meet" => {
            let mut s = state(args, 0)?;
            st::meet(&mut s, int(arg(args, 1), "p")?, int(arg(args, 2), "other")?);
            mutated(&s, Value::Null)
        }
        "updateConnections" | "checkTasks" | "growUnits" => {
            let mut s = state(args, 0)?;
            let p = int(arg(args, 1), "player")?;
            match name {
                "updateConnections" => st::update_connections(&mut s, p),
                "checkTasks" => st::check_tasks(&mut s, p),
                _ => st::grow_units(&mut s, p),
            }
            mutated(&s, Value::Null)
        }
        "checkMeetings" | "checkElimination" | "startTurn" => {
            let mut s = state(args, 0)?;
            match name {
                "checkMeetings" => st::check_meetings(&mut s),
                "checkElimination" => st::check_elimination(&mut s),
                _ => st::start_turn(&mut s),
            }
            mutated(&s, Value::Null)
        }
        "checkGameEnd" => {
            let mut s = state(args, 0)?;
            st::check_game_end(&mut s, arg(args, 1).as_bool().unwrap_or(false));
            mutated(&s, Value::Null)
        }
        // ---- mapgen.ts
        "generateMap" => {
            // args: rng state, n, players, mapType, mods, opts -> {map, rng}
            let mut rng = Rng::from_state(arg(args, 0).as_u64().ok_or("rng state")? as u32);
            let mt = match arg(args, 3).as_str() {
                None => MapType::Drylands,
                Some(m) => MapType::from_id(m).ok_or("unknown map type")?,
            };
            let m = mapgen::generate_map(&mut rng, int(arg(args, 1), "n")?, int(arg(args, 2), "players")?, mt, &mods_from(arg(args, 4))?, &map_options(arg(args, 5))?);
            json!({
                "map": {
                    "tiles": m.tiles.iter().map(tile_to_json).collect::<Vec<_>>(),
                    "capitals": m.capitals.iter().map(|c| json!({"x": c.x, "y": c.y})).collect::<Vec<_>>(),
                    "villages": m.villages.iter().map(|c| json!({"x": c.x, "y": c.y})).collect::<Vec<_>>(),
                },
                "rng": rng.state(),
            })
        }
        "ruinCount" => json!(mapgen::ruin_count(int(arg(args, 0), "size")?)),
        // ---- grid.ts
        "cloneState" => state_to_json(&polycore::grid::clone_state(&state(args, 0)?)),
        _ => return Err(format!("unknown engine function {name}")),
    })
}

/// `call` with the arguments and the result as JSON text (for the C ABI bindings)
pub fn call_json(name: &str, args_json: &str) -> String {
    let args: Value = match serde_json::from_str(args_json) {
        Ok(v) => v,
        Err(e) => return json!({"error": format!("bad arguments: {e}")}).to_string(),
    };
    let list = match args {
        Value::Array(a) => a,
        v => vec![v],
    };
    match call(name, &list) {
        Ok(v) => json!({"ok": v}).to_string(),
        Err(e) => json!({"error": e}).to_string(),
    }
}
