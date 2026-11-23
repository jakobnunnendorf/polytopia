/**
 * Shardlands art: original low-poly vector drawings. Every shape is split into
 * a lit facet and a shaded facet, which reads as 3D without gradients.
 * All drawings use a 100×100 viewBox and scale to the tile size.
 * Purely cosmetic; the engine never imports this file.
 */
import React from "react";
import Svg, { Circle, G, Line, Path, Polygon, Rect } from "react-native-svg";
import type { Terrain } from "@/logic/engine/types";

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
/** deterministic 0..1 noise per tile, so the map looks hand-made but never flickers */
function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const pts = (a: number[]) => a.join(" ");

const PAL = {
  field: "#a8c95a",
  forestFloor: "#7aa84a",
  mountain: "#9c8f7d",
  water: "#5fc2d6",
  ocean: "#2f6fa8",
  pine: "#2f7d4f",
  trunk: "#7a5230",
  snow: "#f4f1ea",
  wood: "#a8743f",
  stone: "#b9b2a6",
  gold: "#f2c14e",
  skin: "#f1c9a0",
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
  const j = (k: number) => 25 + hash(x, y, k) * 50;
  const a = j(1);
  const b = j(2);
  return (
    <G>
      <Rect x={0} y={0} width={100} height={100} fill={base} />
      <Polygon points={pts([0, 0, a, 0, 0, b])} fill={shade(base, 0.12)} />
      <Polygon points={pts([100, 100, 100 - b, 100, 100, 100 - a])} fill={shade(base, -0.1)} />
      <Polygon points={pts([a, 0, 100, 0, 100, 100 - a])} fill={shade(base, 0.05)} />
    </G>
  );
}

function Pine({ cx, base, s = 1 }: { cx: number; base: number; s?: number }) {
  const w = 20 * s;
  const h = 22 * s;
  const tiers = [0, 1, 2];
  return (
    <G>
      <Rect x={cx - 2.5 * s} y={base - 6 * s} width={5 * s} height={8 * s} fill={PAL.trunk} />
      {tiers.map((t) => {
        const bottom = base - 4 * s - t * 13 * s;
        const tw = w - t * 5 * s;
        return (
          <G key={t}>
            <Polygon points={pts([cx - tw, bottom, cx, bottom - h, cx, bottom])} fill={shade(PAL.pine, 0.18)} />
            <Polygon points={pts([cx, bottom, cx, bottom - h, cx + tw, bottom])} fill={shade(PAL.pine, -0.15)} />
          </G>
        );
      })}
    </G>
  );
}

function Peak({ x, y }: { x: number; y: number }) {
  const tip = 40 + hash(x, y, 7) * 20;
  return (
    <G>
      <Polygon points={pts([6, 88, tip, 12, tip, 88])} fill={shade(PAL.mountain, 0.15)} />
      <Polygon points={pts([tip, 12, 94, 88, tip, 88])} fill={shade(PAL.mountain, -0.2)} />
      <Polygon points={pts([tip - 13, 36, tip, 12, tip, 40, tip - 6, 34])} fill={PAL.snow} />
      <Polygon points={pts([tip, 12, tip + 12, 34, tip + 5, 31, tip, 40])} fill={shade(PAL.snow, -0.12)} />
      <Polygon points={pts([70, 88, 82, 62, 94, 88])} fill={shade(PAL.mountain, -0.32)} />
    </G>
  );
}

export function TerrainArt({ terrain, x, y, size }: { terrain: Terrain; x: number; y: number; size: number }) {
  if (terrain === "water" || terrain === "ocean") {
    const base = terrain === "water" ? PAL.water : PAL.ocean;
    const o = hash(x, y, 3) * 30;
    return (
      <Box size={size}>
        <Rect x={0} y={0} width={100} height={100} fill={base} />
        <Polygon points={pts([0, 30 + o, 50, 0, 100, 40 - o / 2, 60, 100, 0, 100])} fill={shade(base, 0.06)} />
        <Polyline d={`M ${15 + o} 30 l 8 -5 l 8 5`} color={shade(base, 0.35)} />
        <Polyline d={`M ${55 - o / 2} 68 l 8 -5 l 8 5`} color={shade(base, 0.35)} />
      </Box>
    );
  }
  if (terrain === "forest") {
    return (
      <Box size={size}>
        <Ground base={PAL.forestFloor} x={x} y={y} />
        <Pine cx={30 + hash(x, y, 4) * 6} base={88} s={1.05} />
        <Pine cx={68 + hash(x, y, 5) * 6} base={72} s={0.85} />
      </Box>
    );
  }
  if (terrain === "mountain") {
    return (
      <Box size={size}>
        <Ground base={shade(PAL.field, -0.1)} x={x} y={y} />
        <Peak x={x} y={y} />
      </Box>
    );
  }
  return (
    <Box size={size}>
      <Ground base={PAL.field} x={x} y={y} />
      {hash(x, y, 9) > 0.6 && (
        <Polygon points={pts([20, 80, 24, 70, 28, 80])} fill={shade(PAL.field, -0.2)} />
      )}
    </Box>
  );
}

