#![allow(clippy::pedantic)]
//! `--fail-on`, which is what makes the CLI usable as a gate.
//!
//! Without it `check` exits 0 whatever it found, so a CI job that runs it
//! passes on a document full of misspellings -- indistinguishable from a
//! clean one, which is the failure mode this whole tool exists to avoid.
//!
//! The default stays 0, because a person running it at a terminal is reading
//! the output, not the exit status, and a non-zero exit there breaks `&&`
//! chains for no reason.

use std::path::Path;
use std::process::Command;

fn temp_workspace(prefix: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .expect("a temp workspace")
}

fn write(dir: &Path, name: &str, contents: &str) {
    std::fs::write(dir.join(name), contents).unwrap();
}

/// Harper alone, with the typo left at its category default of warning.
const CONFIG: &str = "engines:\n  harper: true\n  spell_language: \"en-US\"\n";
/// The same, with spelling demoted below the gate.
const QUIET: &str = "engines:\n  harper: true\n  spell_language: \"en-US\"\nrules:\n  spelling.typo:\n    severity: \"hint\"\n";

fn run(workspace: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace)
        .args(args)
        .output()
        .expect("the CLI runs")
}

#[test]
fn without_the_flag_a_finding_still_exits_zero() {
    let workspace = temp_workspace("lang_check_failon_default");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(workspace.path(), "doc.md", "A recieve typo.\n");

    let output = run(workspace.path(), &["check", "doc.md"]);
    assert!(output.status.success(), "{output:?}");
}

#[test]
fn fail_on_warning_exits_non_zero_when_something_is_wrong() {
    let workspace = temp_workspace("lang_check_failon_warn");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(workspace.path(), "doc.md", "A recieve typo.\n");

    let output = run(
        workspace.path(),
        &["check", "doc.md", "--fail-on", "warning"],
    );
    assert!(
        !output.status.success(),
        "a misspelling did not fail the gate"
    );
    assert_eq!(output.status.code(), Some(1));
}

#[test]
fn fail_on_warning_exits_zero_when_the_document_is_clean() {
    let workspace = temp_workspace("lang_check_failon_clean");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "doc.md",
        "A clean sentence with no mistakes.\n",
    );

    let output = run(
        workspace.path(),
        &["check", "doc.md", "--fail-on", "warning"],
    );
    assert!(output.status.success(), "{output:?}");
}

#[test]
fn a_finding_below_the_threshold_does_not_fail_the_gate() {
    // The whole point of the setting: a style note is visible and is not a
    // blocker, so the gate can be left on.
    let workspace = temp_workspace("lang_check_failon_below");
    write(workspace.path(), ".languagecheck.yaml", QUIET);
    write(workspace.path(), "doc.md", "A recieve typo.\n");

    let quiet = run(
        workspace.path(),
        &["check", "doc.md", "--fail-on", "warning"],
    );
    assert!(
        quiet.status.success(),
        "a hint failed a warning gate: {quiet:?}"
    );

    // And it is still reported, so "does not block" is not "does not appear".
    let listed = run(workspace.path(), &["check", "doc.md", "--format", "json"]);
    let diagnostics: Vec<serde_json::Value> =
        serde_json::from_slice(&listed.stdout).expect("valid JSON array");
    assert!(
        !diagnostics.is_empty(),
        "the finding vanished instead of being demoted"
    );
}

#[test]
fn fail_on_hint_catches_everything() {
    let workspace = temp_workspace("lang_check_failon_hint");
    write(workspace.path(), ".languagecheck.yaml", QUIET);
    write(workspace.path(), "doc.md", "A recieve typo.\n");

    let output = run(workspace.path(), &["check", "doc.md", "--fail-on", "hint"]);
    assert!(!output.status.success(), "{output:?}");
}

#[test]
fn a_directory_run_gates_on_the_worst_file() {
    let workspace = temp_workspace("lang_check_failon_dir");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "clean.md",
        "A clean sentence with no mistakes.\n",
    );
    write(workspace.path(), "dirty.md", "A recieve typo.\n");

    let output = run(workspace.path(), &["check", ".", "--fail-on", "warning"]);
    assert!(
        !output.status.success(),
        "one bad file did not fail the run"
    );
}
