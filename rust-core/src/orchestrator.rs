use crate::engines::{Engine, HarperEngine, LanguageToolEngine};
use crate::checker::{Diagnostic, Severity};
use crate::rules::RuleNormalizer;
use crate::config::Config;
use anyhow::Result;

pub struct Orchestrator {
    engines: Vec<Box<dyn Engine + Send>>,
    normalizer: RuleNormalizer,
    config: Config,
}

impl Orchestrator {
    pub fn new(config: Config) -> Self {
        let mut orchestrator = Self { 
            engines: Vec::new(),
            normalizer: RuleNormalizer::new(),
            config: config.clone(),
        };
        
        orchestrator.initialize_engines();
        orchestrator
    }

    fn initialize_engines(&mut self) {
        self.engines.clear();
        if self.config.engines.harper {
            self.engines.push(Box::new(HarperEngine::new()));
        }
        if self.config.engines.languagetool {
            self.engines.push(Box::new(LanguageToolEngine::new(self.config.engines.languagetool_url.clone())));
        }
    }

    pub fn update_config(&mut self, config: Config) {
        self.config = config;
        self.initialize_engines();
    }

    pub fn get_config(&self) -> &Config {
        &self.config
    }

    pub async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        let mut all_diagnostics = Vec::new();
        
        for engine in &mut self.engines {
            match engine.check(text, language_id).await {
                Ok(mut diagnostics) => {
                    // Normalize and filter based on config
                    for d in &mut diagnostics {
                        let provider = if d.rule_id.starts_with("harper") { "harper" } else { "languagetool" };
                        d.unified_id = self.normalizer.normalize(provider, &d.rule_id);
                        
                        // Apply rule severity overrides from config
                        if let Some(rule_config) = self.config.rules.get(&d.unified_id) {
                            if let Some(severity_str) = &rule_config.severity {
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
                    }
                    
                    diagnostics.retain(|d| d.severity != -1);
                    all_diagnostics.extend(diagnostics);
                }
                Err(e) => eprintln!("Engine error: {}", e),
            }
        }
        
        // Advanced deduplication: if two engines report the same unified rule at the same range,
        // prefer the one with higher severity or just keep one.
        all_diagnostics.sort_by_key(|d| (d.start_byte, d.end_byte, d.unified_id.clone()));
        all_diagnostics.dedup_by(|a, b| {
            a.start_byte == b.start_byte && a.end_byte == b.end_byte && a.unified_id == b.unified_id
        });

        Ok(all_diagnostics)
    }
}
