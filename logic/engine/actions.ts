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
  embassyCost,
  TECH_BY_ID,
  UNITS,
  buildAllowedFor,
  superUnitFor,
  trainableUnitsFor,
} from "./data";
import { around, cloneState, dist, idx, isWater, tileAt } from "./grid";
import { computeDamageRounded, halfDamage } from "./combat";
import {
  canSee,
  chainBody,
  enterKind,
  type StepKind,
  followerOf,
  has,
  isLed,
  pathTo,
  reachable,
  sightRadius,
  territoryOwner,
} from "./movement";
import {
  atPeace,
  canHarm,
  dipMut,
  friendly,
  hasOffer,
  makePeace,
  ordinal,
  recordAttack,
} from "./diplomacy";
import {
  addPop,
  canResearch,
  capitalOf,
  checkElimination,
  checkGameEnd,
  checkMeetings,
  checkTasks,
  cityById,
  citiesOf,
  claimTerritory,
  explore,
  log,
  makeUnit,
  meet,
  newCity,
  pendingReward,
  pushUnit,
  startTurn,
  techCost,
  unitCapacity,
  unitsHomedIn,
  updateConnections,
  withRng,
  growUnits,
} from "./state";
import type { Action, City, Coord, GameState, Unit } from "./types";

/* ---------- helpers ---------- */

const unitById = (s: GameState, id: number) => s.units.find((u) => u.id === id);
const occupant = (s: GameState, x: number, y: number) => s.units.find((u) => u.x === x && u.y === y);

/** tile owned (territory) by player p */
function ownTile(s: GameState, p: number, x: number, y: number): boolean {
  return territoryOwner(s, tileAt(s, x, y)) === p;
}

/** tile in p's own or a peace partner's territory */
function friendlyTile(s: GameState, p: number, x: number, y: number): boolean {
  return friendly(s, p, territoryOwner(s, tileAt(s, x, y)));
}

function attackTargets(s: GameState, u: Unit): Unit[] {
  const def = UNITS[u.type];
  if (!u.canAttack || def.range === 0) return [];
  // a unit led in a chain (Centipede segment) has no attack options (S1 combat::attack_options)
  if (isLed(u)) return [];
  if (def.attack === 0 && !has(u, "convert")) return [];
  // Infiltrate units (Cloak, Dinghy, Scuba, Moth) only target cities (game data: their attack is never used on units)
  if (has(u, "infiltrate")) return [];
  // no attacks (or conversions) on peace partners, nor either way during a cease-fire
  return s.units.filter(
    (t) =>
      canHarm(s, u.owner, t.owner) &&
      dist(u, t) <= def.range &&
      canSee(s, u.owner, t),
  );
}

function infiltrateTargets(s: GameState, u: Unit): City[] {
  // (S1 combat::attacks_into) not after attacking, nor after moving without Dash: a Cloak (Dash) may
  // move and then infiltrate in the same turn, hidden or not
  if (!has(u, "infiltrate") || u.done || u.attacked || u.frozen || (u.moved && !has(u, "dash"))) return [];
  return s.cities.filter(
    (c) =>
      canHarm(s, u.owner, c.owner) &&
      dist(u, c) === 1 &&
      !c.riot &&
      !s.units.some((o) => o.x === c.x && o.y === c.y && o.owner !== c.owner),
  );
}

/** a unit p can see stands on (x,y) and belongs to a tribe not at peace with p */
function blockedByEnemy(s: GameState, p: number, x: number, y: number): boolean {
  const occ = occupant(s, x, y);
  return !!occ && occ.owner !== p && canSee(s, p, occ) && !atPeace(s, p, occ.owner);
}

