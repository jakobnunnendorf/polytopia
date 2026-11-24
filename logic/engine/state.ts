/**
 * Game setup and the shared bookkeeping rules: exploration, territory,
 * population and levels, income, score, city connections, tasks, meetings.
 * Section numbers (§) refer to docs/shardlands/RULES.md.
 */
import { createRng, shuffle, type Rng } from "./rng";
import {
  BOT_CAPITAL_BONUS,
  BUILDS,
  CLANS,
  CLAN_BY_ID,
  EMBASSY_INCOME,
  GLORY_TARGET,
  HUMAN_CAPITAL_BONUS,
  MARKET_CAP,
  MONUMENTS,
  DOMINATION_DIFFICULTY,
  DOMINATION_STARS,
  PERFECTION_DIFFICULTY_BONUS,
  PERFECTION_STARS,
  PERFECTION_TURNS,
  PORT_RANGE,
  SCORE,
  TECHS,
  TECH_BY_ID,
  UNITS,
  maxPlayersFor,
  rewardOptions,
} from "./data";
import { generateMap, type MapType } from "./mapgen";
import { around, dist, idx, inBounds, isWater, tileAt } from "./grid";
import type { City, Coord, Difficulty, GameMode, GameState, Player, Tile, Unit } from "./types";
import { canSee, followerOf, leaderOf } from "./movement";
import { atPeace, atWar } from "./diplomacy";

const CITY_NAMES = [
  "Ashford", "Brightwater", "Cinderholm", "Dunmere", "Elderglen", "Fallowmark", "Greystone",
  "Hollowell", "Ironbrook", "Juniper", "Kestrel", "Larkspur", "Mistvale", "Northwatch",
  "Oakhaven", "Pinecrest", "Quarrytown", "Redcliff", "Saltmarsh", "Thornbury", "Umberfield",
  "Valewick", "Westerby", "Yarrowby", "Zephyr Hill", "Amberleigh", "Briarwood", "Coldharbour",
  "Duskwater", "Emberly", "Foxhollow", "Glimmerdale", "Harrowgate", "Ivydown", "Kingsmoor",
];

export type NewGameOptions = {
  /** default: the size the mode forces (see mapSizeFor), Normal otherwise */
  mapSize?: number;
  players: number;
  mode: GameMode;
  /** bot difficulty, default "normal" */
  difficulty?: Difficulty;
  seed: number;
  /** player ids controlled by humans (others are bots) */
  humans?: number[];
  mapType?: MapType;
  /** clan per player; default: random distinct clans */
  clans?: string[];
  /**
   * Perfection turn limit (default 30, turns 0..29). The Weekly Challenge is
   * Perfection with turnLimit 20 and a fixed seed.
   */
  turnLimit?: number;
};

/**
 * Map size a mode forces (rules doc, Map sizes): Perfection always Normal (16);
 * Domination by opponent count 1 -> 11, 2 -> 14, 3 -> 16, 4+ -> 18.
 * Returns null when the mode lets the player choose (Creative, Glory, Might).
 */
export function mapSizeFor(mode: GameMode, opponents: number): number | null {
  if (mode === "perfection") return 16;
  if (mode === "domination") return opponents <= 1 ? 11 : opponents === 2 ? 14 : opponents === 3 ? 16 : 18;
  return null;
}

/** Huge (20) and Massive (30) maps exist only in Creative and the multiplayer modes */
export function mapSizeAllowed(mode: GameMode, mapSize: number): boolean {
  return mapSize <= 18 || mode === "creative" || mode === "glory" || mode === "might";
}

export const difficultyOf = (s: GameState): Difficulty => s.difficulty ?? "normal";

export function withRng<T>(s: GameState, f: (rng: Rng) => T): T {
  const rng = createRng(s.rng);
  const out = f(rng);
  s.rng = rng.state();
  return out;
}

