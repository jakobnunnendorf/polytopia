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
| Splash damage | corrected (second core audit): half the damage rounded down to whole HP, ranged units only; a poisoning splash only poisons |
| Explosion damage | corrected (second core audit): half the damage rounded down, like splash |
| Poison and movement | -1 movement only above 1 (game logic), so a 1-move unit still moves 1 |
| Perfection bonus | score × (100 + difficulty part 0/20/40/80 + opponent table 0/20/30/37/42/46/49/52/54/57/59/60/62/64/65 for 1..15 opponents) / 100, read off the app's setup screen (25 Nov 2026) |
| Meeting a tribe | wiki formula: 1 + 2★ per 1,000 score, at most 11; base 3 when meeting the first seat in a 2-player game (second core audit) |
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
| Stomp | corrected (second core audit): half the damage rounded down, like splash |

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
  previous one. Corrected (second core audit): infiltration, capturing a
  city, moving onto another tribe's city, stomp hits and explosion hits start
  a war too; splash does not.
- Hostile: shown during the cease-fire after a broken treaty; neutral or war
  after it.
- Peace offers: one pending offer per sender and receiver; an offer the
  receiver doesn't answer on its turn lapses. Offering is allowed at war and
  during a cease-fire.
- Peace partners: their units don't besiege each other's cities, can be
  passed through (not stopped on), and splash, stomp and explosion damage
  skip them. Polaris freezing and Fungi poison are not changed here.
- Corrected (second core audit): a move whose destination holds a hidden
  enemy reveals it; the mover stays and its move is not spent. Passing through
  a hidden unit's tile is silent.
- Daggers: city, then forest or mountain (mountain only with Climbing), then
  other land in the city's borders, then water as Pirates.
