import React, { useMemo } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import Tile, { type Highlight } from "./Tile";
import type { City, GameState, Unit } from "@/logic/engine/types";

/**
 * Renders the map from one player's point of view (fog of war applies).
 * `highlights` maps "x,y" to a highlight kind for move/attack targets.
 */
export default function Map({
  state,
  viewer,
  highlights,
  onTilePress,
}: {
  state: GameState;
  viewer: number;
  highlights: Record<string, Highlight>;
  onTilePress: (x: number, y: number) => void;
}) {
  const n = state.mapSize;
  const explored = state.players[viewer].explored;
  // fit the board to the screen width on phones; big maps scroll, tiles never get too small to tap
  const { width, height } = useWindowDimensions();
  const TILE = Math.max(34, Math.min(60, Math.floor((Math.min(width, height * 0.9) - 24) / n)));

  const { unitAt, cityById, ownerOfTile } = useMemo(() => {
    const unitAt = new globalThis.Map<number, Unit>();
    for (const u of state.units) unitAt.set(u.y * n + u.x, u);
    const cityById = new globalThis.Map<number, City>();
    for (const c of state.cities) cityById.set(c.id, c);
    const ownerOfTile = state.tiles.map((t) =>
      t.territory !== null ? (cityById.get(t.territory)?.owner ?? null) : null,
    );
    return { unitAt, cityById, ownerOfTile };
  }, [state, n]);

  const owner = (x: number, y: number) =>
    x < 0 || y < 0 || x >= n || y >= n ? null : ownerOfTile[y * n + x];

  return (
    <ScrollView
      testID="map-component"
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 12 }}
    >
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
        <View
          style={{
            width: n * TILE,
            height: n * TILE,
            borderRadius: 14,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: "#ffffff2e", // faint edge of the world
          }}
        >
          {state.tiles.map((tile, i) => {
            const x = i % n;
            const y = Math.floor(i / n);
            const seen = explored[i] === 1;
            const o = ownerOfTile[i];
            return (
              <Tile
                key={i}
                x={x}
                y={y}
                tile={tile}
                explored={seen}
                unit={seen ? (unitAt.get(i) ?? null) : null}
                city={tile.cityId !== null ? (cityById.get(tile.cityId) ?? null) : null}
                territoryOwner={o}
                borders={{
                  top: owner(x, y - 1) !== o,
                  right: owner(x + 1, y) !== o,
                  bottom: owner(x, y + 1) !== o,
                  left: owner(x - 1, y) !== o,
                }}
                highlight={highlights[`${x},${y}`] ?? null}
                onPress={onTilePress}
                size={TILE}
              />
            );
          })}
        </View>
      </ScrollView>
    </ScrollView>
  );
}
