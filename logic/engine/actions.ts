/**
 * The action layer: legalActions(state) lists every action the current player
 * may take; applyAction(state, action) returns the next state. Both are pure
 * (applyAction clones first). The UI and RL agents use only these two.
 */
import {
  BUILDS,
  EMBARK_AS,
  EXPLORER_STEPS,
  FEEDS,
  LEVEL_CAP,
  MONUMENTS,
  RAFT_UPGRADES,
  RUIN_STARS,
  STARFISH_STARS,
  TECHS,
  TECH_BY_ID,
  UNITS,
  buildAllowedFor,
  superUnitFor,
  trainableUnitsFor,
} from "./data";
import { around, cloneState, dist, idx, isWater, tileAt } from "./grid";
import { computeDamageRounded } from "./combat";
import { canSee, enterKind, has, reachable, sightRadius, territoryOwner } from "./movement";
import {
  addPop,
  canResearch,
  capitalOf,
  checkElimination,
  checkMeetings,
  checkTasks,
  cityById,
  citiesOf,
  claimTerritory,
  explore,
  log,
  makeUnit,
  newCity,
  pendingReward,
  pushUnit,
  scoreOf,
  startTurn,
  techCost,
  unitCapacity,
  unitsHomedIn,
  updateConnections,
  withRng,
} from "./state";
import type { Action, City, Coord, GameState, Unit } from "./types";

/* ---------- helpers ---------- */

const unitById = (s: GameState, id: number) => s.units.find((u) => u.id === id);
const occupant = (s: GameState, x: number, y: number) => s.units.find((u) => u.x === x && u.y === y);

/** tile owned (territory) by player p */
function ownTile(s: GameState, p: number, x: number, y: number): boolean {
  return territoryOwner(s, tileAt(s, x, y)) === p;
}

function attackTargets(s: GameState, u: Unit): Unit[] {
  const def = UNITS[u.type];
  if (!u.canAttack || def.range === 0) return [];
  if (def.attack === 0 && !has(u, "convert")) return [];
  return s.units.filter(
    (t) =>
      t.owner !== u.owner &&
      dist(u, t) <= def.range &&
      canSee(s, u.owner, t),
  );
}

function infiltrateTargets(s: GameState, u: Unit): City[] {
  if (!has(u, "infiltrate") || u.done || u.attacked) return [];
  return s.cities.filter(
    (c) =>
      c.owner !== u.owner &&
      dist(u, c) === 1 &&
      !c.riot &&
      !s.units.some((o) => o.x === c.x && o.y === c.y && o.owner !== c.owner),
  );
}

/** can p build `b` on tile (x,y)? */
function canBuild(s: GameState, p: number, b: string, x: number, y: number): boolean {
  const def = BUILDS[b];
  const pl = s.players[p];
  if (!buildAllowedFor(pl.clan, b)) return false;
  const t = tileAt(s, x, y);
  if (def.kind === "monument") {
    const task = Object.keys(MONUMENTS).find((k) => MONUMENTS[k] === b)!;
    if (!pl.tasks.includes(task) || pl.monuments.includes(b)) return false;
  } else if (!pl.techs.includes(def.tech)) return false;
  if (pl.stars < def.cost) return false;
  if (t.cityId !== null || t.village || t.ruin || t.lighthouse) return false;
  if (def.kind === "embassy") return false; // embassies are built inside cities, see legalActions
  const own = ownTile(s, p, x, y);
  // roads and bridges may also go on neutral land (§4.4)
  if (def.kind === "road") {
    const o = territoryOwner(s, t);
    return (o === null || o === p) && !t.road && !t.building && def.terrain.includes(t.terrain as never);
  }
  if (def.kind === "bridge") {
    const o = territoryOwner(s, t);
    if (!(o === null || o === p) || t.terrain !== "water" || t.building) return false;
    const land = (dx: number, dy: number) => {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= s.mapSize || yy >= s.mapSize) return false;
      return !isWater(tileAt(s, xx, yy));
    };
    return (land(0, -1) && land(0, 1)) || (land(-1, 0) && land(1, 0));
  }
  if (!own) return false;
  if (def.kind === "destroy") return t.building !== null;
  if (t.building) return false;
  if (!def.terrain.includes(t.terrain as never)) return false;
  if (def.resource && t.resource !== def.resource) return false;
  if (def.kind === "harvest" && def.resource === undefined && t.resource && b !== "growForest" && b !== "clearForest" && b !== "burnForest") return false;
  if (def.kind === "building" && !def.resource && t.resource && b !== "lumberHut" && b !== "forge" && b !== "port") {
    // windmill/sawmill/market on an empty field only
    return false;
  }
  if (b === "lumberHut" && t.resource) return false;
  if (b === "port" && t.resource) return false;
  if (def.nextTo) {
    const ok = around(s.mapSize, { x, y }, 1).some((q) => {
      const n = tileAt(s, q.x, q.y);
      return n.building !== null && def.nextTo!.includes(n.building) && ownTile(s, p, q.x, q.y);
    });
    if (!ok) return false;
  }
  if (def.onePerCity) {
    const terr = t.territory;
    if (s.tiles.some((o) => o.territory === terr && o.building === b)) return false;
  }
  return true;
}

