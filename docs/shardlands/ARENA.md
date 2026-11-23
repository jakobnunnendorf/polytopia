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

## Learning bots: hill climbing (`scripts/train-hill.ts`)

The simplest learning model. It keeps the greedy bot's code and learns its ~20
scoring weights from self-play, with nothing but final scores as feedback:

1. The champion starts as greedy-v1's weights.
2. Each round, a challenger nudges 3 random weights (each × e^(0.5·N(0,1))).
3. They play 60 games on fresh 11×11 maps, swapping seats on every map.
4. The challenger becomes champion if it took ≥ 52% of all points and won at least half the games.
5. After 60 rounds, the champion plays 100 games on maps it never trained on, and is saved as `models/<id>/model.json` (kind `greedy`).

```bash
npm run train-hill                                          # ~2-3 minutes, saves models/greedy-hill-v1
npm run train-hill -- --id greedy-hill-v2 --rounds 200 --games 100 --pick 2 --sigma 0.4 --accept 0.52
npm run arena -- --models greedy-hill-v2,greedy-v1 --games 40   # rate it on the Elo table
```

Training games are not recorded and do not change Elo; only the arena run afterwards does.
Points share instead of win/loss is the key choice: with win/loss only and 20
games a round, the climber kept lucky challengers and drifted (48% against
greedy-v1 after 100 rounds). `greedy-hill-v1` (2026-11-23): 6 of 60 challengers
kept, 58% of 100 unseen games and 52.6% of the points against greedy-v1, then 24
of 40 recorded arena games (Elo 1292).
