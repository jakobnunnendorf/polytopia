/**
 * A still game scene for the lecture notes (lecture-notes/build.el): a small board drawn with
 * the game's own tile and unit components, plus a label per tile and a path.
 *
 * The scene is JSON in the URL fragment, base64url-encoded:
 *   { rows: ["..FFF..V", ...],            // . field, F forest, M mountain, ~ water, V village
 *     labels?: [["0.73", null, ...], ...], // one string or null per tile
 *     path?: [[0, 5], [2, 3], ...],        // tiles joined by a line, in order
 *     unit?: { type: "rider", x: 0, y: 5 },
 *     axes?: true,                         // column numbers above, row numbers on the left
 *     marks?: [                            // arrows and words that tie the picture to the code
 *       { kind: "across", text: "width = 8" },                  // over all columns, above the map
 *       { kind: "down", text: "height = 6" },                   // over all rows, left of the map
 *       { kind: "beside", x: 7, y: 0, text: "village" },        // to one tile, from the right
 *       { kind: "below", x: 0, y: 5, text: "the rider" },       // to one tile, from below
 *       { kind: "outlined", tiles: [[2, 0], ...], text?: "" } ], // these tiles, tinted
 *     margin?: [top, right, bottom, left], // room around the map for the marks, in pixels
 *                                          // (worked out by lecture-notes/build.el)
 *     tile?: 64 }                          // tile size in pixels
 * Web only. The tile and unit components call the rules engine while drawing, so the page
 * waits for the engine like every other page (app/_layout.tsx).
 */
