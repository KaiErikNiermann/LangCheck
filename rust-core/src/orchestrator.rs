use crate::checker::{Diagnostic, EngineHealth, Severity};
use crate::config::Config;
use crate::engines::{
    Engine, ExternalEngine, HarperEngine, LanguageToolEngine, ProselintEngine, ValeEngine,
    WasmEngine, engine_supports_language,
};
use crate::ignore_rules::IgnoreParser;
use crate::rules::RuleNormalizer;
use anyhow::Result;
use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tracing::warn;

#[derive(Default)]
struct EngineHealthTracker {
    consecutive_failures: u32,
    last_error: Option<String>,
    last_success: Option<Instant>,
    last_success_epoch_ms: u64,
}

pub struct Orchestrator {
    engines: Vec<Box<dyn Engine + Send>>,
    normalizer: RuleNormalizer,
    config: Config,
    engine_health: HashMap<String, EngineHealthTracker>,
}

impl Orchestrator {
    #[must_use]
    pub fn new(config: Config) -> Self {
        let mut orchestrator = Self {
            engines: Vec::new(),
            normalizer: RuleNormalizer::new(),
            config,
            engine_health: HashMap::new(),
        };

        orchestrator.initialize_engines();
        orchestrator
    }

    fn initialize_engines(&mut self) {
        self.engines.clear();
        let hpm = self.config.performance.high_performance_mode;

        if self.config.engines.harper.enabled {
            self.engines
                .push(Box::new(HarperEngine::new(&self.config.engines.harper)));
        }

        // In HPM, skip LanguageTool and external providers for speed
        if !hpm {
            if self.config.engines.languagetool.enabled {
                self.engines.push(Box::new(LanguageToolEngine::new(
                    &self.config.engines.languagetool,
                )));
            }

            if self.config.engines.vale.enabled {
                self.engines.push(Box::new(ValeEngine::new(
                    self.config.engines.vale.config.clone(),
                )));
            }

            if self.config.engines.proselint.enabled {
                self.engines.push(Box::new(ProselintEngine::new(
                    self.config.engines.proselint.config.clone(),
                )));
            }

            for provider in &self.config.engines.external {
                self.engines.push(Box::new(ExternalEngine::new(
                    provider.name.clone(),
                    provider.command.clone(),
                    provider.args.clone(),
                )));
            }

            for wasm_plugin in &self.config.engines.wasm_plugins {
                match WasmEngine::new(
                    wasm_plugin.name.clone(),
                    std::path::PathBuf::from(&wasm_plugin.path),
                ) {
                    Ok(engine) => self.engines.push(Box::new(engine)),
                    Err(e) => warn!(
                        plugin = %wasm_plugin.name,
                        path = %wasm_plugin.path,
                        "Failed to load WASM plugin: {e}"
                    ),
                }
            }
        }
    }

    pub fn update_config(&mut self, config: Config) {
        self.config = config;
        self.initialize_engines();
        // Preserve health state across config changes — don't clear engine_health
    }

    #[must_use]
    pub const fn get_config(&self) -> &Config {
        &self.config
    }

    /// Returns health status for each engine that has been tracked.
    #[must_use]
    pub fn engine_health_report(&self) -> Vec<EngineHealth> {
        self.engine_health
            .iter()
            .map(|(name, tracker)| {
                let status = if tracker.consecutive_failures == 0 {
                    "ok"
                } else if tracker.consecutive_failures <= 2 {
                    "degraded"
                } else {
                    "down"
                };
                EngineHealth {
                    name: name.clone(),
                    status: status.to_string(),
                    consecutive_failures: tracker.consecutive_failures,
                    last_error: tracker.last_error.clone().unwrap_or_default(),
                    last_success_epoch_ms: tracker.last_success_epoch_ms,
                }
            })
            .collect()
    }

    #[allow(clippy::too_many_lines)]
    pub async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
        // Skip checking if file exceeds max_file_size
        let max = self.config.performance.max_file_size;
        if max > 0 && text.len() > max {
            return Ok(Vec::new());
        }

        let spell_language = &self.config.engines.spell_language;

        let mut all_diagnostics = Vec::new();
        let mut engines_ran = 0u32;

