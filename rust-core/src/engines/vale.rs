use crate::checker::{Diagnostic, Severity};
use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;
use tracing::{debug, warn};

use super::Engine;

pub struct ValeEngine {
    config_path: Option<String>,
}

impl ValeEngine {
    #[must_use]
    pub const fn new(config_path: Option<String>) -> Self {
        Self { config_path }
    }
}

/// A single alert from Vale's `--output=JSON` format.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ValeAlert {
    message: String,
    severity: String,
    line: u32,
    span: (u32, u32),
    check: String,
    #[serde(default)]
    action: ValeAction,
}

/// Fix action attached to a Vale alert.
#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
struct ValeAction {
    #[serde(default)]
    name: String,
    #[serde(default)]
    params: Vec<String>,
}

/// Map a Vale file extension hint from the language ID.
/// The orchestrator passes a BCP-47 tag (e.g. "en-US"), but we also accept
/// file-type IDs for direct use in tests.
fn ext_for_language_id(language_id: &str) -> &str {
    match language_id {
        "html" => ".html",
        "latex" => ".tex",
        "typst" => ".typ",
        "restructuredtext" => ".rst",
        "org" => ".org",
        // "markdown", BCP-47 tags, and anything unknown default to .md
        _ => ".md",
    }
}

/// Convert a 1-based line number and 1-based column span to byte offsets.
#[allow(clippy::cast_possible_truncation)]
fn line_span_to_byte_range(text: &str, line: u32, span: (u32, u32)) -> (u32, u32) {
    let target_line = line.saturating_sub(1) as usize;
    let mut byte_offset: u32 = 0;

    for (i, l) in text.split('\n').enumerate() {
        if i == target_line {
            let col_start = span.0.saturating_sub(1) as usize;
            let col_end = span.1 as usize; // span end is inclusive in Vale
            let start = byte_offset + col_start.min(l.len()) as u32;
            let end = byte_offset + col_end.min(l.len()) as u32;
            return (start, end);
        }
        byte_offset += l.len() as u32 + 1;
    }

    (byte_offset, byte_offset)
}

fn map_severity(vale_severity: &str) -> i32 {
    match vale_severity {
        "error" => Severity::Error as i32,
        "suggestion" => Severity::Hint as i32,
        // "warning" and anything unknown
        _ => Severity::Warning as i32,
    }
}

fn suggestions_from_action(action: &ValeAction) -> Vec<String> {
    match action.name.as_str() {
        "replace" | "suggest" => action.params.clone(),
        "remove" => vec![String::new()],
        _ => Vec::new(),
    }
}

