use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tracing::warn;

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
    #[serde(default)]
    pub names: NameConfig,
    #[serde(default)]
    pub morphology: MorphologyConfig,
}

/// Opt-in suppression of spelling diagnostics on human names.
///
/// Off by default: the failure mode is silently hiding a real misspelling, which is
/// much harder to notice than a stray squiggle on a surname.
///
/// ```yaml
/// names:
///   enabled: true
///   aggressiveness: balanced   # conservative | balanced | aggressive
/// ```
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct NameConfig {
    /// Whether to drop spelling diagnostics on tokens detected as human names.
    #[serde(default)]
    pub enabled: bool,
    /// How much corroborating evidence a name needs before its diagnostic is dropped.
    /// Default: `balanced`.
    #[serde(default)]
    pub aggressiveness: crate::names::Aggressiveness,
}

/// Acceptance of words built by affixation on material already known.
///
/// On by default, unlike [`NameConfig`]: a name verdict is a guess about a token, while
/// a decomposition is a claim that can be checked — `subalgebra` is accepted only
/// because `algebra` is a word. The failure mode both share is silently hiding a real
/// misspelling, and here it is bounded by the engine's own suggestions.
///
/// ```yaml
/// morphology:
///   enabled: true       # accept prefixed and derived forms of known words
///   inflections: true   # also accept the regular inflections of dictionary words
/// ```
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MorphologyConfig {
    /// Accept a flagged token that decomposes into a known root.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Generate the regular inflections of every dictionary word and accept those too.
    #[serde(default = "default_true")]
    pub inflections: bool,
}

impl Default for MorphologyConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            inflections: true,
        }
    }
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
    /// How long after the last keystroke a check runs, in milliseconds.
    ///
    /// Read by the editor clients, which own the typing loop; the core checks
    /// whatever it is handed, whenever it is handed it.
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u64,
    /// Maximum file size in bytes to check (0 = unlimited).
    #[serde(default)]
    pub max_file_size: usize,
    /// How many engine answers to keep, keyed by the prose that produced them.
    ///
    /// A keystroke re-checks the whole document although one prose range
    /// changed, so the cache is what keeps a long file responsive. `0`
    /// disables it and re-checks every range on every keystroke.
    #[serde(default = "default_result_cache_entries")]
    pub result_cache_entries: usize,
    /// Longest prose range handed on, in bytes; longer ones are split at
    /// sentence boundaries. `0` disables splitting.
    ///
    /// A range is one cache key and one box in the inspector, so a document
    /// written without blank lines between paragraphs otherwise becomes a
    /// single range and neither the cache nor the inspector can say anything
    /// useful about it.
    #[serde(default = "default_max_range_bytes")]
    pub max_range_bytes: usize,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            high_performance_mode: false,
            debounce_ms: 500,
            max_file_size: 0,
            result_cache_entries: default_result_cache_entries(),
            max_range_bytes: default_max_range_bytes(),
        }
    }
}

/// Long enough that a burst of typing produces one check, short enough that a
/// pause feels answered. The VS Code extension defaults to the same number.
const fn default_debounce_ms() -> u64 {
    500
}

/// Room for several long documents at once: a 36 kB file is around 110 prose
/// ranges, so this holds roughly thirty of them per engine before evicting.
const fn default_result_cache_entries() -> usize {
    4096
}

/// Several sentences, so the cross-sentence rules still have something to work
/// with, while a keystroke dirties a paragraph's worth of cache rather than a
/// chapter's. Splitting costs nothing on a cold check: the engines pack ranges
/// back together up to `max_request_bytes` before sending them.
const fn default_max_range_bytes() -> usize {
    2048
}

