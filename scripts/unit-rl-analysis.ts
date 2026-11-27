/**
 * Analysis dashboard for experiment 24 (unit value function): what the agent values, does and earns.
 *
 *   node -r sucrase/register scripts/unit-rl-analysis.ts [--port 8100] [--root <repo or worktree>]
 *
 * Reads models/<run>/analysis.json (written by `unit-rl analyse --run <run>`), analysis-history.jsonl and the
 * training log rl.jsonl, for every run folder that has an analysis.json. The page polls every 10 s.
 */
import fs from "fs";
import http from "http";
import path from "path";

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const PORT = Number(arg("port", "8100"));
const ROOT = path.resolve(arg("root", path.join(__dirname, "..")));
const MODELS = path.join(ROOT, "models");
const PAGE = path.join(__dirname, "unit-rl-analysis.html");

function runs(): string[] {
  if (!fs.existsSync(MODELS)) return [];
  return fs
    .readdirSync(MODELS)
    .filter((d) => fs.existsSync(path.join(MODELS, d, "analysis.json")))
    .sort();
}

function lines(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** the training curve, without the large per-iteration fields */
function training(run: string): unknown[] {
  return lines(path.join(MODELS, run, "rl.jsonl")).map((l: any) =>
    l.type === "iter"
      ? { type: "iter", i: l.i, seconds: l.seconds, epsilon: l.epsilon, err: l.err, diff: l.eval?.diff, kills: l.eval?.kills,
          losses: l.eval?.losses, capturesCity: l.eval?.capturesCity, capturesVillage: l.eval?.capturesVillage, score: l.score }
      : l,
  );
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (v: unknown) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(v));
    };
    const run = url.searchParams.get("run") ?? "";
    if (run && !runs().includes(run)) {
      res.writeHead(404);
      return res.end("unknown run");
    }
    if (url.pathname === "/api/runs") return json({ root: ROOT, runs: runs() });
    if (url.pathname === "/api/analysis")
      return json(JSON.parse(fs.readFileSync(path.join(MODELS, run, "analysis.json"), "utf8")));
    if (url.pathname === "/api/decision") {
      // one recorded decision with its board, for the app's /decision route (another port: allow it)
      const d = JSON.parse(fs.readFileSync(path.join(MODELS, run, "decisions.json"), "utf8"));
      const k = Number(url.searchParams.get("k") ?? 0);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ iteration: d.iteration, example: d.examples[k], state: d.states[k] }));
    }
    if (url.pathname === "/api/history") return json(lines(path.join(MODELS, run, "analysis-history.jsonl")));
    if (url.pathname === "/api/training") return json(training(run));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(PAGE));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Unit RL analysis: http://localhost:${PORT}  (runs in ${MODELS})`));
