import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ImageBackground, Modal, Pressable, ScrollView, Text, View } from "react-native";
import * as Font from "expo-font";
import { useLocalSearchParams, useRouter } from "expo-router";
import Map from "@/components/Map/Map";
import type { Highlight } from "@/components/Map/Tile";
import { ShardIcon } from "@/components/art/Art";
import {
  applyAction,
  createGame,
  income,
  legalActions,
  playBotTurn,
  scoreOf,
  techCost,
} from "@/logic/engine";
import TechTree from "@/components/game/TechTree";
import { actionLabel, name } from "@/logic/engine/names";
import type { Action, GameMode, GameState } from "@/logic/engine/types";
import { PLAYER_COLORS, UI } from "@/components/game/theme";

const HUMAN = 0;
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
        opacity: pressed ? 0.8 : 1,
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

export default function GameScreen() {
  const params = useLocalSearchParams<{
    mapSize?: string;
    players?: string;
    mode?: string;
    seed?: string;
    watch?: string;
  }>();
  // ?watch=1: a bot plays your clan too, so you can watch a whole game unfold
  const watch = params.watch === "1";
  const router = useRouter();

  useEffect(() => {
    Font.loadAsync({ "Oi-Regular": require("@/assets/fonts/Oi-Regular.ttf") }).catch(() => {});
  }, []);

  const [state, setState] = useState<GameState>(() =>
    createGame({
      mapSize: Number(params.mapSize ?? 11),
      players: Math.max(2, Number(params.players ?? 2)),
      mode: (params.mode as GameMode) ?? "perfection",
      seed: Number(params.seed ?? 1),
      humans: watch ? [] : [HUMAN],
    }),
  );
  const [selected, setSelected] = useState<Selection>(null);
  const [techOpen, setTechOpen] = useState(false);

  const myTurn = state.current === HUMAN && !state.over && !watch;
  const actions = useMemo(() => (myTurn ? legalActions(state) : []), [state, myTurn]);

  // let the bots play, one turn per timer tick so the map redraws in between
  useEffect(() => {
    if (state.over || !(watch || state.players[state.current].bot)) return;
    const t = setTimeout(() => setState((s) => playBotTurn(s)), watch ? 120 : 250);
    return () => clearTimeout(t);
  }, [state, watch]);

  const act = useCallback((a: Action) => {
    setState((s) => applyAction(s, a));
  }, []);

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
    if (unitAtSel && unitAtSel.owner === HUMAN) {
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
      if (unitAtSel && unitAtSel.owner === HUMAN && myTurn) {
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
          return unitAtSel !== null && a.unitId === unitAtSel.id;
        case "train":
          return citySel !== null && a.cityId === citySel.id;
        case "build":
          return a.at.x === selected.x && a.at.y === selected.y;
        default:
          return false;
      }
    });
  }, [actions, selected, unitAtSel, citySel]);

  const rewardActions = actions.filter((a) => a.type === "reward");
  const rewardCity =
    rewardActions.length > 0
      ? state.cities.find((c) => c.id === (rewardActions[0] as { cityId: number }).cityId)
      : undefined;
  const me = state.players[HUMAN];
  const researchable = new Set(
    actions.filter((a) => a.type === "research").map((a) => (a as { tech: string }).tech),
  );
  const seen = selected ? me.explored[selected.y * state.mapSize + selected.x] === 1 : false;
  const tileWords =
    tileSel && seen
      ? [
          tileSel.resource ? name("resource", tileSel.resource) : null,
          tileSel.building ? name("building", tileSel.building) : null,
          tileSel.village ? "Hamlet" : null,
          tileSel.ruin ? "Old ruin" : null,
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
      {/* HUD */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 10,
          marginTop: 10,
          width: "94%",
          maxWidth: 640,
          alignSelf: "center",
          borderRadius: 16,
          backgroundColor: "#1b2846e0",
        }}
      >
        <View testID="hud-shards">
          <Shards n={me.stars} size={22} />
          <Text style={{ color: UI.gold, fontSize: 12, fontWeight: "700", marginTop: 2 }}>
            +{income(state, HUMAN)} next turn
          </Text>
        </View>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: UI.mist, fontSize: 16, fontWeight: "800" }}>
            Turn {state.turn}
            {state.mode === "perfection" ? ` of ${state.maxTurns}` : ""}
          </Text>
          <Text style={{ color: clanColor(HUMAN), fontSize: 12, fontWeight: "700", marginTop: 2 }}>
            {name("clan", me.clan)}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: UI.mist, fontSize: 16, fontWeight: "800" }}>
            {scoreOf(state, HUMAN).toLocaleString("en")}
          </Text>
          <Text style={{ color: UI.muted, fontSize: 12, marginTop: 2 }}>score</Text>
        </View>
      </View>

      <Map state={state} viewer={HUMAN} highlights={highlights} onTilePress={onTilePress} />

      {/* selection card + action tray */}
      <View
        style={{
          backgroundColor: "#223154f2",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 18,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
        }}
      >
        <View style={{ minHeight: 64 }}>
          {selected && seen && tileSel ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" }}>
                <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800", marginRight: 8 }}>
                  {citySel ? citySel.name : name("terrain", tileSel.terrain)}
                </Text>
                <Text style={{ color: UI.muted, fontSize: 14 }}>
                  {citySel
                    ? `level ${citySel.level}${citySel.capital ? " capital" : ""}, ${citySel.pop} of ${citySel.level + 1} people to grow`
                    : tileWords.join(", ")}
                </Text>
              </View>
              {unitAtSel && (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: clanColor(unitAtSel.owner),
                      marginRight: 6,
                    }}
                  />
                  <Text style={{ color: UI.mist, fontSize: 14, fontWeight: "700" }}>
                    {name("unit", unitAtSel.type)}
                    {unitAtSel.carried ? ` carrying ${name("unit", unitAtSel.carried)}` : ""}
                    {unitAtSel.veteran ? ", veteran" : ""}
                  </Text>
                  <HpBar hp={unitAtSel.hp} max={unitAtSel.maxHp} color={clanColor(unitAtSel.owner)} />
                  <Text style={{ color: UI.muted, fontSize: 12, marginLeft: 6 }}>
                    {Math.ceil(unitAtSel.hp)}/{unitAtSel.maxHp}
                  </Text>
                </View>
              )}
              {selActions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {selActions.map((a, i) => (
                    <Button key={i} label={actionLabel(state, a)} onPress={() => act(a)} />
                  ))}
                </ScrollView>
              )}
            </>
          ) : selected ? (
            <Text style={{ color: UI.muted, fontSize: 14 }}>Nobody from your clan has been here yet.</Text>
          ) : watch ? (
            <Text style={{ color: UI.muted, fontSize: 14 }}>Watching the bots play every clan.</Text>
          ) : (
            <Text style={{ color: UI.muted, fontSize: 14, lineHeight: 20 }}>
              Tap one of your units to see where it can go. Blue tiles are moves, coral tiles are attacks.
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row" }}>
          <Button label="Lore" kind="ghost" testID="tech-button" onPress={() => setTechOpen(true)} />
          <Button
            grow
            kind="primary"
            label={myTurn ? "End turn" : "Rivals are moving"}
            testID="end-turn"
            disabled={!myTurn || rewardActions.length > 0}
            onPress={() => {
              setSelected(null);
              act({ type: "endTurn" });
            }}
          />
        </View>
      </View>

      {/* lore wheel */}
      <Modal visible={techOpen} animationType="slide" onRequestClose={() => setTechOpen(false)}>
        <TechTree
          known={me.techs}
          researchable={researchable}
          costOf={(t) => techCost(state, HUMAN, t)}
          stars={me.stars}
          clanColor={clanColor(HUMAN)}
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
          <View style={{ backgroundColor: UI.panel, padding: 20, borderRadius: 20, width: "100%", maxWidth: 420 }}>
            <Text style={{ color: UI.mist, fontSize: 26, fontFamily: UI.display }}>
              {rewardCity ? `${rewardCity.name} grew` : "A city grew"}
            </Text>
            <Text style={{ color: UI.muted, fontSize: 14, marginTop: 4, marginBottom: 4 }}>
              It reached level {rewardCity?.level ?? ""}. Choose one boon for it.
            </Text>
            {rewardActions.map((a, i) => (
              <View key={i} style={{ flexDirection: "row" }}>
                <Button grow testID={`reward-${i}`} label={actionLabel(state, a)} onPress={() => act(a)} />
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* game over */}
      <Modal visible={state.over} transparent animationType="fade">
        <View
          style={{ flex: 1, backgroundColor: "#0a1020dd", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <View style={{ backgroundColor: UI.panel, padding: 24, borderRadius: 20, width: "100%", maxWidth: 420 }}>
            <Text
              style={{
                color: state.winner === HUMAN ? UI.gold : UI.coral,
                fontSize: 44,
                fontFamily: UI.display,
                textAlign: "center",
              }}
              testID="game-over"
            >
              {state.winner === HUMAN ? "Victory" : "Defeat"}
            </Text>
            <Text style={{ color: UI.muted, fontSize: 14, textAlign: "center", marginTop: 4, marginBottom: 14 }}>
              The {winnerClan} hold the Shardlands.
            </Text>
            {ranking.map(({ p, score }) => (
              <View
                key={p.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 9,
                  borderTopWidth: 1,
                  borderTopColor: UI.line,
                }}
              >
                <View
                  style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: clanColor(p.id), marginRight: 10 }}
                />
                <Text style={{ color: p.alive ? UI.mist : UI.muted, fontSize: 15, fontWeight: "700", flex: 1 }}>
                  {name("clan", p.clan)}
                  {p.id === HUMAN && !watch ? " (you)" : ""}
                  {p.alive ? "" : ", fallen"}
                </Text>
                <Text style={{ color: UI.mist, fontSize: 15, fontWeight: "800" }}>{score.toLocaleString("en")}</Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", marginTop: 6 }}>
              <Button grow kind="primary" label="Back to the menu" onPress={() => router.replace("/")} />
            </View>
          </View>
        </View>
      </Modal>
    </ImageBackground>
  );
}
