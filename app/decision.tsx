import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Map from "@/components/Map/Map";
import { UI } from "@/components/game/theme";
import { rlMarks, type RlDecision } from "@/components/game/rlOverlay";
import type { GameState } from "@/logic/engine/types";

/**
 * /decision?run=<run>&k=<n>[&unit=<id>][&src=<analysis server>]: one decision of the experiment 24 unit agent on
 * the real board. The acting unit is selected; each of its candidate tiles shows the gain
 * (reward + V after - V before), orange above 0, blue at or below; the played one has a white ring.
 * Embedded by the analysis dashboard (scripts/unit-rl-analysis.ts).
 */
export default function DecisionRoute() {
  const { run, k, unit, src } = useLocalSearchParams<{ run?: string; k?: string; unit?: string; src?: string }>();
  const base = src || "http://localhost:8100";
  const [data, setData] = useState<{ state: GameState; example: RlDecision } | null>(null);
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

  const view = useMemo(() => (data ? rlMarks(data.example, unit !== undefined && unit !== "" ? Number(unit) : null) : null), [data, unit]);

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
      <Map state={data.state} viewer={ex.player ?? 0} reveal={whole} highlights={view.highlights} tileLabels={view.labels} onTilePress={() => {}} />
    </View>
  );
}
