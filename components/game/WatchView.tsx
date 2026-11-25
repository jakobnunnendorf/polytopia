// The watch view: a game shown move by move with the spectator panels (Now playing with the speed
// control, Leaderboard, Events). Used by /analyse for recorded and server-run games, and by the
// game screen for a models-only game played in this tab (when no arena server runs the game).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import Map from "@/components/Map/Map";
import { seatLabel } from "@/components/game/GameList";
import { arena } from "@/components/game/arenaClient";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import { extendReplay, type GameRecord } from "@/logic/arena/record";
import { scoreOf } from "@/logic/engine";
import GameOverCard from "@/components/game/GameOverCard";
import { Pulse } from "@/components/anim";
import { actionLabel, name } from "@/logic/engine/names";
import { EventFeed, Leaderboard, NowPlaying } from "@/components/game/WatchPanels";
import { extendEvents, type EventLog } from "@/components/game/gameEvents";

const color = (p: number) => PLAYER_COLORS[p % PLAYER_COLORS.length];

export function Btn({ label, onPress, on, disabled, testID }: { label: string; onPress: () => void; on?: boolean; disabled?: boolean; testID?: string }) {
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

// live playback: one move per FOLLOW_MS, kept a few moves behind the newest to smooth out polling.
// Matches the server's pace (SHARDLANDS_PACE_MS, scripts/lib/matches.ts) so the buffer stays steady.
const FOLLOW_MS = 1000; // default; the speed control in "Now playing" changes it
const FOLLOW_BUFFER = 2;

/**
 * A models-only game played in this tab (no arena server): the game screen runs the models and
 * hands the growing record in; the speed control and pause set the pace of the models themselves.
 */
export type LocalGame = {
  paceMs: number;
  onPace: (ms: number) => void;
  paused: boolean;
  onPause: (paused: boolean) => void;
  onLeave: () => void;
  /** whether the game is over (the in-tab record gets its result only when it is saved) */
  over: boolean;
  /** shown under the result, e.g. whether the game was recorded */
  footer?: string;
};

export default function WatchView({ rec, live, local }: { rec: GameRecord; live: boolean; local?: LocalGame }) {
  const router = useRouter();
  // live records grow move by move: extend the last replay instead of rebuilding the whole game
  const cache = useRef<{ id: string; r: ReturnType<typeof extendReplay> } | null>(null);
  const { states, divergedAt } = useMemo(() => {
    const r = extendReplay(cache.current?.id === rec.id ? cache.current.r : null, rec);
    cache.current = { id: rec.id, r };
    return r;
  }, [rec]);
  // indices where a new player-turn starts, for the turn jump buttons
  const turnStarts = useMemo(
    () => states.flatMap((s, k) => (k === 0 || s.current !== states[k - 1].current || s.turn !== states[k - 1].turn ? [k] : [])),
    [states],
  );
  const [kWanted, setK] = useState(live ? states.length - 1 : 0);
  // never past the last state: a newer copy of a live record can replay to fewer moves than the one
  // this page opened with (an older-rules game stops where the current rules diverge)
  const k = Math.min(kWanted, states.length - 1);
  // live: stay on the newest move while new moves arrive, unless the viewer stepped back
  const [follow, setFollow] = useState(live);
  // following: step through new moves one at a time at an even pace. While the game runs, stay
  // FOLLOW_BUFFER moves behind the newest one, so the moves that arrive in bursts (one poll can
  // bring zero or two) still play back evenly; speed up only when far behind
  const runningNow = local ? !local.over : live && !rec.result?.over && !rec.stoppedAt;
  // playback speed (ms per move); for a running game the server plays at the same pace
  const [serverSpeedMs, setSpeedMs] = useState(FOLLOW_MS);
  const speedMs = local ? local.paceMs : serverSpeedMs;
  useEffect(() => {
    if (runningNow && !local) void arena.getPace(rec.id).then((r) => setSpeedMs(r.ms)).catch(() => {});
  }, [rec.id, runningNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeSpeed = (ms: number) => {
    if (local) return local.onPace(ms);
    setSpeedMs(ms);
    if (runningNow) void arena.setPace(rec.id, ms).catch(() => {});
  };
  useEffect(() => {
    // an in-tab game arrives move by move at its own pace: no buffer needed
    const target = states.length - 1 - (runningNow && !local ? FOLLOW_BUFFER : 0);
    if (!follow || k >= target) return;
    const behind = target - k;
    if (behind > 60) {
      setK(target);
      return;
    }
    const delay = local && behind <= 1 ? 0 : behind > 20 ? Math.min(150, speedMs) : behind > 6 ? speedMs * 0.6 : speedMs;
    const t = setTimeout(() => setK((x) => Math.min(states.length - 1, x + 1)), delay);
    return () => clearTimeout(t);
  }, [follow, k, states.length, runningNow, speedMs, local]);
  // "mover": the map as the player who is moving right now sees it (switches every turn)
  // the whole map by default: "mover" switches perspective every turn, which is jarring with many players
  const [view, setView] = useState<number | "all" | "mover">("all");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (k >= states.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setK((x) => Math.min(states.length - 1, x + 1)), speedMs);
    return () => clearTimeout(t);
  }, [playing, k, states.length, speedMs]);

  const s = states[k];
  // a live view starts at the record's checkpoint: `base` moves of the game came before it
  const base = rec.base ?? 0;
  // a live model-only game the server is still playing (a stopped one is kept but never resumed)
  const running = runningNow;
  const step = k > 0 ? rec.steps[k - 1] : null;
  // the winner card shows on the last move of a finished game, until closed
  const [closedEnd, setClosedEnd] = useState(false);
  const atEnd = s.over && k === states.length - 1 && !closedEnd;
  const prevTurn = [...turnStarts].reverse().find((i) => i < k) ?? 0;
  const nextTurn = turnStarts.find((i) => i > k) ?? states.length - 1;

  // notable events, extended move by move like the replay
  const who = (p: number) => seatLabel(rec.seats[p]);
  const evCache = useRef<{ id: string; r: EventLog } | null>(null);
  const events = useMemo(() => {
    const r = extendEvents(evCache.current?.id === rec.id ? evCache.current.r : null, rec, states, who);
    evCache.current = { id: rec.id, r };
    return r.events;
  }, [states]); // eslint-disable-line react-hooks/exhaustive-deps

  // the player who made the latest shown move, and their choices so far this turn
  const mover = step ? step.p : s.current;
  const recent: string[] = [];
  for (let i = k - 1; i >= 0 && recent.length < 6; i--) {
    if (rec.steps[i].p !== mover || states[i].turn !== s.turn) break;
    recent.push(actionLabel(states[i], rec.steps[i].a));
  }
  const nowPlaying = (
    <NowPlaying
      current={mover}
      label={who(mover)}
      clan={name("clan", s.players[mover].clan)}
      recent={recent}
      turn={s.turn}
      speedMs={speedMs}
      onSpeed={changeSpeed}
      live={runningNow}
      paused={local && runningNow ? local.paused : undefined}
      onPause={local && runningNow ? local.onPause : undefined}
    />
  );

  const { width } = useWindowDimensions();
  const wide = width >= 1100;
  const [territory, setTerritory] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [overlay, setOverlay] = useState<"board" | "feed" | null>(null);

  const status = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <View style={{ flexDirection: "row" }}>
          {local ? (
            <Btn label="Menu" onPress={local.onLeave} testID="menu-button" />
          ) : (
            <Btn label="Games" onPress={() => router.replace("/analyse" as never)} />
          )}
          {running && !local && <Btn label="Stop game" onPress={() => void arena.stopMatch(rec.id).catch(() => {})} testID="stop-match" />}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
          {running && (
            <Pulse amount={0.5} period={1200} style={{ marginRight: 8 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: UI.coral }} />
            </Pulse>
          )}
          <Text style={{ color: UI.mist, fontSize: 16, fontWeight: "800" }}>
            {running ? (local?.paused ? "PAUSED  " : "LIVE  ") : rec.stoppedAt ? "STOPPED  " : ""}Turn {s.turn}, move {base + k} of {base + states.length - 1}
          </Text>
        </View>
      </View>
      {divergedAt !== null && (
        <Text style={{ color: UI.coral, fontSize: 13, marginTop: 6 }}>
          This game was played under older rules; the replay stops at move {base + divergedAt} of {base + rec.steps.length}.
        </Text>
      )}
      {!wide && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {s.players.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", marginRight: 12, marginTop: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color(p.id), marginRight: 5 }} />
              <Text style={{ color: p.id === s.current ? UI.mist : UI.muted, fontSize: 14, fontWeight: p.id === s.current ? "800" : "600" }}>
                {who(p.id)} {scoreOf(s, p.id).toLocaleString("en")}
              </Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
        {step && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color(step.p), marginRight: 6 }} />}
        <Text style={{ color: UI.muted, fontSize: 13, flex: 1 }} numberOfLines={1}>
          {step ? `${who(step.p)} (${name("clan", states[k - 1].players[step.p].clan)}): ${actionLabel(states[k - 1], step.a)}` : base ? "Where this live view begins; open the whole game to see the moves before" : "Start of the game"}
        </Text>
      </View>
      <Text style={{ color: UI.muted, fontSize: 12, marginTop: 2 }}>
        {territory
          ? "Territory view: each colour is one player's land; grey land belongs to nobody."
          : view === "all"
            ? "Whole map. Dots show who has explored a tile; pale tiles nobody has seen."
            : `Seen through ${who(view === "mover" ? s.current : view)}'s eyes; clouds hide what they have not discovered.`}
      </Text>
    </View>
  );

  // always visible: following and the territory view; the rest folds away
  const quickBar = (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      {live && <Btn label="Follow live" on={follow} onPress={() => setFollow(!follow)} />}
      {base > 0 && <Btn label="Whole game" onPress={() => router.replace({ pathname: "/analyse", params: { id: rec.id } } as never)} testID="whole-game" />}
      <Btn label="Territory" on={territory} onPress={() => setTerritory(!territory)} testID="territory-view" />
      <Btn label={controlsOpen ? "Replay & views ▾" : "Replay & views ▸"} on={controlsOpen} onPress={() => setControlsOpen(!controlsOpen)} />
      {!wide && <Btn label="Leaderboard" on={overlay === "board"} onPress={() => setOverlay(overlay === "board" ? null : "board")} />}
      {!wide && <Btn label="Events" on={overlay === "feed"} onPress={() => setOverlay(overlay === "feed" ? null : "feed")} />}
    </View>
  );
  const controls = controlsOpen && (
    <View style={{ marginTop: 4 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <Btn label="⏮ Turn" onPress={() => { setFollow(false); setK(prevTurn); }} disabled={k === 0} />
        <Btn label="◀ Move" onPress={() => { setFollow(false); setK(Math.max(0, k - 1)); }} disabled={k === 0} testID="replay-back" />
        <Btn label={playing ? "Pause" : "Play"} on={playing} onPress={() => setPlaying(!playing)} testID="replay-play" />
        <Btn label="Move ▶" onPress={() => setK(Math.min(states.length - 1, k + 1))} disabled={k >= states.length - 1} testID="replay-next" />
        <Btn label="Turn ⏭" onPress={() => setK(nextTurn)} disabled={k >= states.length - 1} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        <Btn label="Mover's view" on={view === "mover"} onPress={() => setView("mover")} />
        <Btn label="Whole map" on={view === "all"} onPress={() => setView("all")} />
        {rec.seats.map((seat, i) => (
          <Btn key={i} label={`${seatLabel(seat)}'s view`} on={view === i} onPress={() => setView(i)} />
        ))}
      </View>
    </View>
  );
  const map = (
    <Map
      state={s}
      viewer={view === "all" ? 0 : view === "mover" ? s.current : view}
      reveal={view === "all"}
      seenBy
      territoryFocus={territory}
      highlights={{}}
      onTilePress={() => {}}
    />
  );
  const endCard = atEnd && (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#0a1020cc", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 30 }}>
      <GameOverCard
        title={`${who(s.winner ?? 0)} wins`}
        good
        subtitle={`The ${name("clan", s.players[s.winner ?? 0].clan)} rule the Square after ${s.turn} turns.`}
        standings={[...s.players]
          .sort((a, b) => (b.id === s.winner ? 1 : 0) - (a.id === s.winner ? 1 : 0) || scoreOf(s, b.id) - scoreOf(s, a.id))
          .map((p) => ({ id: p.id, name: who(p.id), clan: name("clan", p.clan), score: scoreOf(s, p.id), alive: p.alive }))}
        footer={local?.footer}
      >
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
          <Btn label="See the final map" onPress={() => setClosedEnd(true)} testID="close-result" />
          <Btn label="Watch from the start" onPress={() => { setClosedEnd(true); setFollow(false); setK(0); }} />
          {local ? <Btn label="Back to the menu" onPress={local.onLeave} /> : <Btn label="Games" onPress={() => router.replace("/analyse" as never)} />}
        </View>
      </GameOverCard>
    </View>
  );

  if (wide) {
    // wide screens: controls and leaderboard on the left, the board at full height, events on the right
    return (
      <View style={{ flex: 1, flexDirection: "row", padding: 12 }}>
        <ScrollView style={{ width: 460, flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 12 }}>
          <View style={{ backgroundColor: "#16213ee8", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "#ffffff1f", marginBottom: 12 }}>
            {status}
            <View style={{ marginTop: 8 }}>{quickBar}</View>
            {controls}
          </View>
          <Leaderboard state={s} label={who} />
          {nowPlaying}
        </ScrollView>
        <View style={{ flex: 1 }}>{map}</View>
        <View style={{ width: 330 }}>
          <EventFeed events={events} upTo={k} />
        </View>
        {endCard}
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, width: "100%", maxWidth: 640, alignSelf: "center" }}>{status}</View>
      <View style={{ flex: 1 }}>
        {map}
        {overlay && (
          <View style={{ position: "absolute", left: 12, right: 12, top: 8, bottom: 8, zIndex: 20, maxWidth: 520, alignSelf: "center" }}>
            {overlay === "board" ? (
              <ScrollView>
                <Leaderboard state={s} label={who} />
                {nowPlaying}
              </ScrollView>
            ) : (
              <EventFeed events={events} upTo={k} />
            )}
          </View>
        )}
      </View>
      {endCard}
      <View style={{ backgroundColor: "#223154f2", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 14, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        {quickBar}
        {controls}
      </View>
    </View>
  );
}
