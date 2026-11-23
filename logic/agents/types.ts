/**
 * Opponent models. Every seat that is not a human is driven by an Agent built
 * from a ModelSpec (the contents of models/<id>/model.json). Agents only ever
 * choose among legalActions(state), so any model is guaranteed to play legally.
 */
import type { Action, GameState } from "../engine/types";
import type { GreedyWeights } from "../engine/bot";

export type ModelKind = "greedy" | "random" | "llm" | "external";

export type ModelSpec = {
  /** folder name under models/, also the Elo key ("model:<id>") */
  id: string;
  /** display name in the menu */
  name: string;
  kind: ModelKind;
  description: string;
  created: string;
  /** greedy: weight overrides on top of DEFAULT_WEIGHTS */
  weights?: Partial<GreedyWeights>;
  /** llm: OpenAI-compatible chat endpoint and model id (LM Studio by default) */
  llm?: {
    endpoint: string;
    model: string;
    temperature?: number;
    /** at most this many candidate actions are shown to the model per decision */
    maxCandidates?: number;
    /** model id used when the LLM is unreachable or answers nonsense */
    fallback?: string;
  };
};

export interface Agent {
  spec: ModelSpec;
  /** choose one of legalActions(state) for state.current */
  act(state: GameState): Promise<Action>;
  /** LLM agents count how often the model itself decided vs. fell back */
  stats?: { decisions: number; byModel: number; fallbacks: number; lastError: string };
}

/** an OpenAI-style chat call; injected so the browser can go through the arena server */
export type ChatFn = (req: {
  endpoint: string;
  model: string;
  temperature: number;
  messages: { role: "system" | "user"; content: string }[];
}) => Promise<string>;
