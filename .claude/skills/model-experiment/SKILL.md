---
name: model-experiment
description: Use when improving a bot model in polytopia-ai-research - adding a decision mechanism or knob to greedy-full (engine/core/src/bot_full.rs), retraining with train-full/train-hill/train-es, A/B-testing a trainer change, or deciding whether a trained model becomes the new champion. Also when the user names an experiment issue (the one-mechanism-per-run plan, #31).
---

# Model experiment

One change per experiment, measured against the current champion on fixed maps, recorded
on its issue and in the experiment notebook (`experiments/NN-slug/`, a LaTeX report with fixed
sections; see `experiments/README.md`). The experiment is the unit: code, measurement, verdict
and record go together.

**Sweep, don't train.** A new mechanism is measured with a strength sweep (`npm run sweep`):
the base plus the new knob at 3-5 hand-set values, each against the panel, then a final test
of the best. About 2-5 minutes. 100k-game hill climbing found nothing in three runs from
Full v1 (control, #28, #29: 0-1 kept changes each), because a round's 300-400 games cannot
see gains under ~1 point. Run a long tuning run only every 3-4 kept mechanisms, over all knobs,
as its own experiment. Use the perturbation probe for it (`npm run train-probe`, settings below):
in experiment 12 it moved 26 of 205 knobs and gained 2.0 panel points in 100k games, where
`train-full` with the same budget found nothing (one run so far, so keep a control).

## The run contract (what every experiment is)

| Part | Value |
|---|---|
| Names | model id `greedy-full-<mechanism>` (e.g. `greedy-full-defend`); branch `model/<id>`; worktree `.claude/worktrees/<id>`; log `logs/<id>.log`; notebook folder `experiments/NN-<mechanism>` (NN = next number) |
| Base | the current champion: the last experiment whose verdict was **kept** (the notebook index, http://localhost:8095/experiments, shows the lineage; `git fetch` first, other sessions merge champions too) |
| Change | exactly one mechanism or trainer change, **off by default** (old models play unchanged) |
| Panel | `greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4,greedy-full-v1` (fixed: curves stay comparable across steps). Add the base only when it is not `greedy-full-v1`, as a 7th entry, and compare means on the fixed six |
| Metric | `--metric finish` on every sweep and tuning run (from step 5, #124): a conquest win scores 75-100% (the earlier, the more), a conquest loss 0-25%, a game stopped at the turn cap 25-75% by points. Report finish, points, won, conquest rate and turns |
| Tuning-run settings | probe (`train-probe`): `--budget 100000 --games 10000 --sigma 0.25 --z 3 --step 0.5 --league greedy-hill-v4,greedy-full-v1,<base>`; it writes `probe.jsonl` (every knob's z-score per round) beside `curve.jsonl`. Hill climbing (`train-full`, the older method): `--budget 100000 --patience 0 --league self,past --batch 30 --seed 4242 --curve-every 12500` |
| Control | sweeps: the base row the sweep measures itself on the same maps. Tuning runs: same base, same settings, no change. Reuse an existing control for the same base (for `greedy-full-v1`: `greedy-full-v2-ctrl`, panel 66.0% at 100k). Run a new one only when the base changes |
| Knob names | as the trainer prints them in KEPT lines: scalars bare (`defend`, `techUse`), tables `group.key` (`unit.giant`, `greedy.move`). Never a `full.` prefix |
| Sweep values | about ×2 apart around a hand-sized middle (e.g. 0.5,1,2,4). Size the middle so the term can just tip the choice it is about: compare with the base score it competes with (a move ≈ `greedy.move` ≈ 25 plus tiles gained; research ≈ `greedy.research` ≈ 28 minus cost and tier), and check the size on a real position in step 4. Include a weak value: #29 started 5× too strong and lost (39.8% vs base). If the best point is at an end of the range, extend the range once. Several knobs of one mechanism: `--points "a=1,b=5|a=2,b=10"` |
| Tuning runs only | `--init k=v` for knobs at 0 (nudges are multiplicative, a 0 never moves); `--focus` on the new knobs only |

The sweep plays the same maps as train-full's curve points and its final test on the same
maps as train-full's final test, so numbers compare across sweeps and old runs. The **final
test** (400 unseen games against each panel model) is the head-to-head against the base. Do
not run `npm run arena` for it: arena writes `data/games/` and changes the shared Elo ratings.

## Steps

1. **Worktree from main**, so the live arena and web app in the main checkout are untouched:
   ```bash
   git worktree add .claude/worktrees/<id> -b model/<id> main
   ln -s ../../../node_modules .claude/worktrees/<id>/node_modules
   ```
2. **Open the notebook entry, before any run**: `cp -r experiments/TEMPLATE experiments/NN-<slug>`,
   fill `experiment.json` (status `running`, verdict `pending`, the run ids the sweeps will
   write) and the report's first three sections: *Question and hypothesis* (Jakob's idea in his
   own words, quoted, plus a prediction as numbers), *Mechanism*, *Setup*. The prediction is
   written before the result is known. Leave `\todo{jakob}{...}` where his input is wanted.
3. **Code**: the knob in `FullWeights` (bot_full.rs, default off), its JSON key in
   `full_weights`, `engine/api/src/lib.rs` (`full_weights_to_json`), `logic/engine/botFull.ts`
   (type), `scripts/lib/train-greedy.ts` (`cloneFull`, the knob list, `SCALARS`, and `whole`
   for integer knobs). Follow commit 857dda9 (defend) as the pattern.
4. **Build and check**: `npm run engine:build` (addon renamed into place, plus the web
   wasm), `cargo test --release -p polycore bot_full` in `engine/`, `npx tsc --noEmit -p .`
   (0 errors). Sanity-check the new signal on a real position (replay a game from
   `data/games` and compare `scoreFull` with the knob on and off).
5. **Serve the dashboard first, every time** (sweeps and tuning runs; the user watches there).
   One dashboard on port 8095, pointed at the experiment's worktree; without `--runs` it finds
   the worktree's training runs and sweeps by itself (sweeps appear under "Strength sweeps",
   point by point):
   ```bash
   pkill -f "scripts/train-dashboard.ts"
   nohup npm run train-dashboard -- --root .claude/worktrees/<id> > /dev/null 2>&1 &
   ```
   Once the run has started, check `curl -s localhost:8095/api/state` lists it, then give the
   user http://localhost:8095/experiment/NN-<slug> (the experiment's page: diagram, live
   results, open report parts, the PDF).
6. **Sweep** from the worktree, log to its `logs/`:
   ```bash
   mkdir -p logs && npm run sweep -- --id <id> --from <base> --metric finish --knob <k> --values 0.5,1,2,4 \
     > logs/<id>.log 2>&1
   ```
   It saves the best point as `models/<id>/model.json`, with one row per point in `sweep.jsonl`.
   Without `--knob`/`--points` it measures the base alone (a re-measure, e.g. in another setup:
   `--players 8 --size 20 --max-turns 300`; players must be even).
   (A tuning run instead: `nohup npm run train-probe -- --id <id> --from <base> --metric finish <settings>
   --workers 10 --panel <panel> > logs/<id>.log 2>&1 &`.)
   Wait with a background `until grep -q "took" logs/<id>.log` loop, not polling.
7. **Verdict**: **kept** when either holds (Jakob, 24 Nov, step 6 of #31):
   - **head to head**: the final test against the base has a finish score above 50% and points
     above 50% with the ±5% interval clear of 50%, and the best point's panel mean is at least
     the base row's (tuning runs: the mean at 100k at least the base's and the control's); or
   - **panel**: on the final-test maps the 6-model panel finish mean beats the base's by more
     than 1.5 points and the head-to-head is not worse (won at least 45% at its lower bound).
     Measure the base on the same maps: `npm run sweep -- --id <id>-base --from <base> --metric
     finish --games 2` (no points: final test of the base alone). Use this for mechanisms that
     act in situations a two-model match rarely has (e.g. the last rivals at peace).
   Otherwise **not kept**: the code still merges (off by default), and the next step starts
   from the unchanged base.
8. **Record** in the notebook, on the experiment's issue and one line on #31. Notebook: fill
   the remaining report sections, set `headline`, `verdict`, `status` and `result` in
   `experiment.json`, run `npm run experiment:report -- NN-<slug>` (it must build), and tell
   Jakob which `\todo{jakob}` parts are open. Issue:

   | | panel mean | vs base (panel test) | final test vs base |
   |---|---|---|---|
   | base · each sweep point · (tuning runs: control, trained) |

   plus where the new knobs ended, which kept changes touched them, a behaviour metric for
   the mechanism, and the verdict. The behaviour metric is one count the mechanism should
   change, read by replaying a recorded game (`replay()` from `logic/arena/record.ts` on
   `findGame(id)` from `scripts/lib/store.ts`) or the final-test games: e.g. cities lost
   while empty (defence), techs researched but never used (research), mean distance of
   units to the nearest enemy (front).
9. **Save and PR**: `cp logs/<id>.log models/<id>/train.log` (tuning runs also
   `rm models/<id>/checkpoint.json`),
   commit code, model and notebook folder on `model/<id>` (the model folder is committed either
   way: it is the experiment's record), PR to main with the result table, `Closes #<issue>`.
   Kept: a model PR (standing go to merge). Not kept: ask before merging, and keep the spec
   as `record.json` instead of `model.json` (a folder with `model.json` is listed as a model in
   the game, the arena and the tournament). Then remove the worktree.
   Kept only: add the new champion to the Elo tournament, or the game's Rankings table will not
   show it: `npm run elo-tournament -- --out elo/<latest date>` (finished pairs are skipped,
   about 15 minutes), and put the changed files under `elo/` in the same PR.

## Common mistakes

| Mistake | Instead |
|---|---|
| Two changes in one run | One mechanism per run; queue the rest as issues |
| A 100k training run per mechanism | A sweep; tuning runs every 3-4 kept mechanisms |
| One hand-set value only | 3-5 values ×2 apart, including a weak one |
| Tuning run with a knob at 0 | `--init` with a non-zero value |
| Base added to the panel, means compared | Compare on the fixed six |
| Separate `npm run arena` final test | The final test in `train-full`'s output |
| Committing `checkpoint.json` | Delete it; commit `train.log` |
| Training in the main checkout | A worktree; the live view runs from main |
| Copying the addon with `cp` over the old file | `npm run engine:build` (renames into place) |
| Starting a sweep or run without the dashboard | Serve it first (step 5) and give the user the link |
| Writing the hypothesis after seeing the result | Notebook entry first (step 2) |
| Typing result numbers from memory into the report | Copy them from the generated tables |
