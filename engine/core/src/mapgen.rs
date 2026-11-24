//! Port of logic/engine/mapgen.ts: map generation for Polytopia 2.18 (the
//! algorithm of polybots-engine, which replays the game's own generator).
//! Bit-exact: the same seed gives the same map tile for tile and leaves the
//! generator in the same state. See mapgen.ts for the outline of the steps.
//!
//! Tile indices are `i32` (TS numbers): `remove_near` builds flattened indices
//! without clamping, as the game does, so they can be negative or wrap rows.
use crate::data::js_sign;
use crate::rng::Rng;
use crate::types::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MapType {
    Drylands,
    Lakes,
    Continents,
    Pangea,
    Archipelago,
    Waterworld,
}

impl MapType {
    pub const ALL: [MapType; 6] = [MapType::Drylands, MapType::Lakes, MapType::Continents, MapType::Pangea, MapType::Archipelago, MapType::Waterworld];
    pub fn id(self) -> &'static str {
        ["drylands", "lakes", "continents", "pangea", "archipelago", "waterworld"][self as usize]
    }
    pub fn from_id(s: &str) -> Option<MapType> {
        MapType::ALL.into_iter().find(|m| m.id() == s)
    }
}

pub struct GeneratedMap {
    pub tiles: Vec<Tile>,
    pub capitals: Vec<Coord>,
    pub villages: Vec<Coord>,
}

/// mapgen.ts MapOptions; None = option not given
#[derive(Clone, Debug, Default)]
pub struct MapOptions {
    pub start_resources: Option<Vec<Vec<Resource>>>,
    pub water_start: Option<Vec<bool>>,
    pub flooded: Option<Vec<bool>>,
    pub spores: Option<Vec<bool>>,
    pub polaris: Option<Vec<bool>>,
    /// the climate's identity (the tribe id string)
    pub climates: Option<Vec<String>>,
}

/// per-player tribe modifiers, indexed by ModKey (None = key absent)
pub type Mods = [Option<f64>; ModKey::COUNT];

/// the game's MapGeneratorSettings per preset (mapgen.ts MapSettings)
#[derive(Clone, Copy, Debug)]
pub struct MapSettings {
    pub wetness: f64,
    pub richness: f64,
    pub smooth_iterations: i32,
    pub pre_terrain_city_density: f64,
    pub post_terrain_city_density: f64,
    pub min_suburbs: i32,
    pub max_suburbs: i32,
    pub surrounding_space: f64,
    pub equality_iterations: i32,
    pub equality_limit: f64,
}

const BASE: MapSettings = MapSettings {
    wetness: 0.45,
    richness: 1.0,
    smooth_iterations: 2,
    pre_terrain_city_density: 0.3,
    post_terrain_city_density: 1.0,
    min_suburbs: 1,
    max_suburbs: 2,
    surrounding_space: 0.5,
    equality_iterations: 50,
    equality_limit: 1.01,
};

/// mapgen.ts MAP_SETTINGS, indexed by MapType
pub const MAP_SETTINGS: [MapSettings; 6] = [
    MapSettings { wetness: 0.0, smooth_iterations: 0, pre_terrain_city_density: 0.0, min_suburbs: 0, max_suburbs: 0, ..BASE },
    MapSettings { wetness: 0.3, surrounding_space: 1.0, ..BASE },
    MapSettings { wetness: 0.5, surrounding_space: 1.0, smooth_iterations: 1, ..BASE },
    MapSettings { wetness: 0.5, surrounding_space: 0.0, smooth_iterations: 1, ..BASE },
    MapSettings { wetness: 0.65, smooth_iterations: 0, ..BASE },
    MapSettings { wetness: 0.85, pre_terrain_city_density: 0.1, min_suburbs: 0, max_suburbs: 0, ..BASE },
];

/// mapgen.ts WETNESS
#[inline]
pub fn wetness(t: MapType) -> f64 {
    MAP_SETTINGS[t as usize].wetness
}

/// ruins: tiles / 40, and the placement loop places one more (11: 4, 16: 7, 30: 23)
pub fn ruin_count(size: i32) -> i32 {
    (size * size) / 40 + 1
}

/// mapgen.ts TERRAIN_WEIGHTS (field, mountain, forest)
pub const TERRAIN_WEIGHT_FIELD: f64 = 0.5;
pub const TERRAIN_WEIGHT_MOUNTAIN: f64 = 0.15;
pub const TERRAIN_WEIGHT_FOREST: f64 = 0.4;

/// resource kinds in the game's id order (mapgen.ts KINDS), with the terrains they need
const KINDS: [(Resource, &[Terrain]); 7] = [
    (Resource::Animal, &[Terrain::Forest]),
    (Resource::Crop, &[Terrain::Field]),
    (Resource::Fish, &[Terrain::Water, Terrain::Ocean]),
    (Resource::Metal, &[Terrain::Mountain]),
    (Resource::Fruit, &[Terrain::Field]),
    (Resource::Spores, &[Terrain::Field, Terrain::Forest]),
    (Resource::AquaCrop, &[Terrain::Water, Terrain::Ocean]),
];
/// mapgen.ts RESOURCE_CHANCES in KINDS order (animal, crop, fish, metal, fruit, spores, aquaCrop)
pub const RESOURCE_CHANCES: [f64; 7] = [0.5, 0.5, 0.5, 0.8, 0.5, 0.0, 0.0];
/// the ModKey of each KINDS entry
const KIND_MODS: [ModKey; 7] = [ModKey::Animal, ModKey::Crop, ModKey::Fish, ModKey::Metal, ModKey::Fruit, ModKey::Spores, ModKey::AquaCrop];
const K_FISH: usize = 2;

/// TERRAINS_OF[kind] ?? ["field"]
fn terrains_of(r: Resource) -> &'static [Terrain] {
    for (k, t) in KINDS.iter() {
        if *k == r {
            return t;
        }
    }
    &[Terrain::Field]
}

const DEFAULT_CLIMATE: i32 = -2;

#[inline]
fn is_water_t(t: Terrain) -> bool {
    matches!(t, Terrain::Water | Terrain::Ocean)
}

/// the game's modifier rule: a positive default is multiplied, a zero default is replaced
#[inline]
fn modify(base: f64, m: Option<f64>) -> f64 {
    match m {
        None => base,
        Some(m) => {
            if base > 0.0 {
                base * m
            } else {
                m
            }
        }
    }
}

fn round_half_even(v: f64) -> f64 {
    let f = v.floor();
    let d = v - f;
    if d > 0.5 {
        return f + 1.0;
    }
    if d < 0.5 {
        return f;
    }
    if f % 2.0 == 0.0 {
        f
    } else {
        f + 1.0
    }
}