function Polyline({ d, color, w = 3 }: { d: string; color: string; w?: number }) {
  return <Path d={d} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
}

// ---------- resources ----------
export function ResourceArt({ id, size }: { id: string; size: number }) {
  switch (id) {
    case "fruit":
      return (
        <Box size={size}>
          <Polygon points={pts([22, 72, 30, 48, 50, 38, 70, 46, 78, 72])} fill={shade("#3f9a52", 0.1)} />
          <Polygon points={pts([50, 38, 70, 46, 78, 72, 50, 72])} fill={shade("#3f9a52", -0.15)} />
          {[
            [36, 56],
            [52, 50],
            [62, 62],
            [44, 66],
          ].map(([cx, cy], i) => (
            <G key={i}>
              <Circle cx={cx} cy={cy} r={6} fill="#6a5acd" />
              <Circle cx={cx - 2} cy={cy - 2} r={2} fill="#b8b0ff" />
            </G>
          ))}
        </Box>
      );
    case "crop":
      return (
        <Box size={size}>
          {[34, 50, 66].map((cx, i) => (
            <G key={i}>
              <Line x1={cx} y1={80} x2={cx + (i - 1) * 4} y2={40} stroke="#b08a3c" strokeWidth={3} />
              {[0, 1, 2].map((k) => (
                <G key={k}>
                  <Polygon points={pts([cx + (i - 1) * 4, 30 + k * 9, cx + (i - 1) * 4 - 6, 36 + k * 9, cx + (i - 1) * 4, 42 + k * 9])} fill={PAL.gold} />
                  <Polygon points={pts([cx + (i - 1) * 4, 30 + k * 9, cx + (i - 1) * 4 + 6, 36 + k * 9, cx + (i - 1) * 4, 42 + k * 9])} fill={shade(PAL.gold, -0.2)} />
                </G>
              ))}
            </G>
          ))}
        </Box>
      );
    case "animal": {
      const c = "#9a6a3e";
      return (
        <Box size={size}>
          <Rect x={34} y={62} width={4} height={18} fill={shade(c, -0.3)} />
          <Rect x={60} y={62} width={4} height={18} fill={shade(c, -0.3)} />
          <Polygon points={pts([28, 52, 68, 48, 70, 66, 30, 66])} fill={c} />
          <Polygon points={pts([28, 52, 68, 48, 48, 58])} fill={shade(c, 0.18)} />
          <Polygon points={pts([66, 50, 80, 34, 86, 40, 74, 58])} fill={shade(c, 0.05)} />
          <Polyline d="M 80 34 L 76 20 M 78 26 L 70 22 M 84 36 L 92 24 M 89 29 L 95 30" color="#e6d3b0" w={2.5} />
          <Circle cx={81} cy={40} r={1.6} fill="#222" />
        </Box>
      );
    }
    case "fish":
      return (
        <Box size={size}>
          <Polygon points={pts([22, 50, 48, 34, 72, 50, 48, 66])} fill="#e2eef2" />
          <Polygon points={pts([22, 50, 48, 34, 72, 50])} fill="#ffffff" />
          <Polygon points={pts([70, 50, 86, 38, 82, 50, 86, 62])} fill="#c9dde4" />
          <Circle cx={32} cy={48} r={2} fill="#234" />
        </Box>
      );
    case "metal":
      return (
        <Box size={size}>
          <Polygon points={pts([20, 76, 30, 50, 52, 40, 76, 52, 82, 76])} fill={shade(PAL.stone, -0.15)} />
          <Polygon points={pts([52, 40, 76, 52, 82, 76, 56, 76])} fill={shade(PAL.stone, -0.35)} />
          <Polygon points={pts([38, 60, 44, 48, 50, 60])} fill={PAL.gold} />
          <Polygon points={pts([44, 48, 50, 60, 47, 60])} fill={shade(PAL.gold, -0.25)} />
          <Polygon points={pts([58, 66, 64, 54, 70, 66])} fill="#d9e3ea" />
        </Box>
      );
    case "starfish":
      return (
        <Box size={size}>
          <Polygon
            points={pts(
              Array.from({ length: 10 }, (_, i) => {
                const r = i % 2 === 0 ? 30 : 13;
                const a = -Math.PI / 2 + (i * Math.PI) / 5;
                return [50 + r * Math.cos(a), 52 + r * Math.sin(a)];
              }).flat(),
            )}
            fill="#ff8a4c"
          />
          <Circle cx={50} cy={52} r={6} fill="#ffb37a" />
        </Box>
      );
    default:
      return null;
  }
}