/* ---------- legal actions ---------- */

export function legalActions(s: GameState): Action[] {
  if (s.over) return [];
  const p = s.current;
  const pl = s.players[p];
  const pending = pendingReward(s);
  if (pending) {
    return pending.options.map((reward) => ({ type: "reward", cityId: pending.city.id, reward }));
  }
  const out: Action[] = [{ type: "endTurn" }];

  for (const t of TECHS) {
    if (canResearch(s, p, t.id) && pl.stars >= techCost(s, p, t.id)) out.push({ type: "research", tech: t.id });
  }

  for (const c of citiesOf(s, p)) {
    if (occupant(s, c.x, c.y)) continue;
    if (unitsHomedIn(s, c) >= unitCapacity(c)) continue;
    for (const def of trainableUnitsFor(pl.clan)) {
      if (def.tech && !pl.techs.includes(def.tech)) continue;
      if (pl.stars < def.cost) continue;
      out.push({ type: "train", cityId: c.id, unit: def.id });
    }
  }

  // tile builds: every tile in own territory, plus neutral tiles for roads/bridges
  const n = s.mapSize;
  for (let i = 0; i < s.tiles.length; i++) {
    if (pl.explored[i] !== 1) continue;
    const x = i % n;
    const y = Math.floor(i / n);
    const o = territoryOwner(s, s.tiles[i]);
    if (o !== null && o !== p) continue;
    for (const b of Object.keys(BUILDS)) {
      const def = BUILDS[b];
      if (o === null && def.kind !== "road" && def.kind !== "bridge") continue;
      if (canBuild(s, p, b, x, y)) out.push({ type: "build", at: { x, y }, building: b });
    }
  }
  // embassies: inside a met tribe's original capital (§5.5)
  if (pl.techs.includes("diplomacy") && pl.stars >= BUILDS.embassy.cost) {
    for (const c of s.cities) {
      if (c.originalCapitalOf === null || c.owner === p || c.originalCapitalOf !== c.owner) continue;
      if (!pl.met.includes(c.owner) || pl.embassies.includes(c.owner)) continue;
      out.push({ type: "build", at: { x: c.x, y: c.y }, building: "embassy" });
    }
  }

  for (const u of s.units) {
    if (u.owner !== p) continue;
    if (u.canMove && !u.done) {
      for (const m of reachable(s, u)) out.push({ type: "move", unitId: u.id, to: { x: m.x, y: m.y } });
    }
    if (!u.done) for (const t of attackTargets(s, u)) out.push({ type: "attack", unitId: u.id, targetId: t.id });
    const fresh = !u.done && !u.moved && !u.attacked;
    const tile = tileAt(s, u.x, u.y);
    if (fresh) {
      if (tile.village || (tile.cityId !== null && cityById(s, tile.cityId)!.owner !== p)) {
        out.push({ type: "capture", unitId: u.id });
      }
      if (tile.ruin) out.push({ type: "examine", unitId: u.id });
      if (u.hp < u.maxHp || u.poisoned) out.push({ type: "recover", unitId: u.id });
      if (tile.resource === "starfish" && pl.techs.includes("navigation") && !tile.building) {
        out.push({ type: "harvestStarfish", unitId: u.id });
      }
      if (pl.techs.includes("freeSpirit")) out.push({ type: "disband", unitId: u.id });
      if (has(u, "heal")) {
        const hurt = s.units.some(
          (o) => o.owner === p && o !== u && dist(o, u) === 1 && (o.hp < o.maxHp || o.poisoned),
        );
        if (hurt) out.push({ type: "healOthers", unitId: u.id });
      }
      if (has(u, "freezeArea")) {
        const canFreeze = around(s.mapSize, u, 1, true).some((q) => {
          const qt = tileAt(s, q.x, q.y);
          return !qt.ice || s.units.some((e) => e.owner !== p && e.x === q.x && e.y === q.y && !e.frozen);
        });
        if (canFreeze) out.push({ type: "freezeArea", unitId: u.id });
      }
      if (has(u, "boost")) {
        const boostable = s.units.some((o) => o.owner === p && o !== u && dist(o, u) === 1 && !o.boosted);
        if (boostable) out.push({ type: "boost", unitId: u.id });
      }
    }
    if (!u.done && has(u, "explode")) {
      const hasTarget =
        s.units.some((e) => e.owner !== p && dist(e, u) === 1) ||
        (u.type === "raychi" && isWater(tile) && !tile.algae);
      if (hasTarget) out.push({ type: "explode", unitId: u.id });
    }
    for (const c of infiltrateTargets(s, u)) out.push({ type: "infiltrate", unitId: u.id, cityId: c.id });
    if (u.kills >= 3 && !u.veteran && !has(u, "static")) out.push({ type: "promote", unitId: u.id });
    if (u.type === "raft" && ownTile(s, p, u.x, u.y)) {
      for (const b of RAFT_UPGRADES) {
        const def = UNITS[b];
        if (def.tech && pl.techs.includes(def.tech) && pl.stars >= def.cost) {
          out.push({ type: "upgrade", unitId: u.id, to: b });
        }
      }
    }
  }
  return out;
}

