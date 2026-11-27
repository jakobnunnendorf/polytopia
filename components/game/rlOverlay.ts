/**
 * Map marks for a recorded decision of the experiment 24 unit agent (`unit-rl analyse` / `unit-rl replay`):
 * the acting unit selected, each tile one of its candidate actions points at labelled with the gain
 * (reward + V after - V before): orange above 0, blue at or below, a white ring on the played one.
 */
import type { Highlight } from "@/components/Map/Tile";

export type RlCand = { uid: number; from: [number, number]; target: [number, number]; kind: string; gain: number; chosen: boolean };
export type RlDecision = {
  turn: number;
  player?: number;
  passed: boolean;
  all: RlCand[];
  rows: { uid: number; unit: string; chosen: boolean }[];
  /** replays only: the state index the decision was taken at, and whether epsilon picked at random */
  at?: number;
  explore?: boolean;
};

/** the unit a decision is shown for: the given one, else the one that acted, else the one with the best option */
export function focusUnit(d: RlDecision, unit?: number | null): number | undefined {
  if (unit !== undefined && unit !== null && d.all.some((c) => c.uid === unit)) return unit;
  const chosen = d.all.find((c) => c.chosen);
  if (chosen) return chosen.uid;
  return [...d.all].sort((a, b) => b.gain - a.gain)[0]?.uid;
}

export function rlMarks(d: RlDecision, unit?: number | null) {
  const uid = focusUnit(d, unit);
  const mine = d.all.filter((c) => c.uid === uid);
  const highlights: Record<string, Highlight> = {};
  const labels: Record<string, { text: string; color: string; ring?: boolean }> = {};
  // one label per tile: the played candidate, else the best (capture and recover share the unit's tile)
  const best: Record<string, RlCand> = {};
  for (const c of mine) {
    const key = `${c.target[0]},${c.target[1]}`;
    if (!best[key] || c.chosen || (!best[key].chosen && c.gain > best[key].gain)) best[key] = c;
  }
  for (const [key, c] of Object.entries(best)) {
    highlights[key] = c.kind === "attack" ? "attack" : c.kind === "move" ? "move" : "action";
    labels[key] = { text: `${c.gain > 0 ? "+" : ""}${c.gain.toFixed(2)}`, color: c.gain > 0 ? "#c96a1ee6" : "#2f6fcde6", ring: c.chosen };
  }
  const from = mine[0]?.from;
  if (from) highlights[`${from[0]},${from[1]}`] = "selected";
  const name = d.rows.find((r) => r.uid === uid)?.unit ?? `unit #${uid}`;
  return { highlights, labels, name, n: mine.length, uid };
}
