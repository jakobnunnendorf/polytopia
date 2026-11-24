//! Python extension module `polyengine`: the engine/api JSON entry point and
//! `VecEnv`, n games stepped in parallel in Rust for reinforcement learning.
//! See README.md for the API.

use polycore::actions::{apply_action, legal_actions};
use polycore::bot::{bot_step, GreedyWeights};
use polycore::json::{action_to_json, state_to_json};
use polycore::observe::{channels as obs_channels, observe, Observation};
use polycore::state::{create_game, score_of, NewGameOptions};
use polycore::types::{Action, GameState, Tech};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use rayon::prelude::*;

/// opponent actions in one turn before the env forces endTurn (never reached by the bot in practice)
const MAX_OPPONENT_ACTIONS_PER_TURN: usize = 5000;

/// `call(name, args_json) -> str`: engine/api `call_json`; returns `{"ok": ...}` or `{"error": ...}`
#[pyfunction]
fn call(py: Python<'_>, name: &str, args_json: &str) -> String {
    let (name, args) = (name.to_string(), args_json.to_string());
    py.detach(move || polyapi::call_json(&name, &args))
}

/// observation plane names, in plane order
#[pyfunction]
fn channels() -> Vec<String> {
    obs_channels().iter().map(|s| s.to_string()).collect()
}

/// scalar feature names for a game with `players` players, in `VecEnv.scalars()` order
#[pyfunction]
fn scalar_names(players: usize) -> Vec<String> {
    let mut v: Vec<String> = ["turn", "max_turns", "stars", "income", "score", "cities", "opponents_alive"].iter().map(|s| s.to_string()).collect();
    v.extend(Tech::ALL.iter().map(|t| format!("tech:{}", t.id())));
    v.extend(Tech::ALL.iter().map(|t| format!("tech_cost:{}", t.id())));
    v.extend((0..players).map(|p| format!("relation:{p}")));
    v.extend((0..players).map(|p| format!("peace_offer:{p}")));
    v
}

fn scalars_of(o: &Observation, out: &mut Vec<f32>) {
    let s = &o.scalars;
    for x in [s.turn, s.max_turns, s.stars, s.income, s.score, s.cities, s.opponents_alive] {
        out.push(x as f32);
    }
    for xs in [&s.techs, &s.tech_costs, &s.relations, &s.peace_offers] {
        out.extend(xs.iter().map(|&x| x as f32));
    }
}

fn f32_bytes(xs: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(xs.len() * 4);
    for x in xs {
        b.extend_from_slice(&x.to_le_bytes());
    }
    b
}

struct Env {
    index: u64,
    episode: u64,
    state: GameState,
    legal: Vec<Action>,
    obs: Observation,
    /// the state the previous episode ended in
    terminal: Option<GameState>,
}

struct Cfg {
    n: u64,
    opts: NewGameOptions,
    seed: i64,
    learner: i32,
    opponent: GreedyWeights,
    max_turns: Option<i32>,
    shaping: bool,
}

impl Cfg {
    /// episode k of env i uses seed + i + n*k
    fn new_game(&self, index: u64, episode: u64) -> Result<GameState, String> {
        let mut o = self.opts.clone_opts();
        o.seed = self.seed + (index + self.n * episode) as i64;
        create_game(&o)
    }
    fn truncated(&self, s: &GameState) -> bool {
        self.max_turns.is_some_and(|t| s.turn >= t)
    }
    fn finished(&self, s: &GameState) -> bool {
        s.over || !s.players[self.learner as usize].alive || self.truncated(s)
    }
    /// the opponents play until it is the learner's turn or the episode ends
    fn play_opponents(&self, s: &mut GameState) -> Result<(), String> {
        let mut in_turn = 0usize;
        let mut cur = s.current;
        while !self.finished(s) && s.current != self.learner {
            if s.current != cur {
                cur = s.current;
                in_turn = 0;
            }
            let a = if in_turn >= MAX_OPPONENT_ACTIONS_PER_TURN { Action::EndTurn } else { bot_step(s, &self.opponent) };
            apply_action(s, &a).map_err(|e| format!("opponent action {a:?} failed: {e}"))?;
            in_turn += 1;
        }
        Ok(())
    }
    fn reward(&self, s: &GameState) -> f64 {
        if !s.players[self.learner as usize].alive {
            return -1.0;
        }
        match (s.over, s.winner) {
            (true, Some(w)) if w == self.learner => 1.0,
            (true, Some(_)) => -1.0,
            _ => 0.0,
        }
    }
    /// sets up env `index`'s next episode (skipping any that end before the learner moves)
    fn start(&self, e: &mut Env) -> Result<(), String> {
        loop {
            let mut s = self.new_game(e.index, e.episode)?;
            e.episode += 1;
            self.play_opponents(&mut s)?;
            if !self.finished(&s) {
                e.legal = legal_actions(&s);
                e.obs = observe(&s, self.learner);
                e.state = s;
                return Ok(());
            }
        }
    }
    /// returns (reward, done)
    fn step(&self, e: &mut Env, choice: usize) -> Result<(f64, bool), String> {
        let before = score_of(&e.state, self.learner);
        let a = e.legal[choice];
        apply_action(&mut e.state, &a).map_err(|err| format!("learner action {a:?} failed: {err}"))?;
        self.play_opponents(&mut e.state)?;
        let mut r = 0.0;
        if self.shaping {
            r += (score_of(&e.state, self.learner) - before) as f64 / 1000.0;
        }
        if self.finished(&e.state) {
            r += self.reward(&e.state);
            let s = std::mem::replace(&mut e.state, placeholder_state());
            e.terminal = Some(s);
            self.start(e)?;
            return Ok((r, true));
        }
        e.legal = legal_actions(&e.state);
        e.obs = observe(&e.state, self.learner);
        Ok((r, false))
    }
}

