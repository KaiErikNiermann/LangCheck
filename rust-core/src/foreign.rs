//! Findings of checkers that are not ours.
//!
//! A host page can run its own spellchecker over the text we check (Typst's
//! and Overleaf's do), and its marks and ours land on the same words. The
//! client reads what that checker found and sends it with the check; here it
//! becomes one more engine's answer, held to the same rules as the engines':
//!
//! - Only inside the prose this check covers, and clear of its exclusions,
//!   by the test an engine's own diagnostic passes
//!   ([`ProseRange::suppresses_diagnostic`]). A host that checks the argument
//!   of `\texttt` or of an unknown command, or the domain of an email address,
//!   gets no further than our extraction lets an engine.
//! - Only where it read the word in the language we read the passage in. Typst
//!   attributes a language to the whole document while it fails to compile,
//!   and then reports every English word of a German document.
//! - Severity by category, with the user's `rules:` override, as for an
//!   engine's finding ([`crate::orchestrator::assign_severity`]).
//! - Not where an engine marked the same word under another span. The merge
//!   folds exactly equal spans into one; a host that tokenises differently
//!   (`naem's` against `naem`, a hyphenated word whole or in parts) would
//!   otherwise put a second mark of ours over the engine's, the double
//!   marking this module exists to end. The engine's span stands.
//!
//! What survives goes through the suppression pass (dictionary, ignores,
//! directives, names, identifiers) and the merge with the engines' findings
//! on the same span, by the caller. None of it is stored with the check: a
//! stored result is what the engines said, and must not change with a host's
//! worker.
//!
//! The input comes from a web page, so it is validated, not trusted: a bounded
//! count, spans inside the text on character boundaries, and plain names.

use crate::checker::{Diagnostic, ForeignCategory, ForeignFinding};
use crate::config::Config;
use crate::prose::ProseRange;

/// The most foreign findings one check takes; the rest are dropped. A page
/// with more marks than this is not a document anyone is reading.
pub const MAX_FINDINGS: usize = 10_000;

/// A checker or rule name: what goes into a rule id, so nothing that could be
/// mistaken for another part of one.
const MAX_NAME_LEN: usize = 32;

/// What a message may be before it is cut: a host's message is one sentence.
const MAX_MESSAGE_LEN: usize = 500;

/// A prose range this check covers, and the language it was checked in.
pub struct CheckedRange<'a> {
    pub range: &'a ProseRange,
    pub language: &'a str,
}

