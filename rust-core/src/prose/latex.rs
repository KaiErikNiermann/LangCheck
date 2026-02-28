use tree_sitter::Node;

use super::{ProseRange, shared};

/// Built-in environment types that tree-sitter-latex recognises as dedicated
/// node kinds (not `generic_environment`). Skip these entirely.
const SKIP_ENV_KINDS: &[&str] = &[
    "verbatim_environment",
    "minted_environment",
    "listing_environment",
    "comment_environment",
    "math_environment",
    "asy_environment",
    "luacode_environment",
    "pycode_environment",
    "sageblock_environment",
    "sagesilent_environment",
];

/// Generic environment names (the `{name}` in `\begin{name}`) that should be
/// skipped. These are environments tree-sitter-latex parses as
/// `generic_environment` rather than a dedicated node kind.
const SKIP_GENERIC_ENVS: &[&str] = &[
    "algorithm",
    "algorithmic",
    "lstlisting",
    "equation",
    "equation*",
    "align",
    "align*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "flalign",
    "flalign*",
    "split",
    "tikzpicture",
    "pgfpicture",
    "forest",
    "tabular",
    "tabular*",
    "array",
    "matrix",
    "bmatrix",
    "pmatrix",
    "vmatrix",
    "Bmatrix",
    "Vmatrix",
    "cases",
];

/// Node types that represent math and should be skipped.
const SKIP_NODES: &[&str] = &["inline_formula", "displayed_equation"];

/// Node types that are always structural (never contain prose `word` nodes).
const STRUCTURAL_NODES: &[&str] = &[
    "command_name",
    "graphics_include",
    "label_definition",
    "label_reference",
    "citation",
    "package_include",
    "bibstyle_include",
];

/// Extract prose ranges from a LaTeX AST.
///
/// Walks the tree collecting `word` leaf nodes, skipping preamble, math,
/// verbatim, and other non-prose environments. Adjacent words are merged
/// into sentence-level prose chunks.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let doc_start = find_document_body_start(root, text);

    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_words(root, text, doc_start, false, &mut word_ranges);

    shared::merge_ranges(&word_ranges, text, strip_latex_noise, collect_display_math_exclusions)
}

/// Check whether a node kind represents a structural (non-prose) container.
///
/// Includes all `brack_group*` variants, specialised `curly_group_*` variants
/// (but NOT plain `curly_group` which holds prose), and explicitly listed
/// structural node types.
fn is_structural_node(kind: &str) -> bool {
    if kind.starts_with("brack_group") {
        return true;
    }
    if kind.starts_with("curly_group_") {
        return true;
    }
    STRUCTURAL_NODES.contains(&kind)
}

/// Find the byte offset where `\begin{document}` body starts.
/// Returns 0 if no document environment is found (single-file snippets).
fn find_document_body_start(root: Node, text: &str) -> usize {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() == "generic_environment"
            && let Some(begin_node) = child.child_by_field_name("begin")
        {
            let begin_text = &text[begin_node.start_byte()..begin_node.end_byte()];
            if begin_text.contains("document") {
                return begin_node.end_byte();
            }
        }
    }
    0
}

/// Recursively collect prose leaf nodes (`word`), skipping excluded subtrees.
///
/// The `in_structural` flag propagates through the tree so that `word` nodes
/// nested inside structural parents (at any depth) are skipped.
fn collect_words(
    node: Node,
    text: &str,
    doc_start: usize,
    in_structural: bool,
    out: &mut Vec<(usize, usize)>,
) {
    if node.end_byte() <= doc_start {
        return;
    }

    let kind = node.kind();

    if SKIP_ENV_KINDS.contains(&kind) || SKIP_NODES.contains(&kind) {
        return;
    }

    if kind == "generic_environment" && should_skip_generic_env(node, text) {
        return;
    }

    let structural = in_structural || is_structural_node(kind);

    if kind == "word" {
        if !structural {
            let start = node.start_byte();
            let end = node.end_byte();
            if start >= doc_start && start < end {
                out.push((start, end));
            }
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_words(child, text, doc_start, structural, out);
    }
}

/// Check if a `generic_environment` node should be skipped based on its name.
fn should_skip_generic_env(node: Node, text: &str) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "begin" {
            let mut inner = child.walk();
            for bc in child.children(&mut inner) {
                if bc.kind() == "curly_group_text" {
                    let mut name_cursor = bc.walk();
                    for name_child in bc.children(&mut name_cursor) {
                        if name_child.kind() == "text" {
                            let env_name =
                                &text[name_child.start_byte()..name_child.end_byte()];
                            return SKIP_GENERIC_ENVS.contains(&env_name.trim());
                        }
                    }
                }
            }
            break;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Word-range merging with LaTeX-aware gap analysis
// ---------------------------------------------------------------------------

/// Find display math regions (`\[...\]`) in a gap and record them as
/// exclusions (document-level byte offsets). The exclusion is extended to
/// cover surrounding whitespace/newlines so that the grammar checker sees
/// flat spaces instead of newlines that could trigger false capitalization
/// warnings.
fn collect_display_math_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && bytes[i + 1] == b'[' {
            // Extend backwards to include leading whitespace/newlines
            let mut exc_start = i;
            while exc_start > 0 && bytes[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }

            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'\\' && bytes[i + 1] == b']') {
                i += 1;
            }
            if i + 1 < bytes.len() {
                i += 2; // skip \]
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

/// Strip LaTeX noise from a gap string: math (`$...$`, `\(...\)`, `\[...\]`)
/// and command names (`\textbf`, `\ref`, etc.). Display math content is
/// excluded from the prose text via `ProseRange.exclusions`, so stripping
/// it here is safe. Leaves braces, whitespace, and punctuation intact for
/// subsequent validation.
fn strip_latex_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' {
            i += 1;
            while i < chars.len() && chars[i] != '$' {
                i += 1;
            }
            i += 1;
            result.push(' ');
        } else if chars[i] == '\\'
            && i + 1 < chars.len()
            && (chars[i + 1] == '[' || chars[i + 1] == '(')
        {
            // Replace math with a space to avoid creating false paragraph
            // breaks (display math between newlines: \n\[...\]\n → \n \n).
            // Display math content is excluded via ProseRange.exclusions.
            let close = if chars[i + 1] == '[' { ']' } else { ')' };
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '\\' && chars[i + 1] == close) {
                i += 1;
            }
            if i + 1 < chars.len() {
                i += 2;
            }
            result.push(' ');
        } else if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
            let cmd_start = i + 1;
            let mut j = cmd_start;
            while j < chars.len() && chars[j].is_ascii_alphabetic() {
                j += 1;
            }
            let cmd: String = chars[cmd_start..j].iter().collect();

            // Block commands should NOT be bridged — leave them to fail validation.
            if matches!(
                cmd.as_str(),
                "begin"
                    | "end"
                    | "item"
                    | "par"
                    | "section"
                    | "subsection"
                    | "subsubsection"
                    | "paragraph"
                    | "chapter"
                    | "part"
            ) {
                result.push(chars[i]);
                i += 1;
                continue;
            }

            i = j;
            if i < chars.len() && chars[i] == '*' {
                i += 1;
            }
            // Skip command arguments: {content} and [content]
            while i < chars.len() && (chars[i] == '{' || chars[i] == '[') {
                let open = chars[i];
                let close = if open == '{' { '}' } else { ']' };
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
        } else if chars[i] == '\\' {
            i += 1;
            if i < chars.len() {
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}
