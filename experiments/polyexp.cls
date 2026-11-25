% polyexp: the class of every experiment report (experiments/<NN-slug>/report.tex) and of the
% combined notebook. Reports use the fixed sections of experiments/TEMPLATE/report.tex; the header,
% the flow diagram, the tables and the plots come from generated.tex, which
% `npm run experiment:report` writes from experiment.json and the measured data.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{polyexp}[2026/11/25 Polytopia AI experiment report]
\LoadClass[10pt,a4paper]{article}

\RequirePackage[a4paper,margin=22mm,top=24mm,bottom=24mm]{geometry}
\RequirePackage{amsmath}
\RequirePackage{booktabs}
\RequirePackage{array}
\RequirePackage{xcolor}
\RequirePackage{enumitem}
\RequirePackage{titlesec}
\RequirePackage{fancyhdr}
\RequirePackage{tikz}
\usetikzlibrary{positioning,arrows.meta}
\RequirePackage{pgfplots}
\pgfplotsset{compat=1.17}
\RequirePackage[colorlinks=true,linkcolor=expblue,urlcolor=expblue]{hyperref}

% palette (matches the training dashboard)
\definecolor{expblue}{HTML}{2A78D6}
\definecolor{exporange}{HTML}{EB6834}
\definecolor{expgreen}{HTML}{0C7A0C}
\definecolor{expred}{HTML}{B5362F}
\definecolor{expgrey}{HTML}{6B6A66}
\definecolor{explight}{HTML}{F3F2EE}
\definecolor{expline}{HTML}{C3C2B7}

\setlength{\parindent}{0pt}
\setlength{\parskip}{5pt}
\setlist{itemsep=1pt,topsep=3pt,leftmargin=1.4em}
\titleformat{\section}{\large\bfseries\sffamily}{}{0pt}{}
\titlespacing*{\section}{0pt}{12pt}{3pt}
\titleformat{\subsection}{\normalsize\bfseries\sffamily\color{expgrey}}{}{0pt}{}
\titlespacing*{\subsection}{0pt}{8pt}{2pt}

\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\fancyfoot[L]{\footnotesize\sffamily\color{expgrey}Polytopia AI research \textperiodcentered\ experiment notebook}
\fancyfoot[R]{\footnotesize\sffamily\color{expgrey}\thepage}

% names
\newcommand{\model}[1]{\texttt{#1}}
\newcommand{\knob}[1]{\texttt{#1}}
\newcommand{\issue}[1]{\href{https://github.com/jakobnunnendorf/polytopia-ai-research/issues/#1}{\##1}}
\newcommand{\pp}{\,pp}

% an open part of a report: \todo{jakob}{what is still to write}. The dashboard lists them.
\newcommand{\todo}[2]{\par\smallskip\noindent\colorbox{explight}{\parbox{\dimexpr\linewidth-2\fboxsep}{\sffamily\small
  \textbf{\color{exporange}To fill in (\MakeUppercase #1):} #2}}\par\smallskip}

% verdict badge: \verdict{kept|not kept|tie|pending|adopted|n/a}
\newcommand{\verdictbox}[2]{\tikz[baseline=(v.base)]\node[v/.style={},rounded corners=3pt,fill=#1,text=white,font=\sffamily\bfseries\small,inner xsep=6pt,inner ysep=3pt](v){#2};}

% a fact line in the header table
\newcommand{\fact}[2]{\textcolor{expgrey}{\sffamily\small #1} & {\small #2}\\[2pt]}

% plots
\pgfplotsset{
  expplot/.style={width=0.92\linewidth,height=5.2cm,axis lines=left,axis line style={expline},
    tick style={expline},ymajorgrids,grid style={explight},tick label style={font=\sffamily\footnotesize},
    label style={font=\sffamily\footnotesize},legend style={font=\sffamily\footnotesize,draw=none,fill=none},
    every axis plot/.append style={line width=1pt}},
}
\tikzset{
  flowbox/.style={draw=expline,rounded corners=4pt,fill=white,align=left,text width=24.5mm,minimum height=19mm,
    inner sep=5pt,font=\sffamily\footnotesize},
  flowlab/.style={font=\sffamily\bfseries\scriptsize,text=expgrey},
  flowarrow/.style={-{Stealth[length=5pt]},draw=expgrey,line width=0.7pt},
}
