/**
 * Battle of Polytopia-style game art.
 * Uses crisp 3D low-poly isometric transparent PNG sprites for all land units,
 * naval units, resources, buildings, temples, and the Star currency icon, paired
 * with Polytopia-styled low-poly SVG terrain, cities, villages, monuments, and clouds.
 * Purely cosmetic; the engine never imports this file.
 */
import React from "react";
import { Image, Platform, View, type ImageSourcePropType } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from "react-native-svg";
import { PLAYER_COLORS } from "@/components/game/theme";
import type { Terrain } from "@/logic/engine/types";
import { SpecialBuildingArt, SpecialUnitArt, TribeEmblem } from "./TribeArt";
import { TRIBE_UNIT_SPRITES } from "./tribeUnits";
import { useMultiplySprite, useTeamSprite } from "./teamTint";

export { TribeEmblem };

// ---------- 3D low-poly Polytopia sprite map ----------
const UNIT_SPRITES: Record<string, ImageSourcePropType> = {
  warrior: require("@/assets/sprites/warrior.png"),
  rider: require("@/assets/sprites/rider.png"),
  archer: require("@/assets/sprites/archer.png"),
  defender: require("@/assets/sprites/defender.png"),
  swordsman: require("@/assets/sprites/swordsman.png"),
  knight: require("@/assets/sprites/knight.png"),
  catapult: require("@/assets/sprites/catapult.png"),
  giant: require("@/assets/sprites/giant.png"),
  mindBender: require("@/assets/sprites/mindBender.png"),
  cloak: require("@/assets/sprites/cloak.png"),
  dagger: require("@/assets/sprites/dagger.png"),
  raft: require("@/assets/sprites/raft.png"),
  dinghy: require("@/assets/sprites/dinghy.png"),
  scout: require("@/assets/sprites/scout.png"),
  rammer: require("@/assets/sprites/rammer.png"),
  pirate: require("@/assets/sprites/pirate.png"),
  bomber: require("@/assets/sprites/bomber.png"),
  juggernaut: require("@/assets/sprites/juggernaut.png"),
};

const RESOURCE_SPRITES: Record<string, ImageSourcePropType> = {
  fruit: require("@/assets/sprites/fruit.png"),
  crop: require("@/assets/sprites/crop.png"),
  animal: require("@/assets/sprites/animal.png"),
  fish: require("@/assets/sprites/fish.png"),
  metal: require("@/assets/sprites/metal.png"),
  starfish: require("@/assets/sprites/starfish.png"),
  aquaCrop: require("@/assets/sprites/aquaCrop.png"),
  spores: require("@/assets/sprites/spores.png"),
};

const BUILDING_SPRITES: Record<string, ImageSourcePropType> = {
  farm: require("@/assets/sprites/farm.png"),
  mine: require("@/assets/sprites/mine.png"),
  lumberHut: require("@/assets/sprites/lumberHut.png"),
  sawmill: require("@/assets/sprites/sawmill.png"),
  windmill: require("@/assets/sprites/windmill.png"),
  forge: require("@/assets/sprites/forge.png"),
  port: require("@/assets/sprites/port.png"),
  market: require("@/assets/sprites/market.png"),
  ruin: require("@/assets/sprites/ruin.png"),
  temple: require("@/assets/sprites/temple.png"),
  forestTemple: require("@/assets/sprites/forestTemple.png"),
  waterTemple: require("@/assets/sprites/waterTemple.png"),
  mountainTemple: require("@/assets/sprites/mountainTemple.png"),
  altarOfPeace: require("@/assets/sprites/altarOfPeace.png"),
  towerOfWisdom: require("@/assets/sprites/towerOfWisdom.png"),
  emperorsTomb: require("@/assets/sprites/emperorsTomb.png"),
  gateOfPower: require("@/assets/sprites/gateOfPower.png"),
  parkOfFortune: require("@/assets/sprites/parkOfFortune.png"),
  grandBazaar: require("@/assets/sprites/grandBazaar.png"),
  eyeOfGod: require("@/assets/sprites/eyeOfGod.png"),
};

const STAR_SPRITE: ImageSourcePropType = require("@/assets/sprites/star.png");
const LIGHTHOUSE_ROOF: ImageSourcePropType = require("@/assets/sprites/lighthouseRoof.png");
const LIGHTHOUSE_SECTION: ImageSourcePropType = require("@/assets/sprites/lighthouseSection.png");
const LIGHTHOUSE_SECTION_TINT: ImageSourcePropType = require("@/assets/sprites/lighthouseSectionTint.png");

function Sprite({ source, size, pad = 0, team }: { source: ImageSourcePropType; size: number; pad?: number; team?: string }) {
  const shown = useTeamSprite(source, team);
  return (
    <Image
      source={shown}
      resizeMode="contain"
      style={{
        position: "absolute",
        left: pad,
        top: pad,
        width: size - pad * 2,
        height: size - pad * 2,
      }}
    />
  );
}

// ---------- colour helpers ----------
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** deterministic 0..1 noise per tile, so the map looks hand-crafted and never flickers */
function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const pts = (a: number[]) => a.join(" ");

const PAL = {
  field: "#8bd44b",
  forestFloor: "#6bb53d",
  mountain: "#8c929c",
  water: "#3ec5e0",
  ocean: "#1a5ba0",
  pine: "#258246",
  trunk: "#7a4c2a",
  snow: "#f6faff",
  wood: "#a9713b",
  stone: "#c4c9d0",
  gold: "#ffd23f",
  skin: "#f5cea8",
  shadow: "#0d1f2d",
  steel: "#dce4ec",
};

