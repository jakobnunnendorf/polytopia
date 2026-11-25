// Live dashboard for training runs: serves a page with charts and insights on the
// runs in progress (or finished) under a project folder.
//
//   npm run train-dashboard -- [--root <folder>] [--port 8095] [--runs id,id]
//
// --root: the folder holding models/ and logs/ (default: the current folder), so the
// dashboard can watch a run in another worktree. --runs: the run ids to show (default:
// every models/<id> with a checkpoint.json, plus every logs/<id>.log that has a model).
// Reads only; never writes into the run folders.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const ROOT = path.resolve(arg("root", process.cwd()));
const PORT = Number(arg("port", "8095"));
const RUNS_ARG = arg("runs", "");
const PAGE = path.join(__dirname, "train-dashboard.html");
const EXPERIMENTS_PAGE = path.join(__dirname, "experiments.html");
// the lab notebook: experiments/<NN-slug>/experiment.json (structured facts) + report.md (fixed sections)
const EXPERIMENTS = path.join(ROOT, "experiments");
const SAMPLE_EVERY_MS = 20_000;

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------- file reads, cached by mtime and size ----------
const cache = new Map<string, { key: string; value: unknown }>();
function cached<T>(file: string, parse: (text: string) => T): T | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.value as T;
  try {
    const value = parse(fs.readFileSync(file, "utf8"));
    cache.set(file, { key, value });
    return value;
  } catch {
    return hit ? (hit.value as T) : null; // a file caught mid-write: keep the last good read
  }
}
const readJson = (file: string) => cached<Json>(file, (t) => JSON.parse(t));
const readJsonl = (file: string) =>
  cached<Json[]>(file, (t) =>
    t
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l)),
  );

// ---------- which runs ----------
function runIds(): string[] {
  if (RUNS_ARG) return RUNS_ARG.split(",").map((s) => s.trim()).filter(Boolean);
  const models = path.join(ROOT, "models");
  const ids = new Set<string>();
  for (const d of fs.existsSync(models) ? fs.readdirSync(models) : []) {
    if (fs.existsSync(path.join(models, d, "checkpoint.json"))) ids.add(d);
    if (fs.existsSync(path.join(models, d, "sweep.jsonl")) && !fs.existsSync(path.join(models, d, "model.json"))) ids.add(d); // a sweep in progress
  }
  const logs = path.join(ROOT, "logs");
  for (const f of fs.existsSync(logs) ? fs.readdirSync(logs) : []) {
    const id = f.replace(/\.log$/, "");
    if (f.endsWith(".log") && fs.existsSync(path.join(models, id, "model.json"))) ids.add(id);
  }
  return [...ids].sort();
}

// ---------- processes ----------
function processes(): { pid: number; cmd: string }[] {
  try {
    const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 16 << 20 });
    return out
      .split("\n")
      .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
  } catch {
    return [];
  }
}
function trainerProcess(procs: { pid: number; cmd: string }[], id: string) {
  // the node process running the trainer script: not npm's wrapper, and not a shell
  // whose command line merely mentions it (a watcher loop calling pgrep, say)
  return procs.find((p) => /^(\S*\/)?node\s.*scripts\/(train-(es|hill|full|probe)|sweep)\.ts\s/.test(p.cmd) && new RegExp(`--id ${id}(\\s|$)`).test(p.cmd)) ?? null;
}
const flag = (args: string, name: string) => args.match(new RegExp(`--${name}\\s+(\\S+)`))?.[1];

// ---------- log parsing ----------
const num = (s: string | undefined) => (s === undefined ? null : Number(s));
const RE_ES = /^iteration\s+(\d+)\s+(\d+) games\s+mean \|margin\| ([\d.]+) pts\s+\|g\| ([\d.]+)\s+sigma ([\d.]+)\s+\(([\d.]+)%, ([^,]+),/;
const RE_ROUND = /^round\s+(\d+)\s+(\d+) games\s+won\s+(\d+)%\s+points\s+([\d.]+)%(?:\s+LLR\s+(-?[\d.]+))?\s+(KEPT|cap)?\s*\((\d+) kept, sigma ([\d.]+), ([\d.]+)%, ([^,]+),[^)]*\)\s*(.*)$/;
const RE_PROGRESS = /^\s+\[(\d\d):(\d\d)\].*\| (\d+) games in the last (\d+)s, (\d+)\/min overall/;
const RE_CURVE = /^curve\s/;
const RE_EVENT = /^(resumed|stopped|milestone|converged|done|final|saved|early stop)/i;

