//! Tests for name detection.
//!
//! The cases with concrete suggestion lists are transcribed from a live LanguageTool 6.7
//! server and from Harper, so they pin real engine behaviour rather than invented data.

use super::*;

fn sugg(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_string()).collect()
}

/// Build a query for `token` inside `text`, locating the token automatically.
fn query<'a>(token: &'a str, text: &'a str, suggestions: &'a [String]) -> NameQuery<'a> {
    let start = text.find(token).expect("token must occur in text");
    NameQuery {
        token,
        text,
        start_byte: start,
        end_byte: start + token.len(),
        suggestions,
    }
}

fn english() -> NameFilter {
    NameFilter::new(Aggressiveness::Balanced, "en-US")
}

// ---------------------------------------------------------------- names suppressed

#[test]
fn surname_close_to_a_real_word_is_still_recognised() {
    // LanguageTool offers Hare/Hoar/Hoard at distance 1, so the orphan signal cannot
    // help here. Gazetteer + shape must carry it.
    let s = sugg(&["Hare", "Hoar", "Hoard"]);
    let verdict = english().evaluate(&query("Hoare", "The logic of Hoare is central.", &s));
    assert!(verdict.is_name, "signals: {:?}", verdict.signals);
    assert!(verdict.signals.contains(&NameSignal::Gazetteer));
    assert!(verdict.signals.contains(&NameSignal::Shape));
}

#[test]
fn surname_one_edit_from_a_variant_spelling_is_recognised() {
    let s = sugg(&["Ackerman"]);
    let verdict = english().evaluate(&query("Ackermann", "See Ackermann for details.", &s));
    assert!(verdict.is_name, "signals: {:?}", verdict.signals);
}

#[test]
fn unknown_surname_with_distant_suggestions_is_recognised() {
    // Not in the gazetteer; carried by orphan + shape.
    let s = sugg(&["Aymaran", "Beltran", "Elara"]);
    let verdict = english().evaluate(&query("Oyelaran", "The paper by Oyelaran argues.", &s));
    assert!(verdict.is_name, "signals: {:?}", verdict.signals);
    assert!(verdict.signals.contains(&NameSignal::Orphan));
}

#[test]
fn honorific_supplies_context() {
    let s = sugg(&["Nemesis"]);
    let verdict = english().evaluate(&query("Nkemdirim", "We met Dr. Nkemdirim today.", &s));
    assert!(verdict.is_name, "signals: {:?}", verdict.signals);
    assert!(verdict.signals.contains(&NameSignal::Context));
}

#[test]
fn repeated_token_gains_a_signal() {
    let text = "Szymanski proved it. Later Szymanski extended the result.";
    let s = sugg(&["Szymanowski"]);
    let verdict = english().evaluate(&query("Szymanski", text, &s));
    assert!(verdict.is_name);
    assert!(verdict.signals.contains(&NameSignal::Repetition));
}

#[test]
fn engine_offering_no_correction_counts_as_evidence() {
    let verdict = english().evaluate(&query("Bhattacharya", "As Bhattacharya notes,", &[]));
    assert!(verdict.is_name, "signals: {:?}", verdict.signals);
    assert!(verdict.signals.contains(&NameSignal::NoSuggestions));
}

// ---------------------------------------------------------------- typos preserved

#[test]
fn common_misspellings_are_never_suppressed() {
    // Every one of these is flagged by LanguageTool at distance 1-2, lowercase, in
    // running text. This is the failure mode that would destroy trust in the feature.
    let cases: &[(&str, &[&str])] = &[
        ("recieve", &["relieve", "receive"]),
        ("seperate", &["separate"]),
        ("definately", &["definitely"]),
        ("occured", &["occurred"]),
        ("adress", &["address", "dress"]),
        ("begining", &["beginning"]),
        ("enviroment", &["environment"]),
        ("succesful", &["successful"]),
        ("neccessary", &["necessary"]),
        ("similiar", &["similar"]),
        ("tommorow", &["tomorrow"]),
    ];
    let filter = english();
    for (token, suggestions) in cases {
        let text = format!("I will {token} the document later.");
        let s = sugg(suggestions);
        let verdict = filter.evaluate(&query(token, &text, &s));
        assert!(
            !verdict.is_name,
            "{token} was wrongly treated as a name (signals {:?}, score {})",
            verdict.signals, verdict.score
        );
    }
}

#[test]
fn thier_is_not_treated_as_a_name() {
    // `thier` ships in the raw crowdsourced surname lists and is pruned at build time.
    // Belt and braces: even if it were present, lowercase + distance 1 cannot reach the
    // two-signal threshold.
    assert!(
        !gazetteer_contains("thier"),
        "build-time typo subtraction regressed"
    );
    let s = sugg(&["their", "there"]);
    let verdict = english().evaluate(&query("thier", "I read thier paper.", &s));
    assert!(!verdict.is_name);
}

#[test]
fn capitalised_misspelling_of_a_real_word_is_not_suppressed() {
    // Sentence-initial, so shape gives nothing, and distance 1 gives nothing.
    let s = sugg(&["Germany"]);
    let verdict = english().evaluate(&query("Germny", "Germny is in Europe.", &s));
    assert!(!verdict.is_name, "signals: {:?}", verdict.signals);
}

