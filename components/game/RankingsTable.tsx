import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { arena, type Profile } from "@/components/game/arenaClient";
import { UI } from "@/components/game/theme";
import { START_RATING, type RatingFilter, type Ratings } from "@/logic/arena/elo";
import type { ModelSpec } from "@/logic/agents/types";

type Row = { key: string; name: string; kind: string; rating: number; games: number; wins: number; lo?: number; hi?: number };

type Facets = { mode: Record<string, number>; players: Record<string, number>; size: Record<string, number>; mapType: Record<string, number> };

const SIZE_NAMES: Record<string, string> = { 11: "Tiny", 14: "Small", 16: "Normal", 18: "Large", 20: "Huge", 30: "Massive" };
const label = (kind: keyof Facets, v: string) =>
  kind === "mode" ? v[0].toUpperCase() + v.slice(1) : kind === "players" ? (v === "2" ? "1v1" : `${v} players`) : kind === "size" ? `${SIZE_NAMES[v] ?? v} ${v}×${v}` : v[0].toUpperCase() + v.slice(1);

function FilterChip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, marginRight: 6, marginTop: 6, backgroundColor: on ? UI.mist : UI.panelHi }}
    >
      <Text style={{ color: on ? UI.dusk : UI.mist, fontSize: 12, fontWeight: "700" }}>{text}</Text>
    </Pressable>
  );
}

/** the Elo leaderboard: every model and every player profile that has finished a rated game; filters refit it on one kind of game */
export default function RankingsTable() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<RatingFilter>({});
  const [facets, setFacets] = useState<Facets | null>(null);

  useEffect(() => {
    arena.ratingFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    setRows(null);
    Promise.all([arena.ratings(filter), arena.models(), arena.profiles()])
      .then(([ratings, models, profiles]: [Ratings, ModelSpec[], Profile[]]) => {
        const label = (key: string): { name: string; kind: string } => {
          const type = key.slice(0, key.indexOf(":"));
          const id = key.slice(key.indexOf(":") + 1);
          if (type === "human") return { name: profiles.find((p) => p.id === id)?.name ?? (id === "guest" ? "Guest" : id), kind: "Player" };
          const m = models.find((x) => x.id === id);
          const kind = m?.kind === "llm" ? "LLM" : m?.kind === "external" ? "Agent" : m?.kind === "random" ? "Baseline" : "Bot";
          return { name: m?.name ?? id, kind };
        };
        setRows(
          Object.entries(ratings)
            .map(([key, r]) => ({ key, ...label(key), rating: r.rating, games: r.games, wins: r.wins, lo: r.lo, hi: r.hi }))
            .sort((a, b) => b.rating - a.rating),
        );
      })
      .catch(() => setError(true));
  }, [filter]);

  // one row of chips per setting; a setting with a single value (all games alike) is not worth a row
  const filterRow = (kind: keyof Facets) => {
    const values = facets ? Object.entries(facets[kind]).sort((a, b) => (kind === "mode" || kind === "mapType" ? a[0].localeCompare(b[0]) : Number(a[0]) - Number(b[0]))) : [];
    if (values.length < 2) return null;
    const cur = filter[kind];
    const set = (v?: string) => setFilter((f) => ({ ...f, [kind]: v === undefined ? undefined : kind === "players" || kind === "size" ? Number(v) : v }));
    return (
      <View key={kind} style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <FilterChip text={kind === "mode" ? "Any mode" : kind === "players" ? "Any players" : kind === "size" ? "Any size" : "Any map"} on={cur === undefined} onPress={() => set(undefined)} />
        {values.map(([v, n]) => (
          <FilterChip key={v} text={`${label(kind, v)} · ${n}`} on={String(cur) === v} onPress={() => set(v)} />
        ))}
      </View>
    );
  };

  const cell = { color: UI.mist, fontSize: 14, fontWeight: "700" as const, textAlign: "right" as const };
  const head = { color: UI.muted, fontSize: 12, fontWeight: "700" as const, textAlign: "right" as const };

  return (
    <View>
      <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800", marginTop: 14 }}>Rankings</Text>
      <Text style={{ color: UI.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>
        Ratings fitted to every finished game at once, on the Elo scale (a 200-point gap means the stronger side wins about 3 games in 4). Below each rating: the range it lies in with 95% certainty. Few games, wide range; new players start near {START_RATING}. Pick a mode, player count or map size to rate only those games; the number on each chip is how many there are.
      </Text>
      <View style={{ marginTop: 4 }} testID="rankings-filters">
        {(["mode", "players", "size", "mapType"] as const).map(filterRow)}
      </View>
      {error && (
        <Text style={{ color: UI.coral, fontSize: 14, marginTop: 10 }}>
          Rankings live on the arena server, and it is not running. Start it with npm run arena-server.
        </Text>
      )}
      {!error && !rows && <Text style={{ color: UI.muted, fontSize: 14, marginTop: 10 }}>Loading rankings</Text>}
      {rows && rows.length === 0 && (
        <Text style={{ color: UI.muted, fontSize: 14, marginTop: 10 }}>
          {Object.values(filter).some((v) => v !== undefined) ? "No rated games of this kind yet." : "No rated games yet. Finish a game to appear here."}
        </Text>
      )}
      {rows && rows.length > 0 && (
        <View style={{ marginTop: 10 }} testID="rankings-table">
          <View style={{ flexDirection: "row", paddingBottom: 6 }}>
            <Text style={[head, { width: 26, textAlign: "left" }]}>#</Text>
            <Text style={[head, { flex: 1, textAlign: "left" }]}>Name</Text>
            <Text style={[head, { width: 70 }]}>Elo</Text>
            <Text style={[head, { width: 48 }]}>Games</Text>
            <Text style={[head, { width: 44 }]}>Wins</Text>
            <Text style={[head, { width: 46 }]}>Win %</Text>
          </View>
          {rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: 1, borderTopColor: UI.line }}>
              <Text style={[cell, { width: 26, textAlign: "left", color: i === 0 ? UI.gold : UI.muted }]}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: i === 0 ? UI.gold : UI.mist, fontSize: 15, fontWeight: "800" }} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={{ color: UI.muted, fontSize: 11 }}>{r.kind}</Text>
              </View>
              <View style={{ width: 70, alignItems: "flex-end" }}>
                <Text style={[cell, { fontSize: 16, fontWeight: "800" }]}>{Math.round(r.rating)}</Text>
                {r.lo !== undefined && (
                  <Text style={{ color: UI.muted, fontSize: 10 }}>
                    {r.lo}–{r.hi}
                  </Text>
                )}
              </View>
              <Text style={[cell, { width: 48 }]}>{r.games}</Text>
              <Text style={[cell, { width: 44 }]}>{r.wins}</Text>
              <Text style={[cell, { width: 46, color: UI.muted }]}>{r.games ? Math.round((100 * r.wins) / r.games) : 0}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
