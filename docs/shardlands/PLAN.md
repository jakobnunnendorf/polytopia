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

## Standing rules (Jakob, 2026-11-23)
- Live preview for Jakob: after **every checkpoint** (each ticked box / commit),
  relaunch the preview so it serves the latest version:
  `zsh scripts/relaunch-preview.sh` (run in the background, from the worktree
  root). It serves http://localhost:8090 and, on the same Wi-Fi,
  http://<Mac LAN IP>:8090 (`ipconfig getifaddr en0`; it was 10.80.133.230).
  Check it answers HTTP 200 before reporting the checkpoint.
- Keep the live preview runnable between checkpoints: unfinished screens stay
  out of `app/` routes (the game screen lives in
  `components/game/GameScreen.tsx` until the engine works).
- `git push` is blocked by auto mode; commit locally, Jakob pushes.

## Checklist
- [x] Seeded RNG (`logic/engine/rng.ts`), seeded `spawnCapitals` that works for any player count
- [x] RULES.md written from research, unverified values marked
- [x] Engine types + data tables (units, techs, improvements, terrain) matching RULES.md
- [x] Map generation (terrain, resources, villages, ruins, capitals)
- [x] Turn loop: income, research, train, move, attack, capture, harvest/build, level-up rewards, end turn
- [x] Combat, healing, veterans, skills (dash, escape, persist, fortify, ...)
- [x] Naval (port, embark, boats/ships), roads/bridges, temples, special units
- [x] Fog of war, vision, explorer, ruins
- [x] Win conditions: Domination, Perfection (30 turns, score)
- [x] Bot opponent (simple, legal-moves-only)
- [x] Rule tests against RULES.md + 200-game bot-vs-bot simulation without errors
- [x] RL interface: `legalActions`, `applyAction`, `observe`, headless Node runner (`scripts/simulate.ts`), documented in `docs/shardlands/RL.md`
- [x] Phone UI: pannable map, select/move/attack, city panel (train/build), tech tree, level-up choice, end turn, game over
- [x] Runs on the phone (Expo Go after SDK upgrade, or web build in phone browser), screenshot checked
- [x] Committed; final report with launch command (push is blocked for the agent, Jakob runs `git push -u origin worktree-shardlands-engine`)

## Status (2026-11-23)

- Playable at http://<Mac LAN IP>:8090 (phone, same Wi-Fi) or http://localhost:8090 after `zsh scripts/relaunch-preview.sh`.
- `?watch=1` on the game URL lets a bot play your clan too (watch a whole game; used to screenshot the game-over screen).
- Metro does not pick up edits inside `.claude/worktrees/` (hidden folder): relaunch the preview after every change.
- Art: original low-poly SVG drawings in `components/art/Art.tsx`.
- Known simplifications vs RULES.md are listed at the end of `docs/shardlands/RL.md`.
