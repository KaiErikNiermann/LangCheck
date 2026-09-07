#![allow(clippy::pedantic)]
//! Precision/recall harness for morphological acceptance.
//!
//! The asymmetry is the same one [`name_detection`] encodes, and for the same reason:
//!
//! * **Hard gate** — a real misspelling that stops being reported destroys trust in
//!   every remaining squiggle. [`typo_corpus_is_never_suppressed`] must stay at zero and
//!   is not a threshold to be relaxed if it starts failing.
//! * **Soft objective** — a coined word that keeps its squiggle is a minor annoyance.
//!   Recall is reported and floor-checked loosely.
//!
//! These tests drive the real suppression path rather than the analyzer directly, because
//! the analyzer on its own is *known* to accept about 1% of typos; what is being gated is
//! the analyzer together with the suggestion check that vetoes it.
//!
//! Corpora that live outside the repo are path-gated and skipped when absent, so CI stays
//! green without them and nothing private is ever committed.

mod common;

use common::TYPO_CORPUS;
use lang_check::checker::Diagnostic;
use lang_check::dictionary::Dictionary;
use lang_check::morphology::AffixAnalyzer;
use lang_check::suppression::{SuppressionContext, should_suppress};

/// A spelling diagnostic over the whole of `text`, carrying `suggestions`.
fn spelling(text: &str, suggestions: &[&str]) -> Diagnostic {
    Diagnostic {
        start_byte: 0,
        end_byte: text.len() as u32,
        message: "Possible spelling mistake found.".to_string(),
        suggestions: suggestions.iter().map(|s| (*s).to_string()).collect(),
        rule_id: "languagetool.MORFOLOGIK_RULE_EN_US".to_string(),
        severity: 2,
        unified_id: "spelling.typo".to_string(),
        confidence: 1.0,
    }
}

/// Whether the full suppression pass silences `token`.
fn suppressed(dict: &Dictionary, token: &str, suggestions: &[&str]) -> bool {
    let analyzer = AffixAnalyzer::new("en-US");
    let ctx = SuppressionContext::new()
        .with_dictionary(dict)
        .with_morphology(&analyzer);
    should_suppress(&spelling(token, suggestions), token, &ctx)
}

/// Whether the pass silences `token` with morphology switched off.
///
/// The baseline the feature has to beat. Without it a measurement over a real dictionary
/// just reports how much of it the bundled wordlists already carried.
fn suppressed_without_morphology(dict: &Dictionary, token: &str, suggestions: &[&str]) -> bool {
    let ctx = SuppressionContext::new().with_dictionary(dict);
    should_suppress(&spelling(token, suggestions), token, &ctx)
}

/// The bundled wordlists, inflected — what a user gets out of the box.
fn bundled() -> Dictionary {
    let mut dict = Dictionary::new();
    dict.load_bundled();
    dict.derive_inflections();
    dict
}

/// The bundled wordlists as they were before this feature: exact matching only.
fn bundled_without_inflections() -> Dictionary {
    let mut dict = Dictionary::new();
    dict.load_bundled();
    dict
}

/// Words the notes corpus contains that no bundled list carries.
const COINAGES: &[&str] = &[
    "semicontinuity",
    "quasicontinuity",
    "subadditivity",
    "subderivation",
    "subderivations",
    "subuniverse",
    "subuniverses",
    "subformula",
    "subformulas",
    "subterm",
    "subterms",
    "metavariable",
    "metavariables",
    "preimage",
    "preimages",
    "codomain",
    "codomains",
    "coclosure",
    "counit",
    "multidegree",
    "multidegrees",
    "hypergraph",
    "hypergraphs",
    "bilinearity",
    "bilinearly",
    "foundedness",
    "definedness",
    "closedness",
    "algebraicity",
    "maximality",
    "transfinitely",
    "definitionally",
    "nonunit",
    "preadditive",
    "subcollection",
    "postcomposition",
    "biconditional",
    "biconditionals",
    "semimodule",
    "polydivision",
];

