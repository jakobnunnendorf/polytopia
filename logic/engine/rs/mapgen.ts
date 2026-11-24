/** mapgen.ts on the Rust engine (same exports; see logic/engine/rust.ts) */
import { call } from "../rust";
import type { Rng } from "../rng";

export type { GeneratedMap, MapOptions, MapSettings, MapType } from "../mapgen";
import type { GeneratedMap, MapOptions, MapSettings, MapType } from "../mapgen";

export const MAP_SETTINGS: Record<MapType, MapSettings> = call("MAP_SETTINGS");
export const WETNESS: Record<MapType, number> = call("WETNESS");
export const TERRAIN_WEIGHTS: { field: number; mountain: number; forest: number } = call("TERRAIN_WEIGHTS");
export const RESOURCE_CHANCES: Record<"animal" | "crop" | "fish" | "metal" | "fruit" | "spores" | "aquaCrop", number> =
  call("RESOURCE_CHANCES");

export const ruinCount = (size: number): number => call("ruinCount", size);
export const inequality = (map: GeneratedMap, n: number): number => call("inequality", map, n);

/** `rng` advances exactly as in mapgen.ts (Rust hands back its final state) */
export function generateMap(
  rng: Rng,
  n: number,
  players: number,
  mapType: MapType = "drylands",
  mods: Partial<Record<string, number>>[] = [],
  opts: MapOptions = {},
): GeneratedMap {
  if (!rng.setState) throw new Error("generateMap on the Rust engine needs an Rng from createRng (with setState)");
  const out = call<{ map: GeneratedMap; rng: number }>("generateMap", rng.state(), n, players, mapType, mods, opts);
  rng.setState(out.rng);
  return out.map;
}
