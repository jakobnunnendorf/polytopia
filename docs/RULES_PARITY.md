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
  generation; settlements and mountains never are. Canal, Fertilize, drain,
  water movement and the Lost City follow 2.18 now (see "2.18 data
  corrections" below).
- Tentacles deal the Jelly's normal attack damage, no retaliation; Drench
  floods the target's tile (attacks target units, so an empty tile can't be
  drenched).
- Aqua Crops spawn on shallow water without fish at the crop rate, only in
  games with an Aquarion. A Scuba's infiltration spawns Mermaid Daggers
  (Dagger + Amphibious).
- Map generation spawns (water multipliers, starting fish and spores,
  flooding): replaced by the 2.18 generator, see "2.18 data corrections".

## 2.18 data corrections

Map generation follows polybots-engine (Apache-2.0), `src/mapgen*.rs`, which
replays the 2.18 generator; `logic/engine/mapgen.ts` ports it. Our random
generator differs, so maps match in distribution, not tile for tile.

| Rule | Old behaviour | New behaviour (2.18) |
| --- | --- | --- |
| Water share | wiki ranges, value noise, Water World land only at cities | one noise sample per tile, smoothed (0-2 passes), water = wetness quantile: Drylands 0, Lakes 0.3, Continents/Pangea 0.5, Archipelago 0.65, Water World 0.85 |
| Capitals | uniform tile in a random quadrant | weighted to the domain centre (cubic peaks), 2 tiles off the edge; Continents/Pangea: island path (continents grown from seeds, capitals picked among their villages, farthest apart) |
| Suburbs and early villages | Lakes/Archipelago 0-2 suburbs at ring 3, early batch 0.3 / 0.1 | 1-2 suburbs per capital (none on Drylands, Water World) joined by a land corridor; pre-terrain villages (budget − suburbs) × 0.3 (Water World 0.1, Drylands 0) |
| Villages | every fitting land tile | budget floor(0.33·width)² − players (16×16, 4 players: 21), no other city within 2, not on the edge; Continents/Pangea also wetness·tiles/50 open-water villages |
| Terrain | 48/38/14 per nearest-capital area | per tribe climate grown from the capital (land first): exact quotas field 0.5 : mountain 0.15 : forest 0.4 times the tribe's terrain modifiers |
| Resources | per-terrain wiki rates, fish on half of the water within 2 | the inner ring always rolls, ring 2 with chance 1/3, none further; fruit/crop/game/fish 0.5, metal 0.8, aqua crop 0.3, times the tribe's modifiers; one of the passing resources that fit the terrain is kept |
| Starting resources | only Kickoo/Aquarion fish, Cymanti spores | every tribe's list next to the capital (`startResources` in data.ts: e.g. Bardur 2 game, Imperius 2 fruit, Vengir 1 metal, Luxidoor 8), turning a tile's terrain if needed (Kickoo fish on Drylands) |
| Tribe modifiers | Aquarion water 1.5, Cymanti spores replace crops in its area | Aquarion forest 0.5, crop 0.5, aqua crop 1.5; Cymanti mountain 1.2, spores 0.3 (field, forest), crop 0; Oumaji water 0.5 recorded; water modifiers (Kickoo 2) are in the data but the generator never reads them |
| Aquarion flooding | land of the nearest-capital area, not settlements | every field and forest of the Aquarion home climate, its cities and villages included |
| Polaris | nothing at map generation | grows no climate of its own (alien climate); the water next to its capital starts as ice, its land neighbours Polaris land |
| Ruins | wiki count, not on resources, at most a third on water on Lakes | tiles/40 + 1 (same counts), none within 2 of another ruin or a capital, none next to a village, water ruins only on ocean away from cities |
| Starfish | one per 25 water tiles | up to ceil(wetness·tiles/25) (none on Drylands), none next to a starfish or a city |
| Aqua Crops | crop rate on shallow water when an Aquarion plays | rolled on every map (0.3), kept only when an Aquarion plays (only Aquarion sees them) |
| Fairness | none | up to 50 candidate maps; the one with the lowest turf inequality (richest/poorest turf) is kept, stopping early below 1.01 |

Engine extensions: more than 4 players use ceil(sqrt(players))² domains, and
an empty capital range on a small map is widened to the whole domain.

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

## 2.18 data corrections: special tribes

Source S1: the game's own 2.18 data (GameLogicData, build 2.18.0.16751) as read
by polybots-engine, and that engine's rules. Logic follows polybots-engine
(Apache-2.0, github.com/polybots-dev/polybots-engine); no data file of it is
copied here. Each line: rule: old behaviour -> new behaviour.

Aquarion
- Water movement: Riding gave shallow water, Free Spirit ocean -> the starting
  tech Aquabase gives amphibious units shallow water, Marine Life (the Sailing
  slot) ocean; Aquarion ships (Shark, Jelly, Aquapult) swim water, ocean and
  flooded land with no tech (their own terrain list). Riding and Free Spirit
  give no water.
