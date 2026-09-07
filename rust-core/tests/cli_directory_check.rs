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
    write(&workspace, "top.md", "This sentance is wrong.\n");
    write(
        &workspace,
        "nested/deep.markdown",
        "Another mispeling here.\n",
    );
    write(&workspace, "ignored.tree", "\\p{A third mispeling.}\n");

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(&workspace)
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

    std::fs::remove_dir_all(&workspace).ok();
}
