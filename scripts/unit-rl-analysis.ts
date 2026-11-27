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
import { execFile } from "child_process";

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
    if (url.pathname === "/api/runs")
      return json({
        root: ROOT,
        runs: runs(),
        // settings per run, from the first line of its training log
        info: Object.fromEntries(
          runs().map((r) => {
            const m: any = lines(path.join(MODELS, r, "rl.jsonl")).find((l: any) => l.type === "meta") ?? {};
            const method = String(m.method ?? "");
            return [r, { explore: m.explore ?? 0, featureSet: m.featureSet ?? 1, gamma: m.gamma ?? 1, mlp: method.includes("neural"), td: method.includes("TD") }];
          }),
        ),
      });
    if (url.pathname === "/api/analysis")
      return json(JSON.parse(fs.readFileSync(path.join(MODELS, run, "analysis.json"), "utf8")));
    if (url.pathname === "/api/decision") {
      // one recorded decision with its board, for the app's /decision route (another port: allow it)
      const d = JSON.parse(fs.readFileSync(path.join(MODELS, run, "decisions.json"), "utf8"));
      const k = Number(url.searchParams.get("k") ?? 0);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ iteration: d.iteration, example: d.examples[k], state: d.states[k] }));
    }
    if (url.pathname === "/api/replays") {
      // games already replayed for this run, newest first
      const d = path.join(MODELS, run, "replays");
      const files = fs.existsSync(d)
        ? fs.readdirSync(d).filter((f) => /^i\d+-g\d+\.json$/.test(f)).sort((a, b) => fs.statSync(path.join(d, b)).mtimeMs - fs.statSync(path.join(d, a)).mtimeMs).map((f) => f.slice(0, -5))
        : [];
      return json({ files });
    }
    if (url.pathname === "/api/replay") {
      // one replayed game, for the app's /rl-replay route (another port: allow it)
      const file = url.searchParams.get("file") ?? "";
      const p = path.join(MODELS, run, "replays", `${file}.json`);
      if (!/^i\d+-g\d+$/.test(file) || !fs.existsSync(p)) {
        res.writeHead(404, { "access-control-allow-origin": "*" });
        return res.end("no such replay");
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" });
      return res.end(fs.readFileSync(p));
    }
    if (url.pathname === "/api/replay-new") {
      // replay a training game with the trainer: unit-rl replay --run R --iter I [--game G]
      const iter = String(Math.max(1, Math.floor(Number(url.searchParams.get("iter")) || 1)));
      const g = url.searchParams.get("game");
      const args = ["replay", "--run", run, "--iter", iter, "--threads", "1"];
      if (g !== null && g !== "") args.push("--game", String(Math.max(0, Math.floor(Number(g) || 0))));
      execFile(path.join(ROOT, "engine", "target", "release", "unit-rl"), args, { cwd: path.join(ROOT, "engine"), timeout: 120000 }, (err, out, errOut) => {
        if (err) {
          res.writeHead(500);
          return res.end(String(errOut || err.message));
        }
        const d = JSON.parse(out.trim().split("\n").pop() ?? "{}");
        json({ ...d, name: `i${d.iteration}-g${d.game}` });
      });
      return;
    }
    if (url.pathname === "/api/history") return json(lines(path.join(MODELS, run, "analysis-history.jsonl")));
    if (url.pathname === "/api/training") return json(training(run));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fs.readFileSync(PAGE));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Unit RL analysis: http://localhost:${PORT}  (runs in ${MODELS})`));
