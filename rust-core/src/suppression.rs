//! Shared post-check diagnostic suppression.
//!
//! Every entry point (protobuf server, LSP, CLI, background indexer) runs the same
//! suppression pass once a diagnostic has been produced. Keeping it here means the four
//! paths cannot drift apart — previously the user-dictionary check existed only in the
//! server and LSP paths, so `language-check check` reported spelling errors for words the
//! user had explicitly whitelisted.
//!
//! Ordering requirements for callers:
//! - diagnostic offsets must already be rebased to **document** coordinates, so `text` is
//!   the whole document and surrounding context is visible;
//! - `unified_id` must already be populated (only [`crate::orchestrator::Orchestrator`]
//!   does that), since the spelling check keys on it.

use crate::checker::Diagnostic;
use crate::dictionary::Dictionary;
use crate::hashing::{DiagnosticFingerprint, IgnoreStore};
use crate::names::{NameFilter, NameQuery, NameVerdict};
use crate::prose::is_spelling_category;
use crate::text_util::safe_slice;

/// The suppression sources available at a given call site.
///
/// Each is optional because the entry points differ in what they have: the CLI has no
/// ignore store, and the name filter is only present when the user opts in.
#[derive(Default, Clone, Copy)]
pub struct SuppressionContext<'a> {
    pub ignore: Option<&'a IgnoreStore>,
    pub dictionary: Option<&'a Dictionary>,
    pub names: Option<&'a NameFilter>,
}

impl<'a> SuppressionContext<'a> {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            ignore: None,
            dictionary: None,
            names: None,
        }
    }

    #[must_use]
    pub const fn with_ignore(mut self, ignore: &'a IgnoreStore) -> Self {
        self.ignore = Some(ignore);
        self
    }

    #[must_use]
    pub const fn with_dictionary(mut self, dictionary: &'a Dictionary) -> Self {
        self.dictionary = Some(dictionary);
        self
    }

    #[must_use]
    pub const fn with_names(mut self, names: &'a NameFilter) -> Self {
        self.names = Some(names);
        self
    }
}

/// What the suppression pass decided about one diagnostic.
enum Outcome {
    /// Show it.
    Keep,
    /// Drop it (ignore store or user dictionary).
    Drop,
    /// Drop it because the token is a human name.
    DropAsName(NameVerdict),
}

/// The single decision point. Both public entry points route through this so the four
/// call sites cannot diverge again.
fn classify(diagnostic: &Diagnostic, text: &str, ctx: &SuppressionContext<'_>) -> Outcome {
    if let Some(ignore) = ctx.ignore {
        let fingerprint = DiagnosticFingerprint::new(
            &diagnostic.message,
            text,
            diagnostic.start_byte as usize,
            diagnostic.end_byte as usize,
        );
        if ignore.is_ignored(&fingerprint) {
            return Outcome::Drop;
        }
    }

    if !is_spelling_category(&diagnostic.unified_id) {
        return Outcome::Keep;
    }

    let word = safe_slice(
        text,
        diagnostic.start_byte as usize,
        diagnostic.end_byte as usize,
    );

    if let Some(dictionary) = ctx.dictionary
        && dictionary.contains(word)
    {
        return Outcome::Drop;
    }

    let Some(filter) = ctx.names else {
        return Outcome::Keep;
    };
    let verdict = filter.evaluate(&NameQuery {
        token: word,
        text,
        start_byte: diagnostic.start_byte as usize,
        end_byte: diagnostic.end_byte as usize,
        suggestions: &diagnostic.suggestions,
    });
    if verdict.is_name {
        Outcome::DropAsName(verdict)
    } else {
        Outcome::Keep
    }
}

/// Whether `diagnostic` should be dropped before reaching the user.
///
/// `text` is the full document; `diagnostic`'s offsets must index into it.
#[must_use]
pub fn should_suppress(diagnostic: &Diagnostic, text: &str, ctx: &SuppressionContext<'_>) -> bool {
    !matches!(classify(diagnostic, text, ctx), Outcome::Keep)
}

