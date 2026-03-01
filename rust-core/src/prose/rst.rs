use tree_sitter::Node;

use super::ProseRange;

/// Directive types whose body content is NOT prose (code, math, raw).
const SKIP_DIRECTIVE_TYPES: &[&str] = &[
    "code-block",
    "code",
    "sourcecode",
    "math",
    "raw",
    "csv-table",
    "include",
    "image",
    "figure",
    "toctree",
    "only",
    "highlight",
    "literalinclude",
];

/// Extract prose ranges from a reStructuredText AST.
///
/// Walks the tree collecting `paragraph` and `title` nodes as prose ranges,
/// with exclusion zones for inline `literal` (`` ``code`` ``) nodes. Skips
/// directive content for code-block, math, and other non-prose directives.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut ranges = Vec::new();
    collect_prose_ranges(root, text, &mut ranges, false);
    ranges
}

/// Recursively walk the AST collecting prose ranges.
fn collect_prose_ranges(node: Node, text: &str, out: &mut Vec<ProseRange>, skip: bool) {
    let kind = node.kind();

    // Paragraphs and titles are prose containers — emit them as ranges
    if kind == "paragraph" || kind == "title" {
        if !skip {
            let mut exclusions = Vec::new();
            collect_exclusions(node, &mut exclusions);
            out.push(ProseRange {
                start_byte: node.start_byte(),
                end_byte: node.end_byte(),
                exclusions,
            });
        }
        return;
    }

    // For directives, check the type and skip non-prose ones
    if kind == "directive" {
        let should_skip = is_skip_directive(node, text);
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            collect_prose_ranges(child, text, out, should_skip);
        }
        return;
    }

    // Recurse into all other nodes (sections, lists, body, content, etc.)
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose_ranges(child, text, out, skip);
    }
}

/// Check if a directive node is a non-prose type that should be skipped.
fn is_skip_directive(node: Node, text: &str) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "type" {
            let name = &text[child.start_byte()..child.end_byte()];
            return SKIP_DIRECTIVE_TYPES.contains(&name);
        }
    }
    false
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
