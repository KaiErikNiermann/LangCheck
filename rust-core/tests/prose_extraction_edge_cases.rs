//! Real-world edge case tests for prose extraction across all supported
//! languages. Uses realistic content modeled on actual documents to complement
//! the unit tests in each language module.

use anyhow::Result;
use rust_core::prose::ProseExtractor;
use rust_core::prose::latex::LatexExtras;

// ── Helpers ─────────────────────────────────────────────────────────────

fn extract_texts<'a>(
    extractor: &mut ProseExtractor,
    text: &'a str,
    lang: &str,
) -> Result<Vec<String>> {
    let ranges = extractor.extract(text, lang, &LatexExtras::default())?;
    Ok(ranges
        .iter()
        .map(|r| r.extract_text(text).into_owned())
        .collect())
}

// ── Forester ────────────────────────────────────────────────────────────

/// Real-world math-heavy Forester document (modeled on actual lecture notes).
#[test]
fn forester_math_definition_document() -> Result<()> {
    let lang: tree_sitter::Language = rust_core::forester_ts::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r"\date{2025-11-22}
\import{base-macros}
\taxon{Definition}
\title{Disjunctive Normal Form (DNF)}

\p{
  A formula #{F} is in Disjunctive Normal Form (DNF) if it is a disjunction of one or more conjunctions of one or more literals. In other words, #{F} can be expressed as a series of clauses connected by disjunctions (#{\lor}), where each clause is a series of literals connected by conjunctions (#{\land}).
}

##{
  F = C_1 \lor C_2 \lor \ldots \lor C_n
}

\p{
  Where each clause #{C_i} is of the form:
}
##{
  C_i = L_{i1} \land L_{i2} \land \ldots \land L_{im}
}";

    let texts = extract_texts(&mut ex, text, "forester")?;

    // Prose from \title should be extracted
    assert!(
        texts.iter().any(|t| t.contains("Disjunctive Normal Form")),
        "Title prose should be extracted, got: {texts:?}"
    );

    // Prose from \p paragraphs should be extracted
    assert!(
        texts
            .iter()
            .any(|t| t.contains("disjunction of one or more")),
        "Paragraph prose should be extracted, got: {texts:?}"
    );

    // Inline math should NOT appear in clean text
    for t in &texts {
        assert!(
            !t.contains("\\lor"),
            "Inline math content (\\lor) leaked into prose: {t:?}"
        );
        assert!(
            !t.contains("\\land"),
            "Inline math content (\\land) leaked into prose: {t:?}"
        );
    }

    // Display math should NOT appear
    assert!(
        !texts.iter().any(|t| t.contains("C_1")),
        "Display math should not be in prose"
    );

    // Structural commands should NOT appear
    assert!(
        !texts.iter().any(|t| t.contains("base-macros")),
        "Import path should not be in prose"
    );
    assert!(
        !texts.iter().any(|t| t.contains("2025-11-22")),
        "Date should not be in prose"
    );
    assert!(
        !texts.iter().any(|t| t.contains("Definition")),
        "Taxon should not be in prose"
    );

    Ok(())
}

/// Forester document with nested subtrees and list items.
#[test]
fn forester_nested_structure_with_lists() -> Result<()> {
    let lang: tree_sitter::Language = rust_core::forester_ts::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r"\title{Operating Systems Concepts}
\subtree{
  \title{Process Management}
  \p{A process is an instance of a running program.}

  \ol{
    \li{The process is created by the operating system.}
    \li{It executes in its own address space.}
    \li{The scheduler determines when it runs.}
  }

  \p{Each process has a unique identifier called a PID.}
}";

    let texts = extract_texts(&mut ex, text, "forester")?;

    // Each list item should be a separate scope
    assert!(
        texts.iter().any(|t| t.contains("process is created")),
        "First list item should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("address space")),
        "Second list item should be extracted"
    );

    // List items should NOT merge into one range
    assert!(
        !texts
            .iter()
            .any(|t| t.contains("created") && t.contains("address space")),
        "List items should be separate prose ranges"
    );

    // Paragraphs and titles should also be extracted separately
    assert!(
        texts.iter().any(|t| t.contains("Process Management")),
        "Subtree title should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("unique identifier")),
        "Paragraph after list should be extracted"
    );

    Ok(())
}

/// Forester with unknown macros, tex blocks, and verbatim.
#[test]
fn forester_macros_and_code_excluded() -> Result<()> {
    let lang: tree_sitter::Language = rust_core::forester_ts::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r"\title{Quiz Solution}
\p{Convert the following formula into DNF:}

\solution{
  \tex{
    \usepackage{amsmath}
  }{
    \startverb
    \begin{align*}
      & (q \lor p) \land (r \lor s)
    \end{align*}
    \stopverb
  }
}

\p{The result follows from distribution.}";

    let texts = extract_texts(&mut ex, text, "forester")?;

    // \solution is an unknown macro — should be skipped
    assert!(
        !texts.iter().any(|t| t.contains("amsmath")),
        "\\tex content inside unknown macro should not be checked"
    );
    assert!(
        !texts.iter().any(|t| t.contains("align")),
        "Verbatim content should not be checked"
    );

    // Known prose commands should still work
    assert!(
        texts.iter().any(|t| t.contains("Convert the following")),
        "\\p prose should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("result follows")),
        "\\p prose after macro should be extracted"
    );

    Ok(())
}