/* ---------- apply ---------- */

export function applyAction(prev: GameState, a: Action): GameState {
  const s = cloneState(prev);
  const p = s.current;
  const pl = s.players[p];
  switch (a.type) {
    case "endTurn":
      endTurn(s);
      return s;
    case "research": {
      pl.stars -= techCost(s, p, a.tech);
      pl.techs.push(a.tech);
      log(s, `researched ${a.tech}`);
      break;
    }
    case "train": {
      const c = cityById(s, a.cityId)!;
      const def = UNITS[a.unit];
      pl.stars -= def.cost;
      const nu = makeUnit(s, a.unit, p, c, c.id);
      explore(s, p, nu, sightRadius(s, nu));
      break;
    }
    case "build":
      doBuild(s, p, a.building, a.at);
      break;
    case "move":
      doMove(s, unitById(s, a.unitId)!, a.to);
      break;
    case "attack":
      doAttack(s, unitById(s, a.unitId)!, unitById(s, a.targetId)!);
      break;
    case "capture":
      doCapture(s, unitById(s, a.unitId)!);
      break;
    case "recover": {
      const u = unitById(s, a.unitId)!;
      heal(s, u);
      endUnit(u);
      break;
    }
    case "examine":
      doExamine(s, unitById(s, a.unitId)!);
      break;
    case "disband": {
      const u = unitById(s, a.unitId)!;
      const base = u.carried ? UNITS[u.carried].cost : UNITS[u.type].cost;
      pl.stars += Math.floor(base / 2);
      s.units = s.units.filter((x) => x !== u);
      break;
    }
    case "promote": {
      const u = unitById(s, a.unitId)!;
      u.veteran = true;
      u.maxHp += 5;
      u.hp = u.maxHp;
      break;
    }
    case "healOthers": {
      const u = unitById(s, a.unitId)!;
      for (const o of s.units) {
        if (o.owner === p && o !== u && dist(o, u) === 1) healBy(o, 4);
      }
      endUnit(u);
      break;
    }
    case "harvestStarfish": {
      const u = unitById(s, a.unitId)!;
      tileAt(s, u.x, u.y).resource = null;
      pl.stars += STARFISH_STARS;
      endUnit(u);
      break;
    }
    case "infiltrate":
      doInfiltrate(s, unitById(s, a.unitId)!, cityById(s, a.cityId)!);
      break;
    case "upgrade": {
      const u = unitById(s, a.unitId)!;
      pl.stars -= UNITS[a.to].cost;
      u.type = a.to;
      explore(s, p, u, sightRadius(s, u));
      break;
    }
    case "reward":
      doReward(s, cityById(s, a.cityId)!, a.reward);
      break;
    case "freezeArea": {
      const u = unitById(s, a.unitId)!;
      freezeSurrounding(s, u);
      endUnit(u);
      break;
    }
    case "boost": {
      const u = unitById(s, a.unitId)!;
      for (const o of s.units) {
        if (o.owner === p && o !== u && dist(o, u) === 1) o.boosted = true;
      }
      endUnit(u);
      break;
    }
    case "explode": {
      const u = unitById(s, a.unitId)!;
      doExplode(s, u);
      break;
    }
  }
  for (const u of s.units) if (u.owner === p && actsOn(a, u)) u.idle = false;
  updateConnections(s, p);
  checkMeetings(s);
  checkTasks(s, p);
  checkElimination(s);
  return s;
}

