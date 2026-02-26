use crate::engines::Engine;
use crate::checker::Diagnostic;
use anyhow::Result;

pub struct Orchestrator {
    engines: Vec<Box<dyn Engine + Send>>,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self { engines: Vec::new() }
    }

    pub fn add_engine(&mut self, engine: Box<dyn Engine + Send>) {
        self.engines.push(engine);
    }

    pub async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        let mut all_diagnostics = Vec::new();
        
        for engine in &mut self.engines {
            match engine.check(text, language_id).await {
                Ok(diagnostics) => all_diagnostics.extend(diagnostics),
                Err(e) => eprintln!("Engine error: {}", e),
            }
        }
        
        // Basic deduplication
        all_diagnostics.sort_by_key(|d| (d.start_byte, d.end_byte));
        all_diagnostics.dedup_by(|a, b| {
            a.start_byte == b.start_byte && a.end_byte == b.end_byte && a.message == b.message
        });

        Ok(all_diagnostics)
    }
}
