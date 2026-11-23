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
| Unit stats | the unit-table value in the doc |
| Unlocking techs | the tech-page value in the doc |
| Bot capital income | 1/2/3/5★ for Easy/Normal/Hard/Crazy |

## Not found in any source (engine choice)

- Units of a tribe that loses its last city are removed.
- Perfection ties: the lower player index wins.
- Ruin rewards: an even draw among the eligible rewards.
- A unit on a mountain sees 5×5.
- No star cap, no unit upkeep.

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
