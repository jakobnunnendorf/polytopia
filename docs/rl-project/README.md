# RL course final project (EMAI, UPF)

The lecturer's brief is [`final_project.pdf`](final_project.pdf) (copied from the course folder on 2026-11-25).
The working project plan is the Claude Doc "RL final project plan: learning to play Polytopia"
(https://claude.ai/artifact/6tcqFQes2PPSfjZZg1Aiej).

## The brief in short

- 25% of the RL grade; groups of at most 3 students, one shared grade.
- In-person talk: 15 minutes plus 5–10 minutes of Q&A, tentatively in the week of June 22–26 (the brief names no year).
- Written report within one week of the talk; it adds the technical details and answers the Q&A questions.
- One week before the talks, each group enters its details in a spreadsheet the lecturer shares on Google Classroom.
- Focus: problem setup, approach and results, or the difficulties met, everything tried, what worked or failed and why.
- Two kinds of project:
  - **Empirical:** formulate your own problem as an RL problem (a gym environment or an ad-hoc solution; showing the MDP is viable by dynamic programming is fine), solve a hard existing environment, or implement an algorithm from scratch on a simple one (suggested: Q-REPS, arXiv 2010.11151; FOGAS, arXiv 2405.13755).
  - **Literature review:** an RL sub-area not covered in class (ideas: POMDPs, multi-objective and constrained MDPs, structured MDPs, multi-agent RL, inverse RL, off-policy RL, Bayesian RL), tied to the course where possible.

## How this repo answers it

An empirical project on the Shardlands engine (`engine/py` VecEnv, see `docs/shardlands/RL.md`): do the course's
value-based and policy-gradient methods beat the ES-tuned greedy bot at an equal game budget? The candidate
experiments are the `[RL]` issues indexed in #123.

## The quality gate: `rl-gate`

Whether an experiment's new agent (the candidate) replaces the current one (the base) is decided by one
command (agreed by Jakob, 25 Nov 2026, #166). The tool lives in `engine/gate` (crate and binary `rl-gate`):

```bash
npm run rl:gate -- --candidate <model id or path> --base <model id or path> --out experiments/NN-rl-<slug>/
```

- **Decided setup (Jakob, 25 Nov 2026, #166), the defaults of the tool:**
  - Difficulty **Crazy** (`--difficulty crazy`), the hardest, and the leaderboard setting.
  - **3 opponents** for training and gating (`--players 4`): learner plus 3 is the only fully symmetric layout on
    the square map (map generation splits it into ceil(√players)² domains). This may grow once the game time per
    opponent count is measured.
  - Final stage: fine-tune and evaluate on **15 Crazy opponents** (see "Final benchmark" below).
  - Opponents are the frozen champion **`greedy-full-probe`** (`--opp`). Do not swap opponents between
    experiments: every result must be measured against the same opponents.
  - The **learner seat counts as human**: the gate creates every game with `humans: [0]`, so seat 0 gets the
    human capital income (+1 star; a Crazy bot's capital gets +4), as in the app, and the game ends when seat 0
    is eliminated. The Python `VecEnv` does the same for its learner seat.
- **Map and tribes:** Perfection, 16x16 Continents. The learner plays seat 0 as Xin-Xi (`--tribe xinxi`); the
  opponents' tribes are distinct and fixed per seed, so candidate and base meet the same tribes on the same map.
  The score compared is the raw `score_of`, not the difficulty-scaled rating.
- **Paired seeds:** candidate and base each play seat 0 on the same N = 10,000 seeds (`--n`, fixed in advance, no
  early stopping). Per seed d = score(candidate) − score(base) of seat 0's final Perfection score.
- **Pass rule (reliability first; Jakob, 25 Nov 2026, #166):** the candidate must be better on more seeds, not
  better by more points on a few. "An agent who wins 1/1000 games but with a much higher margin must not beat one
  that wins the other 999 but with a lower margin", so the mean of d no longer decides. All at α = 0.01
  (`--alpha`), one-sided:
  1. **Main test, a paired sign test.** Seeds with d = 0 are dropped (and reported). Among the others count
     better (d > 0) and worse (d < 0). The **exact one-sided binomial test** of H0 "P(better) = 0.5" must reject
     in favour of better, p < α. The p-value is the exact tail P(X ≥ better), X ~ Binomial(better + worse, 0.5),
     summed in log space (no normal approximation, so it is exact at any N). The tool reports the better share
     with the one-sided 99% Clopper-Pearson lower bound; that bound is above 50% exactly when the test rejects.
  2. **Guard (a), mean not significantly worse:** the one-sided 99% *upper* confidence bound of mean(d),
     mean(d) + 2.326 · sd(d)/√N, must be ≥ 0. We may not be able to show the mean improved, but we must not be able
     to show it got worse. (The paired t bounds are printed too; identical at this N.)
  3. **Guard (b), lower tail not worse:** the candidate's 10th-percentile score must be ≥ the base's.
  Quantiles are linear interpolation between order statistics (Hyndman-Fan type 7, the default of R and numpy).
  **PASS iff the sign test rejects and both guards hold**; otherwise FAIL and the output names each reason.
  Identical players give all ties, no test, FAIL. Exit code 0 = PASS, 1 = FAIL, 2 = error.
- **Reported, not deciding:** mean, sd, 10th percentile, median, 90th percentile and best score of both versions;
  win rates; better/worse/equal counts; mean d with its two bounds; and **best-of-k** (k = 1, 10, 100) for both.
  Best-of-k is the expected best score of k games, estimated from the empirical score distribution: draw k scores
  with replacement from the N observed ones, so with the scores sorted ascending x₍₁₎ ≤ … ≤ x₍N₎ the estimate is
  Σᵢ x₍ᵢ₎ · ((i/N)ᵏ − ((i−1)/N)ᵏ). It is exact for that model, k = 1 is the mean, and it can never exceed the best
  observed score (use it for k ≪ N).
- **Seed rule:** evaluation seeds start at **1,000,000,000** (`--seed-start`) and run upwards. **Training must never
  use seeds ≥ 1,000,000,000.** The tool warns when started below that range.
- **Output:** a summary on the terminal (distribution table and best-of-k for both versions, win rates, d with
  its bounds, the sign test, both guards, verdict with reasons, wall time) and
  `gate-<candidate>-vs-<base>-n<N>.json` in `--out` (default `engine/target/rl-gate/`) with the same numbers
  (`rule`, `signTest`, `guards`, `failReasons`, `candidateStats`, `baseStats`, the older flat fields such as
  `meanD`, `lowerBound`, `upperBound`) plus one row per seed (seed, tribes, both scores, d); cite that file in
  the experiment report.
- **Cost:** 20,000 four-player games, about 1-2 minutes on 12 cores (N = 2,000 took 12-27 s, depending on load).
- **Sanity check (25 Nov 2026, the decided setup: Crazy, 4 players, learner seat human, N = 2,000, sign-test rule):**
  `greedy-full-probe` vs `greedy-v1`: better on 1,800 seeds, worse on 198, 2 ties; better share 90.09% of the 1,998
  differing seeds (99% lower bound 88.43%), exact p < 1e-300, PASS; guard (a) upper bound of mean d +3253 (mean d
  +3099, sd 2972), guard (b) 10th percentile 1435 vs 865; median 7998 vs 3048; best-of-10 11,118 vs 7,745,
  best-of-100 13,226 vs 9,426; 12.3 s. `greedy-full-probe` vs itself: 2,000 ties, no sign test possible, FAIL
  (13.8 s). The reverse (`greedy-v1` as candidate) fails the sign test and both guards. Seat 0 wins only 2.5% of
  these games against three Crazy champions. (The first gate, mean(d) lower bound > 0, gave the same ranking:
  mean d +3099, bound +2944, PASS; vs itself FAIL.)
- Learners are bot models (`models/<id>/model.json`) for now; the RL agent plugs in as a new `Learner` kind in
  `engine/gate/src/main.rs`.

### Final benchmark: the official leaderboard

The final agent (fine-tuned on Crazy with 15 opponents) is compared with the game's official Perfection
high-score list. That list is kept per tribe. Xin-xi on 25 Nov 2026 (final ratings including the difficulty bonus;
no player names recorded): **#1 198,083, #20 122,537, #100 90,147.**

- The wiki's formula gives a 291% bonus for 15 Crazy opponents, so the raw score is about rating / 2.91:
  #1 ≈ 68,100, #20 ≈ 42,100, #100 ≈ 31,000. A February 2024 patch lowered the opponent part of the bonus by an
  amount that was not published, so these raw figures are lower bounds on what a listed player actually scored.
- A leaderboard entry is a player's best game. **Decision (Jakob, 25 Nov 2026, reliability first): the demo
  headline is the agent's median score** (and its 10th/90th percentile), because the project is about an agent that
  plays well every time. Comparing with the leaderboard is a **secondary, labelled best-case figure**: the
  best-of-k estimate (k = 10 or 100 from the gate's score distribution) or the best observed score, always
  stated as "best of k games", never as the agent's typical score.
