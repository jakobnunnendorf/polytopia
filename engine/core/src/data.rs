//! The hand-written part of data.ts: constants and helper functions. The
//! tables themselves are generated into data_gen.rs.

use crate::data_gen::*;
use crate::types::Difficulty;
use std::sync::OnceLock;

#[inline]
pub fn unit_def(t: UnitType) -> &'static UnitDef {
    &UNITS[t as usize]
}
#[inline]
pub fn build_def(b: Build) -> &'static BuildDef {
    &BUILDS[b as usize]
}
#[inline]
pub fn tech_def(t: Tech) -> &'static TechDef {
    &TECHS[t as usize]
}
#[inline]
pub fn tribe_def(t: Tribe) -> &'static TribeDef {
    &TRIBES[t as usize]
}

/// JavaScript Math.round: the nearest integer, halves toward +infinity
#[inline]
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// JavaScript Math.sign for integers
#[inline]
pub fn js_sign(x: i32) -> i32 {
    x.signum()
}

/// data.ts techCostFor: price = ceil((4 + tier × cities) × m), m = fround(0.66666) with Literacy
pub fn tech_cost_for(tier: i32, cities: i32, literacy: bool) -> i32 {
    let base = 4 + tier * cities;
    if literacy {
        ((base as f64) * (0.66666f32 as f64) - 1e-9).ceil() as i32
    } else {
        base
    }
}

/// level-up rewards (§5.3): new level -> [option A, option B]
pub fn reward_options(level: i32) -> [Reward; 2] {
    match level {
        2 => [Reward::Workshop, Reward::Explorer],
        3 => [Reward::CityWall, Reward::Resources],
        4 => [Reward::PopulationGrowth, Reward::BorderGrowth],
        _ => [Reward::Park, Reward::SuperUnit],
    }
}

pub const START_STARS: i32 = 5;
pub const EXPLORER_STEPS: i32 = 12;
pub const PERFECTION_TURNS: i32 = 30;
pub const STARFISH_STARS: i32 = 8;
pub const RUIN_STARS: i32 = 10;
pub const EMBASSY_INCOME: i32 = 2;
pub const LEVEL_CAP: i32 = 8;
pub const MARKET_CAP: i32 = 8;
/// stars of the Resources city reward (§5.3)
pub const REWARD_RESOURCES_STARS: i32 = 5;
/// free population of the Population Growth city reward (§5.3)
pub const REWARD_POP_GROWTH: i32 = 3;
/// embassy price: 4★ plus 2★ for every embassy the builder already has
#[inline]
pub fn embassy_cost(existing: i32) -> i32 {
    4 + 2 * existing
}
pub const PORT_RANGE: i32 = 5;
pub const GLORY_TARGET: i32 = 10_000;
pub const HUMAN_CAPITAL_BONUS: i32 = 1;

pub fn bot_capital_bonus(d: Difficulty) -> i32 {
    match d {
        Difficulty::Easy => 0,
        Difficulty::Normal => 1,
        Difficulty::Hard => 2,
        Difficulty::Crazy => 4,
    }
}
pub fn handicap(d: Difficulty) -> i32 {
    bot_capital_bonus(d)
}
pub fn perfection_difficulty_bonus(d: Difficulty) -> f64 {
    match d {
        Difficulty::Easy => 0.0,
        Difficulty::Normal => 0.2,
        Difficulty::Hard => 0.4,
        Difficulty::Crazy => 0.8,
    }
}
pub fn domination_difficulty(d: Difficulty) -> f64 {
    match d {
        Difficulty::Easy => 0.25,
        Difficulty::Normal => 0.5,
        Difficulty::Hard => 0.75,
        Difficulty::Crazy => 1.0,
    }
}
pub const DOMINATION_STARS: [f64; 4] = [0.2, 0.7, 0.95, 1.0];
pub const PERFECTION_STARS: [f64; 4] = [3_000.0, 10_000.0, 50_000.0, 100_000.0];
#[inline]
pub fn max_players_for(map_size: i32) -> i32 {
    if map_size <= 11 {
        9
    } else {
        16
    }
}