#[inline]
fn flag(v: &Option<Vec<bool>>, p: usize) -> bool {
    v.as_ref().map_or(false, |v| v.get(p).copied().unwrap_or(false))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Imp {
    None,
    City,
    Ruin,
    Lighthouse,
}

impl Imp {
    /// JS truthiness of the tile's improvement
    #[inline]
    fn any(self) -> bool {
        self != Imp::None
    }
}

/// a climate ("continent" in the game's data): terrain weights and resource chances
struct Climate {
    tiles: Vec<i32>,
    field: f64,
    mountain: f64,
    forest: f64,
    /// KINDS order
    chance: [f64; 7],
}

/// Gen::range on a generator held in a local (kept in a register)
#[inline(always)]
fn rrange(rng: &mut Rng, min: i32, max: i32) -> i32 {
    (min as f64 + (rng.next() * ((max - min) as f64)).floor()) as i32
}

/// mulberry32's state step (Rng::next adds it before hashing)
const RNG_STEP: u32 = 0x6d2b79f5;

/// per-size tables shared by every candidate of one generate_map call: the
/// in-bounds square of radius r around each tile without the tile itself,
/// dx outer, dy inner (the order `area` always had)
struct Geo {
    flat: [Vec<i32>; 3],
    starts: [Vec<u32>; 3],
}

impl Geo {
    fn new(n: i32, max_r: i32) -> Geo {
        let mut flat = [Vec::new(), Vec::new(), Vec::new()];
        let mut starts = [Vec::new(), Vec::new(), Vec::new()];
        for r in 1..=max_r {
            let k = (r - 1) as usize;
            let f = &mut flat[k];
            let st = &mut starts[k];
            st.push(0u32);
            for i in 0..n * n {
                let cx = i % n;
                let cy = i.div_euclid(n);
                for dx in -r..=r {
                    for dy in -r..=r {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let x = cx + dx;
                        let y = cy + dy;
                        if x >= 0 && y >= 0 && x < n && y < n {
                            f.push(y * n + x);
                        }
                    }
                }
                st.push(f.len() as u32);
            }
        }
        Geo { flat, starts }
    }
    /// i must be a tile of the map and r one of the radii built
    #[inline]
    fn area(&self, i: i32, r: i32) -> &[i32] {
        let k = (r - 1) as usize;
        let st = &self.starts[k];
        let u = i as usize;
        assert!(u + 1 < st.len());
        // SAFETY: starts are offsets into flat, ascending, the last one flat.len()
        unsafe {
            let a = *st.get_unchecked(u) as usize;
            let b = *st.get_unchecked(u + 1) as usize;
            self.flat[k].get_unchecked(a..b)
        }
    }
}

/// a Fisher-Yates shuffle (Gen::shuffle's order and draws) done only as far as it
/// is read: step k uses the generator's k-th draw, which is computed directly
/// from the state before the shuffle; the generator itself jumps past all draws
struct LazyShuffle {
    s0: u32,
    done: usize,
}

impl LazyShuffle {
    /// start a shuffle of `len` items: advances rng past every draw it takes
    fn start(rng: &mut Rng, len: usize) -> LazyShuffle {
        let s0 = rng.state();
        let draws = if len > 1 { len - 1 } else { 0 };
        *rng = Rng::from_state(s0.wrapping_add(RNG_STEP.wrapping_mul(draws as u32)));
        LazyShuffle { s0, done: 0 }
    }
    /// a[i] as the full shuffle leaves it
    #[inline]
    fn get(&mut self, a: &mut [i32], i: usize) -> i32 {
        let len = a.len();
        while self.done <= i && self.done + 1 < len {
            let k = self.done;
            let mut r = Rng::from_state(self.s0.wrapping_add(RNG_STEP.wrapping_mul(k as u32)));
            // Gen::range(k, len)
            let j = (k as i32 as f64 + (r.next() * ((len as i32 - k as i32) as f64)).floor()) as i32;
            a.swap(k, j as usize);
            self.done += 1;
        }
        a[i]
    }
}

const E_NONE: u64 = u64::MAX;
const E_DONE: u64 = u64::MAX - 1;

/// tile flags for inequality()
const F_WATER: u8 = 1;
const F_MOUNTAIN: u8 = 2;
const F_CITY: u8 = 4;
const F_START: u8 = 8;
const F_RUIN: u8 = 16;

/// the inequality measure's working buffers
#[derive(Default)]
struct IneqScratch {
    /// F_* per tile
    flags: Vec<u8>,
    /// the capitals' tiles in seat order
    caps: Vec<usize>,
    scores: Vec<f64>,
    /// the entry per tile, cost << 32 | seat << 16 | order (so that comparing two
    /// entries of one tile compares (cost, seat)); E_NONE untouched, E_DONE visited
    ent: Vec<u64>,
    queue: Buckets,
}

/// Dial's queue for inequality(): costs grow by 1..=1000 per step, so every
/// pending cost lies within 1000 of the cost being processed and a ring of
/// 1024 buckets holds them without aliasing. An entry is order << 16 | tile.
struct Buckets {
    slots: Vec<Vec<u32>>,
    /// non-empty slots
    bits: [u64; 16],
    pending: usize,
}

impl Default for Buckets {
    fn default() -> Buckets {
        Buckets { slots: (0..1024).map(|_| Vec::new()).collect(), bits: [0; 16], pending: 0 }
    }
}

impl Buckets {
    fn clear(&mut self) {
        if self.pending > 0 {
            for v in &mut self.slots {
                v.clear();
            }
        }
        self.bits = [0; 16];
        self.pending = 0;
    }
    #[inline]
    fn push(&mut self, cost: i32, entry: u32) {
        let slot = (cost & 1023) as usize;
        // SAFETY: slot < 1024 = slots.len(), slot >> 6 < 16
        unsafe {
            self.slots.get_unchecked_mut(slot).push(entry);
            *self.bits.get_unchecked_mut(slot >> 6) |= 1u64 << (slot & 63);
        }
        self.pending += 1;
    }
    /// the smallest pending cost >= cur (cur's slot first, then onwards around the ring)
    fn next_cost(&self, cur: i32) -> i32 {
        let s = (cur & 1023) as usize;
        let w = s >> 6;
        let m = self.bits[w] & (!0u64 << (s & 63));
        if m != 0 {
            return cur + ((w << 6) + m.trailing_zeros() as usize - s) as i32;
        }
        for k in 1..=16 {
            let ww = (w + k) & 15;
            let m = if k == 16 { self.bits[ww] & !(!0u64 << (s & 63)) } else { self.bits[ww] };
            if m != 0 {
                let slot = (ww << 6) + m.trailing_zeros() as usize;
                return cur + ((slot + 1024 - s) & 1023) as i32;
            }
        }
        unreachable!("mapgen: empty queue")
    }
}

/// the arrays output() reads, kept for the fairest candidate so far
#[derive(Default)]
struct Snapshot {
    terrain: Vec<Terrain>,
    resource: Vec<Option<Resource>>,
    imp: Vec<Imp>,
    flooded: Vec<bool>,
    ice: Vec<bool>,
    polar: Vec<bool>,
    capital: Vec<i32>,
}

struct Gen<'a> {
    rng: Rng,
    geo: &'a Geo,
    n: i32,
    total: i32,
    players: i32,
    s: MapSettings,
    map_type: MapType,
    mods: &'a [Mods],
    opts: &'a MapOptions,
    terrain: Vec<Terrain>,
    alt: Vec<i32>,
    imp: Vec<Imp>,
    /// player owning the tile (capital territory), -1 none
    owner: Vec<i32>,
    /// climate index (player index), None, DEFAULT_CLIMATE for an untouched island, 100+id an island
    cont: Vec<Option<i32>>,
    /// climate identity for flooding, interned (0 = "")
    clim_key: Vec<u32>,
    resource: Vec<Option<Resource>>,
    /// TS `capital[p]`; -1 = hole
    capital: Vec<i32>,
    climates: Vec<Climate>,
    islands: Vec<Vec<i32>>,
    /// interned key(p) per player
    player_keys: Vec<u32>,
    /// interned "imperius" (the fallback climate's key)
    imperius_key: u32,
    /// flag(opts.polaris, p) per player
    alien: Vec<bool>,
    /// start_list(), fixed by the options
    starts: Vec<Vec<Resource>>,
    flooded: Vec<bool>,
    ice: Vec<bool>,
    polar: Vec<bool>,
    /// capital_positions' weight table per count (it depends on the size only)
    cap_tables: Vec<Option<Vec<i64>>>,
    // reused working buffers
    buf_i32: Vec<i32>,
    buf_i32b: Vec<i32>,
    buf_bool: Vec<bool>,
    buf_bool2: Vec<bool>,
    buf_f64: Vec<f64>,
    buf_pad: Vec<f64>,
    buf_f64b: Vec<f64>,
    buf_terrain: Vec<Terrain>,
    buf_u8: Vec<u8>,
    ineq: IneqScratch,
}

impl<'a> Gen<'a> {
    #[allow(clippy::too_many_arguments)]
    fn new(rng: Rng, geo: &'a Geo, n: i32, players: i32, s: MapSettings, map_type: MapType, mods: &'a [Mods], opts: &'a MapOptions) -> Gen<'a> {
        let total = n * n;
        let t = total as usize;
        // intern the climate keys: "" = 0, then key(p) for each player, then "imperius"
        let mut names: Vec<String> = vec![String::new()];
        let mut intern = |s: String| -> u32 {
            if let Some(k) = names.iter().position(|x| *x == s) {
                k as u32
            } else {
                names.push(s);
                (names.len() - 1) as u32
            }
        };
        let player_keys: Vec<u32> = (0..players as usize)
            .map(|p| {
                let k = opts.climates.as_ref().and_then(|c| c.get(p)).cloned().unwrap_or_else(|| format!("p{p}"));
                intern(k)
            })
            .collect();
        let imperius_key = intern("imperius".to_string());
        let alien = (0..players as usize).map(|p| flag(&opts.polaris, p)).collect();
        let mut g = Gen {
            rng,
            geo,
            n,
            total,
            players,
            s,
            map_type,
            mods,
            opts,
            terrain: vec![Terrain::Water; t],
            alt: vec![-1; t],
            imp: vec![Imp::None; t],
            owner: vec![-1; t],
            cont: vec![None; t],
            clim_key: vec![0; t],
            resource: vec![None; t],
            capital: Vec::new(),
            climates: Vec::new(),
            islands: Vec::new(),
            player_keys,
            imperius_key,
            alien,
            starts: Vec::new(),
            flooded: vec![false; t],
            ice: vec![false; t],
            polar: vec![false; t],
            cap_tables: Vec::new(),
            buf_i32: Vec::new(),
            buf_i32b: Vec::new(),
            buf_bool: Vec::new(),
            buf_bool2: Vec::new(),
            buf_f64: Vec::new(),
            buf_pad: Vec::new(),
            buf_f64b: Vec::new(),
            buf_terrain: Vec::new(),
            buf_u8: Vec::new(),
            ineq: IneqScratch::default(),
        };
        g.starts = g.start_list();
        g
    }

    /// back to the state Gen::new leaves, with a new generator
    fn reset(&mut self, rng: Rng) {
        self.rng = rng;
        self.clear();
    }

    fn clear(&mut self) {
        self.terrain.fill(Terrain::Water);
        self.alt.fill(-1);
        self.imp.fill(Imp::None);
        self.owner.fill(-1);
        self.cont.fill(None);
        self.clim_key.fill(0);
        self.resource.fill(None);
        self.capital.clear();
        self.islands.clear();
    }

    // ---- random helpers ----
    #[inline]
    fn range(&mut self, min: i32, max: i32) -> i32 {
        (min as f64 + (self.rng.next() * ((max - min) as f64)).floor()) as i32
    }
    #[inline]
    fn float(&mut self, min: f64, max: f64) -> f64 {
        min + self.rng.next() * (max - min)
    }
    fn shuffle(&mut self, a: &mut [i32]) {
        let len = a.len() as i32;
        let mut i = 0;
        while i < len - 1 {
            let j = self.range(i, len);
            a.swap(i as usize, j as usize);
            i += 1;
        }
    }

    // ---- geometry ----
    #[inline]
    fn x(&self, i: i32) -> i32 {
        i % self.n
    }
    #[inline]
    fn y(&self, i: i32) -> i32 {
        i.div_euclid(self.n)
    }
    #[inline]
    fn cheb(&self, a: i32, b: i32) -> i32 {
        (self.x(a) - self.x(b)).abs().max((self.y(a) - self.y(b)).abs())
    }
    #[inline]
    fn edge(&self, i: i32) -> i32 {
        let x = self.x(i);
        let y = self.y(i);
        x.min(y).min(self.n - 1 - x).min(self.n - 1 - y)
    }
    /// the square of `r` around i without i, in-bounds; dx outer, dy inner
    #[inline]
    fn area(&self, i: i32, r: i32) -> &'a [i32] {
        let geo: &'a Geo = self.geo;
        geo.area(i, r)
    }
    #[inline]
    fn area_any(&self, i: i32, r: i32, mut f: impl FnMut(usize) -> bool) -> bool {
        self.area(i, r).iter().any(|&j| f(j as usize))
    }
    fn side(&self) -> i32 {
        (self.players as f64).sqrt().ceil() as i32
    }
    fn min_capital_distance(&self) -> i32 {
        3 + if (self.n - 1) / self.side() > 4 { 1 } else { 0 }
    }
    #[inline]
    fn is_city(&self, i: i32) -> bool {
        self.imp[i as usize] == Imp::City
    }
    fn set_city(&mut self, i: i32) {
        let u = i as usize;
        self.owner[u] = -1;
        self.terrain[u] = Terrain::Field;
        self.resource[u] = None;
        self.imp[u] = Imp::City;
    }
    #[inline]
    fn key(&self, p: i32) -> u32 {
        self.player_keys[p as usize]
    }
    fn set_capital_slot(&mut self, p: i32, i: i32) {
        let p = p as usize;
        if self.capital.len() <= p {
            self.capital.resize(p + 1, -1);
        }
        self.capital[p] = i;
    }
    fn cap(&self, p: i32) -> i32 {
        let c = self.capital.get(p as usize).copied().unwrap_or(-1);
        assert!(c >= 0, "mapgen: player {p} has no capital");
        c
    }
    fn set_capital(&mut self, p: i32, i: i32) {
        self.set_capital_slot(p, i);
        let u = i as usize;
        self.terrain[u] = Terrain::Field;
        self.alt[u] = 1;
        self.resource[u] = None;
        self.imp[u] = Imp::City;
        self.cont[u] = Some(p);
        self.clim_key[u] = self.key(p);
        // its border (radius 1) is its territory
        if self.owner[u] == -1 {
            self.owner[u] = p;
        }
        for &j in self.area(i, 1) {
            if self.owner[j as usize] == -1 {
                self.owner[j as usize] = p;
            }
        }
        self.owner[u] = p;
    }

