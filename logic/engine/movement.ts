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

/** can `player` see unit `u` (explored tile, and not hidden unless adjacent to one of player's units) */
export function canSee(s: GameState, player: number, u: Unit): boolean {
  if (u.owner === player) return true;
  if (s.players[player].explored[idx(s.mapSize, u.x, u.y)] !== 1) return false;
  if (!u.hidden) return true;
  return s.units.some(
    (o) => o.owner === player && Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y)) <= 1,
  );
}

/** road-network tile for a player (§4.4): road, bridge, village, city; not in enemy territory */
function roadNode(s: GameState, t: Tile, player: number): boolean {
  if (!(t.road || t.building === "bridge" || t.village || t.cityId !== null)) return false;
  const o = territoryOwner(s, t);
  return o === null || o === player;
}

export type StepKind = "normal" | "embark" | "disembark";

/** whether unit u (as it is now) may stand on / step onto tile t, and how */
export function enterKind(s: GameState, u: Unit, t: Tile): StepKind | null {
  const p = u.owner;
  const def = UNITS[u.type];
  if (has(u, "fly")) return "normal";
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
    if (t.building === "port" && territoryOwner(s, t) === p && techOf(s, p, "fishing")) return "embark";
    return null;
  }
  if (t.terrain === "mountain" && !techOf(s, p, "climbing")) return null;
  return "normal";
}

export type MoveTarget = Coord & { kind: StepKind };

/** All tiles unit u can end its move on this turn. */
export function reachable(s: GameState, u: Unit): MoveTarget[] {
  if (u.frozen || UNITS[u.type].movement === 0) return [];
  const n = s.mapSize;
  const explored = s.players[u.owner].explored;
  const skate = has(u, "skate");
  // Skate: a move that starts on ice may use the unit's ice movement (Battle Sled 3)
  const startsOnIce = !!tileAt(s, u.x, u.y).ice;
  const baseMov = skate && startsOnIce ? (UNITS[u.type].iceMovement ?? UNITS[u.type].movement) : UNITS[u.type].movement;
  const rawMov = baseMov + (u.boosted ? 1 : 0) - (u.poisoned ? 1 : 0);
  // movement points (a step costs 1, road to road 0.5, a Glide ice step 0.9)
  let budget = Math.max(1, rawMov);
  // Eat: while the Centipede has segments it moves only 1 tile
  if (has(u, "eat") && s.units.some((o) => o.bodyOf === u.id)) budget = 1;
  // Glide (Polarism): Polaris ice steps cost 0.9
  const glide = s.players[u.owner].clan === "polaris" && techOf(s, u.owner, "aquatism");
  const creep = has(u, "creep") || has(u, "fly");
  const ignoresZoc = creep || has(u, "hide") || has(u, "infiltrate");
  const occupied = new Map<number, Unit>();
  for (const o of s.units) occupied.set(idx(n, o.x, o.y), o);
  const enemyAdjacent = (x: number, y: number) =>
    around(n, { x, y }, 1).some((c) => {
      const o = occupied.get(idx(n, c.x, c.y));
      // Centipede segments exert no zone of control
      return o !== undefined && o.owner !== u.owner && !o.hidden && o.type !== "segment";
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
        // enemy units block (hidden movers may pass through), friendly units can be passed
        if (occ && occ.owner !== u.owner && !has(u, "hide")) continue;
        // roads give no bonus on ice or to skaters
        const road =
          !creep && !skate && !UNITS[u.type].naval && !from.ice && !t.ice &&
          roadNode(s, from, u.owner) && roadNode(s, t, u.owner);
        const cost = road ? 0.5 : glide && t.ice ? 0.9 : 1;
        const total = spent + cost;
        let stop = kind !== "normal";
        if (!creep && t.terrain === "mountain") stop = true;
        if (!creep && t.terrain === "forest" && !road) stop = true;
        // Skate: on land at most 1 tile
        if (skate && !isWater(t)) stop = true;
        // algae ends the move of land units
        if (!creep && t.algae && !UNITS[u.type].naval) stop = true;
        if (!ignoresZoc && enemyAdjacent(x, y)) stop = true;
        if (!occ && !ends.has(i)) ends.set(i, kind);
        if (stop) continue;
        if (best.get(i) === undefined || total < best.get(i)!) {
          best.set(i, total);
          queue.push(i);
        }
      }
    }
  }
  ends.delete(start);
  return [...ends.entries()].map(([i, kind]) => ({ x: i % n, y: Math.floor(i / n), kind }));
}

/** Tiles explored around a coord for a unit (scout or mountain: radius 2). */
export function sightRadius(s: GameState, u: Unit): number {
  if (has(u, "scout")) return 2;
  return tileAt(s, u.x, u.y).terrain === "mountain" ? 2 : 1;
}
