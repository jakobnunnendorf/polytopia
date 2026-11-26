import React from "react";
import { Pressable, Text, View } from "react-native";
import { UI } from "@/components/game/theme";
import type { ModelSpec } from "@/logic/agents/types";

const FAMILY: Record<string, string> = {
  "greedy-full": "Full greedy",
  greedy: "Greedy",
  random: "Random",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-25" -> "25 Nov" */
function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : iso;
}

/** 100020 -> "100k" */
function shortCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** the card's one-liner: the hand-written tagline, else the description's first sentence */
export function modelTagline(m: ModelSpec): string {
  if (m.tagline) return m.tagline;
  const first = m.description.split(/(?<=\.)\s/)[0] ?? "";
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

/** the card's small print: what kind of bot and what it was built on; then how much training, and when */
export function modelFacts(m: ModelSpec, all: ModelSpec[]): string {
  const t = m.training;
  const parent = t?.from ? (all.find((x) => x.id === t.from)?.name ?? t.from) : undefined;
  const games = t?.trainingGames ?? (t?.gamesPerPoint && t?.points ? t.gamesPerPoint * t.points.length : undefined);
  const kind = `${FAMILY[m.kind] ?? m.kind}${parent ? `, built on ${parent}` : ""}`;
  const effort = games ? `${shortCount(games)} games${t?.duration ? ` in ${t.duration}` : ""}` : "";
  const made = m.created ? shortDate(m.created) : "";
  return [kind, [effort, made].filter(Boolean).join(", ")].filter(Boolean).join("\n");
}

/**
 * one model in the setup screen's picker: name, rank and Elo on top, what it does in one line,
 * then where it comes from (family, parent model, training games and time, date)
 */
export function ModelCard({
  model,
  all,
  rank,
  elo,
  overall,
  on,
  onPress,
}: {
  model: ModelSpec;
  /** every model, to name the parent */
  all: ModelSpec[];
  /** 1 = strongest in the picker */
  rank: number;
  elo?: number;
  /** the Elo comes from all games, not the chosen settings */
  overall: boolean;
  on: boolean;
  onPress: () => void;
}) {
  const ink = on ? UI.dusk : UI.mist;
  const soft = on ? UI.panelHi : UI.muted;
  return (
    <Pressable
      testID={`model-card-${model.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${model.name}${elo != null ? `, Elo ${elo}` : ""}`}
      style={{
        width: "48.9%",
        padding: 12,
        marginBottom: 8,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: on ? UI.mist : UI.line,
        backgroundColor: on ? UI.mist : "rgba(255,255,255,0.03)",
        justifyContent: "space-between",
      }}
    >
      <View>
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <Text style={{ color: ink, fontWeight: "800", fontSize: 16, flex: 1 }} numberOfLines={1}>
            {model.name}
          </Text>
          {elo != null && <Text style={{ color: ink, fontWeight: "800", fontSize: 16 }}>{elo}</Text>}
        </View>
        <Text style={{ color: soft, fontSize: 11, fontWeight: "700", marginTop: 1 }}>
          {rank === 1 ? "★ Strongest" : `#${rank} by Elo`}
          {elo == null ? ", not rated yet" : overall ? ", over all games" : ""}
        </Text>
        <Text style={{ color: ink, fontSize: 13, lineHeight: 18, marginTop: 8 }} numberOfLines={3}>
          {modelTagline(model)}
        </Text>
      </View>
      <Text style={{ color: soft, fontSize: 11, lineHeight: 15, marginTop: 8 }} numberOfLines={2}>
        {modelFacts(model, all)}
      </Text>
    </Pressable>
  );
}