// ---------- small building parts ----------
function House({ x, y, w, h, roof, wall = "#efe3c8" }: { x: number; y: number; w: number; h: number; roof: string; wall?: string }) {
  return (
    <G>
      <Rect x={x} y={y} width={w / 2} height={h} fill={wall} />
      <Rect x={x + w / 2} y={y} width={w / 2} height={h} fill={shade(wall, -0.15)} />
      <Polygon points={pts([x - 3, y, x + w / 2, y - h * 0.8, x + w / 2, y])} fill={shade(roof, 0.12)} />
      <Polygon points={pts([x + w / 2, y - h * 0.8, x + w + 3, y, x + w / 2, y])} fill={shade(roof, -0.18)} />
      <Rect x={x + w / 2 - 3} y={y + h - 9} width={6} height={9} fill={shade(wall, -0.5)} />
    </G>
  );
}

export function BuildingArt({ id, size }: { id: string; size: number }) {
  switch (id) {
    case "farm":
      return (
        <Box size={size}>
          <Polygon points={pts([10, 30, 90, 30, 90, 90, 10, 90])} fill="#c8a165" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Rect key={i} x={14} y={34 + i * 11} width={72} height={5} fill={i % 2 ? "#e2c25a" : "#8fbf4a"} />
          ))}
        </Box>
      );
    case "mine":
      return (
        <Box size={size}>
          <Polygon points={pts([10, 86, 28, 40, 54, 26, 82, 44, 92, 86])} fill={shade(PAL.stone, -0.2)} />
          <Polygon points={pts([54, 26, 82, 44, 92, 86, 58, 86])} fill={shade(PAL.stone, -0.4)} />
          <Path d="M 36 86 L 36 62 Q 50 46 64 62 L 64 86 Z" fill="#2b2420" />
          <Polyline d="M 34 86 L 34 60 L 66 60 L 66 86" color={PAL.wood} w={4} />
        </Box>
      );
    case "lumberHut":
      return (
        <Box size={size}>
          <House x={22} y={46} w={40} h={30} roof="#8a5a32" wall="#c9955e" />
          {[0, 1, 2].map((i) => (
            <G key={i}>
              <Rect x={64} y={64 + i * 7} width={24} height={6} rx={3} fill={PAL.wood} />
              <Circle cx={88} cy={67 + i * 7} r={3} fill="#e8c597" />
            </G>
          ))}
        </Box>
      );
    case "sawmill":
      return (
        <Box size={size}>
          <House x={14} y={46} w={44} h={32} roof="#8a5a32" wall="#c9955e" />
          <Circle cx={72} cy={56} r={16} fill="#d4dbe0" />
          <Circle cx={72} cy={56} r={16} fill="none" stroke="#8a969e" strokeWidth={3} strokeDasharray="4 3" />
          <Circle cx={72} cy={56} r={4} fill="#59636a" />
        </Box>
      );
    case "windmill":
      return (
        <Box size={size}>
          <Polygon points={pts([38, 90, 44, 40, 50, 40, 50, 90])} fill="#efe3c8" />
          <Polygon points={pts([50, 40, 56, 40, 62, 90, 50, 90])} fill={shade("#efe3c8", -0.18)} />
          <G>
            <Polygon points={pts([50, 38, 46, 8, 54, 8])} fill="#f7f3ea" />
            <Polygon points={pts([50, 38, 80, 34, 80, 42])} fill="#e3ddd0" />
            <Polygon points={pts([50, 38, 54, 68, 46, 68])} fill="#f7f3ea" />
            <Polygon points={pts([50, 38, 20, 42, 20, 34])} fill="#e3ddd0" />
          </G>
          <Circle cx={50} cy={38} r={4} fill={PAL.wood} />
        </Box>
      );
    case "forge":
      return (
        <Box size={size}>
          <Rect x={64} y={22} width={10} height={30} fill={shade(PAL.stone, -0.3)} />
          <House x={20} y={48} w={52} h={34} roof="#5b5b66" wall={PAL.stone} />
          <Polygon points={pts([36, 82, 46, 64, 56, 82])} fill="#ff8c2e" />
          <Polygon points={pts([42, 82, 46, 72, 50, 82])} fill="#ffe08a" />
          <Circle cx={72} cy={16} r={5} fill="#cfcfcf" opacity={0.7} />
        </Box>
      );
    case "port":
      return (
        <Box size={size}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Rect key={i} x={20 + i * 12} y={40} width={10} height={30} fill={i % 2 ? PAL.wood : shade(PAL.wood, 0.12)} />
          ))}
          <Rect x={18} y={68} width={6} height={18} fill={shade(PAL.wood, -0.35)} />
          <Rect x={76} y={68} width={6} height={18} fill={shade(PAL.wood, -0.35)} />
          <Polyline d="M 80 40 L 80 22" color={shade(PAL.wood, -0.35)} w={4} />
        </Box>
      );
    case "market":
      return (
        <Box size={size}>
          <Rect x={20} y={52} width={60} height={30} fill="#efe3c8" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Polygon key={i} points={pts([16 + i * 11.3, 52, 22 + i * 11.3, 32, 27 + i * 11.3, 52])} fill={i % 2 ? "#e9536a" : "#fff3e0"} />
          ))}
          <Circle cx={36} cy={66} r={5} fill={PAL.gold} />
          <Circle cx={50} cy={68} r={5} fill="#7fc36b" />
          <Circle cx={64} cy={66} r={5} fill="#e9536a" />
        </Box>
      );
    case "ruin":
      return (
        <Box size={size}>
          <Rect x={14} y={80} width={72} height={8} fill={shade(PAL.stone, -0.2)} />
          <Rect x={22} y={40} width={10} height={40} fill="#e8e0cf" />
          <Rect x={46} y={58} width={10} height={22} fill="#e8e0cf" />
          <Polygon points={pts([66, 50, 76, 50, 76, 80, 66, 80, 66, 62])} fill={shade("#e8e0cf", -0.15)} />
          <Polygon points={pts([18, 40, 56, 34, 56, 40, 18, 46])} fill={shade("#e8e0cf", -0.08)} />
          <Circle cx={50} cy={50} r={4} fill={PAL.gold} />
        </Box>
      );
    case "monument":
    case "altarOfPeace":
    case "emperorsTomb":
    case "eyeOfGod":
    case "gateOfPower":
    case "grandBazaar":
    case "parkOfFortune":
    case "towerOfWisdom":
      return (
        <Box size={size}>
          <Rect x={30} y={78} width={40} height={10} fill={shade(PAL.stone, -0.1)} />
          <Polygon points={pts([40, 78, 46, 20, 50, 20, 50, 78])} fill="#f3ede0" />
          <Polygon points={pts([50, 20, 54, 20, 60, 78, 50, 78])} fill={shade("#f3ede0", -0.2)} />
          <Polygon points={pts([46, 20, 50, 8, 54, 20])} fill={PAL.gold} />
        </Box>
      );
    default:
      if (id.toLowerCase().includes("temple")) {
        const tint =
          id === "forestTemple" ? "#7fbf7f" : id === "waterTemple" ? "#7fc7e0" : id === "mountainTemple" ? "#c9c0b4" : "#f0e2b6";
        return (
          <Box size={size}>
            <Rect x={18} y={78} width={64} height={10} fill={shade(tint, -0.3)} />
            <Rect x={24} y={68} width={52} height={10} fill={shade(tint, -0.15)} />
            {[30, 44, 58].map((x) => (
              <Rect key={x} x={x} y={42} width={8} height={26} fill={tint} />
            ))}
            <Polygon points={pts([22, 42, 50, 22, 50, 42])} fill={shade(tint, 0.15)} />
            <Polygon points={pts([50, 22, 78, 42, 50, 42])} fill={shade(tint, -0.2)} />
          </Box>
        );
      }
      return (
        <Box size={size}>
          <House x={30} y={48} w={40} h={30} roof="#9a7b5a" />
        </Box>
      );
  }
}

