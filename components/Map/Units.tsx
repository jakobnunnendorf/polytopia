/**
 * The unit layer and map effects. Units are drawn above the tiles (below the
 * clouds) so they can slide between tiles. All effects come from comparing the
 * previous and the next game state (diffEvents), so human moves, bot turns,
 * live games and replays animate the same way.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import { UnitArt } from "@/components/art/Art";
import { FloatText, Pop, reduceMotion } from "@/components/anim";
import { PLAYER_COLORS } from "@/components/game/theme";
import type { GameState, Unit } from "@/logic/engine/types";

const native = Platform.OS !== "web";
const color = (p: number) => PLAYER_COLORS[p % PLAYER_COLORS.length];

/** the art box is larger than the tile because figures only fill its middle */
export function spriteBox(inCity: boolean, TILE: number) {
  const f = inCity ? 0.96 : 1.16;
  return { dx: (inCity ? 0.22 : -0.08) * TILE, dy: (inCity ? 0.12 : -0.2) * TILE, size: f * TILE };
}

export type Lunge = { dx: number; dy: number; key: number };

export function UnitSprite({
  unit,
  inCity,
  TILE,
  selected,
  lunge,
}: {
  unit: Unit;
  inCity: boolean;
  TILE: number;
  selected: boolean;
  lunge?: Lunge;
}) {
  const pos = useRef(new Animated.ValueXY({ x: unit.x * TILE, y: unit.y * TILE })).current;
  const hop = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const thrust = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const bob = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(unit.canMove || unit.canAttack ? 1 : 0.6)).current;
  const last = useRef({ x: unit.x, y: unit.y, TILE, hp: unit.hp, veteran: unit.veteran });
  const [floats, setFloats] = React.useState<{ key: number; text: string; color: string }[]>([]);

  // move: slide with a hop (instant when only the zoom changed)
  useEffect(() => {
    const l = last.current;
    const to = { x: unit.x * TILE, y: unit.y * TILE };
    if (l.TILE !== TILE || reduceMotion()) pos.setValue(to);
    else if (l.x !== unit.x || l.y !== unit.y) {
      const steps = Math.max(Math.abs(l.x - unit.x), Math.abs(l.y - unit.y));
      const dur = Math.min(520, 200 + steps * 90);
      Animated.parallel([
        Animated.timing(pos, { toValue: to, duration: dur, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }),
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: dur / 2, easing: Easing.out(Easing.quad), useNativeDriver: native }),
          Animated.timing(hop, { toValue: 0, duration: dur / 2, easing: Easing.in(Easing.quad), useNativeDriver: native }),
        ]),
      ]).start();
    }
    last.current = { ...last.current, x: unit.x, y: unit.y, TILE };
  }, [unit.x, unit.y, TILE, pos, hop]);

  // hit or healed: shake and a floating number; promoted: a gold star
  useEffect(() => {
    const l = last.current;
    const d = Math.round(unit.hp - l.hp);
    if (d < 0) {
      setFloats((f) => [...f.slice(-2), { key: Date.now(), text: String(d), color: "#ff6b57" }]);
      if (!reduceMotion())
        Animated.sequence(
          [6, -6, 4, -4, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 55, useNativeDriver: native })),
        ).start();
    } else if (d > 0) {
      setFloats((f) => [...f.slice(-2), { key: Date.now(), text: `+${d}`, color: "#7ee08a" }]);
    }
    if (unit.veteran && !l.veteran) setFloats((f) => [...f.slice(-2), { key: Date.now() + 1, text: "★ veteran", color: "#ffd43b" }]);
    last.current = { ...last.current, hp: unit.hp, veteran: unit.veteran };
  }, [unit.hp, unit.veteran, shake]);

  // attack: lunge toward the target and back
  useEffect(() => {
    if (!lunge || reduceMotion()) return;
    const len = Math.hypot(lunge.dx, lunge.dy) || 1;
    const to = { x: (lunge.dx / len) * TILE * 0.35, y: (lunge.dy / len) * TILE * 0.35 };
    Animated.sequence([
      Animated.timing(thrust, { toValue: to, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: native }),
      Animated.timing(thrust, { toValue: { x: 0, y: 0 }, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: native }),
    ]).start();
  }, [lunge?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // used up for the turn: fade to dim instead of snapping
  useEffect(() => {
    Animated.timing(dim, { toValue: unit.canMove || unit.canAttack ? 1 : 0.6, duration: reduceMotion() ? 0 : 350, useNativeDriver: native }).start();
  }, [unit.canMove, unit.canAttack, dim]);

  // selected: lift and bob
  useEffect(() => {
    if (!selected || reduceMotion()) {
      bob.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(bob, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [selected, bob]);

  const box = spriteBox(inCity, TILE);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, top: 0, transform: [{ translateX: pos.x }, { translateY: pos.y }] }}
    >
      <Animated.View
        style={{
          position: "absolute",
          left: box.dx,
          top: box.dy,
          width: box.size,
          height: box.size,
          opacity: dim,
          transform: [
            { translateX: Animated.add(shake, thrust.x) },
            { translateY: Animated.add(thrust.y, Animated.add(hop.interpolate({ inputRange: [0, 1], outputRange: [0, -TILE * 0.22] }), bob.interpolate({ inputRange: [0, 1], outputRange: [-TILE * 0.04, -TILE * 0.12] }))) },
          ],
        }}
      >
        <Pop style={{ position: "absolute", left: 0, top: 0, width: box.size, height: box.size }}>
          <View
            style={{
              position: "absolute",
              left: box.size * 0.22,
              bottom: box.size * 0.08,
              width: box.size * 0.56,
              height: box.size * 0.14,
              borderRadius: TILE,
              backgroundColor: "#0004",
              borderWidth: 2,
              borderColor: unit.veteran ? "#ffd43b" : color(unit.owner),
            }}
          />
          <UnitArt type={unit.type} color={color(unit.owner)} size={box.size} />
          <Text
            style={{
              position: "absolute",
              right: inCity ? TILE * 0.02 : TILE * 0.1,
              bottom: inCity ? TILE * 0.06 : TILE * 0.22,
              fontSize: Math.max(9, Math.round(TILE * 0.16)),
              fontWeight: "800",
              color: "white",
              backgroundColor: "#000a",
              paddingHorizontal: 2,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            {Math.ceil(unit.hp)}
          </Text>
        </Pop>
      </Animated.View>
      {floats.map((f) => (
        <FloatText key={f.key} color={f.color} size={Math.max(12, TILE * 0.24)} style={{ position: "absolute", left: TILE * 0.3, top: TILE * 0.05 }}>
          {f.text}
        </FloatText>
      ))}
    </Animated.View>
  );
}

// ---------- one-shot effects ----------
export type Fx =
  | { id: number; kind: "death"; x: number; y: number; unit: Unit; inCity: boolean }
  | { id: number; kind: "burst"; x: number; y: number; color: string }
  | { id: number; kind: "puff"; x: number; y: number }
  | { id: number; kind: "text"; x: number; y: number; text: string; color: string };

function Ghost({ fx, TILE }: { fx: Extract<Fx, { kind: "death" }>; TILE: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduceMotion() ? 1 : 650, easing: Easing.in(Easing.quad), useNativeDriver: native }).start();
  }, [v]);
  const box = spriteBox(fx.inCity, TILE);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: fx.x * TILE + box.dx,
        top: fx.y * TILE + box.dy,
        width: box.size,
        height: box.size,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, TILE * 0.2] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) },
          { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-25deg"] }) },
        ],
      }}
    >
      <UnitArt type={fx.unit.type} color={color(fx.unit.owner)} size={box.size} />
    </Animated.View>
  );
}

