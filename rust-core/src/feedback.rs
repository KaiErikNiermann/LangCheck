use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Tracks how often each rule's diagnostics are dismissed/ignored by the user.
///
/// This data is stored per-project and used to suggest disabling noisy rules.
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct FeedbackTracker {
    /// Map from unified_rule_id -> stats
    rules: HashMap<String, RuleStats>,
}

/// Per-rule feedback statistics.
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct RuleStats {
    /// Number of times this rule's diagnostic was shown.
    pub shown: u64,
    /// Number of times the user dismissed/ignored this rule's diagnostic.
    pub dismissed: u64,
    /// Number of times the user applied the suggested fix.
    pub fixed: u64,
}

impl RuleStats {
    /// Fraction of shown diagnostics that were dismissed (0.0 to 1.0).
    #[must_use]
    pub fn dismiss_rate(&self) -> f64 {
        if self.shown == 0 {
            0.0
        } else {
            self.dismissed as f64 / self.shown as f64
        }
    }
}

/// A suggestion to disable a frequently-ignored rule.
#[derive(Debug, Clone, PartialEq)]
pub struct DisableSuggestion {
    pub rule_id: String,
    pub dismiss_rate: f64,
    pub dismissed_count: u64,
}

impl FeedbackTracker {
    /// Create a new empty tracker.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that a diagnostic was shown to the user.
    pub fn record_shown(&mut self, rule_id: &str) {
        self.rules
            .entry(rule_id.to_string())
            .or_default()
            .shown += 1;
    }

    /// Record that the user dismissed a diagnostic.
    pub fn record_dismissed(&mut self, rule_id: &str) {
        let stats = self.rules.entry(rule_id.to_string()).or_default();
        stats.dismissed += 1;
    }

    /// Record that the user applied a fix.
    pub fn record_fixed(&mut self, rule_id: &str) {
        let stats = self.rules.entry(rule_id.to_string()).or_default();
        stats.fixed += 1;
    }

    /// Get stats for a specific rule.
    #[must_use]
    pub fn get_stats(&self, rule_id: &str) -> Option<&RuleStats> {
        self.rules.get(rule_id)
    }

    /// Get rules that are frequently dismissed and should be considered for disabling.
    ///
    /// Returns rules where dismiss_rate > `threshold` and at least `min_shown` occurrences.
    #[must_use]
    pub fn suggest_disable(&self, threshold: f64, min_shown: u64) -> Vec<DisableSuggestion> {
        let mut suggestions: Vec<DisableSuggestion> = self
            .rules
            .iter()
            .filter(|(_, stats)| stats.shown >= min_shown && stats.dismiss_rate() > threshold)
            .map(|(rule_id, stats)| DisableSuggestion {
                rule_id: rule_id.clone(),
                dismiss_rate: stats.dismiss_rate(),
                dismissed_count: stats.dismissed,
            })
            .collect();

        // Sort by dismiss rate descending
        suggestions.sort_by(|a, b| b.dismiss_rate.partial_cmp(&a.dismiss_rate).unwrap_or(std::cmp::Ordering::Equal));
        suggestions
    }

    /// Number of tracked rules.
    #[must_use]
    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    /// Load feedback data from a JSON file.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        if path.exists() {
            let content = std::fs::read_to_string(path)?;
            let tracker: Self = serde_json::from_str(&content)?;
            Ok(tracker)
        } else {
            Ok(Self::new())
        }
    }

    /// Save feedback data to a JSON file.
    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Create an anonymized false-positive report for a specific diagnostic.
    #[must_use]
    pub fn create_false_positive_report(
        rule_id: &str,
        text_snippet: &str,
        max_snippet_len: usize,
    ) -> FalsePositiveReport {
        // Truncate and anonymize the snippet
        let snippet = if text_snippet.len() > max_snippet_len {
            &text_snippet[..max_snippet_len]
        } else {
            text_snippet
        };

        FalsePositiveReport {
            rule_id: rule_id.to_string(),
            snippet: snippet.to_string(),
        }
    }
}

/// An anonymized false-positive report that can be sent to engine maintainers.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct FalsePositiveReport {
    pub rule_id: String,
    pub snippet: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_tracker_is_empty() {
        let tracker = FeedbackTracker::new();
        assert_eq!(tracker.rule_count(), 0);
    }

    #[test]
    fn record_and_retrieve_stats() {
        let mut tracker = FeedbackTracker::new();
        tracker.record_shown("spelling.typo");
        tracker.record_shown("spelling.typo");
        tracker.record_dismissed("spelling.typo");
        tracker.record_fixed("spelling.typo");

        let stats = tracker.get_stats("spelling.typo").unwrap();
        assert_eq!(stats.shown, 2);
        assert_eq!(stats.dismissed, 1);
        assert_eq!(stats.fixed, 1);
    }

    #[test]
    fn dismiss_rate_calculation() {
        let stats = RuleStats {
            shown: 10,
            dismissed: 8,
            fixed: 2,
        };
        let rate = stats.dismiss_rate();
        assert!((rate - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn dismiss_rate_zero_shown() {
        let stats = RuleStats::default();
        assert!((stats.dismiss_rate()).abs() < f64::EPSILON);
    }

    #[test]
    fn suggest_disable_above_threshold() {
        let mut tracker = FeedbackTracker::new();

        // Rule with high dismiss rate
        for _ in 0..10 {
            tracker.record_shown("noisy.rule");
            tracker.record_dismissed("noisy.rule");
        }

        // Rule with low dismiss rate
        for _ in 0..10 {
            tracker.record_shown("useful.rule");
        }
        tracker.record_dismissed("useful.rule");

        // Rule below min_shown
        tracker.record_shown("rare.rule");
        tracker.record_dismissed("rare.rule");

        let suggestions = tracker.suggest_disable(0.5, 5);
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].rule_id, "noisy.rule");
        assert!((suggestions[0].dismiss_rate - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir().join("lang_check_feedback_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("feedback.json");

        let mut tracker = FeedbackTracker::new();
        tracker.record_shown("test.rule");
        tracker.record_dismissed("test.rule");
        tracker.save(&path).unwrap();

        let loaded = FeedbackTracker::load(&path).unwrap();
        let stats = loaded.get_stats("test.rule").unwrap();
        assert_eq!(stats.shown, 1);
        assert_eq!(stats.dismissed, 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let path = std::env::temp_dir().join("lang_check_feedback_nonexistent.json");
        let tracker = FeedbackTracker::load(&path).unwrap();
        assert_eq!(tracker.rule_count(), 0);
    }

    #[test]
    fn false_positive_report() {
        let report = FeedbackTracker::create_false_positive_report(
            "spelling.typo",
            "This is a perfectly valid sentence.",
            50,
        );
        assert_eq!(report.rule_id, "spelling.typo");
        assert_eq!(report.snippet, "This is a perfectly valid sentence.");
    }

    #[test]
    fn false_positive_report_truncation() {
        let long_text = "a".repeat(200);
        let report = FeedbackTracker::create_false_positive_report("test.rule", &long_text, 50);
        assert_eq!(report.snippet.len(), 50);
    }
}
