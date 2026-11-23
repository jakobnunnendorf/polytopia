import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { arena, type Profile } from "@/components/game/arenaClient";
import { UI } from "@/components/game/theme";
import { START_RATING, type Ratings } from "@/logic/arena/elo";
import type { ModelSpec } from "@/logic/agents/types";

type Row = { key: string; name: string; kind: string; rating: number; games: number; wins: number };

/** the Elo leaderboard: every model and every player profile that has finished a rated game */
export default function RankingsTable() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([arena.ratings(), arena.models(), arena.profiles()])
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
            .map(([key, r]) => ({ key, ...label(key), rating: r.rating, games: r.games, wins: r.wins }))
            .sort((a, b) => b.rating - a.rating),
        );
      })
      .catch(() => setError(true));
  }, []);

  const cell = { color: UI.mist, fontSize: 14, fontWeight: "700" as const, textAlign: "right" as const };
  const head = { color: UI.muted, fontSize: 12, fontWeight: "700" as const, textAlign: "right" as const };

  return (
    <View>
      <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800", marginTop: 14 }}>Rankings</Text>
      <Text style={{ color: UI.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>
        Elo from every finished game. Everyone starts at {START_RATING}; beating a stronger rival gains more.
      </Text>
      {error && (
        <Text style={{ color: UI.coral, fontSize: 14, marginTop: 10 }}>
          Rankings live on the arena server, and it is not running. Start it with npm run arena-server.
        </Text>
      )}
      {!error && !rows && <Text style={{ color: UI.muted, fontSize: 14, marginTop: 10 }}>Loading rankings</Text>}
      {rows && rows.length === 0 && (
        <Text style={{ color: UI.muted, fontSize: 14, marginTop: 10 }}>No rated games yet. Finish a game to appear here.</Text>
      )}
      {rows && rows.length > 0 && (
        <View style={{ marginTop: 10 }} testID="rankings-table">
          <View style={{ flexDirection: "row", paddingBottom: 6 }}>
            <Text style={[head, { width: 26, textAlign: "left" }]}>#</Text>
            <Text style={[head, { flex: 1, textAlign: "left" }]}>Name</Text>
            <Text style={[head, { width: 54 }]}>Elo</Text>
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
              <Text style={[cell, { width: 54, fontSize: 16, fontWeight: "800" }]}>{Math.round(r.rating)}</Text>
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
