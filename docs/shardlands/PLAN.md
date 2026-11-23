# Shardlands: build plan

Shardlands is a private learning project: a turn-based 4X game whose **rules and
balance numbers match The Battle of Polytopia exactly** (tech tree, costs, unit
stats, combat formula, economy, map generation, game modes), with **original
names and art** (own game name, clan/unit/tech display names, flat top-down
look). Purpose: play it on the phone to learn the mechanics, then train RL
agents on the same engine.

Work happens on branch `worktree-shardlands-engine` in
`.claude/worktrees/shardlands-engine`. Tick a box only when it is done and
verified (tests run, screen checked). This file is the source of truth for what
is left; read it first after any context reset.

## Decisions (made 2026-11-23)
- Rules source: `docs/shardlands/RULES.md`, compiled from the Polytopia wiki
  (current version). Values marked "(unverified)" there are best guesses.
- Engine: pure TypeScript in `logic/engine/`, no React, no `Math.random`.
  The RNG state lives in the game state, so seed + action list replays a game.
- Engine ids are plain descriptive words (`warrior`, `climbing`); Shardlands
  display names live only in `logic/engine/names.ts`.
- UI: the existing Expo app (`app/`, `components/`), using React Native views
  only (no `<div>`, no CSS grid), so it runs on iOS/Android and web.
- Phone: Expo SDK 52 is too old for today's Expo Go (latest SDK 58). Upgrade the
  SDK, or play the web build in the phone's browser.

## Checklist
- [x] Seeded RNG (`logic/engine/rng.ts`), seeded `spawnCapitals` that works for any player count
- [ ] RULES.md written from research, unverified values marked
- [ ] Engine types + data tables (units, techs, improvements, terrain) matching RULES.md
- [ ] Map generation (terrain, resources, villages, ruins, capitals)
- [ ] Turn loop: income, research, train, move, attack, capture, harvest/build, level-up rewards, end turn
- [ ] Combat, healing, veterans, skills (dash, escape, persist, fortify, ...)
- [ ] Naval (port, embark, boats/ships), roads/bridges, temples, special units
- [ ] Fog of war, vision, explorer, ruins
- [ ] Win conditions: Domination, Perfection (30 turns, score)
- [ ] Bot opponent (simple, legal-moves-only)
- [ ] Rule tests against RULES.md + 200-game bot-vs-bot simulation without errors
- [ ] RL interface: `legalActions`, `applyAction`, `observe`, headless Node runner (`scripts/simulate.ts`), documented in `docs/shardlands/RL.md`
- [ ] Phone UI: pannable map, select/move/attack, city panel (train/build), tech tree, level-up choice, end turn, game over
- [ ] Runs on the phone (Expo Go after SDK upgrade, or web build in phone browser), screenshot checked
- [ ] Committed and pushed; final report with launch command
