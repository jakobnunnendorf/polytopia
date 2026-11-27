import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Map from "@/components/Map/Map";
import type { Highlight } from "@/components/Map/Tile";
import { UI } from "@/components/game/theme";
import type { GameState } from "@/logic/engine/types";

/** One candidate of a recorded RL decision (experiment 24, `unit-rl analyse`). */
type Cand = { uid: number; from: [number, number]; target: [number, number]; kind: string; gain: number; chosen: boolean };
type Example = { turn: number; player: number; passed: boolean; all: Cand[]; rows: { uid: number; unit: string; chosen: boolean }[] };

/**
 * /decision?run=<run>&k=<n>[&unit=<id>][&src=<analysis server>]: one decision of the experiment 24 unit agent on
 * the real board. The acting unit is selected; each of its candidate tiles shows the gain
 * (reward + V after - V before), orange above 0, blue at or below; the played one has a white ring.
 * Embedded by the analysis dashboard (scripts/unit-rl-analysis.ts).
 */
export default function DecisionRoute() {
  const { run, k, unit, src } = useLocalSearchParams<{ run?: string; k?: string; unit?: string; src?: string }>();
  const base = src || "http://localhost:8100";
  const [data, setData] = useState<{ state: GameState; example: Example } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`${base}/api/decision?run=${encodeURIComponent(run ?? "")}&k=${encodeURIComponent(k ?? "0")}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch((e) => setError(`Could not load the decision (${e.message}). Is the analysis server running on ${base}?`));
  }, [base, run, k]);

  const view = useMemo(() => {
    if (!data) return null;
    const ex = data.example;
    const chosen = ex.all.find((c) => c.chosen);
    const uid = unit !== undefined && unit !== "" ? Number(unit) : (chosen?.uid ?? ex.all[0]?.uid);
    const mine = ex.all.filter((c) => c.uid === uid);
    const highlights: Record<string, Highlight> = {};
    const labels: Record<string, { text: string; color: string; ring?: boolean }> = {};
    // best candidate per tile (a tile can hold several, e.g. capture and recover on the unit's own tile)
    const best: Record<string, Cand> = {};
    for (const c of mine) {
      const key = `${c.target[0]},${c.target[1]}`;
      if (!best[key] || c.gain > best[key].gain || c.chosen) best[key] = c;
    }
    for (const [key, c] of Object.entries(best)) {
      highlights[key] = c.kind === "attack" ? "attack" : c.kind === "move" ? "move" : "action";
      labels[key] = { text: `${c.gain > 0 ? "+" : ""}${c.gain.toFixed(2)}`, color: c.gain > 0 ? "#c96a1ee6" : "#2f6fcde6", ring: c.chosen };
    }
    const from = mine[0]?.from;
    if (from) highlights[`${from[0]},${from[1]}`] = "selected";
    const name = ex.rows.find((r) => r.uid === uid)?.unit ?? `unit #${uid}`;
    return { highlights, labels, name, n: mine.length, chosen };
  }, [data, unit]);

  if (!data || !view)
    return (
      <View style={{ flex: 1, backgroundColor: UI.dusk, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: error ? UI.coral : UI.muted, fontSize: 14, textAlign: "center" }}>{error ?? "Loading the decision"}</Text>
      </View>
    );
  const ex = data.example;
  return (
    <View style={{ flex: 1, backgroundColor: UI.dusk }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", paddingHorizontal: 12, paddingTop: 8, gap: 10 }}>
        <Text style={{ color: UI.mist, fontSize: 13, fontWeight: "600" }}>
          Turn {ex.turn} · {view.name} · {view.n} options for this unit
          {ex.passed ? " · passed" : ""}
        </Text>
        <Text style={{ color: UI.muted, fontSize: 12 }}>orange = gain above 0 · blue = not worth it · ring = played</Text>
        <Pressable onPress={() => setWhole((w) => !w)} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: "#ffffff1f" }}>
          <Text style={{ color: UI.mist, fontSize: 12 }}>{whole ? "Learner's view (fog)" : "Whole map"}</Text>
        </Pressable>
      </View>
      <Map state={data.state} viewer={ex.player} reveal={whole} highlights={view.highlights} tileLabels={view.labels} onTilePress={() => {}} />
    </View>
  );
}
