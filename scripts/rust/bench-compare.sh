#!/bin/zsh
# TypeScript vs Rust engine speed on the same games (scripts/simulate.ts
# settings: perfection, drylands, greedy bots on both seats, until turn 60).
#   scripts/rust/bench-compare.sh <oracle-dir> [games] [repeats]
# <oracle-dir>: a checkout of the TypeScript engine (e.g. commit 5d2846d)
# with node_modules. Every game must come out identical in both engines.
set -e
ORACLE=${1:?oracle dir}
GAMES=${2:-40}
REPS=${3:-3}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PE="$ROOT/engine/target/release/polyengine"
OUT=${TMPDIR:-/tmp}/bench-compare.$$
mkdir -p $OUT
echo "machine: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores; node $(node -v); load $(uptime | sed 's/.*averages: //')"
for size in 11 16; do
  for players in 2 4; do
    best_ts=0; best_rs=0
    for r in $(seq $REPS); do
      (cd $ORACLE && node -r sucrase/register scripts/simulate.ts --games $GAMES --players $players --size $size) > $OUT/ts.txt
      $PE bench --games $GAMES --players $players --size $size --per-game > $OUT/rs.txt
      ts=$(tail -1 $OUT/ts.txt | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).actionsPerSecond')
      rs=$(tail -1 $OUT/rs.txt | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).actionsPerSecond')
      (( ts > best_ts )) && best_ts=$ts
      (( rs > best_rs )) && best_rs=$rs
    done
    same=$(node -e '
      const fs=require("fs"),rd=f=>fs.readFileSync(f,"utf8").trim().split("\n").map(JSON.parse).filter(x=>!x.summary);
      const a=rd(process.argv[1]),b=rd(process.argv[2]),k=["turns","winner","actions","scores","clans"];
      console.log(a.filter((x,i)=>k.every(j=>JSON.stringify(x[j])===JSON.stringify(b[i][j]))).length+"/"+a.length)' $OUT/ts.txt $OUT/rs.txt)
    all=$($PE bench --games $((GAMES * 8)) --players $players --size $size --threads 0 | tail -1 | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).actionsPerSecond')
    echo "{\"size\":$size,\"players\":$players,\"games\":$GAMES,\"tsActionsPerSecond\":$best_ts,\"rustActionsPerSecond\":$best_rs,\"speedup\":$(( best_rs / best_ts )),\"rustAllCoresActionsPerSecond\":$all,\"allCoresVsTsOneThread\":$(( all / best_ts )),\"identicalGames\":\"$same\"}"
  done
done