export function log(s: GameState, msg: string) {
  s.log.push(`T${s.turn} P${s.current}: ${msg}`);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

export function cityById(s: GameState, id: number | null): City | undefined {
  return id === null ? undefined : s.cities.find((c) => c.id === id);
}

export function citiesOf(s: GameState, p: number): City[] {
  return s.cities.filter((c) => c.owner === p);
}

export function capitalOf(s: GameState, p: number): City | undefined {
  return s.cities.find((c) => c.owner === p && c.capital);
}

/** reveal tiles around a coord for a player (§4.6) */
export function explore(s: GameState, p: number, c: Coord, r: number) {
  const pl = s.players[p];
  for (const q of around(s.mapSize, c, r, true)) {
    const i = idx(s.mapSize, q.x, q.y);
    if (pl.explored[i] === 1) continue;
    pl.explored[i] = 1;
    // lighthouse discovery: +1 population to the capital (§5.11)
    if (s.tiles[i].lighthouse && !pl.lighthouses.includes(i)) {
      pl.lighthouses.push(i);
      const cap = capitalOf(s, p) ?? citiesOf(s, p)[0];
      if (cap) addPop(s, cap, 1);
    }
  }
}

/** claim unowned tiles within radius r of the city (§5.7) */
export function claimTerritory(s: GameState, city: City, r: number) {
  for (const q of around(s.mapSize, city, r, true)) {
    const t = tileAt(s, q.x, q.y);
    if (t.territory === null || t.territory === city.id) t.territory = city.id;
  }
}

export function addPop(s: GameState, city: City, n: number) {
  city.pop += n;
  while (city.pop >= city.level + 1) {
    city.pop -= city.level + 1;
    city.level += 1;
    city.pendingRewards.push(city.level);
  }
}

export function unitsHomedIn(s: GameState, city: City): number {
  return s.units.filter((u) => u.homeCity === city.id && u.owner === city.owner).length;
}

export function unitCapacity(city: City): number {
  return city.level + 1;
}

/** stars per turn of one city (§5.2), ignoring siege */
export function cityIncome(s: GameState, c: City): number {
  const bonus = !c.capital ? 0 : s.players[c.owner]?.bot ? BOT_CAPITAL_BONUS[difficultyOf(s)] : HUMAN_CAPITAL_BONUS;
  const neg = c.pop < 0 ? -c.pop : 0;
  return Math.max(0, c.level + (c.workshop ? 1 : 0) + c.parks + bonus - neg);
}

/** an enemy unit stands in the city (a peace partner's unit does not besiege it) */
export function underSiege(s: GameState, c: City): boolean {
  return s.units.some((u) => u.x === c.x && u.y === c.y && u.owner !== c.owner && !atPeace(s, u.owner, c.owner));
}

/** market stars: sum of adjacent own windmill/sawmill/forge levels (a level-0 one counts 1), capped (§5.5) */
function marketIncome(s: GameState, p: number): number {
  let total = 0;
  s.tiles.forEach((t, i) => {
    if (t.building !== "market") return;
    const c = cityById(s, t.territory);
    if (!c || c.owner !== p) return;
    const pos = { x: i % s.mapSize, y: Math.floor(i / s.mapSize) };
    let sum = 0;
    for (const q of around(s.mapSize, pos, 1)) {
      const n = tileAt(s, q.x, q.y);
      const nc = cityById(s, n.territory);
      if (nc?.owner === p && ["windmill", "sawmill", "forge"].includes(n.building ?? ""))
        sum += Math.max(1, n.buildingLevel);
    }
    total += Math.min(MARKET_CAP, sum);
  });
  return total;
}

/**
 * Ice Bank level (S1 polaris::ice_bank_level): one level per 20 tiles of ice or Polaris-climate
 * land over the whole board, at most 30. Polaris land is `polar` (its home climate and Freeze Area).
 */
export function iceBankLevel(s: GameState): number {
  const count = s.tiles.filter((t) => t.ice || (t.polar && !isWater(t))).length;
  return Math.min(30, Math.floor(count / 20));
}

/**
 * Special tribe building income (S1 turns::work = work x level), from own-territory buildings:
 * Sanctuary (Elyrion) 1★ per adjacent own tile with a wild animal and no building, at most 8;
 * Clathrus (Cymanti) 1★ per adjacent own Fungi, at most 8; Ice Bank (Polaris) 2★ per level.
 */
function specialBuildingIncome(s: GameState, p: number): number {
  let total = 0;
  s.tiles.forEach((t, i) => {
    if (!t.building) return;
    const c = cityById(s, t.territory);
    if (!c || c.owner !== p) return;
    const pos = { x: i % s.mapSize, y: Math.floor(i / s.mapSize) };
    const ownAround = () =>
      around(s.mapSize, pos, 1)
        .map((q) => tileAt(s, q.x, q.y))
        .filter((n) => cityById(s, n.territory)?.owner === p);
    if (t.building === "sanctuary") {
      total += Math.min(8, ownAround().filter((n) => n.resource === "animal" && !n.building && n.cityId === null && !n.village).length);
    } else if (t.building === "iceBank") {
      total += 2 * iceBankLevel(s);
    } else if (t.building === "clathrus") {
      total += Math.min(8, ownAround().filter((n) => n.building === "fungi").length);
    }
  });
  return total;
}

/** expected income for player p at the start of their next turn */
/**
 * Whether player p can see a resource kind: crops show only with Organization
 * and metal only with Climbing (rules doc, Tech tree: "Harvest fruit, see crops",
 * "Mountains, see metal"). Special tribes keep these tech ids under other names.
 */
export function resourceVisible(s: GameState, p: number, r: string): boolean {
  const techs = s.players[p].techs;
  if (r === "aquaCrop") return s.players[p].clan === "aquarion";
  if (r === "crop") return techs.includes("organization");
  if (r === "metal") return techs.includes("climbing");
  return true;
}

export function income(s: GameState, p: number): number {
  let total = 0;
  for (const c of citiesOf(s, p)) {
    if (underSiege(s, c) || c.riot) continue;
    total += cityIncome(s, c);
  }
  total += marketIncome(s, p);
  total += specialBuildingIncome(s, p);
  // embassies pay both builder and host, double between peace partners, nothing while at war (2.18)
  for (const pl of s.players) {
    if (!pl.alive) continue;
    for (const host of pl.embassies) {
      if (!s.players[host]?.alive || atWar(s, pl.id, host)) continue;
      const pay = atPeace(s, pl.id, host) ? 2 * EMBASSY_INCOME : EMBASSY_INCOME;
      if (pl.id === p) total += pay;
      if (host === p) total += pay;
    }
  }
  return total;
}

export function techCost(s: GameState, p: number, tech: string): number {
  const t = TECH_BY_ID[tech];
  const cities = citiesOf(s, p).length;
  const literacy = s.players[p].techs.includes("philosophy");
  const base = 4 + t.tier * cities;
  return literacy ? Math.ceil(base * Math.fround(0.66666)) : base;
}

/** a tech is researchable if its parent is owned, or one of its children (§1.1) */
export function canResearch(s: GameState, p: number, tech: string): boolean {
  const pl = s.players[p];
  if (pl.techs.includes(tech)) return false;
  const t = TECH_BY_ID[tech];
  if (t.parent === null || pl.techs.includes(t.parent)) return true;
  return TECHS.some((c) => c.parent === tech && pl.techs.includes(c.id));
}

/**
 * unit score value (S1 units::unit_score): 5 × (cost + the passenger's cost), so a ship scores its
 * own cost too (Scout or Rammer +25, Bomber +75) and a Juggernaut (0★) its Giant (50)
 */
function unitScore(u: Unit): number {
  return SCORE.perUnitCost * (UNITS[u.type].cost + (u.carried ? UNITS[u.carried].cost : 0));
}

export function scoreOf(s: GameState, p: number): number {
  const pl = s.players[p];
  let score = 0;
  score += pl.explored.reduce((a, b) => a + b, 0) * SCORE.exploredTile;
  for (const t of pl.techs) score += SCORE.techTier * TECH_BY_ID[t].tier;
  for (const u of s.units) if (u.owner === p) score += unitScore(u);
  const mine = new Set(citiesOf(s, p).map((c) => c.id));
  for (const c of citiesOf(s, p)) score += cityScore(c);
  for (const t of s.tiles) {
    if (t.territory === null || !mine.has(t.territory)) continue;
    score += SCORE.territoryTile;
    if (!t.building) continue;
    const kind = BUILDS[t.building]?.kind;
    if (kind === "temple") {
      const lvl = Math.min(SCORE.templeMaxLevel, 1 + Math.floor((s.turn - t.builtTurn) / 2));
      score += SCORE.templeLevel * lvl;
    } else if (kind === "monument") {
      score += SCORE.monument;
    }
  }
  return score;
}

/**
 * City score (game data 2.18; logic follows polybots-engine): 50 × (level + 1)
 * plus 5 per population point toward the next level. Negative population costs
 * 105 per point and the city part never drops below 0. Parks 250 each.
 */
export function cityScore(c: City): number {
  let score = SCORE.cityPerLevel * (c.level + 1) + SCORE.cityPop * c.pop;
  if (c.pop < 0) score = Math.max(0, score + SCORE.cityNegativePop * c.pop);
  return score + SCORE.park * c.parks;
}

/**
 * Perfection rating (2.18): score × (1 + bonus), bonus = round(handicap/5 +
 * ln(opponents)/ln(11.4), 2), handicap 0/1/2/4 for Easy/Normal/Hard/Crazy.
 */
export function perfectionRating(s: GameState, p: number): number {
  const opponents = s.players.length - 1;
  const raw = PERFECTION_DIFFICULTY_BONUS[difficultyOf(s)] + (opponents > 0 ? Math.log(opponents) / Math.log(11.4) : 0);
  const bonus = 1 + Math.round(raw * 100) / 100;
  return Math.round(scoreOf(s, p) * bonus);
}

/**
 * Domination end rating (2.18 end screen): the mean of speed min(1, 10 ×
 * opponents / turns), battle (kills + 1) / (losses + kills + 1), destroyed
 * tribes / opponents and the difficulty part 25/50/75/100%.
 */
export function dominationRating(s: GameState, p: number): number {
  const pl = s.players[p];
  const opponents = s.players.length - 1;
  if (opponents <= 0) return 1;
  const speed = s.turn > 0 ? Math.min(1, (10 * opponents) / s.turn) : 1;
  const battle = (pl.kills + 1) / (pl.losses + pl.kills + 1);
  const destroyed = s.players.filter((o) => o.id !== p && !o.alive).length / opponents;
  return (speed + battle + destroyed + DOMINATION_DIFFICULTY[difficultyOf(s)]) / 4;
}

/** Domination stars for a rating: 0-3, 4 = halo (20% / 70% / 95% / 100%) */
export function dominationStars(rating: number): number {
  return DOMINATION_STARS.filter((t) => rating >= t - 1e-9).length;
}

/** Perfection stars for a rating: 0-3, 4 = halo (3,000 / 10,000 / 50,000 / 100,000) */
export function perfectionStars(rating: number): number {
  return PERFECTION_STARS.filter((t) => rating >= t).length;
}

/* ---------- city connections (§5.6) ---------- */

/** a tile that carries a land connection (explored or not: S1 routes::connectable) */
function networkNode(s: GameState, i: number): boolean {
  const t = s.tiles[i];
  return t.road || t.building === "bridge" || t.village || t.cityId !== null || t.building === "port" || t.building === "outpost" || t.building === "mycelium";
}

/**
 * A connection step from tile `a` onto tile `b` (S1 routes::owners_allow): b is unowned, has a's
 * owner, a is unowned, or the two owners are at peace. So a connection may cross peace partners' land.
 */
function ownersAllow(s: GameState, a: Tile, b: Tile): boolean {
  const from = cityById(s, a.territory)?.owner;
  const to = cityById(s, b.territory)?.owner;
  return to === undefined || to === from || from === undefined || atPeace(s, from, to);
}

/** recompute which of p's cities are connected to its capital; adjust population */
export function updateConnections(s: GameState, p: number) {
  const cap = capitalOf(s, p);
  const n = s.mapSize;
  const connected = new Set<number>();
  if (cap) {
    const seen = new Set<number>([idx(n, cap.x, cap.y)]);
    const queue = [idx(n, cap.x, cap.y)];
    const explored = s.players[p].explored;
    while (queue.length) {
      const cur = queue.shift()!;
      const c = { x: cur % n, y: Math.floor(cur / n) };
      const t = s.tiles[cur];
      if (t.cityId !== null) connected.add(t.cityId);
      for (const q of around(n, c, 1)) {
        const i = idx(n, q.x, q.y);
        if (seen.has(i)) continue;
        if (networkNode(s, i) && ownersAllow(s, t, s.tiles[i])) {
          seen.add(i);
          queue.push(i);
        }
      }
      // Mycelium links cities and other Mycelium within 3 tiles
      if (t.building === "mycelium" || (t.cityId !== null && s.players[p].clan === "cymanti")) {
        for (const q of around(n, c, 3)) {
          const j = idx(n, q.x, q.y);
          const tj = s.tiles[j];
          if (seen.has(j) || explored[j] !== 1) continue;
          if (!(tj.building === "mycelium" || (t.building === "mycelium" && tj.cityId !== null))) continue;
          if (cityById(s, tj.territory)?.owner !== p && tj.cityId === null) continue;
          if (tj.cityId !== null && cityById(s, tj.cityId)?.owner !== p) continue;
          seen.add(j);
          queue.push(j);
        }
      }
      // port-to-port links within range 5 over friendly water; ocean only with Sailing
      // (Polaris: outposts link like ports)
      if (t.building === "port" || t.building === "outpost") {
        for (let j = 0; j < s.tiles.length; j++) {
          if (seen.has(j) || s.tiles[j].building !== t.building) continue;
          const q = { x: j % n, y: Math.floor(j / n) };
          if (dist(c, q) > PORT_RANGE) continue;
          const owner = cityById(s, s.tiles[j].territory)?.owner;
          if (owner !== p) continue;
          if (waterPath(s, p, c, q)) {
            seen.add(j);
            queue.push(j);
          }
        }
      }
      // Aquarion Atolls link own cities and atolls within 3 tiles
      if (t.building === "atoll" || t.cityId !== null) {
        for (let j = 0; j < s.tiles.length; j++) {
          const o = s.tiles[j];
          if (seen.has(j) || dist(c, { x: j % n, y: Math.floor(j / n) }) > 3) continue;
          if (!(o.building === "atoll" || (t.building === "atoll" && o.cityId !== null))) continue;
          if (cityById(s, o.cityId ?? o.territory)?.owner !== p) continue;
          seen.add(j);
          queue.push(j);
        }
      }
    }
  }
  for (const city of citiesOf(s, p)) {
    if (city.capital) continue;
    const now = connected.has(city.id);
    if (now !== city.connected) {
      city.connected = now;
      const d = now ? 1 : -1;
      addPop(s, city, d);
      if (cap) addPop(s, cap, d);
    }
  }
}

function waterPath(s: GameState, p: number, a: Coord, b: Coord): boolean {
  const n = s.mapSize;
  const seen = new Set<number>([idx(n, a.x, a.y)]);
  const queue = [a];
  const sailing = s.players[p].techs.includes("sailing");
  while (queue.length) {
    const c = queue.shift()!;
    if (c.x === b.x && c.y === b.y) return true;
    for (const q of around(n, c, 1)) {
      const i = idx(n, q.x, q.y);
      if (seen.has(i) || dist(a, q) > PORT_RANGE) continue;
      const t = s.tiles[i];
      if (!isWater(t) && !t.flooded) continue;
      if (t.terrain === "ocean" && !sailing) continue;
      const o = cityById(s, t.territory)?.owner;
      if (o !== undefined && o !== p && !atPeace(s, p, o)) continue; // own, neutral or a peace partner's water (S1 routes::accessible)
      seen.add(i);
      queue.push(q);
    }
  }
  return false;
}

/* ---------- tasks and meetings ---------- */

export function checkTasks(s: GameState, p: number) {
  const pl = s.players[p];
  const done = (t: string) => pl.tasks.includes(t);
  const complete = (t: string) => {
    if (!done(t)) {
      pl.tasks.push(t);
      log(s, `task ${t} complete: monument ${MONUMENTS[t]} available`);
    }
  };
  if (!done("genius") && TECHS.every((t) => pl.techs.includes(t.id))) complete("genius");
  if (!done("wealth") && pl.techs.includes("trade") && pl.stars >= 100) complete("wealth");
  if (!done("killer") && pl.kills >= 10) complete("killer");
  if (!done("metropolis") && citiesOf(s, p).some((c) => c.level >= 5)) complete("metropolis");
  if (!done("network") && citiesOf(s, p).filter((c) => c.connected).length >= 5) complete("network");
  if (!done("explorer") && pl.lighthouses.length >= 4) complete("explorer");
  // Cymanti: the convert task (3 enemies converted by Shamans) replaces the pacifist task (2.18 data)
  if (pl.clan === "cymanti") {
    if (!done("convert") && (pl.conversions ?? 0) >= 3) complete("convert");
  } else if (!done("pacifist") && pl.pacifistTurns >= 5) complete("pacifist");
}

/** meeting reward (§5.9) and Capital Vision; checked after every action */
export function checkMeetings(s: GameState) {
  for (const pl of s.players) {
    if (!pl.alive) continue;
    for (const other of s.players) {
      if (other.id === pl.id || !other.alive || pl.met.includes(other.id)) continue;
      const seesUnit = s.units.some((u) => u.owner === other.id && canSee(s, pl.id, u));
      const seesCity = s.cities.some(
        (c) => c.owner === other.id && pl.explored[idx(s.mapSize, c.x, c.y)] === 1,
      );
      if (!seesUnit && !seesCity) continue;
      meet(s, pl.id, other.id);
    }
    if (pl.techs.includes("diplomacy")) {
      for (const m of pl.met) {
        const cap = s.cities.find((c) => c.originalCapitalOf === m);
        if (cap) pl.explored[idx(s.mapSize, cap.x, cap.y)] = 1;
      }
    }
  }
}

/**
 * player p meets `other` (S1 explore::meet_action): stars of 1 + 2 per 1,000 of their score (rounded
 * up, at most 5 tiers); the base is 3 instead of 1 when meeting the first seat in a 2-player game
 */
export function meet(s: GameState, p: number, other: number) {
  const pl = s.players[p];
  if (p === other || pl.met.includes(other)) return;
  pl.met.push(other);
  const sc = scoreOf(s, other);
  const base = s.players.length === 2 && other === 0 ? 3 : 1;
  pl.stars += base + 2 * Math.min(Math.ceil(sc / 1000), 5);
}

/* ---------- units ---------- */

export function makeUnit(
  s: GameState,
  type: string,
  owner: number,
  at: Coord,
  homeCity: number | null,
): Unit {
  const def = UNITS[type];
  const hp = def.hp ?? 10;
  const u: Unit = {
    id: s.nextId++,
    type,
    carried: null,
    owner,
    x: at.x,
    y: at.y,
    hp,
    maxHp: hp,
    kills: 0,
    veteran: false,
    homeCity: (def.skills as string[]).includes("independent") ? null : homeCity,
    canMove: false,
    canAttack: false,
    moved: false,
    attacked: false,
    done: true,
    idle: true,
    hidden: false,
    lastDir: null,
    createdTurn: s.turn,
  };
  s.units.push(u);
  return u;
}

/** S1's direction vectors (step.rs facing_direction, units.rs VECTORS), by S1 direction index */
const S1_DIRS: Coord[] = [
  { x: -1, y: -1 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 },
  { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: -1 },
];
/** the S1 direction with the strictly greatest weighted dot product with (x, y), the first on a tie */
function s1Nearest(x: number, y: number): number {
  let best = 0;
  let score = 0;
  S1_DIRS.forEach((d, i) => {
    const dot = (d.x * x + d.y * y) * (d.x * d.x + d.y * d.y === 1 ? 1393 : 985);
    if (score < dot) {
      score = dot;
      best = i;
    }
  });
  return best;
}
/** S1 step::facing_direction from `a` toward `b` (an S1 direction index) */
function s1Facing(a: Coord, b: Coord): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) {
    const k = S1_DIRS.findIndex((d) => d.x === dx && d.y === dy);
    return k < 0 ? 8 : k;
  }
  return s1Nearest(dx, dy);
}
/** S1 units.rs average: opposite directions give the first turned a quarter, else the nearest to the sum */
function s1Average(first: number, second: number): number {
  const a = S1_DIRS[first] ?? { x: 0, y: 0 };
  const b = S1_DIRS[second] ?? { x: 0, y: 0 };
  const x = a.x + b.x;
  const y = a.y + b.y;
  if (x === 0 && y === 0) return (first + 2) % 8;
  return s1Nearest(x, y);
}

