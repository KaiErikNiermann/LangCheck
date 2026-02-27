use crate::checker::{Diagnostic, Severity};
use anyhow::Result;
use harper_core::{Document, linting::{Linter, LintGroup}, Dialect, spell::FstDictionary, parsers::Markdown, Lrc};
use serde::Deserialize;

#[async_trait::async_trait]
pub trait Engine {
    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>>;
}

pub struct HarperEngine {
    linter: LintGroup,
    dict: Lrc<FstDictionary>,
}

impl HarperEngine {
    pub fn new() -> Self {
        let dict = FstDictionary::curated();
        let linter = LintGroup::new_curated(dict.clone(), Dialect::American);
        Self { linter, dict }
    }
}

#[async_trait::async_trait]
impl Engine for HarperEngine {
    async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
        let document = Document::new(text, &Markdown::default(), self.dict.as_ref());
        let lints = self.linter.lint(&document);
        
        let diagnostics = lints.into_iter().map(|lint| {
            let suggestions = lint.suggestions.into_iter().map(|s| {
                match s {
                    harper_core::linting::Suggestion::ReplaceWith(chars) => chars.into_iter().collect::<String>(),
                    _ => s.to_string(),
                }
            }).collect();

            Diagnostic {
                start_byte: lint.span.start as u32,
                end_byte: lint.span.end as u32,
                message: lint.message,
                suggestions,
                rule_id: format!("harper.{:?}", lint.lint_kind),
                severity: Severity::Warning as i32,
                unified_id: "".to_string(), // Will be filled by normalizer
                confidence: 0.8,
            }
        }).collect();
        
        Ok(diagnostics)
    }
}

pub struct LanguageToolEngine {
    url: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct LTResponse {
    matches: Vec<LTMatch>,
}

#[derive(Deserialize)]
struct LTMatch {
    message: String,
    offset: usize,
    length: usize,
    replacements: Vec<LTReplacement>,
    rule: LTRule,
}

#[derive(Deserialize)]
struct LTReplacement {
    value: String,
}

#[derive(Deserialize)]
struct LTRule {
    id: String,
    issue_type: String,
}

impl LanguageToolEngine {
    pub fn new(url: String) -> Self {
        Self {
            url,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait::async_trait]
impl Engine for LanguageToolEngine {
    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        let url = format!("{}/v2/check", self.url);
        
        // Map common language IDs to LT format if necessary
        let lt_lang = match language_id {
            "markdown" => "en-US", // Default if it's just the file type
            lang if lang.contains('-') => lang,
            lang => lang, // Try as is
        };

        let res = match self.client.post(&url)
            .form(&[
                ("text", text),
                ("language", lt_lang),
            ])
            .send()
            .await {
                Ok(r) => r.json::<LTResponse>().await?,
                Err(e) => {
                    eprintln!("LanguageTool connection error: {}", e);
                    return Ok(vec![]);
                }
            };

        let diagnostics = res.matches.into_iter().map(|m| {
            let severity = match m.rule.issue_type.as_str() {
                "misspelling" => Severity::Error,
                "typographical" => Severity::Warning,
                _ => Severity::Information,
            };

            Diagnostic {
                start_byte: m.offset as u32,
                end_byte: (m.offset + m.length) as u32,
                message: m.message,
                suggestions: m.replacements.into_iter().map(|r| r.value).collect(),
                rule_id: format!("languagetool.{}", m.rule.id),
                severity: severity as i32,
                unified_id: "".to_string(), // Will be filled by normalizer
                confidence: 0.7,
            }
        }).collect();

        Ok(diagnostics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_harper_engine() -> Result<()> {
        let mut engine = HarperEngine::new();
        let text = "This is an test.";
        let diagnostics = engine.check(text, "en-US").await?;
        
        // Harper should find "an test" error
        assert!(!diagnostics.is_empty());
        
        Ok(())
    }
}
