/**
 * Battle of Polytopia-inspired colour palette and UI tokens.
 * Sunlit emerald terrain, turquoise shallows, cobalt oceans, star-gold accents,
 * and vibrant high-contrast clan banners. Purely cosmetic; the engine never reads this file.
 */
import type { Terrain } from "@/logic/engine/types";

export const TILE = 46;

export const TERRAIN_COLOR: Record<Terrain, string> = {
  field: "#8bd44b",
  forest: "#6bb53d",
  mountain: "#8c929c",
  water: "#3ec5e0",
  ocean: "#1a5ba0",
};

export const TERRAIN_GLYPH: Partial<Record<Terrain, string>> = {
  forest: "🌲",
  mountain: "⛰️",
};

export const FOG = "#ebf3fc66"; // crisp Polytopia cloud mist

/**
 * UI tokens harmonized with the Polytopia low-poly diorama aesthetic:
 * deep twilight sky, crisp cobalt panels, bright white-ice text, and star gold.
 */
export const UI = {
  dusk: "#12213d", // app background: deep Polytopia twilight sky
  panel: "#1c3158",
  panelHi: "#264173",
  line: "#365894",
  mist: "#f2f7ff", // primary text
  muted: "#9bb6db", // secondary text
  gold: "#ffd23f", // Polytopia stars + primary action
  goldInk: "#362503", // text on gold
  sky: "#3ec5e0", // move targets, secondary actions
  coral: "#f25f5c", // attack targets, danger
  display: "Oi-Regular", // display face: logo, headings, results only
};

export const RESOURCE_GLYPH: Record<string, string> = {
  fruit: "🫐",
  crop: "🌾",
  animal: "🦌",
  fish: "🐟",
  metal: "🪙",
  starfish: "⭐",
};

/** glyphs for buildings; unknown ids fall back to a generic hut */
export const BUILDING_GLYPH: Record<string, string> = {
  farm: "🟫",
  mine: "⛏️",
  lumberHut: "🪵",
  sawmill: "🪚",
  windmill: "🌀",
  forge: "🔥",
  port: "⚓",
  market: "🏪",
  temple: "🛕",
  forestTemple: "🛕",
  waterTemple: "🛕",
  mountainTemple: "🛕",
  monument: "🗽",
};

export const UNIT_GLYPH: Record<string, string> = {
  warrior: "🗡️",
  rider: "🐎",
  archer: "🏹",
  defender: "🛡️",
  swordsman: "⚔️",
  catapult: "🪨",
  knight: "🏇",
  giant: "🗿",
  mindBender: "🔮",
  explorer: "🧭",
  cloak: "🥷",
  dagger: "🔪",
  raft: "🛶",
  scout: "⛵",
  rammer: "🚤",
  bomber: "🚢",
  boat: "🛶",
  ship: "⛵",
  battleship: "🚢",
};

/** Vibrant Polytopia-style clan banner colours (index = player id). */
export const PLAYER_COLORS = [
  "#e63946",
  "#2589f5",
  "#9b5de5",
  "#2db84d",
  "#f4a226",
  "#ec4899",
  "#14b8a6",
  "#64748b",
  "#f97316",
  "#4361ee",
  "#d90429",
  "#65a30d",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#475569",
];
