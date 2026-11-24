/**
 * Line coverage of logic/engine by the parity corpus: plays corpus games
 * (same settings as scripts/rust/trace-gen.ts) under jest's coverage
 * instrumentation. Not part of the normal test suite; run it with
 *
 *   CORPUS_GAMES=300 npx jest --ci --coverage --testMatch '**' + '/scripts/rust/coverage.spec.ts' \
 *     --collectCoverageFrom 'logic/engine/**' + '/*.ts' --coverageReporters text-summary json-summary json
 */
import { playSpec, specFor } from "./trace-gen";

const GAMES = Number(process.env.CORPUS_GAMES ?? "300");

test(`corpus games 0..${GAMES - 1} play`, () => {
  let steps = 0;
  for (let id = 0; id < GAMES; id++) {
    try {
      steps += playSpec(specFor(id)).steps.length;
    } catch {
      // the corpus records such games as oracle errors; coverage just goes on
    }
  }
  expect(steps).toBeGreaterThan(0);
}, 3_600_000);
