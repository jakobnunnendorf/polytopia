import React, { useMemo, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { ShardIcon, TribeEmblem } from "@/components/art/Art";
import { TechIcon } from "@/components/art/TechIcons";
import { UI } from "@/components/game/theme";
import { Pop } from "@/components/anim";
import { CLAN_BY_ID, TECHS } from "@/logic/engine/data";
import { name } from "@/logic/engine/names";

type Node = { id: string; tier: number; x: number; y: number; parent: string | null };

/**
 * Exact Battle of Polytopia radial tech tree layout (clockwise from 12 o'clock):
 *   Top (-90°):          Riding       (Roads/Trade, Free Spirit/Chivalry)
 *   Upper-Right (-18°):  Organization (Farming/Construction, Strategy/Diplomacy)
 *   Bottom-Right (+54°): Climbing     (Mining/Smithery, Meditation/Philosophy)
 *   Bottom-Left (+126°): Fishing      (Sailing/Navigation, Ramming/Aquatism)
 *   Upper-Left (-162°):  Hunting      (Archery/Spiritualism, Forestry/Mathematics)
 */
const POLYTOPIA_BRANCH_ORDER = ["riding", "organization", "climbing", "fishing", "hunting"];

function layout(size: number): Node[] {
  const c = size / 2;
  const radius = [0, size * 0.17, size * 0.31, size * 0.46];
  const angleOf: Record<string, number> = {};
  const nodes: Node[] = [];
  const roots = POLYTOPIA_BRANCH_ORDER
    .map((id) => TECHS.find((t) => t.id === id))
    .filter((t): t is (typeof TECHS)[number] => !!t);
  roots.forEach((root, k) => {
    // Start straight up at 12 o'clock (-90°) and step +72° clockwise
    const base = -Math.PI / 2 + (k * 2 * Math.PI) / roots.length;
    angleOf[root.id] = base;
    const kids = TECHS.filter((t) => t.parent === root.id);
    kids.forEach((kid, j) => {
      angleOf[kid.id] = base + (j === 0 ? -1 : 1) * (Math.PI / 10);
      for (const leaf of TECHS.filter((t) => t.parent === kid.id)) {
        angleOf[leaf.id] = base + (j === 0 ? -1 : 1) * (Math.PI / 6.5);
      }
    });
  });
  for (const t of TECHS) {
    const a = angleOf[t.id];
    nodes.push({ id: t.id, tier: t.tier, parent: t.parent, x: c + radius[t.tier] * Math.cos(a), y: c + radius[t.tier] * Math.sin(a) });
  }
  return nodes;
}

export default function TechTree({
  known,
  researchable,
  costOf,
  stars,
  clanColor,
  clanId,
  clanName,
  onLearn,
  onClose,
}: {
  known: string[];
  researchable: Set<string>;
  costOf: (tech: string) => number;
  stars: number;
  clanColor: string;
  clanId?: string;
  clanName: string;
  onLearn: (tech: string) => void;
  onClose: () => void;
}) {
  const overrides = clanId ? CLAN_BY_ID[clanId]?.techOverrides : undefined;
  const techLabel = (id: string) => overrides?.[id]?.name ?? name("tech", id);
  const techUnlocks = (id: string, fallback: string) => overrides?.[id]?.unlocks ?? fallback;
  const { width, height } = useWindowDimensions();
  const size = Math.min(width - 16, height - 250, 640);
  const nodes = useMemo(() => layout(size), [size]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const [picked, setPicked] = useState<string | null>(null);
  const node = Math.max(30, Math.round(size * 0.085));
  const c = size / 2;

  const stateOf = (id: string) => (known.includes(id) ? "known" : researchable.has(id) ? "open" : "locked");
  const pickedTech = picked ? TECHS.find((t) => t.id === picked) : undefined;
  const pickedState = picked ? stateOf(picked) : "locked";
  const pickedCost = picked ? costOf(picked) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: UI.dusk }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
        }}
      >
        <Text style={{ color: UI.mist, fontSize: 30, fontFamily: UI.display }}>Tech Tree</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <ShardIcon size={20} />
          <Text style={{ color: UI.mist, fontSize: 20, fontWeight: "800", marginLeft: 4 }}>{stars}</Text>
        </View>
      </View>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size} style={{ position: "absolute", left: 0, top: 0 }}>
            {[0.17, 0.31, 0.46].map((r) => (
              <Circle key={r} cx={c} cy={c} r={size * r} stroke={UI.line} strokeWidth={1} strokeDasharray="2 6" fill="none" />
            ))}
            {nodes.map((n) => {
              const from = n.parent ? byId[n.parent] : { x: c, y: c };
              const lit = known.includes(n.id);
              return (
                <Line
                  key={n.id}
                  x1={from.x}
                  y1={from.y}
                  x2={n.x}
                  y2={n.y}
                  stroke={lit ? "#4ade80" : UI.line}
                  strokeWidth={lit ? 3.5 : 2}
                />
              );
            })}
          </Svg>

          {/* the player's tribe head at the centre */}
          <View
            style={{
              position: "absolute",
              left: c - node * 0.75,
              top: c - node * 0.75,
              width: node * 1.5,
              height: node * 1.5,
              borderRadius: node,
              backgroundColor: clanColor,
              borderWidth: 3,
              borderColor: UI.mist,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TribeEmblem clan={clanId ?? "romans"} size={node * 1.1} />
          </View>

          {nodes.map((n) => {
            const st = stateOf(n.id);
            const on = picked === n.id;
            return (
              <Pressable
                key={n.id}
                testID={`tech-${n.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${name("tech", n.id)}, ${st === "known" ? "researched" : `${costOf(n.id)} stars`}`}
                onPress={() => setPicked(on ? null : n.id)}
                style={{ position: "absolute", left: n.x - 40, top: n.y - node / 2, width: 80, alignItems: "center" }}
              >
                {/* nodes grow in ring by ring; a newly learned one pops again in its new colour */}
                <Pop force key={st} delay={n.tier * 90} from={0.3}>
                <View
                  style={{
                    width: node,
                    height: node,
                    borderRadius: node / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: st === "known" ? "#1e7a48" : st === "open" ? "#1d63b8" : "#14223b",
                    borderWidth: on ? 3 : 2.5,
                    borderColor: on ? "#ffffff" : st === "known" ? "#4ade80" : st === "open" ? UI.gold : "#2c426b",
                  }}
                >
                  <TechIcon
                    id={n.id}
                    size={node * 0.72}
                    ink={st === "known" ? UI.mist : st === "open" ? UI.gold : UI.muted}
                  />
                </View>
                </Pop>
                <Text
                  numberOfLines={1}
                  style={{
                    color: st === "locked" ? UI.muted : UI.mist,
                    fontSize: 10,
                    fontWeight: "700",
                    marginTop: 2,
                    textShadowColor: UI.dusk,
                    textShadowRadius: 4,
                  }}
                >
                  {techLabel(n.id)}
                </Text>
                {st !== "known" && (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ShardIcon size={9} color={st === "open" ? UI.gold : UI.muted} />
                    <Text style={{ color: st === "open" ? UI.gold : UI.muted, fontSize: 10, fontWeight: "800", marginLeft: 2 }}>
                      {costOf(n.id)}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* detail card for the tapped discovery */}
      <View
        style={{
          backgroundColor: UI.panel,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: 16,
          paddingBottom: 18,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
        }}
      >
        <View style={{ minHeight: 48 }}>
          {pickedTech ? (
            <>
              <Text style={{ color: UI.mist, fontSize: 17, fontWeight: "800" }}>{techLabel(pickedTech.id)}</Text>
              <Text style={{ color: UI.muted, fontSize: 14, marginTop: 2 }}>Unlocks {techUnlocks(pickedTech.id, pickedTech.unlocks)}</Text>
            </>
          ) : (
            <Text style={{ color: UI.muted, fontSize: 14, lineHeight: 20 }}>
              Tap a tech to see what it unlocks. Gold ones are ready for {clanName} to research.
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", marginTop: 10 }}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: UI.line, marginRight: 8 }}
          >
            <Text style={{ color: UI.mist, fontWeight: "700", fontSize: 15 }}>Back to map</Text>
          </Pressable>
          {pickedTech && pickedState !== "known" && (
            <Pressable
              testID="learn-button"
              disabled={pickedState !== "open"}
              accessibilityRole="button"
              onPress={() => {
                onLearn(pickedTech.id);
                setPicked(null);
              }}
              style={{
                flexGrow: 1,
                alignItems: "center",
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: pickedState === "open" ? UI.gold : UI.panelHi,
              }}
            >
              <Text style={{ color: pickedState === "open" ? UI.goldInk : UI.muted, fontWeight: "800", fontSize: 15 }}>
                {pickedState === "open"
                  ? `Research for ${pickedCost} stars`
                  : stars < pickedCost
                    ? `Needs ${pickedCost} stars, you have ${stars}`
                    : `Research ${name("tech", pickedTech.parent ?? "")} first`}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