    // ---- placement ----
    fn remove_near(&self, list: &mut Vec<i32>, site: i32, r: i32) {
        let cx = self.x(site);
        let cy = self.y(site);
        let n = self.n;
        if n > 2 * r {
            // the list holds distinct tiles, so removing the first occurrence of each
            // flattened value is dropping every element equal to one of them; the
            // values are (2r+1) runs of 2r+1 consecutive numbers, one per row
            let start = (cy - r) * n + (cx - r);
            let side = 2 * r;
            list.retain(|&e| {
                let d = e - start;
                !(d >= 0 && d / n <= side && d % n <= side)
            });
            return;
        }
        for y in cy - r..=cy + r {
            for x in cx - r..=cx + r {
                // flattened without clamping, as the game does
                let v = y * self.n + x;
                if let Some(k) = list.iter().position(|&e| e == v) {
                    list.remove(k);
                }
            }
        }
    }

    fn capital_positions(&mut self, count: i32) -> Vec<i32> {
        let w = self.n;
        let side = (count as f64).sqrt().ceil() as i32;
        let domain = w / side;
        let rem = w % side;
        let offset = |v: i32| rem.min(1.max(rem.min(v) - 1));
        let ci = count.max(0) as usize;
        if self.cap_tables.len() <= ci {
            self.cap_tables.resize(ci + 1, None);
        }
        if self.cap_tables[ci].is_none() {
            let mut table = vec![0i64; (w * w) as usize];
            for dy in 0..side {
                for dx in 0..side {
                    let cx = domain * dx + domain / 2 + offset(dx);
                    let cy = domain * dy + domain / 2 + offset(dy);
                    for i in 0..table.len() as i32 {
                        let d = (self.x(i) - cx).abs().max((self.y(i) - cy).abs());
                        let peak = 1.max(domain / 2 - d) as i64;
                        let t = &mut table[i as usize];
                        *t = (*t).max(peak * peak * peak);
                    }
                }
            }
            self.cap_tables[ci] = Some(table);
        }
        let table = self.cap_tables[ci].take().unwrap();
        let mut free = std::mem::take(&mut self.buf_i32);
        let mut domains: Vec<i32> = (0..side * side).collect();
        let mut out: Vec<i32> = Vec::new();
        let inset = if domain < 5 { 1 } else { 2 };
        for _ in 0..count {
            let pos = self.range(0, domains.len() as i32) as usize;
            let d = domains.remove(pos);
            let sx = domain * (d % side) + offset(d % side);
            let sy = domain * (d / side) + offset(d / side);
            let (mut x0, mut x1, mut y0, mut y1) = (2.max(sx + inset), (w - 2).min(sx + domain - inset), 2.max(sy + inset), (w - 2).min(sy + domain - inset));
            // engine extension for many players on small maps: widen an empty range
            if x0 >= x1 || y0 >= y1 {
                x0 = 1.max(sx);
                x1 = (w - 1).min(sx + domain);
                y0 = 1.max(sy);
                y1 = (w - 1).min(sy + domain);
            }
            free.clear();
            for y in y0..y1 {
                for x in x0..x1 {
                    let c = y * w + x;
                    if !out.contains(&c) {
                        free.push(c);
                    }
                }
            }
            if free.is_empty() {
                out.push((w / 2) * w + w / 2);
                continue;
            }
            let mut sum: i64 = 0;
            for &c in &free {
                sum += 1.max(table[c as usize]);
            }
            let v = (self.rng.next() * sum as f64).floor() as i64;
            let mut acc: i64 = 0;
            for &c in &free {
                acc += 1.max(table[c as usize]);
                if v < acc {
                    out.push(c);
                    break;
                }
            }
        }
        self.cap_tables[ci] = Some(table);
        self.buf_i32 = free;
        out
    }

    fn land_corridor(&mut self, from: Coord, to: i32, land: &mut Vec<i32>) {
        let w = self.n;
        let tx = self.x(to);
        let ty = self.y(to);
        let mut cur = from;
        for _ in 0..1000 {
            if cur.x == tx && cur.y == ty {
                return;
            }
            let i = cur.y * w + cur.x;
            if !land.contains(&i) {
                land.push(i);
            }
            let dx = tx - cur.x;
            let dy = ty - cur.y;
            if dx.abs() + dy.abs() == 1 {
                return;
            }
            let mask = self.range(1, 4);
            if mask & 1 != 0 {
                let mut sign = js_sign(dx);
                if sign == 0 {
                    sign = if self.rng.next() > 0.5 { 1 } else { -1 };
                }
                cur.x = (w - 1).min(0.max(cur.x + sign));
            }
            if mask & 2 != 0 {
                let mut sign = js_sign(dy);
                if sign == 0 {
                    sign = if self.rng.next() > 0.5 { 1 } else { -1 };
                }
                cur.y = (w - 1).min(0.max(cur.y + sign));
            }
        }
    }

    fn within(&self, c: i32, list: &[i32], r: i32) -> bool {
        list.iter().any(|&v| self.cheb(c, v) <= r)
    }

    fn suburbs(&mut self, capitals: &[i32], count: i32, land: &mut Vec<i32>) -> Vec<i32> {
        let w = self.n;
        let mut sites: Vec<i32> = Vec::new();
        if count <= 0 {
            return sites;
        }
        let mut per: Vec<Vec<i32>> = capitals.iter().map(|_| Vec::new()).collect();
        for _ in 0..count {
            for (p, &cap) in capitals.iter().enumerate() {
                let cx = self.x(cap);
                let cy = self.y(cap);
                let mut radius = 3;
                while (radius as f64) < (w as f64) * 0.6 {
                    let mut cands: Vec<i32> = Vec::new();
                    for y in cy - radius..=cy + radius {
                        if y >= w - 1 {
                            break;
                        }
                        if y <= 0 {
                            continue;
                        }
                        for x in cx - radius..=cx + radius {
                            if x >= w - 1 {
                                break;
                            }
                            if x <= 0 {
                                continue;
                            }
                            if x != cx - radius && x != cx + radius && y != cy - radius && y != cy + radius {
                                continue;
                            }
                            let c = y * w + x;
                            if !self.within(c, capitals, 2) && !self.within(c, &sites, 2) && !self.within(c, &per[p], 2) {
                                cands.push(c);
                            }
                        }
                    }
                    if !cands.is_empty() {
                        let site = cands[self.range(0, cands.len() as i32) as usize];
                        per[p].push(site);
                        sites.push(site);
                        break;
                    }
                    radius += 1;
                }
            }
        }
        for (p, &cap) in capitals.iter().enumerate() {
            if per[p].len() as i32 != count {
                let pool: Vec<i32> = sites.iter().chain(capitals.iter()).copied().collect();
                for _ in 0..count {
                    let mut nearest = -1;
                    let mut best = w;
                    for &c in &pool {
                        if c == cap || per[p].contains(&c) {
                            continue;
                        }
                        let d = self.cheb(cap, c);
                        if d < best {
                            best = d;
                            nearest = c;
                        }
                    }
                    if nearest < 0 {
                        break;
                    }
                    per[p].push(nearest);
                }
            }
            let mut sx = self.x(cap);
            let mut sy = self.y(cap);
            for &s in &per[p] {
                sx += self.x(s);
                sy += self.y(s);
            }
            let k = per[p].len() as i32 + 1;
            // Math.trunc of a non-negative quotient
            let centroid = Coord::new(sx / k, sy / k);
            self.land_corridor(centroid, cap, land);
            let mine = per[p].clone();
            for s in mine {
                self.land_corridor(centroid, s, land);
            }
        }
        sites
    }

    fn preterrain_cities(&mut self, cities: &mut Vec<i32>, count: i32) {
        if count <= 0 {
            // the candidates only feed the draws below
            return;
        }
        let w = self.n;
        let mut cands: Vec<i32> = Vec::new();
        for y in 1..w - 1 {
            for x in 1..w - 1 {
                cands.push(y * w + x);
            }
        }
        for &c in cities.iter() {
            self.remove_near(&mut cands, c, 2);
        }
        for _ in 0..count {
            if cands.is_empty() {
                return;
            }
            let site = cands[self.range(0, cands.len() as i32) as usize];
            cities.push(site);
            self.remove_near(&mut cands, site, 2);
        }
    }

    fn postterrain_cities(&mut self, budget: i32) {
        let w = self.n;
        let total = self.total as usize;
        // tiles with an improvement within 2 (the relation is symmetric)
        let mut near = std::mem::take(&mut self.buf_bool);
        near.clear();
        near.resize(total, false);
        for j in 0..self.total {
            if self.imp[j as usize].any() {
                for &i in self.area(j, 2) {
                    near[i as usize] = true;
                }
            }
        }
        let mut cands = std::mem::take(&mut self.buf_i32b);
        cands.clear();
        for y in 1..w - 1 {
            for x in 1..w - 1 {
                let i = y * w + x;
                let u = i as usize;
                if !near[u] && !is_water_t(self.terrain[u]) && !self.imp[u].any() {
                    cands.push(i);
                }
            }
        }
        self.buf_bool = near;
        for _ in 0..budget {
            if cands.is_empty() {
                break;
            }
            let site = cands[self.range(0, cands.len() as i32) as usize];
            self.set_city(site);
            self.remove_near(&mut cands, site, 2);
        }
        self.buf_i32b = cands;
    }

