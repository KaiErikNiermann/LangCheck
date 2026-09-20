#![allow(clippy::pedantic)]
//! An engine may only answer for what it declares.
//!
//! Before this, `supported_languages()` returned `Vec<&'static str>`, which
//! nothing configurable could fill, so an external provider or a WASM plugin
//! claimed every language. Claiming one is not free: it makes `engines_ran`
//! non-zero, which suppresses the diagnostic saying nothing could check the
//! passage -- so a user with any provider configured silently lost that report
//! for every language, and with it the offer to install a dictionary.
//!
//! These drive the shipped binary, because the bug was only visible in what
//! the user was shown.

use std::path::Path;
use std::process::Command;

/// A provider that answers nothing, so the only thing under test is whether it
/// was consulted at all.
const SILENT_PROVIDER: &str =
    "#!/usr/bin/env python3\nimport json, sys\njson.load(sys.stdin)\njson.dump([], sys.stdout)\n";

fn workspace(config: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    let script = dir.path().join("provider.py");
    std::fs::write(&script, SILENT_PROVIDER).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    // Forward slashes: a backslash in a double-quoted YAML scalar is an escape.
    let command = script.to_string_lossy().replace('\\', "/");
    std::fs::write(
        dir.path().join(".languagecheck.yaml"),
        config.replace("{COMMAND}", &command),
    )
    .unwrap();
    dir
}

fn rules(dir: &Path, name: &str, contents: &str, lang: &str) -> Vec<String> {
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
        .expect("array")
        .iter()
        .filter_map(|d| d.get("rule_id").and_then(|r| r.as_str()))
        .map(str::to_string)
        .collect()
}

/// A document whose only prose is Hebrew, which nothing here can read.
const HEBREW: &str =
    "<!-- lang-check-begin lang:he -->\n\u{5e9}\u{5dc}\u{5d5}\u{5dd}\n<!-- lang-check-end -->\n";

const BASE: &str = "\
engines:
  harper:
    enabled: false
  languagetool:
    enabled: false
  spell_language: en-US
";

#[test]
fn a_provider_that_declares_a_language_does_not_claim_the_others() {
    // The bug, as it was reported: with an English-only provider configured,
    // the Hebrew passage came back "No issues found".
    let dir = workspace(&format!(
        "{BASE}  external:\n    - name: english-only\n      command: \"{{COMMAND}}\"\n      languages: [\"en\"]\n"
    ));
    assert_eq!(
        rules(dir.path(), "he.md", HEBREW, "markdown"),
        vec!["languagecheck.no-provider"],
        "an English-only provider must not claim Hebrew"
    );
}

#[test]
fn a_provider_declaring_nothing_still_claims_everything() {
    // The previous behaviour is the default, so no existing config changes
    // meaning by upgrading.
    let dir = workspace(&format!(
        "{BASE}  external:\n    - name: anything\n      command: \"{{COMMAND}}\"\n"
    ));
    assert!(
        rules(dir.path(), "he.md", HEBREW, "markdown").is_empty(),
        "a provider that declares nothing is still a wildcard"
    );
}

#[test]
fn a_declared_language_matches_its_regional_variants() {
    // `languages: ["en"]` has to cover a document checked as en-GB, or the
    // declaration is a trap.
    let dir = workspace(&format!(
        "engines:\n  harper:\n    enabled: false\n  languagetool:\n    enabled: false\n  spell_language: en-GB\n  external:\n    - name: english-only\n      command: \"{{COMMAND}}\"\n      languages: [\"en\"]\n"
    ));
    assert!(
        rules(dir.path(), "en.md", "Plain English prose.\n", "markdown").is_empty(),
        "an en provider must answer for en-GB"
    );
}

#[test]
fn a_provider_that_declares_an_extension_is_skipped_elsewhere() {
    // `extensions` was parsed, documented and never reached the engine, so a
    // provider restricted to Markdown ran on everything.
    let dir = workspace(&format!(
        "{BASE}  external:\n    - name: markdown-only\n      command: \"{{COMMAND}}\"\n      extensions: [md]\n"
    ));
    assert!(
        rules(dir.path(), "note.md", "Plain English prose.\n", "markdown").is_empty(),
        "a markdown provider must run on markdown"
    );
    assert_eq!(
        rules(dir.path(), "paper.tex", "Plain English prose.\n", "latex"),
        vec!["languagecheck.no-provider"],
        "a markdown provider must not run on LaTeX"
    );
}

#[test]
fn an_extension_may_be_written_with_or_without_its_dot() {
    let dir = workspace(&format!(
        "{BASE}  external:\n    - name: dotted\n      command: \"{{COMMAND}}\"\n      extensions: [\".md\", \"MARKDOWN\"]\n"
    ));
    assert!(
        rules(dir.path(), "note.md", "Plain English prose.\n", "markdown").is_empty(),
        "a leading dot and a different case must both match"
    );
}
