//! LSP JSON-RPC backend for language-check-server.
//!
//! Reuses the existing orchestrator, prose extraction, config, dictionary, and
//! ignore-store logic.  Activated with `language-check-server --lsp`.

#![allow(clippy::cast_possible_truncation)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::Mutex;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::{
    CodeAction, CodeActionKind, CodeActionOrCommand, CodeActionParams,
    CodeActionProviderCapability, CodeActionResponse, Command, Diagnostic, DiagnosticSeverity,
    DidChangeConfigurationParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams,
    DidOpenTextDocumentParams, DidSaveTextDocumentParams, ExecuteCommandOptions,
    ExecuteCommandParams, InitializeParams, InitializeResult, InitializedParams, NumberOrString,
    Position, Range, ServerCapabilities, ServerInfo, TextDocumentSyncCapability,
    TextDocumentSyncKind, TextEdit, Url, WorkspaceEdit,
};
use tower_lsp::{Client, LanguageServer, LspService, Server};
use tracing::{debug, info, warn};

use crate::checker;
use crate::config::Config;
use crate::dictionary::Dictionary;
use crate::hashing::{DiagnosticFingerprint, IgnoreStore};
use crate::orchestrator::Orchestrator;
use crate::prose;
use crate::sls::SchemaRegistry;

// ── LSP settings ────────────────────────────────────────────────────────────

