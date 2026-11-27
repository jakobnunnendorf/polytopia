//! unit-rl: experiment 24 (Jakob's track, issue #166). Every fighting action (move, attack, capture, recover, promote,
//! heal others, tribe combat abilities) of the learner
//! seat is chosen by ONE value function shared by all units, each unit evaluating it from its own local view;
//! every other action of that seat is played by the greedy champion (`full_best_of` on the non-unit actions).
//!
//! Choice: for each legal unit action a of unit u, Q(a) = r_u(a) + V(phi_u(s_a)), s_a the state after a.
//! Leaving the units as they are is worth V(phi_u(s)) for each unit; the action with the largest gain over that
//! is played, and the unit phase ends when no action gains (ties broken at random).
//!
//! Rewards (stars), credited per unit:
//!   * kill: the victim's cost, split among the learner's units that damaged it in the last 3 turns, by damage;
//!   * capture: the captured city's income x turns left; half to the capturer, half split by damage dealt within
//!     3 tiles of the city in the last 3 turns (all to the capturer when nobody fought there);
//!   * own city lost: minus its income x turns left, split evenly among the learner's units;
//!   * no death penalty: a dead unit's return ends.
//! Return: Monte Carlo per unit, discounted per turn by GAMMA.
//!
//! Distances are travel times in turns under the engine's own movement rules (`movement::reachable`, so water,
//! ports, mountains, forests, roads and zones of control count), with a no-route flag.
//!
//!   unit-rl train --run rl-unit-linear --model linear --iters 300 --games 64 --eval 16
//!   unit-rl train --run rl-unit-mlp --model mlp ...
//!   unit-rl measure --run rl-unit-linear --games 200        (or --run champion for the reference)
use polycore::actions::{apply_action, legal_actions};
use polycore::bot_full::{full_best_of, full_bot_step, full_weights, FullWeights};
use polycore::combat::{compute_damage_rounded, defence_bonus};
use polycore::data::{embark_as, unit_def};
use polycore::grid::{dist, idx, is_water, tile_at};
use polycore::movement::{can_see, movement_range, reachable};
use polycore::state::{self as st, NewGameOptions};
use polycore::types::*;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

type R<T> = Result<T, String>;

const NF: usize = 36;
const FEATURES: [&str; NF] = [
    "bias", "turnsLeft", "atk", "def", "range", "move", "hp", "hpShare", "cost", "onWater", "veteran",
    "squadN", "squadAtk", "squadHp", "squadRanged",
    "enemySeen", "enemyAtk", "enemyDef", "enemyHpShare", "enemyDist", "dmgDealt", "dmgTaken", "canKill",
    "dangerN", "dangerAtk", "defBonus",
    "tEnemyCity", "tVillage", "tEnemyUnit", "tThreatened", "noEnemyCity", "noVillage", "noEnemyUnit", "noThreatened",
    "onOwnCity", "onEnemyCity",
];
const TURNS: i32 = 30;
const GAMMA: f64 = 0.97;
const EVAL0: i64 = 6_000_000_000;
const TRAIN0: i64 = 7_000_000_000;
const MAX_MOVES: i32 = 30_000;
const NO_ROUTE: u8 = 255;
const TRAVEL_CAP: f64 = 8.0;
const HIDDEN: usize = 32;
/// the network learns returns divided by this (keeps its targets near 1)
const NET_SCALE: f64 = 10.0;

// ---------------------------------------------------------------- small helpers

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: usize) -> usize {
        ((self.next() * n as f64) as usize).min(n.saturating_sub(1))
    }
    fn normal(&mut self) -> f64 {
        let (a, b) = (self.next().max(1e-12), self.next());
        (-2.0 * a.ln()).sqrt() * (std::f64::consts::TAU * b).cos()
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn champion() -> R<FullWeights> {
    let f = repo_root().join("models/greedy-full-probe-perf/model.json");
    let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).map_err(|e| format!("{f:?}: {e}"))?)
        .map_err(|e| e.to_string())?;
    full_weights(&v["full"])
}

fn new_game(seed: i64) -> R<GameState> {
    let opts = NewGameOptions::from_json(&json!({"mapSize": 16, "players": 4, "mode": "perfection", "seed": seed,
        "humans": [0, 1, 2, 3], "mapType": "continents"}))?;
    st::create_game(&opts)
}

/// The fighting actions, chosen by the value function (decided with Jakob, 27 Nov). Actions that spend or earn
/// stars (Upgrade, Disband, Examine, HarvestStarfish) and all city, tech and diplomacy actions stay with the bot.
fn is_unit_action(a: &Action) -> bool {
    matches!(
        a,
        Action::Move { .. }
            | Action::Attack { .. }
            | Action::Capture { .. }
            | Action::Recover { .. }
            | Action::Promote { .. }
            | Action::HealOthers { .. }
            | Action::Infiltrate { .. }
            | Action::FreezeArea { .. }
            | Action::Swarm { .. }
            | Action::Explode { .. }
            | Action::BreakIce { .. }
            | Action::Drain { .. }
    )
}

fn actor(a: &Action) -> Id {
    match a {
        Action::Move { unit, .. }
        | Action::Attack { unit, .. }
        | Action::Capture { unit }
        | Action::Recover { unit }
        | Action::Promote { unit }
        | Action::HealOthers { unit }
        | Action::Infiltrate { unit, .. }
        | Action::FreezeArea { unit }
        | Action::Swarm { unit }
        | Action::Explode { unit }
        | Action::BreakIce { unit }
        | Action::Drain { unit, .. } => *unit,
        _ => -1,
    }
}

fn unit<'a>(s: &'a GameState, id: Id) -> Option<&'a Unit> {
    s.units.iter().find(|u| u.id == id)
}

fn land_type(u: &Unit) -> UnitType {
    u.carried.unwrap_or(u.ty)
}

fn turns_left(turn: i32) -> f64 {
    (TURNS - turn).max(1) as f64
}

fn explored(s: &GameState, p: i32, x: i32, y: i32) -> bool {
    s.players[p as usize].explored[idx(s.map_size, x, y)] == 1
}

// ---------------------------------------------------------------- travel times

/// Travel times in turns to four target sets, per land unit type, from the state at the start of the learner's turn.
struct Travel {
    snap: GameState,
    p: i32,
    fields: HashMap<UnitType, [Vec<u8>; 4]>,
}

impl Travel {
    fn new(s: &GameState, p: i32) -> Travel {
        let mut snap = s.clone();
        snap.log.clear();
        Travel { snap, p, fields: HashMap::new() }
    }

    fn get(&mut self, u: &Unit) -> &[Vec<u8>; 4] {
        let key = land_type(u);
        if !self.fields.contains_key(&key) {
            let f = travel_fields(&self.snap, self.p, u);
            self.fields.insert(key, f);
        }
        &self.fields[&key]
    }
}

/// Target tiles: 0 next to or on an enemy city, 1 a village, 2 within the unit's range of a visible enemy unit,
/// 3 on or next to an own city with a visible enemy within 3 tiles.
fn targets(s: &GameState, p: i32, range: i32) -> [Vec<usize>; 4] {
    let n = s.map_size;
    let mut t: [Vec<usize>; 4] = Default::default();
    let near = |cx: i32, cy: i32, r: i32, out: &mut Vec<usize>| {
        for y in (cy - r).max(0)..=(cy + r).min(n - 1) {
            for x in (cx - r).max(0)..=(cx + r).min(n - 1) {
                out.push(idx(n, x, y));
            }
        }
    };
    let enemies: Vec<&Unit> = s.units.iter().filter(|e| e.owner != p && can_see(s, p, e)).collect();
    for c in &s.cities {
        if c.owner != p && explored(s, p, c.x, c.y) {
            near(c.x, c.y, 1, &mut t[0]);
        }
        if c.owner == p && enemies.iter().any(|e| dist(e.x, e.y, c.x, c.y) <= 3) {
            near(c.x, c.y, 1, &mut t[3]);
        }
    }
    for y in 0..n {
        for x in 0..n {
            if tile_at(s, x, y).village && explored(s, p, x, y) {
                t[1].push(idx(n, x, y));
            }
        }
    }
    for e in &enemies {
        near(e.x, e.y, range.max(1), &mut t[2]);
    }
    t
}

