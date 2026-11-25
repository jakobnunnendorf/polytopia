#!/usr/bin/env python3
"""Serve the built lecture notes on this computer, with an "explain the syntax" button.

    /usr/bin/python3 lecture-notes/serve.py [port]      (default port: 8097)

Besides the files in _build, the server answers two requests:

  GET  /explanations.json   every saved explanation, as {snippet id: text}
  POST /explain/<id>        the explanation of one code snippet of the notes.  If none is
                            saved yet, a one-shot Claude Sonnet call in the terminal
                            (`claude -p`, no tools, no hooks, no saved session) writes one,
                            and it is saved in explanations/<id>.md.

A snippet is named by the id the build gave it (build.el writes _build/snippets/<id>.<ext>),
so the server only ever explains code that is in the notes, never text sent by a web page.
Saved explanations are plain files: edit or delete one to change or redo it.
"""
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(ROOT, "_build")
SNIPPETS = os.path.join(BUILD, "snippets")
SAVED = os.path.join(ROOT, "explanations")
ID = re.compile(r"^[0-9a-f]{16}$")
LANGUAGES = {".ml": "OCaml", ".rs": "Rust", ".cpp": "C++", ".py": "Python"}
MODEL = "sonnet"
FENCE = "\n```\n\n"

SYSTEM = (
    "You explain the syntax of code snippets in lecture notes. The reader is a master's student "
    "in artificial intelligence who programs in Python and TypeScript and is new to {language}. "
    "Explain the syntax only: what each construct means and how to read it. Do not explain the "
    "algorithm or what the program is for. Answer with 3 to 8 lines, each starting with '- ', "
    "each naming one construct from the snippet in backticks and then explaining it in one or "
    "two plain sentences, in the order the constructs first appear. Skip what reads the same in "
    "Python. No heading, no introduction, no closing remark."
)

locks = {}
locks_guard = threading.Lock()


def snippet_of(snippet_id):
    """(language, code) of a snippet of the built notes, or None."""
    if not os.path.isdir(SNIPPETS):
        return None
    for name in os.listdir(SNIPPETS):
        base, ext = os.path.splitext(name)
        if base == snippet_id:
            with open(os.path.join(SNIPPETS, name), encoding="utf-8") as f:
                return LANGUAGES.get(ext, ext.lstrip(".")), f.read()
    return None


def saved_text(snippet_id):
    """The saved explanation of a snippet (without the copy of the code above it), or None."""
    try:
        with open(os.path.join(SAVED, snippet_id + ".md"), encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return None
    return text.split(FENCE, 1)[1].strip() if FENCE in text else text.strip()


def ask_claude(language, code):
    """One Sonnet call in the terminal: no tools, no settings (so no hooks), nothing saved."""
    env = {k: os.environ[k] for k in ("HOME", "PATH", "USER", "TMPDIR", "LANG") if k in os.environ}
    with tempfile.TemporaryDirectory() as neutral:
        done = subprocess.run(
            ["claude", "-p", "--model", MODEL, "--tools", "", "--setting-sources", "",
             "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
             "--system-prompt", SYSTEM.format(language=language),
             "The snippet (%s):\n\n%s" % (language, code)],
            cwd=neutral, env=env, capture_output=True, text=True, timeout=180,
        )
    if done.returncode != 0 or not done.stdout.strip():
        raise RuntimeError((done.stderr or done.stdout or "claude gave no answer").strip()[:400])
    return done.stdout.strip()


def explain(snippet_id):
    with locks_guard:
        lock = locks.setdefault(snippet_id, threading.Lock())
    with lock:  # two clicks on one snippet: one call
        text = saved_text(snippet_id)
        if text is not None:
            return text
        found = snippet_of(snippet_id)
        if found is None:
            raise KeyError(snippet_id)
        language, code = found
        text = ask_claude(language, code)
        os.makedirs(SAVED, exist_ok=True)
        with open(os.path.join(SAVED, snippet_id + ".md"), "w", encoding="utf-8") as f:
            f.write("Explained by Claude (%s) on %s. The snippet:\n\n```%s\n%s%s%s\n"
                    % (MODEL, datetime.date.today().isoformat(), language.lower(),
                       code.rstrip("\n"), FENCE, text))
        return text


class Notes(SimpleHTTPRequestHandler):
    def send_json(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/explanations.json":
            saved = {}
            if os.path.isdir(SAVED):
                for name in os.listdir(SAVED):
                    base, ext = os.path.splitext(name)
                    if ext == ".md" and ID.match(base):
                        saved[base] = saved_text(base)
            return self.send_json(200, saved)
        return super().do_GET()

    def do_POST(self):
        # only this page may ask: a page of another site sends another Origin
        origin = self.headers.get("Origin")
        if origin is not None and origin != "http://" + self.headers.get("Host", ""):
            return self.send_json(403, {"error": "not from these lecture notes"})
        match = re.match(r"^/explain/([0-9a-f]{16})$", self.path)
        if not match:
            return self.send_json(404, {"error": "no such request"})
        try:
            return self.send_json(200, {"text": explain(match.group(1))})
        except KeyError:
            return self.send_json(404, {"error": "this snippet is not in the built notes; rebuild them"})
        except Exception as e:  # the terminal call failed: say why on the page
            return self.send_json(502, {"error": str(e)})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8097
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Notes, directory=BUILD))
    print("Lecture notes on http://localhost:%d/ (this computer only)" % port, flush=True)
    server.serve_forever()
