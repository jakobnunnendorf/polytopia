/**
 * A still game scene for the lecture notes (lecture-notes/build.el): a small board drawn with
 * the game's own tile and unit components, plus a label per tile and a path.
 *
 * The scene is JSON in the URL fragment, base64url-encoded:
 *   { rows: ["..FFF..V", ...],            // . field, F forest, M mountain, ~ water, V village
 *     labels?: [["0.73", null, ...], ...], // one string or null per tile
 *     path?: [[0, 5], [2, 3], ...],        // tiles joined by a line, in order
 *     unit?: { type: "rider", x: 0, y: 5 },
 *     tile?: 64 }                          // tile size in pixels
 * Web only. The tile and unit components call the rules engine while drawing, so the page
 * waits for the engine like every other page (app/_layout.tsx).
 */
import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import Tile from "@/components/Map/Tile";
import { UnitSprite } from "@/components/Map/Units";
import { AnimateNew } from "@/components/anim";
import type { Terrain, Tile as TileData, Unit } from "@/logic/engine/types";

type Scene = {
  rows: string[];
  labels?: (string | null)[][];
  path?: [number, number][];
  unit?: { type: string; x: number; y: number };
  tile?: number;
};

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

  return (
    <View style={{ padding: 8, backgroundColor: "#ffffff", alignSelf: "flex-start" }}>
      <View testID="scene" style={{ width: cols * T, height: rows * T, borderRadius: 14, overflow: "hidden" }}>
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
    </View>
  );
}
