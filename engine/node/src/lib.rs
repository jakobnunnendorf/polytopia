//! N-API addon: one function, `call(name, argsJson) -> resultJson`, the same
//! entry point the WebAssembly build exports (see engine/api).

use napi_derive::napi;

/// returns `{"ok": value}` or `{"error": message}` as JSON text
#[napi]
pub fn call(name: String, args_json: String) -> String {
    polyapi::call_json(&name, &args_json)
}
