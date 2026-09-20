#![allow(clippy::pedantic)]
//! Config in, diagnostics out, through the shipped binary.
//!
//! The unit tests exercise resolution, validation and the engine separately.
//! This is the chain a user actually runs: a `.languagecheck.yaml` naming a
//! language and a dictionary path, a document declaring that language, and a
//! check that has to route the right range to the right pack and report the
//! byte span of a word in a script the rest of the file is not written in.

use std::path::{Path, PathBuf};
use std::process::Command;

/// A workspace with a config, plus a dictionary directory beside it.
fn workspace(config: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("temp dir");
    let packs = dir.path().join("packs");
    std::fs::create_dir_all(&packs).unwrap();
    // Forward slashes even on Windows: a backslash inside a double-quoted
    // YAML scalar is an escape sequence, so `C:\Users\...` arrives mangled and
    // the pack is never found. Windows accepts either separator.
    let config = config.replace("{PACKS}", &packs.to_string_lossy().replace('\\', "/"));
    std::fs::write(dir.path().join(".languagecheck.yaml"), config).unwrap();
    (dir, packs)
}

/// A small but real pack: the affix file is valid and the word list is ours.
fn write_pack(dir: &Path, stem: &str, words: &[&str]) {
    std::fs::write(dir.join(format!("{stem}.aff")), "SET UTF-8\n").unwrap();
    let mut body = format!("{}\n", words.len());
    for word in words {
        body.push_str(word);
        body.push('\n');
    }
    std::fs::write(dir.join(format!("{stem}.dic")), body).unwrap();
}

/// Run the CLI in `dir` and return the reported diagnostics as JSON.
fn check(dir: &Path, name: &str, contents: &str, lang: &str) -> serde_json::Value {
    std::fs::write(dir.join(name), contents).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(dir)
        .args(["check", name, "--lang", lang, "--format", "json"])
        .output()
        .expect("run language-check");
    let stdout = String::from_utf8(output.stdout).expect("utf8");
    serde_json::from_str(&stdout)
        .unwrap_or_else(|e| panic!("JSON from {name}: {e}\n--- stdout ---\n{stdout}"))
}

/// The rule ids reported, in order.
fn rules(found: &serde_json::Value) -> Vec<String> {
    found
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|d| d.get("rule_id").and_then(|r| r.as_str()))
        .map(str::to_string)
        .collect()
}

