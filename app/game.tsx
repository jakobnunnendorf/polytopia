import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import GameScreen from "@/components/game/GameScreen";
import { arena } from "@/components/game/arenaClient";
import { UI } from "@/components/game/theme";
import type { GameRecord } from "@/logic/arena/record";

/** /game starts a new game; /game?resume=<id> continues a recorded one */
export default function GameRoute() {
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  const [rec, setRec] = useState<GameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!resume) return;
    arena
      .game(resume)
      .then(setRec)
      .catch(() => setError("This game could not be loaded. Is the arena server running?"));
  }, [resume]);
  if (!resume) return <GameScreen />;
  if (!rec)
    return (
      <View style={{ flex: 1, backgroundColor: UI.dusk, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: error ? UI.coral : UI.muted, fontSize: 15, textAlign: "center" }}>{error ?? "Loading the game"}</Text>
      </View>
    );
  return <GameScreen resumed={rec} />;
}
