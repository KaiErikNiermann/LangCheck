use std::collections::HashMap;
use serde::Deserialize;

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

impl RuleNormalizer {
    pub fn new() -> Self {
        let mut normalizer = Self {
            mappings: HashMap::new(),
        };
        
        // Load default mappings
        normalizer.load_defaults();
        
        normalizer
    }

    fn load_defaults(&mut self) {
        // Harper mappings
        let mut harper = HashMap::new();
        harper.insert("harper.SpelledCorrectly".to_string(), "spelling.typo".to_string());
        harper.insert("harper.AnA".to_string(), "grammar.article".to_string());
        harper.insert("harper.RepeatedWord".to_string(), "typography.repeated_word".to_string());
        self.mappings.insert("harper".to_string(), harper);

        // LanguageTool mappings
        let mut lt = HashMap::new();
        lt.insert("languagetool.MORFOLOGIK_RULE_EN_US".to_string(), "spelling.typo".to_string());
        lt.insert("languagetool.EN_A_VS_AN".to_string(), "grammar.article".to_string());
        lt.insert("languagetool.DOUBLE_PUNCTUATION".to_string(), "typography.punctuation".to_string());
        self.mappings.insert("languagetool".to_string(), lt);
    }

    pub fn normalize(&self, provider: &str, native_id: &str) -> String {
        if let Some(provider_mappings) = self.mappings.get(provider) {
            if let Some(unified_id) = provider_mappings.get(native_id) {
                return unified_id.clone();
            }
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
