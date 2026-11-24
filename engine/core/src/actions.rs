//! Port of logic/engine/actions.ts. STUB: agent D fills the bodies; keep the signatures.
#![allow(unused)]
use crate::types::*;

/// actions.ts legalActions, same actions in the same order
pub fn legal_actions(s: &GameState) -> Vec<Action> {
    todo!()
}
/// actions.ts applyAction, in place: `s` becomes the state TS returns.
/// The TS version clones first (cutting the log to 50 lines); this does the same cut.
/// Err for an action TS would reject (throw).
pub fn apply_action(s: &mut GameState, a: &Action) -> Result<(), String> {
    todo!()
}
/// actions.ts runExplorer
pub fn run_explorer(s: &mut GameState, p: i32, from: Coord) {
    todo!()
}
