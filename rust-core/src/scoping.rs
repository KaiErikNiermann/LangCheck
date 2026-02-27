use std::ops::Range;

/// A region of text with an explicitly annotated natural language.
///
/// Parsed from scope markers like `<!-- lang: fr -->` or `// @lang: de`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopedRegion {
    /// BCP-47 language tag (e.g. "fr", "de", "en-US").
    pub language: String,
    /// Byte range this scope covers (from the marker to the next marker or EOF).
    pub byte_range: Range<usize>,
}

/// Parses language scope annotations from document text.
///
/// Supports the following marker formats:
/// - `<!-- lang: xx -->` (HTML/Markdown comments)
/// - `// @lang: xx` (line comments)
/// - `/* @lang: xx */` (block comments)
/// - `% @lang: xx` (LaTeX comments)
pub struct ScopeParser;

impl ScopeParser {
    /// Extract all language scope regions from the given text.
    ///
    /// Returns scoped regions sorted by byte offset. Text between
    /// the start of the document and the first marker (or with no markers
    /// at all) is *not* included - the caller should fall back to the
    /// default language for those ranges.
    #[must_use]
    pub fn parse(text: &str) -> Vec<ScopedRegion> {
        let mut markers: Vec<(usize, String)> = Vec::new();

        for (line_start, line) in line_byte_offsets(text) {
            if let Some(lang) = Self::extract_marker(line) {
                // The scope starts after the marker line
                let scope_start = line_start + line.len();
                // Skip trailing newline if present
                let scope_start = if text.as_bytes().get(scope_start) == Some(&b'\n') {
                    scope_start + 1
                } else {
                    scope_start
                };
                markers.push((scope_start, lang));
            }
        }

        let mut regions = Vec::with_capacity(markers.len());
        for (i, (start, lang)) in markers.iter().enumerate() {
            let end = markers.get(i + 1).map_or(text.len(), |(next_start, _)| {
                // Walk back to before the marker line
                text[..*next_start]
                    .rfind('\n')
                    .map_or(*next_start, |nl_pos| {
                        // Find the start of the marker line
                        text[..nl_pos]
                            .rfind('\n')
                            .map_or(0, |prev_nl| prev_nl + 1)
                    })
            });

            if end > *start {
                regions.push(ScopedRegion {
                    language: lang.clone(),
                    byte_range: *start..end,
                });
            }
        }

        regions
    }

    /// Look up the language for a given byte offset, if it falls within a scoped region.
    #[must_use]
    pub fn language_at(regions: &[ScopedRegion], byte_offset: usize) -> Option<&str> {
        regions
            .iter()
            .find(|r| r.byte_range.contains(&byte_offset))
            .map(|r| r.language.as_str())
    }

    fn extract_marker(line: &str) -> Option<String> {
        let trimmed = line.trim();

        // <!-- lang: xx --> format
        if let Some(rest) = trimmed.strip_prefix("<!--")
            && let Some(inner) = rest.strip_suffix("-->")
        {
            return Self::parse_lang_directive(inner.trim());
        }

        // // @lang: xx format
        if let Some(rest) = trimmed.strip_prefix("//") {
            return Self::parse_lang_directive(rest.trim());
        }

        // /* @lang: xx */ format
        if let Some(rest) = trimmed.strip_prefix("/*")
            && let Some(inner) = rest.strip_suffix("*/")
        {
            return Self::parse_lang_directive(inner.trim());
        }

        // % @lang: xx format (LaTeX)
        if let Some(rest) = trimmed.strip_prefix('%') {
            return Self::parse_lang_directive(rest.trim());
        }

        None
    }

    fn parse_lang_directive(s: &str) -> Option<String> {
        // Accept: "lang: xx", "@lang: xx", "lang:xx", "@lang:xx"
        let s = s.strip_prefix('@').unwrap_or(s);
        let s = s.strip_prefix("lang").unwrap_or_default();
        let s = s.strip_prefix(':').unwrap_or_default();
        let lang = s.trim();

        if lang.is_empty() || lang.len() > 10 || lang.contains(' ') {
            return None;
        }

        Some(lang.to_string())
    }
}

/// Yields `(byte_offset_of_line_start, line_str)` for each line including the trailing `\n`.
fn line_byte_offsets(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = 0;
    text.split_inclusive('\n').map(move |line| {
        let start = offset;
        offset += line.len();
        (start, line)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_comment_marker() {
        let text = "English text.\n<!-- lang: fr -->\nTexte français.\n";
        let regions = ScopeParser::parse(text);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].language, "fr");
        let scoped_text = &text[regions[0].byte_range.clone()];
        assert!(scoped_text.contains("Texte français"));
    }

    #[test]
    fn line_comment_marker() {
        let text = "English.\n// @lang: de\nDeutscher Text.\n";
        let regions = ScopeParser::parse(text);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].language, "de");
    }

    #[test]
    fn block_comment_marker() {
        let text = "Hello.\n/* @lang: es */\nTexto español.\n";
        let regions = ScopeParser::parse(text);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].language, "es");
    }

    #[test]
    fn latex_comment_marker() {
        let text = "English.\n% @lang: fr\nFrançais.\n";
        let regions = ScopeParser::parse(text);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].language, "fr");
    }

    #[test]
    fn multiple_regions() {
        let text = "\
English paragraph.
<!-- lang: fr -->
Paragraphe français.
<!-- lang: de -->
Deutscher Absatz.
";
        let regions = ScopeParser::parse(text);
        assert_eq!(regions.len(), 2);
        assert_eq!(regions[0].language, "fr");
        assert_eq!(regions[1].language, "de");
    }

    #[test]
    fn no_markers() {
        let text = "Just plain English text with no annotations.";
        let regions = ScopeParser::parse(text);
        assert!(regions.is_empty());
    }

    #[test]
    fn language_at_lookup() {
        let text = "Hello.\n<!-- lang: fr -->\nBonjour.\n";
        let regions = ScopeParser::parse(text);
        // "Bonjour" starts somewhere after the marker
        let bonjour_offset = text.find("Bonjour").unwrap();
        assert_eq!(ScopeParser::language_at(&regions, bonjour_offset), Some("fr"));
        assert_eq!(ScopeParser::language_at(&regions, 0), None);
    }

    #[test]
    fn marker_without_at_sign() {
        let text = "Hello.\n<!-- lang: ja -->\n日本語テキスト.\n";
        let regions = ScopeParser::parse(text);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].language, "ja");
    }

    #[test]
    fn ignores_invalid_markers() {
        let text = "<!-- lang: -->\n<!-- lang: this is not a lang -->\n<!-- notlang: fr -->\n";
        let regions = ScopeParser::parse(text);
        assert!(regions.is_empty());
    }
}
