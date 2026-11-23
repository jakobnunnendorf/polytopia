import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import Capital from "./Capital";
import type { City, Tile as TileData, Unit } from "@/logic/engine/types";
import {
  BUILDING_GLYPH,
  FOG,
  PLAYER_COLORS,
  RESOURCE_GLYPH,
  TERRAIN_COLOR,
  TERRAIN_GLYPH,
  TILE,
  UNIT_GLYPH,
} from "@/components/game/theme";

export type Highlight = "selected" | "move" | "attack" | "action" | null;

export type Borders = { top: boolean; right: boolean; bottom: boolean; left: boolean };

const HIGHLIGHT_COLOR: Record<Exclude<Highlight, null>, string> = {
  selected: "#ffffff88",
  move: "#ffffff55",
  attack: "#ff3b3b77",
  action: "#ffd43b77",
};

function Tile({
  x,
  y,
  tile,
  explored,
  unit,
  city,
  territoryOwner,
  borders,
  highlight,
  onPress,
}: {
  x: number;
  y: number;
  tile: TileData;
  explored: boolean;
  unit: Unit | null;
  city: City | null;
  territoryOwner: number | null;
  borders: Borders;
  highlight: Highlight;
  onPress: (x: number, y: number) => void;
}) {
  if (!explored) {
    return (
      <Pressable
        onPress={() => onPress(x, y)}
        style={{
          position: "absolute",
          left: x * TILE,
          top: y * TILE,
          width: TILE,
          height: TILE,
          backgroundColor: FOG,
          borderWidth: 0.5,
          borderColor: "#2a3344",
        }}
      />
    );
  }
  const ownerColor =
    territoryOwner !== null ? PLAYER_COLORS[territoryOwner % PLAYER_COLORS.length] : null;
  const edge = (on: boolean) => (on && ownerColor ? 3 : 0);
  const glyph = tile.building
    ? (BUILDING_GLYPH[tile.building] ?? "🏠")
    : tile.ruin
      ? "🏛️"
      : tile.resource
        ? RESOURCE_GLYPH[tile.resource]
        : (TERRAIN_GLYPH[tile.terrain] ?? "");

  return (
    <Pressable
      testID={`tile-${x}-${y}`}
      onPress={() => onPress(x, y)}
      style={{
        position: "absolute",
        left: x * TILE,
        top: y * TILE,
        width: TILE,
        height: TILE,
        backgroundColor: TERRAIN_COLOR[tile.terrain],
        borderColor: "#00000014",
        borderWidth: 0.5,
      }}
    >
      {ownerColor && (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: ownerColor + "22",
            borderColor: ownerColor,
            borderStyle: "dashed",
            borderTopWidth: edge(borders.top),
            borderRightWidth: edge(borders.right),
            borderBottomWidth: edge(borders.bottom),
            borderLeftWidth: edge(borders.left),
          }}
        />
      )}
      {tile.road && (
        <View
          style={{
            position: "absolute",
            left: TILE / 2 - 3,
            top: TILE / 2 - 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: "#8a6d45",
          }}
        />
      )}
      {glyph ? (
        <Text style={{ position: "absolute", left: 3, top: 1, fontSize: 15 }}>{glyph}</Text>
      ) : null}
      {tile.village && !city && (
        <Text style={{ position: "absolute", right: 3, bottom: 1, fontSize: 18 }}>🛖</Text>
      )}
      {city && (
        <Capital
          color={PLAYER_COLORS[city.owner % PLAYER_COLORS.length]}
          level={city.level}
          capital={city.capital}
          walls={city.walls}
        />
      )}
      {unit && (
        <View
          style={{
            position: "absolute",
            right: 2,
            bottom: 2,
            minWidth: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: PLAYER_COLORS[unit.owner % PLAYER_COLORS.length],
            borderWidth: 2,
            borderColor: unit.veteran ? "#ffd43b" : "white",
            alignItems: "center",
            justifyContent: "center",
            opacity: unit.canMove || unit.canAttack ? 1 : 0.7,
          }}
        >
          <Text style={{ fontSize: 14 }}>{UNIT_GLYPH[unit.type] ?? "●"}</Text>
          <Text
            style={{
              position: "absolute",
              bottom: -7,
              fontSize: 9,
              fontWeight: "800",
              color: "white",
              backgroundColor: "#000a",
              paddingHorizontal: 2,
              borderRadius: 3,
            }}
          >
            {Math.ceil(unit.hp)}
          </Text>
        </View>
      )}
      {highlight && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: HIGHLIGHT_COLOR[highlight],
            borderWidth: highlight === "selected" ? 2 : 0,
            borderColor: "white",
          }}
        />
      )}
    </Pressable>
  );
}

export default memo(Tile);
