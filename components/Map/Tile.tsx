import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { BuildingArt, CityArt, CloudArt, ResourceArt, TerrainArt, UnitArt, VillageArt } from "@/components/art/Art";
import type { City, Tile as TileData, Unit } from "@/logic/engine/types";
import { PLAYER_COLORS, TERRAIN_COLOR, TILE as TILE_BASE, UI } from "@/components/game/theme";

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
  watchers,
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
  /** analysis: ids of the players who have explored this tile (dots), none = dimmed */
  watchers?: number[];
}) {
  const TILE = size ?? TILE_BASE;
  if (!explored) {
    // undiscovered land sits under clouds; they are drawn above the known tiles so they spill over the coast
    return (
      <Pressable
        onPress={() => onPress(x, y)}
        style={{
          position: "absolute",
          left: x * TILE,
          top: y * TILE,
          width: TILE,
          height: TILE,
          zIndex: 2,
        }}
      >
        <CloudArt x={x} y={y} size={TILE} />
      </Pressable>
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
          {/* the city art is drawn in the lower half of its box, so draw it 1.3x and lift it */}
          <View pointerEvents="none" style={{ position: "absolute", left: -TILE * 0.15, top: -TILE * 0.26, width: TILE * 1.3, height: TILE * 1.3 }}>
            <CityArt
              color={PLAYER_COLORS[city.owner % PLAYER_COLORS.length]}
              level={city.level}
              capital={city.capital}
              walls={city.walls}
              size={TILE * 1.3}
            />
          </View>
          <Text
            style={{
              position: "absolute",
              left: 2,
              top: 1,
              fontSize: Math.max(9, Math.round(TILE * 0.16)),
              fontWeight: "800",
              color: "white",
              zIndex: 1,
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
            // figures only fill the middle of their art box, so the box is larger than the tile
            left: city ? TILE * 0.22 : -TILE * 0.08,
            top: city ? TILE * 0.12 : -TILE * 0.2,
            width: (city ? 0.96 : 1.16) * TILE,
            height: (city ? 0.96 : 1.16) * TILE,
            opacity: unit.canMove || unit.canAttack ? 1 : 0.6,
          }}
        >
          <View
            style={{
              position: "absolute",
              left: (city ? 0.96 : 1.16) * TILE * 0.22,
              bottom: (city ? 0.96 : 1.16) * TILE * 0.08,
              width: (city ? 0.96 : 1.16) * TILE * 0.56,
              height: (city ? 0.96 : 1.16) * TILE * 0.14,
              borderRadius: TILE,
              backgroundColor: "#0004",
              borderWidth: 2,
              borderColor: unit.veteran ? "#ffd43b" : PLAYER_COLORS[unit.owner % PLAYER_COLORS.length],
            }}
          />
          <UnitArt type={unit.type} color={PLAYER_COLORS[unit.owner % PLAYER_COLORS.length]} size={(city ? 0.96 : 1.16) * TILE} />
          <Text
            style={{
              position: "absolute",
              right: city ? TILE * 0.02 : TILE * 0.1,
              bottom: city ? TILE * 0.06 : TILE * 0.22,
              fontSize: Math.max(9, Math.round(TILE * 0.16)),
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
      {watchers && watchers.length === 0 && (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#e6e1efb0" }} />
      )}
      {watchers && watchers.length > 0 && (
        <View pointerEvents="none" style={{ position: "absolute", right: 2, top: 2, flexDirection: "row", zIndex: 3 }}>
          {watchers.map((p) => (
            <View
              key={p}
              style={{
                width: Math.max(5, TILE * 0.13),
                height: Math.max(5, TILE * 0.13),
                borderRadius: TILE,
                marginLeft: 1,
                backgroundColor: PLAYER_COLORS[p % PLAYER_COLORS.length],
                borderWidth: 1,
                borderColor: "#ffffffcc",
              }}
            />
          ))}
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
