use tree_sitter::Node;

use super::{ProseRange, shared};

/// BibTeX fields whose values contain human-readable prose worth checking.
const PROSE_FIELDS: &[&str] = &[
    "title",
    "booktitle",
    "abstract",
    "note",
    "annote",
    "annotation",
    "howpublished",
    "series",
];

/// Extract prose ranges from a BibTeX AST.
///
/// Walks the tree collecting text from `brace_word` and `quote_word` leaf
/// nodes inside specific prose-bearing fields (title, abstract, note, etc.).
/// Words are merged into prose chunks using the shared gap analysis.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut ranges = Vec::new();
    let mut cursor = root.walk();

    for child in root.children(&mut cursor) {
        if child.kind() == "entry" {
            collect_entry_fields(child, text, &mut ranges);
        }
    }

    ranges
}

/// Collect prose-bearing fields from a single BibTeX entry.
fn collect_entry_fields(entry: Node, text: &str, out: &mut Vec<ProseRange>) {
    let mut cursor = entry.walk();
    for child in entry.children(&mut cursor) {
        if child.kind() != "field" {
            continue;
        }

        let field_name = match child.child_by_field_name("name") {
            Some(n) => &text[n.start_byte()..n.end_byte()],
            None => continue,
        };

        if !PROSE_FIELDS.iter().any(|f| f.eq_ignore_ascii_case(field_name)) {
            continue;
        }

        let value_node = match child.child_by_field_name("value") {
            Some(v) => v,
            None => continue,
        };

        // Collect all word-level leaf nodes inside the value
        let mut words: Vec<(usize, usize)> = Vec::new();
        collect_words(value_node, &mut words);

        if words.is_empty() {
            continue;
        }

        let mut merged = shared::merge_ranges(
            &words,
            text,
            strip_bibtex_noise,
            collect_command_exclusions,
        );
        out.append(&mut merged);
    }
}

/// Recursively collect `brace_word` and `quote_word` leaf nodes,
/// skipping `command_name` nodes (but including command argument text).
fn collect_words(node: Node, out: &mut Vec<(usize, usize)>) {
    let kind = node.kind();

    if kind == "command_name" {
        return;
    }

    if kind == "brace_word" || kind == "quote_word" {
        let start = node.start_byte();
        let end = node.end_byte();
        if start < end {
            out.push((start, end));
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_words(child, out);
    }
}

/// Strip LaTeX command names (e.g. `\emph`) and braces from gaps between
/// words so the gap is bridgeable. Replaces commands with a space to
/// avoid creating false paragraph breaks.
fn strip_bibtex_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
            // Skip \commandname, replace with space
            i += 1;
            while i < chars.len() && chars[i].is_ascii_alphabetic() {
                i += 1;
            }
            result.push(' ');
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

/// Find LaTeX command names (`\emph`, `\textbf`, etc.) in gaps and record
/// them as exclusion zones so the grammar checker doesn't see them.
fn collect_command_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() && bytes[i + 1].is_ascii_alphabetic() {
            let start = i;
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            out.push((gap_offset + start, gap_offset + i));
        } else {
            i += 1;
        }
    }
}
