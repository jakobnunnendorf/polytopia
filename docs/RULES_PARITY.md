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

- Flooding at map generation: see "2.18 data corrections". Waterways adds Flood Tile
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
