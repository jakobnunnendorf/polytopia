/**
 * The full-action-space greedy bot (model kind "greedy-full").
 *
 * It scores every action legalActions() offers with the greedy bot's own
 * heuristic (bot.ts scoreAction, weights in `greedy`), then scales the score by
 * one knob per action type and one per id: per tech (research), per unit type
 * (train, upgrade), per build or ability (build) and per city reward (reward).
 * So a hill climber can learn to prefer any option, e.g. researching
 * Mathematics and training catapults.
 *
 * Actions the greedy heuristic rejects (score <= 0: breaking a treaty,
 * disbanding, infiltrating, roads when poor, ...) score `open[type] * id - 1`
 * instead. With the defaults (open 0.5) that stays below 0, so they are still
 * never chosen, but a climber that raises an open knob (or the id knob) above 1
 * unlocks them as a fallback, played when nothing scores better.
 *
 * Moves get one more feature: `centre` points per tile of Chebyshev distance
 * to the map centre ((size-1)/2, (size-1)/2) the move removes (negative when
 * the move heads for the edge), added to the greedy move score.
 *
 * With centre 0, every multiplier 1 and every open knob 0 the bot plays
 * exactly like botStep() with the same greedy weights.
 */
import { applyAction, legalActions } from "./actions";
import { DEFAULT_WEIGHTS, goal, noise, scoreAction, type GreedyWeights } from "./bot";
import { BUILDS, TECHS, UNITS } from "./data";
import { dist } from "./grid";
import type { Action, Coord, GameState } from "./types";

export type FullActionType = Exclude<Action["type"], "endTurn">;

// a Record so the compiler insists on every action type
const TYPE_SET: Record<FullActionType, true> = {
  research: true,
  move: true,
  attack: true,
  capture: true,
  recover: true,
  examine: true,
  disband: true,
  upgrade: true,
  promote: true,
  healOthers: true,
  harvestStarfish: true,
  infiltrate: true,
  train: true,
  build: true,
  reward: true,
  freezeArea: true,
  swarm: true,
  explode: true,
  breakIce: true,
  drain: true,
  decompose: true,
  offerPeace: true,
  acceptPeace: true,
  declinePeace: true,
  breakPeace: true,
};
export const FULL_ACTION_TYPES = Object.keys(TYPE_SET) as FullActionType[];

/** city level-up rewards (actions.ts doReward) */
export const REWARD_IDS = ["workshop", "explorer", "cityWall", "resources", "populationGrowth", "borderGrowth", "park", "superUnit"];

export type FullWeights = {
  /** the greedy bot's feature weights (bot.ts) */
  greedy: GreedyWeights;
  /** multiplier on a positive score, per action type */
  type: Record<FullActionType, number>;
  /** score of an action the heuristic rejects: open * id weight - 1 (chosen only when above 0) */
  open: Record<FullActionType, number>;
  /** per tech id (research) */
  tech: Record<string, number>;
  /** per unit type (train, upgrade to) */
  unit: Record<string, number>;
  /** per build or ability id (build) */
  build: Record<string, number>;
  /** per city reward (reward) */
  reward: Record<string, number>;
  /** move score per tile of distance to the map centre removed */
  centre: number;
};

const all = <K extends string>(keys: readonly K[], v: number) => Object.fromEntries(keys.map((k) => [k, v])) as Record<K, number>;

export const DEFAULT_FULL_WEIGHTS: FullWeights = {
  greedy: DEFAULT_WEIGHTS,
  type: all(FULL_ACTION_TYPES, 1),
  open: all(FULL_ACTION_TYPES, 0.5),
  tech: all(
    TECHS.map((t) => t.id),
    1,
  ),
  unit: all(Object.keys(UNITS), 1),
  build: all(Object.keys(BUILDS), 1),
  reward: all(REWARD_IDS, 1),
  centre: 1,
};

export type PartialFullWeights = { [K in keyof FullWeights]?: FullWeights[K] extends number ? number : Partial<FullWeights[K]> };

/** a model file's (partial) weights on top of the defaults */
export function fullWeights(p: PartialFullWeights = {}): FullWeights {
  const d = DEFAULT_FULL_WEIGHTS;
  return {
    greedy: { ...d.greedy, ...(p.greedy ?? {}), rewards: { ...d.greedy.rewards, ...(p.greedy?.rewards ?? {}) } },
    type: { ...d.type, ...(p.type ?? {}) } as FullWeights["type"],
    open: { ...d.open, ...(p.open ?? {}) } as FullWeights["open"],
    tech: { ...d.tech, ...(p.tech ?? {}) } as FullWeights["tech"],
    unit: { ...d.unit, ...(p.unit ?? {}) } as FullWeights["unit"],
    build: { ...d.build, ...(p.build ?? {}) } as FullWeights["build"],
    reward: { ...d.reward, ...(p.reward ?? {}) } as FullWeights["reward"],
    centre: p.centre ?? d.centre,
  };
}

/** Chebyshev distance to the map centre */
export function centreDist(n: number, c: Coord): number {
  const m = (n - 1) / 2;
  return Math.max(Math.abs(c.x - m), Math.abs(c.y - m));
}

function moveScore(s: GameState, a: Extract<Action, { type: "move" }>, w: FullWeights): number {
  const u = s.units.find((x) => x.id === a.unitId)!;
  const g = goal(s, u);
  if (!g) return -1;
  const gain = dist(u, g) - dist(a.to, g);
  if (gain <= 0) return -1;
  const toCentre = centreDist(s.mapSize, u) - centreDist(s.mapSize, a.to);
  return w.greedy.move + gain + w.centre * toCentre + w.greedy.noise * noise(s, u.id * 13 + a.to.x + a.to.y);
}

function idWeight(a: Action, w: FullWeights): number {
  switch (a.type) {
    case "research":
      return w.tech[a.tech] ?? 1;
    case "train":
      return w.unit[a.unit] ?? 1;
    case "upgrade":
      return w.unit[a.to] ?? 1;
    case "build":
      return w.build[a.building] ?? 1;
    case "reward":
      return w.reward[a.reward] ?? 1;
    default:
      return 1;
  }
}

export function scoreFull(s: GameState, a: Action, w: FullWeights = DEFAULT_FULL_WEIGHTS): number {
  if (a.type === "endTurn") return 0;
  const base = a.type === "move" ? moveScore(s, a, w) : scoreAction(s, a, w.greedy);
  const id = idWeight(a, w);
  return base > 0 ? base * w.type[a.type] * id : w.open[a.type] * id - 1;
}

export function fullBotStep(s: GameState, w: FullWeights = DEFAULT_FULL_WEIGHTS): Action {
  const actions = legalActions(s);
  let best: Action = { type: "endTurn" };
  let bestScore = 0;
  for (const a of actions) {
    if (a.type === "endTurn") continue;
    const sc = scoreFull(s, a, w);
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  // a pending reward must be answered
  if (best.type === "endTurn" && actions[0]?.type === "reward") return actions[0];
  return best;
}

/** play the current player's whole turn with the full bot */
export function playFullBotTurn(s: GameState, maxActions = 300, w: FullWeights = DEFAULT_FULL_WEIGHTS): GameState {
  const p = s.current;
  let cur = s;
  for (let i = 0; i < maxActions && !cur.over && cur.current === p; i++) {
    cur = applyAction(cur, fullBotStep(cur, w));
  }
  if (!cur.over && cur.current === p) cur = applyAction(cur, { type: "endTurn" });
  return cur;
}