    fn smooth(&mut self, noise: &mut [f64], protect: &[bool], iterations: i32, surrounding: f64) {
        if iterations <= 0 {
            return;
        }
        let w = self.n;
        let mut next = std::mem::take(&mut self.buf_f64b);
        next.clear();
        next.resize(noise.len(), 0.0);
        // the map inside a border of `surrounding`: pad row y + 1, column x + 1 is tile (x, y)
        let wu = w as usize;
        let wp = wu + 2;
        let mut pad = std::mem::take(&mut self.buf_pad);
        pad.clear();
        pad.resize(wp * wp, surrounding);
        for _ in 0..iterations {
            for y in 0..wu {
                pad[(y + 1) * wp + 1..(y + 1) * wp + 1 + wu].copy_from_slice(&noise[y * wu..(y + 1) * wu]);
            }
            for y in 0..wu {
                let r0 = &pad[y * wp..(y + 1) * wp];
                let r1 = &pad[(y + 1) * wp..(y + 2) * wp];
                let r2 = &pad[(y + 2) * wp..(y + 3) * wp];
                let out = &mut next[y * wu..(y + 1) * wu];
                for x in 0..wu {
                    // the same sum in the same order: rows y - 1 .. y + 1, columns x - 1 .. x + 1
                    let mut sum = 0.0;
                    sum += r0[x];
                    sum += r0[x + 1];
                    sum += r0[x + 2];
                    sum += r1[x];
                    sum += r1[x + 1];
                    sum += r1[x + 2];
                    sum += r2[x];
                    sum += r2[x + 1];
                    sum += r2[x + 2];
                    out[x] = sum / 9.0;
                }
            }
            for (i, &p) in protect.iter().enumerate() {
                if p {
                    next[i] = noise[i];
                }
            }
            noise.copy_from_slice(&next);
        }
        self.buf_pad = pad;
        self.buf_f64b = next;
    }

    // ---- noise path ----
    fn noise_map(&mut self) {
        let s = self.s;
        let w = self.n;
        let total = self.total as usize;
        let capitals = self.capital_positions(self.players);
        let axis = ((w as f64) * 0.33).floor() as i32;
        let available = axis * axis - capitals.len() as i32;
        let max_cities = ((available as f64) * s.post_terrain_city_density).floor() as i32;
        let suburb_count = (s.min_suburbs as f64).max((s.max_suburbs as f64).min((max_cities as f64 / self.players as f64).trunc())) as i32;
        let mut land: Vec<i32> = Vec::new();
        let suburbs = self.suburbs(&capitals, suburb_count, &mut land);
        let mut cities: Vec<i32> = capitals.iter().chain(suburbs.iter()).copied().collect();
        let pre_budget = (((available - suburbs.len() as i32) as f64) * s.pre_terrain_city_density).floor() as i32;
        self.preterrain_cities(&mut cities, pre_budget);
        land.extend_from_slice(&cities);
        let mut land_set = std::mem::take(&mut self.buf_bool);
        land_set.clear();
        land_set.resize(total, false);
        for &i in &land {
            land_set[i as usize] = true;
        }
        // seeds: land_set plus the capitals' orthogonal neighbours
        let mut seeds = std::mem::take(&mut self.buf_bool2);
        seeds.clear();
        seeds.extend_from_slice(&land_set);
        for &c in &capitals {
            for d in [1, -1, w, -w] {
                let j = c + d;
                if j >= 0 && (j as usize) < total {
                    seeds[j as usize] = true;
                }
            }
        }
        let mut noise = std::mem::take(&mut self.buf_f64);
        noise.clear();
        let mut rng = self.rng.clone();
        for i in 0..total {
            let v = rng.next();
            noise.push(if seeds[i] { v * (1.0 - s.wetness) + s.wetness } else { v });
        }
        self.rng = rng;
        self.smooth(&mut noise, &land_set, s.smooth_iterations, s.surrounding_space);
        // the k-th smallest value (noise holds no NaN and no -0, so equal keys are equal values)
        let mut sorted = std::mem::take(&mut self.buf_f64b);
        sorted.clear();
        sorted.extend_from_slice(&noise);
        let k = round_half_even((noise.len() - 1) as f64 * s.wetness) as usize;
        let waterline = *sorted.select_nth_unstable_by(k, |a, b| a.partial_cmp(b).unwrap()).1;
        self.buf_f64b = sorted;
        // city_set reuses the seeds buffer
        let mut city_set = seeds;
        city_set.fill(false);
        for &c in &cities {
            city_set[c as usize] = true;
        }
        for i in 0..self.total {
            let u = i as usize;
            if city_set[u] {
                if let Some(seat) = capitals.iter().position(|&c| c == i) {
                    self.set_capital(seat as i32, i);
                } else {
                    self.set_city(i);
                }
            } else if waterline <= noise[u] {
                self.terrain[u] = Terrain::Field;
                self.alt[u] = 1;
            } else {
                self.terrain[u] = Terrain::Ocean;
                self.alt[u] = -2;
            }
        }
        for &i in &land {
            self.terrain[i as usize] = Terrain::Field;
            self.alt[i as usize] = 1;
        }
        self.buf_bool = land_set;
        self.buf_bool2 = city_set;
        self.buf_f64 = noise;
        self.postterrain_cities(max_cities - pre_budget);
        self.grow_climates();
    }

    // ---- island path ----
    fn island_map(&mut self) -> bool {
        let s = self.s;
        let w = self.n;
        let mut noise: Vec<f64> = Vec::with_capacity(self.total as usize);
        for _ in 0..self.total {
            noise.push(self.rng.next());
        }
        self.smooth(&mut noise, &[], s.smooth_iterations, s.surrounding_space);
        let seeds: Vec<i32> = if self.map_type == MapType::Pangea {
            vec![(w / 2) * w + w / 2]
        } else {
            let mut counts: Vec<i32> = Vec::new();
            for c in 2..=7 {
                let size = (1.0 - s.wetness) * ((self.total / c) as f64);
                if (30.0..=200.0).contains(&size) {
                    counts.push(c);
                }
            }
            let count = if counts.is_empty() { 2 } else { counts[self.range(0, counts.len() as i32) as usize] };
            self.capital_positions(count)
        };
        let mut populated = seeds.len() as i32;
        while populated > 1 {
            let ratio = 1f64.max(self.players as f64 / populated as f64);
            if ratio >= 2.0 || ratio == 1.0 {
                break;
            }
            populated -= 1;
        }
        self.add_continents(&seeds, &noise, populated);
        self.fill_island_villages();
        if !self.island_capitals(populated) {
            if !self.tight_capitals() {
                return false;
            }
            self.fill_island_villages();
        }
        self.open_water_villages();
        self.grow_climates();
        true
    }

    fn add_continents(&mut self, seeds: &[i32], noise: &[f64], populated: i32) {
        let mut caps = vec![0i32; seeds.len()];
        self.islands = seeds.iter().map(|_| Vec::new()).collect();
        for (id, &i) in seeds.iter().enumerate() {
            let u = i as usize;
            self.cont[u] = Some(100 + id as i32);
            self.alt[u] = 1;
            self.terrain[u] = Terrain::Field;
            self.islands[id].push(i);
        }
        let count = seeds.len();
        let mut target = self.total as f64 * (1.0 - self.s.wetness);
        if count > 1 {
            target *= 0.5 / count as f64 + 1.0;
        }
        let capital_share = (0.5 * target) / self.players as f64;
        let base_share = (target - 0.5 * target) / count as f64;
        for p in 0..self.players {
            caps[(p % populated) as usize] += 1;
        }
        let mut blocked = vec![false; self.total as usize];
        for id in 0..count {
            let mut attempts = 0;
            while caps[id] as f64 * capital_share + base_share > self.islands[id].len() as f64 && attempts < 1000 {
                attempts += 1;
                self.expand_continent(id, noise, &mut blocked);
            }
        }
    }

    fn expand_continent(&mut self, id: usize, noise: &[f64], blocked: &mut [bool]) -> bool {
        let w = self.n;
        let mut origins = std::mem::take(&mut self.buf_i32b);
        origins.clear();
        origins.extend_from_slice(&self.islands[id]);
        let mut lazy = LazyShuffle::start(&mut self.rng, origins.len());
        let me = Some(100 + id as i32);
        let mut result = false;
        for oi in 0..origins.len() {
            let origin = lazy.get(&mut origins, oi);
            if blocked[origin as usize] {
                continue;
            }
            let ox = self.x(origin);
            let oy = self.y(origin);
            let mut cand_buf = [0i32; 4];
            let mut nc = 0;
            for (dx, dy) in [(-1, 0), (0, -1), (0, 1), (1, 0)] {
                let (x, y) = (ox + dx, oy + dy);
                if x >= 0 && y >= 0 && x < w && y < w {
                    cand_buf[nc] = y * w + x;
                    nc += 1;
                }
            }
            let cands = &mut cand_buf[..nc];
            self.shuffle(cands);
            let mut best_score = 0.0f64;
            let mut best = -1;
            for &c in cands.iter() {
                if self.cont[c as usize].is_some() {
                    continue;
                }
                let mut score = noise[c as usize] + 1.0;
                let e = self.edge(c) as f64;
                if self.map_type == MapType::Continents {
                    score += e / -5.0;
                } else if self.map_type == MapType::Pangea {
                    score += -1.0 / e;
                }
                for &nb in self.area(c, 1) {
                    let other = self.cont[nb as usize];
                    if other.is_none() || other == me {
                        continue;
                    }
                    if self.alt[nb as usize] >= 0 {
                        score -= self.float(0.5, 3.0);
                        if self.x(nb) == self.x(c) || self.y(nb) == self.y(c) {
                            score += -10.0;
                        }
                    } else {
                        score -= self.float(0.0, 0.5);
                    }
                }
                if score > best_score {
                    best_score = score;
                    best = c;
                }
            }
            if best >= 0 {
                let u = best as usize;
                self.cont[u] = me;
                self.alt[u] = 1;
                self.terrain[u] = Terrain::Field;
                self.resource[u] = None;
                self.islands[id].push(best);
                result = true;
                break;
            }
            blocked[origin as usize] = true;
        }
        self.buf_i32b = origins;
        result
    }

