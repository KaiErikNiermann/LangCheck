use tree_sitter::Node;

use super::{ProseRange, shared};

/// Built-in environment types that tree-sitter-latex recognises as dedicated
/// node kinds (not `generic_environment`). Skip these entirely.
const SKIP_ENV_KINDS: &[&str] = &[
    "verbatim_environment",
    "minted_environment",
    "listing_environment",
    "comment_environment",
    "math_environment",
    "asy_environment",
    "luacode_environment",
    "pycode_environment",
    "sageblock_environment",
    "sagesilent_environment",
];

/// Generic environment names (the `{name}` in `\begin{name}`) that should be
/// skipped. These are environments tree-sitter-latex parses as
/// `generic_environment` rather than a dedicated node kind.
const SKIP_GENERIC_ENVS: &[&str] = &[
    "algorithm",
    "algorithmic",
    "lstlisting",
    "equation",
    "equation*",
    "align",
    "align*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "flalign",
    "flalign*",
    "split",
    "mathpar",
    "mathpar*",
    "IEEEeqnarray",
    "IEEEeqnarray*",
    "tikzpicture",
    "pgfpicture",
    "forest",
    "tabular",
    "tabular*",
    "array",
    "matrix",
    "bmatrix",
    "pmatrix",
    "vmatrix",
    "Bmatrix",
    "Vmatrix",
    "cases",
    "bnf",
];

/// Node types that represent math and should be skipped.
const SKIP_NODES: &[&str] = &["inline_formula", "displayed_equation"];

/// Node types that are always structural (never contain prose `word` nodes).
const STRUCTURAL_NODES: &[&str] = &[
    "command_name",
    "graphics_include",
    "label_definition",
    "label_reference",
    "citation",
    "package_include",
    "bibstyle_include",
];

/// Generic command names (the `\name` in `\name{...}`) whose arguments are
/// non-prose and should be skipped entirely. When `collect_words` encounters
/// a `generic_command` whose command name matches, the entire subtree is
/// dropped.
const SKIP_GENERIC_COMMANDS: &[&str] = &[
    "thispagestyle",
    "pagestyle",
    "bibliographystyle",
    "bibliography",
    "setcounter",
    "addtocounter",
    "setlength",
    "addtolength",
    "newcommand",
    "renewcommand",
    "newenvironment",
    "renewenvironment",
    "DeclareMathOperator",
    "definecolor",
    "hypersetup",
    "geometry",
    "input",
    "include",
    "hfill",
    "vfill",
    "hspace",
    "vspace",
    "smallskip",
    "medskip",
    "bigskip",
    "hrule",
    "vrule",
    "newpage",
    "clearpage",
    "maketitle",
    "tableofcontents",
    "listoffigures",
    "listoftables",
    "texttt",
    "verb",
    "lstinline",
    "mintinline",
    "url",
    "href",
    "path",
];

/// User-configurable extras for LaTeX prose extraction.
#[derive(Default)]
pub struct LatexExtras<'a> {
    pub skip_envs: &'a [String],
    pub skip_commands: &'a [String],
}

/// Extract prose ranges from a LaTeX AST.
///
/// Walks the tree collecting `word` leaf nodes, skipping preamble, math,
/// verbatim, and other non-prose environments. Adjacent words are merged
/// into sentence-level prose chunks.
pub(crate) fn extract(text: &str, root: Node, extras: &LatexExtras) -> Vec<ProseRange> {
    let doc_start = find_document_body_start(root, text);

    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_words(root, text, doc_start, false, extras, &mut word_ranges);

    shared::merge_ranges(
        &word_ranges,
        text,
        strip_latex_noise,
        collect_gap_exclusions,
    )
}

/// Check whether a node kind represents a structural (non-prose) container.
///
/// Includes all `brack_group*` variants, specialised `curly_group_*` variants
/// (but NOT plain `curly_group` which holds prose), and explicitly listed
/// structural node types.
fn is_structural_node(kind: &str) -> bool {
    if kind.starts_with("brack_group") {
        return true;
    }
    if kind.starts_with("curly_group_") {
        return true;
    }
    STRUCTURAL_NODES.contains(&kind)
}

/// Find the byte offset where `\begin{document}` body starts.
/// Returns 0 if no document environment is found (single-file snippets).
fn find_document_body_start(root: Node, text: &str) -> usize {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() == "generic_environment"
            && let Some(begin_node) = child.child_by_field_name("begin")
        {
            let begin_text = &text[begin_node.start_byte()..begin_node.end_byte()];
            if begin_text.contains("document") {
                return begin_node.end_byte();
            }
        }
    }
    0
}