/// Configuration for bundled and additional wordlist dictionaries.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DictionaryConfig {
    /// Whether to load the bundled domain-specific dictionaries (software terms,
    /// TypeScript, companies, jargon, mathematics). Default: true.
    #[serde(default = "default_true")]
    pub bundled: bool,
    /// Names of individual bundled dictionaries to skip, e.g.
    /// `["companies", "mathematics"]`. Every set loads by default; listing one
    /// here turns off just that one. Ignored when `bundled` is false.
    #[serde(default)]
    pub disabled: Vec<String>,
    /// Paths to additional wordlist files (one word per line, `#` comments).
    /// Relative paths are resolved from the workspace root.
    #[serde(default)]
    pub paths: Vec<String>,
}

impl Default for DictionaryConfig {
    fn default() -> Self {
        Self {
            bundled: true,
            disabled: Vec::new(),
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
#[serde(from = "EngineConfigWire")]
pub struct EngineConfig {
    pub harper: HarperConfig,
    pub languagetool: LanguageToolConfig,
    pub vale: ValeConfig,
    pub proselint: ProselintConfig,
    /// External checker providers registered via config.
    pub external: Vec<ExternalProvider>,
    /// WASM checker plugins loaded via Extism.
    pub wasm_plugins: Vec<WasmPlugin>,
    /// BCP-47 natural language tag for spell/grammar checking (e.g. "en-US", "de-DE").
    pub spell_language: String,
}

/// On-disk form of [`EngineConfig`], carrying the flat pre-nesting keys next to
/// the nested ones.
///
/// `engines.languagetool_url` and `engines.vale_config` were folded into
/// `engines.languagetool.url` and `engines.vale.config` when engine settings
/// became nested structs. serde drops unknown keys without a word, so every
/// config still written the flat way — including the one in our own README —
/// silently fell back to the default `http://localhost:8010`, and the only
/// symptom was a connection error naming a server the user never configured
/// (issue #86). Both spellings are read here, and the flat one warns.
#[derive(Deserialize)]
struct EngineConfigWire {
    #[serde(
        default = "default_harper_config",
        deserialize_with = "deser_engine_or_bool"
    )]
    harper: HarperConfig,
    #[serde(default, deserialize_with = "deser_engine_or_bool")]
    languagetool: LanguageToolConfig,
    #[serde(default, deserialize_with = "deser_engine_or_bool")]
    vale: ValeConfig,
    #[serde(default, deserialize_with = "deser_engine_or_bool")]
    proselint: ProselintConfig,
    #[serde(default)]
    external: Vec<ExternalProvider>,
    #[serde(default)]
    wasm_plugins: Vec<WasmPlugin>,
    #[serde(default = "default_spell_language")]
    spell_language: String,
    /// Deprecated alias for `engines.languagetool.url`.
    #[serde(default)]
    languagetool_url: Option<String>,
    /// Deprecated alias for `engines.vale.config`.
    #[serde(default)]
    vale_config: Option<String>,
}

impl From<EngineConfigWire> for EngineConfig {
    fn from(wire: EngineConfigWire) -> Self {
        let EngineConfigWire {
            harper,
            mut languagetool,
            mut vale,
            proselint,
            external,
            wasm_plugins,
            spell_language,
            languagetool_url,
            vale_config,
        } = wire;

        // The nested key wins when both are present: it is the supported
        // spelling, so a config carrying both is mid-migration.
        if let Some(url) = languagetool_url {
            if languagetool.url == default_lt_url() {
                warn_deprecated_engine_key("engines.languagetool_url", "engines.languagetool.url");
                languagetool.url = url;
            } else {
                warn_ignored_engine_key("engines.languagetool_url", "engines.languagetool.url");
            }
        }
        if let Some(path) = vale_config {
            if vale.config.is_none() {
                warn_deprecated_engine_key("engines.vale_config", "engines.vale.config");
                vale.config = Some(path);
            } else {
                warn_ignored_engine_key("engines.vale_config", "engines.vale.config");
            }
        }

        Self {
            harper,
            languagetool,
            vale,
            proselint,
            external,
            wasm_plugins,
            spell_language,
        }
    }
}

/// Report a flat pre-nesting key that was honoured but should be rewritten.
fn warn_deprecated_engine_key(old: &str, new: &str) {
    warn!(
        "`{old}` is deprecated and will be removed in a future release; \
         rename it to `{new}`. Honouring it for now."
    );
}

/// Report a flat pre-nesting key that the nested key already overrode.
fn warn_ignored_engine_key(old: &str, new: &str) {
    warn!("`{old}` is ignored because `{new}` is also set; delete the deprecated key.");
}

/// Deserialize an engine config from either a bool shorthand or the full struct.
/// `harper: true` → `HarperConfig { enabled: true, ..default }`.
fn deser_engine_or_bool<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + EngineToggle + Default,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum BoolOrStruct<T> {
        Bool(bool),
        Struct(T),
    }

