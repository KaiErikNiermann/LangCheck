#![allow(clippy::pedantic)]

use rust_core::engines::{Engine, HarperEngine};
use rust_core::insights::ProseInsights;
use rust_core::prose::ProseExtractor;
use rust_core::rules::RuleNormalizer;
use serde::Serialize;

// Lightweight wrapper so insta can serialize Diagnostic (protobuf-generated types lack Serialize).
#[derive(Serialize)]
struct SnapDiagnostic {
    start_byte: u32,
    end_byte: u32,
    message: String,
    rule_id: String,
    unified_id: String,
    severity: i32,
    suggestions: Vec<String>,
    confidence: f32,
}

impl SnapDiagnostic {
    fn from(d: &rust_core::checker::Diagnostic) -> Self {
        Self {
            start_byte: d.start_byte,
            end_byte: d.end_byte,
            message: d.message.clone(),
            rule_id: d.rule_id.clone(),
            unified_id: d.unified_id.clone(),
            severity: d.severity,
            suggestions: d.suggestions.clone(),
            confidence: d.confidence,
        }
    }
}

// ── Prose extraction snapshots ───────────────────────────────────────

#[test]
fn prose_extraction_basic_markdown() {
    let lang = tree_sitter_md::LANGUAGE.into();
    let mut ext = ProseExtractor::new(lang).unwrap();
    let text = "# Title\n\nA paragraph.\n\n```rust\nfn main(){}\n```\n\nAnother paragraph.";
    let ranges = ext.extract(text, "markdown").unwrap();
    let extracted: Vec<&str> = ranges.iter().map(|r| &text[r.start_byte..r.end_byte]).collect();
    insta::assert_yaml_snapshot!("prose_basic_markdown", extracted);
}

