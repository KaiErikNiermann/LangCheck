use anyhow::Result;
use serde::Deserialize;
use std::path::Path;

use crate::checker::{Diagnostic, Severity};

/// A declarative style rule loaded from YAML, inspired by Vale.
#[derive(Debug, Deserialize, Clone)]
pub struct StyleRule {
    /// Unique rule identifier (e.g. "custom.no-passive-voice").
    pub id: String,
    /// Human-readable message shown to the user.
    pub message: String,
    /// Severity level: "error", "warning", "info", "hint".
    #[serde(default = "default_severity")]
    pub severity: String,
    /// The match pattern type.
    #[serde(flatten)]
    pub pattern: PatternType,
    /// Optional replacement suggestion.
    pub suggestion: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum PatternType {
    /// Match exact words/phrases (case-insensitive by default).
    #[serde(rename = "existence")]
    Existence {
        tokens: Vec<String>,
        #[serde(default)]
        ignorecase: bool,
    },
    /// Match a regex pattern.
    #[serde(rename = "pattern")]
    Pattern { regex: String },
    /// Match one token and suggest substitution with another.
    #[serde(rename = "substitution")]
    Substitution {
        swap: std::collections::HashMap<String, String>,
        #[serde(default)]
        ignorecase: bool,
    },
}

fn default_severity() -> String {
    "warning".to_string()
}

/// Engine that applies declarative style rules to prose text.
pub struct StyleRuleEngine {
    rules: Vec<StyleRule>,
}

impl Default for StyleRuleEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl StyleRuleEngine {
    #[must_use]
    pub const fn new() -> Self {
        Self { rules: Vec::new() }
    }

    /// Load rules from a YAML file.
    pub fn load_file(&mut self, path: &Path) -> Result<usize> {
        let content = std::fs::read_to_string(path)?;
        self.load_yaml(&content)
    }

    /// Load rules from a YAML string.
    pub fn load_yaml(&mut self, yaml: &str) -> Result<usize> {
        let rules: Vec<StyleRule> = serde_yaml::from_str(yaml)?;
        let count = rules.len();
        self.rules.extend(rules);
        Ok(count)
    }

