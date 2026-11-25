;;; build.el --- build the lecture notes  -*- lexical-binding: t; -*-

;; Usage, from the repository root:
;;
;;   emacs --batch -l lecture-notes/build.el
;;
;; For each lecture note (an Org file in this directory), in this order:
;;
;; 1. tangle its OCaml blocks into _build/<name>.ml,
;; 2. run that file with ocaml, so the unit tests in it must pass,
;; 3. export the note to _build/<name>.html.  During the export every
;;    `toplevel' block is fed to the OCaml toplevel, phrase by phrase, after
;;    loading the tangled file, and is replaced by the resulting transcript;
;;    and every `scene' block is replaced by a picture of a game scene, drawn
;;    by the game's own components (see "game scenes" below).
;;
;; So every number, table and picture on a page was computed by the code on
;; that page.  Needs GNU Emacs with Org (9.6 or later) and OCaml on the PATH;
;; for the pictures also the app's node_modules and Google Chrome (macOS path).

(require 'cl-lib)
(require 'org)
(require 'ox-html)
(require 'ob-tangle)

(defconst notes-root
  (file-name-directory (or load-file-name buffer-file-name)))
(defconst notes-out (expand-file-name "_build/" notes-root))
(defconst notes-snippets (expand-file-name "snippets/" notes-out))
(defconst notes-site "EMAI in Polytopia")

(defvar notes-ml nil "The tangled OCaml file of the note being built.")
(defvar notes-meta nil "Alist of the note's own keywords (COURSE, UP, PREVIOUS, NEXT).")

;;; ---------- the OCaml toplevel ----------

(defconst notes-mark "<<<next phrase>>>")

(defun notes-toplevel-transcript (body)
  "Evaluate the phrases of BODY in the OCaml toplevel; return the transcript.
The tangled file of the current note is loaded first.  Phrases end with `;;'."
  (let* ((phrases (split-string body ";;" t "[ \t\n]+"))
         (input (mapconcat (lambda (phrase)
                             (format "%s;;\nprint_endline %S;;\n" phrase notes-mark))
                           phrases ""))
         (output (with-temp-buffer
                   (insert input)
                   (let ((default-directory notes-out)) ; where pictures.ml is
                     (call-process-region (point-min) (point-max) "ocaml" t t nil
                                          "-noprompt" "-no-version" "-init" notes-ml))
                   (buffer-string)))
         (answers (split-string output
                                (concat (regexp-quote notes-mark) "\n- : unit = ()\n"))))
    (unless (= (length answers) (1+ (length phrases)))
      (error "The toplevel answered %d phrases out of %d:\n%s"
             (1- (length answers)) (length phrases) output))
    (concat (mapconcat #'identity
                       (cl-mapcar (lambda (phrase answer)
                                    (format "# %s;;\n%s"
                                            (replace-regexp-in-string "\n" "\n  " phrase)
                                            answer))
                                  phrases answers)
                       "")
            "#")))

(defun org-babel-execute:toplevel (body _params)
  "Org Babel entry point for the pseudo-language `toplevel'."
  (notes-toplevel-transcript body))

;;; ---------- game scenes ----------

;; A `scene' block holds an OCaml expression that evaluates to a scene (JSON,
;; see app/scene.tsx).  The scene is drawn by the game's own components, in
;; the web build of the app, and photographed with headless Chrome into
;; _build/<pic>.png.  The pictures use the game's sprites and are for local
;; viewing only: _build is not committed.
;;
;; The web build is exported once into _build/app (about half a minute).
;; Delete that directory to export it again after changing the game's art.

(defconst notes-repo (file-name-directory (directory-file-name notes-root)))
(defconst notes-app (expand-file-name "app/" notes-out))
(defconst notes-scene-port "8099")
(defconst notes-scene-url (format "http://127.0.0.1:%s/scene/" notes-scene-port))
(defconst notes-chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

(defun notes-scene-server-answers ()
  (zerop (call-process "curl" nil nil nil "-s" "-f" "-o" "/dev/null" "-m" "2" notes-scene-url)))

(defun notes-ensure-scene-server ()
  "Export the web build if it is missing, and serve it unless it is served already."
  (unless (file-exists-p (expand-file-name "scene/index.html" notes-app))
    (message "Exporting the web build of the app into %s ..." notes-app)
    (let ((default-directory notes-repo)
          (process-environment (cons "CI=1" process-environment)))
      (with-temp-buffer
        (unless (zerop (call-process "npx" nil t nil "expo" "export" "-p" "web"
                                     "--output-dir" notes-app))
          (error "The web build could not be exported:\n%s" (buffer-string)))))
    ;; the router knows the page as /scene, a plain file server as /scene/
    (make-directory (expand-file-name "scene" notes-app) t)
    (copy-file (expand-file-name "scene.html" notes-app)
               (expand-file-name "scene/index.html" notes-app) t))
  (unless (notes-scene-server-answers)
    (start-process "notes-scenes" nil "/usr/bin/python3" "-m" "http.server" notes-scene-port
                   "--bind" "127.0.0.1" "--directory" notes-app)
    (let ((tries 0))
      (while (and (not (notes-scene-server-answers)) (< tries 20))
        (sleep-for 0.25)
        (setq tries (1+ tries))))
    (unless (notes-scene-server-answers)
      (error "No scene server at %s" notes-scene-url))))

(defun notes-scene-margin (scene)
  "The room around the map of SCENE that its marks need: [top right bottom left], in pixels.
The figures match the ones app/scene.tsx draws with: an axis takes 20 (top)
or 22 (left), a spanning arrow with its words 32, words are 8 wide a letter."
  (let* ((tile (gethash "tile" scene 64))
         (board (* tile (length (aref (gethash "rows" scene) 0))))
         (axes (eq (gethash "axes" scene) t))
         (top (if axes 20 0)) (left (if axes 22 0)) (right 0) (bottom 0)
         across down)
    (seq-doseq (mark (gethash "marks" scene []))
      (let* ((kind (gethash "kind" mark))
             (text (gethash "text" mark))
             (wide (if (stringp text) (+ 6 (* 8 (length text))) 0)))
        (cond ((equal kind "across") (setq across t))
              ((equal kind "down") (setq down t))
              ((equal kind "below")
               (setq bottom 42
                     right (max right (- (+ (* tile (gethash "x" mark)) 2 wide) board))))
              ((stringp text)           ; beside, or outlined with words
               (setq right (max right (+ 40 wide)))))))
    (vector (+ top (if across 32 0)) right bottom (+ left (if down 32 0)))))

(defun org-babel-execute:scene (body params)
  "Org Babel entry point for the pseudo-language `scene': a picture of a game scene."
  (let* ((pic (or (cdr (assq :pic params)) (error "A scene block needs a :pic name")))
         (png (expand-file-name (format "%s.png" pic) notes-out))
         (output (with-temp-buffer
                   (insert (format "print_string (%s);;\n" body))
                   (let ((default-directory notes-out))
                     (call-process-region (point-min) (point-max) "ocaml" t t nil
                                          "-noprompt" "-no-version" "-init" notes-ml))
                   (buffer-string)))
         (json (if (string-match "\\`\\({.*}\\)- : unit = ()" output)
                   (match-string 1 output)
                 (error "Not a scene:\n%s" output)))
         (scene (json-parse-string json))
         (tile (gethash "tile" scene 64))
         (rows (gethash "rows" scene))
         (margin (notes-scene-margin scene))
         (width (+ 16 (aref margin 3) (* tile (length (aref rows 0))) (aref margin 1)))
         (height (+ 16 (aref margin 0) (* tile (length rows)) (aref margin 2)))
         (json (progn (puthash "margin" margin scene) (json-serialize scene))))
    (notes-ensure-scene-server)
    ;; The app shows "Loading the game engine..." until its WebAssembly engine
    ;; is compiled, and Chrome's clock does not wait for that.  A picture of
    ;; the loading screen is a few kilobytes, a scene well over 50: retake it.
    (let ((tries 0) (size 0))
      (while (and (< size 30000) (< tries 8))
        (when (file-exists-p png) (delete-file png))
        (call-process notes-chrome nil nil nil
                      "--headless=new" "--disable-gpu" "--hide-scrollbars"
                      "--force-device-scale-factor=2" "--virtual-time-budget=8000"
                      (format "--window-size=%d,%d" width height)
                      (concat "--screenshot=" png)
                      (concat notes-scene-url "#" (base64url-encode-string json t)))
        (setq size (or (file-attribute-size (file-attributes png)) 0)
              tries (1+ tries)))
      (when (< size 30000)
        (error "No scene in %s after %d tries" png tries)))
    (format "#+ATTR_HTML: :width %d :class scene\n[[file:%s.png]]" width pic)))

;;; ---------- colours for OCaml code ----------

(defconst notes-ocaml-token
  (concat "\\((\\*\\(?:[^*]\\|\\*[^)]\\)*\\*)\\)"               ; 1: comment
          "\\|\\(\"[^\"\n]*\"\\|'[^'\\\\\n]'\\)"                ; 2: string, character
          "\\|\\_<\\(let\\|rec\\|in\\|and\\|if\\|then\\|else\\|fun\\|function\\|match\\|with\\|type\\|of\\|assert\\|begin\\|end\\)\\_>" ; 3: keyword
          "\\|\\_<\\(true\\|false\\|[A-Z][A-Za-z_]*\\)\\_>"     ; 4: constructor, module
          "\\|\\_<\\([0-9]+\\(?:\\.[0-9]*\\)?\\(?:e-?[0-9]+\\)?\\)")) ; 5: number

(defun notes-ocaml-spans (code)
  "Wrap the tokens of CODE (already HTML-escaped) in coloured spans."
  (with-temp-buffer
    (with-syntax-table (standard-syntax-table)
      (let ((case-fold-search nil))
        (replace-regexp-in-string
         notes-ocaml-token
         (lambda (token)
           (format "<span class=\"%s\">%s</span>"
                   (cond ((match-beginning 1) "c")
                         ((match-beginning 2) "s")
                         ((match-beginning 3) "k")
                         ((match-beginning 4) "nc")
                         (t "m"))
                   token))
         code t t)))))

(defun notes-unescape (html)
  "Undo the escaping that the HTML export applies to code."
  (replace-regexp-in-string
   "&amp;" "&"
   (replace-regexp-in-string "&gt;" ">" (replace-regexp-in-string "&lt;" "<" html))))

(defun notes-highlight-ocaml (text backend _info)
  "Export filter: colour the OCaml source blocks, and name each one.
The name (`data-snippet') is a hash of the code.  The code is also written
to _build/snippets/<name>.ml, where serve.py finds it for the page's
\"explain the syntax\" button."
  (when (and (eq backend 'html)
             (string-match "<pre class=\"src src-ocaml\"\\([^>]*\\)>" text))
    (let* ((tag (match-beginning 0))
           (attributes (match-string 1 text))
           (start (match-end 0))
           (end (string-match "</pre>" text start))
           (code (substring text start end))
           (raw (notes-unescape code))
           (id (substring (secure-hash 'sha256 raw) 0 16))
           (coding-system-for-write 'utf-8))
      (make-directory notes-snippets t)
      (write-region raw nil (expand-file-name (concat id ".ml") notes-snippets) nil 'silent)
      (concat (substring text 0 tag)
              (format "<pre class=\"src src-ocaml\"%s data-snippet=\"%s\">" attributes id)
              (notes-ocaml-spans code)
              (substring text end)))))

;;; ---------- the page around the note ----------

(defun notes-get (key) (or (cdr (assoc key notes-meta)) ""))

(defun notes-related-bar ()
  (format "<div class=\"related\"><ul>
<li class=\"right\"><a href=\"#\" title=\"General Index\">index</a></li>
<li class=\"right\"><a href=\"#\" title=\"%s\">next</a> |</li>
<li class=\"right\"><a href=\"#\" title=\"%s\">previous</a> |</li>
<li><a href=\"#\">%s</a> &raquo;</li>
<li><a href=\"#\">%s</a> &raquo;</li>
<li><a href=\"#\">%s</a> &raquo;</li>
</ul></div>\n"
          (notes-get "NEXT") (notes-get "PREVIOUS")
          notes-site (notes-get "COURSE") (notes-get "UP")))

(defun notes-preamble (info)
  (concat (notes-related-bar)
          "<div class=\"sidebar\">\n"
          (or (org-html-toc 1 info) "")
          (format "<h4>Previous topic</h4>\n<p class=\"topless\"><a href=\"#\">%s</a></p>\n"
                  (notes-get "PREVIOUS"))
          (format "<h4>Next topic</h4>\n<p class=\"topless\"><a href=\"#\">%s</a></p>\n"
                  (notes-get "NEXT"))
          (format "<h3>This Page</h3>\n<ul class=\"this-page-menu\"><li><a href=\"%s\">The OCaml code</a></li></ul>\n"
                  (file-name-nondirectory notes-ml))
          "</div>\n"))

(defun notes-postamble (_info)
  (concat (notes-related-bar)
          (format "<div class=\"footer\">&copy; Copyright 2026, Jakob Nunnendorf.
Last updated on %s.
Created using <a href=\"https://orgmode.org/\">Org mode</a> %s in GNU Emacs %s,
after the lecture notes of Olivier Danvy.</div>\n"
                  (format-time-string "%a %d %b %Y at %H:%M")
                  (org-version) emacs-version)
          ;; a pilcrow next to each heading, as a link to it
          "<script>
document.querySelectorAll('#content h2[id], #content h3[id]').forEach(function (h) {
  var a = document.createElement('a');
  a.className = 'headerlink'; a.href = '#' + h.id; a.textContent = '\\u00b6';
  a.title = 'Permalink to this headline';
  h.appendChild(a);
});
</script>\n"
          ;; "explain the syntax": only when the page comes from serve.py
          "<script>
(function () {
  var blocks = document.querySelectorAll('pre[data-snippet]');
  function inline(parent, text) {            // `code` and plain text, as nodes
    text.split(/(`[^`]+`)/).forEach(function (part) {
      if (part.length > 2 && part[0] === '`' && part[part.length - 1] === '`') {
        var code = document.createElement('code');
        code.textContent = part.slice(1, -1);
        parent.appendChild(code);
      } else if (part) parent.appendChild(document.createTextNode(part.replace(/\\*\\*/g, '')));
    });
  }
  function show(pre, text) {
    var box = document.createElement('details');
    box.className = 'explanation'; box.open = true;
    var summary = document.createElement('summary');
    summary.textContent = 'The syntax, explained';
    box.appendChild(summary);
    var list = null;
    text.split('\\n').forEach(function (line) {
      line = line.trim();
      if (!line) { list = null; return; }
      if (line.slice(0, 2) === '- ') {
        if (!list) { list = document.createElement('ul'); box.appendChild(list); }
        var item = document.createElement('li'); inline(item, line.slice(2)); list.appendChild(item);
      } else {
        list = null;
        var p = document.createElement('p'); inline(p, line); box.appendChild(p);
      }
    });
    pre.parentNode.insertBefore(box, pre.nextSibling);
  }
  fetch('/explanations.json').then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (saved) {
      blocks.forEach(function (pre) {
        var id = pre.dataset.snippet;
        if (saved[id]) { show(pre, saved[id]); return; }
        var button = document.createElement('button');
        button.className = 'explain'; button.textContent = 'explain the syntax';
        button.onclick = function () {
          button.disabled = true; button.textContent = 'asking Sonnet\\u2026';
          fetch('/explain/' + id, { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (answer) {
              if (!answer.text) throw new Error(answer.error || 'no answer');
              button.remove(); show(pre, answer.text);
            })
            .catch(function (e) {
              button.disabled = false; button.textContent = 'explain the syntax';
              button.title = String(e.message || e); window.console.error(e);
            });
        };
        pre.parentNode.insertBefore(button, pre);
      });
    })
    .catch(function () {});                   // a plain file or another server: no buttons
})();
</script>\n"))

;;; ---------- building one note ----------

(defun notes-build (org-file)
  (let* ((name (file-name-base org-file))
         (notes-ml (expand-file-name (concat name ".ml") notes-out))
         (html (expand-file-name (concat name ".html") notes-out))
         (css (with-temp-buffer
                (insert-file-contents (expand-file-name "notes.css" notes-root))
                (buffer-string)))
         (org-confirm-babel-evaluate nil)
         (org-export-use-babel t)
         (org-html-doctype "html5")
         (org-html-html5-fancy t)
         (org-html-head-include-default-style nil)
         (org-html-head-include-scripts nil)
         (org-html-htmlize-output-type nil)
         (org-html-validation-link nil)
         (org-html-head (concat "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
                                "<style>\n" css "</style>"))
         (org-html-preamble #'notes-preamble)
         (org-html-postamble #'notes-postamble)
         (org-export-filter-src-block-functions '(notes-highlight-ocaml)))
    (make-directory notes-out t)
    (with-current-buffer (find-file-noselect org-file)
      (setq notes-meta
            (mapcar (lambda (entry) (cons (car entry) (cadr entry)))
                    (org-collect-keywords '("COURSE" "UP" "PREVIOUS" "NEXT"))))
      ;; 1. tangle
      ;;    (the note names its own file: `:tangle _build/<name>.ml')
      (org-babel-tangle nil nil "ocaml")
      ;;    (a note that draws scenes loads pictures.ml from the directory it runs in)
      (copy-file (expand-file-name "pictures.ml" notes-root)
                 (expand-file-name "pictures.ml" notes-out) t)
      ;; 2. the unit tests
      (with-temp-buffer
        (unless (zerop (let ((default-directory notes-out))
                         (call-process "ocaml" nil t nil notes-ml)))
          (error "%s does not pass its unit tests:\n%s" notes-ml (buffer-string))))
      ;; 3. export
      (org-export-to-file 'html html))
    (message "Built %s" html)))

;; the snippets are written afresh, so that none of an older build stays behind
(when (file-directory-p notes-snippets) (delete-directory notes-snippets t))

(dolist (org-file (directory-files notes-root t "\\`[a-z]+-[0-9]+_.*\\.org\\'"))
  (notes-build org-file))

;;; build.el ends here
