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
        const HUNSPELL_YAML: &str = include_str!("../data/hunspell_mapping.yaml");

        for yaml_src in [HARPER_YAML, LT_YAML, HUNSPELL_YAML] {
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

        // Default to a generic category if no mapping exists.
        //
        // Matched case-insensitively because engine rule ids are shouted:
        // LanguageTool's French speller is FR_SPELLING_RULE and its German one
        // GERMAN_SPELLER_RULE, and a case-sensitive `contains("spell")` put
        // both in `style.unknown` -- where the user dictionary, the name filter
        // and `lang-check-begin spelling.typo` stopped applying to them.
        let lowered = native_id.to_ascii_lowercase();
        if lowered.contains("spell") {
            "spelling.unknown".to_string()
        } else if lowered.contains("grammar") {
            "grammar.unknown".to_string()
        } else {
            "style.unknown".to_string()
        }
    }
}

/// The severity a unified rule category carries, before any config override.
///
/// Severity is a property of the problem, not of the engine that noticed it.
/// Each engine had its own opinion -- `LanguageTool` reports a misspelling as
/// an error, Harper and Hunspell as a warning -- so the same typo came back
/// red or yellow depending on which of them got there, and a word all three
/// found whose spans did not merge showed both colours at once. Deciding it
/// here makes the colour mean how serious the problem is and never which
/// checker found it, and leaves the merge's "keep the highest severity" rule
/// a real tiebreak rather than a vote between arbitrary defaults.
///
/// A user's `rules:` override still wins: this is the default, applied first.
#[must_use]
pub fn default_severity(unified_id: &str) -> Option<i32> {
    // Categories, not individual rules: a rule this table does not know about
    // keeps whatever its engine said, which is the right answer for an
    // external provider's own vocabulary.
    let category = unified_id.split('.').next().unwrap_or(unified_id);
    Some(match category {
        // Wrong, and unambiguously so.
        "spelling" | "grammar" => 2, // warning
        // A judgement about how the prose reads, which the author may disagree
        // with. Never an error.
        "style" | "typography" => 1, // information
        _ => return None,
    })
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

    #[test]
    fn spelling_has_one_severity_whichever_engine_found_it() {
        // The reason this exists: LanguageTool reports a misspelling as an
        // error and Harper as a warning, so `recieved` came back red from one
        // and yellow from the other.
        let normalizer = RuleNormalizer::new();
        let harper = normalizer.normalize("harper", "harper.Spelling");
        let lt = normalizer.normalize("languagetool", "languagetool.MORFOLOGIK_RULE_EN_US");
        assert_eq!(default_severity(&harper), default_severity(&lt));
        assert_eq!(default_severity(&harper), Some(2));
    }

    #[test]
    fn style_is_never_an_error() {
        assert_eq!(default_severity("style.passive_voice"), Some(1));
        assert_eq!(default_severity("typography.punctuation"), Some(1));
    }

    #[test]
    fn an_unknown_category_keeps_what_its_engine_said() {
        // An external provider's own vocabulary is not this table's business.
        assert_eq!(default_severity("vale.Custom"), None);
    }
}