trait CloneOpts {
    fn clone_opts(&self) -> NewGameOptions;
}
impl CloneOpts for NewGameOptions {
    fn clone_opts(&self) -> NewGameOptions {
        NewGameOptions {
            map_size: self.map_size,
            players: self.players,
            mode: self.mode,
            difficulty: self.difficulty,
            seed: self.seed,
            humans: self.humans.clone(),
            map_type: self.map_type,
            clans: self.clans.clone(),
            turn_limit: self.turn_limit,
        }
    }
}

fn placeholder_state() -> GameState {
    GameState {
        seed: 0,
        rng: 0,
        map_size: 0,
        mode: polycore::types::GameMode::Perfection,
        difficulty: None,
        max_turns: 0,
        turn: 0,
        current: 0,
        tiles: vec![],
        units: vec![],
        cities: vec![],
        players: vec![],
        next_id: Default::default(),
        winner: None,
        over: false,
        log: vec![],
        diplomacy: None,
    }
}

fn err(e: String) -> PyErr {
    PyValueError::new_err(e)
}

/// n games stepped in parallel; the learner plays player `learner`, the greedy bot all others
#[pyclass]
struct VecEnv {
    cfg: Cfg,
    envs: Vec<Env>,
    map_size: usize,
    players: usize,
}

impl VecEnv {
    fn obs_bytes(&self) -> Vec<u8> {
        let per = obs_channels().len() * self.map_size * self.map_size;
        let mut v = Vec::with_capacity(per * self.envs.len());
        for e in &self.envs {
            v.extend(e.obs.planes.iter().map(|&x| x as f32));
        }
        f32_bytes(&v)
    }
    fn env(&self, i: usize) -> PyResult<&Env> {
        self.envs.get(i).ok_or_else(|| err(format!("env index {i} out of range")))
    }
}

#[pymethods]
impl VecEnv {
    #[new]
    #[pyo3(signature = (n, options_json, seed, learner=0, opponent_weights_json=None, max_turns=None, shaping=false))]
    fn new(n: usize, options_json: &str, seed: i64, learner: i32, opponent_weights_json: Option<&str>, max_turns: Option<i32>, shaping: bool) -> PyResult<Self> {
        let mut ov: serde_json::Value = serde_json::from_str(options_json).map_err(|e| err(format!("options_json: {e}")))?;
        if let Some(o) = ov.as_object_mut() {
            o.insert("seed".into(), serde_json::json!(seed));
        }
        let opts = NewGameOptions::from_json(&ov).map_err(err)?;
        let opponent = match opponent_weights_json {
            None => GreedyWeights::default_weights(),
            Some(w) => GreedyWeights::from_json(&serde_json::from_str(w).map_err(|e| err(format!("opponent_weights_json: {e}")))?).map_err(err)?,
        };
        if n == 0 {
            return Err(err("n must be at least 1".into()));
        }
        let cfg = Cfg { n: n as u64, opts, seed, learner, opponent, max_turns, shaping };
        let probe = cfg.new_game(0, 0).map_err(err)?;
        if learner < 0 || learner as usize >= probe.players.len() {
            return Err(err(format!("learner {learner} is not a player")));
        }
        let (map_size, players) = (probe.map_size as usize, probe.players.len());
        let obs = observe(&probe, learner);
        let envs = (0..n as u64)
            .map(|i| Env { index: i, episode: 0, state: placeholder_state(), legal: vec![], obs: obs.clone(), terminal: None })
            .collect();
        let mut me = VecEnv { cfg, envs, map_size, players };
        me.reset_all().map_err(err)?;
        Ok(me)
    }

