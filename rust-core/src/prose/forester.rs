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
/// recursed into so nested known blocks are still extracted. Math (#{}, ##{})
/// is excluded both via tree-sitter nodes and a text-based safety-net scanner.
/// Verbatim, comments, and wiki links are always excluded.
pub(crate) fn extract(text: &str, root: Node) -> Vec<ProseRange> {
    let mut scopes: Vec<Vec<(usize, usize)>> = vec![vec![]];
    let mut skips: Vec<(usize, usize)> = Vec::new();
    collect_prose_nodes(root, text, &mut scopes, &mut skips, false);

    // Safety net: text-based math scanner catches regions where tree-sitter
    // truncated display_math/inline_math at escaped braces.
    skips.extend(find_math_regions(text));

    let mut result: Vec<ProseRange> = scopes
        .iter()
        .filter(|s| !s.is_empty())
        .flat_map(|scope| {
            shared::merge_ranges(
                scope,
                text,
                strip_forester_noise,
                collect_forester_exclusions,
            )
        })
        .collect();

    install_skip_exclusions(&mut result, &skips, text.as_bytes());
    result
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
/// recurse into children (so nested `\p`/`\li` are found) but don't enable
/// text collection — only known prose commands set `in_prose` to true.
fn collect_prose_nodes(
    node: Node,
    text: &str,
    scopes: &mut Vec<Vec<(usize, usize)>>,
    skips: &mut Vec<(usize, usize)>,
    in_prose: bool,
) {
    let kind = node.kind();

    // Skip entire subtrees for non-prose node kinds
    if SKIP_KINDS.contains(&kind) {
        skips.push((node.start_byte(), node.end_byte()));
        return;
    }

    if kind == "command" {
        let cmd_name = get_command_name(node, text);

        // Structural commands: skip all arguments
        if cmd_name.is_some_and(|n| STRUCTURAL_COMMANDS.contains(&n)) {
            return;
        }

        // Block-level commands: create scope boundaries, enable prose collection
        if cmd_name.is_some_and(|n| BLOCK_COMMANDS.contains(&n)) {
            scopes.push(vec![]);
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                collect_prose_nodes(child, text, scopes, skips, true);
            }
            // New scope after so subsequent siblings don't merge with this block
            scopes.push(vec![]);
            return;
        }

        // Inline commands: recurse normally (bridges with surrounding text)
        if cmd_name.is_some_and(|n| INLINE_COMMANDS.contains(&n)) {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                collect_prose_nodes(child, text, scopes, skips, true);
            }
            return;
        }

        // Unknown command/macro: recurse into children so nested known
        // blocks (\p, \li, etc.) still create their own scope boundaries.
        // Text collection stays OFF — only known commands enable it.
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            collect_prose_nodes(child, text, scopes, skips, false);
        }
        return;
    }

    // Leaf prose nodes (only when inside a known prose command)
    if kind == "text" && in_prose {
        let start = node.start_byte();
        let end = node.end_byte();
        if start < end {
            if let Some(scope) = scopes.last_mut() {
                scope.push((start, end));
            }
        }
        return;
    }

    // source_file: collect text (handles orphaned nodes from AST truncation).
    // find_math_regions will exclude any leaked math content.
    // Other nodes (brace_group, paren_group, etc.): preserve current context.
    let child_prose = in_prose || kind == "source_file";
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_prose_nodes(child, text, scopes, skips, child_prose);
    }
}

