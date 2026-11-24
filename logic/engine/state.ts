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
import type { City, Coord, Difficulty, GameMode, GameState, Player, Unit } from "./types";
import { canSee } from "./movement";
import { atPeace } from "./diplomacy";

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

/** market stars: sum of adjacent own windmill/sawmill/forge levels, capped (§5.5) */
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
        sum += n.buildingLevel;
    }
    total += Math.min(MARKET_CAP, sum);
  });
  return total;
}

/** Special tribe building income: Sanctuary (Elyrion), Ice Bank (Polaris), Clathrus (Cymanti). */
function specialBuildingIncome(s: GameState, p: number): number {
  let total = 0;
  let hasIceBank = false;
  s.tiles.forEach((t, i) => {
    if (!t.building) return;
    const c = cityById(s, t.territory);
    if (!c || c.owner !== p) return;
    const pos = { x: i % s.mapSize, y: Math.floor(i / s.mapSize) };
    if (t.building === "sanctuary") {
      // +1 per adjacent wild animal
      total += around(s.mapSize, pos, 1).filter((q) => tileAt(s, q.x, q.y).resource === "animal").length;
    } else if (t.building === "iceBank") {
      hasIceBank = true;
    } else if (t.building === "clathrus") {
      // +1 per adjacent algae
      total += around(s.mapSize, pos, 1).filter((q) => tileAt(s, q.x, q.y).algae).length;
    }
  });
  if (hasIceBank) {
    // frozen tiles: ice and Polaris land
    const frozenCount = s.tiles.filter((t) => t.ice || t.polar).length;
    total += Math.min(30, Math.floor(frozenCount / 20) * 2);
  }
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
  // embassies pay both builder and host, double between peace partners (rules doc, Embassy)
  for (const pl of s.players) {
    if (!pl.alive) continue;
    for (const host of pl.embassies) {
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

/** unit score value (§7.1) */
const SUPER_UNITS = new Set(["giant", "juggernaut", "crab", "dragonEgg", "babyDragon", "fireDragon", "gaami", "centipede"]);
function unitScore(u: Unit): number {
  if (SUPER_UNITS.has(u.type) || (u.carried && SUPER_UNITS.has(u.carried))) return SCORE.superUnit;
  const def = UNITS[u.type];
  // a ship scores only the unit it carries; upgrading a ship adds nothing (rules doc, Scoring)
  if (def.naval) return SCORE.perUnitCost * (u.carried ? UNITS[u.carried].cost : 0);
  return SCORE.perUnitCost * def.cost;
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
 * City score (rules doc, Scoring): 100 at level 1, 5 per population point (the
 * points spent on each level-up plus the current population, which counts
 * against when negative), plus a level-up bonus of 40 at level 2, 35 at level 3
 * and falling after; parks 250 each.
 */
export function cityScore(c: City): number {
  let score = SCORE.city + SCORE.cityPop * c.pop + SCORE.park * c.parks;
  for (let l = 2; l <= c.level; l++) score += SCORE.cityPop * l + SCORE.cityLevelBonus(l);
  return score;
}

/**
 * Perfection rating (rules doc, Perfection difficulty bonus):
 * score x (1 + 0.41 ln(opponents) + d), d = 0/0.2/0.4/0.8 for Easy/Normal/Hard/Crazy.
 */
export function perfectionRating(s: GameState, p: number): number {
  const opponents = s.players.length - 1;
  const bonus = 1 + (opponents > 0 ? 0.41 * Math.log(opponents) : 0) + PERFECTION_DIFFICULTY_BONUS[difficultyOf(s)];
  return Math.round(scoreOf(s, p) * bonus);
}

/** Perfection stars for a rating: 0-3, 4 = halo (3,000 / 10,000 / 50,000 / 100,000) */
export function perfectionStars(rating: number): number {
  return PERFECTION_STARS.filter((t) => rating >= t).length;
}

/* ---------- city connections (§5.6) ---------- */

function networkNode(s: GameState, i: number, p: number): boolean {
  const t = s.tiles[i];
  if (!(t.road || t.building === "bridge" || t.village || t.cityId !== null || t.building === "port" || t.building === "outpost" || t.building === "mycelium")) return false;
  const c = cityById(s, t.territory);
  return !c || c.owner === p;
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
        if (seen.has(i) || explored[i] !== 1) continue;
        if (networkNode(s, i, p)) {
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
      if (o !== undefined && o !== p) continue;
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
  // Cymanti: convert 3 enemies with Shamans instead of the pacifist task
  if (!done("pacifist") && (pl.clan === "cymanti" ? (pl.conversions ?? 0) >= 3 : pl.pacifistTurns >= 5)) complete("pacifist");
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

/** player p meets `other`: stars of 1 + 2 per 1,000 of their score (rounded up), at most 11 */
export function meet(s: GameState, p: number, other: number) {
  const pl = s.players[p];
  if (p === other || pl.met.includes(other)) return;
  pl.met.push(other);
  const sc = scoreOf(s, other);
  pl.stars += 1 + 2 * Math.min(Math.ceil(sc / 1000), 5);
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
  };
  s.units.push(u);
  return u;
}

/**
 * push a unit off a tile to make room for a spawn (§5.13); removes it if no room.
 * A friendly occupant is pushed the way it faces, an enemy one the opposite way.
 * `spawner` is the owner of the unit being created (default: the occupant's owner).
 */
export function pushUnit(s: GameState, u: Unit, spawner: number = u.owner) {
  const n = s.mapSize;
  const c = (n - 1) / 2;
  let dir = u.lastDir ?? { x: Math.sign(c - u.x), y: Math.sign(c - u.y) };
  if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: 1 };
  if (spawner !== u.owner) dir = { x: -dir.x, y: -dir.y };
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
      pl.alive = false;
      s.units = s.units.filter((u) => u.owner !== pl.id);
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
 * - Perfection: after the last turn the highest score among alive players wins;
 * - Glory: at the end of a turn in which someone reached the target, the highest score wins;
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
  if (!turnEnded) return;
  if (s.mode === "perfection" && s.turn > s.maxTurns) return end(leader(s));
  if (s.mode === "glory" && s.players.some((o) => o.alive && scoreOf(s, o.id) >= GLORY_TARGET)) return end(leader(s));
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
    aquaCrops: clanIds.includes("aquarion"),
  });
  const humans = new Set(opts.humans ?? [0]);

  const s: GameState = {
    seed: opts.seed,
    rng: rng.state(),
    mapSize: n,
    mode: opts.mode,
    difficulty: opts.difficulty ?? "normal",
    maxTurns: PERFECTION_TURNS,
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
    // Grow: Dragon Egg -> Baby Dragon (3 turns) -> Fire Dragon (3 more);
    // Insect Egg -> Larva (1 turn) -> Moth (3 more). The unit keeps its damage.
    if (s.turn > 0 && (UNITS[u.type].skills as string[]).includes("grow")) {
      u.age = (u.age ?? 0) + 1;
      const g = GROWS[u.type];
      if (g && u.age >= g.at) {
        const lost = u.maxHp - u.hp;
        u.type = g.into;
        u.maxHp = UNITS[g.into].hp! + (u.veteran ? 5 : 0);
        u.hp = Math.max(1, u.maxHp - lost);
      }
    }
    // Cymanti Mycelium: heals adjacent friendly units (4 HP); a heal on a poisoned unit only cures the poison
    if (s.turn > 0 && pl.clan === "cymanti") {
      const nearMyc = around(s.mapSize, u, 1, true).some((q) => {
        const qt = tileAt(s, q.x, q.y);
        return qt.building === "mycelium" && cityById(s, qt.territory)?.owner === p;
      });
      if (nearMyc) {
        if (u.poisoned) u.poisoned = false;
        else u.hp = Math.min(u.maxHp, u.hp + 4);
      }
    }
    u.secondAttack = false;
    const frozen = !!u.frozen;
    u.canMove = !frozen;
    u.canAttack = !frozen && (UNITS[u.type].attack > 0 || (UNITS[u.type].skills as string[]).includes("convert"));
    u.moved = false;
    u.attacked = false;
    u.done = frozen;
    u.idle = true;
    if (u.hidden) u.startedHidden = true;
    else delete u.startedHidden;
  }
  if (s.turn > 0) sanctuaryAnimals(s, p);
  checkTasks(s, p);
}

/** Grow: unit type -> what it becomes and at which age (own turns lived) */
const GROWS: Record<string, { into: string; at: number }> = {
  dragonEgg: { into: "babyDragon", at: 3 },
  babyDragon: { into: "fireDragon", at: 6 },
  insectEgg: { into: "larva", at: 1 },
  larva: { into: "moth", at: 4 },
};

/** Elyrion Sanctuary: every 2 turns it draws a new wild animal into an adjacent empty forest */
function sanctuaryAnimals(s: GameState, p: number) {
  const n = s.mapSize;
  s.tiles.forEach((t, i) => {
    if (t.building !== "sanctuary" || cityById(s, t.territory)?.owner !== p) return;
    const age = s.turn - t.builtTurn;
    if (age <= 0 || age % 2 !== 0) return;
    const spots = around(n, { x: i % n, y: Math.floor(i / n) }, 1).filter((q) => {
      const qt = tileAt(s, q.x, q.y);
      return qt.terrain === "forest" && qt.resource === null && qt.building === null && qt.cityId === null && !qt.village;
    });
    if (!spots.length) return;
    const q = withRng(s, (r) => r.pick(spots));
    tileAt(s, q.x, q.y).resource = "animal";
  });
}

/** pending level-up rewards for the current player, as [city, level] */
export function pendingReward(s: GameState): { city: City; options: [string, string] } | null {
  for (const c of citiesOf(s, s.current)) {
    if (c.pendingRewards.length) return { city: c, options: rewardOptions(c.pendingRewards[0]) };
  }
  return null;
}
