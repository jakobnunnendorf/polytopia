/**
 * Local arena server for the phone/web app (port 8091). The browser cannot
 * write into the repo directly, so it talks to this:
 *
 *   GET  /api/models            model specs from models/<id>/model.json
 *   GET  /api/profiles          human profiles      POST /api/profiles {name}
 *   GET  /api/ratings           Elo table; ?mode=&players=&size=&mapType= fits it on only those games
 *   GET  /api/ratings/facets    rated games per mode, player count, map size and map type
 *   GET  /api/games             summaries of every recorded game (newest first)
 *   GET  /api/games/<id>        one full GameRecord (start position + every move)
 *        ?live=1                the same game from its newest checkpoint on (for watching a long game live)
 *        ?from=N                only the moves after the first N, plus result and stop state
 *   POST /api/games             save a GameRecord (gzipped into data/games/), update Elo
 *   POST /api/matches           start a model-only game that runs here (not in a browser tab)
 *   POST /api/matches/<id>/resume   continue an unfinished model-only game
 *   GET|POST /api/matches/<id>/pace  read or set ms per move of a running game ({ms})
 *   POST /api/matches/<id>/stop     stop a model-only game (kept, not rated, never resumed)
 *
 *   node -r sucrase/register scripts/arena-server.ts      (started by relaunch-preview.sh)
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { liveWindow, type GameRecord } from "../logic/arena/record";
import { createProfile, findGame, listGames, listModels, listProfiles, ratingFacets, ratingsFor, saveGame } from "./lib/store";
import { isRunning, paceOf, resumeMatch, setPace, startMatch, stopMatch } from "./lib/matches";

const PORT = Number(process.env.ARENA_PORT ?? 8091);

// ---------- copy to Supabase for the hosted web game (scripts/supabase-sync.ts) ----------
// in a child process, so a slow sync never blocks a request; every 5 minutes (also bot matches,
// which save without a request) and a few seconds after a saved game or a new profile.
let syncing = false;
let syncAgain = false;
let syncTimer: NodeJS.Timeout | null = null;
function runSync() {
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  const child = spawn(process.execPath, ["-r", "sucrase/register", path.join(__dirname, "supabase-sync.ts")], { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", () => {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync(1000);
    }
  });
}
function scheduleSync(ms: number) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, ms);
}
setInterval(runSync, 5 * 60 * 1000);
scheduleSync(10 * 1000);

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function body(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && url === "/api/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url === "/api/models") return send(res, 200, listModels());
    if (req.method === "GET" && url === "/api/profiles") return send(res, 200, listProfiles());
    if (req.method === "GET" && url === "/api/ratings") {
      const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
      return send(res, 200, ratingsFor({ mode: q.get("mode") ?? undefined, players: num("players"), size: num("size"), mapType: q.get("mapType") ?? undefined }));
    }
    if (req.method === "GET" && url === "/api/ratings/facets") return send(res, 200, ratingFacets());
    if (req.method === "GET" && url === "/api/games") return send(res, 200, listGames().map((g) => ({ ...g, running: isRunning(g.id) })));
    if (req.method === "POST" && url === "/api/matches") {
      const b = (await body(req)) as Parameters<typeof startMatch>[0];
      const rec = startMatch(b);
      console.log(`match ${rec.id} started: ${rec.seats.map((x) => (x.kind === "model" ? x.modelId : x.name)).join(" vs ")}`);
      return send(res, 200, { id: rec.id });
    }
    const resume = url.match(/^\/api\/matches\/([^/]+)\/resume$/);
    if (req.method === "POST" && resume) return send(res, 200, resumeMatch(decodeURIComponent(resume[1])));
    const pace = url.match(/^\/api\/matches\/([^/]+)\/pace$/);
    if (req.method === "GET" && pace) return send(res, 200, { ms: paceOf(decodeURIComponent(pace[1])) });
    if (req.method === "POST" && pace) {
      const { ms } = ((await body(req)) ?? {}) as { ms?: number };
      return send(res, 200, setPace(decodeURIComponent(pace[1]), Number(ms)));
    }
    const stop = url.match(/^\/api\/matches\/([^/]+)\/stop$/);
    if (req.method === "POST" && stop) return send(res, 200, stopMatch(decodeURIComponent(stop[1])));
    if (req.method === "GET" && url.startsWith("/api/games/")) {
      const rec = findGame(decodeURIComponent(url.slice("/api/games/".length)));
      if (!rec) return send(res, 404, { error: "No such game" });
      const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      // ?from=N: only the moves after the first N, for a live view that already has the rest
      if (q.has("from")) {
        const from = Math.max(0, Math.floor(Number(q.get("from")) || 0));
        return send(res, 200, { total: rec.steps.length, steps: rec.steps.slice(from), endedAt: rec.endedAt, result: rec.result, stoppedAt: rec.stoppedAt ?? null });
      }
      // ?live=1: the game from its newest checkpoint on, not from move 1
      return send(res, 200, q.get("live") === "1" ? liveWindow(rec) : rec);
    }
    if (req.method === "POST" && url === "/api/profiles") {
      const { name } = (await body(req)) as { name?: string };
      if (!name || !name.trim()) return send(res, 400, { error: "Profile needs a name" });
      scheduleSync(3000);
      return send(res, 200, createProfile(name));
    }
    if (req.method === "POST" && url === "/api/games") {
      const rec = (await body(req)) as GameRecord;
      if (rec?.version !== 1 || !Array.isArray(rec.steps)) return send(res, 400, { error: "Not a game record" });
      const out = saveGame(rec);
      console.log(`saved ${out.file} (${rec.steps.length} steps${rec.result?.over ? ", rated" : ""})`);
      scheduleSync(3000);
      return send(res, 200, out);
    }
    send(res, 404, { error: "Unknown route" });
  } catch (e) {
    send(res, 500, { error: String((e as Error).message ?? e) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`arena server on :${PORT}`));
