#![allow(clippy::pedantic)]
//! Precision/recall harness for name detection.
//!
//! The feature trades one error for another, so it has to be measured rather than
//! eyeballed. The asymmetry is deliberate and encoded here:
//!
//! * **Hard gate** — a real misspelling that stops being reported is the failure that
//!   destroys trust in every remaining squiggle. [`typo_corpus_is_never_suppressed`] must
//!   stay at zero, and is not a threshold that should be "adjusted" if it starts failing.
//! * **Soft objective** — a name that keeps its squiggle is a minor annoyance. Recall is
//!   reported and floor-checked loosely.
//!
//! Corpora that live outside the repo (the user's real workspace dictionary) are
//! path-gated and skipped when absent, so CI stays green without them and nothing
//! private is ever committed.

use lang_check::names::{Aggressiveness, NameFilter, NameQuery};

/// Locate `token` in `text` and evaluate it.
fn verdict(filter: &NameFilter, token: &str, text: &str, suggestions: &[&str]) -> bool {
    let owned: Vec<String> = suggestions.iter().map(|s| (*s).to_string()).collect();
    let start = text
        .find(token)
        .unwrap_or_else(|| panic!("{token} must occur in the carrier text"));
    filter
        .evaluate(&NameQuery {
            token,
            text,
            start_byte: start,
            end_byte: start + token.len(),
            suggestions: &owned,
        })
        .is_name
}

fn english() -> NameFilter {
    NameFilter::new(Aggressiveness::Balanced, "en-US")
}

/// Real misspellings with the corrections an engine actually proposes, written the way a
/// person types them: lowercase, mid-sentence, in ordinary prose.
const TYPO_CORPUS: &[(&str, &[&str])] = &[
    ("recieve", &["receive", "relieve"]),
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
    ("untill", &["until"]),
    ("goverment", &["government"]),
    ("completly", &["completely"]),
    ("independant", &["independent"]),
    ("reccomend", &["recommend"]),
    ("thier", &["their", "there"]),
    ("alot", &["a lot", "allot"]),
    ("wich", &["which", "witch"]),
    ("teh", &["the"]),
    ("acheive", &["achieve"]),
    ("beleive", &["believe"]),
    ("calender", &["calendar"]),
    ("cemetary", &["cemetery"]),
    ("collegue", &["colleague"]),
    ("concious", &["conscious"]),
    ("existance", &["existence"]),
    ("foriegn", &["foreign"]),
    ("gaurd", &["guard"]),
    ("harrass", &["harass"]),
];

/// Surnames as they appear in academic prose, with realistic engine suggestions.
const NAME_CORPUS: &[(&str, &[&str])] = &[
    ("Hoare", &["Hare", "Hoar", "Hoard"]),
    ("Ackermann", &["Ackerman"]),
    ("Niermann", &["Hermann", "Neumann", "Riemann"]),
    ("Szymanski", &["Szymanowski"]),
    ("Abramsky", &[]),
    ("Oyelaran", &["Aymaran", "Beltran", "Elara"]),
    ("Jaskiewicz", &["Zolkiewicz"]),
    ("Bhattacharya", &[]),
    ("Adebayo", &["Adecco", "Adeboye"]),
    ("Nakagawa", &["Kagawa", "Kanagawa"]),
    ("Chukwuemeka", &[]),
    ("Grothendieck", &[]),
    ("Ramanujan", &[]),
    ("Okonkwo", &[]),
    ("Nkemdirim", &["Empiric"]),
    ("Vasquez", &["Vasques"]),
];

#[test]
fn typo_corpus_is_never_suppressed() {
    let filter = english();
    let mut leaked = Vec::new();

    for (typo, suggestions) in TYPO_CORPUS {
        let carrier = format!("I will {typo} the document later today.");
        if verdict(&filter, typo, &carrier, suggestions) {
            leaked.push(*typo);
        }
    }

    assert!(
        leaked.is_empty(),
        "HARD GATE FAILED — these real misspellings would be silently hidden: {leaked:?}"
    );
}

/// The same misspellings capitalised at a sentence start, where the shape signal must not
/// fire. This is the case that would otherwise slip through in title-case headings.
#[test]
fn sentence_initial_typos_are_never_suppressed() {
    let filter = english();
    let mut leaked = Vec::new();

    for (typo, suggestions) in TYPO_CORPUS {
        let capitalised = {
            let mut chars = typo.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_uppercase().collect::<String>() + chars.as_str()
            })
        };
        let carrier = format!("{capitalised} is the wrong spelling.");
        if verdict(&filter, &capitalised, &carrier, suggestions) {
            leaked.push(capitalised);
        }
    }

    assert!(
        leaked.is_empty(),
        "HARD GATE FAILED — sentence-initial misspellings hidden: {leaked:?}"
    );
}

