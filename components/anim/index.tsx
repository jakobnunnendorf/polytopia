/**
 * Small animation toolkit on React Native's Animated (phone and web).
 * Every helper respects the system's reduced-motion setting: then things simply appear.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

const native = Platform.OS !== "web";

let reduced = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((r) => (reduced = r))
  .catch(() => {});
AccessibilityInfo.addEventListener?.("reduceMotionChanged", (r) => (reduced = r));
export const reduceMotion = () => reduced;

/** false during a screen's first render, so a whole map does not pop in at once */
export const AnimateNew = createContext(true);

export function useMountedOnce(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 50);
    return () => clearTimeout(t);
  }, []);
  return ready;
}

/** scales (and optionally drops) its children in when it mounts; remount with a new key to replay */
export function Pop({
  children,
  delay = 0,
  from = 0.4,
  drop = 0,
  style,
  force = false,
  pointerEvents = "box-none",
}: {
  children: React.ReactNode;
  delay?: number;
  from?: number;
  drop?: number;
  style?: StyleProp<ViewStyle>;
  /** animate even during the screen's first render */
  force?: boolean;
  /** "none" for decoration that must never take a tap (on web, box-none lets the children take it) */
  pointerEvents?: "box-none" | "none";
}) {
  const animateNew = useContext(AnimateNew);
  const skip = reduced || (!animateNew && !force);
  const v = useRef(new Animated.Value(skip ? 1 : 0)).current;
  useEffect(() => {
    if (skip) return;
    Animated.spring(v, { toValue: 1, delay, friction: 5, tension: 120, useNativeDriver: native }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-drop, 0] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** loops a gentle scale pulse while `on` */
export function Pulse({
  children,
  on = true,
  amount = 0.12,
  period = 900,
  style,
}: {
  children: React.ReactNode;
  on?: boolean;
  amount?: number;
  period?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on || reduced) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, period, v]);
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[style, { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + amount] }) }] }]}
    >
      {children}
    </Animated.View>
  );
}

/** a number that counts toward its new value, with a "+N" floating off when it changes */
export function Ticker({
  value,
  style,
  format = (n: number) => String(n),
  float = true,
  floatColor = "#f6c453",
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  format?: (n: number) => string;
  float?: boolean;
  floatColor?: string;
}) {
  const [shown, setShown] = useState(value);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (float) setDelta({ n: value - from, key: Date.now() });
    if (reduced) {
      setShown(value);
      return;
    }
    const start = Date.now();
    const dur = 450;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const e = 1 - (1 - t) ** 3;
      setShown(Math.round(from + (value - from) * e));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, float]);
  return (
    <Animated.View>
      <Text style={style}>{format(shown)}</Text>
      {delta && (
        <FloatText key={delta.key} color={delta.n >= 0 ? floatColor : "#f2785c"} style={{ position: "absolute", right: -6, top: -4 }}>
          {delta.n >= 0 ? `+${delta.n}` : String(delta.n)}
        </FloatText>
      )}
    </Animated.View>
  );
}

/** text that rises and fades out once */
export function FloatText({
  children,
  color,
  size = 14,
  rise = 26,
  duration = 900,
  style,
}: {
  children: React.ReactNode;
  color: string;
  size?: number;
  rise?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduced ? 1 : duration, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [v, duration]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) }],
        },
      ]}
    >
      <Text
        style={{
          color,
          fontSize: size,
          fontWeight: "900",
          textShadowColor: "#0009",
          textShadowRadius: 3,
          textShadowOffset: { width: 0, height: 1 },
        }}
      >
        {children}
      </Text>
    </Animated.View>
  );
}

/** slides in from the top, holds, slides away (turn banner) */
export function Banner({ children, hold = 1100, style }: { children: React.ReactNode; hold?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      const t = setTimeout(() => v.setValue(2), hold + 400);
      return () => clearTimeout(t);
    }
    Animated.sequence([
      Animated.spring(v, { toValue: 1, friction: 7, tension: 90, useNativeDriver: native }),
      Animated.delay(hold),
      Animated.timing(v, { toValue: 2, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: native }),
    ]).start();
  }, [v, hold]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          opacity: v.interpolate({ inputRange: [0, 0.4, 1, 1.6, 2], outputRange: [0, 1, 1, 1, 0] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1, 2], outputRange: [-40, 0, -24] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** falling confetti for a victory */
export function Confetti({ colors, count = 28, width = 360, height = 420 }: { colors: string[]; count?: number; width?: number; height?: number }) {
  const pieces = useRef(
    Array.from({ length: count }, (_, i) => ({
      x: Math.random() * width,
      delay: Math.random() * 500,
      dur: 1400 + Math.random() * 900,
      spin: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 6,
      color: colors[i % colors.length],
      v: new Animated.Value(0),
    })),
  ).current;
  useEffect(() => {
    if (reduced) return;
    Animated.parallel(
      pieces.map((p) => Animated.timing(p.v, { toValue: 1, duration: p.dur, delay: p.delay, easing: Easing.in(Easing.quad), useNativeDriver: native })),
    ).start();
  }, [pieces]);
  if (reduced) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, overflow: "hidden" }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            left: p.x,
            top: -12,
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
            borderRadius: 1,
            opacity: p.v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin}deg`] }) },
            ],
          }}
        />
      ))}
    </Animated.View>
  );
}

/** "Rivals are moving" with animated dots */
export function useDots(on: boolean): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on || reduced) return;
    const t = setInterval(() => setN((x) => (x + 1) % 4), 380);
    return () => clearInterval(t);
  }, [on]);
  return on ? ".".repeat(n) : "";
}

/** press feedback for Pressable style callbacks */
export const pressScale = (pressed: boolean) => (pressed && !reduced ? [{ scale: 0.96 }] : []);
