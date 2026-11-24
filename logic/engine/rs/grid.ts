/** grid.ts on the Rust engine: the pure coordinate helpers stay TypeScript */
import { call } from "../rust";
import type { GameState } from "../types";

export { around, dist, idx, inBounds, isWater, tileAt } from "../grid";

/** deep copy of a game state (through the Rust engine's state) */
export const cloneState = (s: GameState): GameState => call("cloneState", s);