/** can p build `b` on tile (x,y)? */
function canBuild(s: GameState, p: number, b: string, x: number, y: number): boolean {
  const def = BUILDS[b];
  const pl = s.players[p];
  if (!buildAllowedFor(pl.clan, b)) return false;
  const t = tileAt(s, x, y);
  if (def.kind === "monument") {
    const earned = Object.keys(MONUMENTS).some((k) => MONUMENTS[k] === b && pl.tasks.includes(k));
    if (!earned || pl.monuments.includes(b)) return false;
  } else if (!pl.techs.includes(def.tech)) return false;
  // tribe tech swaps: Polaris fish with Ice Fishing (ramming); Cymanti Mountain Temple with Mysticism (philosophy)
  if (b === "fish" && pl.clan === "polaris" && !pl.techs.includes("ramming")) return false;
  if (b === "mountainTemple" && pl.clan === "cymanti" && !pl.techs.includes("philosophy")) return false;
  if (pl.stars < def.cost) return false;
  // Canal: built by an own unit standing on the tile, which can still attack and has not moved;
  // any territory (freelance + manual), even over a building or city (discrete); not on a flooded tile
  if (b === "canal") {
    const u = occupant(s, x, y);
    if (!u || u.owner !== p || u.done || u.moved || !u.canAttack || u.frozen) return false;
    return !isWater(t) && !t.flooded && (t.terrain === "field" || t.terrain === "forest");
  }
  // (S1 menu::can_build) no build on a tile holding a visible unit of a tribe not at peace
  if (blockedByEnemy(s, p, x, y)) return false;
  // roads and bridges may also go on neutral land (§4.4). A road is refused only by a road, a
  // city or village, or a bridge (S1 menu::can_build): farms, huts, other buildings and ruins take one
  if (def.kind === "road") {
    const o = territoryOwner(s, t);
    if (t.road || t.cityId !== null || t.village || t.building === "bridge") return false;
    return (o === null || o === p) && def.terrain.includes(t.terrain as never);
  }
  if (t.cityId !== null || t.village || t.ruin || t.lighthouse) return false;
  if (def.kind === "embassy") return false; // embassies are built inside cities, see legalActions
  const own = ownTile(s, p, x, y);
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
  // 2.18 "wetland" terrain: a flooded tile or algae water, never a forest (S1 can_build)
  const wetland = (!!t.flooded || !!t.algae) && t.terrain !== "forest";
  // Fertilize: a crop on wetland that has none (it replaces another resource there)
  if (b === "fertilize") return wetland && !t.building && t.resource !== "crop";
  if (b === "port" && t.flooded && !isWater(t)) return t.terrain !== "mountain" && !t.building && !t.resource;
  // Destroy: not a bridge with any unit on it (S1 menu::improvement_abilities_into)
  if (def.kind === "destroy") return t.building !== null && !(t.building === "bridge" && occupant(s, x, y));
  // Cymanti Algae: open water without algae (it may sit on a building: discrete)
  if (b === "algae") return isWater(t) && !t.ice && !t.algae && t.resource !== "fruit";
  if (t.building) return false;
  // Atoll on wetland; Mycelium on wetland; Ice Bank on ice (Polaris)
  const extraTerrain =
    ((b === "atoll" || b === "mycelium") && wetland) ||
    // Aquarion Pontoon (Aquabase): field buildings may stand on water (not roads, temples, canals, Grow Forest)
    (pl.clan === "aquarion" && isWater(t) && !t.ice && ["windmill", "sawmill", "forge", "market"].includes(b));
  if (!extraTerrain && !def.terrain.includes(t.terrain as never)) return false;
  if (b === "iceBank" && isWater(t) && !t.ice) return false;
  if ((b === "atoll" || b === "aquaFarm") && t.ice) return false;
  if (b === "iceBank" && (pl.builtUnique ?? []).includes(b)) return false;
  if (def.nextToTerrain) {
    const ok = around(s.mapSize, { x, y }, 1).some(
      (q) => tileAt(s, q.x, q.y).terrain === def.nextToTerrain && ownTile(s, p, q.x, q.y),
    );
    if (!ok) return false;
  }
  if (def.resource && t.resource !== def.resource) return false;
  // 2.18: a building that needs no resource may stand on an unharvested one (the resource stays
  // underneath, hidden, and can't be harvested while the building stands)
  // Polaris: Outpost and Ice Temple stand on ice; one Ice Bank per tribe
  if ((b === "outpost" || b === "iceTemple") && !t.ice) return false;
  if (b === "iceBank" && s.tiles.some((o) => o.building === "iceBank" && territoryOwner(s, o) === p)) return false;
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
      // Raychi: only from cities next to (open) water
      if (def.id === "raychi" && !around(s.mapSize, c, 1).some((q) => isWater(tileAt(s, q.x, q.y)) && !tileAt(s, q.x, q.y).ice)) continue;
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
      if (b === "canal") continue; // unit-built, listed with the units below
      if (o === null && def.kind !== "road" && def.kind !== "bridge") continue;
      if (canBuild(s, p, b, x, y)) out.push({ type: "build", at: { x, y }, building: b });
    }
    // Cymanti Decompose (Recycling): an own building not decomposing yet, with no enemy unit on it
    const t = s.tiles[i];
    if (o === p && t.building && !t.decomposing && pl.clan === "cymanti" && pl.techs.includes("construction")) {
      const occ = occupant(s, x, y);
      const blocked = occ && occ.owner !== p && canSee(s, p, occ) && !atPeace(s, p, occ.owner);
      if (!blocked && !(t.building === "bridge" && occ)) out.push({ type: "decompose", at: { x, y } });
    }
  }
  // embassies (2.18): inside a met tribe's original capital that it still holds; peace not needed,
  // war doesn't block it (an embassy pays nothing during war); 4★ + 2★ per embassy already built
  if (pl.techs.includes("diplomacy") && pl.stars >= embassyCost(pl.embassies.length)) {
    for (const c of s.cities) {
      if (c.originalCapitalOf === null || c.owner === p || c.originalCapitalOf !== c.owner) continue;
      if (!pl.met.includes(c.owner) || pl.embassies.includes(c.owner)) continue;
      out.push({ type: "build", at: { x: c.x, y: c.y }, building: "embassy" });
    }
  }

  // diplomacy (rules doc, Peace treaty): answer offers, offer peace (sender needs Strategy), break peace
  for (const q of s.players) {
    if (q.id === p || !q.alive) continue;
    if (hasOffer(s, q.id, p)) {
      out.push({ type: "acceptPeace", player: q.id }, { type: "declinePeace", player: q.id });
    } else if (atPeace(s, p, q.id)) {
      out.push({ type: "breakPeace", player: q.id });
    } else if (pl.techs.includes("strategy") && pl.met.includes(q.id) && !hasOffer(s, p, q.id)) {
      out.push({ type: "offerPeace", player: q.id });
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
    // a unit led in a chain (Centipede segment) can't capture, examine, recover or disband (S1 menu)
    const leads = !isLed(u);
    if (fresh) {
      const cityOwner = tile.cityId !== null ? cityById(s, tile.cityId)!.owner : null;
      // no capturing from a peace partner
      if (leads && (tile.village || (cityOwner !== null && cityOwner !== p && !atPeace(s, p, cityOwner)))) {
        out.push({ type: "capture", unitId: u.id });
      }
      if (leads && tile.ruin) out.push({ type: "examine", unitId: u.id });
      if (leads && (u.hp < u.maxHp || u.poisoned)) out.push({ type: "recover", unitId: u.id });
      if (tile.resource === "starfish" && pl.techs.includes("navigation") && !tile.building) {
        out.push({ type: "harvestStarfish", unitId: u.id });
      }
      if (leads && pl.techs.includes("freeSpirit")) out.push({ type: "disband", unitId: u.id });
      if (has(u, "heal")) {
        const hurt = s.units.some(
          (o) => o.owner === p && o !== u && dist(o, u) === 1 && (o.hp < o.maxHp || o.poisoned),
        );
        if (hurt) out.push({ type: "healOthers", unitId: u.id });
      }
      if (has(u, "freezeArea") && around(s.mapSize, u, 1, true).some((q) => freezable(s, p, q))) {
        out.push({ type: "freezeArea", unitId: u.id });
      }
    }
    // Swarm (S1 menu, cymanti.rs swarm options): the Shaman only needs to be able to move, with an own
    // neighbour that is not Swift yet and not led in a chain
    if (has(u, "swarm") && u.canMove && !u.done && !u.frozen && swarmTargets(s, u).length) {
      out.push({ type: "swarm", unitId: u.id });
    }
    // Explode (S1 cymanti::can_explode): any time, with or without a target, except on the turn the
    // unit was created (a Centipede segment may even then) or while frozen
    if (has(u, "explode") && !u.frozen && (u.createdTurn !== s.turn || isLed(u))) {
      out.push({ type: "explode", unitId: u.id });
    }
    for (const c of infiltrateTargets(s, u)) out.push({ type: "infiltrate", unitId: u.id, cityId: c.id });
    // Break Ice (S1 polaris::can_break_ice): any unit, Polaris included, not led in a chain, that has
    // not attacked (nor moved, unless it dashes), without Auto Freeze, next to breakable ice
    if (
      !u.done && !u.frozen && leads && !u.attacked && (!u.moved || has(u, "dash")) && !has(u, "autoFreeze") &&
      around(s.mapSize, u, 1).some((q) => breakableIce(s, q, p))
    ) {
      out.push({ type: "breakIce", unitId: u.id });
    }
    // Canal (Waterways): built by this unit on its own tile
    if (canBuild(s, p, "canal", u.x, u.y)) out.push({ type: "build", at: { x: u.x, y: u.y }, building: "canal" });
    // 2.18 Clear Tile Effect ("drain", S1 clear_options): Algae, for a unit that can move or attack and
    // swims, flies or is amphibious; Flooded, for a unit that can move and attack, of a tribe that does not
    // flood (not Aquarion), that is amphibious or does not swim. Free; the unit is spent.
    if (!u.done && !u.frozen) {
      const swims = UNITS[u.type].naval || has(u, "water");
      if (tile.algae && (u.canMove || u.canAttack) && (has(u, "amphibious") || swims || has(u, "fly"))) {
        out.push({ type: "drain", unitId: u.id, effect: "algae" });
      }
      if (
        tile.flooded && !isWater(tile) && u.canMove && u.canAttack && pl.clan !== "aquarion" &&
        (has(u, "amphibious") || !swims)
      ) {
        out.push({ type: "drain", unitId: u.id, effect: "flooded" });
      }
    }
    if (u.kills >= 3 && !u.veteran && !has(u, "static")) out.push({ type: "promote", unitId: u.id });
    // upgrades only in own or an ally's territory
    if (u.type === "raft" && friendlyTile(s, p, u.x, u.y)) {
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
      // a trained Jelly strikes its neighbours at once (S1 units::train: area damage)
      if (has(nu, "tentacles")) areaDamage(s, nu);
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
      // a Centipede's body goes with it, each part paid (S1 step disband: the follower goes too)
      const u = unitById(s, a.unitId)!;
      const gone = [u, ...chainBody(s, u.id)];
      // each part pays half of its boat + passenger cost, rounded down, only when that total is
      // above 1 (S1 step::disband)
      for (const o of gone) {
        const total = UNITS[o.type].cost + (o.carried ? UNITS[o.carried].cost : 0);
        if (total > 1) pl.stars += Math.floor(total / 2);
      }
      s.units = s.units.filter((x) => !gone.includes(x));
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
      u.hidden = false; // harvesting reveals a Cloak
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
      freezeArea(s, u);
      endUnit(u);
      break;
    }
    case "breakIce": {
      const u = unitById(s, a.unitId)!;
      u.hidden = false;
      endUnit(u);
      u.moved = true;
      u.attacked = true;
      breakIceArea(s, u, p);
      break;
    }
    case "drain": {
      const u = unitById(s, a.unitId)!;
      const t = tileAt(s, u.x, u.y);
      if (a.effect === "algae") t.algae = false;
      else t.flooded = false;
      u.hidden = false;
      endUnit(u);
      u.moved = true;
      u.attacked = true;
      break;
    }
    case "decompose":
      tileAt(s, a.at.x, a.at.y).decomposing = true;
      break;
    case "swarm": {
      // Swarm: each own neighbour that is not Swift yet and not led in a chain becomes Swift
      const u = unitById(s, a.unitId)!;
      for (const o of swarmTargets(s, u)) o.swarmed = true;
      endUnit(u);
      u.moved = true;
      u.attacked = true;
      break;
    }
    case "explode": {
      const u = unitById(s, a.unitId)!;
      doExplode(s, u);
      break;
    }
    case "offerPeace":
      dipMut(s).offers.push({ from: p, to: a.player });
      log(s, `offered peace to player ${a.player}`);
      break;
    case "acceptPeace":
      makePeace(s, a.player, p);
      log(s, `accepted peace with player ${a.player}`);
      break;
    case "declinePeace": {
      const d = dipMut(s);
      d.offers = d.offers.filter((o) => !(o.from === a.player && o.to === p));
      log(s, `declined peace from player ${a.player}`);
      break;
    }
    case "breakPeace":
      breakPeace(s, p, a.player);
      break;
  }
  for (const u of s.units) if (u.owner === p && (actsOn(a, u) || builtBy(a, u))) u.idle = false;
  updateConnections(s, p);
  checkMeetings(s);
  checkTasks(s, p);
  checkElimination(s);
  return s;
}

