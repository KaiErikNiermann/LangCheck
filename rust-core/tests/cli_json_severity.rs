#![allow(clippy::pedantic)]
//! The severity `--format json` reports, against the one the config asked for.
//!
//! The mapping was written out as numbers and had two of them the wrong way
//! round: `1 => "error"` and `3 => "information"`, where the enum is
//! SEVERITY_INFORMATION = 1 and SEVERITY_ERROR = 3. Every error came out
//! labelled information and every information an error. Nothing caught it,
//! because the LSP path had its own mapping and that one was right -- so a
//! Neovim user saw the correct severity while anything parsing this JSON in CI
//! saw the opposite.
//!
//! Driven through a config override rather than by looking for a diagnostic
//! that happens to be an error: the override names the severity, so the
//! expected answer is written in the test rather than inferred from whatever
//! the engines decided.

use std::path::PathBuf;
use std::process::Command;

fn temp_workspace(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "{prefix}_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The severities reported for a document checked under `config`.
fn severities(config: &str) -> Vec<String> {
    let workspace = temp_workspace("lang_check_json_severity");
    std::fs::write(workspace.join(".languagecheck.yaml"), config).unwrap();
    std::fs::write(workspace.join("doc.md"), "A recieve typo.\n").unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(&workspace)
        .args(["check", "doc.md", "--format", "json"])
        .output()
        .expect("the CLI runs");
    assert!(output.status.success(), "{output:?}");

    let diagnostics: Vec<serde_json::Value> =
        serde_json::from_slice(&output.stdout).expect("valid JSON array");
    let found = diagnostics
        .iter()
        .filter_map(|d| d["severity"].as_str().map(str::to_string))
        .collect();
    std::fs::remove_dir_all(&workspace).ok();
    found
}

#[test]
fn a_rule_set_to_error_is_reported_as_error() {
    let reported = severities(
        "engines:\n  harper: true\nrules:\n  spelling.typo:\n    severity: error\n",
    );
    assert_eq!(
        reported,
        vec!["error"],
        "the config asked for error and the JSON said otherwise"
    );
}

#[test]
fn a_rule_set_to_info_is_reported_as_information() {
    // The other half of the swap. Asserting only the error case would pass
    // against a mapping that labelled everything an error.
    let reported =
        severities("engines:\n  harper: true\nrules:\n  spelling.typo:\n    severity: info\n");
    assert_eq!(reported, vec!["information"]);
}

#[test]
fn a_rule_left_alone_keeps_its_category_default() {
    // Spelling is a warning unless something says otherwise, so this also
    // pins that the override is what moved the other two and not the engine.
    let reported = severities("engines:\n  harper: true\n");
    assert_eq!(reported, vec!["warning"]);
}
