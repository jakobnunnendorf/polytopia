---
name: lecture-note
description: Use when Jakob types /lecture-note, or asks for a lecture note, chapter, page or write-up that explains an EMAI course concept in Polytopia ("write the note for policy iteration", "make a Danvy-style page for minimax", "add a chapter on TD learning"), or asks to change, rebuild, serve or illustrate an existing note in lecture-notes/ (a new game picture, arrows and marks on a picture, the "explain the syntax" button, the page look).
---

# Lecture note

One page per course concept, in the manner of Olivier Danvy's lecture notes: the concept is
stated, turned into a small OCaml program about a Polytopia situation, tested, run and looked
at. **Every number, table, transcript and picture on the page is computed by the code on that
page when it is built. Nothing is typed in by hand.**

`lecture-notes/rl-02_value-iteration.org` is the worked example. Read it before writing a new
note and keep its shape; this file tells you what the example does not say.

## Where things are

| What | Where |
|---|---|
| A note | `lecture-notes/<course>-<NN>_<slug>.org`: course code in lower case (`as`, `rl`, `ml`, `sr`, `nli`), `NN` the lecture number in two digits. The build only picks up files named this way |
| Build | `emacs --batch -l lecture-notes/build.el`, from the repository root. Output in `lecture-notes/_build/` (ignored by git) |
| Look | `lecture-notes/notes.css` (the Sphinx look of Danvy's site), page frame in `build.el` |
| Pictures, OCaml side | `lecture-notes/pictures.ml`: `scene`, the marks, `show_tile` |
| Pictures, game side | `app/scene.tsx`, a page of the app that draws a scene with the game's own `Tile` and `UnitSprite` |
| Server | `/usr/bin/python3 lecture-notes/serve.py [port]` (default 8097), this computer only |
| Saved syntax explanations | `lecture-notes/explanations/<id>.md`, committed |
| Game rules to quote | `docs/shardlands/RULES.md` (cite the section numbers) |

Needs GNU Emacs with Org 9.6 or later, `ocaml` on the PATH, the app's `node_modules`, and
Google Chrome at its macOS path. Notes are in OCaml; the build knows no other language yet.

## Steps

1. **Source first.** Invoke the `refer-to-lecture` skill for the concept. Take from it: the
   pages you opened in this session, what each supports, and the short citation
   `[EMAI <COURSE> <n> p.<page>: <concept>]`. A note states only what those pages state.
2. **Scope: one concept, one small map, one question.** The title asks the question in game
   terms ("Value iteration, or how many turns to that village?"). A map of about 8 by 6 tiles,
   one unit, the two or three game rules that matter, everything else left out and said so.
3. **Copy the header** of the example and change the title, `COURSE`, `UP`, `PREVIOUS`, `NEXT`
   and the file name in the `:tangle` line (it must be `_build/<name of the note>.ml`). Keep
   the three `header-args` lines as they are. `UP` is "Lecture Notes, Week NN"; `PREVIOUS` and
   `NEXT` are the titles of the neighbouring concepts in the course, whether or not their
   notes exist yet (the links in the bars are placeholders).
4. **Write each piece of code in this order:** the unit-test function, then the function, then
   `let () = assert (test_f f);;`, then a `toplevel` block that runs it, then a paragraph
   starting "In words:" that says what the answer shows, then a picture where one helps.
5. **Build.** A failing unit test or a toplevel error stops the build with the OCaml message.
   The build rebuilds every note and retakes every picture (about a minute; half a minute
   more the first time, to export the app), and prints one "Built ..." line per note.
6. **Check every sentence against the page you built.** A result in the prose ("12 of the 41
   tiles", "four sweeps") must appear in a transcript or in a computed mark on the same page.
   If nothing shows it, add the phrase that computes it, or cut the sentence. What can be read
   off the map as written, or off a quoted game rule ("8 columns and 6 rows", "a movement of
   2"), needs no transcript.
7. **Look at it**: `ls -la lecture-notes/_build/*.png` (a scene is over 50 kB), open each new
   picture with Read, then the page (see "Serving").
8. **Close the note** with the sections "Course material" (file, lecture, a table of page and
   what it supports here, and what was *not* checked) and "Version" (`Created [25 Nov 2026]`,
   with the day's date in that form).
9. **Commit** the `.org` file and any change to the tooling, with the short citation in the
   commit body. `_build/` stays out of git (see "Local only").

## The three kinds of block

```org
#+begin_src ocaml
let value_iteration gamma n = nat_fold_right zero_value (bellman gamma) n;;
#+end_src

#+begin_src toplevel
value_iteration 0.9 1;;
#+end_src

#+begin_src scene :pic rl-02_the-map
picture ~axes:true ~rider:(0, 5) zero_value
#+end_src
```

- `ocaml`: shown on the page and written to `_build/<name>.ml`. Every phrase ends with `;;`.
  Add `:exports none` for code the reader need not see (the picture helper at the end of the
  example).
- `toplevel`: replaced on the page by the real session (`# phrase;;` and the answer). Phrases
  only, each ending with `;;`. They run after the whole tangled file is loaded, so a block may
  use functions defined further down the page.
- `scene`: replaced by a picture, `_build/<pic>.png`. One OCaml expression that evaluates to a
  scene (the string that `scene` returns), without `;;`. Start the `:pic` name with the note's
  prefix.

## Pictures

The note defines its own small `picture` function on top of `scene`, at the end, hidden:

```ocaml
#use "pictures.ml";;

let picture ?(ride = []) ?rider ?(marks = []) ?(axes = false) f =
  let label p = if enterable p && value_at f p > 0.
                then Some (Printf.sprintf "%.2f" (value_at f p)) else None
  and piece = match rider with Some p -> Some ("rider", p) | None -> None
  in scene ~label ~path:ride ?piece ~marks ~axes the_map;;
```

The `picture` function is the note's own: give it the arguments that suit the note (a value
table, a list of tiles, nothing at all). Only `scene` and the marks are fixed.

`scene ?label ?path ?piece ?marks ?axes rows` returns the scene as a string. Only `rows` is
required:

| Argument | Meaning |
|---|---|
| `rows` | the map, a `string array`, one character per tile: `.` field, `F` forest, `M` mountain, `~` water, `V` village |
| `label` | `(x, y) -> string option`: what to write on a tile, at its bottom edge. Return `None` for the tile a unit stands on, or the words cover its feet |
| `path` | a list of tiles, joined by a red line in this order |
| `piece` | a unit on a tile, `("rider", (0, 5))`. Kinds: `warrior`, `rider`, `archer`, `defender`, `swordsman`, `knight`, `catapult`, `giant` and the other keys of `UNIT_SPRITES` in `components/art/Art.tsx`. The game draws the unit with its health badge ("10") |
| `axes` | `true` numbers the columns above and the rows on the left |
| `marks` | a list of marks: arrows, outlines and words, see below |

`show_tile (3, 0)` is the string `"(3, 0)"`, for the words of a mark.

| Mark | Draws |
|---|---|
| `Across "width = 8"` | a two-headed arrow over all columns, above the map |
| `Down "height = 6"` | a two-headed arrow over all rows, left of the map |
| `Beside ((7, 0), "village")` | an outline on the tile and an arrow to it from the right margin |
| `Below ((0, 5), "the rider")` | an outline on the tile and an arrow to it from below the map |
| `Outlined (tiles, "rider_moves (3, 0)")` | these tiles tinted, and one arrow from the right margin to the tile furthest right (the topmost of those) |

Rules for marks:

- A mark names a thing from the code: a variable, a call, one step of a computation. Its
  numbers are computed, never typed: `Across (Printf.sprintf "width = %d" width)`,
  `Beside (village, "village = " ^ show_tile village)`.
- Words are plain ASCII, without double quotes or backslashes.
- Two `Beside` or `Outlined` marks on the same row overlap, and so do two `Below` marks in
  neighbouring columns. Put them on different rows, or use two pictures.
- A tile is `(x, y)`: column from the left, row from the top, both from 0.

A new terrain letter, kind of mark or thing to draw goes in `app/scene.tsx` (and, for a mark,
in `pictures.ml` and in `notes-scene-margin` in `build.el`, which sizes the picture). After
changing `app/scene.tsx` or the game's art, delete `lecture-notes/_build/app` so the build
exports the app again (about half a minute).

## Danvy's devices

Use the ones the concept calls for; the example has all of them. The build requires none of
these sections.

- An **epigraph** under the introduction (`#+begin_epigraph`), then **Resources**.
- **Interlude**: a short dialogue that raises the objection a reader would raise. The cast is
  the Rider (impatient, wants the answer), the Cartographer (knows the map), the Elder (knows
  the course). One line per speaker turn, `Name: words`.
- **"In words:"** after a transcript, never before it.
- **Unit tests before the function**, with a comment above each case saying what it checks.
- Recursion through a fold function (`nat_fold_right`) rather than a loop, when the concept is
  an iteration.
- **Food for thought**, then **Exercise 01**, **Exercise 02**, ... , then a **Postlude**.
- Plain sentences. Formulas in LaTeX (`$V_{k+1} = T^*V_k$`), code and tiles in `~tildes~`
  (the water character itself is written `=~=`).

## Serving

```bash
/usr/bin/python3 lecture-notes/serve.py        # http://localhost:8097/<name>.html
```

Check first whether it already runs (`curl -s -m 2 http://127.0.0.1:8097/explanations.json`);
a rebuild needs no restart. Served this way, every OCaml box has an "explain the syntax"
button: the first click asks Claude Sonnet once in the terminal and saves the answer in
`lecture-notes/explanations/`, later visits show the saved answer. An explanation belongs to
the exact code of its box: changing the code brings the button back, and the old file can be
deleted. To redo one, delete its file. The build also keeps a second server on port 8099 for
taking the pictures; leave it alone.

To check a page without a browser (write the screenshot to a scratch directory outside the
repository):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --hide-scrollbars --virtual-time-budget=10000 --window-size=1150,3000 \
  --screenshot=<scratch>/page.png "http://127.0.0.1:8097/<name>.html"
```

## Local only

The pictures use the game's sprites, which are the official Polytopia art. They stay in
`lecture-notes/_build/` and are never committed, uploaded, published as an artifact or sent to
an outside service. The same holds for the course PDFs (see `refer-to-lecture`): cite page
numbers and paraphrase.

## Common mistakes

| Mistake | Instead |
|---|---|
| Typing a result, a table or a count into the prose | A `toplevel` block computes it; the prose repeats what the transcript shows |
| A page number from memory or from an issue | Only pages opened with Read in this session, through `refer-to-lecture` |
| Checking the build log but not the picture | Read each new `.png`: a picture can build and still show the wrong thing |
| A picture of a few kilobytes | It shows "Loading the game engine…"; the build retakes these, and fails after 8 tries. Run the build again |
| "No routes found" from the app export in a fresh worktree | `node_modules` must be a real directory, not a symlink: `cp -c -R <main checkout>/node_modules node_modules` |
| Claiming the game behaves as the note computes | Say what was not compared with the engine, in "Course material" |
| A note that covers a whole lecture | One concept. The next concept is the next note, named in `NEXT` |
