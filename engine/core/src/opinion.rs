//! Port of logic/engine/opinion.ts. STUB: agent B fills the bodies; keep the signatures.
#![allow(unused)]
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpinionFactor {
    Wise,
    Charming,
    Peaceful,
    Diplomatic,
    Powerful,
    Brave,
    Violent,
    Threatening,
    Weak,
    Annoying,
    Foolish,
    Intrusive,
    Dominating,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum OpinionLevel {
    Horrible,
    Poor,
    Indifferent,
    Decent,
    Great,
}

pub fn opinion_factors(s: &GameState, bot: i32, other: i32) -> Vec<OpinionFactor> {
    todo!()
}
pub fn opinion_score(s: &GameState, bot: i32, other: i32) -> i32 {
    todo!()
}
pub fn opinion_level(score: i32) -> OpinionLevel {
    todo!()
}
pub fn opinion_of(s: &GameState, bot: i32, other: i32) -> OpinionLevel {
    todo!()
}
