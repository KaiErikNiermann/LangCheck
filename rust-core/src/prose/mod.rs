mod bibtex;
mod forester;
mod latex;
mod org;
mod query;
mod rst;
mod shared;
mod sweave;
mod tinylang;

use anyhow::{Result, anyhow};
use tree_sitter::{Language, Parser};

pub struct ProseExtractor {
    parser: Parser,
    language: Language,
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

        let root = tree.root_node();

        match lang_id {
            "latex" => Ok(latex::extract(text, root)),
            "sweave" => Ok(sweave::extract(text, root)),
            "forester" => Ok(forester::extract(text, root)),
            "tinylang" => Ok(tinylang::extract(text, root)),
            "rst" => Ok(rst::extract(text, root)),
            "bibtex" => Ok(bibtex::extract(text, root)),
            "org" => Ok(org::extract(text, root)),
            lang => query::extract(text, root, &self.language, lang),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseRange {
    pub start_byte: usize,
    pub end_byte: usize,
    /// Byte ranges (document-level) within this prose range that should be
    /// excluded from grammar checking (e.g. display math). These regions are
    /// replaced with spaces when extracting text, preserving byte offsets.
    pub exclusions: Vec<(usize, usize)>,
}

impl ProseRange {
    /// Extract the prose text from the full document, replacing any excluded
    /// regions with spaces so that byte offsets remain stable.
    pub fn extract_text<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        let slice = &text[self.start_byte..self.end_byte];
        if self.exclusions.is_empty() {
            return std::borrow::Cow::Borrowed(slice);
        }
        let mut buf = slice.to_string();
        // SAFETY: we only replace valid UTF-8 ranges with ASCII spaces
        let bytes = unsafe { buf.as_bytes_mut() };
        for &(exc_start, exc_end) in &self.exclusions {
            // Convert document-level offsets to slice-local offsets
            let local_start = exc_start.saturating_sub(self.start_byte);
            let local_end = exc_end.saturating_sub(self.start_byte).min(bytes.len());
            for b in &mut bytes[local_start..local_end] {
                *b = b' ';
            }
        }
        std::borrow::Cow::Owned(buf)
    }

    /// Check whether a local byte range (relative to this prose range)
    /// overlaps with any exclusion zone.
    pub fn overlaps_exclusion(&self, local_start: u32, local_end: u32) -> bool {
        let doc_start = self.start_byte as u32 + local_start;
        let doc_end = self.start_byte as u32 + local_end;
        self.exclusions.iter().any(|&(exc_start, exc_end)| {
            let es = exc_start as u32;
            let ee = exc_end as u32;
            doc_start < ee && doc_end > es
        })
    }
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

        assert!(ranges.len() >= 3);

        let extracted_texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
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
        let bridged = ranges
            .iter()
            .any(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("know that") && raw.contains("proves our claim")
            });
        assert!(bridged, "Sentence should bridge across display math, got: {:?}",
            ranges.iter().map(|r| &text[r.start_byte..r.end_byte]).collect::<Vec<_>>());

        // But extract_text should replace the math with spaces
        let bridged_range = ranges
            .iter()
            .find(|r| {
                let raw = &text[r.start_byte..r.end_byte];
                raw.contains("know that") && raw.contains("proves our claim")
            })
            .expect("Should have a bridged range");

        assert!(!bridged_range.exclusions.is_empty(), "Should have exclusions for display math");

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

    #[test]
    fn test_overlaps_exclusion() {
        let range = ProseRange {
            start_byte: 100,
            end_byte: 300,
            exclusions: vec![(150, 200)],
        };

        // Diagnostic entirely inside exclusion
        assert!(range.overlaps_exclusion(50, 100)); // local 50..100 = doc 150..200
        // Diagnostic partially overlapping exclusion
        assert!(range.overlaps_exclusion(40, 60));  // doc 140..160 overlaps 150..200
        assert!(range.overlaps_exclusion(90, 110)); // doc 190..210 overlaps 150..200
        // Diagnostic entirely outside exclusion
        assert!(!range.overlaps_exclusion(0, 40));   // doc 100..140, before exclusion
        assert!(!range.overlaps_exclusion(110, 130)); // doc 210..230, after exclusion
    }

    // ── Forester tests ──

    fn forester_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = crate::forester_ts::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_forester_basic_extraction() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\title{Hello World}
\p{This is a paragraph.}
";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("Hello World")),
            "Should extract title text, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("This is a paragraph")),
            "Should extract paragraph text, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_math_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Display math between paragraphs (separated by blank line) should
        // not appear in prose ranges.
        let text = "\\p{Text before math.}\n\n##{\\int_0^1 f(x) \\, dx}\n\n\\p{Text after math.}\n";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("Text before math")),
            "Should extract text before math, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Text after math")),
            "Should extract text after math, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\int")),
            "Should NOT extract display math content, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_structural_commands_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\import{trees/basics}