function actsOn(a: Action, u: Unit): boolean {
  return "unitId" in a && a.unitId === u.id;
}

/** a Canal is built by the unit standing on the tile */
function builtBy(a: Action, u: Unit): boolean {
  return a.type === "build" && a.building === "canal" && u.x === a.at.x && u.y === a.at.y;
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

/** Recover: 4 HP in own or a peace partner's territory, 2 elsewhere */
function heal(s: GameState, u: Unit) {
  healBy(u, friendlyTile(s, u.owner, u.x, u.y) ? 4 : 2);
}

/**
 * Breaking peace (rules doc, Peace treaty): every unit of the breaker inside the
 * victim's borders is destroyed with no refund, a cease-fire holds until the
 * breaker's next turn (RULES_PARITY), and the victim remembers it forever.
 */
function breakPeace(s: GameState, breaker: number, victim: number) {
  const d = dipMut(s);
  d.peace = d.peace.filter((x) => !((x[0] === breaker && x[1] === victim) || (x[0] === victim && x[1] === breaker)));
  d.ceasefires = d.ceasefires.filter((c) => ordinal(s) < c.until);
  d.ceasefires.push({ breaker, victim, until: ordinal(s) + s.players.length });
  if (!d.broken.some((b) => b[0] === victim && b[1] === breaker)) d.broken.push([victim, breaker]);
  const lost = s.units.filter((u) => u.owner === breaker && territoryOwner(s, tileAt(s, u.x, u.y)) === victim);
  s.units = s.units.filter((u) => !lost.includes(u));
  // every other unit of the breaker is spent for this turn (S1 step Diplomacy::BreakPeace)
  for (const u of s.units) {
    if (u.owner !== breaker) continue;
    endUnit(u);
    u.moved = true;
    u.attacked = true;
  }
  s.players[breaker].losses += lost.length;
  log(s, `broke peace with player ${victim}`);
}

function endTurn(s: GameState) {
  const p = s.current;
  const pl = s.players[p];
  // automatic heal (2.18; logic follows polybots-engine): every own damaged or poisoned unit that
  // neither moved, attacked nor acted this turn and isn't frozen heals as if it recovered
  // (Centipede segments excepted); then frozen units thaw
  for (const u of s.units) {
    if (u.owner !== p) continue;
    const idle = !u.done && !u.moved && !u.attacked && !u.frozen && u.bodyOf === undefined;
    if (idle && (u.hp < u.maxHp || u.poisoned)) heal(s, u);
    if (u.frozen) u.frozen = false;
  }
  growUnits(s, p);
  improvementUpkeep(s, p);
  // Pacifist (S1 attack::reset_peace, turns::end_turn): an attack this turn reset the count to 0,
  // then every end of turn adds 1
  if (pl.techs.includes("meditation")) pl.pacifistTurns = (pl.attackedThisTurn ? 0 : pl.pacifistTurns) + 1;
  checkTasks(s, p);
  // offers this player did not answer on its turn lapse (count as declined)
  if (s.diplomacy) s.diplomacy.offers = s.diplomacy.offers.filter((o) => o.to !== p);
  // next alive player; a new round increments the turn
  let next = p;
  do {
    next = (next + 1) % s.players.length;
    if (next === 0) s.turn += 1;
  } while (!s.players[next].alive && next !== p);
  s.current = next;
  checkGameEnd(s, true);
  if (s.over) return;
  startTurn(s);
}

/**
 * End-of-turn upkeep of p's own buildings (S1 cymanti::improvement_upkeep): a Mycelium heals 4 HP
 * to p's unit on it and p's units next to it (a poisoned unit is cured instead); a decomposing
 * building pays back its full cost and is removed (not a bridge with a unit on it).
 */
function improvementUpkeep(s: GameState, p: number) {
  const n = s.mapSize;
  s.tiles.forEach((t, i) => {
    if (!t.building || territoryOwner(s, t) !== p) return;
    const at = { x: i % n, y: Math.floor(i / n) };
    if (t.building === "mycelium") {
      for (const u of s.units) if (u.owner === p && dist(u, at) <= 1) healBy(u, 4);
    }
    if (t.decomposing && !(t.building === "bridge" && occupant(s, at.x, at.y))) {
      s.players[p].stars += BUILDS[t.building]?.cost ?? 0;
      removeBuilding(s, p, at);
    }
  });
}

/**
 * Remove the building on `at` (Decompose): its city loses the population it gave, a building that
 * needs a resource gives it back (S1 economy::destroy), and adjacent level buildings drop.
 */
function removeBuilding(s: GameState, p: number, at: Coord) {
  const t = tileAt(s, at.x, at.y);
  const old = t.building!;
  const def = BUILDS[old];
  const city = cityById(s, t.territory);
  if (city) city.pop -= (def?.pop ?? 0) + (FEEDS[old] ? 0 : levelPop(old, t.buildingLevel));
  if (def?.resource) t.resource = def.resource as typeof t.resource;
  t.building = null;
  t.buildingLevel = 0;
  t.decomposing = false;
  unfeed(s, p, at, old);
}

/* ---------- moves ---------- */

/**
 * A hidden enemy the mover could not see on the move's destination (S1 step Command::Move): the move
 * becomes a Reveal. The hidden unit is revealed, the mover stays where it is and its move is not
 * spent. A hidden unit on a tile the path only passes through changes nothing (legalActions plans
 * through hidden units as empty tiles, so it never gives away where they are).
 */
function revealAtDestination(s: GameState, u: Unit, to: Coord): boolean {
  const occ = occupant(s, to.x, to.y);
  if (!occ || occ === u || friendly(s, u.owner, occ.owner) || !occ.hidden || canSee(s, u.owner, occ)) return false;
  occ.hidden = false;
  log(s, `ran into a hidden unit at ${to.x},${to.y}`);
  return true;
}

function doMove(s: GameState, u: Unit, to: Coord) {
  if (revealAtDestination(s, u, to)) return;
  const kind = reachable(s, u).find((m) => m.x === to.x && m.y === to.y)?.kind ?? "normal";
  const origin = { x: u.x, y: u.y };
  u.lastDir = { x: Math.sign(to.x - u.x), y: Math.sign(to.y - u.y) };
  // explore the straight-line path's tiles (approximation of "every tile along the path")
  const steps = dist(u, to);
  for (let k = 0; k <= steps; k++) {
    const x = Math.round(u.x + ((to.x - u.x) * k) / steps);
    const y = Math.round(u.y + ((to.y - u.y) * k) / steps);
    // Algae (Living Island): leaves algae on the water tiles it passes
    if (k < steps && has(u, "algae")) {
      const pt = tileAt(s, x, y);
      if (isWater(pt) && !pt.ice) pt.algae = true;
    }
    if (k > 0) explore(s, u.owner, { x, y }, has(u, "scout") ? 2 : 1);
  }
  u.x = to.x;
  u.y = to.y;
  u.moved = true;
  u.canMove = false;
  if (!has(u, "dash")) u.canAttack = false;
  if (has(u, "hide")) u.hidden = true;
  explore(s, u.owner, u, sightRadius(s, u));
  // Skate: a move ending on land allows no attack (Dash blocked on land)
  if (has(u, "skate") && !isWater(tileAt(s, u.x, u.y))) u.canAttack = false;
  afterMove(s, u, kind, origin);
  // moving onto another tribe's city is an act of war (S1 step::move_action)
  const dest = tileAt(s, to.x, to.y);
  const host = dest.cityId !== null ? cityById(s, dest.cityId)?.owner : undefined;
  if (host !== undefined && host !== u.owner) warAct(s, u.owner, host);
}

/**
 * What a move sets off (S1 step::move_action), for a move command and for the advance into a killed
 * unit's tile alike (not for a push): poison buildings, Bubbles, the Tentacles strike on the mover,
 * Stomp (and a Juggernaut landing), Auto Freeze (a full Freeze Area), a Jelly's own strike on its
 * neighbours and Auto Flood; then the chain: a follower two or more tiles behind steps into the
 * mover's old tile, and so on down the body.
 */
function afterMove(s: GameState, u: Unit, kind: StepKind, origin: Coord) {
  const follower = followerOf(s, u);
  const dest = { x: u.x, y: u.y };
  poisonTile(s, u);
  bubbleAfterMove(s, u);
  tentacleStrike(s, u);
  if (s.units.includes(u)) {
    // Stomp also fires when a Juggernaut boards or leaves a port: a Juggernaut landing
    // stomps (with its own stats) before it turns back into a Giant
    const stompsLeaving = kind === "disembark" && has(u, "stomp");
    if (stompsLeaving) stomp(s, u);
    if (kind === "embark") embark(u);
    else if (kind === "disembark") disembark(u);
    if (!stompsLeaving && has(u, "stomp")) stomp(s, u);
    if (has(u, "autoFreeze")) freezeArea(s, u);
    if (has(u, "tentacles") && !u.frozen) areaDamage(s, u);
    if (has(u, "autoFlood")) floodAt(s, u.owner, u.x, u.y);
  }
  if (follower && s.units.includes(follower) && dist(follower, dest) >= 2) followStep(s, follower, origin);
}

/** a chain member steps into the tile its leader left (S1: a Move with reason command) */
function followStep(s: GameState, f: Unit, to: Coord) {
  if (occupant(s, to.x, to.y)) return;
  const origin = { x: f.x, y: f.y };
  f.lastDir = { x: Math.sign(to.x - f.x), y: Math.sign(to.y - f.y) };
  f.x = to.x;
  f.y = to.y;
  f.moved = true;
  f.canMove = false;
  if (!has(f, "dash")) f.canAttack = false;
  explore(s, f.owner, f, sightRadius(s, f));
  afterMove(s, f, "normal", origin);
}

/**
 * An act of war (S1 step::attack_diplomacy): attacks, infiltration, captures, moving onto a city,
 * stomp and explosion hits record the attack (war) and end the embassies between the two.
 */
function warAct(s: GameState, p: number, q: number) {
  if (p === q) return;
  recordAttack(s, p, q);
  s.players[p].embassies = s.players[p].embassies.filter((h) => h !== q);
  s.players[q].embassies = s.players[q].embassies.filter((h) => h !== p);
}

/**
 * Cymanti poison buildings (Fungi, Clathrus): a unit stepping onto one is poisoned, unless its tribe
 * resists poison (Cymanti) or it flies (S1 cymanti::poison_tile; no owner or peace check).
 */
function poisonTile(s: GameState, u: Unit) {
  if (!s.units.includes(u)) return;
  const t = tileAt(s, u.x, u.y);
  if (t.building !== "fungi" && t.building !== "clathrus") return;
  if (s.players[u.owner].clan === "cymanti" || has(u, "fly")) return;
  u.poisoned = true;
}

/* ---------- Aquarion: flooding, Bubbles, Tentacles ---------- */

/** Aquarion's Bubble ability comes with Waterways (the Roads slot) */
const hasBubble = (s: GameState, p: number) => s.players[p].clan === "aquarion" && s.players[p].techs.includes("roads");

/**
 * Flood (S1 aquarion::flood, by Canal, Drench, Auto Flood): a floodable tile (land that is not a
 * mountain and not flooded yet; water, ocean and ice never flood) floods, and an amphibious unit on it
 * gains Bubble when the flooding player has the Bubble ability (whoever owns the unit).
 */
function floodAt(s: GameState, actor: number, x: number, y: number) {
  const t = tileAt(s, x, y);
  if (isWater(t) || t.terrain === "mountain" || t.flooded) return;
  t.flooded = true;
  const occ = occupant(s, x, y);
  if (occ && has(occ, "amphibious") && hasBubble(s, actor)) occ.bubble = true;
}

/**
 * After a move: an Aquarion amphibious unit with Waterways gets a Bubble (+1 movement) on a flooded
 * tile and loses it on dry land.
 */
function bubbleAfterMove(s: GameState, u: Unit) {
  if (!s.units.includes(u) || !has(u, "amphibious")) return;
  const t = tileAt(s, u.x, u.y);
  if (!isWater(t) && t.flooded) {
    if (hasBubble(s, u.owner)) u.bubble = true;
  } else if (!isWater(t) && !t.algae) u.bubble = false;
}

/**
 * Tentacles strike (S1 aquarion::strike): a unit that moves next to an unfrozen Jelly of another
 * tribe it is not at peace with is hit once, by the healthiest such Jelly (the first in x-major order
 * on a tie), with the Jelly's attack damage and no retaliation.
 */
function tentacleStrike(s: GameState, u: Unit) {
  if (!s.units.includes(u)) return;
  let best: Unit | undefined;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const j = occupant(s, u.x + dx, u.y + dy);
      if (!j || !canHarm(s, u.owner, j.owner) || j.frozen || !has(j, "tentacles")) continue;
      if (!best || j.hp > best.hp) best = j;
    }
  }
  if (best) damage(s, u, computeDamageRounded(s, best, u).damage, best);
}

