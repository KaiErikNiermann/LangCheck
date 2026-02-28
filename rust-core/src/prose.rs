use anyhow::{Result, anyhow};
use tree_sitter::{Language, Node, Parser, Query, QueryCursor, StreamingIterator};

pub struct ProseExtractor {
    parser: Parser,
    language: Language,
}

/// Built-in environment types that tree-sitter-latex recognises as dedicated
/// node kinds (not `generic_environment`). Skip these entirely.
const LATEX_SKIP_ENV_KINDS: &[&str] = &[
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
const LATEX_SKIP_GENERIC_ENVS: &[&str] = &[
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
const LATEX_SKIP_NODES: &[&str] = &[
    "inline_formula",
    "displayed_equation",
];

/// Node types that are always structural (never contain prose `word` nodes).
const LATEX_STRUCTURAL_NODES: &[&str] = &[
    "command_name",       // \section, \textbf etc.
    "graphics_include",   // \includegraphics[...]{...}
    "label_definition",   // \label{...}
    "label_reference",    // \ref{...}
    "citation",           // \cite{...}
    "package_include",    // \usepackage{...}
    "bibstyle_include",   // \bibliographystyle{...}
];

/// Check whether a node kind represents a structural (non-prose) container.
/// This includes all `brack_group*` variants, specialised `curly_group_*`
/// variants (but NOT plain `curly_group` which holds prose), and explicitly
/// listed structural node types.
fn is_structural_node(kind: &str) -> bool {
    // All bracket groups are structural: brack_group, brack_group_key_value, etc.
    if kind.starts_with("brack_group") {
        return true;
    }
    // Specialised curly groups are structural: curly_group_text, curly_group_path, etc.
    // Plain `curly_group` (no suffix) holds prose content like \textbf{...}
    if kind.starts_with("curly_group_") {
        return true;
    }
    LATEX_STRUCTURAL_NODES.contains(&kind)
}

impl ProseExtractor {
    pub fn new(language: Language) -> Result<Self> {
        let mut parser = Parser::new();
        parser.set_language(&language)?;
        Ok(Self { parser, language })
    }

    pub fn extract(&mut self, text: &str, lang_id: &str) -> Result<Vec<ProseRange>> {
        let tree = self
            .parser
            .parse(text, None)
            .ok_or_else(|| anyhow!("Failed to parse text"))?;

        if lang_id == "latex" {
            return Ok(self.extract_latex(text, tree.root_node()));
        }

        let query_str = match lang_id {
            "markdown" => "(paragraph) @prose (atx_heading) @prose",
            "html" => "(text) @prose",
            _ => "(paragraph) @prose",
        };

        let query = Query::new(&self.language, query_str)
            .map_err(|e| anyhow!("Failed to create query for {lang_id}: {e}"))?;

        let mut cursor = QueryCursor::new();
        let mut matches = cursor.matches(&query, tree.root_node(), text.as_bytes());

        let mut ranges = Vec::new();
        while let Some(m) = matches.next() {
            for capture in m.captures {
                ranges.push(ProseRange {
                    start_byte: capture.node.start_byte(),
                    end_byte: capture.node.end_byte(),
                });
            }
        }

        Ok(ranges)
    }

    /// Walk the LaTeX AST and extract only `word` leaf nodes, merging adjacent
    /// ones into sentence-level prose chunks. Skips preamble, math, verbatim,
    /// and other non-prose environments.
    #[allow(clippy::unused_self)]
    fn extract_latex(&self, text: &str, root: Node) -> Vec<ProseRange> {
        // Find `\begin{document}` to skip preamble
        let doc_start = find_document_body_start(root, text);

        let mut word_ranges: Vec<(usize, usize)> = Vec::new();
        collect_latex_words(root, text, doc_start, false, &mut word_ranges);

        // Merge adjacent word ranges into prose chunks.
        // Words separated by only whitespace/punctuation (no commands) get merged.
        merge_word_ranges(&word_ranges, text)
    }
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

/// Recursively collect prose leaf nodes (`word` and punctuation), skipping
/// excluded subtrees. The `in_structural` flag propagates through the tree
/// so that `word` nodes nested inside structural parents (at any depth) are
/// skipped.
fn collect_latex_words(
    node: Node,
    text: &str,
    doc_start: usize,
    in_structural: bool,
    out: &mut Vec<(usize, usize)>,
) {
    // Skip anything before \begin{document}
    if node.end_byte() <= doc_start {
        return;
    }

    let kind = node.kind();

    // Skip dedicated non-prose environment types and math
    if LATEX_SKIP_ENV_KINDS.contains(&kind) || LATEX_SKIP_NODES.contains(&kind) {
        return;
    }

    // For generic_environment, check if its name is in the skip list
    if kind == "generic_environment" && should_skip_generic_env(node, text) {
        return;
    }

    // Track whether we're inside a structural parent
    let structural = in_structural || is_structural_node(kind);

    // `word` is a leaf node — this is actual prose text (unless inside structural)
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

    // Recurse into children
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_latex_words(child, text, doc_start, structural, out);
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
                    // Extract the environment name from inside the braces
                    let mut name_cursor = bc.walk();
                    for name_child in bc.children(&mut name_cursor) {
                        if name_child.kind() == "text" {
                            let env_name =
                                &text[name_child.start_byte()..name_child.end_byte()];
                            return LATEX_SKIP_GENERIC_ENVS.contains(&env_name.trim());
                        }
                    }
                }
            }
            break;
        }
    }
    false
}

