// Side panels of the watch view: a sortable leaderboard and a feed of notable events.
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import type { GameState } from "@/logic/engine/types";
import { EVENT_KINDS, STANDING_COLUMNS, standings, type EventKind, type GameEvent, type Standing } from "./gameEvents";

const color = (p: number) => PLAYER_COLORS[p % PLAYER_COLORS.length];
type SortKey = (typeof STANDING_COLUMNS)[number]["key"];

export function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ backgroundColor: "#16213ee8", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "#ffffff1f" }, style]}>
      <Text style={{ color: UI.mist, fontSize: 15, fontWeight: "800", marginBottom: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

/** players ranked by a metric; tap a column to rank by it (tap again to reverse) */
export function Leaderboard({ state, label }: { state: GameState; label: (p: number) => string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "score", desc: true });
  const rows = useMemo(() => standings(state), [state]);
  const sorted = [...rows].sort(
    (a, b) => Number(b.alive) - Number(a.alive) || (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]) || b.score - a.score,
  );
  const total = rows.reduce((s, r) => s + (r.alive ? r[sort.key] : 0), 0) || 1;
  const cell = { width: 34, textAlign: "right" as const, fontVariant: ["tabular-nums" as const], fontSize: 12.5 };
  return (
    <Panel title="Leaderboard">
      <Text style={{ color: UI.muted, fontSize: 11.5, marginTop: -6, marginBottom: 4 }}>Tap a column to rank by it; the bar is each player's share.</Text>
      <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: 4, borderBottomWidth: 1, borderColor: "#ffffff1f" }}>
        <View style={{ flex: 1 }} />
        {STANDING_COLUMNS.map((c) => (
          <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={`rank by ${c.title}`} onPress={() => setSort((s) => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true }))}>
            <Text numberOfLines={1} style={[cell, c.key === "score" && { width: 54 }, { color: sort.key === c.key ? UI.mist : UI.muted, fontWeight: sort.key === c.key ? "800" : "600", fontSize: 11.5 }]}>
              {c.label}
              {sort.key === c.key ? (sort.desc ? "↓" : "↑") : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      {sorted.map((r: Standing, i) => (
        <View key={r.id} style={{ paddingVertical: 4, borderBottomWidth: 1, borderColor: "#ffffff10", opacity: r.alive ? 1 : 0.45 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ width: 18, color: UI.muted, fontSize: 12 }}>{r.alive ? i + 1 : "–"}</Text>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color(r.id), marginRight: 6 }} />
            <Text numberOfLines={1} style={{ flex: 1, color: state.current === r.id ? UI.mist : "#c9d3ea", fontSize: 13, fontWeight: state.current === r.id ? "800" : "600" }}>
              {label(r.id)}
              {!r.alive ? " (out)" : ""}
            </Text>
            {STANDING_COLUMNS.map((c) => (
              <Text key={c.key} numberOfLines={1} style={[cell, c.key === "score" && { width: 54 }, { color: sort.key === c.key ? UI.mist : "#aab6cf", fontWeight: sort.key === c.key ? "700" : "400" }]}>
                {r[c.key].toLocaleString("en")}
              </Text>
            ))}
          </View>
          {/* share of the ranked metric among the living players */}
          <View style={{ height: 3, marginLeft: 34, marginTop: 3, borderRadius: 2, backgroundColor: "#ffffff12" }}>
            <View style={{ height: 3, borderRadius: 2, width: `${r.alive ? Math.max(0, (r[sort.key] / total) * 100) : 0}%`, backgroundColor: color(r.id) }} />
          </View>
        </View>
      ))}
    </Panel>
  );
}

