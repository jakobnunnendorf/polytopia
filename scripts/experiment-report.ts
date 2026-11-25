/**
 * Builds the LaTeX report of an experiment in the lab notebook (experiments/<NN-slug>/):
 *
 *   experiment.json   the structured facts (hand-written, see experiments/TEMPLATE)
 *   report.tex        the fixed sections (hand-written): \ExpHeader, Question ... Notes
 *   generated.tex     written here: \ExpHeader (title, facts, flow diagram, headline numbers) and
 *                     \ExpResults (per run: sweep table and plot, learning curve, final test),
 *                     all from experiment.json and the measured data in models/<run>/
 *   report.pdf        compiled here with tectonic
 *
 *   npm run experiment:report -- 06-peace-break        one experiment
 *   npm run experiment:report -- --all                 every experiment and the combined notebook
 *   npm run experiment:report -- --all --no-pdf        only regenerate generated.tex
 *
 * The combined notebook (experiments/notebook.tex and .pdf) holds every report as one section: the
 * raw material for a paper.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const EXP = path.join(ROOT, "experiments");
const argv = process.argv.slice(2);
const NO_PDF = argv.includes("--no-pdf");
const ALL = argv.includes("--all");

type Vs = Record<string, { winRate: number; pointShare: number; games: number; finish?: number; conquest?: number; turns?: number }>;
type Row = { start?: boolean; final?: boolean | number; point?: string; meanShare?: number; meanWin?: number; meanFinish?: number; vs?: Vs; games?: number };
type Meta = {
  n: number; slug: string; title: string; kind: string; issue?: number; pr?: number; date: string; status: string; verdict: string;
  base: string; result?: string | null; question: string; change: string; method: string; measured?: string; metric: string; setups: string[];
  knobs?: { name: string; tested?: (number | string)[]; chosen?: number | string | null }[];
  headline?: { label: string; base: number | null; new: number | null; unit?: string }[];
  runs?: { id: string; label?: string }[];
};

// ---------- LaTeX helpers ----------
export const tex = (s: unknown) =>
  String(s ?? "")
    .replace(/\\/g, "\\textbackslash ")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde ")
    .replace(/\^/g, "\\textasciicircum ")
    .replace(/→/g, "$\\rightarrow$")
    .replace(/×/g, "$\\times$")
    .replace(/±/g, "$\\pm$")
    .replace(/≥/g, "$\\geq$")
    .replace(/≤/g, "$\\leq$")
    .replace(/−/g, "$-$");
const pct = (x: number | undefined | null, d = 1) => (x == null || Number.isNaN(x) ? "--" : (x * 100).toFixed(d));
const num = (x: number | undefined | null, d = 1) => (x == null || Number.isNaN(x) ? "--" : x.toFixed(d));
const mean = (vs: Vs, f: (v: Vs[string]) => number | undefined, skip?: string) => {
  const xs = Object.entries(vs).filter(([k]) => k !== skip).map(([, v]) => f(v)).filter((x): x is number => x != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
};
const readJsonl = (f: string): Row[] => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const short = (id: string) => id.replace(/^greedy-/, "");

const VERDICT: Record<string, [string, string]> = {
  kept: ["expgreen", "KEPT"],
  "not kept": ["expred", "NOT KEPT"],
  tie: ["expgrey", "TIE, NOT KEPT"],
  adopted: ["expblue", "ADOPTED"],
  pending: ["exporange", "RUNNING"],
  planned: ["expgrey", "PLANNED"],
};
const verdictOf = (m: Meta) => VERDICT[m.verdict] ?? ["expgrey", m.verdict.toUpperCase()];

// ---------- the generated parts ----------
function header(m: Meta): string {
  const [vc, vt] = verdictOf(m);
  const knobs = (m.knobs ?? []).map((k) => `\\knob{${tex(k.name)}}${k.tested?.length ? ` $\\in$ \\{${k.tested.map(tex).join(", ")}\\}` : ""}${k.chosen != null ? `, ${m.verdict === "kept" ? "chosen" : "best"} ${tex(k.chosen)}` : ""}`).join("; ");
  const head = m.headline?.[0];
  const delta = head && head.base != null && head.new != null ? `${head.new - head.base >= 0 ? "+" : "$-$"}${Math.abs(head.new - head.base).toFixed(1)}${head.unit === "%" ? "\\pp" : ""}` : "";
  const box = (label: string, body: string) => `{\\sffamily\\bfseries\\scriptsize\\color{expgrey}${label}}\\\\[1pt]${body}`;
  const flow = [
    box("BASE", `\\model{${tex(short(m.base))}}`),
    box("CHANGE", (m.knobs ?? []).length ? (m.knobs ?? []).map((k) => `\\knob{${tex(k.name)}}${k.tested?.length ? `\\\\{\\scriptsize ${k.tested.map(tex).join(", ")}}` : ""}`).join("\\\\") : tex(m.kind)),
    box("MEASURED", `${tex(m.measured ?? m.method)}\\\\{\\scriptsize ${m.setups.length} setup${m.setups.length > 1 ? "s" : ""}, metric: ${tex(m.metric)}}`),
    box("RESULT", head ? `${tex(head.label)}\\\\{\\scriptsize ${head.base != null ? `${num(head.base)} $\\rightarrow$ ` : ""}${num(head.new)}${head.unit === "%" ? "\\,\\%" : ""}}${delta ? `\\\\\\textbf{${delta}}` : ""}` : "--"),
    box("VERDICT", `\\textbf{\\color{${vc}}${vt}}${m.result ? `\\\\{\\scriptsize new champion:}\\\\\\model{${tex(short(m.result))}}` : ""}`),
  ];
  const nodes = flow.map((b, i) => `\\node[flowbox${i ? `,right=5mm of n${i - 1}` : ""}] (n${i}) {${b}};`).join("\n    ");
  const arrows = flow.slice(1).map((_, i) => `\\draw[flowarrow] (n${i}) -- (n${i + 1});`).join(" ");
  const headline = (m.headline ?? []).length
    ? `\\begin{center}\\sffamily\\small\\begin{tabular}{@{}lrrr@{}}\\toprule
Measure & Base & New & Change\\\\\\midrule
${(m.headline ?? []).map((h) => `${tex(h.label)} & ${num(h.base)}${h.unit === "%" && h.base != null ? "\\,\\%" : ""} & ${num(h.new)}${h.unit === "%" && h.new != null ? "\\,\\%" : ""} & ${h.base != null && h.new != null ? `${h.new - h.base >= 0 ? "+" : "$-$"}${Math.abs(h.new - h.base).toFixed(1)}` : "--"}\\\\`).join("\n")}
\\bottomrule\\end{tabular}\\end{center}`
    : "";
  return `{\\sffamily\\footnotesize\\color{expgrey}EXPERIMENT ${m.n} \\textperiodcentered\\ ${tex(m.kind.toUpperCase())} \\hfill ${tex(m.date)}}\\par
{\\LARGE\\bfseries\\sffamily ${tex(m.title)}}\\hfill\\verdictbox{${vc}}{${vt}}\\par\\smallskip
{\\itshape ${tex(m.question)}}\\par\\medskip
\\begin{tabular}{@{}p{22mm}p{\\dimexpr\\linewidth-26mm}@{}}
\\fact{Change}{${tex(m.change)}}${knobs ? `\n\\fact{Knobs}{${knobs}}` : ""}
\\fact{Base}{\\model{${tex(m.base)}}${m.result ? ` $\\rightarrow$ result \\model{${tex(m.result)}}` : ""}}
\\fact{Method}{${tex(m.method)}; metric: ${tex(m.metric)}}
\\fact{Setups}{${m.setups.map(tex).join("; ")}}
\\fact{Record}{${m.issue ? `issue \\issue{${m.issue}}` : ""}${m.pr ? `, pull request \\issue{${m.pr}}` : ""}; status: ${tex(m.status)}}
\\end{tabular}\\par\\medskip
\\begin{center}\\begin{tikzpicture}[node distance=5mm]
    ${nodes}
    ${arrows}
\\end{tikzpicture}\\end{center}
${headline}`;
}

function finalTable(vs: Vs, caption: string, baseId?: string): string {
  const has = Object.values(vs).some((v) => v.finish != null);
  const fixed = baseId && vs[baseId] && Object.keys(vs).length > 1 ? baseId : undefined;
  const meanRow = `\\midrule\n\\textbf{Mean${fixed ? ` without \\model{${tex(short(fixed))}}` : ""}} & ${pct(mean(vs, (v) => v.winRate, fixed), 1)} & ${pct(mean(vs, (v) => v.pointShare, fixed), 1)}${has ? ` & ${pct(mean(vs, (v) => v.finish, fixed), 1)} & ${pct(mean(vs, (v) => v.conquest, fixed), 1)} & ${num(mean(vs, (v) => v.turns, fixed), 1)}` : ""}\\\\`;
  const rows = Object.entries(vs).map(([id, v]) => {
    const ci = 1.96 * Math.sqrt((v.winRate * (1 - v.winRate)) / v.games);
    return `\\model{${tex(short(id))}} & ${pct(v.winRate, 0)} $\\pm$ ${(ci * 100).toFixed(0)} & ${pct(v.pointShare)}${has ? ` & ${pct(v.finish)} & ${pct(v.conquest, 0)} & ${num(v.turns, 0)}` : ""}\\\\`;
  });
  return `\\begin{center}\\sffamily\\small\\begin{tabular}{@{}lrr${has ? "rrr" : ""}@{}}\\toprule
Opponent & Won (\\%) & Points (\\%)${has ? " & Finish (\\%) & Conquest (\\%) & Turns" : ""}\\\\\\midrule
${rows.join("\n")}
${meanRow}
\\bottomrule\\end{tabular}\\\\[3pt]{\\footnotesize\\color{expgrey}${tex(caption)}}\\end{center}`;
}

function sweepPart(m: Meta, rows: Row[]): string {
  const head = rows.find((r) => r.start) as (Row & { from?: string; games?: number }) | undefined;
  const pts = rows.filter((r) => !r.start && r.final !== true && r.vs);
  const fin = rows.find((r) => r.final === true);
  if (!pts.length) return "{\\small\\color{expgrey}No points measured yet.}";
  const useFinish = pts.every((r) => r.meanFinish != null);
  const val = (r: Row) => (useFinish ? r.meanFinish! : r.meanShare!) * 100;
  const base = pts.find((r) => r.point === "base");
  const baseId = head?.from ?? m.base;
  // one knob: label points by their value only
  const names = [...new Set(pts.filter((r) => r.point !== "base").flatMap((r) => r.point!.split(",").map((kv) => kv.split("=")[0])))];
  const lab = (r: Row) => (r.point === "base" ? "base" : names.length === 1 ? r.point!.split("=")[1] : r.point!);
  const table = `\\begin{center}\\sffamily\\small\\begin{tabular}{@{}lrrrrrr@{}}\\toprule
Point & Finish (\\%) & Points (\\%) & Won (\\%) & Conquest (\\%) & Turns & vs base: points (\\%)\\\\\\midrule
${pts.map((r) => `${tex(r.point)} & ${pct(r.meanFinish, 2)} & ${pct(r.meanShare, 2)} & ${pct(r.meanWin, 1)} & ${pct(mean(r.vs!, (v) => v.conquest), 1)} & ${num(mean(r.vs!, (v) => v.turns), 1)} & ${pct(r.vs![baseId]?.pointShare)}\\\\`).join("\n")}
\\bottomrule\\end{tabular}\\\\[3pt]{\\footnotesize\\color{expgrey}Panel means; ${head?.games ?? "?"} games against each of ${Object.keys(pts[0].vs!).length} panel models per point.}\\end{center}`;
  const plot = pts.length > 1
    ? `\\begin{center}\\begin{tikzpicture}\\begin{axis}[expplot,height=4.6cm,xtick={${pts.map((_, i) => i).join(",")}},xticklabels={${pts.map((r) => `{${tex(lab(r))}}`).join(",")}},
  xlabel={${names.length === 1 ? `\\texttt{${tex(names[0])}}` : "point"}},ylabel={${useFinish ? "Finish score" : "Points share"}, panel mean (\\%)},enlarge x limits=0.12,enlarge y limits=0.25]
${base ? `\\addplot[dashed,expgrey,line width=0.7pt,forget plot] coordinates {(0,${val(base).toFixed(3)}) (${pts.length - 1},${val(base).toFixed(3)})};` : ""}
\\addplot[only marks,mark=*,mark size=2.6pt,expblue] coordinates {${pts.map((r, i) => (r.point === "base" ? "" : `(${i},${val(r).toFixed(3)})`)).join(" ")}};
${base ? `\\addplot[only marks,mark=*,mark size=2.6pt,expgrey] coordinates {(${pts.indexOf(base)},${val(base).toFixed(3)})};` : ""}
\\end{axis}\\end{tikzpicture}\\\\[-2pt]{\\footnotesize\\color{expgrey}Dashed: the base. Grey: base; blue: sweep points.}\\end{center}`
    : "";
  const final = fin?.vs ? finalTable(fin.vs, `Final test of ${fin.point}: ${Object.values(fin.vs)[0]?.games ?? "?"} unseen games against each.`, baseId) : "";
  // a measurement of the base alone: only its final test counts (the point row is a 2-game stub)
  if (pts.length === 1 && final) return final;
  return `${table}\n${plot}\n${final}`;
}

function curvePart(curve: any[], final: Vs | null): string {
  const main = curve.filter((c) => !c.averaged);
  if (!main.length) return "";
  const plot = `\\begin{center}\\begin{tikzpicture}\\begin{axis}[expplot,height=4.6cm,xlabel={training games (thousands)},ylabel={Points share, panel mean (\\%)},enlarge y limits=0.2]
\\addplot[dashed,expgrey,line width=0.7pt,forget plot] coordinates {(${(main[0].trainingGames / 1000).toFixed(1)},${(main[0].meanPointShare * 100).toFixed(2)}) (${(main[main.length - 1].trainingGames / 1000).toFixed(1)},${(main[0].meanPointShare * 100).toFixed(2)})};
\\addplot[expblue,mark=*,mark size=1.8pt] coordinates {${main.map((c) => `(${(c.trainingGames / 1000).toFixed(1)},${(c.meanPointShare * 100).toFixed(2)})`).join(" ")}};
\\end{axis}\\end{tikzpicture}\\\\[-2pt]{\\footnotesize\\color{expgrey}Learning curve of the tuning run (${main[main.length - 1].kept ?? 0} kept changes in ${main[main.length - 1].round ?? "?"} rounds). Dashed: the start, i.e. the mechanism at its hand-set value.}\\end{center}`;
  return `${plot}\n${final ? finalTable(final, "Final test of the saved model: 400 unseen games against each panel model.") : ""}`;
}

function results(m: Meta): string {
  const parts = (m.runs ?? []).map((r) => {
    const dir = path.join(ROOT, "models", r.id);
    const sweep = readJsonl(path.join(dir, "sweep.jsonl"));
    const curve = readJsonl(path.join(dir, "curve.jsonl")) as any[];
    const model = fs.existsSync(path.join(dir, "model.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8")) : null;
    const body = sweep.length ? sweepPart(m, sweep) : curve.length ? curvePart(curve, model?.training?.final ?? null) : "{\\small\\color{expgrey}No data recorded for this run yet.}";
    return `\\subsection{${tex(r.label ?? r.id)} {\\normalfont\\small(\\model{${tex(r.id)}})}}\n${body}`;
  });
  return parts.join("\n\n") || "{\\small\\color{expgrey}No runs recorded.}";
}

export function generate(dir: string): Meta {
  const m: Meta = JSON.parse(fs.readFileSync(path.join(EXP, dir, "experiment.json"), "utf8"));
  const out = `% generated by scripts/experiment-report.ts from experiment.json and models/<run>/ - do not edit
\\providecommand{\\ExpHeader}{}\\renewcommand{\\ExpHeader}{%
${header(m)}
}
\\providecommand{\\ExpResults}{}\\renewcommand{\\ExpResults}{%
${results(m)}
}
`;
  fs.writeFileSync(path.join(EXP, dir, "generated.tex"), out);
  return m;
}

function compile(cwd: string, file: string) {
  try {
    execFileSync("tectonic", ["--chatter", "minimal", file], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e: any) {
    const log = String(e?.stderr ?? "") + String(e?.stdout ?? "");
    throw new Error(`tectonic failed for ${path.join(cwd, file)}:\n${log.split("\n").slice(-25).join("\n")}`);
  }
}

export const experimentDirs = () => fs.readdirSync(EXP).filter((d) => /^\d/.test(d) && fs.existsSync(path.join(EXP, d, "experiment.json"))).sort();

function notebook(dirs: string[]) {
  const parts = dirs.map((d) => {
    const m: Meta = JSON.parse(fs.readFileSync(path.join(EXP, d, "experiment.json"), "utf8"));
    const src = fs.readFileSync(path.join(EXP, d, "report.tex"), "utf8");
    const body = (src.split("\\begin{document}")[1] ?? "").split("\\end{document}")[0]
      .replace(/\\input\{generated\}/g, `\\input{${d}/generated}`)
      .replace(/\\subsection/g, "\\subsubsection")
      .replace(/\\section/g, "\\subsection");
    return `\\clearpage\\phantomsection\\addcontentsline{toc}{section}{Experiment ${m.n}: ${tex(m.title)} (${tex(m.verdict)})}\n${body}`;
  });
  fs.writeFileSync(
    path.join(EXP, "notebook.tex"),
    `% generated by scripts/experiment-report.ts --all: every experiment report in one document - do not edit
\\documentclass{polyexp}
\\titleformat{\\subsection}{\\large\\bfseries\\sffamily}{}{0pt}{}
\\titleformat{\\subsubsection}{\\normalsize\\bfseries\\sffamily\\color{expgrey}}{}{0pt}{}
\\setcounter{tocdepth}{1}
\\begin{document}
{\\sffamily\\Huge\\bfseries Polytopia AI research}\\par\\medskip
{\\sffamily\\Large Experiment notebook}\\par\\medskip
{\\sffamily\\small\\color{expgrey}${dirs.length} experiments \\textperiodcentered\\ built ${new Date().toISOString().slice(0, 10)}}\\par\\bigskip
\\tableofcontents
${parts.join("\n")}
\\end{document}
`,
  );
  if (!NO_PDF) compile(EXP, "notebook.tex");
}

if (require.main === module) {
  const dirs = ALL ? experimentDirs() : argv.filter((a) => !a.startsWith("--")).map((a) => a.replace(/\/$/, "").replace(/^experiments\//, ""));
  if (!dirs.length) throw new Error("give an experiment folder (experiments/<NN-slug>) or --all");
  for (const d of dirs) {
    generate(d);
    if (!NO_PDF) compile(path.join(EXP, d), "report.tex");
    console.log(`${d}: generated.tex${NO_PDF ? "" : " and report.pdf"}`);
  }
  if (ALL) {
    notebook(dirs);
    console.log(`notebook.tex${NO_PDF ? "" : " and notebook.pdf"} (${dirs.length} experiments)`);
  }
}