// ── LaTeX ───────────────────────────────────────────────────────────────

/// LaTeX document with multiple math environments and nested commands.
#[test]
fn latex_complex_math_document() -> Result<()> {
    let lang: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r"\documentclass{article}
\usepackage{amsmath}
\usepackage{amsthm}

\newtheorem{theorem}{Theorem}

\begin{document}

\section{Main Results}

We consider the function $f(x) = x^2 + 1$ on the interval $[0, 1]$.

\begin{theorem}
For all $x \in \mathbb{R}$, we have $f(x) > 0$.
\end{theorem}

\begin{proof}
Since $x^2 \geq 0$ for all $x$, it follows that
\[
  f(x) = x^2 + 1 \geq 1 > 0.
\]
This completes the proof.
\end{proof}

\begin{align}
  a &= b + c \\
  d &= e + f
\end{align}

The equation above shows the relationship.

\end{document}";

    let texts = extract_texts(&mut ex, text, "latex")?;

    // Prose should be extracted
    assert!(
        texts.iter().any(|t| t.contains("We consider the function")),
        "Section prose should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("completes the proof")),
        "Proof text should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("equation above")),
        "Text after align should be extracted"
    );

    // Preamble should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("documentclass")),
        "Preamble should not be in prose"
    );

    // Display math (align) should NOT be in prose
    assert!(
        !texts.iter().any(|t| t.contains("a &= b")),
        "align environment should not be in prose"
    );

    Ok(())
}

/// LaTeX with deeply nested environments and edge cases.
#[test]
fn latex_nested_environments() -> Result<()> {
    let lang: tree_sitter::Language = codebook_tree_sitter_latex::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r"\documentclass{article}
\begin{document}

\begin{enumerate}
  \item First item with \textbf{bold text} and $x^2$.
  \item Second item.
  \begin{itemize}
    \item Nested bullet point.
    \item Another nested point with \emph{emphasis}.
  \end{itemize}
  \item Third item.
\end{enumerate}

\begin{figure}[h]
  \centering
  \includegraphics[width=0.5\textwidth]{image.png}
  \caption{An important figure showing results.}
\end{figure}

\end{document}";

    let texts = extract_texts(&mut ex, text, "latex")?;

    // Caption text should be extracted
    assert!(
        texts.iter().any(|t| t.contains("important figure")),
        "Figure caption should be extracted"
    );

    // Image path should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("image.png")),
        "includegraphics path should not be in prose"
    );

    Ok(())
}

// ── BibTeX ──────────────────────────────────────────────────────────────

/// BibTeX with varied entry types and LaTeX markup in titles.
#[test]
fn bibtex_mixed_entries() -> Result<()> {
    let lang: tree_sitter::Language = tree_sitter_bibtex::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r#"@article{knuth1984,
  author = {Donald E. Knuth},
  title = {Literate Programming},
  journal = {The Computer Journal},
  year = {1984},
  volume = {27},
  number = {2},
  pages = {97--111},
}

@inproceedings{dijkstra1968,
  author = {Edsger W. Dijkstra},
  title = {Go To Statement Considered Harmful},
  booktitle = {Communications of the {ACM}},
  year = {1968},
  note = {This paper sparked a major debate about structured programming.},
}

@book{turing1950,
  author = {Alan Turing},
  title = {Computing Machinery and \emph{Intelligence}},
  year = {1950},
  abstract = {A seminal paper proposing the imitation game as a test for machine intelligence. The paper argues that the question ``Can machines think?'' should be replaced with a more operationally defined test.},
}"#;

    let texts = extract_texts(&mut ex, text, "bibtex")?;

    // Titles should be extracted
    assert!(
        texts.iter().any(|t| t.contains("Literate Programming")),
        "Article title should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("Considered Harmful")),
        "Inproceedings title should be extracted"
    );

    // Abstract should be extracted
    assert!(
        texts.iter().any(|t| t.contains("imitation game")),
        "Abstract prose should be extracted"
    );

    // Note should be extracted
    assert!(
        texts.iter().any(|t| t.contains("major debate")),
        "Note prose should be extracted"
    );

    // Non-prose fields should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("97--111")),
        "Pages field should not be in prose"
    );
    assert!(
        !texts.iter().any(|t| t.contains("1984")),
        "Year field should not be in prose"
    );

    // LaTeX commands in titles should be excluded
    for t in &texts {
        assert!(
            !t.contains("\\emph"),
            "LaTeX command \\emph leaked into prose: {t:?}"
        );
    }

    Ok(())
}

// ── Org mode ────────────────────────────────────────────────────────────

