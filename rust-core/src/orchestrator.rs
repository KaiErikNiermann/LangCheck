use crate::engines::Engine;
use crate::checker::Diagnostic;
use crate::rules::RuleNormalizer;
use anyhow::Result;

pub struct Orchestrator {
    engines: Vec<Box<dyn Engine + Send>>,
    normalizer: RuleNormalizer,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self { 
            engines: Vec::new(),
            normalizer: RuleNormalizer::new(),
        }
    }

    pub fn add_engine(&mut self, engine: Box<dyn Engine + Send>) {
        self.engines.push(engine);
    }

    pub async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        let mut all_diagnostics = Vec::new();
        
        for engine in &mut self.engines {
            match engine.check(text, language_id).await {
                Ok(mut diagnostics) => {
                    // Normalize rule IDs
                    for d in &mut diagnostics {
                        let provider = if d.rule_id.starts_with("harper") { "harper" } else { "languagetool" };
                        d.unified_id = self.normalizer.normalize(provider, &d.rule_id);
                    }
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