    match BoolOrStruct::deserialize(deserializer)? {
        BoolOrStruct::Bool(b) => {
            let mut cfg = T::default();
            cfg.set_enabled(b);
            Ok(cfg)
        }
        BoolOrStruct::Struct(s) => Ok(s),
    }
}

/// Trait for engine configs that can be toggled with a bool shorthand.
pub trait EngineToggle {
    fn enabled(&self) -> bool;
    fn set_enabled(&mut self, v: bool);
}

/// Harper engine configuration.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HarperConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Harper dialect: `American`, `British`, `Canadian`, `Australian`, `Indian`.
    #[serde(default = "default_dialect")]
    pub dialect: String,
    /// Per-rule toggles. Key is the rule name (e.g. `LongSentences`), value
    /// is `true`/`false`. Omitted rules use the curated default.
    #[serde(default)]
    pub linters: HashMap<String, bool>,
}

impl Default for HarperConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            dialect: "American".to_string(),
            linters: HashMap::new(),
        }
    }
}

fn default_harper_config() -> HarperConfig {
    HarperConfig::default()
}

fn default_dialect() -> String {
    "American".to_string()
}

impl EngineToggle for HarperConfig {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn set_enabled(&mut self, v: bool) {
        self.enabled = v;
    }
}

/// `LanguageTool` engine configuration.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LanguageToolConfig {
    #[serde(default)]
    pub enabled: bool,
    /// `LanguageTool` server URL.
    #[serde(default = "default_lt_url")]
    pub url: String,
    /// Checking level: `default` or `picky` (enables stricter rules).
    #[serde(default = "default_lt_level")]
    pub level: String,
    /// User's native language for false-friends detection (BCP-47 tag).
    #[serde(default)]
    pub mother_tongue: Option<String>,
    /// Rule IDs to disable (e.g. `["WHITESPACE_RULE"]`).
    #[serde(default)]
    pub disabled_rules: Vec<String>,
    /// Rule IDs to enable beyond defaults.
    #[serde(default)]
    pub enabled_rules: Vec<String>,
    /// Category IDs to disable.
    #[serde(default)]
    pub disabled_categories: Vec<String>,
    /// Category IDs to enable.
    #[serde(default)]
    pub enabled_categories: Vec<String>,
    /// How many `/v2/check` requests may be in flight at once.
    ///
    /// Lower this when pointing at a shared or rate-limited server; `1`
    /// restores serial checking.
    #[serde(default = "default_lt_max_concurrent_requests")]
    pub max_concurrent_requests: usize,
    /// How much prose to put in one `/v2/check`, in bytes.
    ///
    /// Prose ranges are packed up to this size before being sent. A range that
    /// exceeds it on its own still gets a request of its own; `0` disables
    /// packing and restores one request per range.
    #[serde(default = "default_lt_max_request_bytes")]
    pub max_request_bytes: usize,
}

impl Default for LanguageToolConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            url: default_lt_url(),
            level: "default".to_string(),
            mother_tongue: None,
            disabled_rules: Vec::new(),
            enabled_rules: Vec::new(),
            disabled_categories: Vec::new(),
            enabled_categories: Vec::new(),
            max_concurrent_requests: default_lt_max_concurrent_requests(),
            max_request_bytes: default_lt_max_request_bytes(),
        }
    }
}

fn default_lt_level() -> String {
    "default".to_string()
}

