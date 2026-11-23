/**
 * Game setup and the shared bookkeeping rules: exploration, territory,
 * population and levels, income, score, city connections, tasks, meetings.
 * Section numbers (§) refer to docs/shardlands/RULES.md.
 */
import { createRng, shuffle, type Rng } from "./rng";
import {
  BUILDS,
  CLANS,
  CLAN_BY_ID,
  EMBASSY_INCOME,
  MARKET_CAP,
  MONUMENTS,
  PERFECTION_TURNS,
  SCORE,
  TECHS,
  TECH_BY_ID,
  UNITS,
  rewardOptions,
} from "./data";
import { generateMap, type MapType } from "./mapgen";
import { around, dist, idx, inBounds, isWater, tileAt } from "./grid";
import type { City, Coord, GameMode, GameState, Player, Unit } from "./types";
import { canSee } from "./movement";

const CITY_NAMES = [
  "Ashford", "Brightwater", "Cinderholm", "Dunmere", "Elderglen", "Fallowmark", "Greystone",
  "Hollowell", "Ironbrook", "Juniper", "Kestrel", "Larkspur", "Mistvale", "Northwatch",
  "Oakhaven", "Pinecrest", "Quarrytown", "Redcliff", "Saltmarsh", "Thornbury", "Umberfield",
  "Valewick", "Westerby", "Yarrowby", "Zephyr Hill", "Amberleigh", "Briarwood", "Coldharbour",
  "Duskwater", "Emberly", "Foxhollow", "Glimmerdale", "Harrowgate", "Ivydown", "Kingsmoor",
];

export type NewGameOptions = {
  mapSize: number;
  players: number;
  mode: GameMode;
  seed: number;
  /** player ids controlled by humans (others are bots) */
  humans?: number[];
  mapType?: MapType;
  /** clan per player; default: random distinct clans */
  clans?: string[];
};

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
export function cityIncome(_s: GameState, c: City): number {
  const bonus = c.capital ? 1 : 0;
  const neg = c.pop < 0 ? -c.pop : 0;
  return Math.max(0, c.level + (c.workshop ? 1 : 0) + c.parks + bonus - neg);
}

