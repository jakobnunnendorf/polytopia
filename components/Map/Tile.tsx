import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, Text, View } from "react-native";
import { Pop, Pulse, reduceMotion } from "@/components/anim";
import { BuildingArt, CityArt, CloudArt, ResourceArt, TerrainArt, VillageArt } from "@/components/art/Art";
import type { City, Tile as TileData } from "@/logic/engine/types";
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

/** the cloud over a newly explored tile puffs up and fades away */
function CloudFade({ x, y, TILE }: { x: number; y: number; TILE: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }).start();
  }, [v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: TILE,
        height: TILE,
        zIndex: 4,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
      }}
    >
      <CloudArt x={x} y={y} size={TILE} />
    </Animated.View>
  );
}

const fill = { position: "absolute" as const, left: 0, top: 0, right: 0, bottom: 0 };

function Tile({
  x,
  y,
  tile,
  explored,
  city,
  territoryOwner,
  borders,
  highlight,
  onPress,
  size,
  watchers,
  animateReveal = false,
  showResource = true,
}: {
  x: number;
  y: number;
  tile: TileData;
  explored: boolean;
  city: City | null;
  territoryOwner: number | null;
  borders: Borders;
  highlight: Highlight;
  onPress: (x: number, y: number) => void;
  size?: number;
  /** analysis: ids of the players who have explored this tile (dots), none = dimmed */
  watchers?: number[];
  /** play the clouds-clearing animation when this tile becomes explored */
  animateReveal?: boolean;
  /** false while the viewer lacks the tech that reveals this resource (crops, metal) */
  showResource?: boolean;
}) {
  const TILE = size ?? TILE_BASE;
  // remember when this tile was revealed, so the clearing clouds survive quick re-renders
  const hiddenBefore = useRef(!explored);
  const revealAt = useRef(0);
  if (explored && hiddenBefore.current && animateReveal && !reduceMotion()) revealAt.current = Date.now();
  hiddenBefore.current = !explored;
  const clearing = Date.now() - revealAt.current < 700;
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
  ) : tile.resource && showResource ? (
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
      {tile.ice && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#cceeffaa",
            borderWidth: 1,
            borderColor: "#ffffffcc",
          }}
        />
      )}
      {tile.algae && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 2,
            top: 2,
            right: 2,
            bottom: 2,
            borderRadius: 6,
            backgroundColor: "#65a30dbb",
            borderWidth: 1,
            borderColor: "#a3e635",
          }}
        />
      )}
      {ownerColor && (
        <Pop key={`t${territoryOwner}`} from={0.92} style={fill}>
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
        </Pop>
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
      {!city && overlay && (
        <Pop key={tile.building ?? (tile.ruin ? "ruin" : showResource ? (tile.resource ?? "") : "")} style={fill}>
          {overlay}
        </Pop>
      )}
      {tile.village && !city && <VillageArt size={TILE} />}
      {city && (
        <>
          {/* the city art is drawn in the lower half of its box, so draw it 1.3x and lift it */}
          <Pop key={`${city.owner}-${city.level}`} from={0.6} style={{ position: "absolute", left: -TILE * 0.15, top: -TILE * 0.26, width: TILE * 1.3, height: TILE * 1.3 }}>
            <CityArt
              color={PLAYER_COLORS[city.owner % PLAYER_COLORS.length]}
              level={city.level}
              capital={city.capital}
              walls={city.walls}
              size={TILE * 1.3}
            />
          </Pop>
          {/* Polytopia-style city level + population progress bar */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              bottom: 1,
              zIndex: 2,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#0e1a30dd",
                borderRadius: 4,
                paddingHorizontal: 3,
                paddingVertical: 1,
                borderWidth: 1,
                borderColor: PLAYER_COLORS[city.owner % PLAYER_COLORS.length],
              }}
            >
              <Text
                style={{
                  fontSize: Math.max(8, Math.round(TILE * 0.15)),
                  fontWeight: "800",
                  color: city.capital ? "#ffd23f" : "#ffffff",
                  marginRight: 3,
                }}
              >
                {city.capital ? "♛" : ""}{city.level}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {Array.from({ length: Math.min(6, city.level + 1) }, (_, k) => (
                  <View
                    key={k}
                    style={{
                      width: Math.max(3, Math.round(TILE * 0.08)),
                      height: Math.max(3, Math.round(TILE * 0.08)),
                      borderRadius: 1,
                      marginLeft: 1,
                      backgroundColor: k < city.pop ? "#38bdf8" : "#334155",
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        </>
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
            <Pulse amount={0.18} period={1000}>
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
            </Pulse>
          )}
        </View>
      )}
      {clearing && <CloudFade x={x} y={y} TILE={TILE} />}
    </Pressable>
  );
}

export default memo(Tile);
