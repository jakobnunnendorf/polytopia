# The Battle of Polytopia: rules and game logic

26 Nov 2026 · this file is the source of truth for the game rules. The Claude Doc https://claude.ai/artifact/L4zqyQC7y4nj1EZu1Pevwm it was exported from (revision 24) is an old copy as of 26 Nov 2026 and is no longer updated.

## About this reference

This is a reference for every rule and mechanic of The Battle of Polytopia (Midjiwan) that public sources describe, as of November 2026, with the exact numbers the engine in this repository needs. Numbers describe the current version of the game; rules that changed in an update say which version they belong to. It merges two earlier rules files on 26 Nov 2026: a broad one by topic (exported from the Claude Doc) and a numbered, numbers-complete one; §1 to §8 keep the numbering of the latter, so older section citations stay valid.

- **Version.** The current game is **2.18.0 "Mighty Achievements" (2 Nov 2026)**. The last update that changed rules was **2.15.0 "Cymanti Rework" (29 Oct 2025)**, preceded by **2.14.0 "Balance Adjustments 2025" (9 Sep 2025)**. 2.16 to 2.18 (skin, UI rework of 9 Jun 2026, achievements) and the 2026 patches 2.8.6 and 2.9.1 changed no rules. The one 2026 rule change found is the Explorer: 15 steps cut to 12 (16 Feb 2026).
- **Sources.** Values carry a source tag where one source decides them (the tags are explained in §14): **[W]** community wiki, **[G]** the game's own data (GLD v28) as documented by PolyMod, **[E]** a re-implementation checked against recorded games, **[N]** patch notes, **[P]** a community map generator. Untagged values come from the wiki, the official site and help pages, patch notes and player guides; each section links its pages, and the full list is in §14.
- **Conflicts.** Where the game code or data ([E]/[G]) disagrees with [W], [E]/[G] is used and the difference is noted. Where this repository's engine (`engine/core/src`, which follows the game's 2.18 data, see `docs/RULES_PARITY.md`) settles a conflict, the engine location is named. The rest is listed in §13.
- **(unconfirmed)** or **(unverified)** marks a value found in only one source, or one no source states clearly for the current version.
- **Wording:** everything is summarised in plain words; no text or art from the game or the wiki is copied.
- **Special tribes:** §1 to §8 describe the 12 regular tribes; Aquarion, Elyrion, Polaris and Cymanti are in §9.

Outline: §1 Technology · §2 Units · §3 Combat · §4 Movement, terrain and vision · §5 Economy and cities · §6 Map generation · §7 Modes and score · §8 Tribes · §9 Special tribes · §10 Diplomacy · §11 AI and difficulty · §12 Rule changes by version · §13 Open questions · §14 Sources.

---

## 1. Technology