/// Recursively collect prose leaf nodes (`word`), skipping excluded subtrees.
///
/// The `in_structural` flag propagates through the tree so that `word` nodes
/// nested inside structural parents (at any depth) are skipped.
fn collect_words(
    node: Node,
    text: &str,
    doc_start: usize,
    in_structural: bool,
    extras: &LatexExtras,
    out: &mut Vec<(usize, usize)>,
) {
    if node.end_byte() <= doc_start {
        return;
    }

    let kind = node.kind();

    if SKIP_ENV_KINDS.contains(&kind) || SKIP_NODES.contains(&kind) {
        return;
    }

    if kind == "generic_environment" && should_skip_generic_env(node, text, extras.skip_envs) {
        return;
    }

    if kind == "generic_command" && should_skip_generic_command(node, text, extras.skip_commands) {
        return;
    }

    let structural = in_structural || is_structural_node(kind);

    if kind == "word" {
        if !structural {
            let start = node.start_byte();
            let end = node.end_byte();
            if start >= doc_start && start < end {
                out.push((start, end));
            }
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_words(child, text, doc_start, structural, extras, out);
    }
}

/// Check if a `generic_environment` node should be skipped based on its name.
fn should_skip_generic_env(node: Node, text: &str, extra_skip_envs: &[String]) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() != "begin" {
            continue;
        }
        let mut inner = child.walk();
        for bc in child.children(&mut inner) {
            if bc.kind() != "curly_group_text" {
                continue;
            }
            let mut name_cursor = bc.walk();
            for name_child in bc.children(&mut name_cursor) {
                if name_child.kind() != "text" {
                    continue;
                }
                let env_name = &text[name_child.start_byte()..name_child.end_byte()];
                let env_name = env_name.trim();
                if SKIP_GENERIC_ENVS.contains(&env_name) {
                    return true;
                }
                return extra_skip_envs.iter().any(|e| e == env_name);
            }
        }
        break;
    }
    false
}

/// Check if a `generic_command` node should be skipped based on its command name.
fn should_skip_generic_command(node: Node, text: &str, extra_skip_commands: &[String]) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "command_name" {
            // command_name text is e.g. `\thispagestyle` — strip leading `\`
            let raw = &text[child.start_byte()..child.end_byte()];
            let name = raw.strip_prefix('\\').unwrap_or(raw);
            if SKIP_GENERIC_COMMANDS.contains(&name) {
                return true;
            }
            return extra_skip_commands.iter().any(|c| c == name);
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Word-range merging with LaTeX-aware gap analysis
// ---------------------------------------------------------------------------

/// Walk a gap string and record every LaTeX noise region as an exclusion
/// (document-level byte offsets).  This mirrors the logic in
/// `strip_latex_noise` so that everything the gap-stripper removes is also
/// blanked with spaces in the text the checker receives.
///
/// Covered: inline math (`$...$`), display math (`\[...\]`), inline math
/// (`\(...\)`), command names with their arguments (`\textsc{...}`), and
/// escape sequences (`\\`, `\,`, etc.).  Display math exclusions are
/// extended to cover surrounding whitespace so that the grammar checker
/// doesn't see false paragraph breaks.
fn collect_gap_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        // --- inline math: $...$ ---
        if bytes[i] == b'$' {
            let start = i;
            i += 1;
            while i < len && bytes[i] != b'$' {
                i += 1;
            }
            if i < len {
                i += 1; // closing $
            }
            out.push((gap_offset + start, gap_offset + i));
            continue;
        }

        // --- display math \[...\] (with whitespace absorption) ---
        if i + 1 < len && bytes[i] == b'\\' && bytes[i + 1] == b'[' {
            let mut exc_start = i;
            while exc_start > 0 && bytes[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }
            i += 2;
            while i + 1 < len && !(bytes[i] == b'\\' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            }
            let mut exc_end = i;
            while exc_end < len && bytes[exc_end].is_ascii_whitespace() {
                exc_end += 1;
            }
            out.push((gap_offset + exc_start, gap_offset + exc_end));
            i = exc_end;
            continue;
        }

        // --- inline math \(...\) ---
        if i + 1 < len && bytes[i] == b'\\' && bytes[i + 1] == b'(' {
            let start = i;
            i += 2;
            while i + 1 < len && !(bytes[i] == b'\\' && bytes[i + 1] == b')') {
                i += 1;
            }
            if i + 1 < len {
                i += 2;
            }
            out.push((gap_offset + start, gap_offset + i));
            continue;
        }

        // --- command: \name[...]{...} ---
        if i + 1 < len && bytes[i] == b'\\' && bytes[i + 1].is_ascii_alphabetic() {
            let start = i;
            i += 1;
            while i < len && bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            if i < len && bytes[i] == b'*' {
                i += 1;
            }
            i = shared::skip_command_args_bytes(bytes, i, &[(b'{', b'}'), (b'[', b']')]);
            out.push((gap_offset + start, gap_offset + i));
            continue;
        }

        // --- escape sequence: \\ , \, , \; , etc. ---
        if i + 1 < len && bytes[i] == b'\\' {
            let start = i;
            i += 2;
            out.push((gap_offset + start, gap_offset + i));
            continue;
        }

        // --- bare braces (unmatched closing brace from a command whose
        // opening was in a previous gap, or stray opening brace) ---
        if bytes[i] == b'{' || bytes[i] == b'}' {
            out.push((gap_offset + i, gap_offset + i + 1));
            i += 1;
            continue;
        }

        i += 1;
    }
}

