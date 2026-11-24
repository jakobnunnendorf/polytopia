/**
 * Line coverage of logic/engine by the parity corpus: plays corpus games
 * (same settings as scripts/rust/trace-gen.ts) under jest's coverage
 * instrumentation. Not part of the normal test suite; scripts/rust/coverage.sh
 * runs it in parallel shards (CORPUS_FIRST, CORPUS_GAMES) and merges the result.
 */
import { playSpec, specFor } from "./trace-gen";

const FIRST = Number(process.env.CORPUS_FIRST ?? "0");
const GAMES = Number(process.env.CORPUS_GAMES ?? "300");

test(`corpus games ${FIRST}..${FIRST + GAMES - 1} play`, () => {
  let steps = 0;
  for (let id = FIRST; id < FIRST + GAMES; id++) {
    try {
      steps += playSpec(specFor(id)).steps.length;
    } catch {
      // the corpus records such games as oracle errors; coverage just goes on
    }
  }
  expect(steps).toBeGreaterThan(0);
}, 6 * 3_600_000);
