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

## Elo (`data/ratings.json`, `data/results.jsonl`)

Ratings are a Bradley–Terry fit, the method behind LMArena's leaderboard and
BayesElo in computer chess (`logic/arena/elo.ts`):
- Every finished game adds one line to `data/results.jsonl`: who sat where and how they placed (winner first, then by score).
- Every pair of seats in a game counts as one match, weighted 1/(players − 1); equal placing is a draw.
- The ratings are the strengths that best explain all games at once, so the order games were played in does not matter. (The old step-by-step Elo, K = 32, let recent games dominate: greedy-v1 sat above greedy-hill-v1 despite losing to it 36–44.)
- Prior: everyone also drew one virtual game against a fixed 1200 player, so players with a single game stay near 1200.
- `lo`–`hi`: the 95% interval from 200 refits on games resampled with replacement. Overlapping intervals mean the order between those two is not settled yet.
- Elo scale: a 200-point gap means the stronger side wins about 3 games in 4.

Filtered ratings: every results line also stores the game's mode, player count,
map size and map type, and the same fit over only the matching games gives a
player's rating in that kind of game. Models play every format with the same
weights; the filters show where they are strong or weak.
- `GET /api/ratings?mode=domination&players=2&size=11` (any combination; none = overall), `GET /api/ratings/facets` for the game counts.
- Analyse → Rankings has a row of chips per setting (only settings with more than one value appear).
- New game shows each model's rating for the chosen mode, player count and map size, or "overall" when it has no such games.

The fit reruns after every finished game (about 0.35 s for 300 games). `npm run elo -- --rebuild`
rebuilds the results file from all recordings and refits. Keys are `model:<id>` and
`human:<profileId>`. Unfinished games and a model playing itself don't count.

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

`greedy-hill-v2` (2026-11-23, trained 10× longer: 600 rounds of 60 games, from
greedy-v1's weights, ~20 minutes): 15 of 600 challengers kept, 72% of 100 unseen
games and 57.9% of the points against greedy-v1. In 40 recorded arena games per
pairing: 22–18 against greedy-hill-v1, 27–13 against greedy-v1, 40–0 against
random-v1. It plays differently from v1: monuments 70→162 and healing others
15→89, plain hits 20→1.5 and ruins 60→11.

`greedy-hill-v3` (2026-11-23, 10× longer again: 6000 rounds of 60 games, 360,000
games on 10 worker threads, ~35 minutes): 60 of 6000 challengers kept, 68% of 100
unseen games and 58.7% of the points against greedy-v1, about where v2 landed. A
third style: mass army (train 12→103, unitsPerCity 3→27, growBase 25→112) with
captures almost ignored (100→8). More rounds alone stopped paying: the climber
mostly drifts between equally good weight sets once it is near a local optimum.

`scripts/arena-grid.sh` plays every bot pairing in domination 1v1 (11×11 and
16×16) and perfection 1v1 16×16, plus 3- and 4-player free-for-alls, to give the
rating filters data (~270 games).
