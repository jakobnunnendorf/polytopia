---
name: rl-experiment
description: Use when running an experiment on the RL course project's value-function agent in polytopia-ai-research - adding or changing state features (v1 = cities captured, then more), changing the learning algorithm (MC, TD(lambda), LSTD) or its settings, training the agent, evaluating it against the base version or the current models, or deciding whether a change is merged. Not for greedy-full knob experiments (that is model-experiment).
---

# RL experiment

One idea per experiment: branch, write the report, run, evaluate against the base, gate, merge or record.
The project's agreed setup (25 Nov 2026, issue #166): learn value functions of the game state in **Perfection**
mode (30-turn limit, highest score wins); reward = change in score; reward function and transitions are
unknown to the agent and learned from play; features start minimal (v1: cities captured) and grow one step per
experiment; the agent is measured against our current models.

## The loop

1. **Board first** (`rl-board` skill): overlap check against the other side's open CLAIMs. Overlap → stop
   and tell your human. Otherwise post a CLAIM.
2. **Branch** from `dev` (where the current RL agent lives): `rl/<slug>`. Work in a worktree.
3. **Report before running.** `cp -r experiments/TEMPLATE experiments/NN-rl-<slug>` (NN = next free number),
   set `experiment.json` status `running`, verdict `pending`. Write before the first run:
   - *Question and hypothesis*: the idea in the human's words, and the prediction as numbers (which metric
     moves, which way, about how far).
   - *Mechanism*: which features, which algorithm, which settings change, and nothing else.
   - *Setup*: map size, players, opponents, seeds, number of games, base version.
4. **Run** training; keep the command, seeds and duration in the report.
5. **Evaluate** the new version and the base version on the **same fixed seeds** against the same opponents.
   Report at least: mean final score, win rate, both with confidence intervals; value-prediction error on
   held-out games when the change is about V.
6. **Quality gate.** 99% one-sided paired test on 10,000 evaluation seeds (agreed 25 Nov 2026, #166; details in
   `docs/rl-project/README.md`, "The quality gate"). Run:
   `npm run rl:gate -- --candidate <new> --base <base> --out experiments/NN-rl-<slug>/`
   Decided setup (Jakob, 25 Nov 2026), the tool's defaults: difficulty **Crazy**; **3 opponents** (`--players 4`,
   the symmetric map layout; may grow once game time per opponent count is measured); opponents the frozen
   champion `greedy-full-probe` (never swap opponents between experiments); the learner seat counts as **human**
   (human capital income, as in the app). The final stage fine-tunes and evaluates on 15 Crazy opponents. Train
   on the same setup. Candidate and base play seat 0 (Xin-Xi, Perfection, 16x16 Continents) on the same seeds
   1,000,000,000.. (never use these for training). **PASS iff mean(d) − 2.326·sd(d)/√N > 0**, d = seat-0
   score(candidate) − score(base) per seed; exit 0 = PASS, 1 = FAIL. Apply the verdict as printed, never rerun
   with other seeds or a smaller N to change it; copy the summary and cite the JSON in the report.
7. **Close.**
   - Pass: PR into `dev`, merge, post STATUS on #166 naming the new base version.
   - Fail: verdict `not kept` in `experiment.json` and the report (failures go in the course report too),
     commit the report to `dev`, post STATUS, release the claim.

## Rules

- One change per experiment; a second idea is a second experiment.
- Never compare against a base measured on other seeds or another setup.
- Numbers in the report are copied from the generated output, never from memory.
- Merges to `main`, deleting others' work, or changing the scope need a human's go.
- See `experiments/README.md` for the report sections and `docs/shardlands/RL.md` for the Python environment.
