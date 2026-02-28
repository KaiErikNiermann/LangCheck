use tree_sitter::Node;

use super::{ProseRange, shared};

/// Commands whose arguments contain identifiers/addresses, not prose.
/// All arguments of these commands are skipped entirely.
const STRUCTURAL_COMMANDS: &[&str] = &[
    "\\import",
    "\\export",
    "\\transclude",
    "\\ref",
    "\\author",
    "\\contributor",
    "\\date",
    "\\parent",
    "\\tag",
    "\\taxon",
    "\\meta",
    "\\number",
    "\\def",
    "\\let",
    "\\alloc",
    "\\open",
    "\\namespace",
    "\\put",
    "\\get",
    "\\put?",
    "\\object",
    "\\patch",
    "\\call",
    "\\tex",
    "\\codeblock",
    "\\pre",
    "\\startverb",
    "\\xmlns",
    "\\query",
    "\\datalog",
];

/// Node kinds that are never prose and whose subtrees should be skipped.
const SKIP_KINDS: &[&str] = &[
    "inline_math",
    "display_math",
    "verbatim",
    "comment",
    "wiki_link",
    "command_name",
];

/// Extract prose ranges from a Forester AST.
///
/// Walks the tree collecting `text` and `escape` leaf nodes, skipping math,
/// verbatim, comments, wiki links, and structural command arguments. Adjacent
/// text nodes are merged into sentence-level prose chunks with gap analysis.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_prose_nodes(root, text, false, &mut word_ranges);
    shared::merge_ranges(&word_ranges, text, strip_forester_noise, collect_display_math_exclusions)
}

/// Check whether a command node is structural (non-prose arguments).
fn is_structural_command(node: Node, text: &str) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "command_name" {
            let name = &text[child.start_byte()..child.end_byte()];
            return STRUCTURAL_COMMANDS.contains(&name);
        }
    }
    false
}

/// Recursively collect prose leaf nodes (`text` and `escape`), skipping
/// non-prose subtrees.
fn collect_prose_nodes(
    node: Node,
    text: &str,
    skip: bool,
    out: &mut Vec<(usize, usize)>,
) {
    let kind = node.kind();

    // Skip entire subtrees for non-prose node kinds
    if SKIP_KINDS.contains(&kind) {
        return;
    }

    // For command nodes, check if structural — if so, skip all arguments
    if kind == "command" {
        if skip || is_structural_command(node, text) {
            return;
        }
        // Prose command: recurse into children, skipping the command_name
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            collect_prose_nodes(child, text, false, out);
        }
        return;
    }

    // Leaf prose nodes
    if kind == "text" || kind == "escape" {
        if !skip {
            let start = node.start_byte();
            let end = node.end_byte();
            if start < end {
                out.push((start, end));
            }
        }
        return;
    }

    // Recurse into all other nodes (groups, source_file, etc.)
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose_nodes(child, text, skip, out);
    }
}

/// Find display math regions (`##{...}`) in a gap and record them as
/// exclusions. Extends the exclusion to cover surrounding whitespace so the
/// grammar checker sees spaces instead of newlines.
fn collect_display_math_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] == b'#' && bytes[i + 1] == b'#' && bytes[i + 2] == b'{' {
            // Extend backwards to include leading whitespace/newlines
            let mut exc_start = i;
            while exc_start > 0 && bytes[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }

            // Skip past the ##{ and find matching }
            i += 3;
            let mut depth = 1;
            while i < bytes.len() && depth > 0 {
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                }
                i += 1;
            }

            // Extend forwards to include trailing whitespace/newlines
            let mut exc_end = i;
            while exc_end < bytes.len() && bytes[exc_end].is_ascii_whitespace() {
                exc_end += 1;
            }

            out.push((gap_offset + exc_start, gap_offset + exc_end));
            i = exc_end;
        } else {
            i += 1;
        }
    }
}

/// Strip Forester noise from a gap string: math, commands, escapes.
/// Leaves whitespace, braces, and punctuation for subsequent validation.
fn strip_forester_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        // Display math: ##{...}
        if chars[i] == '#'
            && i + 2 < chars.len()
            && chars[i + 1] == '#'
            && chars[i + 2] == '{'
        {
            i += 3;
            let mut depth = 1;
            while i < chars.len() && depth > 0 {
                if chars[i] == '{' {
                    depth += 1;
                } else if chars[i] == '}' {
                    depth -= 1;
                }
                i += 1;
            }
            // Replace with space to avoid false paragraph breaks
            result.push(' ');
        // Inline math: #{...}
        } else if chars[i] == '#' && i + 1 < chars.len() && chars[i + 1] == '{' {
            i += 2;
            let mut depth = 1;
            while i < chars.len() && depth > 0 {
                if chars[i] == '{' {
                    depth += 1;
                } else if chars[i] == '}' {
                    depth -= 1;
                }
                i += 1;
            }
            result.push(' ');
        // Command: \name followed by optional {}, [], () args
        } else if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphanumeric()
        {
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric()
                    || chars[i] == '-'
                    || chars[i] == '/'
                    || chars[i] == '?'
                    || chars[i] == '*')
            {
                i += 1;
            }
            // Skip command arguments: {content}, [content], (content)
            while i < chars.len() && matches!(chars[i], '{' | '[' | '(') {
                let open = chars[i];
                let close = match open {
                    '{' => '}',
                    '[' => ']',
                    '(' => ')',
                    _ => unreachable!(),
                };
                let mut depth = 1;
                i += 1;
                while i < chars.len() && depth > 0 {
                    if chars[i] == open {
                        depth += 1;
                    } else if chars[i] == close {
                        depth -= 1;
                    }
                    i += 1;
                }
            }
        // Escape: \X
        } else if chars[i] == '\\' && i + 1 < chars.len() {
            i += 2;
        // Comment: % to end of line
        } else if chars[i] == '%' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}