function actsOn(a: Action, u: Unit): boolean {
  return "unitId" in a && a.unitId === u.id;
}

function endUnit(u: Unit) {
  u.done = true;
  u.canMove = false;
  u.canAttack = false;
}

/** any heal: a poisoned unit loses the poison and gains no HP (spec: Poison) */
function healBy(u: Unit, amount: number) {
  if (u.poisoned) {
    u.poisoned = false;
    return;
  }
  u.hp = Math.min(u.maxHp, u.hp + amount);
}

/** Recover: 4 HP in friendly territory, 2 elsewhere */
function heal(s: GameState, u: Unit) {
  healBy(u, ownTile(s, u.owner, u.x, u.y) ? 4 : 2);
}

function endTurn(s: GameState) {
  const p = s.current;
  const pl = s.players[p];
  // thaw frozen units at end of their owner's turn (no automatic heal: only the Recover action heals)
  for (const u of s.units) {
    if (u.owner !== p) continue;
    if (u.frozen) u.frozen = false;
  }
  if (pl.techs.includes("meditation")) pl.pacifistTurns = pl.attackedThisTurn ? 0 : pl.pacifistTurns + 1;
  checkTasks(s, p);
  // next alive player; a new round increments the turn
  let next = p;
  do {
    next = (next + 1) % s.players.length;
    if (next === 0) s.turn += 1;
  } while (!s.players[next].alive && next !== p);
  s.current = next;
  if (s.mode === "perfection" && s.turn > s.maxTurns) {
    s.over = true;
    let best = 0;
    for (const o of s.players) if (o.alive && scoreOf(s, o.id) > scoreOf(s, best)) best = o.id;
    s.winner = best;
    return;
  }
  startTurn(s);
}

/* ---------- moves ---------- */

function doMove(s: GameState, u: Unit, to: Coord) {
  const kind = reachable(s, u).find((m) => m.x === to.x && m.y === to.y)?.kind ?? "normal";
  u.lastDir = { x: Math.sign(to.x - u.x), y: Math.sign(to.y - u.y) };
  // explore the straight-line path's tiles (approximation of "every tile along the path")
  const steps = dist(u, to);
  for (let k = 1; k <= steps; k++) {
    const x = Math.round(u.x + ((to.x - u.x) * k) / steps);
    const y = Math.round(u.y + ((to.y - u.y) * k) / steps);
    explore(s, u.owner, { x, y }, has(u, "scout") ? 2 : 1);
  }
  u.x = to.x;
  u.y = to.y;
  u.moved = true;
  u.canMove = false;
  if (!has(u, "dash")) u.canAttack = false;
  if (has(u, "hide")) u.hidden = true;
  explore(s, u.owner, u, sightRadius(s, u));
  // Stomp also fires when a Juggernaut boards or leaves a port: a Juggernaut landing
  // stomps (with its own stats) before it turns back into a Giant
  const stompsLeaving = kind === "disembark" && has(u, "stomp");
  if (stompsLeaving) stomp(s, u);
  if (kind === "embark") embark(u);
  else if (kind === "disembark") disembark(u);
  if (!stompsLeaving && has(u, "stomp")) stomp(s, u);
  if (has(u, "autoFreeze")) freezeSurrounding(s, u);
  // Cymanti Fungi poisons enemy units stepping onto it
  const destTile = tileAt(s, u.x, u.y);
  if (destTile.building === "fungi" && territoryOwner(s, destTile) !== u.owner) {
    u.poisoned = true;
  }
}

function freezeSurrounding(s: GameState, u: Unit) {
  for (const q of around(s.mapSize, u, 1, true)) {
    const t = tileAt(s, q.x, q.y);
    t.ice = true;
    const occ = occupant(s, q.x, q.y);
    if (occ && occ.owner !== u.owner) occ.frozen = true;
  }
}

