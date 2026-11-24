import { eloFromScore, expectedScore, llr, marginLlr, marginVerdict, sprtBounds, sprtVerdict } from "../../logic/arena/sprt";

/** seeded random numbers so the simulations below give the same result every run */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** run one test against a challenger with a true Elo edge; 20 pairs per look, at most 600 pairs */
function simulate(trueElo: number, rnd: () => number): { verdict: string; pairs: number } {
  const p = expectedScore(trueElo);
  const pairs: number[] = [];
  while (pairs.length < 600) {
    for (let i = 0; i < 20; i++) pairs.push(((rnd() < p ? 1 : 0) + (rnd() < p ? 1 : 0)) / 2);
    const { verdict } = sprtVerdict(pairs, 0, 25);
    if (verdict !== "continue") return { verdict, pairs: pairs.length };
  }
  return { verdict: "truncated", pairs: pairs.length };
}

describe("SPRT", () => {
  it("has symmetric bounds of about ±2.94 at 5% error rates", () => {
    const { lower, upper } = sprtBounds(0.05, 0.05);
    expect(upper).toBeCloseTo(2.944, 3);
    expect(lower).toBeCloseTo(-2.944, 3);
  });

  it("converts between Elo and expected score", () => {
    expect(expectedScore(0)).toBe(0.5);
    expect(expectedScore(200)).toBeCloseTo(0.76, 2);
    expect(eloFromScore(expectedScore(120))).toBeCloseTo(120, 6);
    expect(Number.isFinite(eloFromScore(1, 100))).toBe(true);
  });

  it("rejects a challenger that plays exactly like the champion after one batch", () => {
    // each map goes to the same seat both times: every pair scores 0.5, no variance
    expect(sprtVerdict(Array(20).fill(0.5), 0, 25).verdict).toBe("reject");
  });

  it("accepts a challenger that wins every game after one batch", () => {
    expect(sprtVerdict(Array(20).fill(1), 0, 25).verdict).toBe("accept");
  });

  it("is undecided right between the two hypotheses", () => {
    const mid = (expectedScore(0) + expectedScore(25)) / 2;
    expect(llr(Array(50).fill(mid), 0, 25)).toBeCloseTo(0, 9);
  });

  it("mostly rejects equal challengers and mostly accepts clearly better ones", () => {
    const rnd = mulberry32(7);
    const runs = (elo: number) => Array.from({ length: 200 }, () => simulate(elo, rnd));
    const equal = runs(0);
    const better = runs(60);
    const share = (rs: { verdict: string }[], v: string) => rs.filter((r) => r.verdict === v).length / rs.length;
    expect(share(equal, "accept")).toBeLessThan(0.08); // alpha 5%, plus sampling noise
    expect(share(better, "accept")).toBeGreaterThan(0.9);
    // clearly worse challengers are rejected quickly
    const worse = runs(-100);
    expect(share(worse, "reject")).toBe(1);
    const mean = (rs: { pairs: number }[]) => rs.reduce((a, r) => a + r.pairs, 0) / rs.length;
    expect(mean(worse)).toBeLessThan(80); // ~60 pairs on average, against up to 600 for close calls
    expect(mean(worse)).toBeLessThan(mean(equal));
  });
});

describe("margin test", () => {
  // margins of map pairs: the challenger's share of points minus 0.5, normal around a true mean
  const sim = (trueMean: number, rnd: () => number) => {
    const margins: number[] = [];
    for (;;) {
      for (let i = 0; i < 10; i++) {
        const z = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
        margins.push(trueMean + 0.05 * z);
      }
      const { verdict } = marginVerdict(margins, 0, 0.01);
      if (verdict !== "continue" || margins.length >= 2000) return { verdict, pairs: margins.length };
    }
  };

  it("is zero without data and follows the sign of the mean", () => {
    expect(marginLlr([0.02], 0, 0.01)).toBe(0);
    expect(marginLlr([0.03, 0.02, 0.04, 0.03], 0, 0.01)).toBeGreaterThan(0);
    expect(marginLlr([-0.03, -0.02, -0.04, -0.03], 0, 0.01)).toBeLessThan(0);
  });

  it("rejects identical play fast", () => {
    expect(marginVerdict(Array(10).fill(0), 0, 0.01).verdict).toBe("reject");
  });

  it("keeps real gains and rejects no gain at about the error rates", () => {
    const rnd = mulberry32(11);
    const runs = (m: number) => Array.from({ length: 200 }, () => sim(m, rnd));
    const share = (rs: { verdict: string }[], v: string) => rs.filter((r) => r.verdict === v).length / rs.length;
    expect(share(runs(0), "accept")).toBeLessThan(0.08);
    expect(share(runs(0.015), "accept")).toBeGreaterThan(0.9);
    expect(share(runs(-0.02), "reject")).toBe(1);
  });
});