function Ring({ x, y, TILE, tint, grow = 1.6, duration = 700 }: { x: number; y: number; TILE: number; tint: string; grow?: number; duration?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduceMotion() ? 1 : duration, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [v, duration]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x * TILE,
        top: y * TILE,
        width: TILE,
        height: TILE,
        borderRadius: TILE,
        borderWidth: Math.max(2, TILE * 0.08),
        borderColor: tint,
        opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, grow] }) }],
      }}
    />
  );
}

function Puff({ x, y, TILE }: { x: number; y: number; TILE: number }) {
  return (
    <>
      <Ring x={x} y={y} TILE={TILE} tint="#e9dcc6" grow={1.2} duration={550} />
      <Ring x={x} y={y} TILE={TILE} tint="#c9b79a" grow={0.9} duration={450} />
    </>
  );
}

export function FxLayer({ fx, TILE }: { fx: Fx[]; TILE: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 3 }}>
      {fx.map((f) =>
        f.kind === "death" ? (
          <React.Fragment key={f.id}>
            <Ghost fx={f} TILE={TILE} />
            <Puff x={f.x} y={f.y} TILE={TILE} />
          </React.Fragment>
        ) : f.kind === "burst" ? (
          <React.Fragment key={f.id}>
            <Ring x={f.x} y={f.y} TILE={TILE} tint={f.color} />
            <Ring x={f.x} y={f.y} TILE={TILE} tint="#ffffffcc" grow={1.1} duration={500} />
          </React.Fragment>
        ) : f.kind === "puff" ? (
          <Puff key={f.id} x={f.x} y={f.y} TILE={TILE} />
        ) : (
          <FloatText key={f.id} color={f.color} size={Math.max(12, TILE * 0.26)} rise={TILE * 0.6} style={{ position: "absolute", left: f.x * TILE + TILE * 0.3, top: f.y * TILE }}>
            {f.text}
          </FloatText>
        ),
      )}
    </View>
  );
}