    /// number of envs
    #[getter]
    fn n(&self) -> usize {
        self.envs.len()
    }
    #[getter]
    fn map_size(&self) -> usize {
        self.map_size
    }
    #[getter]
    fn num_channels(&self) -> usize {
        obs_channels().len()
    }
    #[getter]
    fn num_scalars(&self) -> usize {
        scalar_names(self.players).len()
    }
    #[getter]
    fn players(&self) -> usize {
        self.players
    }
    fn scalar_names(&self) -> Vec<String> {
        scalar_names(self.players)
    }

    /// restarts every env from episode 0 (seed + i); returns float32 (n, C, N, N) bytes
    fn reset<'py>(&mut self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        py.detach(|| self.reset_all()).map_err(err)?;
        Ok(PyBytes::new(py, &self.obs_bytes()))
    }

    /// the current observation (float32 (n, C, N, N) bytes) without stepping
    fn obs<'py>(&self, py: Python<'py>) -> Bound<'py, PyBytes> {
        PyBytes::new(py, &self.obs_bytes())
    }

    /// float32 (n, S) bytes of the current observation scalars, in scalar_names() order
    fn scalars<'py>(&self, py: Python<'py>) -> Bound<'py, PyBytes> {
        let mut v = Vec::new();
        for e in &self.envs {
            scalars_of(&e.obs, &mut v);
        }
        PyBytes::new(py, &f32_bytes(&v))
    }

    /// env i's legal actions as JSON strings, in engine order
    fn legal_actions(&self, i: usize) -> PyResult<Vec<String>> {
        Ok(self.env(i)?.legal.iter().map(|a| action_to_json(a).to_string()).collect())
    }

    fn legal_counts(&self) -> Vec<usize> {
        self.envs.iter().map(|e| e.legal.len()).collect()
    }

    /// index of the greedy bot's choice (default weights) in each env's legal list
    fn bot_choices(&self, py: Python<'_>) -> Vec<usize> {
        let envs = &self.envs;
        py.detach(|| {
            let w = GreedyWeights::default_weights();
            envs.par_iter()
                .map(|e| {
                    let a = bot_step(&e.state, &w);
                    e.legal.iter().position(|x| *x == a).expect("bot choice not in the legal list")
                })
                .collect()
        })
    }

    /// applies choices[i] (an index into env i's legal list) in every env, lets the opponents
    /// play, auto-resets finished envs; returns (obs bytes, rewards, dones)
    fn step<'py>(&mut self, py: Python<'py>, choices: Vec<usize>) -> PyResult<(Bound<'py, PyBytes>, Vec<f64>, Vec<bool>)> {
        if choices.len() != self.envs.len() {
            return Err(err(format!("step: {} choices for {} envs", choices.len(), self.envs.len())));
        }
        for (i, (e, &c)) in self.envs.iter().zip(&choices).enumerate() {
            if c >= e.legal.len() {
                return Err(err(format!("step: env {i} has {} legal actions, got choice {c}", e.legal.len())));
            }
        }
        let cfg = &self.cfg;
        let envs = &mut self.envs;
        let out: Result<Vec<(f64, bool)>, String> = py.detach(|| envs.par_iter_mut().zip(choices.par_iter()).map(|(e, &c)| cfg.step(e, c)).collect());
        let out = out.map_err(err)?;
        let (rewards, dones) = out.into_iter().unzip();
        Ok((PyBytes::new(py, &self.obs_bytes()), rewards, dones))
    }

    /// env i's current state as JSON
    fn state_json(&self, i: usize) -> PyResult<String> {
        Ok(state_to_json(&self.env(i)?.state).to_string())
    }

    /// the state env i's previous episode ended in, as JSON (None before the first one ends)
    fn terminal_state_json(&self, i: usize) -> PyResult<Option<String>> {
        Ok(self.env(i)?.terminal.as_ref().map(|s| state_to_json(s).to_string()))
    }

    /// the seed of env i's current episode
    fn episode_seed(&self, i: usize) -> PyResult<i64> {
        Ok(self.env(i)?.state.seed)
    }
}

impl VecEnv {
    fn reset_all(&mut self) -> Result<(), String> {
        let cfg = &self.cfg;
        self.envs
            .par_iter_mut()
            .map(|e| {
                e.episode = 0;
                e.terminal = None;
                cfg.start(e)
            })
            .collect()
    }
}

#[pymodule]
fn polyengine(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(call, m)?)?;
    m.add_function(wrap_pyfunction!(channels, m)?)?;
    m.add_function(wrap_pyfunction!(scalar_names, m)?)?;
    m.add_class::<VecEnv>()?;
    Ok(())
}
