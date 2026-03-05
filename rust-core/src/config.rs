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
    #[serde(default)]
    pub auto_fix: Vec<AutoFixRule>,
    #[serde(default)]
    pub performance: PerformanceConfig,
    #[serde(default)]
    pub dictionaries: DictionaryConfig,
    #[serde(default)]
    pub languages: LanguageConfig,
    #[serde(default)]
    pub workspace: WorkspaceConfig,
}

/// Language extension aliasing configuration.
///
/// Maps canonical language IDs to additional file extensions.
/// Built-in extensions (e.g. `.md` → markdown, `.htm` → html) are always
/// included; entries here add to them.
///
/// ```yaml
/// languages:
///   extensions:
///     markdown: [mdx, Rmd]
///     latex: [sty]
/// ```
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LanguageConfig {
    /// Additional file extensions per language ID (without leading dots).
    #[serde(default)]
    pub extensions: HashMap<String, Vec<String>>,
    /// LaTeX-specific settings.
    #[serde(default)]
    pub latex: LaTeXConfig,
}

/// LaTeX-specific configuration.
///
/// ```yaml
/// languages:
///   latex:
///     skip_environments:
///       - prooftree
///       - mycustomenv
/// ```
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LaTeXConfig {
    /// Extra environment names to skip during prose extraction.
    /// These are checked in addition to the built-in skip list.
    #[serde(default)]
    pub skip_environments: Vec<String>,
    /// Extra command names whose arguments should be skipped during prose
    /// extraction. These are checked in addition to the built-in skip list
    /// (which includes `texttt`, `verb`, `url`, etc.).
    #[serde(default)]
    pub skip_commands: Vec<String>,
}

/// Workspace-level settings.
///
/// ```yaml
/// workspace:
///   index_on_open: true
/// ```
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WorkspaceConfig {
    /// Whether to run a full workspace index when the project is opened.
    /// Default: false (only check documents on open/change).
    #[serde(default)]
    pub index_on_open: bool,
    /// Custom path for the workspace database file. When empty (default),
    /// databases are stored in the user data directory.
    #[serde(default)]
    pub db_path: Option<String>,
}

/// Performance tuning options. High Performance Mode (HPM) disables
/// expensive engines and external providers, using only harper-core.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PerformanceConfig {
    /// Enable High Performance Mode (only harper, no LT/externals).
    #[serde(default)]
    pub high_performance_mode: bool,
    /// Debounce delay in milliseconds for LSP on-type checking.
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u64,
    /// Maximum file size in bytes to check (0 = unlimited).
    #[serde(default)]
    pub max_file_size: usize,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            high_performance_mode: false,
            debounce_ms: 300,
            max_file_size: 0,
        }
    }
}

const fn default_debounce_ms() -> u64 {
    300
}

/// Configuration for bundled and additional wordlist dictionaries.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DictionaryConfig {
    /// Whether to load the bundled domain-specific dictionaries (software terms,
    /// TypeScript, companies, jargon). Default: true.
    #[serde(default = "default_true")]
    pub bundled: bool,
    /// Paths to additional wordlist files (one word per line, `#` comments).
    /// Relative paths are resolved from the workspace root.
    #[serde(default)]
    pub paths: Vec<String>,
}

impl Default for DictionaryConfig {
    fn default() -> Self {
        Self {
            bundled: true,
            paths: Vec::new(),
        }
    }
}

/// A user-defined find->replace auto-fix rule.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoFixRule {
    /// Pattern to find (plain text, case-sensitive).
    pub find: String,
    /// Replacement text.
    pub replace: String,
    /// Optional context filter: only apply when surrounding text matches.
    #[serde(default)]
    pub context: Option<String>,
    /// Optional description for the rule.
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngineConfig {
    #[serde(default = "default_true")]
    pub harper: bool,
    #[serde(default)]
    pub languagetool: bool,
    #[serde(default = "default_lt_url")]
    pub languagetool_url: String,
    /// External checker providers registered via config.
    #[serde(default)]
    pub external: Vec<ExternalProvider>,
    /// WASM checker plugins loaded via Extism.
    #[serde(default)]
    pub wasm_plugins: Vec<WasmPlugin>,
    /// BCP-47 natural language tag for spell/grammar checking (e.g. "en-US", "de-DE").
    #[serde(default = "default_spell_language")]
    pub spell_language: String,
    /// Enable the Vale prose linter (requires `vale` on PATH).
    #[serde(default)]
    pub vale: bool,
    /// Optional path to a `.vale.ini` config file. When empty, Vale uses its
    /// own search logic (CWD upward, then global config).
    #[serde(default)]
    pub vale_config: Option<String>,
}

