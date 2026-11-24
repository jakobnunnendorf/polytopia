import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Svg, { Path } from "react-native-svg";
import { ImageBackground, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as Font from "expo-font";
import * as Haptics from "expo-haptics";
import { Banner, Pop, Pulse, Ticker, pressScale, useDots } from "@/components/anim";
import GameOverCard from "@/components/game/GameOverCard";
import { useLocalSearchParams, useRouter } from "expo-router";
import Map from "@/components/Map/Map";
import type { Highlight } from "@/components/Map/Tile";
import { CityArt, ShardIcon, TribeEmblem, UnitArt } from "@/components/art/Art";
import { BUILDS, UNITS, embassyCost } from "@/logic/engine/data";
import {
  applyAction,
  createGame,
  dominationRating,
  dominationStars,
  income,
  legalActions,
  resourceVisible,
  perfectionRating,
  perfectionStars,
  scoreOf,
  techCost,
} from "@/logic/engine";
import TechTree from "@/components/game/TechTree";
import { actionLabel, name } from "@/logic/engine/names";
import type { Action, Difficulty, GameMode, GameState } from "@/logic/engine/types";
import { PLAYER_COLORS, UI } from "@/components/game/theme";
import { arena, serverChat } from "@/components/game/arenaClient";
import { BUILTIN_MODELS, DEFAULT_MODEL, createAgent } from "@/logic/agents/registry";
import type { ModelSpec } from "@/logic/agents/types";
import { finishRecord, recordStep, replayStates, startRecord, type GameRecord, type Seat } from "@/logic/arena/record";

const clanColor = (p: number) => PLAYER_COLORS[p % PLAYER_COLORS.length];

type Selection = { x: number; y: number } | null;

/** primary = gold (one per screen), secondary = quiet panel button, ghost = outline only */
function Button({
  label,
  onPress,
  disabled,
  kind = "secondary",
  testID,
  grow,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "ghost";
  testID?: string;
  grow?: boolean;
}) {
  const bg = disabled ? UI.panelHi : kind === "primary" ? UI.gold : kind === "secondary" ? UI.panelHi : "transparent";
  const fg = disabled ? UI.muted : kind === "primary" ? UI.goldInk : UI.mist;
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexGrow: grow ? 1 : 0,
        backgroundColor: bg,
        opacity: pressed ? 0.85 : 1,
        transform: pressScale(pressed),
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: kind === "ghost" ? 1 : 0,
        borderColor: UI.line,
        alignItems: "center",
        marginRight: 8,
        marginTop: 8,
      })}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

function Shards({ n, size = 18 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <ShardIcon size={size} />
      <Text style={{ color: UI.mist, fontWeight: "800", fontSize: size, marginLeft: 4 }}>{n}</Text>
    </View>
  );
}

/** low-poly open book: the Lore wheel */
function BookIcon({ size = 26, ink = UI.mist }: { size?: number; ink?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 30 L14 22 L14 76 L50 84 Z" fill={UI.sky} />
      <Path d="M50 30 L86 22 L86 76 L50 84 Z" fill={ink} />
      <Path d="M50 30 L50 84 L46 83 L46 31 Z" fill={UI.dusk} opacity={0.35} />
      <Path d="M22 36 L42 40 M22 48 L42 52 M58 40 L78 36 M58 52 L78 48" stroke={UI.dusk} strokeWidth={4} strokeLinecap="round" opacity={0.45} />
    </Svg>
  );
}

/** low-poly house: back to the menu */
function HomeIcon({ size = 26, ink = UI.mist }: { size?: number; ink?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 16 L12 50 L50 50 Z" fill={UI.coral} />
      <Path d="M50 16 L88 50 L50 50 Z" fill="#c95c45" />
      <Path d="M22 50 L78 50 L78 86 L22 86 Z" fill={ink} />
      <Path d="M42 62 L58 62 L58 86 L42 86 Z" fill={UI.dusk} opacity={0.6} />
    </Svg>
  );
}