/**
 * push a unit off a tile to make room for a spawn (§5.13); removes it if no room.
 * A friendly occupant is pushed the way it faces, an enemy one the opposite way; a chain member is
 * pushed along the chain: toward its leader, its follower, or between the two (S1 units.rs try_push).
 * `spawner` is the owner of the unit being created (default: the occupant's owner).
 * What the push sets off on the new tile is in actions.ts pushAside.
 */
export function pushUnit(s: GameState, u: Unit, spawner: number = u.owner) {
  const n = s.mapSize;
  const c = (n - 1) / 2;
  let dir = u.lastDir ?? { x: Math.sign(c - u.x), y: Math.sign(c - u.y) };
  if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: 1 };
  if (spawner !== u.owner) dir = { x: -dir.x, y: -dir.y };
  const lead = leaderOf(s, u);
  const follow = followerOf(s, u);
  // a chain member whose partner is gone faces S1 direction 0 toward it (linked::find misses)
  const toward = (o: Unit | undefined) => (o && s.units.includes(o) ? s1Facing(u, o) : 0);
  const chainDir = lead && follow ? s1Average(toward(lead), toward(follow)) : lead ? toward(lead) : follow ? toward(follow) : -1;
  if (chainDir >= 0) dir = S1_DIRS[chainDir] ?? S1_DIRS[0];
  const dirs8 = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
  ];
  const k = dirs8.findIndex((d) => d.x === Math.sign(dir.x) && d.y === Math.sign(dir.y));
  const order = [0, 1, -1, 2, -2, 3, -3, 4];
  for (const o of order) {
    const d = dirs8[(k + o + 8) % 8];
    const x = u.x + d.x;
    const y = u.y + d.y;
    if (!inBounds(n, x, y)) continue;
    if (s.units.some((v) => v.x === x && v.y === y)) continue;
    const t = tileAt(s, x, y);
    const naval = UNITS[u.type].naval;
    const amphibious = (UNITS[u.type].skills as string[]).includes("amphibious");
    if (!amphibious && (naval ? !isWater(t) && !t.flooded : isWater(t) && t.building !== "bridge")) continue;
    u.x = x;
    u.y = y;
    return;
  }
  s.units = s.units.filter((v) => v !== u);
}