/// An external checker binary that communicates via stdin/stdout JSON.
///
/// The binary receives `{"text": "...", "language_id": "..."}` on stdin
/// and returns `[{"start_byte": N, "end_byte": N, "message": "...", ...}]` on stdout.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExternalProvider {
    /// Display name for this provider.
    pub name: String,
    /// Path to the executable.
    pub command: String,
    /// Optional arguments to pass to the command.
    #[serde(default)]
    pub args: Vec<String>,
    /// Optional file extensions this provider supports (empty = all).
    #[serde(default)]
    pub extensions: Vec<String>,
}

/// A WASM plugin loaded via Extism.
///
/// Plugins must export a `check` function that receives a JSON string
/// `{"text": "...", "language_id": "..."}` and returns a JSON array of diagnostics.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WasmPlugin {
    /// Display name for this plugin.
    pub name: String,
    /// Path to the `.wasm` file (relative to workspace root or absolute).
    pub path: String,
    /// Optional file extensions this plugin supports (empty = all).
    #[serde(default)]
    pub extensions: Vec<String>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            harper: true,
            languagetool: false,
            languagetool_url: "http://localhost:8010".to_string(),
            external: Vec::new(),
            wasm_plugins: Vec::new(),
            spell_language: default_spell_language(),
            vale: false,
            vale_config: None,
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
fn default_spell_language() -> String {
    "en-US".to_string()
}
fn default_exclude() -> Vec<String> {
    vec![
        "node_modules/**".to_string(),
        ".git/**".to_string(),
        "target/**".to_string(),
        "dist/**".to_string(),
        "build/**".to_string(),
        ".next/**".to_string(),
        ".nuxt/**".to_string(),
        "vendor/**".to_string(),
        "__pycache__/**".to_string(),
        ".venv/**".to_string(),
        "venv/**".to_string(),
        ".tox/**".to_string(),
        ".mypy_cache/**".to_string(),
        "*.min.js".to_string(),
        "*.min.css".to_string(),
        "*.bundle.js".to_string(),
        "package-lock.json".to_string(),
        "yarn.lock".to_string(),
        "pnpm-lock.yaml".to_string(),
    ]
}

impl Config {
    pub fn load(workspace_root: &Path) -> Result<Self> {
        // Prefer YAML, fall back to JSON for backward compatibility
        let yaml_path = workspace_root.join(".languagecheck.yaml");
        let yml_path = workspace_root.join(".languagecheck.yml");
        let json_path = workspace_root.join(".languagecheck.json");

        if yaml_path.exists() {
            let content = std::fs::read_to_string(yaml_path)?;
            let config: Self = serde_yaml::from_str(&content)?;
            Ok(config)
        } else if yml_path.exists() {
            let content = std::fs::read_to_string(yml_path)?;
            let config: Self = serde_yaml::from_str(&content)?;
            Ok(config)
        } else if json_path.exists() {
            let content = std::fs::read_to_string(json_path)?;
            let config: Self = serde_json::from_str(&content)?;
            Ok(config)
        } else {
            Ok(Self::default())
        }
    }

