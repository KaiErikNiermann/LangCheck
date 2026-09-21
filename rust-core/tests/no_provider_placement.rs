#![allow(clippy::pedantic)]
//! Where "nothing reads this language" is reported.
//!
//! The finding is about a language, and the thing the reader can act on
//! depends on how the language was chosen. A passage inside
//! `lang-check-begin lang:he` was declared Hebrew by that comment, so the
//! comment is what to change; a document that is simply written in a language
//! nothing reads has no declaration to point at, so the passage itself is all
//! there is.
//!
//! Driven through the CLI so the column is the one a user sees. Hebrew is two
//! bytes a character and renders right to left, which is what makes a
//! misplaced span here hard to spot by eye.

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

/// Harper alone: it reads English and nothing else, so any other language is
/// a passage nothing can check.
const CONFIG: &str = "engines:\n  harper: true\n  spell_language: \"en-US\"\n";

fn report(workspace: &Path) -> Vec<serde_json::Value> {
    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace)
        .args(["check", "doc.md", "--format", "json"])
        .output()
        .expect("the CLI runs");
    assert!(output.status.success(), "{output:?}");
    serde_json::from_slice(&output.stdout).expect("valid JSON array")
}

fn no_provider(diagnostics: &[serde_json::Value]) -> &serde_json::Value {
    diagnostics
        .iter()
        .find(|d| d["rule_id"] == "languagecheck.no-provider")
        .unwrap_or_else(|| panic!("no unchecked-language report in {diagnostics:#?}"))
}

#[test]
fn a_declared_language_is_reported_against_the_declaration() {
    let workspace = temp_workspace("lang_check_noprov_declared");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "doc.md",
        "# Title\n\n<!-- lang-check-begin lang:he -->\n\nשלום עולם\n\n<!-- lang-check-end -->\n",
    );

    let found = report(workspace.path());
    let report = no_provider(&found);
    assert_eq!(
        report["line"], 3,
        "the report belongs on the declaration, not on the passage: {report}"
    );
    assert_eq!(report["column"], 1, "{report}");
}

#[test]
fn a_scope_marker_is_a_declaration_too() {
    let workspace = temp_workspace("lang_check_noprov_marker");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "doc.md",
        "# Title\n\n<!-- lang: he -->\n\nשלום עולם\n",
    );

    let found = report(workspace.path());
    let report = no_provider(&found);
    assert_eq!(report["line"], 3, "{report}");
}

#[test]
fn an_undeclared_language_is_reported_against_the_passage() {
    // Nothing declares anything here: the whole document is configured `he`,
    // so there is no comment to point at and the prose is what to mark.
    let workspace = temp_workspace("lang_check_noprov_free");
    write(
        workspace.path(),
        ".languagecheck.yaml",
        "engines:\n  harper: true\n  spell_language: \"he\"\n",
    );
    write(workspace.path(), "doc.md", "שלום עולם\n");

    let found = report(workspace.path());
    let report = no_provider(&found);
    assert_eq!(report["line"], 1, "{report}");
    assert_eq!(report["column"], 1, "{report}");
}

#[test]
fn a_typst_set_rule_is_a_declaration_too() {
    // Typst declares its language for hyphenation and quotation marks, and
    // the checker reads the same annotation -- so it is also the line to
    // change when nothing can read what it names.
    let workspace = temp_workspace("lang_check_noprov_typst");
    write(workspace.path(), ".languagecheck.yaml", CONFIG);
    write(
        workspace.path(),
        "doc.typ",
        "= Title\n\n#set text(lang: \"he\")\n\nשלום עולם\n",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace.path())
        .args(["check", "doc.typ", "--format", "json"])
        .output()
        .expect("the CLI runs");
    assert!(output.status.success(), "{output:?}");
    let found: Vec<serde_json::Value> =
        serde_json::from_slice(&output.stdout).expect("valid JSON array");
    let report = no_provider(&found);
    assert_eq!(
        report["line"], 3,
        "the report belongs on the set rule: {report}"
    );
}

/// One document, two unreadable languages, declared two different ways.
///
/// The Latin is simply written there -- nothing declares it, so the passage
/// is all there is to point at. The Hebrew is inside a pragma, so the pragma
/// is what to change. Both reports appear, in their own places, and neither
/// takes the other's.
#[test]
fn a_document_mixing_declared_and_undeclared_languages_places_each_report() {
    let workspace = temp_workspace("lang_check_noprov_mixed");
    // `spell_language: la` makes the undeclared prose Latin, which Harper
    // cannot read either; the Hebrew block declares itself.
    write(
        workspace.path(),
        ".languagecheck.yaml",
        "engines:\n  harper: true\n  spell_language: \"la\"\n",
    );
    write(
        workspace.path(),
        "doc.md",
        // 1: heading
        // 3: the Latin, undeclared
        // 5: the declaration
        // 7: the Hebrew
        // 9: the close
        "# Titulus\n\nGallia est omnis divisa in partes tres.\n\n<!-- lang-check-begin lang:he -->\n\nשלום עולם\n\n<!-- lang-check-end -->\n",
    );

    let found = report(workspace.path());
    // One per prose range, so the heading gets its own -- it is Latin too.
    // The count is a property of how Markdown splits the document and not of
    // what is being tested here; the placements are.
    let lines: Vec<u64> = found
        .iter()
        .filter(|d| d["rule_id"] == "languagecheck.no-provider")
        .filter_map(|d| d["line"].as_u64())
        .collect();
    assert!(!lines.is_empty(), "nothing was reported at all: {found:#?}");
    assert!(
        lines.contains(&3),
        "the undeclared Latin should be marked at its own first word: {lines:?}"
    );
    assert!(
        lines.contains(&5),
        "the declared Hebrew should be marked at its pragma: {lines:?}"
    );
    assert!(
        !lines.contains(&7),
        "the Hebrew prose was marked instead of its declaration: {lines:?}"
    );
}
