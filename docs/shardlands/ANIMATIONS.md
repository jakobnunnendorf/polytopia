# Animations: where a state-of-the-art mobile strategy game moves

This is the full inventory, written before any animation was built. Each row says what
moves, why players need it, and how Shardlands does it. All motion uses React
Native's `Animated` (works on phone and web). With the system's reduced-motion
setting on, everything appears instantly.

Map animations are not wired to buttons. Map compares the previous and the next
game state and plays what changed, so human moves, bot turns, live games and
replays all animate the same way, without touching the engine.

## Map: units

| # | Moment | Motion | Why |
|---|---|---|---|
| 1 | Unit moves | Slides tile to tile with a small hop | Players lose track of a unit that teleports, above all an enemy's |
| 2 | Unit selected | Lifts and bobs gently | Shows which unit the tray is talking about |
| 3 | Attack | Attacker lunges toward the target and back | Shows who hit whom when several units are nearby |
| 4 | Unit takes damage | Shakes, flashes, and a red "−N" floats up | Damage is the central combat feedback |
| 5 | Unit heals | Green "+N" floats up | Recover and heal-others otherwise look like nothing happened |
| 6 | Unit dies | Shrinks, sinks and fades, leaving a puff | A unit that just vanishes reads as a bug |
| 7 | Unit trained | Pops in with an overshoot | Draws the eye to the new unit at the city |
| 8 | Unit promoted (veteran) | Gold burst and ring | A reward moment |
| 9 | Unit used up for the turn | Fades to its dim state over time instead of at once | Softer and clearer than a sudden change |

## Map: tiles and cities

| # | Moment | Motion | Why |
|---|---|---|---|
| 10 | Clouds clear (exploring) | The cloud over a newly seen tile puffs up and fades | Discovery is the core joy of the first turns |
| 11 | Move targets | Dots appear one after another and pulse softly | Shows reach, and that the unit is ready |
| 12 | Attack targets | The ring pulses | Danger and opportunity stand out from moves |
| 13 | Building or harvest | The new building pops up, plus a "+1" for population | Confirms the stars were well spent |
| 14 | City grows a level | The city bounces, with a gold burst | The game's main progress beat |
| 15 | City captured | Burst in the new owner's colour, then the city pops in again | Conquest has to feel like an event |
| 16 | Territory grows | New border tiles fade in | Shows the city's reach expanding |
| 17 | Ruin explored | The ruin crumbles in a dust puff | Makes the reward feel found |
| 18 | Camera | When zoomed in, the view pans smoothly to where a rival acts | Off-screen action is otherwise missed |

## Heads-up display and tray

| # | Moment | Motion | Why |
|---|---|---|---|
| 19 | Shard total changes | The number counts up or down, and "+N" floats off | Players read income from motion |
| 20 | Score changes | The number counts | Same |
| 21 | Your turn starts | A "Turn N" banner slides in and out | Clear handover between rivals and you |
| 22 | Nothing left to do | The End turn button pulses | Nudges without nagging |
| 23 | Rivals are moving | Animated dots on the button | Shows the game is working, not frozen |
| 24 | Any button press | Button shrinks slightly | Every touch gets an answer |

## Panels and screens

| # | Moment | Motion | Why |
|---|---|---|---|
| 25 | Lore wheel opens | Nodes pop in, ring by ring outward | Shows the wheel's structure while it builds |
| 26 | Discovery learned | The node bursts as it fills | Reward |
| 27 | City boon offered | The card pops in, then the options one after another | Draws attention to a decision |
| 28 | Game over | The title drops in, confetti for a victory, rows appear one by one, Elo counts up | The climax of a game |
| 29 | Pass the device | Fade | Exists already (Modal fade) |
| 30 | Main menu | The panel rises in, and buttons press | First impression |
| 31 | Setup chips | Press feedback | Same as 24 |
| 32 | Live view | The LIVE dot pulses | Shows the view is following |

Not animation, but part of the same feel: light haptic taps on phones for select,
move, attack and end turn (expo-haptics, installed).

## Status (built 2026-11-23)

All rows above are built, with three simplifications: territory (16) fades in per
tile, the camera (18) pans only when zoomed in, and the Lore "learned" burst (26) is the node
popping again in its new colour. Code: `components/anim/` (Pop, Pulse, Ticker,
FloatText, Banner, Confetti), `components/Map/Units.tsx` (unit sprites, effects,
`diffEvents`), `components/game/GameOverCard.tsx` (winner card, also shown at the
end of an Analyse replay).

## Pacing

Every bot move takes the same time, so games are pleasant to watch: 480 ms per
move in the app, 550 ms per move for model-only games on the arena server
(`SHARDLANDS_PACE_MS` to change; `0` for fast self-play). The live view and
replay Play step at the same rhythm and catch up quickly when far behind.