/// One-turn move graph of unit type `proto` (a copy placed on every tile, in the form it has there), then a
/// reverse breadth-first search from each target set: turns needed from every tile.
fn travel_fields(s: &GameState, p: i32, proto: &Unit) -> [Vec<u8>; 4] {
    let n = s.map_size;
    let nt = (n * n) as usize;
    let base = land_type(proto);
    let naval_only = unit_def(base).naval;
    let boat = if naval_only { Some(base) } else { embark_as(base) };
    let mut rev: Vec<Vec<u32>> = vec![Vec::new(); nt];
    for y in 0..n {
        for x in 0..n {
            let water = is_water(tile_at(s, x, y));
            let mut c = proto.clone();
            c.x = x;
            c.y = y;
            c.moved = false;
            c.attacked = false;
            c.done = false;
            c.can_move = true;
            c.can_attack = true;
            c.frozen = false;
            if water {
                match boat {
                    Some(b) if !naval_only => {
                        c.ty = b;
                        c.carried = Some(base);
                    }
                    Some(_) => {
                        c.ty = base;
                        c.carried = None;
                    }
                    None => continue,
                }
            } else {
                if naval_only {
                    continue;
                }
                c.ty = base;
                c.carried = None;
            }
            let from = idx(n, x, y) as u32;
            for m in reachable(s, &c) {
                rev[idx(n, m.x, m.y)].push(from);
            }
        }
    }
    let tg = targets(s, p, unit_def(base).range);
    let mut out: [Vec<u8>; 4] = Default::default();
    for k in 0..4 {
        let mut d = vec![NO_ROUTE; nt];
        let mut q = VecDeque::new();
        for &t in &tg[k] {
            if d[t] != 0 {
                d[t] = 0;
                q.push_back(t);
            }
        }
        while let Some(v) = q.pop_front() {
            for &w in &rev[v] {
                let w = w as usize;
                if d[w] == NO_ROUTE {
                    d[w] = d[v] + 1;
                    q.push_back(w);
                }
            }
        }
        out[k] = d;
    }
    out
}

// ---------------------------------------------------------------- features

fn features(s: &GameState, p: i32, uid: Id, tr: &mut Travel) -> Option<[f64; NF]> {
    let u = unit(s, uid)?;
    let d = unit_def(u.ty);
    let n = s.map_size;
    let mut f = [0.0; NF];
    f[0] = 1.0;
    f[1] = turns_left(s.turn) / TURNS as f64;
    f[2] = d.attack / 5.0;
    f[3] = d.defence / 5.0;
    f[4] = d.range as f64 / 3.0;
    f[5] = movement_range(s, u) as f64 / 3.0;
    f[6] = u.hp as f64 / 20.0;
    f[7] = u.hp as f64 / u.max_hp.max(1) as f64;
    f[8] = unit_def(land_type(u)).cost as f64 / 10.0;
    f[9] = is_water(tile_at(s, u.x, u.y)) as i32 as f64;
    f[10] = u.veteran as i32 as f64;
    let (mut sq_n, mut sq_atk, mut sq_hp, mut sq_r) = (0.0, 0.0, 0.0, 0.0);
    for o in s.units.iter().filter(|o| o.owner == p && o.id != uid && dist(o.x, o.y, u.x, u.y) <= 3) {
        let od = unit_def(o.ty);
        sq_n += 1.0;
        sq_atk += od.attack;
        sq_hp += o.hp as f64;
        if od.range >= 2 {
            sq_r += 1.0;
        }
    }
    f[11] = sq_n / 5.0;
    f[12] = sq_atk / 10.0;
    f[13] = sq_hp / 50.0;
    f[14] = sq_r / 3.0;
    let enemies: Vec<&Unit> = s.units.iter().filter(|e| e.owner != p && can_see(s, p, e)).collect();
    if let Some(e) = enemies.iter().min_by_key(|e| dist(e.x, e.y, u.x, u.y)) {
        let ed = unit_def(e.ty);
        let de = dist(e.x, e.y, u.x, u.y);
        let cr = compute_damage_rounded(s, u, e);
        f[15] = 1.0;
        f[16] = ed.attack / 5.0;
        f[17] = ed.defence / 5.0;
        f[18] = e.hp as f64 / e.max_hp.max(1) as f64;
        f[19] = (de as f64 / 8.0).min(1.0);
        f[20] = (cr.damage as f64 / e.hp.max(1) as f64).min(1.5);
        f[21] = (cr.retaliation as f64 / u.hp.max(1) as f64).min(1.5);
        f[22] = (de <= d.range && !u.attacked && cr.damage >= e.hp) as i32 as f64;
    } else {
        f[19] = 1.0;
    }
    let (mut dn, mut da) = (0.0, 0.0);
    for e in &enemies {
        let ed = unit_def(e.ty);
        if dist(e.x, e.y, u.x, u.y) <= ed.movement + ed.range {
            dn += 1.0;
            da += ed.attack;
        }
    }
    f[23] = dn / 5.0;
    f[24] = da / 10.0;
    f[25] = defence_bonus(s, u) / 4.0;
    let i = idx(n, u.x, u.y);
    let fields = tr.get(u);
    for k in 0..4 {
        let t = fields[k][i];
        if t == NO_ROUTE {
            f[26 + k] = 1.0;
            f[30 + k] = 1.0;
        } else {
            f[26 + k] = (t as f64).min(TRAVEL_CAP) / TRAVEL_CAP;
        }
    }
    if let Some(ci) = st::city_by_id(s, tile_at(s, u.x, u.y).city_id) {
        if s.cities[ci].owner == p {
            f[34] = 1.0;
        } else {
            f[35] = 1.0;
        }
    }
    Some(f)
}

// ---------------------------------------------------------------- model

#[derive(Clone)]
enum Model {
    Linear(Vec<f64>),
    Mlp(Mlp),
}

#[derive(Clone)]
struct Mlp {
    w1: Vec<f64>,
    b1: Vec<f64>,
    w2: Vec<f64>,
    b2: f64,
}

impl Mlp {
    fn new(seed: u64) -> Mlp {
        let mut r = Rng::new(seed);
        let sd = 1.0 / (NF as f64).sqrt();
        Mlp {
            w1: (0..HIDDEN * NF).map(|_| r.normal() * sd).collect(),
            b1: vec![0.0; HIDDEN],
            w2: (0..HIDDEN).map(|_| r.normal() * 0.1).collect(),
            b2: 0.0,
        }
    }
    fn hidden(&self, f: &[f64; NF]) -> [f64; HIDDEN] {
        let mut h = [0.0; HIDDEN];
        for j in 0..HIDDEN {
            let w = &self.w1[j * NF..(j + 1) * NF];
            let z: f64 = self.b1[j] + w.iter().zip(f.iter()).map(|(a, b)| a * b).sum::<f64>();
            h[j] = z.tanh();
        }
        h
    }
    fn out(&self, f: &[f64; NF]) -> f64 {
        let h = self.hidden(f);
        self.b2 + h.iter().zip(&self.w2).map(|(a, b)| a * b).sum::<f64>()
    }
}