/**
 * A Jelly's own strike (S1 attack::area_damage with Tentacles): full damage to every neighbour that is
 * not its own or a peace partner's, no retaliation; after a move or an advance and when trained.
 */
function areaDamage(s: GameState, u: Unit) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const e = occupant(s, u.x + dx, u.y + dy);
      if (!e || !canHarm(s, u.owner, e.owner)) continue;
      const dealt = computeDamageRounded(s, u, e).damage;
      // a damaging hit on a visible unit is an act of war and resets the Pacifist count (S1 area_damage)
      if (dealt > 0 && !e.hidden) {
        warAct(s, u.owner, e.owner);
        s.players[u.owner].attackedThisTurn = true;
      }
      damage(s, e, dealt, u);
    }
  }
}

/* ---------- Polaris: freezing and breaking ice ---------- */

/**
 * Whether `actor` can freeze tile q (S1 polaris::freezable): an explored tile that is open water or
 * flooded land, or land that is not Polaris land yet (in any territory, enemy land too); an ice tile
 * or Polaris land only while a visible unfrozen unit not its own or a peace partner's stands on it.
 */
function freezable(s: GameState, actor: number, q: Coord): boolean {
  if (s.players[actor].explored[idx(s.mapSize, q.x, q.y)] !== 1) return false;
  const t = tileAt(s, q.x, q.y);
  if (isWater(t) ? !t.ice : t.flooded || !t.polar) return true;
  const o = occupant(s, q.x, q.y);
  return !!o && canHarm(s, actor, o.owner) && !o.frozen && canSee(s, actor, o);
}

