#![allow(clippy::pedantic)]

use rust_core::prose;
use rust_core::prose::latex::LatexExtras;
use rust_core::sls::SchemaRegistry;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_workspace(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should move forward")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "lang-check-{prefix}-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("temp dir should be created");
    dir
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
    let schema_dir = workspace.join(".langcheck/schemas");

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

    fs::remove_dir_all(workspace).expect("temp dir should be removed");
}

#[test]
fn sls_does_not_shadow_built_in_extractors() {
    let workspace = temp_workspace("sls-builtins");
    let schema_dir = workspace.join(".langcheck/schemas");

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

    let registry = SchemaRegistry::from_workspace(&workspace).expect("registry should load");
    let text = "My Title\n========\n\nThis is a paragraph.\n";
    let path = workspace.join("doc.rst");
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

    fs::remove_dir_all(workspace).expect("temp dir should be removed");
}

#[test]
fn cli_uses_workspace_sls_schema_for_unknown_extension() {
    let workspace = temp_workspace("sls-cli");
    let schema_dir = workspace.join(".langcheck/schemas");

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
        &workspace.join("sample.adoc"),
        "= Title\n\nThis is an test.\n\n----\nThis is an test in code.\n----\n\nAnother clean paragraph.\n",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_language-check"))
        .current_dir(&workspace)
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

    fs::remove_dir_all(workspace).expect("temp dir should be removed");
}
