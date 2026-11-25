/**
 * File storage for the arena (Node only). Everything lives in the repo:
 *   data/games/<YYYY-MM-DD>/<id>.json.gz   one gzipped GameRecord per game
 *   data/profiles.json                      human player profiles
 *   data/ratings.json                       Elo per "model:<id>" / "human:<profileId>" (fitted, see logic/arena/elo.ts)
 *   data/results.jsonl                      one line per rated game: who played and how they placed
 *   models/<id>/model.json                  model specs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { START_RATING, facets, matchesFilter, rate, resultRow, type RatingFilter, type Ratings, type ResultRow } from "../../logic/arena/elo";
import { slimRecord, type GameRecord } from "../../logic/arena/record";
import type { ModelSpec } from "../../logic/agents/types";
import { fit, modeWeights, parseResults, type Fit, type Meta, type PairRow } from "./elo-fit";

export const ROOT = path.resolve(__dirname, "..", "..");
export const DATA = path.join(ROOT, "data");
export const GAMES = path.join(DATA, "games");
export const MODELS = path.join(ROOT, "models");
const PROFILES = path.join(DATA, "profiles.json");
const RATINGS = path.join(DATA, "ratings.json");
const RESULTS = path.join(DATA, "results.jsonl");

export type Profile = { id: string; name: string; created: string };

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function listModels(): ModelSpec[] {
  if (!fs.existsSync(MODELS)) return [];
  return fs
    .readdirSync(MODELS)
    .map((d) => path.join(MODELS, d, "model.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => readJson<ModelSpec>(f, null as never))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function listProfiles(): Profile[] {
  return readJson<Profile[]>(PROFILES, []);
}

export function createProfile(name: string): Profile {
  const profiles = listProfiles();
  const clean = name.trim().slice(0, 40);
  const existing = profiles.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
  let id = base;
  for (let i = 2; profiles.some((p) => p.id === id); i++) id = `${base}-${i}`;
  const p: Profile = { id, name: clean || "Player", created: new Date().toISOString() };
  writeJson(PROFILES, [...profiles, p]);
  return p;
}

export function readRatings(): Ratings {
  return readJson<Ratings>(RATINGS, {});
}

export function gamePath(rec: GameRecord): string {
  return path.join(GAMES, rec.startedAt.slice(0, 10), `${rec.id}.json.gz`);
}

/** the rated games, oldest first; built from data/games/ the first time */
export function readResults(): ResultRow[] {
  const fromGames = () => writeResults(listGameFiles().map(readGame).map(resultRow).filter((r): r is ResultRow => r !== null));
  if (!fs.existsSync(RESULTS)) return fromGames();
  const rows = fs
    .readFileSync(RESULTS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ResultRow);
  // an index written before the game settings were added: rebuild it from the recordings
  return rows.some((r) => r.mode === undefined) ? fromGames() : rows;
}

// ---------- the bot tournament ----------
// scripts/elo-tournament.ts plays every bot against every other in every mode and writes
// elo/<date>/results.jsonl and ratings.json. Those games are not arena games (no recordings, no
// rows in data/results.jsonl), so the leaderboard takes the bots' ratings from the newest
// tournament directly: the same numbers as its README and dashboard. Both fits put greedy-v1 at
// about 1200, so tournament bots and arena players (people, LLM agents) share one scale.
const ELO = path.join(ROOT, "elo");
type Tournament = { dir: string; mtime: number; at: string; meta: Meta; rows: PairRow[]; stored: { overall?: Fit; modes?: Record<string, Fit> } };
let tournamentCache: Tournament | null = null;
const tournamentFits = new Map<string, Ratings>();
function tournament(): Tournament | null {
  const dir = (fs.existsSync(ELO) ? fs.readdirSync(ELO) : [])
    .filter((d) => fs.existsSync(path.join(ELO, d, "results.jsonl")))
    .sort()
    .pop();
  if (!dir) return null;
  const file = path.join(ELO, dir, "results.jsonl");
  const mtime = fs.statSync(file).mtimeMs;
  if (tournamentCache && tournamentCache.dir === dir && tournamentCache.mtime === mtime) return tournamentCache;
  const { meta, rows } = parseResults(fs.readFileSync(file, "utf8"));
  if (!meta || !rows.length) return null;
  const stored = readJson<{ at?: string; overall?: Fit; modes?: Record<string, Fit> }>(path.join(ELO, dir, "ratings.json"), {});
  tournamentFits.clear();
  tournamentCache = { dir, mtime, at: stored.at ?? new Date(mtime).toISOString(), meta, rows, stored };
  return tournamentCache;
}
/** the tournament modes whose setup matches the filter (creative is the 8-player format) */
function tournamentModes(t: Tournament, f: RatingFilter): string[] {
  return Object.entries(t.meta.modes)
    .filter(([m, s]) => (f.mode === undefined || f.mode === m) && (f.players === undefined || f.players === s.players) && (f.size === undefined || f.size === s.size) && (f.mapType === undefined || f.mapType === s.mapType))
    .map(([m]) => m);
}
/** the bots' ratings from the newest tournament, fitted on the modes that match the filter; {} when none does */
export function tournamentRatings(f: RatingFilter): Ratings {
  const t = tournament();
  if (!t) return {};
  const modes = tournamentModes(t, f);
  if (!modes.length) return {};
  const key = modes.join(",");
  const hit = tournamentFits.get(key);
  if (hit) return hit;
  const all = modes.length === Object.keys(t.meta.modes).length;
  // all modes, or one mode: the tournament's own stored fit; a subset: the same pooled fit over those modes
  const table: Fit =
    (all ? t.stored.overall : modes.length === 1 ? t.stored.modes?.[modes[0]] : undefined) ??
    fit(
      t.rows.filter((r) => modes.includes(r.mode)),
      t.meta.agents,
      t.meta.modes,
      200,
      modeWeights(Object.fromEntries(modes.map((m) => [m, t.meta.modes[m]]))),
    );
  const ratings: Ratings = Object.fromEntries(table.ranking.map((r) => [`model:${r.id}`, { rating: r.rating, games: r.games, wins: r.wins, updated: t.at, lo: Math.round(r.lo), hi: Math.round(r.hi), source: "tournament" as const }]));
  tournamentFits.set(key, ratings);
  return ratings;
}

