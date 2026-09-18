//! Randomised composition test for prose extraction.
//!
//! Each language gets a bank of source fragments labelled prose or non-prose.
//! A run shuffles a subset of them into one document, checks that the result
//! still parses without an `ERROR` node (so the composition is valid syntax and
//! the assertions mean something), and then asserts the extractor's contract:
//! every prose fragment's marker word reaches the checked text, and no
//! non-prose fragment's marker word does.
//!
//! The markers are nonsense words, so a leak cannot be confused with ordinary
//! vocabulary, and the seed is printed on failure to make a case reproducible.

use anyhow::Result;
use lang_check::prose::{ProseExtractor, latex::LatexExtras};
use rand::SeedableRng;
use rand::rngs::SmallRng;
use rand::seq::SliceRandom;

/// One piece of a document. `%%` is replaced by a unique marker word.
struct Fragment {
    /// Source template, with `%%` where the marker word goes.
    template: &'static str,
    /// Whether the marker must survive into the extracted prose.
    prose: bool,
}

const fn prose(template: &'static str) -> Fragment {
    Fragment {
        template,
        prose: true,
    }
}

const fn code(template: &'static str) -> Fragment {
    Fragment {
        template,
        prose: false,
    }
}

const TYPST: &[Fragment] = &[
    prose("A plain paragraph mentions %% in passing."),
    prose("= A heading naming %%"),
    prose("#columns(2)[\n  The two-column body mentions %% here.\n]"),
    prose("#align(center)[\n  The centred block mentions %% here.\n]"),
    prose("#figure(\n  image(\"plot.png\"),\n  caption: [The caption mentions %% here.],\n)"),
    prose("#box[A box body mentions %% here.]"),
    prose("- A list item mentions %% here."),
    prose("Text before #emph[an emphasis mentioning %% inside] and after."),
    prose("#text(size: 9pt)[A styled run mentions %% here.]"),
    prose("#align(center)[#emph[A doubly nested run mentions %% here.]]"),
    prose("#figure(caption: [A caption mentioning %% here.])[Figure body text.]"),
    prose("#table(\n  columns: 2,\n  [A cell mentioning %% here.], [Second cell.],\n)"),
    prose("#link(\"https://example.com\")[A link label mentioning %% here.]"),
    code("```rust\nfn %%() {}\n```"),
    code("A paragraph with `%%` inline code."),
    code("$ %% + 1 = 2 $"),
    code("// A comment naming %%"),
    code("#let %% = 1"),
    code("#import \"%%.typ\": *"),
    code("#set text(font: \"%%\")"),
    code("A paragraph with a link to https://example.com/%%/page."),
    code("#box[Prose around `%%` raw text inside a content block.]"),
    code("#align(center)[A centred run around $%% + 1$ math.]"),
    code("#show heading: set text(font: \"%%\")"),
    code("A paragraph followed by a label. <%%>"),
];

// Markdown blocks are emitted whole and re-parsed by the engine's own Markdown
// parser, which is what strips inline code spans and link URLs. So the bank
// asserts on block structure only; an inline span reaching the block text is
// the documented contract, not a leak.
const MARKDOWN: &[Fragment] = &[
    prose("A plain paragraph mentions %% in passing."),
    prose("# A heading naming %%"),
    prose("A setext heading naming %%\n========================"),
    prose("> A blockquote mentions %% here."),
    prose("- A list item mentions %% here."),
    prose("A paragraph with **bold %% inside** and after."),
    prose("| A table cell mentions %% | second |\n| --- | --- |\n| body | cell |"),
    code("```rust\nfn %%() {}\n```"),
    code("<!-- A comment naming %% -->"),
];

const LATEX: &[Fragment] = &[
    prose("A plain paragraph mentions %% in passing."),
    prose("\\section{A heading naming %%}"),
    prose("\\begin{itemize}\n  \\item A list item mentions %% here.\n\\end{itemize}"),
    prose("\\footnote{A footnote mentions %% here.}"),
    prose("\\emph{An emphasised run mentions %% here.}"),
    prose("\\begin{quote}\n  A quoted paragraph mentions %% here.\n\\end{quote}"),
    prose("\\begin{figure}\n  \\caption{The caption mentions %% here.}\n\\end{figure}"),
    code("\\begin{verbatim}\n%%\n\\end{verbatim}"),
    code("\\begin{equation}\n  x = %% + 1\n\\end{equation}"),
    code("% A comment naming %%"),
    code("\\label{sec:%%}"),
    code("A paragraph with \\verb|%%| inline verbatim."),
    code("\\begin{figure}\n  \\includegraphics{%%.png}\n\\end{figure}"),
];

