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
  - **Opponents (Jakob, 25 Nov 2026, "generalisation built in by having different models in each game"):** the
    three opponent seats are (1) the **current champion** (entry 0 of the champions registry, i.e. the base being
    challenged), (2) the **previous champion** (entry 1) and (3) the **frozen greedy champion
    `greedy-full-probe-perf`**, the anchor (app-like, uses the engine's relation model; it never changes, whatever the
    registry says). It was `greedy-full-probe` until 26 Nov 2026; Jakob switched it to the Perfection-tuned
    `greedy-full-probe-perf` (experiment 17) before the first RL iteration, so gate and benchmark numbers from
    before that day used the old anchor. Per seed the three are assigned to seats 1..3 by a seed-derived permutation (Fisher-Yates
    from `splitmix64(seed ^ SEAT_STREAM)`, a stream separate from the tribes), computed once per seed and used for
    both candidate and base, so the pairing stays exact. Each per-seed row records its seating (`opponents`), the
    JSON records the list (`opp`, `setup.opponents`, `opponentSource`). Since 26 Nov 2026 entry 0 is
    `greedy-full-probe-perf` and entry 1 `greedy-full-combo-perf` (both tuned for Perfection in experiment 17).
    They stay the opponents until an RL version beats the greedy champion; see "RL versions and the opponent list".
  - `--opp a,b,c` overrides the list (one entry: every seat that opponent, as before; several: repeated to fill
    the seats and shuffled per seed). Use it only for diagnostics; a gate verdict uses the default.
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
- **Cost:** 20,000 four-player games, about 1-2 minutes on 12 cores (N = 2,000 took 12-27 s, depending on load),
  plus the 15-opponent information run (10,000 sixteen-player games, about 80 s).
- **Sanity check (25 Nov 2026, the decided setup: Crazy, 4 players, learner seat human, N = 2,000, sign-test rule):**
  `greedy-full-probe` vs `greedy-v1`: better on 1,800 seeds, worse on 198, 2 ties; better share 90.09% of the 1,998
  differing seeds (99% lower bound 88.43%), exact p < 1e-300, PASS; guard (a) upper bound of mean d +3253 (mean d
  +3099, sd 2972), guard (b) 10th percentile 1435 vs 865; median 7998 vs 3048; best-of-10 11,118 vs 7,745,
  best-of-100 13,226 vs 9,426; 12.3 s. `greedy-full-probe` vs itself: 2,000 ties, no sign test possible, FAIL
  (13.8 s). The reverse (`greedy-v1` as candidate) fails the sign test and both guards. Seat 0 wins only 2.5% of
  these games against three Crazy champions. (The first gate, mean(d) lower bound > 0, gave the same ranking:
  mean d +3099, bound +2944, PASS; vs itself FAIL.)
- **Sanity check of the opponent set (25 Nov 2026; opponents greedy-full-probe, greedy-full-combo and the anchor
  greedy-full-probe, shuffled; N = 2,000; 12 cores):** `greedy-full-probe` vs `greedy-v1`: better on 1,788 seeds,
  worse on 210, 2 ties, better share 89.49% (99% lower bound 87.79%), mean d +3119, p10 1480 vs 860, median 8055
  vs 3015: PASS (14.9 s). 15-opponent information run (N = 5,000): better 4,177, worse 761, 62 ties, share 84.59%,
  median 1205 vs 690, p10 675 vs 475, mean 2565 vs 1016, rule would PASS (26.1 s). `greedy-full-probe` vs itself:
  all ties, FAIL, exit 1 (14.7 s; information run all 5,000 ties, 29.9 s). First progress rows
  (`--benchmark greedy-full-probe`): 3 opponents median 7955, p10 1425, mean 6756, win 2.6% (N = 10,000, 37.3 s);
  15 opponents median 1205, p10 675, mean 2579, win 1.1% (N = 5,000, 15.4 s).
