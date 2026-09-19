use tree_sitter::Node;

use super::{ProseRange, shared::child_of_kind};

/// Directive types whose `content` block is not prose: code, data, or paths.
///
/// Everything else -- admonitions (`note`, `warning`, `seealso`, …), `only`,
/// `figure` (whose content is the caption and legend) -- has a prose body.
const NON_PROSE_CONTENT: &[&str] = &[
    "code-block",
    "code",
    "sourcecode",
    "math",
    "raw",
    "csv-table",
    "include",
    "literalinclude",
    "toctree",
    "highlight",
    "image",
];

/// Directive option fields whose value is rendered prose rather than a setting.
const PROSE_OPTION_FIELDS: &[&str] = &["caption", "alt"];

/// Directive types whose argument is a rendered title or caption rather than a
/// path, a language or a version.
const PROSE_ARGUMENT: &[&str] = &[
    "csv-table",
    "list-table",
    "table",
    "admonition",
    "rubric",
    "topic",
    "sidebar",
];

/// Extract prose ranges from a reStructuredText AST.
///
/// Walks the tree collecting `paragraph` and `title` nodes as prose ranges,
/// with exclusion zones for inline `literal` (`` ``code`` ``) nodes. Directive
/// bodies are split by role: `arguments` (a path, language or condition) is
/// never prose, `options` contributes only the fields in
/// [`PROSE_OPTION_FIELDS`], and `content` is prose unless the directive is one
/// of [`NON_PROSE_CONTENT`].
pub fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut ranges = Vec::new();
    collect_prose_ranges(root, text, &mut ranges);
    ranges
}

/// Recursively walk the AST collecting prose ranges.
fn collect_prose_ranges(node: Node, text: &str, out: &mut Vec<ProseRange>) {
    match node.kind() {
        // Paragraphs and titles are prose containers — emit them as ranges
        "paragraph" | "title" => push_range(node, out),
        "directive" => collect_directive(node, text, out),
        // Recurse into all other nodes (sections, lists, body, content, etc.)
        _ => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                collect_prose_ranges(child, text, out);
            }
        }
    }
}

/// Emit one prose range for `node`, excluding the inline literals inside it.
fn push_range(node: Node, out: &mut Vec<ProseRange>) {
    let mut exclusions = Vec::new();
    collect_exclusions(node, &mut exclusions);
    out.push(ProseRange {
        start_byte: node.start_byte(),
        end_byte: node.end_byte(),
        exclusions,
        language: None,
    });
}

/// Collect the prose a directive contributes: its prose option values and,
/// unless the type says otherwise, its content block.
fn collect_directive(node: Node, text: &str, out: &mut Vec<ProseRange>) {
    let directive_type = child_of_kind(node, "type").map(|n| &text[n.byte_range()]);
    let content_is_prose = !directive_type.is_some_and(|name| NON_PROSE_CONTENT.contains(&name));
    let argument_is_prose = directive_type.is_some_and(|name| PROSE_ARGUMENT.contains(&name));

    let Some(body) = child_of_kind(node, "body") else {
        return;
    };
    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        match child.kind() {
            "options" => collect_option_fields(child, text, out),
            "content" if content_is_prose => collect_content(child, text, out),
            // Otherwise "arguments" is a path, a language name or a condition.
            "arguments" if argument_is_prose => push_range(child, out),
            _ => {}
        }
    }
}

/// Emit the values of option fields that render as prose (`:caption:`, `:alt:`).
///
/// These are worth checking even on a directive whose body is code — a typo in
/// a code block's caption is still a typo in the rendered document.
fn collect_option_fields(options: Node, text: &str, out: &mut Vec<ProseRange>) {
    let mut cursor = options.walk();
    for field in options.children(&mut cursor) {
        let name = child_of_kind(field, "field_name").map(|n| &text[n.byte_range()]);
        if !name.is_some_and(|name| PROSE_OPTION_FIELDS.contains(&name)) {
            continue;
        }
        if let Some(value) = child_of_kind(field, "field_body") {
            collect_prose_ranges(value, text, out);
        }
    }
}

