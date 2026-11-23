import React from "react";
import { Text, View } from "react-native";
import { Confetti, Pop } from "@/components/anim";
import { PLAYER_COLORS, UI } from "@/components/game/theme";

export type Standing = { id: number; name: string; clan: string; score: number; alive: boolean; elo?: number };

/**
 * The end of a game: the title drops in, confetti for a win, the scoreboard
 * rows appear one by one. Used by the play screen and by the Analyse replay.
 */
export default function GameOverCard({
  title,
  good,
  subtitle,
  standings,
  footer,
  children,
}: {
  title: string;
  /** gold title and confetti (a win, or a model-only game) vs coral (a loss) */
  good: boolean;
  subtitle: string;
  standings: Standing[];
  footer?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ backgroundColor: UI.panel, padding: 24, borderRadius: 20, width: "100%", maxWidth: 420, overflow: "hidden" }}>
      {good && <Confetti colors={[UI.gold, UI.sky, UI.coral, UI.mist, ...PLAYER_COLORS.slice(0, 3)]} width={420} height={460} />}
      <Pop force drop={36} from={0.7}>
        <Text
          testID="game-over"
          style={{ color: good ? UI.gold : UI.coral, fontSize: 42, fontFamily: UI.display, textAlign: "center" }}
        >
          {title}
        </Text>
      </Pop>
      <Pop force delay={200} from={0.95}>
        <Text style={{ color: UI.muted, fontSize: 14, textAlign: "center", marginTop: 4, marginBottom: 14 }}>{subtitle}</Text>
      </Pop>
      {standings.map((s, i) => (
        <Pop force key={s.id} delay={320 + i * 110} from={0.9}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 9, borderTopWidth: 1, borderTopColor: UI.line }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PLAYER_COLORS[s.id % PLAYER_COLORS.length], marginRight: 10 }} />
            <Text style={{ color: s.alive ? UI.mist : UI.muted, fontSize: 15, fontWeight: "700", flex: 1 }} numberOfLines={1}>
              {i === 0 ? "♛ " : ""}
              {s.name}
              <Text style={{ color: UI.muted, fontWeight: "400" }}>
                {" "}
                {s.clan}
                {s.alive ? "" : ", fallen"}
              </Text>
            </Text>
            {s.elo !== undefined && (
              <Text style={{ color: s.elo >= 0 ? UI.sky : UI.coral, fontSize: 13, marginRight: 10 }}>
                {s.elo >= 0 ? "+" : ""}
                {s.elo} Elo
              </Text>
            )}
            <Text style={{ color: UI.mist, fontSize: 15, fontWeight: "800" }}>{s.score.toLocaleString("en")}</Text>
          </View>
        </Pop>
      ))}
      {children}
      {footer ? <Text style={{ color: UI.muted, fontSize: 12, marginTop: 8, textAlign: "center" }}>{footer}</Text> : null}
    </View>
  );
}