- Bot opinions follow the game's own model, per a community decompile of a
  pre-February-2024 build (raphael-64/polyterra-env); POLYTOPIA_RULES.md, What
  bots think of you, lists every term. Ported: all thirteen terms with their
  constants, the level thresholds (great > 2, decent > 0.5, poor < -0.5,
  horrible < -2), accept peace above 2, offer when opinion x roll > 2 (the roll
  is a hash of game seed, turn, bot and tribe), break below 0 when
  -500 x opinion - 200 per own unit inside the partner's borders is positive,
  and aggression (-1000 x opinion) as a (1 - opinion) factor on the greedy
  bots' positive attack scores. To support it the state records the turn of
  each meeting (`metTurns`) and of the last broken treaty per pair
  (`diplomacy.brokenTurns`); older saves count earlier meetings as turn 0.
  Not ported: the AI's other uses of aggression (capture and city-target
  mission scores, embassy scores, the -1000 position penalty for standing in
  a disliked partner's land; our greedy bots have no matching scores), the
  difficulty noise (StupidFactor, +-25 x max(0, 2 - handicap); 0 on Hard and
  Crazy), the Shaman "boosted" effect in the military sum, and the game's
  caching (it refreshes opinions at set moments and keeps eliminated tribes'
  old entries, which can absorb the -0.5 Annoying; we compute them fresh from
  the state, living tribes only). Opinions of a tribe that was never met
  and never attacked are 0 (indifferent), as in the game.

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
- Tentacles deal the Jelly's normal attack damage, no retaliation (who strikes
  when: see "Special tribes, audit 2" below); Drench floods the target's tile
  (attacks target units, so an empty tile can't be drenched).
- Aqua Crops: see the map table below (on every map, only Aquarion sees them).
  A Scuba's infiltration spawns Mermaid Daggers (Dagger + Amphibious).
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
| Aqua Crops | crop rate on shallow water when an Aquarion plays | rolled on every map (0.3) and kept on every map, also without an Aquarion (audit 2: S1 never removes them); only Aquarion sees them (`resourceVisible`) |
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
| Perfection bonus | 1 + 0.41·ln(opponents) + d (old wiki formula, maximum 291%) | (100 + difficulty 0/20/40/80 + a 15-entry opponent table) / 100, maximum 245%; the table is the app's setup screen of 25 Nov 2026 (`perfection_bonus_percent`, data.rs); the engine's earlier `round(handicap/5 + ln(opponents)/ln(11.4), 2)` was the pre-2024 build |
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

## 2.18 data corrections: second core audit

Source: polybots-engine (Apache-2.0), `src/*.rs`, and the game's 2.18 rules
data (not copied here). Tests: `__tests__/engine/parity-audit2-core.test.ts`.
Each line: rule: old behaviour -> new behaviour (reference file::function).

| Rule | Old behaviour | New behaviour |
| --- | --- | --- |
| Perfection end | over when turn > maxTurns (31 rounds, turns 0..30) | over when the round counter reaches maxTurns right after the wrap: turns 0..29 (Weekly Challenge 0..19); the UI shows the turns left (turns.rs::winner) |
| Glory end | at the end of a turn | right after any action that brings a score to 10,000 (step.rs::add_score) |
| Damage formula | float forces, round half up | integer arithmetic in tenths of HP with truncating divisions and round_damage (combat.rs::battle) |
| Splash, stomp, explosion | half the damage, unrounded | floor(damage / 2) in whole HP (attack.rs::half_damage) |
| Splash | any splash unit, poison added to the damage | only units with range > 1; an attacker with Poison (Exida) only poisons the neighbours (attack.rs::attack_command) |
| Explosion | only with an adjacent enemy, not after the unit is done; hit units of peace partners | any time except the turn the unit was created (a Centipede segment even then) or while frozen, no target needed; skips peace partners; each hit starts war and resets Pacifist (cymanti.rs::can_explode, explode) |
| Breaking peace | units in the victim's land destroyed | also every other unit of the breaker is spent for the turn (step.rs Diplomacy::BreakPeace) |
| Roads | not on a tile with any building, ruin or lighthouse | refused only on a road, city, village or bridge: farms, huts, other buildings and ruins take a road (menu.rs::can_build) |
| Builds and Destroy | allowed under an enemy unit | refused on a tile with a visible unit of a tribe not at peace; Destroy refuses a bridge with any unit on it (menu.rs::can_build, improvement_abilities_into) |
| Grow | at the start of the owner's turn by turns lived (egg 3, baby 6; insect egg 1, larva 4) | at the end of the owner's turn when turn - createdTurn >= growth rate (3, 3; 1, 3), each stage restarting the count (turns.rs::end_command, grow; units.rs::upgrade) |
| Cloak infiltration | not on the turn it became hidden | after a move too (Dash), hidden or not (combat.rs::attacks_into) |
| Unit score | ships scored only the passenger; super units 50 | 5 × (unit cost + passenger cost) for every unit (units.rs::unit_score) |
| Disband refund | floor(passenger or unit cost / 2) | floor((boat + passenger cost) / 2), only when the total is above 1 (step.rs::disband) |
| Pacifist count | reset by any attack (even 0 damage, or on a hidden unit) | reset to 0 by an attack that deals damage to a visible unit, a stomp hit, an explosion hit or a freeze; every end of turn then adds 1 (attack.rs::reset_peace, turns.rs::end_turn) |
| War triggers | attacks and conversions | also infiltration, capture of a city, moving onto another tribe's city, stomp and explosion hits (step.rs::attack_diplomacy call sites) |
| Hidden enemy on a move | stopped before it on the path, move spent | only a hidden unit on the destination matters: it is revealed, the mover stays and keeps its move; passing through is silent (step.rs Command::Move) |
| Explorer | 15 steps, sight 1, water needed Sailing, ocean Navigation | 12 steps, sight 2 when it steps on a mountain, explored tiles only on terrain the player can move on (Climbing mountain, Fishing water, Sailing ocean); fog may be entered (reward.rs::scout; its scoring and hash are not ported) |
| Ruin rewards | population needed a capital; free tech only tier 1 or a child of a known tech; explorer not on mountains; veteran unit always | population and resources always; the veteran unit on land, the veteran boat on water only with ocean movement (Sailing); a free tech among every researchable tech (also an unknown parent of a known tech); explorer when a neighbour has terrain the player can move on and fog lies within 2, mountains included (ruins.rs::select_reward) |
| Aquatism on ice | 1.5 defence on ice | none: ice is its own terrain (combat.rs::defence_bonus) |
| Algae | stopped every non-ship | stops only units that don't swim: ships and amphibious units pass, flying units and Creep too (movement.rs::step_cost) |
| City connections | own or neutral tiles, explored only | no explored tiles needed; a step onto another tribe's tile is allowed from an unowned tile, the same owner's tile or a peace partner's; water links may cross peace partners' water (routes.rs::owners_allow, accessible) |
| Meeting stars | 1 + 2 per 1,000 score | base 3 instead of 1 when meeting the first seat in a 2-player game (explore.rs::meet_action) |
| Infiltration kills | no kill credited | a defender killed by infiltration counts for the infiltrating player (kills, Killer task; attack.rs::perform_attack) |

## 2.18 data corrections: special tribes

Source S1: the game's own 2.18 data (GameLogicData, build 2.18.0.16751) as read
by polybots-engine, and that engine's rules. Logic follows polybots-engine
(Apache-2.0, github.com/polybots-dev/polybots-engine); no data file of it is
copied here. Each line: rule: old behaviour -> new behaviour.

Aquarion
- Water movement: Riding gave shallow water, Free Spirit ocean -> the starting
  tech Aquabase gives amphibious units shallow water, Marine Life (the Sailing
  slot) ocean; Aquarion ships (Shark, Jelly, Puffer) swim water, ocean and
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
  tile it may stand on, fanning out from the opposite of the tail's facing;
  see audit 2). When a chain member dies, the unit behind it becomes a
  Centipede (see audit 2).

