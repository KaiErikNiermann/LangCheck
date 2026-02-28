use tree_sitter::Node;

use super::{ProseRange, shared};

/// Commands whose arguments contain identifiers/metadata, not prose.
const STRUCTURAL_COMMANDS: &[&str] = &[
    "@author", "@date", "@import", "@ref", "@tag", "@id", "@class",
];

/// Node kinds that are never prose and whose subtrees should be skipped.
const SKIP_KINDS: &[&str] = &[
    "inline_math",
    "display_math",
    "code_block",
    "code_span",
    "comment",
    "command_name",
    "link_url",
];

/// Extract prose ranges from a TinyLang AST.
///
/// Walks the tree collecting `text` leaf nodes, skipping math, code, comments,
/// and structural command arguments. Adjacent text nodes are merged into
/// sentence-level prose chunks with gap analysis.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_prose_nodes(root, text, false, &mut word_ranges);
    shared::merge_ranges(
        &word_ranges,
        text,
        strip_tinylang_noise,
        collect_math_exclusions,
    )
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

/// Recursively collect prose leaf nodes (`text`), skipping non-prose subtrees.
fn collect_prose_nodes(node: Node, text: &str, skip: bool, out: &mut Vec<(usize, usize)>) {
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
    if kind == "text" {
        if !skip {
            let start = node.start_byte();
            let end = node.end_byte();
            if start < end {
                out.push((start, end));
            }
        }
        return;
    }

    // Recurse into all other nodes
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose_nodes(child, text, skip, out);
    }
}

/// Find math regions (`$...$` and `$$...$$`) in a gap and record them as exclusions.
fn collect_math_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' {
            let exc_start = i;

            if i + 1 < bytes.len() && bytes[i + 1] == b'$' {
                // Display math: $$...$$
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'$' && bytes[i + 1] == b'$') {
                    i += 1;
                }
                if i + 1 < bytes.len() {
                    i += 2;
                }
            } else {
                // Inline math: $...$
                i += 1;
                while i < bytes.len() && bytes[i] != b'$' && bytes[i] != b'\n' {
                    i += 1;
                }
                if i < bytes.len() && bytes[i] == b'$' {
                    i += 1;
                }
            }

            out.push((gap_offset + exc_start, gap_offset + i));
        } else {
            i += 1;
        }
    }
}

/// Strip TinyLang noise from a gap string: math, commands, code spans, etc.
fn strip_tinylang_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        // Display math: $$...$$
        if chars[i] == '$' && i + 1 < chars.len() && chars[i + 1] == '$' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '$' && chars[i + 1] == '$') {
                i += 1;
            }
            if i + 1 < chars.len() {
                i += 2;
            }
            result.push(' ');
        // Inline math: $...$
        } else if chars[i] == '$' {
            i += 1;
            while i < chars.len() && chars[i] != '$' {
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
            result.push(' ');
        // Code span: `...`
        } else if chars[i] == '`' {
            i += 1;
            while i < chars.len() && chars[i] != '`' {
                i += 1;
            }
            if i < chars.len() {
                i += 1;
            }
            result.push(' ');
        // Command: @name{args}
        } else if chars[i] == '@' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphabetic() {
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '-' || chars[i] == '_')
            {
                i += 1;
            }
            // Skip command argument: {content}
            if i < chars.len() && chars[i] == '{' {
                let mut depth = 1;
                i += 1;
                while i < chars.len() && depth > 0 {
                    if chars[i] == '{' {
                        depth += 1;
                    } else if chars[i] == '}' {
                        depth -= 1;
                    }
                    i += 1;
                }
            }
        // Comment: // to end of line — replace with newline so that a comment
        // on its own line reveals a paragraph break (\n + comment + \n → \n\n)
        } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            result.push('\n');
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        // Bold markers: *
        } else if chars[i] == '*' {
            i += 1;
        // Italic markers: _
        } else if chars[i] == '_' {
            i += 1;
        // Heading markers: # at start of line (after whitespace)
        } else if chars[i] == '#' {
            i += 1;
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use anyhow::Result;

    #[test]
    fn test_tinylang_basic_extraction() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "This is a simple sentence.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        assert!(!ranges.is_empty(), "Should extract prose from plain text");
        let prose = ranges[0].extract_text(text);
        assert!(
            prose.contains("simple sentence"),
            "Prose should contain 'simple sentence', got: {:?}",
            prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_code_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "Before code.\n\n~~~\nfn main() {}\n~~~\n\nAfter code.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("fn main"),
            "Code block content should not appear in prose, got: {:?}",
            all_prose
        );
        assert!(
            all_prose.contains("Before code"),
            "Prose before code should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_structural_commands_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "@author{Jane Doe}\n@date{2025-01-01}\n\nSome prose text here.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("Jane Doe"),
            "Structural command args should not be in prose, got: {:?}",
            all_prose
        );
        assert!(
            all_prose.contains("prose text here"),
            "Regular prose should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_math_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "The formula $E = mc^2$ is famous.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("mc^2"),
            "Inline math should not be in prose, got: {:?}",
            all_prose
        );
        assert!(
            all_prose.contains("formula"),
            "Prose around math should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_comment_excluded() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "Visible text.\n// This is a comment\nMore text.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            !all_prose.contains("This is a comment"),
            "Comments should not be in prose, got: {:?}",
            all_prose
        );
        Ok(())
    }

    #[test]
    fn test_tinylang_prose_command_included() -> Result<()> {
        let language: tree_sitter::Language = crate::tinylang_ts::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "@title{My Great Document}\n\nSome text.\n";
        let ranges = extractor.extract(text, "tinylang")?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("Great Document"),
            "Prose command args should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }
}
