# Elo tournament 2026-11-25

Every bot model against every other, in every game mode, in the Rust engine. 145350 games, 19 agents. Made by `scripts/elo-tournament.ts` at commit 9908893; reproduce with `npm run elo-tournament -- --out <new folder>` (the same seeds give the same games).

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
| perfection | 4 | 16x16 | drylands | 30 (the mode's own end) | 200 | 34200 |
| glory | 4 | 16x16 | drylands | 150 | 200 | 34200 |
| might | 4 | 16x16 | drylands | 150 | 200 | 34200 |
| domination | 4 | 16x16 | drylands | 150 | 200 | 34200 |
| creative | 8 | 20x20 | drylands | 150 | 50 | 8550 |

## Rating by mode

Rating, with the place in that mode in brackets. Every column is its own fit with greedy-v1 at 1200: compare places and gaps across columns, not levels.

| agent | overall | perfection | glory | might | domination | creative |
|---|--:|--:|--:|--:|--:|--:|
| greedy-full-probe | 1902 (1) | 1742 (1) | 1746 (1) | 2038 (1) | 2046 (1) | 2138 (1) |
| greedy-full-combo | 1791 (2) | 1635 (2) | 1657 (2) | 1924 (2) | 1927 (2) | 2001 (2) |
| greedy-full-economy | 1767 (3) | 1617 (3) | 1655 (3) | 1912 (3) | 1917 (3) | 1918 (4) |
| greedy-full-movenoise | 1735 (4) | 1550 (4) | 1569 (5) | 1885 (4) | 1894 (4) | 1986 (3) |
| greedy-full-front-sweep | 1704 (5) | 1547 (5) | 1570 (4) | 1838 (5) | 1845 (5) | 1909 (5) |
| greedy-full-roads | 1696 (6) | 1539 (6) | 1561 (6) | 1835 (7) | 1840 (7) | 1889 (6) |
| greedy-full-front | 1694 (7) | 1539 (7) | 1560 (7) | 1833 (8) | 1839 (8) | 1885 (7) |
| greedy-full-peacebreak | 1694 (8) | 1539 (8) | 1560 (8) | 1836 (6) | 1842 (6) | 1877 (8) |
| greedy-full-v1 | 1660 (9) | 1525 (9) | 1546 (10) | 1793 (10) | 1800 (10) | 1805 (9) |
| greedy-full-defend | 1659 (10) | 1519 (10) | 1547 (9) | 1796 (9) | 1803 (9) | 1800 (10) |
| greedy-full-research | 1516 (11) | 1392 (11) | 1396 (11) | 1622 (11) | 1629 (11) | 1687 (11) |
| greedy-es-v1 | 1416 (12) | 1369 (13) | 1383 (12) | 1465 (12) | 1468 (12) | 1458 (12) |
| greedy-hill-v3 | 1406 (13) | 1376 (12) | 1379 (13) | 1442 (14) | 1447 (14) | 1435 (13) |
| greedy-hill-v4 | 1400 (14) | 1360 (14) | 1373 (14) | 1447 (13) | 1452 (13) | 1421 (15) |
| greedy-hill-v5 | 1374 (15) | 1316 (15) | 1329 (15) | 1426 (15) | 1431 (15) | 1430 (14) |
| greedy-hill-v1 | 1303 (16) | 1263 (17) | 1260 (17) | 1349 (16) | 1355 (16) | 1338 (16) |
| greedy-hill-v2 | 1302 (17) | 1293 (16) | 1298 (16) | 1329 (17) | 1330 (17) | 1272 (17) |
| greedy-v1 | 1200 (18) | 1200 (18) | 1200 (18) | 1200 (18) | 1200 (18) | 1200 (18) |
| random-v1 | -123 (19) | 104 (19) | at most -8 (19) | at most 78 (19) | at most 81 (19) | at most 309 (19) |

## Overall

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe | 1902 | 1876 to 1929 | 15300 | 85.2% | 67.6% | 76.5% | 77.0% | 49 |  |
| 2 | greedy-full-combo | 1791 | 1770 to 1811 | 15300 | 75.8% | 63.0% | 69.2% | 67.4% | 53 |  |
| 3 | greedy-full-economy | 1767 | 1748 to 1785 | 15300 | 73.6% | 61.1% | 67.8% | 66.2% | 53 |  |
| 4 | greedy-full-movenoise | 1735 | 1715 to 1757 | 15300 | 70.3% | 60.3% | 65.3% | 63.3% | 52 |  |
| 5 | greedy-full-front-sweep | 1704 | 1687 to 1722 | 15300 | 67.1% | 56.9% | 61.6% | 55.7% | 57 |  |
| 6 | greedy-full-roads | 1696 | 1680 to 1712 | 15300 | 66.2% | 57.2% | 60.9% | 54.8% | 57 |  |
| 7 | greedy-full-front | 1694 | 1679 to 1710 | 15300 | 66.1% | 57.1% | 60.8% | 54.7% | 58 |  |
| 8 | greedy-full-peacebreak | 1694 | 1678 to 1710 | 15300 | 66.0% | 57.4% | 62.1% | 59.6% | 53 |  |
| 9 | greedy-full-v1 | 1660 | 1645 to 1675 | 15300 | 62.3% | 54.9% | 58.1% | 51.7% | 58 |  |
| 10 | greedy-full-defend | 1659 | 1644 to 1673 | 15300 | 62.2% | 55.0% | 58.1% | 51.7% | 58 |  |
| 11 | greedy-full-research | 1516 | 1500 to 1532 | 15300 | 46.6% | 48.9% | 46.8% | 37.0% | 60 |  |
| 12 | greedy-es-v1 | 1416 | 1398 to 1433 | 15300 | 36.3% | 45.5% | 40.6% | 27.5% | 65 |  |
| 13 | greedy-hill-v3 | 1406 | 1387 to 1424 | 15300 | 35.3% | 44.7% | 38.8% | 25.2% | 65 | 1340 |
| 14 | greedy-hill-v4 | 1400 | 1381 to 1420 | 15300 | 34.7% | 44.7% | 39.1% | 24.5% | 67 | 1374 |
| 15 | greedy-hill-v5 | 1374 | 1354 to 1393 | 15300 | 32.1% | 42.3% | 37.1% | 24.8% | 62 |  |
| 16 | greedy-hill-v1 | 1303 | 1279 to 1326 | 15300 | 25.9% | 39.6% | 32.7% | 18.3% | 64 | 1260 |
| 17 | greedy-hill-v2 | 1302 | 1277 to 1326 | 15300 | 25.9% | 40.7% | 33.6% | 17.8% | 67 | 1317 |
| 18 | greedy-v1 | 1200 | 1166 to 1232 | 15300 | 18.3% | 34.4% | 27.6% | 15.5% | 57 | 1202 |
| 19 | random-v1 | -123 | -263 to 4 | 15300 | 0.0% | 18.7% | 13.4% | 0.0% | 52 | 387 |

## perfection

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe | 1742 | 1711 to 1772 | 3600 | 83.3% | 63.0% | 66.7% | 83.3% | 30 |  |
| 2 | greedy-full-combo | 1635 | 1612 to 1659 | 3600 | 73.1% | 58.9% | 61.6% | 73.1% | 30 |  |
| 3 | greedy-full-economy | 1617 | 1596 to 1637 | 3600 | 71.2% | 57.3% | 60.6% | 71.2% | 30 |  |
| 4 | greedy-full-movenoise | 1550 | 1528 to 1574 | 3600 | 63.4% | 54.7% | 56.8% | 63.4% | 30 |  |
| 5 | greedy-full-front-sweep | 1547 | 1530 to 1565 | 3600 | 63.2% | 53.7% | 56.6% | 63.2% | 30 |  |
| 6 | greedy-full-roads | 1539 | 1522 to 1557 | 3600 | 62.2% | 53.6% | 56.2% | 62.2% | 30 |  |
| 7 | greedy-full-front | 1539 | 1522 to 1556 | 3600 | 62.2% | 53.6% | 56.1% | 62.2% | 30 |  |
| 8 | greedy-full-peacebreak | 1539 | 1522 to 1556 | 3600 | 62.2% | 53.6% | 56.1% | 62.2% | 30 |  |
| 9 | greedy-full-v1 | 1525 | 1507 to 1543 | 3600 | 60.4% | 52.8% | 55.2% | 60.4% | 30 |  |
| 10 | greedy-full-defend | 1519 | 1503 to 1535 | 3600 | 59.7% | 52.7% | 54.9% | 59.7% | 30 |  |
| 11 | greedy-full-research | 1392 | 1372 to 1412 | 3600 | 44.1% | 48.2% | 47.0% | 44.1% | 30 |  |
| 12 | greedy-hill-v3 | 1376 | 1357 to 1394 | 3600 | 42.2% | 48.9% | 46.1% | 42.2% | 30 | 1340 |
| 13 | greedy-es-v1 | 1369 | 1350 to 1386 | 3600 | 41.3% | 49.3% | 45.6% | 41.3% | 30 |  |
| 14 | greedy-hill-v4 | 1360 | 1338 to 1379 | 3600 | 40.2% | 48.8% | 45.1% | 40.2% | 30 | 1374 |
| 15 | greedy-hill-v5 | 1316 | 1293 to 1338 | 3600 | 35.2% | 45.8% | 42.6% | 35.2% | 30 |  |
| 16 | greedy-hill-v2 | 1293 | 1271 to 1314 | 3600 | 32.7% | 46.5% | 41.4% | 32.7% | 30 | 1317 |
| 17 | greedy-hill-v1 | 1263 | 1236 to 1287 | 3600 | 29.6% | 44.7% | 39.8% | 29.6% | 30 | 1260 |
| 18 | greedy-v1 | 1200 | 1169 to 1229 | 3600 | 23.7% | 40.5% | 36.8% | 23.7% | 30 | 1202 |
| 19 | random-v1 | 104 | -27 to 227 | 3600 | 0.0% | 23.5% | 24.8% | 0.0% | 30 | 387 |

## glory

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe | 1746 | 1719 to 1777 | 3600 | 82.2% | 59.9% | 79.5% | 82.2% | 26 |  |
| 2 | greedy-full-combo | 1657 | 1634 to 1681 | 3600 | 73.6% | 57.8% | 71.6% | 73.6% | 26 |  |
| 3 | greedy-full-economy | 1655 | 1630 to 1679 | 3600 | 73.4% | 57.1% | 71.4% | 73.4% | 26 |  |
| 4 | greedy-full-front-sweep | 1570 | 1551 to 1588 | 3600 | 63.8% | 53.1% | 62.6% | 63.8% | 28 |  |
| 5 | greedy-full-movenoise | 1569 | 1546 to 1594 | 3600 | 63.7% | 53.8% | 62.5% | 63.7% | 27 |  |
| 6 | greedy-full-roads | 1561 | 1544 to 1578 | 3600 | 62.8% | 53.0% | 61.6% | 62.8% | 28 |  |
| 7 | greedy-full-front | 1560 | 1543 to 1577 | 3600 | 62.7% | 52.9% | 61.5% | 62.7% | 28 |  |
| 8 | greedy-full-peacebreak | 1560 | 1543 to 1577 | 3600 | 62.7% | 52.9% | 61.5% | 62.7% | 28 |  |
| 9 | greedy-full-defend | 1547 | 1532 to 1564 | 3600 | 61.2% | 52.4% | 60.1% | 61.2% | 28 |  |
| 10 | greedy-full-v1 | 1546 | 1531 to 1564 | 3600 | 61.0% | 52.4% | 60.0% | 61.0% | 28 |  |
| 11 | greedy-full-research | 1396 | 1377 to 1417 | 3600 | 42.8% | 48.9% | 43.5% | 42.8% | 27 |  |
| 12 | greedy-es-v1 | 1383 | 1363 to 1401 | 3600 | 41.3% | 49.8% | 42.0% | 41.2% | 28 |  |
| 13 | greedy-hill-v3 | 1379 | 1361 to 1397 | 3600 | 40.8% | 49.5% | 41.6% | 40.8% | 27 | 1340 |
| 14 | greedy-hill-v4 | 1373 | 1352 to 1393 | 3600 | 40.1% | 49.4% | 41.0% | 40.1% | 28 | 1374 |
| 15 | greedy-hill-v5 | 1329 | 1306 to 1351 | 3600 | 35.2% | 46.8% | 36.5% | 35.2% | 27 |  |
| 16 | greedy-hill-v2 | 1298 | 1277 to 1319 | 3600 | 31.9% | 47.4% | 33.5% | 31.9% | 28 | 1317 |
| 17 | greedy-hill-v1 | 1260 | 1235 to 1283 | 3600 | 28.1% | 45.4% | 30.0% | 28.0% | 28 | 1260 |
| 18 | greedy-v1 | 1200 | 1166 to 1230 | 3600 | 22.8% | 42.2% | 25.2% | 22.7% | 28 | 1202 |
| 19 | random-v1 | at most -8 | never won | 3600 | 0.0% | 25.3% | 4.6% | 0.0% | 28 | 387 |

## might

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe | 2038 | 2003 to 2077 | 3600 | 85.8% | 68.9% | 80.3% | 80.4% | 48 |  |
| 2 | greedy-full-combo | 1924 | 1898 to 1949 | 3600 | 76.6% | 64.4% | 72.3% | 70.1% | 54 |  |
| 3 | greedy-full-economy | 1912 | 1885 to 1940 | 3600 | 75.6% | 63.1% | 71.5% | 70.2% | 54 |  |
| 4 | greedy-full-movenoise | 1885 | 1857 to 1917 | 3600 | 73.1% | 61.5% | 69.5% | 68.8% | 51 |  |
| 5 | greedy-full-front-sweep | 1838 | 1816 to 1862 | 3600 | 68.7% | 58.1% | 64.6% | 58.8% | 60 |  |
| 6 | greedy-full-peacebreak | 1836 | 1816 to 1857 | 3600 | 68.4% | 58.9% | 65.5% | 64.0% | 54 |  |
| 7 | greedy-full-roads | 1835 | 1816 to 1857 | 3600 | 68.4% | 58.7% | 63.8% | 58.2% | 60 |  |
| 8 | greedy-full-front | 1833 | 1814 to 1855 | 3600 | 68.2% | 58.6% | 63.7% | 57.9% | 60 |  |
| 9 | greedy-full-defend | 1796 | 1776 to 1818 | 3600 | 64.5% | 56.4% | 60.4% | 53.4% | 63 |  |
| 10 | greedy-full-v1 | 1793 | 1773 to 1814 | 3600 | 64.2% | 56.3% | 60.0% | 53.1% | 63 |  |
| 11 | greedy-full-research | 1622 | 1600 to 1646 | 3600 | 47.5% | 48.8% | 47.3% | 38.0% | 65 |  |
| 12 | greedy-es-v1 | 1465 | 1437 to 1488 | 3600 | 33.4% | 43.9% | 37.5% | 23.3% | 73 |  |
| 13 | greedy-hill-v4 | 1447 | 1419 to 1474 | 3600 | 31.9% | 43.3% | 35.6% | 19.8% | 76 | 1374 |
| 14 | greedy-hill-v3 | 1442 | 1413 to 1469 | 3600 | 31.5% | 43.2% | 34.7% | 20.0% | 73 | 1340 |
| 15 | greedy-hill-v5 | 1426 | 1397 to 1452 | 3600 | 30.1% | 41.0% | 33.6% | 21.1% | 67 |  |
| 16 | greedy-hill-v1 | 1349 | 1317 to 1379 | 3600 | 24.3% | 37.8% | 29.2% | 14.2% | 71 | 1260 |
| 17 | greedy-hill-v2 | 1329 | 1295 to 1362 | 3600 | 22.8% | 38.6% | 28.8% | 12.1% | 75 | 1317 |
| 18 | greedy-v1 | 1200 | 1146 to 1248 | 3600 | 15.0% | 31.8% | 22.6% | 11.5% | 61 | 1202 |
| 19 | random-v1 | at most 78 | never won | 3600 | 0.0% | 16.6% | 9.0% | 0.0% | 51 | 387 |

## domination

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe | 2046 | 2010 to 2086 | 3600 | 85.9% | 71.5% | 79.4% | 77.9% | 54 |  |
| 2 | greedy-full-combo | 1927 | 1903 to 1954 | 3600 | 76.4% | 65.9% | 71.2% | 66.8% | 62 |  |
| 3 | greedy-full-economy | 1917 | 1890 to 1945 | 3600 | 75.5% | 64.8% | 70.7% | 67.5% | 60 |  |
| 4 | greedy-full-movenoise | 1894 | 1866 to 1926 | 3600 | 73.4% | 63.7% | 69.3% | 67.4% | 57 |  |
| 5 | greedy-full-front-sweep | 1845 | 1823 to 1867 | 3600 | 68.7% | 59.5% | 63.8% | 56.2% | 66 |  |
| 6 | greedy-full-peacebreak | 1842 | 1822 to 1863 | 3600 | 68.4% | 60.5% | 64.9% | 62.0% | 60 |  |
| 7 | greedy-full-roads | 1840 | 1821 to 1862 | 3600 | 68.3% | 60.0% | 63.0% | 55.6% | 66 |  |
| 8 | greedy-full-front | 1839 | 1819 to 1861 | 3600 | 68.2% | 59.9% | 62.9% | 55.3% | 66 |  |
| 9 | greedy-full-defend | 1803 | 1784 to 1823 | 3600 | 64.6% | 57.3% | 59.7% | 50.5% | 70 |  |
| 10 | greedy-full-v1 | 1800 | 1781 to 1820 | 3600 | 64.4% | 57.2% | 59.5% | 50.3% | 69 |  |
| 11 | greedy-full-research | 1629 | 1606 to 1653 | 3600 | 47.6% | 48.8% | 47.3% | 35.6% | 72 |  |
| 12 | greedy-es-v1 | 1468 | 1440 to 1492 | 3600 | 33.3% | 42.4% | 38.0% | 20.6% | 83 |  |
| 13 | greedy-hill-v4 | 1452 | 1423 to 1479 | 3600 | 31.9% | 41.6% | 36.1% | 16.1% | 86 | 1374 |
| 14 | greedy-hill-v3 | 1447 | 1417 to 1474 | 3600 | 31.5% | 41.3% | 34.9% | 16.0% | 83 | 1340 |
| 15 | greedy-hill-v5 | 1431 | 1402 to 1457 | 3600 | 30.2% | 39.5% | 34.3% | 18.8% | 77 |  |
| 16 | greedy-hill-v1 | 1355 | 1323 to 1384 | 3600 | 24.4% | 35.6% | 30.4% | 12.2% | 81 | 1260 |
| 17 | greedy-hill-v2 | 1330 | 1295 to 1364 | 3600 | 22.6% | 36.2% | 30.0% | 9.1% | 87 | 1317 |
| 18 | greedy-v1 | 1200 | 1147 to 1246 | 3600 | 14.8% | 29.2% | 24.0% | 10.9% | 69 | 1202 |
| 19 | random-v1 | at most 81 | never won | 3600 | 0.0% | 14.9% | 10.7% | 0.0% | 59 | 387 |

## creative

| # | agent | rating | 95% interval | games | won | points | finish | won by the mode's rule | mean turns | data/ratings.json |
|--:|---|--:|---|--:|--:|--:|--:|--:|--:|--:|
| 1 | greedy-full-probe | 2138 | 2082 to 2208 | 900 | 88.9% | 74.5% | 76.5% | 61.1% | 87 |  |
| 2 | greedy-full-combo | 2001 | 1952 to 2064 | 900 | 79.2% | 68.0% | 69.2% | 53.2% | 91 |  |
| 3 | greedy-full-movenoise | 1986 | 1937 to 2048 | 900 | 78.0% | 67.9% | 68.5% | 52.9% | 93 |  |
| 4 | greedy-full-economy | 1918 | 1884 to 1962 | 900 | 72.1% | 63.3% | 64.7% | 48.9% | 93 |  |
| 5 | greedy-full-front-sweep | 1909 | 1867 to 1959 | 900 | 71.3% | 60.3% | 60.6% | 36.6% | 103 |  |
| 6 | greedy-full-roads | 1889 | 1844 to 1943 | 900 | 69.4% | 60.9% | 59.8% | 35.3% | 104 |  |
| 7 | greedy-full-front | 1885 | 1839 to 1940 | 900 | 69.1% | 60.6% | 59.6% | 35.3% | 104 |  |
| 8 | greedy-full-peacebreak | 1877 | 1830 to 1930 | 900 | 68.3% | 61.2% | 62.4% | 47.2% | 94 |  |
| 9 | greedy-full-v1 | 1805 | 1773 to 1842 | 900 | 61.7% | 56.1% | 55.8% | 33.4% | 103 |  |
| 10 | greedy-full-defend | 1800 | 1766 to 1836 | 900 | 61.2% | 55.9% | 55.5% | 33.6% | 101 |  |
| 11 | greedy-full-research | 1687 | 1643 to 1737 | 900 | 51.0% | 49.8% | 49.0% | 24.6% | 105 |  |
| 12 | greedy-es-v1 | 1458 | 1403 to 1500 | 900 | 32.1% | 42.0% | 40.0% | 11.0% | 113 |  |
| 13 | greedy-hill-v3 | 1435 | 1373 to 1486 | 900 | 30.3% | 40.5% | 37.0% | 6.9% | 112 | 1340 |
| 14 | greedy-hill-v5 | 1430 | 1371 to 1473 | 900 | 30.0% | 38.4% | 38.6% | 13.4% | 108 |  |
| 15 | greedy-hill-v4 | 1421 | 1366 to 1470 | 900 | 29.3% | 40.3% | 37.8% | 6.2% | 116 | 1374 |
| 16 | greedy-hill-v1 | 1338 | 1251 to 1410 | 900 | 23.4% | 34.4% | 33.9% | 7.3% | 108 | 1260 |
| 17 | greedy-hill-v2 | 1272 | 1184 to 1339 | 900 | 19.2% | 34.7% | 34.1% | 3.2% | 117 | 1317 |
| 18 | greedy-v1 | 1200 | 1107 to 1269 | 900 | 15.2% | 28.2% | 29.2% | 8.6% | 99 | 1202 |
| 19 | random-v1 | at most 309 | never won | 900 | 0.0% | 12.9% | 17.8% | 0.0% | 94 | 387 |

The last column is the rating in data/ratings.json when this run was made (mostly 2-player games on 11x11, another method of counting; see scripts/elo.ts). The pairwise results are in ratings.json (`matrix`) and on the dashboard (`npm run elo-dashboard`).