import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import Svg, { Circle, G, Line, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";
import Tile from "@/components/Map/Tile";
import { UnitSprite } from "@/components/Map/Units";
import { AnimateNew } from "@/components/anim";
import type { Terrain, Tile as TileData, Unit } from "@/logic/engine/types";

type Mark =
  | { kind: "across"; text: string }
  | { kind: "down"; text: string }
  | { kind: "beside"; x: number; y: number; text: string }
  | { kind: "below"; x: number; y: number; text: string }
  | { kind: "outlined"; tiles: [number, number][]; text?: string };

type Scene = {
  rows: string[];
  labels?: (string | null)[][];
  path?: [number, number][];
  unit?: { type: string; x: number; y: number };
  axes?: boolean;
  marks?: Mark[];
  margin?: [number, number, number, number];
  tile?: number;
};

const MARK_COLOR = "#133f52";
// the room an axis and a spanning arrow take; lecture-notes/build.el sizes the margin with the same figures
const AXIS_TOP = 20;
const AXIS_LEFT = 22;

function Arrow({ from, to, both }: { from: [number, number]; to: [number, number]; both?: boolean }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dx = (x2 - x1) / length;
  const dy = (y2 - y1) / length;
  const head = (x: number, y: number, ux: number, uy: number) =>
    `${x},${y} ${x - 10 * ux + 4.5 * uy},${y - 10 * uy - 4.5 * ux} ${x - 10 * ux - 4.5 * uy},${y - 10 * uy + 4.5 * ux}`;
  return (
    <G>
      <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={5} strokeLinecap="round" />
      <Line x1={x1 + (both ? 6 * dx : 0)} y1={y1 + (both ? 6 * dy : 0)} x2={x2 - 6 * dx} y2={y2 - 6 * dy} stroke={MARK_COLOR} strokeWidth={2} />
      <Polygon points={head(x2, y2, dx, dy)} fill={MARK_COLOR} stroke="#ffffff" strokeWidth={1} />
      {both ? <Polygon points={head(x1, y1, -dx, -dy)} fill={MARK_COLOR} stroke="#ffffff" strokeWidth={1} /> : null}
    </G>
  );
}

function Words({ x, y, anchor, turned, children }: { x: number; y: number; anchor: "start" | "middle"; turned?: boolean; children: string }) {
  return (
    <SvgText
      x={x}
      y={y}
      textAnchor={anchor}
      fontFamily="monospace"
      fontSize={13}
      fontWeight="700"
      fill={MARK_COLOR}
      transform={turned ? `rotate(-90 ${x} ${y})` : undefined}
    >
      {children}
    </SvgText>
  );
}

/** The marks, drawn over the board and in the margin around it. (left, top) is the board's corner. */
function Marks({ scene, T, left, top }: { scene: Scene; T: number; left: number; top: number }) {
  const rows = scene.rows.length;
  const cols = scene.rows[0].length;
  const right = left + cols * T;
  const bottom = top + rows * T;
  const axisTop = scene.axes ? AXIS_TOP : 0;
  const axisLeft = scene.axes ? AXIS_LEFT : 0;
  const outline = (x: number, y: number, key: string, tinted = false) => (
    <G key={key}>
      <Rect x={left + x * T + 3} y={top + y * T + 3} width={T - 6} height={T - 6} rx={9} fill={tinted ? "#ffffff" : "none"} fillOpacity={0.3} stroke="#ffffff" strokeWidth={5} />
      <Rect x={left + x * T + 3} y={top + y * T + 3} width={T - 6} height={T - 6} rx={9} fill="none" stroke={MARK_COLOR} strokeWidth={2.5} />
    </G>
  );
  const beside = (x: number, y: number, text: string, key: string) => {
    const cy = top + (y + 0.5) * T;
    return (
      <G key={key}>
        <Arrow from={[right + 34, cy]} to={[left + (x + 1) * T + 1, cy]} />
        <Words x={right + 40} y={cy + 4.5} anchor="start">{text}</Words>
      </G>
    );
  };
  return (
    <>
      {scene.axes
        ? [
            ...Array.from({ length: cols }, (_, x) => (
              <SvgText key={`x${x}`} x={left + (x + 0.5) * T} y={top - 6} textAnchor="middle" fontFamily="monospace" fontSize={12} fill="#555555">
                {String(x)}
              </SvgText>
            )),
            ...Array.from({ length: rows }, (_, y) => (
              <SvgText key={`y${y}`} x={left - 8} y={top + (y + 0.5) * T + 4} textAnchor="end" fontFamily="monospace" fontSize={12} fill="#555555">
                {String(y)}
              </SvgText>
            )),
          ]
        : null}
      {(scene.marks ?? []).map((mark, i) => {
        const key = `mark${i}`;
        if (mark.kind === "across") {
          const y = top - axisTop - 10;
          return (
            <G key={key}>
              <Arrow from={[left + 1, y]} to={[right - 1, y]} both />
              <Words x={(left + right) / 2} y={y - 8} anchor="middle">{mark.text}</Words>
            </G>
          );
        }
        if (mark.kind === "down") {
          const x = left - axisLeft - 10;
          return (
            <G key={key}>
              <Arrow from={[x, top + 1]} to={[x, bottom - 1]} both />
              <Words x={x - 8} y={(top + bottom) / 2} anchor="middle" turned>{mark.text}</Words>
            </G>
          );
        }
        if (mark.kind === "beside") {
          return (
            <G key={key}>
              {outline(mark.x, mark.y, "tile")}
              {beside(mark.x, mark.y, mark.text, "words")}
            </G>
          );
        }
        if (mark.kind === "below") {
          const cx = left + (mark.x + 0.5) * T;
          return (
            <G key={key}>
              {outline(mark.x, mark.y, "tile")}
              <Arrow from={[cx, bottom + 20]} to={[cx, top + (mark.y + 1) * T + 1]} />
              <Words x={left + mark.x * T + 2} y={bottom + 35} anchor="start">{mark.text}</Words>
            </G>
          );
        }
        // outlined: the words point at the tile furthest right (the topmost of those)
        const pointed = mark.tiles.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a), mark.tiles[0]);
        return (
          <G key={key}>
            {mark.tiles.map(([x, y]) => outline(x, y, `${x},${y}`, true))}
            {mark.text && pointed ? beside(pointed[0], pointed[1], mark.text, "words") : null}
          </G>
        );
      })}
    </>
  );
}

const TERRAIN: Record<string, Terrain> = { ".": "field", V: "field", F: "forest", M: "mountain", "~": "water" };

function tileOf(ch: string): TileData {
  return {
    terrain: TERRAIN[ch] ?? "field",
    resource: null,
    building: null,
    buildingLevel: 0,
    builtTurn: 0,
    road: false,
    cityId: null,
    village: ch === "V",
    ruin: false,
    lighthouse: false,
    territory: null,
  } as TileData;
}

function readScene(): Scene | string {
  if (Platform.OS !== "web") return "Scenes are drawn in the web build only.";
  try {
    const raw = globalThis.location.hash.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    if (!raw) return "No scene given (expected JSON, base64url-encoded, after the #).";
    return JSON.parse(globalThis.atob(raw)) as Scene;
  } catch (e) {
    return `The scene could not be read: ${(e as Error).message}`;
  }
}