#[test]
fn prose_extraction_nested_markdown() {
    let lang = tree_sitter_md::LANGUAGE.into();
    let mut ext = ProseExtractor::new(lang).unwrap();
    let text = "\
# Heading One

Some prose text here.

## Subheading

- List item one
- List item two with **bold** text

> Blockquote content here.

```python
print('ignore this')
```

Final paragraph with [a link](https://example.com).
";
    let ranges = ext.extract(text, "markdown").unwrap();
    let extracted: Vec<&str> = ranges.iter().map(|r| &text[r.start_byte..r.end_byte]).collect();
    insta::assert_yaml_snapshot!("prose_nested_markdown", extracted);
}

#[test]
fn prose_extraction_html() {
    let lang = tree_sitter_html::LANGUAGE.into();
    let mut ext = ProseExtractor::new(lang).unwrap();
    let text = "<html><body><p>Hello world.</p><script>var x = 1;</script><p>Second para.</p></body></html>";
    let ranges = ext.extract(text, "html").unwrap();
    let extracted: Vec<&str> = ranges.iter().map(|r| &text[r.start_byte..r.end_byte]).collect();
    insta::assert_yaml_snapshot!("prose_html", extracted);
}

#[test]
fn prose_extraction_empty_markdown() {
    let lang = tree_sitter_md::LANGUAGE.into();
    let mut ext = ProseExtractor::new(lang).unwrap();
    let ranges = ext.extract("", "markdown").unwrap();
    let extracted: Vec<&str> = ranges.iter().map(|r| &""[r.start_byte..r.end_byte]).collect();
    insta::assert_yaml_snapshot!("prose_empty", extracted);
}

#[test]
fn prose_extraction_code_only_markdown() {
    let lang = tree_sitter_md::LANGUAGE.into();
    let mut ext = ProseExtractor::new(lang).unwrap();
    let text = "```rust\nfn main() {}\n```";
    let ranges = ext.extract(text, "markdown").unwrap();
    let extracted: Vec<&str> = ranges.iter().map(|r| &text[r.start_byte..r.end_byte]).collect();
    insta::assert_yaml_snapshot!("prose_code_only", extracted);
}

// ── Harper diagnostics snapshots ─────────────────────────────────────

#[tokio::test]
async fn harper_an_vs_a_diagnostic() {
    let mut engine = HarperEngine::new();
    let normalizer = RuleNormalizer::new();
    let text = "This is an test of the system.";
    let mut diagnostics = engine.check(text, "en-US").await.unwrap();
    for d in &mut diagnostics {
        d.unified_id = normalizer.normalize("harper", &d.rule_id);
    }
    let snap: Vec<_> = diagnostics.iter().map(SnapDiagnostic::from).collect();
    insta::assert_yaml_snapshot!("harper_an_vs_a", snap);
}

#[tokio::test]
async fn harper_repeated_word() {
    let mut engine = HarperEngine::new();
    let normalizer = RuleNormalizer::new();
    let text = "The the cat sat on the mat.";
    let mut diagnostics = engine.check(text, "en-US").await.unwrap();
    for d in &mut diagnostics {
        d.unified_id = normalizer.normalize("harper", &d.rule_id);
    }
    let snap: Vec<_> = diagnostics.iter().map(SnapDiagnostic::from).collect();
    insta::assert_yaml_snapshot!("harper_repeated_word", snap);
}

#[tokio::test]
async fn harper_clean_text() {
    let mut engine = HarperEngine::new();
    let text = "The quick brown fox jumped over the lazy dog.";
    let diagnostics = engine.check(text, "en-US").await.unwrap();
    let snap: Vec<_> = diagnostics.iter().map(SnapDiagnostic::from).collect();
    insta::assert_yaml_snapshot!("harper_clean_text", snap);
}

#[tokio::test]
async fn harper_multiple_issues() {
    let mut engine = HarperEngine::new();
    let normalizer = RuleNormalizer::new();
    let text = "This is an test. The the dog is runing.";
    let mut diagnostics = engine.check(text, "en-US").await.unwrap();
    for d in &mut diagnostics {
        d.unified_id = normalizer.normalize("harper", &d.rule_id);
    }
    let snap: Vec<_> = diagnostics.iter().map(SnapDiagnostic::from).collect();
    insta::assert_yaml_snapshot!("harper_multiple_issues", snap);
}

// ── Rule normalization snapshots ─────────────────────────────────────

#[test]
fn rule_normalization_all_harper() {
    let normalizer = RuleNormalizer::new();
    let harper_rules = [
        "harper.Spelling",
        "harper.Typo",
        "harper.Agreement",
        "harper.Grammar",
        "harper.AnA",
        "harper.Repetition",
        "harper.RepeatedWord",
        "harper.Redundancy",
        "harper.Punctuation",
        "harper.Formatting",
        "harper.Style",
        "harper.Readability",
        "harper.WordChoice",
        "harper.Enhancement",
        "harper.Usage",
        "harper.Malapropism",
        "harper.Eggcorn",
        "harper.BoundaryError",
        "harper.Capitalization",
        "harper.Nonstandard",
        "harper.Regionalism",
        "harper.Miscellaneous",
    ];
    let mapped: Vec<(&str, String)> = harper_rules
        .iter()
        .map(|r| (*r, normalizer.normalize("harper", r)))
        .collect();
    insta::assert_yaml_snapshot!("rule_normalization_harper", mapped);
}

#[test]
fn rule_normalization_all_languagetool() {
    let normalizer = RuleNormalizer::new();
    let lt_rules = [
        "languagetool.MORFOLOGIK_RULE_EN_US",
        "languagetool.MORFOLOGIK_RULE_EN_GB",
        "languagetool.MORFOLOGIK_RULE_DE_DE",
        "languagetool.MORFOLOGIK_RULE_FR",
        "languagetool.MORFOLOGIK_RULE_ES",
        "languagetool.HUNSPELL_RULE",
        "languagetool.EN_A_VS_AN",
        "languagetool.AGREEMENT_SENT_START",
        "languagetool.PERS_PRONOUN_AGREEMENT",
        "languagetool.SUBJECT_VERB_AGREEMENT",
        "languagetool.DT_JJ_NO_NOUN",
        "languagetool.BEEN_PART_AGREEMENT",
        "languagetool.HE_VERB_AGR",
        "languagetool.IF_IS_WERE",
        "languagetool.DOUBLE_PUNCTUATION",
        "languagetool.COMMA_PARENTHESIS_WHITESPACE",
        "languagetool.UNPAIRED_BRACKETS",
        "languagetool.WHITESPACE_RULE",
        "languagetool.SENTENCE_WHITESPACE",
        "languagetool.UPPERCASE_SENTENCE_START",
        "languagetool.REDUNDANCY",
        "languagetool.TOO_LONG_SENTENCE",
        "languagetool.PASSIVE_VOICE",
        "languagetool.ENGLISH_WORD_REPEAT_RULE",
        "languagetool.ENGLISH_WORD_REPEAT_BEGINNING_RULE",
        "languagetool.CONFUSION_RULE",
        "languagetool.COMP_THAN",
        "languagetool.POSSESSIVE_APOSTROPHE",
    ];
    let mapped: Vec<(&str, String)> = lt_rules
        .iter()
        .map(|r| (*r, normalizer.normalize("languagetool", r)))
        .collect();
    insta::assert_yaml_snapshot!("rule_normalization_languagetool", mapped);
}

#[test]
fn rule_normalization_fallback_categories() {
    let normalizer = RuleNormalizer::new();
    let cases = [
        ("unknown", "some_spell_checker", "spelling.unknown"),
        ("unknown", "some_grammar_rule", "grammar.unknown"),
        ("unknown", "totally.random.id", "style.unknown"),
    ];
    let mapped: Vec<(&str, &str, String)> = cases
        .iter()
        .map(|(provider, rule, _expected)| (*provider, *rule, normalizer.normalize(provider, rule)))
        .collect();
    insta::assert_yaml_snapshot!("rule_normalization_fallbacks", mapped);
}

// ── Prose insights snapshots ─────────────────────────────────────────

#[test]
fn insights_simple_text() {
    let insights = ProseInsights::analyze("The cat sat on the mat. The dog ran home.");
    insta::assert_yaml_snapshot!("insights_simple", insights);
}

#[test]
fn insights_complex_text() {
    let text = "Notwithstanding the aforementioned constitutional provisions, \
                the jurisprudential interpretation necessitates comprehensive \
                deliberation regarding substantive procedural requirements.";
    let insights = ProseInsights::analyze(text);
    insta::assert_yaml_snapshot!("insights_complex", insights);
}

#[test]
fn insights_empty() {
    let insights = ProseInsights::analyze("");
    insta::assert_yaml_snapshot!("insights_empty", insights);
}

#[test]
fn insights_single_word() {
    let insights = ProseInsights::analyze("Hello");
    insta::assert_yaml_snapshot!("insights_single_word", insights);
}