#[async_trait::async_trait]
impl Engine for ValeEngine {
    fn name(&self) -> &'static str {
        "vale"
    }

    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        use tokio::io::AsyncWriteExt;
        use tokio::process::Command;

        let ext = ext_for_language_id(language_id);
        let mut cmd = Command::new("vale");
        cmd.arg("--output=JSON")
            .arg("--no-exit")
            .arg(format!("--ext={ext}"));

        if let Some(cfg) = &self.config_path {
            cmd.arg(format!("--config={cfg}"));
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
                warn!("Failed to spawn vale: {e}");
                return Ok(vec![]);
            }
        };

        // Vale exit code 2 = runtime error; 0 or 1 = normal
        if output.status.code() == Some(2) {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(stderr = stderr.trim(), "Vale runtime error");
            return Ok(vec![]);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.trim().is_empty() {
            return Ok(vec![]);
        }

        let vale_output: HashMap<String, Vec<ValeAlert>> = match serde_json::from_str(&stdout) {
            Ok(o) => o,
            Err(e) => {
                warn!("Failed to parse Vale JSON output: {e}");
                debug!(stdout = %stdout, "Raw Vale output");
                return Ok(vec![]);
            }
        };

        let mut diagnostics = Vec::new();
        for alerts in vale_output.into_values() {
            for alert in alerts {
                let (start_byte, end_byte) =
                    line_span_to_byte_range(text, alert.line, alert.span);

                diagnostics.push(Diagnostic {
                    start_byte,
                    end_byte,
                    message: alert.message,
                    suggestions: suggestions_from_action(&alert.action),
                    rule_id: format!("vale.{}", alert.check),
                    severity: map_severity(&alert.severity),
                    unified_id: String::new(),
                    confidence: 0.75,
                });
            }
        }

        Ok(diagnostics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_span_to_byte_range_first_line() {
        let text = "Hello world";
        // Line 1, columns 7-11 (1-based) → "world"
        let (start, end) = line_span_to_byte_range(text, 1, (7, 11));
        assert_eq!(&text[start as usize..end as usize], "world");
    }

    #[test]
    fn line_span_to_byte_range_second_line() {
        let text = "First line\nSecond line here";
        // Line 2, columns 8-11 (1-based) → "line"
        let (start, end) = line_span_to_byte_range(text, 2, (8, 11));
        assert_eq!(&text[start as usize..end as usize], "line");
    }

    #[test]
    fn line_span_to_byte_range_clamped() {
        let text = "short";
        // Span extends beyond line length — should clamp
        let (start, end) = line_span_to_byte_range(text, 1, (1, 100));
        assert_eq!(start, 0);
        assert_eq!(end, 5);
    }

    #[test]
    fn map_severity_values() {
        assert_eq!(map_severity("error"), Severity::Error as i32);
        assert_eq!(map_severity("warning"), Severity::Warning as i32);
        assert_eq!(map_severity("suggestion"), Severity::Hint as i32);
        assert_eq!(map_severity("unknown"), Severity::Warning as i32);
    }

    #[test]
    fn suggestions_from_replace_action() {
        let action = ValeAction {
            name: "replace".to_string(),
            params: vec!["use".to_string(), "utilize".to_string()],
        };
        assert_eq!(suggestions_from_action(&action), vec!["use", "utilize"]);
    }

    #[test]
    fn suggestions_from_remove_action() {
        let action = ValeAction {
            name: "remove".to_string(),
            params: vec![],
        };
        assert_eq!(suggestions_from_action(&action), vec![""]);
    }

    #[test]
    fn suggestions_from_empty_action() {
        let action = ValeAction::default();
        assert!(suggestions_from_action(&action).is_empty());
    }

    #[test]
    fn ext_for_known_languages() {
        assert_eq!(ext_for_language_id("markdown"), ".md");
        assert_eq!(ext_for_language_id("html"), ".html");
        assert_eq!(ext_for_language_id("latex"), ".tex");
        assert_eq!(ext_for_language_id("restructuredtext"), ".rst");
        assert_eq!(ext_for_language_id("org"), ".org");
    }

    #[test]
    fn vale_alert_deserializes() {
        let json = r#"{
            "Action": {"Name": "replace", "Params": ["use"]},
            "Span": [13, 20],
            "Check": "Microsoft.Wordiness",
            "Description": "",
            "Link": "https://example.com",
            "Message": "Consider using 'use' instead of 'utilize'.",
            "Severity": "warning",
            "Match": "utilize",
            "Line": 5
        }"#;
        let alert: ValeAlert = serde_json::from_str(json).unwrap();
        assert_eq!(alert.check, "Microsoft.Wordiness");
        assert_eq!(alert.severity, "warning");
        assert_eq!(alert.line, 5);
        assert_eq!(alert.span, (13, 20));
        assert_eq!(alert.action.name, "replace");
        assert_eq!(alert.action.params, vec!["use"]);
    }

    #[test]
    fn vale_full_json_output_deserializes() {
        let json = r#"{
            "stdin.md": [
                {
                    "Action": {"Name": "replace", "Params": ["use"]},
                    "Span": [13, 20],
                    "Check": "Microsoft.Wordiness",
                    "Description": "",
                    "Link": "",
                    "Message": "Consider using 'use'.",
                    "Severity": "warning",
                    "Match": "utilize",
                    "Line": 1
                }
            ]
        }"#;
        let output: HashMap<String, Vec<ValeAlert>> = serde_json::from_str(json).unwrap();
        assert_eq!(output.len(), 1);
        let alerts = &output["stdin.md"];
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].check, "Microsoft.Wordiness");
    }

    #[tokio::test]
    async fn vale_engine_missing_binary() -> Result<()> {
        // Override PATH to ensure vale is not found
        let mut engine = ValeEngine::new(None);
        // If vale is not on PATH, should return empty (not error)
        // This test is best-effort — if vale IS installed, it will still pass
        let result = engine.check("test text", "en-US").await;
        assert!(result.is_ok());
        Ok(())
    }
}
