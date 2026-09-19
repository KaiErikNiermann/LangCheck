#![allow(clippy::pedantic)]
//! The `examples/` corpus, checked the way a real document is.
//!
//! Those files exist to be read — each shows one format's constructs together
//! with the config and the language declarations that go with it. Keeping them
//! under test is what stops them drifting into documentation for behaviour the
//! code no longer has, and it gives the extractors a corpus shaped like a
//! document rather than like a unit test.
//!
//! What is snapshotted is the extraction and the language routing: which prose
//! the parser found, what grammar it used, and which language each range would
//! be checked in. That needs no engine and no network, so it runs anywhere.
//! What the engines then say about that prose is `examples/*/expected.md`,
//! prose for a human, because it depends on which of them are installed.

use std::path::{Path, PathBuf};

use lang_check::config::Config;
use lang_check::prose::{self, latex::LatexExtras};

/// A corpus file and the language id the editor would give it.
struct Example {
    path: PathBuf,
    language_id: &'static str,
}

fn examples_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("rust-core has a parent")
        .join("examples")
}

fn examples() -> Vec<Example> {
    [
        ("typst/thesis.typ", "typst"),
        ("latex/paper.tex", "latex"),
        ("markdown/notes.md", "markdown"),
    ]
    .into_iter()
    .map(|(relative, language_id)| Example {
        path: examples_root().join(relative),
        language_id,
    })
    .collect()
}

/// One line per prose range: the language it is checked in, then its text.
///
/// Rendered as text rather than a struct dump so a diff in review reads as the
/// document it describes.
fn render(example: &Example) -> String {
    let text = std::fs::read_to_string(&example.path)
        .unwrap_or_else(|e| panic!("read {}: {e}", example.path.display()));
    let config = Config::default();
    let latex_extras = LatexExtras {
        skip_envs: &config.languages.latex.skip_environments,
        skip_commands: &config.languages.latex.skip_commands,
    };
    let extraction =
        prose::extract_reporting_syntax(&text, example.language_id, None, None, &latex_extras)
            .expect("extraction");
    let units = prose::range_units(&extraction.ranges, &text, "en-GB");

    let mut out = format!("syntax: {}\n", extraction.syntax);
    for (range, unit) in extraction.ranges.iter().zip(&units) {
        let line = text[..range.start_byte].lines().count();
        let body: String = unit.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let body = if body.chars().count() > 72 {
            let head: String = body.chars().take(69).collect();
            format!("{head}...")
        } else {
            body
        };
        out.push_str(&format!("L{line:<4} {:<8} {body}\n", unit.language));
    }
    out
}

#[test]
fn every_example_extracts_and_routes_as_recorded() {
    for example in examples() {
        let name = example
            .path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .expect("an example lives in a named directory");
        insta::assert_snapshot!(format!("example_{name}"), render(&example));
    }
}

#[test]
fn every_example_directory_carries_the_config_it_demonstrates() {
    for example in examples() {
        let dir = example.path.parent().expect("example directory");
        assert!(
            dir.join(".languagecheck.yaml").is_file(),
            "{} has no .languagecheck.yaml; the config is half the example",
            dir.display()
        );
        assert!(
            dir.join("expected.md").is_file(),
            "{} has no expected.md saying what a check should report",
            dir.display()
        );
    }
}

/// The committed config has to parse, or the example teaches a broken file.
#[test]
fn every_example_config_parses() {
    for example in examples() {
        let dir = example.path.parent().expect("example directory");
        let path = dir.join(".languagecheck.yaml");
        let raw = std::fs::read_to_string(&path).expect("read config");
        serde_yaml::from_str::<Config>(&raw)
            .unwrap_or_else(|e| panic!("{} does not parse: {e}", path.display()));
    }
}
