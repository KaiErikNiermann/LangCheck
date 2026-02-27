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
        const HARPER_YAML: &str = include_str!("../data/harper_mapping.yaml");
        const LT_YAML: &str = include_str!("../data/languagetool_mapping.yaml");

        for yaml_src in [HARPER_YAML, LT_YAML] {
            let mapping: RuleMapping =
                serde_yaml::from_str(yaml_src).expect("embedded YAML mapping should be valid");
            let mut map = HashMap::new();
            for entry in mapping.mappings {
                map.insert(entry.native_id, entry.unified_id);
            }
            self.mappings.insert(mapping.provider, map);
        }
    }

    /// Returns all (provider, native\_id, unified\_id) triples, sorted for stable output.
    #[must_use]
    pub fn all_mappings(&self) -> Vec<(String, String, String)> {
        let mut result = Vec::new();
        for (provider, map) in &self.mappings {
            for (native, unified) in map {
                result.push((provider.clone(), native.clone(), unified.clone()));
            }
        }
        result.sort();
        result
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
