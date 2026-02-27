use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

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

const fn default_true() -> bool {
    true
}
fn default_lt_url() -> String {
    "http://localhost:8010".to_string()
}
fn default_exclude() -> Vec<String> {
    vec!["node_modules/**".to_string(), ".git/**".to_string()]
}

impl Config {
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let config_path = workspace_root.join(".languagecheck.json");
        if config_path.exists() {
            let content = std::fs::read_to_string(config_path)?;
            let config: Self = serde_json::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Self::default())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_both_engines_enabled() {
        let config = Config::default();
        assert!(config.engines.harper);
        assert!(config.engines.languagetool);
    }

    #[test]
    fn default_config_has_standard_excludes() {
        let config = Config::default();
        assert!(config.exclude.contains(&"node_modules/**".to_string()));
        assert!(config.exclude.contains(&".git/**".to_string()));
    }

    #[test]
    fn default_lt_url() {
        let config = Config::default();
        assert_eq!(config.engines.languagetool_url, "http://localhost:8010");
    }

    #[test]
    fn load_from_json_string() {
        let json = r#"{
            "engines": { "harper": true, "languagetool": false },
            "rules": { "spelling.typo": { "severity": "warning" } }
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert!(config.engines.harper);
        assert!(!config.engines.languagetool);
        assert!(config.rules.contains_key("spelling.typo"));
        assert_eq!(
            config.rules["spelling.typo"].severity.as_deref(),
            Some("warning")
        );
    }

    #[test]
    fn load_partial_json_uses_defaults() {
        let json = r#"{}"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert!(config.engines.harper);
        assert!(config.engines.languagetool);
        assert!(config.rules.is_empty());
    }

    #[test]
    fn load_from_file() {
        let dir = std::env::temp_dir().join("lang_check_test_config");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let config_path = dir.join(".languagecheck.json");
        std::fs::write(
            &config_path,
            r#"{"engines": {"harper": false, "languagetool": true}}"#,
        )
        .unwrap();

        let config = Config::load(&dir).unwrap();
        assert!(!config.engines.harper);
        assert!(config.engines.languagetool);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let dir = std::env::temp_dir().join("lang_check_test_config_missing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let config = Config::load(&dir).unwrap();
        assert!(config.engines.harper);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
