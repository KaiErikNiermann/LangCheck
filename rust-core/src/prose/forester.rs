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

/// Block-level commands that contain prose but create scope boundaries.
/// Text across these boundaries is never merged into a single sentence.
const BLOCK_COMMANDS: &[&str] = &[
    "\\p",
    "\\li",
    "\\ol",
    "\\ul",
    "\\title",
    "\\blockquote",
    "\\figure",
    "\\figcaption",
    "\\scope",
    "\\subtree",
];

/// Inline commands whose content bridges with surrounding prose.
const INLINE_COMMANDS: &[&str] = &["\\em", "\\strong", "\\code"];

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
/// Uses scoped collection: block-level commands (\p, \li, \ol, etc.) create
/// prose scope boundaries that prevent sentence merging across them. Inline
/// commands (\em, \strong) bridge with surrounding text. Unknown macros are
/// skipped by default. Math (#{}, ##{}), verbatim, comments, and wiki links
/// are always excluded.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut scopes: Vec<Vec<(usize, usize)>> = vec![vec![]];
    collect_prose_nodes(root, text, &mut scopes);

    scopes
        .iter()
        .filter(|s| !s.is_empty())
        .flat_map(|scope| {
            shared::merge_ranges(scope, text, strip_forester_noise, collect_math_exclusions)
        })
        .collect()
}

/// Get the command name string from a command node.
fn get_command_name<'a>(node: Node, text: &'a str) -> Option<&'a str> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "command_name" {
            return Some(&text[child.start_byte()..child.end_byte()]);
        }
    }
    None
}

/// Recursively collect prose leaf nodes into scoped segments.
///
/// Block-level commands push new segments to prevent cross-boundary merging.
/// Inline commands recurse normally so their content bridges. Unknown macros
/// are skipped entirely (not checked by default).
fn collect_prose_nodes(node: Node, text: &str, scopes: &mut Vec<Vec<(usize, usize)>>) {
    let kind = node.kind();

    // Skip entire subtrees for non-prose node kinds
    if SKIP_KINDS.contains(&kind) {
        return;
    }

    if kind == "command" {
        let cmd_name = get_command_name(node, text);

        // Structural commands: skip all arguments
        if cmd_name.is_some_and(|n| STRUCTURAL_COMMANDS.contains(&n)) {
            return;
        }

        // Block-level commands: create scope boundaries
        if cmd_name.is_some_and(|n| BLOCK_COMMANDS.contains(&n)) {
            scopes.push(vec![]);
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                collect_prose_nodes(child, text, scopes);
            }
            // New scope after so subsequent siblings don't merge with this block
            scopes.push(vec![]);
            return;
        }

        // Inline commands: recurse normally (bridges with surrounding text)
        if cmd_name.is_some_and(|n| INLINE_COMMANDS.contains(&n)) {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                collect_prose_nodes(child, text, scopes);
            }
            return;
        }

        // Unknown command/macro: skip by default (macros are predominantly
        // non-prose; users can opt in via comment directives in the future)
        return;
    }

    // Leaf prose nodes
    if kind == "text" || kind == "escape" {
        let start = node.start_byte();
        let end = node.end_byte();
        if start < end {
            if let Some(scope) = scopes.last_mut() {
                scope.push((start, end));
            }
        }
        return;
    }

    // Recurse into all other nodes (groups, source_file, etc.)
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose_nodes(child, text, scopes);
    }
}

/// Find inline math (`#{...}`) and display math (`##{...}`) regions in a gap
/// and record them as exclusions. Extends exclusions to cover surrounding
/// whitespace so the grammar checker sees clean boundaries.
fn collect_math_exclusions(gap: &str, gap_offset: usize, out: &mut Vec<(usize, usize)>) {
    let bytes = gap.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // Display math: ##{...}
        let is_display =
            i + 2 < bytes.len() && bytes[i] == b'#' && bytes[i + 1] == b'#' && bytes[i + 2] == b'{';
        // Inline math: #{...} (but not ##{)
        let is_inline =
            !is_display && i + 1 < bytes.len() && bytes[i] == b'#' && bytes[i + 1] == b'{';

        if is_display || is_inline {
            // Extend backwards to include leading whitespace
            let mut exc_start = i;
            while exc_start > 0 && bytes[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }

            // Skip past the opener
            i += if is_display { 3 } else { 2 };
            let mut depth = 1;
            while i < bytes.len() && depth > 0 {
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                }
                i += 1;
            }

            // Extend forwards to include trailing whitespace
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
/// Leaves whitespace, braces, and punctuation for bridge analysis.
fn strip_forester_noise(gap: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = gap.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        // Display math: ##{...}
        if chars[i] == '#' && i + 2 < chars.len() && chars[i + 1] == '#' && chars[i + 2] == '{' {
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
        } else if chars[i] == '\\' && i + 1 < chars.len() && chars[i + 1].is_ascii_alphanumeric() {
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

#[cfg(test)]
mod tests {
    use crate::prose::ProseExtractor;
    use anyhow::Result;

    fn forester_extractor() -> Result<ProseExtractor> {
        let language: tree_sitter::Language = crate::forester_ts::LANGUAGE.into();
        ProseExtractor::new(language)
    }

    #[test]
    fn test_forester_basic_extraction() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\title{Hello World}
\p{This is a paragraph.}
";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("Hello World")),
            "Should extract title text, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("This is a paragraph")),
            "Should extract paragraph text, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_math_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Display math between paragraphs (separated by blank line) should
        // not appear in prose ranges.
        let text = "\\p{Text before math.}\n\n##{\\int_0^1 f(x) \\, dx}\n\n\\p{Text after math.}\n";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("Text before math")),
            "Should extract text before math, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Text after math")),
            "Should extract text after math, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("\\int")),
            "Should NOT extract display math content, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_structural_commands_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\import{trees/basics}
\ref{tree-0001}
\p{Some actual prose.}
";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("trees/basics")),
            "Should NOT extract import path, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("tree-0001")),
            "Should NOT extract ref target, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("actual prose")),
            "Should extract prose text, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_verbatim_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = "\\p{Before code.}\n```\nfn main() {}\n```\n\\p{After code.}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("fn main")),
            "Should NOT extract verbatim content, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Before code")),
            "Should extract text before verbatim, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("After code")),
            "Should extract text after verbatim, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_inline_commands_bridge() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{This has \em{emphasized} words in it.}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("This has")
                && t.contains("emphasized")
                && t.contains("words in it")),
            "Sentence with inline command should bridge into single chunk, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_display_math_exclusion() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{We know that