Polaris
- Ice Bank income min(30, 2 x floor(count / 20))★ -> 2★ per level, level =
  min(30, floor(count / 20)); count = ice tiles plus Polaris land over the
  whole board. Polaris land at the start: map generation's 3×3 around the
  capital only (audit 2). Ice Bank on field or ice, once per player ever.

Elyrion
- Sanctuary replaces Clear Forest (was: Clear Forest removed, Sanctuary extra);
  on field, forest or mountain next to an own forest; 1★ per adjacent own tile
  with a wild animal and no building, at most 8 (was: any tile, uncapped).
  Every 2 turns an animal on the first adjacent own empty forest, x-major from
  the north-west (was: a random one, any owner).

Not done (left open)
- Aquarion home climate starts flooded and Cymanti's 2 starting spores belong
  to map generation.

## Special tribes, audit 2

Each line: rule: old behaviour -> new behaviour (reference file:function in
polybots-engine). Tests: `__tests__/engine/parity-audit2-tribes.test.ts`.

Centipede chains. A chain is a head and its Segments (`bodyOf` = head id, in
`s.units` order = chain order); `movement.ts` `leaderOf`/`followerOf`.
- Explode on a body part: only that Segment -> its follower explodes too, so
  the whole tail goes (each blast right after the one in front, the order of
  S1's action stack); the unit in front lets go and keeps the rest
  (cymanti.rs:explode).
- Segments: moved on their own and could attack, capture, examine, recover,
  disband -> a unit led by another has no move, attack, capture, examine,
  recover, disband or Break Ice options; when the head (or an advancing head)
  moves, the follower 2+ tiles behind steps into the head's old tile, and so
  down the chain, each step setting off what a move does (step.rs:move_action;
  menu.rs, combat.rs:attack_options, attack.rs:option_writes). Chain speed:
  1 while it has Segments -> the head's movement capped by its first
  Segment's (movement.rs:moves, movement_range). A chain member never embarks
  (movement.rs:embarks). Disbanding a head disbands its body too, each part
  paid (step.rs disband).
- Killed chain member: only a dead head handed over -> any killed unit with a
  follower: the follower becomes a Centipede (keeping its missing HP, taking
  the dead unit's spent flags) and leads the units behind it; the unit in
  front lets go, so a dead middle Segment splits the body (attack.rs:kill,
  units.rs:upgrade).
- Eat: fanned from the opposite of the head's facing -> of the tail's own
  facing (a new unit faces the middle of the board, units.rs:facing); no
  Segment for a wild unit, of which the engine has none (linked.rs:eat,
  attack.rs:attack_command).

Cymanti
- Kiton: `poisonDefence` (poisoned every attacker, ranged ones too) -> plain
  Poison: its attacks and its retaliation poison; `poisonDefence` removed
  (game data, units.kiton).
- Swarm: a fresh Shaman, every own neighbour -> the Shaman only needs to be
  able to move; neighbours already Swift and units led in a chain are
  skipped; Swift (+1 movement) is lost whenever the unit is hit, retaliation
  included (was kept on retaliation) (cymanti.rs swarm options, menu.rs,
  attack.rs:perform_attack).
- Creep: algae ended a creeping unit's move -> a Creep step costs 1 on water
  and non-mountain land before the algae and slow checks, so algae don't stop
  it (movement.rs:step_cost).

Aquarion
- Tentacles: every enemy Jelly next to a mover struck it; a moving Jelly hit
  every non-own neighbour -> only the healthiest unfrozen adjacent Jelly of a
  tribe not at peace strikes the mover, once; a Jelly's own strike skips its
  own and peace partners' units and also fires when it is trained and when it
  advances on a kill (aquarion.rs:strike, attack.rs:area_damage,
  units.rs:train).
- Advance after a kill: no move effects -> Stomp, Tentacles, Auto Freeze and
  Auto Flood fire on it as on a move (not on a push) (step.rs:move_action
  reason 1).

Pushes (a unit pushed off a tile for a spawn: Super Unit, Enchant Animal,
New Friends ruin; `actions.ts` `pushAside`, `state.ts` `pushUnit`).
- A pushed chain member moved like any unit (the way it faces, or the
  opposite for an enemy) -> it is pushed along the chain: toward its leader,
  its follower, or the average of the two (opposite ones: the leader's
  direction turned a quarter) (units.rs:try_push, average).
- A pushed unit set off nothing -> it turns the way it was pushed, and poison
  buildings, Bubbles and the Tentacles strike fire on its new tile (none of
  its own move effects: Stomp, Auto Freeze, Auto Flood, a Jelly's strike);
  a follower 2+ tiles behind steps into its old tile, and when that is the
  spawn tile it is pushed out again before the spawn (step.rs:move_action
  reason 2; units.rs:train on an occupied tile). Tests 17-18.

Polaris
- Freeze Area: land only outside enemy territory -> no territory check: a
  freezable tile is explored open water, flooded land or land that is not
  Polaris land yet; ice and Polaris land only with an unfrozen visible enemy
  on it (polaris.rs:freezable, freeze_area).
- Auto Freeze (Mooni, Gaami moving): water to ice only -> the same Freeze
  Area, land turns Polaris too (step.rs:move_action, polaris.rs:freeze_area).
- Break Ice: Dash units of other tribes, one empty ice tile at a time ->
  any unit not led in a chain that hasn't attacked (and hasn't moved unless
  it dashes), without Auto Freeze, Polaris included; one action breaks every
  breakable ice tile around (empty, holding a swimmer, flyer or unseen enemy,
  or with algae or a bridge; a hidden enemy is revealed instead); broken ice
  becomes ocean, or shallow water when a land tile is orthogonally next to it
  (polaris.rs:can_break_ice, break_ice_area, break_ice). The action is now
  `{ type: "breakIce", unitId }`.
- Escape for skaters: tested on the tile it attacked from -> on its final
  tile, after any advance (attack.rs:attack_command).
- Starting Polaris land: `createGame` marked all land nearest a Polaris
  capital -> only map generation's 3×3 around the capital
  (mapgen_candidate.rs:populate).

Conversion
- An Independent unit converted lost its home (null) -> keeps its own; a
  converted boat converts its passenger, which here is part of the unit
  (attack.rs:convert).

Map
- Aqua Crops: removed from maps without an Aquarion -> kept, hidden from
  other tribes (mapgen_candidate.rs, no removal).

Checked against the reference, no change
- Fertilize on wetland that holds a non-crop resource: allowed, the crop
  replaces it; not on a crop (menu.rs:can_build, "creates").
- Fungi level cap: 1, 2 with Microbes (Recycling) (economy.rs:level_for);
  already so.
- Harvest Spores (3★, +1 population) is in the 2.18 data, but no tech or
  tribe unlocks it, so it can't be reached in 2.18; left out.
- Quetzali start with S1's `shields`, the tech that unlocks the Defender and
  peace treaties: our `strategy`, only the name differs.