export function VillageArt({ size }: { size: number }) {
  return (
    <Box size={size}>
      <House x={18} y={56} w={28} h={22} roof="#8f8a80" wall="#ddd3bf" />
      <House x={52} y={48} w={32} h={26} roof="#8f8a80" wall="#ddd3bf" />
      <Polyline d="M 14 88 L 88 88" color="#b9a98a" w={4} />
    </Box>
  );
}

// ---------- cities ----------
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
  const houses = [
    { x: 34, y: 46, w: 32, h: 26 },
    { x: 12, y: 60, w: 24, h: 20 },
    { x: 64, y: 60, w: 24, h: 20 },
    { x: 38, y: 76, w: 24, h: 14 },
  ].slice(0, Math.min(4, Math.max(1, Math.ceil(level / 1.5))));
  return (
    <Box size={size}>
      {walls && (
        <G>
          <Rect x={4} y={84} width={92} height={10} fill={shade(PAL.stone, -0.25)} />
          {[4, 24, 44, 64, 84].map((x) => (
            <Rect key={x} x={x} y={78} width={12} height={8} fill={shade(PAL.stone, -0.1)} />
          ))}
        </G>
      )}
      {houses.map((h, i) => (
        <House key={i} {...h} roof={color} />
      ))}
      {capital && (
        <G>
          <Line x1={50} y1={26} x2={50} y2={4} stroke="#4a3a2a" strokeWidth={2.5} />
          <Polygon points={pts([51, 4, 68, 9, 51, 14])} fill={color} />
          <Polygon points={pts([51, 9, 68, 9, 51, 14])} fill={shade(color, -0.25)} />
        </G>
      )}
    </Box>
  );
}

