/**
 * Builds Agents from model specs. The specs themselves live in models/<id>/model.json;
 * BUILTIN_MODELS mirrors them so the app still works when the arena server is down.
 */
import { legalActions } from "../engine/actions";
import { DEFAULT_WEIGHTS, botStep, type GreedyWeights } from "../engine/bot";
import type { GameState } from "../engine/types";
import { llmAgent } from "./llm";
import type { Agent, ChatFn, ModelSpec } from "./types";

import greedyV1 from "../../models/greedy-v1/model.json";
import randomV1 from "../../models/random-v1/model.json";
import qwen from "../../models/qwen3-coder-lmstudio/model.json";

export const BUILTIN_MODELS: ModelSpec[] = [greedyV1, randomV1, qwen] as ModelSpec[];
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

export function createAgent(spec: ModelSpec, chat: ChatFn, all: ModelSpec[] = BUILTIN_MODELS): Agent {
  switch (spec.kind) {
    case "greedy":
      return greedyAgent(spec);
    case "random":
      return randomAgent(spec);
    case "llm": {
      const fb = all.find((m) => m.id === (spec.llm?.fallback ?? DEFAULT_MODEL)) ?? greedyV1;
      return llmAgent(spec, chat, greedyAgent(fb as ModelSpec));
    }
    default:
      return greedyAgent(greedyV1 as ModelSpec);
  }
}

/** direct OpenAI-compatible call (Node, or a browser on the same machine as LM Studio) */
export const directChat: ChatFn = async ({ endpoint, model, temperature, messages }) => {
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature, messages, max_tokens: 16, stream: false }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
};
