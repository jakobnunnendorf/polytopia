---
name: refer-to-lecture
description: Use when Jakob types /refer-to-lecture, or asks which EMAI lecture, course concept or course strategy applies to a Polytopia problem, bot behaviour, experiment or issue ("what does the course say about this", "see the lecture strategies", "which lecture is this from"). Also use, without being asked, whenever work in this repo applies a course technique (a #123 technique issue, a new knob, model kind or trainer change): find its lecture reference and cite it in the code, commit, pull request, issue comment, model.json and write-up.
---

# Refer to lecture

Tie a Polytopia problem to the EMAI lecture material it illustrates, with a source you have
opened, not one you remember, and cite it wherever the work lands. The repo's goal is one body
of work with the first semester of EMAI (UPF 2026-27): each experiment names the course concept
it applies, so the citation travels with the code and the results.

## Where things are

| What | Where |
|---|---|
| Course material | `~/Documents/Education/EMAI/<course>/` for the five courses: Autonomous Systems (AS), Reinforcement Learning (RL), Machine Learning (ML), Symbolic Reasoning (SR), Natural Language Interaction (NLI). Files are named `<lecture>.<n> <topic> - <kind> - <title>.pdf`; `0.1 Course overview` is the syllabus |
| Technique index | issue #123: one issue per course technique, grouped by course and `fit:` label (knob, new-model-kind, trainer, long-shot) |
| One technique | its issue (e.g. #101): catalogue id like `SR-01`, what it is, how it applies to greedy-full, risks, and **Course material (sources)** with file and PDF page |
| Rejected techniques | #118 (AS), #119 (RL), #120 (ML), #121 (SR), #122 (NLI): "considered and not filed", each with the reason |
| How to run it as an experiment | `.claude/skills/model-experiment/SKILL.md` and #31 |

## Steps

1. **Read the ask.** The argument can be a topic ("value iteration", "minimax"), a bot
   behaviour ("armies sit idle", #130), an issue number, a model id, or a lecture ("AS lecture
   4"). For a behaviour, name the decision problem behind it first (e.g. idle armies = target
   choice under a goal = planning or search).
2. **Find the technique, in this order:**
   - an issue number: `gh issue view <n> --json title,body --jq '.title, .body'`
   - else search the techniques: `gh issue list --state all --limit 30 --search "<2-4 terms> in:title,body"`, then skim #123 for the course section that fits
   - else check the rejected lists (#118-#122): a technique may have been ruled out, and the reason matters
   - only then search the course folder itself:
     `pdftotext -layout "<file>.pdf" - | grep -n -i "<term>"` per likely file (start with the
     slides of the matching lecture), and `pdfinfo` for the page count. Map a hit to its page
     with `pdftotext -f N -l N`.
3. **Open the source page** with the Read tool (`pages: "N"`) for every page you will cite, and
   check it says what you claim. If the cited page does not match (decks were updated), find
   the right one and say the index was off. Videos (`.mp4`) and audio (`.m4a`) are cited by
   title only; say so.
4. **Answer** in this shape, short:
   - **Concept**: the technique in two plain sentences, as the lecture teaches it.
   - **Source**: `<course>/<file>`, PDF page N (and the printed slide number if the deck has
     one). At most one quote, under 15 words; otherwise paraphrase.
   - **Here**: what it becomes in this repo: which code (`engine/core/src/bot_full.rs`,
     trainers in `scripts/`), which knob or new model kind, and how it would be measured.
   - **Tracked by**: the issue and its `fit:` label, or "not tracked yet".
   - **Story**: one line on what this experiment would show about the course concept, win or
     lose (a negative result still illustrates the concept).
   Several candidates: list up to three, best fit first, and say which you recommend.
5. **Nothing in the index fits:** say so plainly, give the closest lecture material you found
   in step 2 with its page, and offer to file a technique issue in the #123 format (catalogue
   id, sections as in #101, label `fit:...`, a line added to #123). File it only when Jakob says
   so.

## Cite it wherever the work lands

Two forms of the same reference. Course codes: AS, RL, ML, SR, NLI. `<n>` is the number at the
start of the file name (`2.6`, `4.0`).

- **Short** (code, commit messages, model.json): `[EMAI <COURSE> <n> p.<page>: <concept>]`,
  e.g. `[EMAI SR 2.6 p.124: knapsack as choice + #sum + #maximize]`. Add the catalogue id when
  there is one: `[EMAI SR-01, SR 2.6 p.124: ...]`.
- **Full** (pull requests, issues, write-ups, papers): course, file path under
  `~/Documents/Education/EMAI/`, PDF page (and printed slide number), and one line on what that
  page supports, as in the "Course material (sources)" section of #101.

| Where | What to put there |
|---|---|
| Code | one comment line with the short form on the function or knob that implements the technique (e.g. the new term in `score_full_with` in `engine/core/src/bot_full.rs`, the new `FullWeights` field) |
| Commit message | the short form in the body |
| Pull request | a **Course concept** section with the full form and the technique issue number |
| Experiment issue / verdict comment | the full form, and the **Story** line: what the result shows about the concept, kept or not |
| `models/<id>/model.json` | append the short form to `description` (the field exists; do not add new fields) |
| Write-up or paper | full form as a reference entry; in the text, the short form |

Cite only pages opened in this session (step 3). An unverified reference from an issue is
written as "per #<issue>, not re-checked", never as a page you vouch for.

## Rules

- Never cite a page you have not opened in this session; never invent a page or a quote.
- Course PDFs are Jakob's study material: read them locally, never upload them or paste long
  passages into issues or artifacts. Short citations and paraphrase only.
- Keep reading targeted: the cited pages and a few neighbours, not whole decks or textbooks.
- When a concept appears in several courses, cite the course whose material you opened and
  name the others.