/// Install skip-node byte ranges as exclusions on merged prose ranges.
///
/// For each `ProseRange`, finds all skip ranges that overlap `[start_byte, end_byte)`,
/// extends each to cover surrounding whitespace (so the checker sees clean boundaries),
/// and adds them as exclusions.
fn install_skip_exclusions(ranges: &mut [ProseRange], skips: &[(usize, usize)], text: &[u8]) {
    for range in ranges.iter_mut() {
        for &(skip_start, skip_end) in skips {
            // Skip range must overlap the prose range
            if skip_end <= range.start_byte || skip_start >= range.end_byte {
                continue;
            }

            // Clamp to the prose range boundaries
            let mut exc_start = skip_start.max(range.start_byte);
            let mut exc_end = skip_end.min(range.end_byte);

            // Extend backwards to include leading whitespace
            while exc_start > range.start_byte && text[exc_start - 1].is_ascii_whitespace() {
                exc_start -= 1;
            }

            // Extend forwards to include trailing whitespace
            while exc_end < range.end_byte && text[exc_end].is_ascii_whitespace() {
                exc_end += 1;
            }

            range.exclusions.push((exc_start, exc_end));
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

/// Collect exclusion regions from a gap string between prose text nodes.
///
/// Works on bytes directly — Forester markup delimiters (`#`, `{`, `}`, `\`,
/// `%`) are all single-byte ASCII. Called by `merge_ranges` for each bridgeable
/// gap so that commands, math, escapes, and comments become exclusions.
fn collect_forester_exclusions(gap: &str, offset: usize, exclusions: &mut Vec<(usize, usize)>) {
    let b = gap.as_bytes();
    let len = b.len();
    let mut i = 0;
    while i < len {
        let start = i;
        if b[i] == b'#' && i + 2 < len && b[i + 1] == b'#' && b[i + 2] == b'{' {
            i = skip_braces(b, i + 3); // display math
            exclusions.push((offset + start, offset + i));
        } else if b[i] == b'#' && i + 1 < len && b[i + 1] == b'{' {
            i = skip_braces(b, i + 2); // inline math
            exclusions.push((offset + start, offset + i));
        } else if b[i] == b'\\' && i + 1 < len && b[i + 1].is_ascii_alphanumeric() {
            i = skip_command_with_args(b, i); // \name{...}[...](...)
            exclusions.push((offset + start, offset + i));
        } else if b[i] == b'\\' && i + 1 < len {
            i += 2; // escape \X
            exclusions.push((offset + start, offset + i));
        } else if b[i] == b'%' {
            while i < len && b[i] != b'\n' {
                i += 1;
            }
            exclusions.push((offset + start, offset + i));
        } else {
            i += 1;
        }
    }
}

/// Skip balanced braces starting after the opening `{`. Returns position after closing `}`.
fn skip_braces(b: &[u8], mut i: usize) -> usize {
    let mut depth: u32 = 1;
    while i < b.len() && depth > 0 {
        if b[i] == b'\\' && i + 1 < b.len() {
            i += 2;
            continue;
        }
        if b[i] == b'{' {
            depth += 1;
        } else if b[i] == b'}' {
            depth -= 1;
        }
        i += 1;
    }
    i
}

/// Skip a `\name` command and its optional brace/bracket/paren arguments.
fn skip_command_with_args(b: &[u8], mut i: usize) -> usize {
    i += 1; // skip backslash
    while i < b.len()
        && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'-' | b'/' | b'?' | b'*'))
    {
        i += 1;
    }
    while i < b.len() && matches!(b[i], b'{' | b'[' | b'(') {
        let (open, close) = match b[i] {
            b'{' => (b'{', b'}'),
            b'[' => (b'[', b']'),
            b'(' => (b'(', b')'),
            _ => unreachable!(),
        };
        let mut depth: u32 = 1;
        i += 1;
        while i < b.len() && depth > 0 {
            if b[i] == open {
                depth += 1;
            } else if b[i] == close {
                depth -= 1;
            }
            i += 1;
        }
    }
    i
}

/// Scan raw text for `#{...}` and `##{...}` math regions using escape-aware
/// brace counting. Returns byte ranges covering each math region (including
/// the `#` / `##` prefix and the outermost braces).
///
/// This provides a safety net for cases where tree-sitter truncates math nodes
/// at escaped braces (`\{`, `\}`).
fn find_math_regions(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut regions = Vec::new();
    let mut i = 0;

    while i < len {
        // Skip % comments (to end of line)
        if bytes[i] == b'%' {
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        // Skip escape sequences: \X consumes 2 bytes (prevents \# from
        // triggering math detection)
        if bytes[i] == b'\\' && i + 1 < len {
            i += 2;
            continue;
        }

        // Display math: ##{...}
        if bytes[i] == b'#' && i + 2 < len && bytes[i + 1] == b'#' && bytes[i + 2] == b'{' {
            let start = i;
            i += 3; // skip ##{
            let mut depth: u32 = 1;
            while i < len && depth > 0 {
                if bytes[i] == b'\\' && i + 1 < len {
                    i += 2; // skip escape inside math
                    continue;
                }
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                }
                i += 1;
            }
            regions.push((start, i));
            continue;
        }

        // Inline math: #{...}
        if bytes[i] == b'#' && i + 1 < len && bytes[i + 1] == b'{' {
            let start = i;
            i += 2; // skip #{
            let mut depth: u32 = 1;
            while i < len && depth > 0 {
                if bytes[i] == b'\\' && i + 1 < len {
                    i += 2; // skip escape inside math
                    continue;
                }
                if bytes[i] == b'{' {
                    depth += 1;
                } else if bytes[i] == b'}' {
                    depth -= 1;
                }
                i += 1;
            }
            regions.push((start, i));
            continue;
        }

        i += 1;
    }

    regions
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
        let ranges = extractor.extract(text, "forester", &[])?;
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
        let ranges = extractor.extract(text, "forester", &[])?;
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
        let ranges = extractor.extract(text, "forester", &[])?;
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
        let ranges = extractor.extract(text, "forester", &[])?;
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
        let ranges = extractor.extract(text, "forester", &[])?;
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
        let ranges = extractor.extract(text, "forester", &[])?;

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
        let ranges = extractor.extract(text, "forester", &[])?;

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
        let ranges = extractor.extract(text, "forester", &[])?;
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
        let ranges = extractor.extract(text, "forester", &[])?;

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
    fn test_forester_unknown_macros_recurse() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Unknown macros now recurse into children, so nested \p is extracted
        let text = r"\solution{
  \p{Prose inside unknown wrapper.}
}";
        let ranges = extractor.extract(text, "forester", &[])?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted
                .iter()
                .any(|t| t.contains("Prose inside unknown wrapper")),
            "Nested \\p inside unknown macro should be extracted, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_unknown_macros_plain_text_skipped() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Plain text inside unknown macros is NOT collected — only text
        // inside known prose commands (\p, \li, etc.) is prose.
        let text = r"\p{Real prose here.}
\mymacro{macro content}
\p{More real prose.}";
        let ranges = extractor.extract(text, "forester", &[])?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            !extracted.iter().any(|t| t.contains("macro content")),
            "Text inside unknown macro should NOT be extracted, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Real prose")),
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
        let ranges = extractor.extract(text, "forester", &[])?;
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

    #[test]
    fn test_forester_display_math_align_inside_li() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Real-world pattern: display math with \begin{align*} inside \li.
        // The braces inside the math used to confuse the old brace-counting
        // exclusion collector, leaking LaTeX commands into prose.
        let text = r"\ol{\li{We have the equation
