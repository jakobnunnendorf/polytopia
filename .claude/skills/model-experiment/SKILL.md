---
name: model-experiment
description: Use when improving a bot model in polytopia-ai-research - adding a decision mechanism or knob to greedy-full (engine/core/src/bot_full.rs), retraining with train-full/train-hill/train-es, A/B-testing a trainer change, or deciding whether a trained model becomes the new champion. Also when the user names an experiment issue (the one-mechanism-per-run plan, #31).
---

# Model experiment

One change per experiment, measured against the current champion and a control with the
same budget and seed, recorded on its issue. The experiment is the unit: code, run,
verdict and record go together.

## The run contract (what every experiment is)

| Part | Value |
|---|---|
| Names | model id `greedy-full-<mechanism>` (e.g. `greedy-full-defend`); branch `model/<id>`; worktree `.claude/worktrees/<id>`; log `logs/<id>.log` |
| Base | the current champion: the last experiment whose verdict was **kept** (see #31 comments), else `greedy-full-v1` |
| Change | exactly one mechanism or trainer change, **off by default** (old models play unchanged) |
| Panel | `greedy-v1,greedy-hill-v1,greedy-hill-v2,greedy-hill-v3,greedy-hill-v4,greedy-full-v1` (fixed: curves stay comparable across steps). Add the base only when it is not `greedy-full-v1`, as a 7th entry, and compare means on the fixed six |
| Settings | `--budget 100000 --patience 0 --league self,past --batch 30 --seed 4242 --curve-every 12500` |
| Control | same base, same settings, no change. Reuse an existing control for the same base (for `greedy-full-v1`: `greedy-full-v2-ctrl`, panel 66.0% at 100k). Run a new one only when the base changes |
| Knob names | as the trainer prints them in KEPT lines: scalars bare (`defend`, `techUse`), tables `group.key` (`unit.giant`, `greedy.move`). Never a `full.` prefix |
| Start values | new knobs need `--init k=v` with a hand-set non-zero value: nudges are multiplicative, a 0 never moves. Size it so the term can just tip the choice it is about: compare with the base score it competes with (a move ≈ `greedy.move` ≈ 25 plus tiles gained; research ≈ `greedy.research` ≈ 28 minus cost and tier), and check the size on a real position in step 3 |
| Focus | `--focus <the new knobs only>`; never existing knobs (that tests something else) |

The curve point at 0 games is the **mechanism alone at its hand-set value**; report it.
`train-full` ends with the **final test** (400 unseen games against each panel model): that
is the head-to-head against the base. Do not run `npm run arena` for it: arena writes
`data/games/` and changes the shared Elo ratings.

## Steps

1. **Worktree from main**, so the live arena and web app in the main checkout are untouched:
   ```bash
   git worktree add .claude/worktrees/<id> -b model/<id> main
   ln -s ../../../node_modules .claude/worktrees/<id>/node_modules
   ```
2. **Code**: the knob in `FullWeights` (bot_full.rs, default off), its JSON key in
   `full_weights`, `engine/api/src/lib.rs` (`full_weights_to_json`), `logic/engine/botFull.ts`
   (type), `scripts/lib/train-greedy.ts` (`cloneFull`, the knob list, `SCALARS`, and `whole`
   for integer knobs). Follow commit 857dda9 (defend) as the pattern.
3. **Build and check**: `npm run engine:build` (addon renamed into place, plus the web
   wasm), `cargo test --release -p polycore bot_full` in `engine/`, `npx tsc --noEmit -p .`
   (0 errors). Sanity-check the new signal on a real position (replay a game from
   `data/games` and compare `scoreFull` with the knob on and off).
4. **Train** from the worktree, log to its `logs/`:
   ```bash
   mkdir -p logs && nohup npm run train-full -- --id <id> --from <base> <settings> \
     --workers 10 --panel <panel> --init <k=v,...> --focus <new knobs> > logs/<id>.log 2>&1 &
   ```
   Point the dashboard at it: `npm run train-dashboard -- --root .claude/worktrees/<id> --runs <id>`.
   Wait with a background `until grep -q "^training took" logs/<id>.log` loop, not polling.
5. **Verdict**: **kept** when the final test against the base has points above 50% with
   the ±5% interval clear of 50%, and the panel mean at 100k is at least the base's and
   the control's. Otherwise **not kept**: the code still merges (off by default), and the
   next step starts from the unchanged base.
6. **Record** on the experiment's issue and one line on #31:

   | | panel at 0 games | panel at 100k | final test vs base |
   |---|---|---|---|
   | base · control · change hand-set · change trained |

   plus where the new knobs ended, which kept changes touched them, a behaviour metric for
   the mechanism, and the verdict. The behaviour metric is one count the mechanism should
   change, read by replaying a recorded game (`replay()` from `logic/arena/record.ts` on
   `findGame(id)` from `scripts/lib/store.ts`) or the final-test games: e.g. cities lost
   while empty (defence), techs researched but never used (research), mean distance of
   units to the nearest enemy (front).
7. **Save and PR**: `cp logs/<id>.log models/<id>/train.log`, `rm models/<id>/checkpoint.json`,
   commit code and model on `model/<id>` (the model folder is committed either way: it is the
   experiment's record), PR to main with the result table, `Closes #<issue>`.
   Kept: a model PR (standing go to merge). Not kept: ask before merging. Then remove the
   worktree.

## Common mistakes

| Mistake | Instead |
|---|---|
| Two changes in one run | One mechanism per run; queue the rest as issues |
| New knob starting at 0 | `--init` with a non-zero hand-set value |
| Base added to the panel, means compared | Compare on the fixed six |
| Separate `npm run arena` final test | The final test in `train-full`'s output |
| Committing `checkpoint.json` | Delete it; commit `train.log` |
| Training in the main checkout | A worktree; the live view runs from main |
| Copying the addon with `cp` over the old file | `npm run engine:build` (renames into place) |