- Flood Tile (3★ build on own land) -> Canal (Waterways, 0★): built by an own
  unit standing on a field or forest that has not moved and can attack, in any
  territory, also over a building; not on a flooded tile; the unit's turn ends,
  the tile floods.
- Landfill (3★ build, other tribes) -> no Landfill. "Drain" (Clear Tile
  Effect) is a unit action: a unit that can still move and attack, of a tribe
  that does not flood (not Aquarion), amphibious or not a swimmer, clears
  Flooded under it; Algae is cleared the same way by a unit that can move or
  attack and swims, flies or is amphibious. Free; the unit is spent.
- Fertilize 3★ on an empty flooded field -> 5★ on wetland (a flooded tile or
  algae water, never a forest) that has no crop.
- Atoll +1 population on water -> no population, on water, ocean or flooded
  land (still a 3-tile network node).
- Aqua Farm: Windmills now count it like a Farm.
- Pontoon (Aquabase): Aquarion may build Windmill, Sawmill, Forge and Market on
  water.
- Ports: Aquarion had ports on flooded land -> no Port (Aquafishing unlocks
  only Fishing).
- Bubble: also when the unit's tile floods (Canal, Drench, Auto Flood by a
  player with Waterways, whoever owns the amphibious unit); lost when attacked
  or stepping on dry land that is not flooded.
- Capture: a city or village captured by Aquarion floods, by anyone else
  drains (its tile becomes field).
- Unit replacements: Rammer -> Shark, Bomber -> Jelly, Dagger -> Mermaid
  Dagger added (Shark and Jelly were extra units).
- Lost City: a random ruin reward that left a capturable level-3 walled
  village with 4 shallow tiles -> always the reward on a valid ocean ruin
  (unowned, off the edge, no city, village or ruin within 2): a level-1 city
  of the examiner on a flooded field, the 8 tiles around turn shallow (not
  ice). S1 also places resources around it; the engine does not.

Cymanti
- Fungi +3 population on spore fields/forests -> +1 population on any spores
  tile, then one level a turn (+1 population each) to level 1, level 2 with
  Microbes (Recycling, the Construction slot).
- Fungi and Clathrus poison: only enemy units not at peace -> every unit that
  steps on them unless its tribe is Cymanti or it flies (no owner or peace
  check).
- Clathrus on spores, +1★ per adjacent algae, uncapped -> any terrain, next to
  an own Fungi, one per city, 1★ per adjacent own Fungi, at most 8.
- Mycelium: heal at the start of the turn of adjacent units -> at the end of
  the owner's turn, 4 HP to the own unit on it and own units next to it
  (poisoned units are cured instead); one per city; also on algae water.
- Decompose (Recycling): new action on an own building that is not
  decomposing yet and holds no visible enemy; at the end of the owner's turn
  the full cost is paid back and the building is removed (its population
  goes, a resource it needs comes back). A bridge with a unit on it waits.
  The observation has a `decomposing` plane.
- Spores: only on empty land, algae on water -> spores on any tile that is not
  a city or village (replacing a resource), and algae too on water.
- Algae (Fishing, replaces the Port): 5★ on open water without algae, adds a
  fruit. No Windmill, Burn Forest or Bridge (Recycling replaces Construction).
- Moth infiltration: no riot, defender only poisoned -> the city rebels (no
  income next turn, no stars), the defender takes the Moth's hit and is
  poisoned if it survives; Eggs as before (city level, at most 5).
- Centipede: a Segment only when it advanced into the killed unit's tile ->
  every kill by attack grows a Segment behind the body's tail (the first free
  tile it may stand on, fanning out from the opposite of the head's facing).
  When the head dies the first Segment becomes the Centipede and leads the
  rest.

Polaris
- Ice Bank income min(30, 2 x floor(count / 20))★ -> 2★ per level, level =
  min(30, floor(count / 20)); count = ice tiles plus Polaris land over the
  whole board. A new game marks the land of the Polaris area (nearest capital,
  as map generation) as Polaris land. Ice Bank on field or ice, once per
  player ever.

Elyrion
- Sanctuary replaces Clear Forest (was: Clear Forest removed, Sanctuary extra);
  on field, forest or mountain next to an own forest; 1★ per adjacent own tile
  with a wild animal and no building, at most 8 (was: any tile, uncapped).
  Every 2 turns an animal on the first adjacent own empty forest, x-major from
  the north-west (was: a random one, any owner).

Not done (left open)
- Centipede segments still move on their own; in S1 only the head moves and
  the body follows. A dying middle segment keeps the rest in the body.
- Harvest Spores (3★, +1 population) exists in the 2.18 data but no tech
  unlocks it; left out.
- Aquarion home climate starts flooded and Cymanti's 2 starting spores belong
  to map generation.