const NO_BORDERS = { top: false, right: false, bottom: false, left: false };
const PATH_COLOR = "#c60f0f";

export default function ScenePage() {
  const [scene, setScene] = useState<Scene | string | null>(null);
  useEffect(() => setScene(readScene()), []);
  if (scene === null) return null;
  if (typeof scene === "string") return <Text style={{ padding: 16 }}>{scene}</Text>;

  const T = scene.tile ?? 64;
  const rows = scene.rows.length;
  const cols = scene.rows[0].length;
  const centre = ([x, y]: [number, number]) => `${(x + 0.5) * T},${(y + 0.5) * T}`;
  const unit: Unit | null = scene.unit
    ? ({
        id: 1,
        type: scene.unit.type,
        carried: null,
        owner: 0,
        x: scene.unit.x,
        y: scene.unit.y,
        hp: 10,
        maxHp: 10,
        kills: 0,
        veteran: false,
        homeCity: null,
        canMove: true,
        canAttack: true,
        moved: false,
        attacked: false,
        done: false,
      } as Unit)
    : null;

  const [marginTop, marginRight, marginBottom, marginLeft] = scene.margin ?? [0, 0, 0, 0];
  const fullWidth = marginLeft + cols * T + marginRight;
  const fullHeight = marginTop + rows * T + marginBottom;

  return (
    <View style={{ padding: 8, backgroundColor: "#ffffff", alignSelf: "flex-start" }}>
     <View style={{ width: fullWidth, height: fullHeight }}>
      <View
        testID="scene"
        style={{ position: "absolute", left: marginLeft, top: marginTop, width: cols * T, height: rows * T, borderRadius: 14, overflow: "hidden" }}
      >
        {scene.rows.flatMap((row, y) =>
          [...row].map((ch, x) => (
            <Tile
              key={`${x},${y}`}
              x={x}
              y={y}
              tile={tileOf(ch)}
              explored
              city={null}
              territoryOwner={null}
              borders={NO_BORDERS}
              highlight={null}
              onPress={() => {}}
              size={T}
            />
          )),
        )}
        {scene.path && scene.path.length > 0 ? (
          <Svg width={cols * T} height={rows * T} style={{ position: "absolute", left: 0, top: 0, zIndex: 1 }}>
            <Polyline
              points={scene.path.map(centre).join(" ")}
              fill="none"
              stroke="#ffffff"
              strokeWidth={T * 0.13}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Polyline
              points={scene.path.map(centre).join(" ")}
              fill="none"
              stroke={PATH_COLOR}
              strokeWidth={T * 0.07}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {scene.path.map(([x, y], i) => (
              <Circle key={i} cx={(x + 0.5) * T} cy={(y + 0.5) * T} r={T * 0.09} fill={PATH_COLOR} stroke="#ffffff" strokeWidth={2} />
            ))}
          </Svg>
        ) : null}
        {unit ? (
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 1 }}>
            {/* a still picture: the unit is drawn as it stands, without its pop-in animation */}
            <AnimateNew.Provider value={false}>
              <UnitSprite unit={unit} inCity={false} TILE={T} selected={false} />
            </AnimateNew.Provider>
          </View>
        ) : null}
        {scene.labels?.flatMap((row, y) =>
          row.map((label, x) =>
            label === null ? null : (
              <View
                key={`label ${x},${y}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: x * T,
                  top: (y + 1) * T - T * 0.36,
                  width: T,
                  alignItems: "center",
                  zIndex: 3,
                }}
              >
                <Text
                  style={{
                    fontFamily: "monospace",
                    fontSize: T * 0.22,
                    fontWeight: "700",
                    color: "#1c2b3a",
                    backgroundColor: "#ffffffd9",
                    borderRadius: T * 0.08,
                    paddingHorizontal: T * 0.06,
                    overflow: "hidden",
                  }}
                >
                  {label}
                </Text>
              </View>
            ),
          ),
        )}
      </View>
      {scene.axes || scene.marks?.length ? (
        <Svg width={fullWidth} height={fullHeight} pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
          <Marks scene={scene} T={T} left={marginLeft} top={marginTop} />
        </Svg>
      ) : null}
     </View>
    </View>
  );
}
