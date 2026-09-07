use super::{AffixAnalyzer, AffixStep, Analysis};
use crate::dictionary::Dictionary;

/// A workspace dictionary holding exactly `words`.
///
/// `Dictionary::new` has no workspace path, so `add_word` never touches disk.
fn workspace(words: &[&str]) -> Dictionary {
    let mut dict = Dictionary::new();
    for word in words {
        dict.add_word(word).expect("no path means no write");
    }
    dict
}

fn english() -> AffixAnalyzer {
    AffixAnalyzer::new("en-US")
}

/// Analyse against harper's curated dictionary alone — no workspace wordlist.
fn root_of(token: &str) -> Option<String> {
    english().analyze(token, None).map(|a| a.root)
}

#[test]
fn a_prefixed_form_resolves_to_its_stem() {
    assert_eq!(root_of("subalgebra").as_deref(), Some("algebra"));
    assert_eq!(root_of("semicontinuity").as_deref(), Some("continuity"));
    assert_eq!(root_of("counit").as_deref(), Some("unit"));
}

#[test]
fn the_hyphenated_spelling_resolves_identically() {
    assert_eq!(root_of("sub-algebra"), root_of("subalgebra"));
    assert_eq!(root_of("quasi-continuity"), root_of("quasicontinuity"));
}

#[test]
fn a_derivational_suffix_resolves_to_its_stem() {
    assert_eq!(root_of("foundedness").as_deref(), Some("founded"));
    assert_eq!(root_of("maximality").as_deref(), Some("maximal"));
    // `trans-` peels first and `finitely` is already a word, so that is the analysis.
    assert_eq!(root_of("transfinitely").as_deref(), Some("finitely"));
}

#[test]
fn a_prefix_and_a_suffix_compose() {
    // Neither half reaches `additive` alone.
    let analysis = english()
        .analyze("subadditivity", None)
        .expect("decomposes");
    assert_eq!(analysis.root, "additive");
    assert_eq!(
        analysis.steps,
        vec![AffixStep::Prefix("sub"), AffixStep::Suffix("ivity")]
    );
}

#[test]
fn a_bare_known_word_is_not_an_analysis() {
    // Nothing was affixed, so there is nothing here to report.
    assert!(english().analyze("algebra", None).is_none());
    assert!(english().analyze("read", None).is_none());
}

#[test]
fn workspace_words_serve_as_roots() {
    let dict = workspace(&["hypergraph"]);
    let analysis = english()
        .analyze("subhypergraph", Some(&dict))
        .expect("decomposes onto a user word");
    assert_eq!(analysis.root, "hypergraph");
    // Without the wordlist there is no root to reach.
    assert!(english().analyze("subhypergraph", None).is_none());
}

#[test]
fn inflectional_endings_are_not_stripped() {
    // These are the errors a checker exists to catch; generation handles the real forms.
    for wrong in ["childs", "mouses", "occured", "begining", "runned"] {
        assert!(
            english().analyze(wrong, None).is_none(),
            "{wrong} must not decompose"
        );
    }
}

#[test]
fn ly_does_not_restore_a_bare_e() {
    // `immediatly` would otherwise reach `immediate`, and it is a misspelling.
    assert!(english().analyze("immediatly", None).is_none());
    // The `le` restoration is what real `-ly` adverbs on `-le` stems need.
    assert_eq!(root_of("subtly").as_deref(), Some("subtle"));
}

#[test]
fn able_keeps_a_soft_e_where_english_does() {
    // `movable` drops the e, `noticeable` keeps it, and `noticable` is a misspelling.
    assert_eq!(root_of("movable").as_deref(), Some("move"));
    assert!(english().analyze("noticable", None).is_none());
}

#[test]
fn only_one_prefix_is_peeled() {
    // `recomend` reads as re + co + mend if two are allowed.
    assert!(english().analyze("recomend", None).is_none());
}

#[test]
fn roots_shorter_than_three_characters_are_refused() {
    // Same prefix, same shape, only the root length differs.
    assert!(
        english()
            .analyze("subab", Some(&workspace(&["ab"])))
            .is_none()
    );
    assert!(
        english()
            .analyze("subabc", Some(&workspace(&["abc"])))
            .is_some()
    );
}

#[test]
fn short_technical_stems_survive() {
    // The reason the root bound is three and not four.
    assert_eq!(root_of("subset").as_deref(), Some("set"));
    assert_eq!(root_of("coset").as_deref(), Some("set"));
}

#[test]
fn non_english_is_not_analysed() {
    let german = AffixAnalyzer::new("de-DE");
    assert!(german.analyze("subalgebra", None).is_none());
}

#[test]
fn non_ascii_tokens_are_refused() {
    // Not a judgement about the word — just outside what these rules can express.
    assert!(english().analyze("subétale", None).is_none());
    assert!(english().analyze("Grüße", None).is_none());
}

#[test]
fn a_decomposition_describes_itself() {
    let analysis = Analysis {
        root: "algebra".to_string(),
        steps: vec![AffixStep::Prefix("sub")],
    };
    assert_eq!(analysis.describe(), "sub-+algebra");
}

/// Words the notes corpus actually contains, measured as unknown to every bundled list.
///
/// This is the feature's reason to exist, so it is asserted rather than sampled.
#[test]
fn the_corpus_wins_resolve() {
    const WINS: &[&str] = &[
        "semicontinuity",
        "quasicontinuity",
        "subadditivity",
        "subderivation",
        "subuniverse",
        "subformula",
        "subterm",
        "metavariable",
        "preimage",
        "codomain",
        "coclosure",
        "counit",
        "multidegree",
        "hypergraph",
        "bilinearity",
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
        "deconstruct",
        "polydivision",
        "semimodule",
        "biconditional",
    ];

    let analyzer = english();
    let missed: Vec<&str> = WINS
        .iter()
        .copied()
        .filter(|w| analyzer.analyze(w, None).is_none())
        .collect();
    assert!(
        missed.is_empty(),
        "{} of {} corpus words did not decompose: {missed:?}",
        missed.len(),
        WINS.len()
    );
}
