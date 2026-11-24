//! polyengine: corpus replay (parity gate), state dumps, self-play and benchmarks.
//!
//!   polyengine replay <corpus dir> [--max N] [--game ID] [--no-bot]
//!   polyengine dump <corpus dir> <game id> <step>     canonical state after a step (-1: initial)
//!   polyengine hash <state.json>...                   canonical hash of saved TS states

use flate2::read::GzDecoder;
use polycore::actions::{apply_action, legal_actions};
use polycore::bot::{bot_step, GreedyWeights};
use polycore::canon::{actions_hash, canon_state, log_hash, state_hash};
use polycore::json::{action_from_json, action_to_json, state_from_json, state_to_json};
use polycore::state::{create_game, NewGameOptions};
use polycore::types::GameState;
use rayon::prelude::*;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap()
}

fn weights(name: &str) -> GreedyWeights {
    match name {
        "default" => GreedyWeights::default_weights(),
        "v4" => {
            let f = repo_root().join("models/greedy-hill-v4/model.json");
            let v: Value = serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap();
            GreedyWeights::from_json(&v["weights"]).unwrap()
        }
        w => panic!("unknown weight set {w}"),
    }
}

/// scripts/rust/trace-gen.ts obsHash: md5 of the canonical observation of the player to move
fn obs_hash(s: &GameState) -> String {
    let o = polycore::observe::observation_to_json(&polycore::observe::observe(s, s.current));
    let d = md5_hex(&polycore::canon::canon_string(&o));
    d[..16].to_string()
}

fn md5_hex(s: &str) -> String {
    polycore::canon::md5_hex(s)
}

fn dummy_weights() -> GreedyWeights {
    GreedyWeights {
        capture: 0.0, examine: 0.0, promote: 0.0, harvest_starfish: 0.0, monument: 0.0, kill: 0.0, hit: 0.0,
        special: 0.0, grow_base: 0.0, grow_per_pop: 0.0, other_build: 0.0, rich_at: 0.0, research: 0.0,
        train: 0.0, units_per_city: 0.0, move_: 0.0, recover: 0.0, heal_others: 0.0, upgrade: 0.0, noise: 0.0,
        rewards: [None; polycore::types::Reward::COUNT],
    }
}

fn read_corpus(dir: &Path) -> Vec<Value> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.to_string_lossy().ends_with(".jsonl.gz"))
        .collect();
    files.sort();
    let mut games: Vec<Value> = files
        .par_iter()
        .flat_map(|f| {
            let r = BufReader::new(GzDecoder::new(std::fs::File::open(f).unwrap()));
            r.lines().map(|l| serde_json::from_str::<Value>(&l.unwrap()).unwrap()).collect::<Vec<_>>()
        })
        .collect();
    games.sort_by_key(|g| g["spec"]["id"].as_i64().unwrap());
    games
}

#[derive(Debug)]
enum Outcome {
    Ok(usize),
    /// the oracle itself failed to create or play this game
    OracleError(String),
    Mismatch { step: i64, what: String },
    Panic { step: i64, msg: String },
}