function Box({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute", left: 0, top: 0 }}>
      {children}
    </Svg>
  );
}

// ---------- terrain ----------
function Ground({ base, x, y }: { base: string; x: number; y: number }) {
  const j = (k: number) => 22 + hash(x, y, k) * 56;
  const a = j(1);
  const b = j(2);
  return (
    <G>
      <Rect x={0} y={0} width={100} height={100} fill={base} />
      <Polygon points={pts([0, 0, a, 0, 50, 50, 0, b])} fill={shade(base, 0.13)} />
      <Polygon points={pts([a, 0, 100, 0, 100, 100 - a, 50, 50])} fill={shade(base, 0.04)} />
      <Polygon points={pts([100, 100, 100 - b, 100, 50, 50, 100, 100 - a])} fill={shade(base, -0.11)} />
      <Polygon points={pts([0, b, 50, 50, 100 - b, 100, 0, 100])} fill={shade(base, -0.04)} />
      <Polygon points={pts([0, 0, 100, 0, 96, 4, 4, 4])} fill="#ffffff" opacity={0.14} />
      <Polygon points={pts([0, 0, 4, 4, 4, 96, 0, 100])} fill="#ffffff" opacity={0.09} />
      <Polygon points={pts([0, 100, 4, 96, 96, 96, 100, 100])} fill={PAL.shadow} opacity={0.14} />
      <Polygon points={pts([100, 0, 100, 100, 96, 96, 96, 4])} fill={PAL.shadow} opacity={0.1} />
    </G>
  );
}

function Pine({ cx, base, s = 1, tint = PAL.pine }: { cx: number; base: number; s?: number; tint?: string }) {
  const w = 18 * s;
  const h = 21 * s;
  const tiers = [0, 1, 2];
  return (
    <G>
      <Polygon
        points={pts([cx - 6 * s, base + 2 * s, cx + 18 * s, base - 2 * s, cx + 12 * s, base + 5 * s, cx - 2 * s, base + 5 * s])}
        fill={PAL.shadow}
        opacity={0.22}
      />
      <Rect x={cx - 3 * s} y={base - 8 * s} width={3 * s} height={10 * s} fill={shade(PAL.trunk, 0.14)} />
      <Rect x={cx} y={base - 8 * s} width={3 * s} height={10 * s} fill={shade(PAL.trunk, -0.22)} />
      {tiers.map((t) => {
        const bottom = base - 5 * s - t * 12 * s;
        const tw = w - t * 4.2 * s;
        const top = bottom - h + t * 2 * s;
        return (
          <G key={t}>
            <Polygon points={pts([cx - tw, bottom, cx, top, cx - tw * 0.12, bottom + 2 * s])} fill={shade(tint, 0.24)} />
            <Polygon points={pts([cx - tw * 0.12, bottom + 2 * s, cx, top, cx + tw * 0.18, bottom + 2 * s])} fill={tint} />
            <Polygon points={pts([cx + tw * 0.18, bottom + 2 * s, cx, top, cx + tw, bottom])} fill={shade(tint, -0.26)} />
          </G>
        );
      })}
    </G>
  );
}

function Peak({ x, y }: { x: number; y: number }) {
  const tip = 44 + hash(x, y, 7) * 12;
  const sideTip = tip > 50 ? 24 : 76;
  return (
    <G>
      <Polygon points={pts([10, 90, 94, 90, 86, 96, 18, 96])} fill={PAL.shadow} opacity={0.22} />
      <Polygon points={pts([sideTip - 20, 88, sideTip, 40, sideTip, 88])} fill={shade(PAL.mountain, 0.1)} />
      <Polygon points={pts([sideTip, 40, sideTip + 20, 88, sideTip, 88])} fill={shade(PAL.mountain, -0.28)} />
      <Polygon points={pts([sideTip - 7, 56, sideTip, 40, sideTip, 58])} fill={PAL.snow} />
      <Polygon points={pts([sideTip, 40, sideTip + 7, 56, sideTip, 58])} fill={shade(PAL.snow, -0.14)} />
      <Polygon points={pts([10, 90, tip, 10, tip - 5, 90])} fill={shade(PAL.mountain, 0.22)} />
      <Polygon points={pts([tip - 5, 90, tip, 10, tip + 8, 90])} fill={PAL.mountain} />
      <Polygon points={pts([tip + 8, 90, tip, 10, 90, 90])} fill={shade(PAL.mountain, -0.3)} />
      <Polygon points={pts([tip - 15, 39, tip, 10, tip - 2, 42, tip - 9, 35])} fill={PAL.snow} />
      <Polygon points={pts([tip - 2, 42, tip, 10, tip + 6, 36, tip + 3, 44])} fill={shade(PAL.snow, -0.06)} />
      <Polygon points={pts([tip + 6, 36, tip, 10, tip + 15, 38, tip + 9, 34])} fill={shade(PAL.snow, -0.2)} />
    </G>
  );
}

/**
 * Frozen water: an opaque faceted ice sheet that hides the water below, so ice never
 * reads as shallow water. Icy cyan (not white, which is the clouds), white glints,
 * dark-blue cracks and a crisp rim; the facets and cracks vary per tile.
 */