#[test]
fn lowercase_jargon_is_not_a_name() {
    // Distance 2 alone is one signal; not enough.
    let s = sugg(&["fumble", "flyable", "burble"]);
    let verdict = english().evaluate(&query("flurble", "the flurble operator commutes", &s));
    assert!(!verdict.is_name, "signals: {:?}", verdict.signals);
}

#[test]
fn a_gazetteer_hit_alone_never_suppresses() {
    // "sterling" is a surname and an English word. Lowercase, mid-sentence, with a
    // close suggestion: exactly one signal, so it must survive.
    let s = sugg(&["starling"]);
    let verdict = english().evaluate(&query("sterlin", "the sterlin rate today", &s));
    assert!(!verdict.is_name);
}

// ---------------------------------------------------------------- language handling

#[test]
fn german_does_not_use_capitalisation_as_evidence() {
    // Every German noun is capitalised, so shape must not vote. "Bäcker" (baker) is
    // also a surname, and with only a gazetteer hit it must not be suppressed.
    let german = NameFilter::new(Aggressiveness::Balanced, "de-DE");
    let s = sugg(&["Backer"]);
    let verdict = german.evaluate(&query("Bäcker", "Der Bäcker hat geöffnet.", &s));
    assert!(
        !verdict.signals.contains(&NameSignal::Shape),
        "shape must not vote in German"
    );
    assert!(!verdict.is_name, "signals: {:?}", verdict.signals);
}

#[test]
fn english_capitalisation_does_vote() {
    let verdict = english().evaluate(&query("Baker", "I saw Baker yesterday.", &[]));
    assert!(verdict.signals.contains(&NameSignal::Shape));
}

// ---------------------------------------------------------------- unit-level helpers

#[test]
fn split_suggestions_are_ignored_for_distance() {
    // LanguageTool answers "Abramsky" with "Abram sky" — a word-split proposal, not
    // evidence of a misspelling. Ignoring it leaves no usable suggestion at all.
    assert_eq!(
        min_suggestion_distance("Abramsky", &sugg(&["Abram sky"])),
        None
    );
    // `recieve` -> `receive` is a single transposition under Damerau-Levenshtein, which
    // is exactly why it must not earn the orphan signal.
    assert_eq!(
        min_suggestion_distance("recieve", &sugg(&["receive"])),
        Some(1)
    );
}

#[test]
fn distance_is_case_insensitive() {
    assert_eq!(min_suggestion_distance("Hoare", &sugg(&["hoar"])), Some(1));
}

#[test]
fn morphological_bases_cover_possessive_and_genitive() {
    let bases = morphological_bases("merkels");
    assert!(bases.contains(&"merkels".to_string()));
    assert!(bases.contains(&"merkel".to_string()));

    let possessive = morphological_bases("merkel's");
    assert!(possessive.contains(&"merkel".to_string()));
}

#[test]
fn gazetteer_matches_inflected_forms() {
    assert!(gazetteer_contains("Hoare"));
    assert!(gazetteer_contains("hoare"));
    assert!(gazetteer_contains("Hoare's"));
}

#[test]
fn occurrences_counts_whole_words_only() {
    assert_eq!(occurrences("Hoare and Hoare again", "Hoare"), 2);
    assert_eq!(occurrences("Hoarefrost is not Hoare", "Hoare"), 1);
    assert_eq!(occurrences("nothing here", "Hoare"), 0);
}

#[test]
fn occurrences_terminates_on_overlapping_and_empty_input() {
    assert_eq!(occurrences("aaaa", ""), 0);
    assert_eq!(occurrences("aaaa", "aa"), 0, "not whole words");
    assert_eq!(occurrences("aa aa", "aa"), 2);
}

#[test]
fn sentence_start_detection() {
    let text = "Hello. Baker arrived.";
    assert!(starts_sentence(text, 0));
    assert!(starts_sentence(text, text.find("Baker").unwrap()));
    assert!(!starts_sentence("I saw Baker there.", 6));
}

#[test]
fn windows_respect_char_boundaries() {
    let text = "Grüße von Müller und Schröder überall";
    let start = text.find("Müller").unwrap();
    // Must not panic on multi-byte boundaries.
    let _ = preceding_window(text, start);
    let _ = following_window(text, start + "Müller".len());
}

#[test]
fn aggressiveness_changes_the_bar() {
    // Two signals scoring 3.0 total: accepted at balanced, rejected at conservative.
    let s = sugg(&["Hare"]);
    let text = "The logic of Hoare is central.";
    assert!(
        NameFilter::new(Aggressiveness::Balanced, "en-US")
            .evaluate(&query("Hoare", text, &s))
            .is_name
    );
    assert!(
        !NameFilter::new(Aggressiveness::Conservative, "en-US")
            .evaluate(&query("Hoare", text, &s))
            .is_name
    );
}

#[test]
fn verdict_reports_its_signals() {
    let verdict = english().evaluate(&query("Bhattacharya", "As Bhattacharya notes,", &[]));
    let tags = verdict.signal_tags();
    assert!(tags.contains("no-suggestions"), "tags were {tags}");
}

#[test]
fn gazetteer_loads() {
    assert!(
        GAZETTEER.is_some(),
        "embedded names.fst failed to parse — regenerate via examples/build-name-fst.rs"
    );
}