/// Strip LaTeX noise from a gap string: math (`$...$`, `\(...\)`, `\[...\]`)
/// and command names (`\textbf`, `\ref`, etc.). Display math content is
/// excluded from the prose text via `ProseRange.exclusions`, so stripping
/// it here is safe. Leaves braces, whitespace, and punctuation intact for
/// subsequent validation.
fn strip_latex_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' {
            i += 1;
            while i < chars.len() && chars[i] != '$' {
                i += 1;
            }
            i += 1;
            result.push(' ');
        } else if chars[i] == '\\'
            && i + 1 < chars.len()
            && (chars[i + 1] == '[' || chars[i + 1] == '(')
        {
            // Replace math with a space to avoid creating false paragraph
            // breaks (display math between newlines: \n\[...\]\n → \n \n).
            // Display math content is excluded via ProseRange.exclusions.
            let close = if chars[i + 1] == '[' { ']' } else { ')' };
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '\\' && chars[i + 1] == close) {
                i += 1;
            }
            if i + 1 < chars.len() {
                i += 2;
            }
            result.push(' ');
        } else if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
            let cmd_start = i + 1;
            let mut j = cmd_start;
            while j < chars.len() && chars[j].is_ascii_alphabetic() {
                j += 1;
            }
            let cmd: String = chars[cmd_start..j].iter().collect();

            // Block/layout commands should NOT be bridged — leave them to
            // fail validation so adjacent ranges stay separate.
            if matches!(
                cmd.as_str(),
                "begin"
                    | "end"
                    | "item"
                    | "par"
                    | "section"
                    | "subsection"
                    | "subsubsection"
                    | "paragraph"
                    | "chapter"
                    | "part"
                    | "hfill"
                    | "vfill"
                    | "newline"
                    | "linebreak"
                    | "noindent"
            ) {
                result.push(chars[i]);
                i += 1;
                continue;
            }

            i = j;
            if i < chars.len() && chars[i] == '*' {
                i += 1;
            }
            i = shared::skip_command_args_chars(&chars, i, &[('{', '}'), ('[', ']')]);
        } else if chars[i] == '\\' {
            i += 1;
            if i < chars.len() {
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::LatexExtras;
    use crate::prose::ProseExtractor;
    use anyhow::Result;

    #[test]
    fn test_latex_basic_extraction() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\usepackage{amsmath}

\begin{document}

\section{Introduction}

This is a simple paragraph with some text.

\textbf{Bold text} and \textit{italic text} here.

\begin{verbatim}
This should be ignored completely.
\end{verbatim}

Another paragraph after verbatim.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("simple paragraph")),
            "Should extract prose text, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Bold text")),
            "Should extract text inside \\textbf, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("ignored completely")),
            "Should NOT extract verbatim content, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\textbf")),
            "Should NOT contain latex commands, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\documentclass")),
            "Should NOT contain preamble, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_math_excluded() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

Some text before math.

$x^2 + y^2 = z^2$

Text after inline math.

\[
  \int_0^1 f(x) \, dx
\]