// ---------- units ----------
function Figure({ color, head = PAL.skin, hood = false, big = false }: { color: string; head?: string; hood?: boolean; big?: boolean }) {
  const s = big ? 1.25 : 1;
  const cx = 50;
  return (
    <G>
      <Polygon points={pts([cx - 16 * s, 88, cx - 10 * s, 52, cx, 50, cx, 88])} fill={shade(color, 0.12)} />
      <Polygon points={pts([cx, 50, cx + 10 * s, 52, cx + 16 * s, 88, cx, 88])} fill={shade(color, -0.2)} />
      <Circle cx={cx} cy={50 - 13 * s} r={11 * s} fill={head} />
      {hood ? (
        <Polygon points={pts([cx - 13 * s, 44 - 10 * s, cx, 50 - 30 * s, cx + 13 * s, 44 - 10 * s, cx + 9 * s, 50 - 5 * s, cx - 9 * s, 50 - 5 * s])} fill={shade(color, -0.45)} opacity={0.9} />
      ) : (
        <Polygon points={pts([cx - 11 * s, 50 - 15 * s, cx, 50 - 27 * s, cx + 11 * s, 50 - 15 * s])} fill={shade(color, -0.1)} />
      )}
      <Circle cx={cx - 4 * s} cy={50 - 12 * s} r={1.6} fill="#2b2b2b" />
      <Circle cx={cx + 4 * s} cy={50 - 12 * s} r={1.6} fill="#2b2b2b" />
    </G>
  );
}

function Horse({ color }: { color: string }) {
  const c = "#8a5a3a";
  return (
    <G>
      <Rect x={26} y={78} width={5} height={14} fill={shade(c, -0.3)} />
      <Rect x={66} y={78} width={5} height={14} fill={shade(c, -0.3)} />
      <Polygon points={pts([20, 66, 76, 64, 78, 82, 22, 82])} fill={c} />
      <Polygon points={pts([20, 66, 76, 64, 50, 72])} fill={shade(c, 0.15)} />
      <Polygon points={pts([74, 66, 90, 48, 96, 54, 82, 72])} fill={shade(c, 0.05)} />
      <Rect x={36} y={62} width={26} height={6} fill={color} />
    </G>
  );
}