    /// Apply user-defined auto-fix rules to the given text, returning the modified text
    /// and the number of replacements made.
    #[must_use]
    pub fn apply_auto_fixes(&self, text: &str) -> (String, usize) {
        let mut result = text.to_string();
        let mut total = 0;

        for rule in &self.auto_fix {
            if let Some(ctx) = &rule.context
                && !result.contains(ctx.as_str())
            {
                continue;
            }
            let count = result.matches(&rule.find).count();
            if count > 0 {
                result = result.replace(&rule.find, &rule.replace);
                total += count;
            }
        }

        (result, total)
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            engines: EngineConfig::default(),
            rules: HashMap::new(),
            exclude: default_exclude(),
            auto_fix: Vec::new(),
            performance: PerformanceConfig::default(),
            dictionaries: DictionaryConfig::default(),
            languages: LanguageConfig::default(),
            workspace: WorkspaceConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_harper_enabled_lt_disabled() {
        let config = Config::default();
        assert!(config.engines.harper);
        assert!(!config.engines.languagetool);
    }

    #[test]
    fn default_config_has_standard_excludes() {
        let config = Config::default();
        assert!(config.exclude.contains(&"node_modules/**".to_string()));
        assert!(config.exclude.contains(&".git/**".to_string()));
        assert!(config.exclude.contains(&"target/**".to_string()));
        assert!(config.exclude.contains(&"dist/**".to_string()));
        assert!(config.exclude.contains(&"vendor/**".to_string()));
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
        assert!(!config.engines.languagetool);
        assert!(config.rules.is_empty());
    }

    #[test]
    fn load_from_json_file() {
        let dir = std::env::temp_dir().join("lang_check_test_config_json");
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
    fn load_from_yaml_file() {
        let dir = std::env::temp_dir().join("lang_check_test_config_yaml");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let config_path = dir.join(".languagecheck.yaml");
        std::fs::write(
            &config_path,
            "engines:\n  harper: false\n  languagetool: true\n",
        )
        .unwrap();

        let config = Config::load(&dir).unwrap();
        assert!(!config.engines.harper);
        assert!(config.engines.languagetool);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn yaml_takes_precedence_over_json() {
        let dir = std::env::temp_dir().join("lang_check_test_config_precedence");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Write both files with different values
        std::fs::write(
            dir.join(".languagecheck.yaml"),
            "engines:\n  harper: false\n",
        )
        .unwrap();
        std::fs::write(
            dir.join(".languagecheck.json"),
            r#"{"engines": {"harper": true}}"#,
        )
        .unwrap();

        let config = Config::load(&dir).unwrap();
        // YAML should win
        assert!(!config.engines.harper);

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

    #[test]
    fn auto_fix_simple_replacement() {
        let config = Config {
            auto_fix: vec![AutoFixRule {
                find: "teh".to_string(),
                replace: "the".to_string(),
                context: None,
                description: None,
            }],
            ..Config::default()
        };
        let (result, count) = config.apply_auto_fixes("Fix teh typo in teh text.");
        assert_eq!(result, "Fix the typo in the text.");
        assert_eq!(count, 2);
    }

    #[test]
    fn auto_fix_with_context_filter() {
        let config = Config {
            auto_fix: vec![AutoFixRule {
                find: "colour".to_string(),
                replace: "color".to_string(),
                context: Some("American".to_string()),
                description: Some("Use American spelling".to_string()),
            }],
            ..Config::default()
        };
        // Context matches — replacement should happen
        let (result, count) = config.apply_auto_fixes("American English: the colour is red.");
        assert_eq!(result, "American English: the color is red.");
        assert_eq!(count, 1);

        // Context does not match — no replacement
        let (result, count) = config.apply_auto_fixes("British English: the colour is red.");
        assert_eq!(result, "British English: the colour is red.");
        assert_eq!(count, 0);
    }

    #[test]
    fn auto_fix_no_match() {
        let config = Config {
            auto_fix: vec![AutoFixRule {
                find: "foo".to_string(),
                replace: "bar".to_string(),
                context: None,
                description: None,
            }],
            ..Config::default()
        };
        let (result, count) = config.apply_auto_fixes("No matches here.");
        assert_eq!(result, "No matches here.");
        assert_eq!(count, 0);
    }

    #[test]
    fn auto_fix_multiple_rules() {
        let config = Config {
            auto_fix: vec![
                AutoFixRule {
                    find: "recieve".to_string(),
                    replace: "receive".to_string(),
                    context: None,
                    description: None,
                },
                AutoFixRule {
                    find: "seperate".to_string(),
                    replace: "separate".to_string(),
                    context: None,
                    description: None,
                },
            ],
            ..Config::default()
        };
        let (result, count) = config.apply_auto_fixes("Please recieve the seperate package.");
        assert_eq!(result, "Please receive the separate package.");
        assert_eq!(count, 2);
    }

    #[test]
    fn auto_fix_loads_from_yaml() {
        let yaml = r#"
auto_fix:
  - find: "teh"
    replace: "the"
    description: "Fix common typo"
  - find: "colour"
    replace: "color"
    context: "American"
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.auto_fix.len(), 2);
        assert_eq!(config.auto_fix[0].find, "teh");
        assert_eq!(config.auto_fix[0].replace, "the");
        assert_eq!(
            config.auto_fix[0].description.as_deref(),
            Some("Fix common typo")
        );
        assert_eq!(config.auto_fix[1].context.as_deref(), Some("American"));
    }

    #[test]
    fn default_config_has_empty_auto_fix() {
        let config = Config::default();
        assert!(config.auto_fix.is_empty());
    }

    #[test]
    fn external_providers_from_yaml() {
        let yaml = r#"
engines:
  harper: true
  languagetool: false
  external:
    - name: vale
      command: /usr/bin/vale
      args: ["--output", "JSON"]
      extensions: [md, rst]
    - name: custom-checker
      command: ./my-checker
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.engines.external.len(), 2);
        assert_eq!(config.engines.external[0].name, "vale");
        assert_eq!(config.engines.external[0].command, "/usr/bin/vale");
        assert_eq!(config.engines.external[0].args, vec!["--output", "JSON"]);
        assert_eq!(config.engines.external[0].extensions, vec!["md", "rst"]);
        assert_eq!(config.engines.external[1].name, "custom-checker");
        assert!(config.engines.external[1].args.is_empty());
    }

    #[test]
    fn default_config_has_no_external_providers() {
        let config = Config::default();
        assert!(config.engines.external.is_empty());
    }

    #[test]
    fn wasm_plugins_from_yaml() {
        let yaml = r#"
engines:
  harper: true
  wasm_plugins:
    - name: custom-checker
      path: .languagecheck/plugins/checker.wasm
      extensions: [md, html]
    - name: style-linter
      path: /opt/plugins/style.wasm
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.engines.wasm_plugins.len(), 2);
        assert_eq!(config.engines.wasm_plugins[0].name, "custom-checker");
        assert_eq!(
            config.engines.wasm_plugins[0].path,
            ".languagecheck/plugins/checker.wasm"
        );
        assert_eq!(
            config.engines.wasm_plugins[0].extensions,
            vec!["md", "html"]
        );
        assert_eq!(config.engines.wasm_plugins[1].name, "style-linter");
        assert!(config.engines.wasm_plugins[1].extensions.is_empty());
    }

    #[test]
    fn default_config_has_no_wasm_plugins() {
        let config = Config::default();
        assert!(config.engines.wasm_plugins.is_empty());
    }

    #[test]
    fn performance_config_defaults() {
        let config = Config::default();
        assert!(!config.performance.high_performance_mode);
        assert_eq!(config.performance.debounce_ms, 300);
        assert_eq!(config.performance.max_file_size, 0);
    }

    #[test]
    fn performance_config_from_yaml() {
        let yaml = r#"
performance:
  high_performance_mode: true
  debounce_ms: 500
  max_file_size: 1048576
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.performance.high_performance_mode);
        assert_eq!(config.performance.debounce_ms, 500);
        assert_eq!(config.performance.max_file_size, 1_048_576);
    }