##{
  \begin{align*}
    \mathcal{C} &\vDash \forall x.\, \varphi(x) \\
    &\Rightarrow \psi
  \end{align*}
}
which completes the proof.}}";
        let ranges = extractor.extract(text, "forester", &[])?;

        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("\\mathcal"),
                "LaTeX \\mathcal should not leak into prose, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\vDash"),
                "LaTeX \\vDash should not leak into prose, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\forall"),
                "LaTeX \\forall should not leak into prose, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\begin"),
                "LaTeX \\begin should not leak into prose, got: {clean:?}"
            );
        }

        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("We have the equation"),
            "Prose before display math should be extracted, got: {all_text:?}"
        );
        assert!(
            all_text.contains("completes the proof"),
            "Prose after display math should be extracted, got: {all_text:?}"
        );

        Ok(())
    }

    #[test]
    fn test_forester_em_command_name_not_leaked() -> Result<()> {
        let mut extractor = forester_extractor()?;

        let text = r"\p{This has \em{emphasized} words.}";
        let ranges = extractor.extract(text, "forester", &[])?;

        let range = ranges
            .iter()
            .find(|r| {
                let t = &text[r.start_byte..r.end_byte];
                t.contains("emphasized")
            })
            .expect("Should find range containing 'emphasized'");

        let clean = range.extract_text(text);
        assert!(
            !clean.contains("\\em"),
            "Command name \\em should not appear in clean text, got: {clean:?}"
        );
        assert!(
            clean.contains("emphasized"),
            "Word 'emphasized' should be in clean text, got: {clean:?}"
        );
        assert!(
            clean.contains("This has"),
            "Surrounding prose should be in clean text, got: {clean:?}"
        );

        Ok(())
    }

    #[test]
    fn test_unknown_inline_macro_excluded() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Unknown inline macros like \cf{...} should be excluded from prose
        // (their content is not checked) while surrounding prose bridges.
        let text = r"\li{The carrier \cf{Fin A.n} is important.}";
        let ranges = extractor.extract(text, "forester", &[])?;

        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("Fin"),
                "\\cf content should be excluded, got: {clean:?}"
            );
        }

        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("The carrier"),
            "Prose before \\cf, got: {all_text:?}"
        );
        assert!(
            all_text.contains("is important"),
            "Prose after \\cf, got: {all_text:?}"
        );

        Ok(())
    }

    #[test]
    fn test_display_math_escaped_braces_top_level() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Display math with \{...\} at top level between \p blocks.
        // Tree-sitter truncates display_math at escaped braces; the text-based
        // scanner should catch the leaked content.
        let text = r"\p{Consider the structure:}
