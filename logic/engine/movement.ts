/**
 * Movement (RULES.md §4): Chebyshev neighbours, a budget of movement×2
 * half-steps, road-to-road steps cost 1 half-step, others 2. A unit may keep
 * stepping from any tile reached below its budget ("rounds up"). Entering
 * forest (unless road-to-road) or mountain, any tile next to an enemy (zone of
 * control), an own port (embark) or land from a boat (disembark) ends the move.
 * Unexplored tiles cannot be entered.
 */
import { UNITS } from "./data";
import { around, idx, inBounds, isWater, tileAt } from "./grid";
import { atPeace, friendly } from "./diplomacy";
import type { Coord, GameState, Tile, Unit } from "./types";

export const has = (u: Unit, skill: string) => (UNITS[u.type].skills as string[]).includes(skill);
export const techOf = (s: GameState, p: number, t: string) => s.players[p].techs.includes(t);

/** owner of the territory a tile belongs to, or null */
export function territoryOwner(s: GameState, t: Tile): number | null {
  if (t.territory === null) return null;
  const c = s.cities.find((c) => c.id === t.territory);
  return c ? c.owner : null;
}

export function unitAt(s: GameState, x: number, y: number): Unit | undefined {
  return s.units.find((u) => u.x === x && u.y === y);
}

/**
 * can `player` see unit `u` (explored tile, and not hidden unless adjacent to one of player's units;
 * peace partners see each other's Cloaks)
 */
export function canSee(s: GameState, player: number, u: Unit): boolean {
  if (u.owner === player) return true;
  if (s.players[player].explored[idx(s.mapSize, u.x, u.y)] !== 1) return false;
  if (!u.hidden || atPeace(s, player, u.owner)) return true;
  return s.units.some(
    (o) => o.owner === player && Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y)) <= 1,
  );
}

/** road-network tile for a player (§4.4): road, bridge, village, city; in own, neutral or allied territory */
function roadNode(s: GameState, t: Tile, player: number): boolean {
  if (!(t.road || t.building === "bridge" || t.village || t.cityId !== null)) return false;
  const o = territoryOwner(s, t);
  return o === null || friendly(s, player, o);
}

export type StepKind = "normal" | "embark" | "disembark";

/** whether unit u (as it is now) may stand on / step onto tile t, and how */
export function enterKind(s: GameState, u: Unit, t: Tile): StepKind | null {
  const p = u.owner;
  const def = UNITS[u.type];
  if (has(u, "fly")) return "normal";
  const aq = aquarionEnterKind(s, u, t);
  if (aq !== undefined) return aq;
  if (def.naval) {
    if (isWater(t)) {
      if (t.ice) return null;
      if (t.terrain === "ocean" && !techOf(s, p, "sailing")) return null;
      if (t.terrain === "water" && !techOf(s, p, "fishing") && u.type !== "raychi") return null;
      return "normal";
    }
    if (u.type === "raychi") return null;
    // landing: passenger must be able to stand there
    if (t.terrain === "mountain" && !techOf(s, p, "climbing")) return null;
    return "disembark";
  }
  // land or amphibious unit
  if (isWater(t)) {
    if (t.ice || t.algae || t.building === "bridge") return "normal";
    if (has(u, "amphibious")) {
      if (t.terrain === "ocean" && !techOf(s, p, "sailing")) return null;
      return "normal";
    }
    // land units board at their own port or a peace partner's port
    if (t.building === "port" && friendly(s, p, territoryOwner(s, t)) && techOf(s, p, "fishing")) return "embark";
    return null;
  }
  if (t.terrain === "mountain" && !techOf(s, p, "climbing")) return null;
  return "normal";
}

/**
 * Aquarion and flooded-tile rules (2.18 data; logic follows polybots-engine):
 * Aquarion's starting tech Aquabase gives its amphibious units shallow water,
 * Marine Life (the Sailing slot) gives ocean; Riding and Free Spirit give no
 * water movement. Its ships (Shark, Jelly, Puffer) have their own terrain
 * list (water, ocean, flooded land) and need no tech. Ships may enter flooded
 * land (and stop there); a port on a flooded tile embarks land units.
 * Returns undefined when the regular rules apply.
 */
function aquarionEnterKind(s: GameState, u: Unit, t: Tile): StepKind | null | undefined {
  const p = u.owner;
  const def = UNITS[u.type];
  if (s.players[p].clan === "aquarion" && isWater(t) && !t.ice && !t.algae && t.building !== "bridge") {
    const swims = def.naval || has(u, "amphibious");
    if (swims) {
      if (def.naval) return "normal";
      return t.terrain === "ocean" && !techOf(s, p, "sailing") ? null : "normal";
    }
  }
  if (!isWater(t) && t.flooded) {
    if (def.naval) return t.terrain === "mountain" ? null : "normal";
    if (!has(u, "amphibious") && t.building === "port" && territoryOwner(s, t) === p && techOf(s, p, "fishing")) return "embark";
  }
  if (def.naval && !isWater(t) && !has(u, "carry")) return null; // a ship with no passenger can't land
  return undefined;
}

export type MoveTarget = Coord & { kind: StepKind };

/** All tiles unit u can end its move on this turn. */
export function reachable(s: GameState, u: Unit): MoveTarget[] {
  return search(s, u).targets;
}

/**
 * The path unit u takes to `to` (tiles after its start, ending at `to`), as the
 * mover plans it: hidden enemies it cannot see count as empty tiles, so the
 * planned path may run into one (rules doc, Cloak: the mover is stopped).
 */
