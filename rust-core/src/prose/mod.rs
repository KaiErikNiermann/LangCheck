mod bibtex;
mod forester;
mod latex;
mod org;
mod query;
mod rst;
mod shared;
mod sweave;
mod tinylang;

use anyhow::{Result, anyhow};
use std::ops::Range;
use std::path::Path;
use tree_sitter::{Language, Parser};

use crate::ignore_rules::{DirectiveRegion, IgnoreParser};

use crate::sls::SchemaRegistry;

pub struct ProseExtractor {
    parser: Parser,
    language: Language,
}

impl ProseExtractor {
    pub fn new(language: Language) -> Result<Self> {
        let mut parser = Parser::new();
        parser.set_language(&language)?;
        Ok(Self { parser, language })
    }

    pub fn extract(
        &mut self,
        text: &str,
        lang_id: &str,
        extra_skip_envs: &[String],
    ) -> Result<Vec<ProseRange>> {
        let tree = self
            .parser
            .parse(text, None)
            .ok_or_else(|| anyhow!("Failed to parse text"))?;

        let root = tree.root_node();

        match lang_id {
            "latex" => Ok(latex::extract(text, root, extra_skip_envs)),
            "sweave" => Ok(sweave::extract(text, root, extra_skip_envs)),
            "forester" => Ok(forester::extract(text, root)),
            "tinylang" => Ok(tinylang::extract(text, root)),
            "rst" => Ok(rst::extract(text, root)),
            "bibtex" => Ok(bibtex::extract(text, root)),
            "org" => Ok(org::extract(text, root)),
            lang => query::extract(text, root, &self.language, lang),
        }
    }
}

/// Extract prose using a built-in tree-sitter extractor or an SLS fallback.
///
/// When the file extension matches a loaded SLS schema and that extension has
/// no built-in tree-sitter extractor, the schema takes over. Built-in
/// extensions always keep precedence.
pub fn extract_with_fallback(
    text: &str,
    lang_id: &str,
    path: Option<&Path>,
    schema_registry: Option<&SchemaRegistry>,
    extra_skip_envs: &[String],
) -> Result<Vec<ProseRange>> {
    if let Some(ext) = path
        .and_then(|value| value.extension())
        .and_then(|value| value.to_str())
        && crate::languages::builtin_language_for_extension(ext).is_none()
        && let Some(schema) = schema_registry.and_then(|registry| registry.find_by_extension(ext))
    {
        return Ok(schema.extract(text));
    }

    let canonical_lang = crate::languages::resolve_language_id(lang_id);
    let language = crate::languages::resolve_ts_language(canonical_lang);
    let mut extractor = ProseExtractor::new(language)?;
    let mut ranges = extractor.extract(text, canonical_lang, extra_skip_envs)?;

    let directives = IgnoreParser::parse_directives(text);
    let resolved = IgnoreParser::resolve_all(text, &directives);
    let type_regions: Vec<_> = resolved
        .regions
        .iter()
        .filter(|r| r.options.doc_type.is_some())
        .collect();
    if !type_regions.is_empty() {
        ranges = apply_type_overrides(text, ranges, &type_regions, extra_skip_envs)?;
    }

    Ok(ranges)
}

