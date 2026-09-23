#![allow(clippy::pedantic)]

use lang_check::engines::{Engine, HarperEngine};
use lang_check::insights::ProseInsights;
use lang_check::prose::ProseExtractor;
use lang_check::prose::latex::LatexExtras;
use lang_check::rules::RuleNormalizer;

fn main() {
    divan::main();
}

// ── Prose extraction benchmarks ──────────────────────────────────────

#[divan::bench]
fn prose_extraction_short_markdown(bencher: divan::Bencher) {
    bench_extract(
        bencher,
        tree_sitter_md::LANGUAGE.into(),
        "markdown",
        "# Hello\n\nA short paragraph.",
    );
}

#[divan::bench]
fn prose_extraction_long_markdown(bencher: divan::Bencher) {
    bench_extract(
        bencher,
        tree_sitter_md::LANGUAGE.into(),
        "markdown",
        &generate_markdown(100),
    );
}

#[divan::bench]
fn prose_extraction_html(bencher: divan::Bencher) {
    bench_extract(
        bencher,
        tree_sitter_html::LANGUAGE.into(),
        "html",
        "<html><body><p>Hello world.</p><p>Another paragraph with some text.</p></body></html>",
    );
}

// ── Harper checking benchmarks ───────────────────────────────────────

#[divan::bench]
fn harper_check_clean_sentence(bencher: divan::Bencher) {
    bench_harper(bencher, "The quick brown fox jumped over the lazy dog.");
}

#[divan::bench]
fn harper_check_with_errors(bencher: divan::Bencher) {
    bench_harper(bencher, "This is an test of the the system.");
}

#[divan::bench]
fn harper_check_paragraph(bencher: divan::Bencher) {
    bench_harper(
        bencher,
        "The quick brown fox jumped over the lazy dog. \
         It was a beautiful day in the neighborhood. \
         The sun was shining and the birds were singing. \
         Everything seemed perfect in every way.",
    );
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

fn bench_extract(
    bencher: divan::Bencher,
    language: tree_sitter::Language,
    language_id: &str,
    text: &str,
) {
    bencher
        .with_inputs(|| ProseExtractor::new(language.clone()).unwrap())
        .bench_local_refs(|ext| {
            ext.extract(text, language_id, &LatexExtras::default())
                .unwrap()
        });
}

/// Harper's `check` is async, so each iteration blocks on a current-thread runtime.
fn bench_harper(bencher: divan::Bencher, text: &str) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    bencher
        .with_inputs(|| HarperEngine::new(&lang_check::config::HarperConfig::default()))
        .bench_local_refs(|engine| rt.block_on(engine.check(text, "en-US")).unwrap());
}

fn bench_morphology(bencher: divan::Bencher, word: &str) {
    let analyzer = lang_check::morphology::AffixAnalyzer::new("en-US");
    bencher.bench_local(|| divan::black_box(analyzer.analyze(word, None)));
}

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

// ── Dictionary and morphology benchmarks ─────────────────────────────

#[divan::bench]
fn dictionary_load_bundled() {
    let mut dict = lang_check::dictionary::Dictionary::new();
    dict.load_bundled();
    divan::black_box(dict.len());
}

/// The cost paid once per workspace load when inflections are on.
#[divan::bench]
fn dictionary_derive_inflections(bencher: divan::Bencher) {
    bencher
        .with_inputs(|| {
            let mut dict = lang_check::dictionary::Dictionary::new();
            dict.load_bundled();
            dict
        })
        .bench_local_refs(|dict| {
            dict.derive_inflections();
            divan::black_box(dict.derived_len())
        });
}

/// The common case: a token that is simply misspelled and decomposes into nothing.
#[divan::bench]
fn morphology_reject_typo(bencher: divan::Bencher) {
    bench_morphology(bencher, "recieve");
}

/// The worst case: a prefix and a suffix, both peeled, before the root is found.
#[divan::bench]
fn morphology_accept_derived(bencher: divan::Bencher) {
    bench_morphology(bencher, "subadditivity");
}
