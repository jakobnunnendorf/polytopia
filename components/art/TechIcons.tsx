/**
 * Original two-facet icons for the 25 discoveries of the Shardlands lore wheel.
 * Drawn in one ink colour (lit facet = ink, shaded facet = ink at 60%) so they
 * sit on any node colour: gold (ready), sky (learned) or slate (locked).
 */
import React from "react";
import Svg, { Circle, G, Path, Polygon, Rect } from "react-native-svg";

const p = (a: number[]) => a.join(" ");

function Icon({ id, ink }: { id: string; ink: string }) {
  const s = { fill: ink };
  const d = { fill: ink, opacity: 0.6 };
  const stroke = { stroke: ink, strokeWidth: 7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (id) {
    // ---- beastcalling branch
    case "riding": // horse head
      return (
        <G>
          <Polygon points={p([30, 86, 36, 46, 56, 18, 64, 30, 80, 50, 72, 58, 58, 48, 52, 86])} {...s} />
          <Polygon points={p([56, 18, 50, 10, 46, 24])} {...d} />
          <Polygon points={p([36, 46, 56, 18, 46, 52])} {...d} />
        </G>
      );
    case "roads": // road vanishing to the horizon
      return (
        <G>
          <Polygon points={p([40, 14, 60, 14, 90, 88, 10, 88])} {...d} />
          <Rect x={47} y={22} width={6} height={12} {...s} />
          <Rect x={46} y={44} width={8} height={14} {...s} />
          <Rect x={45} y={68} width={10} height={16} {...s} />
        </G>
      );
    case "trade": // stacked coins
      return (
        <G>
          {[70, 54, 38].map((y, i) => (
            <G key={y}>
              <Rect x={22 + i * 4} y={y} width={56 - i * 8} height={14} rx={7} {...s} />
              <Rect x={22 + i * 4} y={y + 7} width={56 - i * 8} height={7} rx={3} {...d} />
            </G>
          ))}
          <Circle cx={50} cy={24} r={9} {...s} />
        </G>
      );
    case "freeSpirit": // bird in flight
      return (
        <G>
          <Polygon points={p([8, 40, 50, 58, 30, 70])} {...d} />
          <Polygon points={p([92, 28, 50, 58, 66, 70])} {...s} />
          <Polygon points={p([40, 62, 60, 62, 50, 80])} {...s} />
        </G>
      );
    case "chivalry": // lance with pennant
      return (
        <G>
          <Path d="M 18 88 L 76 16" {...stroke} />
          <Polygon points={p([76, 16, 88, 6, 84, 22])} {...s} />
          <Polygon points={p([60, 36, 86, 44, 66, 54])} {...d} />
        </G>
      );
    // ---- foraging branch
    case "organization": // berry cluster
      return (
        <G>
          {[
            [36, 58],
            [60, 56],
            [48, 76],
            [48, 40],
          ].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={14} {...(i % 2 ? d : s)} />
          ))}
          <Polygon points={p([48, 26, 62, 10, 66, 20])} {...s} />
        </G>
      );
    case "farming": // wheat sheaf
      return (
        <G>
          <Path d="M 50 90 L 50 30 M 50 90 L 30 36 M 50 90 L 70 36" {...stroke} strokeWidth={5} />
          {[
            [50, 22],
            [28, 30],
            [72, 30],
          ].map(([x, y], i) => (
            <G key={i}>
              <Polygon points={p([x, y - 14, x - 7, y, x, y + 10])} {...s} />
              <Polygon points={p([x, y - 14, x + 7, y, x, y + 10])} {...d} />
            </G>
          ))}
        </G>
      );
    case "construction": // brick wall
      return (
        <G>
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2].map((c) => (
              <Rect key={`${r}${c}`} x={12 + c * 26 + (r % 2 ? 13 : 0) - (r % 2 && c === 2 ? 13 : 0)} y={18 + r * 18} width={24} height={14} rx={2} {...((r + c) % 2 ? d : s)} />
            )),
          )}
        </G>
      );
    case "strategy": // shield
      return (
        <G>
          <Polygon points={p([50, 10, 84, 22, 80, 58, 50, 90])} {...d} />
          <Polygon points={p([50, 10, 16, 22, 20, 58, 50, 90])} {...s} />
        </G>
      );
    case "diplomacy": // sealed scroll
      return (
        <G>
          <Rect x={18} y={24} width={64} height={52} rx={6} {...d} />
          <Rect x={18} y={24} width={64} height={12} rx={6} {...s} />
          <Rect x={18} y={64} width={64} height={12} rx={6} {...s} />
          <Circle cx={50} cy={50} r={10} {...s} />
        </G>
      );
    // ---- cragwalking branch
    case "climbing": // peak with flag
      return (
        <G>
          <Polygon points={p([8, 88, 50, 26, 50, 88])} {...s} />
          <Polygon points={p([50, 26, 92, 88, 50, 88])} {...d} />
          <Path d="M 50 28 L 50 8" {...stroke} strokeWidth={4} />
          <Polygon points={p([52, 8, 70, 14, 52, 20])} {...s} />
        </G>
      );
    case "mining": // pickaxe
      return (
        <G>
          <Path d="M 30 84 L 66 30" {...stroke} />
          <Polygon points={p([20, 30, 50, 14, 86, 24, 62, 26])} {...s} />
          <Polygon points={p([62, 26, 86, 24, 90, 40])} {...d} />
        </G>
      );
    case "smithery": // anvil
      return (
        <G>
          <Polygon points={p([10, 30, 80, 30, 92, 40, 70, 50, 26, 50])} {...s} />
          <Polygon points={p([36, 50, 64, 50, 70, 74, 30, 74])} {...d} />
          <Rect x={22} y={74} width={56} height={12} rx={3} {...s} />
        </G>
      );
    case "meditation": // lotus
      return (
        <G>
          <Polygon points={p([50, 14, 64, 50, 50, 78, 36, 50])} {...s} />
          <Polygon points={p([12, 40, 46, 62, 50, 78, 22, 66])} {...d} />
          <Polygon points={p([88, 40, 54, 62, 50, 78, 78, 66])} {...d} />
          <Rect x={20} y={80} width={60} height={6} rx={3} {...s} />
        </G>
      );
    case "philosophy": // open book
      return (
        <G>
          <Polygon points={p([8, 24, 48, 32, 48, 84, 8, 76])} {...s} />
          <Polygon points={p([92, 24, 52, 32, 52, 84, 92, 76])} {...d} />
        </G>
      );
    // ---- tracking branch
    case "hunting": // spear head
      return (
        <G>
          <Path d="M 22 88 L 60 40" {...stroke} />
          <Polygon points={p([86, 12, 54, 32, 68, 46])} {...s} />
          <Polygon points={p([86, 12, 68, 46, 74, 40])} {...d} />
        </G>
      );
    case "archery": // bow and arrow
      return (
        <G>
          <Path d="M 30 10 Q 82 50 30 90" {...stroke} />
          <Path d="M 30 10 L 30 90" stroke={ink} strokeWidth={2} />
          <Path d="M 14 50 L 80 50" {...stroke} strokeWidth={4} />
          <Polygon points={p([92, 50, 76, 42, 76, 58])} {...s} />
        </G>
      );
    case "spiritualism": // sapling with glow
      return (
        <G>
          <Circle cx={50} cy={46} r={34} {...d} opacity={0.25} />
          <Path d="M 50 88 L 50 46" {...stroke} />
          <Polygon points={p([50, 50, 24, 36, 30, 22, 50, 40])} {...s} />
          <Polygon points={p([50, 46, 76, 30, 72, 18, 50, 36])} {...d} />
        </G>
      );
    case "forestry": // axe
      return (
        <G>
          <Path d="M 30 90 L 62 22" {...stroke} />
          <Polygon points={p([54, 22, 84, 12, 88, 46, 64, 40])} {...s} />
          <Polygon points={p([64, 40, 88, 46, 76, 30])} {...d} />
        </G>
      );
    case "mathematics": // set square and compass point
      return (
        <G>
          <Polygon points={p([12, 86, 12, 22, 76, 86])} {...d} />
          <Polygon points={p([24, 74, 24, 50, 48, 74])} fill="none" stroke={ink} strokeWidth={4} />
          <Path d="M 62 14 L 88 74 M 62 14 L 50 50" {...stroke} strokeWidth={5} />
          <Circle cx={62} cy={14} r={6} {...s} />
        </G>
      );
    // ---- fishing branch
    case "fishing": // fish
      return (
        <G>
          <Polygon points={p([10, 50, 44, 26, 72, 50])} {...s} />
          <Polygon points={p([10, 50, 72, 50, 44, 74])} {...d} />
          <Polygon points={p([70, 50, 92, 32, 86, 50, 92, 68])} {...s} />
        </G>
      );
    case "sailing": // sail over hull
      return (
        <G>
          <Polygon points={p([46, 10, 46, 66, 14, 66])} {...d} />
          <Polygon points={p([52, 14, 52, 66, 84, 66])} {...s} />
          <Polygon points={p([10, 72, 90, 72, 78, 88, 22, 88])} {...s} />
        </G>
      );
    case "navigation": // compass rose
      return (
        <G>
          <Polygon points={p([50, 6, 60, 50, 50, 94, 40, 50])} {...s} />
          <Polygon points={p([6, 50, 50, 40, 94, 50, 50, 60])} {...d} />
          <Circle cx={50} cy={50} r={7} {...s} />
        </G>
      );
    case "ramming": // armoured prow
      return (
        <G>
          <Polygon points={p([10, 40, 70, 40, 94, 60, 70, 78, 18, 78])} {...d} />
          <Polygon points={p([70, 40, 94, 60, 70, 60])} {...s} />
          <Rect x={10} y={52} width={56} height={6} {...s} />
        </G>
      );
    case "aquatism": // cresting wave
      return (
        <G>
          <Path d="M 8 70 Q 30 22 62 34 Q 46 40 50 56 Q 70 50 92 70 Z" {...s} />
          <Path d="M 8 82 Q 30 72 50 82 T 92 82" {...stroke} strokeWidth={5} opacity={0.6} />
        </G>
      );
    default:
      return <Circle cx={50} cy={50} r={20} {...s} />;
  }
}

export function TechIcon({ id, size, ink }: { id: string; size: number; ink: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Icon id={id} ink={ink} />
    </Svg>
  );
}