/** remove a player who lost their last city (§5.8) */
export function checkElimination(s: GameState) {
  for (const pl of s.players) {
    if (!pl.alive) continue;
    if (citiesOf(s, pl.id).length === 0) {
      // a wiped tribe: every unit disbanded, every embassy to or from it ended
      pl.alive = false;
      s.units = s.units.filter((u) => u.owner !== pl.id);
      pl.embassies = [];
      for (const o of s.players) o.embassies = o.embassies.filter((h) => h !== pl.id);
      log(s, `player ${pl.id} eliminated`);
    }
  }
  checkGameEnd(s, false);
}

/** the alive player with the highest score; ties go to the lower player index */
export function leader(s: GameState): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const o of s.players) {
    if (!o.alive) continue;
    const sc = scoreOf(s, o.id);
    if (sc > bestScore) {
      best = o.id;
      bestScore = sc;
    }
  }
  return best;
}

/**
 * Game end by mode (rules doc, Modes). Called after every action and, with
 * turnEnded, after every player's turn:
 * - every mode: the last tribe with a city wins;
 * - single player (exactly one human seat): the human losing all cities ends the game (a loss);
 * - Perfection: after the last turn (turn maxTurns - 1) the highest score among alive players wins;
 * - Glory: as soon as someone reaches the target (after any action), the highest score wins;
 * - Might: holding every tribe's original capital wins.
 * Domination and Creative end only by elimination (Creative has no turn limit).
 */