/// Aggressive mode is allowed to be looser about names, but must still never eat a typo.
#[test]
fn aggressive_mode_still_protects_the_typo_corpus() {
    let filter = NameFilter::new(Aggressiveness::Aggressive, "en-US");
    let mut leaked = Vec::new();

    for (typo, suggestions) in TYPO_CORPUS {
        let carrier = format!("I will {typo} the document later today.");
        if verdict(&filter, typo, &carrier, suggestions) {
            leaked.push(*typo);
        }
    }

    assert!(
        leaked.is_empty(),
        "aggressive mode leaked real misspellings: {leaked:?}"
    );
}

#[test]
fn name_recall_is_reported_and_above_the_floor() {
    let filter = english();
    let (mut hit, mut missed) = (Vec::new(), Vec::new());

    for (name, suggestions) in NAME_CORPUS {
        let carrier = format!("The paper by {name} argues otherwise.");
        if verdict(&filter, name, &carrier, suggestions) {
            hit.push(*name);
        } else {
            missed.push(*name);
        }
    }

    let recall = hit.len() as f64 / NAME_CORPUS.len() as f64;
    println!(
        "name recall: {}/{} = {:.1}%",
        hit.len(),
        NAME_CORPUS.len(),
        recall * 100.0
    );
    println!("  missed: {missed:?}");

    assert!(
        recall >= 0.75,
        "name recall dropped to {recall:.2} (missed {missed:?}) — the gazetteer or the \
         signal weights regressed"
    );
}

/// Ordinary English words must never be classified as names. They are not normally
/// flagged in the first place, but a user dictionary or an unusual engine could surface
/// one, and treating it as a name would be wrong.
#[test]
fn common_words_are_not_names() {
    let filter = english();
    let words = [
        "the",
        "and",
        "because",
        "however",
        "therefore",
        "document",
        "sentence",
        "language",
        "computer",
        "keyboard",
        "morning",
        "yesterday",
        "important",
        "everything",
    ];
    for word in words {
        let carrier = format!("This is the {word} in question.");
        assert!(
            !verdict(&filter, word, &carrier, &[]),
            "{word} was classified as a name"
        );
    }
}

/// Technical jargon is out of scope: it should keep its squiggle so the user can add it
/// to the dictionary, rather than being silently mistaken for a surname.
#[test]
fn lowercase_jargon_is_not_mistaken_for_a_name() {
    let filter = english();
    let jargon: &[(&str, &[&str])] = &[
        ("kubectl", &[]),
        ("dogstatsd", &[]),
        ("pyquaternion", &[]),
        ("gitleaksignore", &[]),
        ("slerp", &["sleep", "slurp"]),
        ("memoise", &["memorise"]),
        ("hexdigest", &[]),
        ("endian", &["Indian"]),
    ];
    let mut flagged = Vec::new();
    for (token, suggestions) in jargon {
        let carrier = format!("the {token} value is cached");
        if verdict(&filter, token, &carrier, suggestions) {
            flagged.push(*token);
        }
    }
    assert!(
        flagged.is_empty(),
        "jargon treated as names: {flagged:?} — lowercase tokens with no context should \
         not reach two signals"
    );
}

/// Precision sweep over the user's real workspace dictionary, which is ~95% technical
/// jargon and identifiers rather than names.
///
/// Skipped when the corpus is absent so CI is unaffected; the file is never committed.
#[test]
fn real_workspace_dictionary_precision() {
    const CORPUS: &str =
        "/home/appulsauce/Projects/personal-code/notes/.languagecheck/dictionary.txt";

    let Ok(contents) = std::fs::read_to_string(CORPUS) else {
        eprintln!("skipping: {CORPUS} not present");
        return;
    };

    let filter = english();
    let entries: Vec<&str> = contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.contains('*'))
        .collect();

    let mut classified = Vec::new();
    for entry in &entries {
        // As they appear in the dictionary: lowercase, no context. This is the weakest
        // possible evidence, so almost nothing should reach two signals.
        let carrier = format!("the {entry} value here");
        if verdict(&filter, entry, &carrier, &[]) {
            classified.push(*entry);
        }
    }

    let rate = classified.len() as f64 / entries.len() as f64;
    println!(
        "workspace dictionary: {}/{} ({:.1}%) classified as names",
        classified.len(),
        entries.len(),
        rate * 100.0
    );
    if !classified.is_empty() {
        let sample: Vec<_> = classified.iter().take(25).collect();
        println!("  sample: {sample:?}");
    }

    assert!(
        rate < 0.10,
        "{:.1}% of a mostly-jargon dictionary was classified as names — far too eager",
        rate * 100.0
    );
}