/// Enough parallelism to hide per-request latency on a local server without
/// swamping a shared one — measured saturation point is around 8.
const fn default_lt_max_concurrent_requests() -> usize {
    8
}

/// Measured against a local `LanguageTool` 6.x, a `/v2/check` costs about
/// 8 ms flat plus 20.6 us per byte. Per prose range that flat cost dominates —
/// a 36 kB Typst document is 109 ranges of median 156 bytes, so 872 ms of the
/// wall clock is request overhead alone. Packing to 4 kB leaves overhead under
/// a tenth of the request and keeps each one short enough that the concurrency
/// window stays full; 8 kB and above buys little and delays the first result.
const fn default_lt_max_request_bytes() -> usize {
    4096
}

impl EngineToggle for LanguageToolConfig {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn set_enabled(&mut self, v: bool) {
        self.enabled = v;
    }
}

/// Vale engine configuration.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct ValeConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Path to `.vale.ini`. When empty, Vale uses its own search logic.
    #[serde(default)]
    pub config: Option<String>,
}

impl EngineToggle for ValeConfig {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn set_enabled(&mut self, v: bool) {
        self.enabled = v;
    }
}

/// Proselint engine configuration.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct ProselintConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Path to `proselint.json` config. When empty, proselint uses its own search logic.
    #[serde(default)]
    pub config: Option<String>,
}

impl EngineToggle for ProselintConfig {
    fn enabled(&self) -> bool {
        self.enabled
    }
    fn set_enabled(&mut self, v: bool) {
        self.enabled = v;
    }
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
            harper: HarperConfig::default(),
            languagetool: LanguageToolConfig::default(),
            vale: ValeConfig::default(),
            proselint: ProselintConfig::default(),
            external: Vec::new(),
            wasm_plugins: Vec::new(),
            spell_language: default_spell_language(),
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
    /// Load configuration, warning and falling back to defaults if it cannot be read.
    ///
    /// `load` fails on a malformed `.languagecheck.yaml` — a bad indent, a typo'd enum — and
    /// callers used to answer that with a bare `Config::default()`, so a rejected file was
    /// indistinguishable from an absent one and the user's overrides silently did nothing.
    /// A missing file is not an error and is not reported; an unreadable one is.
    ///
    /// Callers with no `tracing` subscriber installed (the CLI binary) must report to stderr
    /// themselves rather than call this, or the warning goes nowhere.
    #[must_use]
    pub fn load_or_warn(workspace_root: &Path) -> Self {
        Self::load(workspace_root).unwrap_or_else(|e| {
            warn!(
                root = %workspace_root.display(),
                "Ignoring unreadable workspace config, using defaults: {e}"
            );
            Self::default()
        })
    }