/** notable events up to the shown move, newest first, filterable by kind */
export function EventFeed({ events, upTo, style }: { events: GameEvent[]; upTo: number; style?: object }) {
  const [off, setOff] = useState<Set<EventKind>>(new Set());
  const shown = useMemo(() => {
    const out: GameEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 150; i--) {
      const e = events[i];
      if (e.step <= upTo && !off.has(e.kind)) out.push(e);
    }
    return out;
  }, [events, upTo, off]);
  return (
    <Panel title="What just happened" style={[{ flex: 1, minHeight: 0 }, style]}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
        {EVENT_KINDS.map(({ kind, label: l }) => {
          const on = !off.has(kind);
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setOff((s) => { const n = new Set(s); if (n.has(kind)) n.delete(kind); else n.add(kind); return n; })}
              style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginRight: 5, marginBottom: 5, backgroundColor: on ? "#ffffff24" : "transparent", borderWidth: 1, borderColor: "#ffffff2e" }}
            >
              <Text style={{ color: on ? UI.mist : UI.muted, fontSize: 11.5, fontWeight: "700" }}>{l}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView style={{ flex: 1 }}>
        {shown.length === 0 && <Text style={{ color: UI.muted, fontSize: 12.5 }}>Nothing notable yet.</Text>}
        {shown.map((e, j) => (
          <View key={`${e.step}-${j}-${e.text}`} style={{ flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderColor: "#ffffff10", opacity: j === 0 ? 1 : 0.92 }}>
            <View style={{ width: 4, borderRadius: 2, backgroundColor: color(e.player), marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#e7ecf7", fontSize: 12.5, fontWeight: e.kind === "elimination" || e.kind === "lead" ? "800" : "500" }}>{e.text}</Text>
              <Text style={{ color: UI.muted, fontSize: 11 }}>
                turn {e.turn} · {EVENT_KINDS.find((x) => x.kind === e.kind)?.label}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </Panel>
  );
}

export const SPEEDS: { label: string; ms: number }[] = [
  { label: "¼×", ms: 4000 },
  { label: "½×", ms: 2000 },
  { label: "1×", ms: 1000 },
  { label: "2×", ms: 500 },
  { label: "4×", ms: 250 },
];

/** who is moving, what they just did, and the playback speed */
export function NowPlaying({
  current,
  label,
  clan,
  model,
  recent,
  turn,
  speedMs,
  onSpeed,
  live,
}: {
  current: number;
  label: string;
  clan: string;
  model?: string;
  /** this player's latest actions this turn, newest first */
  recent: string[];
  turn: number;
  speedMs: number;
  onSpeed: (ms: number) => void;
  live: boolean;
}) {
  return (
    <Panel title="Now playing" style={{ marginTop: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: color(current) + "33", borderRadius: 10, padding: 8, borderLeftWidth: 5, borderLeftColor: color(current) }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: UI.mist, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
            {label}
          </Text>
          <Text style={{ color: "#c9d3ea", fontSize: 12 }} numberOfLines={1}>
            {clan} · turn {turn}
            {model ? ` · ${model}` : ""}
          </Text>
        </View>
      </View>
      <Text style={{ color: UI.muted, fontSize: 11.5, marginTop: 8, marginBottom: 2 }}>Chose this turn (newest first)</Text>
      {recent.length === 0 && <Text style={{ color: UI.muted, fontSize: 12.5 }}>Nothing yet this turn.</Text>}
      {recent.map((r, i) => (
        <Text key={i} numberOfLines={1} style={{ color: i === 0 ? UI.mist : "#aab6cf", fontSize: i === 0 ? 14 : 12.5, fontWeight: i === 0 ? "800" : "500", paddingVertical: 1 }}>
          {i === 0 ? "▶ " : "   "}
          {r}
        </Text>
      ))}
      <Text style={{ color: UI.muted, fontSize: 11.5, marginTop: 10, marginBottom: 4 }}>
        Speed: {speedMs >= 1000 ? `${speedMs / 1000} s` : `${speedMs} ms`} per move{live ? " (the game itself runs at this pace)" : ""}
      </Text>
      <View style={{ flexDirection: "row" }}>
        {SPEEDS.map((sp) => {
          const on = sp.ms === speedMs;
          return (
            <Pressable
              key={sp.ms}
              accessibilityRole="button"
              accessibilityLabel={`speed ${sp.label}`}
              accessibilityState={{ selected: on }}
              onPress={() => onSpeed(sp.ms)}
              style={{ flex: 1, alignItems: "center", paddingVertical: 7, marginRight: 4, borderRadius: 8, backgroundColor: on ? UI.mist : "#ffffff14" }}
            >
              <Text style={{ color: on ? "#16213e" : UI.mist, fontWeight: "800", fontSize: 13 }}>{sp.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Panel>
  );
}
