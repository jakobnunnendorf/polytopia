# Arena: opponent models, recordings, Elo

## Models (`models/<id>/`)

Every opponent is a model with a folder named after it. `model.json` holds its spec:

| id | kind | what it is |
|---|---|---|
| `greedy-v1` | greedy | The bot that controlled every opponent until 2026-11-23. Scores each legal action with a hand-written heuristic and plays the best one. `policy.snapshot.ts` is a frozen copy of its source. |
| `random-v1` | random | Random legal moves. The floor any model should beat. |
| `qwen3-coder-lmstudio` | llm | Qwen3 Coder 30B through LM Studio (`http://localhost:1234/v1`). It gets a position summary and up to 24 numbered candidate moves, and answers with a number. It falls back to `greedy-v1` when LM Studio is off. |
| `claude-sonnet-agent` | external | A Claude subagent playing through `npm run play`. It is not selectable in the app. |

To make a new model, copy a folder, give it a new `id`, and change its spec:
- **greedy:** set `weights` (any key of `GreedyWeights` in `logic/engine/bot.ts`).
- **llm:** set `llm.endpoint` and `llm.model` (any OpenAI-compatible server).

It shows up in the app's seat picker after a reload. A learned policy is a new `kind` in `logic/agents/registry.ts`.

## Seats and players

In **New game**, every seat is either:
- a **Person**: Guest, or a named player profile (`data/profiles.json`); or
- a **Model**.

With two or more people in a game, it becomes local hot-seat play. Between their turns, a "pass the device" screen hides the map.

## Recordings (`data/games/YYYY-MM-DD/<id>.json.gz`)

Every game is recorded automatically: games from the app, from `npm run arena` and from `npm run play`.

A record (`logic/arena/record.ts`) holds:
- the options: seed, map, clans;
- the seats;
- every action in order;
- the full state at the start of every player-turn;
- the result.

The engine is deterministic, so `replayStates(record)` rebuilds the exact state after every single action. That keeps files small: about 15 KB gzipped per game.

The app autosaves every round. That is what powers **Resume game**. The **Analyse** page shows the Elo rankings, replays finished games move by move, and watches games in progress live (mover's view, any player's view, or the whole map).

## Elo (`data/ratings.json`)

Each finished game is rated once:
- Seats are ranked winner first, then by score.
- Every pair of seats counts as one match.
- K = 32 / (players − 1).

Keys are `model:<id>` and `human:<profileId>`. Unfinished games and a model playing itself don't count.

## Commands

```bash
npm run arena-server                      # the app's backend on :8091 (relaunch-preview.sh starts it)
npm run arena -- --models greedy-v1,random-v1 --games 20       # models play each other, rotating seats
npm run arena -- --models greedy-v1,qwen3-coder-lmstudio --games 2
npm run elo                               # leaderboard;  npm run elo -- --rebuild  recomputes from all games
npm run export-dataset -- --out data/datasets/all.jsonl [--only-humans]   # one line per decision: obs, legal, action, outcome
npm run play -- new --me claude-sonnet-agent --opponent qwen3-coder-lmstudio   # play one seat from a terminal or agent
npm run play -- move --game <id> <n>
```

For the LLM model, LM Studio must be running with the model loaded: `~/.lmstudio/bin/lms load qwen3-coder-30b-a3b-instruct-mlx`.
