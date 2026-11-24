use polycore::canon::{log_hash, state_hash};
use polycore::json::{state_from_json, state_to_json};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        // hash <state.json>...: canonical hash and log hash of each state (round trip through Rust)
        Some("hash") => {
            for f in &args[2..] {
                let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(f).expect("read")).expect("json");
                let s = state_from_json(&v).unwrap_or_else(|e| panic!("{f}: {e}"));
                let back = state_from_json(&state_to_json(&s)).expect("round trip");
                assert_eq!(s, back, "{f}: JSON round trip changed the state");
                println!("{} {} {}", state_hash(&s), log_hash(&s), f);
            }
        }
        _ => eprintln!("usage: polyengine hash <state.json>..."),
    }
}
