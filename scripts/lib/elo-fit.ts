/**
 * Ratings from a round robin (scripts/elo-tournament.ts): the rows it writes, the per-agent and
 * per-pair summaries, and the joint rating fit. Used by the tournament (ratings.json, README.md)
 * and by the dashboard (scripts/elo-dashboard.ts), so both always show the same numbers.
 *
 * Rating: Bradley-Terry maximum likelihood over all games of a mode at once (minorize-maximize,
 * Hunter 2004), so the order of games does not matter. One game = one result between the two
 * models in it: the side that won it (see `won`). Scale: classic Elo, 400 points = 10:1 odds.
 * Anchor: ANCHOR_ID (greedy-v1) = ANCHOR_RATING (1200, where data/ratings.json puts it).
 * Prior: every agent also has one virtual win and one virtual loss against the anchor's level,
 * which keeps an agent that never won (or never lost) at a finite rating; it is 2 games against
 * more than a thousand real ones, so it moves nobody else.
 * Interval: 95% bootstrap over map seeds. The same seeds are played by every pair in every mode,
 * so whole seeds are drawn with replacement (all games on a map go in or out together) and the fit
 * is repeated. Ratings in a resample are compared after centring on the mean of the learned agents
 * (all but kind "random"), so an interval says how well an agent is placed in the field, and the
 * anchor has an interval too.
 */

export const ANCHOR_ID = "greedy-v1";
export const ANCHOR_RATING = 1200;
const SCALE = 400 / Math.LN10;

/** the setup of one mode: every game of the mode is played with it */
export type Setup = { players: number; size: number; mapType: string; maxTurns: number; maxMoves: number; turnLimit?: number; games: number };

/**
 * One game, compact: map seed index, seating (0: a on the even seats, 1: a on the odd seats),
 * the engine's winner seat (-1: none), over (1: ended by the mode's own rule, 0: stopped at the
 * turn or move cap), last turn, actions played, then the score of every seat.
 */
export type GameRow = number[];
export type PairRow = { mode: string; a: string; b: string; games: GameRow[]; seconds: number; at: string };
export type Agent = { id: string; kind: string; name?: string; created?: string };
export type Meta = {
  start: true;
  at: string;
  firstSeed: number;
  agents: Agent[];
  modes: Record<string, Setup>;
  excluded: { id: string; why: string }[];
  commit?: string;
};

export const pairKey = (mode: string, a: string, b: string) => `${mode}|${a}|${b}`;

export type Game = { seed: number; aWon: boolean; aShare: number; aFinish: number; byRule: boolean; turn: number; moves: number };

/** a game from side a's view */
export function readGame(g: GameRow, setup: Setup): Game {
  const [seed, seating, winnerSeat, over, turn, moves, ...scores] = g;
  // stopped at a cap: the highest-scoring seat wins, a tie goes to the later seat (as in training)
  let top = 0;
  scores.forEach((v, i) => v >= scores[top] && (top = i));
  const byRule = over === 1 && winnerSeat >= 0;
  const aWon = (byRule ? winnerSeat : top) % 2 === seating;
  let mine = 0;
  let total = 0;
  scores.forEach((v, i) => {
    total += v;
    if (i % 2 === seating) mine += v;
  });
  const aShare = total ? mine / total : 0.5;
  // the finish score of train-greedy.ts (#124): a game ended by the mode's rule scores 0.75 to 1
  // for the winner (the earlier, the more) and the mirror image for the loser; a game stopped at
  // the cap scores 0.25 + 0.5 x the share of points
  const cap = setup.turnLimit ?? setup.maxTurns;
  const win = 0.75 + (0.25 * Math.max(0, cap - turn)) / cap;
  const aFinish = byRule ? (aWon ? win : 1 - win) : 0.25 + 0.5 * aShare;
  return { seed, aWon, aShare, aFinish, byRule, turn, moves };
}

// ---------- the fit ----------
/** wins[i][j]: games i won against j */
type Wins = number[][];