export function checkGameEnd(s: GameState, turnEnded: boolean) {
  if (s.over) return;
  const end = (w: number | null) => {
    s.over = true;
    s.winner = w;
  };
  const alive = s.players.filter((p) => p.alive);
  if (alive.length === 1) return end(alive[0].id);
  const humans = s.players.filter((p) => !p.bot);
  if (humans.length === 1 && !humans[0].alive) return end(leader(s));
  if (s.mode === "might") {
    const capitals = s.cities.filter((c) => c.originalCapitalOf !== null);
    const holder = capitals[0]?.owner;
    if (capitals.length > 1 && capitals.every((c) => c.owner === holder)) return end(holder);
  }
  // Glory (S1 step::add_score): over as soon as a score reaches the target, after any action
  if (s.mode === "glory" && s.players.some((o) => o.alive && scoreOf(s, o.id) >= GLORY_TARGET)) return end(leader(s));
  if (!turnEnded) return;
  // Perfection (S1 turns::winner): over when the round counter reaches the limit, so turns 0..limit-1
  if (s.mode === "perfection" && s.turn >= s.maxTurns) return end(leader(s));
}

/* ---------- setup ---------- */

export function newCity(s: GameState, at: Coord, owner: number): City {
  const city: City = {
    id: s.nextId++,
    name: withRng(s, (r) => r.pick(CITY_NAMES)),
    owner,
    x: at.x,
    y: at.y,
    level: 1,
    pop: 0,
    capital: false,
    originalCapitalOf: null,
    walls: false,
    workshop: false,
    parks: 0,
    connected: false,
    riot: false,
    pendingRewards: [],
  };
  s.cities.push(city);
  const t = tileAt(s, at.x, at.y);
  t.cityId = city.id;
  t.village = false;
  return city;
}

