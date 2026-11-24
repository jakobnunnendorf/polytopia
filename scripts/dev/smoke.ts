/**
 * Smoke test: bot-vs-bot games with the special tribes forced in, on every map
 * type, checking that games finish and every chosen action was legal.
 *   node -r sucrase/register scripts/dev/smoke.ts
 */
import { createGame } from "../../logic/engine/state";
import { applyAction, legalActions } from "../../logic/engine/actions";
import { botStep } from "../../logic/engine/bot";
import { observe } from "../../logic/engine/observe";
import type { MapType } from "../../logic/engine/mapgen";

const types: MapType[] = ["drylands", "lakes", "continents", "pangea", "archipelago", "waterworld"];
const lineups = [
  ["aquarion", "polaris", "cymanti", "elyrion"],
  ["kickoo", "aquarion", "hoodrick", "luxidoor"],
];
let games = 0;
let illegal = 0;
for (const mapType of types) {
  for (const [li, clans] of lineups.entries()) {
    let s = createGame({ mapSize: 16, players: 4, seed: 100 + li, mode: "domination", mapType, clans: clans as never, humans: [] } as never);
    let steps = 0;
    while (!s.over && s.turn <= 40 && steps < 20000) {
      const a = botStep(s);
      const legal = legalActions(s);
      if (!legal.some((l) => JSON.stringify(l) === JSON.stringify(a))) illegal++;
      s = applyAction(s, a);
      steps++;
    }
    observe(s, 0);
    games++;
    console.log(mapType.padEnd(12), clans.join(","), "turn", s.turn, "over", s.over, "steps", steps);
  }
}
console.log(`games ${games}, illegal bot actions ${illegal}`);
