use tree_sitter::Node;

use super::{ProseRange, shared::child_of_kind};

/// Node types that should be skipped entirely (no prose inside).
const SKIP_NODES: &[&str] = &[
    "drawer",    // :PROPERTIES: ... :END:
    "latex_env", // \begin{equation} ... \end{equation}
    "comment",   // # comment lines
];

/// `#+begin_…` blocks whose contents are prose rather than code or data.
const PROSE_BLOCKS: &[&str] = &["quote", "verse", "abstract"];

/// `#+KEY:` directives whose value is rendered prose rather than a setting.
///
/// Compared case-insensitively — Org accepts `#+title:` and `#+TITLE:` alike.
const PROSE_DIRECTIVES: &[&str] = &["TITLE", "SUBTITLE", "CAPTION", "DESCRIPTION"];

/// Extract prose ranges from an Org mode AST.
///
/// Walks the tree collecting `paragraph` and heading `item` nodes as prose,
/// plus the parts of a structured node that render as text: the contents of a
/// quote or verse block, table cells, footnote definitions and the value of a
/// `#+TITLE:`-style directive. Code blocks, drawers, LaTeX environments and
/// comments are skipped.
pub fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut ranges = Vec::new();
    collect_prose(root, text, &mut ranges);
    ranges
}

/// Recursively collect prose ranges from the AST.
fn collect_prose(node: Node, text: &str, out: &mut Vec<ProseRange>) {
    let kind = node.kind();

    // Skip non-prose subtrees entirely
    if SKIP_NODES.contains(&kind) {
        return;
    }

    match kind {
        // Paragraph nodes contain prose text
        "paragraph" => {
            push_trimmed(node, text, out);
            return;
        }
        // `#+begin_quote` and friends wrap prose; `#+begin_src` wraps code.
        "block" => {
            let name = child_of_kind(node, "expr").map(|n| &text[n.byte_range()]);
            if name.is_some_and(|name| PROSE_BLOCKS.contains(&name))
                && let Some(contents) = child_of_kind(node, "contents")
            {
                push_trimmed(contents, text, out);
            }
            return;
        }
        // `[fn:1] The footnote text.` — the label is not prose, the body is.
        "fndef" => {
            if let Some(description) = child_of_kind(node, "description") {
                push_trimmed(description, text, out);
            }
            return;
        }
        // `#+TITLE: …` renders; `#+OPTIONS: …` does not.
        "directive" => {
            let key = child_of_kind(node, "expr").map(|n| text[n.byte_range()].to_uppercase());
            if key.is_some_and(|key| PROSE_DIRECTIVES.contains(&key.as_str()))
                && let Some(value) = child_of_kind(node, "value")
            {
                push_trimmed(value, text, out);
            }
            return;
        }
        // A table is a grid of cells, and each cell holds prose.
        "cell" => {
            if let Some(contents) = child_of_kind(node, "contents") {
                push_trimmed(contents, text, out);
            }
            return;
        }
        _ => {}
    }

    // Heading item nodes contain the heading text
    if kind == "item"
        && let Some(parent) = node.parent()
        && parent.kind() == "headline"
    {
        let start = node.start_byte();
        let end = node.end_byte();
        if start < end {
            out.push(ProseRange {
                start_byte: start,
                end_byte: end,
                exclusions: Vec::new(),
            });
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose(child, text, out);
    }
}

/// Emit `node` as a prose range with its trailing newlines trimmed off.
fn push_trimmed(node: Node, text: &str, out: &mut Vec<ProseRange>) {
    let start = node.start_byte();
    let mut end = node.end_byte();
    while end > start && text.as_bytes()[end - 1] == b'\n' {
        end -= 1;
    }
    if start < end {
        out.push(ProseRange {
            start_byte: start,
            end_byte: end,
            exclusions: Vec::new(),
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use crate::prose::latex::LatexExtras;
    use anyhow::Result;

    fn org_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = crate::org_ts::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_org_basic_extraction() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text = "* Introduction\n\nThis is a paragraph.\n";
        let ranges = extractor.extract(text, "org", &LatexExtras::default())?;
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

    fn prose_of(text: &str) -> Result<String> {
        let mut extractor = org_extractor()?;
        let ranges = extractor.extract(text, "org", &LatexExtras::default())?;
        Ok(ranges
            .iter()
            .map(|r| r.extract_text(text).into_owned())
            .collect::<Vec<_>>()
            .join("\n"))
    }

    #[test]
    fn test_org_quote_block_extracted() -> Result<()> {
        let text = "\
#+begin_quote
A quoted paragraph.
#+end_quote

#+begin_src rust
fn code_here() {}
#+end_src
";
        let prose = prose_of(text)?;
        assert!(prose.contains("A quoted paragraph."), "{prose:?}");
        assert!(!prose.contains("code_here"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_org_table_cells_extracted() -> Result<()> {
        let prose = prose_of("| First cell | Second cell |\n")?;
        assert!(prose.contains("First cell"), "{prose:?}");
        assert!(prose.contains("Second cell"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_org_footnote_definition_extracted() -> Result<()> {
        let prose = prose_of("[fn:1] The text of the footnote.\n")?;
        assert!(prose.contains("The text of the footnote."), "{prose:?}");
        assert!(!prose.contains("fn:1"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_org_prose_directives_extracted() -> Result<()> {
        let text = "#+title: The document title\n#+options: toc:nil num:t\n";
        let prose = prose_of(text)?;
        assert!(prose.contains("The document title"), "{prose:?}");
        assert!(!prose.contains("toc:nil"), "{prose:?}");
        assert!(!prose.contains("#+"), "{prose:?}");
        Ok(())
    }

    #[test]
    fn test_org_code_block_excluded() -> Result<()> {
        let mut extractor = org_extractor()?;
        let text =
            "Some text.\n\n#+begin_src python\ndef hello():\n    pass\n#+end_src\n\nMore text.\n";
        let ranges = extractor.extract(text, "org", &LatexExtras::default())?;
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
        let ranges = extractor.extract(text, "org", &LatexExtras::default())?;
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
        let ranges = extractor.extract(text, "org", &LatexExtras::default())?;
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
        let ranges = extractor.extract(text, "org", &LatexExtras::default())?;
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
