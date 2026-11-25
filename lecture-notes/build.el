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
;;    loading the tangled file, and is replaced by the resulting transcript.
;;
;; So every number and every table on a page was computed by the code on
;; that page.  Needs GNU Emacs with Org (9.6 or later) and OCaml on the PATH.

(require 'cl-lib)
(require 'org)
(require 'ox-html)
(require 'ob-tangle)

(defconst notes-root
  (file-name-directory (or load-file-name buffer-file-name)))
(defconst notes-out (expand-file-name "_build/" notes-root))
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
                   (call-process-region (point-min) (point-max) "ocaml" t t nil
                                        "-noprompt" "-no-version" "-init" notes-ml)
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

(defun notes-highlight-ocaml (text backend _info)
  "Export filter: colour the OCaml source blocks."
  (when (and (eq backend 'html)
             (string-match "<pre class=\"src src-ocaml\"[^>]*>" text))
    (let* ((start (match-end 0))
           (end (string-match "</pre>" text start)))
      (concat (substring text 0 start)
              (notes-ocaml-spans (substring text start end))
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
      ;; 2. the unit tests
      (with-temp-buffer
        (unless (zerop (call-process "ocaml" nil t nil notes-ml))
          (error "%s does not pass its unit tests:\n%s" notes-ml (buffer-string))))
      ;; 3. export
      (org-export-to-file 'html html))
    (message "Built %s" html)))

(dolist (org-file (directory-files notes-root t "\\`[a-z]+-[0-9]+_.*\\.org\\'"))
  (notes-build org-file))

;;; build.el ends here
