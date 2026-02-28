mod latex;
mod query;

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

        Ok(())
    }
}
