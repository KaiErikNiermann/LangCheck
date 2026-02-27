use crate::checker::{Diagnostic, Severity};
use anyhow::Result;
use harper_core::{
    Dialect, Document, Lrc,
    linting::{LintGroup, Linter},
    parsers::Markdown,
    spell::FstDictionary,
};
use serde::Deserialize;

#[async_trait::async_trait]
pub trait Engine {
    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>>;
}

pub struct HarperEngine {
    linter: LintGroup,
    dict: Lrc<FstDictionary>,
}

impl Default for HarperEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl HarperEngine {
    #[must_use]
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

        let diagnostics = lints
            .into_iter()
            .map(|lint| {
                let suggestions = lint
                    .suggestions
                    .into_iter()
                    .map(|s| match s {
                        harper_core::linting::Suggestion::ReplaceWith(chars) => {
                            chars.into_iter().collect::<String>()
                        }
                        _ => s.to_string(),
                    })
                    .collect();

                Diagnostic {
                    #[allow(clippy::cast_possible_truncation)]
                    start_byte: lint.span.start as u32,
                    #[allow(clippy::cast_possible_truncation)]
                    end_byte: lint.span.end as u32,
                    message: lint.message,
                    suggestions,
                    rule_id: format!("harper.{:?}", lint.lint_kind),
                    severity: Severity::Warning as i32,
                    unified_id: String::new(), // Will be filled by normalizer
                    confidence: 0.8,
                }
            })
            .collect();

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
    #[must_use]
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
        let lt_lang = if language_id == "markdown" {
            "en-US" // Default if it's just the file type
        } else {
            language_id
        };

        let res = match self
            .client
            .post(&url)
            .form(&[("text", text), ("language", lt_lang)])
            .send()
            .await
        {
            Ok(r) => r.json::<LTResponse>().await?,
            Err(e) => {
                eprintln!("LanguageTool connection error: {e}");
                return Ok(vec![]);
            }
        };

        let diagnostics = res
            .matches
            .into_iter()
            .map(|m| {
                let severity = match m.rule.issue_type.as_str() {
                    "misspelling" => Severity::Error,
                    "typographical" => Severity::Warning,
                    _ => Severity::Information,
                };

                Diagnostic {
                    #[allow(clippy::cast_possible_truncation)]
                    start_byte: m.offset as u32,
                    #[allow(clippy::cast_possible_truncation)]
                    end_byte: (m.offset + m.length) as u32,
                    message: m.message,
                    suggestions: m.replacements.into_iter().map(|r| r.value).collect(),
                    rule_id: format!("languagetool.{}", m.rule.id),
                    severity: severity as i32,
                    unified_id: String::new(), // Will be filled by normalizer
                    confidence: 0.7,
                }
            })
            .collect();

        Ok(diagnostics)
    }
}

/// An external checker engine that communicates with a subprocess via stdin/stdout JSON.
pub struct ExternalEngine {
    name: String,
    command: String,
    args: Vec<String>,
}

impl ExternalEngine {
    #[must_use]
    pub fn new(name: String, command: String, args: Vec<String>) -> Self {
        Self {
            name,
            command,
            args,
        }
    }
}

/// JSON request sent to the external process on stdin.
#[derive(serde::Serialize)]
struct ExternalRequest<'a> {
    text: &'a str,
    language_id: &'a str,
}

/// JSON diagnostic returned by the external process on stdout.
#[derive(Deserialize)]
struct ExternalDiagnostic {
    start_byte: u32,
    end_byte: u32,
    message: String,
    #[serde(default)]
    suggestions: Vec<String>,
    #[serde(default)]
    rule_id: String,
    #[serde(default = "default_severity_value")]
    severity: i32,
    #[serde(default)]
    confidence: f32,
}

fn default_severity_value() -> i32 {
    Severity::Warning as i32
}

#[async_trait::async_trait]
impl Engine for ExternalEngine {
    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        use tokio::process::Command;

        let request = ExternalRequest { text, language_id };
        let input = serde_json::to_string(&request)?;

        let output = match Command::new(&self.command)
            .args(&self.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                use tokio::io::AsyncWriteExt;
                if let Some(mut stdin) = child.stdin.take() {
                    stdin.write_all(input.as_bytes()).await?;
                    stdin.shutdown().await?;
                }
                child.wait_with_output().await?
            }
            Err(e) => {
                eprintln!("Failed to spawn external provider '{}': {e}", self.name);
                return Ok(vec![]);
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!(
                "External provider '{}' exited with {}: {}",
                self.name,
                output.status,
                stderr.trim()
            );
            return Ok(vec![]);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let ext_diagnostics: Vec<ExternalDiagnostic> = match serde_json::from_str(&stdout) {
            Ok(d) => d,
            Err(e) => {
                eprintln!(
                    "Failed to parse output from external provider '{}': {e}",
                    self.name
                );
                return Ok(vec![]);
            }
        };

        let diagnostics = ext_diagnostics
            .into_iter()
            .map(|ed| {
                let rule_id = if ed.rule_id.is_empty() {
                    format!("external.{}", self.name)
                } else {
                    format!("external.{}.{}", self.name, ed.rule_id)
                };
                Diagnostic {
                    start_byte: ed.start_byte,
                    end_byte: ed.end_byte,
                    message: ed.message,
                    suggestions: ed.suggestions,
                    rule_id,
                    severity: ed.severity,
                    unified_id: String::new(),
                    confidence: if ed.confidence > 0.0 {
                        ed.confidence
                    } else {
                        0.7
                    },
                }
            })
            .collect();

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

    #[tokio::test]
    async fn external_engine_with_echo() -> Result<()> {
        // Use a simple shell command that echoes a valid JSON response
        let mut engine = ExternalEngine::new(
            "test-provider".to_string(),
            "sh".to_string(),
            vec![
                "-c".to_string(),
                r#"cat > /dev/null; echo '[{"start_byte":0,"end_byte":4,"message":"test issue","suggestions":["fix"],"rule_id":"test.rule","severity":2}]'"#.to_string(),
            ],
        );

        let diagnostics = engine.check("some text", "markdown").await?;
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "test issue");
        assert_eq!(diagnostics[0].rule_id, "external.test-provider.test.rule");
        assert_eq!(diagnostics[0].suggestions, vec!["fix"]);
        assert_eq!(diagnostics[0].start_byte, 0);
        assert_eq!(diagnostics[0].end_byte, 4);

        Ok(())
    }

    #[tokio::test]
    async fn external_engine_missing_binary() -> Result<()> {
        let mut engine = ExternalEngine::new(
            "nonexistent".to_string(),
            "/nonexistent/binary".to_string(),
            vec![],
        );

        // Should not error, just return empty
        let diagnostics = engine.check("text", "markdown").await?;
        assert!(diagnostics.is_empty());

        Ok(())
    }

    #[tokio::test]
    async fn external_engine_bad_json_output() -> Result<()> {
        let mut engine = ExternalEngine::new(
            "bad-json".to_string(),
            "echo".to_string(),
            vec!["not json".to_string()],
        );

        // Should not error, just return empty
        let diagnostics = engine.check("text", "markdown").await?;
        assert!(diagnostics.is_empty());

        Ok(())
    }
}
