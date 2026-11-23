# The Battle of Polytopia: rules spec (numbers-complete, current version)

Compiled 2026-11-23.

**Version.** The current game is **2.18.0 "Mighty Achievements" (2 Nov 2026)**. The last update that changed rules was **2.15.0 "Cymanti Rework" (29 Oct 2025)**, preceded by **2.14.0 "Balance Adjustments 2025" (9 Sep 2025)**. 2.16 to 2.18 (skin, UI rework of 9 Jun 2026, achievements) and the 2026 patches 2.8.6 and 2.9.1 changed no rules. The one 2026 rule change found is the Explorer: 15 steps cut to 12 (16 Feb 2026).

**Tech tree.** The tree below is the post-"Patch of the Ocean" (2.8.5, Feb 2024) tree, with the 2.10 Aquarion rework renames and the 2025 changes (backward research, starting stars).

### Sources (all read, not recalled)

| Tag | Source | What it is |
|---|---|---|
| **[W]** | polytopia.fandom.com, page wikitext through the MediaWiki API (fetched 2026-11-23), and its mirror wiki.polytopia.com (edited Nov 2026) | Community wiki |
| **[G]** | PolyModdingTeam/PolyMod `docs/gld/*.md` | Documents the game's own GameLogicData JSON (GLD version 28) and the engine rules found in the decompiled game |
| **[E]** | kevinz917/superhuman-polytopia-bot: `docs/rules-alignment-2026-10-27.md`, `gpu/rules.json` and engine-rs source | A re-implementation checked against **Steam 2.17.3 (game version 123, GLD v28)**: 27,785 recorded game transitions, legal-move sets identical in 685 of 686 recorded positions. Bardur 1v1 and 4-player free-for-all; diplomacy only for 2 players. |
| **[N]** | wiki.polytopia.com "What's new" pages for 2.14.0, 2.15.0, 2.17.0 and 2.18.0 | Patch notes |
| **[P]** | HenBOMB/Polyfish `mapgen.rs` | Map generator ported from a community reverse-engineering. Approximate (it has its own "fairness" passes). |

Where [E] or [G] (the game code or data) disagrees with [W], [E]/[G] is used and the difference is noted. **(unverified)** marks every value no source could confirm for the current version.

---

## 1. Technology

### 1.1 Cost

```
price = ceil( (4 + tier × C) × m )
```

- `C` is the number of cities the player owns now [G][E][W]. All owned cities count, including captured ones.
- `m = 1`. With **Literacy** (from Philosophy) `m = 0.66666f`, a 32-bit float [E]. The wiki calls this "−33%, rounded up". At 0.66 instead of 0.66666 the result first differs at a base price of about 50 stars.
- The free root tech `basic` (tier 0) costs nothing.
- Researching a tech gives **100 × tier** score [W][E].

Sample prices (stars):

| Cities | T1 | T1 with Literacy | T2 | T2 with Literacy | T3 | T3 with Literacy |
|---|---|---|---|---|---|---|
| 1 | 5 | 4 | 6 | 4 | 7 | 5 |
| 2 | 6 | 4 | 8 | 6 | 10 | 7 |
| 3 | 7 | 5 | 10 | 7 | 13 | 9 |
| 5 | 9 | 6 | 14 | 10 | 19 | 13 |
| 10 | 14 | 10 | 24 | 16 | 34 | 23 |

**Prerequisites.** A tech can be researched if the player owns its parent. Since 2.14 (Sep 2025) it can also be researched if the player owns **one of its children**: "backwards" research, for example Vengir from Smithery to Mining [N][G].

**Ruins.** A ruin can grant a random tech that is currently researchable (§5.10).

### 1.2 Tree

Five branches of 1 + 2 + 2 techs (T1 → two T2 → one T3 each), giving 25 techs.

