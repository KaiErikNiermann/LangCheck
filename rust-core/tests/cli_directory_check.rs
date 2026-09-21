#![allow(clippy::pedantic)]
//! The CLI's directory mode, driven as a subprocess.
//!
//! Regression coverage for a silent failure: the file list was built from a single
//! `**/*.{md,markdown}` pattern, and the `glob` crate implements `*`, `**` and `[...]`
//! but not brace expansion. The braces were matched literally, so every directory run
//! found zero files, printed "No issues found." and exited 0 — indistinguishable from a
//! clean corpus.

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
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

#[test]
fn checking_a_directory_visits_every_matching_file() {
    let workspace = temp_workspace("lang_check_cli_dir");
    // Two of markdown's extensions, one nested, plus a file of another language that
    // must not be picked up.
    write(workspace.path(), "top.md", "This sentance is wrong.\n");
    write(
        workspace.path(),
        "nested/deep.markdown",
        "Another mispeling here.\n",
    );
    write(
        workspace.path(),
        "ignored.tree",
        "\\p{A third mispeling.}\n",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace.path())
        .args(["check", ".", "--lang", "markdown", "--format", "json"])
        .output()
        .expect("the CLI runs");
    assert!(output.status.success(), "{output:?}");

    let diagnostics: Vec<serde_json::Value> =
        serde_json::from_slice(&output.stdout).expect("valid JSON array");
    let files: std::collections::HashSet<&str> = diagnostics
        .iter()
        .filter_map(|d| d["file"].as_str())
        .collect();

    assert!(
        files.iter().any(|f| f.ends_with("top.md")),
        "the .md file was not checked: {files:?}"
    );
    assert!(
        files.iter().any(|f| f.ends_with("deep.markdown")),
        "the nested .markdown file was not checked: {files:?}"
    );
    assert!(
        !files.iter().any(|f| f.ends_with("ignored.tree")),
        "a file of another language was checked: {files:?}"
    );
}
