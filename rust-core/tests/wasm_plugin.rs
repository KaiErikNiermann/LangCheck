use lang_check::engines::{Engine, WasmEngine};

const WASM_BYTES: &[u8] = include_bytes!("../../plugins/wordiness-check/wordiness-check.wasm");

fn engine() -> WasmEngine {
    WasmEngine::from_bytes("wordiness-check".into(), WASM_BYTES)
        .expect("failed to load wordiness-check WASM plugin")
}

#[tokio::test]
async fn detects_single_wordy_phrase() {
    let mut eng = engine();
    let diags = eng
        .check("In order to succeed, you must try.", "markdown")
        .await
        .unwrap();

    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(d.start_byte, 0);
    assert_eq!(d.end_byte, 11);
    assert_eq!(d.suggestions, vec!["to"]);
    assert_eq!(d.rule_id, "wasm.wordiness-check.wordiness");
}

#[tokio::test]
async fn detects_multiple_wordy_phrases() {
    let mut eng = engine();
    let text = "In order to proceed, at this point in time we need a large number of items.";
    let diags = eng.check(text, "markdown").await.unwrap();

    assert_eq!(diags.len(), 3);

    let suggestions: Vec<&str> = diags.iter().map(|d| d.suggestions[0].as_str()).collect();
    assert_eq!(suggestions, vec!["to", "now", "many"]);
}

#[tokio::test]
async fn case_insensitive_matching() {
    let mut eng = engine();
    let diags = eng
        .check("Due To The Fact That it rained, we stayed.", "markdown")
        .await
        .unwrap();

    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].suggestions, vec!["because"]);
}

#[tokio::test]
async fn respects_word_boundaries() {
    let mut eng = engine();
    // "disorder" contains "in order" but should not match
    let diags = eng
        .check("The disorder was severe.", "markdown")
        .await
        .unwrap();

    assert!(diags.is_empty(), "should not match inside words");
}

#[tokio::test]
async fn clean_text_returns_empty() {
    let mut eng = engine();
    let diags = eng
        .check("This is clean, concise text.", "markdown")
        .await
        .unwrap();

    assert!(diags.is_empty());
}

#[tokio::test]
async fn offsets_are_byte_accurate() {
    let mut eng = engine();
    let text = "We should take into consideration all the options.";
    let diags = eng.check(text, "markdown").await.unwrap();

    assert_eq!(diags.len(), 1);
    let d = &diags[0];
    assert_eq!(
        &text[d.start_byte as usize..d.end_byte as usize],
        "take into consideration"
    );
    assert_eq!(d.suggestions, vec!["consider"]);
}

#[tokio::test]
async fn rule_id_has_wasm_prefix() {
    let mut eng = engine();
    let diags = eng.check("In order to test.", "markdown").await.unwrap();

    assert_eq!(diags.len(), 1);
    assert!(
        diags[0].rule_id.starts_with("wasm.wordiness-check."),
        "rule_id should be namespaced: {}",
        diags[0].rule_id
    );
}
