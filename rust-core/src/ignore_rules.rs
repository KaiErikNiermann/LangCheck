use std::ops::Range;

use crate::checker::Diagnostic;

/// Type of ignore directive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectiveKind {
    /// Disable checking from this point until a matching Enable.
    Disable,
    /// Re-enable checking (closes the most recent Disable).
    Enable,
    /// Disable checking for the next non-comment line only.
    DisableNextLine,
}

/// A parsed inline ignore directive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnoreDirective {
    /// The byte offset of the line containing this directive.
    pub line_start: usize,
    /// The byte offset of the end of the line containing this directive.
    pub line_end: usize,
    /// What kind of directive this is.
    pub kind: DirectiveKind,
    /// If set, only suppress the specified rule IDs (unified or native).
    /// If empty, suppress all rules.
    pub rule_ids: Vec<String>,
}

/// A resolved byte range that should be ignored during checking.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnoreRange {
    /// Byte range to ignore.
    pub byte_range: Range<usize>,
    /// If set, only ignore diagnostics matching these rule IDs.
    pub rule_ids: Vec<String>,
}

/// Parses `lang-check-disable` / `lang-check-enable` / `lang-check-disable-next-line`
/// directives from document text and resolves them into ignore ranges.
pub struct IgnoreParser;

impl IgnoreParser {
    /// Parse all ignore directives from the given text.
    #[must_use]
    pub fn parse_directives(text: &str) -> Vec<IgnoreDirective> {
        let mut directives = Vec::new();

        for (line_start, line) in line_byte_offsets(text) {
            let line_end = line_start + line.len();

            if let Some((kind, rule_ids)) = Self::extract_directive(line) {
                directives.push(IgnoreDirective {
                    line_start,
                    line_end,
                    kind,
                    rule_ids,
                });
            }
        }

        directives
    }

    /// Resolve parsed directives into concrete byte ranges that should be ignored.
    #[must_use]
    pub fn resolve(text: &str, directives: &[IgnoreDirective]) -> Vec<IgnoreRange> {
        let mut ranges = Vec::new();

        // Track open disable directives (stack for nesting)
        let mut open_disables: Vec<&IgnoreDirective> = Vec::new();

        for directive in directives {
            match &directive.kind {
                DirectiveKind::Disable => {
                    open_disables.push(directive);
                }
                DirectiveKind::Enable => {
                    if let Some(disable) = open_disables.pop() {
                        // The ignored range starts after the disable directive line,
                        // and ends at the start of the enable directive line.
                        let start = next_line_start(text, disable.line_end);
                        ranges.push(IgnoreRange {
                            byte_range: start..directive.line_start,
                            rule_ids: disable.rule_ids.clone(),
                        });
                    }
                }
                DirectiveKind::DisableNextLine => {
                    // Find the next non-empty, non-directive line after this one
                    let start = next_line_start(text, directive.line_end);
                    if start < text.len() {
                        let end = line_end_at(text, start);
                        ranges.push(IgnoreRange {
                            byte_range: start..end,
                            rule_ids: directive.rule_ids.clone(),
                        });
                    }
                }
            }
        }

        // Any unclosed disable directives extend to EOF
        for disable in open_disables {
            let start = next_line_start(text, disable.line_end);
            if start < text.len() {
                ranges.push(IgnoreRange {
                    byte_range: start..text.len(),
                    rule_ids: disable.rule_ids.clone(),
                });
            }
        }

        ranges
    }

    /// Check whether a diagnostic should be suppressed by any of the ignore ranges.
    #[must_use]
    pub fn should_ignore(diagnostic: &Diagnostic, ranges: &[IgnoreRange]) -> bool {
        let d_start = diagnostic.start_byte as usize;

        for range in ranges {
            if range.byte_range.contains(&d_start) {
                // If no specific rules, ignore everything
                if range.rule_ids.is_empty() {
                    return true;
                }
                // Check if the diagnostic's rule matches
                if range.rule_ids.iter().any(|r| {
                    r == &diagnostic.unified_id || r == &diagnostic.rule_id
                }) {
                    return true;
                }
            }
        }

        false
    }