function Hull({ color, length = 1, ram = false, cannon = false, sail = true }: { color: string; length?: number; ram?: boolean; cannon?: boolean; sail?: boolean }) {
  const l = 36 * length;
  return (
    <G>
      <Polygon points={pts([50 - l, 70, 50 + l, 70, 50 + l - 10, 88, 50 - l + 10, 88])} fill={PAL.wood} />
      <Polygon points={pts([50 - l, 70, 50 + l, 70, 50, 76])} fill={shade(PAL.wood, 0.2)} />
      {ram && <Polygon points={pts([50 + l, 72, 50 + l + 10, 80, 50 + l - 6, 86])} fill="#8a969e" />}
      {cannon && <Rect x={54} y={58} width={26} height={8} rx={3} fill="#3c3c44" />}
      {sail && (
        <G>
          <Line x1={44} y1={70} x2={44} y2={18} stroke="#5a3e26" strokeWidth={3} />
          <Polygon points={pts([46, 20, 74, 58, 46, 58])} fill={color} />
          <Polygon points={pts([46, 20, 60, 39, 46, 58])} fill={shade(color, 0.2)} />
        </G>
      )}
    </G>
  );
}

export function UnitArt({ type, color, size }: { type: string; color: string; size: number }) {
  const metal = "#d9e0e6";
  switch (type) {
    case "rider":
      return (
        <Box size={size}>
          <Horse color={color} />
          <G transform="translate(0,-22) scale(1)">
            <Figure color={color} />
          </G>
        </Box>
      );
    case "knight":
      return (
        <Box size={size}>
          <Horse color={color} />
          <G transform="translate(0,-22)">
            <Figure color={color} head={metal} />
          </G>
          <Line x1={30} y1={60} x2={96} y2={18} stroke="#6b4a2e" strokeWidth={3} />
        </Box>
      );
    case "archer":
      return (
        <Box size={size}>
          <Figure color={color} />
          <Path d="M 72 30 Q 88 56 72 82" stroke="#6b4a2e" strokeWidth={3.5} fill="none" />
          <Line x1={72} y1={30} x2={72} y2={82} stroke="#eee" strokeWidth={1.2} />
        </Box>
      );
    case "defender":
      return (
        <Box size={size}>
          <Figure color={color} />
          <Polygon points={pts([54, 50, 82, 50, 82, 72, 68, 86, 54, 72])} fill={metal} />
          <Polygon points={pts([68, 50, 82, 50, 82, 72, 68, 86])} fill={shade(metal, -0.2)} />
          <Circle cx={68} cy={64} r={5} fill={color} />
        </Box>
      );
    case "swordsman":
      return (
        <Box size={size}>
          <Figure color={color} head={metal} />
          <Polygon points={pts([74, 14, 79, 14, 79, 70, 74, 70])} fill={metal} />
          <Rect x={68} y={68} width={17} height={4} fill="#6b4a2e" />
        </Box>
      );
    case "catapult":
      return (
        <Box size={size}>
          <Rect x={18} y={66} width={64} height={10} fill={PAL.wood} />
          <Circle cx={28} cy={82} r={8} fill={shade(PAL.wood, -0.35)} />
          <Circle cx={72} cy={82} r={8} fill={shade(PAL.wood, -0.35)} />
          <Line x1={36} y1={66} x2={74} y2={22} stroke={shade(PAL.wood, -0.15)} strokeWidth={5} />
          <Circle cx={76} cy={20} r={7} fill={shade(PAL.stone, -0.2)} />
          <Rect x={46} y={52} width={6} height={14} fill={color} />
        </Box>
      );
    case "giant":
      return (
        <Box size={size}>
          <G transform="translate(-12,-6) scale(1.24)">
            <Figure color={color} head="#c9b8a6" />
          </G>
          <Polygon points={pts([80, 30, 90, 26, 94, 70, 84, 72])} fill="#7a5a3a" />
        </Box>
      );
    case "mindBender":
      return (
        <Box size={size}>
          <Figure color={color} hood />
          <Line x1={76} y1={30} x2={76} y2={88} stroke="#6b4a2e" strokeWidth={3} />
          <Circle cx={76} cy={26} r={7} fill="#b18cff" />
          <Circle cx={74} cy={24} r={2.5} fill="#e8dcff" />
        </Box>
      );
    case "cloak":
      return (
        <Box size={size}>
          <Figure color={shade(color, -0.45)} hood head="#3a3a44" />
        </Box>
      );
    case "dagger":
      return (
        <Box size={size}>
          <Figure color={shade(color, -0.3)} hood />
          <Polygon points={pts([72, 46, 76, 46, 74, 30])} fill={metal} />
          <Rect x={70} y={46} width={8} height={4} fill="#6b4a2e" />
        </Box>
      );
    case "raft":
    case "boat":
    case "dinghy":
      return (
        <Box size={size}>
          <Hull color={color} length={0.8} sail={type !== "dinghy"} />
        </Box>
      );
    case "scout":
    case "ship":
      return (
        <Box size={size}>
          <Hull color={color} length={1} />
        </Box>
      );
    case "rammer":
    case "pirate":
      return (
        <Box size={size}>
          <Hull color={color} length={0.95} ram />
        </Box>
      );
    case "bomber":
    case "battleship":
      return (
        <Box size={size}>
          <Hull color={color} length={1} cannon sail={false} />
        </Box>
      );
    case "juggernaut":
      return (
        <Box size={size}>
          <Hull color={color} length={1.2} cannon ram />
        </Box>
      );
    default:
      // warrior and any unknown unit: a fighter with a short club-sword
      return (
        <Box size={size}>
          <Figure color={color} />
          <Polygon points={pts([72, 34, 77, 34, 77, 72, 72, 72])} fill={shade(PAL.wood, 0.1)} />
          <Rect x={67} y={70} width={15} height={4} fill="#5a3e26" />
        </Box>
      );
  }
}

