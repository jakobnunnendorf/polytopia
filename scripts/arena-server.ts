/**
 * Local arena server for the phone/web app (port 8091). The browser cannot
 * write into the repo or reach LM Studio on the Mac directly, so it talks to this:
 *
 *   GET  /api/models            model specs from models/<id>/model.json
 *   GET  /api/profiles          human profiles      POST /api/profiles {name}
 *   GET  /api/ratings           Elo table
 *   GET  /api/games             summaries of every recorded game (newest first)
 *   GET  /api/games/<id>        one full GameRecord
 *   POST /api/games             save a GameRecord (gzipped into data/games/), update Elo
 *   POST /api/matches           start a model-only game that runs here (not in a browser tab)
 *   POST /api/matches/<id>/resume   continue an unfinished model-only game
 *   POST /api/chat              proxy an OpenAI-style chat call to the model's endpoint
 *
 *   node -r sucrase/register scripts/arena-server.ts      (started by relaunch-preview.sh)
 */
import http from "node:http";
import { directChat } from "../logic/agents/registry";
import type { GameRecord } from "../logic/arena/record";
import { createProfile, findGame, listGames, listModels, listProfiles, readRatings, saveGame } from "./lib/store";
import { isRunning, resumeMatch, startMatch } from "./lib/matches";

const PORT = Number(process.env.ARENA_PORT ?? 8091);

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
    if (req.method === "GET" && url === "/api/ratings") return send(res, 200, readRatings());
    if (req.method === "GET" && url === "/api/games") return send(res, 200, listGames().map((g) => ({ ...g, running: isRunning(g.id) })));
    if (req.method === "POST" && url === "/api/matches") {
      const b = (await body(req)) as Parameters<typeof startMatch>[0];
      const rec = startMatch(b);
      console.log(`match ${rec.id} started: ${rec.seats.map((x) => (x.kind === "model" ? x.modelId : x.name)).join(" vs ")}`);
      return send(res, 200, { id: rec.id });
    }
    const resume = url.match(/^\/api\/matches\/([^/]+)\/resume$/);
    if (req.method === "POST" && resume) return send(res, 200, resumeMatch(decodeURIComponent(resume[1])));
    if (req.method === "GET" && url.startsWith("/api/games/")) {
      const rec = findGame(decodeURIComponent(url.slice("/api/games/".length)));
      return rec ? send(res, 200, rec) : send(res, 404, { error: "No such game" });
    }
    if (req.method === "POST" && url === "/api/profiles") {
      const { name } = (await body(req)) as { name?: string };
      if (!name || !name.trim()) return send(res, 400, { error: "Profile needs a name" });
      return send(res, 200, createProfile(name));
    }
    if (req.method === "POST" && url === "/api/games") {
      const rec = (await body(req)) as GameRecord;
      if (rec?.version !== 1 || !Array.isArray(rec.steps)) return send(res, 400, { error: "Not a game record" });
      const out = saveGame(rec);
      console.log(`saved ${out.file} (${rec.steps.length} steps${rec.result?.over ? ", rated" : ""})`);
      return send(res, 200, out);
    }
    if (req.method === "POST" && url === "/api/chat") {
      const r = (await body(req)) as Parameters<typeof directChat>[0];
      const content = await directChat(r);
      return send(res, 200, { content });
    }
    send(res, 404, { error: "Unknown route" });
  } catch (e) {
    send(res, 500, { error: String((e as Error).message ?? e) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`arena server on :${PORT}`));
