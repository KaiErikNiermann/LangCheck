use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct RuleMapping {
    pub provider: String,
    pub mappings: Vec<MappingEntry>,
}

#[derive(Debug, Deserialize)]
pub struct MappingEntry {
    pub native_id: String,
    pub unified_id: String,
}

pub struct RuleNormalizer {
    mappings: HashMap<String, HashMap<String, String>>,
}

impl Default for RuleNormalizer {
    fn default() -> Self {
        Self::new()
    }
}

impl RuleNormalizer {
    #[must_use]
    pub fn new() -> Self {
        let mut normalizer = Self {
            mappings: HashMap::new(),
        };

        // Load default mappings
        normalizer.load_defaults();

        normalizer
    }

    fn load_defaults(&mut self) {
        // Harper mappings (based on LintKind enum variants)
        let harper_mappings = [
            // Spelling & Typos
            ("harper.Spelling", "spelling.typo"),
            ("harper.Typo", "spelling.typo"),
            // Grammar
            ("harper.Agreement", "grammar.agreement"),
            ("harper.Grammar", "grammar.general"),
            // Articles (legacy rule name kept for backward compat)
            ("harper.AnA", "grammar.article"),
            // Repetition
            ("harper.Repetition", "typography.repeated_word"),
            ("harper.RepeatedWord", "typography.repeated_word"),
            // Redundancy
            ("harper.Redundancy", "style.redundancy"),
            // Punctuation & Formatting
            ("harper.Punctuation", "typography.punctuation"),
            ("harper.Formatting", "typography.formatting"),
            // Style & Readability
            ("harper.Style", "style.general"),
            ("harper.Readability", "style.readability"),
            ("harper.WordChoice", "style.word_choice"),
            ("harper.Enhancement", "style.enhancement"),
            // Usage & Malapropisms
            ("harper.Usage", "grammar.usage"),
            ("harper.Malapropism", "grammar.malapropism"),
            ("harper.Eggcorn", "grammar.eggcorn"),
            // Boundary & Compound words
            ("harper.BoundaryError", "grammar.boundary"),
            // Capitalization
            ("harper.Capitalization", "typography.capitalization"),
            // Nonstandard & Regionalism
            ("harper.Nonstandard", "style.nonstandard"),
            ("harper.Regionalism", "style.regionalism"),
            // Misc
            ("harper.Miscellaneous", "style.unknown"),
        ];
        let mut harper = HashMap::new();
        for (native, unified) in harper_mappings {
            harper.insert(native.to_string(), unified.to_string());
        }
        self.mappings.insert("harper".to_string(), harper);

        // LanguageTool mappings (common rule IDs)
        let lt_mappings = [
            // Spelling
            ("languagetool.MORFOLOGIK_RULE_EN_US", "spelling.typo"),
            ("languagetool.MORFOLOGIK_RULE_EN_GB", "spelling.typo"),
            ("languagetool.MORFOLOGIK_RULE_DE_DE", "spelling.typo"),
            ("languagetool.MORFOLOGIK_RULE_FR", "spelling.typo"),
            ("languagetool.MORFOLOGIK_RULE_ES", "spelling.typo"),
            ("languagetool.HUNSPELL_RULE", "spelling.typo"),
            // Grammar: Articles
            ("languagetool.EN_A_VS_AN", "grammar.article"),
            // Grammar: Agreement
            ("languagetool.AGREEMENT_SENT_START", "grammar.agreement"),
            ("languagetool.PERS_PRONOUN_AGREEMENT", "grammar.agreement"),
            ("languagetool.SUBJECT_VERB_AGREEMENT", "grammar.agreement"),
            ("languagetool.DT_JJ_NO_NOUN", "grammar.agreement"),
            // Grammar: General
            ("languagetool.BEEN_PART_AGREEMENT", "grammar.general"),
            ("languagetool.HE_VERB_AGR", "grammar.general"),
            ("languagetool.IF_IS_WERE", "grammar.general"),
            // Typography: Punctuation
            ("languagetool.DOUBLE_PUNCTUATION", "typography.punctuation"),
            (
                "languagetool.COMMA_PARENTHESIS_WHITESPACE",
                "typography.punctuation",
            ),
            ("languagetool.UNPAIRED_BRACKETS", "typography.punctuation"),
            ("languagetool.WHITESPACE_RULE", "typography.formatting"),
            ("languagetool.SENTENCE_WHITESPACE", "typography.formatting"),
            // Typography: Capitalization
            (
                "languagetool.UPPERCASE_SENTENCE_START",
                "typography.capitalization",
            ),
            // Style: Redundancy & Verbosity
            ("languagetool.REDUNDANCY", "style.redundancy"),
            ("languagetool.TOO_LONG_SENTENCE", "style.readability"),
            // Style: Word Choice & Passive
            ("languagetool.PASSIVE_VOICE", "style.passive_voice"),
            (
                "languagetool.ENGLISH_WORD_REPEAT_RULE",
                "typography.repeated_word",
            ),
            (
                "languagetool.ENGLISH_WORD_REPEAT_BEGINNING_RULE",
                "style.repetition",
            ),
            // Confusion pairs
            ("languagetool.CONFUSION_RULE", "grammar.confusion"),
            // Misc common
            ("languagetool.COMP_THAN", "grammar.comparison"),
            (
                "languagetool.POSSESSIVE_APOSTROPHE",
                "typography.punctuation",
            ),
        ];
        let mut lt = HashMap::new();
        for (native, unified) in lt_mappings {
            lt.insert(native.to_string(), unified.to_string());
        }
        self.mappings.insert("languagetool".to_string(), lt);
    }

