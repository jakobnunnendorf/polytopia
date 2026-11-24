#!/bin/zsh
# Line coverage of logic/engine by the first GAMES corpus games, in SHARDS
# parallel jest runs, merged into one report (engine/corpus/coverage/).
#   scripts/rust/coverage.sh 2000 10
set -e
GAMES=${1:-300}
SHARDS=${2:-10}
cd "$(dirname "$0")/../.."
OUT=engine/corpus/coverage
rm -rf $OUT && mkdir -p $OUT
per=$(( (GAMES + SHARDS - 1) / SHARDS ))
for i in $(seq 0 $((SHARDS - 1))); do
  first=$(( i * per ))
  CORPUS_FIRST=$first CORPUS_GAMES=$per npx jest --ci --coverage --testMatch '**/scripts/rust/coverage.spec.ts' \
    --collectCoverageFrom 'logic/engine/**/*.ts' --coverageReporters json --coverageDirectory $OUT/shard-$i \
    > $OUT/shard-$i.log 2>&1 &
done
wait
node -e '
const libCov = require("istanbul-lib-coverage");
const fs = require("fs");
const dir = process.argv[1];
const map = libCov.createCoverageMap({});
for (const d of fs.readdirSync(dir)) if (d.startsWith("shard-") && fs.existsSync(`${dir}/${d}/coverage-final.json`)) map.merge(JSON.parse(fs.readFileSync(`${dir}/${d}/coverage-final.json`, "utf8")));
const rows = [];
let cov = 0, tot = 0, covR = 0, totR = 0;
for (const f of map.files().sort()) {
  const s = map.fileCoverageFor(f).toSummary().lines;
  const name = f.split("/").pop();
  const rules = !["names.ts", "types.ts", "index.ts"].includes(name);
  rows.push({ file: name, pct: s.pct, uncovered: s.total - s.covered, rules });
  cov += s.covered; tot += s.total;
  if (rules) { covR += s.covered; totR += s.total; }
  const lines = map.fileCoverageFor(f).getUncoveredLines();
  fs.writeFileSync(`${dir}/uncovered-${name}.txt`, lines.join("\n") + "\n");
}
const out = { files: rows, all: +(100 * cov / tot).toFixed(2), rulesOnly: +(100 * covR / totR).toFixed(2), note: "rulesOnly leaves out names.ts (display text, stays TypeScript), types.ts and index.ts" };
fs.writeFileSync(`${dir}/summary.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
' $OUT
