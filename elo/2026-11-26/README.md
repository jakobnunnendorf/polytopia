# Elo tournament 2026-11-26

Every bot model against every other, in every game mode, in the Rust engine. 17850 games, 7 agents, 6m46s on 5 workers. Made by `scripts/elo-tournament.ts` at commit da04376; reproduce with `npm run elo-tournament -- --out <new folder>` (the same seeds give the same games).

## Method

- Round robin: every pair of agents plays the same map seeds (1800000000 upward) in every mode. Every map is played twice, the two models swapping seats. In a game the two models take alternate seats of a free-for-all and every seat plays for itself, as in training.
- Who won: the side of the seat the engine declares winner; a game still running at the turn cap goes to the side of the highest-scoring seat.
- Rating: Bradley-Terry maximum likelihood over all games of a mode at once, so the order of games does not matter. Elo scale (400 points = 10:1 odds), greedy-v1 = 1200 in every table (where data/ratings.json puts it), so a rating says how far an agent is from greedy-v1 in that mode. "Overall" is one fit over the games of all modes, every mode counting the same (a game of a mode with fewer games per pair weighs more); its other columns are averaged the same way.
- Interval: 95%, from 1000 refits on map seeds drawn with replacement (all games on a map go in or out together), each centred on the mean of the learned agents.
- Points: the agent's share of all points in its games. Finish: the finish score of training (#124). Won by the mode's rule: games it won that ended by the mode's own rule (conquest in domination), not at the turn cap, as a share of all its games.
- An agent that never won is held at a finite rating only by the fit's prior (one virtual win and one virtual loss per agent, spread over the others); its rating is an upper bound and is marked "at most".

## Setup

