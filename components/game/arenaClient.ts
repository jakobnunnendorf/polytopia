/**
 * Talks to the local arena server (scripts/arena-server.ts, port 8091) on the
 * same host that serves the app, so it works from the phone over Wi-Fi too.
 * Every call fails soft: without the server the game still plays, it just
 * cannot record games, keep profiles or reach the local LLM.
 */
import { Platform } from "react-native";
import type { ChatFn, ModelSpec } from "@/logic/agents/types";
import type { GameRecord } from "@/logic/arena/record";
import type { RatingFilter, Ratings } from "@/logic/arena/elo";

export type Profile = { id: string; name: string; created: string };

export type GameSummary = {
  id: string;
  file: string;
  source: "play" | "arena";
  startedAt: string;
  endedAt: string | null;
  mapSize: number;
  mode: string;
  seats: GameRecord["seats"];
  turn: number;
  steps: number;
  over: boolean;
  winner: number | null;
  scores: number[] | null;
  /** a model-only game the server is playing right now */
  running?: boolean;
};

export function arenaBase(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8091`;
  }
  return "http://localhost:8091";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${arenaBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const arena = {
  health: () => call<{ ok: boolean }>("/api/health"),
  models: () => call<ModelSpec[]>("/api/models"),
  profiles: () => call<Profile[]>("/api/profiles"),
  createProfile: (name: string) => call<Profile>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  /** the overall table, or the fit on only the games matching the filter */
  ratings: (f: RatingFilter = {}) => {
    const q = Object.entries(f)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return call<Ratings>(`/api/ratings${q ? `?${q}` : ""}`);
  },
  ratingFacets: () =>
    call<{ mode: Record<string, number>; players: Record<string, number>; size: Record<string, number>; mapType: Record<string, number> }>("/api/ratings/facets"),
  games: () => call<GameSummary[]>("/api/games"),
  startMatch: (m: { mapSize: number; mode: string; difficulty?: string; seed: number; seats: GameRecord["seats"] }) =>
    call<{ id: string }>("/api/matches", { method: "POST", body: JSON.stringify(m) }),
  resumeMatch: (id: string) =>
    call<{ ok: boolean; reason?: string }>(`/api/matches/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  getPace: (id: string) => call<{ ms: number }>(`/api/matches/${encodeURIComponent(id)}/pace`),
  setPace: (id: string, ms: number) =>
    call<{ ok: boolean; ms: number }>(`/api/matches/${encodeURIComponent(id)}/pace`, { method: "POST", body: JSON.stringify({ ms }) }),
  stopMatch: (id: string) =>
    call<{ ok: boolean; reason?: string }>(`/api/matches/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  game: (id: string) => call<GameRecord>(`/api/games/${encodeURIComponent(id)}`),
  /** a game from its newest checkpoint on (`base` = moves before it), so a long game opens at once */
  liveGame: (id: string) => call<GameRecord>(`/api/games/${encodeURIComponent(id)}?live=1`),
  /** only the moves after the first `from` (counted from the start of the game) */
  gameSteps: (id: string, from: number) =>
    call<{ total: number; steps: GameRecord["steps"]; endedAt: string | null; result: GameRecord["result"]; stoppedAt: string | null }>(
      `/api/games/${encodeURIComponent(id)}?from=${from}`,
    ),
  saveGame: (rec: GameRecord) =>
    call<{ file: string; deltas: number[]; ratings: Ratings }>("/api/games", { method: "POST", body: JSON.stringify(rec) }),
};

/** LLM calls go through the arena server, which can reach LM Studio on the Mac */
export const serverChat: ChatFn = async (req) => {
  const out = await call<{ content: string }>("/api/chat", { method: "POST", body: JSON.stringify(req) });
  return out.content;
};