function IconButton({
  label,
  onPress,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 48,
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: UI.line,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 8,
        marginTop: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

function HpBar({ hp, max, color }: { hp: number; max: number; color: string }) {
  return (
    <View style={{ width: 64, height: 6, borderRadius: 3, backgroundColor: UI.dusk, marginLeft: 8 }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, hp / max)) * 100}%`,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function parseSeats(raw: string | undefined, players: number, watch: boolean): Seat[] {
  try {
    const s = raw ? (JSON.parse(raw) as Seat[]) : null;
    if (Array.isArray(s) && s.length >= 2) return watch ? s.map(() => ({ kind: "model", modelId: DEFAULT_MODEL })) : s;
  } catch {
    // fall through to the classic setup
  }
  return Array.from({ length: players }, (_, i) =>
    i === 0 && !watch ? { kind: "human", profileId: "guest", name: "Guest" } : { kind: "model", modelId: DEFAULT_MODEL },
  ) as Seat[];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function GameScreen({ resumed }: { resumed?: GameRecord } = {}) {
  const params = useLocalSearchParams<{
    mapSize?: string;
    players?: string;
    mode?: string;
    difficulty?: string;
    seed?: string;
    watch?: string;
    seats?: string;
  }>();
  // ?watch=1: models play every clan, so you can watch a whole game unfold
  const watch = params.watch === "1";
  const router = useRouter();

  useEffect(() => {
    Font.loadAsync({ "Oi-Regular": require("@/assets/fonts/Oi-Regular.ttf") }).catch(() => {});
  }, []);

  const seats = useMemo(
    () => resumed?.seats ?? parseSeats(params.seats, Math.max(2, Number(params.players ?? 2)), watch),
    [resumed, params.seats, params.players, watch],
  );
  const humanSeats = useMemo(() => seats.flatMap((s, i) => (s.kind === "human" ? [i] : [])), [seats]);

  const [state, setState] = useState<GameState>(() => {
    if (resumed) return replayStates(resumed).pop()!;
    const hasExplicitTribes = seats.some((s) => !!s.clan);
    const chosenClans = hasExplicitTribes
      ? seats.map((s, i) => s.clan ?? ["imperius", "bardur", "aquarion", "elyrion", "polaris", "cymanti"][i % 6])
      : undefined;
    return createGame({
      mapSize: params.mapSize ? Number(params.mapSize) : undefined,
      players: seats.length,
      mode: (params.mode as GameMode) ?? "perfection",
      difficulty: (params.difficulty as Difficulty) ?? "normal",
      seed: Number(params.seed ?? 1),
      humans: humanSeats,
      clans: chosenClans,
    });
  });
  // the record of every action, saved to the repo through the arena server
  const stateRef = useRef(state);
  const recRef = useRef<GameRecord>(
    resumed ? { ...resumed, endedAt: null, result: null } : startRecord(state, seats, humanSeats.length ? "play" : "arena"),
  );
  const savedRef = useRef(false);
  const [saved, setSaved] = useState<{ file: string; deltas: number[] } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** apply one action: the only way the game state changes */
  const commit = useCallback((a: Action) => {
    const before = stateRef.current;
    const next = applyAction(before, a);
    recordStep(recRef.current, before, a, next);
    stateRef.current = next;
    return next;
  }, []);

  // opponent models: built-in specs, replaced by models/<id>/model.json from the arena server
  const [models, setModels] = useState<ModelSpec[]>(BUILTIN_MODELS);
  useEffect(() => {
    arena
      .models()
      .then((m) => m.length && setModels(m.filter((x) => x.kind !== "external")))
      .catch(() => {});
  }, []);
  const agents = useMemo(
    () =>
      seats.map((seat) => {
        if (seat.kind !== "model") return null;
        const spec = models.find((m) => m.id === seat.modelId) ?? models.find((m) => m.id === DEFAULT_MODEL)!;
        return createAgent(spec, serverChat, models);
      }),
    [seats, models],
  );
  const [thinking, setThinking] = useState<string | null>(null);

  // hot-seat: whose eyes the map is drawn for. With several humans, the next one
  // has to tap "I'm here" first so nobody sees another player's fog.
  const [viewer, setViewer] = useState<number>(humanSeats[0] ?? 0);
  const handoff =
    !state.over && !watch && humanSeats.length > 1 && seats[state.current]?.kind === "human" && viewer !== state.current;
  useEffect(() => {
    if (humanSeats.length === 1) setViewer(humanSeats[0]);
  }, [humanSeats]);

  const [selected, setSelected] = useState<Selection>(null);
  const [techOpen, setTechOpen] = useState(false);

  const myTurn = state.current === viewer && seats[viewer]?.kind === "human" && !state.over && !watch && !handoff;
  const actions = useMemo(() => (myTurn ? legalActions(state) : []), [state, myTurn]);

  // models play their turns; slow models (the LLM) redraw after every move
  useEffect(() => {
    const agent = agents[state.current];
    if (state.over || !agent) return;
    let cancelled = false;
    const p = state.current;
    // every bot move takes the same time (thinking included), so it is pleasant to follow
    const PACE = 480;
    (async () => {
      await wait(300);
      if (agent.spec.kind === "llm") setThinking(agent.spec.name);
      let n = 0;
      while (!cancelled && !stateRef.current.over && stateRef.current.current === p) {
        const t0 = Date.now();
        const a = n++ > 300 ? ({ type: "endTurn" } as Action) : await agent.act(stateRef.current);
        if (cancelled) return;
        await wait(Math.max(0, PACE - (Date.now() - t0)));
        if (cancelled) return;
        setState(commit(a));
      }
      if (!cancelled) {
        setThinking(null);
        setState(stateRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.current, state.turn, state.over, agents, watch, commit]);

  const act = useCallback(
    (a: Action) => {
      if (Platform.OS !== "web") {
        const heavy = a.type === "attack" || a.type === "endTurn" || a.type === "capture";
        Haptics.impactAsync(heavy ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      setState(commit(a));
    },
    [commit],
  );

  // save the record when the game ends (rated) or when the player leaves early (unrated)
  const saveRecord = useCallback(() => {
    if (savedRef.current || recRef.current.steps.length === 0) return;
    savedRef.current = true;
    const rec = finishRecord(recRef.current, stateRef.current);
    arena
      .saveGame(rec)
      .then((r) => setSaved({ file: r.file, deltas: r.deltas }))
      .catch(() => {
        savedRef.current = false;
        setSaveError("Not recorded: the arena server is not running (npm run arena-server).");
      });
  }, []);
  useEffect(() => {
    if (state.over) saveRecord();
  }, [state.over, saveRecord]);
  // autosave at the start of every round, so an unfinished game can be resumed from the menu
  useEffect(() => {
    if (state.over || recRef.current.steps.length === 0) return;
    arena.saveGame({ ...recRef.current, endedAt: null, result: null }).catch(() => {});
  }, [state.turn, state.over]);
  useEffect(
    () => () => {
      if (!savedRef.current && recRef.current.steps.length > 0 && !stateRef.current.over) {
        arena.saveGame({ ...recRef.current, endedAt: null, result: null }).catch(() => {});
      }
    },
    [],
  );
  const leave = () => {
    saveRecord();
    router.replace("/");
  };

  const seatName = (i: number) => {
    const s = seats[i];
    if (!s) return "";
    return s.kind === "human" ? s.name : (models.find((m) => m.id === s.modelId)?.name ?? s.modelId);
  };

  const unitAtSel = selected
    ? (state.units.find((u) => u.x === selected.x && u.y === selected.y) ?? null)
    : null;
  const tileSel = selected ? state.tiles[selected.y * state.mapSize + selected.x] : null;
  const citySel =
    tileSel && tileSel.cityId !== null
      ? (state.cities.find((c) => c.id === tileSel.cityId) ?? null)
      : null;

  // move/attack targets of the selected unit
  const highlights = useMemo(() => {
    const h: Record<string, Highlight> = {};
    if (selected) h[`${selected.x},${selected.y}`] = "selected";
    if (unitAtSel && unitAtSel.owner === viewer) {
      for (const a of actions) {
        if (a.type === "move" && a.unitId === unitAtSel.id) h[`${a.to.x},${a.to.y}`] = "move";
        if (a.type === "attack" && a.unitId === unitAtSel.id) {
          const t = state.units.find((u) => u.id === a.targetId);
          if (t) h[`${t.x},${t.y}`] = "attack";
        }
      }
    }
    return h;
  }, [selected, unitAtSel, actions, state.units]);

  const onTilePress = useCallback(
    (x: number, y: number) => {
      if (unitAtSel && unitAtSel.owner === viewer && myTurn) {
        const target = state.units.find((u) => u.x === x && u.y === y);
        const attack = target
          ? actions.find(
              (a) => a.type === "attack" && a.unitId === unitAtSel.id && a.targetId === target.id,
            )
          : undefined;
        if (attack) {
          act(attack);
          setSelected(null);
          return;
        }
        const move = actions.find(
          (a) => a.type === "move" && a.unitId === unitAtSel.id && a.to.x === x && a.to.y === y,
        );
        if (move) {
          act(move);
          setSelected({ x, y });
          return;
        }
      }
      setSelected((s) => (s && s.x === x && s.y === y ? null : { x, y }));
    },
    [unitAtSel, myTurn, actions, state.units, act],
  );

  // actions relevant to the current selection (besides moves/attacks)
  const selActions = useMemo(() => {
    if (!selected) return [];
    return actions.filter((a) => {
      switch (a.type) {
        case "capture":
        case "recover":
        case "examine":
        case "disband":
        case "upgrade":
        case "promote":
        case "healOthers":
        case "harvestStarfish":
        case "infiltrate":
        case "freezeArea":
        case "boost":
        case "explode":
        case "breakIce":
        case "drain":
          return unitAtSel !== null && a.unitId === unitAtSel.id;
        case "train":
          return citySel !== null && a.cityId === citySel.id;
        case "decompose":
        case "build":
          return a.at.x === selected.x && a.at.y === selected.y;
        // a tribe's diplomacy options show when one of its cities or units is selected
        case "offerPeace":
        case "breakPeace":
          return (citySel !== null && citySel.owner === a.player) || (unitAtSel !== null && unitAtSel.owner === a.player);
        default:
          return false;
      }
    });
  }, [actions, selected, unitAtSel, citySel]);
  // peace offers waiting for an answer this turn
  const peaceReplies = actions.filter((a) => a.type === "acceptPeace" || a.type === "declinePeace");

  const rewardActions = actions.filter((a) => a.type === "reward");
  // nothing left that moves a unit or spends shards wisely: nudge toward End turn
  const nothingLeft = myTurn && rewardActions.length === 0 && !actions.some((a) => a.type === "move" || a.type === "attack" || a.type === "capture");
  const dots = useDots(!myTurn && !state.over);
  // "Turn N" banner whenever a human turn starts
  const bannerKey = myTurn ? `${state.turn}-${state.current}` : null;
  const rewardCity =
    rewardActions.length > 0
      ? state.cities.find((c) => c.id === (rewardActions[0] as { cityId: number }).cityId)
      : undefined;
  const me = state.players[viewer];
  const researchable = new Set(
    actions.filter((a) => a.type === "research").map((a) => (a as { tech: string }).tech),
  );
  const seen = selected ? me.explored[selected.y * state.mapSize + selected.x] === 1 : false;
  const tileWords =
    tileSel && seen
      ? [
          tileSel.resource && resourceVisible(state, me.id, tileSel.resource) ? name("resource", tileSel.resource) : null,
          tileSel.building ? name("building", tileSel.building) : null,
          tileSel.village ? "Village" : null,
          tileSel.ruin ? "Ruins" : null,
        ].filter((w): w is string => !!w)
      : [];
  const ranking = [...state.players]
    .map((p) => ({ p, score: scoreOf(state, p.id) }))
    .sort((a, b) => b.score - a.score);
  const winnerClan = state.winner !== null ? name("clan", state.players[state.winner].clan) : "";

  return (
    <ImageBackground
      source={require("@/assets/images/menu-background.webp")}
      resizeMode="cover"
      style={{ flex: 1, backgroundColor: UI.dusk }}
    >
      {/* a dusk veil calms the busy landscape so the map stays the focus */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#16213a66" }} />
      {/* Polytopia-style Top HUD: Score (left) · Stars (+income) (center) · Turn + Tribe (right) */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 9,
          marginTop: 10,
          width: "94%",
          maxWidth: 640,
          alignSelf: "center",
          borderRadius: 16,
          backgroundColor: "#0e1a30e8",
          borderWidth: 1,
          borderColor: "#36589488",
        }}
      >
        <View style={{ alignItems: "flex-start", minWidth: 84 }}>
          <Text style={{ color: UI.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>Score</Text>
          <Ticker value={scoreOf(state, viewer)} float={false} format={(n) => n.toLocaleString("en")} style={{ color: UI.mist, fontSize: 19, fontWeight: "800" }} />
        </View>
        <View testID="hud-shards" style={{ alignItems: "center" }}>
          <Text style={{ color: UI.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>Stars</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ShardIcon size={20} />
            <Ticker value={me.stars} style={{ color: UI.mist, fontWeight: "800", fontSize: 21, marginLeft: 4 }} />
            <Text style={{ color: UI.gold, fontSize: 13, fontWeight: "800", marginLeft: 4 }}>
              (+{income(state, viewer)})
            </Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end", minWidth: 96 }}>
          <Text style={{ color: UI.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>
            Turn {state.turn}{state.mode === "perfection" ? `/${state.maxTurns}` : ""}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 1 }}>
            <TribeEmblem clan={me.clan} size={20} />
            <Text style={{ color: clanColor(viewer), fontSize: 13, fontWeight: "800", marginLeft: 4 }}>
              {name("clan", me.clan)}
            </Text>
          </View>
        </View>
      </View>

      {bannerKey && (
        <Banner key={bannerKey} style={{ position: "absolute", top: 86, left: 0, right: 0, alignItems: "center", zIndex: 20 }}>
          <View style={{ backgroundColor: "#1b2846ee", paddingHorizontal: 22, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: clanColor(viewer) }}>
            <Text style={{ color: UI.mist, fontFamily: UI.display, fontSize: 26, textAlign: "center" }}>Turn {state.turn}</Text>
            <Text style={{ color: clanColor(viewer), fontSize: 13, fontWeight: "700", textAlign: "center" }}>
              {seatName(viewer)}, your move
            </Text>
          </View>
        </Banner>
      )}
      <Map state={state} viewer={viewer} highlights={highlights} onTilePress={onTilePress} />

      {/* Polytopia-style selection card + circular action tray */}
      <View
        style={{
          backgroundColor: "#0e1a30f2",
          borderTopWidth: 1,
          borderTopColor: "#36589488",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 16,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
        }}
      >
        {peaceReplies.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
            {peaceReplies.map((a, i) => (
              <Button key={`peace-${i}`} label={actionLabel(state, a)} onPress={() => act(a)} />
            ))}
          </ScrollView>
        )}
        <View style={{ height: 108, justifyContent: "center" }}>
          {selected && seen && tileSel ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {(unitAtSel || citySel) && (
                  <View style={{ width: 44, height: 44, marginRight: 10, borderRadius: 10, backgroundColor: "#1c3158", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {unitAtSel ? (
                      <UnitArt type={unitAtSel.type} color={clanColor(unitAtSel.owner)} size={42} />
                    ) : citySel ? (
                      <CityArt color={clanColor(citySel.owner)} level={citySel.level} capital={citySel.capital} walls={citySel.walls} size={42} />
                    ) : null}
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" }}>
                    <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800", marginRight: 8 }}>
                      {unitAtSel ? name("unit", unitAtSel.type) : citySel ? citySel.name : name("terrain", tileSel.terrain)}
                    </Text>
                    <Text style={{ color: UI.muted, fontSize: 13 }}>
                      {citySel
                        ? `Lv ${citySel.level}${citySel.capital ? " Capital" : ""} · ${citySel.pop}/${citySel.level + 1} pop`
                        : tileWords.join(", ")}
                    </Text>
                  </View>
                  {unitAtSel && (
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                      <HpBar hp={unitAtSel.hp} max={unitAtSel.maxHp} color={clanColor(unitAtSel.owner)} />
                      <Text style={{ color: UI.mist, fontSize: 12, fontWeight: "700", marginLeft: 6 }}>
                        {Math.ceil(unitAtSel.hp)}/{unitAtSel.maxHp} HP
                      </Text>
                      <Text style={{ color: UI.muted, fontSize: 11, marginLeft: 8 }}>
                        {UNITS[unitAtSel.type].attack} ATK · {UNITS[unitAtSel.type].defence} DEF · {UNITS[unitAtSel.type].movement} MOV · {UNITS[unitAtSel.type].range} RNG
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              {selActions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  {selActions.map((a, i) => {
                    const cost =
                      a.type === "train" ? UNITS[a.unit]?.cost :
                      a.type === "build" ? (a.building === "embassy" ? embassyCost(state.players[state.current].embassies.length) : BUILDS[a.building]?.cost) :
                      a.type === "upgrade" ? UNITS[a.to]?.cost : 0;
                    const label = cost && cost > 0 ? `${actionLabel(state, a)} (${cost}★)` : actionLabel(state, a);
                    return <Button key={i} label={label} onPress={() => act(a)} />;
                  })}
                </ScrollView>
              )}
            </>
          ) : selected ? (
            <Text style={{ color: UI.muted, fontSize: 14 }}>Nobody from your tribe has been here yet.</Text>
          ) : watch ? (
            <Text style={{ color: UI.muted, fontSize: 14 }}>Watching the models play every tribe.</Text>
          ) : (
            <Text style={{ color: UI.muted, fontSize: 14, lineHeight: 20 }}>
              Tap a unit or city to act. Blue tiles are moves, red tiles are attacks.
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
          <IconButton label="Back to the menu" testID="menu-button" onPress={leave}>
            <HomeIcon />
          </IconButton>
          <Pressable
            testID="tech-button"
            onPress={() => setTechOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Tech Tree"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#1d63b8",
              borderWidth: 1,
              borderColor: "#38bdf8",
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderRadius: 12,
              marginRight: 8,
              marginTop: 8,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <BookIcon size={20} ink="#ffffff" />
            <Text style={{ color: "#ffffff", fontWeight: "800", fontSize: 14, marginLeft: 6 }}>Tech Tree</Text>
          </Pressable>
          <Pulse on={nothingLeft} amount={0.03} period={1400} style={{ flexGrow: 1 }}>
            <Button
              grow
              kind="primary"
              label={myTurn ? "End Turn" : thinking ? `${thinking} is thinking${dots}` : `${seatName(state.current)} is moving${dots}`}
              testID="end-turn"
              disabled={!myTurn || rewardActions.length > 0}
              onPress={() => {
                setSelected(null);
                act({ type: "endTurn" });
              }}
            />
          </Pulse>
        </View>
      </View>

      {/* lore wheel */}
      <Modal visible={techOpen} animationType="slide" onRequestClose={() => setTechOpen(false)}>
        <TechTree
          known={me.techs}
          researchable={researchable}
          costOf={(t) => techCost(state, viewer, t)}
          stars={me.stars}
          clanColor={clanColor(viewer)}
          clanId={me.clan}
          clanName={name("clan", me.clan)}
          onLearn={(t) => act({ type: "research", tech: t })}
          onClose={() => setTechOpen(false)}
        />
      </Modal>

      {/* level-up reward */}
      <Modal visible={rewardActions.length > 0} transparent animationType="fade">
        <View
          style={{ flex: 1, backgroundColor: "#0a1020bb", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <Pop force from={0.85} style={{ width: "100%", maxWidth: 420 }}>
          <View style={{ backgroundColor: UI.panel, padding: 20, borderRadius: 20, width: "100%" }}>
            <Text style={{ color: UI.mist, fontSize: 26, fontFamily: UI.display }}>
              {rewardCity ? `${rewardCity.name} leveled up!` : "City leveled up!"}
            </Text>
            <Text style={{ color: UI.muted, fontSize: 14, marginTop: 4, marginBottom: 4 }}>
              Reached level {rewardCity?.level ?? ""}. Choose a reward:
            </Text>
            {rewardActions.map((a, i) => (
              <Pop force key={i} delay={180 + i * 90} from={0.8}>
                <View style={{ flexDirection: "row" }}>
                  <Button grow testID={`reward-${i}`} label={actionLabel(state, a)} onPress={() => act(a)} />
                </View>
              </Pop>
            ))}
          </View>
          </Pop>
        </View>
      </Modal>

      {/* hot-seat hand-off: hide the map until the next player is at the device */}
      <Modal visible={handoff} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: UI.dusk, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: clanColor(state.current), marginBottom: 12 }} />
          <Text style={{ color: UI.mist, fontSize: 34, fontFamily: UI.display, textAlign: "center" }}>
            {seatName(state.current)}, your turn
          </Text>
          <Text style={{ color: UI.muted, fontSize: 15, textAlign: "center", marginTop: 8, marginBottom: 20 }}>
            Pass the device to {seatName(state.current)}. The map stays hidden until they tap below.
          </Text>
          <Button kind="primary" testID="handoff-ready" label={`I'm ${seatName(state.current)}, show my map`} onPress={() => setViewer(state.current)} />
        </View>
      </Modal>

      {/* game over */}
      <Modal visible={state.over} transparent animationType="fade">
        <View
          style={{ flex: 1, backgroundColor: "#0a1020dd", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <GameOverCard
            title={humanSeats.length !== 1 ? `${seatName(state.winner ?? 0)} wins` : state.winner === viewer ? "Victory" : "Defeat"}
            good={humanSeats.length !== 1 || state.winner === viewer}
            subtitle={
              `The ${winnerClan} rule the Square.` +
              (state.mode === "perfection"
                ? ` Your rating: ${perfectionRating(state, viewer).toLocaleString("en")} (${
                    ["no stars", "1 star", "2 stars", "3 stars", "a halo"][perfectionStars(perfectionRating(state, viewer))]
                  }).`
                : state.mode === "domination"
                  ? ` Your rating: ${Math.round(dominationRating(state, viewer) * 100)}% (${
                      ["no stars", "1 star", "2 stars", "3 stars", "a halo"][dominationStars(dominationRating(state, viewer))]
                    }).`
                  : "")
            }
            standings={ranking.map(({ p, score }) => ({
              id: p.id,
              name: seatName(p.id),
              clan: name("clan", p.clan),
              score,
              alive: p.alive,
              elo: saved ? saved.deltas[p.id] : undefined,
            }))}
            footer={saved ? `Recorded in ${saved.file}` : (saveError ?? "Recording the game")}
          >
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              <Button grow kind="primary" label="Back to the menu" onPress={leave} />
            </View>
          </GameOverCard>
        </View>
      </Modal>
    </ImageBackground>
  );
}