/// Recover prose paragraphs from a directive's `content` block.
///
/// tree-sitter-rst does not parse directive bodies: the whole block arrives as
/// one flat run of `text` tokens, with nested directives, literal blocks and
/// paragraph breaks all flattened away. They are recovered here from the raw
/// lines — anything that opens an indented non-prose block (an explicit markup
/// line such as `.. code-block:: rust`, a doctest `>>>` prompt, or a line
/// ending in `::`) takes its whole indented body out of the prose with it.
fn collect_content(content: Node, text: &str, out: &mut Vec<ProseRange>) {
    let end = content.end_byte();
    // The content node starts at the first word, not at column 0; back up to
    // the start of that line so the first line's indent is measurable.
    let start = text[..content.start_byte()]
        .rfind('\n')
        .map_or(0, |nl| nl + 1);

    let mut paragraph: Option<(usize, usize)> = None;
    let mut skipping_under: Option<usize> = None;
    // A doctest runs to the next blank line, including its output lines, which
    // sit at the same indent as the `>>>` prompt rather than deeper.
    let mut in_doctest = false;

    for (offset, line) in line_offsets(&text[start..end], start) {
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();

        if trimmed.trim_end().is_empty() {
            // A blank line ends a paragraph but not an indented skipped block.
            flush(&mut paragraph, text, out);
            in_doctest = false;
            continue;
        }

        if in_doctest {
            continue;
        }

        if let Some(base) = skipping_under {
            if indent > base {
                continue;
            }
            skipping_under = None;
        }

        if opens_non_prose_block(trimmed) {
            flush(&mut paragraph, text, out);
            skipping_under = Some(indent);
            in_doctest = trimmed.starts_with(">>>");
            // A paragraph introducing a literal block (`Run this::`) is itself
            // prose; an explicit markup line is not.
            if !trimmed.starts_with("..") && !in_doctest {
                out.push(ProseRange {
                    start_byte: offset + indent,
                    end_byte: offset + line.trim_end().len(),
                    exclusions: inline_literals(line.trim_end(), offset),
                    language: None,
                });
            }
            continue;
        }

        let line_end = offset + line.trim_end().len();
        match &mut paragraph {
            Some((_, para_end)) => *para_end = line_end,
            None => paragraph = Some((offset + indent, line_end)),
        }
    }
    flush(&mut paragraph, text, out);
}

/// Emit the pending paragraph, if any, and clear it.
fn flush(paragraph: &mut Option<(usize, usize)>, text: &str, out: &mut Vec<ProseRange>) {
    if let Some((start, end)) = paragraph.take()
        && start < end
    {
        out.push(ProseRange {
            start_byte: start,
            end_byte: end,
            exclusions: inline_literals(&text[start..end], start),
            language: None,
        });
    }
}

/// Whether this line opens an indented block that is not prose.
fn opens_non_prose_block(trimmed: &str) -> bool {
    // `.. directive::`, `.. |sub| replace::`, `.. _target:` and comments.
    trimmed.starts_with("..")
        // A doctest block.
        || trimmed.starts_with(">>>")
        // A literal block introduced by a trailing `::`.
        || trimmed.trim_end().ends_with("::")
}

/// Byte ranges of inline literals (`` ``code`` ``) and interpreted text
/// (`` :role:`arg` ``) within `line`, offset to document coordinates.
fn inline_literals(line: &str, offset: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"``") {
            let rest = &line[i + 2..];
            if let Some(close) = rest.find("``") {
                out.push((offset + i, offset + i + 2 + close + 2));
                i += 2 + close + 2;
                continue;
            }
        }
        if bytes[i] == b'`'
            && let Some(close) = line[i + 1..].find('`')
        {
            out.push((offset + i, offset + i + 1 + close + 1));
            i += 1 + close + 1;
            continue;
        }
        i += 1;
    }
    out
}

/// Iterate `(document byte offset, line)` pairs over `block`, which starts at
/// `base` in the document. The trailing newline is not part of the line.
fn line_offsets(block: &str, base: usize) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = base;
    block.split_inclusive('\n').map(move |line| {
        let here = offset;
        offset += line.len();
        (here, line.strip_suffix('\n').unwrap_or(line))
    })
}