/**
 * Freeze Area (the Gaami's action, and Auto Freeze after a Mooni's or Gaami's move; S1
 * polaris::freeze_area): every freezable tile around freezes (water turns to ice, land to Polaris
 * land, enemy territory included), and every unit around (seen or not) that isn't the actor's or a
 * peace partner's and isn't frozen yet freezes. Freezing a unit counts as an attack (Altar of Peace).
 */
function freezeArea(s: GameState, u: Unit) {
  const p = u.owner;
  for (const q of around(s.mapSize, u, 1)) {
    const t = tileAt(s, q.x, q.y);
    if (freezable(s, p, q)) {
      if (isWater(t)) t.ice = true;
      else t.polar = true;
    }
    const occ = occupant(s, q.x, q.y);
    if (occ && canHarm(s, p, occ.owner) && !occ.frozen) {
      occ.frozen = true;
      s.players[p].attackedThisTurn = true;
    }
  }
}

/** S1 polaris::breakable: ice that is empty, holds a swimmer or flyer or a hidden enemy, or has algae or a bridge */
function breakableIce(s: GameState, q: Coord, viewer: number): boolean {
  const t = tileAt(s, q.x, q.y);
  if (!t.ice) return false;
  if (t.algae || t.building === "bridge") return true;
  const o = occupant(s, q.x, q.y);
  if (!o) return true;
  const swims = UNITS[o.type].naval || has(o, "water") || has(o, "amphibious");
  return swims || has(o, "fly") || (o.hidden && o.owner !== viewer && !atPeace(s, viewer, o.owner));
}

/**
 * Break Ice (S1 polaris::break_ice_area / break_ice): every breakable ice tile around the unit breaks
 * at once; a hidden enemy on one is revealed instead. Broken ice turns to ocean, or shallow water when
 * a land tile is orthogonally next to it.
 */
function breakIceArea(s: GameState, u: Unit, p: number) {
  for (const q of around(s.mapSize, u, 1)) {
    if (!breakableIce(s, q, p)) continue;
    const o = occupant(s, q.x, q.y);
    if (o && o.hidden && o.owner !== p && !atPeace(s, p, o.owner)) {
      o.hidden = false;
      continue;
    }
    const t = tileAt(s, q.x, q.y);
    t.ice = false;
    const land = [
      { x: q.x - 1, y: q.y },
      { x: q.x, y: q.y - 1 },
      { x: q.x, y: q.y + 1 },
      { x: q.x + 1, y: q.y },
    ].some((d) => d.x >= 0 && d.y >= 0 && d.x < s.mapSize && d.y < s.mapSize && !isWater(tileAt(s, d.x, d.y)));
    t.terrain = land ? "water" : "ocean";
  }
}

/* ---------- Cymanti: Swarm, Explode, Centipede ---------- */

/** Swarm targets (S1 cymanti.rs swarm options): own neighbours not Swift yet and not led in a chain */
function swarmTargets(s: GameState, u: Unit): Unit[] {
  return s.units.filter((o) => o.owner === u.owner && o !== u && dist(o, u) === 1 && !o.swarmed && !isLed(o));
}

/**
 * A poisoned unit's death or an explosion leaves spores (S1 cymanti::spores: a new resource on the
 * tile, replacing one there), and on water algae too. Not on a city or village.
 */
function leaveSporesOrAlgae(t: ReturnType<typeof tileAt>) {
  if (t.cityId !== null || t.village) return;
  t.resource = "spores";
  if (isWater(t) && !t.ice) t.algae = true;
}

/**
 * Explode (S1 cymanti::explode): the unit blows up, hitting every neighbour not its own with half the
 * damage and poisoning the survivors. Its follower explodes too, so the whole tail of a Centipede goes
 * (the follower's blast runs right after this one, as S1's action stack orders them); the unit in
 * front lets go, keeping the rest of the body.
 */
function doExplode(s: GameState, u: Unit) {
  const p = u.owner;
  const pos = { x: u.x, y: u.y };
  const follower = followerOf(s, u);
  s.units = s.units.filter((x) => x !== u);
  const t = tileAt(s, pos.x, pos.y);
  leaveSporesOrAlgae(t);
  // (S1 cymanti::explode) half damage, rounded down, to every neighbour not at peace; a survivor is
  // poisoned; each hit is an act of war and resets the Pacifist count
  for (const e of s.units.slice()) {
    if (!canHarm(s, p, e.owner) || dist(e, pos) !== 1) continue;
    const r = computeDamageRounded(s, u, e);
    warAct(s, p, e.owner);
    s.players[p].attackedThisTurn = true;
    damage(s, e, halfDamage(r.damage), u);
    if (s.units.includes(e)) e.poisoned = true;
  }
  if (follower && s.units.includes(follower)) doExplode(s, follower);
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
    if (!canHarm(s, u.owner, e.owner) || dist(e, u) !== 1) continue;
    const r = computeDamageRounded(s, u, e);
    // (S1 attack::area_damage) a hit that deals damage to a visible unit is an act of war and
    // resets the Pacifist count; half damage, rounded down
    if (r.damage > 0 && !e.hidden) {
      warAct(s, u.owner, e.owner);
      s.players[u.owner].attackedThisTurn = true;
    }
    damage(s, e, halfDamage(r.damage), u);
  }
}

/* ---------- combat ---------- */

/**
 * Deal damage. A kill counts for the attacking unit's player, or for `killer` when there is no
 * attacking unit (infiltration: S1 attack::perform_attack credits the infiltrating player).
 */