/**
 * The leaderboard for a filter. People, LLM agents and any bot the tournament has not played:
 * fitted on the arena games that match (no filter = the stored overall table). Bots of the newest
 * tournament: its ratings (marked source "tournament"), which replace their arena ratings.
 */
const filtered = new Map<string, { n: number; ratings: Ratings }>();
function arenaRatingsFor(f: RatingFilter): Ratings {
  const keys = Object.entries(f).filter(([, v]) => v !== undefined);
  if (keys.length === 0) return readRatings();
  const rows = readResults();
  const cacheKey = JSON.stringify(keys.sort());
  const hit = filtered.get(cacheKey);
  if (hit && hit.n === rows.length) return hit.ratings;
  const ratings = rate(rows.filter((r) => matchesFilter(r, f)));
  filtered.set(cacheKey, { n: rows.length, ratings });
  return ratings;
}
export function ratingsFor(f: RatingFilter): Ratings {
  return { ...arenaRatingsFor(f), ...tournamentRatings(f) };
}

/** rated games per mode, player count, map size and map type: arena games plus the newest tournament's */
export function ratingFacets() {
  const out = facets(readResults());
  const t = tournament();
  if (t)
    for (const r of t.rows) {
      const s = t.meta.modes[r.mode];
      if (!s) continue;
      const n = r.games.length;
      out.mode[r.mode] = (out.mode[r.mode] ?? 0) + n;
      out.players[s.players] = (out.players[s.players] ?? 0) + n;
      out.size[s.size] = (out.size[s.size] ?? 0) + n;
      out.mapType[s.mapType] = (out.mapType[s.mapType] ?? 0) + n;
    }
  return out;
}

function writeResults(rows: ResultRow[]): ResultRow[] {
  const sorted = [...rows].sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(RESULTS, sorted.map((r) => JSON.stringify(r)).join("\n") + (sorted.length ? "\n" : ""));
  return sorted;
}

/** save a record; if it just finished, add it to the results and refit the ratings. Returns the rating change per seat. */
export function saveGame(rec: GameRecord): { file: string; deltas: number[]; ratings: Ratings } {
  // a record from an older client may still carry a snapshot per turn
  rec = slimRecord(rec);
  const file = gamePath(rec);
  // a game is rated once: autosaves and re-saves of an already finished game do not touch Elo
  let ratedBefore = false;
  if (fs.existsSync(file)) {
    try {
      ratedBefore = !!readGame(file).result?.over;
    } catch {
      ratedBefore = false;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(rec)));
  const ratings = readRatings();
  if (ratedBefore || !rec.result?.over) return { file: path.relative(ROOT, file), deltas: rec.seats.map(() => 0), ratings };
  const row = resultRow(rec)!;
  const rows = readResults().filter((r) => r.id !== row.id);
  rows.push(row);
  writeResults(rows);
  const next = rate(rows);
  writeJson(RATINGS, next);
  const deltas = row.keys.map((k) => Math.round(((next[k]?.rating ?? START_RATING) - (ratings[k]?.rating ?? START_RATING)) * 10) / 10);
  return { file: path.relative(ROOT, file), deltas, ratings: next };
}

/** read a record; one saved with a snapshot per turn (up to 150 MB) is slimmed, so nothing downstream carries them */
export function readGame(file: string): GameRecord {
  return slimRecord(JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as GameRecord);
}

export function listGameFiles(): string[] {
  if (!fs.existsSync(GAMES)) return [];
  const out: string[] = [];
  for (const day of fs.readdirSync(GAMES).sort()) {
    const dir = path.join(GAMES, day);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith(".json.gz")) out.push(path.join(dir, f));
  }
  return out;
}

/** rebuild data/results.jsonl from every recorded game and refit data/ratings.json */
export function rebuildRatings(): Ratings {
  const rows = writeResults(listGameFiles().map(readGame).map(resultRow).filter((r): r is ResultRow => r !== null));
  const ratings = rate(rows);
  writeJson(RATINGS, ratings);
  return ratings;
}

export type GameSummary = {
  id: string;
  file: string;
  source: GameRecord["source"];
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
};

export function summarize(file: string, rec: GameRecord): GameSummary {
  const last = rec.checkpoint?.state ?? rec.turnStates[rec.turnStates.length - 1];
  return {
    id: rec.id,
    file: path.relative(ROOT, file),
    source: rec.source,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    mapSize: rec.options.mapSize,
    mode: rec.options.mode,
    seats: rec.seats,
    turn: rec.result?.turns ?? last?.turn ?? 0,
    steps: rec.steps.length,
    over: !!rec.result?.over,
    winner: rec.result?.winner ?? null,
    scores: rec.result?.scores ?? null,
  };
}

/** newest first */
export function listGames(): GameSummary[] {
  return listGameFiles()
    .flatMap((f) => {
      try {
        return [summarize(f, readGame(f))];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function findGame(id: string): GameRecord | null {
  const f = listGameFiles().find((x) => path.basename(x) === `${id}.json.gz`);
  return f ? readGame(f) : null;
}
