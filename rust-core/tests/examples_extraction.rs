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

/// The grammar each example is parsed with, for the syntax check.
fn grammar_for(language_id: &str) -> tree_sitter::Language {
    lang_check::languages::resolve_ts_language(language_id)
}

/// Report every `ERROR` or `MISSING` node in a tree, as `line: text`.
fn parse_errors(node: tree_sitter::Node, text: &str, out: &mut Vec<String>) {
    if node.is_error() || node.is_missing() {
        let line = text[..node.start_byte()].lines().count();
        let snippet: String = text[node.byte_range()].chars().take(60).collect();
        out.push(format!("L{line}: {snippet:?}"));
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        parse_errors(child, text, out);
    }
}

/// An example that does not parse is not an example of anything.
///
/// Cheap enough to always run: the grammars are already linked in, so this
/// needs no Typst or TeX installation. What it cannot see is a document that
/// parses and then fails to *build* — an undefined environment, a package that
/// is not there — which is what `every_example_compiles` covers where the
/// toolchain exists.
#[test]
fn every_example_parses_without_errors() {
    for example in examples() {
        let text = std::fs::read_to_string(&example.path).expect("read example");
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&grammar_for(example.language_id))
            .expect("grammar");
        let tree = parser.parse(&text, None).expect("parse");

        let mut errors = Vec::new();
        parse_errors(tree.root_node(), &text, &mut errors);
        assert!(
            errors.is_empty(),
            "{} does not parse as {}:\n  {}",
            example.path.display(),
            example.language_id,
            errors.join("\n  ")
        );
    }
}

/// Build each example with its real toolchain, where that toolchain is here.
///
/// Parsing is not building. `thesis.typ` once imported a drawing package and
/// called it wrongly, and `paper.tex` used an `algorithm` environment without
/// loading the package — both parse fine and neither produced a document, so
/// the Typst LSP reported the file as empty in the editor while our own
/// extraction looked correct.
///
/// Skipped rather than failed when the compiler is absent, so a checkout
/// without TeX Live still runs the suite.
#[test]
fn every_example_compiles() {
    for (relative, program, args) in [
        (
            "typst/thesis.typ",
            "typst",
            vec!["compile", "thesis.typ", "-"],
        ),
        (
            "latex/paper.tex",
            "latexmk",
            vec![
                "-pdf",
                "-interaction=nonstopmode",
                "-halt-on-error",
                "paper.tex",
            ],
        ),
    ] {
        let path = examples_root().join(relative);
        let dir = path.parent().expect("example directory");
        let out_dir = std::env::temp_dir().join(format!(
            "lang_check_example_build_{}_{}",
            std::process::id(),
            program
        ));
        std::fs::create_dir_all(&out_dir).expect("build directory");

        let mut command = std::process::Command::new(program);
        command.current_dir(dir).args(&args);
        if program == "latexmk" {
            command.arg(format!("-outdir={}", out_dir.display()));
        }

        let output = match command.output() {
            Ok(output) => output,
            // Not installed: this machine cannot answer the question.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                eprintln!("skipping {relative}: {program} is not installed");
                continue;
            }
            Err(e) => panic!("running {program}: {e}"),
        };

        let _ = std::fs::remove_dir_all(&out_dir);
        assert!(
            output.status.success(),
            "{relative} does not compile:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