const HEBREW_CONFIG: &str = "\
engines:
  harper:
    enabled: false
  languagetool:
    enabled: false
  hunspell:
    enabled: true
    languages: [\"he\"]
    search_paths: [\"{PACKS}\"]
  spell_language: en-US
";

#[test]
fn a_configured_pack_checks_the_language_that_declares_it() {
    let (dir, packs) = workspace(HEBREW_CONFIG);
    // "shalom" is in the dictionary; "shalomm" is not.
    write_pack(&packs, "he_IL", &["\u{5e9}\u{5dc}\u{5d5}\u{5dd}"]);

    let document = "English prose here.\n\n\
                    <!-- lang-check-begin lang:he -->\n\
                    \u{5e9}\u{5dc}\u{5d5}\u{5dd} \u{5e9}\u{5dc}\u{5d5}\u{5dd}\u{5dd}\n\
                    <!-- lang-check-end -->\n";
    let found = check(dir.path(), "doc.md", document, "markdown");

    // The English line has no engine behind it in this config -- Harper and
    // LanguageTool are off and Hunspell was given Hebrew only -- so it is
    // correctly reported as unchecked. What matters here is the Hebrew.
    let hunspell: Vec<&serde_json::Value> = found
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| d.get("rule_id").and_then(|r| r.as_str()) == Some("hunspell.spelling"))
        .collect();
    assert_eq!(
        hunspell.len(),
        1,
        "expected one Hunspell report, got {found}"
    );

    // It must name the misspelt word and not the correct one beside it, and
    // point at the line the Hebrew is on rather than the English above it.
    let d = hunspell[0];
    assert_eq!(d.get("line").and_then(serde_json::Value::as_u64), Some(4));
    let message = d
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or_default();
    assert!(
        message.contains("\u{5e9}\u{5dc}\u{5d5}\u{5dd}\u{5dd}"),
        "the report does not name the misspelt word: {message}"
    );
    assert_eq!(
        d.get("unified_id").and_then(|u| u.as_str()),
        Some("spelling.typo"),
        "a Hunspell miss must normalise like every other spelling report, \
         or the user dictionary and the name filter stop applying to it"
    );
}

#[test]
fn english_prose_is_left_to_the_english_engines() {
    // `languages: ["he"]` means Hunspell answers for Hebrew and nothing else,
    // so the English half of the document is not judged against a Hebrew
    // wordlist -- which would report every word in it.
    let (dir, packs) = workspace(HEBREW_CONFIG);
    write_pack(&packs, "he_IL", &["\u{5e9}\u{5dc}\u{5d5}\u{5dd}"]);

    let found = check(
        dir.path(),
        "en.md",
        "Perfectly ordinary English prose.\n",
        "markdown",
    );
    assert!(
        !rules(&found).iter().any(|r| r.starts_with("hunspell.")),
        "Hunspell answered for a language it was not given: {found}"
    );
}

#[test]
fn a_declared_language_with_no_pack_is_reported_as_unchecked() {
    // No pack for Latin anywhere, so the passage is named rather than passing
    // as clean -- and the engine is not marked down for not having one.
    let (dir, packs) = workspace(
        "\
engines:
  harper:
    enabled: false
  languagetool:
    enabled: false
  hunspell:
    enabled: true
    languages: [\"la\"]
    search_paths: [\"{PACKS}\"]
  spell_language: en-US
",
    );
    write_pack(&packs, "he_IL", &["\u{5e9}\u{5dc}\u{5d5}\u{5dd}"]);

    let document =
        "<!-- lang-check-begin lang:la -->\nGallia est omnis divisa.\n<!-- lang-check-end -->\n";
    let found = check(dir.path(), "la.md", document, "markdown");
    assert_eq!(rules(&found), vec!["languagecheck.no-provider"], "{found}");
}

#[test]
fn a_dictionary_path_override_is_the_pack_that_gets_used() {
    let (dir, packs) = workspace(
        "\
engines:
  harper:
    enabled: false
  languagetool:
    enabled: false
  hunspell:
    enabled: true
    languages: [\"he\"]
    search_paths: [\"{PACKS}\"]
    dictionary_paths:
      he: \"{PACKS}/preferred\"
  spell_language: en-US
",
    );
    // The searched pack knows the word; the override's does not. If the
    // override is honoured, the word is reported.
    write_pack(&packs, "he_IL", &["\u{5e9}\u{5dc}\u{5d5}\u{5dd}"]);
    let preferred = packs.join("preferred");
    std::fs::create_dir_all(&preferred).unwrap();
    write_pack(&preferred, "he_IL", &["\u{5d0}\u{5d7}\u{5e8}"]);

    let document = "<!-- lang-check-begin lang:he -->\n\u{5e9}\u{5dc}\u{5d5}\u{5dd}\n<!-- lang-check-end -->\n";
    let found = check(dir.path(), "over.md", document, "markdown");
    assert_eq!(
        rules(&found),
        vec!["hunspell.spelling"],
        "the override was not the pack consulted: {found}"
    );
}

#[test]
fn the_engine_stays_off_until_the_config_turns_it_on() {
    let (dir, packs) = workspace(
        "\
engines:
  harper:
    enabled: false
  languagetool:
    enabled: false
  spell_language: en-US
",
    );
    write_pack(&packs, "he_IL", &["\u{5e9}\u{5dc}\u{5d5}\u{5dd}"]);
    let document = "<!-- lang-check-begin lang:he -->\n\u{5e9}\u{5dc}\u{5d5}\u{5dd}\u{5dd}\n<!-- lang-check-end -->\n";
    let found = check(dir.path(), "off.md", document, "markdown");
    assert!(
        !rules(&found).iter().any(|r| r.starts_with("hunspell.")),
        "a disabled engine answered: {found}"
    );
}