/// Collect exclusion zones within a prose range (e.g. inline code literals).
fn collect_exclusions(node: Node, out: &mut Vec<(usize, usize)>) {
    let kind = node.kind();

    // Inline code: ``code`` — exclude from checking
    if kind == "literal" || kind == "interpreted_text" {
        out.push((node.start_byte(), node.end_byte()));
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_exclusions(child, out);
    }
}

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use crate::prose::latex::LatexExtras;
    use anyhow::Result;

    fn rst_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = tree_sitter_rst::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_rst_basic_extraction() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "My Title\n========\n\nThis is a paragraph.\n";
        let ranges = extractor.extract(text, "rst", &LatexExtras::default())?;
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
        let text =
            "Some text.\n\n.. code-block:: python\n\n   def hello():\n       pass\n\nMore text.\n";
        let ranges = extractor.extract(text, "rst", &LatexExtras::default())?;
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
        let ranges = extractor.extract(text, "rst", &LatexExtras::default())?;
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
        let ranges = extractor.extract(text, "rst", &LatexExtras::default())?;
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

    fn prose_of(text: &str) -> Result<String> {
        let mut extractor = rst_extractor()?;
        let ranges = extractor.extract(text, "rst", &LatexExtras::default())?;
        Ok(ranges
            .iter()
            .map(|r| r.extract_text(text).into_owned())
            .collect::<Vec<_>>()
            .join("\n"))
    }

    #[test]
    fn test_rst_admonition_body_extracted() -> Result<()> {
        let text = "\
.. note::

   First paragraph of the note.

   Second paragraph with ``inline_code`` here.

   .. code-block:: rust

      fn nested() {}

   Fourth paragraph after nested code.
";
        let prose = prose_of(text)?;
        assert!(prose.contains("First paragraph of the note."), "{prose:?}");
        assert!(prose.contains("Second paragraph with"), "{prose:?}");
        assert!(prose.contains("Fourth paragraph after"), "{prose:?}");
        assert!(!prose.contains("inline_code"), "{prose:?}");
        assert!(!prose.contains("fn nested"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_rst_figure_caption_extracted() -> Result<()> {
        let text = "\
.. figure:: diagram.png
   :alt: An alternative description

   The caption of the figure.
";
        let prose = prose_of(text)?;
        assert!(prose.contains("The caption of the figure."), "{prose:?}");
        assert!(prose.contains("An alternative description"), "{prose:?}");
        assert!(!prose.contains("diagram.png"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_rst_code_block_caption_extracted_but_not_code() -> Result<()> {
        let text = "\
.. code-block:: rust
   :caption: A caption above the code

   fn main() {}
";
        let prose = prose_of(text)?;
        assert!(prose.contains("A caption above the code"), "{prose:?}");
        assert!(!prose.contains("fn main"), "{prose:?}");
        assert!(!prose.contains("rust"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_rst_literal_and_doctest_blocks_skipped() -> Result<()> {
        let text = "\
.. warning::

   Build it like this::

      $ cargo build --unknown-flag

   Then run the doctest:

   >>> some_function()
   'result'

   Final paragraph of the warning.
";
        let prose = prose_of(text)?;
        assert!(prose.contains("Build it like this"), "{prose:?}");
        assert!(
            prose.contains("Final paragraph of the warning."),
            "{prose:?}"
        );
        assert!(!prose.contains("cargo build"), "{prose:?}");
        assert!(!prose.contains("some_function"), "{prose:?}");
        assert!(!prose.contains("'result'"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_rst_toctree_paths_not_prose() -> Result<()> {
        let text = ".. toctree::\n   :maxdepth: 2\n\n   guide/index\n   api/index\n";
        let prose = prose_of(text)?;
        assert!(!prose.contains("guide/index"), "{prose:?}");
        assert!(!prose.contains("maxdepth"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_rst_table_caption_extracted() -> Result<()> {
        let text =
            ".. csv-table:: A table caption\n   :header: \"A\", \"B\"\n\n   \"one\", \"two\"\n";
        let prose = prose_of(text)?;
        assert!(prose.contains("A table caption"), "{prose:?}");
        assert!(!prose.contains("one"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_rst_list_items_extracted() -> Result<()> {
        let mut extractor = rst_extractor()?;
        let text = "- First item\n- Second item\n";
        let ranges = extractor.extract(text, "rst", &LatexExtras::default())?;
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
}