export function IceArt({ x, y, size }: { x: number; y: number; size: number }) {
  const base = "#bfeaf8";
  const a = 30 + hash(x, y, 81) * 40;
  const b = 30 + hash(x, y, 82) * 40;
  const c = hash(x, y, 83) * 20;
  return (
    <Box size={size}>
      <Rect x={0} y={0} width={100} height={100} fill={base} />
      <Polygon points={pts([0, 0, a + 20, 0, 42, 46, 0, b])} fill={shade(base, 0.45)} />
      <Polygon points={pts([a + 20, 0, 100, 0, 100, 58 - c, 42, 46])} fill={shade(base, 0.2)} />
      <Polygon points={pts([0, b, 42, 46, 52 + c, 100, 0, 100])} fill={shade(base, -0.06)} />
      <Polygon points={pts([42, 46, 100, 58 - c, 100, 100, 52 + c, 100])} fill={shade(base, -0.16)} />
      {/* glints */}
      <Polygon points={pts([12, 14, 30, 10, 18, 22])} fill="#ffffff" opacity={0.9} />
      <Polygon points={pts([64 + c, 62, 76 + c, 58, 70 + c, 68])} fill="#ffffff" opacity={0.75} />
      {/* cracks from the facet joint */}
      <Path d={`M42 46 L${24 + c} ${66 + c * 0.5} L${14 + c} 84`} stroke="#3d86b8" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={`M42 46 L${66 - c * 0.5} 30 L${84 - c} ${18 + c * 0.4}`} stroke="#3d86b8" strokeWidth={1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d={`M${66 - c * 0.5} 30 L${70 - c * 0.3} 42`} stroke="#3d86b8" strokeWidth={1} fill="none" strokeLinecap="round" />
      {/* rim: white inner bevel, cyan outer edge */}
      <Rect x={1.5} y={1.5} width={97} height={97} fill="none" stroke="#5fb4dc" strokeWidth={3} />
      <Rect x={4.5} y={4.5} width={91} height={91} fill="none" stroke="#ffffff" strokeWidth={1.5} opacity={0.8} />
    </Box>
  );
}

export function TerrainArt({ terrain, x, y, size }: { terrain: Terrain; x: number; y: number; size: number }) {
  if (terrain === "water" || terrain === "ocean") {
    const base = terrain === "water" ? PAL.water : PAL.ocean;
    const o = hash(x, y, 3) * 26;
    const o2 = hash(x, y, 8) * 22;
    return (
      <Box size={size}>
        <Rect x={0} y={0} width={100} height={100} fill={base} />
        <Polygon points={pts([0, 0, 55 + o * 0.4, 0, 35, 52, 0, 40 + o * 0.5])} fill={shade(base, 0.12)} />
        <Polygon points={pts([35, 52, 100, 34 - o * 0.3, 100, 100, 55, 100])} fill={shade(base, -0.1)} />
        <Polygon points={pts([0, 70, 48, 52, 62, 100, 0, 100])} fill={shade(base, 0.05)} />
        <Polygon points={pts([14 + o, 30, 24 + o, 25, 34 + o, 30, 24 + o, 32])} fill={shade(base, 0.48)} opacity={0.75} />
        <Polygon points={pts([50 - o2 * 0.4, 70, 62 - o2 * 0.4, 65, 74 - o2 * 0.4, 70, 62 - o2 * 0.4, 72])} fill={shade(base, 0.42)} opacity={0.65} />
        {terrain === "ocean" && (
          <Polygon points={pts([62, 22 + o2 * 0.4, 72, 18 + o2 * 0.4, 82, 22 + o2 * 0.4, 72, 24 + o2 * 0.4])} fill={shade(base, 0.35)} opacity={0.5} />
        )}
      </Box>
    );
  }
  if (terrain === "forest") {
    const j1 = hash(x, y, 4) * 6;
    const j2 = hash(x, y, 5) * 6;
    const j3 = hash(x, y, 6) * 5;
    return (
      <Box size={size}>
        <Ground base={PAL.forestFloor} x={x} y={y} />
        <Pine cx={68 + j2} base={64} s={0.82} tint={shade(PAL.pine, -0.06)} />
        <Pine cx={28 + j1} base={76} s={0.96} tint={PAL.pine} />
        <Pine cx={56 + j3} base={90} s={1.04} tint={shade(PAL.pine, 0.06)} />
      </Box>
    );
  }
  if (terrain === "mountain") {
    return (
      <Box size={size}>
        <Ground base={shade(PAL.field, -0.12)} x={x} y={y} />
        <Peak x={x} y={y} />
      </Box>
    );
  }
  const tuft = hash(x, y, 9);
  const flower = hash(x, y, 11);
  return (
    <Box size={size}>
      <Ground base={PAL.field} x={x} y={y} />
      {tuft > 0.55 && (
        <G>
          <Polygon points={pts([18, 78, 22, 68, 25, 78])} fill={shade(PAL.field, -0.22)} />
          <Polygon points={pts([24, 79, 28, 71, 31, 79])} fill={shade(PAL.field, 0.22)} />
        </G>
      )}
      {flower > 0.72 && (
        <G>
          <Polygon points={pts([72, 28, 76, 24, 80, 28, 76, 32])} fill={flower > 0.86 ? "#fff7a8" : "#ffffff"} />
          <Circle cx={76} cy={28} r={1.6} fill="#f5a623" />
        </G>
      )}
    </Box>
  );
}

// ---------- resources (3D Polytopia PNG sprites) ----------
export function ResourceArt({ id, size }: { id: string; size: number }) {
  const sprite = RESOURCE_SPRITES[id];
  if (sprite) return <Sprite source={sprite} size={size} pad={size * 0.08} />;
  return null;
}

// ---------- buildings, temples & monuments ----------
function PolyHouse({
  x,
  y,
  w,
  h,
  roof,
  wall = "#f4ebd9",
  door = true,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  roof: string;
  wall?: string;
  door?: boolean;
}) {
  const mid = x + w * 0.52;
  const peakY = y - h * 0.72;
  return (
    <G>
      <Polygon points={pts([x + 2, y + h, x + w + 7, y + h - 3, x + w + 5, y + h + 4, x + 4, y + h + 4])} fill={PAL.shadow} opacity={0.22} />
      <Polygon points={pts([x, y, mid, y + 3, mid, y + h + 3, x, y + h])} fill={wall} />
      <Polygon points={pts([mid, y + 3, x + w, y, x + w, y + h, mid, y + h + 3])} fill={shade(wall, -0.18)} />
      <Polygon points={pts([x - 3, y + 1, mid, peakY, mid, y + 4])} fill={shade(roof, 0.16)} />
      <Polygon points={pts([mid, peakY, x + w + 3, y + 1, mid, y + 4])} fill={shade(roof, -0.22)} />
      {door && <Rect x={x + w * 0.22} y={y + h - 8} width={Math.max(4, w * 0.18)} height={8} fill={shade(wall, -0.58)} />}
      <Rect x={mid + w * 0.14} y={y + h * 0.35} width={Math.max(3, w * 0.14)} height={Math.max(4, h * 0.22)} fill="#2e3e59" />
    </G>
  );
}

export function BuildingArt({ id, size }: { id: string; size: number }) {
  const sprite = BUILDING_SPRITES[id];
  if (sprite) return <Sprite source={sprite} size={size} pad={size * 0.04} />;
  const special = SpecialBuildingArt({ id, size });
  if (special) return special;

  switch (id) {
    case "altarOfPeace":
      return (
        <Box size={size}>
          <Ellipse cx={50} cy={86} rx={30} ry={7} fill={PAL.shadow} opacity={0.22} />
          <Rect x={22} y={76} width={56} height={10} fill="#d6dde6" />
          <Rect x={30} y={66} width={40} height={10} fill="#eef3f8" />
          <Polygon points={pts([50, 14, 62, 66, 50, 66])} fill="#d4deeb" />
          <Polygon points={pts([50, 14, 38, 66, 50, 66])} fill="#ffffff" />
          <Polygon points={pts([50, 26, 62, 38, 50, 50, 38, 38])} fill={PAL.gold} />
        </Box>
      );
    case "towerOfWisdom":
      return (
        <Box size={size}>
          <Ellipse cx={50} cy={88} rx={26} ry={6} fill={PAL.shadow} opacity={0.22} />
          <Polygon points={pts([34, 86, 40, 26, 50, 26, 50, 86])} fill="#f2efe8" />
          <Polygon points={pts([50, 26, 60, 26, 66, 86, 50, 86])} fill="#c9c4b8" />
          <Polygon points={pts([36, 28, 50, 8, 50, 28])} fill="#3b82f6" />
          <Polygon points={pts([50, 8, 64, 28, 50, 28])} fill="#1d4ed8" />
          <Circle cx={50} cy={12} r={5} fill={PAL.gold} />
        </Box>
      );
    case "emperorsTomb":
      return (
        <Box size={size}>
          <Ellipse cx={50} cy={86} rx={36} ry={7} fill={PAL.shadow} opacity={0.24} />
          <Polygon points={pts([14, 84, 50, 20, 50, 84])} fill="#e6c473" />
          <Polygon points={pts([50, 20, 86, 84, 50, 84])} fill="#ba9441" />
          <Polygon points={pts([42, 34, 50, 20, 58, 34])} fill={PAL.gold} />
          <Rect x={44} y={66} width={12} height={18} fill="#2b2114" />
        </Box>
      );
    case "gateOfPower":
      return (
        <Box size={size}>
          <Ellipse cx={50} cy={86} rx={34} ry={7} fill={PAL.shadow} opacity={0.24} />
          <Rect x={18} y={34} width={18} height={50} fill="#e0dcd2" />
          <Rect x={64} y={34} width={18} height={50} fill="#b8b3a8" />
          <Rect x={14} y={24} width={72} height={14} fill="#ece8de" />
          <Polygon points={pts([50, 8, 64, 24, 36, 24])} fill={PAL.gold} />
          <Polygon points={pts([36, 84, 36, 52, 50, 42, 64, 52, 64, 84])} fill="#2b2622" opacity={0.6} />
        </Box>
      );
    case "parkOfFortune":
      return (
        <Box size={size}>
          <Polygon points={pts([14, 78, 50, 62, 86, 78, 50, 92])} fill="#45bd59" />
          <Polygon points={pts([24, 74, 50, 62, 76, 74, 50, 84])} fill="#4fd0e8" />
          <Rect x={46} y={36} width={8} height={36} fill="#f2ede2" />
          <Polygon points={pts([50, 14, 60, 28, 50, 42, 40, 28])} fill={PAL.gold} />
        </Box>
      );
    case "grandBazaar":
      return (
        <Box size={size}>
          <Ellipse cx={50} cy={86} rx={36} ry={7} fill={PAL.shadow} opacity={0.22} />
          <Rect x={20} y={52} width={30} height={32} fill="#f5ede0" />
          <Rect x={50} y={52} width={30} height={32} fill="#d6cbb8" />
          <Polygon points={pts([22, 52, 50, 18, 50, 52])} fill="#2ec4d6" />
          <Polygon points={pts([50, 18, 78, 52, 50, 52])} fill="#1a8fa0" />
          <Polygon points={pts([50, 8, 55, 18, 45, 18])} fill={PAL.gold} />
        </Box>
      );
    case "eyeOfGod":
      return (
        <Box size={size}>
          <Ellipse cx={50} cy={86} rx={28} ry={7} fill={PAL.shadow} opacity={0.24} />
          <Rect x={26} y={76} width={48} height={10} fill={shade(PAL.stone, -0.18)} />
          <Polygon points={pts([38, 76, 44, 22, 50, 22, 50, 76])} fill="#f5f0e4" />
          <Polygon points={pts([50, 22, 56, 22, 62, 76, 50, 76])} fill="#c9c2b2" />
          <Polygon points={pts([44, 22, 50, 6, 56, 22])} fill={PAL.gold} />
          <Polygon points={pts([42, 42, 50, 36, 58, 42, 50, 48])} fill="#3ec5e0" />
          <Circle cx={50} cy={42} r={2.5} fill="#ffffff" />
        </Box>
      );
    default:
      if (id.toLowerCase().includes("temple")) {
        const tint = "#d4cfc6";
        const accent = "#7a7670";
        return (
          <Box size={size}>
            <Ellipse cx={50} cy={86} rx={34} ry={7} fill={PAL.shadow} opacity={0.24} />
            <Rect x={16} y={76} width={68} height={10} fill={shade(tint, -0.32)} />
            <Rect x={22} y={66} width={56} height={10} fill={shade(tint, -0.14)} />
            {[28, 46, 64].map((px) => (
              <G key={px}>
                <Rect x={px} y={42} width={5} height={24} fill={tint} />
                <Rect x={px + 5} y={42} width={3} height={24} fill={shade(tint, -0.25)} />
              </G>
            ))}
            <Polygon points={pts([18, 44, 50, 20, 50, 44])} fill={shade(accent, 0.22)} />
            <Polygon points={pts([50, 20, 82, 44, 50, 44])} fill={shade(accent, -0.18)} />
            <Polygon points={pts([45, 22, 50, 10, 55, 22])} fill={PAL.gold} />
          </Box>
        );
      }
      return (
        <Box size={size}>
          <PolyHouse x={26} y={44} w={48} h={32} roof="#9a7b5a" />
        </Box>
      );
  }
}

/**
 * True isometric 3D low-poly Polytopia building block (sunlit left wall, shaded
 * right wall, pitched pyramidal tribe-coloured roof, arched door & windows).
 * (cx, cy) is the bottom front corner of the isometric footprint.
 */
function IsoBuilding({
  cx,
  cy,
  rx,
  ry,
  h,
  roof,
  roofH,
  wall = "#f6f1e6",
  goldTrim = false,
  door = false,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  h: number;
  roof: string;
  roofH: number;
  wall?: string;
  goldTrim?: boolean;
  door?: boolean;
}) {
  // Base diamond: front (cx, cy), left (cx-rx, cy-ry), back (cx, cy-2*ry), right (cx+rx, cy-ry)
  const topY = cy - h;
  const peakY = topY - ry - roofH;
  const ov = 1.14; // roof overhang
  const rrx = rx * ov;
  const rry = ry * ov;
  return (
    <G>
      {/* soft isometric cast shadow to the right */}
      <Polygon
        points={pts([cx, cy, cx + rx, cy - ry, cx + rx + 5, cy - ry + 2, cx + 4, cy + 3])}
        fill={PAL.shadow}
        opacity={0.22}
      />
      {/* sunlit left wall */}
      <Polygon
        points={pts([cx - rx, cy - ry, cx, cy, cx, topY, cx - rx, topY - ry])}
        fill={wall}
      />
      {/* shaded right wall */}
      <Polygon
        points={pts([cx, cy, cx + rx, cy - ry, cx + rx, topY - ry, cx, topY])}
        fill={shade(wall, -0.19)}
      />
      {/* gold cornice trim on capital/tall towers */}
      {goldTrim && (
        <G>
          <Polygon points={pts([cx - rx, topY - ry, cx, topY, cx, topY + 2.4, cx - rx, topY - ry + 2.4])} fill={PAL.gold} />
          <Polygon points={pts([cx, topY, cx + rx, topY - ry, cx + rx, topY - ry + 2.4, cx, topY + 2.4])} fill={shade(PAL.gold, -0.22)} />
        </G>
      )}
      {/* isometric windows */}
      {h >= 12 && (
        <G>
          <Polygon
            points={pts([
              cx - rx * 0.62, topY - ry * 0.62 + 4,
              cx - rx * 0.34, topY - ry * 0.34 + 4,
              cx - rx * 0.34, topY - ry * 0.34 + 8.5,
              cx - rx * 0.62, topY - ry * 0.62 + 8.5,
            ])}
            fill="#283852"
          />
          <Polygon
            points={pts([
              cx + rx * 0.34, topY - ry * 0.34 + 4,
              cx + rx * 0.62, topY - ry * 0.62 + 4,
              cx + rx * 0.62, topY - ry * 0.62 + 8.5,
              cx + rx * 0.34, topY - ry * 0.34 + 8.5,
            ])}
            fill="#1b2638"
          />
        </G>
      )}
      {/* wooden doorway on front-left wall */}
      {door && (
        <Polygon
          points={pts([
            cx - rx * 0.56, cy - ry * 0.56,
            cx - rx * 0.24, cy - ry * 0.24,
            cx - rx * 0.24, cy - ry * 0.24 - 7,
            cx - rx * 0.56, cy - ry * 0.56 - 7,
          ])}
          fill="#5c3d24"
        />
      )}
      {/* 3D pyramidal isometric pitched roof (3 visible facets) */}
      {/* rear-left sunlit slope */}
      <Polygon
        points={pts([cx - rrx, topY - rry, cx, topY - 2 * rry, cx, peakY])}
        fill={shade(roof, 0.28)}
      />
      {/* front-left bright slope */}
      <Polygon
        points={pts([cx - rrx, topY - rry, cx, topY + 1, cx, peakY])}
        fill={shade(roof, 0.1)}
      />
      {/* front-right shaded slope */}
      <Polygon
        points={pts([cx, topY + 1, cx + rrx, topY - rry, cx, peakY])}
        fill={shade(roof, -0.26)}
      />
    </G>
  );
}

/** Isometric 3D stone watchtower for fortified city walls */
function IsoBastion({ cx, cy, s = 1 }: { cx: number; cy: number; s?: number }) {
  const rx = 6.5 * s;
  const ry = 3.6 * s;
  const h = 13 * s;
  const topY = cy - h;
  return (
    <G>
      <Polygon points={pts([cx - rx, cy - ry, cx, cy, cx, topY, cx - rx, topY - ry])} fill="#cfd5dd" />
      <Polygon points={pts([cx, cy, cx + rx, cy - ry, cx + rx, topY - ry, cx, topY])} fill="#9aa3b0" />
      <Polygon points={pts([cx - rx, topY - ry, cx, topY - 2 * ry, cx + rx, topY - ry, cx, topY])} fill="#e6ebf2" />
      {/* crenellation cap */}
      <Polygon points={pts([cx - rx * 0.7, topY - ry * 0.7, cx, topY - 1.4 * ry, cx + rx * 0.7, topY - ry * 0.7, cx, topY])} fill="#b6bfcc" />
    </G>
  );
}

export function VillageArt({ size }: { size: number }) {
  return (
    <Box size={size}>
      {/* dirt clearing with a dark rim so it reads against grass (still smaller than a city's plaza) */}
      <Polygon points={pts([14, 76, 50, 57, 86, 76, 50, 95])} fill="#7a6238" opacity={0.55} />
      <Polygon points={pts([18, 75, 50, 59, 82, 75, 50, 91])} fill="#c4a46a" />
      {/* 3 neutral huts with warm brown roofs: high contrast on green, no tribe colour (unclaimed) */}
      <IsoBuilding cx={36} cy={72} rx={10} ry={5.4} h={10} roof="#8a4b25" roofH={9} wall="#f3e8cf" door />
      <IsoBuilding cx={60} cy={70} rx={9} ry={4.9} h={9} roof="#9c5a2e" roofH={8} wall="#efe2c6" />
      <IsoBuilding cx={50} cy={86} rx={9.5} ry={5.1} h={9.5} roof="#7c4220" roofH={8.5} wall="#f3e8cf" door />
    </Box>
  );
}

function LighthouseTier({
  color,
  w,
  h,
  bottom,
  left,
  testID,
}: {
  color: string;
  w: number;
  h: number;
  bottom: number;
  left: number;
  testID?: string;
}) {
  const gem = useMultiplySprite(LIGHTHOUSE_SECTION_TINT, color);
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{ position: "absolute", left, bottom, width: w, height: h }}
    >
      <Image source={LIGHTHOUSE_SECTION} resizeMode="contain" style={{ width: w, height: h }} />
      <Image
        source={gem}
        resizeMode="contain"
        style={{
          position: "absolute",
          left: w * 0.334,
          top: h * 0.475,
          width: w * (63 / 190),
          height: h * (73 / 205),
          ...(Platform.OS !== "web" ? { tintColor: color } : null),
        }}
      />
    </View>
  );
}