    fn fill_island_villages(&mut self) {
        let mut misses = 0;
        let mut c = 0;
        if self.islands.is_empty() {
            return;
        }
        while misses < self.islands.len() {
            misses = if self.add_island_village(c) { 0 } else { misses + 1 };
            c = (c + 1) % self.islands.len();
        }
    }

    fn add_island_village(&mut self, id: usize) -> bool {
        if self.islands[id].len() < 2 {
            return false;
        }
        let mut sites = std::mem::take(&mut self.buf_i32b);
        sites.clear();
        sites.extend_from_slice(&self.islands[id]);
        let mut lazy = LazyShuffle::start(&mut self.rng, sites.len());
        let r = self.add_island_village_in(&mut sites, &mut lazy);
        self.buf_i32b = sites;
        r
    }

    fn add_island_village_in(&mut self, sites: &mut [i32], lazy: &mut LazyShuffle) -> bool {
        for forced in [false, true] {
            for si in 0..sites.len() {
                let i = lazy.get(sites, si);
                let u = i as usize;
                let ex = self.x(i).min(self.n - 1 - self.x(i));
                let ey = self.y(i).min(self.n - 1 - self.y(i));
                if ex.min(ey) < 1 || self.imp[u].any() || self.area_any(i, 2, |j| self.imp[j].any()) {
                    continue;
                }
                if forced {
                    let mut same = false;
                    let mut foreign = false;
                    for &j in self.area(i, 1) {
                        let j = j as usize;
                        if self.alt[j] < 0 {
                            continue;
                        }
                        if self.cont[j] == self.cont[u] {
                            same = true;
                        } else {
                            foreign = true;
                        }
                    }
                    if !same || foreign {
                        continue;
                    }
                } else if is_water_t(self.terrain[u]) || ex.min(ey) < 2 || ex == 3 || ey == 3 {
                    continue;
                }
                self.set_city(i);
                return !forced;
            }
        }
        false
    }

    /// None excludes the tile, Some(true) marks a strict site
    fn capital_eligibility(&self, i: i32, radius: i32) -> Option<bool> {
        let u = i as usize;
        let ex = self.x(i).min(self.n - 1 - self.x(i));
        let ey = self.y(i).min(self.n - 1 - self.y(i));
        if ex.min(ey) < 2 || self.imp[u].any() {
            return None;
        }
        for &j in self.area(i, radius) {
            let ju = j as usize;
            if self.imp[ju].any() && (self.cheb(i, j) <= 2 || (self.owner[ju] >= 0 && self.imp[ju] == Imp::City)) {
                return None;
            }
        }
        Some(ex != 3 && ey != 3 && !is_water_t(self.terrain[u]))
    }

    fn emergency_city_position(&mut self) -> Option<i32> {
        let radius = self.min_capital_distance() - 1;
        let mut strict: Vec<i32> = Vec::new();
        let mut first: Option<i32> = None;
        for i in 0..self.total {
            let Some(e) = self.capital_eligibility(i, radius) else { continue };
            if first.is_none() {
                first = Some(i);
            }
            if e {
                strict.push(i);
            }
        }
        if strict.is_empty() {
            return first;
        }
        Some(strict[self.range(0, strict.len() as i32) as usize])
    }

    fn reserve_island_capital(&mut self, id: Option<i32>, player: i32, sites: &mut Vec<i32>) -> bool {
        let minimum = self.min_capital_distance();
        let mut best: Option<i32> = None;
        let mut best_score = 0;
        let list: Vec<i32> = match id {
            None => Vec::new(),
            Some(id) if id >= 0 => self.islands.get(id as usize).cloned().unwrap_or_default(),
            Some(_) => Vec::new(),
        };
        for c in list {
            if self.owner[c as usize] >= 0 || !self.is_city(c) {
                continue;
            }
            let distance = sites.iter().fold(20, |m, &o| m.min(self.cheb(c, o)));
            if distance < minimum {
                continue;
            }
            if self.edge(c) <= 1 {
                continue;
            }
            let water = self.area(c, 1).iter().filter(|&&j| is_water_t(self.terrain[j as usize])).count();
            let score = distance + if (2..=6).contains(&water) { 1 } else { 0 };
            if score > best_score {
                best = Some(c);
                best_score = score;
            }
        }
        let site = match best {
            Some(b) => Some(b),
            None => self.emergency_city_position(),
        };
        let Some(site) = site else { return false };
        self.set_city(site);
        self.owner[site as usize] = player;
        sites.push(site);
        true
    }

    fn island_capitals(&mut self, populated: i32) -> bool {
        let mut sites: Vec<i32> = Vec::new();
        for p in 0..self.players {
            if !self.reserve_island_capital(Some(p % populated), p, &mut sites) {
                return false;
            }
        }
        for original in sites.clone() {
            let Some(c) = self.cont[original as usize] else { continue };
            let id = self.owner[original as usize];
            self.owner[original as usize] = -1;
            let k = sites.iter().position(|&s| s == original).unwrap();
            sites.remove(k);
            if !self.reserve_island_capital(Some(c - 100), id, &mut sites) {
                return false;
            }
        }
        self.finalize_capitals(&sites);
        true
    }

    fn finalize_capitals(&mut self, sites: &[i32]) {
        let owners: Vec<i32> = sites.iter().map(|&i| self.owner[i as usize]).collect();
        for &i in sites {
            self.owner[i as usize] = -1;
        }
        for (k, &i) in sites.iter().enumerate() {
            self.set_capital(owners[k], i);
        }
    }

    fn tight_capitals(&mut self) -> bool {
        let radius = self.min_capital_distance() - 1;
        self.imp.fill(Imp::None);
        self.owner.fill(-1);
        let mut index = 0;
        let mut sites: Vec<i32> = Vec::new();
        for p in 0..self.players {
            while index < self.total && self.capital_eligibility(index, radius) != Some(true) {
                index += 1;
            }
            if index >= self.total {
                return false;
            }
            self.set_city(index);
            self.owner[index as usize] = p;
            sites.push(index);
        }
        self.finalize_capitals(&sites);
        true
    }

    fn open_water_villages(&mut self) {
        let target = ((self.s.wetness * self.total as f64) / 50.0).floor() as i32;
        let mut order = std::mem::take(&mut self.buf_i32b);
        order.clear();
        order.extend(0..self.total);
        let mut lazy = LazyShuffle::start(&mut self.rng, order.len());
        let mut placed = 0;
        for oi in 0..order.len() {
            let i = lazy.get(&mut order, oi);
            let u = i as usize;
            if self.imp[u].any() || !is_water_t(self.terrain[u]) || self.edge(i) <= 0 {
                continue;
            }
            if self.area_any(i, 1, |j| !is_water_t(self.terrain[j])) {
                continue;
            }
            if self.area_any(i, 2, |j| self.imp[j] == Imp::City) {
                continue;
            }
            self.set_city(i);
            placed += 1;
            if placed >= target {
                break;
            }
        }
        self.buf_i32b = order;
    }

    // ---- climates, terrain, resources ----
    fn grow_climates(&mut self) {
        let players = self.players;
        let alien = std::mem::take(&mut self.alien);
        let fallback = alien.iter().all(|&a| a);
        // reuse the climates' tile lists
        let mut old = std::mem::take(&mut self.climates);
        let mut pool: Vec<Vec<i32>> = old.drain(..).map(|c| c.tiles).collect();
        self.climates = old;
        for p in 0..players {
            let none: Mods = [None; ModKey::COUNT];
            let m = self.mods.get(p as usize).unwrap_or(&none);
            let mut chance = [0.0f64; 7];
            for k in 0..7 {
                let base = if KIND_MODS[k] == ModKey::AquaCrop { 0.3 } else { RESOURCE_CHANCES[k] };
                chance[k] = modify(base, m[KIND_MODS[k].idx()]);
            }
            if self.s.wetness == 0.0 {
                chance[K_FISH] = 0.0;
            }
            // mods never carry a "field" key (ModKey has none)
            let mut tiles = if pool.is_empty() { Vec::new() } else { pool.remove(0) };
            tiles.clear();
            tiles.push(self.cap(p));
            let c = Climate {
                tiles,
                field: modify(TERRAIN_WEIGHT_FIELD, None),
                mountain: modify(TERRAIN_WEIGHT_MOUNTAIN, m[ModKey::Mountain.idx()]),
                forest: modify(TERRAIN_WEIGHT_FOREST, m[ModKey::Forest.idx()]),
                chance,
            };
            self.climates.push(c);
        }
        // island continents the climates do not reach keep the default climate
        for c in self.cont.iter_mut() {
            if let Some(v) = *c {
                if v >= 100 {
                    *c = Some(DEFAULT_CLIMATE);
                }
            }
        }
        let mut assigned = players;
        let mut budget = self.total * 10;
        let mut id: i32 = 0;
        let mut rng = self.rng.clone();
        let total = self.total as usize;
        assert!(self.clim_key.len() == total && self.alt.len() == total && self.cont.len() == total && self.terrain.len() == total && self.resource.len() == total);
        while assigned < self.total && budget > 0 {
            let idu = id as usize;
            let len = self.climates[idu].tiles.len();
            if len == 0 || (alien[idu] && !fallback) {
                budget -= 1;
            } else {
                let src = rrange(&mut rng, 0, len as i32) as usize;
                let origin = self.climates[idu].tiles[src];
                let around = self.area(origin, 1);
                // the candidates: free land around the origin, else any free tile
                let mut land_c = [0i32; 8];
                let mut any_c = [0i32; 8];
                let mut nl = 0usize;
                let mut na = 0usize;
                let (ck, alt) = (&self.clim_key[..total], &self.alt[..total]);
                for &i in around {
                    let u = i as usize;
                    debug_assert!(u < total);
                    // SAFETY: area() yields tiles of the map (< total)
                    if unsafe { *ck.get_unchecked(u) } == 0 {
                        any_c[na] = i;
                        na += 1;
                        if unsafe { *alt.get_unchecked(u) } >= 0 {
                            land_c[nl] = i;
                            nl += 1;
                        }
                    }
                }
                if na == 0 {
                    let tiles = &mut self.climates[idu].tiles;
                    let at = if origin == tiles[0] { 0 } else { src };
                    tiles.remove(at);
                    budget -= 1;
                    // TS `continue`: the same climate tries again
                    continue;
                }
                let chosen = if nl > 0 {
                    land_c[rrange(&mut rng, 0, nl as i32) as usize]
                } else {
                    any_c[rrange(&mut rng, 0, na as i32) as usize]
                };
                let u = chosen as usize;
                let key = if fallback { self.imperius_key } else { self.key(id) };
                debug_assert!(u < total);
                // SAFETY: chosen comes from area() (a tile of the map); the arrays have one entry per tile
                unsafe {
                    *self.clim_key.get_unchecked_mut(u) = key;
                    *self.cont.get_unchecked_mut(u) = Some(id);
                    if *self.alt.get_unchecked(u) >= 0 {
                        *self.alt.get_unchecked_mut(u) = 1;
                        *self.terrain.get_unchecked_mut(u) = Terrain::Field;
                        *self.resource.get_unchecked_mut(u) = None;
                    }
                }
                self.climates[idu].tiles.push(chosen);
                assigned += 1;
            }
            id += 1;
            if id == players {
                id = 0;
            }
        }
        self.rng = rng;
        self.alien = alien;
    }

