use crate::checker::{Diagnostic, Severity};
use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;
use tracing::{debug, warn};

use super::Engine;

pub struct ProselintEngine {
    config_path: Option<String>,
}

impl ProselintEngine {
    #[must_use]
    pub const fn new(config_path: Option<String>) -> Self {
        Self { config_path }
    }
}

/// Top-level JSON output from `proselint check -o json`.
#[derive(Deserialize)]
struct ProselintOutput {
    result: HashMap<String, ProselintFileResult>,
}

/// Per-file result — either diagnostics or an error.
#[derive(Deserialize)]
#[serde(untagged)]
enum ProselintFileResult {
    Ok {
        diagnostics: Vec<ProselintDiagnostic>,
    },
    Err {
        error: ProselintError,
    },
}

#[derive(Deserialize)]
struct ProselintDiagnostic {
    check_path: String,
    message: String,
    /// Character offsets [start, end] in padded content (shifted by +1).
    span: (usize, usize),
    /// Suggested replacement text, or null.
    replacements: Option<String>,
}

#[derive(Deserialize)]
struct ProselintError {
    message: String,
}

/// Convert proselint's character-offset span (1-based due to `"\n"` padding)
/// to byte offsets in the original text.
///
/// Proselint internally pads content as `"\n" + content + "\n"`, so all span
/// values are shifted by +1 character. We subtract 1 to get the offset into
/// the original text, then convert from char offset to byte offset.
#[allow(clippy::cast_possible_truncation)]
fn char_span_to_byte_range(text: &str, span: (usize, usize)) -> (u32, u32) {
    // Subtract the 1-char padding offset
    let char_start = span.0.saturating_sub(1);
    let char_end = span.1.saturating_sub(1);

    let mut byte_start = text.len();
    let mut byte_end = text.len();

    for (i, (byte_idx, _)) in text.char_indices().enumerate() {
        if i == char_start {
            byte_start = byte_idx;
        }
        if i == char_end {
            byte_end = byte_idx;
            break;
        }
    }

    (byte_start as u32, byte_end as u32)
}

