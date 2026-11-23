# Rules parity with POLYTOPIA_RULES.md

`POLYTOPIA_RULES.md` (export of the Claude Doc "The Battle of Polytopia: rules
and game logic", game version 2.18) is the spec for the engine in
`logic/engine`. Where the engine and the doc disagree, the doc wins, except
for the items listed under "Kept on purpose".

## Decisions where the doc leaves a choice

The doc's "Open questions" table names a value under "Used here"; the engine
uses that value. Where it says "Open" or "Both shown", the engine uses:

| Topic | Engine value |
| --- | --- |
| Breaking peace | cease-fire: neither side may attack the other until the breaker's next turn |
| Embassy condition | allowed when not at war |
| Embassy cost | 5★, no scaling (no numbers published) |
| Cloak attack | 0 in combat; infiltration damage uses attack 2 |
| Cloak detection | every adjacent enemy unit |
| Splash damage | half the damage, unrounded (HP may be fractional, shown rounded up) |
| Explosion damage | half the explosion's damage, unrounded, like splash |
| Poison and movement | movement floor of 1 |
| Perfection bonus | score × (1 + 0.41·ln(opponents) + difficulty) |
| Meeting a tribe | wiki formula: 1 + 2★ per 1,000 score, at most 11 |
| Market income | +1★ per adjacent building level, at most 8 |
| Port reach | range 5; ocean links need Sailing |
| Ice Bank | 2★ per 20 frozen tiles |
| Glide on ice | 0.9 movement per ice step |
| Luxidoor capital | level 2 |
| Sanctuary | a new animal every 2 turns (game data) |
| Ruin placement | never next to a capital or a village |
| Unit stats | the unit-page value (the doc's "Used here"), e.g. Pirate movement 2 |
| Unlocking techs | the tech-page value in the doc |
| Bot capital income | 1/2/3/5★ for Easy/Normal/Hard/Crazy |
| Creep and zone of control | the doc contradicts itself (Terrain and Cloak sections: Creep ignores it; Movement rules: only Sneak, Hide and invisibility do). The engine follows Movement rules; Cloak and Dinghy ignore it through Hide anyway |
| Escape | after attacking, the unit may move again with its full movement |
| Stomp | half the damage, unrounded, like splash |

## Not found in any source (engine choice)

- Units of a tribe that loses its last city are removed.
- Perfection ties: the lower player index wins.
- Ruin rewards: an even draw among the eligible rewards.
- A unit on a mountain sees 5×5.
- No star cap, no unit upkeep.
- War: an attack (or conversion) either way in this turn number or the
  previous one. Splash, stomp and infiltration don't start a war.
- Hostile: shown during the cease-fire after a broken treaty; neutral or war
  after it.
- Peace offers: one pending offer per sender and receiver; an offer the
  receiver doesn't answer on its turn lapses. Offering is allowed at war and
  during a cease-fire.
- Peace partners: their units don't besiege each other's cities, can be
  passed through (not stopped on), and splash and stomp damage skip them.
  Polaris freezing, Cymanti explosions and Fungi poison are not changed here.
- A unit stopped by a hidden enemy ends on the last free tile of its planned
  path before that tile; its move is spent.
- Daggers: city, then forest or mountain (mountain only with Climbing), then
  other land in the city's borders, then water as Pirates.
- Bot opinions: each factor of the doc's table counts +1 or -1 (horrible ≤ -3,
  poor -2..-1, indifferent 0, decent 1..2, great ≥ 3). Peaceful = no attack on
  the bot for 3 turns, Violent otherwise; Threatening = a unit inside or next
  to the bot's land; Annoying on Hard and Crazy; Charming by a fixed roll per
  game (50/30/15/5% for Easy/Normal/Hard/Crazy); Dominating = at least half of
  all cities (4 or more cities on the map); Brave = at war with the
  highest-scoring other tribe. Bots accept and send peace offers only at
  great and never break a treaty.

## Kept on purpose

- Monuments: the doc says "once per game by the first tribe to finish its
  task". The engine lets every tribe build each monument once, as the game
  does in practice. Change `canBuild` in `logic/engine/actions.ts` if the doc's
  reading is wanted.
