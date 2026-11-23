import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Map from "@/components/Map/Map";
import type { Highlight } from "@/components/Map/Tile";
import {
  applyAction,
  createGame,
  income,
  legalActions,
  playBotTurn,
  scoreOf,
  techCost,
} from "@/logic/engine";
import { TECHS } from "@/logic/engine/data";
import { actionLabel, name } from "@/logic/engine/names";
import type { Action, GameMode, GameState } from "@/logic/engine/types";
import { PLAYER_COLORS } from "@/components/game/theme";

const HUMAN = 0;

type Selection = { x: number; y: number } | null;

function Button({
  label,
  onPress,
  disabled,
  color = "#e8a33d",
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: disabled ? "#6b7280" : color,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 9,
        margin: 3,
      }}
    >
      <Text style={{ color: "white", fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export default function GameScreen() {
  const params = useLocalSearchParams<{
    mapSize?: string;
    players?: string;
    mode?: string;
    seed?: string;
  }>();
  const router = useRouter();

  const [state, setState] = useState<GameState>(() =>
    createGame({
      mapSize: Number(params.mapSize ?? 11),
      players: Math.max(2, Number(params.players ?? 2)),
      mode: (params.mode as GameMode) ?? "perfection",
      seed: Number(params.seed ?? 1),
      humans: [HUMAN],
    }),
  );
  const [selected, setSelected] = useState<Selection>(null);
  const [techOpen, setTechOpen] = useState(false);

  const myTurn = state.current === HUMAN && !state.over;
  const actions = useMemo(() => (myTurn ? legalActions(state) : []), [state, myTurn]);

  // let the bots play, one turn per animation frame so the map redraws in between
  useEffect(() => {
    if (state.over || !state.players[state.current].bot) return;
    const t = setTimeout(() => setState((s) => playBotTurn(s)), 250);
    return () => clearTimeout(t);
  }, [state]);

  const act = useCallback((a: Action) => {
    setState((s) => applyAction(s, a));
  }, []);

  const unitAtSel = selected
    ? state.units.find((u) => u.x === selected.x && u.y === selected.y) ?? null
    : null;
  const tileSel = selected ? state.tiles[selected.y * state.mapSize + selected.x] : null;
  const citySel =
    tileSel && tileSel.cityId !== null
      ? state.cities.find((c) => c.id === tileSel.cityId) ?? null
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
  const me = state.players[HUMAN];
  const researchable = new Set(
    actions.filter((a) => a.type === "research").map((a) => (a as { tech: string }).tech),
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#1f2633" }}>
      {/* top bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingTop: 12,
          paddingBottom: 6,
          backgroundColor: "#141922",
        }}
      >
        <View>
          <Text style={{ color: "#f3e7c9", fontWeight: "800" }} testID="hud-shards">
            ◆ {me.stars} (+{income(state, HUMAN)})
          </Text>
          <Text style={{ color: "#aab", fontSize: 12 }}>
            Turn {state.turn}
            {state.mode === "perfection" ? `/${state.maxTurns}` : ""} · Score {scoreOf(state, HUMAN)}
          </Text>
        </View>
        <View style={{ flexDirection: "row" }}>
          <Button label="Lore" testID="tech-button" onPress={() => setTechOpen(true)} color="#5b7bd5" />
          <Button
            label={myTurn ? "End turn" : "Waiting…"}
            testID="end-turn"
            disabled={!myTurn || rewardActions.length > 0}
            onPress={() => {
              setSelected(null);
              act({ type: "endTurn" });
            }}
          />
        </View>
      </View>

      <Map state={state} viewer={HUMAN} highlights={highlights} onTilePress={onTilePress} />

      {/* selection panel */}
      <View style={{ backgroundColor: "#141922", padding: 8, minHeight: 92 }}>
        {selected ? (
          <>
            <Text style={{ color: "#f3e7c9", fontWeight: "700" }}>
              {tileSel && me.explored[selected.y * state.mapSize + selected.x]
                ? [
                    name("terrain", tileSel.terrain),
                    tileSel.resource ? name("resource", tileSel.resource) : null,
                    tileSel.building ? name("building", tileSel.building) : null,
                    tileSel.village ? "Hamlet" : null,
                    tileSel.ruin ? "Old ruin" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Unexplored"}
            </Text>
            {citySel && (
              <Text style={{ color: PLAYER_COLORS[citySel.owner % PLAYER_COLORS.length] }}>
                {citySel.name} · level {citySel.level} · pop {citySel.pop}/{citySel.level + 1}
                {citySel.capital ? " · seat" : ""}
              </Text>
            )}
            {unitAtSel && (
              <Text style={{ color: PLAYER_COLORS[unitAtSel.owner % PLAYER_COLORS.length] }}>
                {name("unit", unitAtSel.carried ? unitAtSel.type : unitAtSel.type)}
                {unitAtSel.carried ? ` (carrying ${name("unit", unitAtSel.carried)})` : ""} · HP{" "}
                {Math.ceil(unitAtSel.hp)}/{unitAtSel.maxHp}
                {unitAtSel.veteran ? " · veteran" : ""}
              </Text>
            )}
            <ScrollView horizontal style={{ marginTop: 4 }}>
              {selActions.map((a, i) => (
                <Button key={i} label={actionLabel(state, a)} onPress={() => act(a)} />
              ))}
            </ScrollView>
          </>
        ) : (
          <Text style={{ color: "#aab" }}>
            Tap a tile. Tap your unit, then a highlighted tile to move or a red tile to attack.
          </Text>
        )}
      </View>

      {/* tech tree */}
      <Modal visible={techOpen} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#1b2130", maxHeight: "80%", padding: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <Text style={{ color: "#f3e7c9", fontSize: 18, fontWeight: "800", marginBottom: 6 }}>
              Lore ◆ {me.stars}
            </Text>
            <ScrollView>
              {TECHS.map((t) => {
                const known = me.techs.includes(t.id);
                const can = researchable.has(t.id);
                return (
                  <View
                    key={t.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginLeft: (t.tier - 1) * 14,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ color: known ? "#7bd88f" : "#dde", flex: 1 }}>
                      {known ? "✓ " : ""}
                      {name("tech", t.id)} <Text style={{ color: "#889", fontSize: 11 }}>{t.unlocks}</Text>
                    </Text>
                    {!known && (
                      <Button
                        label={`◆ ${techCost(state, HUMAN, t.id)}`}
                        disabled={!can}
                        onPress={() => act({ type: "research", tech: t.id })}
                      />
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <Button label="Close" onPress={() => setTechOpen(false)} color="#5b7bd5" />
          </View>
        </View>
      </Modal>

      {/* level-up reward */}
      <Modal visible={rewardActions.length > 0} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "#000a", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: "#1b2130", padding: 16, borderRadius: 16, width: "85%" }}>
            <Text style={{ color: "#f3e7c9", fontSize: 18, fontWeight: "800", marginBottom: 8 }}>
              A city grew! Choose a boon
            </Text>
            {rewardActions.map((a, i) => (
              <Button key={i} testID={`reward-${i}`} label={actionLabel(state, a)} onPress={() => act(a)} />
            ))}
          </View>
        </View>
      </Modal>

      {/* game over */}
      <Modal visible={state.over} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "#000c", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: "#1b2130", padding: 20, borderRadius: 16, width: "85%" }}>
            <Text style={{ color: "#f3e7c9", fontSize: 22, fontWeight: "800" }} testID="game-over">
              {state.winner === HUMAN ? "Victory!" : "Defeat"}
            </Text>
            {state.players.map((p) => (
              <Text key={p.id} style={{ color: PLAYER_COLORS[p.id % PLAYER_COLORS.length] }}>
                {name("clan", p.clan)}: {scoreOf(state, p.id)} {p.alive ? "" : "(fallen)"}
              </Text>
            ))}
            <Button label="Back to menu" onPress={() => router.replace("/")} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
