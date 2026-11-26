/**
 * Talks to the local arena server (scripts/arena-server.ts, port 8091) on the
 * same host that serves the app, so it works from the phone over Wi-Fi too.
 * Every call fails soft: without the server the game still plays, it just
 * cannot record games or keep profiles.
 */
import { Platform } from "react-native";
import type { ModelSpec } from "@/logic/agents/types";
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

/**
 * The hosted web game (https://polytopia.expo.app) has no arena server next to it. There it reads
 * the public, read-only copy in Supabase that the Mac's arena server keeps up to date
 * (scripts/supabase-sync.ts); everything that writes or runs matches stays local-only.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.local$)/;
export function isHostedWeb(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && !LOCAL_HOST.test(window.location.hostname);
}

async function publicRead<T>(table: string, query: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("no Supabase configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: { apikey: SUPABASE_KEY } });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  return (await res.json()) as T[];
}

type RatingRow = { key: string; rating: number; games: number; wins: number; lo: number | null; hi: number | null; source: string | null; updated: string };
type GameRow = {
  id: string; source: GameSummary["source"]; started_at: string; ended_at: string | null; map_size: number; mode: string;
  seats: GameSummary["seats"]; turn: number; steps: number; over: boolean; winner: number | null; scores: number[] | null;
};

const hosted = {
  ratings: async (f: RatingFilter): Promise<Ratings> => {
    if (Object.values(f).some((v) => v !== undefined)) throw new Error("filtered ratings need the arena server");
    const out: Ratings = {};
    for (const r of await publicRead<RatingRow>("ratings", "select=*")) {
      out[r.key] = {
        rating: r.rating, games: r.games, wins: r.wins, updated: r.updated,
        ...(r.lo != null ? { lo: r.lo } : {}), ...(r.hi != null ? { hi: r.hi } : {}),
        ...(r.source === "tournament" ? { source: "tournament" as const } : {}),
      };
    }
    return out;
  },
  models: async () => (await publicRead<{ spec: ModelSpec }>("models", "select=spec&order=id")).map((r) => r.spec),
  profiles: () => publicRead<Profile>("profiles", "select=id,name,created&order=created"),
  games: async (): Promise<GameSummary[]> =>
    (await publicRead<GameRow>("games", "select=*&order=started_at.desc")).map((g) => ({
      id: g.id, file: "", source: g.source, startedAt: g.started_at, endedAt: g.ended_at, mapSize: g.map_size, mode: g.mode,
      seats: g.seats, turn: g.turn, steps: g.steps, over: g.over, winner: g.winner, scores: g.scores,
    })),
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (isHostedWeb()) throw new Error(`${path}: no arena server on the hosted site`);
  const res = await fetch(`${arenaBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const arena = {
  health: () => call<{ ok: boolean }>("/api/health"),
  models: () => (isHostedWeb() ? hosted.models() : call<ModelSpec[]>("/api/models")),
  profiles: () => (isHostedWeb() ? hosted.profiles() : call<Profile[]>("/api/profiles")),
  createProfile: (name: string) => call<Profile>("/api/profiles", { method: "POST", body: JSON.stringify({ name }) }),
  /** the overall table, or the fit on only the games matching the filter */
  ratings: (f: RatingFilter = {}) => {
    if (isHostedWeb()) return hosted.ratings(f);
    const q = Object.entries(f)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return call<Ratings>(`/api/ratings${q ? `?${q}` : ""}`);
  },
  ratingFacets: () =>
    call<{ mode: Record<string, number>; players: Record<string, number>; size: Record<string, number>; mapType: Record<string, number> }>("/api/ratings/facets"),
  games: () => (isHostedWeb() ? hosted.games() : call<GameSummary[]>("/api/games")),
  startMatch: (m: { mapSize: number; mode: string; difficulty?: string; mapType?: string; seed: number; seats: GameRecord["seats"] }) =>
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