\ref{tree-0001}
\p{Some actual prose.}
";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("trees/basics")),
            "Should NOT extract import path, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("tree-0001")),
            "Should NOT extract ref target, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("actual prose")),
            "Should extract prose text, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_verbatim_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = "\\p{Before code.}\n```\nfn main() {}\n```\n\\p{After code.}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("fn main")),
            "Should NOT extract verbatim content, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Before code")),
            "Should extract text before verbatim, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("After code")),
            "Should extract text after verbatim, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_inline_commands_bridge() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{This has \em{emphasized} words in it.}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted
                .iter()
                .any(|t| t.contains("This has") && t.contains("emphasized") && t.contains("words in it")),
            "Sentence with inline command should bridge into single chunk, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_display_math_exclusion() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{We know that
##{
  x^2 + y^2 = z^2
}
which proves our claim.}";
        let ranges = extractor.extract(text, "forester")?;

        // Should bridge across display math
        let bridged = ranges.iter().find(|r| {
            let raw = &text[r.start_byte..r.end_byte];
            raw.contains("know that") && raw.contains("proves our claim")
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
        assert!(
            !range.exclusions.is_empty(),
            "Should have exclusions for display math"
        );

        let clean_text = range.extract_text(text);
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

        Ok(())
    }

    // ── TinyLang tests ──────────────────────────────────────────────────

    #[test]
    fn test_tinylang_basic_extraction() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "This is a simple sentence.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        assert!(!ranges.is_empty(), "Should extract prose from plain text");
        let prose = ranges[0].extract_text(text);
        assert!(
            prose.contains("simple sentence"),
            "Prose should contain 'simple sentence', got: {:?}",
            prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_code_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "Before code.\n\n~~~\nfn main() {}\n~~~\n\nAfter code.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("fn main"),
            "Code block content should not appear in prose, got: {:?}",
            all_prose
        );
        assert!(
            all_prose.contains("Before code"),
            "Prose before code should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_structural_commands_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "@author{Jane Doe}\n@date{2025-01-01}\n\nSome prose text here.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("Jane Doe"),
            "Structural command args should not be in prose, got: {:?}",
            all_prose
        );
        assert!(
            all_prose.contains("prose text here"),
            "Regular prose should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_math_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "The formula $E = mc^2$ is famous.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("mc^2"),
            "Inline math should not be in prose, got: {:?}",
            all_prose
        );
        assert!(
            all_prose.contains("formula"),
            "Prose around math should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_comment_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "Visible text.\n// This is a comment\nMore text.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("This is a comment"),
            "Comments should not be in prose, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_prose_command_included() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "@title{My Great Document}\n\nSome text.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("Great Document"),
            "Prose command args should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    // ── reStructuredText tests ──────────────────────────────────────

    fn rst_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = tree_sitter_rst::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_rst_basic_extraction() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "My Title\n========\n\nThis is a paragraph.\n";
        let ranges = extractor.extract(text, "rst")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("My Title"),
            "Title should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("This is a paragraph"),
            "Paragraph should be extracted, got: {all_prose:?}"
        );
        Ok(())
    }

    #[test]
    fn test_rst_code_block_excluded() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "Some text.\n\n.. code-block:: python\n\n   def hello():\n       pass\n\nMore text.\n";
        let ranges = extractor.extract(text, "rst")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("Some text"),
            "Paragraph before code should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("More text"),
            "Paragraph after code should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("def hello"),
            "Code block content should not be in prose, got: {all_prose:?}"
        );
        Ok(())
    }

    #[test]
    fn test_rst_math_excluded() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "Before math.\n\n.. math::\n\n   E = mc^2\n\nAfter math.\n";
        let ranges = extractor.extract(text, "rst")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("Before math"),
            "Paragraph before math should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("mc^2"),
            "Math directive content should not be in prose, got: {all_prose:?}"
        );
        Ok(())
    }

    #[test]
    fn test_rst_inline_code_excluded() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "Use ``some_function()`` to do things.\n";
        let ranges = extractor.extract(text, "rst")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("Use"),
            "Text around inline code should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("some_function"),
            "Inline code should be excluded, got: {all_prose:?}"
        );
        Ok(())
    }

    #[test]
    fn test_rst_list_items_extracted() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "- First item\n- Second item\n";
        let ranges = extractor.extract(text, "rst")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("First item"),
            "List items should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("Second item"),
            "List items should be extracted, got: {all_prose:?}"
        );
        Ok(())
    }

    // ── Sweave (R Sweave / .Rnw) tests ────────────────────────────────

    fn sweave_extractor() -> Result<ProseExtractor> {
        let language = crate::languages::resolve_ts_language("sweave");
        ProseExtractor::new(language)
    }

    #[test]
    fn test_sweave_basic_extraction() -> Result<()> {
        let mut extractor = sweave_extractor()?;

        let text = r"\documentclass{article}
\begin{document}

This is a paragraph in a Sweave document.

<<setup, echo=FALSE>>=
library(ggplot2)
x <- rnorm(100)
@

Another paragraph after the R chunk.

\end{document}
";
        let ranges = extractor.extract(text, "sweave")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("paragraph in a Sweave")),
            "Should extract prose text before R chunk, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Another paragraph after")),
            "Should extract prose text after R chunk, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_sweave_r_chunk_excluded() -> Result<()> {
        let mut extractor = sweave_extractor()?;

        let text = r"\documentclass{article}
