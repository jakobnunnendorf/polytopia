//! Invariant: no boat ever stands on dry land. A boat moving onto land disembarks into its
//! carried unit; ships may stand only on water, ocean or flooded land (Aquarion).
//! Regression for boats drawn on green land in the app: a boat that captured a flooded city
//! stayed a boat after the capture drained the tile (actions.rs do_capture).
use crate::actions::apply_action;
use crate::bot_full::{full_bot_step, full_weights, FullWeights};
use crate::data::unit_def;
use crate::grid::{is_water, tile_at};
use crate::types::*;

fn weights(model: &str) -> FullWeights {
    let path = format!("{}/../../models/{model}/model.json", env!("CARGO_MANIFEST_DIR"));
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    full_weights(&v["full"]).unwrap()
}

/// the first unit that is a boat (carries a unit or is a ship) on a dry land tile
fn boat_on_land(s: &GameState) -> Option<String> {
    s.units.iter().find_map(|u| {
        let t = tile_at(s, u.x, u.y);
        let boat = u.carried.is_some() || unit_def(u.ty).naval;
        (boat && !is_water(t) && !t.flooded).then(|| {
            format!("{:?} carrying {:?} of p{} at ({},{}) on {:?}, city {:?}, building {:?}", u.ty, u.carried, u.owner, u.x, u.y, t.terrain, t.city_id, t.building)
        })
    })
}

/// seeded 4-player Crazy Perfection games between the full-bot models (as in the app), checked
/// after every action; seed 8 has a Raft capture a flooded Aquarion city on turn 19
#[test]
fn no_boat_stands_on_land() {
    let ws: Vec<FullWeights> = ["greedy-full-probe", "greedy-full-economy", "greedy-full-front", "greedy-full-probe"].iter().map(|m| weights(m)).collect();
    for seed in 1..=24i64 {
        let mut s = crate::state::create_game(&crate::state::NewGameOptions {
            map_size: None,
            players: 4,
            mode: GameMode::Perfection,
            difficulty: Some(Difficulty::Crazy),
            seed,
            humans: Some(vec![]),
            map_type: None,
            clans: None,
            turn_limit: None,
        })
        .unwrap();
        let mut moves = 0;
        while !s.over && moves < 20000 {
            let a = full_bot_step(&s, &ws[s.current as usize % ws.len()]);
            apply_action(&mut s, &a).unwrap();
            moves += 1;
            if let Some(msg) = boat_on_land(&s) {
                panic!("seed {seed}, turn {}, after {a:?}: {msg}", s.turn);
            }
        }
    }
}