##{
  U = \{A, B\} \quad I = \{\texttt{taller} \mapsto \{\langle A, B\rangle\}\}
}
\p{Is it a model?}";
        let ranges = extractor.extract(text, "forester", &[])?;

        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("\\texttt"),
                "\\texttt should not leak into prose, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\mapsto"),
                "\\mapsto should not leak into prose, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\langle"),
                "\\langle should not leak into prose, got: {clean:?}"
            );
        }

        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("Consider the structure"),
            "Prose before math should be extracted, got: {all_text:?}"
        );
        assert!(
            all_text.contains("Is it a model"),
            "Prose after math should be extracted, got: {all_text:?}"
        );

        Ok(())
    }

    #[test]
    fn test_display_math_align_top_level() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Display math with \begin{align*} at top level
        let text = r"\p{Define the interpretation:}
##{
  \begin{align*}
  I &= \{a \mapsto \alpha\} \\
  I &= \{f(\alpha) \mapsto \beta\}
  \end{align*}
}
\p{Evaluate the terms.}";
        let ranges = extractor.extract(text, "forester", &[])?;

        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("\\begin"),
                "\\begin should not leak, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\end"),
                "\\end should not leak, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\mapsto"),
                "\\mapsto should not leak, got: {clean:?}"
            );
        }

        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("Define the interpretation"),
            "Got: {all_text:?}"
        );
        assert!(all_text.contains("Evaluate the terms"), "Got: {all_text:?}");

        Ok(())
    }

    #[test]
    fn test_display_math_escaped_braces_inside_li() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Display math with \{...\} inside \li — the hardest case because
        // tree-sitter's brace_group interacts with display_math.
        let text = r"\li{
    If we change the interpretation to
    ##{
      I = \{\texttt{taller} \mapsto \{\langle A, B\rangle\}\}
    }
    is the structure now a model?
  }";
        let ranges = extractor.extract(text, "forester", &[])?;

        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("\\texttt"),
                "\\texttt should not leak, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\mapsto"),
                "\\mapsto should not leak, got: {clean:?}"
            );
        }

        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("change the interpretation"),
            "Prose before math in \\li, got: {all_text:?}"
        );
        assert!(
            all_text.contains("is the structure now a model"),
            "Prose after math in \\li, got: {all_text:?}"
        );

        Ok(())
    }

    #[test]
    fn test_unknown_macro_wrapping_blocks() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // \solution is not in any command list — should recurse into children
        let text = r"\solution{
  \p{As a reminder we are working with the axiom.}
  \ol{
    \li{First item.}
    \li{Second item.}
  }
}";
        let ranges = extractor.extract(text, "forester", &[])?;
        let extracted: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        assert!(
            extracted
                .iter()
                .any(|t| t.contains("working with the axiom")),
            "\\p inside \\solution should be extracted, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("First item")),
            "\\li inside \\solution should be extracted, got: {extracted:?}"
        );
        assert!(
            extracted.iter().any(|t| t.contains("Second item")),
            "\\li inside \\solution should be extracted, got: {extracted:?}"
        );

        Ok(())
    }

    #[test]
    fn test_multiple_inline_math_in_li() -> Result<()> {
        let mut extractor = forester_extractor()?;

        // Multiple inline math expressions in a single \li — all should be excluded
        let text = r"\li{#{p(a)} evaluates to #{\top} because #{a = \alpha}.}";
        let ranges = extractor.extract(text, "forester", &[])?;

        for range in &ranges {
            let clean = range.extract_text(text);
            assert!(
                !clean.contains("p(a)"),
                "Inline math p(a) should be excluded, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\top"),
                "Inline math \\top should be excluded, got: {clean:?}"
            );
            assert!(
                !clean.contains("\\alpha"),
                "Inline math \\alpha should be excluded, got: {clean:?}"
            );
        }

        let all_text: String = ranges
            .iter()
            .map(|r| r.extract_text(text))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            all_text.contains("evaluates to"),
            "Prose between math should be extracted, got: {all_text:?}"
        );
        assert!(
            all_text.contains("because"),
            "Prose between math should be extracted, got: {all_text:?}"
        );

        Ok(())
    }

}