pub struct Score {
    pub per_unit_cost: i32,
    pub super_unit: i32,
    pub territory_tile: i32,
    pub explored_tile: i32,
    pub city: i32,
    pub city_pop: i32,
    pub city_per_level: i32,
    pub city_negative_pop: i32,
    pub park: i32,
    pub monument: i32,
    pub temple_level: i32,
    pub temple_max_level: i32,
    pub tech_tier: i32,
}

pub const SCORE: Score = Score {
    per_unit_cost: 5,
    super_unit: 50,
    territory_tile: 20,
    explored_tile: 5,
    city: 100,
    city_pop: 5,
    city_per_level: 50,
    city_negative_pop: 100,
    park: 250,
    monument: 400,
    temple_level: 100,
    temple_max_level: 5,
    tech_tier: 100,
};

#[inline]
pub fn tribe_only_unit(t: UnitType) -> bool {
    TRIBE_ONLY_UNITS.contains(&t)
}
#[inline]
pub fn tribe_only_build(b: Build) -> bool {
    TRIBE_ONLY_BUILDS.contains(&b)
}

/// data.ts trainableUnitsFor (precomputed per tribe, same order)
pub fn trainable_units_for(t: Tribe) -> &'static [UnitType] {
    static TABLE: OnceLock<Vec<Vec<UnitType>>> = OnceLock::new();
    &TABLE.get_or_init(|| {
        Tribe::ALL
            .iter()
            .map(|&tr| {
                let def = tribe_def(tr);
                let rep = def.unit_replacements;
                let mut out = Vec::new();
                for u in UnitType::ALL {
                    let d = unit_def(u);
                    if !d.trainable {
                        continue;
                    }
                    if tribe_only_unit(u) {
                        if def.extra_units.contains(&u) || rep.iter().any(|&(_, to)| to == Some(u)) {
                            out.push(u);
                        }
                        continue;
                    }
                    if rep.iter().any(|&(from, _)| from == u) {
                        continue;
                    }
                    out.push(u);
                }
                out
            })
            .collect()
    })[t as usize]
}

/// data.ts buildAllowedFor (precomputed per tribe)
#[inline]
pub fn build_allowed_for(t: Tribe, b: Build) -> bool {
    static TABLE: OnceLock<Vec<[bool; Build::COUNT]>> = OnceLock::new();
    TABLE.get_or_init(|| {
        Tribe::ALL
            .iter()
            .map(|&tr| {
                let def = tribe_def(tr);
                let rep = def.build_replacements;
                let mut row = [false; Build::COUNT];
                for b in Build::ALL {
                    row[b as usize] = if tribe_only_build(b) {
                        def.extra_builds.contains(&b) || rep.iter().any(|&(_, to)| to == Some(b))
                    } else {
                        !rep.iter().any(|&(from, _)| from == b)
                    };
                }
                row
            })
            .collect()
    })[t as usize][b as usize]
}

/// data.ts superUnitFor (default giant)
#[inline]
pub fn super_unit_for(t: Tribe) -> UnitType {
    tribe_def(t).super_unit.unwrap_or(UnitType::Giant)
}

/// data.ts EMBARK_AS lookup: the boat a land unit becomes (None = raft, the TS default)
pub fn embark_as(t: UnitType) -> Option<UnitType> {
    EMBARK_AS.iter().find(|&&(from, _)| from == t).map(|&(_, to)| to)
}

/// data.ts FEEDS lookup: feeder -> (leveling building, population per level)
pub fn feeds(b: Build) -> Option<(Build, i32)> {
    FEEDS.iter().find(|&&(f, _, _)| f == b).map(|&(_, to, n)| (to, n))
}

/// data.ts MONUMENTS lookup: task -> monument
pub fn monument_for(t: Task) -> Build {
    MONUMENTS.iter().find(|&&(k, _)| k == t).map(|&(_, m)| m).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn js_round_matches() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
        assert_eq!(js_round(0.49999999999999994), 0.0);
    }
    #[test]
    fn literacy() {
        // TS: Math.ceil((4 + 2*3) * Math.fround(0.66666) - 1e-9) = 7
        assert_eq!(tech_cost_for(2, 3, true), 7);
        assert_eq!(tech_cost_for(1, 2, false), 6);
    }
}
