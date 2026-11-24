# Rules parity with POLYTOPIA_RULES.md

`POLYTOPIA_RULES.md` (export of the Claude Doc "The Battle of Polytopia: rules
and game logic", game version 2.18) is the spec for the engine in
`logic/engine`. Where the engine and the doc disagree, the doc wins, except
for the items listed under "Kept on purpose" and the "2.18 data corrections"
below: the game's own 2.18 rules data and the polybots-engine replay engine
win over the doc.

## Decisions where the doc leaves a choice

The doc's "Open questions" table names a value under "Used here"; the engine
uses that value. Where it says "Open" or "Both shown", the engine uses:

| Topic | Engine value |
| --- | --- |
| Breaking peace | cease-fire: neither side may attack the other until the breaker's next turn |
| Embassy condition | see 2.18 data corrections: allowed at war too (pays nothing then) |
| Embassy cost | see 2.18 data corrections: 4★ + 2★ per embassy already built |
| Cloak attack | 2 (game data), but Infiltrate units never attack units; infiltration damage uses Dagger stats |
| Cloak detection | every adjacent enemy unit |
| Splash damage | half the damage, unrounded (HP may be fractional, shown rounded up) |
| Explosion damage | half the explosion's damage, unrounded, like splash |
| Poison and movement | -1 movement only above 1 (game logic), so a 1-move unit still moves 1 |
| Perfection bonus | score × (1 + round(handicap/5 + ln(opponents)/ln(11.4), 2)) |
| Meeting a tribe | wiki formula: 1 + 2★ per 1,000 score, at most 11 |
| Market income | +1★ per adjacent building level, at most 8 |
| Port reach | range 5; ocean links need Sailing |
| Ice Bank | 2★ per 20 frozen tiles |
| Glide on ice | 0.9 movement per ice step |
| Luxidoor capital | level 3 (game data) |
| Sanctuary | a new animal every 2 turns (game data) |
| Ruin placement | never next to a capital or a village |
| Unit stats | the unit-page value (the doc's "Used here"), e.g. Pirate movement 2 |
| Unlocking techs | the tech-page value in the doc |
| Bot capital income | a bot capital makes 1/2/3/5★ in total for Easy/Normal/Hard/Crazy (Normal = a human capital) |
| Creep and zone of control | the doc contradicts itself (Terrain and Cloak sections: Creep ignores it; Movement rules: only Sneak, Hide and invisibility do). The engine follows Movement rules; Cloak and Dinghy ignore it through Hide anyway |
| Escape | after attacking, the unit may move again with its full movement |
| Stomp | half the damage, unrounded, like splash |

## Not found in any source (engine choice)

- Units of a tribe that loses its last city are removed.
- Perfection ties: the lower player index wins.
- Ruin rewards: an even draw among the eligible rewards.
- A unit on a mountain sees 5×5.
- No star cap, no unit upkeep.
- When the only human is eliminated, the game ends; the leading surviving bot is recorded as winner.
- Map size: Perfection 16 and Domination 11/14/16/18 are the defaults and are forced in the
  settings screen; scripts may still pass an explicit size.
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

## Aquarion and spawn multipliers (engine choices)

The doc names these mechanics but not every number; the engine uses:

- Flooding: the land (fields, forests) of the Aquarion area is flooded at map
  generation; settlements and mountains never are. Waterways adds Flood Tile
  (3★) on own dry land; Construction gives other tribes Landfill (3★) and
  Aquarion Fertilize (3★, a crop on an empty flooded field). Costs are not in
  the doc.
- Water movement for Aquarion: amphibious units need Riding for shallow water
  and Free Spirit (Free Diving) for ocean; its water units swim shallow water
  from the start and need Free Spirit for ocean.
- Bubbles need Waterways. Tentacles deal the Jelly's normal attack damage, no
  retaliation; Drench floods the target's tile (attacks target units, so an
  empty tile can't be drenched).
- Atoll (Aquaculture, 5★, +1 population) on own water links own cities and
  atolls within 3 tiles. Aqua Crops spawn on shallow water without fish at the
  crop rate, only in games with an Aquarion; Aqua Farm (Aquaculture) 5★, +2.
- Lost City: the ruin tile becomes a village any tribe can capture; capturing
  it gives a level-3 city with a wall. Its 4 orthogonal ocean neighbours turn
  shallow. A Scuba's infiltration spawns Mermaid Daggers (Dagger + Amphibious).
- Water multipliers (Kickoo 2, Aquarion 1.5) scale the water share of the
  capital's area, scaled down together if the map total would leave the map
  type's range; on Continents and Pangea (capitals picked after terrain) they
  have no effect. Kickoo and Aquarion get 2 fish next to the capital on every
  map type. Cymanti areas get spores instead of crops, at least 2 next to the
  capital, and Fungi are built on spores. Bardur keeps no fruit bias (the
  table's value; only its own page says 1.5).

## 2.18 data corrections: core rules

Source: the game's own rules data from build 2.18.0.16751 and the replay engine
of [polybots-engine](https://github.com/polybots-dev/polybots-engine) (Apache-2.0;
the logic below follows polybots-engine). The data itself is not copied into
this repository. Tests: `__tests__/engine/parity-218-core.test.ts`.

| Rule | Old behaviour | New behaviour |
| --- | --- | --- |
| Healing | only the Recover action healed | also automatic at the end of the owner's turn for every damaged or poisoned unit that neither moved, attacked nor acted and isn't frozen (Centipede segments excepted): 4 HP in own or a peace partner's territory, 2 elsewhere; a poisoned unit loses the poison and heals 0 |
| Luxidoor | level-2 capital | level-3 capital (2★ start unchanged) |
| Buildings on resources | a building that needs no resource (Forge, Lumber Hut, temples, Port, monuments) only on a tile without one | allowed on an unharvested resource; the resource stays underneath and can't be harvested while the building stands |
| Embassy | 5★, not while at war | 4★ + 2★ per embassy the builder already has; allowed at war; pays nothing to either side while at war; a wiped tribe's embassies end |
| City score | 100 + 5·pop + Σ(5·l + max(0, 50 − 5·l)) per level | 50 × (level + 1) + 5 per population point toward the next level (same up to level 10, no drop after); negative population costs 105 per point, city part floored at 0 |
| Perfection bonus | 1 + 0.41·ln(opponents) + d | 1 + round(handicap/5 + ln(opponents)/ln(11.4), 2), handicap 0/1/2/4 |
| Domination rating | none | `dominationRating`: mean of speed min(1, 10·opponents/turns), battle (kills+1)/(losses+kills+1), destroyed tribes/opponents, difficulty 25/50/75/100%; stars at 20/70/95%, halo at 100%; shown on the game-over screen |
| Weekly Challenge | none | `createGame({ turnLimit })` sets the last Perfection turn (default 30); the challenge is Perfection with turnLimit 20 and a fixed seed |
| Market | sum of adjacent upgrade-building levels | each adjacent Windmill/Sawmill/Forge counts its level, at least 1 (cap 8 unchanged) |
| Infiltrate units | attack 0 | attack 2 (game data) but they never attack units, only infiltrate cities |

Unit data checked against the game data (cost, HP, attack, defence, movement,
range, skills) for every unit in `logic/engine/data.ts`. Fixed:

| Unit | Old | New |
| --- | --- | --- |
| Siren | 8★ | 5★ |
| Crab | movement 1 | movement 2 |
| Mooni | movement 1, Static | movement 2, not Static (can be promoted) |
| Battle Sled | movement 2 (3 when starting on ice) | movement 3 (Skate still ends the move on leaving ice) |
| Ice Fortress | movement 1 | movement 2 |
| Boomchi | movement 1, range 1 | movement 2, range 0 (it can't attack, only explode) |
| Amphibian | Fortify | no Fortify |
| Moth | attack 0 | attack 2, Scout |
| Cloak, Scuba, Dinghy | attack 0 | attack 2 (unused, see above) |
| Dinghy | Creep | no Creep; Dash, Scout, Static |
| Pirate | Independent | not Independent |
| Insect Egg | 0★, range 1, Independent | 2★ (score), range 0, not Independent |
| Larva | 0★ | 2★ (score) |
| Raft, Dragon Egg | range 0 | range 2, 1 (attack 0, so unused) |

Checked and already matching: every regular unit, every other special unit
(Phychi attack 0.7 is the game's value), boats' HP (the passenger's), the tech
tree (tiers and parents of all 25 regular techs; tech price tier·cities + 4,
Literacy ×0.66666), researching a parent of an owned tech, every regular
building's cost, tech and terrain (Forge on field or forest, Burn Forest 3★,
temples 100 points per level up to 5 levels every 2 turns, Polytaur 3★),
starting stars (Xin-xi, Hoodrick, Quetzali, Yădakk 7; Oumaji 6; Luxidoor 2;
others 5), Ai-Mo's Philosophy and Mind Bender, poison halving the defence
bonus, Creep not ignoring zone of control, meeting stars 1 + 2·min(ceil(score
/ 1000), 5), the bot capital bonus, a wiped tribe's units disbanded, ties to
the earlier slot, no star cap.

Left to the special-tribe and map work: the special tribes' tech trees and
buildings (for example Sanctuary also on mountains, and Polaris and Cymanti
movement techs), and starting resources (Luxidoor's 8).