- Learners are bot models (`models/<id>/model.json`) for now; the RL agent plugs in as a new `Learner` kind in
  `engine/gate/src/main.rs`. Opponents go through an `Opponent` enum: greedy models today (registry kind
  `greedy-model`); an RL policy (kind `rl-policy`) fills a seat once a variant and a step-by-step game loop are
  added there (playGames only drives the engine's own bot policies). Not built yet.

### Information only: 15 opponents

Jakob, 25 Nov 2026: "a second evaluation purely for information on 15 opponents for every candidate so we can just
learn what the difference is." After the 3-opponent gate, `rl-gate` plays the same candidate and base again with
**16 players (15 opponents)**, Crazy, learner seat 0 human, the **same three opponents** repeated to fill the 15
seats (5 copies each), seated by the same kind of seed-derived shuffle (identical for both versions), on a fixed
seed range of its own from **1,500,000,000** with **N = 5,000** (`--info15-n`; `--no-info15` skips it). It prints the
same numbers as the gate (sign test, better/worse/equal, mean/median/p10/p90/best-of-k, win rates) and writes them
in the JSON block **`info15`** (`informationOnly: true`; what the rule would say is `ruleWouldSay`, not `verdict`).
**It never decides and never changes the exit code**; if it fails, the gate's verdict stands and `info15.error`
says why. The experiment report records both the 3-opponent verdict and the 15-opponent information numbers.

### RL versions and the opponent list (Jakob, 26 Nov 2026)

The project is about the RL agents improving on themselves; the greedy bots are a sanity check and a baseline,
not a bar the RL agents must clear (Jakob: "neither have to beat the greedy bots"). Two lists follow from that:

- **The RL line** (`rlLine` in `champions.json`), the pass rule. **RL v1** enters by decision once it plays
  complete games without errors; its numbers against the greedy base are reported, not required. **Every later
  version** must pass `rl-gate` with `--base` = the current head of the RL line (v2 against v1, v3 against v2, and
  so on). A greedy model is never the base of an RL pass decision.
- **The opponent list** (`champions` in `champions.json`, entries 0 and 1 fill the champion and
  previous-champion seats). It stays greedy (`greedy-full-probe-perf`, `greedy-full-combo-perf`) while the RL
  agents are weaker. Every new head of the RL line also gets a gate run with `--base` = the opponent list's entry 0
  (information only). The **first time that run is a PASS**, that RL version is promoted onto the opponent list
  (it takes the champion seat, the greedy champion moves to the previous-champion seat). From then on each new
  head of the RL line is promoted onto the opponent list too, so the seats are: newest RL, the RL before it, anchor.
- **The anchor** `greedy-full-probe-perf` never changes, so every game keeps at least one greedy bot.

| Phase | Champion seat | Previous-champion seat | Anchor |
| --- | --- | --- | --- |
| RL weaker than greedy (from 26 Nov) | greedy-full-probe-perf | greedy-full-combo-perf | greedy-full-probe-perf |
| RL vK first passes vs the greedy champion | RL vK | greedy-full-probe-perf | greedy-full-probe-perf |
| Every RL version after that | newest RL | the RL before it | greedy-full-probe-perf |

When the opponent list changes, the environment changes: scores before and after are not directly comparable.
At each such switch, re-run the greedy baseline (`--candidate greedy-full-probe-perf`) on the new opponents and
record it, so the progress curve stays readable. Two pieces of `rl-gate` are still to build: playing an RL policy
as candidate and base (needed for v2 against v1), and as an opponent (needed only once an RL version enters the
opponent list); `promote` gets a target for the RL line and the "v1 by decision" case with the first of them.

### Champions registry and promotion

`docs/rl-project/champions.json` lists the promoted versions best first (id, path, kind, date, experiment, PR,
gate result). The gate's default opponents are entries 0 and 1 plus the fixed anchor. Seeded 25 Nov 2026 with
the three best greedy models of the Elo tournament of 25 Nov 2026 (`elo/2026-11-25/README.md`), which are also
the last three greedy champions in promotion order: `greedy-full-probe` (Perfection 1742, #1), `greedy-full-combo`
(1635, #2; the model probe was tuned from) and `greedy-full-economy` (1617, #3; history only). After a PASS and
its merge, promote explicitly (never automatic):

```bash
npm run rl:gate -- promote <id> --gate experiments/NN-rl-<slug>/gate-<id>-vs-<base>-n10000.json --experiment NN-rl-<slug> --pr <n>
```

It checks that the JSON is a PASS for that candidate, puts it at the top (the old champion becomes entry 1, the
older ones stay listed for history) and prints the new opponent set. Commit the registry change.

### Progress curve (report only)

`npm run rl:gate -- --benchmark <id>` plays the model in seat 0 against **three copies of the frozen
`greedy-full-probe`** (Crazy, 4 players, seeds 1,000,000,000.., N = 10,000) and against **15 copies** (16 players,
seeds 1,500,000,000.., N = 5,000; `--no-info15` skips it), and appends one row each to
`docs/rl-project/progress.csv` (date, model, players, opponents, n, seedStart, median, p10, mean, p90, winRate,
wallSeconds, commit). The opponents and seeds are fixed forever, so rows stay comparable across versions. It
decides nothing. Run it after every promotion.

### Opponent model: how the bots judge the learner

The opponents' opinions of other tribes (and so of the learner) follow the real game's model, per a community
decompile of a pre-February-2024 build (raphael-64/polyterra-env); the current app may behave differently, and that
build's Perfection bonus already differs from today's. The full list of terms is in `POLYTOPIA_RULES.md`
(Diplomacy, What bots think of you); `docs/RULES_PARITY.md` says what is and is not ported. What matters for the
learner on the gate's setup (Crazy, learner seat human):

- No Charming bonus on Crazy, so a bot's opinion of the learner comes from calm (Peaceful, at most +1), embassies,
  shared friends and enemies, military balance, and penalties for units near its land, land next to its land,
  leading the standings late in the game (Dominating, up to -4 for the leader at turn 30) and not being at peace.
- Bots accept peace above an opinion of 2, offer it when opinion x a per-turn roll is above 2, break it below 0,
  and scale their attacks on a tribe by (1 - opinion): a bot that rates the learner 1 or more stops attacking it.
- Measured on the gate's setup (N = 2,000, 25 Nov 2026), switching from the old +-1-per-factor model:
  `greedy-full-probe` mean seat-0 score 6821 -> 6711 (median 7998 -> 7875, win rate 2.5% -> 2.6%);
  `greedy-v1` 3723 -> 3718; probe vs v1 still PASS (mean d +2993, lower bound +2841).

### Final benchmark: the official leaderboard

The final agent (fine-tuned on Crazy with 15 opponents) is compared with the game's official Perfection
high-score list. That list is kept per tribe. Xin-xi on 25 Nov 2026 (final ratings including the difficulty bonus;
no player names recorded): **#1 198,083, #20 122,537, #100 90,147.**

- The bonus for 15 Crazy opponents is **245%** (app setup screen, 25 Nov 2026), so the raw score is rating / 2.45:
  #1 ≈ 80,850, #20 ≈ 50,015, #100 ≈ 36,795. The older 291% (÷ 2.91) comes from the wiki's pre-February-2024
  formula and is outdated: it matches the community decompile raphael-64/polyterra-env, which is a pre-2024
  build. The engine uses the app's table (`perfection_bonus_percent` in `engine/core/src/data.rs`).
- A leaderboard entry is a player's best game. **Decision (Jakob, 25 Nov 2026, reliability first): the demo
  headline is the agent's median score** (and its 10th/90th percentile), because the project is about an agent that
  plays well every time. Comparing with the leaderboard is a **secondary, labelled best-case figure**: the
  best-of-k estimate (k = 10 or 100 from the gate's score distribution) or the best observed score, always
  stated as "best of k games", never as the agent's typical score.
