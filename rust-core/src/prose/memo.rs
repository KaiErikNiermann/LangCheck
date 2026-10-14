//! The last extraction, kept for when the same text comes back.
//!
//! Extraction is a full parse: about 0.7 s for a megabyte of LaTeX, 0.25 s
//! for Typst. The same text is extracted again more often than not: each
//! window of a progressive check is a request with the whole document in
//! it, and a file reopened, or re-checked when a site's own spellchecker
//! answers, sends what it sent before.

use std::path::{Path, PathBuf};

use anyhow::Result;

use super::Extraction;

/// Everything besides the text that shapes an extraction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractionInputs {
    pub language: String,
    pub path: Option<PathBuf>,
    pub max_range_bytes: usize,
    pub skip_environments: Vec<String>,
    pub skip_commands: Vec<String>,
    pub schemas: u64,
}

/// One document's text and its extraction. The text is kept and compared
/// whole rather than by hash: a collision would hand one document another's
/// ranges, and comparing a megabyte costs microseconds.
#[derive(Default)]
pub struct LastExtraction {
    held: Option<(String, ExtractionInputs, Extraction)>,
}

impl LastExtraction {
    /// The extraction of `text` under `inputs`: the one held when both match,
    /// else `extract`'s, which is then held in its place. A failed
    /// extraction is not held.
    pub fn get_or_extract(
        &mut self,
        text: &str,
        inputs: ExtractionInputs,
        extract: impl FnOnce() -> Result<Extraction>,
    ) -> Result<Extraction> {
        if let Some((held_text, held_inputs, extraction)) = &self.held
            && *held_inputs == inputs
            && held_text == text
        {
            return Ok(extraction.clone());
        }
        self.held = None;
        let extraction = extract()?;
        self.held = Some((text.to_owned(), inputs, extraction.clone()));
        Ok(extraction)
    }

    /// Whether `path`'s text is the one held (for the tests).
    #[must_use]
    pub fn holds(&self, path: Option<&Path>) -> bool {
        self.held
            .as_ref()
            .is_some_and(|(_, inputs, _)| inputs.path.as_deref() == path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prose::{ProseRange, latex::LatexExtras};

    fn inputs(language: &str) -> ExtractionInputs {
        ExtractionInputs {
            language: language.to_owned(),
            path: None,
            max_range_bytes: 2048,
            skip_environments: Vec::new(),
            skip_commands: Vec::new(),
            schemas: 0,
        }
    }

    fn extract(text: &str, language: &str) -> Result<Extraction> {
        crate::prose::extract_reporting_syntax(text, language, None, None, &LatexExtras::default())
    }

    fn starts(extraction: &Extraction) -> Vec<usize> {
        extraction
            .ranges
            .iter()
            .map(|r: &ProseRange| r.start_byte)
            .collect()
    }

    #[test]
    fn the_same_text_is_extracted_once() {
        let mut memo = LastExtraction::default();
        let text = "\\section{One}\nSome prose.\n\nMore prose.";
        let mut runs = 0;
        let first = memo
            .get_or_extract(text, inputs("latex"), || {
                runs += 1;
                extract(text, "latex")
            })
            .unwrap();
        let second = memo
            .get_or_extract(text, inputs("latex"), || {
                runs += 1;
                extract(text, "latex")
            })
            .unwrap();
        assert_eq!(runs, 1);
        assert_eq!(starts(&first), starts(&second));
    }

    #[test]
    fn other_text_or_other_inputs_are_extracted_afresh() {
        let mut memo = LastExtraction::default();
        let mut runs = 0;
        let mut ask = |memo: &mut LastExtraction, text: &str, language: &str| {
            memo.get_or_extract(text, inputs(language), || {
                runs += 1;
                extract(text, language)
            })
            .unwrap()
        };
        ask(&mut memo, "Some prose.", "latex");
        let edited = ask(&mut memo, "Some prose!", "latex");
        assert_eq!(edited.ranges[0].start_byte, 0);
        ask(&mut memo, "Some prose!", "markdown");
        let mut wider = inputs("markdown");
        wider.max_range_bytes = 0;
        memo.get_or_extract("Some prose!", wider, || {
            runs += 1;
            extract("Some prose!", "markdown")
        })
        .unwrap();
        assert_eq!(runs, 4);
    }

    #[test]
    fn a_failed_extraction_is_not_held() {
        let mut memo = LastExtraction::default();
        let failed = memo.get_or_extract("text", inputs("latex"), || Err(anyhow::anyhow!("no")));
        assert!(failed.is_err());
        assert!(!memo.holds(None));
    }
}