/// The diagnostics `foreign` contributes to a check of `text` covering
/// `checked`, beside the engines' `found` (document offsets, both); see the
/// module documentation.
#[must_use]
pub fn adopt(
    foreign: &[ForeignFinding],
    text: &str,
    checked: &[CheckedRange<'_>],
    found: &[Diagnostic],
    config: &Config,
) -> Vec<Diagnostic> {
    // Sorted starts of the engines' spelling findings, so each foreign one
    // looks only at those that could overlap it.
    let mut spelling: Vec<(u32, u32)> = found
        .iter()
        .filter(|d| crate::prose::is_spelling_category(&d.unified_id))
        .map(|d| (d.start_byte, d.end_byte))
        .collect();
    spelling.sort_unstable();
    let longest = spelling.iter().map(|&(s, e)| e - s).max().unwrap_or(0);
    let crossed = |d: &Diagnostic| {
        let from = spelling.partition_point(|&(s, _)| s < d.start_byte.saturating_sub(longest));
        spelling[from..]
            .iter()
            .take_while(|&&(s, _)| s < d.end_byte)
            .any(|&(s, e)| e > d.start_byte && (s, e) != (d.start_byte, d.end_byte))
    };
    foreign
        .iter()
        .take(MAX_FINDINGS)
        .filter_map(|finding| adopt_one(finding, text, checked, config))
        .filter(|d| !crossed(d))
        .collect()
}

fn adopt_one(
    finding: &ForeignFinding,
    text: &str,
    checked: &[CheckedRange<'_>],
    config: &Config,
) -> Option<Diagnostic> {
    let unified_id = match ForeignCategory::try_from(finding.category) {
        Ok(ForeignCategory::Spelling) => "spelling.typo",
        Ok(ForeignCategory::Unspecified) | Err(_) => return None,
    };
    if !is_name(&finding.checker) || !is_name(&finding.rule) {
        return None;
    }
    let (start, end) = (finding.start_byte as usize, finding.end_byte as usize);
    if start >= end
        || end > text.len()
        || !text.is_char_boundary(start)
        || !text.is_char_boundary(end)
    {
        return None;
    }
    let home = checked
        .iter()
        .find(|c| c.range.start_byte <= start && end <= c.range.end_byte)?;
    if !same_language(&finding.language, home.language) {
        return None;
    }
    let local = |offset: usize| u32::try_from(offset - home.range.start_byte).ok();
    if home
        .range
        .suppresses_diagnostic(text, local(start)?, local(end)?, unified_id)
    {
        return None;
    }

    let mut diagnostic = Diagnostic {
        start_byte: finding.start_byte,
        end_byte: finding.end_byte,
        message: message_of(finding, &text[start..end]),
        rule_id: format!("{}.{}", finding.checker, finding.rule),
        unified_id: unified_id.to_string(),
        confidence: 1.0,
        ..Diagnostic::default()
    };
    crate::orchestrator::assign_severity(config, &mut diagnostic);
    (diagnostic.severity != -1).then_some(diagnostic)
}

/// Lowercase ASCII letters, digits, `-` and `_`, as a site's or a rule's name is.
fn is_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Whether a word read in `theirs` belongs in a passage read in `ours`: the
/// same primary language (`en_US`, `en-GB` and `en` agree), or `theirs` unknown.
fn same_language(theirs: &str, ours: &str) -> bool {
    let primary = |tag: &str| {
        tag.split(['-', '_'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    theirs.is_empty() || primary(theirs) == primary(ours)
}

/// The host's message, bounded, or one naming the word and who found it.
fn message_of(finding: &ForeignFinding, word: &str) -> String {
    let message = finding.message.trim();
    if message.is_empty() {
        return format!(
            "Possible spelling mistake: \"{word}\" ({})",
            finding.checker
        );
    }
    match message.char_indices().nth(MAX_MESSAGE_LEN) {
        Some((cut, _)) => format!("{}\u{2026}", &message[..cut]),
        None => message.to_string(),
    }
}

#[cfg(test)]
#[allow(clippy::cast_possible_truncation)]
mod tests {
    use super::*;
    use crate::checker::Severity;

    const TEXT: &str = "I recieve teh parcel at \\texttt{wrod} today.";

    /// One range over the whole text, `\texttt{wrod}` excluded.
    fn range() -> ProseRange {
        let skip = TEXT.find("\\texttt").unwrap();
        let skip_end = TEXT.find(" today").unwrap();
        ProseRange {
            start_byte: 0,
            end_byte: TEXT.len(),
            exclusions: vec![(skip, skip_end)],
            language: None,
            language_span: None,
        }
    }

    fn spelling(word: &str) -> ForeignFinding {
        let start = TEXT.find(word).unwrap();
        ForeignFinding {
            checker: "typst".to_string(),
            rule: "misspelling".to_string(),
            category: ForeignCategory::Spelling as i32,
            start_byte: start as u32,
            end_byte: (start + word.len()) as u32,
            message: format!("the word \"{word}\" seems to be misspelled"),
            language: "en".to_string(),
        }
    }

    fn adopt_in(findings: &[ForeignFinding], language: &str, config: &Config) -> Vec<Diagnostic> {
        let range = range();
        adopt(
            findings,
            TEXT,
            &[CheckedRange {
                range: &range,
                language,
            }],
            &[],
            config,
        )
    }

    #[test]
    fn a_finding_in_checked_prose_becomes_a_spelling_diagnostic() {
        let found = adopt_in(&[spelling("teh")], "en-US", &Config::default());
        assert_eq!(found.len(), 1);
        let d = &found[0];
        assert_eq!(&TEXT[d.start_byte as usize..d.end_byte as usize], "teh");
        assert_eq!(d.rule_id, "typst.misspelling");
        assert_eq!(d.unified_id, "spelling.typo");
        assert_eq!(d.severity, Severity::Warning as i32);
        assert_eq!(d.message, "the word \"teh\" seems to be misspelled");
        assert_eq!(d.suggestions, Vec::<String>::new());
    }

    #[test]
    fn a_finding_inside_an_exclusion_is_dropped() {
        assert_eq!(
            adopt_in(&[spelling("wrod")], "en-US", &Config::default()),
            Vec::new()
        );
    }

    #[test]
    fn a_finding_outside_every_checked_range_is_dropped() {
        let range = range();
        let partial = ProseRange {
            end_byte: TEXT.find(" teh").unwrap(),
            ..range
        };
        let found = adopt(
            &[spelling("recieve"), spelling("teh")],
            TEXT,
            &[CheckedRange {
                range: &partial,
                language: "en",
            }],
            &[],
            &Config::default(),
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].start_byte, 2);
    }

    #[test]
    fn a_finding_read_in_another_language_is_dropped() {
        let mut german = spelling("teh");
        german.language = "de-DE".to_string();
        assert_eq!(adopt_in(&[german], "en-US", &Config::default()), Vec::new());
        let mut unknown = spelling("teh");
        unknown.language = String::new();
        assert_eq!(adopt_in(&[unknown], "en-US", &Config::default()).len(), 1);
        let mut underscored = spelling("teh");
        underscored.language = "en_US".to_string();
        assert_eq!(
            adopt_in(&[underscored], "en-GB", &Config::default()).len(),
            1
        );
    }

    #[test]
    fn spans_that_do_not_fit_the_text_are_dropped() {
        let past_end = ForeignFinding {
            end_byte: TEXT.len() as u32 + 1,
            ..spelling("today")
        };
        let empty = ForeignFinding {
            end_byte: 2,
            ..spelling("recieve")
        };
        let mid_char = {
            let text = "Größe";
            let finding = ForeignFinding {
                start_byte: 0,
                end_byte: 3,
                ..spelling("I")
            };
            assert!(!text.is_char_boundary(3));
            (text, finding)
        };
        assert_eq!(
            adopt_in(&[past_end, empty], "en", &Config::default()),
            Vec::new()
        );
        let range = ProseRange {
            start_byte: 0,
            end_byte: mid_char.0.len(),
            exclusions: Vec::new(),
            language: None,
            language_span: None,
        };
        assert_eq!(
            adopt(
                &[mid_char.1],
                mid_char.0,
                &[CheckedRange {
                    range: &range,
                    language: "en"
                }],
                &[],
                &Config::default()
            ),
            Vec::new()
        );
    }

    #[test]
    fn names_that_could_not_be_a_rule_id_are_dropped() {
        for (checker, rule) in [
            ("", "x"),
            ("Typst", "x"),
            ("typst", "a.b"),
            ("typst", &"r".repeat(33)),
        ] {
            let finding = ForeignFinding {
                checker: checker.to_string(),
                rule: rule.to_string(),
                ..spelling("teh")
            };
            assert_eq!(
                adopt_in(&[finding], "en", &Config::default()),
                Vec::new(),
                "{checker}.{rule}"
            );
        }
    }

    #[test]
    fn an_unknown_category_is_dropped() {
        let finding = ForeignFinding {
            category: ForeignCategory::Unspecified as i32,
            ..spelling("teh")
        };
        assert_eq!(
            adopt_in(std::slice::from_ref(&finding), "en", &Config::default()),
            Vec::new()
        );
        assert_eq!(
            adopt_in(
                &[ForeignFinding {
                    category: 99,
                    ..finding
                }],
                "en",
                &Config::default()
            ),
            Vec::new()
        );
    }

    #[test]
    fn a_rule_override_applies_to_foreign_findings() {
        let off: Config =
            serde_yaml::from_str("rules:\n  typst.misspelling:\n    severity: off\n").unwrap();
        assert_eq!(adopt_in(&[spelling("teh")], "en", &off), Vec::new());
        let hint: Config =
            serde_yaml::from_str("rules:\n  spelling.typo:\n    severity: hint\n").unwrap();
        assert_eq!(
            adopt_in(&[spelling("teh")], "en", &hint)[0].severity,
            Severity::Hint as i32
        );
    }

    #[test]
    fn a_bare_mark_gets_a_message_naming_the_word_and_its_checker() {
        let bare = ForeignFinding {
            message: String::new(),
            ..spelling("teh")
        };
        assert_eq!(
            adopt_in(&[bare], "en", &Config::default())[0].message,
            "Possible spelling mistake: \"teh\" (typst)"
        );
    }

    #[test]
    fn a_long_message_is_cut() {
        let long = ForeignFinding {
            message: "é".repeat(MAX_MESSAGE_LEN + 10),
            ..spelling("teh")
        };
        let message = &adopt_in(&[long], "en", &Config::default())[0].message;
        assert_eq!(message.chars().count(), MAX_MESSAGE_LEN + 1);
        assert!(message.ends_with('\u{2026}'));
    }

    #[test]
    fn at_most_max_findings_are_taken() {
        let many = vec![spelling("teh"); MAX_FINDINGS + 5];
        assert_eq!(
            adopt_in(&many, "en", &Config::default()).len(),
            MAX_FINDINGS
        );
    }

    #[test]
    fn a_finding_crossing_an_engines_spelling_span_yields_to_it() {
        let range = range();
        let engine = |start: usize, end: usize, unified: &str| Diagnostic {
            start_byte: start as u32,
            end_byte: end as u32,
            unified_id: unified.to_string(),
            ..Diagnostic::default()
        };
        let teh = TEXT.find("teh").unwrap();
        let checked = [CheckedRange {
            range: &range,
            language: "en",
        }];
        let adopt_beside = |found: &[Diagnostic]| {
            adopt(
                &[spelling("teh"), spelling("parcel")],
                TEXT,
                &checked,
                found,
                &Config::default(),
            )
            .iter()
            .map(|d| &TEXT[d.start_byte as usize..d.end_byte as usize])
            .collect::<Vec<_>>()
            .join(",")
        };
        // The engine read " teh" as its word: theirs on "teh" would sit under it.
        assert_eq!(
            adopt_beside(&[engine(teh - 1, teh + 3, "spelling.typo")]),
            "parcel"
        );
        // The same span is for the merge, not for this.
        assert_eq!(
            adopt_beside(&[engine(teh, teh + 3, "spelling.typo")]),
            "teh,parcel"
        );
        // Only spelling yields: a grammar finding over the words is another matter.
        assert_eq!(
            adopt_beside(&[engine(0, TEXT.len(), "grammar.agreement")]),
            "teh,parcel"
        );
        // A long engine span starting well before still counts.
        assert_eq!(
            adopt_beside(&[
                engine(0, teh + 1, "spelling.unknown"),
                engine(1, 2, "spelling.typo")
            ]),
            "parcel"
        );
    }
}
