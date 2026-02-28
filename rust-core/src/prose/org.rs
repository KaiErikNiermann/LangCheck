use tree_sitter::Node;

use super::ProseRange;

/// Node types that should be skipped entirely (no prose inside).
const SKIP_NODES: &[&str] = &[
    "block",      // #+begin_src / #+begin_example etc.
    "drawer",     // :PROPERTIES: ... :END:
    "latex_env",  // \begin{equation} ... \end{equation}
    "comment",    // # comment lines
    "directive",  // #+TITLE: etc. (metadata)
    "fndef",      // footnote definitions
    "table",      // org tables
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