function doExplode(s: GameState, u: Unit) {
  const p = u.owner;
  const pos = { x: u.x, y: u.y };
  s.units = s.units.filter((x) => x !== u);
  const t = tileAt(s, pos.x, pos.y);
  if (isWater(t)) t.algae = true;
  for (const e of s.units.slice()) {
    if (e.owner === p || dist(e, pos) !== 1) continue;
    const r = computeDamageRounded(s, u, e);
    damage(s, e, r.damage / 2, u); // half the damage, unrounded (RULES_PARITY)
    if (s.units.includes(e)) e.poisoned = true;
  }
}

function embark(u: Unit) {
  const boat = EMBARK_AS[u.type] ?? "raft";
  u.carried = u.type;
  u.type = boat;
  endUnit(u);
}

function disembark(u: Unit) {
  if (!u.carried) return;
  const wasStomp = u.type === "juggernaut";
  u.type = u.carried;
  u.carried = null;
  endUnit(u);
  void wasStomp;
}

function stomp(s: GameState, u: Unit) {
  for (const e of s.units.slice()) {
    if (e.owner === u.owner || dist(e, u) !== 1) continue;
    const r = computeDamageRounded(s, u, e);
    damage(s, e, r.damage / 2, u); // amount unconfirmed in the spec: half, unrounded, like splash
  }
}

/* ---------- combat ---------- */

function damage(s: GameState, target: Unit, amount: number, by: Unit | null): boolean {
  target.hp -= amount;
  if (target.hp > 0) return false;
  s.units = s.units.filter((x) => x !== target);
  s.players[target.owner].losses += 1;
  if (by) {
    s.players[by.owner].kills += 1;
    if (!has(by, "static") && !has(by, "carry")) by.kills += 1;
  }
  return true;
}

function doAttack(s: GameState, u: Unit, target: Unit) {
  const p = u.owner;
  s.players[p].attackedThisTurn = true;
  u.hidden = false;
  u.lastDir = { x: Math.sign(target.x - u.x), y: Math.sign(target.y - u.y) };
  // embassies between the two are destroyed by any attack (§5.5)
  const q = target.owner;
  s.players[p].embassies = s.players[p].embassies.filter((h) => h !== q);
  s.players[q].embassies = s.players[q].embassies.filter((h) => h !== p);

  if (has(u, "convert")) {
    target.owner = p;
    const cap = capitalOf(s, p) ?? citiesOf(s, p)[0];
    target.homeCity = has(target, "independent") ? null : (cap?.id ?? null);
    target.canMove = false;
    target.canAttack = false;
    target.done = true;
    endUnit(u);
    u.attacked = true;
    return;
  }

  const r = computeDamageRounded(s, u, target);
  const from = { x: target.x, y: target.y };
  const prevPos = { x: u.x, y: u.y };
  const killed = damage(s, target, r.damage, u);
  // special on-hit effects: freeze (Ice Archer) & poison (Phychi, Exida, Kiton)
  if (!killed && has(u, "freeze")) target.frozen = true;
  if (!killed && has(u, "poison")) target.poisoned = true;
  // splash: half damage, unrounded (.5 possible), to enemies adjacent to the target
  if (has(u, "splash")) {
    for (const e of s.units.slice()) {
      if (e.owner === p || dist(e, from) !== 1 || e === u) continue;
      const sr = computeDamageRounded(s, u, e);
      damage(s, e, sr.damage / 2, u);
      if (s.units.includes(e) && has(u, "poison")) e.poisoned = true;
    }
  }
  if (!killed) {
    const retaliates =
      !target.frozen &&
      !has(u, "surprise") &&
      !has(target, "stiff") &&
      dist(u, target) <= UNITS[target.type].range &&
      s.players[target.owner].explored[idx(s.mapSize, u.x, u.y)] === 1 &&
      r.retaliation > 0;
    if (retaliates) {
      damage(s, u, r.retaliation, target);
      if (s.units.includes(u) && has(target, "poison")) u.poisoned = true;
    }
  }
  u.attacked = true;
  const alive = s.units.includes(u);
  if (!alive) return;
  u.canAttack = false;
  // Escape: may move again after attacking, also after moving first (move, attack, move)
  u.canMove = has(u, "escape") && !u.frozen;
  // melee advance into the killed unit's tile (§3.4)
  if (killed && UNITS[u.type].range < 2 && !occupant(s, from.x, from.y)) {
    const kind = enterKind(s, u, tileAt(s, from.x, from.y));
    if (kind === "normal" || kind === "embark") {
      u.x = from.x;
      u.y = from.y;
      explore(s, p, u, sightRadius(s, u));
      if (kind === "embark") embark(u);
      // Cymanti Centipede eat: spawns a Segment behind it on kill
      if (has(u, "eat") && !occupant(s, prevPos.x, prevPos.y)) {
        makeUnit(s, "segment", p, prevPos, null);
      }
    }
  }
  if (killed && has(u, "persist") && attackTargets(s, { ...u, canAttack: true }).length) u.canAttack = true;
}

