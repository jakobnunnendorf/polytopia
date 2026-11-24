/** mapgen.ts on the Rust engine (see logic/engine/rust.ts) */
import { call } from "./rust";
import type { Rng } from "./rng";
import type { Coord, ResourceId, Tile } from "./types";

export type GeneratedMap = {
  tiles: Tile[];
  capitals: Coord[];
  villages: Coord[];
};

export type MapOptions = {
  /** per player: the tribe's starting resources around the capital (default: none) */
  startResources?: ResourceId[][];
  /** shorthand for tests: the player starts with 2 fish (Kickoo, Aquarion) */
  waterStart?: boolean[];
  /** per player: the home climate's fields and forests start flooded (Aquarion) */
  flooded?: boolean[];
  /** shorthand for tests: Cymanti spawns (spores 0.3, crop 0, 2 starting spores) */
  spores?: boolean[];
  /** per player: alien climate (Polaris): grows no climate; the water next to the capital freezes */
  polaris?: boolean[];
  /** per player: the climate's identity (the tribe id); two players of one tribe share a climate */
  climates?: string[];
  /** ignored: Aqua Crops stay on every map (S1), only Aquarion sees them (kept for old callers) */
  aquaCrops?: boolean;
  /** map candidates drawn for the fairness pick (default: the preset's 50) */
  candidates?: number;
};

/** the game's MapGeneratorSettings per preset (polybots-engine mapgen.rs) */
export type MapSettings = {
  wetness: number;
  richness: number;
  smoothIterations: number;
  preTerrainCityDensity: number;
  postTerrainCityDensity: number;
  minSuburbs: number;
  maxSuburbs: number;
  surroundingSpace: number;
  equalityIterations: number;
  equalityLimit: number;
};

export type MapType =
  | "drylands"
  | "lakes"
  | "continents"
  | "pangea"
  | "archipelago"
  | "waterworld";

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
