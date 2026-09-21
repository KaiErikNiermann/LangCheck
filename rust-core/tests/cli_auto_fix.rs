#![allow(clippy::pedantic)]
//! `auto_fix` rules, driven through the CLI as a user would.
//!
//! `config.rs` unit-tests `apply_auto_fixes` on a `Config` built in memory.
//! These go the whole way: a `.languagecheck.yaml` on disk, the binary as a
//! subprocess, and the file's contents afterwards. What that adds is the parse
//! -- a rule the YAML loader silently drops is invisible to a test that
//! constructs the rule itself, and looks exactly like a rule that did not
//! match.
//!
//! Worth stating where this feature lives: `apply_auto_fixes` is called from
//! the `fix` subcommand and from nowhere else. `check` does not report these
//! replacements and the VS Code extension does not apply them.

use std::path::{Path, PathBuf};
use std::process::Command;

/// A workspace directory that is unique, and removed when the handle drops.
///
/// Built with `tempfile` rather than from a pid and a timestamp. The
/// hand-rolled version named the directory after `SystemTime::now()`, and
/// tests in one binary run in parallel threads: where the clock is coarser
/// than a nanosecond -- macOS among them -- two of them landed on the same
/// name, shared one `.languagecheck.yaml`, and read each other's config. The
/// symptom was a severity override that worked locally and reported the
/// category default in CI. `tempfile` creates the directory with O_EXCL and
/// retries, so the name cannot collide.
///
/// The returned handle must stay alive for as long as the directory is
/// needed; dropping it deletes the tree.
fn temp_workspace(prefix: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir()
        .expect("a temp workspace")
}

fn write(dir: &Path, name: &str, contents: &str) {
    std::fs::write(dir.join(name), contents).unwrap();
}

/// The config from the documentation, verbatim, plus an engine to run.
const CONFIG: &str = r#"
engines:
  harper: true
auto_fix:
  - find: "teh"
    replace: "the"
    description: "Fix common typo"
  - find: "colour"
    replace: "color"
    context: "American"
"#;

fn fix(workspace: &Path, file: &str) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace)
        .args(["fix", file])
        .output()
        .expect("the CLI runs");
    assert!(output.status.success(), "{output:?}");
    std::fs::read_to_string(workspace.join(file)).expect("the file is still there")
}

#[test]
fn a_rule_without_a_context_applies_anywhere() {
    let workspace = temp_workspace("lang_check_autofix_plain");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    // No engine suggestion is involved: `frobnicate` is not a word Harper
    // corrects, so the replacement can only have come from the rule.
    write(workspace.path(), "doc.md", "A frobnicate and teh word.\n");

    let fixed = fix(workspace.path(), "doc.md");
    assert!(
        fixed.contains("the word"),
        "the rule did not apply: {fixed:?}"
    );
    assert!(!fixed.contains("teh "), "the typo survived: {fixed:?}");
}

#[test]
fn a_context_rule_applies_only_where_its_context_appears() {
    let workspace = temp_workspace("lang_check_autofix_context");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "us.md",
        "American English: the colour is red.\n",
    );
    write(
        workspace.path(),
        "gb.md",
        "British English: the colour is red.\n",
    );

    let us = fix(workspace.path(), "us.md");
    assert!(
        us.contains("the color is red"),
        "the context matched but the rule did not apply: {us:?}"
    );

    let gb = fix(workspace.path(), "gb.md");
    assert!(
        gb.contains("the colour is red"),
        "the rule applied although its context was absent: {gb:?}"
    );
}

#[test]
fn the_run_says_how_many_of_its_own_rules_fired() {
    let workspace = temp_workspace("lang_check_autofix_count");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "doc.md",
        "American English: a colour here.\n",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace.path())
        .args(["fix", "doc.md"])
        .output()
        .expect("the CLI runs");
    let printed = String::from_utf8_lossy(&output.stdout);

    // The user-defined count is reported separately from the engines', which
    // is the only way to tell a rule that fired from a suggestion that
    // happened to agree with it.
    assert!(
        printed.contains("user-defined auto-fix"),
        "the run did not report its own rules: {printed}"
    );
}

#[test]
fn a_file_with_nothing_to_fix_is_left_exactly_as_it_was() {
    let workspace = temp_workspace("lang_check_autofix_noop");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    let original = "British English: a colour here, spelled correctly.\n";
    write(workspace.path(), "doc.md", original);

    let fixed = fix(workspace.path(), "doc.md");
    assert_eq!(
        fixed, original,
        "a file with no applicable rule was rewritten anyway"
    );
}
