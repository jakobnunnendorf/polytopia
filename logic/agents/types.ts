/**
 * Opponent models. Every seat that is not a human is driven by an Agent built
 * from a ModelSpec (the contents of models/<id>/model.json). Agents only ever
 * choose among legalActions(state), so any model is guaranteed to play legally.
 */
import type { Action, GameState } from "../engine/types";
import type { GreedyWeights } from "../engine/bot";
import type { PartialFullWeights } from "../engine/botFull";

export type ModelKind = "greedy" | "greedy-full" | "random";

export type ModelSpec = {
  /** folder name under models/, also the Elo key ("model:<id>") */
  id: string;
  /** display name in the menu */
  name: string;
  kind: ModelKind;
  description: string;
  /**
   * superseded: kept for training scripts, tests and old games (which still replay), but not offered
   * in the setup screen's model picker
   */
  hidden?: boolean;
  /** one plain line for the model card (what it does, not how it was tuned) */
  tagline?: string;
  /** how it was made (scripts/train-*.ts, scripts/sweep.ts); the card shows a few of these */
  training?: {
    method?: string;
    /** the model it started from */
    from?: string;
    trainingGames?: number;
    gamesPerPoint?: number;
    points?: string[];
    duration?: string;
    [k: string]: unknown;
  };
  created: string;
  /** greedy: weight overrides on top of DEFAULT_WEIGHTS */
  weights?: Partial<GreedyWeights>;
  /** greedy-full: weight overrides on top of DEFAULT_FULL_WEIGHTS (logic/engine/botFull.ts) */
  full?: PartialFullWeights;
};

export interface Agent {
  spec: ModelSpec;
  /** choose one of legalActions(state) for state.current */
  act(state: GameState): Promise<Action>;
}