/* ---------- capture, ruins, infiltration ---------- */

function doCapture(s: GameState, u: Unit) {
  const p = u.owner;
  const t = tileAt(s, u.x, u.y);
  u.hidden = false;
  if (t.village) {
    const c = newCity(s, u, p);
    claimTerritory(s, c, 1);
    explore(s, p, c, 1);
    if (!has(u, "independent")) u.homeCity = c.id;
    log(s, `captured village -> ${c.name}`);
  } else {
    const c = cityById(s, t.cityId);
    if (!c) {
      endUnit(u);
      return;
    }
    const old = c.owner;
    c.owner = p;
    c.capital = false;
    c.connected = false;
    c.pendingRewards = [];
    for (const o of s.units) if (o.owner === old && o.homeCity === c.id) o.homeCity = null;
    // reveal the whole old territory
    s.tiles.forEach((tt, i) => {
      if (tt.territory === c.id) explore(s, p, { x: i % s.mapSize, y: Math.floor(i / s.mapSize) }, 0);
    });
    // embassies in a captured original capital are destroyed
    if (c.originalCapitalOf !== null) {
      for (const o of s.players) o.embassies = o.embassies.filter((h) => h !== c.originalCapitalOf);
    }
    if (!has(u, "independent")) u.homeCity = c.id;
    updateConnections(s, old);
    log(s, `captured ${c.name} from player ${old}`);
  }
  endUnit(u);
}

function doExamine(s: GameState, u: Unit) {
  const p = u.owner;
  const pl = s.players[p];
  const t = tileAt(s, u.x, u.y);
  t.ruin = false;
  u.hidden = false;
  endUnit(u);
  const options: string[] = ["resources", "newFriends"];
  const researchable = TECHS.filter((x) => canResearch(s, p, x.id) && (x.tier === 1 || (x.parent && pl.techs.includes(x.parent))));
  if (researchable.length) options.push("scroll");
  if (capitalOf(s, p)) options.push("population");
  const fogNear = around(s.mapSize, u, 2).some((q) => pl.explored[idx(s.mapSize, q.x, q.y)] !== 1);
  if (t.terrain !== "mountain" && fogNear) options.push("explorer");
  const pick = withRng(s, (r) => r.pick(options));
  switch (pick) {
    case "resources":
      pl.stars += RUIN_STARS;
      break;
    case "scroll": {
      const tech = withRng(s, (r) => r.pick(researchable));
      pl.techs.push(tech.id);
      break;
    }
    case "population":
      addPop(s, capitalOf(s, p)!, 3);
      break;
    case "explorer":
      runExplorer(s, p, u);
      break;
    case "newFriends": {
      const water = isWater(t);
      pushUnit(s, u, p);
      const nu = makeUnit(s, water ? "rammer" : "swordsman", p, { x: t === tileAt(s, u.x, u.y) ? u.x : u.x, y: u.y }, null);
      // spawn on the ruin tile itself
      const ruinIdx = s.tiles.indexOf(t);
      nu.x = ruinIdx % s.mapSize;
      nu.y = Math.floor(ruinIdx / s.mapSize);
      if (water) {
        nu.carried = "warrior";
        nu.hp = 15;
        nu.maxHp = 15;
      } else {
        nu.hp = UNITS.swordsman.hp! + 5;
        nu.maxHp = nu.hp;
      }
      nu.veteran = true;
      explore(s, p, nu, 1);
      break;
    }
  }
  log(s, `ruin: ${pick}`);
}

/**
 * Explorer walker (spec "Explorer"): EXPLORER_STEPS automatic moves into the fog.
 * Each step goes to the neighbour that uncovers the most new tiles (3x3 vision);
 * ties go to the step closest to the nearest lighthouse this player hasn't found.
 * If no neighbour uncovers anything, it steps along a shortest path toward the
 * nearest unexplored tile. Remaining ties are broken by the game RNG.
 */