    /// Parse all directives and resolve to ranges in one step.
    #[must_use]
    pub fn parse(text: &str) -> Vec<IgnoreRange> {
        let directives = Self::parse_directives(text);
        Self::resolve(text, &directives)
    }

    /// Extract a directive from a single line of text.
    fn extract_directive(line: &str) -> Option<(DirectiveKind, Vec<String>)> {
        let trimmed = line.trim();

        // HTML comment: <!-- lang-check-disable [-next-line] [RULE ...] -->
        if let Some(rest) = trimmed.strip_prefix("<!--") {
            if let Some(inner) = rest.strip_suffix("-->") {
                return Self::parse_directive_content(inner.trim());
            }
        }

        // Line comment: // lang-check-disable [-next-line] [RULE ...]
        if let Some(rest) = trimmed.strip_prefix("//") {
            return Self::parse_directive_content(rest.trim());
        }

        // Block comment (single line): /* lang-check-disable [-next-line] [RULE ...] */
        if let Some(rest) = trimmed.strip_prefix("/*") {
            if let Some(inner) = rest.strip_suffix("*/") {
                return Self::parse_directive_content(inner.trim());
            }
        }

        // LaTeX comment: % lang-check-disable [-next-line] [RULE ...]
        if let Some(rest) = trimmed.strip_prefix('%') {
            return Self::parse_directive_content(rest.trim());
        }

        None
    }

    /// Parse the content after the comment markers.
    fn parse_directive_content(content: &str) -> Option<(DirectiveKind, Vec<String>)> {
        if let Some(rest) = content.strip_prefix("lang-check-disable-next-line") {
            let rule_ids = parse_rule_ids(rest);
            return Some((DirectiveKind::DisableNextLine, rule_ids));
        }

        if let Some(rest) = content.strip_prefix("lang-check-disable") {
            let rule_ids = parse_rule_ids(rest);
            return Some((DirectiveKind::Disable, rule_ids));
        }

        if content.starts_with("lang-check-enable") {
            return Some((DirectiveKind::Enable, Vec::new()));
        }

        None
    }
}

