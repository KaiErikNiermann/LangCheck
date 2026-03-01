use crate::checker::{Diagnostic, Severity};
use crate::config::Config;
use crate::engines::{Engine, ExternalEngine, HarperEngine, LanguageToolEngine, WasmEngine};
use crate::ignore_rules::IgnoreParser;
use crate::rules::RuleNormalizer;
use anyhow::Result;

pub struct Orchestrator {
    engines: Vec<Box<dyn Engine + Send>>,
    normalizer: RuleNormalizer,
    config: Config,
}

impl Orchestrator {
    #[must_use]
    pub fn new(config: Config) -> Self {
        let mut orchestrator = Self {
            engines: Vec::new(),
            normalizer: RuleNormalizer::new(),
            config,
        };

        orchestrator.initialize_engines();
        orchestrator
    }

    fn initialize_engines(&mut self) {
        self.engines.clear();
        let hpm = self.config.performance.high_performance_mode;

        if self.config.engines.harper {
            self.engines.push(Box::new(HarperEngine::new()));
        }

        // In HPM, skip LanguageTool and external providers for speed
        if !hpm {
            if self.config.engines.languagetool {
                self.engines.push(Box::new(LanguageToolEngine::new(
                    self.config.engines.languagetool_url.clone(),
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
                    Err(e) => eprintln!(
                        "Failed to load WASM plugin '{}' from {}: {e}",
                        wasm_plugin.name, wasm_plugin.path
                    ),
                }
            }
        }
    }

    pub fn update_config(&mut self, config: Config) {
        self.config = config;
        self.initialize_engines();
    }

    #[must_use]
    pub const fn get_config(&self) -> &Config {
        &self.config
    }

    pub async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        // Skip checking if file exceeds max_file_size
        let max = self.config.performance.max_file_size;
        if max > 0 && text.len() > max {
            return Ok(Vec::new());
        }

        let is_english = is_english_content(language_id);
        let english_engine = &self.config.engines.english_engine;

        let mut all_diagnostics = Vec::new();
        let mut engines_ran = 0u32;

        for engine in &mut self.engines {
            // English engine toggle: skip the non-selected engine for English content
            let engine_name = engine.name();
            if english_engine == "languagetool" && engine_name == "harper" {
                // Harper is English-only; when LT is the English engine, skip it entirely
                continue;
            }
            if english_engine == "harper" && engine_name == "languagetool" && is_english {
                // Let LT still run for non-English content, but skip it for English
                continue;
            }

            engines_ran += 1;
            match engine.check(text, language_id).await {
                Ok(mut diagnostics) => {
                    // Normalize and filter based on config
                    for d in &mut diagnostics {
                        let provider = if d.rule_id.starts_with("harper") {
                            "harper"
                        } else if d.rule_id.starts_with("wasm.") {
                            "wasm"
                        } else if d.rule_id.starts_with("external.") {
                            "external"
                        } else {
                            "languagetool"
                        };
                        d.unified_id = self.normalizer.normalize(provider, &d.rule_id);

                        // Apply rule severity overrides from config
                        if let Some(rule_config) = self.config.rules.get(&d.unified_id)
                            && let Some(severity_str) = &rule_config.severity
                        {
                            d.severity = match severity_str.to_lowercase().as_str() {
                                "error" => Severity::Error as i32,
                                "warning" => Severity::Warning as i32,
                                "info" => Severity::Information as i32,
                                "hint" => Severity::Hint as i32,
                                "off" => -1, // Mark for removal
                                _ => d.severity,
                            };
                        }
                    }

                    diagnostics.retain(|d| d.severity != -1);
                    all_diagnostics.extend(diagnostics);
                }
                Err(e) => eprintln!("Engine error: {e}"),
            }
        }

        // Warn when no engines ran for non-English content
        if engines_ran == 0 && !is_english && all_diagnostics.is_empty() {
            all_diagnostics.push(Diagnostic {
                start_byte: 0,
                end_byte: 0,
                message: "No checking provider is configured for this language. \
                          Enable LanguageTool or add an external provider."
                    .to_string(),
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

/// Treat a `language_id` as English unless it's an explicit non-English locale.
///
/// File-type identifiers like `"markdown"`, `"html"`, `"latex"` default to English.
/// BCP-47 tags starting with `"en"` (e.g. `"en-US"`) are English. Everything else
/// (e.g. `"de"`, `"fr-FR"`) is non-English.
fn is_english_content(language_id: &str) -> bool {
    // File types that default to English
    matches!(
        language_id,
        "markdown" | "html" | "latex" | "text" | "rst" | "asciidoc" | "typst" | "djot"
    ) || language_id.starts_with("en")
}
