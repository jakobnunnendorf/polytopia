import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { BuildingArt, CityArt, ResourceArt, TerrainArt, UnitArt, VillageArt } from "@/components/art/Art";
import type { City, Tile as TileData, Unit } from "@/logic/engine/types";
import { FOG, PLAYER_COLORS, TERRAIN_COLOR, TILE as TILE_BASE, UI } from "@/components/game/theme";

export type Highlight = "selected" | "move" | "attack" | "action" | null;

export type Borders = { top: boolean; right: boolean; bottom: boolean; left: boolean };

/** light washes only, so the art stays readable; the shape (ring, dot) carries the meaning */
const HIGHLIGHT_COLOR: Record<Exclude<Highlight, null>, string> = {
  selected: "transparent",
  move: "#5ec4d62e",
  attack: "#f2785c40",
  action: "#f6c45333",
};
const HIGHLIGHT_RING: Record<Exclude<Highlight, null>, string> = {
  selected: "#ffffff",
  move: "#bdeaf2aa",
  attack: "#f2785c",
  action: "#f6c453",
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
  size,
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
  size?: number;
}) {
  const TILE = size ?? TILE_BASE;
  if (!explored) {
    // unexplored land is dusk sea: no grid lines, so the known world reads as an island
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
        }}
      />
    );
  }
  const ownerColor =
    territoryOwner !== null ? PLAYER_COLORS[territoryOwner % PLAYER_COLORS.length] : null;
  const edge = (on: boolean) => (on && ownerColor ? 3 : 0);
  // a building replaces the resource it was built on; ruins sit on bare terrain
  const overlay = tile.building ? (
    <BuildingArt id={tile.building} size={TILE} />
  ) : tile.ruin ? (
    <BuildingArt id="ruin" size={TILE} />
  ) : tile.resource ? (
    <ResourceArt id={tile.resource} size={TILE} />
  ) : null;

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
        overflow: "hidden",
      }}
    >
      <TerrainArt terrain={tile.terrain} x={x} y={y} size={TILE} />
      {ownerColor && (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: ownerColor + "1a",
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
      {!city && overlay}
      {tile.village && !city && <VillageArt size={TILE} />}
      {city && (
        <>
          <CityArt
            color={PLAYER_COLORS[city.owner % PLAYER_COLORS.length]}
            level={city.level}
            capital={city.capital}
            walls={city.walls}
            size={TILE}
          />
          <Text
            style={{
              position: "absolute",
              left: 2,
              top: 1,
              fontSize: 9,
              fontWeight: "800",
              color: "white",
              backgroundColor: PLAYER_COLORS[city.owner % PLAYER_COLORS.length],
              paddingHorizontal: 3,
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            {city.capital ? "♛" : ""}
            {city.level}
          </Text>
        </>
      )}
      {unit && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: city ? TILE * 0.42 : TILE * 0.12,
            top: city ? TILE * 0.4 : TILE * 0.08,
            width: (city ? 0.6 : 0.88) * TILE,
            height: (city ? 0.6 : 0.88) * TILE,
            opacity: unit.canMove || unit.canAttack ? 1 : 0.6,
          }}
        >
          <View
            style={{
              position: "absolute",
              left: TILE * 0.14,
              bottom: TILE * 0.02,
              width: TILE * 0.6,
              height: TILE * 0.16,
              borderRadius: TILE,
              backgroundColor: "#0004",
              borderWidth: 2,
              borderColor: unit.veteran ? "#ffd43b" : PLAYER_COLORS[unit.owner % PLAYER_COLORS.length],
            }}
          />
          <UnitArt type={unit.type} color={PLAYER_COLORS[unit.owner % PLAYER_COLORS.length]} size={(city ? 0.6 : 0.88) * TILE} />
          <Text
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              fontSize: 9,
              fontWeight: "800",
              color: "white",
              backgroundColor: "#000a",
              paddingHorizontal: 2,
              borderRadius: 3,
              overflow: "hidden",
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
            borderWidth: highlight === "selected" || highlight === "attack" ? 3 : 1,
            borderColor: HIGHLIGHT_RING[highlight],
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {highlight === "move" && (
            <View
              style={{
                width: TILE * 0.24,
                height: TILE * 0.24,
                borderRadius: TILE,
                backgroundColor: "#ffffffd9",
                borderWidth: 2,
                borderColor: UI.sky,
              }}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}

export default memo(Tile);