/// Parse optional rule IDs from the remainder of a directive.
fn parse_rule_ids(rest: &str) -> Vec<String> {
    rest.split_whitespace()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

/// Iterate over lines in text, yielding (byte_offset, line_content) pairs.
fn line_byte_offsets(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.split('\n').scan(0usize, |offset, line| {
        let start = *offset;
        *offset += line.len() + 1; // +1 for the newline
        Some((start, line))
    })
}

/// Return the byte offset of the start of the next line after `pos`.
fn next_line_start(text: &str, pos: usize) -> usize {
    text[pos..]
        .find('\n')
        .map_or(text.len(), |nl| pos + nl + 1)
}

/// Return the byte offset of the end of the line starting at `pos`.
fn line_end_at(text: &str, pos: usize) -> usize {
    text[pos..]
        .find('\n')
        .map_or(text.len(), |nl| pos + nl)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_html_disable_enable() {
        let text = "Line one\n<!-- lang-check-disable -->\nBad text here\n<!-- lang-check-enable -->\nGood text";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert!(text[ranges[0].byte_range.clone()].contains("Bad text here"));
        assert!(!text[ranges[0].byte_range.clone()].contains("Good text"));
        assert!(ranges[0].rule_ids.is_empty());
    }

    #[test]
    fn parse_disable_next_line() {
        let text = "Line one\n<!-- lang-check-disable-next-line -->\nBad line\nGood line";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(&text[ranges[0].byte_range.clone()], "Bad line");
    }

    #[test]
    fn parse_disable_with_rule_id() {
        let text = "<!-- lang-check-disable spelling.typo -->\nsome text\n<!-- lang-check-enable -->";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].rule_ids, vec!["spelling.typo"]);
    }

    #[test]
    fn parse_disable_multiple_rule_ids() {
        let text = "<!-- lang-check-disable spelling.typo grammar.article -->\ntext\n<!-- lang-check-enable -->";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0].rule_ids,
            vec!["spelling.typo", "grammar.article"]
        );
    }

    #[test]
    fn parse_line_comment_format() {
        let text = "code\n// lang-check-disable\nsome text\n// lang-check-enable\nmore code";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert!(text[ranges[0].byte_range.clone()].contains("some text"));
    }

    #[test]
    fn parse_block_comment_format() {
        let text = "/* lang-check-disable-next-line */\nbad line\ngood line";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(&text[ranges[0].byte_range.clone()], "bad line");
    }

    #[test]
    fn parse_latex_comment_format() {
        let text = "% lang-check-disable\nbad text\n% lang-check-enable\ngood text";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert!(text[ranges[0].byte_range.clone()].contains("bad text"));
    }

    #[test]
    fn unclosed_disable_extends_to_eof() {
        let text = "Good text\n<!-- lang-check-disable -->\nBad text\nMore bad text";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].byte_range.end, text.len());
    }

    #[test]
    fn no_directives_no_ranges() {
        let text = "Just normal text\nwith no directives.";
        let ranges = IgnoreParser::parse(text);
        assert!(ranges.is_empty());
    }

    #[test]
    fn should_ignore_all_rules() {
        let text = "Hello\n<!-- lang-check-disable -->\nBad text\n<!-- lang-check-enable -->\nGood";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);

        // "Bad text" starts at byte 35 (after "Hello\n" + "<!-- lang-check-disable -->\n")
        let bad_start = text.find("Bad text").unwrap();

        // Diagnostic inside the ignored range
        let d_inside = Diagnostic {
            start_byte: bad_start as u32,
            end_byte: (bad_start + 3) as u32,
            message: "test".to_string(),
            suggestions: vec![],
            rule_id: "some_rule".to_string(),
            severity: 2,
            unified_id: "spelling.typo".to_string(),
            confidence: 0.9,
        };
        assert!(IgnoreParser::should_ignore(&d_inside, &ranges));

        // Diagnostic outside the ignored range (in "Hello")
        let d_outside = Diagnostic {
            start_byte: 0,
            end_byte: 5,
            message: "test".to_string(),
            suggestions: vec![],
            rule_id: "some_rule".to_string(),
            severity: 2,
            unified_id: "spelling.typo".to_string(),
            confidence: 0.9,
        };
        assert!(!IgnoreParser::should_ignore(&d_outside, &ranges));
    }

    #[test]
    fn should_ignore_specific_rule_only() {
        let text = "<!-- lang-check-disable spelling.typo -->\nBad text\n<!-- lang-check-enable -->";
        let ranges = IgnoreParser::parse(text);

        let bad_start = text.find("Bad text").unwrap();

        // Matching rule: should be ignored
        let d_match = Diagnostic {
            start_byte: bad_start as u32,
            end_byte: (bad_start + 3) as u32,
            message: "test".to_string(),
            suggestions: vec![],
            rule_id: "harper::spelling".to_string(),
            severity: 2,
            unified_id: "spelling.typo".to_string(),
            confidence: 0.9,
        };
        assert!(IgnoreParser::should_ignore(&d_match, &ranges));

        // Non-matching rule: should NOT be ignored
        let d_no_match = Diagnostic {
            start_byte: bad_start as u32,
            end_byte: (bad_start + 3) as u32,
            message: "test".to_string(),
            suggestions: vec![],
            rule_id: "grammar_check".to_string(),
            severity: 2,
            unified_id: "grammar.article".to_string(),
            confidence: 0.9,
        };
        assert!(!IgnoreParser::should_ignore(&d_no_match, &ranges));
    }

    #[test]
    fn disable_next_line_with_rule_id() {
        let text = "// lang-check-disable-next-line grammar.article\nThe the error\nClean line";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(&text[ranges[0].byte_range.clone()], "The the error");
        assert_eq!(ranges[0].rule_ids, vec!["grammar.article"]);
    }
}
