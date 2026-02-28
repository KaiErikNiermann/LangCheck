#![allow(clippy::pedantic)]

use rust_core::engines::{Engine, HarperEngine};
use rust_core::insights::ProseInsights;
use rust_core::prose::ProseExtractor;
use rust_core::rules::RuleNormalizer;

fn main() {
    divan::main();
}

// ── Prose extraction benchmarks ──────────────────────────────────────

#[divan::bench]
fn prose_extraction_short_markdown(bencher: divan::Bencher) {
    bencher
        .with_inputs(|| ProseExtractor::new(tree_sitter_md::LANGUAGE.into()).unwrap())
        .bench_local_refs(|ext| {
            ext.extract("# Hello\n\nA short paragraph.", "markdown")
                .unwrap()
        });
}

#[divan::bench]
fn prose_extraction_long_markdown(bencher: divan::Bencher) {
    let text = generate_markdown(100);
    bencher
        .with_inputs(|| ProseExtractor::new(tree_sitter_md::LANGUAGE.into()).unwrap())
        .bench_local_refs(|ext| ext.extract(&text, "markdown").unwrap());
}

#[divan::bench]
fn prose_extraction_html(bencher: divan::Bencher) {
    let text =
        "<html><body><p>Hello world.</p><p>Another paragraph with some text.</p></body></html>";
    bencher
        .with_inputs(|| ProseExtractor::new(tree_sitter_html::LANGUAGE.into()).unwrap())
        .bench_local_refs(|ext| ext.extract(text, "html").unwrap());
}

// ── Harper checking benchmarks ───────────────────────────────────────

#[divan::bench]
fn harper_check_clean_sentence(bencher: divan::Bencher) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    bencher
        .with_inputs(HarperEngine::new)
        .bench_local_refs(|engine| {
            rt.block_on(engine.check("The quick brown fox jumped over the lazy dog.", "en-US"))
                .unwrap()
        });
}

#[divan::bench]
fn harper_check_with_errors(bencher: divan::Bencher) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    bencher
        .with_inputs(HarperEngine::new)
        .bench_local_refs(|engine| {
            rt.block_on(engine.check("This is an test of the the system.", "en-US"))
                .unwrap()
        });
}

#[divan::bench]
fn harper_check_paragraph(bencher: divan::Bencher) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let text = "The quick brown fox jumped over the lazy dog. \
                It was a beautiful day in the neighborhood. \
                The sun was shining and the birds were singing. \
                Everything seemed perfect in every way.";
    bencher
        .with_inputs(HarperEngine::new)
        .bench_local_refs(|engine| rt.block_on(engine.check(text, "en-US")).unwrap());
}

// ── Rule normalization benchmarks ────────────────────────────────────

#[divan::bench]
fn rule_normalize_known(bencher: divan::Bencher) {
    let normalizer = RuleNormalizer::new();
    bencher.bench_local(|| normalizer.normalize("harper", "harper.Spelling"));
}

#[divan::bench]
fn rule_normalize_unknown(bencher: divan::Bencher) {
    let normalizer = RuleNormalizer::new();
    bencher.bench_local(|| normalizer.normalize("unknown", "some.random.rule"));
}

#[divan::bench]
fn rule_normalizer_construction() {
    divan::black_box(RuleNormalizer::new());
}

// ── Prose insights benchmarks ────────────────────────────────────────

#[divan::bench]
fn insights_short_text() {
    divan::black_box(ProseInsights::analyze("Hello world. This is a test."));
}

#[divan::bench]
fn insights_long_text(bencher: divan::Bencher) {
    let text = "The quick brown fox jumped over the lazy dog. ".repeat(100);
    bencher.bench_local(|| divan::black_box(ProseInsights::analyze(&text)));
}

// ── Helpers ──────────────────────────────────────────────────────────

fn generate_markdown(paragraphs: usize) -> String {
    let mut text = String::from("# Benchmark Document\n\n");
    for i in 0..paragraphs {
        text.push_str(&format!(
            "This is paragraph number {i}. It contains several sentences. \
             The quick brown fox jumped over the lazy dog. \
             Everything is working correctly in this benchmark.\n\n"
        ));
    }
    text
}
