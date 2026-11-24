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

struct Gen<'a> {
    rng: Rng,
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
}

impl<'a> Gen<'a> {
    fn new(rng: Rng, n: i32, players: i32, s: MapSettings, map_type: MapType, mods: &'a [Mods], opts: &'a MapOptions) -> Gen<'a> {
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
        Gen {
            rng,
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
        }
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
    fn area(&self, i: i32, r: i32) -> Vec<i32> {
        let cx = self.x(i);
        let cy = self.y(i);
        let mut out = Vec::with_capacity(((2 * r + 1) * (2 * r + 1)) as usize);
        for dx in -r..=r {
            for dy in -r..=r {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let x = cx + dx;
                let y = cy + dy;
                if x >= 0 && y >= 0 && x < self.n && y < self.n {
                    out.push(y * self.n + x);
                }
            }
        }
        out
    }
    fn area_any(&self, i: i32, r: i32, mut f: impl FnMut(usize) -> bool) -> bool {
        let cx = self.x(i);
        let cy = self.y(i);
        for dx in -r..=r {
            for dy in -r..=r {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let x = cx + dx;
                let y = cy + dy;
                if x >= 0 && y >= 0 && x < self.n && y < self.n && f((y * self.n + x) as usize) {
                    return true;
                }
            }
        }
        false
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
        for j in self.area(i, 1) {
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
        let mut table = vec![0i64; (w * w) as usize];
        let offset = |v: i32| rem.min(1.max(rem.min(v) - 1));
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
            let mut free: Vec<i32> = Vec::new();
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
        let mut cands: Vec<i32> = Vec::new();
        for i in 0..self.total {
            let x = self.x(i);
            let y = self.y(i);
            if is_water_t(self.terrain[i as usize]) || x < 1 || y < 1 || x >= w - 1 || y >= w - 1 || self.imp[i as usize].any() {
                continue;
            }
            if !self.area_any(i, 2, |j| self.imp[j].any()) {
                cands.push(i);
            }
        }
        for _ in 0..budget {
            if cands.is_empty() {
                break;
            }
            let site = cands[self.range(0, cands.len() as i32) as usize];
            self.set_city(site);
            self.remove_near(&mut cands, site, 2);
        }
    }

    fn smooth(&self, noise: &mut [f64], protect: &[bool], iterations: i32, surrounding: f64) {
        let w = self.n;
        let mut next = vec![0.0f64; noise.len()];
        for _ in 0..iterations {
            for y in 0..w {
                for x in 0..w {
                    let mut sum = 0.0;
                    for ny in y - 1..=y + 1 {
                        for nx in x - 1..=x + 1 {
                            sum += if nx >= 0 && ny >= 0 && nx < w && ny < w { noise[(ny * w + nx) as usize] } else { surrounding };
                        }
                    }
                    next[(y * w + x) as usize] = sum / 9.0;
                }
            }
            for (i, &p) in protect.iter().enumerate() {
                if p {
                    next[i] = noise[i];
                }
            }
            noise.copy_from_slice(&next);
        }
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
        let mut land_set = vec![false; total];
        for &i in &land {
            land_set[i as usize] = true;
        }
        let mut seeds = land_set.clone();
        for &c in &capitals {
            for d in [1, -1, w, -w] {
                let j = c + d;
                if j >= 0 && (j as usize) < total {
                    seeds[j as usize] = true;
                }
            }
        }
        let mut noise: Vec<f64> = Vec::with_capacity(total);
        for i in 0..total {
            let v = self.rng.next();
            noise.push(if seeds[i] { v * (1.0 - s.wetness) + s.wetness } else { v });
        }
        self.smooth(&mut noise, &land_set, s.smooth_iterations, s.surrounding_space);
        let mut sorted = noise.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let waterline = sorted[round_half_even((noise.len() - 1) as f64 * s.wetness) as usize];
        let mut city_set = vec![false; total];
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
        let mut origins = self.islands[id].clone();
        self.shuffle(&mut origins);
        let me = Some(100 + id as i32);
        for origin in origins {
            if blocked[origin as usize] {
                continue;
            }
            let ox = self.x(origin);
            let oy = self.y(origin);
            let mut cands: Vec<i32> = [(-1, 0), (0, -1), (0, 1), (1, 0)]
                .iter()
                .map(|&(dx, dy)| (ox + dx, oy + dy))
                .filter(|&(x, y)| x >= 0 && y >= 0 && x < w && y < w)
                .map(|(x, y)| y * w + x)
                .collect();
            self.shuffle(&mut cands);
            let mut best_score = 0.0f64;
            let mut best = -1;
            for &c in &cands {
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
                for nb in self.area(c, 1) {
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
                return true;
            }
            blocked[origin as usize] = true;
        }
        false
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
        let mut sites = self.islands[id].clone();
        if sites.len() < 2 {
            return false;
        }
        self.shuffle(&mut sites);
        for forced in [false, true] {
            for &i in &sites {
                let u = i as usize;
                let ex = self.x(i).min(self.n - 1 - self.x(i));
                let ey = self.y(i).min(self.n - 1 - self.y(i));
                if ex.min(ey) < 1 || self.imp[u].any() || self.area_any(i, 2, |j| self.imp[j].any()) {
                    continue;
                }
                if forced {
                    let mut same = false;
                    let mut foreign = false;
                    for j in self.area(i, 1) {
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
        for j in self.area(i, radius) {
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
        let mut order: Vec<i32> = (0..self.total).collect();
        self.shuffle(&mut order);
        let mut placed = 0;
        for i in order {
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
    }

    // ---- climates, terrain, resources ----
    fn grow_climates(&mut self) {
        let players = self.players;
        let alien: Vec<bool> = (0..players as usize).map(|p| flag(&self.opts.polaris, p)).collect();
        let fallback = alien.iter().all(|&a| a);
        self.climates.clear();
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
            let c = Climate {
                tiles: vec![self.cap(p)],
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
        while assigned < self.total && budget > 0 {
            let idu = id as usize;
            let len = self.climates[idu].tiles.len();
            if len == 0 || (alien[idu] && !fallback) {
                budget -= 1;
            } else {
                let src = self.range(0, len as i32) as usize;
                let origin = self.climates[idu].tiles[src];
                let around = self.area(origin, 1);
                let mut cands: Vec<i32> = around.iter().copied().filter(|&i| self.clim_key[i as usize] == 0 && self.alt[i as usize] >= 0).collect();
                if cands.is_empty() {
                    cands = around.iter().copied().filter(|&i| self.clim_key[i as usize] == 0).collect();
                }
                if cands.is_empty() {
                    let tiles = &mut self.climates[idu].tiles;
                    let at = if origin == tiles[0] { 0 } else { src };
                    tiles.remove(at);
                    budget -= 1;
                    // TS `continue`: the same climate tries again
                    continue;
                }
                let chosen = cands[self.range(0, cands.len() as i32) as usize];
                let u = chosen as usize;
                self.clim_key[u] = if fallback { self.imperius_key } else { self.key(id) };
                self.cont[u] = Some(id);
                if self.alt[u] >= 0 {
                    self.alt[u] = 1;
                    self.terrain[u] = Terrain::Field;
                    self.resource[u] = None;
                }
                self.climates[idu].tiles.push(chosen);
                assigned += 1;
            }
            id = (id + 1) % players;
        }
    }

    fn assign_terrain(&mut self) {
        for id in 0..self.climates.len() {
            let mut tiles: Vec<i32> = Vec::new();
            let mut land = 0;
            for i in 0..self.total {
                let u = i as usize;
                if self.cont[u] != Some(id as i32) {
                    continue;
                }
                tiles.push(i);
                if !is_water_t(self.terrain[u]) && !self.imp[u].any() {
                    land += 1;
                }
            }
            let c = &self.climates[id];
            let total = c.forest + c.field + c.mountain;
            let mut counts = [c.field, c.mountain, c.forest].map(|wt| {
                let q = (wt / total) * land as f64;
                if q > 0.0 {
                    q.ceil() as i32
                } else {
                    0
                }
            });
            for i in tiles {
                let u = i as usize;
                if is_water_t(self.terrain[u]) || self.imp[u].any() {
                    continue;
                }
                self.resource[u] = None;
                let remaining = counts[0] + counts[1] + counts[2];
                if remaining == 0 {
                    break;
                }
                let pick = self.range(0, remaining);
                let g = if pick < counts[0] {
                    0
                } else if pick < counts[0] + counts[1] {
                    1
                } else {
                    2
                };
                counts[g] -= 1;
                self.terrain[u] = [Terrain::Field, Terrain::Mountain, Terrain::Forest][g];
                self.alt[u] = if g == 1 { 2 } else { 1 };
            }
        }
    }

    fn make_ocean(&mut self) {
        let w = self.n;
        let total = self.total;
        let water = |i: i32| is_water_t(self.terrain[i as usize]);
        let mut next = self.terrain.clone();
        for i in 0..total {
            if !water(i) {
                continue;
            }
            let near_land = (i + w < total && !water(i + w)) || (i >= w && !water(i - w)) || (i % w != 0 && !water(i - 1)) || ((i % w) + 1 < w && !water(i + 1));
            next[i as usize] = if near_land { Terrain::Water } else { Terrain::Ocean };
        }
        self.terrain = next;
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

    fn chance_at(&self, i: usize) -> [f64; 7] {
        match self.cont[i] {
            Some(c) if c >= 0 => self.climates[c as usize].chance,
            _ => RESOURCE_CHANCES,
        }
    }

    fn add_resource(&mut self, i: usize) {
        if self.imp[i].any() {
            return;
        }
        let chance = self.chance_at(i);
        let t = self.terrain[i];
        let mut passed: Vec<Resource> = Vec::new();
        for (k, (kind, terrains)) in KINDS.iter().enumerate() {
            let p = chance[k];
            if p == 0.0 || !(self.rng.next() <= p) {
                continue;
            }
            if terrains.contains(&t) {
                passed.push(*kind);
            }
        }
        if passed.is_empty() {
            return;
        }
        self.resource[i] = Some(passed[self.range(0, passed.len() as i32) as usize]);
    }

    fn resources(&mut self) {
        let cities: Vec<i32> = (0..self.total).filter(|&i| self.is_city(i)).collect();
        let mut visited = vec![false; self.total as usize];
        let richness = self.s.richness;
        for &c in &cities {
            for i in self.area(c, 1) {
                let u = i as usize;
                if self.rng.next() < richness && !visited[u] && self.resource[u].is_none() && !self.imp[u].any() {
                    self.add_resource(u);
                }
                visited[u] = true;
            }
        }
        for &c in &cities {
            for i in self.area(c, 2) {
                let u = i as usize;
                if !self.imp[u].any() && self.rng.next() < richness / 3.0 && !visited[u] && self.resource[u].is_none() {
                    self.add_resource(u);
                }
                visited[u] = true;
            }
        }
    }

    fn starting_resources(&mut self, p: i32, wanted: &[Resource]) {
        let mut requests: Vec<Resource> = wanted.to_vec();
        if requests.is_empty() {
            return;
        }
        let mut all = self.area(self.cap(p), 1);
        self.shuffle(&mut all);
        let mut cands: Vec<i32> = Vec::with_capacity(all.len());
        for i in all {
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
        let mut order: Vec<i32> = (0..self.total).collect();
        self.shuffle(&mut order);
        let corners = self.corners();
        let mut placed = 0;
        let mut water = 0;
        for i in order {
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

    fn draw(mut self) -> GeneratedMap {
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
        let starts = self.start_list();
        let total = self.total as usize;
        let mut ice = vec![false; total];
        let mut polar = vec![false; total];
        for p in 0..self.players {
            self.starting_resources(p, &starts[p as usize]);
            let key = self.key(p);
            for i in self.area(self.cap(p), 1) {
                self.clim_key[i as usize] = key;
            }
        }
        self.make_ocean();
        let mut flooded = vec![false; total];
        for p in 0..self.players {
            if !flag(&self.opts.flooded, p as usize) {
                continue;
            }
            let key = self.clim_key[self.cap(p) as usize];
            for i in 0..total {
                if self.clim_key[i] == key && matches!(self.terrain[i], Terrain::Field | Terrain::Forest) {
                    flooded[i] = true;
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
            let mut ring = vec![c];
            ring.extend(self.area(c, 1));
            for i in ring {
                let u = i as usize;
                if is_water_t(self.terrain[u]) {
                    ice[u] = true;
                } else if !self.imp[u].any() {
                    polar[u] = true;
                }
            }
        }
        self.output(&flooded, &ice, &polar)
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

    fn output(&self, flooded: &[bool], ice: &[bool], polar: &[bool]) -> GeneratedMap {
        let mut capitals = vec![false; self.total as usize];
        for &c in &self.capital {
            if c >= 0 {
                capitals[c as usize] = true;
            }
        }
        let mut tiles = Vec::with_capacity(self.total as usize);
        let mut villages = Vec::new();
        for i in 0..self.total {
            let u = i as usize;
            let village = self.imp[u] == Imp::City && !capitals[u];
            if village {
                villages.push(Coord::new(self.x(i), self.y(i)));
            }
            let mut t = Tile::new(self.terrain[u]);
            t.resource = self.resource[u];
            t.village = village;
            t.ruin = self.imp[u] == Imp::Ruin;
            t.lighthouse = self.imp[u] == Imp::Lighthouse;
            t.flooded = flooded[u];
            t.ice = ice[u];
            t.polar = polar[u];
            tiles.push(t);
        }
        let capitals = self.capital.iter().map(|&i| Coord::new(self.x(i), self.y(i))).collect();
        GeneratedMap { tiles, capitals, villages }
    }
}

/// The fairness measure (polybots-engine mapgen/select.rs): every tile goes to
/// the capital that reaches it most cheaply; the result is the richest turf's
/// score over the poorest's.
pub fn inequality(map: &GeneratedMap, n: i32) -> f64 {
    let total = (n * n) as usize;
    let seats = map.capitals.len();
    let mut starts = vec![false; total];
    let mut city_at = vec![false; total];
    for c in &map.capitals {
        starts[(c.y * n + c.x) as usize] = true;
        city_at[(c.y * n + c.x) as usize] = true;
    }
    for c in &map.villages {
        city_at[(c.y * n + c.x) as usize] = true;
    }
    let water: Vec<bool> = map.tiles.iter().map(|t| is_water_t(t.terrain) && !t.ice).collect();
    let mountain: Vec<bool> = map.tiles.iter().map(|t| t.terrain == Terrain::Mountain).collect();
    let nf = n as f64;
    let turf = |i: usize, cost: i32| -> f64 {
        let factor = 1f64.min(0f64.max((cost as f64 - 3.0) / (nf * 0.8 - 3.0)));
        let mut score;
        if city_at[i] {
            let base = -90.0 * factor + 100.0 + 0.1;
            score = if cost == 3 {
                base + 40.0
            } else if cost == 4 {
                base + 20.0
            } else {
                base
            };
        } else if map.tiles[i].ruin {
            let base = -3.0 * factor + 5.0 + 0.1;
            score = if cost < 5 { base + 5.0 } else { base };
        } else {
            score = 0.1;
        }
        if !water[i] {
            score += 1.5 - factor;
        }
        score
    };
    let mut scores = vec![0.0f64; seats];
    let mut visited = vec![false; total];
    // entry per tile: (cost, seat, order)
    let mut entry: Vec<Option<(i32, usize, i32)>> = vec![None; total];
    // binary heap of (cost, order, index)
    let mut heap: Vec<(i32, i32, usize)> = Vec::new();
    #[inline]
    fn less(a: &(i32, i32, usize), b: &(i32, i32, usize)) -> bool {
        a.0 < b.0 || (a.0 == b.0 && a.1 < b.1)
    }
    fn push(heap: &mut Vec<(i32, i32, usize)>, v: (i32, i32, usize)) {
        heap.push(v);
        let mut k = heap.len() - 1;
        while k > 0 {
            let p = (k - 1) >> 1;
            if !less(&heap[k], &heap[p]) {
                break;
            }
            heap.swap(k, p);
            k = p;
        }
    }
    fn pop(heap: &mut Vec<(i32, i32, usize)>) -> (i32, i32, usize) {
        let top = heap[0];
        let last = heap.pop().unwrap();
        if !heap.is_empty() {
            heap[0] = last;
            let mut k = 0;
            loop {
                let l = 2 * k + 1;
                let r = l + 1;
                let mut m = k;
                if l < heap.len() && less(&heap[l], &heap[m]) {
                    m = l;
                }
                if r < heap.len() && less(&heap[r], &heap[m]) {
                    m = r;
                }
                if m == k {
                    break;
                }
                heap.swap(k, m);
                k = m;
            }
        }
        top
    }
    let mut added: i32 = 0;
    let mut expand = |index: usize, seat: usize, cost: i32, visited: &Vec<bool>, entry: &mut Vec<Option<(i32, usize, i32)>>, heap: &mut Vec<(i32, i32, usize)>| {
        let cx = index as i32 % n;
        let cy = index as i32 / n;
        for x in cx - 1..=cx + 1 {
            for y in cy - 1..=cy + 1 {
                if x < 0 || y < 0 || x >= n || y >= n {
                    continue;
                }
                let j = (y * n + x) as usize;
                if visited[j] || j == index {
                    continue;
                }
                let step = if mountain[j] {
                    4
                } else if !water[j] {
                    1
                } else if water[index] {
                    4
                } else if !city_at[index] {
                    1000
                } else if starts[index] {
                    8
                } else {
                    16
                };
                let next = cost + step;
                if let Some(prev) = entry[j].as_mut() {
                    if next < prev.0 || (next == prev.0 && seat < prev.1) {
                        if next < prev.0 {
                            push(heap, (next, prev.2, j));
                        }
                        prev.0 = next;
                        prev.1 = seat;
                    }
                } else {
                    entry[j] = Some((next, seat, added));
                    push(heap, (next, added, j));
                    added += 1;
                }
            }
        }
    };
    for (seat, c) in map.capitals.iter().enumerate() {
        let i = (c.y * n + c.x) as usize;
        visited[i] = true;
        scores[seat] = turf(i, 0);
    }
    for (seat, c) in map.capitals.iter().enumerate() {
        expand((c.y * n + c.x) as usize, seat, 0, &visited, &mut entry, &mut heap);
    }
    while !heap.is_empty() {
        let (cost, _, index) = pop(&mut heap);
        let Some(e) = entry[index] else { continue };
        if e.0 != cost || visited[index] {
            continue;
        }
        entry[index] = None;
        visited[index] = true;
        scores[e.1] += turf(index, cost);
        expand(index, e.1, cost, &visited, &mut entry, &mut heap);
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
    let mut best: Option<GeneratedMap> = None;
    let mut best_score = f64::INFINITY;
    for _ in 0..candidates {
        let seed = (rng.next() * 2147483647.0).floor() as i64;
        let map = Gen::new(Rng::new(seed), n, players, settings, map_type, &eff_mods, opts).draw();
        if candidates == 1 {
            return map;
        }
        let score = inequality(&map, n);
        if score < settings.equality_limit {
            return map;
        }
        if score < best_score {
            best = Some(map);
            best_score = score;
        }
    }
    best.expect("mapgen: no candidate map")
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
