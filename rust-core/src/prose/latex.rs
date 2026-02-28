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

/// Extract prose ranges from a LaTeX AST.
///
/// Walks the tree collecting `word` leaf nodes, skipping preamble, math,
/// verbatim, and other non-prose environments. Adjacent words are merged
/// into sentence-level prose chunks.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let doc_start = find_document_body_start(root, text);

    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_words(root, text, doc_start, false, &mut word_ranges);

    shared::merge_ranges(
        &word_ranges,
        text,
        strip_latex_noise,
        collect_display_math_exclusions,
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
    out: &mut Vec<(usize, usize)>,
) {
    if node.end_byte() <= doc_start {
        return;
    }

    let kind = node.kind();

    if SKIP_ENV_KINDS.contains(&kind) || SKIP_NODES.contains(&kind) {
        return;
    }

    if kind == "generic_environment" && should_skip_generic_env(node, text) {
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
        collect_words(child, text, doc_start, structural, out);
    }
}

/// Check if a `generic_environment` node should be skipped based on its name.
fn should_skip_generic_env(node: Node, text: &str) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "begin" {
            let mut inner = child.walk();
            for bc in child.children(&mut inner) {
                if bc.kind() == "curly_group_text" {
                    let mut name_cursor = bc.walk();
                    for name_child in bc.children(&mut name_cursor) {
                        if name_child.kind() == "text" {
                            let env_name = &text[name_child.start_byte()..name_child.end_byte()];
                            return SKIP_GENERIC_ENVS.contains(&env_name.trim());
                        }
                    }
                }
            }
            break;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Word-range merging with LaTeX-aware gap analysis
// ---------------------------------------------------------------------------

/// Find display math regions (`\[...\]`) in a gap and record them as
/// exclusions (document-level byte offsets). The exclusion is extended to
/// cover surrounding whitespace/newlines so that the grammar checker sees
/// flat spaces instead of newlines that could trigger false capitalization
/// warnings.
fn collect_display_math_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && bytes[i + 1] == b'[' {
            // Extend backwards to include leading whitespace/newlines
            let mut exc_start = i;
            while exc_start > 0 && bytes[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }

            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'\\' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 < bytes.len() {
                i += 2; // skip \]
            }

            // Extend forwards to include trailing whitespace/newlines
            let mut exc_end = i;
            while exc_end < bytes.len() && bytes[exc_end].is_ascii_whitespace() {
                exc_end += 1;
            }

            out.push((gap_offset + exc_start, gap_offset + exc_end));
            i = exc_end;
        } else {
            i += 1;
        }
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

            // Block commands should NOT be bridged — leave them to fail validation.
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
            ) {
                result.push(chars[i]);
                i += 1;
                continue;
            }

            i = j;
            if i < chars.len() && chars[i] == '*' {
                i += 1;
            }
            // Skip command arguments: {content} and [content]
            while i < chars.len() && (chars[i] == '{' || chars[i] == '[') {
                let open = chars[i];
                let close = if open == '{' { '}' } else { ']' };
                let mut depth = 1;
                i += 1;
                while i < chars.len() && depth > 0 {
                    if chars[i] == open {
                        depth += 1;
                    } else if chars[i] == close {
                        depth -= 1;
                    }
                    i += 1;
                }
            }
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;
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
        let ranges = extractor.extract(text, "latex")?;

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
        let ranges = extractor.extract(text, "latex")?;

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
}