function damage(s: GameState, target: Unit, amount: number, by: Unit | null, killer: number | null = null): boolean {
  target.hp -= amount;
  // Swarm (Swift) is lost whenever the unit is hit, retaliation and area damage included
  target.swarmed = false;
  if (target.hp > 0) return false;
  const follower = followerOf(s, target);
  s.units = s.units.filter((x) => x !== target);
  if (target.poisoned) leaveSporesOrAlgae(tileAt(s, target.x, target.y));
  if (follower) splitChain(s, target, follower);
  s.players[target.owner].losses += 1;
  if (by) {
    s.players[by.owner].kills += 1;
    if (!has(by, "static") && !has(by, "carry")) by.kills += 1;
  } else if (killer !== null) {
    s.players[killer].kills += 1;
  }
  return true;
}

/**
 * A killed chain member (S1 attack::kill): its follower grows into a Centipede (it keeps its missing
 * HP and takes the dead unit's spent flags) and leads the rest of the body behind it; the unit in front
 * lets go, keeping the part ahead. Killing a middle Segment so splits the body in two.
 */
function splitChain(s: GameState, dead: Unit, next: Unit) {
  const rest = s.units.filter((o) => o.bodyOf === next.bodyOf);
  const behind = rest.slice(rest.indexOf(next) + 1);
  const missing = next.maxHp - next.hp;
  next.type = "centipede";
  next.maxHp = UNITS.centipede.hp! + (next.veteran ? 5 : 0);
  next.hp = next.maxHp - Math.min(missing, next.maxHp - 1);
  delete next.bodyOf;
  next.moved = dead.moved;
  next.attacked = dead.attacked;
  next.canMove = dead.canMove;
  next.canAttack = dead.canAttack;
  next.done = dead.done;
  for (const o of behind) o.bodyOf = next.id;
}

/** the 8 directions clockwise from north-west (S1 linked::FAN order) */
const FAN: Coord[] = [
  { x: -1, y: -1 }, { x: -1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 },
  { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: -1 },
];

/** a new unit's facing (S1 units::facing): toward the middle of the board, straight steps weighted 1393, diagonal 985 */
function facingOf(s: GameState, u: Unit): Coord {
  if (u.lastDir && (u.lastDir.x || u.lastDir.y)) return u.lastDir;
  const half = Math.floor(s.mapSize / 2);
  const dx = half - u.x;
  const dy = half - u.y;
  let best = FAN[0];
  let score = 0;
  for (const d of FAN) {
    const next = (d.x * dx + d.y * dy) * (d.x * d.x + d.y * d.y === 1 ? 1393 : 985);
    if (score < next) {
      best = d;
      score = next;
    }
  }
  return best;
}

/**
 * Eat (S1 linked::eat): a Segment is placed behind the body's tail (the last Segment, or the head),
 * on the first free tile it may stand on, fanning out from the opposite of the tail's own facing.
 * No Segment for killing a wild unit (S1 owner 255); the engine has none.
 */
function growSegment(s: GameState, head: Unit) {
  const body = chainBody(s, head.id);
  const tail = body.length ? body[body.length - 1] : head;
  const facing = facingOf(s, tail);
  const dir = FAN.findIndex((d) => d.x === facing.x && d.y === facing.y);
  const opposite = ((dir < 0 ? 7 : dir) + 4) % 8;
  const probe: Unit = { ...tail, type: "segment", carried: null };
  for (let i = 1; i <= 8; i++) {
    const offset = (i - 1) % 2 === 0 ? Math.floor(i / 2) : -(i >> 1);
    const d = FAN[(((offset + opposite) % 8) + 8) % 8];
    const x = tail.x + d.x;
    const y = tail.y + d.y;
    if (x < 0 || y < 0 || x >= s.mapSize || y >= s.mapSize || occupant(s, x, y)) continue;
    if (enterKind(s, probe, tileAt(s, x, y)) !== "normal") continue;
    const seg = makeUnit(s, "segment", head.owner, { x, y }, null);
    seg.bodyOf = head.id;
    explore(s, head.owner, seg, 1);
    return;
  }
}

function doAttack(s: GameState, u: Unit, target: Unit) {
  const p = u.owner;
  u.hidden = false;
  u.lastDir = { x: Math.sign(target.x - u.x), y: Math.sign(target.y - u.y) };
  // embassies between the two are destroyed by any attack (§5.5); the two are now at war
  warAct(s, p, target.owner);

  if (has(u, "convert")) {
    // converting any part of a Centipede converts the whole body (S1 attack::convert: the chain
    // neighbours come along); an Independent unit keeps its home city, any other is homed in the
    // converter's capital; a boat's passenger is part of the unit here, so it is converted with it
    const headId = target.bodyOf ?? (target.type === "centipede" ? target.id : null);
    const group = headId === null ? [target] : s.units.filter((o) => o.id === headId || o.bodyOf === headId);
    const cap = capitalOf(s, p) ?? citiesOf(s, p)[0];
    for (const o of group) {
      o.owner = p;
      if (!has(o, "independent")) o.homeCity = cap?.id ?? null;
      o.canMove = false;
      o.canAttack = false;
      o.done = true;
    }
    // conversions are no attack for the Altar of Peace; Cymanti count them for its replacement task
    if (u.type === "shaman") s.players[p].conversions = (s.players[p].conversions ?? 0) + 1;
    endUnit(u);
    u.attacked = true;
    return;
  }
  const r = computeDamageRounded(s, u, target);
  // Pacifist: only an attack that deals damage to a visible unit resets the count (S1 attack_command)
  if (r.damage > 0 && !target.hidden) s.players[p].attackedThisTurn = true;
  const from = { x: target.x, y: target.y };
  const killed = damage(s, target, r.damage, u);
  // Aquarion: being attacked pops a Bubble; Drench floods the attacked tile (and may bubble its unit)
  target.bubble = false;
  if (has(u, "drench")) floodAt(s, p, from.x, from.y);
  // special on-hit effects: freeze (Ice Archer) & poison (Phychi, Exida, Kiton)
  if (!killed && has(u, "freeze")) target.frozen = true;
  if (!killed && has(u, "poison")) target.poisoned = true;
  // splash (S1 attack_command, ranged units only): half damage, rounded down, to every unit next to
  // the target not at peace; a poisoning attacker (Exida) only poisons them, no damage
  if (has(u, "splash") && UNITS[u.type].range > 1) {
    for (const e of s.units.slice()) {
      if (!canHarm(s, p, e.owner) || dist(e, from) !== 1 || e === u) continue;
      if (has(u, "poison")) {
        e.poisoned = true;
        continue;
      }
      damage(s, e, halfDamage(computeDamageRounded(s, u, e).damage), u);
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
      // retaliation is an attack on the attacker: it loses Swift (damage); a poisoner's
      // retaliation poisons it (Kiton, Exida, ...)
      damage(s, u, r.retaliation, target);
      if (s.units.includes(u) && has(target, "poison")) u.poisoned = true;
    }
  }
  u.attacked = true;
  const alive = s.units.includes(u);
  if (!alive) return;
  u.canAttack = false;
  // Double Attack: a second attack this turn
  if (has(u, "doubleAttack") && !u.secondAttack) {
    u.secondAttack = true;
    u.canAttack = true;
  }
  // melee advance into the killed unit's tile (§3.4); it sets off what a move does (S1 move reason 1)
  if (killed && UNITS[u.type].range < 2 && !occupant(s, from.x, from.y)) {
    const kind = enterKind(s, u, tileAt(s, from.x, from.y));
    if (kind === "normal" || kind === "embark") {
      const origin = { x: u.x, y: u.y };
      u.x = from.x;
      u.y = from.y;
      explore(s, p, u, sightRadius(s, u));
      afterMove(s, u, kind, origin);
    }
  }
  if (!s.units.includes(u)) return;
  // Escape: may move again after attacking, also after moving first (move, attack, move);
  // a skater only while it ends (after any advance) on ice (S1 attack_command)
  const escape = has(u, "escape") && !(has(u, "skate") && !tileAt(s, u.x, u.y).ice);
  u.canMove = escape && !u.frozen && !u.done;
  // Cymanti Centipede Eat: every kill by attack grows a Segment behind the body's tail
  if (killed && has(u, "eat")) growSegment(s, u);
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
    // capturing a tribe's city is an act of war (S1 capture::capture_city)
    warAct(s, p, old);
    // the connections through this city are cut and the population they gave goes with them (may go negative)
    if (c.capital) {
      for (const o of citiesOf(s, old)) {
        if (o === c || !o.connected) continue;
        o.connected = false;
        o.pop -= 1;
        c.pop -= 1;
      }
    } else if (c.connected) {
      const oldCap = capitalOf(s, old);
      c.pop -= 1;
      if (oldCap) oldCap.pop -= 1;
    }
    // a captured Polaris city's land changes to the captor's style
    if (s.players[old].clan === "polaris" && s.players[p].clan !== "polaris") {
      for (const tt of s.tiles) if (tt.territory === c.id) tt.polar = false;
    }
    c.owner = p;
    // recapturing your own starting city makes it your capital again; level, population and rewards stay
    c.capital = c.originalCapitalOf === p;
    c.connected = false;
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
    updateConnections(s, p);
    log(s, `captured ${c.name} from player ${old}`);
  }
  // the city tile becomes field, flooded by a flooding tribe (Aquarion) and drained by any other
  // (S1 capture::capture_city, villages too)
  t.terrain = "field";
  if (s.players[p].clan === "aquarion") t.flooded = true;
  else if (t.flooded) t.flooded = false;
  endUnit(u);
}

