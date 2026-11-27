/**
 * The setup screen's Players board: the seats laid out as their capitals lie on a sample world.
 * Each card shows the land around that seat's capital; the cards sit in a grid in the same relation
 * to each other as the capitals (north-west of, east of, ...). Grid squares nobody starts in lie
 * under clouds. The world comes from the engine (createGame with the chosen mode, world and size),
 * so the layout is one the game can really deal; it is not the world the game will be played on.
 */
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Polygon, Rect, Stop } from "react-native-svg";
import { Pop } from "@/components/anim";
import { TribeEmblem } from "@/components/art/Art";
import { PLAYER_COLORS, TERRAIN_COLOR, UI } from "@/components/game/theme";
import type { ModelSpec } from "@/logic/agents/types";
import type { Ratings } from "@/logic/arena/elo";
import type { Seat } from "@/logic/arena/record";
import type { MapType } from "@/logic/engine/mapgen";
import { createGame } from "@/logic/engine/state";
import type { GameMode, Terrain } from "@/logic/engine/types";
import { modelTagline } from "./ModelCard";

export type SampleWorld = {
  /** tiles per side */
  n: number;
  /** grid squares per side: the smallest square grid that seats everyone, ceil(sqrt(players)) */
  side: number;
  terrain: Terrain[];
  /** seat -> its capital tile */
  capitals: { x: number; y: number }[];
  /** seat -> the tiles of its starting territory (row-major indices) */
  territory: number[][];
  /** seat -> grid square (row-major in the side × side grid) */
  regionOf: number[];
};

/**
 * Seats the capitals on a side × side grid so that the grid keeps their relative positions: the
 * assignment with the smallest total distance between each capital and its square's centre (nearest
 * free square first, then swaps while one helps). The engine spreads capitals out but does not keep
 * to one per square, so two that share a quarter of the map still get a square each.
 */
export function seatGrid(capitals: { x: number; y: number }[], n: number, side: number): number[] {
  const span = n / side;
  const cost = (p: number, cell: number) => {
    const dx = capitals[p].x + 0.5 - ((cell % side) + 0.5) * span;
    const dy = capitals[p].y + 0.5 - (Math.floor(cell / side) + 0.5) * span;
    return dx * dx + dy * dy;
  };
  const at: (number | null)[] = Array(side * side).fill(null);
  capitals.forEach((_, p) => {
    let best = -1;
    for (let c = 0; c < at.length; c++) if (at[c] == null && (best < 0 || cost(p, c) < cost(p, best))) best = c;
    at[best] = p;
  });
  const total = (a: number, b: number) => (at[a] != null ? cost(at[a]!, a) : 0) + (at[b] != null ? cost(at[b]!, b) : 0);
  for (let improved = true, rounds = 0; improved && rounds < 50; rounds++) {
    improved = false;
    for (let a = 0; a < at.length; a++) {
      for (let b = a + 1; b < at.length; b++) {
        const before = total(a, b);
        [at[a], at[b]] = [at[b], at[a]];
        if (total(a, b) < before - 1e-9) improved = true;
        else [at[a], at[b]] = [at[b], at[a]];
      }
    }
  }
  const out: number[] = Array(capitals.length).fill(0);
  at.forEach((p, c) => {
    if (p != null) out[p] = c;
  });
  return out;
}

/** one world the engine could deal for these settings; null when the engine refuses them */
export function sampleWorld(o: {
  mapSize: number;
  players: number;
  mode: GameMode;
  mapType: MapType;
  seed: number;
}): SampleWorld | null {
  try {
    const s = createGame({ mapSize: o.mapSize, players: o.players, mode: o.mode, mapType: o.mapType, seed: o.seed });
    const n = Math.round(Math.sqrt(s.tiles.length));
    const side = Math.ceil(Math.sqrt(o.players));
    const capitals: SampleWorld["capitals"] = [];
    const territory: number[][] = [];
    for (let p = 0; p < o.players; p++) {
      const city = s.cities.find((c) => c.capital && c.owner === p);
      if (!city) return null;
      capitals.push({ x: city.x, y: city.y });
      territory.push(s.tiles.flatMap((t, i) => (t.territory === city.id ? [i] : [])));
    }
    return { n, side, terrain: s.tiles.map((t) => t.terrain), capitals, territory, regionOf: seatGrid(capitals, n, side) };
  } catch {
    return null;
  }
}

