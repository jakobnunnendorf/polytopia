//! Seeded generator, bit-exact port of logic/engine/rng.ts (mulberry32).
//! `next` returns exactly the f64 the TypeScript version returns, and `int`
//! does the same float arithmetic, so every draw matches.

#[derive(Clone, Debug)]
pub struct Rng {
    s: u32,
}

impl Rng {
    /// createRng(seed): the seed is taken modulo 2^32 (seed >>> 0)
    pub fn new(seed: i64) -> Rng {
        Rng { s: seed as u32 }
    }
    pub fn from_state(s: u32) -> Rng {
        Rng { s }
    }
    /// float in [0, 1)
    #[inline]
    pub fn next(&mut self) -> f64 {
        self.s = self.s.wrapping_add(0x6d2b79f5);
        let mut t = self.s;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    /// integer in [min, max] (inclusive): min + floor(next() * (max - min + 1))
    #[inline]
    pub fn int(&mut self, min: i32, max: i32) -> i32 {
        let f = self.next();
        (min as f64 + (f * ((max - min + 1) as f64)).floor()) as i32
    }
    /// index of a random element of a non-empty slice of length `len`
    #[inline]
    pub fn pick_idx(&mut self, len: usize) -> usize {
        (self.next() * len as f64).floor() as usize
    }
    pub fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[self.pick_idx(items.len())]
    }
    /// current internal state, to store back into the game state
    #[inline]
    pub fn state(&self) -> u32 {
        self.s
    }
}

/// Fisher-Yates shuffle (returns a new vector)
pub fn shuffle<T: Clone>(rng: &mut Rng, items: &[T]) -> Vec<T> {
    let mut out = items.to_vec();
    let mut i = out.len();
    while i > 1 {
        i -= 1;
        let j = rng.int(0, i as i32) as usize;
        out.swap(i, j);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_values() {
        // reference values printed by logic/engine/rng.ts
        let mut r = Rng::new(1);
        assert_eq!(r.next(), 0.6270739405881613);
        assert_eq!(r.next(), 0.002735721180215478);
        assert_eq!(r.int(3, 9), 6);
        assert_eq!(r.int(-5, 5), 5);
        let mut q = Rng::new(4294967297 + 5);
        assert_eq!(q.next(), 0.5257466111797839);
        assert_eq!(q.state(), 1831565819);
        assert_eq!(shuffle(&mut Rng::new(42), &[1, 2, 3, 4, 5, 6, 7, 8]), vec![3, 8, 2, 1, 7, 6, 4, 5]);
    }
}