let fxId = 1;

/**
 * What changed between two states, as effects and attack lunges.
 * `visible(i)` says whether the viewer may see tile i.
 */
export function diffEvents(
  prev: GameState,
  next: GameState,
  visible: (i: number) => boolean,
): { fx: Fx[]; lunges: Record<number, Lunge>; focus: { x: number; y: number } | null } {
  const n = next.mapSize;
  const fx: Fx[] = [];
  const lunges: Record<number, Lunge> = {};
  let focus: { x: number; y: number } | null = null;
  const at = (x: number, y: number) => y * n + x;
  const nextUnits = new Map(next.units.map((u) => [u.id, u]));
  const prevUnits = new Map(prev.units.map((u) => [u.id, u]));
  const cityAt = (s: GameState, x: number, y: number) => s.cities.find((c) => c.x === x && c.y === y);

  // victims: units that died or lost hp
  const victims: { x: number; y: number }[] = [];
  for (const u of prev.units) {
    const v = nextUnits.get(u.id);
    if (!v) {
      victims.push(u);
      if (visible(at(u.x, u.y))) fx.push({ id: fxId++, kind: "death", x: u.x, y: u.y, unit: u, inCity: !!cityAt(prev, u.x, u.y) });
    } else if (v.hp < u.hp) victims.push(v);
  }
  // attackers: units of the mover that just spent their attack without moving
  for (const u of next.units) {
    const p = prevUnits.get(u.id);
    if (!p || u.owner !== prev.current || !(p.canAttack && !u.canAttack) || p.x !== u.x || p.y !== u.y) continue;
    const target = victims
      .filter((t) => t.x !== u.x || t.y !== u.y)
      .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
    if (target) lunges[u.id] = { dx: target.x - u.x, dy: target.y - u.y, key: fxId++ };
  }
  // the mover's moved unit is where the camera should look
  for (const u of next.units) {
    const p = prevUnits.get(u.id);
    if (p && (p.x !== u.x || p.y !== u.y) && visible(at(u.x, u.y))) focus = { x: u.x, y: u.y };
    if (!p && visible(at(u.x, u.y))) focus = { x: u.x, y: u.y };
  }
  // cities: level ups, captures, growth
  for (const c of next.cities) {
    const p = prev.cities.find((x) => x.id === c.id);
    if (!visible(at(c.x, c.y))) continue;
    if (!p) {
      fx.push({ id: fxId++, kind: "burst", x: c.x, y: c.y, color: color(c.owner) });
      focus = { x: c.x, y: c.y };
    } else if (p.owner !== c.owner) {
      fx.push({ id: fxId++, kind: "burst", x: c.x, y: c.y, color: color(c.owner) });
      focus = { x: c.x, y: c.y };
    } else if (c.level > p.level) {
      fx.push({ id: fxId++, kind: "burst", x: c.x, y: c.y, color: "#ffd43b" });
      fx.push({ id: fxId++, kind: "text", x: c.x, y: c.y, text: `Level ${c.level}`, color: "#ffd43b" });
    } else if (c.pop > p.pop) {
      fx.push({ id: fxId++, kind: "text", x: c.x, y: c.y, text: `+${c.pop - p.pop}`, color: "#7ee08a" });
    }
  }
  // tiles: ruins explored, resources harvested
  next.tiles.forEach((t, i) => {
    const p = prev.tiles[i];
    if (!visible(i)) return;
    if (p.ruin && !t.ruin) fx.push({ id: fxId++, kind: "puff", x: i % n, y: Math.floor(i / n) });
    else if (p.resource && !t.resource && !t.building) fx.push({ id: fxId++, kind: "puff", x: i % n, y: Math.floor(i / n) });
  });
  return { fx, lunges, focus };
}