/**
 * Corner lighthouse built from the official Polytopia sprites:
 * one stacked hexagonal section per finder (with its tribe-coloured gem), topped by the lantern roof.
 */
export function LighthouseArt({
  size,
  finders = [],
  testID,
}: {
  size: number;
  finders?: number[];
  testID?: string;
}) {
  const n = finders.length;
  const baseSecW = size * 0.5;
  const baseSecH = baseSecW * (205 / 190);
  const baseRoofW = baseSecW * (207 / 190);
  const baseRoofH = baseRoofW * (214 / 207);
  const baseStep = baseSecH * 0.42;
  const naturalH = baseRoofH + n * baseStep;
  const scale = Math.min(1, (size * 0.92) / naturalH);
  const secW = baseSecW * scale;
  const secH = baseSecH * scale;
  const roofW = baseRoofW * scale;
  const roofH = baseRoofH * scale;
  const step = baseStep * scale;
  const baseBottom = size * 0.04;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
    >
      {finders.map((p, k) => (
        <LighthouseTier
          key={`${p}-${k}`}
          testID={testID ? `${testID}-tier-${k}` : `lighthouse-tier-${k}`}
          color={PLAYER_COLORS[p % PLAYER_COLORS.length]}
          w={secW}
          h={secH}
          left={(size - secW) / 2}
          bottom={baseBottom + k * step}
        />
      ))}
      <Image
        source={LIGHTHOUSE_ROOF}
        resizeMode="contain"
        style={{
          position: "absolute",
          left: (size - roofW) / 2,
          bottom: baseBottom + n * step,
          width: roofW,
          height: roofH,
        }}
      />
    </View>
  );
}