fn replay_game(g: &Value, check_bot: bool, check_obs: bool, w_default: &GreedyWeights, w_v4: &GreedyWeights) -> Outcome {
    let spec = &g["spec"];
    if let Some(e) = g.get("error") {
        return Outcome::OracleError(e.to_string());
    }
    let step = std::cell::Cell::new(-1i64);
    let res = catch_unwind(AssertUnwindSafe(|| -> Outcome {
        let opts = match NewGameOptions::from_json(&spec["opts"]) {
            Ok(o) => o,
            Err(e) => return Outcome::Mismatch { step: -1, what: format!("options: {e}") },
        };
        let mut s = match create_game(&opts) {
            Ok(s) => s,
            Err(e) => return Outcome::Mismatch { step: -1, what: format!("createGame failed: {e}") },
        };
        let init = &g["init"];
        if state_hash(&s) != init[0].as_str().unwrap() {
            return Outcome::Mismatch { step: -1, what: "initial state".into() };
        }
        if log_hash(&s) != init[1].as_str().unwrap() {
            return Outcome::Mismatch { step: -1, what: "initial log".into() };
        }
        let w = if spec["weights"] == "v4" { w_v4 } else { w_default };
        let steps = g["steps"].as_array().unwrap();
        for (k, st) in steps.iter().enumerate() {
            step.set(k as i64);
            let a = action_from_json(&st[0]).unwrap();
            let legal = legal_actions(&s);
            if actions_hash(&legal) != st[1].as_str().unwrap() {
                return Outcome::Mismatch { step: k as i64, what: "legal actions".into() };
            }
            if check_bot && st[4] == 1 {
                let b = bot_step(&s, w);
                if b != a {
                    return Outcome::Mismatch {
                        step: k as i64,
                        what: format!("bot chose {} instead of {}", action_to_json(&b), st[0]),
                    };
                }
            }
            if let Err(e) = apply_action(&mut s, &a) {
                return Outcome::Mismatch { step: k as i64, what: format!("apply failed: {e}") };
            }
            if state_hash(&s) != st[2].as_str().unwrap() {
                return Outcome::Mismatch { step: k as i64, what: format!("state after {}", st[0]) };
            }
            if log_hash(&s) != st[3].as_str().unwrap() {
                return Outcome::Mismatch { step: k as i64, what: format!("log after {}", st[0]) };
            }
            if let Some(h) = st.get(5).and_then(|h| h.as_str()).filter(|h| check_obs && !h.is_empty()) {
                if obs_hash(&s) != h {
                    return Outcome::Mismatch { step: k as i64, what: "observation".into() };
                }
            }
        }
        Outcome::Ok(steps.len())
    }));
    match res {
        Ok(o) => o,
        Err(p) => {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "panic".into());
            Outcome::Panic { step: step.get(), msg }
        }
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn replay(args: &[String]) -> i32 {
    let dir = PathBuf::from(&args[0]);
    let mut games = read_corpus(&dir);
    if let Some(id) = flag(args, "--game") {
        games.retain(|g| g["spec"]["id"].to_string() == id);
    }
    if let Some(m) = flag(args, "--max") {
        games.truncate(m.parse().unwrap());
    }
    let check_bot = !args.iter().any(|a| a == "--no-bot");
    let check_obs = !args.iter().any(|a| a == "--no-obs");
    // without the bot check the weights are not needed (and bot.rs may not be ported yet)
    let (wd, wv) = if check_bot {
        (weights("default"), weights("v4"))
    } else {
        let w = catch_unwind(|| weights("default")).ok();
        match w {
            Some(w) => (w.clone(), w),
            None => (dummy_weights(), dummy_weights()),
        }
    };
    std::panic::set_hook(Box::new(|_| {}));
    let t0 = std::time::Instant::now();
    let steps_ok = AtomicUsize::new(0);
    let results: Vec<(i64, Outcome)> = games
        .par_iter()
        .map(|g| {
            let o = replay_game(g, check_bot, check_obs, &wd, &wv);
            if let Outcome::Ok(n) = o {
                steps_ok.fetch_add(n, Ordering::Relaxed);
            }
            (g["spec"]["id"].as_i64().unwrap(), o)
        })
        .collect();
    let _ = std::panic::take_hook();
    let mut ok = 0;
    let mut oracle = 0;
    let mut bad = Vec::new();
    for (id, o) in &results {
        match o {
            Outcome::Ok(_) => ok += 1,
            Outcome::OracleError(_) => oracle += 1,
            _ => bad.push((id, o)),
        }
    }
    for (id, o) in bad.iter().take(40) {
        match o {
            Outcome::Mismatch { step, what } => println!("game {id}: step {step}: {what}"),
            Outcome::Panic { step, msg } => println!("game {id}: step {step}: PANIC {}", msg.lines().next().unwrap_or("")),
            _ => {}
        }
    }
    let total_steps: usize = games.iter().map(|g| g["steps"].as_array().map_or(0, |a| a.len())).sum();
    println!(
        "{}",
        serde_json::json!({
            "games": games.len(), "equal": ok, "different": bad.len(), "oracleErrors": oracle,
            "stepsReplayedEqual": steps_ok.load(Ordering::Relaxed), "stepsInCorpus": total_steps,
            "seconds": t0.elapsed().as_secs_f64(),
        })
    );
    if bad.is_empty() && ok > 0 {
        0
    } else {
        1
    }
}

/// canonical state after step k of a corpus game (k = -1: the initial state)
fn dump(args: &[String]) -> i32 {
    let games = read_corpus(Path::new(&args[0]));
    let id: i64 = args[1].parse().unwrap();
    let k: i64 = args[2].parse().unwrap();
    let g = games.iter().find(|g| g["spec"]["id"].as_i64() == Some(id)).expect("no such game");
    let mut s: GameState = create_game(&NewGameOptions::from_json(&g["spec"]["opts"]).unwrap()).unwrap();
    for st in g["steps"].as_array().unwrap().iter().take((k + 1).max(0) as usize) {
        apply_action(&mut s, &action_from_json(&st[0]).unwrap()).unwrap();
    }
    if args.iter().any(|a| a == "--legal") {
        let legal = legal_actions(&s);
        println!("{}", Value::Array(legal.iter().map(action_to_json).collect()));
    } else if args.iter().any(|a| a == "--log") {
        println!("{}", s.log.join("\n"));
    } else {
        println!("{}", canon_state(&s));
    }
    0
}

/// one game exactly like scripts/simulate.ts: perfection, drylands, all bots, until over or turn 60
fn simulate_game(seed: i64, size: i32, players: i32, w: &GreedyWeights) -> (Value, usize) {
    let opts = NewGameOptions {
        map_size: Some(size),
        players,
        mode: polycore::types::GameMode::Perfection,
        difficulty: None,
        seed,
        humans: Some(vec![]),
        map_type: Some(polycore::mapgen::MapType::Drylands),
        clans: None,
        turn_limit: None,
    };
    let mut s = create_game(&opts).unwrap();
    let mut actions = 0usize;
    while !s.over && s.turn <= 60 {
        let a = bot_step(&s, w);
        apply_action(&mut s, &a).unwrap();
        actions += 1;
    }
    let line = serde_json::json!({
        "seed": seed, "turns": s.turn, "winner": s.winner, "actions": actions,
        "scores": (0..s.players.len() as i32).map(|p| polycore::state::score_of(&s, p)).collect::<Vec<_>>(),
        "clans": s.players.iter().map(|p| p.tribe.id()).collect::<Vec<_>>(),
    });
    (line, actions)
}

/// bench [--games N] [--size 11] [--players 2] [--seed 1] [--threads 1] [--per-game]
fn bench(args: &[String]) -> i32 {
    let games: i64 = flag(args, "--games").map_or(40, |x| x.parse().unwrap());
    let size: i32 = flag(args, "--size").map_or(11, |x| x.parse().unwrap());
    let players: i32 = flag(args, "--players").map_or(2, |x| x.parse().unwrap());
    let seed0: i64 = flag(args, "--seed").map_or(1, |x| x.parse().unwrap());
    let threads: usize = flag(args, "--threads").map_or(1, |x| x.parse().unwrap());
    let per_game = args.iter().any(|a| a == "--per-game");
    if args.iter().any(|a| a == "--mapgen-only") {
        // only create the games (to subtract the map generation share from instruction counts)
        let mut n = 0usize;
        for g in 0..games {
            let opts = NewGameOptions {
                map_size: Some(size), players, mode: polycore::types::GameMode::Perfection, difficulty: None, seed: seed0 + g,
                humans: Some(vec![]), map_type: Some(polycore::mapgen::MapType::Drylands), clans: None, turn_limit: None,
            };
            n += create_game(&opts).unwrap().units.len();
        }
        println!("{n}");
        return 0;
    }
    let w = GreedyWeights::default_weights();
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().unwrap();
    let t0 = std::time::Instant::now();
    let results: Vec<(Value, usize)> = pool.install(|| (0..games).into_par_iter().map(|g| simulate_game(seed0 + g, size, players, &w)).collect());
    let secs = t0.elapsed().as_secs_f64();
    let total: usize = results.iter().map(|r| r.1).sum();
    if per_game {
        for (g, (line, _)) in results.iter().enumerate() {
            let mut l = line.clone();
            l["game"] = g.into();
            println!("{l}");
        }
    }
    let mut wins = vec![0; players as usize];
    for (line, _) in &results {
        if let Some(w) = line["winner"].as_i64() {
            wins[w as usize] += 1;
        }
    }
    println!(
        "{}",
        serde_json::json!({"summary": true, "engine": "rust", "games": games, "threads": threads, "wins": wins, "actions": total,
            "seconds": secs, "actionsPerSecond": (total as f64 / secs).round()})
    );
    0
}

/// mapbench [--games N] [--size 11] [--players 2] [--type drylands|...|all] [--hash]: createGame alone
fn mapbench(args: &[String]) -> i32 {
    let games: i64 = flag(args, "--games").map_or(200, |x| x.parse().unwrap());
    let size: i32 = flag(args, "--size").map_or(11, |x| x.parse().unwrap());
    let players: i32 = flag(args, "--players").map_or(2, |x| x.parse().unwrap());
    let ty = flag(args, "--type").map_or("drylands".to_string(), |x| x.to_string());
    let types: Vec<polycore::mapgen::MapType> = if ty == "all" {
        polycore::mapgen::MapType::ALL.to_vec()
    } else {
        vec![polycore::mapgen::MapType::from_id(&ty).expect("map type")]
    };
    let t0 = std::time::Instant::now();
    let mut states = Vec::new();
    for &mt in &types {
        for g in 0..games {
            let opts = NewGameOptions {
                map_size: Some(size),
                players,
                mode: polycore::types::GameMode::Perfection,
                difficulty: None,
                seed: 1 + g,
                humans: Some(vec![]),
                map_type: Some(mt),
                clans: None,
                turn_limit: None,
            };
            states.push(create_game(&opts).unwrap());
        }
    }
    let secs = t0.elapsed().as_secs_f64();
    println!("{} games in {:.4}s: {:.1} us/createGame", states.len(), secs, secs * 1e6 / states.len() as f64);
    if args.iter().any(|a| a == "--hash") {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for s in &states {
            state_hash(s).hash(&mut h);
        }
        println!("hash {:016x}", h.finish());
    }
    0
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1).map(String::as_str) {
        Some("replay") => replay(&args[2..]),
        Some("bench") => bench(&args[2..]),
        Some("mapbench") => mapbench(&args[2..]),
        Some("dump") => dump(&args[2..]),
        Some("hash") => {
            for f in &args[2..] {
                let v: Value = serde_json::from_str(&std::fs::read_to_string(f).expect("read")).expect("json");
                let s = state_from_json(&v).unwrap_or_else(|e| panic!("{f}: {e}"));
                let back = state_from_json(&state_to_json(&s)).expect("round trip");
                assert_eq!(s, back, "{f}: JSON round trip changed the state");
                println!("{} {} {}", state_hash(&s), log_hash(&s), f);
            }
            0
        }
        _ => {
            eprintln!("usage: polyengine replay <corpus dir> [--max N] [--game ID] [--no-bot] | dump <corpus dir> <game> <step> [--legal|--log] | hash <state.json>...");
            2
        }
    };
    std::process::exit(code);
}
