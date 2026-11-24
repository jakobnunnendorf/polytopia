# Porting contract (TypeScript -> Rust)

Every agent porting a part of `logic/engine` follows these rules, so the
modules fit together without negotiation. The goal is **bit-exact parity**:
same legal actions in the same order, same state after every action, same
game log, for every game. Speed comes later (phase 5); write straightforward
code now, but do not allocate needlessly in hot paths.

## Files

| Rust module (`engine/core/src/`) | TypeScript source | Owner |
| --- | --- | --- |
| `data_gen.rs` | generated from `data.ts` by `scripts/rust/gen-data.ts` | done |
| `types.rs`, `json.rs`, `canon.rs`, `rng.rs`, `grid.rs` | `types.ts`, `rng.ts`, `grid.ts` | done |
| `data.rs` | rest of `data.ts` (constants, helper functions) | agent B |
| `diplomacy.rs`, `combat.rs`, `movement.rs`, `opinion.rs` | same names | agent B |
| `mapgen.rs`, `names.rs` | same names | agent A |
| `state.rs` | `state.ts` | agent C |
| `actions.rs` | `actions.ts` | agent D |
| `bot.rs`, `observe.rs`, `cli` replay | `bot.ts`, `observe.ts` | agent E |

Each module starts as a stub with the agreed public signatures and
`todo!()` bodies. Keep every public signature exactly as it is in the stub
(other agents call them); add private helpers freely. If a signature truly
cannot work, change it, fix every caller you can see, and say so in your
report.

## Naming

- Functions: snake_case of the TypeScript name (`legalActions` ->
  `legal_actions`, `canSee` -> `can_see`), in the module of the same name.
- Data constants: SCREAMING_CASE of the TypeScript name in `data.rs`
  (`EXPLORER_STEPS`, `SCORE.perUnitCost` -> `SCORE.per_unit_cost`).
- Ids are enums from `data_gen.rs`: `UnitType::Warrior`, `Build::Farm`,
  `Tech::Climbing`, `Tribe::Aquarion`, `Skill::Dash`, `Reward::CityWall`,
  `Task::Pacifist`, `Terrain::Water`, `Resource::Fish`. Per-id records:
  `UNITS[t as usize]`, `BUILDS[b as usize]`, `TECHS[t as usize]`,
  `TRIBES[t as usize]` (all in data order). TS state field `type` is `ty`,
  `clan` is `tribe`.
- `Object.keys(BUILDS)` order == `Build::ALL` order; `Object.values(UNITS)`
  == `UnitType::ALL`; `TECHS` == `Tech::ALL`; `CLANS` == `Tribe::ALL`.

## Passing state, units, cities

- `s: &GameState` for reads, `s: &mut GameState` when the TS function
  mutates `s` (or anything inside it).
- **Read-only** helpers take `&Unit`, `&City`, `&Tile` (a reference into the
  state or a local copy). **Mutating** functions take an index into
  `s.units` / `s.cities` (`ui: usize`, `ci: usize`) or an id, as the stub says.
- A TS function that returns a unit or city from the state returns its index
  (`Option<usize>`) into `s.units` / `s.cities`. `makeUnit` and `newCity`
  push and return the new index.
- TS object identity (`o !== u`, `s.units.includes(u)`, `filter((v) => v !== u)`)
  becomes id comparison. Remember that removing a unit shifts later indices:
  re-find by id after any removal. TS code that keeps mutating a unit object
  that was already removed from `s.units` must keep that behaviour (mutating
  a removed unit has no effect on the state; drop the write).
- Iterating while the TS loop mutates the array: reproduce TS semantics
  exactly (`for...of` over an array sees elements appended during the loop
  and skips over shifted ones; `filter` / `map` iterate a snapshot).

## Numbers

- JavaScript numbers are f64. Every state number is an integer and is `i32`
  in Rust. Intermediate arithmetic that can be fractional (division,
  multipliers like 1.5, `Math.fround(0.66666)`, unit attack 3.5) must be done
  in `f64` exactly as the TS expression does it, in the same order, then
  converted where TS stores an integer.
- `Math.floor`/`ceil`/`trunc` -> `f64::floor`/`ceil`/`trunc`.
  `Math.round(x)` -> `crate::data::js_round(x)` (halves toward +infinity, also
  for negatives). `Math.sign` -> `crate::data::js_sign`. `x % y` in JS keeps
  the sign of x: Rust `%` on i32 does too; on f64 too.
- Transcendental functions (`Math.log`, `pow`, `exp`, `sin`...) -> the `libm`
  crate (same fdlibm code as V8), never `f64::ln` etc. `Math.sqrt` ->
  `f64::sqrt` (exact).
- Integer overflow cannot happen in JS; use i64 for products that could pass
  2^31.

## Randomness

`state.rng` holds the generator state. TS `withRng(s, f)` ->
`state::with_rng(s, |r| ...)`; same draws in the same order, or parity is
lost. Map generation receives a `&mut Rng`.

## Errors

TS `applyAction` throws on an illegal action. Rust `apply_action` returns
`Result<(), String>`; inner helpers may return `Result` or panic on states
that cannot occur. Never silently ignore an action TS would reject.

## Log

`state::log(s, msg)` formats exactly like TS (`T${turn} P${current}: ${msg}`,
capped at 200 lines). Messages must match TS character for character.
`clone_state` / `apply_action` cut the log to the last 50 lines before the
action like `cloneState`.

## Checking your work

- `cargo check` from `engine/` must pass for your files. Errors in modules
  other agents are still writing are expected; do not edit their files.
- Read the TS source in full before writing; port every branch, comment the
  non-obvious ones with the TS line they mirror.
- Parity is checked by replaying the corpus: `node -r sucrase/register
  scripts/rust/trace-gen.ts --games 60 --out engine/corpus/smoke`, then
  `cargo run --release -p polyengine -- replay engine/corpus/smoke`.
