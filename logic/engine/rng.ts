/**
 * Seeded pseudo-random generator (mulberry32).
 *
 * The generator's whole state is one 32-bit integer, which lives inside the
 * GameState (`state.rng`). That keeps every game exactly replayable from its
 * seed plus its action list, which is what an RL setup needs.
 */
export type Rng = {
  /** float in [0, 1) */
  next(): number;
  /** integer in [min, max] (inclusive) */
  int(min: number, max: number): number;
  /** random element of a non-empty array */
  pick<T>(items: readonly T[]): T;
  /** current internal state, to store back into the game state */
  state(): number;
  /** continue from internal state `s` (as returned by state()) */
  setState?(s: number): void;
};

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    state: () => s,
    setState: (v) => {
      s = v >>> 0;
    },
  };
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
