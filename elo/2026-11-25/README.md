# Elo tournament 2026-11-25

Every bot model against every other, in every game mode, in the Rust engine. 89250 games, 15 agents, 33m17s on 5 workers. Made by `scripts/elo-tournament.ts` at commit 7ec1537; reproduce with `npm run elo-tournament -- --out <new folder>` (the same seeds give the same games).

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
| perfection | 4 | 16x16 | drylands | 30 (the mode's own end) | 200 | 21000 |
| glory | 4 | 16x16 | drylands | 150 | 200 | 21000 |
| might | 4 | 16x16 | drylands | 150 | 200 | 21000 |
| domination | 4 | 16x16 | drylands | 150 | 200 | 21000 |
| creative | 8 | 20x20 | drylands | 150 | 50 | 5250 |

Left out: claude-sonnet-agent (external agent: every move is a paid model call); qwen3-coder-lmstudio (LLM agent: needs a local model server).

## Rating by mode

Rating, with the place in that mode in brackets. Every column is its own fit with greedy-v1 at 1200: compare places and gaps across columns, not levels.

| agent | overall | perfection | glory | might | domination | creative |
|---|--:|--:|--:|--:|--:|--:|
| greedy-full-front-sweep | 1707 (1) | 1543 (1) | 1571 (1) | 1836 (3) | 1843 (2) | 1916 (1) |
| greedy-full-roads | 1695 (2) | 1530 (2) | 1555 (2) | 1836 (2) | 1841 (3) | 1886 (2) |
| greedy-full-front | 1694 (3) | 1529 (4) | 1554 (3) | 1835 (4) | 1841 (4) | 1884 (3) |
| greedy-full-peacebreak | 1693 (4) | 1529 (3) | 1554 (4) | 1838 (1) | 1844 (1) | 1872 (4) |
| greedy-full-v1 | 1661 (5) | 1516 (5) | 1541 (6) | 1796 (6) | 1803 (6) | 1801 (5) |
| greedy-full-defend | 1661 (6) | 1511 (6) | 1544 (5) | 1800 (5) | 1807 (5) | 1796 (6) |
| greedy-full-research | 1521 (7) | 1387 (7) | 1397 (7) | 1626 (7) | 1631 (7) | 1694 (7) |
| greedy-es-v1 | 1419 (8) | 1367 (9) | 1383 (8) | 1469 (8) | 1473 (8) | 1456 (8) |
| greedy-hill-v3 | 1408 (9) | 1376 (8) | 1378 (9) | 1443 (10) | 1448 (10) | 1439 (9) |
| greedy-hill-v4 | 1402 (10) | 1356 (10) | 1375 (10) | 1450 (9) | 1454 (9) | 1423 (11) |
| greedy-hill-v5 | 1376 (11) | 1311 (11) | 1327 (11) | 1430 (11) | 1435 (11) | 1434 (10) |
| greedy-hill-v2 | 1302 (12) | 1289 (12) | 1298 (12) | 1331 (13) | 1331 (13) | 1270 (13) |
| greedy-hill-v1 | 1301 (13) | 1255 (13) | 1256 (13) | 1349 (12) | 1354 (12) | 1334 (12) |
| greedy-v1 | 1200 (14) | 1200 (14) | 1200 (14) | 1200 (14) | 1200 (14) | 1200 (14) |
| random-v1 | -116 (15) | 111 (15) | at most 1 (15) | at most 82 (15) | at most 85 (15) | at most 311 (15) |

## Overall

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-front-sweep | 1707 | 1684 to 1730 | 11900 | 75.8% | 60.9% | 67.9% | 62.7% | 58 |  |
| 2 | greedy-full-roads | 1695 | 1676 to 1716 | 11900 | 74.7% | 61.3% | 67.0% | 61.8% | 58 |  |
| 3 | greedy-full-front | 1694 | 1675 to 1714 | 11900 | 74.6% | 61.2% | 66.9% | 61.6% | 59 |  |
| 4 | greedy-full-peacebreak | 1693 | 1674 to 1713 | 11900 | 74.5% | 61.6% | 68.5% | 67.5% | 53 |  |
| 5 | greedy-full-v1 | 1661 | 1643 to 1679 | 11900 | 71.1% | 59.1% | 64.5% | 58.7% | 60 |  |
| 6 | greedy-full-defend | 1661 | 1643 to 1679 | 11900 | 71.1% | 59.1% | 64.5% | 58.7% | 60 |  |
| 7 | greedy-full-research | 1521 | 1503 to 1539 | 11900 | 55.5% | 53.0% | 53.3% | 43.8% | 62 |  |
| 8 | greedy-es-v1 | 1419 | 1402 to 1434 | 11900 | 43.8% | 49.2% | 46.2% | 32.9% | 68 |  |
| 9 | greedy-hill-v3 | 1408 | 1392 to 1425 | 11900 | 42.5% | 48.2% | 44.2% | 30.0% | 69 | 1340 |
| 10 | greedy-hill-v4 | 1402 | 1385 to 1421 | 11900 | 41.9% | 48.2% | 44.3% | 29.2% | 71 | 1374 |
| 11 | greedy-hill-v5 | 1376 | 1360 to 1393 | 11900 | 39.1% | 46.0% | 42.4% | 29.8% | 65 |  |
| 12 | greedy-hill-v2 | 1302 | 1280 to 1323 | 11900 | 31.5% | 43.8% | 38.2% | 21.3% | 72 | 1317 |
| 13 | greedy-hill-v1 | 1301 | 1279 to 1321 | 11900 | 31.4% | 42.7% | 36.9% | 21.8% | 67 | 1260 |
| 14 | greedy-v1 | 1200 | 1168 to 1230 | 11900 | 22.6% | 36.8% | 31.2% | 19.0% | 60 | 1202 |
| 15 | random-v1 | -116 | -254 to 10 | 11900 | 0.0% | 18.8% | 13.9% | 0.0% | 55 | 387 |

## perfection

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-front-sweep | 1543 | 1522 to 1567 | 2800 | 70.5% | 56.1% | 60.3% | 70.5% | 30 |  |
| 2 | greedy-full-roads | 1530 | 1509 to 1551 | 2800 | 69.0% | 55.9% | 59.6% | 69.0% | 30 |  |
| 3 | greedy-full-peacebreak | 1529 | 1508 to 1550 | 2800 | 68.9% | 55.9% | 59.5% | 68.9% | 30 |  |
| 4 | greedy-full-front | 1529 | 1509 to 1550 | 2800 | 68.9% | 55.9% | 59.5% | 68.9% | 30 |  |
| 5 | greedy-full-v1 | 1516 | 1496 to 1537 | 2800 | 67.4% | 55.2% | 58.7% | 67.4% | 30 |  |
| 6 | greedy-full-defend | 1511 | 1492 to 1533 | 2800 | 66.8% | 55.0% | 58.4% | 66.8% | 30 |  |
| 7 | greedy-full-research | 1387 | 1366 to 1407 | 2800 | 50.9% | 50.6% | 50.4% | 50.9% | 30 |  |
| 8 | greedy-hill-v3 | 1376 | 1358 to 1393 | 2800 | 49.4% | 51.3% | 49.7% | 49.4% | 30 | 1340 |
| 9 | greedy-es-v1 | 1367 | 1350 to 1384 | 2800 | 48.3% | 51.8% | 49.1% | 48.3% | 30 |  |
| 10 | greedy-hill-v4 | 1356 | 1334 to 1376 | 2800 | 46.9% | 51.1% | 48.4% | 46.9% | 30 | 1374 |
| 11 | greedy-hill-v5 | 1311 | 1291 to 1332 | 2800 | 41.3% | 48.4% | 45.6% | 41.3% | 30 |  |
| 12 | greedy-hill-v2 | 1289 | 1269 to 1309 | 2800 | 38.5% | 49.0% | 44.3% | 38.5% | 30 | 1317 |
| 13 | greedy-hill-v1 | 1255 | 1229 to 1276 | 2800 | 34.5% | 47.1% | 42.3% | 34.5% | 30 | 1260 |
| 14 | greedy-v1 | 1200 | 1170 to 1227 | 2800 | 28.7% | 42.9% | 39.3% | 28.7% | 30 | 1202 |
| 15 | random-v1 | 111 | -19 to 235 | 2800 | 0.0% | 23.9% | 24.8% | 0.0% | 30 | 387 |

## glory

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-front-sweep | 1571 | 1549 to 1593 | 2800 | 71.6% | 55.2% | 69.7% | 71.6% | 28 |  |
| 2 | greedy-full-roads | 1555 | 1535 to 1576 | 2800 | 69.8% | 55.0% | 68.0% | 69.8% | 28 |  |
| 3 | greedy-full-front | 1554 | 1534 to 1574 | 2800 | 69.7% | 55.0% | 67.9% | 69.7% | 28 |  |
| 4 | greedy-full-peacebreak | 1554 | 1534 to 1574 | 2800 | 69.6% | 55.0% | 67.9% | 69.6% | 28 |  |
| 5 | greedy-full-defend | 1544 | 1525 to 1564 | 2800 | 68.5% | 54.5% | 66.8% | 68.5% | 28 |  |
| 6 | greedy-full-v1 | 1541 | 1523 to 1562 | 2800 | 68.2% | 54.5% | 66.5% | 68.2% | 28 |  |
| 7 | greedy-full-research | 1397 | 1376 to 1417 | 2800 | 50.0% | 51.0% | 50.0% | 50.0% | 28 |  |
| 8 | greedy-es-v1 | 1383 | 1365 to 1399 | 2800 | 48.2% | 52.0% | 48.3% | 48.2% | 28 |  |
| 9 | greedy-hill-v3 | 1378 | 1360 to 1394 | 2800 | 47.6% | 51.5% | 47.8% | 47.6% | 28 | 1340 |
| 10 | greedy-hill-v4 | 1375 | 1354 to 1394 | 2800 | 47.2% | 51.4% | 47.4% | 47.2% | 28 | 1374 |
| 11 | greedy-hill-v5 | 1327 | 1306 to 1346 | 2800 | 41.3% | 48.8% | 42.0% | 41.3% | 28 |  |
| 12 | greedy-hill-v2 | 1298 | 1277 to 1318 | 2800 | 37.9% | 49.4% | 38.9% | 37.8% | 29 | 1317 |
| 13 | greedy-hill-v1 | 1256 | 1232 to 1276 | 2800 | 33.1% | 47.4% | 34.6% | 33.1% | 29 | 1260 |
| 14 | greedy-v1 | 1200 | 1169 to 1229 | 2800 | 27.4% | 43.9% | 29.5% | 27.4% | 28 | 1202 |
| 15 | random-v1 | at most 1 | never won | 2800 | 0.0% | 25.5% | 4.7% | 0.0% | 28 | 387 |

## might

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-peacebreak | 1838 | 1811 to 1866 | 2800 | 77.7% | 63.7% | 73.4% | 73.0% | 54 |  |
| 2 | greedy-full-roads | 1836 | 1810 to 1864 | 2800 | 77.6% | 63.4% | 71.4% | 66.3% | 61 |  |
| 3 | greedy-full-front-sweep | 1836 | 1806 to 1866 | 2800 | 77.6% | 62.5% | 71.7% | 66.0% | 61 |  |
| 4 | greedy-full-front | 1835 | 1808 to 1863 | 2800 | 77.5% | 63.3% | 71.2% | 65.7% | 61 |  |
| 5 | greedy-full-defend | 1800 | 1775 to 1825 | 2800 | 74.3% | 61.3% | 68.3% | 61.7% | 65 |  |
| 6 | greedy-full-v1 | 1796 | 1772 to 1821 | 2800 | 73.9% | 61.0% | 68.0% | 61.4% | 65 |  |
| 7 | greedy-full-research | 1626 | 1604 to 1652 | 2800 | 57.1% | 53.5% | 55.4% | 45.8% | 69 |  |
| 8 | greedy-es-v1 | 1469 | 1444 to 1490 | 2800 | 41.3% | 48.0% | 44.1% | 28.8% | 79 |  |
| 9 | greedy-hill-v4 | 1450 | 1427 to 1473 | 2800 | 39.4% | 47.4% | 41.5% | 24.3% | 82 | 1374 |
| 10 | greedy-hill-v3 | 1443 | 1418 to 1466 | 2800 | 38.7% | 47.1% | 40.8% | 24.6% | 79 | 1340 |
| 11 | greedy-hill-v5 | 1430 | 1405 to 1453 | 2800 | 37.5% | 45.0% | 39.9% | 26.3% | 73 |  |
| 12 | greedy-hill-v1 | 1349 | 1322 to 1375 | 2800 | 30.1% | 41.2% | 34.2% | 17.5% | 78 | 1260 |
| 13 | greedy-hill-v2 | 1331 | 1302 to 1359 | 2800 | 28.5% | 42.0% | 33.9% | 15.0% | 82 | 1317 |
| 14 | greedy-v1 | 1200 | 1151 to 1245 | 2800 | 18.8% | 34.2% | 26.6% | 14.4% | 65 | 1202 |
| 15 | random-v1 | at most 82 | never won | 2800 | 0.0% | 16.5% | 9.6% | 0.0% | 54 | 387 |

## domination

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-peacebreak | 1844 | 1818 to 1871 | 2800 | 77.8% | 66.1% | 72.7% | 70.7% | 61 |  |
| 2 | greedy-full-front-sweep | 1843 | 1813 to 1872 | 2800 | 77.6% | 64.5% | 70.8% | 63.1% | 68 |  |
| 3 | greedy-full-roads | 1841 | 1814 to 1868 | 2800 | 77.5% | 65.4% | 70.3% | 63.0% | 68 |  |
| 4 | greedy-full-front | 1841 | 1814 to 1869 | 2800 | 77.5% | 65.3% | 70.3% | 62.8% | 68 |  |
| 5 | greedy-full-defend | 1807 | 1782 to 1833 | 2800 | 74.5% | 62.9% | 67.4% | 58.3% | 72 |  |
| 6 | greedy-full-v1 | 1803 | 1780 to 1828 | 2800 | 74.1% | 62.7% | 67.1% | 58.2% | 72 |  |
| 7 | greedy-full-research | 1631 | 1608 to 1657 | 2800 | 57.1% | 54.1% | 54.9% | 42.7% | 76 |  |
| 8 | greedy-es-v1 | 1473 | 1448 to 1494 | 2800 | 41.3% | 47.2% | 44.2% | 25.5% | 88 |  |
| 9 | greedy-hill-v4 | 1454 | 1430 to 1477 | 2800 | 39.4% | 46.1% | 41.7% | 19.8% | 93 | 1374 |
| 10 | greedy-hill-v3 | 1448 | 1424 to 1471 | 2800 | 38.8% | 45.7% | 40.6% | 19.6% | 89 | 1340 |
| 11 | greedy-hill-v5 | 1435 | 1410 to 1458 | 2800 | 37.6% | 44.0% | 40.4% | 23.4% | 83 |  |
| 12 | greedy-hill-v1 | 1354 | 1328 to 1378 | 2800 | 30.1% | 39.4% | 35.2% | 14.9% | 88 | 1260 |
| 13 | greedy-hill-v2 | 1331 | 1302 to 1361 | 2800 | 28.2% | 39.9% | 34.9% | 11.2% | 94 | 1317 |
| 14 | greedy-v1 | 1200 | 1152 to 1244 | 2800 | 18.6% | 31.9% | 27.9% | 13.7% | 74 | 1202 |
| 15 | random-v1 | at most 85 | never won | 2800 | 0.0% | 14.8% | 11.5% | 0.0% | 64 | 387 |

## creative

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-front-sweep | 1916 | 1858 to 1992 | 700 | 81.9% | 66.3% | 67.0% | 42.3% | 105 |  |
| 2 | greedy-full-roads | 1886 | 1829 to 1960 | 700 | 79.4% | 67.0% | 66.0% | 41.0% | 105 |  |
| 3 | greedy-full-front | 1884 | 1826 to 1959 | 700 | 79.3% | 66.7% | 65.8% | 40.9% | 106 |  |
| 4 | greedy-full-peacebreak | 1872 | 1816 to 1946 | 700 | 78.3% | 67.5% | 69.2% | 55.1% | 94 |  |
| 5 | greedy-full-v1 | 1801 | 1756 to 1858 | 700 | 72.0% | 62.2% | 62.3% | 38.4% | 106 |  |
| 6 | greedy-full-defend | 1796 | 1756 to 1844 | 700 | 71.6% | 61.7% | 61.9% | 38.1% | 105 |  |
| 7 | greedy-full-research | 1694 | 1644 to 1754 | 700 | 62.1% | 56.0% | 55.8% | 29.9% | 108 |  |
| 8 | greedy-es-v1 | 1456 | 1408 to 1495 | 700 | 39.9% | 46.8% | 45.0% | 13.6% | 118 |  |
| 9 | greedy-hill-v3 | 1439 | 1380 to 1492 | 700 | 38.3% | 45.6% | 42.3% | 8.7% | 119 | 1340 |
| 10 | greedy-hill-v5 | 1434 | 1379 to 1476 | 700 | 37.9% | 43.5% | 44.1% | 16.7% | 113 |  |
| 11 | greedy-hill-v4 | 1423 | 1377 to 1463 | 700 | 36.9% | 45.0% | 42.5% | 7.7% | 122 | 1374 |
| 12 | greedy-hill-v1 | 1334 | 1257 to 1398 | 700 | 29.1% | 38.6% | 38.0% | 9.1% | 113 | 1260 |
| 13 | greedy-hill-v2 | 1270 | 1189 to 1331 | 700 | 24.1% | 38.7% | 38.8% | 4.0% | 125 | 1317 |
| 14 | greedy-v1 | 1200 | 1114 to 1265 | 700 | 19.3% | 31.4% | 32.6% | 10.9% | 103 | 1202 |
| 15 | random-v1 | at most 311 | never won | 700 | 0.0% | 13.1% | 18.7% | 0.0% | 98 | 387 |

The last column is the rating in data/ratings.json when this run was made (mostly 2-player games on 11x11, another method of counting; see scripts/elo.ts). The pairwise results are in ratings.json (`matrix`) and on the dashboard (`npm run elo-dashboard`).