    fn assign_terrain(&mut self) {
        // each climate's land tiles (no water, no improvement) in index order:
        // terrain and imp of one tile do not change another's eligibility
        let nc = self.climates.len();
        let total = self.total as usize;
        let mut offs = [0usize; 17];
        let mut big: Vec<usize> = Vec::new();
        let offs: &mut [usize] = if nc < 16 {
            &mut offs[..nc + 1]
        } else {
            big.resize(nc + 1, 0);
            &mut big[..]
        };
        let mut lists = std::mem::take(&mut self.buf_i32b);
        lists.clear();
        lists.resize(total, 0);
        assert!(self.resource.len() == total && self.terrain.len() == total && self.alt.len() == total);
        let eligible = |g: &Gen, u: usize| -> Option<usize> {
            match g.cont[u] {
                Some(c) if c >= 0 && (c as usize) < nc && !is_water_t(g.terrain[u]) && !g.imp[u].any() => Some(c as usize),
                _ => None,
            }
        };
        for u in 0..total {
            if let Some(c) = eligible(self, u) {
                offs[c + 1] += 1;
            }
        }
        for c in 0..nc {
            offs[c + 1] += offs[c];
        }
        let mut fill: [usize; 16] = [0; 16];
        let mut fill_big: Vec<usize> = Vec::new();
        let fill: &mut [usize] = if nc < 16 {
            fill[..nc].copy_from_slice(&offs[..nc]);
            &mut fill[..nc]
        } else {
            fill_big.extend_from_slice(&offs[..nc]);
            &mut fill_big[..]
        };
        for u in 0..total {
            if let Some(c) = eligible(self, u) {
                lists[fill[c]] = u as i32;
                fill[c] += 1;
            }
        }
        let mut rng = self.rng.clone();
        for id in 0..nc {
            let land = offs[id + 1] - offs[id];
            let c = &self.climates[id];
            let wsum = c.forest + c.field + c.mountain;
            let mut counts = [c.field, c.mountain, c.forest].map(|wt| {
                let q = (wt / wsum) * land as f64;
                if q > 0.0 {
                    q.ceil() as i32
                } else {
                    0
                }
            });
            for k in offs[id]..offs[id + 1] {
                let u = lists[k] as usize;
                debug_assert!(u < total);
                // SAFETY: lists holds tiles of the map (< total); the arrays have one entry per tile
                unsafe { *self.resource.get_unchecked_mut(u) = None };
                let remaining = counts[0] + counts[1] + counts[2];
                if remaining == 0 {
                    break;
                }
                let pick = rrange(&mut rng, 0, remaining);
                let g = if pick < counts[0] {
                    0
                } else if pick < counts[0] + counts[1] {
                    1
                } else {
                    2
                };
                counts[g] -= 1;
                // SAFETY: as above
                unsafe {
                    *self.terrain.get_unchecked_mut(u) = [Terrain::Field, Terrain::Mountain, Terrain::Forest][g];
                    *self.alt.get_unchecked_mut(u) = if g == 1 { 2 } else { 1 };
                }
            }
        }
        self.rng = rng;
        self.buf_i32b = lists;
    }

    fn make_ocean(&mut self) {
        let w = self.n;
        let total = self.total;
        let mut next = std::mem::take(&mut self.buf_terrain);
        next.clear();
        next.extend_from_slice(&self.terrain);
        let water = |i: i32| is_water_t(self.terrain[i as usize]);
        for i in 0..total {
            if !water(i) {
                continue;
            }
            let near_land = (i + w < total && !water(i + w)) || (i >= w && !water(i - w)) || (i % w != 0 && !water(i - 1)) || ((i % w) + 1 < w && !water(i + 1));
            next[i as usize] = if near_land { Terrain::Water } else { Terrain::Ocean };
        }
        self.buf_terrain = std::mem::replace(&mut self.terrain, next);
    }

    fn corners(&self) -> [i32; 4] {
        let m = self.n - 1;
        [m * self.n + m, 0, m * self.n, m]
    }

    fn lighthouses(&mut self) {
        for i in self.corners() {
            let u = i as usize;
            self.imp[u] = Imp::Lighthouse;
            if !is_water_t(self.terrain[u]) {
                self.terrain[u] = Terrain::Field;
            }
        }
    }

    fn add_resource(&mut self, rng: &mut Rng, i: usize) {
        if self.imp[i].any() {
            return;
        }
        // KINDS' terrains as bit masks over Terrain
        const fn mask(ts: &[Terrain]) -> u8 {
            let mut m = 0u8;
            let mut k = 0;
            while k < ts.len() {
                m |= 1 << ts[k] as u8;
                k += 1;
            }
            m
        }
        const KIND_TERRAINS: [u8; 7] = [mask(KINDS[0].1), mask(KINDS[1].1), mask(KINDS[2].1), mask(KINDS[3].1), mask(KINDS[4].1), mask(KINDS[5].1), mask(KINDS[6].1)];
        let chance = match self.cont[i] {
            Some(c) if c >= 0 => &self.climates[c as usize].chance,
            _ => &RESOURCE_CHANCES,
        };
        let tb = 1u8 << self.terrain[i] as u8;
        let mut passed = [Resource::Animal; 7];
        let mut np = 0;
        for k in 0..7 {
            let p = chance[k];
            if p == 0.0 || !(rng.next() <= p) {
                continue;
            }
            if KIND_TERRAINS[k] & tb != 0 {
                passed[np] = KINDS[k].0;
                np += 1;
            }
        }
        if np == 0 {
            return;
        }
        self.resource[i] = Some(passed[rrange(rng, 0, np as i32) as usize]);
    }

    fn resources(&mut self) {
        // the cities in index order (add_resource changes no improvement)
        let mut cities = std::mem::take(&mut self.buf_i32b);
        cities.clear();
        cities.extend((0..self.total).filter(|&i| self.is_city(i)));
        // per tile: OPEN = not visited yet, no resource and no improvement (the
        // only tile whose resource changes is the one being visited); IMP = has an
        // improvement (fixed here)
        const OPEN: u8 = 1;
        const IMP: u8 = 2;
        let total = self.total as usize;
        let mut st = std::mem::take(&mut self.buf_u8);
        st.clear();
        st.extend(self.resource[..total].iter().zip(&self.imp[..total]).map(|(r, &im)| {
            if im.any() {
                IMP
            } else if r.is_none() {
                OPEN
            } else {
                0
            }
        }));
        let richness = self.s.richness;
        let third = richness / 3.0;
        let mut rng = self.rng.clone();
        for &c in &cities {
            for &i in self.area(c, 1) {
                let u = i as usize;
                debug_assert!(u < total);
                // SAFETY: area() yields tiles of the map; st holds one entry per tile
                let f = unsafe { st.get_unchecked_mut(u) };
                if rng.next() < richness && *f & OPEN != 0 {
                    self.add_resource(&mut rng, u);
                }
                *f &= !OPEN;
            }
        }
        for &c in &cities {
            for &i in self.area(c, 2) {
                let u = i as usize;
                debug_assert!(u < total);
                // SAFETY: as above
                let f = unsafe { st.get_unchecked_mut(u) };
                if *f & IMP == 0 && rng.next() < third && *f & OPEN != 0 {
                    self.add_resource(&mut rng, u);
                }
                *f &= !OPEN;
            }
        }
        self.buf_u8 = st;
        self.rng = rng;
        self.buf_i32b = cities;
    }

    fn starting_resources(&mut self, p: i32, wanted: &[Resource]) {
        let mut requests: Vec<Resource> = wanted.to_vec();
        if requests.is_empty() {
            return;
        }
        let around = self.area(self.cap(p), 1);
        let mut all_buf = [0i32; 8];
        let all = &mut all_buf[..around.len()];
        all.copy_from_slice(around);
        self.shuffle(all);
        let mut cands: Vec<i32> = Vec::with_capacity(all.len());
        for &i in all.iter() {
            let k = self.resource[i as usize].and_then(|r| requests.iter().position(|&q| q == r));
            match k {
                Some(k) => {
                    requests.remove(k);
                }
                None => cands.push(i),
            }
        }
        let mut placements: Vec<(i32, Terrain, Resource)> = Vec::new();
        for pass in 0..3 {
            let mut k = 0;
            while k < requests.len() {
                let kind = requests[k];
                let choices = terrains_of(kind);
                let terrain = choices[self.range(0, choices.len() as i32) as usize];
                let at = cands.iter().position(|&i| {
                    let ti = self.terrain[i as usize];
                    match pass {
                        0 => ti == terrain,
                        1 => !is_water_t(ti),
                        _ => true,
                    }
                });
                if let Some(at) = at {
                    let tile = cands.remove(at);
                    let r = requests.remove(k);
                    placements.push((tile, terrain, r));
                } else {
                    k += 1;
                }
            }
        }
        for (i, terrain, kind) in placements {
            self.terrain[i as usize] = terrain;
            self.resource[i as usize] = Some(kind);
        }
    }

