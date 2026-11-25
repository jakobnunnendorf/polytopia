# Elo tournament 2026-11-25

Every bot model against every other, in every game mode, in the Rust engine. 130050 games, 18 agents. Made by `scripts/elo-tournament.ts` at commit 9e19aae; reproduce with `npm run elo-tournament -- --out <new folder>` (the same seeds give the same games).

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
| perfection | 4 | 16x16 | drylands | 30 (the mode's own end) | 200 | 30600 |
| glory | 4 | 16x16 | drylands | 150 | 200 | 30600 |
| might | 4 | 16x16 | drylands | 150 | 200 | 30600 |
| domination | 4 | 16x16 | drylands | 150 | 200 | 30600 |
| creative | 8 | 20x20 | drylands | 150 | 50 | 7650 |

Left out: claude-sonnet-agent (external agent: every move is a paid model call); qwen3-coder-lmstudio (LLM agent: needs a local model server).

## Rating by mode

Rating, with the place in that mode in brackets. Every column is its own fit with greedy-v1 at 1200: compare places and gaps across columns, not levels.

| agent | overall | perfection | glory | might | domination | creative |
|---|--:|--:|--:|--:|--:|--:|
| greedy-full-combo | 1789 (1) | 1634 (1) | 1656 (2) | 1924 (1) | 1928 (1) | 1993 (1) |
| greedy-full-economy | 1768 (2) | 1614 (2) | 1658 (1) | 1915 (2) | 1919 (2) | 1917 (3) |
| greedy-full-movenoise | 1733 (3) | 1545 (4) | 1568 (4) | 1885 (3) | 1895 (3) | 1980 (2) |
| greedy-full-front-sweep | 1706 (4) | 1546 (3) | 1571 (3) | 1840 (4) | 1846 (4) | 1913 (4) |
| greedy-full-roads | 1697 (5) | 1537 (5) | 1560 (5) | 1837 (6) | 1842 (6) | 1892 (5) |
| greedy-full-front | 1694 (6) | 1536 (6) | 1559 (6) | 1835 (7) | 1841 (7) | 1885 (6) |
| greedy-full-peacebreak | 1694 (7) | 1536 (7) | 1559 (7) | 1838 (5) | 1844 (5) | 1876 (7) |
| greedy-full-v1 | 1659 (8) | 1522 (8) | 1545 (9) | 1792 (9) | 1800 (9) | 1803 (8) |
| greedy-full-defend | 1658 (9) | 1516 (9) | 1547 (8) | 1796 (8) | 1803 (8) | 1799 (9) |
| greedy-full-research | 1516 (10) | 1391 (10) | 1396 (10) | 1623 (10) | 1629 (10) | 1687 (10) |
| greedy-es-v1 | 1418 (11) | 1369 (12) | 1385 (11) | 1468 (11) | 1471 (11) | 1459 (11) |
| greedy-hill-v3 | 1408 (12) | 1378 (11) | 1382 (12) | 1445 (13) | 1449 (13) | 1436 (12) |
| greedy-hill-v4 | 1401 (13) | 1360 (13) | 1375 (13) | 1450 (12) | 1453 (12) | 1421 (14) |
| greedy-hill-v5 | 1374 (14) | 1315 (14) | 1329 (14) | 1428 (14) | 1433 (14) | 1430 (13) |
| greedy-hill-v1 | 1304 (15) | 1263 (16) | 1261 (16) | 1352 (15) | 1357 (15) | 1337 (15) |
| greedy-hill-v2 | 1303 (16) | 1292 (15) | 1299 (15) | 1331 (16) | 1331 (16) | 1270 (16) |
| greedy-v1 | 1200 (17) | 1200 (17) | 1200 (17) | 1200 (17) | 1200 (17) | 1200 (17) |
| random-v1 | -121 (18) | 105 (18) | at most -6 (18) | at most 80 (18) | at most 82 (18) | at most 309 (18) |

## Overall

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-combo | 1789 | 1768 to 1810 | 14450 | 78.1% | 64.1% | 70.9% | 69.5% | 53 |  |
| 2 | greedy-full-economy | 1768 | 1748 to 1788 | 14450 | 76.1% | 62.3% | 69.7% | 68.5% | 53 |  |
| 3 | greedy-full-movenoise | 1733 | 1712 to 1758 | 14450 | 72.6% | 61.5% | 67.1% | 65.4% | 52 |  |
| 4 | greedy-full-front-sweep | 1706 | 1688 to 1725 | 14450 | 69.8% | 58.2% | 63.6% | 57.9% | 58 |  |
| 5 | greedy-full-roads | 1697 | 1681 to 1714 | 14450 | 68.8% | 58.5% | 62.8% | 56.9% | 58 |  |
| 6 | greedy-full-front | 1694 | 1679 to 1712 | 14450 | 68.6% | 58.4% | 62.6% | 56.7% | 58 |  |
| 7 | greedy-full-peacebreak | 1694 | 1678 to 1711 | 14450 | 68.5% | 58.7% | 64.0% | 62.0% | 53 |  |
| 8 | greedy-full-v1 | 1659 | 1644 to 1674 | 14450 | 64.7% | 56.1% | 59.9% | 53.6% | 59 |  |
| 9 | greedy-full-defend | 1658 | 1643 to 1673 | 14450 | 64.7% | 56.1% | 59.9% | 53.6% | 59 |  |
| 10 | greedy-full-research | 1516 | 1500 to 1533 | 14450 | 48.8% | 49.9% | 48.4% | 38.6% | 60 |  |
| 11 | greedy-es-v1 | 1418 | 1400 to 1434 | 14450 | 38.2% | 46.4% | 42.0% | 28.9% | 66 |  |
| 12 | greedy-hill-v3 | 1408 | 1391 to 1426 | 14450 | 37.2% | 45.6% | 40.3% | 26.5% | 66 | 1340 |
| 13 | greedy-hill-v4 | 1401 | 1383 to 1421 | 14450 | 36.5% | 45.6% | 40.4% | 25.7% | 68 | 1374 |
| 14 | greedy-hill-v5 | 1374 | 1356 to 1393 | 14450 | 33.8% | 43.2% | 38.3% | 26.0% | 63 |  |
| 15 | greedy-hill-v1 | 1304 | 1281 to 1326 | 14450 | 27.3% | 40.4% | 33.8% | 19.2% | 65 | 1260 |
| 16 | greedy-hill-v2 | 1303 | 1278 to 1325 | 14450 | 27.2% | 41.4% | 34.6% | 18.7% | 68 | 1317 |
| 17 | greedy-v1 | 1200 | 1168 to 1231 | 14450 | 19.2% | 34.9% | 28.4% | 16.3% | 58 | 1202 |
| 18 | random-v1 | -121 | -260 to 5 | 14450 | 0.0% | 18.7% | 13.5% | 0.0% | 53 | 387 |

## perfection

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-combo | 1634 | 1609 to 1660 | 3400 | 75.5% | 59.7% | 62.8% | 75.5% | 30 |  |
| 2 | greedy-full-economy | 1614 | 1591 to 1635 | 3400 | 73.3% | 58.0% | 61.7% | 73.3% | 30 |  |
| 3 | greedy-full-front-sweep | 1546 | 1527 to 1565 | 3400 | 65.4% | 54.5% | 57.8% | 65.4% | 30 |  |
| 4 | greedy-full-movenoise | 1545 | 1522 to 1570 | 3400 | 65.3% | 55.5% | 57.7% | 65.3% | 30 |  |
| 5 | greedy-full-roads | 1537 | 1520 to 1555 | 3400 | 64.4% | 54.3% | 57.2% | 64.4% | 30 |  |
| 6 | greedy-full-front | 1536 | 1519 to 1555 | 3400 | 64.3% | 54.3% | 57.2% | 64.3% | 30 |  |
| 7 | greedy-full-peacebreak | 1536 | 1519 to 1555 | 3400 | 64.3% | 54.3% | 57.2% | 64.3% | 30 |  |
| 8 | greedy-full-v1 | 1522 | 1504 to 1541 | 3400 | 62.5% | 53.5% | 56.3% | 62.5% | 30 |  |
| 9 | greedy-full-defend | 1516 | 1499 to 1534 | 3400 | 61.8% | 53.4% | 55.9% | 61.8% | 30 |  |
| 10 | greedy-full-research | 1391 | 1370 to 1410 | 3400 | 46.0% | 48.9% | 48.0% | 46.0% | 30 |  |
| 11 | greedy-hill-v3 | 1378 | 1359 to 1396 | 3400 | 44.4% | 49.7% | 47.2% | 44.4% | 30 | 1340 |
| 12 | greedy-es-v1 | 1369 | 1351 to 1386 | 3400 | 43.3% | 50.1% | 46.7% | 43.3% | 30 |  |
| 13 | greedy-hill-v4 | 1360 | 1337 to 1378 | 3400 | 42.1% | 49.6% | 46.1% | 42.1% | 30 | 1374 |
| 14 | greedy-hill-v5 | 1315 | 1293 to 1337 | 3400 | 36.9% | 46.6% | 43.4% | 36.9% | 30 |  |
| 15 | greedy-hill-v2 | 1292 | 1271 to 1312 | 3400 | 34.3% | 47.3% | 42.1% | 34.3% | 30 | 1317 |
| 16 | greedy-hill-v1 | 1263 | 1236 to 1285 | 3400 | 31.1% | 45.4% | 40.5% | 31.1% | 30 | 1260 |
| 17 | greedy-v1 | 1200 | 1169 to 1228 | 3400 | 25.0% | 41.2% | 37.5% | 25.0% | 30 | 1202 |
| 18 | random-v1 | 105 | -25 to 228 | 3400 | 0.0% | 23.7% | 24.8% | 0.0% | 30 | 387 |

## glory

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-economy | 1658 | 1632 to 1684 | 3400 | 75.8% | 57.7% | 73.6% | 75.8% | 26 |  |
| 2 | greedy-full-combo | 1656 | 1633 to 1681 | 3400 | 75.6% | 58.4% | 73.4% | 75.6% | 26 |  |
| 3 | greedy-full-front-sweep | 1571 | 1553 to 1590 | 3400 | 66.2% | 53.7% | 64.7% | 66.2% | 28 |  |
| 4 | greedy-full-movenoise | 1568 | 1544 to 1594 | 3400 | 65.7% | 54.4% | 64.3% | 65.7% | 27 |  |
| 5 | greedy-full-roads | 1560 | 1543 to 1579 | 3400 | 64.9% | 53.6% | 63.5% | 64.9% | 28 |  |
| 6 | greedy-full-front | 1559 | 1542 to 1577 | 3400 | 64.8% | 53.6% | 63.4% | 64.8% | 28 |  |
| 7 | greedy-full-peacebreak | 1559 | 1542 to 1577 | 3400 | 64.7% | 53.6% | 63.4% | 64.7% | 28 |  |
| 8 | greedy-full-defend | 1547 | 1530 to 1565 | 3400 | 63.2% | 53.0% | 62.0% | 63.2% | 28 |  |
| 9 | greedy-full-v1 | 1545 | 1529 to 1563 | 3400 | 63.0% | 53.0% | 61.8% | 63.0% | 28 |  |
| 10 | greedy-full-research | 1396 | 1376 to 1416 | 3400 | 44.6% | 49.5% | 45.1% | 44.6% | 27 |  |
| 11 | greedy-es-v1 | 1385 | 1366 to 1402 | 3400 | 43.2% | 50.4% | 43.8% | 43.2% | 28 |  |
| 12 | greedy-hill-v3 | 1382 | 1365 to 1400 | 3400 | 42.9% | 50.1% | 43.5% | 42.9% | 28 | 1340 |
| 13 | greedy-hill-v4 | 1375 | 1354 to 1394 | 3400 | 42.0% | 50.0% | 42.7% | 42.0% | 28 | 1374 |
| 14 | greedy-hill-v5 | 1329 | 1307 to 1350 | 3400 | 36.7% | 47.3% | 37.9% | 36.7% | 28 |  |
| 15 | greedy-hill-v2 | 1299 | 1277 to 1319 | 3400 | 33.4% | 47.9% | 34.8% | 33.3% | 28 | 1317 |
| 16 | greedy-hill-v1 | 1261 | 1236 to 1283 | 3400 | 29.4% | 46.0% | 31.3% | 29.4% | 28 | 1260 |
| 17 | greedy-v1 | 1200 | 1168 to 1229 | 3400 | 23.8% | 42.6% | 26.2% | 23.8% | 28 | 1202 |
| 18 | random-v1 | at most -6 | never won | 3400 | 0.0% | 25.4% | 4.6% | 0.0% | 28 | 387 |

## might

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-combo | 1924 | 1898 to 1951 | 3400 | 79.1% | 65.7% | 74.3% | 72.4% | 54 |  |
| 2 | greedy-full-economy | 1915 | 1885 to 1944 | 3400 | 78.3% | 64.4% | 73.7% | 72.7% | 54 |  |
| 3 | greedy-full-movenoise | 1885 | 1856 to 1921 | 3400 | 75.6% | 62.9% | 71.7% | 71.3% | 51 |  |
| 4 | greedy-full-front-sweep | 1840 | 1816 to 1864 | 3400 | 71.3% | 59.4% | 66.8% | 61.1% | 60 |  |
| 5 | greedy-full-peacebreak | 1838 | 1817 to 1861 | 3400 | 71.1% | 60.3% | 67.8% | 66.5% | 54 |  |
| 6 | greedy-full-roads | 1837 | 1815 to 1859 | 3400 | 71.0% | 60.0% | 66.0% | 60.4% | 60 |  |
| 7 | greedy-full-front | 1835 | 1814 to 1858 | 3400 | 70.8% | 59.9% | 65.8% | 60.0% | 61 |  |
| 8 | greedy-full-defend | 1796 | 1776 to 1819 | 3400 | 67.0% | 57.7% | 62.4% | 55.5% | 63 |  |
| 9 | greedy-full-v1 | 1792 | 1771 to 1814 | 3400 | 66.6% | 57.5% | 62.0% | 55.1% | 63 |  |
| 10 | greedy-full-research | 1623 | 1602 to 1648 | 3400 | 49.8% | 49.9% | 49.2% | 39.8% | 66 |  |
| 11 | greedy-es-v1 | 1468 | 1441 to 1491 | 3400 | 35.2% | 44.9% | 39.0% | 24.6% | 75 |  |
| 12 | greedy-hill-v4 | 1450 | 1422 to 1475 | 3400 | 33.6% | 44.3% | 37.0% | 20.9% | 78 | 1374 |
| 13 | greedy-hill-v3 | 1445 | 1416 to 1471 | 3400 | 33.2% | 44.2% | 36.2% | 21.1% | 74 | 1340 |
| 14 | greedy-hill-v5 | 1428 | 1401 to 1453 | 3400 | 31.8% | 41.9% | 35.0% | 22.2% | 69 |  |
| 15 | greedy-hill-v1 | 1352 | 1322 to 1380 | 3400 | 25.7% | 38.7% | 30.5% | 15.1% | 73 | 1260 |
| 16 | greedy-hill-v2 | 1331 | 1299 to 1362 | 3400 | 24.1% | 39.3% | 30.0% | 12.8% | 77 | 1317 |
| 17 | greedy-v1 | 1200 | 1148 to 1246 | 3400 | 15.8% | 32.3% | 23.4% | 12.1% | 62 | 1202 |
| 18 | random-v1 | at most 80 | never won | 3400 | 0.0% | 16.6% | 9.1% | 0.0% | 52 | 387 |

## domination

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-combo | 1928 | 1901 to 1955 | 3400 | 78.9% | 67.4% | 73.2% | 68.9% | 62 |  |
| 2 | greedy-full-economy | 1919 | 1890 to 1949 | 3400 | 78.2% | 66.4% | 72.8% | 69.9% | 60 |  |
| 3 | greedy-full-movenoise | 1895 | 1865 to 1929 | 3400 | 75.9% | 65.3% | 71.4% | 69.9% | 57 |  |
| 4 | greedy-full-front-sweep | 1846 | 1823 to 1870 | 3400 | 71.3% | 61.0% | 66.0% | 58.4% | 67 |  |
| 5 | greedy-full-peacebreak | 1844 | 1823 to 1866 | 3400 | 71.1% | 62.1% | 67.2% | 64.5% | 60 |  |
| 6 | greedy-full-roads | 1842 | 1821 to 1864 | 3400 | 70.9% | 61.5% | 65.1% | 57.7% | 67 |  |
| 7 | greedy-full-front | 1841 | 1820 to 1864 | 3400 | 70.9% | 61.5% | 65.1% | 57.4% | 67 |  |
| 8 | greedy-full-defend | 1803 | 1782 to 1825 | 3400 | 67.1% | 58.8% | 61.7% | 52.5% | 70 |  |
| 9 | greedy-full-v1 | 1800 | 1779 to 1821 | 3400 | 66.8% | 58.5% | 61.4% | 52.2% | 70 |  |
| 10 | greedy-full-research | 1629 | 1607 to 1654 | 3400 | 49.8% | 50.0% | 49.1% | 37.2% | 73 |  |
| 11 | greedy-es-v1 | 1471 | 1443 to 1493 | 3400 | 35.1% | 43.6% | 39.4% | 21.8% | 84 |  |
| 12 | greedy-hill-v4 | 1453 | 1426 to 1480 | 3400 | 33.6% | 42.7% | 37.4% | 17.0% | 88 | 1374 |
| 13 | greedy-hill-v3 | 1449 | 1421 to 1474 | 3400 | 33.2% | 42.4% | 36.3% | 16.8% | 84 | 1340 |
| 14 | greedy-hill-v5 | 1433 | 1405 to 1457 | 3400 | 31.9% | 40.5% | 35.7% | 19.9% | 78 |  |
| 15 | greedy-hill-v1 | 1357 | 1327 to 1384 | 3400 | 25.7% | 36.6% | 31.6% | 12.9% | 83 | 1260 |
| 16 | greedy-hill-v2 | 1331 | 1298 to 1364 | 3400 | 23.9% | 37.0% | 31.1% | 9.5% | 89 | 1317 |
| 17 | greedy-v1 | 1200 | 1149 to 1247 | 3400 | 15.6% | 29.7% | 24.8% | 11.5% | 70 | 1202 |
| 18 | random-v1 | at most 82 | never won | 3400 | 0.0% | 15.0% | 10.9% | 0.0% | 60 | 387 |

## creative

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-combo | 1993 | 1940 to 2059 | 850 | 81.5% | 69.4% | 70.7% | 54.9% | 91 |  |
| 2 | greedy-full-movenoise | 1980 | 1928 to 2045 | 850 | 80.5% | 69.4% | 70.1% | 54.7% | 93 |  |
| 3 | greedy-full-economy | 1917 | 1880 to 1965 | 850 | 75.1% | 65.0% | 66.6% | 50.9% | 93 |  |
| 4 | greedy-full-front-sweep | 1913 | 1868 to 1967 | 850 | 74.7% | 62.3% | 62.8% | 38.4% | 104 |  |
| 5 | greedy-full-roads | 1892 | 1846 to 1950 | 850 | 72.8% | 62.9% | 62.0% | 37.2% | 105 |  |
| 6 | greedy-full-front | 1885 | 1837 to 1941 | 850 | 72.1% | 62.6% | 61.7% | 37.2% | 105 |  |
| 7 | greedy-full-peacebreak | 1876 | 1829 to 1932 | 850 | 71.3% | 63.2% | 64.7% | 49.8% | 94 |  |
| 8 | greedy-full-v1 | 1803 | 1771 to 1844 | 850 | 64.5% | 57.8% | 57.8% | 35.2% | 104 |  |
| 9 | greedy-full-defend | 1799 | 1765 to 1836 | 850 | 64.1% | 57.6% | 57.4% | 35.1% | 102 |  |
| 10 | greedy-full-research | 1687 | 1642 to 1738 | 850 | 53.6% | 51.4% | 50.6% | 25.6% | 106 |  |
| 11 | greedy-es-v1 | 1459 | 1406 to 1501 | 850 | 34.0% | 43.2% | 41.1% | 11.6% | 114 |  |
| 12 | greedy-hill-v3 | 1436 | 1374 to 1487 | 850 | 32.1% | 41.7% | 38.1% | 7.3% | 114 | 1340 |
| 13 | greedy-hill-v5 | 1430 | 1373 to 1471 | 850 | 31.6% | 39.5% | 39.7% | 14.1% | 109 |  |
| 14 | greedy-hill-v4 | 1421 | 1367 to 1466 | 850 | 30.9% | 41.3% | 38.9% | 6.5% | 117 | 1374 |
| 15 | greedy-hill-v1 | 1337 | 1255 to 1405 | 850 | 24.7% | 35.3% | 34.9% | 7.8% | 109 | 1260 |
| 16 | greedy-hill-v2 | 1270 | 1185 to 1336 | 850 | 20.2% | 35.5% | 35.1% | 3.4% | 118 | 1317 |
| 17 | greedy-v1 | 1200 | 1110 to 1265 | 850 | 16.1% | 28.8% | 29.9% | 9.1% | 100 | 1202 |
| 18 | random-v1 | at most 309 | never won | 850 | 0.0% | 13.0% | 17.9% | 0.0% | 94 | 387 |

The last column is the rating in data/ratings.json when this run was made (mostly 2-player games on 11x11, another method of counting; see scripts/elo.ts). The pairwise results are in ratings.json (`matrix`) and on the dashboard (`npm run elo-dashboard`).
