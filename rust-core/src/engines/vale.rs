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
    pub fn new(config_path: Option<String>) -> Self {
        Self { config_path }
    }
}

#[async_trait::async_trait]
impl Engine for ValeEngine {
    fn name(&self) -> &'static str {
        "vale"
    }

    async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
        // TODO: implement
        Ok(vec![])
    }
}
