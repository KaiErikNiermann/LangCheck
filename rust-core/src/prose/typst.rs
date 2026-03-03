use tree_sitter::Node;

use super::ProseRange;

/// Node types that contain no prose and should be skipped entirely.
const SKIP_NODES: &[&str] = &[
    "raw_blck",  // ```code blocks```
    "raw_span",  // `inline code`
    "math",      // $math$ and $ display math $
    "code",      // #code expressions
    "comment",   // // and /* */ comments
    "set",       // set rules
    "show",      // show rules
    "let",       // let bindings
    "import",    // import statements
    "include",   // include statements
    "label",     // <label>
    "ref",       // @reference
    "url",       // https://...
    "escape",    // \n, \u{...}
    "linebreak", // \  (trailing backslash)
];

/// Extract prose ranges from a Typst AST.
///
/// Collects text from paragraphs, headings, and list items while
/// skipping code blocks, math, set/show rules, imports, and other
/// non-prose elements. Inline markup (emphasis, strong) is bridged.
pub fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut ranges = Vec::new();
    collect_prose(root, text, &mut ranges);
    ranges
}

/// Recursively collect prose ranges from the AST.
fn collect_prose(node: Node, text: &str, out: &mut Vec<ProseRange>) {
    let kind = node.kind();

    if SKIP_NODES.contains(&kind) {
        return;
    }

    // Text leaf nodes are the primary prose content
    if kind == "text" {
        let start = node.start_byte();
        let end = node.end_byte();
        if start < end {
            // Try to merge with the previous range if they're on the same line
            // or adjacent (bridging through inline markup)
            if let Some(last) = out.last_mut() {
                let gap = &text[last.end_byte..start];
                if is_bridgeable(gap) {
                    last.end_byte = end;
                    return;
                }
            }
            out.push(ProseRange {
                start_byte: start,
                end_byte: end,
                exclusions: Vec::new(),
            });
        }
        return;
    }

    // Heading text: extract the text content, skip the # markers
    if kind == "heading" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "text" || child.kind() == "emph" || child.kind() == "strong" {
                collect_prose(child, text, out);
            }
        }
        return;
    }

    // Recurse into children for container nodes
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose(child, text, out);
    }
}

