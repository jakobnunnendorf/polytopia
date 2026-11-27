import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import WatchView, { type Annotate } from "@/components/game/WatchView";
import { UI } from "@/components/game/theme";
import { rlMarks, type RlDecision } from "@/components/game/rlOverlay";
import type { GameRecord } from "@/logic/arena/record";

type ReplayDoc = { run: string; iteration: number; game: number; seed: number; learner: number; epsilon: number; exact: boolean; record: GameRecord; decisions: RlDecision[] };

/**
 * /rl-replay?run=<run>&file=<i300-g5>[&src=<analysis server>]: a whole training game of the experiment 24 unit agent,
 * replayed move by move in the game's own viewer (written by `unit-rl replay`). At each of the learner's unit decisions
 * the acting unit's options carry their gain. Embedded by the analysis dashboard, which it tells the current
 * decision (postMessage {type: "rl-step", k, decision}); the dashboard can pick the unit shown ({type: "rl-unit", uid}).
 */
export default function RlReplayRoute() {
  const { run, file, src } = useLocalSearchParams<{ run?: string; file?: string; src?: string }>();
  const base = src || "http://localhost:8100";
  const [doc, setDoc] = useState<ReplayDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unit, setUnit] = useState<number | null>(null);
  useEffect(() => {
    setDoc(null);
    setError(null);
    fetch(`${base}/api/replay?run=${encodeURIComponent(run ?? "")}&file=${encodeURIComponent(file ?? "")}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setDoc)
      .catch((e) => setError(`Could not load the game (${e.message}). Is the analysis server running on ${base}?`));
  }, [base, run, file]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.type === "rl-unit") setUnit(typeof e.data.uid === "number" ? e.data.uid : null);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  // state index -> index of the decision taken there
  const byStep = useMemo(() => {
    const m = new Map<number, number>();
    doc?.decisions.forEach((d, i) => d.at !== undefined && m.set(d.at, i));
    return m;
  }, [doc]);
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const annotate: Annotate | undefined = useMemo(() => {
    if (!doc) return undefined;
    return {
      marks: [...byStep.keys()].sort((a, b) => a - b),
      at: (k) => {
        const i = byStep.get(k);
        return i === undefined ? null : rlMarks(doc.decisions[i], unitRef.current);
      },
      onStep: (k) => {
        setUnit(null);
        window.parent?.postMessage({ type: "rl-step", k, decision: byStep.get(k) ?? null }, "*");
      },
    };
  }, [doc, byStep]);

  if (!doc || !annotate)
    return (
      <View style={{ flex: 1, backgroundColor: UI.dusk, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: error ? UI.coral : UI.muted, fontSize: 14, textAlign: "center" }}>{error ?? "Replaying the game"}</Text>
      </View>
    );
  // a unit picked on the dashboard re-renders this route, and WatchView asks `at` again on every render
  return (
    <View style={{ flex: 1, backgroundColor: UI.dusk }} key={`${doc.run}-${doc.iteration}-${doc.game}`}>
      <WatchView rec={doc.record} live={false} annotate={annotate} />
    </View>
  );
}