/// Settings received via `workspace/didChangeConfiguration`.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct LspSettings {
    #[serde(alias = "langCheck")]
    lang_check: LangCheckSettings,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct LangCheckSettings {
    engines: Option<EngineSettings>,
    performance: Option<PerformanceSettings>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct EngineSettings {
    harper: Option<bool>,
    languagetool: Option<bool>,
    languagetool_url: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
struct PerformanceSettings {
    high_performance_mode: Option<bool>,
    debounce_ms: Option<u64>,
    max_file_size: Option<usize>,
}

// ── Document store ──────────────────────────────────────────────────────────

/// In-memory text of open documents (keyed by URI string).
/// Value is `(text, language_id)`.
type DocumentStore = DashMap<String, (String, String)>;

// ── Backend ─────────────────────────────────────────────────────────────────

pub struct Backend {
    client: Client,
    orchestrator: Arc<Mutex<Orchestrator>>,
    config: Arc<Mutex<Config>>,
    dictionary: Arc<Mutex<Dictionary>>,
    ignore_store: Arc<Mutex<IgnoreStore>>,
    schema_registry: Arc<Mutex<SchemaRegistry>>,
    documents: DocumentStore,
    workspace_root: Mutex<Option<PathBuf>>,
}

impl Backend {
    fn new(client: Client) -> Self {
        Self {
            client,
            orchestrator: Arc::new(Mutex::new(Orchestrator::new(Config::default()))),
            config: Arc::new(Mutex::new(Config::default())),
            dictionary: Arc::new(Mutex::new(Dictionary::new())),
            ignore_store: Arc::new(Mutex::new(IgnoreStore::new())),
            schema_registry: Arc::new(Mutex::new(SchemaRegistry::new())),
            documents: DashMap::new(),
            workspace_root: Mutex::new(None),
        }
    }

    /// Initialise all state from the workspace root (config, dictionary, …).
    async fn init_workspace(&self, root: &Path) {
        let config = Config::load(root).unwrap_or_default();
        info!(
            harper = config.engines.harper,
            languagetool = config.engines.languagetool,
            "LSP: engines configured"
        );

        self.orchestrator.lock().await.update_config(config.clone());
        *self.config.lock().await = config.clone();

        match Dictionary::load(root) {
            Ok(mut dict) => {
                if config.dictionaries.bundled {
                    dict.load_bundled();
                }
                for p in &config.dictionaries.paths {
                    if let Err(e) = dict.load_wordlist_file(Path::new(p), root) {
                        warn!(path = p, "Could not load wordlist: {e}");
                    }
                }
                *self.dictionary.lock().await = dict;
            }
            Err(e) => warn!("Could not load dictionary: {e}"),
        }

        if let Ok(store) = IgnoreStore::load(root) {
            *self.ignore_store.lock().await = store;
        }
        if let Ok(reg) = SchemaRegistry::from_workspace(root) {
            *self.schema_registry.lock().await = reg;
        }

        *self.workspace_root.lock().await = Some(root.to_path_buf());
    }

    /// Apply LSP settings on top of the workspace config.
    async fn apply_settings(&self, settings: &LangCheckSettings) {
        let mut config = self.config.lock().await;
        if let Some(ref eng) = settings.engines {
            if let Some(v) = eng.harper {
                config.engines.harper = v;
            }
            if let Some(v) = eng.languagetool {
                config.engines.languagetool = v;
            }
            if let Some(ref v) = eng.languagetool_url {
                config.engines.languagetool_url.clone_from(v);
            }
        }
        if let Some(ref perf) = settings.performance {
            if let Some(v) = perf.high_performance_mode {
                config.performance.high_performance_mode = v;
            }
            if let Some(v) = perf.debounce_ms {
                config.performance.debounce_ms = v;
            }
            if let Some(v) = perf.max_file_size {
                config.performance.max_file_size = v;
            }
        }
        let updated = config.clone();
        drop(config);
        self.orchestrator.lock().await.update_config(updated);
        info!("LSP: config updated via didChangeConfiguration");
    }

    /// Re-diagnose all currently open documents.
    async fn rediagnose_all(&self) {
        let entries: Vec<(String, String, String)> = self
            .documents
            .iter()
            .map(|r| {
                let (text, lang_id) = r.value();
                (r.key().clone(), text.clone(), lang_id.clone())
            })
            .collect();
        for (uri_str, text, lang_id) in entries {
            if let Ok(uri) = Url::parse(&uri_str) {
                self.diagnose(&uri, &text, &lang_id).await;
            }
        }
    }

    /// Run diagnostics on a document and publish them.
    async fn diagnose(&self, uri: &Url, text: &str, lang_id: &str) {
        let canonical = crate::languages::resolve_language_id(lang_id);

        let extraction = {
            let schema_reg = self.schema_registry.lock().await;
            let cfg = self.config.lock().await;
            let latex_extras = prose::latex::LatexExtras {
                skip_envs: &cfg.languages.latex.skip_environments,
                skip_commands: &cfg.languages.latex.skip_commands,
            };
            let result = prose::extract_with_fallback(
                text,
                canonical,
                None,
                Some(&schema_reg),
                &latex_extras,
            );
            drop(cfg);
            drop(schema_reg);
            result
        };

        let ranges = match extraction {
            Ok(r) => r,
            Err(e) => {
                warn!(uri = %uri, "Extraction error: {e}");
                return;
            }
        };

        let mut all_diagnostics: Vec<Diagnostic> = Vec::new();

        for range in &ranges {
            let prose_text = range.extract_text(text);

            let check_result = {
                let mut orch = self.orchestrator.lock().await;
                orch.check(&prose_text, lang_id).await
            };

            if let Ok(mut diags) = check_result {
                diags.retain(|d| !range.overlaps_exclusion(d.start_byte, d.end_byte));

                for d in &mut diags {
                    d.start_byte += range.start_byte as u32;
                    d.end_byte += range.start_byte as u32;
                }

                let ignore = self.ignore_store.lock().await;
                let dict = self.dictionary.lock().await;
                diags.retain(|d| {
                    let fp = DiagnosticFingerprint::new(
                        &d.message,
                        text,
                        d.start_byte as usize,
                        d.end_byte as usize,
                    );
                    if ignore.is_ignored(&fp) {
                        return false;
                    }
                    if d.unified_id.starts_with("spelling.") {
                        let word = safe_slice(text, d.start_byte as usize, d.end_byte as usize);
                        if dict.contains(word) {
                            return false;
                        }
                    }
                    true
                });

                all_diagnostics.extend(diags.iter().map(|d| to_lsp_diagnostic(text, d)));
            }
        }

        self.client
            .publish_diagnostics(uri.clone(), all_diagnostics, None)
            .await;
    }
}

// ── LanguageServer impl ─────────────────────────────────────────────────────

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, params: InitializeParams) -> Result<InitializeResult> {
        if let Some(root_uri) = params.root_uri
            && let Ok(path) = root_uri.to_file_path()
        {
            self.init_workspace(&path).await;
        }

        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                code_action_provider: Some(CodeActionProviderCapability::Simple(true)),
                execute_command_provider: Some(ExecuteCommandOptions {
                    commands: vec![
                        "langCheck.addDictionaryWord".into(),
                        "langCheck.ignoreDiagnostic".into(),
                    ],
                    ..Default::default()
                }),
                ..Default::default()
            },
            server_info: Some(ServerInfo {
                name: "language-check-server".into(),
                version: Some(env!("CARGO_PKG_VERSION").into()),
            }),
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        info!("LSP client initialized");
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let uri = params.text_document.uri;
        let text = params.text_document.text;
        let lang_id = params.text_document.language_id.clone();
        self.documents
            .insert(uri.to_string(), (text.clone(), lang_id.clone()));
        self.diagnose(&uri, &text, &lang_id).await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        if let Some(change) = params.content_changes.into_iter().last() {
            let lang_id = guess_lang_id(&uri);
            self.documents
                .insert(uri.to_string(), (change.text.clone(), lang_id.clone()));
            self.diagnose(&uri, &change.text, &lang_id).await;
        }
    }

    async fn did_save(&self, params: DidSaveTextDocumentParams) {
        let uri = params.text_document.uri;
        let key = uri.to_string();
        let entry = self.documents.get(&key).map(|r| r.value().clone());
        if let Some((text, lang_id)) = entry {
            self.diagnose(&uri, &text, &lang_id).await;
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.documents.remove(&params.text_document.uri.to_string());
    }

    async fn did_change_configuration(&self, params: DidChangeConfigurationParams) {
        let settings: LspSettings = serde_json::from_value(params.settings).unwrap_or_default();
        self.apply_settings(&settings.lang_check).await;
        self.rediagnose_all().await;
    }

    async fn code_action(&self, params: CodeActionParams) -> Result<Option<CodeActionResponse>> {
        let uri = &params.text_document.uri;
        let mut actions: Vec<CodeActionOrCommand> = Vec::new();

        for diag in &params.context.diagnostics {
            if diag.source.as_deref() != Some("language-check") {
                continue;
            }

            let Some(data) = &diag.data else { continue };
            let Some(obj) = data.as_object() else {
                continue;
            };

            // Apply suggestion actions
            if let Some(suggestions) = obj.get("suggestions").and_then(|v| v.as_array()) {
                for s in suggestions {
                    if let Some(text) = s.as_str() {
                        let edit = TextEdit {
                            range: diag.range,
                            new_text: text.to_string(),
                        };
                        let mut changes = HashMap::new();
                        changes.insert(uri.clone(), vec![edit]);
                        actions.push(CodeActionOrCommand::CodeAction(CodeAction {
                            title: format!("Replace with \"{text}\""),
                            kind: Some(CodeActionKind::QUICKFIX),
                            diagnostics: Some(vec![diag.clone()]),
                            edit: Some(WorkspaceEdit {
                                changes: Some(changes),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }));
                    }
                }
            }

            // Add to dictionary (spelling rules)
            if let Some(rule_id) = obj.get("rule_id").and_then(|v| v.as_str())
                && (rule_id.contains("TYPO")
                    || rule_id.contains("MORFOLOGIK")
                    || rule_id.contains("spelling"))
                && let Some(doc) = self.documents.get(&uri.to_string())
            {
                let word = extract_word_at_range(&doc.value().0, diag.range).unwrap_or_default();
                if !word.is_empty() {
                    actions.push(CodeActionOrCommand::CodeAction(CodeAction {
                        title: format!("Add \"{word}\" to dictionary"),
                        kind: Some(CodeActionKind::QUICKFIX),
                        diagnostics: Some(vec![diag.clone()]),
                        command: Some(Command {
                            title: "Add to dictionary".into(),
                            command: "langCheck.addDictionaryWord".into(),
                            arguments: Some(vec![serde_json::json!(word)]),
                        }),
                        ..Default::default()
                    }));
                }
            }
        }

        if actions.is_empty() {
            Ok(None)
        } else {
            Ok(Some(actions))
        }
    }

    async fn execute_command(
        &self,
        params: ExecuteCommandParams,
    ) -> Result<Option<serde_json::Value>> {
        match params.command.as_str() {
            "langCheck.addDictionaryWord" => {
                if let Some(word_val) = params.arguments.first()
                    && let Some(word) = word_val.as_str()
                {
                    debug!(word, "Adding to dictionary");
                    let mut dict = self.dictionary.lock().await;
                    if let Err(e) = dict.add_word(word) {
                        warn!(word, "Failed to add word: {e}");
                    }
                }
            }
            "langCheck.ignoreDiagnostic" => {
                if let Some(args) = params.arguments.first()
                    && let Some(obj) = args.as_object()
                {
                    let message = obj
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let context = obj
                        .get("context")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let start = obj
                        .get("start_byte")
                        .and_then(serde_json::Value::as_u64)
                        .map_or(0, |v| v as usize);
                    let end = obj
                        .get("end_byte")
                        .and_then(serde_json::Value::as_u64)
                        .map_or(0, |v| v as usize);
                    let fp = DiagnosticFingerprint::new(message, context, start, end);
                    self.ignore_store.lock().await.ignore(&fp);
                }
            }
            _ => {}
        }
        Ok(None)
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Convert an internal Diagnostic to an LSP Diagnostic.
fn to_lsp_diagnostic(text: &str, d: &checker::Diagnostic) -> Diagnostic {
    let range = byte_range_to_lsp(text, d.start_byte as usize, d.end_byte as usize);
    let severity = match d.severity {
        3 => Some(DiagnosticSeverity::ERROR),
        2 => Some(DiagnosticSeverity::WARNING),
        4 => Some(DiagnosticSeverity::HINT),
        // SEVERITY_UNSPECIFIED (0) and SEVERITY_INFORMATION (1)
        _ => Some(DiagnosticSeverity::INFORMATION),
    };

    let data = serde_json::json!({
        "suggestions": d.suggestions,
        "rule_id": d.rule_id,
        "unified_id": d.unified_id,
    });

    Diagnostic {
        range,
        severity,
        source: Some("language-check".into()),
        code: Some(NumberOrString::String(d.unified_id.clone())),
        message: d.message.clone(),
        data: Some(data),
        ..Default::default()
    }
}

/// Convert byte offsets to an LSP Range (line/character).
fn byte_range_to_lsp(text: &str, start: usize, end: usize) -> Range {
    Range {
        start: byte_to_position(text, start),
        end: byte_to_position(text, end),
    }
}

fn byte_to_position(text: &str, byte_offset: usize) -> Position {
    let offset = byte_offset.min(text.len());
    let prefix = &text[..offset];
    let line = prefix.matches('\n').count() as u32;
    let last_newline = prefix.rfind('\n').map_or(0, |i| i + 1);
    let character = prefix[last_newline..].chars().count() as u32;
    Position { line, character }
}

/// Guess a language ID from a file URI extension.
fn guess_lang_id(uri: &Url) -> String {
    let path = uri.path();
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "html" | "htm" | "xhtml" => "html",
        "tex" | "latex" | "ltx" => "latex",
        "typ" => "typst",
        "rst" => "rst",
        "org" => "org",
        "bib" => "bibtex",
        "Rnw" | "rnw" | "Snw" | "snw" => "sweave",
        "tree" => "forester",
        // md, mdx, markdown, and everything else defaults to markdown
        _ => "markdown",
    }
    .to_string()
}

fn safe_slice(s: &str, start: usize, end: usize) -> &str {
    let mut lo = start.min(s.len());
    while lo > 0 && !s.is_char_boundary(lo) {
        lo -= 1;
    }
    let mut hi = end.min(s.len());
    while hi < s.len() && !s.is_char_boundary(hi) {
        hi += 1;
    }
    &s[lo..hi]
}

/// Extract the word at a given LSP range from a document.
fn extract_word_at_range(text: &str, range: Range) -> Option<String> {
    let start = position_to_byte(text, range.start)?;
    let end = position_to_byte(text, range.end)?;
    Some(safe_slice(text, start, end).to_string())
}

fn position_to_byte(text: &str, pos: Position) -> Option<usize> {
    let mut line = 0u32;
    let mut byte = 0usize;
    for (i, ch) in text.char_indices() {
        if line == pos.line {
            let col_offset = text[byte..].char_indices().nth(pos.character as usize);
            return Some(col_offset.map_or(text.len(), |(off, _)| byte + off));
        }
        if ch == '\n' {
            line += 1;
            byte = i + 1;
        }
    }
    if line == pos.line {
        let col_offset = text[byte..].char_indices().nth(pos.character as usize);
        return Some(col_offset.map_or(text.len(), |(off, _)| byte + off));
    }
    None
}

// ── Entry point ─────────────────────────────────────────────────────────────

/// Run the LSP server on stdin/stdout.
pub async fn run_lsp() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let (service, socket) = LspService::new(Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}