export function createGame(opts: NewGameOptions): GameState {
  const n = opts.mapSize ?? mapSizeFor(opts.mode, opts.players - 1) ?? 16;
  if (opts.players > maxPlayersFor(n)) throw new Error(`a ${n}x${n} map holds at most ${maxPlayersFor(n)} tribes`);
  const rng = createRng(opts.seed);
  const clanIds =
    opts.clans ??
    shuffle(
      rng,
      CLANS.map((c) => c.id),
    )
      .concat(shuffle(rng, CLANS.map((c) => c.id)))
      .slice(0, opts.players);
  const mods = clanIds.map((c) => CLAN_BY_ID[c].mod as Record<string, number>);
  const map = generateMap(rng, n, opts.players, opts.mapType ?? "drylands", mods, {
    startResources: clanIds.map((c) => CLAN_BY_ID[c].startResources),
    climates: clanIds.slice(),
    flooded: clanIds.map((c) => c === "aquarion"),
    polaris: clanIds.map((c) => c === "polaris"),
  });
  const humans = new Set(opts.humans ?? [0]);

  const s: GameState = {
    seed: opts.seed,
    rng: rng.state(),
    mapSize: n,
    mode: opts.mode,
    difficulty: opts.difficulty ?? "normal",
    maxTurns: opts.turnLimit ?? PERFECTION_TURNS,
    turn: 0,
    current: 0,
    tiles: map.tiles,
    units: [],
    cities: [],
    players: [],
    nextId: 1,
    winner: null,
    over: false,
    log: [],
  };

  for (let p = 0; p < opts.players; p++) {
    const clan = CLAN_BY_ID[clanIds[p]];
    const pl: Player = {
      id: p,
      clan: clan.id,
      stars: clan.startStars,
      techs: clan.startTech ? [clan.startTech] : [],
      explored: new Array(n * n).fill(0),
      alive: true,
      bot: !humans.has(p),
      kills: 0,
      losses: 0,
      met: [],
      tasks: [],
      monuments: [],
      pacifistTurns: 0,
      attackedThisTurn: false,
      lighthouses: [],
      embassies: [],
      capitalId: -1,
    };
    s.players.push(pl);
    const cap = newCity(s, map.capitals[p], p);
    cap.capital = true;
    cap.originalCapitalOf = p;
    cap.level = clan.capitalLevel;
    pl.capitalId = cap.id;
    claimTerritory(s, cap, 1);
    explore(s, p, cap, 2);
    const unit = makeUnit(s, clan.startUnit, p, cap, cap.id);
    // the starting unit can act on turn 0 (§8)
    unit.done = false;
  }
  // Polaris home climate: map generation already marks the land around a Polaris capital as Polaris
  // land (S1 mapgen_candidate populate: the 3×3 area); nothing more here
  startTurn(s);
  checkMeetings(s);
  return s;
}