/** Flat-roofed isometric Polytopia parapet/terrace block (used alongside pitched roofs for authentic stacked Polytopia skylines) */
function IsoTerrace({
  cx,
  cy,
  rx,
  ry,
  h,
  accent,
  wall = "#f4efe4",
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  h: number;
  accent: string;
  wall?: string;
}) {
  const topY = cy - h;
  return (
    <G>
      <Polygon points={pts([cx - rx, cy - ry, cx, cy, cx, topY, cx - rx, topY - ry])} fill={wall} />
      <Polygon points={pts([cx, cy, cx + rx, cy - ry, cx + rx, topY - ry, cx, topY])} fill={shade(wall, -0.2)} />
      {/* flat roof terrace */}
      <Polygon points={pts([cx - rx, topY - ry, cx, topY - 2 * ry, cx + rx, topY - ry, cx, topY])} fill={shade(wall, 0.08)} />
      {/* tribe-coloured cornice band */}
      <Polygon points={pts([cx - rx, topY - ry + 1, cx, topY + 1, cx, topY + 3.6, cx - rx, topY - ry + 3.6])} fill={accent} />
      <Polygon points={pts([cx, topY + 1, cx + rx, topY - ry + 1, cx + rx, topY - ry + 3.6, cx, topY + 3.6])} fill={shade(accent, -0.25)} />
      {/* arched doorway/window */}
      <Polygon
        points={pts([
          cx - rx * 0.52, cy - ry * 0.52,
          cx - rx * 0.22, cy - ry * 0.22,
          cx - rx * 0.22, cy - ry * 0.22 - 5.5,
          cx - rx * 0.52, cy - ry * 0.52 - 5.5,
        ])}
        fill="#283852"
      />
    </G>
  );
}

