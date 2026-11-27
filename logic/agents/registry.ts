/**
 * Builds Agents from model specs. The specs themselves live in models/<id>/model.json;
 * BUILTIN_MODELS mirrors them so the app still works when the arena server is down.
 */
import { legalActions } from "../engine/actions";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "../engine/bot";
import { fullBotStep, fullWeights } from "../engine/botFull";
import type { GameState } from "../engine/types";
import type { Agent, ModelSpec } from "./types";

import greedyV1 from "../../models/greedy-v1/model.json";
import randomV1 from "../../models/random-v1/model.json";

export const BUILTIN_MODELS: ModelSpec[] = [greedyV1, randomV1] as ModelSpec[];
export const DEFAULT_MODEL = "greedy-v1";

function rngFor(s: GameState): () => number {
  // seeded by game + step so random games are replayable
  let x = (s.seed ^ (s.turn * 2654435761) ^ (s.log.length * 40503)) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function greedyAgent(spec: ModelSpec): Agent {
  const w: GreedyWeights = {
    ...DEFAULT_WEIGHTS,
    ...(spec.weights ?? {}),
    rewards: { ...DEFAULT_WEIGHTS.rewards, ...(spec.weights?.rewards ?? {}) },
  };
  return { spec, act: async (s) => botStep(s, w) };
}

/** the full-action-space greedy bot (kind "greedy-full") */
export function greedyFullAgent(spec: ModelSpec): Agent {
  const w = fullWeights(spec.full);
  return { spec, act: async (s) => fullBotStep(s, w) };
}

export function randomAgent(spec: ModelSpec): Agent {
  return {
    spec,
    act: async (s) => {
      const legal = legalActions(s);
      // end the turn less often than any other move, otherwise random play barely moves
      const r = rngFor(s)();
      if (legal.length > 1 && r < 0.9) {
        const rest = legal.filter((a) => a.type !== "endTurn");
        return rest[Math.floor(rngFor({ ...s, turn: s.turn + 7 })() * rest.length)];
      }
      return legal[Math.floor(r * legal.length)] ?? { type: "endTurn" };
    },
  };
}

export function createAgent(spec: ModelSpec): Agent {
  switch (spec.kind) {
    case "greedy":
      return greedyAgent(spec);
    case "greedy-full":
      return greedyFullAgent(spec);
    case "random":
      return randomAgent(spec);
    default:
      return greedyAgent(greedyV1 as ModelSpec);
  }
}