| Tech | Tier | Parent | Unlocks (regular tribes) | Starting tech of |
|---|---|---|---|---|
| **Riding** | 1 | – | Rider | Oumaji |
| Free Spirit | 2 | Riding | Temple (field); **Disband** ability | – |
| Chivalry | 3 | Free Spirit | Knight; **Destroy** ability | – |
| Roads | 2 | Riding | Road; Bridge; Network task (the task actually starts with the first city connection [E]) | Yădakk |
| Trade | 3 | Roads | Market; Wealth task (Emperor's Tomb) | – |
| **Organization** | 1 | – | Harvest Fruit; reveals crop | Imperius |
| Farming | 2 | Organization | Farm (also reveals crop) | Zebasi |
| Construction | 3 | Farming | Windmill; **Burn Forest** | – |
| Strategy (formerly "Shields") | 2 | Organization | Defender; can **offer a Peace Treaty** | Quetzali |
| Diplomacy | 3 | Strategy | Cloak (Dagger, Dinghy and Pirate come with it); Embassy; **Capital Vision**; shows the relations between other tribes | – |
| **Climbing** | 1 | – | Movement onto mountains; **defence bonus on mountains**; reveals metal | Xin-xi |
| Mining | 2 | Climbing | Mine | – |
| Smithery | 3 | Mining | Swordsman; Forge | Vengir |
| Meditation | 2 | Climbing | Mountain Temple; Pacifist task (Altar of Peace) [E: Mountain Temple is Meditation's, not Philosophy's] | – |
| Philosophy | 3 | Meditation | Mind Bender; **Literacy**; Genius task (Tower of Wisdom) | Ai-Mo (since 2.14; before that Ai-Mo started with Meditation) |
| **Fishing** | 1 | – | Fishing (harvest fish); Port; Raft (by embarking); movement on **shallow water**; reveals starfish | Kickoo |
| Sailing | 2 | Fishing | Scout (Raft upgrade); movement on **ocean** | – |
| Navigation | 3 | Sailing | Bomber (Raft upgrade); **Starfish Harvesting** | – |
| Ramming | 2 | Fishing | Rammer (Raft upgrade) | – |
| Aquatism | 3 | Ramming | Water Temple; **defence bonus on water and ocean** | – |
| **Hunting** | 1 | – | Hunting (harvest wild animals) | Bardur |
| Forestry | 2 | Hunting | Lumber Hut; **Clear Forest** | – |
| Mathematics | 3 | Forestry | Catapult; Sawmill | – |
| Archery | 2 | Hunting | Archer; **defence bonus in forest** | Hoodrick |
| Spiritualism | 3 | Archery | Forest Temple; **Grow Forest** | – |

Notes:

- Ruins and the "Explorer" lighthouse task need no tech. The Killer, Metropolis, Network and Explorer tasks start by themselves [G].
- Tribe-specific renamed techs (Frostwork, Forest Magic, Free Diving, Spearing, Waterways, Shock Tactics, Recycling and others) exist only for the special tribes Polaris, Elyrion, Aquarion and Cymanti.
- The GLD player abilities include **discipline** (promotion after 2 kills) and **treehouse**/**pontoon** (build field buildings on forest/water). No regular-tribe tech grants them [G].

---

## 2. Units

Stats come from the game data [E rules.json = GLD v28], cross-checked with [W]. **HP** is maximum health. A **veteran** gets **+5 max HP**.

### 2.1 Land units (regular tribes)

| Unit | Cost | HP | Attack | Defence | Move | Range | Skills | Unlocked by |
|---|---|---|---|---|---|---|---|---|
| Warrior | 2 | 10 | 2 | 2 | 1 | 1 | dash, fortify | start (basic) |
| Rider | 3 | 10 | 2 | 1 | 2 | 1 | dash, escape, fortify | Riding |
| Archer | 3 | 10 | 2 | 1 | 1 | 2 | dash, fortify | Archery |
| Defender | 3 | 15 | 1 | 3 | 1 | 1 | fortify | Strategy |
| Swordsman | 5 | 15 | 3 | 3 | 1 | 1 | dash (no fortify since 2.8) | Smithery |
| Mind Bender | 5 | 10 | 0 | 1 | 1 | 1 | heal, convert, stiff | Philosophy |
| Catapult | 8 | 10 | 4 | 0 | 1 | 3 | stiff | Mathematics |
| Knight | 8 | 10 | 3.5 | 1 | 3 | 1 | dash, persist, fortify | Chivalry |
| Cloak | 8 | 5 | 0 (only infiltrates; deals 2 on infiltration) | 0.5 | 2 | 1 | hide, infiltrate, dash, scout, creep, stiff, static | Diplomacy |
| Dagger | 2 (score and disband value; cannot be trained) | 10 | 2 | 2 | 1 | 1 | dash, surprise, independent, static | spawned by Cloak infiltration |
| **Giant** (super unit) | 10 (theoretical: score 50, disband 5) | 40 | 5 | 4 | 1 | 1 | static (no dash, no fortify) | city level-up reward, level 5 and above |

### 2.2 Naval units

All naval units have the skills water and carry. Their HP is the **carried unit's HP** (including the veteran +5), except the Juggernaut and Dinghy/Pirate, which carry their own HP. An upgrade does not heal.

| Unit | How obtained | Cost | Attack | Defence | Move | Range | Skills | Tech |
|---|---|---|---|---|---|---|---|---|
| Raft | any land unit that moves onto an own Port | free | 0 | 1 | 2 | – (cannot attack) | carry, stiff, static | Fishing (Port) |
| Scout | Raft upgrade | 5 | 2 | 1 | 3 | 2 | dash, scout, static | Sailing |
| Rammer | Raft upgrade | 5 | 3 | 3 | 3 | 1 | dash, static | Ramming |
| Bomber | Raft upgrade | 15 | 3 | 2 | 2 | 3 | splash, stiff, static (no dash) | Navigation |
| Juggernaut | Giant enters a Port | – | 4 | 4 | 2 | 1 | stomp, stiff, static; HP 40 | – |
| Dinghy | Cloak enters a Port | – | 0 | 0.5 | 2 | 1 | hide, infiltrate, dash, scout, stiff, static; HP 5 | – |
| Pirate | Dagger enters or spawns on water | – | 2 | 2 | 2 | 1 | dash, surprise, independent, static; HP 10 | – |

Naval rules:

- **Upgrades:** only an own **Raft**, only in **own or allied territory**. An upgrade costs the full price of the new boat and cannot be changed later [E][W].
- **Disembark:** when a boat lands, the passenger comes back and the naval upgrade is lost. The next Port makes a Raft again.
- **Disband refund** = ½ of the **passenger's** cost, rounded down. The upgrade cost is never refunded [E].

### 2.3 Not available to regular tribes

The **Amphibian** (3 stars, HP 10, attack 2, defence 1, move 2, range 1, amphibious/dash/escape/fortify) and the **Tridention** (8 stars, HP 10, attack 2.5, defence 1, move 2, range 2, amphibious/dash/persist) exist only for **Aquarion**: they replace the Rider and Knight through Riding and Spearing. Normal tribes can only get them by converting them with a Mind Bender. The Mind Bender itself is available to all regular tribes.

### 2.4 Skills (exact semantics, [G] plus engine [E])

| Skill | Definition |
|---|---|
| dash | Can attack after moving in the same turn. Without dash, a unit that moved cannot attack. |
| escape | Can move after attacking (the moved flag is cleared after the attack). |
| persist | After a **kill**, the unit may attack again, **only if another valid target is in range from where it now stands** [E]. There is no limit on chained kills. |
| fortify | Gets the city defence bonus in its **own** city: ×1.5, or ×4 with a City Wall. Without fortify a unit never gets the city bonus; it can still get the terrain bonus. |
| stiff | Never retaliates. |
| surprise | Its targets never retaliate. |
| convert | An attack converts the target to the attacker's side (no damage; works at 0 attack). The target does not retaliate. The attacker's turn ends. The converted unit is homed in the converter's **capital**, falling back to the oldest city; it may exceed the city's unit capacity, which then blocks training there. Independent units stay homeless. Conversion changes neither player's unit score. |
| heal | Action "Heal Others" instead of moving: every adjacent friendly unit gets +4 HP (capped at max; a poisoned unit is only cured of poison). Allowed only if an adjacent friendly unit is damaged [E]. |
| splash | Range must be above 1. Units adjacent to the target take **½ of the normal damage formula computed against each of them**, rounded down in [E]. [W] says there is no rounding (an "x.5 HP bug"). Hits enemies only (allies and protected players excluded). |
| stomp | After **every move**, and on embark or disembark, deals ½-damage (same formula, rounded down) to every adjacent enemy. |
| carry | Is a boat. Carries one unit. Can step onto a land tile next to water: the passenger is released and its turn ends. HP equals the passenger's. |
| scout | Sight radius 2 (5×5) instead of 1 (3×3), when moving, on training and on upgrade. |
| creep | Every tile except mountains costs normal movement (forest, flood and algae do not stop it). Gets **no road bonus**. Ignores zone of control (in [E]). Since 2.15 creep no longer overcomes mountains. |
| sneak | Ignores zone of control; cannot pass through enemy units. |
| hide | Invisible after moving. Ignores zone of control. **May pass through tiles held by other players' units** (cannot end there). Revealed by attacking, capturing, examining a ruin, or being bumped into. Every unit detects a hidden unit on an adjacent tile [W]. |
| infiltrate | The only possible target is an adjacent enemy city that was not already infiltrated this turn and is not under siege. See §3.6. |
| independent | Takes no city unit slot (unit capacity) and belongs to no city. |
| static | Never gains XP and is never promoted. |
| water | Moves only on water. |
| amphibious | Moves on water and land; the move stops after the first land tile that is not flooded. |
| fly | Ignores terrain; uses no roads (special tribes only). |

**Veteran.** A unit becomes eligible after **3 kills** [G][E]. Kills by attack and by retaliation both count.

- **No XP** for a killer that is a boat (carry) or static. A passenger keeps the XP it had when it embarked; a non-static passenger can be promoted at sea [E].
- Promoting costs no action. It gives +5 max HP and heals to full.
- A unit can be promoted **only once**.
- A player may delay the promotion and use it as a free heal later.

---

## 3. Combat

### 3.1 Damage formula [E][G][W]

```
attackForce  = A_att × (hp_att / maxhp_att)
defenceForce = D_def × (hp_def / maxhp_def) × defenceBonus
total        = attackForce + defenceForce
damage       = roundHalfUp( attackForce  / total × A_att × 4.5 )
retaliation  = roundHalfUp( defenceForce / total × D_def × 4.5 )   // only if the defender survives
roundHalfUp(x) = floor(x + 0.5 + 1e-6)   // [E]; [W]: "rounded to the nearest whole number"
```

- `maxhp` includes the veteran +5. A boat uses its passenger's max HP.
- Retaliation uses the **same** `attackForce` and `defenceForce` computed **before** the damage is applied. It is not recomputed with the defender's reduced HP.
- The bonus multiplies the defence **force** only; it does not multiply `D_def` in the retaliation term.
- Poison (Cymanti only): the defender's `D` is ×0.7 and the bonus ×0.5 in [E]; [W] and [N] say "defence −50%". Irrelevant to regular tribes.

### 3.2 Retaliation happens only if all of these hold [E]

1. The defender survives the attack.
2. The attacker has neither surprise nor convert (nor freeze).
3. The defender is not stiff (nor frozen).
4. The Chebyshev distance attacker to defender is at most the **defender's range**.
5. The defender's owner has **explored** the attacker's tile (the attacker is visible to it).
6. The computed retaliation is above 0.

### 3.3 Defence bonus [E][G]

The terrain bonuses are applied as per-tile alternatives in [E] (they do not stack): water/ocean, forest, mountain, or otherwise the city bonus.

| Situation | Bonus | Requirement |
|---|---|---|
| Unit on forest | ×1.5 | the **unit owner** has Archery |
| Unit on mountain | ×1.5 | owner has Climbing |
| Unit on shallow water or ocean (includes boats and units on bridges) | ×1.5 | owner has Aquatism |
| Unit with **fortify** in **its own city** (a besieger gets nothing) | ×1.5 | – |
| Same, with a City Wall | ×4 | City Wall reward (city level 3) |
| Otherwise | ×1 | – |

### 3.4 After the attack [E]

- A **melee** attacker (range < 2) that kills its target and survives **moves onto the target's tile** if it may enter it: field/forest; mountain only with Climbing; water only for water units, onto a bridge, or onto an **own** Port. A Port makes it a Raft.
- A ranged unit **never** advances, even when it attacks an adjacent unit.
- After the attack the attacker is marked as having attacked. It may still move if it has escape, or attack again if it has persist and another target remains.
- If the attacker dies from retaliation, the defender gets the kill credit.

### 3.5 Healing [E][W]

| Source | Amount |
|---|---|
| **Recover** action (unit not moved or attacked this turn; damaged) | +4 HP if the tile is **own territory** (or a peace partner's); +2 HP otherwise. Capped at max HP. A poisoned unit is cured instead of healed. Ends the unit's turn. |
| **Automatic** | At the owner's end of turn, every unit that neither moved nor attacked heals the same amount (+4 or +2). |
| Mind Bender "Heal Others" | +4 HP to every adjacent friendly unit (flat, in any territory). |
| Veteran promotion | Full heal plus 5 max HP. |

### 3.6 Cloak infiltration [W][E]

- The Cloak is consumed.
- A non-allied unit in the city takes the damage of a full-HP Dagger attack (attack 2, using its defence bonus).
- The attacker gains stars equal to the city's own income (level + workshop + park + capital bonus, minus negative population). The city's own production is 0 on its owner's next turn ("riot").
- **min(city level, 5)** Daggers spawn within the city's borders. Priority: the city tile, then tiles with a defence bonus, known resources, and land over water; a Pirate spawns on water. The Daggers cannot act until their owner's next turn.
- A city can be infiltrated once per turn.
- Infiltration does not count as an attack for the Pacifist task.

---

## 4. Movement, terrain, vision

### 4.1 Basics

- Distance is **Chebyshev** (8-neighbour grid).
- Each unit has a **budget of `movement × 2` half-steps**. A normal step costs 2; a road-to-road step costs 1.
- One tile holds one unit.
- A unit moves once per turn (dash and escape as in §2.4).
- **Expansion rule [E]:** the unit can keep stepping from any tile reached with cost below the budget. So with ½ move left it can still enter any one adjacent tile (the game "rounds up" [W]).

### 4.2 Terrain [E][W]

| Terrain | Enter | Effect |
|---|---|---|
| Field | always | – |
| Forest | always | **Entering ends the move** unless the step is road to road (creep is exempt) |
| Mountain | **Climbing** required | **Entering always ends the move** (creep too, since 2.15). No roads possible. Sight radius 2 from a mountain. |
| Shallow water | **Fishing** required, only for water/naval units; land units only via an own Port (embark) or a Bridge | – |
| Ocean | **Sailing** required | Ocean is water with no land neighbour |
| Cloud (unexplored) | **cannot be entered** by any unit; the Explorer reward is the exception | – |
| Own Port (land unit enters) | – | The move ends; the unit becomes a Raft (Giant → Juggernaut, Cloak → Dinghy, Dagger → Pirate) and cannot act further this turn |
| Land tile for a boat | – | The move ends; the boat disembarks and the passenger's turn ends |

### 4.3 Zone of control [E][W]

- Any tile **adjacent to a non-allied, non-hidden enemy unit** is terminal: the move stops there.
- This counts **unseen enemies too** [E: TileData.GetMovementCost reads the raw neighbours].
- Zone of control overrides roads.
- Exempt: creep, sneak, hide (invisible), infiltrate.
- A unit with dash may still attack after stopping.

### 4.4 Roads and bridges [E][W]

| Item | Cost | Placement | Effect |
|---|---|---|---|
| Road | 3 stars | Field or forest, in own **or neutral** territory. Not on mountain or water. Not on any city or village tile (they already count as road). Cannot be destroyed. | A road step costs ½ (1 half-step) when **both** tiles are road-network tiles. |
| Bridge | 5 stars | Shallow water with **land on both opposite sides**, either north-south or east-west (north-south wins if both hold). Own or neutral territory. Can be destroyed. | Land units may cross. Counts as road. Naval units pass through. |

- **Road-network tiles:** road, bridge, village, and any city in own, neutral or **peace-partner** territory.
- Roads in enemy territory give no bonus.
- A road on a forest tile removes the forest stop (road-to-road step only).
- Without Fishing, a bridge cannot be entered straight across its span; diagonal steps onto it are allowed [E].

### 4.5 Naval

| Item | Rule |
|---|---|
| Embark | A land unit moves onto an **own** Port (enemy Ports cannot be used). It becomes a Raft, or keeps its special boat form; its turn ends (Rafts have no dash). |
| Shallow water | Needs Fishing |
| Ocean | Needs Sailing |
| Speed | Raft 2, Scout 3, Rammer 3, Bomber 2, Juggernaut 2 |
| Port-to-Port connections over ocean | [W] says Navigation is required (unverified) |

### 4.6 Fog of war and vision [E][W]

- **Exploration is permanent.** An explored tile stays visible for the rest of the game, including the units on it.
- Tiles are only explored by: unit movement (every tile along the path), training, upgrades, conversion, village/city capture, border growth, the Explorer, Embassies, Capital Vision, and the start.
- A turn start explores nothing.

| Source | Radius revealed |
|---|---|
| Unit (moving, trained, upgraded) | 1 (3×3) |
| Unit on a mountain, or with scout | 2 (5×5) |
| Capital at game start | 2 (5×5; 25 tiles, derived from the turn-0 score of 515) |
| Village/city capture | 1 around the city, or the whole old territory of a captured enemy city |
| Border Growth | 2 |
| Embassy | 1 around the host capital |
| Capital Vision (Diplomacy) | The capital tiles of every met tribe |
| Lighthouses (the 4 map corners) | Always start in fog |

---

## 5. Economy and cities

### 5.1 Start

- One capital at **level 1** (Luxidoor: level 3), with **3×3 territory** (radius 1).
- One starting unit.
- Starting tech: `basic` plus the tribe's tech.
- Starting stars: **5 by default**; tribe values in §8.
- **No income is paid on turn 0** [E].

### 5.2 Income per turn (paid at the start of the owner's turn) [E][W]

```
city income = level + Workshop(1) + Park(1 each) + capitalBonus
              − (negative population, if any), floored at 0
total       = Σ cities not under siege + Σ markets (§5.5) + embassies
```

- **capitalBonus:** human players and Normal bots +1; Easy bots 0; Hard bots +2; Crazy bots +4. So a level 1 capital earns 2/1/3/5 [E][W].
- **Siege:** any unit of another player (hidden ones included) standing on the city tile stops the city's own income. Its Markets still pay [E].

### 5.3 Population and levels

| Rule | Value |
|---|---|
| Population to go from level `L` to `L+1` | `L+1` (so the bars shown = level + 1) |
| Excess population | Carries over and can level up several times at once [E] |
| Each level-up | +1 star of income, +50 score (40/35/… share; see §7.1) |
| **Unit capacity** | **level + 1** units homed in the city. Training also needs the city tile to be empty [E]. Trained units cannot act on the turn they are trained. |
| Negative population (for example after losing connections) | −1 star of income per point, not below 0. Does not reduce unit capacity. |

**Level-up reward (choose one)** [W][E]:

| New level | Option A | Option B |
|---|---|---|
| 2 | Workshop (+1 star/turn) | Explorer (§5.12) |
| 3 | City Wall (defence ×4 for fortify units) | Resources: +5 stars |
| 4 | Population Growth: +3 population | Border Growth: territory radius 2 (claims unowned tiles in 5×5; reveals 5×5) |
| 5 and above (every level) | Park (+1 star/turn, +250 score) | Super unit: a Giant spawns on the city tile. An occupant is pushed (§5.13). |

### 5.4 Harvest actions

All harvest actions are on an own, owned tile with no building. Each gives **+1 population** to the tile's city and removes the resource.

| Action | Cost | Resource | Tech |
|---|---|---|---|
| Harvest Fruit | 2 | fruit (field) | Organization |
| Hunting | 2 | wild animal (forest) | Hunting |
| Fishing | 2 | fish (water) | Fishing |
| Starfish Harvesting | **+8 stars**, no population | starfish (water or ocean). Any unit may stand on it, **in any territory**, at the start of its turn; the action uses up the unit's turn. Not on a tile that has a building. | Navigation |
| Clear Forest | **+1 star** | forest → field | Forestry |
| Burn Forest | 3 (since 2.14) | forest → field **with crop** | Construction |
| Grow Forest | 5 | field → forest (removes any resource) | Spiritualism |

### 5.5 Buildings

A building goes on an own tile, one building per tile. "One per city" counts the city's territory.

| Building | Cost | Terrain / requirement | Population | Other | Tech |
|---|---|---|---|---|---|
| Farm | 5 | field with crop | 2 | – | Farming |
| Mine | 5 | mountain with metal | 2 | – | Mining |
| Lumber Hut | 3 | forest | 1 | – | Forestry |
| Windmill | 5 | field, next to an own Farm; one per city | 1 per adjacent own Farm (maxLevel 8 [G]) | – | Construction |
| Sawmill | 5 | field, next to an own Lumber Hut; one per city | 1 per adjacent own Lumber Hut (maxLevel 8, unverified) | – | Mathematics |
| Forge | 5 | field **or forest** (since 2.14), next to an own Mine; one per city | **2** per adjacent own Mine (maxLevel 8, unverified) | – | Smithery |
| Market | 5 | field, next to a Windmill, Sawmill or Forge; one per city | 0 | **Stars/turn = Σ levels of the adjacent own Windmills, Sawmills and Forges, capped at 8.** A building's level = its count of adjacent feeders. Recomputed at turn start [E]. | Trade |
| Port | 7 | **shallow water** (or a flooded field) | 1 | Embark point; connects cities by sea | Fishing |
| Temple | 20 | field | 1 | Score §7.1 | Free Spirit |
| Mountain Temple | 20 | mountain | 1 | – | Meditation |
| Forest Temple | 15 | forest | 1 | – | Spiritualism |
| Water Temple | 20 | shallow water or ocean | 1 | – | Aquatism |
| Embassy | 5 (2.14 says the cost "starts cheaper and rises with each Embassy owned"; exact formula unverified) | Inside a met tribe's **original** capital, only while not at war (no recent attack); one per tribe | 0 | +2 stars/turn to **both** builder and host; +4 each under a Peace Treaty. Reveals the 3×3 around the host capital. Any attack between the two destroys both players' embassies. | Diplomacy |
| Monument (one of 7) | free when its task is done; each can be built once per player | field, shallow water or ice | **3** | +400 score | task (§7.3) |

Rules:

- Adjacency counts only neighbour tiles **owned by the same player** [G][E].
- **Destroy** (Chivalry), on an own tile:
  - Removes the building, its population (including the population from levels) and its score.
  - Cannot remove a city, ruin, lighthouse or road.
  - Gives no refund.
  - Lost monuments cannot be rebuilt.
- Removed buildings: Customs House (replaced by the Market in 2.8), Aqua Farm (now Aquarion-only), Whale hunting.

### 5.6 City connections [E][W]

- A non-capital city is **connected** when it links to the capital through the road network (§4.4: roads, bridges, cities, villages; own, neutral or peace-partner territory) and/or Port-to-Port links.
- **Port-to-Port link:** both ports are own; their Chebyshev distance is **at most 4**; and a path runs between them over friendly (own, neutral or peace) water tiles. In [E] the search expands only from tiles within distance below 4 of the first port. A port tile is itself a network node next to land.
- **Each connected city gives +1 population to itself and +1 to the capital.** Losing a connection (a capture, or a broken peace) removes them; the result can be negative population.
- Fog: no connection forms through tiles hidden by fog [W].

### 5.7 Territory

| Event | Territory |
|---|---|
| New city (village capture) | Claims the **unowned** tiles at radius 1 (3×3). Already-owned tiles are not taken. |
| Border Growth | Radius 2 (5×5), unowned tiles only |
| Capturing an enemy city | Takes its whole territory |
| Each owned tile | 20 score |

### 5.8 Capturing villages and cities [E][W]

- **Capture** is an action of a unit that **started its turn on the tile**: it has not moved or attacked this turn. Arriving is not enough. Any unit type can capture.
- The action ends the unit's turn and reveals the unit if hidden.
- **Village:**
  - Becomes a level 1 city of the capturer: +100 score, territory as in §5.7.
  - Home transfer: the capturing unit's home city becomes the new city; it frees its slot in the old city.
- **Enemy city:**
  - Keeps its level, population and rewards.
  - Score `100 + 50×(level−1) + 5×population + 250×parks` moves from the old owner to the capturer.
  - Units of the old owner homed there lose their home.
- **Last city:** capturing a player's last city eliminates them. All their units are disbanded and refunded [E].
- **Capital:** capturing a capital destroys every embassy in it.
- Units of a player at peace (or on truce cooldown) cannot capture that player's cities.

### 5.9 Tribe meeting reward [E]

A player meets another tribe the first time it sees one of that tribe's units, or its city [W]. It then gains

```
1 + 2 × min( ceil(score_met / 1000), 5 )   // max 11 stars
```

- In a 2-player game, the seat that meets player 1 (the seat moving second) gets **+2 more** ("away stars", game version ≥ 123).

### 5.10 Ruins

- **Examining** a ruin needs a unit that started its turn on it; the unit's turn ends.
- The reward is **uniformly random among the eligible options** [E][W]:

| Reward | Effect | Eligible when |
|---|---|---|
| Resources | +10 stars | always |
| Scroll of Wisdom | a random free tech among those currently researchable (a tier 1 tech, or one whose parent is owned) | the tree is not complete |
| Population | +3 population to the capital | the player owns a capital |
| Explorer | an Explorer starts from the ruin | the ruin is not on a mountain **and** some tile within radius 2 is unexplored |
| New Friends | Land ruin: a **veteran Swordsman** (home-less). Water ruin: a **veteran Rammer carrying a Warrior**. Pushes any occupant. | always |

- Ruins block building on the tile until examined.
- Chivalry's Destroy can remove a ruin [W]. In [E] ruins are not destructible (unverified).

### 5.11 Lighthouses and other one-off stars

| Item | Effect |
|---|---|
| Lighthouse (one per map corner) | The first discovery by each player gives +1 population to its capital (else its oldest city). |
| Disband (Free Spirit; unit not moved or attacked) | Refunds ½ of the cost, rounded down. A super unit refunds 5. Removes the unit's score. |
| Infiltration | Steals the city's income (§3.6) |

### 5.12 Explorer [E][W]

- A walker controlled by the game, not a unit. It takes **12 steps** (15 before 16 Feb 2026).
- Each step it moves to an adjacent tile and reveals the 3×3 around it. It may move onto occupied tiles and into fog.
- **Step choice:**
  - Each fog tile is scored `183 − 10×min(max(unexplored tiles within radius 2, 1), 4) − 33×(a lighthouse is within those tiles)`.
  - The scores are spread by a 3-pass breadth-first search, adding +100 per step.
  - The explorer picks the lowest-scoring neighbour, +1 for backtracking.
  - Ties are broken by RNG.
- **Passable explored terrain:** mountain needs Climbing; shallow water needs Sailing; ocean needs Navigation [E]. This differs from unit movement; [W] says the same.
- It stops early if no step is possible.

### 5.13 Forced push (super unit spawn, ruin unit) [W][E]

The unit already on the tile is pushed one tile:

- A friendly unit is pushed in the direction of its last move.
- An enemy unit is pushed opposite to its last move.
- A ranged unit that last attacked is pushed by its attack direction.
- A unit that never moved is pushed toward the map centre; at the exact centre, south.

If that tile is blocked, the push tries the alternatives in the order ±45°, ±90°, ±135°, 180°, preferring the one nearer the centre. If all 8 are blocked, the unit is removed.

### 5.14 Peace (Strategy and Diplomacy), brief [W][E]

| Topic | Rule |
|---|---|
| Treaty | Needs Strategy to **offer**; none to accept |
| While at peace | No attacks or captures. Units may pass through each other's units (not end there) and use each other's roads. Embassy income doubles. |
| Breaking peace | The breaker's units in the partner's territory are removed without refund. All the breaker's units are exhausted for the turn. A cooldown ("truce breaker") forbids attacks until the next turn. |
| Diplomacy for 3+ players | Not verified (unverified) |

---

## 6. Map generation

The values are from [W], with [G] base weights and [P] for the algorithm. **The exact algorithm is (unverified)**: the community re-implementations are approximate.

### 6.1 Map sizes [W]

| Size | Tiles | Side | Ruins | Tiny-island villages (Continents/Pangea) |
|---|---|---|---|---|
| Tiny | 121 | 11 | 4 | 0 |
| Small | 196 | 14 | 5 | 1 |
| Normal | 256 | 16 | 7 | 2 |
| Large | 324 | 18 | 9 | 3 |
| Huge | 400 | 20 | 11 | 4 |
| Massive | 900 | 30 | 23 | 9 |

**Default map size by mode:**

- Perfection: **Normal**.
- Domination: by number of opponents: 1 → Tiny; 2 → Small; 3 → Normal; 4 or more → Large.
- Tiny maps hold at most 9 players; other sizes up to 16.

### 6.2 Map types (water share) [W]

Wetness percentages are from [W]. The land ratios are from [P] (unverified).

| Type | Wetness | [P] land ratio |
|---|---|---|
| Drylands | 0–10% (Kickoo, Luxidoor and Aquarion capitals get 2 fish-water tiles) | 1.0 |
| Lakes | 25–30% | 0.72 |
| Continents | 40–70% (rivers one tile wide) | 0.45 |
| Pangea | 40–60% | 0.78 |
| Archipelago | 60–80% | 0.38 |
| Water World | 90–100% | 0.15 |

### 6.3 Land terrain per tribe area [W][G]

- **Base shares:** field 48%, forest 38%, mountain 14%. [G] gives raw weights 0.5 / 0.4 / 0.15, which normalise to the same shares.
- **Order of tribe modifiers:**
  1. The mountain multiplier, rescaling forest and field proportionally.
  2. The forest multiplier, taking the difference from field.
  3. Field is the remainder.

| | Inner (adjacent to a city or village) | Outer |
|---|---|---|
| Fruit (share of land) | 18% | 6% |
| Crop | 18% | 6% |
| Empty field | 12% | 36% |
| Wild animal | 19% | 6% |
| Empty forest | 19% | 32% |
| Metal | 11% | 3% |
| Empty mountain | 3% | 11% |
| Fish (share of shallow water) | 50% | 50% |

- **Resources spawn only within 2 tiles of a city or village** [W].
- [G] resource base chances: 0.5 for crop, fish, fruit and game; 0.8 for metal; multiplied by the tribe modifier. How these combine with the inner/outer table is (unverified).

**Tribe modifiers** [W]:

| Tribe | Modifiers |
|---|---|
| Xin-xi | mountain ×1.5, metal ×1.5 |
| Imperius | animal ×0.5, fruit ×2 |
| Bardur | forest ×0.8, crop ×0 ([P] also: game ×2) |
| Oumaji | forest ×0.2, animal ×0.2, mountain ×0.5 |
| Kickoo | mountain ×0.5, fish ×1.5, water ×2 (the water effect is bugged and inactive) |
| Hoodrick | mountain ×0.5, forest ×1.5 |
| Luxidoor | base rates |
| Vengir | metal ×2, animal ×0.1, fruit ×0.1, fish ×0.1 |
| Zebasi | mountain ×0.5, forest ×0.5, fruit ×0.5 ([P] also: crop ×2) |
| Ai-Mo | mountain ×1.5, crop ×0.1 |
| Quetzali | fruit ×2, crop ×0.1 |
| Yădakk | mountain ×0.5, forest ×0.5, fruit ×1.5 |

[G] `startingResource` guarantees the tribe's resource on the 8 tiles around the capital; by default this is the resource of its starting tech's first improvement.

### 6.4 Placement [W][P]

**Order of placement:**

1. Capitals.
2. Suburbs (Lakes and Archipelago only).
3. Pre-terrain villages.
4. Terrain.
5. Post-terrain villages.
6. Resources.
7. Lighthouses (4 corners).
8. Ruins.
9. Starfish.

**Capitals:**

- Drylands, Lakes, Archipelago and Water World use quadrants: 4 for 1–4 players, 9 for 5–9, 16 for 10–16. One capital per randomly chosen free quadrant (weighted to keep players apart).
- Continents and Pangea: villages are placed first, then villages far apart and preferably coastal are converted into capitals.

**Suburbs** (Lakes, Archipelago): up to 2 villages near each capital.

**Pre-terrain villages:** `floor(width/3)² − (#capitals + #suburbs)`, multiplied by 0.3 (Lakes, Archipelago) or 0.1 (Water World). Each must be at least 1 tile from the edge and 2 tiles from other villages.

**Post-terrain villages** are added until no valid tile remains:

- Not within 2 tiles of the edge, and not exactly 3 tiles from it.
- Not within 2 tiles of another village.
- [W] also says "at most one village per 3×3"; the exact spacing is (unverified).

**Ruins:**

- Any terrain except shallow water: field, forest, mountain or **ocean** (more likely on mountains since 2.0.58).
- Not adjacent to another ruin, a capital, or (per [P]) a village. [W] says ruins may be next to villages since 2.0.58 (unverified).
- On non-Drylands maps at most ⅓ of the ruins are on water.

**Starfish:** about 1 per 25 water tiles, on shallow water or ocean. Not adjacent to another starfish, a lighthouse or a city.

---

## 7. Game modes and score

### 7.1 Score [W][E]

| Item | Points |
|---|---|
| Unit | 5 × cost (super unit 50). A boat counts its passenger plus the upgrade cost [E]. Lost when the unit dies or is disbanded; conversion changes nothing. |
| Territory | 20 per tile (plus the building score on the tile when captured) |
| Exploration | 5 per explored tile |
| City | 100, plus 50 per level above 1 (internally 5 per population plus a level bonus of 40/35/… summing to 50 per level). Levels ≥ 10 lower the score [W]. |
| Park | 250 |
| Monument | 400 |
| Temple | **100 × level**; level = `1 + floor((current turn − build turn) / 2)`, capped at **5** (max 500). The level rises at the owner's turn start [E]. Pre-2.14 values were 50 per level. |
| Technology | 100 × tier |
| Starving city (negative population) | Score penalty since 2.15; the amount is unverified |

**Turn-0 check:** city 100 + 9 tiles ×20 + 25 explored ×5 + warrior 10 + tier 1 tech 100 = **515**.

### 7.2 Modes [W]

**Perfection (single player):**

- **30 turns**; the highest score wins.
- **Final score** = score × difficulty bonus. The bonus is `100% + 41% × ln(number of opponents)`, plus 20% (Normal), 40% (Hard) or 80% (Crazy). Easy table: 1 → 100%, 2 → 128%, 3 → 145%, … 15 → 211%; maximum 291% (15 Crazy opponents).
- **Caveat:** "Patch of the Ocean" (Feb 2024) "lowered the score bonus for opponent count". The 41% coefficient may be outdated (**unverified for the current version**).
- Tribe stars at 3,000 / 10,000 / 50,000 points; a halo at 100,000.

**Weekly Challenge:** Perfection rules with a **20-turn** limit and a fixed seed.

**Domination (single player):**

- No turn limit. A player is eliminated when it loses its **last city**; the game ends when one tribe remains.
- Rating = average of four equal parts:
  - **Speed:** 100% if the game is won within 10 turns per enemy; otherwise `(10 × enemies) / turns taken`.
  - **Battle:** `(kills + 1) / (losses + kills + 1)`.
  - **Tribes destroyed:** the share of opponents the player eliminated itself.
  - **Difficulty:** 25% / 50% / 75% / 100% for Easy / Normal / Hard / Crazy.

**Multiplayer:**

- **Glory:** the first to **10,000 points** wins; ties are decided by the highest score at the end of the turn.
- **Might:** capture **every capital**.

**Creative:** free settings; Perfection, Domination or Infinity rules.

### 7.3 Tasks (unlock monuments; still present) [G][E]

| Task | Condition | Starts with | Monument |
|---|---|---|---|
| Pacifist | 5 consecutive own turns without attacking. Turns count only while Meditation is owned [E]. | Meditation | Altar of Peace |
| Genius | Own every tech | Philosophy | Tower of Wisdom |
| Wealth | Hold **100 stars** | Trade | Emperor's Tomb |
| Killer | **10 kills** | first kill | Gate of Power |
| Metropolis | A **level ≥ 5** city (levelled up or captured) | first level-up | Park of Fortune |
| Network | **5 cities connected** to the capital | first connection | Grand Bazaar |
| Explorer | Discover all **4 lighthouses** | always | Eye of God |

Every monument gives 3 population and 400 score, is built for free on field, shallow water or ice, and can be built once per player (blocked only by having built it already) [E].

---

## 8. Tribes: starting tech, starting unit, starting stars (since 2.14, Sep 2025) [N][W]

| Tribe | Starting tech | Starting unit | Starting stars |
|---|---|---|---|
| Xin-xi | Climbing | Warrior | 7 |
| Imperius | Organization | Warrior | 5 |
| Bardur | Hunting | Warrior | 5 |
| Oumaji | Riding | Rider | 6 |
| Kickoo | Fishing | Warrior | 5 |
| Hoodrick | Archery | Archer | 7 |
| Luxidoor | none | Warrior | 2, plus a **level 3 capital** (no wall) |
| Vengir | Smithery | Swordsman | 5 |
| Zebasi | Farming | Warrior | 5 |
| Ai-Mo | Philosophy | Mind Bender | 5 |
| Quetzali | Strategy | Defender | 7 |
| Yădakk | Roads | Warrior | 7 |
| Aquarion (special) | none | Mermaid | 5 |
| ∑∫ỹriȱŋ / Elyrion (special) | Forest Magic | Warrior | 5 |
| Polaris (special) | Frostwork | Mooni | 5 |
| Cymanti (special) | Farming (its own version) | Shaman | 5 |

How differing starts work in the game [G]:

- `startingTech` is a list that always includes `basic`.
- `startingUnit` is placed in the capital and can act on turn 0.
- `startingStars` defaults to 5.
- `bonus` can be `CityLevel3`, which Luxidoor uses.

---

## Open items (could not be verified)

- Market, Sawmill and Forge `maxLevel`. The Market is capped at 8 [W][E]; the Windmill example has 8 [G]; the others are unverified.
- Embassy cost scaling after 2.14.
- Perfection difficulty-bonus coefficients after Patch of the Ocean.
- The starvation score penalty (2.15).
- Exact map-generation algorithm and village spacing.
- Whether ruins are destructible.
- Splash rounding: floored in [E], unrounded in [W].
- Diplomacy rules for 3 or more players.
