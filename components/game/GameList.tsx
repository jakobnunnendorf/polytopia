import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { arena, type GameSummary } from "@/components/game/arenaClient";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import { BUILTIN_MODELS } from "@/logic/agents/registry";

export function seatLabel(seat: GameSummary["seats"][number]): string {
  if (seat.kind === "human") return seat.name;
  if (seat.modelId === "claude-sonnet-agent") return "Claude Sonnet";
  return BUILTIN_MODELS.find((m) => m.id === seat.modelId)?.name ?? seat.modelId;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** recorded games from the arena server; finished=true for analysis, false for resuming */
export default function GameList({
  finished,
  onPick,
  anySource = false,
}: {
  finished: boolean;
  onPick: (g: GameSummary) => void;
  /** also list unfinished model-only games (for watching live) */
  anySource?: boolean;
}) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    arena
      .games()
      .then((all) => setGames(all.filter((g) => (finished ? g.over : !g.over && (anySource || g.source === "play")))))
      .catch(() => setError(true));
  }, [finished, anySource]);

  if (error)
    return (
      <Text style={{ color: UI.coral, fontSize: 14, lineHeight: 20, marginTop: 12 }}>
        Recorded games live on the arena server, and it is not running. Start it with npm run arena-server.
      </Text>
    );
  if (!games) return <Text style={{ color: UI.muted, fontSize: 14, marginTop: 12 }}>Loading games</Text>;
  if (games.length === 0)
    return (
      <Text style={{ color: UI.muted, fontSize: 14, lineHeight: 20, marginTop: 12 }}>
        {finished
          ? "No finished games yet. Play one, or let models play each other with npm run arena."
          : "No unfinished games. Games are saved every round, so one you leave shows up here."}
      </Text>
    );
  return (
    <View style={{ marginTop: 8 }}>
      {games.slice(0, 40).map((g) => (
        <Pressable
          key={g.id}
          testID={`game-${g.id}`}
          accessibilityRole="button"
          onPress={() => onPick(g)}
          style={({ pressed }) => ({
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: UI.line,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
            {g.seats.map((s, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length], marginRight: 5 }} />
                <Text style={{ color: UI.mist, fontSize: 15, fontWeight: g.winner === i ? "800" : "600" }}>
                  {seatLabel(s)}
                  {g.winner === i ? " won" : ""}
                </Text>
              </View>
            ))}
          </View>
          <Text style={{ color: UI.muted, fontSize: 12, marginTop: 3 }}>
            {when(g.startedAt)}, {g.mode}, map {g.mapSize}, turn {g.turn}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
