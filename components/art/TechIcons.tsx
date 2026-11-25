/**
 * Battle of Polytopia Tech Tree icons: each of the 25 technologies displays
 * the full-colour 3D low-poly sprite of the primary unit, resource, or building
 * it unlocks (matching The Battle of Polytopia's iconic tech wheel), with
 * full-colour low-poly isometric SVGs for Roads, Climbing, and Meditation.
 */
import React from "react";
import { Image, type ImageSourcePropType } from "react-native";
import Svg, { G, Polygon, Rect } from "react-native-svg";

const TECH_SPRITES: Record<string, ImageSourcePropType> = {
  // Riding branch
  riding: require("@/assets/sprites/rider.png"),
  trade: require("@/assets/sprites/market.png"),
  freeSpirit: require("@/assets/sprites/temple.png"),
  chivalry: require("@/assets/sprites/knight.png"),
  // Organization branch
  organization: require("@/assets/sprites/fruit.png"),
  farming: require("@/assets/sprites/farm.png"),
  construction: require("@/assets/sprites/windmill.png"),
  strategy: require("@/assets/sprites/defender.png"),
  diplomacy: require("@/assets/sprites/cloak.png"),
  // Climbing branch
  mining: require("@/assets/sprites/mine.png"),
  smithery: require("@/assets/sprites/swordsman.png"),
  meditation: require("@/assets/sprites/mountainTemple.png"),
  philosophy: require("@/assets/sprites/mindBender.png"),
  // Hunting branch
  hunting: require("@/assets/sprites/animal.png"),
  archery: require("@/assets/sprites/archer.png"),
  forestry: require("@/assets/sprites/lumberHut.png"),
  spiritualism: require("@/assets/sprites/forestTemple.png"),
  mathematics: require("@/assets/sprites/catapult.png"),
  // Fishing branch
  fishing: require("@/assets/sprites/fish.png"),
  sailing: require("@/assets/sprites/scout.png"),
  ramming: require("@/assets/sprites/rammer.png"),
  navigation: require("@/assets/sprites/bomber.png"),
  aquatism: require("@/assets/sprites/waterTemple.png"),
};

const p = (a: number[]) => a.join(" ");

function FullColorSvgIcon({ id }: { id: string }) {
  switch (id) {
    case "roads": // full-colour isometric cobblestone road & stone arch bridge
      return (
        <G>
          {/* emerald grass diamond */}
          <Polygon points={p([8, 62, 50, 40, 92, 62, 50, 84])} fill="#7ec845" />
          <Polygon points={p([8, 62, 50, 84, 50, 90, 8, 68])} fill="#5a992d" />
          <Polygon points={p([50, 84, 92, 62, 92, 68, 50, 90])} fill="#447a20" />
          {/* isometric cobblestone road strip */}
          <Polygon points={p([24, 71, 64, 49, 76, 55, 36, 77])} fill="#d4c7b0" />
          {/* individual sunlit cobbles */}
          <Polygon points={p([34, 67, 42, 63, 46, 65, 38, 69])} fill="#ede3d1" />
          <Polygon points={p([47, 60, 55, 56, 59, 58, 51, 62])} fill="#ede3d1" />
          <Polygon points={p([58, 54, 66, 50, 70, 52, 62, 56])} fill="#b8aa93" />
          {/* wooden signpost */}
          <Rect x={26} y={32} width={4} height={24} fill="#7a4c2a" />
          <Polygon points={p([24, 34, 44, 30, 48, 35, 44, 40, 24, 40])} fill="#d49b54" />
        </G>
      );
    case "climbing": // full-colour Polytopia snow-capped mountain peak with flag
      return (
        <G>
          <Polygon points={p([10, 84, 50, 18, 45, 84])} fill="#aeb4bf" />
          <Polygon points={p([45, 84, 50, 18, 58, 84])} fill="#8c929c" />
          <Polygon points={p([58, 84, 50, 18, 90, 84])} fill="#626770" />
          {/* crisp zig-zag snow cap */}
          <Polygon points={p([35, 44, 50, 18, 48, 47, 41, 40])} fill="#ffffff" />
          <Polygon points={p([48, 47, 50, 18, 56, 42, 53, 48])} fill="#e6f0fa" />
          <Polygon points={p([56, 42, 50, 18, 65, 44, 59, 40])} fill="#c9dcf0" />
          {/* golden summit flag */}
          <Rect x={49} y={6} width={2.5} height={14} fill="#5c3d22" />
          <Polygon points={p([51.5, 6, 68, 11, 51.5, 16])} fill="#2589f5" />
        </G>
      );
    case "meditation": // full-colour isometric Mountain Temple sanctuary
      return (
        <G>
          <Polygon points={p([12, 82, 50, 64, 88, 82, 50, 96])} fill="#8c929c" />
          <Rect x={20} y={72} width={60} height={10} fill="#a8aeb8" />
          <Rect x={26} y={62} width={48} height={10} fill="#cfd5dd" />
          {[32, 46, 60].map((px) => (
            <G key={px}>
              <Rect x={px} y={40} width={5} height={22} fill="#f2efe8" />
              <Rect x={px + 5} y={40} width={3} height={22} fill="#b8b3a8" />
            </G>
          ))}
          <Polygon points={p([20, 42, 50, 18, 50, 42])} fill="#d9e4f0" />
          <Polygon points={p([50, 18, 80, 42, 50, 42])} fill="#99adc4" />
          <Polygon points={p([45, 20, 50, 8, 55, 20])} fill="#ffd23f" />
        </G>
      );
    default:
      return <Polygon points={p([50, 16, 84, 50, 50, 84, 16, 50])} fill="#ffd23f" />;
  }
}

export function TechIcon({ id, size, ink }: { id: string; size: number; ink?: string }) {
  // Locked tech nodes pass a muted ink colour; dim slightly like Polytopia's locked nodes
  const locked = ink === "#9bb6db" || ink === "#9db0cf";
  const sprite = TECH_SPRITES[id];
  if (sprite) {
    return (
      <Image
        source={sprite}
        resizeMode="contain"
        style={{
          width: size * 1.18,
          height: size * 1.18,
          opacity: locked ? 0.52 : 1,
        }}
      />
    );
  }
  return (
    <Svg width={size * 1.12} height={size * 1.12} viewBox="0 0 100 100" opacity={locked ? 0.55 : 1}>
      <FullColorSvgIcon id={id} />
    </Svg>
  );
}