impl Model {
    fn value(&self, f: &[f64; NF]) -> f64 {
        match self {
            Model::Linear(w) => w.iter().zip(f.iter()).map(|(a, b)| a * b).sum(),
            Model::Mlp(m) => m.out(f) * NET_SCALE,
        }
    }
    fn to_json(&self) -> Value {
        match self {
            Model::Linear(w) => json!({"model": "linear", "features": FEATURES.to_vec(), "w": w}),
            Model::Mlp(m) => json!({"model": "mlp", "features": FEATURES.to_vec(), "hidden": HIDDEN, "scale": NET_SCALE,
                "w1": m.w1, "b1": m.b1, "w2": m.w2, "b2": m.b2}),
        }
    }
    fn from_json(v: &Value) -> R<Model> {
        let vec = |k: &str| -> Vec<f64> { v[k].as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default() };
        match v["model"].as_str() {
            Some("linear") => Ok(Model::Linear(vec("w"))),
            Some("mlp") => Ok(Model::Mlp(Mlp { w1: vec("w1"), b1: vec("b1"), w2: vec("w2"), b2: v["b2"].as_f64().unwrap_or(0.0) })),
            _ => Err("unknown model".into()),
        }
    }
}

/// Linear: decayed least squares. Net: Adam on a replay buffer.
enum Learner {
    Linear { a: Vec<f64>, b: Vec<f64> },
    Mlp { m: Vec<f64>, v: Vec<f64>, t: u64, buf: VecDeque<([f64; NF], f64)>, rng: Rng },
}

const DECAY: f64 = 0.98;
const RIDGE: f64 = 1.0;
const BUF: usize = 400_000;
const STEPS: usize = 1500;
const BATCH: usize = 128;
const LR: f64 = 1e-3;

fn solve(mut a: Vec<f64>, mut b: Vec<f64>, n: usize) -> Vec<f64> {
    for c in 0..n {
        let piv = (c..n).max_by(|&i, &j| a[i * n + c].abs().partial_cmp(&a[j * n + c].abs()).unwrap()).unwrap();
        if a[piv * n + c].abs() < 1e-12 {
            continue;
        }
        if piv != c {
            for k in 0..n {
                a.swap(c * n + k, piv * n + k);
            }
            b.swap(c, piv);
        }
        for r in 0..n {
            if r != c {
                let fac = a[r * n + c] / a[c * n + c];
                if fac != 0.0 {
                    for k in c..n {
                        a[r * n + k] -= fac * a[c * n + k];
                    }
                    b[r] -= fac * b[c];
                }
            }
        }
    }
    (0..n).map(|i| if a[i * n + i].abs() < 1e-12 { 0.0 } else { b[i] / a[i * n + i] }).collect()
}

fn n_params() -> usize {
    HIDDEN * NF + HIDDEN + HIDDEN + 1
}

impl Learner {
    fn new(kind: &str) -> Learner {
        if kind == "mlp" {
            Learner::Mlp { m: vec![0.0; n_params()], v: vec![0.0; n_params()], t: 0, buf: VecDeque::new(), rng: Rng::new(17) }
        } else {
            Learner::Linear { a: vec![0.0; NF * NF], b: vec![0.0; NF] }
        }
    }

