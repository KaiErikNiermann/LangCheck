#![allow(clippy::pedantic)]

use lang_check::prose;
use lang_check::prose::latex::LatexExtras;
use lang_check::sls::SchemaRegistry;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent dir should be created");
    }
    fs::write(path, contents).expect("file should be written");
}

#[test]
fn schema_registry_load_dir_loads_multiple_schemas() {
    let workspace = temp_workspace("sls-load-dir");
    let schema_dir = workspace.path().join(".langcheck/schemas");

    write_file(
        &schema_dir.join("asciidoc.yaml"),
        r#"
name: asciidoc
extensions: [adoc]
prose_patterns: []
skip_patterns:
  - pattern: "^=+\\s"
skip_blocks:
  - start: "^----\\s*$"
    end: "^----\\s*$"
"#,
    );
    write_file(
        &schema_dir.join("toml.yaml"),
        r#"
name: toml
extensions: [toml]
prose_patterns: []
skip_patterns:
  - pattern: "^\\s*#"
  - pattern: "^\\s*\\w+\\s*="
skip_blocks: []
"#,
    );

    let mut registry = SchemaRegistry::new();
    let count = registry.load_dir(&schema_dir).expect("schemas should load");

    assert_eq!(count, 2);
    assert_eq!(registry.len(), 2);
    assert!(registry.find_by_extension("adoc").is_some());
    assert!(registry.find_by_extension("toml").is_some());
}

#[test]
fn sls_does_not_shadow_built_in_extractors() {
    let workspace = temp_workspace("sls-builtins");
    let schema_dir = workspace.path().join(".langcheck/schemas");

    write_file(
        &schema_dir.join("shadow-rst.yaml"),
        r#"
name: fake-rst
extensions: [rst]
prose_patterns:
  - pattern: "^NEVER$"
skip_patterns: []
skip_blocks: []
"#,
    );

    let registry = SchemaRegistry::from_workspace(workspace.path()).expect("registry should load");
    let text = "My Title\n========\n\nThis is a paragraph.\n";
    let path = workspace.path().join("doc.rst");
    let ranges = prose::extract_with_fallback(
        &text,
        "rst",
        Some(&path),
        Some(&registry),
        &LatexExtras::default(),
    )
    .expect("built-in rst extractor should be used");

    assert!(!ranges.is_empty());
    let extracted: Vec<_> = ranges
        .iter()
        .map(|range| range.extract_text(text))
        .collect();
    assert!(
        extracted
            .iter()
            .any(|range_text| range_text.contains("This is a paragraph"))
    );
}

#[test]
fn cli_uses_workspace_sls_schema_for_unknown_extension() {
    let workspace = temp_workspace("sls-cli");
    let schema_dir = workspace.path().join(".langcheck/schemas");

    write_file(
        &schema_dir.join("asciidoc.yaml"),
        r#"
name: asciidoc
extensions: [adoc]
prose_patterns: []
skip_patterns:
  - pattern: "^=+\\s"
skip_blocks:
  - start: "^----\\s*$"
    end: "^----\\s*$"
"#,
    );

    write_file(
        &workspace.path().join("sample.adoc"),
        "= Title\n\nThis is an test.\n\n----\nThis is an test in code.\n----\n\nAnother clean paragraph.\n",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(workspace.path())
        .arg("check")
        .arg("sample.adoc")
        .arg("--format")
        .arg("json")
        .output()
        .expect("language-check should run");

    assert!(
        output.status.success(),
        "language-check failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let diagnostics: Vec<serde_json::Value> =
        serde_json::from_slice(&output.stdout).expect("stdout should be valid json");

    assert_eq!(diagnostics.len(), 1, "expected one prose diagnostic");
    assert_eq!(diagnostics[0]["file"], "sample.adoc");
    assert_eq!(diagnostics[0]["line"], 3);
}