/// Re-extract prose for regions tagged with `type:FORMAT`.
///
/// For each type-override region, slices the document text, runs the specified
/// format's extractor, and rebases the resulting ranges to document-level
/// offsets. Base ranges whose `start_byte` falls inside a type-override region
/// are removed and replaced with the re-extracted ranges.
fn apply_type_overrides(
    text: &str,
    base_ranges: Vec<ProseRange>,
    type_regions: &[&DirectiveRegion],
    extra_skip_envs: &[String],
) -> Result<Vec<ProseRange>> {
    let override_spans: Vec<&Range<usize>> =
        type_regions.iter().map(|r| &r.byte_range).collect();

    // Keep base ranges that don't start inside any type-override region.
    let mut result: Vec<ProseRange> = base_ranges
        .into_iter()
        .filter(|r| !override_spans.iter().any(|span| span.contains(&r.start_byte)))
        .collect();

    for region in type_regions {
        let doc_type = region.options.doc_type.as_deref().unwrap();
        let canonical = crate::languages::resolve_language_id(doc_type);

        if !crate::languages::SUPPORTED_LANGUAGE_IDS.contains(&canonical) {
            eprintln!(
                "lang-check: `type:{doc_type}` is not a supported language; skipping region"
            );
            continue;
        }

        let slice = &text[region.byte_range.clone()];
        let ts_lang = crate::languages::resolve_ts_language(canonical);
        let mut ext = ProseExtractor::new(ts_lang)?;
        let sub_ranges = ext.extract(slice, canonical, extra_skip_envs)?;

        let offset = region.byte_range.start;
        for mut r in sub_ranges {
            r.start_byte += offset;
            r.end_byte += offset;
            r.exclusions = r
                .exclusions
                .into_iter()
                .map(|(s, e)| (s + offset, e + offset))
                .collect();
            result.push(r);
        }
    }

    result.sort_by_key(|r| r.start_byte);
    Ok(result)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseRange {
    pub start_byte: usize,
    pub end_byte: usize,
    /// Byte ranges (document-level) within this prose range that should be
    /// excluded from grammar checking (e.g. display math). These regions are
    /// replaced with spaces when extracting text, preserving byte offsets.
    pub exclusions: Vec<(usize, usize)>,
}

impl ProseRange {
    /// Extract the prose text from the full document, replacing any excluded
    /// regions with spaces so that byte offsets remain stable.
    pub fn extract_text<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        let slice = &text[self.start_byte..self.end_byte];
        if self.exclusions.is_empty() {
            return std::borrow::Cow::Borrowed(slice);
        }
        let mut buf = slice.to_string();
        // SAFETY: we only replace valid UTF-8 ranges with ASCII spaces
        let bytes = unsafe { buf.as_bytes_mut() };
        for &(exc_start, exc_end) in &self.exclusions {
            // Convert document-level offsets to slice-local offsets
            let local_start = exc_start.saturating_sub(self.start_byte);
            let local_end = exc_end.saturating_sub(self.start_byte).min(bytes.len());
            for b in &mut bytes[local_start..local_end] {
                *b = b' ';
            }
        }
        std::borrow::Cow::Owned(buf)
    }

    /// Check whether a local byte range (relative to this prose range)
    /// overlaps with any exclusion zone.
    pub fn overlaps_exclusion(&self, local_start: u32, local_end: u32) -> bool {
        let doc_start = self.start_byte as u32 + local_start;
        let doc_end = self.start_byte as u32 + local_end;
        self.exclusions.iter().any(|&(exc_start, exc_end)| {
            let es = exc_start as u32;
            let ee = exc_end as u32;
            doc_start < ee && doc_end > es
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_markdown_extraction() -> Result<()> {
        let language: tree_sitter::Language = tree_sitter_md::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text =
            "# Header\n\nThis is a paragraph.\n\n```rust\nfn main() {}\n```\n\nAnother paragraph.";
        let ranges = extractor.extract(text, "markdown", &[])?;

        assert!(ranges.len() >= 3);

        let extracted_texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        assert!(extracted_texts.iter().any(|t| t.contains("Header")));
        assert!(
            extracted_texts
                .iter()
                .any(|t| t.contains("This is a paragraph"))
        );
        assert!(
            extracted_texts
                .iter()
                .any(|t| t.contains("Another paragraph"))
        );

        Ok(())
    }

    #[test]
    fn test_overlaps_exclusion() {
        let range = ProseRange {
            start_byte: 100,
            end_byte: 300,
            exclusions: vec![(150, 200)],
        };

        // Diagnostic entirely inside exclusion
        assert!(range.overlaps_exclusion(50, 100)); // local 50..100 = doc 150..200
        // Diagnostic partially overlapping exclusion
        assert!(range.overlaps_exclusion(40, 60)); // doc 140..160 overlaps 150..200
        assert!(range.overlaps_exclusion(90, 110)); // doc 190..210 overlaps 150..200
        // Diagnostic entirely outside exclusion
        assert!(!range.overlaps_exclusion(0, 40)); // doc 100..140, before exclusion
        assert!(!range.overlaps_exclusion(110, 130)); // doc 210..230, after exclusion
    }

    #[test]
    fn type_override_latex_in_markdown() -> Result<()> {
        let text = "\
# Title

Some intro text.

<!-- lang-check-begin type:latex -->
\\emph{Hello} world and \\textbf{bold} text.
<!-- lang-check-end -->

Final paragraph.";

        let ranges = extract_with_fallback(text, "markdown", None, None, &[])?;

        let texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // Surrounding markdown prose is preserved.
        assert!(texts.iter().any(|t| t.contains("Title")));
        assert!(texts.iter().any(|t| t.contains("intro text")));
        assert!(texts.iter().any(|t| t.contains("Final paragraph")));

        // The LaTeX region was re-extracted: the prose content from
        // \emph{Hello} and \textbf{bold} should appear in ranges.
        assert!(
            texts.iter().any(|t| t.contains("Hello")),
            "expected LaTeX extractor to produce range containing 'Hello', got: {texts:?}"
        );

        Ok(())
    }

    #[test]
    fn type_override_unknown_skipped() -> Result<()> {
        let text = "\
# Title

<!-- lang-check-begin type:foobar -->
Some content here.
<!-- lang-check-end -->

Trailing text.";

        let ranges = extract_with_fallback(text, "markdown", None, None, &[])?;

        let texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // Surrounding ranges preserved.
        assert!(texts.iter().any(|t| t.contains("Title")));
        assert!(texts.iter().any(|t| t.contains("Trailing text")));

        // The unknown-type region's base ranges were filtered out, and no
        // re-extraction happened, so "Some content" should be absent.
        assert!(
            !texts.iter().any(|t| t.contains("Some content")),
            "expected unknown type region to be skipped, got: {texts:?}"
        );

        Ok(())
    }

    #[test]
    fn type_override_preserves_surrounding() -> Result<()> {
        let text = "\
First paragraph before.

<!-- lang-check-begin type:latex -->
\\section{Test}
Some LaTeX prose.
<!-- lang-check-end -->

Last paragraph after.";

        let ranges = extract_with_fallback(text, "markdown", None, None, &[])?;

        let texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // Both surrounding paragraphs must be present and unmodified.
        assert!(
            texts.iter().any(|t| t.contains("First paragraph before")),
            "pre-region range missing: {texts:?}"
        );
        assert!(
            texts.iter().any(|t| t.contains("Last paragraph after")),
            "post-region range missing: {texts:?}"
        );

        Ok(())
    }
}
