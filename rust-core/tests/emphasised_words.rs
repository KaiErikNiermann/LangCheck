#![allow(clippy::pedantic)]
//! A misspelling inside inline emphasis still gets reported.
//!
//! Excluding the emphasis delimiters, so `_réception_` stops reaching
//! `LanguageTool` as one token and coming back a French misspelling, moved the
//! word next to a skip with no character between -- which the exclusion
//! adjacency rule reads as "blanking split a word into a fragment" and drops.
//! The result was worse than the bug it fixed: every emphasised word in a
//! Markdown or Typst document was silently unchecked.
//!
//! Extraction tests could not see it. The text handed to the engines was right
//! in both cases; the diagnostic was thrown away afterwards. So this drives the
//! shipped binary and asserts on what the user is shown.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Harper alone: no server, no network, and it flags the typo on its own.
fn workspace() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "lang_check_emphasis_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(".languagecheck.yaml"),
        "engines:\n  harper:\n    enabled: true\n  languagetool:\n    enabled: false\n  spell_language: en-US\nrules:\n  typography.capitalization:\n    severity: \"off\"\n",
    )
    .unwrap();
    dir
}

/// The words the CLI reported a spelling diagnostic on.
fn misspellings(dir: &Path, name: &str, contents: &str, lang: &str) -> Vec<String> {
    std::fs::write(dir.join(name), contents).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(dir)
        .args(["check", name, "--lang", lang, "--format", "json"])
        .output()
        .expect("run language-check");
    let stdout = String::from_utf8(output.stdout).expect("utf8");
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|e| panic!("JSON from {name}: {e}\n--- stdout ---\n{stdout}"));

    parsed
        .as_array()
        .expect("an array of diagnostics")
        .iter()
        .filter(|d| {
            d.get("unified_id").and_then(serde_json::Value::as_str) == Some("spelling.typo")
        })
        .map(|d| {
            // The CLI reports a position, so recover the word from the source.
            let line = d.get("line").and_then(serde_json::Value::as_u64).unwrap() as usize;
            let column = d.get("column").and_then(serde_json::Value::as_u64).unwrap() as usize;
            contents
                .lines()
                .nth(line - 1)
                .unwrap_or_default()
                .chars()
                .skip(column - 1)
                .take_while(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .collect()
}

#[test]
fn a_misspelling_inside_markdown_emphasis_is_reported() {
    let dir = workspace();
    assert_eq!(
        misspellings(&dir, "emph.md", "A _deliberatly_ wrong word.\n", "markdown"),
        vec!["deliberatly"]
    );
}

#[test]
fn a_misspelling_inside_markdown_strong_emphasis_is_reported() {
    let dir = workspace();
    assert_eq!(
        misspellings(
            &dir,
            "strong.md",
            "A **deliberatly** wrong word.\n",
            "markdown"
        ),
        vec!["deliberatly"]
    );
}

#[test]
fn a_misspelling_inside_typst_emphasis_is_reported() {
    let dir = workspace();
    assert_eq!(
        misspellings(&dir, "emph.typ", "A _deliberatly_ wrong word.\n", "typst"),
        vec!["deliberatly"]
    );
}

#[test]
fn a_correctly_spelled_emphasised_word_is_not_reported() {
    let dir = workspace();
    // The delimiters must not reach the speller: `_reception_` sent whole is
    // what started this, reported with `_ reception` among its suggestions.
    assert!(
        misspellings(&dir, "clean.md", "A _reception_ was held.\n", "markdown").is_empty(),
        "an emphasised word that is spelled correctly must not be reported"
    );
}

#[test]
fn code_and_urls_inside_a_sentence_are_not_spell_checked() {
    let dir = workspace();
    let source = "Call `recieve` from <https://exmaple.org/teh> now.\n";
    assert!(
        misspellings(&dir, "code.md", source, "markdown").is_empty(),
        "inline code and link targets are not prose"
    );
}

#[test]
fn a_links_text_is_still_spell_checked() {
    let dir = workspace();
    assert_eq!(
        misspellings(
            &dir,
            "link.md",
            "See [the deliberatly wrong guide](https://example.org/x).\n",
            "markdown"
        ),
        vec!["deliberatly"]
    );
}