\begin{document}

Some prose before code.

<<my-chunk, fig=TRUE>>=
plot(1:10)
summary(lm(y ~ x))
@

Some prose after code.

\end{document}
";
        let ranges = extractor.extract(text, "sweave")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            !all_prose.contains("plot(1:10)"),
            "R code should NOT appear in prose, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("summary(lm"),
            "R code should NOT appear in prose, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("prose before code"),
            "Prose before R chunk should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("prose after code"),
            "Prose after R chunk should be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    // ── BibTeX tests ────────────────────────────────────────────────

    fn bibtex_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = tree_sitter_bibtex::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_bibtex_title_extracted() -> Result<()> {
        let mut extractor = bibtex_extractor()?;
        let text = r#"@article{key2024,
  title = {A Great Paper on Important Things},
  author = {John Doe},
  year = {2024},
}
"#;
        let ranges = extractor.extract(text, "bibtex")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Great Paper"),
            "Title should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("John Doe"),
            "Author should NOT be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("2024"),
            "Year should NOT be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_bibtex_abstract_extracted() -> Result<()> {
        let mut extractor = bibtex_extractor()?;
        let text = r#"@article{key2024,
  title = {Some Title},
  abstract = {This paper presents a novel approach to solving problems.},
  journal = {Nature},
}
"#;
        let ranges = extractor.extract(text, "bibtex")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("novel approach"),
            "Abstract should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("Nature"),
            "Journal should NOT be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_bibtex_note_extracted() -> Result<()> {
        let mut extractor = bibtex_extractor()?;
        let text = r#"@book{key2024,
  title = {Some Title},
  note = {Accepted for publication.},
  publisher = {Addison-Wesley},
}
"#;
        let ranges = extractor.extract(text, "bibtex")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Accepted for publication"),
            "Note should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("Addison-Wesley"),
            "Publisher should NOT be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_bibtex_latex_commands_in_title() -> Result<()> {
        let mut extractor = bibtex_extractor()?;
        let text = r#"@article{key2024,
  title = {A Paper on \emph{Important} Things},
}
"#;
        let ranges = extractor.extract(text, "bibtex")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Important"),
            "Text inside LaTeX commands should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("\\emph"),
            "LaTeX command names should NOT be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_bibtex_non_prose_fields_excluded() -> Result<()> {
        let mut extractor = bibtex_extractor()?;
        let text = r#"@article{key2024,
  author = {John Doe and Jane Smith},
  journal = {Nature},
  year = {2024},
  volume = {42},
  pages = {100--200},
  doi = {10.1234/example},
}
"#;
        let ranges = extractor.extract(text, "bibtex")?;
        assert!(
            ranges.is_empty(),
            "No prose fields present, should have no ranges, got: {:?}",
            ranges.iter().map(|r| &text[r.start_byte..r.end_byte]).collect::<Vec<_>>()
        );

        Ok(())
    }

    // ── Org mode tests ──────────────────────────────────────────────

    fn org_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = crate::org_ts::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_org_basic_extraction() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text = "* Introduction\n\nThis is a paragraph.\n";
        let ranges = extractor.extract(text, "org")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Introduction"),
            "Heading should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("This is a paragraph"),
            "Paragraph should be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_org_code_block_excluded() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text = "Some text.\n\n#+begin_src python\ndef hello():\n    pass\n#+end_src\n\nMore text.\n";
        let ranges = extractor.extract(text, "org")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Some text"),
            "Paragraph before code should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("More text"),
            "Paragraph after code should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("def hello"),
            "Code block content should not be in prose, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_org_drawer_excluded() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text = "* Heading\n\n:PROPERTIES:\n:ID: some-id\n:END:\n\nSome prose.\n";
        let ranges = extractor.extract(text, "org")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Some prose"),
            "Paragraph should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("some-id"),
            "Drawer content should not be in prose, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_org_list_items_extracted() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text = "- First item\n- Second item\n";
        let ranges = extractor.extract(text, "org")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("First item"),
            "List items should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("Second item"),
            "List items should be extracted, got: {all_prose:?}"
        );

        Ok(())
    }

    #[test]
    fn test_org_latex_env_excluded() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text = "Before math.\n\n\\begin{equation}\nE = mc^2\n\\end{equation}\n\nAfter math.\n";
        let ranges = extractor.extract(text, "org")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();

        assert!(
            all_prose.contains("Before math"),
            "Paragraph before LaTeX should be extracted, got: {all_prose:?}"
        );
        assert!(
            all_prose.contains("After math"),
            "Paragraph after LaTeX should be extracted, got: {all_prose:?}"
        );
        assert!(
            !all_prose.contains("mc^2"),
            "LaTeX env content should not be in prose, got: {all_prose:?}"
        );

        Ok(())
    }
}