/** Tiny Polytopia courtyard cypress tree */
function MiniTree({ cx, cy }: { cx: number; cy: number }) {
  return (
    <G>
      <Rect x={cx - 1.2} y={cy - 3} width={2.4} height={4} fill="#6b4423" />
      <Polygon points={pts([cx - 4.5, cy - 2, cx, cy - 13, cx, cy - 2])} fill="#38b04a" />
      <Polygon points={pts([cx, cy - 13, cx + 4.5, cy - 2, cx, cy - 2])} fill="#217834" />
    </G>
  );
}

// ---------- cities (iconic stacked isometric Polytopia skyline) ----------
export function CityArt({
  color,
  level,
  capital,
  walls,
  size,
}: {
  color: string;
  level: number;
  capital: boolean;
  walls: boolean;
  size: number;
}) {
  return (
    <Box size={size}>
      {/* isometric 3D marble city plaza slab */}
      <Polygon points={pts([6, 74, 50, 52, 94, 74, 50, 96])} fill="#d6d0c2" />
      <Polygon points={pts([12, 74, 50, 55, 88, 74, 50, 93])} fill="#ece7db" />
      <Polygon points={pts([6, 74, 50, 96, 50, 100, 6, 78])} fill="#aba496" />
      <Polygon points={pts([50, 96, 94, 74, 94, 78, 50, 100])} fill="#857f73" />

      {/* rear isometric fortress walls when fortified */}
      {walls && (
        <G>
          <Polygon points={pts([10, 72, 50, 52, 50, 41, 10, 61])} fill="#aeb6c2" />
          <Polygon points={pts([50, 52, 90, 72, 90, 61, 50, 41])} fill="#8f98a6" />
          <IsoBastion cx={50} cy={53} s={0.95} />
        </G>
      )}

      {/* back-row stacked towers (levels 3+) */}
      {level >= 3 && (
        <IsoBuilding cx={35} cy={65} rx={10.5} ry={5.8} h={level >= 5 ? 27 : 20} roof={color} roofH={11} wall="#f4efe4" />
      )}
      {level >= 4 && (
        <IsoBuilding cx={65} cy={65} rx={10.5} ry={5.8} h={level >= 5 ? 25 : 19} roof={color} roofH={11} wall="#f4efe4" />
      )}

      {/* central Polytopia tiered citadel tower */}
      <IsoBuilding
        cx={50}
        cy={73}
        rx={capital ? 14.5 : 13.5}
        ry={capital ? 7.8 : 7.3}
        h={capital ? Math.min(35, 22 + level * 2.6) : Math.min(28, 17 + level * 2.4)}
        roof={color}
        roofH={capital ? 16 : 12}
        wall="#faf6ee"
        goldTrim={capital}
        door
      />

      {/* fluttering capital banner atop the spire */}
      {capital && (
        <G>
          <Line x1={50} y1={73 - Math.min(35, 22 + level * 2.6) - 23} x2={50} y2={6} stroke="#4a3828" strokeWidth={2.4} />
          <Polygon points={pts([51, 6, 71, 11, 51, 16])} fill={color} />
          <Polygon points={pts([51, 11, 71, 11, 51, 16])} fill={shade(color, -0.24)} />
          <Circle cx={50} cy={6} r={2.3} fill={PAL.gold} />
        </G>
      )}

      {/* left stacked terrace building (present from Lv 1!) */}
      <IsoTerrace cx={28} cy={79} rx={10.5} ry={5.8} h={level >= 2 ? 16 : 12} accent={color} wall="#f2ece0" />

      {/* right pitched-roof building (levels 2+) or courtyard tree at Lv 1 */}
      {level >= 2 ? (
        <IsoBuilding cx={72} cy={79} rx={10.5} ry={5.8} h={level >= 3 ? 16 : 13} roof={color} roofH={9.5} wall="#f2ece0" />
      ) : (
        <MiniTree cx={71} cy={76} />
      )}

      {/* front-courtyard terraced block (levels 4+) or tiny cypress at Lv 2-3 */}
      {level >= 4 ? (
        <IsoTerrace cx={50} cy={87} rx={11.5} ry={6.2} h={13} accent={color} wall="#f6f1e6" />
      ) : (
        <MiniTree cx={49} cy={86} />
      )}

      {/* front isometric crenelated fortress walls + bastions + gatehouse */}
      {walls && (
        <G>
          <IsoBastion cx={12} cy={74} s={1} />
          <IsoBastion cx={88} cy={74} s={1} />
          <Polygon points={pts([12, 74, 50, 93, 50, 81, 12, 62])} fill="#cfd5dd" />
          <Polygon points={pts([12, 62, 50, 81, 50, 78, 12, 59])} fill="#e6ebf2" />
          <Polygon points={pts([50, 93, 88, 74, 88, 62, 50, 81])} fill="#9aa3b0" />
          <Polygon points={pts([50, 81, 88, 62, 88, 59, 50, 78])} fill="#b8c0cc" />
          {/* square merlons along front-left and front-right walls */}
          {[0.25, 0.5, 0.75].map((t) => (
            <G key={t}>
              <Rect x={12 + 38 * t - 2.5} y={60 + 19 * t - 3} width={5} height={4} fill="#e6ebf2" />
              <Rect x={50 + 38 * t - 2.5} y={79 - 19 * t - 3} width={5} height={4} fill="#b8c0cc" />
            </G>
          ))}
          {/* arched gatehouse */}
          <Polygon points={pts([26, 81, 36, 86, 36, 77, 26, 72])} fill="#453324" />
          <IsoBastion cx={50} cy={95} s={1.05} />
        </G>
      )}
    </Box>
  );
}

