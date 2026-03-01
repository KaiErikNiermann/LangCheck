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
    /// Begin a scoped region with options (language, type, line count, etc.).
    Begin,
    /// End the most recent scoped Begin region.
    End,
}

/// Options for a `lang-check-begin` directive.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BeginOptions {
    /// Only suppress these rule IDs; if empty, suppress all.
    pub rule_ids: Vec<String>,
    /// Override natural language for this region (e.g. "fr", "de").
    pub language: Option<String>,
    /// Re-parse region as this format (e.g. "latex"). Deferred implementation.
    pub doc_type: Option<String>,
    /// Scope applies to a slice of lines after the directive (no end directive needed).
    /// `(start, end)` in 0-indexed line offsets, like Python slice notation `[start:end]`.
    pub line_slice: Option<(usize, usize)>,
    /// Only apply to lines matching this regex pattern.
    pub match_pattern: Option<String>,
    /// Skip lines matching this regex pattern.
    pub exclude_pattern: Option<String>,
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
    /// If empty, suppress all rules. Used by Disable/DisableNextLine.
    pub rule_ids: Vec<String>,
    /// Options for Begin directives; `None` for all other kinds.
    pub options: Option<BeginOptions>,
}

/// A resolved byte range that should be ignored during checking.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnoreRange {
    /// Byte range to ignore.
    pub byte_range: Range<usize>,
    /// If set, only ignore diagnostics matching these rule IDs.
    pub rule_ids: Vec<String>,
}

/// A resolved scoped region from `lang-check-begin` / `lang-check-end`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectiveRegion {
    /// Byte range this region covers.
    pub byte_range: Range<usize>,
    /// Options carried from the `Begin` directive.
    pub options: BeginOptions,
}

/// The full result of resolving all directives: legacy ignore ranges + scoped regions.
#[derive(Debug, Clone, Default)]
pub struct ResolvedDirectives {
    /// Legacy disable/enable and disable-next-line ranges.
    pub ignore_ranges: Vec<IgnoreRange>,
    /// Scoped begin/end regions (may carry language overrides, regex filters, etc.).
    pub regions: Vec<DirectiveRegion>,
}

/// Parses `lang-check-disable` / `lang-check-enable` / `lang-check-disable-next-line`
/// and `lang-check-begin` / `lang-check-end` directives from document text.
pub struct IgnoreParser;

