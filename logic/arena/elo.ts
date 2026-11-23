/**
 * Multiplayer Elo. A finished game is ranked (winner first, then by final
 * score), and every pair of seats with different keys plays one virtual
 * match: the higher-ranked seat "won" it (equal scores draw). K is divided by
 * (players - 1) so a 4-player game moves ratings about as much as one duel.
 */
import { seatKey, type GameRecord } from "./record";

export const START_RATING = 1200;
export const K = 32;

export type Rating = { rating: number; games: number; wins: number; updated: string };
export type Ratings = Record<string, Rating>;

export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** rank value per seat: higher = better. The winner always ranks first. */
function standing(rec: GameRecord): number[] {
  const r = rec.result!;
  return r.scores.map((sc, i) => (i === r.winner ? Number.MAX_SAFE_INTEGER : sc));
}

/** apply one finished game; returns the rating change per seat */
export function applyGame(ratings: Ratings, rec: GameRecord): number[] {
  const deltas = rec.seats.map(() => 0);
  if (!rec.result || !rec.result.over) return deltas;
  const keys = rec.seats.map(seatKey);
  const n = keys.length;
  const k = K / Math.max(1, n - 1);
  const get = (key: string) => ratings[key]?.rating ?? START_RATING;
  const before = keys.map(get);
  const st = standing(rec);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (keys[i] === keys[j]) continue; // a model against itself teaches the ratings nothing
      const sI = st[i] > st[j] ? 1 : st[i] < st[j] ? 0 : 0.5;
      const eI = expected(before[i], before[j]);
      deltas[i] += k * (sI - eI);
      deltas[j] += k * (1 - sI - (1 - eI));
    }
  }
  const counted = new Set<string>();
  keys.forEach((key, i) => {
    const cur = ratings[key] ?? { rating: START_RATING, games: 0, wins: 0, updated: "" };
    // the same key in several seats: average its deltas, count the game once
    const same = keys.map((k2, j) => (k2 === key ? j : -1)).filter((j) => j >= 0);
    if (counted.has(key)) return;
    counted.add(key);
    const d = same.reduce((acc, j) => acc + deltas[j], 0) / same.length;
    ratings[key] = {
      rating: Math.round((cur.rating + d) * 10) / 10,
      games: cur.games + 1,
      wins: cur.wins + (same.includes(rec.result!.winner ?? -1) ? 1 : 0),
      updated: rec.endedAt ?? new Date().toISOString(),
    };
    void i;
  });
  return deltas.map((d) => Math.round(d * 10) / 10);
}

/** recompute all ratings from scratch, oldest game first */
export function rebuild(records: GameRecord[]): Ratings {
  const ratings: Ratings = {};
  [...records]
    .filter((r) => r.result?.over)
    .sort((a, b) => (a.endedAt ?? "").localeCompare(b.endedAt ?? ""))
    .forEach((r) => applyGame(ratings, r));
  return ratings;
}
