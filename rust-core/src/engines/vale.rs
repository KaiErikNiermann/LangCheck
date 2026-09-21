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
    #[serde(default, deserialize_with = "deserialize_null_as_empty_vec")]
    params: Vec<String>,
}

fn deserialize_null_as_empty_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Vec<String>>::deserialize(deserializer).map(Option::unwrap_or_default)
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
///
/// Vale is written in Go and counts its columns in runes, so the span is a
/// character index into the line and not a byte one. Taking it for bytes
/// shifts the underline left by one for every multi-byte character earlier on
/// the same line -- two for an em dash -- which on a line of prose that
/// happens to contain one lands the squiggle in the middle of the word
/// before. The offsets on the wire are bytes, so the conversion happens here.
#[allow(clippy::cast_possible_truncation)]
fn line_span_to_byte_range(text: &str, line: u32, span: (u32, u32)) -> (u32, u32) {
    let target_line = line.saturating_sub(1) as usize;
    let mut byte_offset: u32 = 0;

    for (i, l) in text.split('\n').enumerate() {
        if i == target_line {
            let table = super::char_to_byte_table(l);
            let start_char = span.0.saturating_sub(1) as usize;
            // Vale's span end is inclusive, so the exclusive index is one past.
            let end_char = span.1 as usize;
            let start = byte_offset + super::lookup_offset(&table, start_char);
            let end = byte_offset + super::lookup_offset(&table, end_char);
            return (start, end.max(start));
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
                let (start_byte, end_byte) = line_span_to_byte_range(text, alert.line, alert.span);

                diagnostics.push(Diagnostic {
                    start_byte,
                    end_byte,
                    message: alert.message,
                    suggestions: suggestions_from_action(&alert.action),
                    rule_id: format!("vale.{}", alert.check),
                    severity: map_severity(&alert.severity),
                    unified_id: String::new(),
                    confidence: 0.75,
                    language: String::new(),
                    pack_installable: false,
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

    /// The span Vale actually returned for a line out of the notes this was
    /// found in, measured with `vale 3.13.1` rather than assumed:
    ///
    /// ```text
    /// The em dash — and morphisms here.
    /// Span [19, 27]  Match "morphisms"
    /// ```
    ///
    /// The em dash is one rune and three bytes, so reading 19 as a byte
    /// column starts the underline two bytes early -- on the `d` of "and".
    #[test]
    fn a_span_after_an_em_dash_still_lands_on_the_word() {
        let text = "The em dash — and morphisms here.";
        let (start, end) = line_span_to_byte_range(text, 1, (19, 27));
        assert_eq!(&text[start as usize..end as usize], "morphisms");
    }

    #[test]
    fn a_span_on_a_later_line_counts_that_line_s_own_characters() {
        // The multi-byte character is on the first line, so the second line's
        // own columns are unaffected by it -- but the byte offset it starts
        // at is not.
        let text = "Résumé — first
The word naïve here";
        // "naïve" is chars 10-14 on line 2, 1-based inclusive.
        let (start, end) = line_span_to_byte_range(text, 2, (10, 14));
        assert_eq!(&text[start as usize..end as usize], "naïve");
    }

    #[test]
    fn a_span_reaching_past_the_line_is_clamped_to_its_end() {
        let text = "Short — line";
        let (start, end) = line_span_to_byte_range(text, 1, (9, 999));
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

    #[test]
    fn vale_alert_null_params_deserializes() {
        // Vale sends `"Params": null` when no action params exist
        let json = r#"{
            "Action": {"Name": "", "Params": null},
            "Span": [1, 2],
            "Check": "Google.We",
            "Message": "Avoid first-person plural.",
            "Severity": "warning",
            "Match": "We",
            "Line": 1
        }"#;
        let alert: ValeAlert = serde_json::from_str(json).unwrap();
        assert!(alert.action.params.is_empty());
        assert!(alert.action.name.is_empty());
    }

    #[tokio::test]
    async fn vale_engine_missing_binary() -> Result<()> {
        let mut engine = ValeEngine::new(None);
        // If vale is not on PATH, should return empty (not error)
        let result = engine.check("test text", "en-US").await;
        assert!(result.is_ok());
        Ok(())
    }

    /// Live integration test — requires `vale` on PATH with Google style.
    /// Run with: `cargo test vale_engine_live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn vale_engine_live() -> Result<()> {
        let mut engine = ValeEngine::new(Some("/tmp/vale-test/.vale.ini".to_string()));
        let text = "We would like to utilize this.";
        let diagnostics = engine.check(text, "en-US").await?;

        println!("Vale returned {} diagnostics:", diagnostics.len());
        for d in &diagnostics {
            println!(
                "  [{}-{}] {} (rule: {}, suggestions: {:?})",
                d.start_byte, d.end_byte, d.message, d.rule_id, d.suggestions
            );
        }

        assert!(
            !diagnostics.is_empty(),
            "Expected at least 1 diagnostic from Vale"
        );
        // Verify rule_id is namespaced with "vale."
        assert!(diagnostics[0].rule_id.starts_with("vale."));
        Ok(())
    }
}