#[test]
fn typo_corpus_is_never_suppressed() {
    let dict = bundled();
    let leaked: Vec<&str> = TYPO_CORPUS
        .iter()
        .filter(|(typo, suggestions)| suppressed(&dict, typo, suggestions))
        .map(|(typo, _)| *typo)
        .collect();

    assert!(
        leaked.is_empty(),
        "{} real misspellings were silenced: {leaked:?}",
        leaked.len()
    );
}

#[test]
fn typos_are_still_reported_when_the_engine_offers_nothing() {
    // The weakest case for the guard: no suggestions at all, so only the analyzer's own
    // structure stands between a misspelling and silence.
    let dict = bundled();
    let leaked: Vec<&str> = TYPO_CORPUS
        .iter()
        .filter(|(typo, _)| suppressed(&dict, typo, &[]))
        .map(|(typo, _)| *typo)
        .collect();

    // This is a report, not a gate: without suggestions there is genuinely less
    // evidence, and the number is what tells us how much the guard is carrying.
    println!(
        "without suggestions: {}/{} typos silenced {leaked:?}",
        leaked.len(),
        TYPO_CORPUS.len()
    );
    let rate = leaked.len() as f64 / TYPO_CORPUS.len() as f64;
    assert!(rate < 0.10, "{:.1}% is too many", rate * 100.0);
}

#[test]
fn coinage_recall_is_reported_and_above_the_floor() {
    let dict = bundled();
    // A coined word an engine cannot correct: no suggestions, which is the realistic
    // case for domain vocabulary.
    let accepted = COINAGES
        .iter()
        .filter(|word| suppressed(&dict, word, &[]))
        .count();
    let missed: Vec<&&str> = COINAGES
        .iter()
        .filter(|word| !suppressed(&dict, word, &[]))
        .collect();

    let recall = accepted as f64 / COINAGES.len() as f64;
    println!(
        "coinage recall: {accepted}/{} ({:.0}%) missed: {missed:?}",
        COINAGES.len(),
        recall * 100.0
    );
    assert!(recall >= 0.75, "recall fell to {:.0}%", recall * 100.0);
}

#[test]
fn an_unknown_root_is_not_rescued_by_its_prefix() {
    // The residue constraint is the whole safety argument: `sub` + nonsense is nonsense.
    let dict = bundled();
    for word in ["subxyzzy", "quasiblorp", "nonfrobnitz"] {
        assert!(!suppressed(&dict, word, &[]), "{word} was silenced");
    }
}

/// The user's real workspace dictionary, if this machine has one.
///
/// Skipped when the corpus is absent so CI is unaffected; the file is never committed.
#[test]
fn real_workspace_dictionary_entries_become_unnecessary() {
    const CORPUS: &str =
        "/home/appulsauce/Projects/personal-code/notes/.languagecheck/dictionary.txt";

    let Ok(contents) = std::fs::read_to_string(CORPUS) else {
        eprintln!("skipping: {CORPUS} not present");
        return;
    };

    let entries: Vec<&str> = contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.contains('*'))
        .collect();

    // Deliberately without the user's own dictionary loaded: the question is which of
    // those entries the feature makes unnecessary.
    let before = bundled_without_inflections();
    let after = bundled();

    // Only entries the bundled lists did not already carry can be "newly" covered, and
    // they are the only ones the user had a reason to add.
    let needed: Vec<&str> = entries
        .iter()
        .filter(|entry| !suppressed_without_morphology(&before, entry, &[]))
        .copied()
        .collect();
    let now_covered: Vec<&str> = needed
        .iter()
        .filter(|entry| suppressed(&after, entry, &[]))
        .copied()
        .collect();

    let rate = now_covered.len() as f64 / needed.len() as f64;
    println!(
        "workspace dictionary: {} entries, {} not already covered by the bundled lists, \
         of which {} ({:.1}%) would no longer need an entry",
        entries.len(),
        needed.len(),
        now_covered.len(),
        rate * 100.0
    );
    println!("  sample: {:?}", &now_covered[..now_covered.len().min(30)]);

    assert!(
        rate > 0.05,
        "only {:.1}% of a real dictionary was covered — the affix tables have regressed",
        rate * 100.0
    );
}
