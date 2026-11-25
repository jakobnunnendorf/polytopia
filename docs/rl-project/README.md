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
- **Paired test:** candidate and base each play seat 0 on the same N = 10,000 seeds (`--n`, fixed in advance, no
  early stopping). Per seed d = score(candidate) − score(base) of seat 0's final Perfection score.
- **Pass rule:** one-sided at α = 0.01 (`--alpha`): **PASS iff mean(d) − 2.326 · sd(d)/√N > 0**. The paired t
  bound is printed too (identical at this N). Exit code 0 = PASS, 1 = FAIL, 2 = error.
- **Seed rule:** evaluation seeds start at **1,000,000,000** (`--seed-start`) and run upwards. **Training must never
  use seeds ≥ 1,000,000,000.** The tool warns when started below that range.
- **Output:** a summary on the terminal (means, mean and sd of d, correlation, lower bound, verdict, wall time)
  and `gate-<candidate>-vs-<base>-n<N>.json` in `--out` (default `engine/target/rl-gate/`) with the same numbers
  plus one row per seed (seed, tribes, both scores, d); cite that file in the experiment report.
- **Cost:** 20,000 four-player games, about 2 minutes on 12 cores (N = 2,000 took 24–27 s).
- **Sanity check (25 Nov 2026, the decided setup: Crazy, 4 players, learner seat human, N = 2,000):**
  `greedy-full-probe` vs `greedy-v1`: mean score 6821 vs 3723, mean d = +3099 (sd 2972), lower bound +2944, PASS
  (24.3 s); `greedy-full-probe` vs itself: d = 0 on every seed, lower bound 0, FAIL (27.1 s). Seat 0 wins only
  2.5% of these games against three Crazy champions. (The earlier check on Normal, 3 players, learner seat a
  bot: mean d = +3453, lower bound +3396, PASS.)
- Learners are bot models (`models/<id>/model.json`) for now; the RL agent plugs in as a new `Learner` kind in
  `engine/gate/src/main.rs`.

### Final benchmark: the official leaderboard

The final agent (fine-tuned on Crazy with 15 opponents) is compared with the game's official Perfection
high-score list. That list is kept per tribe. Xin-xi on 25 Nov 2026 (final ratings including the difficulty bonus;
no player names recorded): **#1 198,083, #20 122,537, #100 90,147.**

- The wiki's formula gives a 291% bonus for 15 Crazy opponents, so the raw score is about rating / 2.91:
  #1 ≈ 68,100, #20 ≈ 42,100, #100 ≈ 31,000. A February 2024 patch lowered the opponent part of the bonus by an
  amount that was not published, so these raw figures are lower bounds on what a listed player actually scored.
- A leaderboard entry is a player's best game, so compare the agent's **best score over many seeds**, not its mean.