        for engine in &mut self.engines {
            let engine_name = engine.name();

            // Skip engines that don't support the configured language
            if !engine_supports_language(engine.as_ref(), spell_language) {
                continue;
            }

            engines_ran += 1;
            match engine.check(text, spell_language).await {
                Ok(mut diagnostics) => {
                    // Update health tracker: success
                    let tracker = self
                        .engine_health
                        .entry(engine_name.to_string())
                        .or_default();
                    tracker.consecutive_failures = 0;
                    tracker.last_error = None;
                    tracker.last_success = Some(Instant::now());
                    #[allow(clippy::cast_possible_truncation)]
                    {
                        tracker.last_success_epoch_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                            as u64;
                    }

                    // Normalize and filter based on config
                    for d in &mut diagnostics {
                        let provider = if d.rule_id.starts_with("harper") {
                            "harper"
                        } else if d.rule_id.starts_with("vale.") {
                            "vale"
                        } else if d.rule_id.starts_with("proselint.") {
                            "proselint"
                        } else if d.rule_id.starts_with("wasm.") {
                            "wasm"
                        } else if d.rule_id.starts_with("external.") {
                            "external"
                        } else {
                            "languagetool"
                        };
                        d.unified_id = self.normalizer.normalize(provider, &d.rule_id);

                        // Apply rule severity overrides from config.
                        if let Some(severity) =
                            rule_override_severity(&self.config, &d.rule_id, &d.unified_id)
                        {
                            d.severity = severity;
                        }
                    }

                    diagnostics.retain(|d| d.severity != -1);
                    all_diagnostics.extend(diagnostics);
                }
                Err(e) => {
                    // Update health tracker: failure
                    let tracker = self
                        .engine_health
                        .entry(engine_name.to_string())
                        .or_default();
                    tracker.consecutive_failures += 1;
                    tracker.last_error = Some(e.to_string());

                    warn!(engine = engine_name, "Engine error: {e}");
                }
            }
        }

        // Warn when no engines ran (e.g. non-English language with only Harper enabled)
        if engines_ran == 0 && all_diagnostics.is_empty() {
            all_diagnostics.push(Diagnostic {
                start_byte: 0,
                end_byte: 0,
                message: format!(
                    "No active engine supports \"{spell_language}\". \
                     Enable LanguageTool or add an external provider."
                ),
                suggestions: Vec::new(),
                rule_id: "languagecheck.no-provider".to_string(),
                severity: Severity::Information as i32,
                unified_id: "languagecheck.no-provider".to_string(),
                confidence: 1.0,
            });
        }

        // Advanced deduplication: if two engines report the same unified rule at the same range,
        // prefer the one with higher severity or just keep one.
        all_diagnostics.sort_by_key(|d| (d.start_byte, d.end_byte, d.unified_id.clone()));
        all_diagnostics.dedup_by(|a, b| {
            a.start_byte == b.start_byte && a.end_byte == b.end_byte && a.unified_id == b.unified_id
        });

        // Filter out diagnostics suppressed by inline ignore directives
        let directives = IgnoreParser::parse_directives(text);
        let resolved = IgnoreParser::resolve_all(text, &directives);

        if !resolved.ignore_ranges.is_empty() || !resolved.regions.is_empty() {
            all_diagnostics.retain(|d| {
                !IgnoreParser::should_ignore(d, &resolved.ignore_ranges)
                    && !IgnoreParser::should_ignore_by_region(d, text, &resolved.regions)
            });
        }

        Ok(all_diagnostics)
    }
}

/// Resolve a configured severity override for a diagnostic.
///
/// Overrides may be keyed by the **native** rule id shown on the diagnostic
/// (e.g. `languagetool.ARROWS`, what the "Deactivate rule" action writes) or by
/// the **unified** category id (e.g. `typography.capitalization`). The native id
/// is matched first. Returns the new severity (`-1` marks the diagnostic for
/// removal), or `None` when there is no applicable override.
fn rule_override_severity(config: &Config, rule_id: &str, unified_id: &str) -> Option<i32> {
    let rule_config = config
        .rules
        .get(rule_id)
        .or_else(|| config.rules.get(unified_id))?;
    let severity = rule_config.severity.as_ref()?;
    match severity.to_lowercase().as_str() {
        "error" => Some(Severity::Error as i32),
        "warning" => Some(Severity::Warning as i32),
        "info" => Some(Severity::Information as i32),
        "hint" => Some(Severity::Hint as i32),
        "off" => Some(-1),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RuleConfig;

    fn config_with_rule(key: &str, severity: &str) -> Config {
        let mut config = Config::default();
        config.rules.insert(
            key.to_string(),
            RuleConfig {
                severity: Some(severity.to_string()),
            },
        );
        config
    }

    #[test]
    fn override_matches_native_rule_id() {
        // The user keys the override by the native id (what diagnostics show).
        let config = config_with_rule("languagetool.ARROWS", "off");
        assert_eq!(
            rule_override_severity(&config, "languagetool.ARROWS", "style.unknown"),
            Some(-1)
        );
    }

    #[test]
    fn override_matches_unified_id() {
        let config = config_with_rule("typography.capitalization", "off");
        assert_eq!(
            rule_override_severity(
                &config,
                "languagetool.UPPERCASE_SENTENCE_START",
                "typography.capitalization"
            ),
            Some(-1)
        );
    }

    #[test]
    fn override_absent_returns_none() {
        let config = config_with_rule("languagetool.OTHER", "off");
        assert_eq!(
            rule_override_severity(&config, "languagetool.ARROWS", "style.unknown"),
            None
        );
    }

    #[test]
    fn override_maps_named_severities() {
        let config = config_with_rule("languagetool.ARROWS", "Error");
        assert_eq!(
            rule_override_severity(&config, "languagetool.ARROWS", "x"),
            Some(Severity::Error as i32)
        );
    }
}