    fn ruins(&mut self, amount: i32) {
        let mut order = std::mem::take(&mut self.buf_i32b);
        order.clear();
        order.extend(0..self.total);
        let mut lazy = LazyShuffle::start(&mut self.rng, order.len());
        let corners = self.corners();
        let mut placed = 0;
        let mut water = 0;
        for oi in 0..order.len() {
            let i = lazy.get(&mut order, oi);
            let u = i as usize;
            let wet = is_water_t(self.terrain[u]);
            if corners.contains(&i) || (wet && water > amount) {
                continue;
            }
            if wet && (self.owner[u] >= 0 || self.terrain[u] != Terrain::Ocean || self.edge(i) <= 0) {
                continue;
            }
            let check = |j: usize| -> bool {
                match self.imp[j] {
                    Imp::Ruin => true,
                    Imp::City => wet || self.owner[j] >= 0 || self.cheb(i, j as i32) <= 1,
                    _ => false,
                }
            };
            let blocked = self.area_any(i, 2, check) || check(u);
            if blocked {
                continue;
            }
            self.imp[u] = Imp::Ruin;
            placed += 1;
            if wet {
                water += 1;
            }
            if placed > amount {
                break;
            }
        }
        self.buf_i32b = order;
    }

    fn starfish(&mut self, amount: f64) {
        if amount <= 0.0 {
            return;
        }
        let mut placed = 0;
        for _ in 0..self.total {
            let i = self.range(0, self.total);
            let u = i as usize;
            if !is_water_t(self.terrain[u]) || self.imp[u].any() {
                continue;
            }
            if self.area_any(i, 1, |j| self.resource[j] == Some(Resource::Starfish) || self.imp[j] == Imp::City) {
                continue;
            }
            self.resource[u] = Some(Resource::Starfish);
            placed += 1;
            if amount <= placed as f64 {
                break;
            }
        }
    }

    fn draw(&mut self) {
        let islands = matches!(self.map_type, MapType::Continents | MapType::Pangea);
        if !(islands && self.island_map()) {
            if islands {
                self.clear();
            }
            self.noise_map();
        }
        // populate
        self.assign_terrain();
        self.make_ocean();
        self.lighthouses();
        self.resources();
        let total = self.total as usize;
        let starts = std::mem::take(&mut self.starts);
        for p in 0..self.players {
            self.starting_resources(p, &starts[p as usize]);
            let key = self.key(p);
            for &i in self.area(self.cap(p), 1) {
                self.clim_key[i as usize] = key;
            }
        }
        self.starts = starts;
        self.make_ocean();
        self.flooded.fill(false);
        self.ice.fill(false);
        self.polar.fill(false);
        for p in 0..self.players {
            if !flag(&self.opts.flooded, p as usize) {
                continue;
            }
            let key = self.clim_key[self.cap(p) as usize];
            for i in 0..total {
                if self.clim_key[i] == key && matches!(self.terrain[i], Terrain::Field | Terrain::Forest) {
                    self.flooded[i] = true;
                }
            }
        }
        self.ruins(self.total / 40);
        self.starfish((self.total as f64 * self.s.wetness) / 25.0);
        for p in 0..self.players {
            if !flag(&self.opts.polaris, p as usize) {
                continue;
            }
            let c = self.cap(p);
            let ring = std::iter::once(c).chain(self.area(c, 1).iter().copied());
            for i in ring {
                let u = i as usize;
                if is_water_t(self.terrain[u]) {
                    self.ice[u] = true;
                } else if !self.imp[u].any() {
                    self.polar[u] = true;
                }
            }
        }
    }

    fn start_list(&self) -> Vec<Vec<Resource>> {
        (0..self.players as usize)
            .map(|p| {
                if let Some(v) = self.opts.start_resources.as_ref().and_then(|s| s.get(p)) {
                    // an empty array is truthy in TS too
                    return v.clone();
                }
                if flag(&self.opts.water_start, p) {
                    return vec![Resource::Fish, Resource::Fish];
                }
                if flag(&self.opts.spores, p) {
                    return vec![Resource::Spores, Resource::Spores];
                }
                Vec::new()
            })
            .collect()
    }

    fn output(&self) -> GeneratedMap {
        output_of(self.n, &self.terrain, &self.resource, &self.imp, &self.flooded, &self.ice, &self.polar, &self.capital)
    }

    fn save(&self, snap: &mut Snapshot) {
        fn copy<T: Copy>(to: &mut Vec<T>, from: &[T]) {
            to.clear();
            to.extend_from_slice(from);
        }
        copy(&mut snap.terrain, &self.terrain);
        copy(&mut snap.resource, &self.resource);
        copy(&mut snap.imp, &self.imp);
        copy(&mut snap.flooded, &self.flooded);
        copy(&mut snap.ice, &self.ice);
        copy(&mut snap.polar, &self.polar);
        copy(&mut snap.capital, &self.capital);
    }

    /// inequality(&self.output(), n) without building the map
    fn inequality(&mut self) -> f64 {
        let total = self.total as usize;
        let mut sc = std::mem::take(&mut self.ineq);
        sc.flags.clear();
        sc.flags.extend(self.terrain[..total].iter().zip(&self.ice[..total]).zip(&self.imp[..total]).map(|((&t, &ice), &imp)| {
            let water = if is_water_t(t) && !ice { F_WATER } else { 0 };
            let mountain = if t == Terrain::Mountain { F_MOUNTAIN } else { 0 };
            // capitals and villages: every city tile
            let im = match imp {
                Imp::City => F_CITY,
                Imp::Ruin => F_RUIN,
                _ => 0,
            };
            water | mountain | im
        }));
        sc.caps.clear();
        for &c in &self.capital {
            // output(): capitals are Coord(x(i), y(i)), read back as y * n + x
            let u = (self.y(c) * self.n + self.x(c)) as usize;
            sc.caps.push(u);
            sc.flags[u] |= F_START | F_CITY;
        }
        let v = inequality_core(self.n, self.geo, &mut sc);
        self.ineq = sc;
        v
    }
}

#[allow(clippy::too_many_arguments)]
fn output_of(n: i32, terrain: &[Terrain], resource: &[Option<Resource>], imp: &[Imp], flooded: &[bool], ice: &[bool], polar: &[bool], capital: &[i32]) -> GeneratedMap {
    let total = (n * n) as usize;
    let mut capitals = vec![false; total];
    for &c in capital {
        if c >= 0 {
            capitals[c as usize] = true;
        }
    }
    let x = |i: i32| i % n;
    let y = |i: i32| i.div_euclid(n);
    let mut tiles = Vec::with_capacity(total);
    let mut villages = Vec::new();
    for i in 0..total as i32 {
        let u = i as usize;
        let village = imp[u] == Imp::City && !capitals[u];
        if village {
            villages.push(Coord::new(x(i), y(i)));
        }
        let mut t = Tile::new(terrain[u]);
        t.resource = resource[u];
        t.village = village;
        t.ruin = imp[u] == Imp::Ruin;
        t.lighthouse = imp[u] == Imp::Lighthouse;
        t.flooded = flooded[u];
        t.ice = ice[u];
        t.polar = polar[u];
        tiles.push(t);
    }
    let capitals = capital.iter().map(|&i| Coord::new(x(i), y(i))).collect();
    GeneratedMap { tiles, capitals, villages }
}

/// The fairness measure (polybots-engine mapgen/select.rs): every tile goes to
/// the capital that reaches it most cheaply; the result is the richest turf's
/// score over the poorest's.
pub fn inequality(map: &GeneratedMap, n: i32) -> f64 {
    let mut sc = IneqScratch::default();
    for t in &map.tiles {
        let mut f = 0u8;
        if is_water_t(t.terrain) && !t.ice {
            f |= F_WATER;
        }
        if t.terrain == Terrain::Mountain {
            f |= F_MOUNTAIN;
        }
        if t.ruin {
            f |= F_RUIN;
        }
        sc.flags.push(f);
    }
    for c in &map.capitals {
        let u = (c.y * n + c.x) as usize;
        sc.caps.push(u);
        sc.flags[u] |= F_START | F_CITY;
    }
    for c in &map.villages {
        sc.flags[(c.y * n + c.x) as usize] |= F_CITY;
    }
    inequality_core(n, &Geo::new(n, 1), &mut sc)
}