    #[must_use]
    pub fn normalize(&self, provider: &str, native_id: &str) -> String {
        if let Some(provider_mappings) = self.mappings.get(provider)
            && let Some(unified_id) = provider_mappings.get(native_id)
        {
            return unified_id.clone();
        }

        // Default to a generic category if no mapping exists
        if native_id.contains("spell") {
            "spelling.unknown".to_string()
        } else if native_id.contains("grammar") {
            "grammar.unknown".to_string()
        } else {
            "style.unknown".to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_harper_spelling() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.Spelling"),
            "spelling.typo"
        );
        assert_eq!(
            normalizer.normalize("harper", "harper.Typo"),
            "spelling.typo"
        );
    }

    #[test]
    fn normalize_lt_spelling() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("languagetool", "languagetool.MORFOLOGIK_RULE_EN_US"),
            "spelling.typo"
        );
        assert_eq!(
            normalizer.normalize("languagetool", "languagetool.MORFOLOGIK_RULE_EN_GB"),
            "spelling.typo"
        );
    }

    #[test]
    fn normalize_article_rules() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.AnA"),
            "grammar.article"
        );
        assert_eq!(
            normalizer.normalize("languagetool", "languagetool.EN_A_VS_AN"),
            "grammar.article"
        );
    }

    #[test]
    fn normalize_agreement_rules() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.Agreement"),
            "grammar.agreement"
        );
        assert_eq!(
            normalizer.normalize("languagetool", "languagetool.SUBJECT_VERB_AGREEMENT"),
            "grammar.agreement"
        );
    }

    #[test]
    fn normalize_style_rules() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.Readability"),
            "style.readability"
        );
        assert_eq!(
            normalizer.normalize("harper", "harper.WordChoice"),
            "style.word_choice"
        );
        assert_eq!(
            normalizer.normalize("languagetool", "languagetool.PASSIVE_VOICE"),
            "style.passive_voice"
        );
    }

    #[test]
    fn normalize_typography_rules() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.Punctuation"),
            "typography.punctuation"
        );
        assert_eq!(
            normalizer.normalize("harper", "harper.Capitalization"),
            "typography.capitalization"
        );
        assert_eq!(
            normalizer.normalize("languagetool", "languagetool.DOUBLE_PUNCTUATION"),
            "typography.punctuation"
        );
    }

    #[test]
    fn normalize_unknown_spelling_rule() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.SomeSpellRule_spell"),
            "spelling.unknown"
        );
    }

    #[test]
    fn normalize_unknown_grammar_rule() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("harper", "harper.SomeGrammarCheck_grammar"),
            "grammar.unknown"
        );
    }

    #[test]
    fn normalize_completely_unknown_rule() {
        let normalizer = RuleNormalizer::new();
        assert_eq!(
            normalizer.normalize("unknown_provider", "some.random.rule"),
            "style.unknown"
        );
    }
}
