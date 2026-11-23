/**
 * A simple greedy bot. It only picks from legalActions(), scoring each action
 * by a hand-written heuristic, and ends its turn when nothing scores above 0.
 * Useful as an opponent for humans and as a baseline for RL agents.
 */
import { applyAction, legalActions } from "./actions";
import { computeDamageRounded } from "./combat";
import { BUILDS, TECH_BY_ID, UNITS } from "./data";
import { dist, idx } from "./grid";
import { reachable } from "./movement";
import { capitalOf, cityById, techCost } from "./state";
import type { Action, Coord, GameState, Unit } from "./types";

/** deterministic small noise so bots don't all behave identically */
function noise(s: GameState, k: number): number {
  let h = (s.seed ^ (s.turn * 7919) ^ (k * 104729)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h % 1000) / 1000;
}

/** where should this unit go? nearest claimable village/enemy city, else fog, else enemies */
function goal(s: GameState, u: Unit): Coord | null {
  const n = s.mapSize;
  const pl = s.players[u.owner];
  let best: Coord | null = null;
  let bestD = Infinity;
  const consider = (c: Coord, bias: number) => {
    const d = dist(u, c) + bias;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  };
  s.tiles.forEach((t, i) => {
    if (pl.explored[i] !== 1) return;
    const c = { x: i % n, y: Math.floor(i / n) };
    if (t.village) consider(c, 0);
    if (t.ruin) consider(c, 1);
    if (t.cityId !== null && cityById(s, t.cityId)?.owner !== u.owner) consider(c, 1);
  });
  for (const e of s.units) {
    if (e.owner !== u.owner && pl.explored[idx(n, e.x, e.y)] === 1) consider(e, 2);
  }
  if (best) return best;
  // frontier: an explored tile next to fog
  for (let i = 0; i < s.tiles.length; i++) {
    if (pl.explored[i] === 1) continue;
    consider({ x: i % n, y: Math.floor(i / n) }, 0);
  }
  return best;
}

function scoreAction(s: GameState, a: Action): number {
  const p = s.current;
  const pl = s.players[p];
  switch (a.type) {
    case "reward": {
      const prefs: Record<string, number> = {
        workshop: 5, explorer: 3, resources: 5, cityWall: 2, populationGrowth: 5,
        borderGrowth: 3, superUnit: 6, park: 4,
      };
      return prefs[a.reward] ?? 1;
    }
    case "capture":
      return 100;
    case "examine":
      return 60;
    case "promote":
      return 90;
    case "harvestStarfish":
      return 40;
    case "attack": {
      const u = s.units.find((x) => x.id === a.unitId)!;
      const t = s.units.find((x) => x.id === a.targetId)!;
      if (UNITS[u.type].attack === 0) return 30;
      const r = computeDamageRounded(s, u, t);
      return r.damage >= t.hp ? 80 + UNITS[t.type].cost : 20 + r.damage - r.retaliation;
    }
    case "build": {
      const def = BUILDS[a.building];
      if (def.kind === "monument") return 70;
      if (def.kind === "destroy" || a.building === "growForest" || a.building === "burnForest") return -1;
      if (def.kind === "road" || def.kind === "bridge" || def.kind === "embassy") return pl.stars > 15 ? 3 : -1;
      if (def.kind === "temple") return pl.stars > 30 ? 4 : -1;
      if (a.building === "clearForest") return -1;
      if (def.pop > 0) return 25 + 6 * def.pop - def.cost + noise(s, a.at.x * 31 + a.at.y);
      return pl.stars > 10 ? 8 : -1;
    }
    case "research": {
      const cost = techCost(s, p, a.tech);
      const tier = TECH_BY_ID[a.tech].tier;
      return pl.stars - cost >= 2 ? 18 - cost - tier + noise(s, a.tech.length) * 4 : -1;
    }
    case "train": {
      const def = UNITS[a.unit];
      const units = s.units.filter((x) => x.owner === p).length;
      const cities = s.cities.filter((c) => c.owner === p).length;
      if (units > cities * 3) return -1;
      const strength = def.attack + def.defence + (def.hp ?? 10) / 5;
      return 12 + strength - def.cost / 2 + noise(s, a.cityId + a.unit.length);
    }
    case "move": {
      const u = s.units.find((x) => x.id === a.unitId)!;
      const g = goal(s, u);
      if (!g) return -1;
      const gain = dist(u, g) - dist(a.to, g);
      return gain > 0 ? 10 + gain + noise(s, u.id * 13 + a.to.x + a.to.y) : -1;
    }
    case "recover": {
      const u = s.units.find((x) => x.id === a.unitId)!;
      return u.hp < u.maxHp / 2 ? 15 : -1;
    }
    case "healOthers":
      return 15;
    case "upgrade":
      return pl.stars > 20 ? 6 : -1;
    default:
      return -1;
  }
}

export function botStep(s: GameState): Action {
  const actions = legalActions(s);
  let best: Action = { type: "endTurn" };
  let bestScore = 0;
  for (const a of actions) {
    if (a.type === "endTurn") continue;
    const sc = scoreAction(s, a);
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  // a pending reward must be answered
  if (best.type === "endTurn" && actions[0]?.type === "reward") return actions[0];
  return best;
}

/** play the current player's whole turn with the bot policy */
export function playBotTurn(s: GameState, maxActions = 300): GameState {
  const p = s.current;
  let cur = s;
  for (let i = 0; i < maxActions && !cur.over && cur.current === p; i++) {
    cur = applyAction(cur, botStep(cur));
  }
  if (!cur.over && cur.current === p) cur = applyAction(cur, { type: "endTurn" });
  return cur;
}

export { capitalOf, reachable };
