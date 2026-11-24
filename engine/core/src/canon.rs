//! Canonical form and hashes, an exact mirror of scripts/rust/canon.ts:
//! keys sorted; entries whose value is null, false or an empty array left out;
//! array elements kept; the game log not part of the state's form.

use crate::json::{action_to_json, state_to_json};
use crate::types::{Action, GameState};
use serde_json::Value;

pub fn canon(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            // JSON.stringify: integral values print without a fraction, -0 as 0
            match n.as_f64() {
                Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => out.push_str(&format!("{}", f as i64)),
                Some(f) => out.push_str(&format!("{f}")),
                None => out.push_str(&n.to_string()),
            }
        }
        Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap()),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canon(x, out);
            }
            out.push(']');
        }
        Value::Object(o) => {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            out.push('{');
            let mut first = true;
            for k in keys {
                let x = &o[k];
                match x {
                    Value::Null | Value::Bool(false) => continue,
                    Value::Array(a) if a.is_empty() => continue,
                    _ => {}
                }
                if !first {
                    out.push(',');
                }
                first = false;
                out.push_str(&serde_json::to_string(k).unwrap());
                out.push(':');
                canon(x, out);
            }
            out.push('}');
        }
    }
}

pub fn canon_string(v: &Value) -> String {
    let mut s = String::new();
    canon(v, &mut s);
    s
}

pub fn canon_state(s: &GameState) -> String {
    let mut v = state_to_json(s);
    v.as_object_mut().unwrap().remove("log");
    canon_string(&v)
}

pub fn md5_hex(s: &str) -> String {
    format!("{:x}", md5::compute(s.as_bytes()))
}

fn md5_16(s: &str) -> String {
    md5_hex(s)[..16].to_string()
}

pub fn state_hash(s: &GameState) -> String {
    md5_16(&canon_state(s))
}

pub fn actions_hash(a: &[Action]) -> String {
    let v = Value::Array(a.iter().map(action_to_json).collect());
    md5_16(&canon_string(&v))
}

pub fn log_hash(s: &GameState) -> String {
    md5_16(&s.log.join("\n"))
}
