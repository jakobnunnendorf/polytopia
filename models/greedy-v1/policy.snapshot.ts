// FROZEN SNAPSHOT of logic/engine/bot.ts for model greedy-v1 (2026-11-23). Do not edit; copy into a new model folder instead.
/**
 * A simple greedy bot. It only picks from legalActions(), scoring each action
 * by a hand-written heuristic, and ends its turn when nothing scores above 0.
 * Every number in the heuristic is a named weight, so different versions of
 * this bot can be saved as models (models/<name>/model.json) and rated by Elo.
 */
import { applyAction, legalActions } from "@/logic/engine/actions";
import { computeDamageRounded } from "@/logic/engine/combat";
import { BUILDS, TECH_BY_ID, UNITS } from "@/logic/engine/data";
import { dist, idx } from "@/logic/engine/grid";
import { reachable } from "@/logic/engine/movement";
import { capitalOf, cityById, techCost } from "@/logic/engine/state";
import type { Action, Coord, GameState, Unit } from "@/logic/engine/types";

export type GreedyWeights = {
  capture: number;
  examine: number;
  promote: number;
  harvestStarfish: number;
  monument: number;
  /** score of a killing blow, plus the victim's cost */
  kill: number;
  /** base score of a non-lethal hit, plus damage minus retaliation */
  hit: number;
  /** attack with a 0-attack unit (convert, etc.) */
  special: number;
  /** pop-giving build: base + perPop * pop - cost */
  growBase: number;
  growPerPop: number;
  /** other buildings when stars > richAt */
  otherBuild: number;
  richAt: number;
  /** research: base - cost - tier, only if 2 stars remain afterwards */
  research: number;
  /** train: base + strength - cost/2, while units <= cities * unitsPerCity */
  train: number;
  unitsPerCity: number;
  /** move: base + distance gained toward the unit's goal */
  move: number;
  recover: number;
  healOthers: number;
  upgrade: number;
  /** random tie-break spread */
  noise: number;
  rewards: Record<string, number>;
};

export const DEFAULT_WEIGHTS: GreedyWeights = {
  capture: 100,
  examine: 60,
  promote: 90,
  harvestStarfish: 40,
  monument: 70,
  kill: 80,
  hit: 20,
  special: 30,
  growBase: 25,
  growPerPop: 6,
  otherBuild: 8,
  richAt: 10,
  research: 18,
  train: 12,
  unitsPerCity: 3,
  move: 10,
  recover: 15,
  healOthers: 15,
  upgrade: 6,
  noise: 1,
  rewards: {
    workshop: 5,
    explorer: 3,
    resources: 5,
    cityWall: 2,
    populationGrowth: 5,
    borderGrowth: 3,
    superUnit: 6,
    park: 4,
  },
};

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

export function scoreAction(s: GameState, a: Action, w: GreedyWeights = DEFAULT_WEIGHTS): number {
  const p = s.current;
  const pl = s.players[p];
  switch (a.type) {
    case "reward":
      return w.rewards[a.reward] ?? 1;
    case "capture":
      return w.capture;
    case "examine":
      return w.examine;
    case "promote":
      return w.promote;
    case "harvestStarfish":
      return w.harvestStarfish;
    case "attack": {
      const u = s.units.find((x) => x.id === a.unitId)!;
      const t = s.units.find((x) => x.id === a.targetId)!;
      if (UNITS[u.type].attack === 0) return w.special;
      const r = computeDamageRounded(s, u, t);
      return r.damage >= t.hp ? w.kill + UNITS[t.type].cost : w.hit + r.damage - r.retaliation;
    }
    case "build": {
      const def = BUILDS[a.building];
      if (def.kind === "monument") return w.monument;
      if (def.kind === "destroy" || a.building === "growForest" || a.building === "burnForest") return -1;
      if (def.kind === "road" || def.kind === "bridge" || def.kind === "embassy") return pl.stars > 15 ? 3 : -1;
      if (def.kind === "temple") return pl.stars > 30 ? 4 : -1;
      if (a.building === "clearForest") return -1;
      if (def.pop > 0) return w.growBase + w.growPerPop * def.pop - def.cost + w.noise * noise(s, a.at.x * 31 + a.at.y);
      return pl.stars > w.richAt ? w.otherBuild : -1;
    }
    case "research": {
      const cost = techCost(s, p, a.tech);
      const tier = TECH_BY_ID[a.tech].tier;
      return pl.stars - cost >= 2 ? w.research - cost - tier + w.noise * noise(s, a.tech.length) * 4 : -1;
    }
    case "train": {
      const def = UNITS[a.unit];
      const units = s.units.filter((x) => x.owner === p).length;
      const cities = s.cities.filter((c) => c.owner === p).length;
      if (units > cities * w.unitsPerCity) return -1;
      const strength = def.attack + def.defence + (def.hp ?? 10) / 5;
      return w.train + strength - def.cost / 2 + w.noise * noise(s, a.cityId + a.unit.length);
    }
    case "move": {
      const u = s.units.find((x) => x.id === a.unitId)!;
      const g = goal(s, u);
      if (!g) return -1;
      const gain = dist(u, g) - dist(a.to, g);
      return gain > 0 ? w.move + gain + w.noise * noise(s, u.id * 13 + a.to.x + a.to.y) : -1;
    }
    case "recover": {
      const u = s.units.find((x) => x.id === a.unitId)!;
      return u.hp < u.maxHp / 2 ? w.recover : -1;
    }
    case "healOthers":
      return w.healOthers;
    case "upgrade":
      return pl.stars > 20 ? w.upgrade : -1;
    default:
      return -1;
  }
}

export function botStep(s: GameState, w: GreedyWeights = DEFAULT_WEIGHTS): Action {
  const actions = legalActions(s);
  let best: Action = { type: "endTurn" };
  let bestScore = 0;
  for (const a of actions) {
    if (a.type === "endTurn") continue;
    const sc = scoreAction(s, a, w);
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
export function playBotTurn(s: GameState, maxActions = 300, w: GreedyWeights = DEFAULT_WEIGHTS): GameState {
  const p = s.current;
  let cur = s;
  for (let i = 0; i < maxActions && !cur.over && cur.current === p; i++) {
    cur = applyAction(cur, botStep(cur, w));
  }
  if (!cur.over && cur.current === p) cur = applyAction(cur, { type: "endTurn" });
  return cur;
}

export { capitalOf, reachable };