/// Merge word byte ranges into larger prose chunks.
///
/// Two adjacent words are merged when the gap between them is "benign" —
/// containing only whitespace, inline math, and simple punctuation. This
/// keeps sentences like "the variable $i$ is positive" as a single chunk
/// while still breaking at display math, block commands, and paragraph
/// breaks.
fn merge_word_ranges(words: &[(usize, usize)], text: &str) -> Vec<ProseRange> {
    if words.is_empty() {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut chunk_start = words[0].0;
    let mut chunk_end = words[0].1;

    for &(start, end) in &words[1..] {
        let gap = &text[chunk_end..start];

        if !is_bridgeable_gap(gap) {
            // Flush current chunk and start a new one
            ranges.push(ProseRange {
                start_byte: chunk_start,
                end_byte: chunk_end,
            });
            chunk_start = start;
        }
        chunk_end = end;
    }

    // Flush final chunk
    ranges.push(ProseRange {
        start_byte: chunk_start,
        end_byte: chunk_end,
    });

    ranges
}

/// Check if the gap between two word ranges can be bridged (merged into one
/// prose chunk). A bridgeable gap contains only:
/// - Whitespace (spaces, tabs, single newlines — NOT paragraph breaks)
/// - Math: `$...$`, `\(...\)`, `\[...\]`
/// - LaTeX commands: `\textbf`, `\textit`, `\ref{...}`, etc.
/// - Braces and simple punctuation: `{`, `}`, `, . ; : ! ? ( ) ' " - –`
///
/// Non-bridgeable gaps include paragraph breaks.
fn is_bridgeable_gap(gap: &str) -> bool {
    // Paragraph break — always split
    if gap.contains("\n\n") || gap.contains("\r\n\r\n") {
        return false;
    }

    // Strip math and LaTeX commands from the gap, then check what remains
    let stripped = strip_latex_noise(gap);

    // After stripping, everything left must be whitespace or simple punctuation
    stripped.chars().all(|c| {
        c.is_ascii_whitespace()
            || matches!(c, ',' | '.' | ';' | ':' | '!' | '?' | '(' | ')' | '\'' | '"'
                         | '-' | '\u{2013}' | '\u{2014}' | '[' | ']'
                         | '{' | '}' | '~')
    })
}

/// Strip LaTeX noise from a gap string: math (`$...$`, `\[...\]`, `\(...\)`)
/// and command names (`\textbf`, `\ref`, etc.). Leaves braces, whitespace,
/// and punctuation intact for subsequent validation.
fn strip_latex_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' {
            // Skip inline math until closing $
            i += 1;
            while i < chars.len() && chars[i] != '$' {
                i += 1;
            }
            i += 1; // skip closing $
        } else if chars[i] == '\\' && i + 1 < chars.len() && (chars[i + 1] == '[' || chars[i + 1] == '(') {
            // Skip display math \[...\] or inline math \(...\)
            let close = if chars[i + 1] == '[' { ']' } else { ')' };
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '\\' && chars[i + 1] == close) {
                i += 1;
            }
            if i + 1 < chars.len() {
                i += 2; // skip closing delimiter
            }
        } else if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
            // Read the command name
            let cmd_start = i + 1;
            let mut j = cmd_start;
            while j < chars.len() && chars[j].is_ascii_alphabetic() {
                j += 1;
            }
            let cmd: String = chars[cmd_start..j].iter().collect();

            // Block commands that should NOT be bridged — leave them in the
            // output so they cause the gap to fail validation.
            if matches!(cmd.as_str(), "begin" | "end" | "item" | "par"
                | "section" | "subsection" | "subsubsection" | "paragraph"
                | "chapter" | "part") {
                result.push(chars[i]);
                i += 1;
                continue;
            }

            // Skip this command: \commandname (backslash + letters)
            i = j;
            // Also skip optional * (e.g. \emph*)
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
                    if chars[i] == open { depth += 1; }
                    else if chars[i] == close { depth -= 1; }
                    i += 1;
                }
            }
        } else if chars[i] == '\\' {
            // Skip lone backslash (e.g. \\, \,, \;)
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseRange {
    pub start_byte: usize,
    pub end_byte: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_markdown_extraction() -> Result<()> {
        let language: tree_sitter::Language = tree_sitter_md::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text =
            "# Header\n\nThis is a paragraph.\n\n```rust\nfn main() {}\n```\n\nAnother paragraph.";
        let ranges = extractor.extract(text, "markdown")?;

        // We expect "Header", "This is a paragraph.", and "Another paragraph."
        // The code block should be ignored.
        assert!(ranges.len() >= 3);

        let extracted_texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        // The tree-sitter-md grammar includes trailing newlines in node ranges
        assert!(extracted_texts.iter().any(|t| t.contains("Header")));
        assert!(extracted_texts.iter().any(|t| t.contains("This is a paragraph")));
        assert!(extracted_texts.iter().any(|t| t.contains("Another paragraph")));

        Ok(())
    }

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

        // Should contain prose words but NOT latex commands
        assert!(
            extracted.iter().any(|t| t.contains("simple paragraph")),
            "Should extract prose text, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Bold text")),
            "Should extract text inside \\textbf, got: {extracted:?}"
        );
        // Verbatim content should be excluded
        assert!(
            !extracted.iter().any(|t| t.contains("ignored completely")),
            "Should NOT extract verbatim content, got: {extracted:?}"
        );
        // LaTeX commands themselves should not appear
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
        // Math content should not appear
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
        // Preamble should not appear
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

        // A snippet without \begin{document} — should extract everything
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

        // Should extract prose text
        assert!(
            extracted.iter().any(|t| t.contains("popular variants")),
            "Should extract prose about variants, got: {extracted:?}"
        );
        // Should extract section heading text
        assert!(
            extracted.iter().any(|t| t.contains("Insertion sort")),
            "Should extract section heading, got: {extracted:?}"
        );
        // Should NOT contain LaTeX commands
        assert!(
            !extracted.iter().any(|t| t.contains("\\section")),
            "Should NOT contain \\section command, got: {extracted:?}"
        );
        // Preamble should be excluded
        assert!(
            !extracted.iter().any(|t| t.contains("pagestyle")),
            "Should NOT contain preamble, got: {extracted:?}"
        );
        // Minted code should be excluded
        assert!(
            !extracted.iter().any(|t| t.contains("InsertionSortA")),
            "Should NOT contain minted code, got: {extracted:?}"
        );
        // Algorithm env should be excluded
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

        // Sentence with inline math should be ONE chunk, not fragmented
        assert!(
            extracted.iter().any(|t| t.contains("variable") && t.contains("always between") && t.contains("length")),
            "Sentence with inline math should be a single chunk bridging across $i$ and $1$, got: {extracted:?}"
        );
        // Comma sentence should also be one chunk
        assert!(
            extracted.iter().any(|t| t.contains("text,") || (t.contains("text") && t.contains("comma"))),
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

        // Should NOT extract "width" or "0.5" from includegraphics optional args
        assert!(
            !extracted.iter().any(|t| *t == "width" || *t == "0.5"),
            "Should NOT extract includegraphics optional args, got: {extracted:?}"
        );
        // Should extract surrounding prose
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

}
