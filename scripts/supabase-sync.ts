/**
 * Copies what the arena server serves (ratings, models, profiles, the game list) to the public
 * read-only tables in Supabase (supabase/migrations), so the hosted web game can show them.
 *
 *   npm run supabase:sync
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY, from the environment or ~/.config/polytopia/supabase.env
 * (mode 600; the secret key is the project's sb_secret_ key and must never reach the app or git).
 * Without them it prints a note and exits 0, so the arena server can call it on any machine.
 *
 * Games: only files that changed since the last run are read again (old full records are large);
 * the per-file state lives in ~/.config/polytopia/supabase-sync-state.json. Rows whose source is gone
 * (a deleted game file, a removed model) are deleted. The schema itself only changes through
 * migrations, never from here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listGameFiles, listModels, listProfiles, ratingsFor, readGame, summarize, type GameSummary } from "./lib/store";

const CONF_DIR = path.join(os.homedir(), ".config", "polytopia");
const STATE = path.join(CONF_DIR, "supabase-sync-state.json");

function config(): { url: string; key: string } | null {
  const env: Record<string, string | undefined> = { ...process.env };
  const file = path.join(CONF_DIR, "supabase.env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  }
  return env.SUPABASE_URL && env.SUPABASE_SECRET_KEY ? { url: env.SUPABASE_URL.replace(/\/$/, ""), key: env.SUPABASE_SECRET_KEY } : null;
}

type State = { files: Record<string, number> };
const readState = (): State => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8")) as State;
  } catch {
    return { files: {} };
  }
};

async function main() {
  const c = config();
  if (!c) {
    console.log("supabase-sync: no SUPABASE_URL / SUPABASE_SECRET_KEY, nothing synced");
    return;
  }
  const rest = async (method: string, table: string, query = "", body?: unknown, prefer?: string) => {
    const res = await fetch(`${c.url}/rest/v1/${table}${query}`, {
      method,
      headers: { apikey: c.key, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${table}: HTTP ${res.status} ${await res.text()}`);
    return method === "GET" ? res.json() : null;
  };
  const upsert = async (table: string, conflict: string, rows: object[]) => {
    for (let i = 0; i < rows.length; i += 500)
      await rest("POST", table, `?on_conflict=${conflict}`, rows.slice(i, i + 500), "resolution=merge-duplicates,return=minimal");
  };
  /** delete the rows of `table` whose `col` is not among `keep` */
  const prune = async (table: string, col: string, keep: string[]) => {
    const have = ((await rest("GET", table, `?select=${col}`)) as Record<string, string>[]).map((r) => r[col]);
    const gone = have.filter((k) => !keep.includes(k));
    for (let i = 0; i < gone.length; i += 100)
      await rest("DELETE", table, `?${col}=in.(${gone.slice(i, i + 100).map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",")})`);
    return gone.length;
  };
  const now = new Date().toISOString();

  const ratings = Object.entries(ratingsFor({})).map(([key, r]) => ({
    key, rating: r.rating, games: r.games, wins: r.wins, lo: r.lo ?? null, hi: r.hi ?? null,
    source: r.source ?? null, updated: r.updated, synced_at: now,
  }));
  await upsert("ratings", "key", ratings);
  const ratingsGone = await prune("ratings", "key", ratings.map((r) => r.key));

  const models = listModels().map((spec) => ({ id: spec.id, spec, synced_at: now }));
  await upsert("models", "id", models);
  const modelsGone = await prune("models", "id", models.map((m) => m.id));

  const profiles = listProfiles().map((p) => ({ id: p.id, name: p.name, created: p.created, synced_at: now }));
  await upsert("profiles", "id", profiles);
  const profilesGone = await prune("profiles", "id", profiles.map((p) => p.id));

  const state = readState();
  const files = listGameFiles();
  const changed: GameSummary[] = [];
  const next: State = { files: {} };
  for (const f of files) {
    const mtime = fs.statSync(f).mtimeMs;
    next.files[f] = mtime;
    if (state.files[f] === mtime) continue;
    try {
      changed.push(summarize(f, readGame(f)));
    } catch (e) {
      console.warn(`supabase-sync: skipped ${f}: ${(e as Error).message}`);
      delete next.files[f];
    }
  }
  await upsert("games", "id", changed.map((g) => ({
    id: g.id, source: g.source, started_at: g.startedAt, ended_at: g.endedAt, map_size: g.mapSize, mode: g.mode,
    seats: g.seats, turn: g.turn, steps: g.steps, over: g.over, winner: g.winner, scores: g.scores, synced_at: now,
  })));
  const ids = files.map((f) => path.basename(f).replace(/\.json\.(gz|br)$/, ""));
  const gamesGone = await prune("games", "id", ids);
  fs.mkdirSync(CONF_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(next));

  console.log(
    `supabase-sync: ${ratings.length} ratings, ${models.length} models, ${profiles.length} profiles, ` +
      `${changed.length} of ${files.length} games sent; removed ${ratingsGone + modelsGone + profilesGone + gamesGone} stale rows`,
  );
}

main().catch((e) => {
  console.error("supabase-sync failed:", e.message);
  process.exit(1);
});
