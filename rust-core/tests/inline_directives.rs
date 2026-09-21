#![allow(clippy::pedantic)]
//! End-to-end cover for the `lang-check-*` comment directives.
//!
//! The unit tests in `ignore_rules` drive the parser with the whole document,
//! which is what the API wants and not what the pipeline used to hand it: the
//! suppression pass ran inside the orchestrator against a single *extracted
//! prose range*. Every extractor strips comments, so no directive was ever in
//! that string, and the offsets there are range-local besides — the directives
//! silently did nothing in Markdown, LaTeX and Typst alike, while every unit
//! test stayed green.
//!
//! So these run the shipped binary. A suppression pass that is correct but no
//! longer wired into an entry point fails here.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The one misspelling used throughout, so a line number identifies a hit.
const TYPO: &str = "definitly";

/// `(language id, file extension, comment opener, comment closer)` for each
/// format that carries directives, so one assertion covers all of them.
const SYNTAXES: &[(&str, &str, &str, &str)] = &[
    ("markdown", "md", "<!-- ", " -->"),
    ("latex", "tex", "% ", ""),
    ("typst", "typ", "// ", ""),
];

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
fn temp_workspace() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("lang_check_test")
        .tempdir()
        .expect("a temp workspace")
}

/// Check one file through the CLI and report the 1-based lines it flagged.
fn flagged_lines(dir: &Path, name: &str, lang: &str) -> Vec<usize> {
    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(dir)
        .args(["check", name, "--lang", lang, "--format", "json"])
        .output()
        .expect("run language-check");
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");

    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or_else(|e| panic!("JSON from {name}: {e}\n--- stdout ---\n{stdout}"));
    let mut lines: Vec<usize> = parsed
        .as_array()
        .unwrap_or_else(|| panic!("unexpected JSON shape from {name}: {parsed}"))
        .iter()
        .map(|d| {
            usize::try_from(
                d.get("line")
                    .and_then(serde_json::Value::as_u64)
                    .expect("every diagnostic carries a line"),
            )
            .unwrap()
        })
        .collect();
    lines.sort_unstable();
    lines.dedup();
    lines
}

/// Typo on lines 1, 4 and 7, with line 4 inside a `begin`/`end` region.
fn begin_end_document(open: &str, close: &str) -> String {
    format!(
        "A {TYPO} sentence here.\n\
         \n\
         {open}lang-check-begin{close}\n\
         Another {TYPO} sentence in the region.\n\
         {open}lang-check-end{close}\n\
         \n\
         A final {TYPO} sentence.\n"
    )
}

/// Typo on lines 1, 4, 8 and 10; line 4 is inside `disable`/`enable` and line 8
/// is the line after `disable-next-line`.
fn disable_document(open: &str, close: &str) -> String {
    format!(
        "A {TYPO} sentence here.\n\
         \n\
         {open}lang-check-disable{close}\n\
         Another {TYPO} sentence in the region.\n\
         {open}lang-check-enable{close}\n\
         \n\
         {open}lang-check-disable-next-line{close}\n\
         A nextline {TYPO} sentence.\n\
         \n\
         A final {TYPO} sentence.\n"
    )
}

#[test]
fn begin_end_region_is_suppressed_in_every_format() {
    let dir = temp_workspace();
    for &(lang, ext, open, close) in SYNTAXES {
        let name = format!("region.{ext}");
        std::fs::write(dir.path().join(&name), begin_end_document(open, close)).unwrap();
        assert_eq!(
            flagged_lines(dir.path(), &name, lang),
            vec![1, 7],
            "begin/end region not honoured in {lang}"
        );
    }
}

#[test]
fn disable_directives_are_honoured_in_every_format() {
    let dir = temp_workspace();
    for &(lang, ext, open, close) in SYNTAXES {
        let name = format!("disable.{ext}");
        std::fs::write(dir.path().join(&name), disable_document(open, close)).unwrap();
        assert_eq!(
            flagged_lines(dir.path(), &name, lang),
            vec![1, 10],
            "disable directives not honoured in {lang}"
        );
    }
}

#[test]
fn a_document_without_directives_keeps_every_diagnostic() {
    let dir = temp_workspace();
    std::fs::write(
        dir.path().join("plain.md"),
        format!("A {TYPO} sentence here.\n\nA final {TYPO} sentence.\n"),
    )
    .unwrap();
    assert_eq!(
        flagged_lines(dir.path(), "plain.md", "markdown"),
        vec![1, 3]
    );
}