impl IgnoreParser {
    /// Parse all ignore directives from the given text.
    #[must_use]
    pub fn parse_directives(text: &str) -> Vec<IgnoreDirective> {
        let mut directives = Vec::new();

        for (line_start, line) in line_byte_offsets(text) {
            let line_end = line_start + line.len();

            if let Some((kind, rule_ids, options)) = Self::extract_directive(line) {
                directives.push(IgnoreDirective {
                    line_start,
                    line_end,
                    kind,
                    rule_ids,
                    options,
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
                // Begin/End are handled by resolve_regions(); skip here.
                DirectiveKind::Begin | DirectiveKind::End => {}
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
                if range
                    .rule_ids
                    .iter()
                    .any(|r| r == &diagnostic.unified_id || r == &diagnostic.rule_id)
                {
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

    /// Resolve all directives into both legacy ignore ranges and scoped regions.
    #[must_use]
    pub fn resolve_all(text: &str, directives: &[IgnoreDirective]) -> ResolvedDirectives {
        let ignore_ranges = Self::resolve(text, directives);
        let regions = Self::resolve_regions(text, directives);
        ResolvedDirectives {
            ignore_ranges,
            regions,
        }
    }

    /// Resolve `Begin`/`End` directives into `DirectiveRegion` entries.
    fn resolve_regions(text: &str, directives: &[IgnoreDirective]) -> Vec<DirectiveRegion> {
        let mut regions = Vec::new();
        let mut open_begins: Vec<&IgnoreDirective> = Vec::new();

        for directive in directives {
            match &directive.kind {
                DirectiveKind::Begin => {
                    let opts = directive
                        .options
                        .clone()
                        .unwrap_or_default();

                    if let Some((a, b)) = opts.line_slice {
                        // Auto-closing: scope covers lines a..b after the directive
                        let first_line = next_line_start(text, directive.line_end);
                        let start = advance_n_lines(text, first_line, a);
                        let end = advance_n_lines(text, first_line, b);
                        if start < text.len() {
                            regions.push(DirectiveRegion {
                                byte_range: start..end,
                                options: opts,
                            });
                        }
                    } else {
                        open_begins.push(directive);
                    }
                }
                DirectiveKind::End => {
                    if let Some(begin) = open_begins.pop() {
                        let opts = begin
                            .options
                            .clone()
                            .unwrap_or_default();
                        let start = next_line_start(text, begin.line_end);
                        let end = directive.line_start;
                        if start < end {
                            regions.push(DirectiveRegion {
                                byte_range: start..end,
                                options: opts,
                            });
                        }
                    }
                }
                _ => {}
            }
        }

        // Unclosed begins extend to EOF
        for begin in open_begins {
            let opts = begin
                .options
                .clone()
                .unwrap_or_default();
            let start = next_line_start(text, begin.line_end);
            if start < text.len() {
                regions.push(DirectiveRegion {
                    byte_range: start..text.len(),
                    options: opts,
                });
            }
        }

        regions
    }

    /// Check whether a diagnostic should be suppressed by any directive region.
    ///
    /// Regions with only a `language` override (no `rule_ids`) do NOT suppress;
    /// they are language-override-only regions.
    #[must_use]
    pub fn should_ignore_by_region(
        diagnostic: &Diagnostic,
        text: &str,
        regions: &[DirectiveRegion],
    ) -> bool {
        let d_start = diagnostic.start_byte as usize;

        for region in regions {
            if !region.byte_range.contains(&d_start) {
                continue;
            }

            // Language-only regions don't suppress diagnostics
            if region.options.rule_ids.is_empty()
                && region.options.language.is_some()
                && region.options.match_pattern.is_none()
                && region.options.exclude_pattern.is_none()
            {
                continue;
            }

            // Check match/exclude regex filters
            if !line_matches_filters(text, d_start, &region.options) {
                continue;
            }

            // Rule ID filtering
            if region.options.rule_ids.is_empty() {
                return true;
            }
            if region
                .options
                .rule_ids
                .iter()
                .any(|r| r == &diagnostic.unified_id || r == &diagnostic.rule_id)
            {
                return true;
            }
        }

        false
    }

    /// Extract a directive from a single line of text.
    fn extract_directive(line: &str) -> Option<(DirectiveKind, Vec<String>, Option<BeginOptions>)> {
        let trimmed = line.trim();

        // HTML comment: <!-- lang-check-... -->
        if let Some(rest) = trimmed.strip_prefix("<!--")
            && let Some(inner) = rest.strip_suffix("-->")
        {
            return Self::parse_directive_content(inner.trim());
        }

        // Line comment: // lang-check-...
        if let Some(rest) = trimmed.strip_prefix("//") {
            return Self::parse_directive_content(rest.trim());
        }

        // Block comment (single line): /* lang-check-... */
        if let Some(rest) = trimmed.strip_prefix("/*")
            && let Some(inner) = rest.strip_suffix("*/")
        {
            return Self::parse_directive_content(inner.trim());
        }

        // LaTeX comment: % lang-check-...
        if let Some(rest) = trimmed.strip_prefix('%') {
            return Self::parse_directive_content(rest.trim());
        }

        None
    }

    /// Parse the content after the comment markers.
    fn parse_directive_content(
        content: &str,
    ) -> Option<(DirectiveKind, Vec<String>, Option<BeginOptions>)> {
        if let Some(rest) = content.strip_prefix("lang-check-disable-next-line") {
            let rule_ids = parse_rule_ids(rest);
            return Some((DirectiveKind::DisableNextLine, rule_ids, None));
        }

        if let Some(rest) = content.strip_prefix("lang-check-disable") {
            let rule_ids = parse_rule_ids(rest);
            return Some((DirectiveKind::Disable, rule_ids, None));
        }

        if content.starts_with("lang-check-enable") {
            return Some((DirectiveKind::Enable, Vec::new(), None));
        }

        if let Some(rest) = content.strip_prefix("lang-check-begin") {
            let options = parse_begin_options(rest);
            return Some((DirectiveKind::Begin, Vec::new(), Some(options)));
        }

        if content.starts_with("lang-check-end") {
            return Some((DirectiveKind::End, Vec::new(), None));
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

/// Parse the options after `lang-check-begin`.
///
/// Tokens are space-separated. Recognized option prefixes:
/// - `lang:xx` → language override
/// - `type:xx` → document type override
/// - `check[a:b]` or `check[:b]` → line slice (0-indexed, like `[start:end]`)
/// - `match:/PATTERN/` → regex include filter
/// - `exclude:/PATTERN/` → regex exclude filter
/// - anything else → treated as a rule ID
fn parse_begin_options(rest: &str) -> BeginOptions {
    let mut opts = BeginOptions::default();

    for token in rest.split_whitespace() {
        if let Some(lang) = token.strip_prefix("lang:") {
            opts.language = Some(lang.to_string());
        } else if let Some(dtype) = token.strip_prefix("type:") {
            opts.doc_type = Some(dtype.to_string());
        } else if let Some(inner) = token.strip_prefix("check[")
            && let Some(slice) = inner.strip_suffix(']')
            && let Some((a_str, b_str)) = slice.split_once(':')
            && let Ok(b) = b_str.parse::<usize>()
        {
            let a = if a_str.is_empty() {
                0
            } else if let Ok(v) = a_str.parse::<usize>() {
                v
            } else {
                continue;
            };
            opts.line_slice = Some((a, b));
        } else if let Some(pat) = token.strip_prefix("match:") {
            // e.g. "match:/^>\s/"
            let pat = pat.strip_prefix('/').unwrap_or(pat);
            let pat = pat.strip_suffix('/').unwrap_or(pat);
            opts.match_pattern = Some(pat.to_string());
        } else if let Some(pat) = token.strip_prefix("exclude:") {
            let pat = pat.strip_prefix('/').unwrap_or(pat);
            let pat = pat.strip_suffix('/').unwrap_or(pat);
            opts.exclude_pattern = Some(pat.to_string());
        } else {
            opts.rule_ids.push(token.to_string());
        }
    }

    opts
}

/// Iterate over lines in text, yielding (`byte_offset`, `line_content`) pairs.
fn line_byte_offsets(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.split('\n').scan(0usize, |offset, line| {
        let start = *offset;
        *offset += line.len() + 1; // +1 for the newline
        Some((start, line))
    })
}

/// Return the byte offset of the start of the next line after `pos`.
fn next_line_start(text: &str, pos: usize) -> usize {
    text[pos..].find('\n').map_or(text.len(), |nl| pos + nl + 1)
}

/// Return the byte offset of the end of the line starting at `pos`.
fn line_end_at(text: &str, pos: usize) -> usize {
    text[pos..].find('\n').map_or(text.len(), |nl| pos + nl)
}

/// Advance `n` lines from `start` and return the byte offset of the end of the Nth line.
fn advance_n_lines(text: &str, start: usize, n: usize) -> usize {
    let mut pos = start;
    for _ in 0..n {
        match text[pos..].find('\n') {
            Some(nl) => pos = pos + nl + 1,
            None => return text.len(),
        }
    }
    // pos is now at the start of line n+1; the region covers up to here
    pos
}

/// Extract the line containing byte offset `pos` from `text`.
fn line_at(text: &str, pos: usize) -> &str {
    let start = text[..pos].rfind('\n').map_or(0, |nl| nl + 1);
    let end = text[pos..].find('\n').map_or(text.len(), |nl| pos + nl);
    &text[start..end]
}

/// Resolve the effective language at a byte offset.
///
/// Directive regions with `lang:` take precedence over `ScopeParser` regions.
/// Returns `None` if neither system overrides the language at this position.
#[must_use]
pub fn resolve_language<'a>(
    byte_offset: usize,
    regions: &'a [DirectiveRegion],
    scope_regions: &'a [crate::scoping::ScopedRegion],
) -> Option<&'a str> {
    // Directive regions take precedence
    for region in regions {
        if region.byte_range.contains(&byte_offset)
            && let Some(ref lang) = region.options.language
        {
            return Some(lang.as_str());
        }
    }
    // Fall back to legacy scope parser
    crate::scoping::ScopeParser::language_at(scope_regions, byte_offset)
}

/// Check whether a diagnostic position passes the match/exclude regex filters.
fn line_matches_filters(text: &str, byte_pos: usize, opts: &BeginOptions) -> bool {
    let line = line_at(text, byte_pos);

    if let Some(ref pat) = opts.match_pattern
        && let Ok(re) = regex::Regex::new(pat)
        && !re.is_match(line)
    {
        return false;
    }

    if let Some(ref pat) = opts.exclude_pattern
        && let Ok(re) = regex::Regex::new(pat)
        && re.is_match(line)
    {
        return false;
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_diag(text: &str, needle: &str, rule_id: &str, unified_id: &str) -> Diagnostic {
        let start = text.find(needle).unwrap();
        Diagnostic {
            start_byte: start as u32,
            end_byte: (start + needle.len()) as u32,
            message: "test".to_string(),
            suggestions: vec![],
            rule_id: rule_id.to_string(),
            severity: 2,
            unified_id: unified_id.to_string(),
            confidence: 0.9,
        }
    }

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
        let text =
            "<!-- lang-check-disable spelling.typo -->\nsome text\n<!-- lang-check-enable -->";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].rule_ids, vec!["spelling.typo"]);
    }

    #[test]
    fn parse_disable_multiple_rule_ids() {
        let text = "<!-- lang-check-disable spelling.typo grammar.article -->\ntext\n<!-- lang-check-enable -->";
        let ranges = IgnoreParser::parse(text);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].rule_ids, vec!["spelling.typo", "grammar.article"]);
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

        let d_inside = make_diag(text, "Bad", "some_rule", "spelling.typo");
        assert!(IgnoreParser::should_ignore(&d_inside, &ranges));

        let d_outside = make_diag(text, "Hello", "some_rule", "spelling.typo");
        assert!(!IgnoreParser::should_ignore(&d_outside, &ranges));
    }

    #[test]
    fn should_ignore_specific_rule_only() {
        let text =
            "<!-- lang-check-disable spelling.typo -->\nBad text\n<!-- lang-check-enable -->";
        let ranges = IgnoreParser::parse(text);

        let d_match = make_diag(text, "Bad", "harper::spelling", "spelling.typo");
        assert!(IgnoreParser::should_ignore(&d_match, &ranges));

        let d_no_match = make_diag(text, "Bad", "grammar_check", "grammar.article");
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

    // ── Begin/End directive tests ────────────────────────────────────

    #[test]
    fn parse_begin_end_basic() {
        let text = "Good\n<!-- lang-check-begin -->\nBad text\n<!-- lang-check-end -->\nGood";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        let region_text = &text[resolved.regions[0].byte_range.clone()];
        assert!(region_text.contains("Bad text"));
        assert!(!region_text.contains("Good"));
    }

    #[test]
    fn parse_begin_with_rule_ids() {
        let text = "<!-- lang-check-begin spelling.typo -->\ntext\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        assert_eq!(resolved.regions[0].options.rule_ids, vec!["spelling.typo"]);
    }

    #[test]
    fn parse_begin_with_lang() {
        let text = "<!-- lang-check-begin lang:fr -->\nTexte\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        assert_eq!(
            resolved.regions[0].options.language,
            Some("fr".to_string())
        );
    }

    #[test]
    fn parse_begin_with_line_count() {
        let text = "<!-- lang-check-begin check[:2] -->\nLine one\nLine two\nLine three";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        let region_text = &text[resolved.regions[0].byte_range.clone()];
        assert!(region_text.contains("Line one"));
        assert!(region_text.contains("Line two"));
        assert!(!region_text.contains("Line three"));
    }

    #[test]
    fn parse_begin_with_match_exclude() {
        let text = "<!-- lang-check-begin match:/^>/ exclude:/TODO/ -->\ntext\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        assert_eq!(
            resolved.regions[0].options.match_pattern,
            Some("^>".to_string())
        );
        assert_eq!(
            resolved.regions[0].options.exclude_pattern,
            Some("TODO".to_string())
        );
    }

    #[test]
    fn parse_begin_multiple_options() {
        let text =
            "<!-- lang-check-begin lang:de spelling.typo check[:3] -->\nZeile\nZwei\nDrei\nVier";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        let opts = &resolved.regions[0].options;
        assert_eq!(opts.language, Some("de".to_string()));
        assert_eq!(opts.rule_ids, vec!["spelling.typo"]);
        assert_eq!(opts.line_slice, Some((0, 3)));
    }

    #[test]
    fn parse_begin_unclosed_extends_to_eof() {
        let text = "Good\n<!-- lang-check-begin -->\nBad text\nMore bad text";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);
        assert_eq!(resolved.regions[0].byte_range.end, text.len());
    }

    #[test]
    fn begin_end_suppress_all() {
        let text = "Good\n<!-- lang-check-begin -->\nBad text\n<!-- lang-check-end -->\nGood";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        let d_inside = make_diag(text, "Bad", "some_rule", "spelling.typo");
        assert!(IgnoreParser::should_ignore_by_region(
            &d_inside,
            text,
            &resolved.regions
        ));

        let d_outside = make_diag(text, "Good", "some_rule", "spelling.typo");
        assert!(!IgnoreParser::should_ignore_by_region(
            &d_outside,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn begin_end_suppress_specific_rule() {
        let text = "<!-- lang-check-begin spelling.typo -->\nBad text\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        let d_match = make_diag(text, "Bad", "harper::spelling", "spelling.typo");
        assert!(IgnoreParser::should_ignore_by_region(
            &d_match,
            text,
            &resolved.regions
        ));

        let d_no_match = make_diag(text, "Bad", "grammar_check", "grammar.article");
        assert!(!IgnoreParser::should_ignore_by_region(
            &d_no_match,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn begin_line_count_no_end_needed() {
        let text = "<!-- lang-check-begin check[:1] -->\nBad line\nGood line";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);
        assert_eq!(resolved.regions.len(), 1);

        let d_bad = make_diag(text, "Bad", "r", "spelling.typo");
        assert!(IgnoreParser::should_ignore_by_region(
            &d_bad,
            text,
            &resolved.regions
        ));

        let d_good = make_diag(text, "Good", "r", "spelling.typo");
        assert!(!IgnoreParser::should_ignore_by_region(
            &d_good,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn begin_end_with_match_filter() {
        let text =
            "<!-- lang-check-begin match:/^>/ -->\n> Quoted line\nNormal line\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        // Diagnostic on the quoted line — should be suppressed
        let d_quoted = make_diag(text, "Quoted", "r", "spelling.typo");
        assert!(IgnoreParser::should_ignore_by_region(
            &d_quoted,
            text,
            &resolved.regions
        ));

        // Diagnostic on the normal line — should NOT be suppressed
        let d_normal = make_diag(text, "Normal", "r", "spelling.typo");
        assert!(!IgnoreParser::should_ignore_by_region(
            &d_normal,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn begin_end_with_exclude_filter() {
        let text =
            "<!-- lang-check-begin exclude:/TODO/ -->\nCheck this\nTODO skip this\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        // "Check this" — should be suppressed
        let d_check = make_diag(text, "Check", "r", "spelling.typo");
        assert!(IgnoreParser::should_ignore_by_region(
            &d_check,
            text,
            &resolved.regions
        ));

        // "TODO skip this" — excluded, should NOT be suppressed
        let d_todo = make_diag(text, "TODO", "r", "spelling.typo");
        assert!(!IgnoreParser::should_ignore_by_region(
            &d_todo,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn mixed_disable_and_begin() {
        let text = "<!-- lang-check-disable -->\nDisabled\n<!-- lang-check-enable -->\n<!-- lang-check-begin -->\nBegin region\n<!-- lang-check-end -->\nClean";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        // Legacy disable range
        assert_eq!(resolved.ignore_ranges.len(), 1);
        assert!(
            text[resolved.ignore_ranges[0].byte_range.clone()].contains("Disabled")
        );

        // Begin/end region
        assert_eq!(resolved.regions.len(), 1);
        assert!(
            text[resolved.regions[0].byte_range.clone()].contains("Begin region")
        );

        // Both systems suppress their respective content
        let d_disabled = make_diag(text, "Disabled", "r", "spelling.typo");
        assert!(IgnoreParser::should_ignore(&d_disabled, &resolved.ignore_ranges));

        let d_begin = make_diag(text, "Begin region", "r", "spelling.typo");
        assert!(IgnoreParser::should_ignore_by_region(
            &d_begin,
            text,
            &resolved.regions
        ));

        let d_clean = make_diag(text, "Clean", "r", "spelling.typo");
        assert!(!IgnoreParser::should_ignore(&d_clean, &resolved.ignore_ranges));
        assert!(!IgnoreParser::should_ignore_by_region(
            &d_clean,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn nested_begin_end() {
        let text = "<!-- lang-check-begin -->\nOuter\n<!-- lang-check-begin spelling.typo -->\nInner\n<!-- lang-check-end -->\nStill outer\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        // Two regions: the inner one closes first (stack semantics)
        assert_eq!(resolved.regions.len(), 2);

        // Inner region has spelling.typo filter
        let inner = resolved
            .regions
            .iter()
            .find(|r| !r.options.rule_ids.is_empty())
            .unwrap();
        assert_eq!(inner.options.rule_ids, vec!["spelling.typo"]);
        assert!(text[inner.byte_range.clone()].contains("Inner"));

        // Outer region has no rule filter (suppress all)
        let outer = resolved
            .regions
            .iter()
            .find(|r| r.options.rule_ids.is_empty())
            .unwrap();
        assert!(text[outer.byte_range.clone()].contains("Outer"));
        assert!(text[outer.byte_range.clone()].contains("Still outer"));
    }

    #[test]
    fn lang_override_does_not_suppress() {
        // A region with only lang: and no rule_ids should NOT suppress diagnostics
        let text = "<!-- lang-check-begin lang:fr -->\nTexte\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        let d = make_diag(text, "Texte", "r", "spelling.typo");
        assert!(!IgnoreParser::should_ignore_by_region(
            &d,
            text,
            &resolved.regions
        ));
    }

    #[test]
    fn resolve_language_directive_takes_precedence() {
        let text = "<!-- lang-check-begin lang:fr -->\nTexte\n<!-- lang-check-end -->";
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        let texte_offset = text.find("Texte").unwrap();

        // Directive region provides French
        assert_eq!(
            resolve_language(texte_offset, &resolved.regions, &[]),
            Some("fr")
        );

        // Before the region — no override
        assert_eq!(resolve_language(0, &resolved.regions, &[]), None);
    }
}
