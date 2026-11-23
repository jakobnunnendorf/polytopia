/**
 * Shardlands art: a flat, top-down tile look with a muted "parchment map"
 * palette and glyph icons. Purely cosmetic; the engine never reads this file.
 */
import type { Terrain } from "@/logic/engine/types";

export const TILE = 46;

export const TERRAIN_COLOR: Record<Terrain, string> = {
  field: "#cdd88a",
  forest: "#7fa25a",
  mountain: "#b3a48f",
  water: "#79c3cf",
  ocean: "#3c78a8",
};

export const TERRAIN_GLYPH: Partial<Record<Terrain, string>> = {
  forest: "🌲",
  mountain: "⛰️",
};

export const FOG = "#1b2846";

/**
 * UI tokens, taken from the menu landscape: dusk sky, sunset clouds, shard gold.
 * Gold is reserved for shards (currency) and the one primary action on screen.
 */
export const UI = {
  dusk: "#16213a", // app background: the sea of fog the map floats in
  panel: "#223154",
  panelHi: "#2c3d66",
  line: "#34477a",
  mist: "#e8eef8", // primary text
  muted: "#9db0cf", // secondary text
  gold: "#f6c453", // shards + primary action
  goldInk: "#3a2a05", // text on gold
  sky: "#5ec4d6", // move targets, secondary actions
  coral: "#f2785c", // attack targets, danger
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

/** Clan banner colours (index = player id). */
export const PLAYER_COLORS = [
  "#e4572e",
  "#2e86ab",
  "#8e5bd1",
  "#2f9e44",
  "#e9b44c",
  "#d6336c",
  "#1b998b",
  "#6c757d",
  "#f76707",
  "#3b5bdb",
  "#c2255c",
  "#5c940d",
  "#862e9c",
  "#0b7285",
  "#a61e4d",
  "#495057",
];