/// inequality over `sc.flags` and `sc.caps`; the other buffers are scratch.
/// A Dijkstra over (cost, first-entry order): those keys are unique (a tile is
/// pushed again only with a lower cost and keeps its order), so the pops come
/// in one definite order and each seat's score is summed in that order.
fn inequality_core(n: i32, geo: &Geo, sc: &mut IneqScratch) -> f64 {
    let total = (n * n) as usize;
    let seats = sc.caps.len();
    let IneqScratch { flags, caps, scores, ent, queue } = sc;
    let flags = &flags[..];
    let nf = n as f64;
    let span = nf * 0.8 - 3.0;
    let turf = |i: usize, cost: i32| -> f64 {
        let factor = 1f64.min(0f64.max((cost as f64 - 3.0) / span));
        let mut score;
        debug_assert!(i < flags.len());
        // SAFETY: i is a tile of the map (flags has one entry per tile)
        let f = unsafe { *flags.get_unchecked(i) };
        if f & F_CITY != 0 {
            let base = -90.0 * factor + 100.0 + 0.1;
            score = if cost == 3 {
                base + 40.0
            } else if cost == 4 {
                base + 20.0
            } else {
                base
            };
        } else if f & F_RUIN != 0 {
            let base = -3.0 * factor + 5.0 + 0.1;
            score = if cost < 5 { base + 5.0 } else { base };
        } else {
            score = 0.1;
        }
        if f & F_WATER == 0 {
            score += 1.5 - factor;
        }
        score
    };
    scores.clear();
    scores.resize(seats, 0.0);
    ent.clear();
    ent.resize(total, E_NONE);
    queue.clear();
    // a bucket's entries sort by order (the tile in the low bits never decides)
    assert!(total <= 1 << 16, "mapgen: map too large for inequality's keys");
    let entry = |order: u32, j: usize| (order << 16) | j as u32;
    let mut added: u32 = 0;
    assert!(seats <= 1 << 16, "mapgen: too many seats");
    let pack = |cost: i32, seat: u32, order: u32| ((cost as u32 as u64) << 32) | ((seat as u64) << 16) | order as u64;
    assert!(flags.len() == total && ent.len() == total);
    let mut expand = |index: usize, seat: u32, cost: i32, ent: &mut Vec<u64>, queue: &mut Buckets| {
        let fi = flags[index];
        // the step onto water depends on the tile left
        let wstep = if fi & F_WATER != 0 {
            4
        } else if fi & F_CITY == 0 {
            1000
        } else if fi & F_START != 0 {
            8
        } else {
            16
        };
        // step onto a tile by its flags & (F_WATER | F_MOUNTAIN): land, water, mountain
        let steps = [1, wstep, 4, 4];
        // the neighbours in the order x outer, y inner (geo's order)
        for &j in geo.area(index as i32, 1) {
            let j = j as usize;
            debug_assert!(j < ent.len() && j < flags.len());
            // SAFETY: area() yields tiles of the map; ent and flags hold one entry per tile
            let e = unsafe { *ent.get_unchecked(j) };
            if e == E_DONE {
                continue;
            }
            let fj = unsafe { *flags.get_unchecked(j) };
            let step = steps[(fj & (F_WATER | F_MOUNTAIN)) as usize];
            let next = cost + step;
            if e == E_NONE {
                unsafe { *ent.get_unchecked_mut(j) = pack(next, seat, added) };
                queue.push(next, entry(added, j));
                added += 1;
            } else {
                // next < cost || (next == cost && seat < its seat)
                let order = (e & 0xffff) as u32;
                let ne = pack(next, seat, order);
                if ne < e {
                    if next < (e >> 32) as i32 {
                        queue.push(next, entry(order, j));
                    }
                    unsafe { *ent.get_unchecked_mut(j) = ne };
                }
            }
        }
    };
    for (seat, &i) in caps.iter().enumerate() {
        ent[i] = E_DONE;
        scores[seat] = turf(i, 0);
    }
    for (seat, &i) in caps.iter().enumerate() {
        expand(i, seat as u32, 0, ent, queue);
    }
    // the pops in (cost, order) order: a bucket is complete when reached (every
    // push adds at least 1), so it is sorted once; its pushes go to later buckets
    let mut cur = 0;
    let mut bucket: Vec<u32> = Vec::new();
    while queue.pending > 0 {
        cur = queue.next_cost(cur);
        let slot = (cur & 1023) as usize;
        std::mem::swap(&mut bucket, &mut queue.slots[slot]);
        queue.bits[slot >> 6] &= !(1u64 << (slot & 63));
        queue.pending -= bucket.len();
        if bucket.len() > 1 {
            bucket.sort_unstable();
        }
        let cost = cur;
        for &q in bucket.iter() {
            let index = (q & 0xffff) as usize;
            debug_assert!(index < ent.len());
            // SAFETY: entries hold tiles of the map (ent has one entry per tile)
            let e = unsafe { *ent.get_unchecked(index) };
            if e >= E_DONE || (e >> 32) as i32 != cost {
                continue;
            }
            unsafe { *ent.get_unchecked_mut(index) = E_DONE };
            let seat = ((e >> 16) & 0xffff) as u32;
            scores[seat as usize] += turf(index, cost);
            expand(index, seat, cost, ent, queue);
        }
        bucket.clear();
        std::mem::swap(&mut bucket, &mut queue.slots[slot]);
    }
    // Math.min(...scores) / Math.max(...scores)
    let lo = scores.iter().fold(f64::INFINITY, |m, &v| m.min(v));
    let hi = scores.iter().fold(f64::NEG_INFINITY, |m, &v| m.max(v));
    hi / if lo > 0.0 { lo } else { 0.001 }
}

pub fn generate_map(rng: &mut Rng, n: i32, players: i32, map_type: MapType, mods: &[Mods], opts: &MapOptions) -> GeneratedMap {
    generate_map_with(rng, n, players, map_type, mods, opts, None)
}

/// generate_map with mapgen.ts `opts.candidates` (None = the preset's 50)
pub fn generate_map_with(rng: &mut Rng, n: i32, players: i32, map_type: MapType, mods: &[Mods], opts: &MapOptions, candidates: Option<i32>) -> GeneratedMap {
    let settings = MAP_SETTINGS[map_type as usize];
    let eff_mods: Vec<Mods> = (0..players as usize)
        .map(|p| {
            let mut m: Mods = mods.get(p).copied().unwrap_or([None; ModKey::COUNT]);
            // shorthand: Cymanti spawns (2.18 data: spores 0.3, crop 0)
            if flag(&opts.spores, p) {
                if m[ModKey::Spores.idx()].is_none() {
                    m[ModKey::Spores.idx()] = Some(0.3);
                }
                if m[ModKey::Crop.idx()].is_none() {
                    m[ModKey::Crop.idx()] = Some(0.0);
                }
            }
            m
        })
        .collect();
    let candidates = 1.max(candidates.unwrap_or(settings.equality_iterations));
    // capital_eligibility reads radius 3 (island maps only)
    let islands = matches!(map_type, MapType::Continents | MapType::Pangea);
    let geo = Geo::new(n, if islands { 3 } else { 2 });
    // one generator, reset per candidate; the fairest candidate is copied out
    let mut g = Gen::new(Rng::new(0), &geo, n, players, settings, map_type, &eff_mods, opts);
    let mut best = Snapshot::default();
    let mut have_best = false;
    let mut best_score = f64::INFINITY;
    for _ in 0..candidates {
        let seed = (rng.next() * 2147483647.0).floor() as i64;
        g.reset(Rng::new(seed));
        g.draw();
        if candidates == 1 {
            return g.output();
        }
        let score = g.inequality();
        if score < settings.equality_limit {
            return g.output();
        }
        if score < best_score {
            g.save(&mut best);
            have_best = true;
            best_score = score;
        }
    }
    assert!(have_best, "mapgen: no candidate map");
    output_of(n, &best.terrain, &best.resource, &best.imp, &best.flooded, &best.ice, &best.polar, &best.capital)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canon::canon_string;
    use crate::json::tile_to_json;
    use serde_json::Value;

    #[test]
    fn ruins_and_rounding() {
        assert_eq!(ruin_count(11), 4);
        assert_eq!(ruin_count(16), 7);
        assert_eq!(ruin_count(30), 23);
        assert_eq!(round_half_even(2.5), 2.0);
        assert_eq!(round_half_even(3.5), 4.0);
        assert_eq!(round_half_even(3.4999), 3.0);
    }

    fn bools(v: &Value) -> Option<Vec<bool>> {
        v.as_array().map(|a| a.iter().map(|x| x.as_bool().unwrap_or(false)).collect())
    }

    /// Compares against reference maps written by a TS script (path in
    /// MAPGEN_REF, a JSON array of {seed, n, players, mapType, mods, opts,
    /// tiles, capitals, villages, rngState}); skipped when unset.
    #[test]
    fn parity_with_ts_reference() {
        let Ok(path) = std::env::var("MAPGEN_REF") else {
            eprintln!("MAPGEN_REF not set; skipped");
            return;
        };
        let text = std::fs::read_to_string(&path).expect("read reference");
        let cases: Vec<Value> = serde_json::from_str(&text).unwrap();
        let mut bad = 0;
        for case in &cases {
            let seed = case["seed"].as_f64().unwrap() as i64;
            let n = case["n"].as_i64().unwrap() as i32;
            let players = case["players"].as_i64().unwrap() as i32;
            let mt = MapType::from_id(case["mapType"].as_str().unwrap()).unwrap();
            let mods: Vec<Mods> = case["mods"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| {
                    let mut out: Mods = [None; ModKey::COUNT];
                    for (k, v) in m.as_object().unwrap() {
                        out[ModKey::from_id(k).unwrap().idx()] = Some(v.as_f64().unwrap());
                    }
                    out
                })
                .collect();
            let o = &case["opts"];
            let opts = MapOptions {
                start_resources: o["startResources"]
                    .as_array()
                    .map(|a| a.iter().map(|l| l.as_array().unwrap().iter().map(|r| Resource::from_id(r.as_str().unwrap()).unwrap()).collect()).collect()),
                water_start: bools(&o["waterStart"]),
                flooded: bools(&o["flooded"]),
                spores: bools(&o["spores"]),
                polaris: bools(&o["polaris"]),
                climates: o["climates"].as_array().map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect()),
            };
            let mut rng = Rng::new(seed);
            let map = generate_map(&mut rng, n, players, mt, &mods, &opts);
            let want_tiles: Vec<String> = case["tiles"].as_array().unwrap().iter().map(canon_string).collect();
            let got_tiles: Vec<String> = map.tiles.iter().map(|t| canon_string(&tile_to_json(t))).collect();
            let coords = |v: &[Coord]| canon_string(&Value::Array(v.iter().map(|c| serde_json::json!({"x": c.x, "y": c.y})).collect()));
            let mut ok = true;
            if want_tiles != got_tiles {
                let first = want_tiles.iter().zip(&got_tiles).position(|(a, b)| a != b);
                eprintln!("case {} ({} n={} p={}): tiles differ, first at {:?}", case["id"], mt.id(), n, players, first);
                if let Some(k) = first {
                    eprintln!("  want {}\n  got  {}", want_tiles[k], got_tiles[k]);
                }
                ok = false;
            }
            if canon_string(&case["capitals"]) != coords(&map.capitals) {
                eprintln!("case {}: capitals differ", case["id"]);
                ok = false;
            }
            if canon_string(&case["villages"]) != coords(&map.villages) {
                eprintln!("case {}: villages differ", case["id"]);
                ok = false;
            }
            if case["rngState"].as_u64().unwrap() as u32 != rng.state() {
                eprintln!("case {}: rng state differs", case["id"]);
                ok = false;
            }
            let ineq = inequality(&map, n);
            // compared as JS number strings (serde_json float parsing is not correctly rounded)
            if case["inequality"].as_str().unwrap() != format!("{ineq}") {
                eprintln!("case {}: inequality {} vs {}", case["id"], case["inequality"], ineq);
                ok = false;
            }
            if !ok {
                bad += 1;
            }
        }
        eprintln!("mapgen parity: {} of {} cases equal", cases.len() - bad, cases.len());
        assert_eq!(bad, 0);
    }
}
