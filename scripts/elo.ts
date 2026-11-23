/**
 * Elo leaderboard (Bradley–Terry fit with 95% bootstrap intervals, see logic/arena/elo.ts).
 * `npm run elo` prints data/ratings.json; `npm run elo -- --rebuild` refits it from every game in data/games/.
 */
import { listProfiles, readRatings, rebuildRatings } from "./lib/store";

const ratings = process.argv.includes("--rebuild") ? rebuildRatings() : readRatings();
const names = Object.fromEntries(listProfiles().map((p) => [`human:${p.id}`, p.name]));
const rows = Object.entries(ratings).sort((a, b) => b[1].rating - a[1].rating);
if (rows.length === 0) console.log("No rated games yet. Play one, or run: npm run arena -- --games 10");
for (const [k, r] of rows) {
  const label = names[k] ? `${names[k]} (${k})` : k;
  const ci = r.lo !== undefined ? `${r.lo}–${r.hi}` : "";
  console.log(`${label.padEnd(44)} ${r.rating.toFixed(0).padStart(5)}  ${ci.padEnd(10)} games ${String(r.games).padStart(4)}  wins ${r.wins}`);
}
