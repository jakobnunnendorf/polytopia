/**
 * Ratings: Bradley–Terry maximum likelihood with a BayesElo-style prior and
 * bootstrap confidence intervals (the method behind LMArena's leaderboard and
 * BayesElo in computer chess).
 *
 * - Every finished game is ranked (winner first, then by final score). Every
 *   pair of seats with different keys is one virtual match: the higher-ranked
 *   seat won it, equal standing is a draw (half a win each). A game with n
 *   players weighs each of its pairs by 1/(n-1), so it counts about as much
 *   as one duel per player.
 * - Ratings are the strengths that best explain ALL games at once, so the
 *   order games were played in does not matter (unlike classic Elo updates).
 * - Prior: every player also drew one virtual game (a win and a loss) against
 *   a fixed opponent rated 1200. Players with few games stay near 1200 instead
 *   of jumping to extremes; with many games the prior washes out.
 * - lo/hi: the 95% interval from refitting on games resampled with replacement.
 * - Scale: classic Elo, 400 points = 10:1 odds, a 1200 player is the anchor.
 * - Filters: the same fit over only the games of one mode, player count, map
 *   size or map type gives a player's rating in that kind of game.
 */
import { seatKey, type GameRecord } from "./record";

export const START_RATING = 1200;
const SCALE = 400 / Math.LN10;

export type Rating = {
  rating: number;
  games: number;
  wins: number;
  updated: string;
  /** 95% confidence interval from the bootstrap */
  lo?: number;
  hi?: number;
};
export type Ratings = Record<string, Rating>;

/** one rated game, compact: what the fit and the filters need */
export type ResultRow = {
  id: string;
  endedAt: string;
  keys: string[];
  standing: number[];
  winner: number | null;
  mode: string;
  players: number;
  size: number;
  mapType: string;
};

/** which games a rating is fitted on; an empty filter means all games */
export type RatingFilter = { mode?: string; players?: number; size?: number; mapType?: string };

export function matchesFilter(row: ResultRow, f: RatingFilter): boolean {
  return (
    (f.mode === undefined || row.mode === f.mode) &&
    (f.players === undefined || row.players === f.players) &&
    (f.size === undefined || row.size === f.size) &&
    (f.mapType === undefined || row.mapType === f.mapType)
  );
}

/** how many rated games exist per mode, player count, map size and map type (for filter menus) */
export function facets(rows: ResultRow[]): { mode: Record<string, number>; players: Record<string, number>; size: Record<string, number>; mapType: Record<string, number> } {
  const out = { mode: {} as Record<string, number>, players: {} as Record<string, number>, size: {} as Record<string, number>, mapType: {} as Record<string, number> };
  for (const r of rows) {
    out.mode[r.mode] = (out.mode[r.mode] ?? 0) + 1;
    out.players[r.players] = (out.players[r.players] ?? 0) + 1;
    out.size[r.size] = (out.size[r.size] ?? 0) + 1;
    out.mapType[r.mapType] = (out.mapType[r.mapType] ?? 0) + 1;
  }
  return out;
}

/** chance that a player rated a beats one rated b */
export function expected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export function resultRow(rec: GameRecord): ResultRow | null {
  if (!rec.result?.over) return null;
  const r = rec.result;
  return {
    id: rec.id,
    endedAt: rec.endedAt ?? "",
    keys: rec.seats.map(seatKey),
    // the winner always ranks first, the rest by final score
    standing: r.scores.map((sc, i) => (i === r.winner ? Number.MAX_SAFE_INTEGER : sc)),
    winner: r.winner ?? null,
    mode: rec.options.mode,
    players: rec.seats.length,
    size: rec.options.mapSize,
    mapType: rec.options.mapType ?? "drylands",
  };
}

type Tally = { players: string[]; W: number[]; N: number[][] };