    /// Load all `.yaml`/`.yml` files from a directory.
    pub fn load_dir(&mut self, dir: &Path) -> Result<usize> {
        let mut total = 0;
        if !dir.exists() {
            return Ok(0);
        }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str())
                && (ext == "yaml" || ext == "yml")
            {
                total += self.load_file(&path)?;
            }
        }
        Ok(total)
    }

    /// Number of loaded rules.
    #[must_use]
    pub const fn rule_count(&self) -> usize {
        self.rules.len()
    }

    /// Check prose text against all loaded rules.
    #[must_use]
    pub fn check(&self, text: &str) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();

        for rule in &self.rules {
            match &rule.pattern {
                PatternType::Existence { tokens, ignorecase } => {
                    for token in tokens {
                        Self::find_token_matches(text, token, *ignorecase, rule, &mut diagnostics);
                    }
                }
                PatternType::Pattern { regex } => {
                    if let Ok(re) = regex::Regex::new(regex) {
                        for m in re.find_iter(text) {
                            let suggestions = rule
                                .suggestion
                                .as_ref()
                                .map_or_else(Vec::new, |s| vec![s.clone()]);
                            diagnostics.push(Self::make_diagnostic(
                                rule,
                                m.start(),
                                m.end(),
                                suggestions,
                            ));
                        }
                    }
                }
                PatternType::Substitution { swap, ignorecase } => {
                    for (from, to) in swap {
                        Self::find_token_matches_with_suggestion(
                            text,
                            from,
                            *ignorecase,
                            rule,
                            to,
                            &mut diagnostics,
                        );
                    }
                }
            }
        }

        diagnostics
    }

    fn find_token_matches(
        text: &str,
        token: &str,
        ignorecase: bool,
        rule: &StyleRule,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        Self::find_token_matches_with_suggestion(
            text,
            token,
            ignorecase,
            rule,
            rule.suggestion.as_deref().unwrap_or_default(),
            diagnostics,
        );
    }

    fn find_token_matches_with_suggestion(
        text: &str,
        token: &str,
        ignorecase: bool,
        rule: &StyleRule,
        suggestion: &str,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        let search_text = if ignorecase {
            text.to_lowercase()
        } else {
            text.to_string()
        };
        let search_token = if ignorecase {
            token.to_lowercase()
        } else {
            token.to_string()
        };

        let mut start = 0;
        while let Some(pos) = search_text[start..].find(&search_token) {
            let abs_pos = start + pos;
            let end_pos = abs_pos + token.len();

            // Ensure word boundary match (not part of a larger word)
            let at_word_start =
                abs_pos == 0 || !text.as_bytes()[abs_pos - 1].is_ascii_alphanumeric();
            let at_word_end = end_pos >= text.len()
                || !text.as_bytes()[end_pos.min(text.len() - 1)].is_ascii_alphanumeric();

            if at_word_start && at_word_end {
                let suggestions = if suggestion.is_empty() {
                    vec![]
                } else {
                    vec![suggestion.to_string()]
                };
                diagnostics.push(Self::make_diagnostic(rule, abs_pos, end_pos, suggestions));
            }

            start = abs_pos + 1;
        }
    }

    fn make_diagnostic(
        rule: &StyleRule,
        start: usize,
        end: usize,
        suggestions: Vec<String>,
    ) -> Diagnostic {
        let severity = match rule.severity.as_str() {
            "error" => Severity::Error as i32,
            "info" => Severity::Information as i32,
            "hint" => Severity::Hint as i32,
            _ => Severity::Warning as i32,
        };

        Diagnostic {
            #[allow(clippy::cast_possible_truncation)]
            start_byte: start as u32,
            #[allow(clippy::cast_possible_truncation)]
            end_byte: end as u32,
            message: rule.message.clone(),
            suggestions,
            rule_id: rule.id.clone(),
            severity,
            unified_id: format!("style.custom.{}", rule.id),
            confidence: 0.9,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXISTENCE_YAML: &str = r#"
- id: no-jargon
  message: "Avoid jargon"
  severity: warning
  type: existence
  tokens:
    - leverage
    - synergy
    - paradigm
  ignorecase: true
"#;

    const SUBSTITUTION_YAML: &str = r#"
- id: contractions
  message: "Use the expanded form"
  severity: info
  type: substitution
  swap:
    "don't": "do not"
    "can't": "cannot"
    "won't": "will not"
  ignorecase: false
"#;

    const PATTERN_YAML: &str = r#"
- id: no-passive
  message: "Avoid passive voice"
  severity: warning
  type: pattern
  regex: '\b(was|were|been|being)\s+\w+ed\b'
"#;

    #[test]
    fn load_existence_rules() {
        let mut engine = StyleRuleEngine::new();
        let count = engine.load_yaml(EXISTENCE_YAML).unwrap();
        assert_eq!(count, 1);
        assert_eq!(engine.rule_count(), 1);
    }

    #[test]
    fn existence_match() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(EXISTENCE_YAML).unwrap();
        let diagnostics = engine.check("We should leverage our synergy.");
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().any(|d| d.rule_id == "no-jargon"));
    }

    #[test]
    fn existence_ignorecase() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(EXISTENCE_YAML).unwrap();
        let diagnostics = engine.check("LEVERAGE the Paradigm.");
        assert_eq!(diagnostics.len(), 2);
    }

    #[test]
    fn existence_word_boundary() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(EXISTENCE_YAML).unwrap();
        // "leveraged" should NOT match "leverage" due to word boundary
        let diagnostics = engine.check("They leveraged their position.");
        assert_eq!(diagnostics.len(), 0);
    }

    #[test]
    fn substitution_match() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(SUBSTITUTION_YAML).unwrap();
        let diagnostics = engine.check("You don't need to worry.");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].suggestions, vec!["do not"]);
    }

    #[test]
    fn pattern_match() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(PATTERN_YAML).unwrap();
        let diagnostics = engine.check("The ball was kicked by the player.");
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].rule_id, "no-passive");
    }

    #[test]
    fn no_matches_on_clean_text() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(EXISTENCE_YAML).unwrap();
        let diagnostics = engine.check("The quick brown fox jumped over the lazy dog.");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn multiple_rule_files() {
        let mut engine = StyleRuleEngine::new();
        engine.load_yaml(EXISTENCE_YAML).unwrap();
        engine.load_yaml(SUBSTITUTION_YAML).unwrap();
        engine.load_yaml(PATTERN_YAML).unwrap();
        assert_eq!(engine.rule_count(), 3);
    }
}