| mode | players | map | map type | turn cap | games per pair | games played |
|---|--:|---|---|--:|--:|--:|
| perfection | 4 | 16x16 | continents | 30 (the mode's own end) | 200 | 4200 |
| glory | 4 | 16x16 | drylands | 150 | 200 | 4200 |
| might | 4 | 16x16 | drylands | 150 | 200 | 4200 |
| domination | 4 | 16x16 | drylands | 150 | 200 | 4200 |
| creative | 8 | 20x20 | drylands | 150 | 50 | 1050 |

Left out: nobody.

## Rating by mode

Rating, with the place in that mode in brackets. Every column is its own fit with greedy-v1 at 1200: compare places and gaps across columns, not levels.

| agent | overall | perfection | glory | might | domination | creative |
|---|--:|--:|--:|--:|--:|--:|
| greedy-full-probe-perf | 1848 (1) | 1608 (1) | 1817 (1) | 2114 (1) | 2140 (1) | 2063 (1) |
| greedy-full-combo-perf | 1840 (2) | 1601 (2) | 1814 (2) | 2109 (2) | 2138 (2) | 2037 (3) |
| greedy-full-probe | 1832 (3) | 1580 (3) | 1813 (3) | 2100 (3) | 2124 (3) | 2043 (2) |
| greedy-full-combo | 1749 (4) | 1542 (4) | 1720 (4) | 1997 (4) | 2014 (4) | 1966 (4) |
| greedy-full-economy | 1714 (5) | 1488 (5) | 1712 (5) | 1968 (5) | 1995 (5) | 1902 (5) |
| greedy-v1 | 1200 (6) | 1200 (6) | 1200 (6) | 1200 (6) | 1200 (6) | 1200 (6) |
| random-v1 | 285 (7) | 507 (7) | at most 250 (7) | at most 274 (7) | at most 274 (7) | at most 513 (7) |

## Overall

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf | 1848 | 1835 to 1863 | 5100 | 72.3% | 62.1% | 66.8% | 64.9% | 49 |  |
| 2 | greedy-full-combo-perf | 1840 | 1826 to 1856 | 5100 | 71.3% | 61.5% | 66.0% | 64.0% | 49 |  |
| 3 | greedy-full-probe | 1832 | 1821 to 1844 | 5100 | 70.3% | 61.3% | 65.5% | 62.9% | 49 |  |
| 4 | greedy-full-combo | 1749 | 1735 to 1762 | 5100 | 60.4% | 56.6% | 57.9% | 55.8% | 48 |  |
| 5 | greedy-full-economy | 1714 | 1697 to 1730 | 5100 | 56.3% | 54.3% | 55.2% | 52.0% | 48 |  |
| 6 | greedy-v1 | 1200 | 1167 to 1231 | 5100 | 19.3% | 35.1% | 26.4% | 18.7% | 46 | 1202 |
| 7 | random-v1 | 285 | 91 to 388 | 5100 | 0.1% | 19.3% | 12.1% | 0.1% | 46 | 387 |

## perfection

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf | 1608 | 1589 to 1630 | 1200 | 70.4% | 57.0% | 60.2% | 70.4% | 30 |  |
| 2 | greedy-full-combo-perf | 1601 | 1583 to 1620 | 1200 | 69.5% | 57.2% | 59.8% | 69.5% | 30 |  |
| 3 | greedy-full-probe | 1580 | 1559 to 1602 | 1200 | 66.8% | 56.8% | 58.4% | 66.8% | 30 |  |
| 4 | greedy-full-combo | 1542 | 1521 to 1564 | 1200 | 62.0% | 55.4% | 56.0% | 62.0% | 30 |  |
| 5 | greedy-full-economy | 1488 | 1465 to 1511 | 1200 | 55.2% | 53.3% | 52.6% | 55.2% | 30 |  |
| 6 | greedy-v1 | 1200 | 1161 to 1236 | 1200 | 25.7% | 43.3% | 37.8% | 25.7% | 30 | 1202 |
| 7 | random-v1 | 507 | 315 to 607 | 1200 | 0.4% | 26.8% | 25.2% | 0.4% | 30 | 387 |

## glory

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf | 1817 | 1795 to 1840 | 1200 | 71.1% | 58.5% | 69.3% | 71.1% | 25 |  |
| 2 | greedy-full-combo-perf | 1814 | 1795 to 1835 | 1200 | 70.8% | 58.0% | 69.0% | 70.8% | 25 |  |
| 3 | greedy-full-probe | 1813 | 1792 to 1836 | 1200 | 70.7% | 57.9% | 68.9% | 70.7% | 25 |  |
| 4 | greedy-full-combo | 1720 | 1696 to 1745 | 1200 | 59.4% | 55.3% | 58.6% | 59.4% | 26 |  |
| 5 | greedy-full-economy | 1712 | 1693 to 1734 | 1200 | 58.5% | 54.2% | 57.7% | 58.5% | 26 |  |
| 6 | greedy-v1 | 1200 | 1128 to 1256 | 1200 | 19.6% | 41.2% | 22.0% | 19.6% | 26 | 1202 |
| 7 | random-v1 | at most 250 | never won | 1200 | 0.0% | 24.9% | 4.4% | 0.0% | 26 | 387 |

## might

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf | 2114 | 2091 to 2144 | 1200 | 73.1% | 63.6% | 69.5% | 68.0% | 48 |  |
| 2 | greedy-full-combo-perf | 2109 | 2087 to 2138 | 1200 | 72.5% | 63.4% | 69.2% | 67.6% | 48 |  |
| 3 | greedy-full-probe | 2100 | 2076 to 2131 | 1200 | 71.5% | 62.8% | 68.2% | 66.0% | 49 |  |
| 4 | greedy-full-combo | 1997 | 1972 to 2030 | 1200 | 59.5% | 56.5% | 58.3% | 56.4% | 47 |  |
| 5 | greedy-full-economy | 1968 | 1942 to 1998 | 1200 | 56.3% | 54.6% | 55.8% | 53.8% | 48 |  |
| 6 | greedy-v1 | 1200 | 1090 to 1274 | 1200 | 17.2% | 32.6% | 21.7% | 16.7% | 43 | 1202 |
| 7 | random-v1 | at most 274 | never won | 1200 | 0.0% | 16.5% | 7.2% | 0.0% | 42 | 387 |

## domination

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf | 2140 | 2116 to 2168 | 1200 | 73.3% | 65.0% | 69.0% | 65.5% | 55 |  |
| 2 | greedy-full-combo-perf | 2138 | 2113 to 2169 | 1200 | 73.0% | 64.8% | 69.2% | 67.3% | 52 |  |
| 3 | greedy-full-probe | 2124 | 2103 to 2152 | 1200 | 71.4% | 63.7% | 67.8% | 65.3% | 52 |  |
| 4 | greedy-full-combo | 2014 | 1992 to 2041 | 1200 | 58.7% | 56.5% | 57.7% | 54.4% | 53 |  |
| 5 | greedy-full-economy | 1995 | 1967 to 2029 | 1200 | 56.6% | 54.8% | 55.6% | 52.2% | 53 |  |
| 6 | greedy-v1 | 1200 | 1067 to 1279 | 1200 | 17.1% | 30.1% | 22.5% | 16.4% | 49 | 1202 |
| 7 | random-v1 | at most 274 | never won | 1200 | 0.0% | 15.0% | 8.1% | 0.0% | 47 | 387 |

## creative

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf | 2063 | 2028 to 2103 | 300 | 73.7% | 66.3% | 66.0% | 49.7% | 87 |  |
| 2 | greedy-full-probe | 2043 | 2007 to 2085 | 300 | 71.3% | 65.1% | 64.3% | 45.7% | 89 |  |
| 3 | greedy-full-combo-perf | 2037 | 1993 to 2086 | 300 | 70.7% | 63.9% | 62.7% | 45.0% | 87 |  |
| 4 | greedy-full-combo | 1966 | 1938 to 1996 | 300 | 62.3% | 59.0% | 59.0% | 46.7% | 83 |  |
| 5 | greedy-full-economy | 1902 | 1854 to 1950 | 300 | 55.0% | 54.3% | 54.1% | 40.3% | 84 |  |
| 6 | greedy-v1 | 1200 | 1124 to 1285 | 300 | 17.0% | 28.4% | 28.1% | 15.3% | 81 | 1202 |
| 7 | random-v1 | at most 513 | never won | 300 | 0.0% | 13.0% | 15.7% | 0.0% | 84 | 387 |

The last column is the rating in data/ratings.json when this run was made (mostly 2-player games on 11x11, another method of counting; see scripts/elo.ts). The pairwise results are in ratings.json (`matrix`) and on the dashboard (`npm run elo-dashboard`).
