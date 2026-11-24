/**
 * Sequential probability ratio test (SPRT) for "is the challenger stronger?",
 * the way chess engines decide whether to keep a change (Stockfish's fishtest).
 *
 * Two hypotheses about the challenger's Elo advantage over the champion:
 *   H0: elo = elo0 (no better)    H1: elo = elo1 (better by elo1)
 * After each batch of games the log-likelihood ratio (LLR) of H1 over H0 is
 * compared with two bounds: above `upper` accept H1, below `lower` accept H0,
 * otherwise play more. alpha is the chance of keeping a challenger that is
 * really at elo0, beta the chance of rejecting one that is really at elo1.
 *
 * Samples are map pairs: the same map played once from each seat, scored as the
 * challenger's average result over the two games (0, 0.5 or 1). Swapping seats
 * cancels whatever advantage the map gives one seat, which makes each sample
 * less noisy than a single game. The LLR uses the normal approximation
 * ("GSPRT"): with sample mean m and variance v over n pairs,
 *   LLR = n (s1 - s0) (2m - s0 - s1) / (2v)
 * where s0, s1 are the expected scores at elo0 and elo1.
 */

/** expected score of the side that is `elo` points stronger */
export function expectedScore(elo: number): number {
  return 1 / (1 + 10 ** (-elo / 400));
}

/** Elo advantage that a score share implies (clamped away from 0 and 1) */
export function eloFromScore(score: number, games = 1000): number {
  const p = Math.min(Math.max(score, 0.5 / games), 1 - 0.5 / games);
  return -400 * Math.log10(1 / p - 1);
}

export function sprtBounds(alpha = 0.05, beta = 0.05): { lower: number; upper: number } {
  return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

/**
 * Below this sample variance the challenger plays exactly like the champion
 * (every map goes to the same seat both times); the floor makes such a
 * no-change challenger fail fast instead of dividing by zero.
 */
const MIN_VARIANCE = 1e-3;

/** LLR of H1 (elo1) over H0 (elo0) from pair scores in [0, 1] */
export function llr(pairs: number[], elo0: number, elo1: number): number {
  const n = pairs.length;
  if (n < 2) return 0;
  const mean = pairs.reduce((a, x) => a + x, 0) / n;
  const variance = Math.max(pairs.reduce((a, x) => a + (x - mean) ** 2, 0) / n, MIN_VARIANCE);
  const s0 = expectedScore(elo0);
  const s1 = expectedScore(elo1);
  return (n * (s1 - s0) * (2 * mean - s0 - s1)) / (2 * variance);
}

export type SprtVerdict = "accept" | "reject" | "continue";

export function sprtVerdict(pairs: number[], elo0: number, elo1: number, alpha = 0.05, beta = 0.05): { verdict: SprtVerdict; llr: number } {
  const l = llr(pairs, elo0, elo1);
  const { lower, upper } = sprtBounds(alpha, beta);
  return { verdict: l >= upper ? "accept" : l <= lower ? "reject" : "continue", llr: l };
}

/**
 * The same test on score margins instead of results. A sample is one map pair's
 * margin: the challenger's share of all points over the two games minus 0.5
 * (in [-0.5, 0.5]). Points are a much finer signal than who won: a game the
 * challenger lost narrowly still counts in its favour, and games stopped at the
 * turn cap still carry information. Hypotheses about the mean margin:
 *   H0: margin = m0 (no better)    H1: margin = m1 (better by m1)
 * With sample mean m and variance v over n pairs (normal approximation):
 *   LLR = n (m1 - m0) (2m - m0 - m1) / (2v)
 */
export function marginLlr(margins: number[], m0: number, m1: number): number {
  const n = margins.length;
  if (n < 2) return 0;
  const mean = margins.reduce((a, x) => a + x, 0) / n;
  // identical play gives zero variance; the floor (a 1% margin spread) rejects such a challenger fast
  const variance = Math.max(margins.reduce((a, x) => a + (x - mean) ** 2, 0) / n, 1e-4);
  return (n * (m1 - m0) * (2 * mean - m0 - m1)) / (2 * variance);
}

export function marginVerdict(margins: number[], m0: number, m1: number, alpha = 0.05, beta = 0.05): { verdict: SprtVerdict; llr: number } {
  const l = marginLlr(margins, m0, m1);
  const { lower, upper } = sprtBounds(alpha, beta);
  return { verdict: l >= upper ? "accept" : l <= lower ? "reject" : "continue", llr: l };
}