type LogData = {
  es: { it: number; games: number; margin: number; g: number; sigma: number; pct: number }[];
  rounds: { round: number; games: number; won: number; points: number; llr: number | null; verdict: "kept" | "cap" | "rejected"; kept: number; sigma: number; pct: number; changes: string }[];
  progress: { t: number; recent: number; window: number; overall: number }[];
  events: { kind: string; text: string; at: number | null }[];
  tail: string[];
};
function parseLog(text: string, mtime: number): LogData {
  const out: LogData = { es: [], rounds: [], progress: [], events: [], tail: [] };
  const lines = text.split("\n");
  // progress lines carry HH:MM only: lay them on a timeline that ends at the log's
  // last write, stepping back a day whenever the clock runs backwards
  const stamps: { i: number; hh: number; mm: number }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(RE_PROGRESS);
    if (m) stamps.push({ i, hh: Number(m[1]), mm: Number(m[2]) });
  });
  const times = new Map<number, number>();
  {
    const end = new Date(mtime);
    let day = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    let prevMin = Infinity;
    for (let k = stamps.length - 1; k >= 0; k--) {
      const min = stamps[k].hh * 60 + stamps[k].mm;
      if (min > prevMin + 1) day -= 86_400_000; // went back past midnight
      prevMin = min;
      times.set(stamps[k].i, day + min * 60_000);
    }
  }
  let lastTime: number | null = null;
  lines.forEach((l, i) => {
    let m: RegExpMatchArray | null;
    if ((m = l.match(RE_ES))) {
      out.es.push({ it: +m[1], games: +m[2], margin: +m[3], g: +m[4], sigma: +m[5], pct: +m[6] });
    } else if ((m = l.match(RE_ROUND))) {
      out.rounds.push({
        round: +m[1],
        games: +m[2],
        won: +m[3],
        points: +m[4],
        llr: num(m[5]),
        verdict: m[6] === "KEPT" ? "kept" : m[6] === "cap" ? "cap" : "rejected",
        kept: +m[7],
        sigma: +m[8],
        pct: +m[9],
        changes: (m[11] ?? "").trim(),
      });
    } else if ((m = l.match(RE_PROGRESS))) {
      const t = times.get(i)!;
      lastTime = t;
      out.progress.push({ t, recent: +m[3], window: +m[4], overall: +m[5] });
    } else if (RE_EVENT.test(l.trim()) || (RE_CURVE.test(l) && /BEST\s*$/.test(l))) {
      out.events.push({ kind: RE_CURVE.test(l) ? "best" : l.trim().split(/\s/)[0].toLowerCase(), text: l.trim().replace(/\s+/g, " "), at: lastTime });
    }
  });
  out.tail = lines.filter((l) => l.trim() && !/^\s+look:/.test(l)).slice(-40);
  return out;
}
function readLog(id: string): { file: string | null; data: LogData | null } {
  for (const file of [path.join(ROOT, "logs", `${id}.log`), path.join(ROOT, "models", id, "train.log")]) {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    return { file, data: cached(file, (t) => parseLog(t, st.mtimeMs)) };
  }
  return { file: null, data: null };
}

