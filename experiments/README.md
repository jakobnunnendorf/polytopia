# Experiment notebook

One folder per experiment, numbered in the order they were run. Together they are the raw
material for a paper: every experiment has the same structure, the same diagram and the same
report sections.

```
experiments/
  polyexp.cls              the LaTeX class of every report
  TEMPLATE/                copy this to start an experiment
  NN-slug/
    experiment.json        the facts (question, change, knobs, setups, headline numbers, runs)
    report.tex             the report: nine fixed sections, written by Jakob and Claude
    generated.tex          built: header, flow diagram, tables and plots from the measured data
    report.pdf             built, not committed
  notebook.tex             built: every report in one document
```

**View:** `npm run train-dashboard`, then http://localhost:8095/experiments. Each experiment has
a page with its diagram, live results while a run is going, the parts of the report still to fill
in, and the PDF. The dashboard rebuilds a PDF whenever its sources change.

**Build by hand:** `npm run experiment:report -- NN-slug` (one), `-- --all` (all, plus
`notebook.pdf`). Needs `tectonic` (`brew install tectonic`).

## Starting an experiment

1. `cp -r experiments/TEMPLATE experiments/NN-slug`, fill `experiment.json` (status `running`,
   verdict `pending`) and list the run ids under `runs` (the `models/<id>` folders the sweeps
   will write).
2. **Before the first run**, write *Question and hypothesis*, *Mechanism* and *Setup*. The
   hypothesis is a prediction: which number should move, which way, about how far.
3. After the runs, fill the rest, set `headline`, `verdict`, `status`, and `result` (the new
   champion's id) when kept.

## The report sections

| Section | When | Who |
|---|---|---|
| Question and hypothesis | before | Jakob: the idea in his words. Claude: the prediction as numbers |
| Mechanism | before | Claude |
| Setup | before | Claude |
| Results | after | generated tables and plots (`\ExpResults`), plus Claude's reading |
| Behaviour | after | Claude: the behaviour metric. Jakob: what he saw in live games |
| Interpretation | after | both |
| Threats to validity | after | Claude |
| Verdict and next step | after | Claude, by the keep rules; Jakob decides anything outside them |
| Notes for the paper | after | Claude drafts, Jakob decides |

An open part is a line `\todo{jakob}{what is missing}` or `\todo{claude}{...}`. It shows as a box
in the PDF and in the dashboard's "still to fill in" list. Replace the line with the text.

Numbers in the prose are typed by hand: copy them from the generated tables, never from memory.

## experiment.json

`verdict`: `planned`, `pending` (running), `kept`, `not kept`, `tie`, `adopted` (for a method).
`headline`: rows of `{label, base, new, unit}` (add `"better": "lower"` when a smaller value is
the good direction, e.g. game length); the first row is the one shown in the diagram.
`measured`: a few words for the diagram's middle box. `knobs[].chosen`: the value kept, or the
best value found when not kept.

## Measurement records under models/

Folders under `models/` that hold only `sweep.jsonl` and `train.log` are measurements: a model
re-measured (no knob changed) or a sweep whose best point was not kept. Their model.json is left
out so the app and arena do not list duplicate models. The experiment that owns them lists them
under `runs`.