    pub fn load(workspace_root: &Path) -> Result<Self> {
        // Prefer YAML, fall back to JSON for backward compatibility
        let yaml_path = workspace_root.join(".languagecheck.yaml");
        let yml_path = workspace_root.join(".languagecheck.yml");
        let json_path = workspace_root.join(".languagecheck.json");

        if yaml_path.exists() {
            let content = std::fs::read_to_string(yaml_path)?;
            warn_duplicate_rule_keys(&content);
            let config: Self = serde_yaml::from_str(&content)?;
            warn_unknown_keys(&serde_yaml::from_str(&content)?);
            Ok(config)
        } else if yml_path.exists() {
            let content = std::fs::read_to_string(yml_path)?;
            warn_duplicate_rule_keys(&content);
            let config: Self = serde_yaml::from_str(&content)?;
            warn_unknown_keys(&serde_yaml::from_str(&content)?);
            Ok(config)
        } else if json_path.exists() {
            let content = std::fs::read_to_string(json_path)?;
            let config: Self = serde_json::from_str(&content)?;
            // YAML 1.2 is a superset of JSON, so one key scanner covers both formats.
            warn_unknown_keys(&serde_yaml::from_str(&content)?);
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

/// Collect rule keys that appear more than once under the top-level `rules:`
/// mapping of a raw YAML config, in first-seen order.
///
/// `serde_yaml` silently keeps only the last value for a duplicated mapping
/// key, so duplicates vanish after parsing; this scans the raw text so they can
/// be surfaced. Recognizes block-style child keys (`  some.rule:` on its own
/// line) at the mapping's first child indentation.
fn duplicate_rule_keys(content: &str) -> Vec<String> {
    let mut in_rules = false;
    let mut child_indent: Option<usize> = None;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut duplicates: Vec<String> = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();

        if !in_rules {
            if indent == 0 && line.trim() == "rules:" {
                in_rules = true;
            }
            continue;
        }

        // A new top-level key ends the rules block.
        if indent == 0 {
            break;
        }

        let child = *child_indent.get_or_insert(indent);
        if indent != child {
            continue; // deeper line (e.g. `severity: ...`), not a rule key
        }
        if let Some(key) = line.trim().strip_suffix(':') {
            let key = key.trim().to_string();
            if !key.is_empty() && !seen.insert(key.clone()) && !duplicates.contains(&key) {
                duplicates.push(key);
            }
        }
    }

    duplicates
}

/// Top-level keys [`Config`] understands.
const KNOWN_TOP_LEVEL_KEYS: &[&str] = &[
    "engines",
    "rules",
    "exclude",
    "auto_fix",
    "performance",
    "dictionaries",
    "languages",
    "workspace",
    "names",
    "morphology",
];

/// Keys [`EngineConfig`] understands, including the deprecated flat aliases.
const KNOWN_ENGINE_KEYS: &[&str] = &[
    "harper",
    "languagetool",
    "vale",
    "proselint",
    "external",
    "wasm_plugins",
    "spell_language",
    "languagetool_url",
    "vale_config",
];

/// Collect the keys of `value`'s `section` mapping that are not in `known`.
fn unknown_keys(value: &serde_yaml::Value, known: &[&str]) -> Vec<String> {
    let Some(map) = value.as_mapping() else {
        return Vec::new();
    };
    map.keys()
        .filter_map(serde_yaml::Value::as_str)
        .filter(|k| !known.contains(k))
        .map(ToString::to_string)
        .collect()
}

/// Warn about config keys nothing reads.
///
/// serde ignores what it does not recognise, so a typo'd or renamed key is
/// indistinguishable from an absent one: the setting simply never takes effect
/// and the user is left debugging the default. Reporting them turns a silent
/// no-op into a line in the log.
fn warn_unknown_keys(value: &serde_yaml::Value) {
    let unknown = unknown_keys(value, KNOWN_TOP_LEVEL_KEYS);
    if !unknown.is_empty() {
        warn!(keys = ?unknown, "Unknown keys in workspace config; they have no effect.");
    }
    if let Some(engines) = value.get("engines") {
        let unknown = unknown_keys(engines, KNOWN_ENGINE_KEYS);
        if !unknown.is_empty() {
            warn!(keys = ?unknown, "Unknown keys under `engines:`; they have no effect.");
        }
    }
}

/// Log a warning if a raw YAML config contains duplicate rule keys.
fn warn_duplicate_rule_keys(content: &str) {
    let duplicates = duplicate_rule_keys(content);
    if !duplicates.is_empty() {
        warn!(
            duplicates = ?duplicates,
            "Duplicate rule keys in .languagecheck.yaml; only the last entry for each takes \
             effect. Remove the extra copies to keep the ignore list clean."
        );
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
            names: NameConfig::default(),
            morphology: MorphologyConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_rule_keys_detects_repeats() {
        let yaml = "rules:\n  languagetool.ARROWS:\n    severity: \"off\"\n  \
                    languagetool.UPPERCASE_SENTENCE_START:\n    severity: \"off\"\n  \
                    languagetool.ARROWS:\n    severity: \"off\"\n  \
                    languagetool.UPPERCASE_SENTENCE_START:\n    severity: \"off\"\n  \
                    languagetool.THE_SUPERLATIVE:\n    severity: \"off\"\n";
        let dups = duplicate_rule_keys(yaml);
        assert_eq!(
            dups,
            vec![
                "languagetool.ARROWS".to_string(),
                "languagetool.UPPERCASE_SENTENCE_START".to_string()
            ]
        );
    }

    #[test]
    fn duplicate_rule_keys_clean_list_is_empty() {
        let yaml = "rules:\n  a.B:\n    severity: \"off\"\n  c.D:\n    severity: \"off\"\n";
        assert!(duplicate_rule_keys(yaml).is_empty());
    }

    #[test]
    fn duplicate_rule_keys_stops_at_next_section() {
        // A repeat under a *different* top-level section must not count.
        let yaml = "rules:\n  a.B:\n    severity: \"off\"\nengines:\n  harper: false\n";
        assert!(duplicate_rule_keys(yaml).is_empty());
    }

    #[test]
    fn morphology_is_on_by_default() {
        let config = Config::default();
        assert!(config.morphology.enabled);
        assert!(config.morphology.inflections);
    }

    #[test]
    fn morphology_can_be_switched_off_from_yaml() {
        let yaml = "morphology:\n  enabled: false\n";
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(!config.morphology.enabled);
        // An unmentioned field keeps its default rather than falling to `false`.
        assert!(config.morphology.inflections);
    }

    #[test]
    fn default_dictionaries_load_all_bundled_sets() {
        let config = Config::default();
        assert!(config.dictionaries.bundled);
        assert!(config.dictionaries.disabled.is_empty());
        assert!(config.dictionaries.paths.is_empty());
    }

    #[test]
    fn dictionaries_disabled_from_yaml() {
        let config: Config = serde_yaml::from_str(
            r"
dictionaries:
  disabled: [companies, mathematics]
",
        )
        .unwrap();
        assert_eq!(config.dictionaries.disabled, ["companies", "mathematics"]);
        // The master switch is untouched by listing individual sets.
        assert!(config.dictionaries.bundled);
    }

    #[test]
    fn default_config_has_harper_enabled_lt_disabled() {
        let config = Config::default();
        assert!(config.engines.harper.enabled);
        assert!(!config.engines.languagetool.enabled);
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
        assert_eq!(config.engines.languagetool.url, "http://localhost:8010");
    }

    #[test]
    fn load_from_json_string() {
        let json = r#"{
            "engines": { "harper": true, "languagetool": false },
            "rules": { "spelling.typo": { "severity": "warning" } }
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert!(config.engines.harper.enabled);
        assert!(!config.engines.languagetool.enabled);
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
        assert!(config.engines.harper.enabled);
        assert!(!config.engines.languagetool.enabled);
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
        assert!(!config.engines.harper.enabled);
        assert!(config.engines.languagetool.enabled);

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
        assert!(!config.engines.harper.enabled);
        assert!(config.engines.languagetool.enabled);

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
        assert!(!config.engines.harper.enabled);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let dir = std::env::temp_dir().join("lang_check_test_config_missing");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let config = Config::load(&dir).unwrap();
        assert!(config.engines.harper.enabled);

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
        assert_eq!(config.performance.debounce_ms, 500);
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
        assert!(!config.engines.vale.enabled);
        assert!(config.engines.vale.config.is_none());
    }

    #[test]
    fn vale_bool_shorthand_from_yaml() {
        let yaml = r#"
engines:
  vale: true
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.vale.enabled);
    }

    #[test]
    fn vale_nested_config_from_yaml() {
        let yaml = r#"
engines:
  vale:
    enabled: true
    config: ".vale.ini"
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.vale.enabled);
        assert_eq!(config.engines.vale.config.as_deref(), Some(".vale.ini"));
    }

    #[test]
    fn harper_nested_config_from_yaml() {
        let yaml = r#"
engines:
  harper:
    enabled: true
    dialect: "British"
    linters:
      LongSentences: false
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.harper.enabled);
        assert_eq!(config.engines.harper.dialect, "British");
        assert_eq!(
            config.engines.harper.linters.get("LongSentences"),
            Some(&false)
        );
    }

