---
name: clean-up-after-yourself
description: Use in polytopia-ai-research before ending a session or reporting a task done, after a pull request you opened is merged or closed, after an experiment or training run finishes, and whenever you created a worktree, a branch, a stash, a background server, dashboard or training process, or scratch files and logs. Also when the user asks to tidy, clean up, or "what is left" across worktrees, branches, stashes and processes.
---

# Clean up after yourself

Every session removes what it created once that work is merged, closed or abandoned. Nobody else will:
on 26 Nov 2026 the repo held 25 worktrees, about 60 local and 30 remote branches, servers running for 36
hours from deleted folders and stashes from long-gone sessions, all left by finished sessions, and a
whole session went into sorting out which were safe to delete.

**Scope is the rule:** you clean up **what you created**, and anything else only when your human names it.
Another session's worktree, branch, process or stash is never yours, however stale it looks.

## When your work ends (merged, closed, or dropped)

Do these in order, at the end of the task, before your final report:

1. **Processes you started.** Stop every server, dashboard, watcher and training run you launched. Find
   each by its port or exact command, not by folder (a dashboard started from elsewhere with `--root` does
   not run *in* the worktree): `lsof -Pan -iTCP:<port> -sTCP:LISTEN`, `pgrep -fl "<your exact command>"`,
   confirm the command line is yours, `kill <pid>`, check the port is free. A run counts as finished when its
   process is gone and its log has the final line (`training took` / `sweep took`). One that must keep
   running (a training run the human watches): name it in the report with its port, PID and how to stop it.
2. **Records before the merge.** Commit everything worth keeping on your branch *before* the PR merges: an
   experiment's run folders under `models/<id>/` with its log as `train.log` (sweeps too), its
   `experiments/NN-slug/`, results the report cites. Untracked files in a worktree die with it. Found one
   after the merge: commit it on the same branch and open a small follow-up PR; the worktree stays until that
   merges.
3. **The worktree**, once its branch is in `dev`:
   ```bash
   git fetch -q --prune
   git merge-base --is-ancestor <branch> origin/dev && echo merged   # must print merged
   git -C .claude/worktrees/<name> status --porcelain               # must be empty
   lsof -d cwd 2>/dev/null | grep "worktrees/<name>$"               # must be empty
   ```
   Then: entered with `EnterWorktree` → `ExitWorktree` with `action: "remove"`; made with `git worktree add`
   → from outside it, `git worktree remove .claude/worktrees/<name>`, without `--force` (if git refuses, read
   what it names; `--force` only for files you know are scratch). A modified `public/polyengine.wasm` is
   restored first (`git restore public/polyengine.wasm`).
4. **The branch.** Local: `git branch -D <branch>` (after the check in step 3; `-d` gives a false "not fully
   merged", see below). On GitHub: `git push origin --delete <branch>` if it still exists
   (`git ls-remote --heads origin <branch>`; GitHub often deletes it on merge). This holds for `model/<id>`
   branches too: one branch per model is for iterating, not for keeping (Jakob, 26 Nov 2026).
5. **Stashes you made:** look first (`git stash show --stat --include-untracked <ref>`); one that holds work
   not in `dev` is reported, not dropped. Otherwise drop it by its tag (see below), never by position: the
   stash list is shared by every worktree and session.
6. **Scratch files:** temp files go in your job or tmp folder and are deleted there, never in the repo. A file
   you created by mistake in the main checkout (`nohup.out`): delete that one file by name.
7. **Report** what you removed and what you left on purpose, with the reason.

A pull request still open, or waiting for a human: keep its worktree and branch, and say so in the report.

## Is it mine? Is it safe?

| Check | Command | Means |
|---|---|---|
| Fully in dev | `git merge-base --is-ancestor <ref> origin/dev` | exit 0: nothing to lose. Trust this, not `[gone]` and not `git branch -d` (that compares with the current branch, often `main`, and says "not fully merged" for work that is in `dev`). PRs here merge with merge commits; if one was squashed, `gh pr view <n> --json state,headRefOid` showing `MERGED` with your tip as head is the proof instead |
| Commits not in dev | `git log --oneline origin/dev..<branch>` | anything listed is unmerged work: keep, or ask |
| Someone working there | `lsof -d cwd 2>/dev/null \| grep worktrees/<name>` and `cat .git/worktrees/<name>/locked` | a process or a lock: another session's, leave it. A lock naming a dead PID is still not yours: list it for the human |
| Uncommitted work | `git -C <wt> status --porcelain` | `M`/`A` lines are work; `??` may be records to commit first |
| Listening server | `lsof -Pan -p <pid> -iTCP -sTCP:LISTEN`, `ps -p <pid> -o etime=,command=` | who serves what, and since when |

## Repo specifics

- **`logs/` is git-ignored scratch** shared by every session's runs. Delete only the log files you wrote,
  by name; never `rm logs/*`. An experiment's log is committed as `models/<id>/train.log`.
- **Never delete a `models/` folder an experiment cites** under `runs` in `experiments/*/experiment.json`,
  even without a `model.json`: those are measurement records (`experiments/README.md`). The settings test
  fails on uncited folders without `model.json`, so a folder it accepts is a record.
- **The main checkout** serves the game and holds local arena data (`data/ratings.json`,
  `data/results.jsonl`, `data/games/`): never clean, reset or commit there; work in a worktree from `dev`.
- **Stash only with a unique tag** and drop by it, only when exactly one entry matches:
  ```bash
  git stash push -u -m "<session>-<what>"
  ref=$(git stash list --format='%gd %gs' | grep -F '<session>-<what>' | cut -d' ' -f1)
  [ "$(echo "$ref" | grep -c .)" = 1 ] && git stash drop "$ref"
  ```
- **Engine builds** (`engine/target`, `engine/node/polyengine.node`) go with the worktree; a rebuilt
  `public/polyengine.wasm` is committed on your branch or restored (`git restore public/polyengine.wasm`),
  never left modified.

## Repo-wide sweep (only when the human asks)

Survey first, delete nothing yet, and present the list grouped as: safe (in `dev`, clean, no process),
in use (process, lock, open PR), unmerged work (needs a decision). Then delete exactly what the human
approves, re-checking each item right before it goes.

```bash
git fetch -q --prune; git worktree list; git stash list
for b in $(git for-each-ref refs/heads refs/remotes/origin --format='%(refname:short)'); do
  git merge-base --is-ancestor "$b" origin/dev && echo "in dev: $b" || echo "NOT in dev: $b"; done
gh pr list
```

## Common mistakes

| Mistake | Instead |
|---|---|
| Ending the session with the worktree still there "in case" | Merged and committed: remove it. Open PR: keep it and say so |
| Deleting a stale-looking worktree of another session | Not yours: list it for the human |
| `git branch -D` because `-d` refused | First `merge-base --is-ancestor ... origin/dev`; `-d` only compares with the current branch |
| Removing a worktree with uncommitted run results | Commit the records first (`models/<id>/`, `train.log`) |
| Leaving a dashboard or lecture server running after the task | Stop it, or name it in the report |
| `rm logs/*.log` | Delete your own logs by name; other sessions' runs write there too |
| Dropping `stash@{0}` | Drop by your tag; positions shift when others stash |