Stars are the only currency. At the start of each turn you collect your income (§5.2); you then train units, research techs and build in any order, and each unit acts once. ([Technology](https://wiki.polytopia.com/wiki/Technology), game data version 28)

### 1.1 Cost

A tech's price grows with its tier and with the number of cities you own, so wide empires pay more per tech.

```
price = ceil( (4 + tier × C) × m )
```

- `C` is the number of cities the player owns now [G][E][W]. All owned cities count, including captured ones.
- `m = 1`. With **Literacy** (from Philosophy) `m = 0.66666f`, a 32-bit float [E]. The wiki calls this "−33%, rounded up" (a fifth off before February 2021). At 0.66 instead of 0.66666 the result first differs at a base price of about 50 stars.
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

**Prerequisites.** A tech can be researched if the player owns its parent. Since 2.14 (Sep 2025) it can also be researched if the player owns **one of its children**: "backwards" research, for example Vengir from Smithery to Mining without Climbing [N][G].

**Ruins.** A ruin can grant a random tech that is currently researchable (§5.10).

### 1.2 Tree

The standard tree has 25 techs: five branches of 1 + 2 + 2 techs (one tier-1 tech unlocks two tier-2 techs, each of which unlocks one tier-3 tech). Without any tech, every tribe can already train Warriors, move on fields and forests, and turn units into Rafts at a port. Special tribes swap some techs (§9).

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

- Strategy is still called "shields" in the game data, and Ramming was named Aquaculture until August 2024.
- Ruins and the "Explorer" lighthouse task need no tech. The Killer, Metropolis, Network and Explorer tasks start by themselves [G].
- Tribe-specific renamed techs (Frostwork, Forest Magic, Spearing, Waterways, Shock Tactics, Recycling and others) exist only for the special tribes (§9).
- The GLD player abilities include **discipline** (promotion after 2 kills) and **treehouse**/**pontoon** (build field buildings on forest/water). No regular-tribe tech grants them [G].

---

## 2. Units

Units are trained in cities for stars, and each unlocks with one tech. Stats come from the game data [E rules.json = GLD v28], cross-checked with [W]. **HP** is maximum health. A **veteran** gets **+5 max HP**. Unit stats last changed in 2.15 (October 2025); versions 2.16 to 2.18 left them alone. ([Units](https://wiki.polytopia.com/wiki/Units) and each unit's own page)

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
| Cloak | 8 | 5 | 0 (2 in the data, used only for infiltration damage) | 0.5 | 2 | 1 | hide, infiltrate, dash, scout, creep, stiff, static | Diplomacy |
| Dagger | 2 (score and disband value; cannot be trained) | 10 | 2 | 2 | 1 | 1 | dash, surprise, independent, static | spawned by Cloak infiltration (§3.6) |
| **Giant** (super unit) | 10 (theoretical: score 50, disband 5) | 40 | 5 | 4 | 1 | 1 | static (no dash, no fortify) | city level-up reward, level 5 and above |

- The Knight went to 10★ in 2021, then back to 8★ with 15 → 10 HP in 2022. ([Knight](https://wiki.polytopia.com/wiki/Knight))
- A hidden Bunny (20 HP, attack 5) appears if you tap an empty tile of your own 10 times; it can't be converted and isn't in multiplayer. ([Bunny](https://wiki.polytopia.com/wiki/Bunny))
- Units removed earlier: the Guard Tower and an Oumaji Scout.

### 2.2 Naval units

The current system dates from 2.8 "Path of the Ocean" (November 2023). A land unit that enters an own port becomes a Raft, and paying stars upgrades it. All naval units have the skills water and carry. Their HP is the **carried unit's HP** (including the veteran +5: 10 for a Warrior, 15 for a Defender, 20 for a veteran Swordsman), except the Juggernaut and Dinghy/Pirate, which carry their own HP. ([Path of the Ocean](https://wiki.polytopia.com/wiki/Whatsnew-path-of-the-ocean))

| Unit | How obtained | Cost | Attack | Defence | Move | Range | Skills | Tech |
|---|---|---|---|---|---|---|---|---|
| Raft | any land unit that moves onto an own Port | free | 0 | 1 | 2 | – (cannot attack) | carry, stiff, static | Fishing (Port) |
| Scout | Raft upgrade | 5 | 2 | 1 | 3 | 2 | dash, scout, static | Sailing |
| Rammer | Raft upgrade | 5 | 3 | 3 | 3 | 1 | dash, static | Ramming |
| Bomber | Raft upgrade | 15 | 3 (4 before February 2024) | 2 | 2 | 3 | splash, stiff, static (no dash) | Navigation |
| Juggernaut | Giant enters a Port | – | 4 | 4 | 2 | 1 | stomp, stiff, static; HP 40 | – |
| Dinghy | Cloak enters a Port | – | 0 (2 in the data, unused) | 0.5 | 2 | 1 | hide, infiltrate, dash, scout, stiff, static; **no creep**; HP 5 | – |
| Pirate | Dagger enters or spawns on water | – | 2 | 2 | **2** | 1 | dash, surprise, static; **not independent** in the 2.18 data; HP 10 | – |

The Dinghy and Pirate skill lists and the Pirate's movement follow the 2.18 game data as used by this engine (`engine/core/src/data_gen.rs`, `UnitDef` for Dinghy and Pirate); the wiki and [W] gave the Dinghy creep and the Pirate independent, and the Pirate's own page gives movement 2 against 1 elsewhere. Neither the Dinghy nor the Pirate can be upgraded. ([Pirate](https://polytopia.fandom.com/wiki/Pirate), [Dinghy](https://polytopia.fandom.com/wiki/Dinghy))

Naval rules:

- **Upgrades:** only an own **Raft**, only in **own or allied territory**. An upgrade costs the full price of the new boat, cannot be changed later, and does not heal [E][W].
- **Disembark:** when a boat lands, the passenger comes back and the naval upgrade is lost for good. The next Port makes a Raft again.
- **Disband refund** = ½ of the **passenger's** cost, rounded down. The upgrade cost is never refunded [E].

**The old system, removed in 2.8 (November 2023):** a unit in a port became a Boat (attack 1, defence 1, move 2, range 2). It upgraded to a Ship for 5★ (2/2/3, range 2) and to a Battleship for 15★ more (4/3/3, range 2, Scout). Elyrion enchanted whales into the Navalon (30 HP, 4/4/3). ([Boat](https://wiki.polytopia.com/wiki/Boat), [Battleship](https://wiki.polytopia.com/wiki/Battleship))

### 2.3 Not available to regular tribes

The **Amphibian** (3 stars, HP 10, attack 2, defence 1, move 2, range 1, amphibious/dash/escape) and the **Tridention** (8 stars, HP 10, attack 2.5, defence 1, move 2, range 2, amphibious/dash/persist) exist only for **Aquarion**: they replace the Rider and Knight through Riding and Spearing. Normal tribes can only get them by converting them with a Mind Bender. The Mind Bender itself is available to all regular tribes. Every special-tribe unit is listed in §9.

### 2.4 Skills (exact semantics, [G] plus engine [E])

A unit normally moves, then attacks, and the turn ends; skills bend that order. ([Unit abilities](https://wiki.polytopia.com/wiki/Unit_Abilities))

| Skill | Definition |
|---|---|
| dash | Can attack after moving in the same turn. Without dash, a unit that moved cannot attack. (Polaris ice: dash also allows breaking ice, §9.4.) |
| escape | Can move after attacking (the moved flag is cleared after the attack). A unit with dash and escape still attacks only once. |
| persist | After a **kill**, the unit may attack again, **only if another valid target is in range from where it now stands** [E]. There is no limit on chained kills. |
| double attack | Two attacks per turn; after the first it can't capture a city or examine a ruin (Cymanti Phychi). |
| fortify | Gets the city defence bonus in its **own** city: ×1.5, or ×4 with a City Wall. Without fortify a unit never gets the city bonus; it can still get the terrain bonus. |
| stiff | Never retaliates. |
| surprise | Its targets never retaliate. |
| convert | An attack converts the target to the attacker's side (no damage; works at 0 attack). The target does not retaliate, keeps its kill count, and the attacker's turn ends. The converted unit is homed in the converter's **capital**, falling back to the oldest city; it may exceed the city's unit capacity, which then blocks training there. Independent units stay homeless. Conversion changes neither player's unit score. It counts as an attack and destroys embassies (§10.1). Cymanti's Shaman has the same skill under the name **parasite**. |
| heal | Action "Heal Others" instead of moving: every adjacent friendly unit gets +4 HP (capped at max; a poisoned unit is only cured of poison). Allowed only if an adjacent friendly unit is damaged [E]. |
| splash | Range must be above 1. Units adjacent to the target take **½ of the normal damage formula computed against each of them, rounded down** to whole HP (`engine/core/src/combat.rs`, `half_damage`) [E]. [W] says there is no rounding (an "x.5 HP bug"). Hits enemies only (allies and protected players excluded). Splash does not reveal a hidden Cloak. |
| stomp | After **every move**, and on embark or disembark (a Juggernaut boarding or leaving a port), deals ½-damage (same formula, rounded down) to every adjacent enemy. |
| carry | Is a boat. Carries one unit. Can step onto a land tile next to water: the passenger is released and its turn ends. HP equals the passenger's. |
| scout | Sight radius 2 (5×5) instead of 1 (3×3), when moving, on training and on upgrade. |
| creep | Every tile except mountains costs normal movement (forest, flood and algae do not stop it). Gets **no road bonus**. Since 2.15 creep no longer overcomes mountains. **Does not ignore zone of control** in this engine (`engine/core/src/movement.rs`, `ignores_zoc` = hide or sneak; the 2.18 data check in `docs/RULES_PARITY.md`); [E] and the wiki's Cloak and Terrain pages say it does (§13.1). |
| sneak | Ignores zone of control; cannot pass through enemy units. |
| hide | Invisible after moving. Ignores zone of control. **May pass through tiles held by other players' units** (cannot end there). Revealed by attacking, capturing, examining a ruin, or being bumped into. Every unit detects a hidden unit on an adjacent tile [W] (§3.6). |
| infiltrate | The only possible target is an adjacent enemy city that was not already infiltrated this turn and is not under siege. See §3.6. |
| independent | Takes no city unit slot (unit capacity) and belongs to no city. |
| static | Never gains XP and is never promoted. |
| water | Moves only on water. |
| amphibious | Moves on water and land; the move stops after the first land tile that is not flooded. No roads (since 2.8). |
| fly (Air) | Ignores terrain and ports; every step costs 1; uses no roads; zone of control still stops it (special tribes only). |
| skate | Ice steps cost 1; on land at most 1 tile, and a turn ending on land allows no attack; dash and escape blocked on land (Polaris). |
| swarm | Shaman ends its turn; adjacent friendly units get +1 movement until attacked (replaced Boost in 2.15). |
| tentacles | Jelly damages enemies that move next to it, and enemies it moves next to; ranged attacks don't trigger it, freezing switches it off. |
| explode | Destroys the unit and deals ½-damage (rounded down, like splash) to adjacent enemies and poisons them; leaves spores on land or algae on water; allowed after attacking since 2.15. |
| freeze | The attacked enemy is frozen: it can't move, heal, attack or retaliate for a turn. |
| auto freeze | After moving, freezes adjacent enemies and turns adjacent water to ice. |
| freeze area | An action: as auto freeze, and turns adjacent land into Polaris terrain. |
| poison | The target's defence bonus 1 / 1.5 / 4 becomes 0.5 / 0.7 / 2 (§3.3), its movement drops by 1 and it can't heal; a heal removes the poison but restores no HP. A dead poisoned unit leaves spores (on land) or algae (on water). |
| grow | Turns into another unit after a set number of turns, keeping its damage (since 2.15). |
| eat | Each kill by attack adds a body segment; while it has segments the Centipede moves only 1 tile. |
| auto flood / drench | Floods each tile it moves onto / the tile it attacks. |
| algae | Leaves algae on the tiles it passes. |

**Veteran.** A unit becomes eligible after **3 kills** [G][E]. Kills by attack and by retaliation both count.

- **No XP** for a killer that is a boat (carry) or static. A passenger keeps the XP it had when it embarked; a non-static passenger can be promoted at sea [E].
- Promoting costs no action. It gives +5 max HP and heals to full.
- A unit can be promoted **only once**.
- A player may delay the promotion and use it as a free heal later.
- Ships, super units, Daggers, Pirates, Polytaurs and every static unit can't be promoted.

---

## 3. Combat

Damage depends on the attacker's attack and the defender's defence, each scaled by its unit's remaining HP; the defender's force also gets its terrain or city bonus. The attacker's defence and the defender's attack play no part. ([Combat](https://wiki.polytopia.com/wiki/Combat), checked against the community [battle calculator](https://frothfrenzy.github.io/polytopiacalculator))

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
- The bonus multiplies the defence **force** only; it does not multiply `D_def` in the retaliation term. So a defence-2 unit with a ×1.5 bonus takes the same damage as a defence-3 unit without one, but hits back less hard.
- This engine computes the same formula in the game's integer arithmetic, in tenths of HP with truncating divisions and halves rounded up (`engine/core/src/combat.rs`, `compute_damage`, `round_damage`).
- Poison (special tribes only): the defence bonus is halved as in §3.3; [E] also lists `D` ×0.7, and [W] and [N] say "defence −50%".

**Worked examples:**

| Fight | Forces (attack : defence) | Damage | Retaliation |
| --- | --- | --- | --- |
| Warrior attacks a Warrior, both full HP, open field | 2 : 2 | round(2/4 × 9) = 5 | round(2/4 × 9) = 5 |
| Warrior attacks a full Defender behind walls (×4) | 2 : 12 | round(2/14 × 9) = 1 | round(12/14 × 13.5) = 12, so the Warrior dies |
| Catapult attacks a full Swordsman in a forest (×1.5) from 3 tiles | 4 : 4.5 | round(4/8.5 × 18) = 8 | none: out of range |
| Knight attacks an Archer at 4 of 10 HP | 3.5 : 0.4 | round(3.5/3.9 × 15.75) = 14, a kill | none; the Knight moves in and Persist lets it attack again |

### 3.2 Retaliation happens only if all of these hold [E]

1. The defender survives the attack.
2. The attacker has neither surprise nor convert (nor freeze).
3. The defender is not stiff (nor frozen).
4. The Chebyshev distance attacker to defender is at most the **defender's range**.
5. The defender's owner has **explored** the attacker's tile (the attacker is visible to it, not in fog).
6. The computed retaliation is above 0.

### 3.3 Defence bonus [E][G]

The terrain bonuses are applied as per-tile alternatives in [E] (they do not stack): water/ocean, forest, mountain, or otherwise the city bonus.

| Situation | Bonus | Poisoned | Requirement |
|---|---|---|---|
| Unit on forest | ×1.5 | ×0.7 | the **unit owner** has Archery |
| Unit on mountain | ×1.5 | ×0.7 | owner has Climbing |
| Unit on shallow water or ocean (includes boats and units on bridges; not ice) | ×1.5 | ×0.7 | owner has Aquatism |
| Unit with **fortify** in **its own city** (a besieger gets nothing) | ×1.5 | ×0.7 | – |
| Same, with a City Wall | ×4 | ×2 | City Wall reward (city level 3) |
| Otherwise | ×1 | ×0.5 | – |

Villages you haven't captured give no bonus, and units without fortify get no city bonus.

### 3.4 After the attack [E]

- A **melee** attacker (range < 2) that kills its target and survives **moves onto the target's tile** if it may enter it: field/forest; mountain only with Climbing; water only for water units, onto a bridge, or onto an **own** Port. A Port makes it a Raft.
- A ranged unit **never** advances, even when it attacks an adjacent unit.
- After the attack the attacker is marked as having attacked. It may still move if it has escape, or attack again if it has persist and another target remains.
- If the attacker dies from retaliation, the defender gets the kill credit.
- Splash, stomp and explosions: half damage, rounded down (§2.4).

### 3.5 Healing [E][W]

| Source | Amount |
|---|---|
| **Recover** action (unit not moved or attacked this turn; damaged) | +4 HP if the tile is **own territory** (or a peace partner's); +2 HP otherwise. Capped at max HP. A poisoned unit is cured instead of healed. Ends the unit's turn. |
| **Automatic** | At the owner's end of turn, every unit that neither moved nor attacked heals the same amount (+4 or +2). |
| Mind Bender "Heal Others" | +4 HP to every adjacent friendly unit (flat, in any territory). |
| Veteran promotion | Full heal plus 5 max HP. |

Poison blocks healing; frozen units don't heal.

### 3.6 Cloak infiltration [W][E]

**Hidden and visible.** A Cloak (stats in §2.1) is visible on the turn it is trained, and after it captures a village, examines a ruin, breaks ice or harvests a starfish; it hides again once it moves. An enemy trying to enter its tile is stopped, which reveals the Cloak so it can be attacked. Since October 2022 every unit detects an adjacent Cloak. ([Cloak](https://polytopia.fandom.com/wiki/Cloak))

**Infiltration** (a Cloak moves into an adjacent enemy city):

- The Cloak is consumed.
- A non-allied unit in the city takes the damage of a full-HP Dagger attack (attack 2, using its defence bonus).
- The attacker gains stars equal to the city's own income (level + workshop + park + capital bonus, minus negative population). The city's own production is 0 on its owner's next turn ("riot"). Market, Ice Bank, Sanctuary and embassy income are untouched.
- **min(city level, 5)** Daggers spawn within the city's borders. Priority: the city tile (if it is empty or its defender died), then tiles with a defence bonus, known resources, and land over water; a Pirate spawns on water. No free tile means no Dagger. Since November 2023, killing the defender guarantees a Dagger in the city. The Daggers cannot act until their owner's next turn.
- A city can be infiltrated once per turn, never while under siege.
- A Cloak cannot infiltrate on the turn it became hidden, unless it started that turn hidden [W] (this engine allows it after a move too: `docs/RULES_PARITY.md`, second core audit).
- Infiltration does not count as an attack for the Pacifist task.

Special tribes: Aquarion's Scuba spawns Mermaid Daggers; Cymanti use the Moth (§9.5). ([2.2.9 notes](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4588629064110779566), [Dagger](https://polytopia.fandom.com/wiki/Dagger))

---

## 4. Movement, terrain, vision

Movement points pay for steps, and terrain, roads and enemies change what a step costs. ([Movement](https://wiki.polytopia.com/wiki/Movement))

### 4.1 Basics

- Distance is **Chebyshev** (8-neighbour grid).
- Each unit has a **budget of `movement × 2` half-steps**. A normal step costs 2; a road-to-road step costs 1 (½ a move).
- One tile holds one unit.
- A unit moves once per turn (dash and escape as in §2.4).
- **Expansion rule [E]:** the unit can keep stepping from any tile reached with cost below the budget. So with ½ move left it can still enter any one adjacent tile (the game "rounds up" [W]).
- **Modifiers:** Swarm and Bubble each give +1 movement (they don't stack); Poison gives −1. Polaris Glide makes an ice step cost 0.9 (§9.4).
- **Passing through:** units may pass through their own and allied units but not stop on them. Enemy units block the path, except for hide.
- **Pushing:** a unit created on an occupied tile pushes the occupant (§5.13). Being pushed doesn't use the unit's turn.

### 4.2 Terrain [E][W]

| Terrain | Enter | Effect |
|---|---|---|
| Field | always | – |
| Forest | always | **Entering ends the move** unless the step is road to road (creep is exempt) |
| Mountain | **Climbing** required | **Entering always ends the move** (creep too, since 2.15). No roads possible. Sight radius 2 from a mountain. |
| Shallow water | **Fishing** required, only for water/naval units; land units only via an own Port (embark), a peace partner's Port, or a Bridge | – |
| Ocean | **Sailing** required | Ocean is water with no land neighbour |
| Cloud (unexplored) | **cannot be entered** by any unit; the Explorer reward is the exception | – |
| Own Port (land unit enters) | – | The move ends; the unit becomes a Raft (Giant → Juggernaut, Cloak → Dinghy, Dagger → Pirate) and cannot act further this turn |
| Land tile for a boat | – | The move ends; the boat disembarks and the passenger's turn ends |
| Ice (Polaris) | land units walk on it | 1 per step, 0.9 with Glide; no roads (§9.4) |
| Flooded (Aquarion) | land and water units | Ends the move for ships and for amphibious units leaving water onto dry land (§9.2) |
| Algae (Cymanti) | – | Ends the move for land units that don't swim (§9.5) |

Tiles that end the move also include **any tile next to an enemy** (§4.3).

### 4.3 Zone of control [E][W]

- Any tile **adjacent to a non-allied, non-hidden enemy unit** is terminal: the move stops there.
- This counts **unseen enemies too** [E: TileData.GetMovementCost reads the raw neighbours]: enemies hidden in clouds still exert it.
- Zone of control overrides roads; it is checked before roads, Glide, creep or fly.
- Exempt: sneak and hide (invisible), which covers the Cloak and Dinghy. **Creep is not exempt** (`engine/core/src/movement.rs`, `MoveCtx` and `ignores_zoc`; §13.1).
- Peace partners, hidden units and Centipede segments exert none.
- Starting your turn inside an enemy's zone doesn't trap you.
- A unit with dash may still attack after stopping.

### 4.4 Roads and bridges [E][W]

| Item | Cost | Placement | Effect |
|---|---|---|---|
| Road | 3 stars (2 before November 2023) | Field or forest, in own **or neutral** territory. Not on mountain or water. Not on any city or village tile (they already count as road). Cannot be destroyed. | A road step costs ½ (1 half-step) when **both** tiles are road-network tiles. |
| Bridge | 5 stars (7 at launch in November 2023) | Shallow water with **land on both opposite sides**, either north-south or east-west (north-south wins if both hold). Own or neutral territory. Can be destroyed. | Land units may cross. Counts as road. Naval units pass through. |

- **Road-network tiles:** road, bridge, village, and any city in own, neutral or **peace-partner** territory.
- Roads in enemy territory give no bonus.
- A road on a forest tile removes the forest stop (road-to-road step only).
- Roads give no bonus on ice, or to creep, skate, fly, amphibious or swimming units.
- A Rider covers 4 road tiles in one move, a Knight 6.
- Without Fishing, a bridge cannot be entered straight across its span; diagonal steps onto it are allowed [E].

### 4.5 Naval

| Item | Rule |
|---|---|
| Embark | A land unit moves onto an **own** Port (or a peace partner's; enemy Ports cannot be used). It becomes a Raft, or keeps its special boat form; its turn ends (Rafts have no dash). |
| Shallow water | Needs Fishing |
| Ocean | Needs Sailing |
| Speed | Raft 2, Scout 3, Rammer 3, Bomber 2, Juggernaut 2 |
| Port-to-Port connections over ocean | Need Sailing (`engine/core/src/state.rs`, `water_path`); [W] says Navigation (§13.1). Details in §5.6. |

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
| Capital Vision (Diplomacy) | The capital tiles of every met tribe (§10.2) |
| Lighthouses (the 4 map corners) | Always start in fog |
| Elyrion units | Also see ruins through clouds |

---

## 5. Economy and cities

Cities make your stars, house your units and grow by population. ([City](https://wiki.polytopia.com/wiki/City), [Population](https://wiki.polytopia.com/wiki/Population), [Star](https://wiki.polytopia.com/wiki/Star))

### 5.1 Start

- One capital at **level 1** (Luxidoor: level 3, `engine/core/src/data_gen.rs`, `TribeDef` `capital_level: 3`), with **3×3 territory** (radius 1).
- One starting unit.
- Starting tech: `basic` plus the tribe's tech.
- Starting stars: **5 by default**; tribe values in §8.
- **No income is paid on turn 0** [E].

### 5.2 Income per turn (paid at the start of the owner's turn) [E][W]

```
city income = level + Workshop(1) + Park(1 each) + capitalBonus
              − (negative population, if any), floored at 0
total       = Σ cities not under siege + Σ markets (§5.5) + tribe buildings + embassies
```

- **capitalBonus** (the original capital only): human players and Normal bots +1; Easy bots 0; Hard bots +2; Crazy bots +4. So a level 1 capital earns 2/1/3/5 [E][W].
- **Siege:** any unit of another player (hidden ones included) standing on the city tile stops the city's own income. Its Markets still pay [E].
- **Tribe buildings** are the special tribes' Sanctuary, Clathrus and Ice Bank (§9); **embassies** pay 2★ each way, 4★ at peace (§10.1).
- **Parks** have given +1★ per turn since November 2023; before that they gave only score.
- **No star cap** is mentioned in any source (unconfirmed), and there is no unit upkeep.

### 5.3 Population and levels

A city at level L needs L+1 population to reach the next level.

| Rule | Value |
|---|---|
| Population to go from level `L` to `L+1` | `L+1` (so the bars shown = level + 1) |
| Excess population | Carries over and can level up several times at once [E] |
| Each level-up | +1 star of income, +50 score (40/35/… share; see §7.1) |
| **Unit capacity** | **level + 1** units homed in the city. Independent units (Dagger, Polytaur, Larva, Segments) take no slot. Training also needs the city tile to be empty [E]. Trained units cannot act on the turn they are trained. |
| Negative population (for example after losing connections) | −1 star of income per point, not below 0. Does not reduce unit capacity. |

**Level-up reward (choose one)** [W][E]:

| New level | Option A | Option B |
|---|---|---|
| 2 | Workshop (+1 star/turn) | Explorer (§5.12) |
| 3 | City Wall (defence ×4 for fortify units) | Resources: +5 stars |
| 4 | Population Growth: +3 population | Border Growth: territory radius 2 (claims unowned tiles in 5×5; reveals 5×5). Offered only at level 4, so 5×5 is the largest border. |
| 5 and above (every level) | Park (+1 star/turn, +250 score) | Super unit: a Giant spawns on the city tile (Aquarion Crab, Elyrion Dragon Egg, Polaris Gaami, Cymanti Centipede). An occupant is pushed (§5.13), which pushes besiegers out of the city. |

**Population sources:** harvesting and buildings (§5.4, §5.5), connections (§5.6), monuments (+3), temples (+1), ruins (+3 in the capital, §5.10) and lighthouses (+1 in the capital, §5.11).

### 5.4 Harvest actions

All harvest actions are on an own, owned tile with no building. Each gives **+1 population** to the tile's city and removes the resource.

| Action | Cost | Resource | Tech |
|---|---|---|---|
| Harvest Fruit | 2 | fruit (field) | Organization |
| Hunting | 2 | wild animal (forest) | Hunting |
| Fishing | 2 | fish (shallow water, and ocean since 2.8) | Fishing |
| Starfish Harvesting | **+8 stars** (10 before February 2024), no population | starfish (water or ocean). Any unit may stand on it, **in any territory**, at the start of its turn; the action uses up the unit's turn. Not on a tile that has a building. | Navigation |
| Clear Forest | **+1 star** (2 before May 2022) | forest → field | Forestry |
| Burn Forest | 3 (5 from February 2024, 3 since 2.14) | forest → field **with crop** | Construction (Chivalry before February 2024) |
| Grow Forest | 5 | field → forest (removes any resource) | Spiritualism |

Whales (+10★ by Whaling) were removed in 2.8 (November 2023) and starfish took their place; whales are still in the data file, but nothing can harvest them.

### 5.5 Buildings

A building goes on an own tile, one building per tile. "One per city" counts the city's territory. ([Buildings](https://wiki.polytopia.com/wiki/Buildings), [PolyMod data reference](https://github.com/PolyModdingTeam/PolyMod/tree/main/docs/gld))

| Building | Cost | Terrain / requirement | Population | Other | Tech |
|---|---|---|---|---|---|
| Farm | 5 | field with crop | 2 | – | Farming |
| Mine | 5 | mountain with metal | 2 | – | Mining |
| Lumber Hut | 3 (2 before November 2023) | forest | 1 | – | Forestry |
| Windmill | 5 | field, next to an own Farm; one per city | 1 per adjacent own Farm (maxLevel 8 [G]) | – | Construction |
| Sawmill | 5 | field, next to an own Lumber Hut; one per city | 1 per adjacent own Lumber Hut (maxLevel 8, unverified) | – | Mathematics |
| Forge | 5 | field **or forest** (since 2.14), next to an own Mine; one per city | **2** per adjacent own Mine (maxLevel 8, unverified) | – | Smithery |
| Market | 5 | field, next to a Windmill, Sawmill or Forge; one per city | 0 | **Stars/turn = Σ levels of the adjacent own Windmills, Sawmills and Forges, capped at 8.** A building's level = its count of adjacent feeders. Recomputed at turn start [E]. | Trade |
| Port | 7 (10 before November 2023) | **shallow water** (or a flooded field) | 1 (2 before November 2023) | Embark point; connects cities by sea (§5.6) | Fishing |
| Temple | 20 | field | 1 | Score §7.1 | Free Spirit |
| Mountain Temple | 20 | mountain | 1 | – | Meditation |
| Forest Temple | 15 | forest | 1 | – | Spiritualism |
| Water Temple | 20 | shallow water or ocean | 1 | – | Aquatism |
| Embassy | 5 (2.14 says the cost "starts cheaper and rises with each Embassy owned"; this engine: 4 + 2 per embassy already built, `engine/core/src/data.rs`, `embassy_cost`) | Inside a met tribe's **original** capital; one per tribe | 0 | §10.1 | Diplomacy |
| Monument (one of 7) | free when its task is done; each can be built once per player | field or shallow water (frozen shallow water included) | **3** | +400 score | task (§7.3) |

Rules:

- Adjacency counts only neighbour tiles **owned by the same player** [G][E].
- The Market replaced the Customs House (+2★ per adjacent port) in November 2023 and got its current rule in February 2024. Some wiki pages still show the older rule of 2★ per adjacent building.
- A temple gains a level every 2 turns (3 before February 2024), up to level 5; its score is in §7.1.
- **Destroy** (Chivalry; Construction before February 2024), on an own tile:
  - Removes the building, its population (including the population from levels) and its score.
  - Cannot remove a city, ruin, lighthouse or road.
  - Gives no refund.
  - Lost monuments cannot be rebuilt.
- Buildings removed before 2.18 (Customs House, Whaling) are not modelled; the Aqua Farm is Aquarion-only.

### 5.6 City connections [E][W]

- A non-capital city is **connected** when it links to the capital through the road network (§4.4: roads, bridges, cities, villages; own, neutral or peace-partner territory) and/or Port-to-Port links. Special tribes also link over Outposts, Mycelium or Atolls (§9).
- **Port-to-Port link:** both ports are own; their Chebyshev distance is **at most 5**; and a path runs between them over friendly (own, neutral or peace) water tiles, ocean only with Sailing. The search expands only over tiles within distance 5 of the first port. A port tile is itself a network node next to land. (`engine/core/src/data.rs` `PORT_RANGE = 5`, `engine/core/src/state.rs` `water_path`; the game data says range 5, the wiki pages 4 or 5 water tiles.)
- **Each connected city gives +1 population to itself and +1 to the capital.** Losing a connection (a capture, or a broken peace) removes them; the result can be negative population.
- Fog: [W] says no connection forms through tiles hidden by fog; in the 2.18 rules no explored tiles are needed (`engine/core/src/state.rs`, `update_connections`).
- **Network task:** connecting 5 cities to the capital earns the Grand Bazaar (§7.3); the task starts by itself at your first connection (since November 2023). ([City connection](https://wiki.polytopia.com/wiki/City_Connection))

### 5.7 Territory

| Event | Territory |
|---|---|
| New city (village capture) | Claims the **unowned** tiles at radius 1 (3×3). Already-owned tiles are not taken. |
| Border Growth | Radius 2 (5×5), unowned tiles only |
| Capturing an enemy city | Takes its whole territory |
| Each owned tile | 20 score |

### 5.8 Capturing villages and cities [E][W]

- **Capture** is an action of a unit that **started its turn on the tile**: it has not moved or attacked this turn. Arriving is not enough. Any unit type can capture (since 2.0.31, December 2020).
- The action ends the unit's turn and reveals the unit if hidden.
- **Village:**
  - Becomes a level 1 city of the capturer (1★ per turn): +100 score, territory as in §5.7.
  - Home transfer: the capturing unit's home city becomes the new city; it frees its slot in the old city.
- **Enemy city:**
  - Keeps its level, population and rewards (Workshop, wall, parks).
  - Score `100 + 50×(level−1) + 5×population + 250×parks` moves from the old owner to the capturer, plus the tiles (20 each) and each building's points.
  - The capturing unit's home becomes that city. Units of the old owner homed there lose their home, so they no longer use any city's unit slots.
  - Road connections through the lost land are cut, and the population they gave goes with them (it can go negative).
- **Last city:** capturing a player's last city eliminates them. All their units are disbanded and refunded [E]. Losing only the capital doesn't eliminate a tribe (capitals decide Might, §7.2).
- **Capital:** capturing a capital destroys every embassy in it.
- Units of a player at peace (or on truce cooldown) cannot capture that player's cities.

### 5.9 Tribe meeting reward [E]

A player meets another tribe the first time it sees one of that tribe's units, or its city [W]. It then gains

```
1 + 2 × min( ceil(score_met / 1000), 5 )   // max 11 stars
```

- In a 2-player game, the seat that meets player 1 (the seat moving second) gets **+2 more** ("away stars", game version ≥ 123).
- Before September 2021 a meeting stole a tech instead. The patch notes of October 2022 give a different formula (§13.1). ([Star](https://polytopia.fandom.com/wiki/Star))

### 5.10 Ruins

- **Examining** a ruin needs a unit that started its turn on it; the unit's turn ends.
- The reward is **uniformly random among the eligible options** [E][W]; no odds are published. ([Ruin](https://wiki.polytopia.com/wiki/Ruin))

| Reward | Effect | Eligible when |
|---|---|---|
| Resources | +10 stars | always |
| Scroll of Wisdom | a random free tech among those currently researchable (§1.1) | the tree is not complete |
| Population | +3 population to the capital | the player owns a capital |
| Explorer | an Explorer starts from the ruin (§5.12) | the ruin is not on a mountain **and** some tile within radius 2 is unexplored |
| New Friends | Land ruin: a **veteran Swordsman** (home-less; a Giant before September 2021). Water ruin (since February 2024): a **veteran Rammer carrying a Warrior** (HP 15). Pushes any occupant (§5.13). | always on land; on water only with Sailing (`engine/core/src/actions.rs`, `do_examine`) |
| Lost City | §9.2 | Aquarion, valid ocean ruin |

- Ruins block building on the tile until examined.
- Chivalry's Destroy can remove a ruin [W]. In [E] ruins are not destructible (unverified).
- The 2.18 rules as ported here are a little wider: population and resources always, the explorer also from mountains when a neighbour can be entered (`do_examine`; `docs/RULES_PARITY.md`, "Ruin rewards").

### 5.11 Lighthouses and other one-off stars

| Item | Effect |
|---|---|
| Lighthouse (one per map corner) | Every tribe that uncovers a lighthouse gets +1 population in its capital (its oldest city without one) (`engine/core/src/state.rs`, `explore`) and adds its colour as a tier. Lighthouses can't be built on or destroyed, and always start under clouds. Finding all 4 completes the Explorer task (§7.3). ([Lighthouse](https://wiki.polytopia.com/wiki/Lighthouse)) |
| Ruin: Resources | +10 stars (§5.10) |
| Starfish | +8 stars (§5.4) |
| City level 3 reward: Resources | +5 stars (§5.3) |
| Clear Forest | +1 star (§5.4) |
| Meeting a tribe | §5.9 |
| Disband (Free Spirit; unit not moved or attacked) | Refunds ½ of the cost, rounded down. A super unit refunds 5. Removes the unit's score. |
| Infiltration | Steals the city's income (§3.6) |

### 5.12 Explorer [E][W]

- A walker controlled by the game, not a unit. It takes **12 steps** (15 before 16 Feb 2026; `engine/core/src/data.rs` `EXPLORER_STEPS = 12`).
- Each step it moves to an adjacent tile and reveals the 3×3 around it. It may move onto occupied tiles and into fog.
- **Step choice:**
  - Each fog tile is scored `183 − 10×min(max(unexplored tiles within radius 2, 1), 4) − 33×(a lighthouse is within those tiles)`.
  - The scores are spread by a 3-pass breadth-first search, adding +100 per step.
  - The explorer picks the lowest-scoring neighbour, +1 for backtracking.
  - Ties are broken by RNG.
  - In plain words: each step goes toward the nearest fog, preferring paths that uncover the most, and heads for lighthouses first. ([Explorer](https://wiki.polytopia.com/wiki/Explorer))
- **Passable explored terrain:** mountain needs Climbing; shallow water needs Sailing; ocean needs Navigation [E]. This differs from unit movement; [W] says the same.
- It stops early if no step is possible.

### 5.13 Forced push (super unit spawn, ruin unit) [W][E]

The unit already on the tile is pushed one tile:

- A friendly unit is pushed in the direction of its last move.
- An enemy unit is pushed opposite to its last move.
- A ranged unit that last attacked is pushed by its attack direction.
- A unit that never moved is pushed toward the map centre; at the exact centre, south.

If that tile is blocked, the push tries the alternatives in the order ±45°, ±90°, ±135°, 180°, preferring the one nearer the centre. If all 8 are blocked, the unit is removed. Being pushed doesn't use the unit's turn.

### 5.14 Peace (Strategy and Diplomacy) [W][E]

Strategy unlocks peace treaties; both it and Diplomacy arrived in update 2.2 (May 2022). ([Strategy](https://polytopia.fandom.com/wiki/Strategy), [Diplomacy FAQ](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4469272893492663515))

| Topic | Rule |
|---|---|
| Offering | Open a tribe's info popup (its name bubble, or its face in Game Stats) and choose Offer Peace. Needs Strategy to **offer**; none to accept. The receiver accepts or declines on its next turn. |
| While at peace | No attacks, captures or conversions. No zone of control between the two. Units may pass through each other's units (not end there) and use each other's roads. Embassy income doubles. Each sees the other's Cloaks. Units heal 4 HP in the partner's territory, as in their own. |
| Duration | Permanent, until one side breaks it. There is no shared victory: Might and Domination still require beating every rival. |
| Breaking peace | The breaker's units in the partner's territory are removed without refund. All the breaker's units are exhausted for the turn. A cooldown ("truce breaker") forbids attacks until the next turn (sources disagree on who exactly is frozen, §13.1). The relation shows as Hostile. An AI victim thinks the breaker Foolish (§10.3). |
| Diplomacy for 3+ players | Not verified (unverified) |

---

## 6. Map generation

The map is a square grid. The values are from [W], with [G] base weights and [P] for the algorithm. **The exact algorithm is (unverified)**: the community re-implementations are approximate. This engine's generator ports the 2.18 generator as replayed by polybots-engine (`engine/core/src/mapgen.rs`; `docs/RULES_PARITY.md`, "2.18 data corrections"). ([Map generation](https://wiki.polytopia.com/wiki/Map_Generation))

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
- Huge and Massive are only in Creative and multiplayer.
- Tiny maps hold at most 9 players; other sizes up to 16. Single-player allows up to 15 opponents since version 2.0; before that the cap was 9.
- **Other settings** (since 2.0): the water amount (map type), mirror matches with several players on one tribe, and disabling tribes so opponents can't be them.

### 6.2 Map types (water share) [W]

Wetness percentages are from [W]. The land ratios are from [P] (unverified).

| Type | Wetness | [P] land ratio | Shape |
|---|---|---|---|
| Drylands | 0–10% | 1.0 | Almost no water; Kickoo, Luxidoor and Aquarion capitals still get 2 water tiles with fish, because their starting resources force them (`logic/engine/data.ts` `startResources`, placed by `engine/core/src/mapgen.rs` `starting_resources`) |
| Lakes | 25–30% | 0.72 | Inland lakes, a ring of land bridges at the edge; every player can walk to at least 2 villages |
| Continents | 40–70% (rivers one tile wide) | 0.45 | Separate landmasses; since 2.8 each tribe gets its own, or spawns share a few split by 1-tile channels |
| Pangea (since 2.8, November 2023) | 40–60% | 0.78 | One central landmass ringed by ocean |
| Archipelago | 60–80% | 0.38 | Irregular islands; almost every city is coastal |
| Water World | 90–100% | 0.15 | Land only where cities stand; 1–2 villages per landmass |

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

- **Resources spawn only within 2 tiles of a city or village** [W]. Fish are on half the shallow-water tiles, and also on ocean since 2.8.
- [G] resource base chances: 0.5 for crop, fish, fruit and game; 0.8 for metal; multiplied by the tribe modifier. How these combine with the inner/outer table is (unverified).

**Tribe modifiers** [W] (multipliers on the base rate):

| Tribe | Modifiers |
|---|---|
| Xin-xi | mountain ×1.5, metal ×1.5 |
| Imperius | animal ×0.5, fruit ×2 |
| Bardur | forest ×0.8, crop ×0 ([P] also: game ×2; its own wiki page adds fruit ×1.5) |
| Oumaji | forest ×0.2, animal ×0.2, mountain ×0.5 |
| Kickoo | mountain ×0.5, fish ×1.5, water ×2 (the water effect is bugged and inactive) |
| Hoodrick | mountain ×0.5, forest ×1.5 |
| Luxidoor | base rates |
| Vengir | metal ×2, animal ×0.1, fruit ×0.1, fish ×0.1 |
| Zebasi | mountain ×0.5, forest ×0.5, fruit ×0.5 ([P] also: crop ×2) |
| Ai-Mo | mountain ×1.5, crop ×0.1 |
| Quetzali | fruit ×2, crop ×0.1 |
| Yădakk | mountain ×0.5, forest ×0.5, fruit ×1.5 |

[G] `startingResource` guarantees the tribe's resource on the 8 tiles around the capital; by default this is the resource of its starting tech's first improvement. Special tribes' terrain is in §9.1.

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

**Post-terrain villages** are added until no valid tile remains (all Drylands villages come this way):

- Not within 2 tiles of the edge, and not exactly 3 tiles from it.
- Not within 2 tiles of another village.
- [W] also says "at most one village per 3×3"; the exact spacing is (unverified).

**Ruins:**

- Any terrain except shallow water: field, forest, mountain or **ocean** (more likely on mountains since 2.0.58).
- Not within 2 tiles of another ruin or a capital, and not next to a village; a water ruin is also not within 2 tiles of any village, not in anyone's territory and not on the map edge (`engine/core/src/mapgen.rs`, `ruins`). This settles the wiki's two pages (one says never next to a capital, the other never next to a village) and [W]'s note that ruins may be next to villages since 2.0.58.
- Water share: [W] says at most ⅓ of the ruins are on water on non-Drylands maps (the Map generation page: on Lakes); the 2.18 generator ported here applies no such cap (`ruins` lets water ruins through until their count exceeds the total) (§13.1).

**Starfish:** about 1 per 25 water tiles, on shallow water or ocean. Not adjacent to another starfish, a lighthouse or a city.

---

## 7. Game modes and score

### 7.1 Score [W][E]

Score decides Perfection, Glory and the Weekly Challenge. It drops when you lose any of its sources: losing a city, building or unit (killed or disbanded) removes its points. ([Score](https://wiki.polytopia.com/wiki/Score))

| Item | Points |
|---|---|
| Unit | 5 × cost (super unit 50). A boat counts its passenger plus the upgrade cost [E]. Lost when the unit dies or is disbanded; conversion changes nothing. |
| Territory | 20 per tile (plus the building score on the tile when captured) |
| Exploration | 5 per explored tile |
| City | 100, plus 50 per level above 1 (internally 5 per population plus a level bonus of 40 at level 2, 35 at level 3, falling after, summing to 50 per level). Levels ≥ 10 lower the score [W] (the 2.18 data has no drop: `docs/RULES_PARITY.md`, "City score"). |
| Park | 250 |
| Monument | 400 |
| Temple | **100 × level**; level = `1 + floor((current turn − build turn) / 2)`, capped at **5** (max 500). The level rises at the owner's turn start [E]. Before 2.14 a temple was worth 100 + 50 per level. |
| Technology | 100 × tier |
| Starving city (negative population) | Score penalty since 2.15; the amount is unverified |

**Turn-0 check:** city 100 + 9 tiles ×20 + 25 explored ×5 + warrior 10 + tier 1 tech 100 = **515**.

**Starting score by tribe:** Aquarion 415; Xin-xi, Imperius, Bardur, Kickoo, Luxidoor and Elyrion 515; Oumaji 520; Polaris 530; Zebasi and Yădakk 615; Quetzali and Hoodrick 620; Cymanti 630; Vengir and Ai-Mo 730.

### 7.2 Modes [W]

A game is set by map size, map type, number of opponents, their difficulty and the mode. Main source: [wiki.polytopia.com](https://wiki.polytopia.com/wiki/Game_Modes), current to version 2.18.

| Mode | Where | How it ends | How it is rated |
| --- | --- | --- | --- |
| Perfection | Single-player | After **30 turns**; highest score wins | Final score × the difficulty bonus (below) |
| Domination | Single-player | No turn limit. A player is eliminated when it loses its **last city**; the game ends when one tribe remains | Rating (below) |
| Creative | Single-player | Your choice: Perfection scoring, Domination scoring, or Infinity (no end) | Any opponent count (0 allowed), water amount and size |
| Glory | Multiplayer | First to **10,000 points** by default (other targets selectable since 2.2.3); if several pass it in one turn, the highest score at the end of that turn wins | – |
| Might | Multiplayer | Capture **every capital**; other cities don't count | Game Stats ranks tribes by capitals held |
| Weekly Challenge | Single-player (since 2.12, March 2025) | Perfection rules with a **20-turn** limit; everyone gets the same seed, tribe, opponents and settings | League tables (below) |
| Boot Camp | First game for new players | A guided 14×14 Lakes map: Imperius against one Easy Xin-xi, starting with 6★ and no warrior | – |

**Perfection:**

- **Final score** = score × difficulty bonus. The bonus is `100% + difficulty part + opponent part`: the difficulty part is +0% (Easy), +20% (Normal), +40% (Hard) or +80% (Crazy); the opponent part T is a table, not a known formula.
- Read off the app's Perfection setup screen ("Difficulty bonus: X%", iPhone, 25 Nov 2026):

| Opponents | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T (percent) | 0 | 20 | 30 | 37 | 42 | 46 | 49 | 52 | 54 | 57 | 59 | 60 | 62 | 64 | 65 |
| Crazy, bonus shown | 180 | 200 | 210 | 217 | 222 | 226 | 229 | 232 | 234 | 237 | 239 | 240 | 242 | 244 | 245 |

- With 15 opponents the screen shows 165% (Easy), 185% (Normal), 205% (Hard) and 245% (Crazy), so the difficulty part is unchanged. Maximum 245% (15 Crazy opponents). **Assumption:** Easy, Normal and Hard were read only at 15 opponents; at fewer opponents they are assumed to add the same T as Crazy (not yet checked in the app).
- **Old formula (pre-Feb 2024, outdated):** `100% + 41% × ln(number of opponents)` plus the same difficulty part (maximum 291%). "Patch of the Ocean" (Feb 2024) "lowered the score bonus for opponent count" without giving numbers; the community decompile [raphael-64/polyterra-env](https://github.com/raphael-64/polyterra-env) still has exactly the old formula. Before version 2.0 the bonus was 100/120/140/180% by difficulty plus 10% per opponent.
- 3,000 points earns 1 tribe star, 10,000 2 stars, 50,000 3 stars, 100,000 a halo. Weekly high scores reset on Mondays. Perfection ties are unconfirmed; only Glory states a tie rule.

**Domination:** rating = average of four equal parts:

- **Speed:** 100% if the game is won within 10 turns per enemy; otherwise `(10 × enemies) / turns taken`.
- **Battle:** `(kills + 1) / (losses + kills + 1)`.
- **Tribes destroyed:** the share of opponents the player eliminated itself.
- **Difficulty:** 25% / 50% / 75% / 100% for Easy / Normal / Hard / Crazy.
- 20% earns 1 star, 70% 2, 95% 3, 100% a halo.

**Weekly Challenge:**

- Unlocks after 5 finished games; you don't need to own the featured tribe.
- Leagues are Entry, Bronze, Silver and Gold, with bots from Easy in Entry to Crazy in Gold on the same seed.
- Each week the top third moves up and the bottom third down. You can be demoted only in a week you played, and never back into Entry. ([2.12 notes](https://wiki.polytopia.com/wiki/Whatsnew-weekly-challenges))

**Multiplayer:**

- The host sets the mode, size and opponents; bots of mixed difficulty can fill seats.
- **Pass & Play** is local on one device and free.
- **Online** needs at least one bought tribe. It offers random lobbies, friend games, Elo ratings (since 2.0.58) and tournaments.
- Turn order is random at the start of lobby games (since late 2022).
- **Turn timers:** live games work like a chess clock: under a minute at the start, unused time carries over, and every city and unit adds time. A player whose time runs out is skipped; after 3 skips they are kicked, and their tribe stays on the map but acts only when attacked. Slower games use 24-hour or 7-day turn limits.

**Defeat:** a tribe is out when it has lost all its cities (§5.8).

### 7.3 Tasks and monuments [G][E]

Each task unlocks one monument. ([Monument](https://wiki.polytopia.com/wiki/Monument))

| Task | Condition | Starts with | Monument |
|---|---|---|---|
| Pacifist | 5 consecutive own turns without attacking. Turns count only while Meditation is owned [E]. Retaliation, conversions and infiltration don't count as attacks; Polaris freezing does. Cymanti instead convert 3 enemies with Shamans (October 2025). | Meditation | Altar of Peace |
| Genius | Own every tech | Philosophy | Tower of Wisdom |
| Wealth | Hold **100 stars** | Trade | Emperor's Tomb |
| Killer | **10 kills** | first kill | Gate of Power |
| Metropolis | A **level ≥ 5** city (levelled up or captured) | first level-up | Park of Fortune |
| Network | **5 cities connected** to the capital | first connection | Grand Bazaar |
| Explorer | Discover all **4 lighthouses** (before November 2023: explore every tile) | always | Eye of God |

Every monument gives 3 population and 400 score, is built for free on a field or shallow water (frozen shallow water included) inside your borders, and can be built **once per player** (blocked only by having built it already) [E] (`engine/core/src/actions.rs`, `may_build`: `pl.monuments.contains(&b)`; the monument's terrain is in `engine/core/src/data_gen.rs`). The wiki's "once per game by the first tribe to finish its task" is not what the game does. ([Altar of Peace](https://polytopia.fandom.com/wiki/Altar_of_Peace))

---

## 8. Tribes: starting tech, starting unit, starting stars (since 2.14, Sep 2025) [N][W]

There are 16 tribes: 12 regular ones that share the standard rules and differ only in start and map, and 4 special ones with their own units, techs and terrain (§9). No tribe has been added since Cymanti in February 2021. ([Tribes](https://wiki.polytopia.com/wiki/Tribes))

### 8.1 Starts

| Tribe | Starting tech | Starting unit | Starting stars |
|---|---|---|---|
| Xin-xi | Climbing | Warrior | 7 |
| Imperius | Organization | Warrior | 5 |
| Bardur | Hunting | Warrior | 5 |
| Oumaji | Riding | Rider | 6 |
| Kickoo | Fishing | Warrior | 5 |
| Hoodrick | Archery | Archer | 7 |
| Luxidoor | none | Warrior | 2, plus a **level 3 capital** (no wall) |
| Vengir | Smithery (tier 3) | Swordsman | 5 |
| Zebasi | Farming | Warrior | 5 |
| Ai-Mo | Philosophy (Meditation before 2.14) | Mind Bender (Warrior before) | 5 |
| Quetzali | Strategy | Defender | 7 |
| Yădakk | Roads | Warrior | 7 |
| Aquarion (special) | none | Mermaid | 5 |
| ∑∫ỹriȱŋ / Elyrion (special) | Forest Magic | Warrior | 5 |
| Polaris (special) | Frostwork | Mooni | 5 |
| Cymanti (special) | Farming (its own version) | Shaman | 5 |

- Map bias per tribe: §6.3.
- Bardur, Imperius, Kickoo and Zebasi can level up their capital on turn 0 with their starting tech. Since 2.14 Vengir can research backwards from Smithery to Mining without Climbing (§1.1).
- Luxidoor's capital: level 3 in the game data and this engine (`engine/core/src/data_gen.rs`, `TribeDef` `capital_level: 3`). The April 2021 notes cut it from 3 (with a wall) to 2 with a cosmetic park; the 2025 notes say only "upgraded".

How differing starts work in the game [G]:

- `startingTech` is a list that always includes `basic`.
- `startingUnit` is placed in the capital and can act on turn 0.
- `startingStars` defaults to 5.
- `bonus` can be `CityLevel3`, which Luxidoor uses.

### 8.2 Buying, picking and skins

- **Buying tribes:**
  - On mobile, Xin-xi, Imperius, Bardur and Oumaji are free. Most other regular tribes cost $0.99, Luxidoor $2.99 (or $3.99 per its page), and special tribes $1.99.
  - On Steam and consoles all 12 regular tribes come with the game, and special tribes are $2.99 add-ons.
- **Picking:**
  - Online play needs at least one bought tribe; Pass & Play needs none.
  - Several players can be the same tribe (mirror matches, since 2020).
  - Disabled tribes can't be picked by anyone, including bots.
  - Luxidoor can appear as a bot even if you don't own it.
- **Skins** change only the look. Each regular tribe has one: Sha-po, Lirepacci, Baergøff, Khondor, Ragoo, Yorthwober, Aumux, Cultist, Anzala, To-Lï, Iqaruz and Ürkaz.
- **Special-tribe skins:** Midnight (Elyrion, 2024), Forgotten (Aquarion, 2024), Solaris (Polaris, 2025) and New Dawn (Cymanti, 2025). These also rename units and buildings, for example lava in place of ice for Solaris. Forgotten and New Dawn also change the tribe's colour.

---

## 9. Special tribes

### 9.1 Overview

| Tribe | Starting tech | Starting unit | Stars | Released | Terrain |
| --- | --- | --- | --- | --- | --- |
| Aquarion | none (water movement built in) | Mermaid | 5 | June 2017; reworked August 2024 | Own land is flooded; forest 0.5, water 1.5; 2 fish at the capital |
| Elyrion (∑∫ỹriȱŋ) | Forest Magic | Warrior | 5 | May 2018 | Crops 1.5, mountains 0.5 |
| Polaris | Frostwork | Mooni | 5 | June 2019 | No land of its own; it freezes the land and water around it |
| Cymanti | Farming (gives Fungi, not Farms) | Shaman | 5 | February 2021; reworked October 2025 | Mountains 1.2; spores instead of crops, at least 2 at the capital |

The engine's special-tribe rules follow the 2.18 data where it differs from the wiki; `docs/RULES_PARITY.md` lists each difference ("2.18 data corrections: special tribes", "Special tribes, audit 2").

### 9.2 Aquarion

**Units** (after the 2.10 rework, August 2024; most are amphibious versions of the regular ones, with the same stats):

| Unit (replaces) | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mermaid (Warrior) | 2★ | 10 | 2 | 2 | 1 | 1 | Dash, Fortify, Amphibious | none |
| Amphibian (Rider) | 3★ | 10 | 2 | 1 | 2 | 1 | Amphibious, Dash, Escape | Riding |
| Mermaid Archer | 3★ | 10 | 2 | 1 | 1 | 2 | Dash, Fortify, Amphibious | Archery (unconfirmed) |
| Mermaid Defender | 3★ | 15 | 1 | 3 | 1 | 1 | Fortify, Amphibious | Strategy (unconfirmed) |
| Swordsmaid | 5★ | 15 | 3 | 3 | 1 | 1 | Dash, Amphibious | Smithery (unconfirmed) |
| Siren (Mind Bender) | 5★ (8★ per older pages) | 10 | 0 | 1 | 1 | 1 | Heal, Convert, Amphibious, Stiff | Philosophy (unconfirmed) |
| Scuba (Cloak) | 8★ | 5 | 0 | 0.5 | 2 | 1 | Cloak skills plus Amphibious | Diplomacy (unconfirmed) |
| Shark | 8★ | 10 | 3.5 | 2 | 3 | 1 | Dash, Surprise, Water | Marine Life |
| Jelly (Bomber) | 8★ | 20 | 2 (0 in the unit list) | 2 | 2 | 1 | Tentacles, Water, Stiff, Static | Navigation |
| Puffer (Catapult) | 8★ | 10 | 4 | 0 | 2 | 3 | Drench, Water, Stiff | Mathematics |
| Tridention (Knight) | 8★ | 10 | 2.5 | 1 | 2 | 2 | Dash, Persist, Amphibious | Spearing (Chivalry per its infobox) |
| Crab | super unit | 40 | 4 | 4 (5 per older pages) | 2 (1 per the wiki) | 1 | Amphibious, Escape, Auto Flood, Static | City reward |

Siren cost, Amphibian (no Fortify) and Crab movement follow the 2.18 data (`docs/RULES_PARITY.md`, unit fixes).

**Rules:**

- **Amphibious:** every land unit is amphibious, and none can build or use roads.
- **Flooded tiles:** both land and water units can use them; for ships they end the move. Aquarion may build land improvements on water.
- **A ship that captures a flooded city** of another tribe stands on dry land once the capture drains the tile, so it turns back into the unit it carries (as on any landing).
- **Atoll:** replaces roads and links cities within 3 tiles over water (+1 population, 5★).
- **Aqua Crops:** only Aquarion sees them. An Aqua Farm (5★) gives +2 population.
- **Fertilize** replaces Burn Forest and grows crops on flooded fields.
- **Bubbles:** an amphibious unit entering a flooded tile gets +1 movement (since November 2024); lost when the unit is attacked or steps onto dry land.
- **Lost City:** an Aquarion examining an ocean ruin can raise a city: a level-3 city with a wall and 4 shallow-water tiles around it per the wiki, capturable by any tribe (the 2.18 rules: `docs/RULES_PARITY.md`, "Lost City").
- **Landfill:** every other tribe can use it, to deal with flooded land.

| Regular tech | Aquarion tech | Unlocks |
| --- | --- | --- |
| Roads | Waterways | Flooding land, Bubbles |
| Ramming | Aquaculture | Aqua Farm, Atoll |
| Sailing | Marine Life | Shark |
| Free Spirit | Free Diving | Temple, ocean movement, Disband |
| Chivalry | Spearing | Tridention, Destroy |
| Riding, Construction | same names | Amphibian; Fertilize |

([Aquarion rework](https://wiki.polytopia.com/wiki/Whatsnew-aquarion-rework))

### 9.3 Elyrion

| Unit | Cost | HP | Attack | Defence | Move | Range | Skills | How you get it |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Polytaur | 3★ | 15 | 3 | 1 | 1 | 1 | Dash, Fortify, Independent, Static | Enchant a wild animal (Forest Magic) |
| Dragon Egg | super unit | 10 | 0 | 2 | 1 | – | Grow, Fortify, Stiff, Static | City reward; hatches after 3 turns |
| Baby Dragon | grows | 15 | 3 | 3 | 2 | 1 | Air, Grow, Dash, Escape, Scout, Static | Grows from the egg; 3 turns later becomes |
| Fire Dragon | grows | 20 | 4 | 3 | 3 | 2 | Air, Dash, Splash (when attacking only), Scout, Static | the adult |

- **Forest Magic** replaces Hunting. Elyrion can't hunt; Enchant Animal turns a wild animal into a Polytaur (3★, Independent).
- **Forestry** gives the Lumber Hut and the Sanctuary but no Clear Forest. A Sanctuary costs 5★, gives +1★ per turn per adjacent wild animal, and draws a new animal into a nearby forest every 2 or 3 turns (sources differ).
- **Construction** gives no Burn Forest.
- **Super unit:** a Dragon Egg that hatches into a Baby Dragon and then a Fire Dragon, 3 turns per stage, keeping its damage. An egg on a raft can't hatch.
- **The Navalon** (an enchanted whale) left with the whales in November 2023.
- Ruins through clouds: §4.6.

### 9.4 Polaris

| Unit | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mooni | 5★ | 10 | 0 | 1 | 2 (1 per the wiki) | 1 | Skate, Auto Freeze, Stiff (Static per the wiki) | Frostwork (starting tech; starting unit) |
| Ice Archer | 3★ | 10 | 1 | 1 | 1 | 2 | Dash, Freeze, Fortify, Stiff | Archery |
| Battle Sled | 5★ | 15 | 3 | 2 | 3 (wiki: 2, 3 on ice) | 1 | Dash, Escape, Skate | Sledding |
| Ice Fortress | 15★ | 20 | 4 | 3 | 2 (1 per the wiki) | 2 | Skate, Scout, Escape, Static | Polar Warfare |
| Gaami | super unit | 30 | 4 | 3 | 1 | 1 | Auto Freeze, Freeze Area, Static | City reward |

Movements and the Mooni's Static follow the 2.18 data (`docs/RULES_PARITY.md`, unit fixes). The 2025 Balance Pass raised Ice Archer attack from 0.1 to 1, cut Battle Sled ice movement from 4 to 3, and gave the Ice Fortress Escape and Static. ([2025 Balance Pass](https://wiki.polytopia.com/wiki/Whatsnew-balance-adjustments-2025))

- **Freezing:** turns water into ice and land into Polaris terrain. A captured Polaris city's land changes to the captor's style.
- **Frozen units** can't move, attack or retaliate until they thaw.
- **Ice:** 1 movement per step; with Glide (Polarism) 0.9 per step; since 2025 Glide gives about one extra tile instead of doubling (sources differ, §13.1). No terrain defence bonus on ice.
- **No ports or navy:** land units walk on ice, and skating units take the ship roles. Since November 2023 units with dash can break ice.
- **Outpost** (5★, on ice): +1 population, links cities.
- **Ice Bank** (20★, one per tribe): 2★ per turn for every 20 frozen tiles on the map, at most 30★. Some pages still say 3★.

| Regular tech | Polaris tech | Unlocks |
| --- | --- | --- |
| Fishing | Frostwork | Mooni, Outpost, shallow-water movement |
| Ramming | Ice Fishing | Fishing |
| Sailing | Sledding | Battle Sled |
| Aquatism | Polarism | Ice Temple (20★, on ice), Glide |
| Navigation | Polar Warfare | Ice Fortress, starfish |
| Archery, Trade | same names | Ice Archer; Ice Bank instead of Market |

([Polaris](https://wiki.polytopia.com/wiki/Polaris))

### 9.5 Cymanti

**Units** (after the 2.15 rework, October 2025):

| Unit (replaces) | Cost | HP | Attack | Defence | Move | Range | Skills | Tech |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shaman (Mind Bender) | 5★ | 10 | 1 | 1 | 1 | 1 | Parasite, Swarm | Rituals (starting unit) |
| Hexapod (Rider) | 3★ | 5 | 3 | 1 | 2 | 1 | Dash, Escape, Creep, Sneak | Riding |
| Kiton (Defender) | 3★ | 15 | 1 | 3 | 1 | 1 | Poison (on units that attack it), Creep | Strategy |
| Phychi (Archer) | 3★ | 5 | 0.7 | 1 (2 per its page) | 2 | 2 | Air, Dash, Poison, Surprise, Double Attack | Archery |
| Mantis (Swordsman) | 5★ | 15 | 3 | 3 | 1 | 1 | Dash, Creep | Smithery |
| Moth (Cloak) | 5★ | 10 | 0 (2 in the data) | 0.1 | 2 | 1 | Air, Dash, Sneak, Infiltrate, Poison, Scout, Static, Stiff | Synergy |
| Raychi | 5★ | 10 | 3 | 2 | 3 | 1 | Water, Dash (only from cities next to water) | Pescetism |
| Boomchi | 5★ | 10 | 3 | 3 | 2 (1 per other pages) | 0 (cannot attack, only explode) | Dash, Explode, Stiff, amphibious | Inflation |
| Exida (Catapult) | 8★ | 10 | 3 | 1 | 2 | 3 | Poison, Splash, Creep | Mathematics |
| Doomux (Knight) | 10★ | 20 | 3.5 | 2 | 3 | 1 | Dash, Creep, Explode, Static | Shock Tactics |
| Living Island (Bomber) | 20★ | 20 | 4 | 4 | 2 | 1 | Water, Stomp, Algae, Poison, Static | Oceanology |
| Centipede | super unit | 20 | 4 | 3 | 2 | 1 | Dash, Eat, Creep, Static | City reward |
| Segment | grows | 10 | 2 | 2 | 1 | 1 | Independent, Creep, Explode, Dash, Stiff, Static | Each Centipede kill adds one |
| Insect Egg | spawned | 10 | 2 | 3 | 0 | 0 | Grow, Stiff, Explode, Static | Moth infiltration |
| Larva | grows | 10 | 2 | 2 | 1 | 1 | Dash, Creep, Surprise, Independent, Static, Grow | Hatches from an egg; a Moth 3 turns later |

Converting any segment converts the whole Centipede. A kill made by the Centipede's retaliation adds no segment. ([Centipede](https://wiki.polytopia.com/wiki/Centipede), [Cymanti rework](https://wiki.polytopia.com/wiki/Whatsnew-cymanti-rework))

- **Fungi** (from Farming) is built on spores and poisons enemies that step on it, up to level 2 (3 with Microbes).
- **Algae:** a tile effect on water since October 2025. It spawns with a fruit, slows land units but not ships, and allows other buildings on it.
- **Mycelium** replaces roads: it links cities within 3 tiles and heals adjacent units.
- **Clathrus** (Trade) grows from spores, poisons enemies, and earns +1★ per adjacent algae.
- **Poison** halves the defence bonus and slows (§2.4, §3.3).
- **Moth** (replaces the Cloak since October 2025): flies, never hidden. Its infiltration poisons the defender and lays Insect Eggs (city level, at most 5) that hatch into a Larva after 1 turn and a Moth 3 turns later. Per the wiki it steals no stars. ([Moth](https://polytopia.fandom.com/wiki/Moth))
- **Explorer:** the Cymanti Explorer can cross water since 2.15.
- **Monument:** converting 3 enemies replaces the Altar of Peace task (§7.3).

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

Cymanti Organization doesn't reveal crops. Riding, Archery, Strategy, Mathematics, Smithery and Trade keep their names but unlock Hexapod, Phychi, Kiton, Exida, Mantis and Clathrus. ([Cymanti](https://wiki.polytopia.com/wiki/Cymanti))

---

## 10. Diplomacy

Two techs carry diplomacy. Strategy unlocks peace treaties (§5.14); Diplomacy, a tier-3 tech after Strategy, unlocks embassies, the Cloak (§3.6) and Capital Vision. Both arrived in update 2.2 (May 2022); Strategy was called Shields before that. Meeting tribes is in §5.9. ([Diplomacy](https://polytopia.fandom.com/wiki/Diplomacy))

### 10.1 Embassy

| Rule | Detail |
| --- | --- |
| Building | From the other tribe's diplomacy popup; it appears in their capital at any distance |
| Conditions | Not while at war; only in a capital still held by its original owner; one per tribe; the host cannot refuse, and receiving one makes the host meet the sender |
| Income | +2★ per turn to **both** builder and host, +4★ each with a peace treaty; embassies both ways plus peace give each player +8★ per turn |
| Vision | The 3×3 area around the host capital |
| Lost when | Either side attacks the other (both embassies go), or the host capital is captured (§5.8) |
| Cost | 5★ from May 2022; since the 2025 Balance Pass the first is cheaper and later ones cost more (formula unpublished; this engine uses 4★ + 2★ per embassy already built, §5.5) |

Sources: [Embassy](https://polytopia.fandom.com/wiki/Embassy), [2025 Balance Pass](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1810503566363587).

### 10.2 Capital Vision and relations

- **Capital Vision** (Diplomacy tech): you see the capital of every tribe you have met, including tribes met later and capitals that have been captured. The diplomacy screen also shows who is at peace or at war with whom.
- **War and neutral:** two tribes count as at war if either attacked the other within the last turn; otherwise they are neutral. After a broken treaty the relation shows as Hostile. ([Tribe relations](https://polytopia.fandom.com/wiki/Tribe_Relations))

### 10.3 What bots think of you

Each bot rates you horrible, poor, indifferent, decent or great; red flames around its head mean horrible, a halo means great. Per a community decompile of a pre-February-2024 build (raphael-64/polyterra-env), the rating is a sum of terms, each shown as a reason when it is larger than 0.1 either way, and the level is **great above 2**, decent above 0.5, poor below -0.5, horrible below -2, indifferent otherwise. A bot has no opinion (indifferent) of a tribe it has neither met nor been attacked by. The behaviour may have changed since that build.

In the table, g is how far the game has gone: in Perfection the turn divided by the turn limit; in Domination the leader's capitals divided by the number of players; in Might your capitals divided by the number of players; in Glory whole multiples of the score target only.

| Reason | Term |
| --- | --- |
| Charming | Only toward human players: (2 − handicap) × 2 when positive, with handicap Easy 0, Normal 1, Hard 2, Crazy 4. So +4 on Easy, +2 on Normal, nothing on Hard and Crazy |
| Annoying | When the bot is not at peace with you: minus the share of the other living tribes it is at peace with. The tribe it already rates lowest gets −0.5 more |
| Peaceful / Violent | t = (turn − your last attack on the bot − 4) / 4; an attack before you met (or none) counts as meeting turn − 4. t > 0 gives +0.5 × min(t, 2) (at most +1, 12 turns after an attack); otherwise 2t (−2 on the turn of an attack, fading to 0 four turns later) |
| Diplomatic | +1 for its embassy with you, +1 for yours with it |
| Wise / Foolish | Over every third tribe: both at war with it +2; the bot at war with it and you at peace with it −1; the bot at peace with it and you at war with it −2; both at peace with it +1. Then −4 / (turns since your treaty with the bot was last broken + 1), so −4 on the turn itself, −1 three turns later. Capped at +2, no floor |
| Threatening | Each of your units the bot sees on its land: −1 (−0.2 while at peace), −2 more on one of its cities; each on a tile next to its land: −0.5 unless at peace |
| Intrusive | −0.1 per tile of your land on or next to its land; −2 while you hold its first capital |
| Powerful / Weak | a = min(2, its military / your military), 1 when neither has units; military = the sum over units of 9 × defence × defence bonus + 10 × attack + 7 × movement + 14 × (range − 1). a < 1 gives +(1 − a), a > 1 gives −(a − 1) |
| Dominating | −4g² / rank², rank being your place in the standings (1 = leading) |
| Brave | +g² while you are at war with the leader (when that is neither you nor the bot) |

"At war" here means: not at peace, and one side attacked the other since the attacker's previous turn.

**What bots do with it** (same decompile):

- **Accept peace** when the opinion is above 2.
- **Offer peace** when opinion × a random number in [0, 1) is above 2.
- **Break peace** only below 0, scored −500 × opinion − 200 per own unit inside your borders (those would be lost), so only when that is positive.
- **Aggression** toward a tribe is −1000 × opinion. A worthwhile attack on that tribe counts (1 + aggression / 1000) = (1 − opinion) times, so a bot that rates you 1 or more no longer attacks you on its own initiative; capturing your cities is worth more and an embassy with you less, the lower its opinion.
- **Difficulty noise:** easier bots add a random term to their move scores, ±25 × max(0, 2 − handicap), so Easy ±50, Normal ±25, Hard and Crazy none.

Older community notes (2022 FAQ, wiki) agree on the reasons' names and that a bot accepts peace only at great; their descriptions (a random Charming, Annoying on higher difficulties, Dominating near a Domination win) are summaries of the terms above.

---

## 11. AI and difficulty

Difficulty changes two things, per the developers: how many stars a bot's capital makes each turn, and how aggressive the bot is. The bots play by the same rules as you otherwise. ([developer answer, 2020](https://steamcommunity.com/app/874390/discussions/0/4390400383727805950))

| Difficulty | Bot capital income (level 1) | Behaviour | Perfection bonus part | Domination difficulty part |
| --- | --- | --- | --- | --- |
| Easy | 1★ per turn | Mostly peaceful unless provoked | +0% | 25% |
| Normal | 2★ (same as a human) | – | +20% | 50% |
| Hard | 3★ | More aggressive | +40% | 75% |
| Crazy | 5★ | May attack at once | +80% | 100% |

- **Opinions:** bots find a human Charming only on Easy (+4) and Normal (+2), and all bots weigh the leader as Dominating more as the game goes on (§10.3).
- **Diplomacy behaviour:** bots gang up on a player who is winning and take pity on one who is losing. The Brave and Dominating opinions steer them against the leader. They send peace offers too, and per the decompile they break a treaty when their opinion of the partner falls below 0 (§10.3).
- **Weekly Challenge:** bot difficulty follows your league, from Easy in Entry to Crazy in Gold.
- **Resigned players:** since 2.7.2 (September 2023) they show as bots, which suggests an AI takes over their tribe (unconfirmed).
- **Changes over time:**
  - 2020: bots stop playing once they have taken the human's last city in single-player.
  - 2022: smarter use of troops, defence and economy; fewer Cloaks; better at finding Cloaks.
  - October 2023: smarter tech choices and a much harder Crazy; bots stopped training Cloaks when defending.
  - February 2024: better choice of units and city upgrades.
- **Known quirks** (player reports from 2020, before several AI updates): attacks into city walls, attacking Defenders head-on, and not upgrading boats.

---

## 12. Rule changes by version

The current rules come from more than twenty balance updates since 2020. The biggest were the naval rework of November 2023, which replaced the old Boat, Ship and Battleship, and the 2025 Balance Pass. Newest first; each row links its official patch notes.

| Date | Update | Rule changes |
| --- | --- | --- |
| 2026-11-02 | [2.18 Achievements](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1848557880480580) | 15 achievements; no rule changes |
| 2026-02-16 | patch | Explorer takes 12 steps instead of 15 |
| 2025-10-29 | [2.15 Cymanti rework](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1814942955109414) | Moth replaces the Cymanti Cloak; algae becomes a tile effect; Mantis, Boomchi, Living Island; poison halves defence and slows; Creep no longer ignores mountains; Explorer moves better; starving cities cost score |
| 2025-09-09 | [2025 Balance Pass (2.14)](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1810503566363587) | Starting stars by tribe (5, 6 or 7; Luxidoor 2 with a bigger capital); Ai-Mo starts with Philosophy and a Mind Bender; techs can be researched backwards from a child; Forges on forests; temples 100 points per level; Burn Forest 3★; Polytaur 3★; embassy cost scales; Polaris changes (Glide, Battle Sled, Ice Fortress, Ice Archer) |
| 2025-03-10 | [2.12 Weekly Challenges](https://wiki.polytopia.com/wiki/Whatsnew-weekly-challenges) | Same-seed 20-turn challenge with leagues |
| 2024-08-08 | [2.10 Aquarion rework](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5963414363391248504) | Flooded terrain; mermaid units; Shark, Jelly, Puffer; Atolls; Lost City from ruins; Landfill for other tribes; Aquaculture renamed Ramming |
| 2024-02-26 | [2.8.5 Patch of the Ocean](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5728086065197236794) | Aqua farming removed; Fishing is the first water tech and includes the Port; Market +1★ per level of each adjacent Sawmill, Windmill or Forge, at most 8; bridges 5★; starfish 8★; Bomber attack 3; Burn Forest to Construction, Destroy to Chivalry; temples grow every 2 turns; water ruins give a veteran Rammer; lower Perfection bonus for opponent count |
| 2023-11-21 | [2.8 Path of the Ocean](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5382426458970207830) | Boat, Ship, Battleship and Navalon removed; Raft, Scout, Rammer, Bomber and Juggernaut added; ships upgrade only in your own territory; Port 7★ and +1 population; starfish replace whales; Market replaces Custom House; lighthouses in the corners; Pangea map; Swordsman loses Fortify; Lumber Hut and Roads 3★; Parks +1★ |
| 2023-01-25 | [2.4.5 Tournaments](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5035622109506914466) | Lobbies, Live games with a chess-clock timer, random turn order, replays, crossplay, spectating after defeat |
| 2022-10-10 | [2.2.9 Diplomacy balance](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4588629064110779566) | All units detect adjacent Cloaks; Cloaks gain Scout and Creep; infiltration deals damage, steals income, once per turn per city; Pirates; Cymanti explosion damage halved; Ice Bank capped at 30★ |
| 2022-05-24 | [2.2 Diplomacy](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4292505348844115074) | Shields renamed Strategy and gains peace treaties; Diplomacy tech with Cloak, Dagger, Embassy and Capital Vision; Knight 10 HP at 8★ |
| 2021-09-08 | [2.0.58 Balance Pass 2](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4020014731790399318) | Meeting a tribe gives stars instead of a tech; ruin Giant becomes a veteran Swordsman; mountain defence moved to Climbing; Elo ratings |
| 2021-04-20 | 2.0.49 Balance Pass 1 | Whales never next to a city; Clear Forest moved to Free Spirit; Luxidoor capital level 3 to 2 |
| 2021-02-17 | 2.0.44 | Cymanti released; Literacy discount 20% to 33%; Polytaur becomes Independent |
| 2020-12-04 | 2.0.31 | Any unit can capture cities |
| 2020-08-04 | [2.0 Moonrise](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/3664193578978493471) | New engine; Huge and Massive maps; water settings; Creative mode; new map generator |

Copies of all developer posts are collected at [devtrackers.gg](https://devtrackers.gg/polytopia/patch_notes).

---

## 13. Open questions

Most conflicts come from wiki pages written before the 2023–2025 reworks. Where the game's data file, a dated patch note or this repository's engine (which follows the 2.18 data) decides a conflict, this reference follows it. The rest stay open below.

### 13.1 Values that sources disagree on

| Topic | What the sources say | Used here |
| --- | --- | --- |
| Breaking peace | No one may attack until the next turn (2022 FAQ); only the victim is frozen for a turn (2022 beta); the breaker is frozen this turn, or this and the next (wiki) | Cease-fire until the next turn (§5.14) |
| Embassy cost since September 2025 | Rises with each embassy you own; no numbers published | Open; the engine uses 4★ + 2★ per embassy built |
| Embassy condition | "Not at war" (developers) vs "at peace" (wiki) | Not at war |
| Cloak attack | 0 (unit list, 2022 FAQ) vs 2 (Cloak page and game data, used only for infiltration damage) | Both shown |
| Who detects Cloaks | Mind Benders and Cloaks only (May 2022) vs every adjacent unit (since October 2022) | Every unit |
| Splash, stomp and explosion damage | Half the damage unrounded (Combat page, [W]); half rounded down (Bomber and Fire Dragon pages, [E]); explosion equal to the unit's attack (skills page) | Half, rounded down (`engine/core/src/combat.rs`, `half_damage`) |
| Creep and zone of control | Creep ignores it ([E], the Cloak and Terrain pages) vs only Sneak, Hide and invisibility do (Movement page) | Creep does not ignore it (`engine/core/src/movement.rs`, `ignores_zoc`; checked against the 2.18 data) |
| Poison and movement | Floor of 1 (Movement page) vs 0 (Combat page) | Open; the engine takes −1 only above 1 |
| Poison and defence | Bonus ×0.5 (this engine, wiki table) vs `D` ×0.7 and bonus ×0.5 ([E]) vs "defence −50%" ([W], [N]) | Bonus halved (§3.3) |
| Perfection bonus | 100% + 41% × ln(opponents) + difficulty (old wiki formula, maximum 291%) vs the app's setup screen: 100% + difficulty + a table, maximum 245% | App setup screen (25 Nov 2026) |
| Meeting a tribe | 1 + 2★ per 1,000 score, at most 11 (wiki) vs 3★ per 1,000, at most 12, minus 1 per step since October 2022 (patch notes) | Wiki formula (§5.9) |
| Market income | +1★ per adjacent building level, at most 8 (data, February 2024 notes) vs 2★ per adjacent building (older pages) | Data |
| Port reach | Range 5 (data) vs 4 or 5 water tiles (wiki pages); ocean links need Navigation (wiki) vs Sailing (data) | Range 5, Sailing (`engine/core/src/data.rs` `PORT_RANGE`, `state.rs` `water_path`) |
| Connections through fog | None through fog ([W]) vs no explored tiles needed (2.18 rules) | No explored tiles needed (`engine/core/src/state.rs`, `update_connections`) |
| Ice Bank | 2★ per 20 frozen tiles (data, 2023 notes) vs 3★ (Buildings page) | 2★ |
| Glide on ice | 0.9 per step (Movement page) vs half a move (Polarism page) vs one extra tile (2025 notes) | 0.9 per step |
| Luxidoor | Capital level 2 (April 2021 notes) vs 3 (a 2025 wiki summary, game data); price $2.99 vs $3.99 | Level 3 (`engine/core/src/data_gen.rs`, `TribeDef`) |
| Lighthouse reward | +1 population for the first tribe to uncover it (wiki) vs for each player's first discovery ([E]) | Each player (`engine/core/src/state.rs`, `explore`) |
| Monuments | Once per game by the first tribe to finish its task (wiki) vs once per player ([E]) | Once per player (`engine/core/src/actions.rs`, `may_build`) |
| Monument terrain | Field or shallow water (wiki) vs field, shallow water or ice ([E]) | Field or shallow water, frozen shallow water included (ice is a flag on water; `engine/core/src/data_gen.rs` monument `BuildDef`) |
| Explorer steps | 15 (wiki) vs 12 (since 16 Feb 2026) | 12 (`engine/core/src/data.rs`, `EXPLORER_STEPS`) |
| Sanctuary | New animal every 3 turns (wiki) vs 2 (data) | Both shown; the engine uses 2 |
| Ruin placement | Never next to a capital (Ruin page) vs never next to a village (Map generation page) vs next to villages allowed since 2.0.58 ([W]) | Neither within 2 of a ruin or capital, nor next to a village (`engine/core/src/mapgen.rs`, `ruins`) |
| Ruins on water | At most ⅓ of the ruins ([W]; the Map generation page says on Lakes) vs no cap (the 2.18 generator as ported here) | **Open**: both stated in §6.4 |
| Water ruin reward | Veteran Rammer (patch notes) vs veteran Rammer carrying a Warrior ([E]) | Rammer carrying a Warrior, only with Sailing (`engine/core/src/actions.rs`, `do_examine`) |
| Drylands fish capitals | Kickoo and Aquarion (wiki) vs Kickoo, Luxidoor and Aquarion ([W] map page) | Kickoo, Luxidoor and Aquarion (forced by their starting resources, §6.2) |
| Unit stats | Mooni defence 1 or 2; Crab defence 4 or 5; Jelly attack 0 or 2; Phychi defence 1 or 2; Boomchi and Pirate movement 1 or 2; Siren cost 8 or 5; Dinghy with or without Creep; Pirate Independent or not | Unit page value, or the 2.18 data where `docs/RULES_PARITY.md` checked it; alternative shown |
| Unlocking techs | Tridention: Spearing or Chivalry. Battle Sled: Sledding or Polar Warfare. Atoll: Aquaculture or Waterways. Shark replaces the Scout or the Rammer. Cymanti Hydrology takes the Fishing slot (likely) | Tech page value |
| Cymanti monument | "Church of Converts" (patch notes) vs "Cult of Ciru" (wiki) | Unnamed |
| Weekly Challenge | One attempt per day (2025 notes) vs unlimited, best counts (wiki); 4 leagues in 2025, six mentioned in 2026 | Both shown |
| Bot capital income | 1/2/3/5★ from a 2020 developer answer, not reconfirmed since | Shown |
| Ruins destructible | Destroy can remove a ruin ([W]) vs not destructible ([E]) | Open |

### 13.2 Not verified for the current version

- Market, Sawmill and Forge `maxLevel`. The Market is capped at 8 [W][E]; the Windmill example has 8 [G]; the others are unverified.
- Why the opponent part of the Perfection bonus is a table, and its values for other difficulties at fewer than 15 opponents (only Crazy was read for every opponent count).
- The starvation score penalty (2.15).
- Exact map-generation algorithm and village spacing.
- Diplomacy rules for 3 or more players.

### 13.3 Not found in any source

- What happens to the units of a tribe that loses its last city ([E]: disbanded and refunded).
- Whether bots ever break a peace treaty themselves.
- How Perfection ties are broken.
- The odds of each ruin reward (only that it's an even draw among eligible rewards).
- How long a frozen unit stays frozen, and how much damage Stomp and Tentacles deal.
- Whether there is a star cap or any unit upkeep (no source mentions either).
- The full current list of multiplayer turn timers and Glory point targets.
- Whether a unit on a mountain really sees 5×5 (only a fan guide and [E] say so).

---

## 14. Sources

Researched on 2026-11-23 (all read, not recalled). Each section links the pages its facts come from; these are the main ones.

| Tag | Source | What it is |
|---|---|---|
| **[W]** | polytopia.fandom.com, page wikitext through the MediaWiki API (fetched 2026-11-23), and its mirror wiki.polytopia.com (edited Nov 2026) | Community wiki |
| **[G]** | PolyModdingTeam/PolyMod `docs/gld/*.md` | Documents the game's own GameLogicData JSON (GLD version 28) and the engine rules found in the decompiled game |
| **[E]** | kevinz917/superhuman-polytopia-bot: `docs/rules-alignment-2026-10-27.md`, `gpu/rules.json` and engine-rs source | A re-implementation checked against **Steam 2.17.3 (game version 123, GLD v28)**: 27,785 recorded game transitions, legal-move sets identical in 685 of 686 recorded positions. Bardur 1v1 and 4-player free-for-all; diplomacy only for 2 players. |
| **[N]** | wiki.polytopia.com "What's new" pages for 2.14.0, 2.15.0, 2.17.0 and 2.18.0 | Patch notes |
| **[P]** | HenBOMB/Polyfish `mapgen.rs` | Map generator ported from a community reverse-engineering. Approximate (it has its own "fairness" passes). |

- **Official wiki (Wikitopia):** [Units](https://wiki.polytopia.com/wiki/Units), [Unit abilities](https://wiki.polytopia.com/wiki/Unit_Abilities), [Combat](https://wiki.polytopia.com/wiki/Combat), [Movement](https://wiki.polytopia.com/wiki/Movement), [Technology](https://wiki.polytopia.com/wiki/Technology), [City](https://wiki.polytopia.com/wiki/City), [Buildings](https://wiki.polytopia.com/wiki/Buildings), [Score](https://wiki.polytopia.com/wiki/Score), [Map generation](https://wiki.polytopia.com/wiki/Map_Generation), [Game modes](https://wiki.polytopia.com/wiki/Game_Modes), [Ruin](https://wiki.polytopia.com/wiki/Ruin), [Tribes](https://wiki.polytopia.com/wiki/Tribes), [Monument](https://wiki.polytopia.com/wiki/Monument), [Update history](https://wiki.polytopia.com/wiki/Update_History)
- **Community wiki (Fandom, read through its API):** [Tribe relations](https://polytopia.fandom.com/wiki/Tribe_Relations), [Embassy](https://polytopia.fandom.com/wiki/Embassy), [Cloak](https://polytopia.fandom.com/wiki/Cloak), [Dagger](https://polytopia.fandom.com/wiki/Dagger), [Star](https://polytopia.fandom.com/wiki/Star)
- **Developer posts:** the official Steam announcements, 2018–2026 (linked per update in §12), the [Diplomacy FAQ](https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/4469272893492663515), a [developer answer on difficulty](https://steamcommunity.com/app/874390/discussions/0/4390400383727805950), and copies at [devtrackers.gg](https://devtrackers.gg/polytopia/patch_notes)
- **Game data:** the [data file dump, versions 1–28](https://github.com/usemsedge/biblical_greed/tree/main/polytopia_extracted/gamelogic) and the [PolyMod field reference](https://github.com/PolyModdingTeam/PolyMod/tree/main/docs/gld)
- **Engine checks:** this repository's engine (`engine/core/src`), whose rules follow the game's 2.18 data and the polybots-engine replay engine; every difference from this document is in `docs/RULES_PARITY.md`
- **Tools and press:** the community [battle calculator](https://frothfrenzy.github.io/polytopiacalculator), [Pocket Gamer on the Cymanti rework](https://www.pocketgamer.com/the-battle-of-polytopia/cymanti-rework)