Text after display math.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("before math")),
            "Should extract text before math, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("after inline math")),
            "Should extract text after math, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("x^2")),
            "Should NOT extract inline math, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\int")),
            "Should NOT extract display math, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_preamble_excluded() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\usepackage{amsmath}
\title{My Document}
\author{John Doe}

\begin{document}

Hello world.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("Hello world")),
            "Should extract body text, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("My Document")),
            "Should NOT extract title from preamble, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("John Doe")),
            "Should NOT extract author from preamble, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_no_document_env() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\section{Test}
Some text here.
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("text here")),
            "Should extract text from snippet without document env, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_real_content() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass[10pt]{article}
\usepackage{styles/pagestyle}
\usepackage{styles/codestyle}

\begin{document}

{\scshape Notes } \hfill {\scshape \large } \hfill {\scshape \today}

\smallskip
\hrule
\bigskip

\section{Insertion sort}

There are two popular variants of insertsion sort you typically see

\begin{algorithm}[H]
  \caption{InsertionSort A}
  \begin{algorithmic}[1]
    \State $i \gets 1$
    \While{$i < \text{length}(A)$}
    \State $j \gets i$
    \EndWhile
  \end{algorithmic}
\end{algorithm}

\subsection{InsertionSort A}
The invariants for this version are relatively straightforward. The first invariant we specify is that the outer loop variable $i$ is always between $1$ and the length of the array (inclusive). So
\[
  1 \leq i \leq \text{length}(A) \tag{Index Constraint}
\]
Secondly, for the outer loop, we weaken the postcondition with the index variable $i$ to get the invariant that the subarray $A[0..i)$ is sorted.