/** start-of-turn processing for s.current (§5.2) */
export function startTurn(s: GameState) {
  const p = s.current;
  const pl = s.players[p];
  pl.attackedThisTurn = false;
  if (s.turn > 0) {
    pl.stars += income(s, p);
    for (const c of citiesOf(s, p)) c.riot = false;
  }
  for (const u of s.units) {
    if (u.owner !== p) continue;
    u.secondAttack = false;
    const frozen = !!u.frozen;
    u.canMove = !frozen;
    u.canAttack = !frozen && (UNITS[u.type].attack > 0 || (UNITS[u.type].skills as string[]).includes("convert"));
    u.moved = false;
    u.attacked = false;
    u.done = frozen;
    u.idle = true;
  }
  if (s.turn > 0) {
    sanctuaryAnimals(s, p);
    growFungi(s, p);
  }
  checkTasks(s, p);
}

/** Grow: unit type -> what it becomes and its growth rate (game data growth_rate) */
const GROWS: Record<string, { into: string; rate: number }> = {
  dragonEgg: { into: "babyDragon", rate: 3 },
  babyDragon: { into: "fireDragon", rate: 3 },
  insectEgg: { into: "larva", rate: 1 },
  larva: { into: "moth", rate: 3 },
};

/**
 * Grow (S1 turns::end_command / grow), at the end of the owner's turn: a Grow unit with
 * turn - createdTurn >= its growth rate becomes the next stage, which counts from this turn again
 * (Dragon Egg -> Baby Dragon -> Fire Dragon, 3 + 3; Insect Egg -> Larva -> Moth, 1 + 3). The unit
 * keeps its damage (at least 1 HP).
 */