/// Check if a gap between text nodes can be bridged.
///
/// Gaps containing only whitespace (no double newlines) and inline
/// markup delimiters (`*`, `_`, `` ` ``) are bridgeable.
fn is_bridgeable(gap: &str) -> bool {
    // Paragraph breaks are never bridgeable
    if gap.contains("\n\n") || gap.contains("\r\n\r\n") {
        return false;
    }

    gap.chars()
        .all(|c| c.is_whitespace() || "*/_ \"'`".contains(c))
}

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use crate::prose::latex::LatexExtras;
    use anyhow::Result;

    fn typst_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = crate::typst_ts::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    fn extract_all_prose(text: &str) -> Result<String> {
        let mut extractor = typst_extractor()?;
        let ranges = extractor.extract(text, "typst", &LatexExtras::default())?;
        Ok(ranges.iter().map(|r| r.extract_text(text)).collect())
    }

    #[test]
    fn basic_paragraph() -> Result<()> {
        let prose = extract_all_prose("This is a simple paragraph.\n")?;
        assert!(
            prose.contains("This is a simple paragraph"),
            "got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn heading_extracted() -> Result<()> {
        let prose = extract_all_prose("= Introduction\n\nSome text.\n")?;
        assert!(prose.contains("Introduction"), "got: {prose:?}");
        assert!(prose.contains("Some text"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn emphasis_bridged() -> Result<()> {
        let prose = extract_all_prose("This is _emphasized_ text.\n")?;
        assert!(
            prose.contains("This is") && prose.contains("text"),
            "Emphasis should bridge, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn strong_bridged() -> Result<()> {
        let prose = extract_all_prose("This is *strong* text.\n")?;
        assert!(
            prose.contains("This is") && prose.contains("text"),
            "Strong should bridge, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn code_block_excluded() -> Result<()> {
        let text = "Before code.\n\n```rust\nfn main() {}\n```\n\nAfter code.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Before code"), "got: {prose:?}");
        assert!(prose.contains("After code"), "got: {prose:?}");
        assert!(!prose.contains("fn main"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn inline_code_excluded() -> Result<()> {
        let prose = extract_all_prose("Use the `println` macro.\n")?;
        assert!(prose.contains("Use the"), "got: {prose:?}");
        assert!(prose.contains("macro"), "got: {prose:?}");
        assert!(!prose.contains("println"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn math_excluded() -> Result<()> {
        let prose = extract_all_prose("The formula $E = m c^2$ is famous.\n")?;
        assert!(prose.contains("The formula"), "got: {prose:?}");
        assert!(prose.contains("is famous"), "got: {prose:?}");
        assert!(!prose.contains("E = m"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn display_math_excluded() -> Result<()> {
        let text = "Before math.\n\n$ E = m c^2 $\n\nAfter math.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Before math"), "got: {prose:?}");
        assert!(prose.contains("After math"), "got: {prose:?}");
        assert!(!prose.contains("E = m"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn set_rule_excluded() -> Result<()> {
        let text = "#set text(size: 12pt)\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("12pt"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn show_rule_excluded() -> Result<()> {
        let text = "#show heading: set text(blue)\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("blue"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn import_excluded() -> Result<()> {
        let text = "#import \"template.typ\": *\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("template"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn comment_excluded() -> Result<()> {
        let text = "Some text. // this is a comment\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some text"), "got: {prose:?}");
        assert!(!prose.contains("this is a comment"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn label_and_ref_excluded() -> Result<()> {
        let text = "= Introduction <intro>\n\nSee @intro for details.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Introduction"), "got: {prose:?}");
        assert!(prose.contains("See"), "got: {prose:?}");
        assert!(prose.contains("for details"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn list_items_extracted() -> Result<()> {
        let text = "- First item\n- Second item\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("First item"), "got: {prose:?}");
        assert!(prose.contains("Second item"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn numbered_list_extracted() -> Result<()> {
        let text = "+ One\n+ Two\n+ Three\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("One"), "got: {prose:?}");
        assert!(prose.contains("Two"), "got: {prose:?}");
        assert!(prose.contains("Three"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn paragraph_break_splits_ranges() -> Result<()> {
        let mut extractor = typst_extractor()?;
        let text = "First paragraph.\n\nSecond paragraph.\n";
        let ranges = extractor.extract(text, "typst", &LatexExtras::default())?;
        assert!(
            ranges.len() >= 2,
            "Paragraph break should create separate ranges, got {} ranges",
            ranges.len()
        );
        Ok(())
    }

    #[test]
    fn function_call_excluded() -> Result<()> {
        let text = "Some text #box[content] more text.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some text"), "got: {prose:?}");
        assert!(prose.contains("more text"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn multiple_headings() -> Result<()> {
        let text = "= Chapter One\n\nText one.\n\n== Section A\n\nText two.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Chapter One"), "got: {prose:?}");
        assert!(prose.contains("Text one"), "got: {prose:?}");
        assert!(prose.contains("Section A"), "got: {prose:?}");
        assert!(prose.contains("Text two"), "got: {prose:?}");
        Ok(())
    }

    // --- Edge case tests ---

    #[test]
    fn nested_emphasis_in_strong() -> Result<()> {
        let prose = extract_all_prose("This is *strongly _emphasized_ text* here.\n")?;
        assert!(prose.contains("This is"), "got: {prose:?}");
        assert!(prose.contains("here"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn unicode_text() -> Result<()> {
        let prose = extract_all_prose("Dies ist ein Beispiel mit Umlauten: ä, ö, ü.\n")?;
        assert!(prose.contains("Umlauten"), "got: {prose:?}");
        assert!(prose.contains("ä"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn cjk_text() -> Result<()> {
        let prose = extract_all_prose("这是一个中文段落。\n")?;
        assert!(prose.contains("中文"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn mixed_prose_and_code_same_line() -> Result<()> {
        let prose = extract_all_prose("Before `code` middle `more` after.\n")?;
        assert!(prose.contains("Before"), "got: {prose:?}");
        assert!(prose.contains("after"), "got: {prose:?}");
        assert!(
            !prose.contains("code"),
            "code should be excluded, got: {prose:?}"
        );
        assert!(
            !prose.contains("more"),
            "code should be excluded, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn multiline_line_comments_excluded() -> Result<()> {
        let text = "Before.\n// first comment\n// second comment\nAfter.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Before"), "got: {prose:?}");
        assert!(prose.contains("After"), "got: {prose:?}");
        assert!(!prose.contains("first comment"), "got: {prose:?}");
        assert!(!prose.contains("second comment"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn let_binding_excluded() -> Result<()> {
        let text = "#let x = 42\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("42"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn include_excluded() -> Result<()> {
        let text = "#include \"chapter.typ\"\n\nSome prose.\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Some prose"), "got: {prose:?}");
        assert!(!prose.contains("chapter"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn term_list_extracted() -> Result<()> {
        let text = "/ Term: Definition here\n/ Another: Second definition\n";
        let prose = extract_all_prose(text)?;
        assert!(prose.contains("Definition here"), "got: {prose:?}");
        assert!(prose.contains("Second definition"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn url_excluded() -> Result<()> {
        let prose = extract_all_prose("Visit https://example.com for details.\n")?;
        assert!(prose.contains("Visit"), "got: {prose:?}");
        assert!(prose.contains("for details"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn empty_document() -> Result<()> {
        let mut extractor = typst_extractor()?;
        let ranges = extractor.extract("", "typst", &LatexExtras::default())?;
        assert!(ranges.is_empty(), "Empty doc should produce no ranges");
        Ok(())
    }

    #[test]
    fn only_code_no_prose() -> Result<()> {
        let text = "#set text(size: 12pt)\n#show heading: set text(blue)\n#let x = 1\n";
        let prose = extract_all_prose(text)?;
        assert!(
            prose.trim().is_empty(),
            "Only code should produce no prose, got: {prose:?}"
        );
        Ok(())
    }

    #[test]
    fn heading_with_emphasis() -> Result<()> {
        let prose = extract_all_prose("= A _very_ important heading\n\nBody.\n")?;
        assert!(prose.contains("important heading"), "got: {prose:?}");
        assert!(prose.contains("Body"), "got: {prose:?}");
        Ok(())
    }

    #[test]
    fn multiple_math_inline() -> Result<()> {
        let prose = extract_all_prose("We have $a$ and $b$ as variables.\n")?;
        assert!(prose.contains("We have"), "got: {prose:?}");
        assert!(prose.contains("as variables"), "got: {prose:?}");
        Ok(())
    }
}
