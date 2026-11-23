import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { UI } from "@/components/game/theme";
import { CLOUD } from "@/components/art/Art";
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
  reveal = false,
}: {
  state: GameState;
  viewer: number;
  /** show the whole map without clouds (game analysis) */
  reveal?: boolean;
  highlights: Record<string, Highlight>;
  onTilePress: (x: number, y: number) => void;
}) {
  const n = state.mapSize;
  const explored = state.players[viewer].explored;
  // fit the board to the screen width on phones; big maps scroll, tiles never get too small to tap
  const { width, height } = useWindowDimensions();
  const fit = Math.floor((Math.min(width, height * 0.9) - 24) / n);
  // zoom steps: 0 = fit the board on screen; each step is 25% bigger and the board scrolls
  const [zoom, setZoom] = useState(0);
  const TILE = Math.max(34, Math.min(88, Math.round(fit * 1.25 ** zoom)));

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

  const zoomButton = (label: string, d: number, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={d > 0 ? "Zoom in" : "Zoom out"}
      disabled={!enabled}
      onPress={() => setZoom((z) => z + d)}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: "#1b2846e0",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 8,
        opacity: enabled ? 1 : 0.4,
      }}
    >
      <Text style={{ color: UI.mist, fontSize: 20, fontWeight: "800", lineHeight: 22 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
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
            backgroundColor: CLOUD.base, // the cloud bank under undiscovered tiles
          }}
        >
          {state.tiles.map((tile, i) => {
            const x = i % n;
            const y = Math.floor(i / n);
            const seen = reveal || explored[i] === 1;
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
      <View style={{ position: "absolute", right: 12, top: 12 }}>
        {zoomButton("+", 1, TILE < 88)}
        {zoomButton("−", -1, zoom > 0 || TILE > fit)}
      </View>
    </View>
  );
}