export function pathTo(s: GameState, u: Unit, to: Coord): Coord[] {
  const { parent } = search(s, u);
  const n = s.mapSize;
  const start = idx(n, u.x, u.y);
  const out: Coord[] = [];
  let cur = idx(n, to.x, to.y);
  for (let guard = 0; cur !== start && guard < n * n; guard++) {
    out.push({ x: cur % n, y: Math.floor(cur / n) });
    const p = parent.get(cur);
    if (p === undefined) return [to];
    cur = p;
  }
  return out.reverse();
}

function search(s: GameState, u: Unit): { targets: MoveTarget[]; parent: Map<number, number> } {
  const parent = new Map<number, number>();
  if (u.frozen || UNITS[u.type].movement === 0) return { targets: [], parent };
  const n = s.mapSize;
  const explored = s.players[u.owner].explored;
  const skate = has(u, "skate");
  // Skate: a move that starts on ice may use the unit's ice movement (Battle Sled 3)
  const startsOnIce = !!tileAt(s, u.x, u.y).ice;
  const baseMov = skate && startsOnIce ? (UNITS[u.type].iceMovement ?? UNITS[u.type].movement) : UNITS[u.type].movement;
  const rawMov = baseMov + (u.swarmed || u.bubble ? 1 : 0) - (u.poisoned ? 1 : 0);
  // movement points (a step costs 1, road to road 0.5, a Glide ice step 0.9)
  let budget = Math.max(1, rawMov);
  // Eat: while the Centipede has segments it moves only 1 tile
  if (has(u, "eat") && s.units.some((o) => o.bodyOf === u.id)) budget = 1;
  // Glide (Polarism): Polaris ice steps cost 0.9
  const glide = s.players[u.owner].clan === "polaris" && techOf(s, u.owner, "aquatism");
  // Creep: forests cost 1 and don't stop it, no road bonus, mountains still stop it (2.15).
  // Air: ignores terrain (no forest/mountain stop), every step costs 1, no roads.
  // Zone of control is ignored only by Hide (invisible) and Sneak; Creep and Air still stop.
  const creep = has(u, "creep");
  const fly = has(u, "fly");
  const noRoad = creep || fly;
  const amphibious = has(u, "amphibious");
  const ignoresZoc = has(u, "hide") || has(u, "sneak");
  // units the mover knows about: hidden enemies it cannot see are planned through as empty tiles
  const occupied = new Map<number, Unit>();
  for (const o of s.units) if (!o.hidden || canSee(s, u.owner, o)) occupied.set(idx(n, o.x, o.y), o);
  // zone of control: not from hidden units or peace partners
  const enemyAdjacent = (x: number, y: number) =>
    around(n, { x, y }, 1).some((c) => {
      const o = occupied.get(idx(n, c.x, c.y));
      // Centipede segments and peace partners exert no zone of control
      return (
        o !== undefined && o.owner !== u.owner && !o.hidden && o.type !== "segment" && !atPeace(s, u.owner, o.owner)
      );
    });

  // spent[i] = cheapest movement points to reach tile i with the ability to continue
  const best = new Map<number, number>();
  const ends = new Map<number, StepKind>();
  const start = idx(n, u.x, u.y);
  best.set(start, 0);
  const queue: number[] = [start];
  while (queue.length) {
    // pick lowest cost (maps are small; linear scan is fine)
    let bi = 0;
    for (let k = 1; k < queue.length; k++)
      if ((best.get(queue[k]) ?? 0) < (best.get(queue[bi]) ?? 0)) bi = k;
    const cur = queue.splice(bi, 1)[0];
    const spent = best.get(cur)!;
    if (spent >= budget - 1e-9) continue;
    const cx = cur % n;
    const cy = Math.floor(cur / n);
    const from = s.tiles[cur];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(n, x, y)) continue;
        const i = idx(n, x, y);
        if (explored[i] !== 1) continue;
        const t = s.tiles[i];
        const kind = enterKind(s, u, t);
        if (!kind) continue;
        const occ = occupied.get(i);
        // enemy units block (hidden movers may pass through); own and allied units can be passed
        if (occ && !friendly(s, u.owner, occ.owner) && !has(u, "hide")) continue;
        // roads give no bonus on ice or to skaters
        const road =
          !noRoad && !amphibious && !skate && !UNITS[u.type].naval && !from.ice && !t.ice &&
          roadNode(s, from, u.owner) && roadNode(s, t, u.owner);
        const cost = road ? 0.5 : glide && t.ice ? 0.9 : 1;
        const total = spent + cost;
        let stop = kind !== "normal";
        if (!fly && t.terrain === "mountain") stop = true;
        if (!creep && !fly && t.terrain === "forest" && !road) stop = true;
        // Skate: on land at most 1 tile
        if (skate && !isWater(t)) stop = true;
        // algae ends the move of land units
        if (!fly && t.algae && !UNITS[u.type].naval) stop = true;
        if (!ignoresZoc && enemyAdjacent(x, y)) stop = true;
        // Aquarion: amphibious units stop on dry land, ships stop on flooded tiles
        if (amphibious && !isWater(t) && !t.flooded) stop = true;
        if (UNITS[u.type].naval && !isWater(t) && t.flooded) stop = true;
        if (!occ && !ends.has(i)) {
          ends.set(i, kind);
          if (!parent.has(i)) parent.set(i, cur);
        }
        if (stop) continue;
        if (best.get(i) === undefined || total < best.get(i)!) {
          best.set(i, total);
          parent.set(i, cur);
          queue.push(i);
        }
      }
    }
  }
  ends.delete(start);
  return { targets: [...ends.entries()].map(([i, kind]) => ({ x: i % n, y: Math.floor(i / n), kind })), parent };
}

/** Tiles explored around a coord for a unit (scout or mountain: radius 2). */
export function sightRadius(s: GameState, u: Unit): number {
  if (has(u, "scout")) return 2;
  return tileAt(s, u.x, u.y).terrain === "mountain" ? 2 : 1;
}