    #[test]
    fn latex_skip_environments_from_yaml() {
        let yaml = r#"
languages:
  latex:
    skip_environments:
      - prooftree
      - mycustomenv
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            config.languages.latex.skip_environments,
            vec!["prooftree", "mycustomenv"]
        );
    }

    #[test]
    fn default_config_has_empty_latex_skip_environments() {
        let config = Config::default();
        assert!(config.languages.latex.skip_environments.is_empty());
    }

    #[test]
    fn latex_skip_commands_from_yaml() {
        let yaml = r#"
languages:
  latex:
    skip_commands:
      - codefont
      - myverb
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            config.languages.latex.skip_commands,
            vec!["codefont", "myverb"]
        );
    }

    #[test]
    fn default_spell_language_is_en_us() {
        let config = Config::default();
        assert_eq!(config.engines.spell_language, "en-US");
    }

    #[test]
    fn spell_language_from_yaml() {
        let yaml = r#"
engines:
  spell_language: de-DE
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.engines.spell_language, "de-DE");
    }

    #[test]
    fn default_config_has_empty_latex_skip_commands() {
        let config = Config::default();
        assert!(config.languages.latex.skip_commands.is_empty());
    }

    #[test]
    fn default_vale_is_disabled() {
        let config = Config::default();
        assert!(!config.engines.vale);
        assert!(config.engines.vale_config.is_none());
    }

    #[test]
    fn vale_config_from_yaml() {
        let yaml = r#"
engines:
  vale: true
  vale_config: ".vale.ini"
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.vale);
        assert_eq!(config.engines.vale_config.as_deref(), Some(".vale.ini"));
    }
}
