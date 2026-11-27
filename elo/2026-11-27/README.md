# Elo tournament 2026-11-27

Every bot model against every other, in every game mode, in the Rust engine. 23800 games, 8 agents, 8m07s on 8 workers. Made by `scripts/elo-tournament.ts` at commit 46ac3ed; reproduce with `npm run elo-tournament -- --out <new folder>` (the same seeds give the same games).

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
| perfection | 4 | 16x16 | continents | 30 (the mode's own end) | 200 | 5600 |
| glory | 4 | 16x16 | drylands | 150 | 200 | 5600 |
| might | 4 | 16x16 | drylands | 150 | 200 | 5600 |
| domination | 4 | 16x16 | drylands | 150 | 200 | 5600 |
| creative | 8 | 20x20 | drylands | 150 | 50 | 1400 |

Left out: nobody.

## Rating by mode

Rating, with the place in that mode in brackets. Every column is its own fit with greedy-v1 at 1200: compare places and gaps across columns, not levels.

| agent | overall | perfection | glory | might | domination | creative |
|---|--:|--:|--:|--:|--:|--:|
| greedy-full-probe-perf-r15 | 1859 (1) | 1638 (1) | 1812 (1) | 2086 (1) | 2118 (1) | 2089 (1) |
| greedy-full-probe-perf | 1848 (2) | 1613 (2) | 1797 (3) | 2078 (2) | 2115 (2) | 2087 (2) |
| greedy-full-probe | 1839 (3) | 1603 (4) | 1794 (4) | 2066 (4) | 2104 (4) | 2075 (3) |
| greedy-full-combo-perf | 1837 (4) | 1604 (3) | 1798 (2) | 2069 (3) | 2111 (3) | 2053 (4) |
| greedy-full-combo | 1749 (5) | 1555 (5) | 1701 (5) | 1958 (5) | 1993 (5) | 1984 (5) |
| greedy-full-economy | 1711 (6) | 1507 (6) | 1688 (6) | 1930 (6) | 1965 (6) | 1912 (6) |
| greedy-v1 | 1200 (7) | 1200 (7) | 1200 (7) | 1200 (7) | 1200 (7) | 1200 (7) |
| random-v1 | 250 (8) | 472 (8) | at most 242 (8) | at most 271 (8) | at most 273 (8) | at most 514 (8) |

## Overall

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf-r15 | 1859 | 1846 to 1873 | 5950 | 70.1% | 60.6% | 65.2% | 62.9% | 49 |  |
| 2 | greedy-full-probe-perf | 1848 | 1836 to 1861 | 5950 | 68.8% | 60.3% | 64.2% | 61.7% | 49 |  |
| 3 | greedy-full-probe | 1839 | 1827 to 1851 | 5950 | 67.7% | 59.7% | 63.4% | 60.4% | 50 |  |
| 4 | greedy-full-combo-perf | 1837 | 1823 to 1852 | 5950 | 67.5% | 59.7% | 63.5% | 61.3% | 49 |  |
| 5 | greedy-full-combo | 1749 | 1737 to 1762 | 5950 | 56.7% | 54.6% | 55.3% | 52.4% | 48 |  |
| 6 | greedy-full-economy | 1711 | 1694 to 1728 | 5950 | 52.3% | 52.2% | 52.0% | 48.4% | 48 |  |
| 7 | greedy-v1 | 1200 | 1163 to 1233 | 5950 | 16.9% | 33.7% | 24.5% | 16.5% | 45 | 1147 |
| 8 | random-v1 | 250 | 61 to 361 | 5950 | 0.1% | 19.2% | 12.0% | 0.1% | 45 | 192 |

## perfection

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf-r15 | 1638 | 1621 to 1659 | 1400 | 69.4% | 56.5% | 59.7% | 69.4% | 30 |  |
| 2 | greedy-full-probe-perf | 1613 | 1597 to 1633 | 1400 | 66.2% | 56.1% | 58.1% | 66.2% | 30 |  |
| 3 | greedy-full-combo-perf | 1604 | 1586 to 1624 | 1400 | 65.1% | 56.2% | 57.5% | 65.1% | 30 |  |
| 4 | greedy-full-probe | 1603 | 1585 to 1626 | 1400 | 65.0% | 56.0% | 57.5% | 65.0% | 30 |  |
| 5 | greedy-full-combo | 1555 | 1535 to 1577 | 1400 | 58.8% | 54.4% | 54.4% | 58.8% | 30 |  |
| 6 | greedy-full-economy | 1507 | 1482 to 1531 | 1400 | 52.6% | 52.4% | 51.4% | 52.6% | 30 |  |
| 7 | greedy-v1 | 1200 | 1155 to 1239 | 1400 | 22.6% | 42.0% | 36.3% | 22.6% | 30 | 1147 |
| 8 | random-v1 | 472 | 291 to 578 | 1400 | 0.3% | 26.5% | 25.1% | 0.3% | 30 | 192 |

## glory

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf-r15 | 1812 | 1791 to 1835 | 1400 | 69.6% | 57.2% | 67.9% | 69.6% | 25 |  |
| 2 | greedy-full-combo-perf | 1798 | 1779 to 1817 | 1400 | 67.8% | 56.9% | 66.3% | 67.8% | 25 |  |
| 3 | greedy-full-probe-perf | 1797 | 1778 to 1816 | 1400 | 67.6% | 57.3% | 66.2% | 67.6% | 25 |  |
| 4 | greedy-full-probe | 1794 | 1774 to 1817 | 1400 | 67.4% | 56.8% | 65.9% | 67.4% | 25 |  |
| 5 | greedy-full-combo | 1701 | 1678 to 1724 | 1400 | 55.9% | 53.8% | 55.3% | 55.9% | 26 |  |
| 6 | greedy-full-economy | 1688 | 1668 to 1708 | 1400 | 54.3% | 52.8% | 53.9% | 54.3% | 26 |  |
| 7 | greedy-v1 | 1200 | 1134 to 1250 | 1400 | 17.5% | 40.3% | 20.1% | 17.5% | 26 | 1147 |
| 8 | random-v1 | at most 242 | never won | 1400 | 0.0% | 24.8% | 4.4% | 0.0% | 26 | 192 |

## might

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf-r15 | 2086 | 2064 to 2115 | 1400 | 70.7% | 62.0% | 67.3% | 64.7% | 50 |  |
| 2 | greedy-full-probe-perf | 2078 | 2056 to 2104 | 1400 | 69.7% | 61.7% | 66.9% | 65.0% | 49 |  |
| 3 | greedy-full-combo-perf | 2069 | 2050 to 2093 | 1400 | 68.7% | 61.3% | 66.1% | 63.9% | 49 |  |
| 4 | greedy-full-probe | 2066 | 2045 to 2091 | 1400 | 68.3% | 60.9% | 65.5% | 63.2% | 49 |  |
| 5 | greedy-full-combo | 1958 | 1934 to 1991 | 1400 | 55.4% | 54.3% | 55.1% | 52.6% | 48 |  |
| 6 | greedy-full-economy | 1930 | 1903 to 1961 | 1400 | 52.2% | 52.2% | 52.2% | 49.6% | 48 |  |
| 7 | greedy-v1 | 1200 | 1077 to 1277 | 1400 | 14.9% | 31.2% | 19.8% | 14.5% | 42 | 1147 |
| 8 | random-v1 | at most 271 | never won | 1400 | 0.0% | 16.5% | 7.1% | 0.0% | 41 | 192 |

## domination

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf-r15 | 2118 | 2093 to 2150 | 1400 | 70.1% | 63.1% | 66.8% | 63.9% | 54 |  |
| 2 | greedy-full-probe-perf | 2115 | 2094 to 2141 | 1400 | 69.8% | 62.8% | 66.3% | 62.6% | 55 |  |
| 3 | greedy-full-combo-perf | 2111 | 2089 to 2138 | 1400 | 69.4% | 62.7% | 66.4% | 63.9% | 53 |  |
| 4 | greedy-full-probe | 2104 | 2084 to 2132 | 1400 | 68.5% | 61.7% | 65.3% | 62.2% | 53 |  |
| 5 | greedy-full-combo | 1993 | 1970 to 2020 | 1400 | 55.3% | 54.2% | 54.7% | 50.9% | 54 |  |
| 6 | greedy-full-economy | 1965 | 1940 to 1994 | 1400 | 52.1% | 52.0% | 51.9% | 47.9% | 54 |  |
| 7 | greedy-v1 | 1200 | 1070 to 1279 | 1400 | 14.8% | 28.5% | 20.7% | 14.3% | 48 | 1147 |
| 8 | random-v1 | at most 273 | never won | 1400 | 0.0% | 14.9% | 8.0% | 0.0% | 46 | 192 |

## creative

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe-perf-r15 | 2089 | 2061 to 2123 | 350 | 70.9% | 64.1% | 64.0% | 46.9% | 87 |  |
| 2 | greedy-full-probe-perf | 2087 | 2054 to 2126 | 350 | 70.6% | 63.8% | 63.5% | 47.1% | 86 |  |
| 3 | greedy-full-probe | 2075 | 2040 to 2113 | 350 | 69.1% | 63.1% | 62.7% | 44.0% | 91 |  |
| 4 | greedy-full-combo-perf | 2053 | 2008 to 2102 | 350 | 66.6% | 61.5% | 61.3% | 45.7% | 85 |  |
| 5 | greedy-full-combo | 1984 | 1957 to 2015 | 350 | 58.3% | 56.4% | 56.7% | 44.0% | 83 |  |
| 6 | greedy-full-economy | 1912 | 1869 to 1956 | 350 | 50.0% | 51.5% | 50.7% | 37.7% | 82 |  |
| 7 | greedy-v1 | 1200 | 1123 to 1287 | 350 | 14.6% | 26.5% | 25.9% | 13.4% | 80 | 1147 |
| 8 | random-v1 | at most 514 | never won | 350 | 0.0% | 13.0% | 15.2% | 0.0% | 82 | 192 |

The last column is the rating in data/ratings.json when this run was made (mostly 2-player games on 11x11, another method of counting; see scripts/elo.ts). The pairwise results are in ratings.json (`matrix`) and on the dashboard (`npm run elo-dashboard`).
