use tree_sitter::Node;

use super::{ProseRange, gap, shared};

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

/// Extract prose ranges from a `TinyLang` AST.
///
/// Walks the tree collecting `text` leaf nodes, skipping math, code, comments,
/// and structural command arguments. Adjacent text nodes are merged into
/// sentence-level prose chunks with gap analysis.
pub fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut word_ranges: Vec<(usize, usize)> = Vec::new();
    collect_prose_nodes(root, text, false, &mut word_ranges);
    shared::merge_ranges(&word_ranges, text, tinylang_gap)
}

/// Check whether a command node is structural (non-prose arguments).
fn is_structural_command(node: Node, text: &str) -> bool {
    shared::child_of_kind(node, "command_name")
        .is_some_and(|name| STRUCTURAL_COMMANDS.contains(&&text[name.byte_range()]))
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

/// `TinyLang` gap syntax: math, code spans, commands, comments and the inline
/// emphasis markers.
///
/// Arm order is load-bearing — `$$` before `$`, and `//` before the bare
/// markers.
fn tinylang_gap(b: &[u8], i: usize) -> Option<gap::Match> {
    use gap::Token::{Elided, Separator};
    Some(match b[i..] {
        // Display math: $$...$$
        [b'$', b'$', ..] => gap::Match::at(Separator, i, shared::close_at(b, i + 2, b"$$", None)),
        // Inline math: $...$ — a newline ends it, so an unpaired `$` in prose
        // cannot swallow the rest of the gap.
        [b'$', ..] => gap::Match::at(Separator, i, delimited_end(b, i + 1, b'$', |c| c == b'\n')),
        // Code span: `...`
        [b'`', ..] => gap::Match::at(Separator, i, shared::close_at(b, i + 1, b"`", None)),
        // Command: @name{args}
        [b'@', first, ..] if first.is_ascii_alphabetic() => {
            let name_end = shared::run_end(b, i + 1, |c| {
                c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')
            });
            let end = if b.get(name_end) == Some(&b'{') {
                shared::skip_balanced_bytes(b, name_end + 1, b'{', b'}', None)
            } else {
                name_end
            };
            gap::Match::at(Elided, i, end)
        }
        // Comment: // to the end of the line. Eliding it leaves the newlines on
        // either side adjacent, so a comment on its own line reveals the
        // paragraph break it was hiding.
        [b'/', b'/', ..] => gap::Match::at(Elided, i, shared::run_end(b, i, |c| c != b'\n')),
        // Emphasis and heading markers carry no text of their own.
        [b'*' | b'_' | b'#', ..] => gap::Match::at(Elided, i, i + 1),
        _ => return None,
    })
}

/// End of a run closed by `delimiter`, abandoned at the first byte matching
/// `breaks` — a delimiter the run may not cross.
fn delimited_end(b: &[u8], from: usize, delimiter: u8, breaks: impl Fn(u8) -> bool) -> usize {
    let end = shared::run_end(b, from, |c| c != delimiter && !breaks(c));
    if b.get(end) == Some(&delimiter) {
        end + 1
    } else {
        end
    }
}

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use crate::prose::latex::LatexExtras;
    use anyhow::Result;

    #[test]
    fn test_tinylang_basic_extraction() -> Result<()> {
        let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "This is a simple sentence.\n";
        let ranges = extractor.extract(text, "tinylang", &LatexExtras::default())?;
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
        let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "Before code.\n\n~~~\nfn main() {}\n~~~\n\nAfter code.\n";
        let ranges = extractor.extract(text, "tinylang", &LatexExtras::default())?;
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
        let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "@author{Jane Doe}\n@date{2025-01-01}\n\nSome prose text here.\n";
        let ranges = extractor.extract(text, "tinylang", &LatexExtras::default())?;
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
        let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "The formula $E = mc^2$ is famous.\n";
        let ranges = extractor.extract(text, "tinylang", &LatexExtras::default())?;
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
        let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "Visible text.\n// This is a comment\nMore text.\n";
        let ranges = extractor.extract(text, "tinylang", &LatexExtras::default())?;
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
        let language: tree_sitter::Language = crate::grammars::TINYLANG.into();
        let mut extractor = ProseExtractor::new(language)?;
        let text = "@title{My Great Document}\n\nSome text.\n";
        let ranges = extractor.extract(text, "tinylang", &LatexExtras::default())?;
        let all_prose: String = ranges.iter().map(|r| r.extract_text(text)).collect();
        assert!(
            all_prose.contains("Great Document"),
            "Prose command args should be extracted, got: {:?}",
            all_prose
        );
        Ok(())
    }
}