// ---------- weights ----------
// flatten nested weight tables into "table.key" -> number
function flatten(o: Json, prefix = "", out: Record<string, number> = {}): Record<string, number> {
  for (const [k, v] of Object.entries(o ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number") out[key] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
  }
  return out;
}
function firstSnapshot(id: string): Json | null {
  const dir = path.join(ROOT, "models", id, "snapshots");
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()[0];
  return f ? readJson(path.join(dir, f)) : null;
}

// ---------- throughput samples, taken by this server ----------
const samples = new Map<string, { t: number; games: number }[]>();
function sample() {
  for (const id of runIds()) {
    const ck = readJson(path.join(ROOT, "models", id, "checkpoint.json"));
    if (!ck) continue;
    const list = samples.get(id) ?? [];
    const last = list[list.length - 1];
    if (!last || last.games !== ck.trainingGames || Date.now() - last.t > 5 * 60_000) list.push({ t: Date.now(), games: ck.trainingGames });
    if (list.length > 2000) list.splice(0, list.length - 2000);
    samples.set(id, list);
  }
}

// ---------- state ----------
function runState(id: string, procs: { pid: number; cmd: string }[]) {
  const dir = path.join(ROOT, "models", id);
  const ck = readJson(path.join(dir, "checkpoint.json"));
  const model = readJson(path.join(dir, "model.json"));
  const curve = readJsonl(path.join(dir, "curve.jsonl")) ?? [];
  const sweep = readJsonl(path.join(dir, "sweep.jsonl"));
  const log = readLog(id);
  const proc = trainerProcess(procs, id);
  const args: string = proc?.cmd ?? ck?.args ?? "";
  const kind: "es" | "hill" | "sweep" | "unknown" = sweep ? "sweep" : ck ? ("theta" in ck ? "es" : "round" in ck ? "hill" : "unknown") : model?.training?.method === "evolution-strategies" ? "es" : model?.training ? "hill" : "unknown";
  const budget = Number(flag(args, "budget") ?? model?.training?.budget ?? 0) || null;
  const milestones = (flag(args, "milestones") ?? "")
    .split(",")
    .map(Number)
    .filter((x) => x > 0);
  const milestoneFiles = fs.existsSync(path.join(dir, "milestones")) ? fs.readdirSync(path.join(dir, "milestones")).filter((f) => f.endsWith(".json")) : [];

  // weights: start, current, best
  const snap = firstSnapshot(id);
  let start: Record<string, number> = {};
  let current: Record<string, number> = {};
  let best: Record<string, number> = {};
  let averaged: Record<string, number> | null = null;
  if (kind === "es") {
    const names = Object.keys((model?.weights ?? snap?.weights ?? {}) as object).filter((k) => k !== "noise" && k !== "rewards");
    start = flatten(snap?.weights ?? {});
    const fromTheta = (theta: number[] | undefined) => Object.fromEntries((theta ?? []).map((x, i) => [names[i] ?? `knob${i}`, Math.exp(x)]));
    current = ck ? fromTheta(ck.theta) : flatten(model?.weights ?? {});
    averaged = ck ? fromTheta(ck.ema) : null;
    best = ck?.best?.theta ? fromTheta(ck.best.theta) : flatten(model?.weights ?? {});
    for (const k of Object.keys(start)) if (!(k in current)) delete start[k];
  } else if (kind === "hill") {
    const isFull = !!(snap?.full ?? model?.full);
    start = flatten(isFull ? snap?.full : snap?.weights);
    current = flatten(ck?.weights ?? (isFull ? model?.full : model?.weights));
    best = flatten(ck?.best?.champ ?? (isFull ? model?.full : model?.weights));
  }

  return {
    id,
    kind,
    name: model?.name ?? id,
    running: !!proc,
    pid: proc?.pid ?? null,
    workers: Number(flag(args, "workers") ?? 0) || null,
    pop: Number(flag(args, "pop") ?? 0) || null,
    args,
    budget,
    milestones,
    milestoneFiles,
    checkpoint: ck
      ? {
          savedAt: ck.savedAt,
          startedAt: ck.startedAt,
          seconds: ck.seconds,
          trainingGames: ck.trainingGames,
          iteration: ck.iteration ?? null,
          round: ck.round ?? null,
          accepted: ck.accepted ?? null,
          capped: ck.capped ?? null,
          sinceKeep: ck.sinceKeep ?? null,
          sigma: ck.sigma,
          nextCurve: ck.nextCurve,
          points: ck.points,
          converged: ck.converged,
          resumes: ck.resumes ?? [],
          best: ck.best ? { score: ck.best.score, point: ck.best.point, trainingGames: ck.best.trainingGames, averaged: ck.best.averaged } : null,
        }
      : null,
    finished: !ck && !!model && !model?.training?.provisional,
    curve,
    sweep: sweep ?? null,
    weights: { start, current, best, averaged },
    log: log.data ? { file: log.file, ...log.data } : null,
    samples: samples.get(id) ?? [],
  };
}
// ---------- experiments (the lab notebook) ----------
// experiments/<NN-slug>/: experiment.json (facts), report.tex (fixed sections, written by Jakob and
// Claude), generated.tex + report.pdf (built by scripts/experiment-report.ts, here on demand).
type Open = { section: string; who: string; what: string };
/** the parts of a report still marked \todo{who}{what}, by section */
function openSections(report: string): Open[] {
  const out: Open[] = [];
  for (const part of report.split(/\\section\{/).slice(1)) {
    const section = part.slice(0, part.indexOf("}"));
    for (const m of part.matchAll(/\\todo\{(\w+)\}\{([^}]*)\}/g)) out.push({ section, who: m[1], what: m[2].replace(/\s+/g, " ").trim() });
  }
  return out;
}
/** the report's sections in order, with whether each still has an open part */
function sections(report: string) {
  return report.split(/\\section\{/).slice(1).map((part) => {
    const body = part.slice(part.indexOf("}") + 1).split("\\end{document}")[0];
    const text = body.replace(/\\todo\{\w+\}\{[^}]*\}/g, "").replace(/%.*$/gm, "").replace(/\\ExpResults/g, "x").trim();
    return { section: part.slice(0, part.indexOf("}")), open: /\\todo\{/.test(body), empty: text.length === 0 };
  });
}
function experimentDirs(): string[] {
  if (!fs.existsSync(EXPERIMENTS)) return [];
  return fs.readdirSync(EXPERIMENTS).filter((d) => /^\d/.test(d) && fs.existsSync(path.join(EXPERIMENTS, d, "experiment.json"))).sort();
}
const reportOf = (dir: string) => {
  const f = path.join(EXPERIMENTS, dir, "report.tex");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
};
const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);

// PDFs are built when asked for and out of date (never committed)
const builds = new Map<string, { running: boolean; error: string | null }>();
function build(key: string, args: string[]) {
  const b = builds.get(key) ?? { running: false, error: null };
  if (b.running) return;
  builds.set(key, { running: true, error: null });
  execFile(process.execPath, ["-r", "sucrase/register", path.join(__dirname, "experiment-report.ts"), ...args], { cwd: ROOT }, (err, _out, stderr) => {
    builds.set(key, { running: false, error: err ? String(stderr || err.message).split("\n").slice(-12).join("\n") : null });
  });
}
function pdfOf(dir: string, runIds: string[], anyRunning: boolean) {
  const pdf = path.join(EXPERIMENTS, dir, "report.pdf");
  const sources = [
    path.join(EXPERIMENTS, dir, "experiment.json"),
    path.join(EXPERIMENTS, dir, "report.tex"),
    path.join(EXPERIMENTS, "polyexp.cls"),
    path.join(__dirname, "experiment-report.ts"),
    ...runIds.flatMap((id) => ["sweep.jsonl", "curve.jsonl", "model.json"].map((f) => path.join(ROOT, "models", id, f))),
  ];
  const stale = mtime(pdf) < Math.max(...sources.map(mtime));
  const b = builds.get(dir);
  // while a run of this experiment is going, its data changes every minute: rebuild only once it rests
  if (stale && !b?.running && !b?.error && (!anyRunning || !mtime(pdf))) build(dir, [dir]);
  if (b?.error && mtime(path.join(EXPERIMENTS, dir, "report.tex")) > mtime(pdf) && !b.running) builds.delete(dir); // edited since the failure: try again next time
  return { exists: mtime(pdf) > 0, at: mtime(pdf), stale, building: !!builds.get(dir)?.running, error: builds.get(dir)?.error ?? null };
}
function experimentSummary(dir: string) {
  const meta = readJson(path.join(EXPERIMENTS, dir, "experiment.json"));
  const report = reportOf(dir);
  const procs = processes();
  const running = ((meta?.runs ?? []) as { id: string }[]).some((r) => !!trainerProcess(procs, r.id));
  return { dir, meta, open: openSections(report), sections: sections(report), running };
}
function experimentList() {
  const dirs = experimentDirs();
  const nb = path.join(EXPERIMENTS, "notebook.pdf");
  return { experiments: dirs.map(experimentSummary), notebook: { exists: mtime(nb) > 0, building: !!builds.get("notebook")?.running, error: builds.get("notebook")?.error ?? null } };
}
function experimentDetail(dir: string) {
  if (!experimentDirs().includes(dir)) return null;
  const sum = experimentSummary(dir);
  const procs = processes();
  const runs = ((sum.meta?.runs ?? []) as { id: string; label?: string }[]).map((r) => {
    const m = path.join(ROOT, "models", r.id);
    const model = readJson(path.join(m, "model.json"));
    const log = path.join(ROOT, "logs", `${r.id}.log`);
    const tail = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trimEnd().split("\n").slice(-1)[0] ?? "" : "";
    return {
      ...r,
      exists: fs.existsSync(m),
      running: !!trainerProcess(procs, r.id),
      progress: /^\s*\[\d/.test(tail) ? tail.trim().slice(0, 160) : "",
      sweep: readJsonl(path.join(m, "sweep.jsonl")) ?? null,
      curve: (readJsonl(path.join(m, "curve.jsonl")) ?? []).filter((c: Json) => !c.averaged),
      final: model?.training?.final ?? null,
    };
  });
  const dirsAll = experimentDirs();
  const at = dirsAll.indexOf(dir);
  return { ...sum, runs, pdf: pdfOf(dir, runs.map((r) => r.id), runs.some((r) => r.running)), prev: dirsAll[at - 1] ?? null, next: dirsAll[at + 1] ?? null };
}
function sendPdf(res: http.ServerResponse, file: string) {
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not built yet");
    return;
  }
  res.writeHead(200, { "content-type": "application/pdf", "cache-control": "no-store" });
  res.end(fs.readFileSync(file));
}

function state() {
  const procs = processes();
  const load = os.loadavg();
  return {
    now: Date.now(),
    root: ROOT,
    host: { cpus: os.cpus().length, load1: load[0], load5: load[1], freeMem: os.freemem(), totalMem: os.totalmem() },
    runs: runIds().map((id) => runState(id, procs)),
  };
}

// ---------- server ----------
sample();
setInterval(sample, SAMPLE_EVERY_MS).unref();
http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/state") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(state()));
      } else if (url.pathname === "/api/experiments") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ root: ROOT, ...experimentList() }));
      } else if (url.pathname === "/experiments/notebook.pdf") {
        // the whole notebook: built on the first request and whenever asked again with ?build
        const nb = path.join(EXPERIMENTS, "notebook.pdf");
        if (!fs.existsSync(nb) || url.searchParams.has("build")) {
          build("notebook", ["--all"]);
          res.writeHead(202, { "content-type": "text/html; charset=utf-8", refresh: "4;url=/experiments/notebook.pdf" });
          res.end("<p style='font:14px system-ui;padding:24px'>Building the notebook PDF. This page reloads by itself.</p>");
        } else sendPdf(res, nb);
      } else if (/^\/experiment\/[^/]+\/report\.pdf$/.test(url.pathname)) {
        const dir = decodeURIComponent(url.pathname.split("/")[2]);
        if (!experimentDirs().includes(dir)) throw new Error("no such experiment");
        sendPdf(res, path.join(EXPERIMENTS, dir, "report.pdf"));
      } else if (url.pathname.startsWith("/api/experiment/")) {
        const d = experimentDetail(decodeURIComponent(url.pathname.slice("/api/experiment/".length)));
        res.writeHead(d ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(d ?? { error: "no such experiment" }));
      } else if (url.pathname === "/experiments" || url.pathname.startsWith("/experiment/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(fs.readFileSync(EXPERIMENTS_PAGE));
      } else if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(fs.readFileSync(PAGE));
      } else {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      }
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error)?.stack ?? e));
    }
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`training dashboard: http://localhost:${PORT}  (watching ${ROOT}; runs: ${runIds().join(", ") || "none yet"})`);
  });