/** where a tile lies on the map, in words: "the north-west", "the east", "the centre" */
export function compass(at: { x: number; y: number }, n: number): string {
  const third = (v: number) => (v + 0.5 < n / 3 ? 0 : v + 0.5 > (2 * n) / 3 ? 2 : 1);
  const ns = ["north", "", "south"][third(at.y)];
  const we = ["west", "", "east"][third(at.x)];
  return `the ${ns && we ? `${ns}-${we}` : ns || we || "centre"}`;
}

/** the window of the map a seat's card shows: `span` tiles square, the capital a little above the middle */
export function windowFor(cap: { x: number; y: number }, n: number, span: number): { x0: number; y0: number } {
  const clamp = (v: number) => Math.max(0, Math.min(n - span, v));
  return { x0: clamp(cap.x + 0.5 - span / 2), y0: clamp(cap.y + 0.5 - span * 0.36) };
}

// ---------- drawing ----------

/** a stable pseudo-random number in [0, 1) per tile: facet shades never flicker between renders */
function noise(x: number, y: number, k = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/** hex colour moved toward white (t > 0) or black (t < 0) */
function shade(hex: string, t: number): string {
  const to = t > 0 ? 255 : 0;
  const a = Math.abs(t);
  const ch = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - a) + to * a);
  return `rgb(${ch(1)},${ch(3)},${ch(5)})`;
}

const CLOUD = "#e6eefa";

/** a square window of the world as low-poly tiles: two facets per tile, trees and peaks on top */
function RegionArt({
  world,
  x0,
  y0,
  cell,
  color,
  seat,
  clouded,
  px,
  scrimTop,
}: {
  world: SampleWorld;
  /** the window's top-left corner, in tiles */
  x0: number;
  y0: number;
  /** only to keep the gradient's id unique */
  cell: number;
  /** the seat's banner colour, when someone starts here */
  color?: string;
  seat?: number;
  clouded: boolean;
  px: number;
  /** the text sits at the top of the card (the capital is in the lower half), so the scrim does too */
  scrimTop?: boolean;
}) {
  const { n, side } = world;
  const span = n / side;
  const tiles: React.ReactNode[] = [];
  const tops: React.ReactNode[] = [];
  for (let y = Math.floor(y0); y < Math.min(n, Math.ceil(y0 + span)); y++) {
    for (let x = Math.floor(x0); x < Math.min(n, Math.ceil(x0 + span)); x++) {
      const k = `${x}-${y}`;
      if (clouded) {
        // cloud cover as in the game: every unseen tile is a pale facet pair
        const a = shade(CLOUD, 0.5 * noise(x, y));
        const b = shade(CLOUD, -0.06 * noise(x, y, 1));
        tiles.push(
          <Polygon key={`a${k}`} points={`${x},${y} ${x + 1},${y} ${x},${y + 1}`} fill={a} />,
          <Polygon key={`b${k}`} points={`${x + 1},${y} ${x + 1},${y + 1} ${x},${y + 1}`} fill={b} />,
        );
        continue;
      }
      const t = world.terrain[y * n + x];
      const base = TERRAIN_COLOR[t];
      const flip = noise(x, y, 2) > 0.5;
      const light = shade(base, 0.05 + 0.13 * noise(x, y));
      const dark = shade(base, -0.04 - 0.1 * noise(x, y, 1));
      // the diagonal alternates per tile, so the facets read as terrain and not as stripes
      tiles.push(
        <Polygon key={`a${k}`} points={flip ? `${x},${y} ${x + 1},${y} ${x + 1},${y + 1}` : `${x},${y} ${x + 1},${y} ${x},${y + 1}`} fill={light} />,
        <Polygon key={`b${k}`} points={flip ? `${x},${y} ${x + 1},${y + 1} ${x},${y + 1}` : `${x + 1},${y} ${x + 1},${y + 1} ${x},${y + 1}`} fill={dark} />,
      );
      if (t === "forest") {
        const j = 0.12 * (noise(x, y, 3) - 0.5);
        tops.push(
          <Polygon key={`tl${k}`} points={`${x + 0.5 + j},${y + 0.14} ${x + 0.5 + j},${y + 0.8} ${x + 0.2 + j},${y + 0.8}`} fill="#2f7d2a" />,
          <Polygon key={`tr${k}`} points={`${x + 0.5 + j},${y + 0.14} ${x + 0.8 + j},${y + 0.8} ${x + 0.5 + j},${y + 0.8}`} fill="#44a03a" />,
        );
      } else if (t === "mountain") {
        tops.push(
          <Polygon key={`ml${k}`} points={`${x + 0.5},${y + 0.1} ${x + 0.5},${y + 0.88} ${x + 0.06},${y + 0.88}`} fill="#6f7682" />,
          <Polygon key={`mr${k}`} points={`${x + 0.5},${y + 0.1} ${x + 0.94},${y + 0.88} ${x + 0.5},${y + 0.88}`} fill="#a9afba" />,
          <Polygon key={`ms${k}`} points={`${x + 0.5},${y + 0.1} ${x + 0.66},${y + 0.38} ${x + 0.5},${y + 0.46} ${x + 0.36},${y + 0.36}`} fill="#f4f8ff" />,
        );
      }
    }
  }
  const cap = seat != null ? world.capitals[seat] : undefined;
  const land = seat != null ? world.territory[seat] : [];
  const xs = land.map((i) => i % n);
  const ys = land.map((i) => Math.floor(i / n));
  return (
    <Svg width={px} height={px} viewBox={`${x0} ${y0} ${span} ${span}`} style={{ position: "absolute", left: 0, top: 0 }}>
      <Defs>
        <LinearGradient id={`scrim${cell}`} x1="0" y1={scrimTop ? "1" : "0"} x2="0" y2={scrimTop ? "0" : "1"}>
          <Stop offset="0.46" stopColor={UI.dusk} stopOpacity={0} />
          <Stop offset="0.72" stopColor={UI.dusk} stopOpacity={0.8} />
          <Stop offset="1" stopColor={UI.dusk} stopOpacity={0.96} />
        </LinearGradient>
      </Defs>
      {tiles}
      {tops}
      {!clouded && <Rect x={x0} y={y0} width={span} height={span} fill={`url(#scrim${cell})`} />}
      {cap && color && land.length > 0 && (
        // the capital's borders, dashed in the tribe's colour as on the game board
        <Rect
          x={Math.min(...xs) + 0.06}
          y={Math.min(...ys) + 0.06}
          width={Math.max(...xs) - Math.min(...xs) + 0.88}
          height={Math.max(...ys) - Math.min(...ys) + 0.88}
          fill={color}
          fillOpacity={0.16}
          stroke={color}
          strokeWidth={0.1}
          strokeDasharray="0.34 0.2"
        />
      )}
      {cap && color && (
        <>
          <Polygon points={`${cap.x + 0.22},${cap.y + 0.9} ${cap.x + 0.22},${cap.y + 0.5} ${cap.x + 0.78},${cap.y + 0.5} ${cap.x + 0.78},${cap.y + 0.9}`} fill="#f7f1e3" stroke={UI.dusk} strokeWidth={0.05} />
          <Polygon points={`${cap.x + 0.12},${cap.y + 0.52} ${cap.x + 0.5},${cap.y + 0.12} ${cap.x + 0.88},${cap.y + 0.52}`} fill={color} stroke={UI.dusk} strokeWidth={0.05} />
        </>
      )}
    </Svg>
  );
}