export function runExplorer(s: GameState, p: number, from: Coord) {
  const pl = s.players[p];
  const n = s.mapSize;
  let cur = { x: from.x, y: from.y };
  const passable = (q: Coord) => {
    const t = tileAt(s, q.x, q.y);
    if (pl.explored[idx(n, q.x, q.y)] !== 1) return true; // may walk into fog
    if (t.terrain === "mountain") return pl.techs.includes("climbing");
    if (t.terrain === "water") return pl.techs.includes("sailing");
    if (t.terrain === "ocean") return pl.techs.includes("navigation");
    return true;
  };
  const uncovers = (q: Coord) =>
    around(n, q, 1, true).filter((c) => pl.explored[idx(n, c.x, c.y)] !== 1).length;
  const lighthouseDist = (q: Coord) => {
    let best = Infinity;
    s.tiles.forEach((t, i) => {
      if (!t.lighthouse || pl.lighthouses.includes(i)) return;
      best = Math.min(best, dist(q, { x: i % n, y: Math.floor(i / n) }));
    });
    return best;
  };
  /** BFS distance (steps over passable tiles) from every tile to the nearest unexplored tile */
  const fogDistance = () => {
    const d = new Array<number>(n * n).fill(Infinity);
    const queue: number[] = [];
    for (let i = 0; i < n * n; i++) {
      if (pl.explored[i] !== 1) {
        d[i] = 0;
        queue.push(i);
      }
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h];
      for (const q of around(n, { x: i % n, y: Math.floor(i / n) }, 1)) {
        const j = idx(n, q.x, q.y);
        if (d[j] !== Infinity || !passable(q)) continue;
        d[j] = d[i] + 1;
        queue.push(j);
      }
    }
    return d;
  };
  const lowest = (cands: { q: Coord; key: number }[]) => {
    const top = Math.min(...cands.map((c) => c.key));
    return cands.filter((c) => c.key === top).map((c) => c.q);
  };
  explore(s, p, cur, 1);
  for (let step = 0; step < EXPLORER_STEPS; step++) {
    const options = around(n, cur, 1).filter(passable);
    if (!options.length) break;
    let cands: Coord[];
    const gains = options.map((q) => ({ q, key: -uncovers(q) }));
    if (Math.min(...gains.map((g) => g.key)) < 0) {
      cands = lowest(gains);
    } else {
      const d = fogDistance();
      const near = options.map((q) => ({ q, key: d[idx(n, q.x, q.y)] }));
      if (near.every((c) => c.key === Infinity)) break;
      cands = lowest(near);
    }
    if (cands.length > 1) cands = lowest(cands.map((q) => ({ q, key: lighthouseDist(q) })));
    const choice = cands.length === 1 ? cands[0] : withRng(s, (r) => r.pick(cands));
    cur = choice;
    explore(s, p, cur, 1);
  }
}

function doInfiltrate(s: GameState, u: Unit, c: City) {
  const p = u.owner;
  s.units = s.units.filter((x) => x !== u);
  const occ = occupant(s, c.x, c.y);
  if (occ && occ.owner !== p) {
    const dagger = { ...u, type: "dagger", hp: 10, maxHp: 10 };
    const r = computeDamageRounded(s, dagger, occ);
    damage(s, occ, r.damage, null);
  }
  const owner = c.owner;
  const stolen = c.capital ? c.level + 1 : c.level;
  s.players[p].stars += stolen + (c.workshop ? 1 : 0) + c.parks;
  c.riot = true;
  void owner;
  const count = Math.min(c.level, 5);
  const spots = s.tiles
    .map((t, i) => ({ t, x: i % s.mapSize, y: Math.floor(i / s.mapSize) }))
    .filter(({ t }) => t.territory === c.id)
    .sort((a, b) => {
      const sc = (o: { t: typeof a.t; x: number; y: number }) =>
        (o.x === c.x && o.y === c.y ? 100 : 0) + (isWater(o.t) ? 0 : 10) + (o.t.resource ? 1 : 0);
      return sc(b) - sc(a);
    });
  let made = 0;
  for (const sp of spots) {
    if (made >= count) break;
    if (occupant(s, sp.x, sp.y)) continue;
    const nu = makeUnit(s, isWater(sp.t) ? "pirate" : "dagger", p, sp, null);
    if (isWater(sp.t)) nu.carried = "dagger";
    made++;
  }
  log(s, `infiltrated ${c.name}`);
}

/* ---------- builds ---------- */

