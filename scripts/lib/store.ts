/**
 * File storage for the arena (Node only). Everything lives in the repo:
 *   data/games/<YYYY-MM-DD>/<id>.json.gz   one gzipped GameRecord per game
 *   data/profiles.json                      human player profiles
 *   data/ratings.json                       Elo per "model:<id>" / "human:<profileId>"
 *   models/<id>/model.json                  model specs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { applyGame, rebuild, type Ratings } from "../../logic/arena/elo";
import type { GameRecord } from "../../logic/arena/record";
import type { ModelSpec } from "../../logic/agents/types";

export const ROOT = path.resolve(__dirname, "..", "..");
export const DATA = path.join(ROOT, "data");
export const GAMES = path.join(DATA, "games");
export const MODELS = path.join(ROOT, "models");
const PROFILES = path.join(DATA, "profiles.json");
const RATINGS = path.join(DATA, "ratings.json");

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

/** save a record; if it is finished, update the Elo table. Returns the rating change per seat. */
export function saveGame(rec: GameRecord): { file: string; deltas: number[]; ratings: Ratings } {
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
  const deltas = applyGame(ratings, rec);
  writeJson(RATINGS, ratings);
  return { file: path.relative(ROOT, file), deltas, ratings };
}

export function readGame(file: string): GameRecord {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as GameRecord;
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

/** recompute data/ratings.json from every recorded game */
export function rebuildRatings(): Ratings {
  const ratings = rebuild(listGameFiles().map(readGame));
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
  const last = rec.turnStates[rec.turnStates.length - 1];
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
