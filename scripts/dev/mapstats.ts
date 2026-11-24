/**
 * Map density check: average object counts per generated map.
 *   node -r sucrase/register scripts/dev/mapstats.ts 16 4 drylands
 */
import { createGame } from "../../logic/engine/state";

const size = Number(process.argv[2] ?? 16);
const players = Number(process.argv[3] ?? 4);
const type = (process.argv[4] ?? "drylands") as never;
const agg: Record<string, number> = {};
const add = (k: string, v = 1) => (agg[k] = (agg[k] ?? 0) + v);
const N = 40;
for (let seed = 1; seed <= N; seed++) {
  const s = createGame({ mapSize: size, players, seed, mapType: type } as never);
  for (const t of s.tiles) {
    const land = ["field", "forest", "mountain"].includes(t.terrain);
    add(land ? "land" : "water");
    if (t.cityId !== null) add("city");
    if (t.village) add("village");
    if (t.ruin) add(land ? "ruin_land" : "ruin_water");
    if (t.resource) add("res_" + t.resource);
    if (land && !t.village && t.cityId === null && !t.ruin && !t.resource) add("empty_land");
  }
}
for (const k of Object.keys(agg).sort()) console.log(k.padEnd(14), (agg[k] / N).toFixed(1));
console.log("empty share of land", (agg.empty_land / agg.land).toFixed(3));
