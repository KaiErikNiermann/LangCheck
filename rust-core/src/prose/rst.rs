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