function doBuild(s: GameState, p: number, b: string, at: Coord) {
  const pl = s.players[p];
  const def = BUILDS[b];
  const t = tileAt(s, at.x, at.y);
  pl.stars -= def.cost;
  if (def.gain) pl.stars += def.gain;
  const city = cityById(s, t.territory);
  switch (def.kind) {
    case "harvest":
      if (b === "enchantAnimal") {
        t.resource = null;
        const occ = occupant(s, at.x, at.y);
        if (occ) pushUnit(s, occ, p);
        const poly = makeUnit(s, "polytaur", p, at, null);
        explore(s, p, poly, 1);
        break;
      }
      if (b === "clearForest") t.terrain = "field";
      else if (b === "burnForest") {
        t.terrain = "field";
        t.resource = "crop";
        break;
      } else if (b === "growForest") {
        t.terrain = "forest";
        t.resource = null;
        break;
      }
      if (def.resource) t.resource = null;
      if (city && def.pop) addPop(s, city, def.pop);
      if (b === "clearForest") t.resource = null;
      break;
    case "road":
      t.road = true;
      break;
    case "bridge":
      t.building = "bridge";
      break;
    case "embassy":
      pl.embassies.push(cityById(s, t.cityId)!.owner);
      explore(s, p, at, 1);
      break;
    case "destroy": {
      const old = t.building!;
      if (city) {
        const lost = (BUILDS[old]?.pop ?? 0) + (FEEDS[old] ? 0 : levelPop(old, t.buildingLevel));
        city.pop -= lost;
      }
      unfeed(s, p, at, old);
      t.building = null;
      t.buildingLevel = 0;
      break;
    }
    default: {
      t.building = b;
      t.builtTurn = s.turn;
      if (def.kind === "monument") pl.monuments.push(b);
      if (city && def.pop) addPop(s, city, def.pop);
      // leveling buildings (§5.5)
      const levelKind = Object.values(FEEDS).find((f) => f.building === b);
      if (levelKind) {
        const feeder = Object.keys(FEEDS).find((k) => FEEDS[k].building === b)!;
        const lvl = Math.min(
          LEVEL_CAP,
          around(s.mapSize, at, 1).filter(
            (q) => tileAt(s, q.x, q.y).building === feeder && ownTile(s, p, q.x, q.y),
          ).length,
        );
        t.buildingLevel = lvl;
        if (city) addPop(s, city, lvl * levelKind.popPerLevel);
      }
      if (FEEDS[b]) feed(s, p, at, b, +1);
    }
  }
}

function levelPop(building: string, level: number): number {
  const f = Object.values(FEEDS).find((x) => x.building === building);
  return f ? f.popPerLevel * level : 0;
}

/** a feeder (farm/lumber hut/mine) was built or removed: adjust adjacent leveling buildings */
function feed(s: GameState, p: number, at: Coord, feeder: string, delta: number) {
  const f = FEEDS[feeder];
  for (const q of around(s.mapSize, at, 1)) {
    const n = tileAt(s, q.x, q.y);
    if (n.building !== f.building || !ownTile(s, p, q.x, q.y)) continue;
    const before = n.buildingLevel;
    n.buildingLevel = Math.max(0, Math.min(LEVEL_CAP, before + delta));
    const gained = (n.buildingLevel - before) * f.popPerLevel;
    const c = cityById(s, n.territory);
    if (c && gained) {
      if (gained > 0) addPop(s, c, gained);
      else c.pop += gained;
    }
  }
}

function unfeed(s: GameState, p: number, at: Coord, old: string) {
  if (FEEDS[old]) feed(s, p, at, old, -1);
}

/* ---------- rewards ---------- */

function doReward(s: GameState, c: City, reward: string) {
  const p = c.owner;
  c.pendingRewards.shift();
  switch (reward) {
    case "workshop":
      c.workshop = true;
      break;
    case "explorer":
      runExplorer(s, p, c);
      break;
    case "cityWall":
      c.walls = true;
      break;
    case "resources":
      s.players[p].stars += 5;
      break;
    case "populationGrowth":
      addPop(s, c, 3);
      break;
    case "borderGrowth":
      claimTerritory(s, c, 2);
      explore(s, p, c, 2);
      break;
    case "park":
      c.parks += 1;
      break;
    case "superUnit": {
      const occ = occupant(s, c.x, c.y);
      if (occ) pushUnit(s, occ, p);
      const su = superUnitFor(s.players[p].clan);
      const g = makeUnit(s, su, p, c, c.id);
      explore(s, p, g, 1);
      break;
    }
  }
}

export { TECH_BY_ID };
