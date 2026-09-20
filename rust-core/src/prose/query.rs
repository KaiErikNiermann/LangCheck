use anyhow::{Result, anyhow};
use tree_sitter::{Language, Node, Parser, Query, QueryCursor, StreamingIterator};

use super::ProseRange;

/// Extract prose ranges using a tree-sitter query.
///
/// This is the generic extraction path for languages where prose regions
/// correspond directly to named AST nodes (paragraphs, headings, text nodes).
pub fn extract(
    text: &str,
    root: Node,
    language: &Language,
    lang_id: &str,
) -> Result<Vec<ProseRange>> {
    let query_str = match lang_id {
        // A table cell holds prose like any other block; without it every
        // table in the document goes unchecked.
        "markdown" => "(paragraph) @prose (atx_heading) @prose (pipe_table_cell) @prose",
        "html" => "(text) @prose",
        _ => "(paragraph) @prose",
    };

    let query = Query::new(language, query_str)
        .map_err(|e| anyhow!("Failed to create query for {lang_id}: {e}"))?;

    // Markdown's block grammar stops at the paragraph: everything inside one is
    // a flat run of tokens, so the markup has to be found by parsing that run
    // with the inline grammar. See [`inline_markup`].
    let mut inline = if lang_id == "markdown" {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_md::INLINE_LANGUAGE.into())
            .map_err(|e| anyhow!("Failed to load the Markdown inline grammar: {e}"))?;
        Some(parser)
    } else {
        None
    };

    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, root, text.as_bytes());

    let mut ranges = Vec::new();
    while let Some(m) = matches.next() {
        for capture in m.captures() {
            let mut exclusions = Vec::new();
            if let Some(parser) = inline.as_mut() {
                inline_markup(capture.node, text, parser, &mut exclusions);
            }
            ranges.push(ProseRange {
                start_byte: capture.node.start_byte(),
                end_byte: capture.node.end_byte(),
                exclusions,
                language: None,
            });
        }
    }

    Ok(ranges)
}

/// Inline nodes that are markup all the way through, and hold no prose.
///
/// `code_span` is excluded whole rather than unwrapped: its content is code,
/// like a fenced block, and `` `recieve` `` is not a misspelling. A
/// `link_destination` is a URL, and `backslash_escape` and `entity_reference`
/// are spellings of a character, not words.
const INLINE_MARKUP: &[&str] = &[
    "emphasis_delimiter",
    "code_span",
    "uri_autolink",
    "email_autolink",
    "link_destination",
    "link_title",
    "link_label",
    "html_tag",
    "backslash_escape",
    "entity_reference",
];

/// Inline nodes wrapping prose in punctuation: the brackets go, the text stays.
const INLINE_WRAPPERS: &[&str] = &[
    "inline_link",
    "image",
    "shortcut_link",
    "collapsed_reference_link",
    "full_reference_link",
];

/// The prose inside a wrapper. Everything else in one is punctuation.
const WRAPPED_PROSE: &[&str] = &["link_text", "image_description"];

/// Record the inline markup inside a captured block as exclusions.
///
/// Markdown's block grammar exposes a paragraph's contents as one `inline`
/// token run, so `_réception_` reached the engines with its underscores
/// attached — which `LanguageTool` reports as a French misspelling. The
/// delimiters cannot be found in that run by matching characters, because the
/// same `_` tokens appear in `snake_case_names`; only the inline grammar knows
/// which of them opened an emphasis.
///
/// Offsets from the inline parse are relative to the run, so each is rebased to
/// the document before being recorded.
fn inline_markup(node: Node, text: &str, parser: &mut Parser, out: &mut Vec<(usize, usize)>) {
    if node.kind() == "inline" {
        let base = node.start_byte();
        let run = &text[node.byte_range()];
        let Some(tree) = parser.parse(run, None) else {
            return;
        };
        collect_inline_markup(tree.root_node(), base, out);
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        inline_markup(child, text, parser, out);
    }
}

/// Walk an inline tree, recording every markup span at document offsets.
fn collect_inline_markup(node: Node, base: usize, out: &mut Vec<(usize, usize)>) {
    if INLINE_MARKUP.contains(&node.kind()) {
        out.push((base + node.start_byte(), base + node.end_byte()));
        return;
    }
    if INLINE_WRAPPERS.contains(&node.kind()) {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if WRAPPED_PROSE.contains(&child.kind()) {
                collect_inline_markup(child, base, out);
            } else {
                out.push((base + child.start_byte(), base + child.end_byte()));
            }
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_inline_markup(child, base, out);
    }
}

#[cfg(test)]
mod tests {
    use crate::prose::{ProseExtractor, latex::LatexExtras};

    /// What the engines are handed for a Markdown document: the prose with
    /// every excluded span blanked, which is what `extract_text` produces.
    fn checked_text(markdown: &str) -> String {
        let language: tree_sitter::Language = tree_sitter_md::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language).expect("extractor");
        extractor
            .extract(markdown, "markdown", &LatexExtras::default())
            .expect("extraction")
            .iter()
            .map(|r| r.extract_text(markdown).trim_end().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn emphasis_delimiters_do_not_reach_the_engine() {
        // `_réception_` sent whole is reported as a French misspelling, with
        // `_ réception` among the suggestions.
        assert_eq!(
            checked_text("The word _reception_ here.\n"),
            "The word  reception  here."
        );
    }

    #[test]
    fn strong_delimiters_do_not_reach_the_engine() {
        assert_eq!(checked_text("A **strong** word.\n"), "A   strong   word.");
    }

    #[test]
    fn an_underscore_inside_a_word_is_not_a_delimiter() {
        // The block grammar cannot tell these apart from real emphasis, which
        // is why the inline grammar has to be run: blanking them would hand the
        // speller three words that are not in the document.
        assert_eq!(
            checked_text("Use snake_case_names here.\n"),
            "Use snake_case_names here."
        );
    }

    #[test]
    fn inline_code_is_excluded_whole() {
        // Its content is code, like a fenced block: `recieve` is not a typo.
        assert_eq!(checked_text("Call `recieve` now.\n"), "Call           now.");
    }

    #[test]
    fn a_link_keeps_its_text_and_drops_its_url() {
        assert_eq!(
            checked_text("See [the guide](https://example.org/x) now.\n"),
            "See  the guide                         now."
        );
    }

    #[test]
    fn an_autolink_is_excluded_whole() {
        assert_eq!(
            checked_text("Visit <https://example.org> now.\n"),
            "Visit                       now."
        );
    }

    #[test]
    fn an_image_keeps_its_alt_text() {
        assert_eq!(
            checked_text("Here ![a diagram](img.png) is.\n"),
            "Here   a diagram           is."
        );
    }

    #[test]
    fn a_backslash_escape_leaves_the_word_it_escapes() {
        assert_eq!(
            checked_text("An \\_escaped\\_ word.\n"),
            "An   escaped   word."
        );
    }

    #[test]
    fn a_heading_gets_the_same_treatment() {
        assert_eq!(
            checked_text("# A _stressed_ heading\n"),
            "# A  stressed  heading"
        );
    }

    #[test]
    fn prose_without_markup_is_untouched() {
        assert_eq!(
            checked_text("Just a plain sentence.\n"),
            "Just a plain sentence."
        );
    }
}
