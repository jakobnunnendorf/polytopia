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
npm run rl:gate -- --candidate <model id or path> --base <model id or path> --difficulty <easy|normal|hard|crazy> \
  --out experiments/NN-rl-<slug>/
```

- **Setup:** Perfection, 16x16 Continents, 3 players. The learner plays seat 0 as Xin-Xi (`--tribe xinxi`);
  the two opponents' tribes are distinct and fixed per seed, so candidate and base meet the same tribes on the same
  map. Opponents are the champion `greedy-full-probe` (`--opp`).
- **Difficulty: not decided yet, pass it explicitly** (`--difficulty`; `normal` is only the technical default).
  Open modelling question: with no human seats the engine treats every seat as a bot, so the learner in seat 0
  also gets that difficulty's bot capital bonus. The score compared is the raw `score_of`, not the
  difficulty-scaled rating.
- **Paired test:** candidate and base each play seat 0 on the same N = 10,000 seeds (`--n`, fixed in advance, no
  early stopping). Per seed d = score(candidate) − score(base) of seat 0's final Perfection score.
- **Pass rule:** one-sided at α = 0.01 (`--alpha`): **PASS iff mean(d) − 2.326 · sd(d)/√N > 0**. The paired t
  bound is printed too (identical at this N). Exit code 0 = PASS, 1 = FAIL, 2 = error.
- **Seed rule:** evaluation seeds start at **1,000,000,000** (`--seed-start`) and run upwards. **Training must never
  use seeds ≥ 1,000,000,000.** The tool warns when started below that range.
- **Output:** a summary on the terminal (means, mean and sd of d, correlation, lower bound, verdict, wall time)
  and `gate-<candidate>-vs-<base>-n<N>.json` in `--out` (default `engine/target/rl-gate/`) with the same numbers
  plus one row per seed (seed, tribes, both scores, d); cite that file in the experiment report.
- **Cost:** 20,000 games, about 50 s on 12 cores.
- **Sanity check (25 Nov 2026, difficulty normal):** `greedy-full-probe` vs `greedy-v1`: mean d = +3453, lower bound
  +3396, PASS; `greedy-full-probe` vs itself: d = 0 on every seed, lower bound 0, FAIL.
- Learners are bot models (`models/<id>/model.json`) for now; the RL agent plugs in as a new `Learner` kind in
  `engine/gate/src/main.rs`.