// ---------- units (official per-tribe Polytopia PNG sprites + special tribe units) ----------
export function UnitArt({ type, color, clan, size }: { type: string; color: string; clan?: string; size: number }) {
  const tribeSprite = clan ? TRIBE_UNIT_SPRITES[clan]?.[type] : undefined;
  if (tribeSprite) return <Sprite source={tribeSprite} size={size} pad={size * 0.02} />;
  const sprite = UNIT_SPRITES[type];
  // fallback when no clan is provided: Imperius stock sprite recoloured to the owner's colour
  if (sprite) return <Sprite source={sprite} size={size} pad={size * 0.02} team={color} />;
  const special = SpecialUnitArt({ type, color, size });
  if (special) return special;
  return <Sprite source={UNIT_SPRITES.warrior} size={size} pad={size * 0.02} team={color} />;
}

/** Battle of Polytopia 3D faceted golden Star currency icon */
export function StarIcon({ size, color }: { size: number; color?: string }) {
  if (!color || color === "#f6c453" || color === "#ffd23f") {
    return (
      <Image
        source={STAR_SPRITE}
        resizeMode="contain"
        style={{ width: size, height: size }}
      />
    );
  }
  const cx = 50;
  const cy = 52;
  const rOut = 44;
  const rIn = 20;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {Array.from({ length: 5 }, (_, i) => {
        const aTip = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const aL = aTip - Math.PI / 5;
        const aR = aTip + Math.PI / 5;
        const tx = cx + rOut * Math.cos(aTip);
        const ty = cy + rOut * Math.sin(aTip);
        const lx = cx + rIn * Math.cos(aL);
        const ly = cy + rIn * Math.sin(aL);
        const rx = cx + rIn * Math.cos(aR);
        const ry = cy + rIn * Math.sin(aR);
        return (
          <G key={i}>
            <Polygon points={pts([cx, cy, lx, ly, tx, ty])} fill={shade(color, 0.34)} />
            <Polygon points={pts([cx, cy, tx, ty, rx, ry])} fill={shade(color, -0.18)} />
          </G>
        );
      })}
    </Svg>
  );
}