##{
  x^2 + y^2 = z^2
}
which proves our claim.}";
        let ranges = extractor.extract(text, "forester")?;

        // Should bridge across display math
        let bridged = ranges.iter().find(|r| {
            let raw = &text[r.start_byte..r.end_byte];
            raw.contains("know that") && raw.contains("proves our claim")
        });
        assert!(
            bridged.is_some(),
            "Should bridge across display math, got: {:?}",
            ranges
                .iter()
                .map(|r| &text[r.start_byte..r.end_byte])
                .collect::<Vec<_>>()
        );

        let range = bridged.unwrap();
        assert!(
            !range.exclusions.is_empty(),
            "Should have exclusions for display math"
        );

        let clean_text = range.extract_text(text);
        assert!(
            !clean_text.contains("x^2"),
            "extract_text should not contain math content, got: {:?}",
            clean_text
        );
        assert!(
            clean_text.contains("know that"),
            "extract_text should still contain prose, got: {:?}",
            clean_text
        );

        Ok(())
    }

    #[test]
    fn test_forester_list_items_separate_scopes() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\ol{\li{Item one}\li{Item two}\li{Item three}}";
        let ranges = extractor.extract(text, "forester")?;

        // Each \li should be a separate prose range — never merged into one sentence
        assert!(
            ranges.len() >= 3,
            "Each list item should be a separate prose range, got {} ranges: {:?}",
            ranges.len(),
            ranges
                .iter()
                .map(|r| &text[r.start_byte..r.end_byte])
                .collect::<Vec<_>>()
        );
        // No single range should span across list items
        assert!(
            !ranges.iter().any(|r| {
                let t = &text[r.start_byte..r.end_byte];
                t.contains("one") && t.contains("two")
            }),
            "List items should not merge into a single range"
        );

        Ok(())
    }

    #[test]
    fn test_forester_inline_math_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{The value #{x + y} is positive.}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("The value")),
            "Should extract prose around inline math, got: {extracted:?}"
        );

        // The range that contains the math should have an exclusion for it
        let range_with_math = ranges.iter().find(|r| {
            let raw = &text[r.start_byte..r.end_byte];
            raw.contains("value") && raw.contains("positive")
        });
        if let Some(range) = range_with_math {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("x + y"),
                "Inline math should be excluded from clean text, got: {:?}",
                clean
            );
        }

        Ok(())
    }

    #[test]
    fn test_forester_block_math_multiline_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Block math with real newlines inside \p — tree-sitter parses ##{...}
        // as display_math which is in SKIP_KINDS, so it should be excluded.
        let text = "\\p{Consider the equation\n##{  x^2 + y^2 = z^2 }\nwhich is well known.}";
        let ranges = extractor.extract(text, "forester")?;

        // The math content should not appear in extracted prose
        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("x^2"),
                "Block math content should not appear in clean prose, got: {:?}",
                clean
            );
        }

        // Surrounding prose should still be extracted
        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("Consider the equation"),
            "Prose before block math should be extracted, got: {:?}",
            all_text
        );
        assert!(
            all_text.contains("well known"),
            "Prose after block math should be extracted, got: {:?}",
            all_text
        );

        Ok(())
    }

    #[test]
    fn test_forester_unknown_macros_skipped() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{Real prose here.}
\mymacro{macro content}
\anothermacro[opt]{more content}
\p{More real prose.}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("macro content")),
            "Unknown macro content should NOT be checked, got: {extracted:?}"
        );
        assert!(
            !extracted.iter().any(|t| t.contains("more content")),
            "Unknown macro with args should NOT be checked, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Real prose")),
            "Known commands should still extract prose, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("More real prose")),
            "Known commands should still extract prose, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_nested_blocks_separate_scopes() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // A title and paragraph inside a subtree should be separate scopes
        let text = r"\subtree{
\title{My Section}
\p{First paragraph.}
\p{Second paragraph.}
}";
        let ranges = extractor.extract(text, "forester")?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted.iter().any(|t| t.contains("My Section")),
            "Title inside subtree should be extracted, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("First paragraph")),
            "Paragraph inside subtree should be extracted, got: {extracted:?}"
        );
        // Title and paragraphs should not merge into one range
        assert!(
            !ranges.iter().any(|r| {
                let t = &text[r.start_byte..r.end_byte];
                t.contains("My Section") && t.contains("First paragraph")
            }),
            "Title and paragraph should be separate scopes"
        );

        Ok(())
    }
}
