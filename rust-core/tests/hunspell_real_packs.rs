#![allow(clippy::pedantic)]
//! The Hunspell engine against dictionaries people actually install.
//!
//! The fixtures in the unit tests are three words long. These are the real
//! thing -- Hspell's Hebrew is 7.8 MB and 469,509 entries, and the Latin pack
//! carries two genuine defects -- and they are what the engine exists for, so
//! the format is exercised at full size rather than in miniature.
//!
//! Skipped when the packs are not installed, so a checkout without them still
//! runs the suite. `LANG_CHECK_TEST_PACKS` names the directory to look in;
//! otherwise the usual system locations are searched.

use lang_check::checker::Diagnostic;
use lang_check::engines::Engine;
use lang_check::engines::hunspell::HunspellEngine;
use lang_check::packs::PackRegistry;

fn registry() -> PackRegistry {
    std::env::var("LANG_CHECK_TEST_PACKS").map_or_else(
        |_| PackRegistry::new(),
        |dir| PackRegistry::new().with_search_path(dir),
    )
}

/// The engine, or `None` when this machine has no pack for `language`.
fn engine_for(language: &str) -> Option<HunspellEngine> {
    let registry = registry();
    if registry.resolve(language).is_err() {
        eprintln!("skipping: no {language} pack installed");
        return None;
    }
    Some(HunspellEngine::new(registry, Vec::new()))
}

/// The words a check reported, recovered from their byte spans.
async fn misspelt(engine: &mut HunspellEngine, text: &str, language: &str) -> Vec<String> {
    let found: Vec<Diagnostic> = engine.check(text, language).await.expect("check");
    found
        .iter()
        .map(|d| text[d.start_byte as usize..d.end_byte as usize].to_string())
        .collect()
}

#[tokio::test]
async fn hebrew_accepts_real_words_and_flags_typos() {
    let Some(mut engine) = engine_for("he") else {
        return;
    };
    // "This is text in Hebrew" with two deliberate doublings.
    let clean = "\u{5d6}\u{5d4}\u{5d5} \u{5d8}\u{5e7}\u{5e1}\u{5d8} \u{5d1}\u{5e2}\u{5d1}\u{5e8}\u{5d9}\u{5ea}";
    assert!(
        misspelt(&mut engine, clean, "he").await.is_empty(),
        "real Hebrew was reported as misspelt"
    );

    let typos = "\u{5d6}\u{5d4}\u{5d5}\u{5d5} \u{5d8}\u{5e7}\u{5e1}\u{5d8}\u{5d8}";
    let found = misspelt(&mut engine, typos, "he").await;
    assert_eq!(found.len(), 2, "{found:?}");
}

#[tokio::test]
async fn hebrew_offsets_land_on_the_word() {
    let Some(mut engine) = engine_for("he") else {
        return;
    };
    // Hebrew is right-to-left on screen and in logical order in the buffer,
    // so a span is only correct if it slices back to the word it named.
    let text = "\u{5d6}\u{5d4}\u{5d5} \u{5d8}\u{5e7}\u{5e1}\u{5d8}\u{5d8} \u{5d1}\u{5e2}\u{5d1}\u{5e8}\u{5d9}\u{5ea}";
    let found: Vec<Diagnostic> = engine.check(text, "he").await.unwrap();
    for d in &found {
        let slice = &text[d.start_byte as usize..d.end_byte as usize];
        assert!(
            !slice.is_empty() && !slice.contains(' '),
            "span {}..{} is not one word: {slice:?}",
            d.start_byte,
            d.end_byte
        );
    }
}

#[tokio::test]
async fn latin_accepts_caesar_and_flags_typos() {
    let Some(mut engine) = engine_for("la") else {
        return;
    };
    assert!(
        misspelt(&mut engine, "Gallia est omnis divisa in partes tres", "la")
            .await
            .is_empty(),
        "real Latin was reported as misspelt"
    );
    assert_eq!(
        misspelt(&mut engine, "Galllia diviisa parrtes", "la").await,
        vec!["Galllia", "diviisa", "parrtes"]
    );
}

#[tokio::test]
async fn a_suggestion_is_offered_for_a_near_miss() {
    let Some(mut engine) = engine_for("la") else {
        return;
    };
    let found: Vec<Diagnostic> = engine.check("Galllia", "la").await.unwrap();
    assert_eq!(found.len(), 1);
    assert!(
        found[0].suggestions.iter().any(|s| s == "Gallia"),
        "expected Gallia among {:?}",
        found[0].suggestions
    );
}

#[tokio::test]
async fn a_large_dictionary_loads_once_and_answers_fast() {
    let Some(mut engine) = engine_for("he") else {
        return;
    };
    let text = "\u{5d6}\u{5d4}\u{5d5} \u{5d8}\u{5e7}\u{5e1}\u{5d8}";

    let cold = std::time::Instant::now();
    engine.check(text, "he").await.unwrap();
    let cold = cold.elapsed();

    let warm = std::time::Instant::now();
    for _ in 0..50 {
        engine.check(text, "he").await.unwrap();
    }
    let warm = warm.elapsed() / 50;

    // The point is that the 7.8 MB parse happens once per session. Generous
    // bounds: this asserts the cache exists, not a benchmark figure.
    assert!(
        warm * 10 < cold,
        "warm check ({warm:?}) is not meaningfully faster than the cold one ({cold:?}); \
         the dictionary is being reloaded"
    );
}