\begin{grayblock}
  One sidenote we can actually weaken the `elements greater than key' invariant as follows
  \[
    \forall k.\ j < k \leq i \to A[k] \geq \text{key}
  \]
\end{grayblock}

\begin{minted}{dafny}
method InsertionSortA(a : array<int>)
  modifies a
  requires a.Length >= 1
\end{minted}

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("popular variants")),
            "Should extract prose about variants, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Insertion sort")),
            "Should extract section heading, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\section")),
            "Should NOT contain \\section command, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("pagestyle")),
            "Should NOT contain preamble, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("InsertionSortA")),
            "Should NOT contain minted code, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\caption")),
            "Should NOT contain algorithm content, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_algorithm_env() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

Text before algorithm.

\begin{algorithm}[H]
  \caption{InsertionSort}
  \begin{algorithmic}[1]
    \State $i \gets 1$
  \end{algorithmic}
\end{algorithm}

Text after algorithm.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("before algorithm")),
            "Should extract text before algorithm, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("after algorithm")),
            "Should extract text after algorithm, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_inline_math_bridges() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

The variable $i$ is always between $1$ and the length of the array.

Some text, with a comma and more text after it.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("variable")
                && t.contains("always between")
                && t.contains("length")),
            "Sentence with inline math should be a single chunk bridging across $i$ and $1$, got: {extracted:?}"
        );
        assert!(
            extracted
                .iter()
                .any(|t| t.contains("text,") || (t.contains("text") && t.contains("comma"))),
            "Sentence with comma should stay together, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_includegraphics_not_extracted() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

Some text before.

\includegraphics[width=0.5\textwidth]{array.pdf}

Some text after.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| *t == "width" || *t == "0.5"),
            "Should NOT extract includegraphics optional args, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("text before")),
            "Should extract prose before includegraphics, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("text after")),
            "Should extract prose after includegraphics, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_display_math_excluded_from_text() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

We know that
\[
  x^2 + y^2 = z^2
\]
which proves our claim.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;

        // The sentence should bridge across the display math
        let bridged = ranges.iter().any(|r| {
            let raw = &text[r.start_byte..r.end_byte];
            raw.contains("know that") && raw.contains("proves our claim")
        });
        assert!(
            bridged,
            "Sentence should bridge across display math, got: {:?}",
            ranges
                .iter()
                .map(|r| &text[r.start_byte..r.end_byte])
                .collect::<Vec<_>>()
        );

        // But extract_text should replace the math with spaces
        let bridged_range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("know that") && raw.contains("proves our claim")
            })
            .expect("Should have a bridged range");

        assert!(
            !bridged_range.exclusions.is_empty(),
            "Should have exclusions for display math"
        );

        let clean_text = bridged_range.extract_text(text);
        assert!(
            !clean_text.contains("x^2"),
            "extract_text should not contain math content, got: {:?}",
            clean_text
        );
        assert!(
            clean_text.contains("know that"),
            "extract_text should still contain prose, got: {:?}",
            clean_text
        );
        // Newlines around display math should also be blanked so that
        // "which" after \] doesn't look like a new sentence start
        assert!(
            !clean_text.contains('\n'),
            "extract_text should blank newlines around display math, got: {:?}",
            clean_text
        );

        Ok(())
    }

    #[test]
    fn test_latex_display_math_no_false_capitalization() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        // Reproduces the user's exact pattern: display math followed by
        // lowercase continuation that should NOT be flagged for capitalization.
        let text = r"\documentclass{article}
\begin{document}

Thus, our invariant for the inner loop is:
\[
  \forall p, q.\ 0 \leq p < q
\]
the intuition here being that all elements are in sorted order.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;

        // Should bridge across \[...\] into one chunk
        let bridged = ranges.iter().find(|r| {
            let raw = &text[r.start_byte..r.end_byte];
            raw.contains("invariant") && raw.contains("intuition")
        });
        assert!(
            bridged.is_some(),
            "Should bridge across display math, got: {:?}",
            ranges
                .iter()
                .map(|r| &text[r.start_byte..r.end_byte])
                .collect::<Vec<_>>()
        );

        let range = bridged.unwrap();
        let clean = range.extract_text(text);

        // The clean text should flow as "is:  the intuition" (with spaces
        // replacing the math), not "is:\n...\nthe" which would trigger
        // capitalization warnings.
        assert!(
            clean.contains("is:") && clean.contains("the intuition"),
            "Prose should flow continuously, got: {:?}",
            clean
        );
        assert!(
            !clean.contains("\\forall"),
            "Math commands should be blanked, got: {:?}",
            clean
        );

        Ok(())
    }

    #[test]
    fn test_latex_mathpar_skipped() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

We define the rules as follows
\begin{mathpar}
    \inferrule
    { }
    {\Gamma \vdash n : \text{num}} \quad \text{T-Num}

    \inferrule
    {\Gamma (x) = \tau}
    {\Gamma \vdash x : \tau} \quad \text{T-Var}
\end{mathpar}

The proof is complete.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("define the rules")),
            "Should extract prose before mathpar, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("proof is complete")),
            "Should extract prose after mathpar, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("T-Num")),
            "Should NOT extract inference rule labels, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("T-Var")),
            "Should NOT extract inference rule labels, got: {extracted:?}"
        );
        // Single-letter fragments from \text{} inside math should not appear
        assert!(
            !extracted.iter().any(|t| *t == "x" || *t == "n"),
            "Should NOT extract single variable names from mathpar, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_thispagestyle_skipped() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}
\thispagestyle{empty}

Hello world.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("empty")),
            "Should NOT extract thispagestyle argument, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Hello world")),
            "Should extract body prose, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_hfill_breaks_ranges() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

{\scshape LV } \hfill {\scshape \large Assignment 1} \hfill {\scshape \today}

Some real prose here.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // \hfill should break merging — LV and Assignment 1 should not be in the same range
        assert!(
            !extracted
                .iter()
                .any(|t| t.contains("LV") && t.contains("Assignment")),
            "\\hfill should break ranges, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("real prose")),
            "Should extract body prose, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_bnf_env_skipped() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

The syntax is defined as follows.
\begin{bnf}(
        prod-delim={--},
        comment={//},
      )[
        colspec = {llcll},
      ]
      e // Expr ::=
      | n // number
    \end{bnf}

That concludes the grammar.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("syntax is defined")),
            "Should extract prose before bnf, got: {extracted:?}"
        );
        assert!(
            extracted
                .iter()
                .any(|t| t.contains("concludes the grammar")),
            "Should extract prose after bnf, got: {extracted:?}"
        );
        assert!(
            !extracted
                .iter()
                .any(|t| t.contains("prod-delim") || t.contains("colspec")),
            "Should NOT extract bnf parameters, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_inline_math_excluded_from_text() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

The value $x + 1$ is positive and $y - 2$ is negative.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;

        let range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("value") && raw.contains("positive")
            })
            .expect("Should have a range containing the sentence");

        let clean = range.extract_text(text);
        assert!(
            !clean.contains("x + 1"),
            "extract_text should not contain inline math, got: {clean:?}"
        );
        assert!(
            !clean.contains("y - 2"),
            "extract_text should not contain second inline math, got: {clean:?}"
        );
        assert!(
            clean.contains("value"),
            "extract_text should preserve prose, got: {clean:?}"
        );
        assert!(
            clean.contains("positive"),
            "extract_text should preserve prose after math, got: {clean:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_paren_math_excluded_from_text() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

We define \(f(x) = x^2\) for all reals.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;

        let range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("define") && raw.contains("reals")
            })
            .expect("Should have a range containing the sentence");

        let clean = range.extract_text(text);
        assert!(
            !clean.contains("f(x)"),
            "extract_text should not contain \\(...\\) math, got: {clean:?}"
        );
        assert!(
            clean.contains("define"),
            "extract_text should preserve prose, got: {clean:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_command_excluded_from_text() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

The \textsc{Foo} method solves \textbf{bar} problems.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;

        let range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("method") && raw.contains("solves")
            })
            .expect("Should have a range containing the sentence");

        let clean = range.extract_text(text);
        assert!(
            !clean.contains("\\textsc"),
            "extract_text should not contain \\textsc command, got: {clean:?}"
        );
        assert!(
            !clean.contains("\\textbf"),
            "extract_text should not contain \\textbf command, got: {clean:?}"
        );
        // The word content inside the braces is also excluded (command + args),
        // so Foo and bar should be blanked too
        assert!(
            clean.contains("method"),
            "extract_text should preserve surrounding prose, got: {clean:?}"
        );
        assert!(
            clean.contains("solves"),
            "extract_text should preserve surrounding prose, got: {clean:?}"
        );

        Ok(())
    }

    #[test]
    fn test_latex_custom_skip_env() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

Text before custom env.

\begin{prooftree}
  Some proof tree content here.
\end{prooftree}

Text after custom env.

\end{document}
";
        // Without extra skip envs, prooftree content is extracted
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        assert!(
            extracted.iter().any(|t| t.contains("proof tree content")),
            "Without config, prooftree content should be extracted, got: {extracted:?}"
        );

        // With extra skip envs, prooftree content is skipped
        let extra = vec!["prooftree".to_string()];
        let extras = LatexExtras {
            skip_envs: &extra,
            ..LatexExtras::default()
        };
        let ranges = extractor.extract(text, "latex", &extras)?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        assert!(
            !extracted.iter().any(|t| t.contains("proof tree content")),
            "With config, prooftree content should be skipped, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Text before")),
            "Prose before should still be extracted, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Text after")),
            "Prose after should still be extracted, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_texttt_content_not_extracted() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

Use the \texttt{myvar} variable in your code.

\end{document}
";
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;

        // The raw range bridges across \texttt{myvar}, but extract_text
        // should strip the command and its argument via gap exclusions.
        let range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("variable")
            })
            .expect("Should have a range containing surrounding prose");

        let clean = range.extract_text(text);
        assert!(
            !clean.contains("myvar"),
            "extract_text should not contain \\texttt argument, got: {clean:?}"
        );
        assert!(
            clean.contains("variable"),
            "extract_text should preserve surrounding prose, got: {clean:?}"
        );

        Ok(())
    }

    #[test]
    fn test_custom_skip_command() -> Result<()> {
        let language: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text = r"\documentclass{article}
\begin{document}

The \codefont{badspeling} function works.

\end{document}
";
        // Without skip_commands, codefont content IS extracted as prose words
        let ranges = extractor.extract(text, "latex", &LatexExtras::default())?;
        let clean_texts: Vec<_> = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            clean_texts.iter().any(|t| t.contains("badspeling")),
            "Without config, codefont content should appear in prose, got: {clean_texts:?}"
        );

        // With skip_commands, the word node inside \codefont is not collected,
        // and extract_text strips the gap command — so "badspeling" disappears.
        let skip_cmds = vec!["codefont".to_string()];
        let extras = LatexExtras {
            skip_commands: &skip_cmds,
            ..LatexExtras::default()
        };
        let ranges = extractor.extract(text, "latex", &extras)?;
        let range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("function works")
            })
            .expect("Should have a range with surrounding prose");

        let clean = range.extract_text(text);
        assert!(
            !clean.contains("badspeling"),
            "With config, codefont argument should not appear in extract_text, got: {clean:?}"
        );
        assert!(
            clean.contains("function works"),
            "Surrounding prose should be preserved, got: {clean:?}"
        );

        Ok(())
    }
}