// ---------- crisp Polytopia white low-poly clouds over undiscovered land ----------
export const CLOUD = { base: "#ebf3fc", lit: "#ffffff", blush: "#dcebf9", shade: "#b8cee6" };

function Puff({ cx, cy, r, seed }: { cx: number; cy: number; r: number; seed: number }) {
  const k = 7;
  const ring = (rx: number, ry: number, dx = 0, dy = 0) =>
    Array.from({ length: k }, (_, i) => {
      const a = (i / k) * Math.PI * 2 + seed;
      return [cx + dx + Math.cos(a) * rx, cy + dy + Math.sin(a) * ry];
    });
  const body = ring(r, r * 0.78);
  const shadow = ring(r * 0.98, r * 0.72, 2, r * 0.2);
  const lit = ring(r * 0.64, r * 0.46, -r * 0.16, -r * 0.22);
  return (
    <G>
      <Polygon points={pts(shadow.flat())} fill={CLOUD.shade} />
      <Polygon points={pts(body.flat())} fill={CLOUD.base} />
      <Polygon points={pts(lit.flat())} fill={seed > 4.2 ? CLOUD.blush : CLOUD.lit} />
    </G>
  );
}

export function CloudArt({ x, y, size }: { x: number; y: number; size: number }) {
  const n = 2 + Math.floor(hash(x, y, 40) * 2);
  const puffs = Array.from({ length: n }, (_, i) => ({
    cx: 18 + hash(x, y, 41 + i) * 64,
    cy: 20 + hash(x, y, 51 + i) * 60,
    r: 31 + hash(x, y, 61 + i) * 12,
    seed: hash(x, y, 71 + i) * 6.28,
  })).sort((a, b) => a.cy - b.cy);
  const big = size * 1.36;
  return (
    <Svg
      width={big}
      height={big}
      viewBox="-18 -18 136 136"
      pointerEvents="none"
      style={{ position: "absolute", left: -size * 0.18, top: -size * 0.18 }}
    >
      {puffs.map((pf, i) => (
        <Puff key={i} {...pf} />
      ))}
    </Svg>
  );
}