/** Bradley-Terry strengths with the prior, as Elo-scale ratings (not anchored yet) */
export function solve(wins: Wins): number[] {
  const n = wins.length;
  const W = wins.map((r) => r.reduce((a, x) => a + x, 0) + 1); // + the prior's virtual win
  const g = new Array(n).fill(1);
  for (let it = 0; it < 5000; it++) {
    let change = 0;
    for (let i = 0; i < n; i++) {
      let den = 2 / (g[i] + 1); // the prior: 2 games against a fixed opponent of strength 1
      for (let j = 0; j < n; j++) {
        const games = wins[i][j] + wins[j][i];
        if (j !== i && games > 0) den += games / (g[i] + g[j]);
      }
      const next = W[i] / den;
      change = Math.max(change, Math.abs(Math.log(next / g[i])));
      g[i] = next;
    }
    if (change < 1e-9) break;
  }
  return g.map((x) => SCALE * Math.log(x));
}

function rng(seed: number) {
  // mulberry32: seeded, so the intervals are the same on every run
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

export type Rated = {
  id: string;
  rating: number;
  lo: number;
  hi: number;
  /** share of bootstrap fits in which this agent is rated above the next one down the ranking */
  aboveNext: number | null;
  games: number;
  wins: number;
  winRate: number;
  pointShare: number;
  finish: number;
  /** games won by the mode's own rule (conquest in domination), as a share of all its games */
  outright: number;
  /** mean last turn of its games */
  turns: number;
  /** share of its games that ended by the mode's rule, not at the turn or move cap */
  decided: number;
};
export type Cell = { games: number; wins: number; winRate: number; pointShare: number; finish: number };
export type Fit = {
  games: number;
  pairs: number;
  ranking: Rated[];
  /** matrix[row][col]: the row agent against the column agent */
  matrix: Record<string, Record<string, Cell>>;
};

/** games and won are counts; the other sums are weighted (weight: the sum of the games' weights) */
type Tally = { games: number; won: number; weight: number; wins: number; share: number; finish: number; outright: number; turns: number; decided: number };
const emptyTally = (): Tally => ({ games: 0, won: 0, weight: 0, wins: 0, share: 0, finish: 0, outright: 0, turns: 0, decided: 0 });

/**
 * The fit over some pair rows: one mode, or all modes pooled. `weights` gives a game of each mode
 * its weight in the fit and in the averages (default 1); the pooled fit uses it to count every
 * mode the same although the modes play different numbers of games.
 */
export function fit(rows: PairRow[], agents: Agent[], modes: Record<string, Setup>, bootstrap = 1000, weights: Record<string, number> = {}): Fit {
  const ids = agents.map((a) => a.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const zero = () => Array.from({ length: n }, () => new Array(n).fill(0));
  const bySeed = new Map<number, Wins>();
  const total = zero();
  const tallies = ids.map(emptyTally);
  const cells: Tally[][] = Array.from({ length: n }, () => Array.from({ length: n }, emptyTally));
  let games = 0;
  let pairs = 0;
  for (const row of rows) {
    const a = idx.get(row.a);
    const b = idx.get(row.b);
    const setup = modes[row.mode];
    if (a === undefined || b === undefined || !setup) continue;
    pairs++;
    const wt = weights[row.mode] ?? 1;
    for (const raw of row.games) {
      const g = readGame(raw, setup);
      games++;
      let w = bySeed.get(g.seed);
      if (!w) bySeed.set(g.seed, (w = zero()));
      const [win, lose] = g.aWon ? [a, b] : [b, a];
      w[win][lose] += wt;
      total[win][lose] += wt;
      for (const [me, other, won, share, finish] of [
        [a, b, g.aWon, g.aShare, g.aFinish],
        [b, a, !g.aWon, 1 - g.aShare, 1 - g.aFinish],
      ] as [number, number, boolean, number, number][]) {
        for (const t of [tallies[me], cells[me][other]]) {
          t.games++;
          t.won += won ? 1 : 0;
          t.weight += wt;
          t.wins += won ? wt : 0;
          t.share += wt * share;
          t.finish += wt * finish;
          t.outright += won && g.byRule ? wt : 0;
          t.turns += wt * g.turn;
          t.decided += g.byRule ? wt : 0;
        }
      }
    }
  }

  const anchor = idx.get(ANCHOR_ID) ?? 0;
  const best = solve(total);
  const shift = ANCHOR_RATING - best[anchor];
  const rating = best.map((r) => r + shift);

  // bootstrap over map seeds; each resample is centred on the learned agents' mean
  const learned = agents.map((a, i) => (a.kind === "random" ? -1 : i)).filter((i) => i >= 0);
  const centre = (r: number[]) => learned.reduce((s, i) => s + r[i], 0) / Math.max(1, learned.length);
  const c0 = centre(rating);
  const seeds = [...bySeed.values()];
  const samples: number[][] = ids.map(() => []);
  const order = ids.map((_, i) => i).sort((x, y) => rating[y] - rating[x]);
  const above = new Array(n).fill(0);
  const rand = rng(12345);
  let fits = 0;
  for (let b = 0; b < bootstrap && seeds.length > 1; b++) {
    const w = zero();
    for (let k = 0; k < seeds.length; k++) {
      const s = seeds[Math.floor(rand() * seeds.length)];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) w[i][j] += s[i][j];
    }
    const r = solve(w);
    const c = centre(r);
    r.forEach((x, i) => samples[i].push(x - c + c0));
    order.forEach((i, k) => k + 1 < n && r[i] > r[order[k + 1]] && above[i]++);
    fits++;
  }

  const ranking: Rated[] = order.map((i, k) => {
    const t = tallies[i];
    const s = samples[i];
    const d = t.weight || 1;
    return {
      id: ids[i],
      rating: Math.round(rating[i]),
      lo: Math.round(s.length ? quantile(s, 0.025) : rating[i]),
      hi: Math.round(s.length ? quantile(s, 0.975) : rating[i]),
      aboveNext: fits && k + 1 < n ? above[i] / fits : null,
      games: t.games,
      wins: t.won,
      winRate: t.wins / d,
      pointShare: t.share / d,
      finish: t.finish / d,
      outright: t.outright / d,
      turns: t.turns / d,
      decided: t.decided / d,
    };
  });
  const matrix: Fit["matrix"] = {};
  ids.forEach((r, i) => {
    matrix[r] = {};
    ids.forEach((c, j) => {
      const t = cells[i][j];
      if (t.games) matrix[r][c] = { games: t.games, wins: t.won, winRate: t.wins / t.weight, pointShare: t.share / t.weight, finish: t.finish / t.weight };
    });
  });
  return { games, pairs, ranking: ranking.filter((r) => r.games > 0), matrix };
}

export type Ratings = { overall: Fit; modes: Record<string, Fit> };

/** a game's weight in the pooled fit, per mode: every mode counts as much as the one with the most games per pair */
export function modeWeights(modes: Record<string, Setup>): Record<string, number> {
  const most = Math.max(1, ...Object.values(modes).map((s) => s.games));
  return Object.fromEntries(Object.entries(modes).map(([m, s]) => [m, most / Math.max(1, s.games)]));
}

/** every mode on its own, and all modes pooled with every mode counting the same */
export function fitAll(meta: Meta, rows: PairRow[], bootstrap = 1000): Ratings {
  const modes: Record<string, Fit> = {};
  for (const mode of Object.keys(meta.modes)) {
    const mine = rows.filter((r) => r.mode === mode);
    if (mine.length) modes[mode] = fit(mine, meta.agents, meta.modes, bootstrap);
  }
  return { overall: fit(rows, meta.agents, meta.modes, bootstrap, modeWeights(meta.modes)), modes };
}

/** results.jsonl: the first line is the run's meta, every other line one finished pair in one mode */
export function parseResults(text: string): { meta: Meta | null; rows: PairRow[] } {
  let meta: Meta | null = null;
  // the last meta line counts (a resumed run writes a new one), and the last row of a pair in a mode
  const rows = new Map<string, PairRow>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let v: Meta | PairRow;
    try {
      v = JSON.parse(line);
    } catch {
      continue; // a line caught mid-write
    }
    if ("start" in v) meta = v;
    else rows.set(pairKey(v.mode, v.a, v.b), v);
  }
  return { meta, rows: [...rows.values()] };
}

