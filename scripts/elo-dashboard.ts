// Dashboard for the Elo tournament (scripts/elo-tournament.ts): the run's progress while it plays,
// then the rankings per mode, the pairwise matrix and the tables.
//
//   npm run elo-dashboard -- [--root <folder>] [--run 2026-11-25] [--port 8097]
//
// --root: the folder holding elo/ and data/ (default: the current folder), so the dashboard can
// watch a tournament in another worktree. --run: the folder under elo/ to show (default: the newest
// with results). The page can switch runs with ?run=<name>. Reads only; ratings are refitted from
// results.jsonl whenever it changes, so they are live during a run.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ANCHOR_ID, ANCHOR_RATING, fitAll, parseResults, type Ratings } from "./lib/elo-fit";

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const ROOT = path.resolve(arg("root", process.cwd()));
const PORT = Number(arg("port", "8097"));
const RUN = arg("run", "");
const PAGE = path.join(__dirname, "elo-dashboard.html");
const ELO = path.join(ROOT, "elo");

function runs(): string[] {
  try {
    return fs
      .readdirSync(ELO)
      .filter((d) => fs.existsSync(path.join(ELO, d, "results.jsonl")))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// the fit of a run, cached until its results.jsonl changes
const fits = new Map<string, { key: string; value: { meta: unknown; ratings: Ratings | null; rows: number; fitMs: number } }>();
function fitted(run: string, running: boolean) {
  const file = path.join(ELO, run, "results.jsonl");
  const st = fs.statSync(file);
  // fewer refits while the file grows every few seconds; the full 1000 once the run has ended
  const bootstrap = running ? 200 : 1000;
  const key = `${st.mtimeMs}:${st.size}:${bootstrap}`;
  const hit = fits.get(run);
  if (hit && hit.key === key) return { ...hit.value, bootstrap };
  const t0 = Date.now();
  const { meta, rows } = parseResults(fs.readFileSync(file, "utf8"));
  const value = { meta, ratings: meta && rows.length ? fitAll(meta, rows, bootstrap) : null, rows: rows.length, fitMs: 0 };
  value.fitMs = Date.now() - t0;
  fits.set(run, { key, value });
  return { ...value, bootstrap };
}

function state(want: string) {
  const all = runs();
  const run = all.includes(want) ? want : all.includes(RUN) ? RUN : all[0];
  if (!run) return { runs: all, run: null, note: `no tournament under ${ELO} yet: npm run elo-tournament` };
  const progress = readJson(path.join(ELO, run, "progress.json")) as { pid?: number; running?: boolean } | null;
  // a run that died without saying so: its process is gone
  const running = !!progress?.running && !!progress.pid && alive(progress.pid);
  const old = (readJson(path.join(ROOT, "data", "ratings.json")) ?? {}) as Record<string, unknown>;
  const previous = Object.fromEntries(Object.entries(old).filter(([k]) => k.startsWith("model:")).map(([k, v]) => [k.slice(6), v]));
  return {
    runs: all,
    run,
    root: ROOT,
    at: new Date().toISOString(),
    anchor: { id: ANCHOR_ID, rating: ANCHOR_RATING },
    running,
    stopped: !!progress?.running && !running,
    progress,
    previous,
    ...fitted(run, running),
  };
}

http
  .createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api/state") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(state(url.searchParams.get("run") ?? "")));
      } else if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(fs.readFileSync(PAGE));
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error).stack ?? e));
    }
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`elo dashboard: http://localhost:${PORT}  (watching ${ELO}; runs: ${runs().join(", ") || "none yet"})`);
  });