#[async_trait::async_trait]
impl Engine for ProselintEngine {
    fn name(&self) -> &'static str {
        "proselint"
    }

    fn supported_languages(&self) -> Vec<&'static str> {
        vec!["en"]
    }

    async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
        use tokio::io::AsyncWriteExt;
        use tokio::process::Command;

        let mut cmd = Command::new("proselint");
        cmd.arg("check").arg("-o").arg("json");

        if let Some(cfg) = &self.config_path {
            cmd.arg("--config").arg(cfg);
        }

        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let output = match cmd.spawn() {
            Ok(mut child) => {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(text.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                }
                child.wait_with_output().await?
            }
            Err(e) => {
                warn!("Failed to spawn proselint: {e}");
                return Ok(vec![]);
            }
        };

        // Exit code 0 = clean, 1 = found errors (both normal)
        // Exit code >= 2 = actual error
        let code = output.status.code().unwrap_or(4);
        if code >= 2 {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(code, stderr = stderr.trim(), "Proselint error");
            return Ok(vec![]);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.trim().is_empty() {
            return Ok(vec![]);
        }

        let parsed: ProselintOutput = match serde_json::from_str(&stdout) {
            Ok(o) => o,
            Err(e) => {
                warn!("Failed to parse proselint JSON: {e}");
                debug!(stdout = %stdout, "Raw proselint output");
                return Ok(vec![]);
            }
        };

        let mut diagnostics = Vec::new();
        for file_result in parsed.result.into_values() {
            match file_result {
                ProselintFileResult::Ok {
                    diagnostics: diags,
                } => {
                    for d in diags {
                        let (start_byte, end_byte) = char_span_to_byte_range(text, d.span);
                        let suggestions = d
                            .replacements
                            .map(|r| vec![r])
                            .unwrap_or_default();

                        diagnostics.push(Diagnostic {
                            start_byte,
                            end_byte,
                            message: d.message,
                            suggestions,
                            rule_id: format!("proselint.{}", d.check_path),
                            severity: Severity::Warning as i32,
                            unified_id: String::new(),
                            confidence: 0.7,
                        });
                    }
                }
                ProselintFileResult::Err { error } => {
                    warn!(msg = error.message, "Proselint reported a file error");
                }
            }
        }

        Ok(diagnostics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn char_span_basic() {
        let text = "Hello world";
        // proselint span would be (7, 12) for "world" (1-based offset from padding)
        let (start, end) = char_span_to_byte_range(text, (7, 12));
        assert_eq!(start, 6);
        assert_eq!(end, 11);
        assert_eq!(&text[start as usize..end as usize], "world");
    }

    #[test]
    fn char_span_start_of_text() {
        let text = "Hello";
        // proselint span (1, 6) for "Hello" (padded +1)
        let (start, end) = char_span_to_byte_range(text, (1, 6));
        assert_eq!(start, 0);
        assert_eq!(end, 5);
        assert_eq!(&text[start as usize..end as usize], "Hello");
    }

    #[test]
    fn char_span_unicode() {
        let text = "café latte";
        // "latte" starts at char index 5, span would be (6, 11) with padding
        let (start, end) = char_span_to_byte_range(text, (6, 11));
        assert_eq!(&text[start as usize..end as usize], "latte");
    }

    #[test]
    fn char_span_clamped() {
        let text = "short";
        let (start, end) = char_span_to_byte_range(text, (1, 100));
        assert_eq!(start, 0);
        assert_eq!(end as usize, text.len());
    }

    #[test]
    fn proselint_diagnostic_deserializes() {
        let json = r#"{
            "check_path": "uncomparables",
            "message": "Comparison of an uncomparable: 'very unique'.",
            "span": [10, 21],
            "replacements": "unique",
            "pos": [1, 9]
        }"#;
        let d: ProselintDiagnostic = serde_json::from_str(json).unwrap();
        assert_eq!(d.check_path, "uncomparables");
        assert_eq!(d.span, (10, 21));
        assert_eq!(d.replacements.as_deref(), Some("unique"));
    }

    #[test]
    fn proselint_diagnostic_null_replacements() {
        let json = r#"{
            "check_path": "hedging",
            "message": "Hedging: 'I think'.",
            "span": [1, 8],
            "replacements": null,
            "pos": [1, 0]
        }"#;
        let d: ProselintDiagnostic = serde_json::from_str(json).unwrap();
        assert!(d.replacements.is_none());
    }

    #[test]
    fn proselint_full_output_deserializes() {
        let json = r#"{
            "result": {
                "<stdin>": {
                    "diagnostics": [
                        {
                            "check_path": "uncomparables",
                            "message": "Comparison of an uncomparable.",
                            "span": [10, 21],
                            "replacements": "unique",
                            "pos": [1, 9]
                        }
                    ]
                }
            }
        }"#;
        let output: ProselintOutput = serde_json::from_str(json).unwrap();
        assert_eq!(output.result.len(), 1);
        match &output.result["<stdin>"] {
            ProselintFileResult::Ok { diagnostics } => {
                assert_eq!(diagnostics.len(), 1);
                assert_eq!(diagnostics[0].check_path, "uncomparables");
            }
            ProselintFileResult::Err { .. } => panic!("expected Ok"),
        }
    }

    #[test]
    fn proselint_error_result_deserializes() {
        let json = r#"{
            "result": {
                "<stdin>": {
                    "error": {
                        "code": -31997,
                        "message": "Some error occurred"
                    }
                }
            }
        }"#;
        let output: ProselintOutput = serde_json::from_str(json).unwrap();
        match &output.result["<stdin>"] {
            ProselintFileResult::Err { error } => {
                assert_eq!(error.message, "Some error occurred");
            }
            ProselintFileResult::Ok { .. } => panic!("expected Err"),
        }
    }

    #[tokio::test]
    async fn proselint_engine_missing_binary() -> Result<()> {
        let mut engine = ProselintEngine::new(None);
        let result = engine.check("test text", "en-US").await;
        assert!(result.is_ok());
        Ok(())
    }

    /// Live integration test — requires `proselint` installed.
    /// Run with: `cargo test proselint_engine_live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn proselint_engine_live() -> Result<()> {
        let mut engine = ProselintEngine::new(None);
        let text = "This is very unique and extremely obvious.";
        let diagnostics = engine.check(text, "en-US").await?;

        println!("Proselint returned {} diagnostics:", diagnostics.len());
        for d in &diagnostics {
            println!(
                "  [{}-{}] {} (rule: {}, suggestions: {:?})",
                d.start_byte, d.end_byte, d.message, d.rule_id, d.suggestions
            );
        }

        assert!(
            !diagnostics.is_empty(),
            "Expected at least 1 diagnostic from proselint"
        );
        assert!(diagnostics[0].rule_id.starts_with("proselint."));
        Ok(())
    }
}
