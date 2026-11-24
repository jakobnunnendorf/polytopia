//! Grid helpers, port of logic/engine/grid.ts.

use crate::types::*;

#[inline]
pub fn idx(size: i32, x: i32, y: i32) -> usize {
    (y * size + x) as usize
}

#[inline]
pub fn in_bounds(size: i32, x: i32, y: i32) -> bool {
    x >= 0 && y >= 0 && x < size && y < size
}

#[inline]
pub fn tile_at(s: &GameState, x: i32, y: i32) -> &Tile {
    &s.tiles[idx(s.map_size, x, y)]
}

#[inline]
pub fn tile_at_mut(s: &mut GameState, x: i32, y: i32) -> &mut Tile {
    let i = idx(s.map_size, x, y);
    &mut s.tiles[i]
}

/// Chebyshev distance: the game uses 8-directional movement
#[inline]
pub fn dist(ax: i32, ay: i32, bx: i32, by: i32) -> i32 {
    (ax - bx).abs().max((ay - by).abs())
}

/// All in-bounds coords within `r` (Chebyshev) of `c`, row by row, excluding c
/// itself unless `include_self`; same order as grid.ts `around`.
pub fn around(size: i32, c: Coord, r: i32, include_self: bool) -> Vec<Coord> {
    let mut out = Vec::with_capacity(((2 * r + 1) * (2 * r + 1)) as usize);
    for dy in -r..=r {
        for dx in -r..=r {
            if !include_self && dx == 0 && dy == 0 {
                continue;
            }
            let x = c.x + dx;
            let y = c.y + dy;
            if in_bounds(size, x, y) {
                out.push(Coord { x, y });
            }
        }
    }
    out
}

/// calls `f` for every coord `around` would return, in the same order, without allocating
#[inline]
pub fn for_around(size: i32, c: Coord, r: i32, include_self: bool, mut f: impl FnMut(Coord)) {
    for dy in -r..=r {
        for dx in -r..=r {
            if !include_self && dx == 0 && dy == 0 {
                continue;
            }
            let x = c.x + dx;
            let y = c.y + dy;
            if in_bounds(size, x, y) {
                f(Coord { x, y });
            }
        }
    }
}

/// true if `f` holds for any coord `around` would return (stops at the first, like Array.some)
#[inline]
pub fn any_around(size: i32, c: Coord, r: i32, include_self: bool, mut f: impl FnMut(Coord) -> bool) -> bool {
    for dy in -r..=r {
        for dx in -r..=r {
            if !include_self && dx == 0 && dy == 0 {
                continue;
            }
            let x = c.x + dx;
            let y = c.y + dy;
            if in_bounds(size, x, y) && f(Coord { x, y }) {
                return true;
            }
        }
    }
    false
}

#[inline]
pub fn is_water(t: &Tile) -> bool {
    matches!(t.terrain, Terrain::Water | Terrain::Ocean)
}

/// grid.ts cloneState also cuts the log to its last 50 lines
pub fn clone_state(s: &GameState) -> GameState {
    let mut c = s.clone();
    trim_log(&mut c);
    c
}

/// the log part of cloneState: keep the last 50 lines
#[inline]
pub fn trim_log(s: &mut GameState) {
    if s.log.len() > 50 {
        let cut = s.log.len() - 50;
        s.log.drain(..cut);
    }
}