function doExamine(s: GameState, u: Unit) {
  const p = u.owner;
  const pl = s.players[p];
  const t = tileAt(s, u.x, u.y);
  t.ruin = false;
  u.hidden = false;
  endUnit(u);
  // eligible rewards (S1 ruins::select_reward; a shuffle taking the first eligible one = an even draw):
  // resources and population always; the veteran unit on land, the veteran boat on water only with
  // ocean movement; a free tech among all researchable ones (also an unknown parent of a known tech);
  // the explorer when a neighbour has terrain the player can move on and fog lies within 2
  const options: string[] = ["resources", "population"];
  if (!isWater(t) || pl.techs.includes("sailing")) options.push("newFriends");
  const researchable = TECHS.filter((x) => canResearch(s, p, x.id));
  if (researchable.length) options.push("scroll");
  const fogNear = around(s.mapSize, u, 2).some((q) => pl.explored[idx(s.mapSize, q.x, q.y)] !== 1);
  const enterable = around(s.mapSize, u, 1).some((q) => explorerCanEnter(s, p, tileAt(s, q.x, q.y)));
  if (enterable && fogNear) options.push("explorer");
  // 2.18 (S1 ruins::select_reward): an Aquarion examining a valid ocean ruin always raises the Lost City
  const pick = pl.clan === "aquarion" && validLostCity(s, u) ? "lostCity" : withRng(s, (r) => r.pick(options));
  switch (pick) {
    case "resources":
      pl.stars += RUIN_STARS;
      break;
    case "scroll": {
      const tech = withRng(s, (r) => r.pick(researchable));
      pl.techs.push(tech.id);
      break;
    }
    case "population": {
      const cap = capitalOf(s, p);
      if (cap) addPop(s, cap, 3);
      break;
    }
    case "explorer":
      runExplorer(s, p, u);
      break;
    case "lostCity":
      raiseLostCity(s, u);
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
 * A valid Lost City (S1 ruins::valid_lost_city): an unowned ocean tile off the board's edge with no
 * other city, village or ruin within two tiles.
 */
function validLostCity(s: GameState, at: Coord): boolean {
  const t = tileAt(s, at.x, at.y);
  const n = s.mapSize;
  if (at.x <= 0 || at.y <= 0 || at.x >= n - 1 || at.y >= n - 1) return false;
  if (t.terrain !== "ocean" || t.territory !== null) return false;
  return !around(n, at, 2).some((q) => {
    const o = tileAt(s, q.x, q.y);
    return o.cityId !== null || o.village || o.ruin;
  });
}

/**
 * Aquarion Lost City (S1 ruins::lost_city): the 8 tiles around turn to shallow water (not ice), a
 * level-1 city rises on a flooded field and the examining player owns it at once. (S1 also places
 * resources around it with its map hash; the engine does not.)
 */
function raiseLostCity(s: GameState, u: Unit) {
  const p = u.owner;
  const at = { x: u.x, y: u.y };
  const t = tileAt(s, at.x, at.y);
  for (const q of around(s.mapSize, at, 1)) {
    const o = tileAt(s, q.x, q.y);
    if (!o.ice && o.cityId === null && !o.village) o.terrain = "water";
  }
  t.terrain = "field";
  t.resource = null;
  t.flooded = true;
  const c = newCity(s, at, p);
  claimTerritory(s, c, 1);
  explore(s, p, c, 1);
  if (!has(u, "independent")) u.homeCity = c.id;
  // a water-only unit can't stand on the new land
  if (UNITS[u.type].naval && !has(u, "carry") && enterKind(s, u, t) === null) pushUnit(s, u, p);
}

/**
 * Terrain player p's techs let it move on (S1 routes::movements, game data movement_unlocks): field,
 * forest, ice and wetland always, a city, a bridge; mountain with Climbing, shallow water with
 * Fishing (Aquarion: its starting tech Aquabase), ocean with Sailing.
 */
function explorerCanEnter(s: GameState, p: number, t: ReturnType<typeof tileAt>): boolean {
  const pl = s.players[p];
  if (t.cityId !== null || t.building === "bridge" || t.ice || t.algae) return true;
  if (t.terrain === "mountain") return pl.techs.includes("climbing");
  if (t.terrain === "water") return pl.techs.includes("fishing") || pl.clan === "aquarion";
  if (t.terrain === "ocean") return pl.techs.includes("sailing");
  return true;
}

/**
 * Explorer walker (S1 reward::scout): EXPLORER_STEPS (12) automatic moves into the fog.
 * Each step goes to the neighbour that uncovers the most new tiles (3x3 vision, 5x5
 * when it stands on a mountain); ties go to the step closest to the nearest
 * lighthouse this player hasn't found. If no neighbour uncovers anything, it steps
 * along a shortest path toward the nearest unexplored tile. It walks into fog, but
 * on explored tiles only on terrain the player can move on. Remaining ties are
 * broken by the game RNG (S1's own scoring and hash are not ported).
 */
export function runExplorer(s: GameState, p: number, from: Coord) {
  const pl = s.players[p];
  const n = s.mapSize;
  let cur = { x: from.x, y: from.y };
  const passable = (q: Coord) => {
    if (pl.explored[idx(n, q.x, q.y)] !== 1) return true; // may walk into fog
    return explorerCanEnter(s, p, tileAt(s, q.x, q.y));
  };
  const sight = (q: Coord) => (tileAt(s, q.x, q.y).terrain === "mountain" ? 2 : 1);
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
    explore(s, p, cur, sight(cur));
  }
}

function doInfiltrate(s: GameState, u: Unit, c: City) {
  const p = u.owner;
  s.units = s.units.filter((x) => x !== u);
  // infiltration is an act of war (S1 attack::attack_command)
  warAct(s, p, c.owner);
  if (u.type === "moth") {
    mothInfiltrate(s, u, c);
    return;
  }
  const occ = occupant(s, c.x, c.y);
  if (occ && occ.owner !== p) {
    const dagger = { ...u, type: "dagger", hp: 10, maxHp: 10 };
    const r = computeDamageRounded(s, dagger, occ);
    damage(s, occ, r.damage, null, p);
  }
  const owner = c.owner;
  const stolen = c.capital ? c.level + 1 : c.level;
  s.players[p].stars += stolen + (c.workshop ? 1 : 0) + c.parks;
  c.riot = true;
  void owner;
  const count = Math.min(c.level, 5);
  // spawn order (rules doc, Infiltration): the city, then defensive tiles (forest, or mountain
  // with Climbing), then other land inside the borders, then water as Pirates
  const climbing = s.players[p].techs.includes("climbing");
  const spots = s.tiles
    .map((t, i) => ({ t, x: i % s.mapSize, y: Math.floor(i / s.mapSize) }))
    .filter(({ t }) => t.territory === c.id && (t.terrain !== "mountain" || climbing))
    .sort((a, b) => {
      const sc = (o: { t: typeof a.t; x: number; y: number }) =>
        (o.x === c.x && o.y === c.y ? 100 : 0) +
        (isWater(o.t) ? 0 : 10) +
        (o.t.terrain === "forest" || o.t.terrain === "mountain" ? 20 : 0) +
        (o.t.resource ? 1 : 0);
      return sc(b) - sc(a);
    });
  let made = 0;
  for (const sp of spots) {
    if (made >= count) break;
    if (occupant(s, sp.x, sp.y)) continue;
    const aqua = s.players[p].clan === "aquarion"; // Scuba: amphibious Mermaid Daggers
    const nu = makeUnit(s, aqua ? "mermaidDagger" : isWater(sp.t) ? "pirate" : "dagger", p, sp, null);
    if (isWater(sp.t) && !aqua) nu.carried = "dagger";
    made++;
  }
  log(s, `infiltrated ${c.name}`);
}

/** Moth: poisons the defender and lays Insect Eggs on free land; steals no stars, no riot */
function mothInfiltrate(s: GameState, u: Unit, c: City) {
  const p = u.owner;
  // (S1 infiltrate::reward, the Poison reward) the city rebels (no income next turn) but pays no
  // stars; the defender takes the Moth's hit and is poisoned when it survives
  c.riot = true;
  const occ = occupant(s, c.x, c.y);
  if (occ && occ.owner !== p) {
    const killed = damage(s, occ, computeDamageRounded(s, u, occ).damage, null, p);
    if (!killed) occ.poisoned = true;
  }
  // Insect Eggs (city level, at most 5) on free land of the city's territory, the city tile too
  // when the defender died
  const count = Math.min(c.level, 5);
  let made = 0;
  s.tiles.forEach((t, i) => {
    const x = i % s.mapSize;
    const y = Math.floor(i / s.mapSize);
    if (made >= count || t.territory !== c.id || isWater(t) || occupant(s, x, y)) return;
    if (t.terrain === "mountain" && !s.players[p].techs.includes("climbing")) return;
    makeUnit(s, "insectEgg", p, { x, y }, null);
    made++;
  });
  log(s, `moth infiltrated ${c.name}`);
}

/* ---------- builds ---------- */

function doBuild(s: GameState, p: number, b: string, at: Coord) {
  const pl = s.players[p];
  const def = BUILDS[b];
  const t = tileAt(s, at.x, at.y);
  pl.stars -= b === "embassy" ? embassyCost(pl.embassies.length) : def.cost;
  if (def.gain) pl.stars += def.gain;
  const city = cityById(s, t.territory);
  switch (def.kind) {
    case "harvest":
      if (b === "fertilize") {
        t.resource = "crop";
        break;
      }
      if (b === "canal") {
        // the builder is spent (a hidden one revealed), then the tile floods
        const u = occupant(s, at.x, at.y);
        if (u) {
          u.hidden = false;
          endUnit(u);
          u.moved = true;
          u.attacked = true;
        }
        floodAt(s, p, at.x, at.y);
        break;
      }
      if (b === "algae") {
        t.algae = true;
        if (!t.resource) t.resource = "fruit";
        break;
      }
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
    case "embassy": {
      const host = cityById(s, t.cityId)!.owner;
      pl.embassies.push(host);
      explore(s, p, at, 1);
      meet(s, host, p); // receiving an embassy makes the host meet the sender
      break;
    }
    case "destroy": {
      const old = t.building!;
      if (city) {
        const lost = (BUILDS[old]?.pop ?? 0) + (FEEDS[old] ? 0 : levelPop(old, t.buildingLevel));
        city.pop -= lost;
      }
      t.building = null;
      t.buildingLevel = 0;
      t.decomposing = false;
      unfeed(s, p, at, old);
      break;
    }
    default: {
      t.building = b;
      t.builtTurn = s.turn;
      t.buildingLevel = 0;
      t.decomposing = false;
      if (b === "iceBank") pl.builtUnique = [...(pl.builtUnique ?? []), b];
      if (def.kind === "monument") pl.monuments.push(b);
      if (city && def.pop) addPop(s, city, def.pop);
      // leveling buildings (§5.5)
      const levelKind = Object.values(FEEDS).find((f) => f.building === b);
      if (levelKind) {
        const feeders = Object.keys(FEEDS).filter((k) => FEEDS[k].building === b);
        const lvl = Math.min(
          LEVEL_CAP,
          around(s.mapSize, at, 1).filter(
            (q) => tileAt(s, q.x, q.y).building !== null && feeders.includes(tileAt(s, q.x, q.y).building!) && ownTile(s, p, q.x, q.y),
          ).length,
        );
        t.buildingLevel = lvl;
        if (city) addPop(s, city, lvl * levelKind.popPerLevel);
      }
      if (FEEDS[b]) feed(s, p, at, b);
    }
  }
}

function levelPop(building: string, level: number): number {
  if (building === "fungi") return level; // +1 population per growth level
  const f = Object.values(FEEDS).find((x) => x.building === building);
  return f ? f.popPerLevel * level : 0;
}

/** a feeder (farm/lumber hut/mine) was built or removed: adjust adjacent leveling buildings */
function feed(s: GameState, p: number, at: Coord, feeder: string) {
  const f = FEEDS[feeder];
  for (const q of around(s.mapSize, at, 1)) {
    const n = tileAt(s, q.x, q.y);
    if (n.building !== f.building || !ownTile(s, p, q.x, q.y)) continue;
    const before = n.buildingLevel;
    // level = adjacent own feeders, at most 8 (recounted, so a 9th feeder's removal keeps level 8)
    // (a Windmill counts Farms and Aqua Farms)
    const feeders = Object.keys(FEEDS).filter((k) => FEEDS[k].building === f.building);
    n.buildingLevel = Math.min(
      LEVEL_CAP,
      around(s.mapSize, q, 1).filter((r) => {
        const b = tileAt(s, r.x, r.y).building;
        return b !== null && feeders.includes(b) && ownTile(s, p, r.x, r.y);
      }).length,
    );
    const gained = (n.buildingLevel - before) * f.popPerLevel;
    const c = cityById(s, n.territory);
    if (c && gained) {
      if (gained > 0) addPop(s, c, gained);
      else c.pop += gained;
    }
  }
}

function unfeed(s: GameState, p: number, at: Coord, old: string) {
  if (FEEDS[old]) feed(s, p, at, old);
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