    fn update(&mut self, model: &mut Model, samples: &[([f64; NF], f64)]) {
        match (self, model) {
            (Learner::Linear { a, b }, Model::Linear(w)) => {
                a.iter_mut().for_each(|x| *x *= DECAY);
                b.iter_mut().for_each(|x| *x *= DECAY);
                for (f, g) in samples {
                    for i in 0..NF {
                        b[i] += f[i] * g;
                        for j in 0..NF {
                            a[i * NF + j] += f[i] * f[j];
                        }
                    }
                }
                let mut ar = a.clone();
                for i in 1..NF {
                    ar[i * NF + i] += RIDGE;
                }
                *w = solve(ar, b.clone(), NF);
            }
            (Learner::Mlp { m, v, t, buf, rng }, Model::Mlp(net)) => {
                for s in samples {
                    buf.push_back(*s);
                }
                while buf.len() > BUF {
                    buf.pop_front();
                }
                if buf.is_empty() {
                    return;
                }
                let np = n_params();
                let mut g = vec![0.0; np];
                for _ in 0..STEPS {
                    g.iter_mut().for_each(|x| *x = 0.0);
                    for _ in 0..BATCH {
                        let (f, y) = &buf[rng.below(buf.len())];
                        let h = net.hidden(f);
                        let out = net.b2 + h.iter().zip(&net.w2).map(|(a, b)| a * b).sum::<f64>();
                        let e = (out - y / NET_SCALE) / BATCH as f64;
                        let o_w2 = HIDDEN * NF + HIDDEN;
                        for j in 0..HIDDEN {
                            g[o_w2 + j] += e * h[j];
                            let dz = e * net.w2[j] * (1.0 - h[j] * h[j]);
                            g[HIDDEN * NF + j] += dz;
                            for i in 0..NF {
                                g[j * NF + i] += dz * f[i];
                            }
                        }
                        g[np - 1] += e;
                    }
                    *t += 1;
                    let (b1, b2, eps) = (0.9f64, 0.999f64, 1e-8);
                    let c1 = 1.0 - b1.powi(*t as i32);
                    let c2 = 1.0 - b2.powi(*t as i32);
                    for k in 0..np {
                        m[k] = b1 * m[k] + (1.0 - b1) * g[k];
                        v[k] = b2 * v[k] + (1.0 - b2) * g[k] * g[k];
                        let step = LR * (m[k] / c1) / ((v[k] / c2).sqrt() + eps);
                        if k < HIDDEN * NF {
                            net.w1[k] -= step;
                        } else if k < HIDDEN * NF + HIDDEN {
                            net.b1[k - HIDDEN * NF] -= step;
                        } else if k < np - 1 {
                            net.w2[k - HIDDEN * NF - HIDDEN] -= step;
                        } else {
                            net.b2 -= step;
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------- credit

#[derive(Clone)]
struct Hit {
    by: Id,
    dmg: i32,
    turn: i32,
    x: i32,
    y: i32,
}

/// target unit id -> the learner's hits on it
type HitLog = HashMap<Id, Vec<Hit>>;

/// Reward credits of action `a` (state before -> after): (unit, stars), and the new hit to log.
fn credit(before: &GameState, after: &GameState, a: &Action, log: &HitLog) -> (Vec<(Id, f64)>, Option<(Id, Hit)>, u8) {
    let mut out = Vec::new();
    match *a {
        Action::Attack { unit: by, target } => {
            let Some(tb) = unit(before, target) else { return (out, None, 0) };
            let ta = unit(after, target);
            let dmg = tb.hp - ta.map(|t| t.hp).unwrap_or(0);
            let hit = Hit { by, dmg: dmg.max(0), turn: before.turn, x: tb.x, y: tb.y };
            let mut kill = 0;
            if ta.is_none() {
                kill = 1;
                let total = unit_def(land_type(tb)).cost as f64;
                let mut share: HashMap<Id, f64> = HashMap::new();
                for h in log.get(&target).into_iter().flatten().filter(|h| h.turn >= before.turn - 2).chain(std::iter::once(&hit)) {
                    *share.entry(h.by).or_default() += h.dmg.max(0) as f64;
                }
                let sum: f64 = share.values().sum();
                if sum > 0.0 {
                    out.extend(share.into_iter().map(|(id, d)| (id, total * d / sum)));
                } else {
                    out.push((by, total));
                }
            }
            (out, Some((target, hit)), kill)
        }
        Action::Capture { unit: by } => {
            let Some(u) = unit(before, by) else { return (out, None, 0) };
            let Some(ci) = st::city_by_id(after, tile_at(after, u.x, u.y).city_id) else { return (out, None, 0) };
            let total = st::city_income(after, &after.cities[ci]) as f64 * turns_left(before.turn);
            let village = tile_at(before, u.x, u.y).village;
            let mut share: HashMap<Id, f64> = HashMap::new();
            for h in log.values().flatten() {
                if h.turn >= before.turn - 2 && dist(h.x, h.y, u.x, u.y) <= 3 {
                    *share.entry(h.by).or_default() += h.dmg.max(0) as f64;
                }
            }
            let sum: f64 = share.values().sum();
            if sum > 0.0 {
                out.push((by, total * 0.5));
                out.extend(share.into_iter().map(|(id, d)| (id, total * 0.5 * d / sum)));
            } else {
                out.push((by, total));
            }
            (out, None, if village { 3 } else { 2 })
        }
        _ => (out, None, 0),
    }
}

// ---------------------------------------------------------------- one game

/// Sample: features, turn, action kind that led to it (END_SAMPLE = end of turn), unit type.
enum Ev {
    Sample([f64; NF], i32, u8, u8),
    Reward(f64, i32),
}

const END_SAMPLE: u8 = NK as u8;
/// reward sources, for the analysis
const SOURCES: [&str; 4] = ["kill", "capture city", "capture village", "own city lost"];

/// One recorded sample for the analysis: features, return, action kind (END_SAMPLE = end of turn), unit type, turn.
#[derive(Clone)]
struct Rec {
    f: [f64; NF],
    g: f64,
    kind: u8,
    ty: u8,
    turn: i32,
}

#[derive(Default)]
struct GameOut {
    samples: Vec<([f64; NF], f64)>,
    recs: Vec<Rec>,
    /// (unit type, source, stars)
    rewards: Vec<(u8, u8, f64)>,
    /// (attacker type, victim type, killed)
    attacks: Vec<(u8, u8, bool)>,
    type_names: HashMap<u8, String>,
    /// example decisions, for the analysis page
    examples: Vec<Value>,
    score: f64,
    champs: f64,
    levels: f64,
    kills: f64,
    losses: f64,
    cap_city: f64,
    cap_village: f64,
    turns: f64,
    /// [move, attack, capture, pass] x [available, chosen]
    kinds: [[u64; 2]; NK],
    decisions: u64,
    decided: u64,
}

const NK: usize = 6;
const KIND_NAMES: [&str; NK] = ["move", "attack", "capture", "care", "ability", "pass"];
const PASS: usize = NK - 1;

/// move, attack, capture, care (recover, promote, heal others), ability (tribe combat abilities)
fn kind_ix(a: &Action) -> usize {
    match a {
        Action::Move { .. } => 0,
        Action::Attack { .. } => 1,
        Action::Capture { .. } => 2,
        Action::Recover { .. } | Action::Promote { .. } | Action::HealOthers { .. } => 3,
        _ => 4,
    }
}

fn bot_phase(s: &mut GameState, w: &FullWeights, moves: &mut i32) -> R<()> {
    while !s.over && *moves < MAX_MOVES {
        let acts: Vec<Action> = legal_actions(s).into_iter().filter(|a| !is_unit_action(a)).collect();
        if acts.is_empty() {
            break;
        }
        let a = full_best_of(s, &acts, w);
        if a == Action::EndTurn {
            break;
        }
        apply_action(s, &a)?;
        *moves += 1;
    }
    Ok(())
}

fn play(seed: i64, model: Option<&Model>, champ: &FullWeights, eps: f64, collect: bool, ex: bool) -> R<GameOut> {
    let me = (seed % 4) as i32;
    let mut s = new_game(seed)?;
    let mut rng = Rng::new(seed as u64 ^ 0xA5A5);
    let mut out = GameOut::default();
    let mut ev: HashMap<Id, Vec<Ev>> = HashMap::new();
    let mut log: HitLog = HashMap::new();
    let mut owned: HashSet<Id> = HashSet::new();
    let mut types: HashMap<Id, u8> = HashMap::new();
    let mut moves = 0;
    while !s.over && moves < MAX_MOVES {
        s.log.clear();
        let Some(model) = model.filter(|_| s.current == me) else {
            let a = full_bot_step(&s, champ);
            apply_action(&mut s, &a)?;
            moves += 1;
            continue;
        };
        // ---- the learner's turn
        let now: HashSet<Id> = s.cities.iter().filter(|c| c.owner == me).map(|c| c.id).collect();
        let mine: Vec<Id> = s.units.iter().filter(|u| u.owner == me).map(|u| u.id).collect();
        for u in s.units.iter().filter(|u| u.owner == me) {
            let t = land_type(u);
            types.insert(u.id, t as u8);
            out.type_names.entry(t as u8).or_insert_with(|| format!("{t:?}"));
        }
        for lost in owned.difference(&now) {
            if let Some(c) = s.cities.iter().find(|c| c.id == *lost) {
                let pen = st::city_income(&s, c) as f64 * turns_left(s.turn);
                for id in &mine {
                    ev.entry(*id).or_default().push(Ev::Reward(-pen / mine.len() as f64, s.turn));
                    out.rewards.push((types[id], 3, -pen / mine.len() as f64));
                }
            }
        }
        bot_phase(&mut s, champ, &mut moves)?;
        let mut tr = Travel::new(&s, me);
        let mut steps = 0;
        while !s.over && s.current == me && steps < 400 && moves < MAX_MOVES {
            steps += 1;
            s.log.clear();
            let acts: Vec<Action> = legal_actions(&s).into_iter().filter(is_unit_action).collect();
            if acts.is_empty() {
                break;
            }
            let mut base: HashMap<Id, f64> = HashMap::new();
            // candidates: (gain, action, after, credits, hit, event kind)
            let mut cands = Vec::with_capacity(acts.len());
            for a in &acts {
                let uid = actor(a);
                if !base.contains_key(&uid) {
                    let v = features(&s, me, uid, &mut tr).map(|f| model.value(&f)).unwrap_or(0.0);
                    base.insert(uid, v);
                }
                let mut t = s.clone();
                if apply_action(&mut t, a).is_err() {
                    continue;
                }
                let (cr, hit, kind) = credit(&s, &t, a, &log);
                let r: f64 = cr.iter().filter(|(id, _)| *id == uid).map(|(_, r)| r).sum();
                let v = features(&t, me, uid, &mut tr).map(|f| model.value(&f)).unwrap_or(0.0);
                cands.push((r + v - base[&uid], *a, t, cr, hit, kind));
            }
            for c in &cands {
                out.kinds[kind_ix(&c.1)][0] += 1;
            }
            out.kinds[PASS][0] += 1;
            out.decisions += 1;
            // pick: epsilon-random among actions and pass, else the largest gain (pass = 0), ties at random
            let pick: Option<usize> = if eps > 0.0 && rng.next() < eps {
                let k = rng.below(cands.len() + 1);
                (k < cands.len()).then_some(k)
            } else {
                let best = cands.iter().map(|c| c.0).fold(0.0f64, f64::max);
                let mut ties: Vec<Option<usize>> = cands.iter().enumerate().filter(|(_, c)| c.0 >= best - 1e-9).map(|(i, _)| Some(i)).collect();
                if best <= 1e-9 {
                    ties.push(None);
                }
                if ties.len() == 1 {
                    out.decided += 1;
                }
                ties[rng.below(ties.len())]
            };
            if ex && out.examples.len() < 12 && !cands.is_empty() {
                let interesting = cands.iter().any(|c| kind_ix(&c.1) != 0) || pick.is_none() || s.turn % 5 == 0;
                if interesting {
                    out.examples.push(example(&s, me, &cands, pick, model, &mut tr));
                }
            }
            let Some(k) = pick else {
                out.kinds[PASS][1] += 1;
                break;
            };
            let (_, a, t, cr, hit, kind) = cands.swap_remove(k);
            out.kinds[kind_ix(&a)][1] += 1;
            if let Action::Attack { unit: by, target } = a {
                if let (Some(au), Some(vu)) = (unit(&s, by), unit(&s, target)) {
                    let (at, vt) = (land_type(au), land_type(vu));
                    out.type_names.entry(vt as u8).or_insert_with(|| format!("{vt:?}"));
                    out.attacks.push((at as u8, vt as u8, kind == 1));
                }
            }
            s = t;
            moves += 1;
            for u in s.units.iter().filter(|u| u.owner == me) {
                let t = land_type(u);
                types.entry(u.id).or_insert(t as u8);
                out.type_names.entry(t as u8).or_insert_with(|| format!("{t:?}"));
            }
            for (id, r) in cr {
                ev.entry(id).or_default().push(Ev::Reward(r, s.turn));
                if let (Some(&ty), 1..=3) = (types.get(&id), kind) {
                    out.rewards.push((ty, kind - 1, r));
                }
            }
            if let Some((target, h)) = hit {
                log.entry(target).or_default().push(h);
            }
            match kind {
                1 => out.kills += 1.0,
                2 => out.cap_city += 1.0,
                3 => out.cap_village += 1.0,
                _ => {}
            }
            let uid = actor(&a);
            if collect {
                if let Some(f) = features(&s, me, uid, &mut tr) {
                    let ty = types.get(&uid).copied().unwrap_or(0);
                    ev.entry(uid).or_default().push(Ev::Sample(f, s.turn, kind_ix(&a) as u8, ty));
                }
            }
        }
        bot_phase(&mut s, champ, &mut moves)?;
        if s.over || s.current != me {
            continue;
        }
        if collect {
            let ids: Vec<Id> = s.units.iter().filter(|u| u.owner == me).map(|u| u.id).collect();
            for id in ids {
                if let Some(f) = features(&s, me, id, &mut tr) {
                    let ty = types.get(&id).copied().unwrap_or(0);
                    ev.entry(id).or_default().push(Ev::Sample(f, s.turn, END_SAMPLE, ty));
                }
            }
        }
        owned = s.cities.iter().filter(|c| c.owner == me).map(|c| c.id).collect();
        apply_action(&mut s, &Action::EndTurn)?;
        moves += 1;
    }
    // per-unit Monte Carlo returns
    if collect {
        for evs in ev.values() {
            let mut g = 0.0;
            let mut cur: Option<i32> = None;
            for e in evs.iter().rev() {
                let t = match e {
                    Ev::Sample(_, t, _, _) | Ev::Reward(_, t) => *t,
                };
                if let Some(c) = cur {
                    g *= GAMMA.powi(c - t);
                }
                cur = Some(t);
                match e {
                    Ev::Reward(r, _) => g += r,
                    Ev::Sample(f, t, kind, ty) => {
                        out.samples.push((*f, g));
                        out.recs.push(Rec { f: *f, g, kind: *kind, ty: *ty, turn: *t });
                    }
                }
            }
        }
    }
    let sc: Vec<f64> = (0..4).map(|p| st::score_of(&s, p) as f64).collect();
    out.score = sc[me as usize];
    out.champs = (0..4).filter(|&p| p != me as usize).map(|p| sc[p]).sum::<f64>() / 3.0;
    out.levels = s.cities.iter().filter(|c| c.owner == me).map(|c| c.level as f64).sum();
    if model.is_none() {
        out.kills = s.players[me as usize].kills as f64;
    }
    out.losses = s.players[me as usize].losses as f64;
    out.turns = s.turn as f64;
    Ok(out)
}

/// One decision for the analysis page: the acting units' situation, the best candidates (by gain) with their reward,
/// V before and after, and the features that moved V most (the change of each feature's contribution between
/// standing still and the afterstate: w_j * delta f_j for the linear model, the change in V when the feature alone is
/// set back to its value before, for the net).
fn example(s: &GameState, me: i32, cands: &[(f64, Action, GameState, Vec<(Id, f64)>, Option<(Id, Hit)>, u8)], pick: Option<usize>, model: &Model, tr: &mut Travel) -> Value {
    let mut order: Vec<usize> = (0..cands.len()).collect();
    order.sort_by(|&a, &b| cands[b].0.partial_cmp(&cands[a].0).unwrap());
    if let Some(k) = pick {
        if !order[..order.len().min(6)].contains(&k) {
            order.insert(0, k);
        }
    }
    let rows: Vec<Value> = order
        .iter()
        .take(7)
        .map(|&i| {
            let (gain, a, t, cr, _, _) = &cands[i];
            let uid = actor(a);
            let u = unit(s, uid);
            let fb = features(s, me, uid, tr);
            let fa = features(t, me, uid, tr);
            let vb = fb.map(|f| model.value(&f)).unwrap_or(0.0);
            let va = fa.map(|f| model.value(&f)).unwrap_or(0.0);
            let r: f64 = cr.iter().filter(|(id, _)| *id == uid).map(|(_, r)| r).sum();
            let mut why: Vec<(usize, f64, f64, f64)> = Vec::new();
            if let (Some(fb), Some(fa)) = (fb, fa) {
                for j in 1..NF {
                    if (fa[j] - fb[j]).abs() < 1e-9 {
                        continue;
                    }
                    let c = match model {
                        Model::Linear(w) => w[j] * (fa[j] - fb[j]),
                        Model::Mlp(_) => {
                            let mut f = fa;
                            f[j] = fb[j];
                            va - model.value(&f)
                        }
                    };
                    why.push((j, fb[j], fa[j], c));
                }
            }
            why.sort_by(|a, b| b.3.abs().partial_cmp(&a.3.abs()).unwrap());
            let what = match a {
                Action::Move { to, .. } => format!("move to ({},{})", to.x, to.y),
                Action::Attack { target, .. } => format!("attack {}", unit(s, *target).map(|v| format!("{:?} ({} hp)", land_type(v), v.hp)).unwrap_or_default()),
                other => format!("{:?}", other).split_whitespace().next().unwrap_or("").to_lowercase(),
            };
            json!({
                "unit": u.map(|u| format!("{:?} #{} at ({},{}), {} hp", land_type(u), u.id, u.x, u.y, u.hp)).unwrap_or_default(),
                "action": what, "kind": KIND_NAMES[kind_ix(a)], "chosen": pick == Some(i),
                "reward": r, "vBefore": vb, "vAfter": va, "gain": gain,
                "why": why.iter().take(6).map(|(j, b, a, c)| json!({"feature": FEATURES[*j], "before": b, "after": a, "contribution": c})).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!({"turn": s.turn, "candidates": cands.len(), "passed": pick.is_none(), "rows": rows})
}

// ---------------------------------------------------------------- statistics and output

fn stats(xs: &[f64]) -> Value {
    let n = xs.len().max(1) as f64;
    let mean = xs.iter().sum::<f64>() / n;
    let sd = (xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0)).sqrt();
    let ci = 1.96 * sd / n.sqrt();
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |p: f64| v.get(((v.len() as f64 - 1.0) * p).round() as usize).copied().unwrap_or(0.0);
    json!({"mean": mean, "lo": mean - ci, "hi": mean + ci, "p10": q(0.1), "p90": q(0.9)})
}

fn mean(xs: impl Iterator<Item = f64>) -> f64 {
    let v: Vec<f64> = xs.collect();
    v.iter().sum::<f64>() / v.len().max(1) as f64
}

fn run_games(pool: &rayon::ThreadPool, seeds: &[i64], model: Option<&Model>, champ: &FullWeights, eps: f64, collect: bool) -> R<Vec<GameOut>> {
    pool.install(|| seeds.par_iter().map(|&sd| play(sd, model, champ, eps, collect, false)).collect())
}

fn summary(gs: &[GameOut]) -> Value {
    let d: Vec<f64> = gs.iter().map(|g| g.score - g.champs).collect();
    json!({
        "score": stats(&gs.iter().map(|g| g.score).collect::<Vec<_>>()),
        "champs": stats(&gs.iter().map(|g| g.champs).collect::<Vec<_>>()),
        "diff": stats(&d),
        "levels": stats(&gs.iter().map(|g| g.levels).collect::<Vec<_>>()),
        "beatsAvg": mean(gs.iter().map(|g| (g.score > g.champs) as i32 as f64)),
        "kills": mean(gs.iter().map(|g| g.kills)),
        "losses": mean(gs.iter().map(|g| g.losses)),
        "capturesCity": mean(gs.iter().map(|g| g.cap_city)),
        "capturesVillage": mean(gs.iter().map(|g| g.cap_village)),
        "turns": mean(gs.iter().map(|g| g.turns)),
    })
}

fn args() -> (String, HashMap<String, String>) {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let mut m = HashMap::new();
    let mut i = 1;
    while i < a.len() {
        m.insert(a[i].trim_start_matches("--").to_string(), a.get(i + 1).cloned().unwrap_or_default());
        i += 2;
    }
    (a.first().cloned().unwrap_or_default(), m)
}

fn num<T: std::str::FromStr>(m: &HashMap<String, String>, k: &str, d: T) -> T {
    m.get(k).and_then(|v| v.parse().ok()).unwrap_or(d)
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> R<()> {
    let (cmd, m) = args();
    let champ = champion()?;
    let threads = num(&m, "threads", 10usize);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().map_err(|e| e.to_string())?;
    let run = m.get("run").cloned().unwrap_or_else(|| "rl-unit-linear".into());
    let dir = repo_root().join("models").join(&run);
    match cmd.as_str() {
        "train" => train(&m, &pool, &champ, &run, &dir),
        "analyse" => analyse(&pool, &champ, &run, &dir, num(&m, "games", 64i64)),
        "measure" => {
            let games = num(&m, "games", 200i64);
            let seeds: Vec<i64> = (0..games).map(|g| EVAL0 + g).collect();
            let model = if run == "champion" {
                None
            } else {
                let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("weights.json")).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                Some(Model::from_json(&v)?)
            };
            let t0 = Instant::now();
            let gs = run_games(&pool, &seeds, model.as_ref(), &champ, 0.0, false)?;
            let mut s = summary(&gs);
            s["run"] = json!(run);
            s["games"] = json!(games);
            s["seconds"] = json!(t0.elapsed().as_secs_f64());
            println!("{}", serde_json::to_string_pretty(&s).unwrap());
            Ok(())
        }
        _ => Err("usage: unit-rl train|measure --run <id> [--model linear|mlp] [--iters N] [--games N] [--eval N]".into()),
    }
}

fn train(m: &HashMap<String, String>, pool: &rayon::ThreadPool, champ: &FullWeights, run: &str, dir: &PathBuf) -> R<()> {
    let kind = m.get("model").cloned().unwrap_or_else(|| "linear".into());
    let iters = num(&m, "iters", 300i64);
    let games = num(&m, "games", 64i64);
    let n_eval = num(&m, "eval", 16i64);
    let eps0 = num(&m, "eps", 0.3f64);
    let eps_min = num(&m, "eps-min", 0.05f64);
    let eps_iters = num(&m, "eps-iters", 100f64);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut f = std::fs::File::create(dir.join("rl.jsonl")).map_err(|e| e.to_string())?;
    let mut line = |v: Value| -> R<()> {
        writeln!(f, "{}", v).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())
    };
    let started = Instant::now();
    line(json!({"type": "meta", "run": run, "title": format!("Experiment 24: unit value function ({kind})"),
        "state": FEATURES.to_vec(), "method": format!("per-unit Monte Carlo, {}", if kind == "mlp" { "neural net (1 hidden layer, 32 tanh, Adam)" } else { "linear least squares, decay 0.98" }),
        "gamma": GAMMA, "tieBreak": "random", "iterations": iters, "gamesPerIteration": games,
        "setup": format!("Perfection 16x16 continents, 4 players all human; learner seat rotated (seed % 4); units by V, economy by greedy-full-probe-perf; opponents 3x greedy-full-probe-perf; epsilon {eps0} -> {eps_min} over {eps_iters} iterations; evaluation {n_eval} greedy games on seeds {EVAL0}.."),
        "startedAt": now_iso()}))?;
    let eval_seeds: Vec<i64> = (0..n_eval).map(|g| EVAL0 + g).collect();
    let base = run_games(pool, &eval_seeds, None, champ, 0.0, false)?;
    let bs = summary(&base);
    line(json!({"type": "baseline", "label": "champion in the learner seat", "score": bs["score"], "levels": bs["levels"], "detail": bs}))?;
    eprintln!("baseline (champion in seat): score {:.0}  diff {:+.0}  kills {:.2}", bs["score"]["mean"].as_f64().unwrap_or(0.0), bs["diff"]["mean"].as_f64().unwrap_or(0.0), bs["kills"].as_f64().unwrap_or(0.0));
    let mut model = if kind == "mlp" { Model::Mlp(Mlp::new(5)) } else { Model::Linear(vec![0.0; NF]) };
    let mut learner = Learner::new(&kind);
    let mut total = 0i64;
    for it in 1..=iters {
        let eps = (eps0 - (eps0 - eps_min) * (it - 1) as f64 / eps_iters).max(eps_min);
        let seeds: Vec<i64> = (0..games).map(|g| TRAIN0 + (it - 1) * games + g).collect();
        let gs = run_games(pool, &seeds, Some(&model), champ, eps, true)?;
        total += games;
        let samples: Vec<([f64; NF], f64)> = gs.iter().flat_map(|g| g.samples.iter().copied()).collect();
        let (mut ae, mut se) = (0.0, 0.0);
        for (x, g) in &samples {
            let e = model.value(x) - g;
            ae += e.abs();
            se += e * e;
        }
        let ns = samples.len().max(1) as f64;
        learner.update(&mut model, &samples);
        let ev = run_games(pool, &eval_seeds, Some(&model), champ, 0.0, false)?;
        let es = summary(&ev);
        let train = summary(&gs);
        let mut kinds = serde_json::Map::new();
        for k in 0..NK {
            kinds.insert(KIND_NAMES[k].into(), json!({"avail": gs.iter().map(|g| g.kinds[k][0]).sum::<u64>(), "chosen": gs.iter().map(|g| g.kinds[k][1]).sum::<u64>()}));
        }
        let dec = gs.iter().map(|g| g.decided).sum::<u64>() as f64 / gs.iter().map(|g| g.decisions).sum::<u64>().max(1) as f64;
        let w = match &model {
            Model::Linear(w) => json!(FEATURES.iter().zip(w).map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<_, _>>()),
            Model::Mlp(_) => json!({}),
        };
        line(json!({"type": "iter", "i": it, "seconds": started.elapsed().as_secs_f64(), "games": total,
            "score": es["score"], "levels": es["levels"], "turns": es["turns"], "V": {}, "visits": {}, "W": w,
            "err": {"mae": ae / ns, "rmse": (se / ns).sqrt()}, "decided": dec, "kinds": kinds, "epsilon": eps,
            "samples": samples.len(), "eval": es, "train": train}))?;
        std::fs::write(dir.join("weights.json"), serde_json::to_string_pretty(&model.to_json()).unwrap()).map_err(|e| e.to_string())?;
        eprintln!("it {it:4}  {:6.0}s  eps {eps:.2}  samples {:6}  rmse {:6.2}  eval score {:5.0} diff {:+5.0}  kills {:.2} caps {:.2}/{:.2} lost {:.2}",
            started.elapsed().as_secs_f64(), samples.len(), (se / ns).sqrt(), es["score"]["mean"].as_f64().unwrap_or(0.0),
            es["diff"]["mean"].as_f64().unwrap_or(0.0), es["kills"].as_f64().unwrap_or(0.0), es["capturesCity"].as_f64().unwrap_or(0.0),
            es["capturesVillage"].as_f64().unwrap_or(0.0), es["losses"].as_f64().unwrap_or(0.0));
    }
    line(json!({"type": "end", "at": now_iso(), "note": format!("{iters} iterations")}))?;
    Ok(())
}

fn now_iso() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, secs) = (t.div_euclid(86_400), t.rem_euclid(86_400));
    // civil date from days since 1970-01-01 (Howard Hinnant's algorithm)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + (mo <= 2) as i64;
    format!("{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z", secs / 3600, secs % 3600 / 60, secs % 60)
}

// ---------------------------------------------------------------- analysis (the analysis dashboard reads it)

/// Feature pairs whose 2-D slice of the learned V is drawn (all other features at their median).
const SLICES: [(&str, &str); 6] = [
    ("hpShare", "dangerAtk"),
    ("dmgDealt", "dmgTaken"),
    ("squadN", "enemyDist"),
    ("tEnemyCity", "turnsLeft"),
    ("tVillage", "turnsLeft"),
    ("atk", "squadRanged"),
];
const BINS: usize = 8;
const GRID: usize = 9;

fn fx(name: &str) -> usize {
    FEATURES.iter().position(|f| *f == name).unwrap_or(0)
}

fn quantile(v: &mut Vec<f64>, q: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[((v.len() as f64 - 1.0) * q).round() as usize]
}

/// Plays `games` greedy evaluation games with the run's current weights and writes models/<run>/analysis.json
/// (plus one line in analysis-history.jsonl): what the agent values, does and earns.
fn analyse(pool: &rayon::ThreadPool, champ: &FullWeights, run: &str, dir: &PathBuf, games: i64) -> R<()> {
    let t0 = Instant::now();
    let wtxt = std::fs::read_to_string(dir.join("weights.json")).map_err(|e| e.to_string())?;
    let model = Model::from_json(&serde_json::from_str(&wtxt).map_err(|e| e.to_string())?)?;
    let iteration = std::fs::read_to_string(dir.join("rl.jsonl"))
        .map(|t| t.lines().filter(|l| l.contains("\"type\":\"iter\"")).count())
        .unwrap_or(0);
    let seeds: Vec<i64> = (0..games).map(|g| EVAL0 + g).collect();
    let gs: Vec<GameOut> = pool.install(|| seeds.par_iter().enumerate().map(|(i, &sd)| play(sd, Some(&model), champ, 0.0, true, i < 4)).collect::<R<Vec<_>>>())?;
    let examples: Vec<Value> = gs.iter().take(4).enumerate().flat_map(|(g, o)| o.examples.iter().map(move |e| { let mut e = e.clone(); e["game"] = json!(g + 1); e })).collect();
    let recs: Vec<Rec> = gs.iter().flat_map(|g| g.recs.iter().cloned()).collect();
    let mut tnames: HashMap<u8, String> = HashMap::new();
    for g in &gs {
        for (k, v) in &g.type_names {
            tnames.entry(*k).or_insert_with(|| v.clone());
        }
    }
    let n = recs.len().max(1) as f64;
    let v: Vec<f64> = recs.iter().map(|r| model.value(&r.f)).collect();
    let mean_f: Vec<f64> = (0..NF).map(|j| recs.iter().map(|r| r.f[j]).sum::<f64>() / n).collect();
    let sd_f: Vec<f64> = (0..NF).map(|j| (recs.iter().map(|r| (r.f[j] - mean_f[j]).powi(2)).sum::<f64>() / n).sqrt()).collect();

    // 1. importance: permutation (rise in squared error when the feature is shuffled) and the linear weight x sd
    let mse = |pred: &dyn Fn(usize) -> f64| recs.iter().enumerate().map(|(i, r)| (pred(i) - r.g).powi(2)).sum::<f64>() / n;
    let base_mse = mse(&|i| v[i]);
    let mut rng = Rng::new(99);
    let perm: Vec<usize> = {
        let mut p: Vec<usize> = (0..recs.len()).collect();
        for i in (1..p.len()).rev() {
            let j = rng.below(i + 1);
            p.swap(i, j);
        }
        p
    };
    let importance: Vec<Value> = (0..NF)
        .map(|j| {
            let pm = if sd_f[j] < 1e-12 {
                base_mse
            } else {
                mse(&|i| {
                    let mut f = recs[i].f;
                    f[j] = recs[perm[i]].f[j];
                    model.value(&f)
                })
            };
            let w = match &model {
                Model::Linear(w) => json!(w[j]),
                _ => Value::Null,
            };
            json!({"feature": FEATURES[j], "permutation": pm - base_mse, "weight": w, "weightSd": match &model { Model::Linear(w) => json!(w[j] * sd_f[j]), _ => Value::Null }, "mean": mean_f[j], "sd": sd_f[j]})
        })
        .collect();

    // 2. by feature value: mean predicted V and mean actual return per bin
    let mut partial = Vec::new();
    for j in 0..NF {
        let mut col: Vec<f64> = recs.iter().map(|r| r.f[j]).collect();
        let lo = quantile(&mut col, 0.01);
        let hi = quantile(&mut col, 0.99);
        let width = (hi - lo) / BINS as f64;
        let mut cnt = [0.0; BINS];
        let mut sv = [0.0; BINS];
        let mut sg = [0.0; BINS];
        for (i, r) in recs.iter().enumerate() {
            let b = if width <= 1e-12 { 0 } else { (((r.f[j] - lo) / width) as isize).clamp(0, BINS as isize - 1) as usize };
            cnt[b] += 1.0;
            sv[b] += v[i];
            sg[b] += r.g;
        }
        let cell = |s: &[f64; BINS]| (0..BINS).map(|b| if cnt[b] > 0.0 { json!(s[b] / cnt[b]) } else { Value::Null }).collect::<Vec<_>>();
        partial.push(json!({"feature": FEATURES[j], "lo": lo, "hi": hi, "n": cnt.to_vec(), "V": cell(&sv), "G": cell(&sg)}));
    }

    // 3. situation per action kind: standardized mean feature value after actions of that kind
    let act: Vec<&Rec> = recs.iter().filter(|r| (r.kind as usize) < NK - 1).collect();
    let mut situation = Vec::new();
    let mut kind_n = vec![0usize; NK - 1];
    for k in 0..NK - 1 {
        let rk: Vec<&&Rec> = act.iter().filter(|r| r.kind as usize == k).collect();
        kind_n[k] = rk.len();
        let row: Vec<Value> = (0..NF)
            .map(|j| {
                if rk.is_empty() || sd_f[j] < 1e-12 {
                    Value::Null
                } else {
                    json!((rk.iter().map(|r| r.f[j]).sum::<f64>() / rk.len() as f64 - mean_f[j]) / sd_f[j])
                }
            })
            .collect();
        situation.push(row);
    }

    // 4. turn x kind, 5. unit type x kind
    let mut turn_kind = vec![vec![0u64; NK - 1]; TURNS as usize + 1];
    let mut ty_kind: HashMap<u8, Vec<u64>> = HashMap::new();
    for r in &act {
        turn_kind[(r.turn.clamp(0, TURNS)) as usize][r.kind as usize] += 1;
        ty_kind.entry(r.ty).or_insert_with(|| vec![0; NK - 1])[r.kind as usize] += 1;
    }
    let mut tys: Vec<u8> = ty_kind.keys().copied().collect();
    tys.sort();
    let tyname = |t: &u8| tnames.get(t).cloned().unwrap_or_else(|| t.to_string());

    // 6. rewards by unit type x source (stars per game)
    let mut rew: HashMap<u8, [f64; 4]> = HashMap::new();
    for g in &gs {
        for (t, src, r) in &g.rewards {
            rew.entry(*t).or_insert([0.0; 4])[*src as usize] += r / games as f64;
        }
    }
    let mut rtys: Vec<u8> = rew.keys().copied().collect();
    rtys.sort();

    // 7. who fights whom
    let mut mu: HashMap<(u8, u8), (u64, u64)> = HashMap::new();
    for g in &gs {
        for (a, b, k) in &g.attacks {
            let e = mu.entry((*a, *b)).or_default();
            e.0 += 1;
            e.1 += *k as u64;
        }
    }
    let mut atys: Vec<u8> = mu.keys().map(|k| k.0).collect::<HashSet<_>>().into_iter().collect();
    let mut vtys: Vec<u8> = mu.keys().map(|k| k.1).collect::<HashSet<_>>().into_iter().collect();
    atys.sort();
    vtys.sort();

    // 8. calibration: predicted V bins vs actual return; per turn
    let mut vs = v.clone();
    let (vlo, vhi) = (quantile(&mut vs.clone(), 0.01), quantile(&mut vs, 0.99));
    let cw = ((vhi - vlo) / 12.0).max(1e-9);
    let mut cal: Vec<(f64, f64, f64)> = vec![(0.0, 0.0, 0.0); 12];
    for (i, r) in recs.iter().enumerate() {
        let b = (((v[i] - vlo) / cw) as isize).clamp(0, 11) as usize;
        cal[b].0 += 1.0;
        cal[b].1 += v[i];
        cal[b].2 += r.g;
    }
    let mut per_turn: Vec<(f64, f64, f64, f64)> = vec![(0.0, 0.0, 0.0, 0.0); TURNS as usize + 1];
    for (i, r) in recs.iter().enumerate() {
        let t = &mut per_turn[r.turn.clamp(0, TURNS) as usize];
        t.0 += 1.0;
        t.1 += v[i];
        t.2 += r.g;
        t.3 += (v[i] - r.g).abs();
    }

    // 9. 2-D slices of the learned V (other features at their median over action samples)
    let median: Vec<f64> = (0..NF).map(|j| quantile(&mut act.iter().map(|r| r.f[j]).collect(), 0.5)).collect();
    let slices: Vec<Value> = SLICES
        .iter()
        .map(|(xn, yn)| {
            let (xi, yi) = (fx(xn), fx(yn));
            let range = |j: usize| {
                let mut c: Vec<f64> = recs.iter().map(|r| r.f[j]).collect();
                let lo = quantile(&mut c, 0.02);
                let hi = quantile(&mut c, 0.98).max(lo + 1e-6);
                (0..GRID).map(|k| lo + (hi - lo) * k as f64 / (GRID - 1) as f64).collect::<Vec<f64>>()
            };
            let (xs, ys) = (range(xi), range(yi));
            let grid: Vec<Vec<f64>> = ys
                .iter()
                .map(|y| {
                    xs.iter()
                        .map(|x| {
                            let mut f = [0.0; NF];
                            f.copy_from_slice(&median);
                            f[0] = 1.0;
                            f[xi] = *x;
                            f[yi] = *y;
                            model.value(&f)
                        })
                        .collect()
                })
                .collect();
            json!({"x": xn, "y": yn, "xs": xs, "ys": ys, "V": grid})
        })
        .collect();

    let summary = summary(&gs);
    let out = json!({
        "run": run, "model": match model { Model::Linear(_) => "linear", Model::Mlp(_) => "mlp" },
        "iteration": iteration, "games": games, "samples": recs.len(), "at": now_iso(), "seconds": t0.elapsed().as_secs_f64(),
        "features": FEATURES.to_vec(), "kinds": KIND_NAMES[..NK - 1].to_vec(), "sources": SOURCES.to_vec(),
        "summary": summary, "fitRmse": base_mse.sqrt(),
        "importance": importance,
        "partial": partial,
        "situation": {"kinds": KIND_NAMES[..NK - 1].to_vec(), "n": kind_n, "z": situation},
        "turnKind": turn_kind,
        "typeKind": {"types": tys.iter().map(tyname).collect::<Vec<_>>(), "counts": tys.iter().map(|t| ty_kind[t].clone()).collect::<Vec<_>>()},
        "rewards": {"types": rtys.iter().map(tyname).collect::<Vec<_>>(), "perGame": rtys.iter().map(|t| rew[t].to_vec()).collect::<Vec<_>>()},
        "matchup": {"attackers": atys.iter().map(tyname).collect::<Vec<_>>(), "victims": vtys.iter().map(tyname).collect::<Vec<_>>(),
            "attacks": atys.iter().map(|a| vtys.iter().map(|b| mu.get(&(*a, *b)).map(|e| e.0).unwrap_or(0)).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "kills": atys.iter().map(|a| vtys.iter().map(|b| mu.get(&(*a, *b)).map(|e| e.1).unwrap_or(0)).collect::<Vec<_>>()).collect::<Vec<_>>()},
        "calibration": cal.iter().map(|c| if c.0 > 0.0 { json!({"n": c.0, "V": c.1 / c.0, "G": c.2 / c.0}) } else { Value::Null }).collect::<Vec<_>>(),
        "perTurn": per_turn.iter().enumerate().skip(1).map(|(t, c)| json!({"turn": t, "n": c.0, "V": c.1 / c.0.max(1.0), "G": c.2 / c.0.max(1.0), "mae": c.3 / c.0.max(1.0)})).collect::<Vec<_>>(),
        "slices": slices,
        "examples": examples,
        "weights": model.to_json(),
    });
    std::fs::write(dir.join("analysis.json"), serde_json::to_string(&out).unwrap()).map_err(|e| e.to_string())?;
    let hist = json!({"iteration": iteration, "at": now_iso(), "importance": out["importance"].as_array().unwrap().iter().map(|x| x["permutation"].clone()).collect::<Vec<_>>(),
        "weightSd": out["importance"].as_array().unwrap().iter().map(|x| x["weightSd"].clone()).collect::<Vec<_>>(),
        "diff": out["summary"]["diff"]["mean"], "kills": out["summary"]["kills"], "fitRmse": base_mse.sqrt()});
    let mut h = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("analysis-history.jsonl")).map_err(|e| e.to_string())?;
    writeln!(h, "{hist}").map_err(|e| e.to_string())?;
    eprintln!("analysis of {run} at iteration {iteration}: {} samples, {:.1}s", recs.len(), t0.elapsed().as_secs_f64());
    Ok(())
}