export function growUnits(s: GameState, p: number) {
  for (const u of s.units) {
    if (u.owner !== p || !(UNITS[u.type].skills as string[]).includes("grow")) continue;
    const g = GROWS[u.type];
    if (!g || s.turn - (u.createdTurn ?? 0) < g.rate) continue;
    const lost = u.maxHp - u.hp;
    u.type = g.into;
    u.maxHp = UNITS[g.into].hp! + (u.veteran ? 5 : 0);
    u.hp = Math.max(1, u.maxHp - lost);
    u.createdTurn = s.turn;
  }
}

/**
 * Elyrion Sanctuary (S1 elyrion::attract): every 2 turns of its age it puts a wild animal on the first
 * adjacent tile (x-major from the north-west corner) that p owns, that is forest and holds no
 * building and no resource.
 */
function sanctuaryAnimals(s: GameState, p: number) {
  const n = s.mapSize;
  s.tiles.forEach((t, i) => {
    if (t.building !== "sanctuary" || cityById(s, t.territory)?.owner !== p) return;
    const age = s.turn - t.builtTurn;
    if (age % 2 !== 0) return;
    const cx = i % n;
    const cy = Math.floor(i / n);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        if (!inBounds(n, x, y)) continue;
        const qt = tileAt(s, x, y);
        if (cityById(s, qt.territory)?.owner !== p) continue;
        if (qt.terrain !== "forest" || qt.resource !== null || qt.building !== null || qt.cityId !== null || qt.village) continue;
        qt.resource = "animal";
        return;
      }
    }
  });
}

/**
 * Cymanti Fungi grow (S1 economy::level_for, patina): level = turns since built, at most 1, 2 with
 * Microbes (Recycling, the Construction slot); each new level gives its city +1 population.
 */
function growFungi(s: GameState, p: number) {
  const cap = 1 + (s.players[p].techs.includes("construction") && s.players[p].clan === "cymanti" ? 1 : 0);
  for (const t of s.tiles) {
    if (t.building !== "fungi") continue;
    const c = cityById(s, t.territory);
    if (!c || c.owner !== p) continue;
    const level = Math.min(cap, Math.max(0, s.turn - t.builtTurn));
    if (level > t.buildingLevel) {
      addPop(s, c, level - t.buildingLevel);
      t.buildingLevel = level;
    }
  }
}

/** pending level-up rewards for the current player, as [city, level] */
export function pendingReward(s: GameState): { city: City; options: [string, string] } | null {
  for (const c of citiesOf(s, s.current)) {
    if (c.pendingRewards.length) return { city: c, options: rewardOptions(c.pendingRewards[0]) };
  }
  return null;
}
