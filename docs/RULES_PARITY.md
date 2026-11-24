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
- City score above level 3 (the doc only says "falling"): level bonus max(0, 50 − 5·level).
- When the only human is eliminated, the game ends; the leading surviving bot is recorded as winner.
- Buildings that need no resource (Forge, temples, monuments included) go on a tile without one.
- Map size: Perfection 16 and Domination 11/14/16/18 are the defaults and are forced in the
  settings screen; scripts may still pass an explicit size.
- Luxidoor: the doc's starting-score table (515) assumes a level-3 capital; with the level-2
  capital it chose, Luxidoor starts at 465.
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
- Water multipliers (Kickoo 2, Aquarion 1.5) scale the water share of the
  capital's area, scaled down together if the map total would leave the map
  type's range; on Continents and Pangea (capitals picked after terrain) they
  have no effect. Kickoo and Aquarion get 2 fish next to the capital on every
  map type. Cymanti areas get spores instead of crops, at least 2 next to the
  capital, and Fungi are built on spores. Bardur keeps no fruit bias (the
  table's value; only its own page says 1.5).

## 2.18 data corrections

Source S1: the game's own 2.18 data (GameLogicData, build 2.18.0.16751) as read
by polybots-engine, and that engine's rules. Logic follows polybots-engine
(Apache-2.0, github.com/polybots-dev/polybots-engine); no data file of it is
copied here. Each line: rule: old behaviour -> new behaviour.

### Special tribes

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