const ORG: &[Fragment] = &[
    prose("A plain paragraph mentions %% in passing."),
    prose("* A heading naming %%"),
    prose("#+begin_quote\nA quoted paragraph mentions %% here.\n#+end_quote"),
    prose("[fn:9] A footnote mentions %% here."),
    prose("| A table cell mentions %% | second |"),
    prose("#+title: A document title naming %%"),
    code("#+begin_src rust\nfn %%() {}\n#+end_src"),
    code("# A comment naming %%"),
    code("#+options: %%:nil"),
    code(":PROPERTIES:\n:CUSTOM_ID: %%\n:END:"),
];

const RST: &[Fragment] = &[
    prose("A plain paragraph mentions %% in passing."),
    prose(".. note::\n\n   An admonition mentions %% here."),
    prose(".. figure:: plot.png\n\n   The caption mentions %% here."),
    prose(".. code-block:: rust\n   :caption: The caption mentions %% here.\n\n   fn main() {}"),
    prose("- A list item mentions %% here."),
    code(".. code-block:: rust\n\n   fn %%() {}"),
    code(".. math::\n\n   x = %% + 1"),
    code(".. toctree::\n\n   guide/%%"),
    code(
        ".. note::\n\n   An admonition around a code block.\n\n   .. code-block:: rust\n\n      fn %%() {}",
    ),
    code(".. warning::\n\n   An admonition introducing a literal block::\n\n      %% --flag"),
];

/// A marker word: nonsense, alphanumeric, and a legal identifier everywhere.
///
/// The `zz` tail keeps one marker from being a prefix of another, so a
/// `contains` check cannot match `zqvurg1` inside `zqvurg10`.
fn marker(index: usize) -> String {
    format!("zqvurg{index}zz")
}

/// Build one document from `fragments`, returning it with the marker each
/// fragment was given.
fn compose(fragments: &[&Fragment]) -> (String, Vec<(String, bool)>) {
    let mut doc = String::new();
    let mut markers = Vec::with_capacity(fragments.len());
    for (index, fragment) in fragments.iter().enumerate() {
        let word = marker(index);
        doc.push_str(&fragment.template.replace("%%", &word));
        doc.push_str("\n\n");
        markers.push((word, fragment.prose));
    }
    (doc, markers)
}

/// Run `iterations` shuffles of `bank` through the extractor for `lang_id`.
fn fuzz_language(lang_id: &str, bank: &'static [Fragment], iterations: u64) -> Result<()> {
    let language = lang_check::languages::resolve_ts_language(lang_id);
    let mut extractor = ProseExtractor::new(language.clone())?;
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&language)?;

    for seed in 0..iterations {
        let mut rng = SmallRng::seed_from_u64(seed);
        let mut picks: Vec<&Fragment> = bank.iter().collect();
        picks.shuffle(&mut rng);
        picks.truncate(3 + (seed as usize % (bank.len() - 2)));

        let (doc, markers) = compose(&picks);

        // The composition has to be valid source, or the assertions below would
        // be testing the error-recovery path instead of the extractor.
        let tree = parser.parse(&doc, None).expect("parser returned no tree");
        assert!(
            !tree.root_node().has_error(),
            "{lang_id} seed {seed}: composed document does not parse\n{doc}"
        );

        let extracted: String = extractor
            .extract(&doc, lang_id, &LatexExtras::default())?
            .iter()
            .map(|range| range.extract_text(&doc).into_owned())
            .collect::<Vec<_>>()
            .join("\n");

        for (word, is_prose) in markers {
            assert_eq!(
                extracted.contains(&word),
                is_prose,
                "{lang_id} seed {seed}: marker {word:?} should{} be in the prose\n\
                 --- document ---\n{doc}\n--- extracted ---\n{extracted}",
                if is_prose { "" } else { " not" }
            );
        }
    }
    Ok(())
}

#[test]
fn typst_composition() -> Result<()> {
    fuzz_language("typst", TYPST, 500)
}

#[test]
fn markdown_composition() -> Result<()> {
    fuzz_language("markdown", MARKDOWN, 500)
}

#[test]
fn latex_composition() -> Result<()> {
    fuzz_language("latex", LATEX, 500)
}

#[test]
fn org_composition() -> Result<()> {
    fuzz_language("org", ORG, 500)
}

#[test]
fn rst_composition() -> Result<()> {
    fuzz_language("rst", RST, 500)
}
