use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::path::Path;
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    #[serde(default)]
    pub engines: EngineConfig,
    #[serde(default)]
    pub rules: HashMap<String, RuleConfig>,
    #[serde(default = "default_exclude")]
    pub exclude: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngineConfig {
    #[serde(default = "default_true")]
    pub harper: bool,
    #[serde(default = "default_true")]
    pub languagetool: bool,
    #[serde(default = "default_lt_url")]
    pub languagetool_url: String,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            harper: true,
            languagetool: true,
            languagetool_url: "http://localhost:8010".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuleConfig {
    pub severity: Option<String>, // "error", "warning", "info", "hint", "off"
}

fn default_true() -> bool { true }
fn default_lt_url() -> String { "http://localhost:8010".to_string() }
fn default_exclude() -> Vec<String> { vec!["node_modules/**".to_string(), ".git/**".to_string()] }

impl Config {
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let config_path = workspace_root.join(".languagecheck.json");
        if config_path.exists() {
            let content = std::fs::read_to_string(config_path)?;
            let config: Config = serde_json::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Config::default())
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            engines: EngineConfig::default(),
            rules: HashMap::new(),
            exclude: default_exclude(),
        }
    }
}
