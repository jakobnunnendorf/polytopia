import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { UI } from "@/components/game/theme";
import { CLOUD } from "@/components/art/Art";
import Tile, { ROAD_DIRS, type Highlight } from "./Tile";
import { FxLayer, UnitSprite, diffEvents, type Fx, type Lunge } from "./Units";
import { AnimateNew, useMountedOnce } from "@/components/anim";
import type { City, GameState, Unit } from "@/logic/engine/types";
import { resourceVisible } from "@/logic/engine/state";

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
  seenBy,
  territoryFocus = false,
  activeUnits,
}: {
  /** on a human's turn: ids of the current player's units that still have a unit action;
   *  their other units are drawn as spent even if a move or attack flag is still set */
  activeUnits?: Set<number>;
  state: GameState;
  viewer: number;
  /** show the whole map without clouds (game analysis) */
  reveal?: boolean;
  /** with reveal: mark each tile with the colours of the players who have explored it */
  seenBy?: boolean;
  /** territory view: owners' colours filled in strongly, unclaimed land greyed (no explored-by dots) */
  territoryFocus?: boolean;
  highlights: Record<string, Highlight>;
  onTilePress: (x: number, y: number) => void;
}) {
  const n = state.mapSize;
  const explored = state.players[viewer].explored;
  // fit the whole board into the space this map really gets (between HUD and tray);
  // before the first layout, guess from the window
  const { width, height } = useWindowDimensions();
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const fit = Math.max(12, Math.floor((Math.min(area?.w ?? width, area?.h ?? height * 0.6) - 26) / n));
  // zoom steps: 0 = the whole board fits; each step is 25% bigger and the board scrolls
  const [zoom, setZoom] = useState(0);
  const TILE = zoom <= 0 ? fit : Math.min(96, Math.round(fit * 1.25 ** zoom));

  const { unitAt, cityById, ownerOfTile, roadDirs, lighthouseFinders } = useMemo(() => {
    const unitAt = new globalThis.Map<number, Unit>();
    for (const u of state.units) unitAt.set(u.y * n + u.x, u);
    const cityById = new globalThis.Map<number, City>();
    for (const c of state.cities) cityById.set(c.id, c);
    const ownerOfTile = state.tiles.map((t) =>
      t.territory !== null ? (cityById.get(t.territory)?.owner ?? null) : null,
    );
    // roads: a tile on the road network (road, city) links to each network neighbour, as long as
    // one of the two is a real road (two cities side by side show no road)
    const net = state.tiles.map((t) => t.road || t.cityId !== null);
    const roadDirs = state.tiles.map((t, i) => {
      if (!net[i]) return 0;
      const x = i % state.mapSize;
      const y = Math.floor(i / state.mapSize);
      let bits = 0;
      ROAD_DIRS.forEach(([dx, dy], k) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.mapSize || ny >= state.mapSize) return;
        const j = ny * state.mapSize + nx;
        if (!net[j] || !(t.road || state.tiles[j].road)) return;
        // a diagonal only where no straight two-step path already turns that corner (no lattices)
        if (dx !== 0 && dy !== 0 && (net[y * state.mapSize + nx] || net[ny * state.mapSize + x])) return;
        bits |= 1 << k;
      });
      return bits;
    });
    const lighthouseFinders = new globalThis.Map<number, number[]>();
    state.tiles.forEach((t, i) => {
      if (t.lighthouse) {
        lighthouseFinders.set(
          i,
          state.players.filter((p) => p.lighthouses.includes(i)).map((p) => p.id),
        );
      }
    });
    return { unitAt, cityById, ownerOfTile, roadDirs, lighthouseFinders };
  }, [state, n]);

  // animations: compare with the previous state seen by the same viewer
  const ready = useMountedOnce();
  const prev = useRef<{ state: GameState; viewer: number; reveal: boolean } | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  const [lunges, setLunges] = useState<Record<number, Lunge>>({});
  const sameView = !!prev.current && prev.current.viewer === viewer && prev.current.reveal === reveal;
  const outer = useRef<ScrollView>(null);
  const inner = useRef<ScrollView>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = { state, viewer, reveal };
    if (!p || p.state === state || p.viewer !== viewer || p.reveal !== reveal) return;
    // a big jump (replay scrubbing, resume) is not animated
    if (Math.abs(state.log.length - p.state.log.length) > 3 && state.turn !== p.state.turn) return;
    const visible = (i: number) => reveal || state.players[viewer].explored[i] === 1;
    const ev = diffEvents(p.state, state, visible);
    if (ev.fx.length) {
      setFx((cur) => [...cur.slice(-24), ...ev.fx]);
      const ids = new Set(ev.fx.map((f) => f.id));
      setTimeout(() => setFx((cur) => cur.filter((f) => !ids.has(f.id))), 1200);
    }
    if (Object.keys(ev.lunges).length) setLunges((cur) => ({ ...cur, ...ev.lunges }));
    // camera: when zoomed in, pan to where the action is
    if (ev.focus && zoom > 0 && p.state.current !== viewer) {
      outer.current?.scrollTo({ y: Math.max(0, ev.focus.y * TILE - 120), animated: true });
      inner.current?.scrollTo({ x: Math.max(0, ev.focus.x * TILE - 120), animated: true });
    }
  }, [state, viewer, reveal]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <View style={{ flex: 1 }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
    <AnimateNew.Provider value={ready && sameView}>
    <ScrollView
      ref={outer}
      testID="map-component"
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 12 }}
    >
      <ScrollView ref={inner} horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
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
            const watchers = reveal && seenBy && !territoryFocus ? state.players.filter((p) => p.explored[i] === 1).map((p) => p.id) : undefined;
            const o = ownerOfTile[i];
            return (
              <Tile
                key={i}
                x={x}
                y={y}
                tile={tile}
                explored={seen}
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
                watchers={watchers}
                animateReveal={ready && sameView}
                showResource={reveal || !tile.resource || resourceVisible(state, viewer, tile.resource)}
                ruinThroughClouds={!seen && tile.ruin && state.players[viewer].clan === "elyrion"}
                territoryFocus={territoryFocus}
                roadDirs={seen ? roadDirs[i] : 0}
                lighthouseFinders={tile.lighthouse ? lighthouseFinders.get(i) : undefined}
              />
            );
          })}
          {/* units above the tiles, below the clouds (zIndex 2), so they can slide */}
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 1 }}>
            {state.units
              .filter((u) => reveal || explored[u.y * n + u.x] === 1)
              .map((u) => (
                <UnitSprite
                  key={u.id}
                  unit={u}
                  clan={state.players[u.owner]?.clan}
                  inCity={state.tiles[u.y * n + u.x].cityId !== null}
                  TILE={TILE}
                  selected={highlights[`${u.x},${u.y}`] === "selected"}
                  lunge={lunges[u.id]}
                  spent={
                    activeUnits && u.owner === state.current ? !activeUnits.has(u.id) : !(u.canMove || u.canAttack)
                  }
                />
              ))}
          </View>
          <FxLayer fx={fx} TILE={TILE} clans={Object.fromEntries(state.players.map((p) => [p.id, p.clan]))} />
        </View>
      </ScrollView>
    </ScrollView>
    </AnimateNew.Provider>
      <View style={{ position: "absolute", right: 12, top: 12 }}>
        {zoomButton("+", 1, TILE < 96)}
        {zoomButton("−", -1, zoom > 0)}
      </View>
    </View>
  );
}