/// Org document with mixed content: headings, code, drawers, tables.
#[test]
fn org_mixed_content() -> Result<()> {
    let lang: tree_sitter::Language = rust_core::org_ts::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = "* Introduction
This is the opening paragraph of the document.

** Background
Some background information is provided here.

#+BEGIN_SRC python
def hello():
    print(\"Hello, world!\")
#+END_SRC

The code above demonstrates a simple function.

:PROPERTIES:
:CUSTOM_ID: background
:END:

*** Key Concepts
- First concept in the list.
- Second concept with more details.
- Third concept.

| Header 1 | Header 2 |
|----------+----------|
| Cell 1   | Cell 2   |

\\begin{equation}
E = mc^2
\\end{equation}

Final paragraph after the equation.
";

    let texts = extract_texts(&mut ex, text, "org")?;

    // Headings and paragraphs should be extracted
    assert!(
        texts.iter().any(|t| t.contains("opening paragraph")),
        "Paragraph should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("background information")),
        "Background paragraph should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("simple function")),
        "Paragraph after code should be extracted"
    );

    // Code blocks should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("def hello")),
        "Python code should not be in prose"
    );

    // Drawers should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("CUSTOM_ID")),
        "Property drawer should not be in prose"
    );

    // Tables should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("Cell 1")),
        "Table content should not be in prose"
    );

    // Final paragraph should be extracted
    assert!(
        texts.iter().any(|t| t.contains("Final paragraph")),
        "Final paragraph should be extracted"
    );

    Ok(())
}

// ── reStructuredText ────────────────────────────────────────────────────

/// rST document with directives, code, and nested structures.
#[test]
fn rst_directives_and_code() -> Result<()> {
    let lang: tree_sitter::Language = tree_sitter_rst::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = "Introduction
============

This is a paragraph in the introduction section.

.. note::

   This is an important note for the reader.

.. code-block:: python

   def example():
       return 42

After the code block, we continue with more prose.

.. math::

   \\int_0^1 f(x) \\, dx

The integral above is fundamental to the theory.

.. warning::

   Be careful with edge cases.
";

    let texts = extract_texts(&mut ex, text, "rst")?;

    // Regular prose should be extracted
    assert!(
        texts
            .iter()
            .any(|t| t.contains("paragraph in the introduction")),
        "Intro paragraph should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("continue with more prose")),
        "Prose after code should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("integral above")),
        "Prose after math should be extracted"
    );

    // Code should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("def example")),
        "Code block should not be in prose"
    );

    Ok(())
}

// ── Sweave ──────────────────────────────────────────────────────────────

/// Sweave document mixing LaTeX and R code chunks.
#[test]
fn sweave_mixed_content() -> Result<()> {
    let lang = rust_core::languages::resolve_ts_language("sweave");
    let mut ex = ProseExtractor::new(lang)?;

    let text = r#"\documentclass{article}
\begin{document}

\section{Data Analysis}

We analyze the dataset using standard statistical methods.

<<setup, echo=FALSE>>=
library(ggplot2)
data <- read.csv("experiment.csv")
summary(data)
@

The summary statistics show a normal distribution.

<<plot, fig=TRUE>>=
ggplot(data, aes(x=value)) + geom_histogram()
@

The histogram above confirms our hypothesis.

\end{document}"#;

    let texts = extract_texts(&mut ex, text, "sweave")?;

    // Prose should be extracted
    assert!(
        texts.iter().any(|t| t.contains("analyze the dataset")),
        "Prose before R chunk should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("summary statistics")),
        "Prose between R chunks should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("confirms our hypothesis")),
        "Prose after R chunk should be extracted"
    );

    // R code should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("library(ggplot2)")),
        "R code should not be in prose"
    );
    assert!(
        !texts.iter().any(|t| t.contains("read.csv")),
        "R code should not be in prose"
    );

    // Preamble should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("documentclass")),
        "Preamble should not be in prose"
    );

    Ok(())
}

// ── Markdown ────────────────────────────────────────────────────────────

/// Markdown with fenced code, inline code, links, and nested lists.
#[test]
fn markdown_complex_document() -> Result<()> {
    let lang: tree_sitter::Language = tree_sitter_md::LANGUAGE.into();
    let mut ex = ProseExtractor::new(lang)?;

    let text = r#"# Project Overview

This project provides a **grammar checking** tool for multiple markup languages.

## Features

- Supports Markdown, LaTeX, and more.
- Uses `tree-sitter` for parsing.
- Provides real-time diagnostics.

## Installation

```bash
cargo install language-check
```

After installation, run `language-check check file.md` to start checking.

## Configuration

See the [configuration guide](docs/guide.md) for details.

> **Note:** This is a blockquote with important information.
> It spans multiple lines.

The tool works with the following formats:

1. Markdown (`.md`)
2. LaTeX (`.tex`)
3. Forester (`.tree`)
"#;

    let texts = extract_texts(&mut ex, text, "markdown")?;

    // Prose should be extracted
    assert!(
        texts.iter().any(|t| t.contains("grammar checking")),
        "Paragraph prose should be extracted"
    );
    assert!(
        texts.iter().any(|t| t.contains("After installation")),
        "Prose after code block should be extracted"
    );

    // Code blocks should NOT be extracted
    assert!(
        !texts.iter().any(|t| t.contains("cargo install")),
        "Fenced code should not be in prose"
    );

    Ok(())
}
