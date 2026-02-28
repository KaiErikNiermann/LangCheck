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
use std::path::Path;
use tree_sitter::{Language, Parser};

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

    pub fn extract(&mut self, text: &str, lang_id: &str) -> Result<Vec<ProseRange>> {
        let tree = self
            .parser
            .parse(text, None)
            .ok_or_else(|| anyhow!("Failed to parse text"))?;

        let root = tree.root_node();

        match lang_id {
            "latex" => Ok(latex::extract(text, root)),
            "sweave" => Ok(sweave::extract(text, root)),
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
    extractor.extract(text, canonical_lang)
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
        let ranges = extractor.extract(text, "markdown")?;

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
}
