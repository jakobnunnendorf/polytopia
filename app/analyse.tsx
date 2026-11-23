import React, { useEffect, useMemo, useState } from "react";
import { ImageBackground, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Map from "@/components/Map/Map";
import GameList, { seatLabel } from "@/components/game/GameList";
import RankingsTable from "@/components/game/RankingsTable";
import * as Font from "expo-font";
import { arena } from "@/components/game/arenaClient";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import { replayStates, type GameRecord } from "@/logic/arena/record";
import { scoreOf } from "@/logic/engine";
import { actionLabel, name } from "@/logic/engine/names";

const color = (p: number) => PLAYER_COLORS[p % PLAYER_COLORS.length];

function Btn({ label, onPress, on, disabled, testID }: { label: string; onPress: () => void; on?: boolean; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 10,
        marginRight: 6,
        marginTop: 6,
        backgroundColor: on ? UI.mist : UI.panelHi,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ color: on ? UI.dusk : UI.mist, fontWeight: "700", fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function Replay({ rec, live }: { rec: GameRecord; live: boolean }) {
  const router = useRouter();
  const states = useMemo(() => replayStates(rec), [rec]);
  // indices where a new player-turn starts, for the turn jump buttons
  const turnStarts = useMemo(
    () => states.flatMap((s, k) => (k === 0 || s.current !== states[k - 1].current || s.turn !== states[k - 1].turn ? [k] : [])),
    [states],
  );
  const [k, setK] = useState(live ? states.length - 1 : 0);
  // live: stay on the newest move while new moves arrive, unless the viewer stepped back
  const [follow, setFollow] = useState(live);
  useEffect(() => {
    if (follow) setK(states.length - 1);
  }, [follow, states.length]);
  // "mover": the map as the player who is moving right now sees it (switches every turn)
  const [view, setView] = useState<number | "all" | "mover">(live ? "mover" : "all");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (k >= states.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setK((x) => Math.min(states.length - 1, x + 1)), 90);
    return () => clearTimeout(t);
  }, [playing, k, states.length]);

  const s = states[k];
  const step = k > 0 ? rec.steps[k - 1] : null;
  const prevTurn = [...turnStarts].reverse().find((i) => i < k) ?? 0;
  const nextTurn = turnStarts.find((i) => i > k) ?? states.length - 1;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Btn label="Games" onPress={() => router.replace("/analyse" as never)} />
          <Text style={{ color: UI.mist, fontSize: 16, fontWeight: "800" }}>
            {live && !rec.result?.over ? "LIVE  " : ""}Turn {s.turn}, move {k} of {states.length - 1}
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {s.players.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", marginRight: 12, marginTop: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color(p.id), marginRight: 5 }} />
              <Text style={{ color: p.id === s.current ? UI.mist : UI.muted, fontSize: 14, fontWeight: p.id === s.current ? "800" : "600" }}>
                {seatLabel(rec.seats[p.id])} {scoreOf(s, p.id).toLocaleString("en")}
              </Text>
            </View>
          ))}
        </View>
        <Text style={{ color: UI.muted, fontSize: 13, marginTop: 6 }} numberOfLines={1}>
          {step
            ? `${seatLabel(rec.seats[step.p])} (${name("clan", states[k - 1].players[step.p].clan)}): ${actionLabel(states[k - 1], step.a)}`
            : "Start of the game"}
        </Text>
        <Text style={{ color: UI.muted, fontSize: 12, marginTop: 2 }}>
          {view === "all"
            ? "Whole map. Dots show who has explored a tile; pale tiles nobody has seen."
            : `Seen through ${seatLabel(rec.seats[view === "mover" ? s.current : view])}'s eyes; clouds hide what they have not discovered.`}
        </Text>
      </View>
      <Map
        state={s}
        viewer={view === "all" ? 0 : view === "mover" ? s.current : view}
        reveal={view === "all"}
        seenBy
        highlights={{}}
        onTilePress={() => {}}
      />
      <View style={{ backgroundColor: "#223154f2", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Btn label="⏮ Turn" onPress={() => { setFollow(false); setK(prevTurn); }} disabled={k === 0} />
          <Btn label="◀ Move" onPress={() => { setFollow(false); setK(Math.max(0, k - 1)); }} disabled={k === 0} testID="replay-back" />
          <Btn label={playing ? "Pause" : "Play"} on={playing} onPress={() => setPlaying(!playing)} testID="replay-play" />
          <Btn label="Move ▶" onPress={() => setK(Math.min(states.length - 1, k + 1))} disabled={k >= states.length - 1} testID="replay-next" />
          <Btn label="Turn ⏭" onPress={() => setK(nextTurn)} disabled={k >= states.length - 1} />
          {live && <Btn label="Follow live" on={follow} onPress={() => setFollow(!follow)} />}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
          <Btn label="Mover's view" on={view === "mover"} onPress={() => setView("mover")} />
          <Btn label="Whole map" on={view === "all"} onPress={() => setView("all")} />
          {rec.seats.map((seat, i) => (
            <Btn key={i} label={`${seatLabel(seat)}'s view`} on={view === i} onPress={() => setView(i)} />
          ))}
        </View>
      </View>
    </View>
  );
}

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
    if (!id) return;
    let stop = false;
    const load = () =>
      arena
        .game(id)
        .then((r) => {
          if (stop) return;
          // only replace the record when it grew, so the replay is not recomputed for nothing
          setRec((cur) => (cur && cur.steps.length === r.steps.length && !!cur.result?.over === !!r.result?.over ? cur : r));
        })
        .catch(() => !stop && setError("This game could not be loaded. Is the arena server running?"));
    load();
    // a model-only game left behind by a closed tab continues on the server
    if (live) arena.resumeMatch(id).catch(() => {});
    // live: poll the recording, which the players save after every move
    const t = live ? setInterval(load, 2000) : null;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [id, live]);

  return (
    <ImageBackground source={require("@/assets/images/menu-background.webp")} resizeMode="cover" style={{ flex: 1, backgroundColor: UI.dusk }}>
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#16213a99" }} />
      {id && rec ? (
        <Replay rec={rec} live={live} />
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