/** The shard: Shardlands' currency and emblem. A cut gem in four facets. */
export function ShardIcon({ size, color = "#f6c453" }: { size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Polygon points={pts([50, 4, 86, 40, 50, 96, 14, 40])} fill={color} />
      <Polygon points={pts([50, 4, 50, 40, 14, 40])} fill={shade(color, 0.45)} />
      <Polygon points={pts([50, 4, 86, 40, 50, 40])} fill={shade(color, 0.15)} />
      <Polygon points={pts([14, 40, 50, 40, 50, 96])} fill={shade(color, -0.12)} />
      <Polygon points={pts([50, 40, 86, 40, 50, 96])} fill={shade(color, -0.32)} />
    </Svg>
  );
}

// ---------- clouds over undiscovered land ----------
export const CLOUD = { base: "#e6e1ef", lit: "#ffffff", blush: "#f4d6dd", shade: "#c8c2dc" };

/** a faceted puff: lower facets in shade, upper facets lit, one blush facet catching the dusk */
function Puff({ cx, cy, r, seed }: { cx: number; cy: number; r: number; seed: number }) {
  const k = 8;
  const p = Array.from({ length: k }, (_, i) => {
    const a = (i / k) * Math.PI * 2 + seed;
    const rr = r * (0.86 + 0.14 * Math.sin(seed * 7 + i * 2.3));
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82];
  });
  const fan = (i: number) => pts([cx, cy, ...p[i], ...p[(i + 1) % k]]);
  return (
    <G>
      <Polygon points={pts(p.flat())} fill={CLOUD.shade} />
      {p.map((_, i) => {
        const mid = Math.sin(((i + 0.5) / k) * Math.PI * 2 + seed);
        // sin < 0 is the upper half (SVG y grows down)
        const fill = mid < -0.55 ? CLOUD.lit : mid < 0 ? (i % 3 === 0 ? CLOUD.blush : CLOUD.base) : mid < 0.5 ? CLOUD.base : CLOUD.shade;
        return <Polygon key={i} points={fan(i)} fill={fill} />;
      })}
    </G>
  );
}

export function CloudArt({ x, y, size }: { x: number; y: number; size: number }) {
  // two or three big puffs per tile; the cloud colour itself is the board's background,
  // so neighbouring tiles merge into one continuous cloud bank without seams
  const n = 2 + Math.floor(hash(x, y, 40) * 2);
  const puffs = Array.from({ length: n }, (_, i) => ({
    cx: 18 + hash(x, y, 41 + i) * 64,
    cy: 20 + hash(x, y, 51 + i) * 60,
    r: 30 + hash(x, y, 61 + i) * 12,
    seed: hash(x, y, 71 + i) * 6.28,
  })).sort((a, b) => a.cy - b.cy);
  // drawn 36% larger than the tile so puffs spill over the coast of the known world
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