    #[test]
    fn languagetool_nested_config_from_yaml() {
        let yaml = r#"
engines:
  languagetool:
    enabled: true
    url: "http://localhost:9090"
    level: "picky"
    disabled_rules:
      - WHITESPACE_RULE
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.languagetool.enabled);
        assert_eq!(config.engines.languagetool.url, "http://localhost:9090");
        assert_eq!(config.engines.languagetool.level, "picky");
        assert_eq!(
            config.engines.languagetool.disabled_rules,
            vec!["WHITESPACE_RULE"]
        );
        assert_eq!(config.engines.languagetool.max_concurrent_requests, 8);
    }

    /// Issue #86: the flat key our own docs advertised was dropped on the floor,
    /// so a self-hosted server was checked against `localhost:8010` instead.
    #[test]
    fn legacy_flat_languagetool_url_is_honoured() {
        let yaml = r#"
engines:
  spell_language: fr
  proselint: false
  vale: false
  languagetool: true
  languagetool_url: "http://10.0.10.3:8003"
  harper: false
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.languagetool.enabled);
        assert_eq!(config.engines.languagetool.url, "http://10.0.10.3:8003");
        assert_eq!(config.engines.spell_language, "fr");
        assert!(!config.engines.harper.enabled);
    }

    #[test]
    fn nested_languagetool_url_beats_the_legacy_key() {
        let yaml = r#"
engines:
  languagetool:
    enabled: true
    url: "http://nested:9090"
  languagetool_url: "http://flat:8003"
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.engines.languagetool.url, "http://nested:9090");
    }

    #[test]
    fn legacy_flat_vale_config_is_honoured() {
        let yaml = "engines:\n  vale: true\n  vale_config: \"config/.vale.ini\"\n";
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.vale.enabled);
        assert_eq!(
            config.engines.vale.config.as_deref(),
            Some("config/.vale.ini")
        );
    }

    #[test]
    fn unknown_keys_are_reported() {
        let value: serde_yaml::Value =
            serde_yaml::from_str("engines:\n  languagetol: true\n  harper: true\nrulez: {}\n")
                .unwrap();
        assert_eq!(unknown_keys(&value, KNOWN_TOP_LEVEL_KEYS), vec!["rulez"]);
        assert_eq!(
            unknown_keys(value.get("engines").unwrap(), KNOWN_ENGINE_KEYS),
            vec!["languagetol"]
        );
    }

    #[test]
    fn recognised_keys_are_not_reported() {
        let value: serde_yaml::Value = serde_yaml::from_str(
            "engines:\n  languagetool_url: \"http://x:1\"\n  harper: true\nrules: {}\n",
        )
        .unwrap();
        assert!(unknown_keys(&value, KNOWN_TOP_LEVEL_KEYS).is_empty());
        assert!(unknown_keys(value.get("engines").unwrap(), KNOWN_ENGINE_KEYS).is_empty());
    }

    #[test]
    fn languagetool_concurrency_can_be_pinned_to_serial() {
        // Shared or rate-limited servers need the old one-at-a-time behaviour back.
        let yaml = r"
engines:
  languagetool:
    enabled: true
    max_concurrent_requests: 1
";
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.engines.languagetool.max_concurrent_requests, 1);
    }

    #[test]
    fn default_proselint_is_disabled() {
        let config = Config::default();
        assert!(!config.engines.proselint.enabled);
        assert!(config.engines.proselint.config.is_none());
    }

    #[test]
    fn proselint_bool_shorthand_from_yaml() {
        let yaml = r#"
engines:
  proselint: true
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.proselint.enabled);
    }

    #[test]
    fn proselint_nested_config_from_yaml() {
        let yaml = r#"
engines:
  proselint:
    enabled: true
    config: "proselint.json"
"#;
        let config: Config = serde_yaml::from_str(yaml).unwrap();
        assert!(config.engines.proselint.enabled);
        assert_eq!(
            config.engines.proselint.config.as_deref(),
            Some("proselint.json")
        );
    }
}
