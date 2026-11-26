import React, { useEffect, useState } from "react";
import { ImageBackground, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import GameList from "@/components/game/GameList";
import RankingsTable from "@/components/game/RankingsTable";
import * as Font from "expo-font";
import { arena } from "@/components/game/arenaClient";
import { UI } from "@/components/game/theme";
import type { GameRecord } from "@/logic/arena/record";
import WatchView, { Btn } from "@/components/game/WatchView";

/** /analyse lists finished games; /analyse?id=<id> replays one move by move */
export default function AnalyseScreen() {
  const { id, live: liveParam } = useLocalSearchParams<{ id?: string; live?: string }>();
  const live = liveParam === "1";
  useEffect(() => {
    Font.loadAsync({ "Oi-Regular": require("@/assets/fonts/Oi-Regular.ttf") }).catch(() => {});
  }, []);
  const router = useRouter();
  const [rec, setRec] = useState<GameRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRec(null);
    setError(null);
    if (!id) return;
    let stop = false;
    // the record as loaded so far, and whether a request is under way (polls never pile up)
    let cur: GameRecord | null = null;
    let busy = false;
    const fail = () => !stop && !cur && setError("This game could not be loaded. Is the arena server running?");
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!cur) {
          // live: from the newest checkpoint, so a game of thousands of moves opens at once
          const r = await (live ? arena.liveGame(id) : arena.game(id));
          if (stop) return;
          cur = r;
          setRec(r);
          return;
        }
        // afterwards only the moves this page does not have yet
        const have = (cur.base ?? 0) + cur.steps.length;
        const d = await arena.gameSteps(id, have);
        if (stop) return;
        if (d.total < have) {
          cur = null; // the record on the server is shorter than ours: start over
          return;
        }
        if (d.steps.length === 0 && !!d.result?.over === !!cur.result?.over && (d.stoppedAt ?? null) === (cur.stoppedAt ?? null)) return;
        cur = { ...cur, steps: d.steps.length ? [...cur.steps, ...d.steps] : cur.steps, endedAt: d.endedAt, result: d.result, stoppedAt: d.stoppedAt };
        setRec(cur);
      } catch {
        fail();
      } finally {
        busy = false;
      }
    };
    void load();
    // a model-only game left behind by a closed tab continues on the server
    if (live) arena.resumeMatch(id).catch(() => {});
    // live: poll for the moves the players saved since
    const t = live ? setInterval(() => void load(), 700) : null;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [id, live]);

  return (
    <ImageBackground source={require("@/assets/images/menu-background.webp")} resizeMode="cover" style={{ flex: 1, backgroundColor: UI.dusk, overflow: "hidden" }} imageStyle={{ width: "100%", height: "100%" }}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#16213a99" }} />
      {id && rec ? (
        <WatchView rec={rec} live={live} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, alignItems: "center" }}>
          <View style={{ width: "100%", maxWidth: 520, backgroundColor: "#1b2846f2", borderRadius: 24, padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontFamily: UI.display, fontSize: 32, color: UI.mist }}>Analyse</Text>
              <Btn label="Menu" onPress={() => router.replace("/")} />
            </View>
            {id ? (
              <Text style={{ color: error ? UI.coral : UI.muted, fontSize: 14, marginTop: 12 }}>{error ?? "Loading the game"}</Text>
            ) : (
              <>
                <RankingsTable />
                <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800", marginTop: 22 }}>Finished games</Text>
                <Text style={{ color: UI.muted, fontSize: 14, marginTop: 2 }}>Pick one to replay it move by move.</Text>
                <GameList finished onPick={(g) => router.push({ pathname: "/analyse", params: { id: g.id } } as never)} />
                <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800", marginTop: 22 }}>Games in progress</Text>
                <Text style={{ color: UI.muted, fontSize: 14, marginTop: 4 }}>Watch them live; the map follows each new move.</Text>
                <GameList finished={false} anySource onPick={(g) => router.push({ pathname: "/analyse", params: { id: g.id, live: "1" } } as never)} />
              </>
            )}
          </View>
        </ScrollView>
      )}
    </ImageBackground>
  );
}