/// A span the name filter recognised, for the inspector.
#[derive(Debug, Clone)]
pub struct DetectedName {
    pub start_byte: u32,
    pub end_byte: u32,
    pub confidence: f32,
    pub signals: String,
}

/// Drop suppressed diagnostics, reporting any dropped because they were names.
///
/// The report exists so the inspector can show exactly what the filter silenced and on
/// what evidence — without it the feature is invisible and undebuggable. Call sites that
/// don't surface it simply discard the return value.
pub fn retain_visible(
    diagnostics: &mut Vec<Diagnostic>,
    text: &str,
    ctx: &SuppressionContext<'_>,
) -> Vec<DetectedName> {
    let mut detected = Vec::new();
    diagnostics.retain(|d| match classify(d, text, ctx) {
        Outcome::Keep => true,
        Outcome::Drop => false,
        Outcome::DropAsName(verdict) => {
            detected.push(DetectedName {
                start_byte: d.start_byte,
                end_byte: d.end_byte,
                confidence: verdict.score,
                signals: verdict.signal_tags(),
            });
            false
        }
    });
    detected
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spelling_diagnostic(start: u32, end: u32) -> Diagnostic {
        Diagnostic {
            start_byte: start,
            end_byte: end,
            message: "Possible spelling mistake found.".to_string(),
            suggestions: vec![],
            rule_id: "languagetool.MORFOLOGIK_RULE_EN_US".to_string(),
            severity: 2,
            unified_id: "spelling.typo".to_string(),
            confidence: 1.0,
        }
    }

    #[test]
    fn empty_context_suppresses_nothing() {
        let text = "Ackermann wrote this.";
        let d = spelling_diagnostic(0, 9);
        assert!(!should_suppress(&d, text, &SuppressionContext::new()));
    }

    #[test]
    fn dictionary_word_is_suppressed() {
        let text = "Ackermann wrote this.";
        let mut dict = Dictionary::new();
        dict.add_word("ackermann").unwrap();
        let ctx = SuppressionContext::new().with_dictionary(&dict);
        assert!(should_suppress(&spelling_diagnostic(0, 9), text, &ctx));
    }

    #[test]
    fn dictionary_lookup_is_case_insensitive() {
        let text = "ACKERMANN wrote this.";
        let mut dict = Dictionary::new();
        dict.add_word("Ackermann").unwrap();
        let ctx = SuppressionContext::new().with_dictionary(&dict);
        assert!(should_suppress(&spelling_diagnostic(0, 9), text, &ctx));
    }

    #[test]
    fn dictionary_does_not_suppress_non_spelling_diagnostics() {
        let text = "Ackermann wrote this.";
        let mut dict = Dictionary::new();
        dict.add_word("ackermann").unwrap();
        let mut d = spelling_diagnostic(0, 9);
        d.unified_id = "grammar.agreement".to_string();
        let ctx = SuppressionContext::new().with_dictionary(&dict);
        assert!(!should_suppress(&d, text, &ctx));
    }

    #[test]
    fn multibyte_spans_do_not_panic() {
        let text = "Grüße von Müller.";
        let mut dict = Dictionary::new();
        dict.add_word("müller").unwrap();
        let start = text.find("Müller").unwrap() as u32;
        let ctx = SuppressionContext::new().with_dictionary(&dict);
        // "Müller" is 7 bytes because of the umlaut.
        assert!(should_suppress(
            &spelling_diagnostic(start, start + 7),
            text,
            &ctx
        ));
    }

    #[test]
    fn retain_visible_drops_only_suppressed() {
        let text = "Ackermann met Hoare.";
        let mut dict = Dictionary::new();
        dict.add_word("ackermann").unwrap();
        let ctx = SuppressionContext::new().with_dictionary(&dict);

        let hoare_start = text.find("Hoare").unwrap() as u32;
        let mut diagnostics = vec![
            spelling_diagnostic(0, 9),
            spelling_diagnostic(hoare_start, hoare_start + 5),
        ];
        retain_visible(&mut diagnostics, text, &ctx);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].start_byte, hoare_start);
    }
}
