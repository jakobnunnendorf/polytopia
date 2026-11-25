# The Battle of Polytopia: rules and game logic

Nov 23, 2026 · exported from the Claude Doc https://claude.ai/artifact/L4zqyQC7y4nj1EZu1Pevwm (revision 24); the online doc is the source of truth

## About this reference

This is a reference for every rule and mechanic of The Battle of Polytopia (Midjiwan) that public sources describe, as of November 2026. Numbers describe the current version of the game; rules that changed in an update say which version they belong to.

- **Sources:** the community wiki, the official site and help pages, official patch notes, and player guides on Reddit and Steam. Each section links the pages its numbers come from, and the full list is under Sources at the end.
- **Conflicts:** where sources disagree, a section gives the value most sources agree on and lists the alternative under Open questions.
- **(unconfirmed)** marks a value found in only one source, or one no source states clearly.
- **Wording:** everything is summarised in plain words; no text or art from the game or the wiki is copied.

## Game setup, modes and victory

A game is set by map size, map type, number of opponents, their difficulty and the mode. Perfection (30 turns, highest score) and Domination (beat everyone) are the single-player modes; Glory and Might are multiplayer-only. Main source: the official wiki at [wiki.polytopia.com](https://wiki.polytopia.com/wiki/Game_Modes), current to version 2.18 (November 2026).

### Map sizes

| Size | Grid | Tiles | Ruins | Extra island villages (Continents, Pangea) |
| --- | --- | --- | --- | --- |
| Tiny | 11×11 | 121 | 4 | 0 |
| Small | 14×14 | 196 | 5 | 1 |
| Normal | 16×16 | 256 | 7 | 2 |
| Large | 18×18 | 324 | 9 | 3 |
| Huge | 20×20 | 400 | 11 | 4 |
| Massive | 30×30 | 900 | 23 | 9 |

- **Players:** Tiny holds at most 9 tribes; every other size holds up to 16. Single-player allows up to 15 opponents (one fewer than the number of tribes) since version 2.0; before that the cap was 9.
- **Size forced by mode:** Perfection always plays on Normal. Domination picks the size from the opponent count: 1 → Tiny, 2 → Small, 3 → Normal, 4 or more → Large. Huge and Massive are only in Creative and multiplayer. ([Map generation](https://wiki.polytopia.com/wiki/Map_Generation))
- **Other settings** (since 2.0): the water amount (map type), mirror matches with several players on one tribe, and disabling tribes so opponents can't be them.
- **Starting stars** (since the 2025 Balance Pass): 5★ for most tribes; 7★ for Xin-xi, Hoodrick, Quetzali and Yădakk; 6★ for Oumaji; 2★ for Luxidoor, which starts with a level-3 capital instead. ([2025 Balance Pass](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1810503566363587))

### Modes

| Mode | Where | How it ends | How it is rated |
| --- | --- | --- | --- |
| Perfection | Single-player | After 30 turns; highest score wins | Final score × the difficulty bonus (see Scoring). 3,000 points earns 1 star, 10,000 2 stars, 50,000 3 stars, 100,000 a halo. Weekly high scores reset on Mondays |
| Domination | Single-player | When every opponent has lost all its cities | Four equal parts: speed (full marks at 10 turns or fewer per enemy), battle skill (kills+1)/(losses+kills+1), share of tribes you destroyed yourself, and difficulty. 20% earns 1 star, 70% 2, 95% 3, 100% a halo |
| Creative | Single-player | Your choice: Perfection scoring, Domination scoring, or Infinity (no end) | Any opponent count (0 allowed), water amount and size |
| Glory | Multiplayer | First to the point target, 10,000 by default (other targets selectable since 2.2.3). If several pass it in one turn, the highest score at the end of that turn wins | — |
| Might | Multiplayer | Capture every tribe's capital; other cities don't count | Game Stats ranks tribes by capitals held |
| Weekly Challenge | Single-player (since 2.12, March 2025) | 20 turns, Perfection scoring; everyone gets the same seed, tribe, opponents and settings | League tables (below) |
| Boot Camp | First game for new players | A guided 14×14 Lakes map: Imperius against one Easy Xin-xi, starting with 6★ and no warrior | — |

- **Weekly Challenge:**
  - Unlocks after 5 finished games; you don't need to own the featured tribe.
  - Leagues are Entry, Bronze, Silver and Gold, with bots from Easy in Entry to Crazy in Gold on the same seed.
  - Each week the top third moves up and the bottom third down. You can be demoted only in a week you played, and never back into Entry. ([2.12 notes](https://wiki.polytopia.com/wiki/Whatsnew-weekly-challenges))
- **Multiplayer:**
  - The host sets the mode, size and opponents; bots of mixed difficulty can fill seats.
  - **Pass & Play** is local on one device and free.
  - **Online** needs at least one bought tribe. It offers random lobbies, friend games, Elo ratings (since 2.0.58) and tournaments.
  - Turn order is random at the start of lobby games (since late 2022).
- **Turn timers:**
  - **Live games** work like a chess clock: under a minute at the start, unused time carries over, and every city and unit adds time.
  - A player whose time runs out is skipped. After 3 skips they are kicked, and their tribe stays on the map but acts only when attacked.
  - Slower games use 24-hour or 7-day turn limits.
- **Defeat:** a tribe is out when it has lost all its cities. Losing only the capital doesn't eliminate it, except that capitals decide Might. ([City](https://wiki.polytopia.com/wiki/City))

## Map, terrain, resources and exploration

The map is a square grid with six types that differ by water share, from Drylands (almost none) to Water World (almost all). The generator places capitals first, then villages, terrain, resources, ruins and starfish. ([Map generation](https://wiki.polytopia.com/wiki/Map_Generation))

### Map types

| Type | Water share | Shape |
| --- | --- | --- |
| Drylands | 0–10% | Almost no water; Kickoo and Aquarion capitals still get 2 water tiles with fish |
| Lakes | 25–30% | Inland lakes, a ring of land bridges at the edge; every player can walk to at least 2 villages |
| Pangea (since 2.8, November 2023) | 40–60% | One central landmass ringed by ocean |
| Continents | 40–70% | Separate landmasses; since 2.8 each tribe gets its own, or spawns share a few split by 1-tile channels |
| Archipelago | 60–80% | Irregular islands; almost every city is coastal |
| Water World | 90–100% | Land only where cities stand; 1–2 villages per landmass |

### How the map is generated

1. **Capitals.**
   - Drylands, Lakes, Archipelago and Water World split the map into quadrants: 4 for 1–4 players, 9 for 5–9, 16 for 10–16. Each capital lands in a free quadrant, picked with weighted chance.
   - Continents and Pangea turn some villages into capitals instead, as far apart as possible and near the coast.
2. **Villages.**
   - Lakes and Archipelago add 0–2 suburb villages near each capital.
   - An early batch follows: ((⌊width / 3⌋)² − capitals − suburbs) × a coefficient, 0.3 on Lakes and Archipelago and 0.1 on Water World.
   - After terrain, villages are added at random until no valid tile is left; all Drylands villages come this way.
   - No village is within 2 tiles of another village or on the map edge.
3. **Terrain and resources.** Resources spawn only within 2 tiles of a city or village. The land share per terrain is fixed; tribe multipliers (see Tribes) shift it.
4. **Ruins.**
   - Ruins go on fields, forests, mountains or deep ocean, never on shallow water.
   - They are never next to another ruin. The wiki's pages disagree on whether the other neighbour ruled out is a capital or a village.
   - On Lakes at most a third of the ruins are on water.
5. **Starfish and lighthouses.**
   - About 1 starfish per 25 water tiles, never next to another starfish, a lighthouse or a city.
   - One lighthouse in each of the 4 corners.

| Land tile | Near a city or village | Away from them |
| --- | --- | --- |
| Field | 48%: fruit 18, crop 18, empty 12 | 48%: fruit 6, crop 6, empty 36 |
| Forest | 38%: animal 19, empty 19 | 38%: animal 6, empty 32 |
| Mountain | 14%: metal 11, empty 3 | 14%: metal 3, empty 11 |

Fish are on half the shallow-water tiles, and also on ocean since 2.8.

### Terrain

| Terrain | Movement | Defence ×1.5 with | Resources and what harvesting gives |
| --- | --- | --- | --- |
| Field | 1 | — | Fruit (Organization: 2★, +1 population); crop (Farm via Farming: 5★, +2 population). Cymanti find spores instead of crops |
| Forest | Entering ends the move, except road to road | Archery | Animals (Hunting: 2★, +1 population); Lumber Hut (Forestry: 3★, +1 population) |
| Mountain | Needs Climbing; entering always ends the move; no roads | Climbing | Metal (Mine via Mining: 5★, +2 population). A unit on a mountain sees 5×5 (fan guide, unconfirmed) |
| Shallow water | Needs Fishing; land units board at your own port or a peaceful tribe's port and become a Raft | Aquatism | Fish (Fishing: 2★, +1 population), starfish, Cymanti algae |
| Ocean | Needs Sailing | Aquatism | Fish (since 2.8), starfish, ruins |
| Ice (Polaris) | 1 per step, 0.9 with Glide (sources differ) | none found | Ice Bank stars per 20 frozen tiles |
| Flooded (Aquarion) | Land and water units both move on it; ships stop on it | not stated | Fertilize grows crops on flooded fields |
| Clouds (unexplored) | Cannot be entered | — | — |

- **General movement:**
  - A step costs 1. A step from road to road costs 0.5, and cities, villages and bridges count as road.
  - A unit can always take one more step while it has any movement left.
- **Zone of control:** stepping onto any of the 8 tiles around an enemy ends the move. Enemies hidden in clouds still exert it. Creep units ignore it. ([Movement](https://wiki.polytopia.com/wiki/Movement))
- **Defence bonuses:**
  - A terrain bonus multiplies the defender's defence by 1.5; a city wall multiplies it by 4.
  - The city bonus applies only to units with Fortify, in cities you own, and never to a unit besieging one. ([Combat](https://wiki.polytopia.com/wiki/Combat))
- **Starfish:** harvesting needs Navigation (Polaris: Polar Warfare; Cymanti: Oceanology) and works in any territory. It gives 8★ (10★ before February 2024). Whales were removed in 2.8 and starfish took their place.

### Ruins and exploration

- **Examining a ruin:** a unit must start its turn on the ruin, and examining it ends that turn. The reward is drawn evenly from those whose conditions are met; no odds are published. ([Ruin](https://wiki.polytopia.com/wiki/Ruin))

| Ruin reward | Effect | Only when |
| --- | --- | --- |
| Resources | +10★ | always possible |
| Scrolls of Wisdom | A random free tech among those you could research now | Tech tree not finished |
| Population | +3 population in your capital | You own a capital |
| Explorer | A free Explorer | Unexplored tiles in the 5×5 around the ruin; never from mountain ruins |
| New Friends | A veteran Swordsman (a Giant before September 2021) | Land ruin |
| Rammer | A veteran Rammer (since February 2024) | Water ruin |
| Lost City | A level-3 city with a wall and 4 shallow-water tiles around it | Aquarion, ocean ruin |

- **Vision:**
  - Units reveal the 3×3 area around them; Scout units reveal 5×5.
  - Elyrion see ruins through clouds.
  - The Diplomacy tech shows every met tribe's capital.
- **Explorer:** an Explorer makes 15 automatic moves, each toward the nearest fog. It prefers paths that uncover the most and heads for lighthouses first. ([Explorer](https://wiki.polytopia.com/wiki/Explorer))
- **Lighthouses:**
  - The first tribe to uncover a lighthouse gets +1 population in its capital and its colour on it.
  - Lighthouses can't be built on or destroyed, and always start under clouds.
  - Finding all 4 completes the Explorer task, which unlocks the Eye of God. ([Lighthouse](https://wiki.polytopia.com/wiki/Lighthouse))

## Turns, stars and tech cost

Stars are the only currency. At the start of each turn you collect every city's income plus building and embassy income. You then train units, research techs and build in any order, and each unit acts once. The figures below match the game's own data file, version 28 of June 2026. ([game data dump](https://github.com/usemsedge/biblical_greed/tree/main/polytopia_extracted/gamelogic), [Star](https://wiki.polytopia.com/wiki/Star))

### Income per turn

- **One city:** 1 + (level − 1) + 1 for a Workshop + 1 per Park. Your original capital adds +1, so a human's level-1 capital makes 2★. Bots' capitals make 1, 2, 3 or 5★ by difficulty instead.
- **Penalties:** each point of negative population costs that city 1★. A city never makes less than 0★. An enemy unit standing on a city (a siege) cuts its income to 0.
- **Whole tribe:** all city income, plus Markets, plus tribe buildings (Sanctuary, Clathrus, Ice Bank), plus embassies (2★ each way, 4★ at peace).
- **Parks** have given +1★ per turn since November 2023; before that they gave only score.
- **No star cap** is mentioned in any source (unconfirmed).

### One-off stars

| Source | Stars |
| --- | --- |
| Ruin: Resources | +10 |
| Starfish (Navigation) | +8 (10 before February 2024) |
| City level 3 reward: Resources | +5 |
| Clear Forest (Forestry) | +1 (2 before May 2022) |
| Disbanding a unit (Free Spirit) | Half its cost, rounded down |
| Meeting a tribe | 1 + 2 per 1,000 of its score, rounded up, at most 11 (wiki formula, unconfirmed) |
| Embassy, Infiltration | See Diplomacy |

### Tech cost

A tech's price grows with its tier and with the number of cities you own, so wide empires pay more per tech. Philosophy's Literacy takes a third off (a fifth before February 2021).

```latex
\text{price} = \left\lceil (4 + \text{tier} \times \text{cities}) \times m \right\rceil, \qquad m = 1 \text{, or } \tfrac{2}{3} \text{ with Literacy}
```

| Cities | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| 1 | 5★ | 6★ | 7★ |
| 2 | 6★ | 8★ | 10★ |
| 3 | 7★ | 10★ | 13★ |
| 5 | 9★ | 14★ | 19★ |
| 10 | 14★ | 24★ | 34★ |

Each tech is worth 100 × its tier in score. Since the 2025 Balance Pass you may research a tech if you already own one after it in the tree; for example, Smithery leads back to Mining without Climbing.

## Cities

Cities make your stars, house your units and grow by population. A city at level L needs L+1 population to reach the next level, and each level-up gives +1★ per turn, +1 unit slot and a choice of two rewards. ([City](https://wiki.polytopia.com/wiki/City), [Population](https://wiki.polytopia.com/wiki/Population))

### Capturing

- **Who can capture:** any unit that starts its turn on a village or enemy city and hasn't moved or attacked yet. Capturing ends the unit's turn. You can't capture from a tribe you are at peace with.
- **A village** becomes your level-1 city, with a 3×3 border and 1★ per turn.
- **An enemy city** keeps its level, population and rewards (Workshop, wall, parks).
  - You take all its tiles and buildings. Their score moves to you: 20 per tile plus each building's points.
  - The capturing unit's home becomes that city.
  - Units that had the captured city as home lose it, so they no longer use any city's unit slots.
  - Road connections through the lost land are cut, and the population they gave goes with them (it can go negative).
- **Siege:** an enemy unit standing on a city cuts its income to 0.
- **Elimination:** a tribe that loses its last city is out.

### Levels and rewards

| Reaching level | Population needed | Option A | Option B |
| --- | --- | --- | --- |
| 2 | 2 | Workshop: +1★ per turn | Explorer: a free unit that makes 15 automatic moves into the fog |
| 3 | 3 | City Wall: ×4 defence for fortified units in the city | Resources: +5★ |
| 4 | 4 | Population Growth: +3 population | Border Growth: border from 3×3 to 5×5 |
| 5 and every later level | level | Park: +250 score and +1★ per turn | Super unit: a Giant (Aquarion Crab, Elyrion Dragon Egg, Polaris Gaami, Cymanti Centipede) |

- **Unit slots:** a city supports level + 1 units. Independent units (Dagger, Polytaur, Larva, Segments) take no slot.
- **Score:** a city is worth 100 points, plus about 50 per level above 1.
- **Super units:** a new super unit pushes besiegers out of the city.
- **Border Growth:** offered only at level 4, so a 5×5 border is the largest.
- **Population sources:** harvesting and buildings (see Buildings), connections, monuments (+3), temples (+1), ruins (+3 in the capital) and lighthouses (+1 in the capital).

### The capital and connections

- **Capital:** the starting city. It makes +1★ more than other cities, and bots' capitals make more or less by difficulty (see AI).
- **Luxidoor** starts with an upgraded capital: level 2 since April 2021, with a cosmetic park; level 3 with a wall before that. The 2025 notes say only "upgraded", and one wiki summary says level 3.
- **Connections:** a city linked to the capital gives +1 population to both cities.
  - A link can run over roads, bridges or ports; for some special tribes, over Outposts, Mycelium or Atolls.
  - Breaking the link takes both points away again.
  - Roads work in your own, neutral and allied territory, never in enemy territory.
  - Ports link to other ports within range 5 (game data; the wiki pages say 4 or 5 water tiles).
- **Network task:** connecting 5 cities to the capital earns the Grand Bazaar monument. The task starts by itself at your first connection (since November 2023). ([City connection](https://wiki.polytopia.com/wiki/City_Connection))

## Tech tree

The standard tree has 25 techs: 5 at tier 1, 10 at tier 2 and 10 at tier 3. Without any tech, every tribe can already train Warriors, move on fields and forests, and turn units into Rafts at a port. ([Technology](https://wiki.polytopia.com/wiki/Technology), game data version 28)

**Standard tech tree · 25 techs in 3 tiers** (the diagram from the online doc as a table; every row is one chain, tier 1 → tier 2 → tier 3; special tribes swap some techs)

| Tier 1 (4★ + 1★ per city) | Tier 2 (4★ + 2★ per city) | Tier 3 (4★ + 3★ per city) |
| --- | --- | --- |
| **Riding**: Rider | Roads: Road, Bridge | Trade: Market, Wealth task |
| **Riding** | Free Spirit: Temple, Disband | Chivalry: Knight, Destroy |
| **Organization**: harvest fruit, see crops | Farming: Farm | Construction: Windmill, Burn Forest |
| **Organization** | Strategy: Defender, peace treaty | Diplomacy: Cloak, Embassy, Capital Vision |
| **Fishing**: Port, shallow water | Sailing: Scout, ocean movement | Navigation: Bomber, starfish harvest |
| **Fishing** | Ramming: Rammer | Aquatism: Water Temple, water defence |
| **Hunting**: hunt wild animals | Archery: Archer, forest defence | Spiritualism: Forest Temple, Grow Forest |
| **Hunting** | Forestry: Lumber Hut, Clear Forest | Mathematics: Catapult, Sawmill |
| **Climbing**: mountains, see metal | Mining: Mine | Smithery: Swordsman, Forge |
| **Climbing** | Meditation: Mountain Temple, Pacifist task | Philosophy: Mind Bender, Literacy, Genius task |

Read it left to right: each tier-1 tech unlocks two tier-2 techs, and each of those unlocks one tier-3 tech. Since September 2025 you may also research a tech if you own one further along its chain. Strategy is still called "shields" in the game data, and Ramming was named Aquaculture until August 2024. Starting techs are listed under Tribes, and the special tribes' replacements under each special tribe.

## Improvements and buildings

Buildings turn stars into population, and population levels up cities. Every improvement sits on a tile inside your borders. Values are from the game's data file, version 28, with dated changes noted. ([Buildings](https://wiki.polytopia.com/wiki/Buildings), [PolyMod data reference](https://github.com/PolyModdingTeam/PolyMod/tree/main/docs/gld))

### Harvesting and basic buildings

| Improvement | Cost | Tech | Placement | Effect |
| --- | --- | --- | --- | --- |
| Harvest Fruit | 2★ | Organization | Fruit on a field | +1 population; the fruit is used up |
| Hunting | 2★ | Hunting | Wild animal in a forest | +1 population; used up |
| Fishing | 2★ | Fishing | Fish on shallow water or ocean | +1 population; used up |
| Farm | 5★ | Farming | Crop on a field | +2 population |
| Mine | 5★ | Mining | Metal on a mountain | +2 population |
| Lumber Hut | 3★ (2★ before November 2023) | Forestry | Forest | +1 population |
| Port | 7★ (10★ before November 2023) | Fishing | Shallow water or a flooded tile | +1 population (was 2); land units entering it become Rafts; links to ports within range 5 |
| Road | 3★ (2★ before November 2023) | Roads | Field or forest, own or neutral land | Road movement; links cities |
| Bridge | 5★ (7★ at launch in November 2023) | Roads | One shallow-water tile, straight across | Land units cross; links cities |

### Upgrade buildings

You can build only one of each per city, and each grows with the matching buildings next to it, up to 8 levels.

| Building | Cost | Tech | Must stand next to | Effect |
| --- | --- | --- | --- | --- |
| Windmill | 5★ | Construction | A farm (on a field) | +1 population per adjacent farm |
| Sawmill | 5★ | Mathematics | A lumber hut (on a field) | +1 population per adjacent lumber hut |
| Forge | 5★ | Smithery | A mine (on a field, or a forest since September 2025) | +2 population per adjacent mine |
| Market | 5★ | Trade | A windmill, sawmill or forge (on a field) | +1★ per turn for each level of each adjacent windmill, sawmill or forge, at most 8★ |

The Market replaced the Customs House (+2★ per adjacent port) in November 2023. It got its current rule in February 2024. Some wiki pages still show the older rule of 2★ per adjacent building.

### Terrain actions

| Action | Cost | Tech | Effect |
| --- | --- | --- | --- |
| Clear Forest | free | Forestry | Forest becomes a field; +1★ |
| Burn Forest | 3★ (5★ from February 2024, 3★ since September 2025) | Construction (Chivalry before February 2024) | Forest becomes a field with a crop |
| Grow Forest | 5★ | Spiritualism | Field becomes forest |
| Destroy | free | Chivalry (Construction before February 2024) | Removes your own building; its score and population are lost |
| Harvest Starfish | free | Navigation | A unit standing on it collects 8★, in any territory |

### Temples

A temple gives +1 population and 100 points when built, then gains a level every 2 turns (3 before February 2024), up to level 5. Each level adds 100 points (50 before September 2025), so a full temple is worth 500.

| Temple | Cost | Tech | Placement |
| --- | --- | --- | --- |
| Temple | 20★ | Free Spirit | Field |
| Forest Temple | 15★ | Spiritualism | Forest |
| Mountain Temple | 20★ | Meditation | Mountain |
| Water Temple | 20★ | Aquatism | Shallow water or ocean |
| Ice Temple (Polaris) | 20★ | Polarism | Ice |

### Monuments

A monument is free and gives +3 population and 400 points. It goes on a field or shallow water inside your borders, and each tribe can build each one once per game, after finishing its task (see Scoring).

### Removed

- **Customs House:** replaced by the Market in November 2023.
- **Whaling and whale hunting** (+10★): removed in November 2023, replaced by starfish. Whales are still in the data file, but nothing can harvest them.

## Units

Units are trained in cities for stars, and each unlocks with one tech. Every unit has HP, attack, defence, movement and range plus a set of skills (next section). Unit stats last changed in 2.15 (October 2025); versions 2.16 to 2.18 left them alone. Main source: [Units](https://wiki.polytopia.com/wiki/Units) and each unit's own page.

### Regular land units

| Unit | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warrior | 2★ | 10 | 2 | 2 | 1 | 1 | Dash, Fortify | none |
| Archer | 3★ | 10 | 2 | 1 | 1 | 2 | Dash, Fortify | Archery |
| Defender | 3★ | 15 | 1 | 3 | 1 | 1 | Fortify | Strategy |
| Rider | 3★ | 10 | 2 | 1 | 2 | 1 | Dash, Escape, Fortify | Riding |
| Swordsman | 5★ | 15 | 3 | 3 | 1 | 1 | Dash | Smithery |
| Mind Bender | 5★ | 10 | 0 | 1 | 1 | 1 | Heal, Convert, Stiff | Philosophy |
| Catapult | 8★ | 10 | 4 | 0 | 1 | 3 | Stiff | Mathematics |
| Knight | 8★ | 10 | 3.5 | 1 | 3 | 1 | Dash, Persist, Fortify | Chivalry |
| Cloak | 8★ | 5 | 0 (2 when infiltrating) | 0.5 | 2 | 1 | Hide, Creep, Infiltrate, Dash, Stiff, Scout, Static | Diplomacy |
| Dagger | not trained | 10 | 2 | 2 | 1 | 1 | Dash, Surprise, Independent, Static | Spawned by infiltration |
| Giant | super unit | 40 | 5 | 4 | 1 | 1 | Static | City reward at level 5 or higher |

The Swordsman lost Fortify in 2.8. The Knight went to 10★ in 2021, then back to 8★ with 15 → 10 HP in 2022. A hidden Bunny (20 HP, attack 5) appears if you tap an empty tile of your own 10 times; it can't be converted and isn't in multiplayer. ([Knight](https://wiki.polytopia.com/wiki/Knight), [Bunny](https://wiki.polytopia.com/wiki/Bunny))

### Naval units (current system, since November 2023)

A land unit that enters your port becomes a Raft, and paying stars upgrades it. A ship's HP is the HP of the unit it carries: 10 for a Warrior, 15 for a Defender, 20 for a veteran Swordsman. ([Path of the Ocean](https://wiki.polytopia.com/wiki/Whatsnew-path-of-the-ocean))

| Unit | Cost | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Raft | free (enter a port) | 0 | 1 | 2 | — | Water, Carry, Stiff, Static | Fishing |
| Scout | +5★ from a Raft | 2 | 1 | 3 | 2 | Water, Dash, Carry, Scout, Static | Sailing |
| Rammer | +5★ from a Raft | 3 | 3 | 3 | 1 | Water, Dash, Carry, Static | Ramming |
| Bomber | +15★ from a Raft | 3 | 2 | 2 | 3 | Water, Carry, Splash, Stiff, Static | Navigation |
| Juggernaut | a Giant entering a port | 4 | 4 | 2 | 1 | Water, Carry, Stiff, Stomp, Static (40 HP) | — |
| Dinghy | a Cloak entering a port | 0 | 0.5 | 2 | 1 | Water, Carry, Hide, Creep, Infiltrate, Stiff (5 HP) | — |
| Pirate | a Dagger on water | 2 | 2 | 1 (2 per its page) | 1 | Water, Carry, Dash, Surprise, Independent, Static (10 HP) | — |

- **Upgrades:** only in your own or an ally's territory, and they don't heal. Bomber attack was cut from 4 to 3 in February 2024.
- **Leaving the water:** moving onto land removes the upgrade for good; the next port makes a Raft again.

**The old system, removed in 2.8 (November 2023):** a unit in a port became a Boat (attack 1, defence 1, move 2, range 2). It upgraded to a Ship for 5★ (2/2/3, range 2) and to a Battleship for 15★ more (4/3/3, range 2, Scout). Elyrion enchanted whales into the Navalon (30 HP, 4/4/3). Earlier removed units: the Guard Tower and an Oumaji Scout. ([Boat](https://wiki.polytopia.com/wiki/Boat), [Battleship](https://wiki.polytopia.com/wiki/Battleship))

### Aquarion units (after the 2.10 rework, August 2024)

Most Aquarion units are amphibious versions of the regular ones, with the same stats.

| Unit (replaces) | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mermaid (Warrior) | 2★ | 10 | 2 | 2 | 1 | 1 | Dash, Fortify, Amphibious | none |
| Amphibian (Rider) | 3★ | 10 | 2 | 1 | 2 | 1 | Amphibious, Dash, Escape, Fortify | Riding |
| Mermaid Archer | 3★ | 10 | 2 | 1 | 1 | 2 | Dash, Fortify, Amphibious | Archery (unconfirmed) |
| Mermaid Defender | 3★ | 15 | 1 | 3 | 1 | 1 | Fortify, Amphibious | Strategy (unconfirmed) |
| Swordsmaid | 5★ | 15 | 3 | 3 | 1 | 1 | Dash, Amphibious | Smithery (unconfirmed) |
| Siren (Mind Bender) | 8★ (unconfirmed) | 10 | 0 | 1 | 1 | 1 | Heal, Convert, Amphibious, Stiff | Philosophy (unconfirmed) |
| Scuba (Cloak) | 8★ | 5 | 0 | 0.5 | 2 | 1 | Cloak skills plus Amphibious | Diplomacy (unconfirmed) |
| Shark | 8★ | 10 | 3.5 | 2 | 3 | 1 | Dash, Surprise, Water | Marine Life |
| Jelly (Bomber) | 8★ | 20 | 2 (0 in the unit list) | 2 | 2 | 1 | Tentacles, Water, Stiff, Static | Navigation |
| Puffer (Catapult) | 8★ | 10 | 4 | 0 | 2 | 3 | Drench, Water, Stiff | Mathematics |
| Tridention (Knight) | 8★ | 10 | 2.5 | 1 | 2 | 2 | Dash, Persist, Amphibious | Spearing (Chivalry per its infobox) |
| Crab | super unit | 40 | 4 | 4 (5 per older pages) | 1 | 1 | Amphibious, Escape, Auto Flood, Static | City reward |

### Elyrion units

| Unit | Cost | HP | Attack | Defence | Move | Range | Skills | How you get it |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Polytaur | 3★ | 15 | 3 | 1 | 1 | 1 | Dash, Fortify, Independent, Static | Enchant a wild animal (Forest Magic) |
| Dragon Egg | super unit | 10 | 0 | 2 | 1 | — | Grow, Fortify, Stiff, Static | City reward; hatches after 3 turns |
| Baby Dragon | grows | 15 | 3 | 3 | 2 | 1 | Air, Grow, Dash, Escape, Scout, Static | Grows from the egg; 3 turns later becomes |
| Fire Dragon | grows | 20 | 4 | 3 | 3 | 2 | Air, Dash, Splash (when attacking only), Scout, Static | the adult |

### Polaris units

| Unit | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mooni | 5★ | 10 | 0 | 1 | 1 | 1 | Skate, Auto Freeze, Stiff, Static | Frostwork (starting tech; starting unit) |
| Ice Archer | 3★ | 10 | 1 | 1 | 1 | 2 | Dash, Freeze, Fortify, Stiff | Archery |
| Battle Sled | 5★ | 15 | 3 | 2 | 2 (3 on ice) | 1 | Dash, Escape, Skate | Sledding |
| Ice Fortress | 15★ | 20 | 4 | 3 | 1 | 2 | Skate, Scout, Escape, Static | Polar Warfare |
| Gaami | super unit | 30 | 4 | 3 | 1 | 1 | Auto Freeze, Freeze Area, Static | City reward |

The 2025 Balance Pass raised Ice Archer attack from 0.1 to 1, cut Battle Sled ice movement from 4 to 3, and gave the Ice Fortress Escape and Static. ([2025 Balance Pass](https://wiki.polytopia.com/wiki/Whatsnew-balance-adjustments-2025))

### Cymanti units (after the 2.15 rework, October 2025)

| Unit (replaces) | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shaman (Mind Bender) | 5★ | 10 | 1 | 1 | 1 | 1 | Parasite, Swarm | Rituals (starting unit) |
| Hexapod (Rider) | 3★ | 5 | 3 | 1 | 2 | 1 | Dash, Escape, Creep, Sneak | Riding |
| Kiton (Defender) | 3★ | 15 | 1 | 3 | 1 | 1 | Poison (on units that attack it), Creep | Strategy |
| Phychi (Archer) | 3★ | 5 | 0.7 | 1 (2 per its page) | 2 | 2 | Air, Dash, Poison, Surprise, Double Attack | Archery |
| Mantis (Swordsman) | 5★ | 15 | 3 | 3 | 1 | 1 | Dash, Creep | Smithery |
| Moth (Cloak) | 5★ | 10 | 0 | 0.1 | 2 | 1 | Air, Dash, Sneak, Infiltrate, Poison, Static, Stiff | Synergy |
| Raychi | 5★ | 10 | 3 | 2 | 3 | 1 | Water, Dash (only from cities next to water) | Pescetism |
| Boomchi | 5★ | 10 | 3 | 3 | 1 (2 per its page) | 1 | Dash, Explode, Stiff, amphibious | Inflation |
| Exida (Catapult) | 8★ | 10 | 3 | 1 | 2 | 3 | Poison, Splash, Creep | Mathematics |
| Doomux (Knight) | 10★ | 20 | 3.5 | 2 | 3 | 1 | Dash, Creep, Explode, Static | Shock Tactics |
| Living Island (Bomber) | 20★ | 20 | 4 | 4 | 2 | 1 | Water, Stomp, Algae, Poison, Static | Oceanology |
| Centipede | super unit | 20 | 4 | 3 | 2 | 1 | Dash, Eat, Creep, Static | City reward |
| Segment | grows | 10 | 2 | 2 | 1 | 1 | Independent, Creep, Explode, Dash, Stiff, Static | Each Centipede kill adds one |
| Insect Egg | spawned | 10 | 2 | 3 | 0 | 1 | Grow, Stiff, Explode, Static | Moth infiltration |
| Larva | grows | 10 | 2 | 2 | 1 | 1 | Dash, Creep, Surprise, Independent, Static, Grow | Hatches from an egg; a Moth 3 turns later |

Converting any segment converts the whole Centipede. A kill made by the Centipede's retaliation adds no segment. ([Centipede](https://wiki.polytopia.com/wiki/Centipede), [Cymanti rework](https://wiki.polytopia.com/wiki/Whatsnew-cymanti-rework))

## Unit skills and movement

A unit normally moves, then attacks, and the turn ends; skills bend that order. Movement points pay for steps, and terrain, roads and enemies change what a step costs. ([Unit abilities](https://wiki.polytopia.com/wiki/Unit_Abilities), [Movement](https://wiki.polytopia.com/wiki/Movement))

### Skills

| Skill | Effect |
| --- | --- |
| Dash | May attack after moving (on Polaris ice it also allows breaking ice) |
| Escape | May move after attacking; a unit with Dash and Escape still attacks only once |
| Persist | May attack again right after a kill, with no limit per turn |
| Double Attack | Two attacks per turn; after the first it can't capture a city or examine a ruin |
| Creep | Forests and other move-ending tiles cost 1; no road bonus; mountains still stop it (since 2.15) |
| Sneak | Ignores zone of control; enemy units still block the path |
| Hide | Invisible after moving; ignores zone of control and may pass through enemies, but not stop on them |
| Air | Ignores terrain and ports, every step costs 1, no roads; zone of control still stops it |
| Water | Moves only on water |
| Amphibious | Moves on land and water, but stops on any dry tile that isn't flooded; no roads (since 2.8) |
| Skate | Ice steps cost 1; on land at most 1 tile, and a turn ending on land allows no attack; Dash and Escape blocked on land |
| Carry | Carries one land unit; reaching land or a city releases it and ends the turn |
| Fortify | Gets the city defence bonus: ×1.5, or ×4 behind walls |
| Stiff | Never retaliates |
| Surprise | Its attacks draw no retaliation |
| Splash | Also damages enemies next to the target, for half the damage (see Combat) |
| Stomp | Damages every adjacent enemy whenever it moves, including a Juggernaut boarding or leaving a port; amount unconfirmed |
| Tentacles | Jelly damages enemies that move next to it, and enemies it moves next to; ranged attacks don't trigger it, freezing switches it off |
| Explode | Destroys the unit and damages and poisons adjacent enemies; leaves spores on land or algae on water; allowed after attacking since 2.15 |
| Convert | Mind Bender: the attacked enemy joins you, keeping its kill count. Counts as an attack and destroys embassies |
| Parasite | The Cymanti Shaman's version of Convert |
| Heal | Heals every adjacent friendly unit by up to 4 HP |
| Swarm | Shaman ends its turn; adjacent friendly units get +1 movement until attacked (replaced Boost in 2.15) |
| Infiltrate | Cloak enters an adjacent enemy city and spawns Daggers (see Diplomacy) |
| Freeze | The attacked enemy is frozen: it can't move, heal, attack or retaliate for a turn |
| Auto Freeze | After moving, freezes adjacent enemies and turns adjacent water to ice |
| Freeze Area | An action: as Auto Freeze, and turns adjacent land into Polaris terrain (not inside enemy cities) |
| Poison | The target's defence halves (bonuses 1, 1.5, 4 become 0.5, 0.7, 2), movement drops by 1 and it can't heal; a heal removes the poison but restores no HP |
| Grow | Turns into another unit after a set number of turns, keeping its damage (since 2.15) |
| Eat | Each kill by attack adds a body segment; while it has segments the Centipede moves only 1 tile |
| Auto Flood / Drench | Floods each tile it moves onto / the tile it attacks, even an empty one |
| Algae | Leaves algae on the tiles it passes |
| Scout | Sees 5×5 instead of 3×3 |
| Independent | Takes no unit slot and belongs to no city |
| Static | Can never become a veteran |

A dead poisoned unit leaves spores (on land) or algae (on water).

### Movement rules

- **Costs:**
  - A step costs 1. A step from road to road costs 0.5.
  - An ice step with Glide costs 0.9; since 2025 Glide gives about one extra tile instead of doubling.
  - A unit may take any step while it has more than 0 points left, even if the step costs more than what remains.
- **Modifiers:** Swarm and Bubble each give +1 (they don't stack); Poison gives −1. Aquarion's Bubble comes from stepping onto a flooded tile and is lost when the unit is attacked or steps onto dry land.
- **Tiles that end the move** (the unit may enter, then stops):
  - a forest, unless moving road to road;
  - a mountain, always (Climbing needed to enter);
  - any tile next to an enemy;
  - a port, where a land unit becomes a Raft;
  - land, for a ship, which turns back into the carried unit;
  - dry land, for amphibious units;
  - flooded tiles, for ships;
  - algae, for land units.
- **Zone of control:**
  - Each enemy controls the 8 tiles around it, and entering one ends the move. It is checked before roads, Glide, Creep or Air.
  - Only Sneak, Hide and invisibility ignore it.
  - Peace partners, hidden units and Centipede segments exert none.
  - Starting your turn inside an enemy's zone doesn't trap you.
- **Passing through:** units may pass through their own and allied units but not stop on them. Enemy units block the path, except for Hide. Clouds can't be entered.
- **Roads:**
  - Both tiles of a step need a road, in your own, neutral or allied territory. Cities, villages and bridges count as road.
  - Roads give no bonus on ice, or to Creep, Skate, Air or swimming units.
  - A Rider covers 4 road tiles, a Knight 6.
- **Water:** shallow-water movement comes from Fishing, ocean from Sailing (for Aquarion, Riding and Free Spirit). Land units enter water only through their own or an ally's port.
- **Pushing:**
  - A unit created on an occupied tile pushes the occupant: a friendly one in the direction it faces, an enemy the opposite way.
  - If that tile is blocked, the game tries the neighbours in turn; with no free tile the pushed unit is removed.
  - Being pushed doesn't use the unit's turn.

## Combat

Damage depends on the attacker's attack and the defender's defence, each scaled by its unit's remaining HP; the defender's force also gets its terrain or city bonus. The attacker's defence and the defender's attack play no part. Both results use the HP from before the hit. ([Combat](https://wiki.polytopia.com/wiki/Combat), checked against the community [battle calculator](https://frothfrenzy.github.io/polytopiacalculator))

```latex
\begin{aligned}
\text{attackForce} &= \text{attack} \times \frac{\text{attacker HP}}{\text{attacker max HP}} \\
\text{defenceForce} &= \text{defence} \times \frac{\text{defender HP}}{\text{defender max HP}} \times \text{defenceBonus} \\
\text{total} &= \text{attackForce} + \text{defenceForce} \\
\text{damage} &= \operatorname{round}\left(\frac{\text{attackForce}}{\text{total}} \times \text{attack} \times 4.5\right) \\
\text{retaliation} &= \operatorname{round}\left(\frac{\text{defenceForce}}{\text{total}} \times \text{defence} \times 4.5\right)
\end{aligned}
```

The bonus raises defenceForce but not the final ×4.5 term. So a defence-2 unit with a ×1.5 bonus takes the same damage as a defence-3 unit without one, but hits back less hard. Rounding is to the nearest whole number.

### Defence bonus

| Situation | Bonus | Poisoned |
| --- | --- | --- |
| No bonus | 1 | 0.5 |
| Forest (with Archery), mountain (with Climbing), shallow water or ocean (with Aquatism), or your own city for a unit with Fortify | 1.5 | 0.7 |
| City with walls, for a unit with Fortify | 4 | 2 |

Villages you haven't captured give no bonus. A unit besieging a city gets none, and units without Fortify get no city bonus.

### Retaliation, kills and splash

- **No retaliation when:**
  - the defender dies;
  - the attacker is out of the defender's range, or in fog;
  - the retaliation rounds to 0;
  - the defender has Stiff, or the attacker has Surprise.
- **After a kill:**
  - A melee attacker moves into the tile if it can stand there, and entering its own port makes it a Raft.
  - A ranged attacker never moves in, even from next door.
- **Splash and explosions:**
  - Each neighbour takes half the attack's damage, unrounded, so an odd result gives .5.
  - The map shows that .5 rounded up and the info box rounded down; the wiki calls this a bug. Two unit pages say the half is rounded down.
- **Veterans:**
  - After 3 kills, by attack or retaliation, a unit can be promoted: +5 max HP and a full heal.
  - The promotion can be held back and used later as a heal.
  - Ships, super units, Daggers, Pirates, Polytaurs and every Static unit can't be promoted.
- **Healing:** a unit that neither moves nor attacks can recover 4 HP in friendly or allied territory, or 2 HP elsewhere, never above its maximum. A Mind Bender heals its neighbours 4 each. Poison blocks healing.

### Worked examples

| Fight | Forces (attack : defence) | Damage | Retaliation |
| --- | --- | --- | --- |
| Warrior attacks a Warrior, both full HP, open field | 2 : 2 | round(2/4 × 9) = 5 | round(2/4 × 9) = 5 |
| Warrior attacks a full Defender behind walls (×4) | 2 : 12 | round(2/14 × 9) = 1 | round(12/14 × 13.5) = 12, so the Warrior dies |
| Catapult attacks a full Swordsman in a forest (×1.5) from 3 tiles | 4 : 4.5 | round(4/8.5 × 18) = 8 | none: out of range |
| Knight attacks an Archer at 4 of 10 HP | 3.5 : 0.4 | round(3.5/3.9 × 15.75) = 14, a kill | none; the Knight moves in and Persist lets it attack again |

## Tribes

There are 16 tribes: 12 regular ones that share the standard rules and differ only in start and map, and 4 special ones with their own units, techs and terrain. No tribe has been added since Cymanti in February 2021. ([Tribes](https://wiki.polytopia.com/wiki/Tribes))

### Regular tribes

| Tribe | Starting tech | Starting unit | Stars | Map bias (multiplier on the base rate) |
| --- | --- | --- | --- | --- |
| Xin-xi | Climbing | Warrior | 7 | Mountains 1.5, metal 1.5 |
| Imperius | Organization | Warrior | 5 | Fruit 2, animals 0.5 |
| Bardur | Hunting | Warrior | 5 | Forest 0.8, no crops (its own page adds fruit 1.5) |
| Oumaji | Riding | Rider | 6 | Forest 0.2, animals 0.2, mountains 0.5 |
| Kickoo | Fishing | Warrior | 5 | Water 2, fish 1.5, mountains 0.5; 2 fish next to the capital |
| Hoodrick | Archery | Archer | 7 | Forest 1.5, mountains 0.5 |
| Luxidoor | none | Warrior | 2 | Base rates; starts with an upgraded capital |
| Vengir | Smithery (tier 3) | Swordsman | 5 | Metal 2; animals, fruit and fish 0.1 |
| Zebasi | Farming | Warrior | 5 | Mountains, forest and fruit 0.5 |
| Ai-Mo | Philosophy (Meditation before September 2025) | Mind Bender (Warrior before) | 5 | Mountains 1.5, crops 0.1 |
| Quetzali | Strategy | Defender | 7 | Fruit 2, crops 0.1 |
| Yădakk | Roads | Warrior | 7 | Fruit 1.5, mountains 0.5, forest 0.5 |

Bardur, Imperius, Kickoo and Zebasi can level up their capital on turn 0 with their starting tech. Since 2025 Vengir can research backwards from Smithery to Mining without Climbing. ([Map generation](https://wiki.polytopia.com/wiki/Map_Generation), [2025 Balance Pass](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1810503566363587))

### Special tribes

| Tribe | Starting tech | Starting unit | Stars | Released | Terrain |
| --- | --- | --- | --- | --- | --- |
| Aquarion | none (water movement built in) | Mermaid | 5 | June 2017; reworked August 2024 | Own land is flooded; forest 0.5, water 1.5; 2 fish at the capital |
| Elyrion (∑∫ỹriȱŋ) | Forest Magic | Warrior | 5 | May 2018 | Crops 1.5, mountains 0.5 |
| Polaris | Frostwork | Mooni | 5 | June 2019 | No land of its own; it freezes the land and water around it |
| Cymanti | Farming (gives Fungi, not Farms) | Shaman | 5 | February 2021; reworked October 2025 | Mountains 1.2; spores instead of crops, at least 2 at the capital |

Their units are listed under Units.

#### Aquarion

- **Amphibious:** every land unit is amphibious, and none can build or use roads.
- **Flooded tiles:** both land and water units can use them; for ships they end the move. Aquarion may build land improvements on water.
- **Atoll:** replaces roads and links cities within 3 tiles over water (+1 population, 5★).
- **Aqua Crops:** only Aquarion sees them. An Aqua Farm (5★) gives +2 population.
- **Fertilize** replaces Burn Forest and grows crops on flooded fields.
- **Bubbles:** an amphibious unit entering a flooded tile gets +1 movement (since November 2024).
- **Lost Cities:** a water ruin can turn into a city that any tribe can capture.
- **Landfill:** every other tribe can use it, to deal with flooded land.

| Regular tech | Aquarion tech | Unlocks |
| --- | --- | --- |
| Roads | Waterways | Flooding land, Bubbles |
| Ramming | Aquaculture | Aqua Farm, Atoll |
| Sailing | Marine Life | Shark |
| Free Spirit | Free Diving | Temple, ocean movement, Disband |
| Chivalry | Spearing | Tridention, Destroy |
| Riding, Construction | same names | Amphibian; Fertilize |

#### Elyrion

- **Forest Magic** replaces Hunting. Elyrion can't hunt; Enchant Animal turns a wild animal into a Polytaur (3★, Independent).
- **Forestry** gives the Lumber Hut and the Sanctuary but no Clear Forest. A Sanctuary costs 5★, gives +1★ per turn per adjacent wild animal, and draws a new animal into a nearby forest every 2 or 3 turns (sources differ).
- **Construction** gives no Burn Forest.
- **Super unit:** a Dragon Egg that hatches into a Baby Dragon and then a Fire Dragon, 3 turns per stage, keeping its damage. An egg on a raft can't hatch.
- **The Navalon** (an enchanted whale) left with the whales in November 2023.
- Elyrion see ruins through clouds.

#### Polaris

- **Freezing:** turns water into ice and land into Polaris terrain. A captured Polaris city's land changes to the captor's style.
- **Frozen units** can't move, attack or retaliate until they thaw.
- **No ports or navy:** land units walk on ice, and skating units take the ship roles. Since November 2023 units with Dash can break ice.
- **Outpost** (5★, on ice): +1 population, links cities.
- **Ice Bank** (20★, one per tribe): 2★ per turn for every 20 frozen tiles on the map, at most 30★. Some pages still say 3★.

| Regular tech | Polaris tech | Unlocks |
| --- | --- | --- |
| Fishing | Frostwork | Mooni, Outpost, shallow-water movement |
| Ramming | Ice Fishing | Fishing |
| Sailing | Sledding | Battle Sled |
| Aquatism | Polarism | Ice Temple, Glide |
| Navigation | Polar Warfare | Ice Fortress, starfish |
| Archery, Trade | same names | Ice Archer; Ice Bank instead of Market |

#### Cymanti

- **Fungi** (from Farming) is built on spores and poisons enemies that step on it, up to level 2 (3 with Microbes).
- **Algae:** a tile effect on water since October 2025. It spawns with a fruit, slows land units but not ships, and allows other buildings on it.
- **Mycelium** replaces roads: it links cities within 3 tiles and heals adjacent units.
- **Clathrus** (Trade) grows from spores, poisons enemies, and earns +1★ per adjacent algae.
- **Poison** halves defence and slows (see Unit skills).
- **Explorer:** the Cymanti Explorer can cross water since 2.15.
- **Monument:** converting 3 enemies replaces the Altar of Peace task.

| Regular tech | Cymanti tech | Unlocks |
| --- | --- | --- |
| Fishing (likely) | Hydrology | Algae, fishing, water movement |
| Ramming | Inflation | Boomchi |
| Sailing | Pescetism | Raychi, ocean movement |
| Navigation | Oceanology | Living Island, starfish |
| Roads | Network | Mycelium |
| Construction | Recycling | Decompose, Microbes |
| Meditation | Rituals | Shaman, the convert task |
| Philosophy | Mysticism | Mountain Temple, Deep Insight, Genius task |
| Chivalry | Shock Tactics | Doomux |
| Diplomacy | Synergy | Moth, Embassy, Capital Vision |

Cymanti Organization doesn't reveal crops. Riding, Archery, Strategy, Mathematics, Smithery and Trade keep their names but unlock Hexapod, Phychi, Kiton, Exida, Mantis and Clathrus. ([Cymanti](https://wiki.polytopia.com/wiki/Cymanti), [Polaris](https://wiki.polytopia.com/wiki/Polaris), [Aquarion rework](https://wiki.polytopia.com/wiki/Whatsnew-aquarion-rework))

### Buying, picking and skins

- **Buying tribes:**
  - On mobile, Xin-xi, Imperius, Bardur and Oumaji are free. Most other regular tribes cost $0.99, Luxidoor $2.99 (or $3.99 per its page), and special tribes $1.99.
  - On Steam and consoles all 12 regular tribes come with the game, and special tribes are $2.99 add-ons.
- **Picking:**
  - Online play needs at least one bought tribe; Pass & Play needs none.
  - Several players can be the same tribe (mirror matches, since 2020).
  - Disabled tribes can't be picked by anyone, including bots.
  - Luxidoor can appear as a bot even if you don't own it.
- **Skins** change only the look. Each regular tribe has one: Sha-po, Lirepacci, Baergøff, Khondor, Ragoo, Yorthwober, Aumux, Cultist, Anzala, To-Lï, Iqaruz and Ürkaz.
- **Special-tribe skins:**
  - Midnight (Elyrion, 2024), Forgotten (Aquarion, 2024), Solaris (Polaris, 2025) and New Dawn (Cymanti, 2025).
  - These also rename units and buildings, for example lava in place of ice for Solaris.
  - Forgotten and New Dawn also change the tribe's colour.

## Diplomacy

Two techs carry diplomacy. Strategy unlocks peace treaties; Diplomacy, a tier-3 tech after Strategy, unlocks embassies, the Cloak and Capital Vision. Both arrived in update 2.2 (May 2022). Strategy was called Shields before that. ([Strategy](https://polytopia.fandom.com/wiki/Strategy), [Diplomacy](https://polytopia.fandom.com/wiki/Diplomacy), [Diplomacy FAQ](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4469272893492663515))

**Capital Vision** (Diplomacy tech): you see the capital of every tribe you have met, including tribes met later and capitals that have been captured. The diplomacy screen also shows who is at peace or at war with whom.

### Peace treaty

- **Offering:** open a tribe's info popup (its name bubble, or its face in Game Stats) and choose Offer Peace. Only the sender needs Strategy. The receiver accepts or declines on its next turn.
- **Effects while at peace:**
  - Neither side can attack, capture the other's cities or convert its units.
  - There is no zone of control between the two tribes, and each can use the other's roads.
  - Embassy income between them doubles.
  - Each sees the other's Cloaks.
  - Units heal 4 HP in the partner's territory, as in their own.
- **Duration:** permanent, until one side breaks it. There is no shared victory: Might and Domination still require beating every rival.
- **Breaking peace:**
  - Every unit of the breaker inside the victim's borders is destroyed, with no refund.
  - A cease-fire follows until the next turn (sources disagree on who exactly is frozen; see Open questions).
  - The relation shows as Hostile.
  - An AI victim keeps a permanent Foolish opinion of the breaker.
- **War and neutral:** two tribes count as at war if either attacked the other within the last turn; otherwise they are neutral. ([Tribe relations](https://polytopia.fandom.com/wiki/Tribe_Relations))

### Embassy

| Rule | Detail |
| --- | --- |
| Building | From the other tribe's diplomacy popup; it appears in their capital at any distance |
| Conditions | Not while at war; only in a capital still held by its original owner; one per tribe; the host cannot refuse, and receiving one makes the host meet the sender |
| Income | +2★ per turn to both sides, +4★ each with a peace treaty; embassies both ways plus peace give each player +8★ per turn |
| Vision | The 3×3 area around the host capital |
| Lost when | Either side attacks the other (both embassies go), or the host capital is captured |
| Cost | 5★ from May 2022; since the 2025 Balance Pass the first is cheaper and later ones cost more (formula unpublished, unconfirmed) |

Sources: [Embassy](https://polytopia.fandom.com/wiki/Embassy), [2025 Balance Pass](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1810503566363587).

### Cloak, infiltration and Daggers

- **Cloak:** 8★, 5 HP, attack 2 (used only when infiltrating), defence 0.5, movement 2, never a veteran. Skills: Hide, Infiltrate, Dash, Scout (5×5 sight), Creep, Stiff, Static. ([Cloak](https://polytopia.fandom.com/wiki/Cloak))
  - **Creep** ignores zone of control and terrain costs but gets no road bonus. Since October 2025 it no longer ignores the mountain penalty.
- **Hidden and visible:**
  - A Cloak is visible on the turn it is trained, and after it captures a village, examines a ruin, breaks ice or harvests a starfish. It hides again once it moves.
  - An enemy trying to enter its tile is stopped, which reveals the Cloak so it can be attacked.
  - Since October 2022 every unit detects an adjacent Cloak. Splash damage does not reveal it.
- **Infiltration:** a Cloak moves into an adjacent enemy city and is used up.
  - The city's defender takes damage from attack 2.
  - The Cloak's owner gets **Daggers equal to the city's level, at most 5.** They spawn in the city if it is empty or its defender died, then on defensive tiles inside the borders, then on water as Pirates. No free tile means no Dagger.
  - The infiltrator takes the city's own star income, and the city produces nothing on its owner's next turn. Market, Ice Bank, Sanctuary and embassy income are untouched.
  - A city can be infiltrated once per turn, never while under siege.
  - A Cloak cannot infiltrate on the turn it became hidden, unless it started that turn hidden.
  - Since November 2023, killing the defender guarantees a Dagger in the city. ([2.2.9 notes](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4588629064110779566))
- **Dagger:** 10 HP, attack 2, defence 2, movement 1. Skills: Dash, Surprise (no retaliation against it), Independent (uses no city unit slot), Static. It cannot be trained or promoted. ([Dagger](https://polytopia.fandom.com/wiki/Dagger))
- **Pirate** (a Dagger on water) moves 2. **Dinghy** (a Cloak on a port) keeps the Cloak's stats. Neither can be upgraded. ([Pirate](https://polytopia.fandom.com/wiki/Pirate), [Dinghy](https://polytopia.fandom.com/wiki/Dinghy))
- **Special tribes:**
  - Aquarion has its own Scuba and Mermaid Dagger.
  - Cymanti have used the **Moth** instead of the Cloak since October 2025: 5★, 10 HP, flies, never hidden. Its infiltration poisons the defender and lays Insect Eggs that hatch into a Larva after 1 turn and a Moth 3 turns later. Per the wiki it steals no stars. ([Moth](https://polytopia.fandom.com/wiki/Moth), [Cymanti rework](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1814942955109414))

### What bots think of you

Each bot rates you horrible, poor, indifferent, decent or great; red flames around its head mean horrible, a halo means great. A bot accepts peace only at **great** (2022 FAQ).

| Raises the opinion | Lowers the opinion |
| --- | --- |
| Wise: you share their friends or enemies | Violent: you attacked them recently |
| Charming: random, more often on easy bots | Threatening: your units are near or inside their land |
| Peaceful: no attacks on them for several turns | Weak: they see fewer of your units than they have |
| Diplomatic: an embassy exists either way | Annoying: a penalty on higher difficulties |
| Powerful: you have more units than they do | Foolish: at war with their friends or at peace with their enemies; permanent after you break a treaty with them |
| Brave: you are at war with the strongest tribe | Intrusive: your borders touch |
|  | Dominating: you are close to winning Domination |

### Meeting tribes and the Altar of Peace

- **Meeting a tribe** pays stars. The current wiki formula is 1★ plus 2★ per 1,000 points of the met tribe's score, rounded up, at most 11★ (unconfirmed by an official source). Before September 2021 a meeting stole a tech instead. Seeing one of a tribe's cities also counts as meeting it. ([Star](https://polytopia.fandom.com/wiki/Star))
- **Altar of Peace** (Meditation): make no attack for 5 turns to earn it: 3 population and 400 points. Retaliation, conversions and infiltration don't count as attacks; Polaris freezing does. Cymanti instead convert 3 enemies with Shamans (October 2025). ([Altar of Peace](https://polytopia.fandom.com/wiki/Altar_of_Peace))

## Scoring

Score decides Perfection, Glory and the Weekly Challenge. It comes from explored tiles, territory, units, cities, techs and special buildings, and drops when you lose any of them. ([Score](https://wiki.polytopia.com/wiki/Score))

| Source | Points |
| --- | --- |
| Exploration | 5 per explored tile |
| Territory | 20 per tile you own |
| Units | 5 per star the unit costs; super units 50. Upgrading a ship adds nothing; a converted unit changes no score |
| City | 100 at level 1, then about +50 per level (5 per population plus a level-up bonus: 40 at level 2, 35 at level 3, falling after) |
| Park | 250 |
| Monument | 400 each, plus 3 population |
| Temple | 100 per temple level, up to 500 at level 5 (since September 2025; before that 100 + 50 per level) |
| Technology | 100 × the tech's tier |
| Losses | Losing a city, building or unit (killed or disbanded) removes its points. Since 2.15 (October 2025) a starving city also costs points |

**Starting score by tribe:** Aquarion 415; Xin-xi, Imperius, Bardur, Kickoo, Luxidoor and Elyrion 515; Oumaji 520; Polaris 530; Zebasi and Yădakk 615; Quetzali and Hoodrick 620; Cymanti 630; Vengir and Ai-Mo 730.

### Monuments

Each monument can be built once per game by the first tribe to finish its task. Three tasks start with a tech (Meditation, Trade, Philosophy); the others start on their own. ([Monument](https://wiki.polytopia.com/wiki/Monument))

| Monument | Task |
| --- | --- |
| Altar of Peace | Pacifist: no attacks for 5 turns (Meditation). Cymanti instead convert 3 enemies with Shamans |
| Emperor's Tomb | Wealth: hold 100★ (starts with Trade) |
| Eye of God | Explorer: find all 4 corner lighthouses (before November 2023: explore every tile) |
| Gate of Power | Killer: kill 10 enemy units (starts with the first kill) |
| Grand Bazaar | Network: connect 5 cities to the capital (starts with the first connection) |
| Park of Fortune | Metropolis: a city at level 5 (starts with the first level-up) |
| Tower of Wisdom | Genius: research every tech (starts with Philosophy) |

### Perfection difficulty bonus

At the end of a Perfection game the score is multiplied by a bonus for the opponent count and their difficulty. The maximum is 245%, against 15 Crazy bots. The Perfection setup screen shows the bonus as "Difficulty bonus: X%" for the chosen opponent count and difficulty.

```latex
\text{bonus} = 100\% + d + T(\text{opponents}), \quad d = 0, 20, 40, 80\% \text{ for Easy, Normal, Hard, Crazy}
```

The opponent part T is a table, not a known formula. Read off the app's setup screen (iPhone, 25 November 2026):

| Opponents | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T (percent) | 0 | 20 | 30 | 37 | 42 | 46 | 49 | 52 | 54 | 57 | 59 | 60 | 62 | 64 | 65 |
| Crazy, bonus shown | 180 | 200 | 210 | 217 | 222 | 226 | 229 | 232 | 234 | 237 | 239 | 240 | 242 | 244 | 245 |

With 15 opponents the setup screen shows 165% (Easy), 185% (Normal), 205% (Hard) and 245% (Crazy), so the difficulty part is unchanged. **Assumption:** Easy, Normal and Hard were read only at 15 opponents; at fewer opponents we assume they add the same opponent part T as Crazy, i.e. bonus = 100% + d + T(opponents) for every difficulty (not yet checked in the app). The old wiki formula, 100% + 41% × ln(opponents) + d (maximum 291%), is from before the February 2024 "Patch of the Ocean", which lowered the opponent part without giving numbers; the community decompile [raphael-64/polyterra-env](https://github.com/raphael-64/polyterra-env) still has exactly that old formula. Before version 2.0 the bonus was 100/120/140/180% by difficulty plus 10% per opponent. Only Glory states a tie rule (highest score at the end of the turn that crosses the target); Perfection ties are unconfirmed.

## AI and difficulty

Difficulty changes two things, per the developers: how many stars a bot's capital makes each turn, and how aggressive the bot is. The bots play by the same rules as you otherwise. ([developer answer, 2020](https://steamcommunity.com/app/874390/discussions/0/4390400383727805950))

| Difficulty | Bot capital income | Behaviour | Perfection bonus part | Domination difficulty part |
| --- | --- | --- | --- | --- |
| Easy | 1★ per turn | Mostly peaceful unless provoked | +0% | 25% |
| Normal | 2★ (same as a human) | — | +20% | 50% |
| Hard | 3★ | More aggressive | +40% | 75% |
| Crazy | 5★ | May attack at once | +80% | 100% |

- **Opinions:** harder bots start with the Annoying opinion of you, and their Charming opinion is rarer (see Diplomacy).
- **Diplomacy behaviour:** bots gang up on a player who is winning and take pity on one who is losing. The Brave and Dominating opinions steer them against the leader. They send peace offers too; whether they ever break a treaty themselves is unconfirmed.
- **Weekly Challenge:** bot difficulty follows your league, from Easy in Entry to Crazy in Gold.
- **Resigned players:** since 2.7.2 (September 2023) they show as bots, which suggests an AI takes over their tribe (unconfirmed).
- **Changes over time:**
  - 2020: bots stop playing once they have taken the human's last city in single-player.
  - 2022: smarter use of troops, defence and economy; fewer Cloaks; better at finding Cloaks.
  - October 2023: smarter tech choices and a much harder Crazy; bots stopped training Cloaks when defending.
  - February 2024: better choice of units and city upgrades.
- **Known quirks** (player reports from 2020, before several AI updates): attacks into city walls, attacking Defenders head-on, and not upgrading boats.

## Rule changes by version

The current rules come from more than twenty balance updates since 2020. The biggest were the naval rework of November 2023, which replaced the old Boat, Ship and Battleship, and the 2025 Balance Pass. Newest first; each row links its official patch notes.

| Date | Update | Rule changes |
| --- | --- | --- |
| 2026-11-02 | [2.18 Achievements](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1848557880480580) | 15 achievements; no rule changes |
| 2025-10-29 | [2.15 Cymanti rework](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1814942955109414) | Moth replaces the Cymanti Cloak; algae becomes a tile effect; Mantis, Boomchi, Living Island; poison halves defence and slows; Creep no longer ignores mountains; Explorer moves better; starving cities cost score |
| 2025-09-09 | [2025 Balance Pass](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1810503566363587) | Starting stars by tribe (5, 6 or 7; Luxidoor 2 with a bigger capital); Ai-Mo starts with Philosophy and a Mind Bender; techs from tier 3 can be researched backwards; Forges on forests; temples 100 points per level; Burn Forest 3★; Polytaur 3★; embassy cost scales; Polaris changes (Glide, Battle Sled, Ice Fortress, Ice Archer) |
| 2025-03-10 | [2.12 Weekly Challenges](https://wiki.polytopia.com/wiki/Whatsnew-weekly-challenges) | Same-seed 20-turn challenge with leagues |
| 2024-08-08 | [2.10 Aquarion rework](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5963414363391248504) | Flooded terrain; mermaid units; Shark, Jelly, Puffer; Atolls; Lost City from ruins; Landfill for other tribes; Aquaculture renamed Ramming |
| 2024-02-26 | [2.8.5 Patch of the Ocean](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5728086065197236794) | Aqua farming removed; Fishing is the first water tech and includes the Port; Market +1★ per level of each adjacent Sawmill, Windmill or Forge, at most 8; bridges 5★; starfish 8★; Bomber attack 3; Burn Forest to Construction, Destroy to Chivalry; temples grow every 2 turns; water ruins give a veteran Rammer |
| 2023-11-21 | [2.8 Path of the Ocean](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5382426458970207830) | Boat, Ship, Battleship and Navalon removed; Raft, Scout, Rammer, Bomber and Juggernaut added; ships upgrade only in your own territory; Port 7★ and +1 population; starfish replace whales; Market replaces Custom House; lighthouses in the corners; Pangea map; Swordsman loses Fortify; Lumber Hut and Roads 3★ |
| 2023-01-25 | [2.4.5 Tournaments](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5035622109506914466) | Lobbies, Live games with a chess-clock timer, random turn order, replays, crossplay, spectating after defeat |
| 2022-10-10 | [2.2.9 Diplomacy balance](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4588629064110779566) | All units detect adjacent Cloaks; Cloaks gain Scout and Creep; infiltration deals damage, steals income, once per turn per city; Pirates; Cymanti explosion damage halved; Ice Bank capped at 30★ |
| 2022-05-24 | [2.2 Diplomacy](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4292505348844115074) | Shields renamed Strategy and gains peace treaties; Diplomacy tech with Cloak, Dagger, Embassy and Capital Vision; Knight 10 HP at 8★ |
| 2021-09-08 | [2.0.58 Balance Pass 2](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4020014731790399318) | Meeting a tribe gives stars instead of a tech; ruin Giant becomes a veteran Swordsman; mountain defence moved to Climbing; Elo ratings |
| 2021-04-20 | 2.0.49 Balance Pass 1 | Whales never next to a city; Clear Forest moved to Free Spirit; Luxidoor capital level 3 to 2 |
| 2021-02-17 | 2.0.44 | Cymanti released; Literacy discount 20% to 33%; Polytaur becomes Independent |
| 2020-12-04 | 2.0.31 | Any unit can capture cities |
| 2020-08-04 | [2.0 Moonrise](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/3664193578978493471) | New engine; Huge and Massive maps; water settings; Creative mode; new map generator |

Copies of all developer posts are collected at [devtrackers.gg](https://devtrackers.gg/polytopia/patch_notes).

## Open questions

Most conflicts come from wiki pages written before the 2023–2025 reworks. Where the game's data file or a dated patch note decides a conflict, this reference follows it. The rest stay open below.

### Values that sources disagree on

| Topic | What the sources say | Used here |
| --- | --- | --- |
| Breaking peace | No one may attack until the next turn (2022 FAQ); only the victim is frozen for a turn (2022 beta); the breaker is frozen this turn, or this and the next (wiki) | Cease-fire until the next turn |
| Embassy cost since September 2025 | Rises with each embassy you own; no numbers published | Open |
| Embassy condition | "Not at war" (developers) vs "at peace" (wiki) | Not at war |
| Cloak attack | 0 (unit list, 2022 FAQ) vs 2 (Cloak page, used only for infiltration damage) | Both shown |
| Who detects Cloaks | Mind Benders and Cloaks only (May 2022) vs every adjacent unit (since October 2022) | Every unit |
| Splash damage | Half the damage unrounded (Combat page) vs half rounded down (Bomber and Fire Dragon pages) | Unrounded |
| Explosion damage | Equal to the unit's attack (skills page) vs half the attack's damage (Combat page) | Open |
| Poison and movement | Floor of 1 (Movement page) vs 0 (Combat page) | Open |
| Perfection bonus | 100% + 41% × ln(opponents) + difficulty (old wiki formula, maximum 291%) vs the app's setup screen: 100% + difficulty + a table, maximum 245% | App setup screen (25 Nov 2026) |
| Meeting a tribe | 1 + 2★ per 1,000 score, at most 11 (wiki) vs 3★ per 1,000, at most 12, minus 1 per step since October 2022 (patch notes) | Wiki formula |
| Market income | +1★ per adjacent building level, at most 8 (data, February 2024 notes) vs 2★ per adjacent building (older pages) | Data |
| Port reach | Range 5 (data) vs 4 or 5 water tiles (wiki pages); ocean links need Navigation (wiki) vs Sailing (data) | Data |
| Ice Bank | 2★ per 20 frozen tiles (data, 2023 notes) vs 3★ (Buildings page) | 2★ |
| Glide on ice | 0.9 per step (Movement page) vs half a move (Polarism page) vs one extra tile (2025 notes) | Both shown |
| Luxidoor | Capital level 2 (April 2021 notes) vs 3 (a 2025 wiki summary); price $2.99 vs $3.99 | Level 2 |
| Sanctuary | New animal every 3 turns (wiki) vs 2 (data) | Both shown |
| Ruin placement | Never next to a capital (Ruin page) vs never next to a village (Map generation page) | Both shown |
| Unit stats | Mooni defence 1 or 2; Crab defence 4 or 5; Jelly attack 0 or 2; Phychi defence 1 or 2; Boomchi and Pirate movement 1 or 2; Siren cost 8 or 5 | Unit page value, alternative shown |
| Unlocking techs | Tridention: Spearing or Chivalry. Battle Sled: Sledding or Polar Warfare. Atoll: Aquaculture or Waterways. Shark replaces the Scout or the Rammer. Cymanti Hydrology takes the Fishing slot (likely) | Tech page value |
| Cymanti monument | "Church of Converts" (patch notes) vs "Cult of Ciru" (wiki) | Unnamed |
| Weekly Challenge | One attempt per day (2025 notes) vs unlimited, best counts (wiki); 4 leagues in 2025, six mentioned in 2026 | Both shown |
| Bot capital income | 1/2/3/5★ from a 2020 developer answer, not reconfirmed since | Shown |

### Not found in any source

- What happens to the units of a tribe that loses its last city.
- Whether bots ever break a peace treaty themselves.
- How Perfection ties are broken.
- The odds of each ruin reward (only that it's an even draw among eligible rewards).
- How long a frozen unit stays frozen, and how much damage Stomp and Tentacles deal.
- Whether there is a star cap or any unit upkeep (no source mentions either).
- The full current list of multiplayer turn timers and Glory point targets.
- Whether a unit on a mountain really sees 5×5 (only a fan guide says so).

## Sources

Researched on 2026-11-23. Each section links the pages its facts come from; these are the main ones.

- **Official wiki (Wikitopia):** [Units](https://wiki.polytopia.com/wiki/Units), [Unit abilities](https://wiki.polytopia.com/wiki/Unit_Abilities), [Combat](https://wiki.polytopia.com/wiki/Combat), [Movement](https://wiki.polytopia.com/wiki/Movement), [Technology](https://wiki.polytopia.com/wiki/Technology), [City](https://wiki.polytopia.com/wiki/City), [Buildings](https://wiki.polytopia.com/wiki/Buildings), [Score](https://wiki.polytopia.com/wiki/Score), [Map generation](https://wiki.polytopia.com/wiki/Map_Generation), [Game modes](https://wiki.polytopia.com/wiki/Game_Modes), [Ruin](https://wiki.polytopia.com/wiki/Ruin), [Tribes](https://wiki.polytopia.com/wiki/Tribes), [Monument](https://wiki.polytopia.com/wiki/Monument), [Update history](https://wiki.polytopia.com/wiki/Update_History)
- **Community wiki (Fandom, read through its API):** [Tribe relations](https://polytopia.fandom.com/wiki/Tribe_Relations), [Embassy](https://polytopia.fandom.com/wiki/Embassy), [Cloak](https://polytopia.fandom.com/wiki/Cloak), [Dagger](https://polytopia.fandom.com/wiki/Dagger), [Star](https://polytopia.fandom.com/wiki/Star)
- **Developer posts:** the official Steam announcements, 2018–2026 (linked per update under Rule changes by version), the [Diplomacy FAQ](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4469272893492663515), a [developer answer on difficulty](https://steamcommunity.com/app/874390/discussions/0/4390400383727805950), and copies at [devtrackers.gg](https://devtrackers.gg/polytopia/patch_notes)
- **Game data:** the [data file dump, versions 1–28](https://github.com/usemsedge/biblical_greed/tree/main/polytopia_extracted/gamelogic) and the [PolyMod field reference](https://github.com/PolyModdingTeam/PolyMod/tree/main/docs/gld)
- **Tools and press:** the community [battle calculator](https://frothfrenzy.github.io/polytopiacalculator), [Pocket Gamer on the Cymanti rework](https://www.pocketgamer.com/the-battle-of-polytopia/cymanti-rework)
