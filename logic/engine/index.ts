/** Public engine API (UI, simulations, RL). */
export { createGame, income, scoreOf, techCost } from "./state";
export type { NewGameOptions } from "./state";
export { applyAction, legalActions } from "./actions";
export { botStep, playBotTurn } from "./bot";
export { observe } from "./observe";
export type { Action, GameState } from "./types";