/** wins and weighted match counts per pair, including the prior's virtual games */
function tally(rows: ResultRow[], players: string[]): Tally {
  const idx = new Map(players.map((p, i) => [p, i]));
  const n = players.length;
  const W = new Array(n + 1).fill(0); // index n = the 1200 prior opponent
  const N = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (const row of rows) {
    const m = row.keys.length;
    const w = 1 / Math.max(1, m - 1);
    for (let i = 0; i < m; i++)
      for (let j = i + 1; j < m; j++) {
        if (row.keys[i] === row.keys[j]) continue; // a model against itself teaches nothing
        const a = idx.get(row.keys[i])!;
        const b = idx.get(row.keys[j])!;
        const sA = row.standing[i] > row.standing[j] ? 1 : row.standing[i] < row.standing[j] ? 0 : 0.5;
        W[a] += w * sA;
        W[b] += w * (1 - sA);
        N[a][b] += w;
        N[b][a] += w;
      }
  }
  for (let i = 0; i < n; i++) {
    W[i] += 1; // prior: one virtual win and one virtual loss against the 1200 anchor
    N[i][n] += 2;
    N[n][i] += 2;
  }
  return { players, W, N };
}

/** maximum a-posteriori strengths by minorize–maximize (Hunter 2004); returns Elo-scale ratings */
function solve({ players, W, N }: Tally): number[] {
  const n = players.length;
  const g = new Array(n + 1).fill(1); // g[n] = anchor, fixed at 1 (= 1200)
  for (let it = 0; it < 2000; it++) {
    let change = 0;
    for (let i = 0; i < n; i++) {
      let den = 0;
      for (let j = 0; j <= n; j++) if (j !== i && N[i][j] > 0) den += N[i][j] / (g[i] + g[j]);
      const next = W[i] / den;
      change = Math.max(change, Math.abs(Math.log(next / g[i])));
      g[i] = next;
    }
    if (change < 1e-10) break;
  }
  return players.map((_, i) => START_RATING + SCALE * Math.log(g[i]));
}

function rng(seed: number) {
  // mulberry32: a seeded generator, so the intervals do not flicker between runs
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo);
};

/** the full table: fitted ratings, intervals, games and wins per player */
export function rate(rows: ResultRow[], bootstrap = 200): Ratings {
  const players = [...new Set(rows.flatMap((r) => r.keys))].sort();
  if (players.length === 0) return {};
  const best = solve(tally(rows, players));

  // bootstrap: refit on games drawn with replacement
  const samples: number[][] = players.map(() => []);
  const rand = rng(12345);
  for (let b = 0; b < bootstrap && rows.length > 1; b++) {
    const pick = rows.map(() => rows[Math.floor(rand() * rows.length)]);
    const r = solve(tally(pick, players));
    // players missing from the sample only show the prior; leave them out of their interval
    const present = new Set(pick.flatMap((x) => x.keys));
    players.forEach((p, i) => present.has(p) && samples[i].push(r[i]));
  }

  const out: Ratings = {};
  players.forEach((p, i) => {
    let games = 0;
    let wins = 0;
    let updated = "";
    for (const row of rows) {
      const seats = row.keys.map((k, j) => (k === p ? j : -1)).filter((j) => j >= 0);
      if (!seats.length) continue;
      games++;
      if (row.winner !== null && seats.includes(row.winner)) wins++;
      if (row.endedAt > updated) updated = row.endedAt;
    }
    const s = samples[i];
    out[p] = {
      rating: Math.round(best[i] * 10) / 10,
      games,
      wins,
      updated,
      ...(s.length >= 20 ? { lo: Math.round(quantile(s, 0.025)), hi: Math.round(quantile(s, 0.975)) } : {}),
    };
  });
  return out;
}

/** recompute all ratings from game records */
export function rebuild(records: GameRecord[], bootstrap = 200): Ratings {
  return rate(records.map(resultRow).filter((r): r is ResultRow => r !== null), bootstrap);
}
