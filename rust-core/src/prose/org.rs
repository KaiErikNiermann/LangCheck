use tree_sitter::Node;

use super::ProseRange;

/// Node types that should be skipped entirely (no prose inside).
const SKIP_NODES: &[&str] = &[
    "block",     // #+begin_src / #+begin_example etc.
    "drawer",    // :PROPERTIES: ... :END:
    "latex_env", // \begin{equation} ... \end{equation}
    "comment",   // # comment lines
    "directive", // #+TITLE: etc. (metadata)
    "fndef",     // footnote definitions
    "table",     // org tables
];

/// Extract prose ranges from an Org mode AST.
///
/// Walks the tree collecting `paragraph` and heading `item` nodes as prose.
/// Skips code blocks, drawers, LaTeX environments, and other non-prose elements.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
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

    // Paragraph nodes contain prose text
    if kind == "paragraph" {
        let start = node.start_byte();
        let mut end = node.end_byte();
        // Trim trailing newlines from the paragraph range
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
        return;
    }

    // Heading item nodes contain the heading text
    if kind == "item" {
        if let Some(parent) = node.parent() {
            if parent.kind() == "headline" {
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
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose(child, text, out);
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