/** a seat's card on its region: emblem and move order on top, who plays and how strong below */
function SeatCard({
  i,
  seat,
  world,
  cell,
  px,
  models,
  elo,
  on,
  onPress,
}: {
  i: number;
  seat: Seat;
  world: SampleWorld | null;
  cell: number;
  px: number;
  models: ModelSpec[];
  elo?: number;
  on: boolean;
  onPress: () => void;
}) {
  const [hover, setHover] = useState(false);
  const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
  const model = seat.kind === "model" ? models.find((m) => m.id === seat.modelId) : undefined;
  const who = seat.kind === "human" ? seat.name : (model?.name ?? seat.modelId);
  const line = seat.kind === "human" ? "You play this tribe." : model ? modelTagline(model) : "";
  const big = px >= 168;
  const mid = px >= 112;
  const badge = big ? 34 : mid ? 26 : 20;
  const cap = world?.capitals[i];
  const where = world && cap ? compass(cap, world.n) : "";
  const span = world ? world.n / world.side : 1;
  const win = world && cap ? windowFor(cap, world.n, span) : { x0: 0, y0: 0 };
  // the text takes the bottom of the card; near the map's southern edge the capital sits low in its
  // window, and the text moves to the top so the city is never covered
  const infoTop = !!cap && (cap.y + 0.5 - win.y0) / span > 0.52;
  const info = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View
          style={{
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: UI.dusk,
            borderWidth: 2,
            borderColor: color,
            alignItems: "center",
            justifyContent: "center",
            marginRight: big ? 8 : 5,
          }}
        >
          {seat.clan ? (
            <TribeEmblem clan={seat.clan} size={badge - 10} />
          ) : (
            <Text style={{ color: UI.mist, fontWeight: "800", fontSize: badge * 0.46 }}>?</Text>
          )}
        </View>
        <Text style={{ color: UI.mist, fontWeight: "800", fontSize: big ? 16 : mid ? 12 : 10, flex: 1 }} numberOfLines={1}>
          {who}
        </Text>
        {mid && elo != null && <Text style={{ color: UI.gold, fontWeight: "800", fontSize: big ? 15 : 11, marginLeft: 4 }}>{elo}</Text>}
      </View>
      {big && !!line && (
        <Text style={{ color: UI.muted, fontSize: 11, lineHeight: 15, marginTop: 4 }} numberOfLines={2}>
          {line}
        </Text>
      )}
    </View>
  );
  // move order: seats take their turns in this order
  const order = (
    <View style={{ alignSelf: "flex-end", backgroundColor: color, borderRadius: 999, minWidth: big ? 22 : 16, paddingHorizontal: big ? 6 : 4, paddingVertical: 1, alignItems: "center" }}>
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: big ? 12 : 10 }}>{i + 1}</Text>
    </View>
  );
  return (
    <Pressable
      testID={`seat-${i}`}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${i === 0 ? "First to move" : `Seat ${i + 1}`}: ${who}${elo != null ? `, Elo ${elo}` : ""}${where ? `, starts in ${where}` : ""}`}
      style={{
        width: px,
        height: px,
        borderRadius: big ? 16 : 11,
        overflow: "hidden",
        backgroundColor: UI.panel,
        borderWidth: 2,
        borderColor: on ? UI.mist : hover ? color : "rgba(242,247,255,0.14)",
        transform: [{ translateY: on ? -2 : 0 }],
      }}
    >
      {world && <RegionArt world={world} x0={win.x0} y0={win.y0} cell={cell} color={color} seat={i} clouded={false} px={px - 4} scrimTop={infoTop} />}
      <View style={{ flex: 1, padding: big ? 10 : 6, justifyContent: "space-between" }}>
        {infoTop ? info : order}
        {infoTop ? order : info}
      </View>
    </Pressable>
  );
}

export function WorldBoard({
  seats,
  models,
  ratings,
  overall,
  world,
  dealKey,
  selected,
  onSelect,
}: {
  seats: Seat[];
  models: ModelSpec[];
  ratings: Ratings;
  overall: Ratings;
  world: SampleWorld | null;
  /** changes with every new deal: the cards land again */
  dealKey: string;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const [width, setWidth] = useState(400);
  const side = world?.side ?? Math.ceil(Math.sqrt(seats.length));
  const gap = side > 3 ? 4 : 6;
  const px = Math.floor((width - gap * (side - 1)) / side);
  const seatAt = new Map<number, number>();
  seats.forEach((_, i) => seatAt.set(world ? world.regionOf[i] : i, i));
  const elo = (seat: Seat) => {
    const key = seat.kind === "human" ? `human:${seat.profileId}` : `model:${seat.modelId}`;
    const r = ratings[key] ?? overall[key];
    return r ? Math.round(r.rating) : undefined;
  };
  return (
    <View>
      <View testID="world-board" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap", width: "100%" }}>
        {Array.from({ length: side * side }, (_, cell) => {
          const i = seatAt.get(cell);
          const last = cell % side === side - 1;
          return (
            <Pop key={`${dealKey}-${cell}`} force from={0.9} drop={12} delay={cell * 45} style={{ marginRight: last ? 0 : gap, marginBottom: gap }}>
              {i != null ? (
                <SeatCard
                  i={i}
                  seat={seats[i]}
                  world={world}
                  cell={cell}
                  px={px}
                  models={models}
                  elo={elo(seats[i])}
                  on={i === selected}
                  onPress={() => onSelect(i)}
                />
              ) : (
                <View style={{ width: px, height: px, borderRadius: px >= 168 ? 16 : 11, overflow: "hidden", backgroundColor: CLOUD, opacity: 0.82 }}>
                  {world && <RegionArt world={world} x0={(cell % side) * (world.n / side)} y0={Math.floor(cell / side) * (world.n / side)} cell={cell} clouded px={px} />}
                </View>
              )}
            </Pop>
          );
        })}
      </View>
      <Text style={{ color: UI.muted, fontSize: 12, lineHeight: 16, marginTop: 2, marginBottom: 6 }}>
        A sample world: each card shows the land around that capital. Every game deals a new map. Tap a
        card to choose who plays it.
      </Text>
    </View>
  );
}
