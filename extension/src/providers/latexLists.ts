/**
 * The LaTeX names the inlay hints never offer to skip.
 *
 * The built-in lists mirror what the core already skips (`latex.rs`), and the
 * prose lists are names that obviously hold text worth checking, so a hint on
 * either would be noise.
 */

// Built-in LaTeX environments that the checker always skips (mirrors SKIP_GENERIC_ENVS in latex.rs)
export const BUILTIN_SKIP_ENVS = new Set([
    "algorithm", "algorithmic", "lstlisting",
    "equation", "equation*", "align", "align*",
    "gather", "gather*", "multline", "multline*",
    "flalign", "flalign*", "split",
    "mathpar", "mathpar*",
    "IEEEeqnarray", "IEEEeqnarray*",
    "tikzpicture", "pgfpicture", "forest",
    "tabular", "tabular*", "array",
    "matrix", "bmatrix", "pmatrix", "vmatrix", "Bmatrix", "Vmatrix",
    "cases", "bnf",
]);

// Standard prose-bearing environments — never suggest skipping these since they
// obviously contain text that should be checked.
export const PROSE_ENVS = new Set([
    "document",
    "abstract", "acknowledgments", "acknowledgements",
    "itemize", "enumerate", "description",
    "figure", "figure*", "table", "table*",
    "minipage", "center", "flushleft", "flushright",
    "quote", "quotation", "verse",
    "theorem", "lemma", "proposition", "corollary", "definition",
    "example", "exercise", "remark", "note", "proof",
    "assumption", "conjecture", "observation", "claim", "fact",
    "notation", "convention",
    "frame", "block", "alertblock", "exampleblock",
    "columns", "column",
]);

// Sectioning and other structural commands contain prose in their arguments.
// A spelling diagnostic inside one of these must not be mistaken for evidence
// that the command itself should be skipped.
export const PROSE_COMMANDS = new Set([
    "part", "chapter", "section", "subsection", "subsubsection",
    "paragraph", "subparagraph", "subsubparagraph",
    "title", "author", "date", "caption", "footnote",
]);

// Built-in LaTeX commands whose arguments the checker always skips (mirrors SKIP_GENERIC_COMMANDS in latex.rs)
export const BUILTIN_SKIP_COMMANDS = new Set([
    "thispagestyle", "pagestyle", "bibliographystyle", "bibliography",
    "setcounter", "addtocounter", "setlength", "addtolength",
    "newcommand", "renewcommand", "newenvironment", "renewenvironment",
    "DeclareMathOperator", "definecolor", "hypersetup", "geometry",
    "input", "include", "hfill", "vfill", "hspace", "vspace",
    "smallskip", "medskip", "bigskip", "hrule", "vrule",
    "newpage", "clearpage", "maketitle",
    "tableofcontents", "listoffigures", "listoftables",
    "texttt", "verb", "lstinline", "mintinline", "url", "href", "path",
]);