export function underSiege(s: GameState, c: City): boolean {
  return s.units.some((u) => u.x === c.x && u.y === c.y && u.owner !== c.owner);
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
      total += around(s.mapSize, pos, 1).filter((q) => tileAt(s, q.x, q.y).terrain === "forest").length;
    } else if (t.building === "iceBank") {
      hasIceBank = true;
    } else if (t.building === "clathrus") {
      const adj = around(s.mapSize, pos, 1).filter((q) => {
        const nt = tileAt(s, q.x, q.y);
        return nt.algae || nt.building === "fungi";
      }).length;
      total += Math.min(16, adj * 2);
    }
  });
  if (hasIceBank) {
    const frozenCount = s.tiles.filter((t) => t.ice).length;
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
  // embassies pay both builder and host (§5.5)
  for (const pl of s.players) {
    if (!pl.alive) continue;
    for (const host of pl.embassies) {
      if (pl.id === p) total += EMBASSY_INCOME;
      if (host === p) total += EMBASSY_INCOME;
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
  if (def.naval) {
    const passenger = u.carried ? UNITS[u.carried].cost : 0;
    return SCORE.perUnitCost * (passenger + def.cost);
  }
  return SCORE.perUnitCost * def.cost;
}

export function scoreOf(s: GameState, p: number): number {
  const pl = s.players[p];
  let score = 0;
  score += pl.explored.reduce((a, b) => a + b, 0) * SCORE.exploredTile;
  for (const t of pl.techs) score += SCORE.techTier * TECH_BY_ID[t].tier;
  for (const u of s.units) if (u.owner === p) score += unitScore(u);
  const mine = new Set(citiesOf(s, p).map((c) => c.id));
  for (const c of citiesOf(s, p)) {
    score += SCORE.city + SCORE.cityLevel * (c.level - 1) + SCORE.park * c.parks;
  }
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

/* ---------- city connections (§5.6) ---------- */

function networkNode(s: GameState, i: number, p: number): boolean {
  const t = s.tiles[i];
  if (!(t.road || t.building === "bridge" || t.village || t.cityId !== null || t.building === "port")) return false;
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
      // port-to-port links within distance 4 over friendly water
      if (t.building === "port") {
        for (let j = 0; j < s.tiles.length; j++) {
          if (seen.has(j) || s.tiles[j].building !== "port") continue;
          const q = { x: j % n, y: Math.floor(j / n) };
          if (dist(c, q) > 4) continue;
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
  while (queue.length) {
    const c = queue.shift()!;
    if (c.x === b.x && c.y === b.y) return true;
    for (const q of around(n, c, 1)) {
      const i = idx(n, q.x, q.y);
      if (seen.has(i) || dist(a, q) > 4) continue;
      const t = s.tiles[i];
      if (!isWater(t) && !t.flooded) continue;
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
  if (!done("pacifist") && pl.pacifistTurns >= 5) complete("pacifist");
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
      pl.met.push(other.id);
      const sc = scoreOf(s, other.id);
      let reward = 1 + 2 * Math.min(Math.ceil(sc / 1000), 5);
      if (s.players.length === 2 && other.id === 1) reward += 2;
      pl.stars += reward;
    }
    if (pl.techs.includes("diplomacy")) {
      for (const m of pl.met) {
        const cap = s.cities.find((c) => c.originalCapitalOf === m);
        if (cap) pl.explored[idx(s.mapSize, cap.x, cap.y)] = 1;
      }
    }
  }
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

/** push a unit off a tile to make room for a spawn (§5.13); removes it if no room */
export function pushUnit(s: GameState, u: Unit) {
  const n = s.mapSize;
  const c = (n - 1) / 2;
  let dir = u.lastDir ?? { x: Math.sign(c - u.x), y: Math.sign(c - u.y) };
  if (dir.x === 0 && dir.y === 0) dir = { x: 0, y: 1 };
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
  const alive = s.players.filter((p) => p.alive);
  if (alive.length === 1) {
    s.over = true;
    s.winner = alive[0].id;
  }
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
  const n = opts.mapSize;
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
    waterStart: clanIds.map((c) => c === "polynesians" || c === "aquarion"),
    flooded: clanIds.map((c) => c === "aquarion"),
    spores: clanIds.map((c) => c === "cymanti"),
    aquaCrops: clanIds.includes("aquarion"),
  });
  const humans = new Set(opts.humans ?? [0]);

  const s: GameState = {
    seed: opts.seed,
    rng: rng.state(),
    mapSize: n,
    mode: opts.mode,
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
    // Elyrion dragon growth: Egg -> Baby Dragon (3 turns) -> Fire Dragon (6 turns)
    if (s.turn > 0 && (UNITS[u.type].skills as string[]).includes("grow")) {
      u.age = (u.age ?? 0) + 1;
      if (u.type === "dragonEgg" && u.age >= 3) {
        u.type = "babyDragon";
        u.maxHp = UNITS.babyDragon.hp!;
        u.hp = Math.min(u.maxHp, u.hp + 5);
      } else if (u.type === "babyDragon" && u.age >= 6) {
        u.type = "fireDragon";
        u.maxHp = UNITS.fireDragon.hp!;
        u.hp = Math.min(u.maxHp, u.hp + 5);
      }
    }
    // Cymanti Mycelium: heals adjacent friendly units & cures poison
    if (s.turn > 0 && pl.clan === "cymanti") {
      const nearMyc = around(s.mapSize, u, 1, true).some((q) => tileAt(s, q.x, q.y).building === "mycelium");
      if (nearMyc) {
        u.hp = Math.min(u.maxHp, u.hp + 4);
        u.poisoned = false;
      }
    }
    const frozen = !!u.frozen;
    u.canMove = !frozen;
    u.canAttack = !frozen && (UNITS[u.type].attack > 0 || (UNITS[u.type].skills as string[]).includes("convert"));
    u.moved = false;
    u.attacked = false;
    u.done = frozen;
    u.idle = true;
  }
  checkTasks(s, p);
}

/** pending level-up rewards for the current player, as [city, level] */
export function pendingReward(s: GameState): { city: City; options: [string, string] } | null {
  for (const c of citiesOf(s, s.current)) {
    if (c.pendingRewards.length) return { city: c, options: rewardOptions(c.pendingRewards[0]) };
  }
  return null;
}
