#![warn(clippy::pedantic, clippy::nursery)]
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::cast_possible_truncation,
    clippy::significant_drop_tightening,
    clippy::too_many_lines
)]

use anyhow::Result;
use bytes::{Buf, BytesMut};
use checker::{
    CheckResponse, ErrorResponse, ExtractionExclusion, ExtractionInfo, ExtractionProseRange,
    MetadataResponse, Request, Response, response,
};
use config::Config;
use dictionary::Dictionary;
use glob::glob;
use hashing::{DiagnosticFingerprint, IgnoreStore};
use insights::ProseInsights;
use orchestrator::Orchestrator;
use prost::Message;
use rust_core::sls::SchemaRegistry;
use rust_core::{checker, config, dictionary, hashing, insights, orchestrator, prose, workspace};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Notify};
use tracing::{debug, error, info, warn};
use workspace::WorkspaceIndex;

/// Slice a `&str` at byte offsets, snapping to the nearest char boundaries.
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

async fn process_file_for_indexing(
    file_path: PathBuf,
    orchestrator: Arc<Mutex<Orchestrator>>,
    ignore_store_arc: Arc<Mutex<IgnoreStore>>,
    schema_registry_arc: Arc<Mutex<SchemaRegistry>>,
    workspace_index_arc: Arc<Mutex<Option<WorkspaceIndex>>>,
    config_arc: Arc<Mutex<Config>>,
    lang_id: String,
) -> Result<()> {
    if !file_path.is_file() {
        return Ok(());
    }

    let text = fs::read_to_string(&file_path).await?;

    // Check if file is unchanged since last indexing (cache hit)
    if let Some(file_path_str) = file_path.to_str()
        && let Some(idx) = &*workspace_index_arc.lock().await
        && idx.is_file_unchanged(file_path_str, &text)
    {
        return Ok(());
    }

    let ranges = {
        let schema_registry = schema_registry_arc.lock().await;
        let cfg = config_arc.lock().await;
        prose::extract_with_fallback(
            &text,
            &lang_id,
            Some(file_path.as_path()),
            Some(&schema_registry),
            &cfg.languages.latex.skip_environments,
        )?
    };
    let mut all_diagnostics = Vec::new();

    for range in ranges {
        let prose_text = range.extract_text(&text);

        // Uses a dedicated indexing orchestrator — no contention with foreground
        let mut orch = orchestrator.lock().await;
        let check_result = orch.check(&prose_text, &lang_id).await;
        drop(orch);

        if let Ok(mut diagnostics) = check_result {
            diagnostics.retain(|d| !range.overlaps_exclusion(d.start_byte, d.end_byte));
            for d in &mut diagnostics {
                d.start_byte += range.start_byte as u32;
                d.end_byte += range.start_byte as u32;
            }
            let ignore_store_lock = ignore_store_arc.lock().await;
            diagnostics.retain(|d| {
                let fingerprint = DiagnosticFingerprint::new(
                    &d.message,
                    &text,
                    d.start_byte as usize,
                    d.end_byte as usize,
                );
                !ignore_store_lock.is_ignored(&fingerprint)
            });
            drop(ignore_store_lock);
            all_diagnostics.extend(diagnostics);
        }

        tokio::task::yield_now().await;
    }

    if let Some(idx) = &*workspace_index_arc.lock().await
        && let Some(file_path_str) = file_path.to_str()
    {
        let insights = ProseInsights::analyze(&text);
        idx.update_diagnostics(file_path_str, &all_diagnostics)
            .unwrap_or_else(|e| {
                warn!(file = file_path_str, "Error updating diagnostics: {e}");
            });
        idx.update_insights(file_path_str, &insights)
            .unwrap_or_else(|e| warn!(file = file_path_str, "Error updating insights: {e}"));
        idx.update_file_hash(file_path_str, &text)
            .unwrap_or_else(|e| warn!(file = file_path_str, "Error updating file hash: {e}"));
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize structured logging.  In debug builds default to `debug`;
    // in release builds default to `warn`.  The user can always override
    // via the RUST_LOG env-var (e.g. `RUST_LOG=trace`).
    let default_level = if cfg!(debug_assertions) {
        "debug"
    } else {
        "warn"
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_level)),
        )
        .with_writer(std::io::stderr)
        .with_target(false)
        .init();

    let stdin = tokio::io::stdin();
    let mut buffer = BytesMut::with_capacity(4096);

    let orchestrator_arc: Arc<Mutex<Orchestrator>> =
        Arc::new(Mutex::new(Orchestrator::new(Config::default())));
    let config_arc: Arc<Mutex<Config>> = Arc::new(Mutex::new(Config::default()));
    let ignore_store_arc: Arc<Mutex<IgnoreStore>> = Arc::new(Mutex::new(IgnoreStore::new()));
    let dictionary_arc: Arc<Mutex<Dictionary>> = Arc::new(Mutex::new(Dictionary::new()));
    let schema_registry_arc: Arc<Mutex<SchemaRegistry>> =
        Arc::new(Mutex::new(SchemaRegistry::new()));
    let workspace_index_arc: Arc<Mutex<Option<WorkspaceIndex>>> = Arc::new(Mutex::new(None));
    let indexing_notify = Arc::new(Notify::new());

    // Background indexing task — uses its own orchestrator to avoid mutex
    // contention with the foreground request handler.
    let indexing_handle = {
        let config_arc = config_arc.clone();
        let ignore_store_arc = ignore_store_arc.clone();
        let schema_registry_arc = schema_registry_arc.clone();
        let workspace_index_arc = workspace_index_arc.clone();
        let indexing_notify = indexing_notify.clone();
        // Read the foreground config to build the indexing orchestrator
        let fg_orchestrator = orchestrator_arc.clone();

        tokio::spawn(async move {
            loop {
                indexing_notify.notified().await; // Wait for notification to start indexing

                // Delay indexing to let initial foreground requests complete first
                tokio::time::sleep(Duration::from_secs(3)).await;

                let workspace_root = {
                    let idx_lock = workspace_index_arc.lock().await;
                    idx_lock
                        .as_ref()
                        .and_then(|idx| idx.get_root_path().map(Path::to_path_buf))
                };

                if let Some(root) = workspace_root {
                    info!(root = %root.display(), "Starting workspace indexing");

                    // Build a dedicated orchestrator for indexing.  Force Harper-only
                    // mode so background work never hits the LT HTTP server — this
                    // avoids flooding LT's request queue and starving foreground
                    // requests that genuinely need LT.
                    let mut config = fg_orchestrator.lock().await.get_config().clone();
                    config.engines.harper = true;
                    config.engines.languagetool = false;
                    config.engines.english_engine = "harper".to_string();
                    let indexing_orchestrator =
                        Arc::new(Mutex::new(Orchestrator::new(config.clone())));

                    // Build exclude matchers from config.
                    let exclude_patterns: Vec<glob::Pattern> = config
                        .exclude
                        .iter()
                        .filter_map(|p| glob::Pattern::new(p).ok())
                        .collect();
                    let match_opts = glob::MatchOptions {
                        require_literal_separator: false,
                        require_literal_leading_dot: false,
                        case_sensitive: true,
                    };

                    let mut tasks = Vec::new();
                    let mut file_patterns = rust_core::languages::all_file_patterns(&config);
                    file_patterns.extend(schema_registry_arc.lock().await.fallback_file_patterns());

                    for (pattern_suffix, lang) in &file_patterns {
                        let full_pattern = format!("{}/{}", root.to_string_lossy(), pattern_suffix);
                        if let Ok(entries) = glob(&full_pattern) {
                            for path in entries.flatten() {
                                // Skip files matching exclude patterns
                                let rel = path.strip_prefix(&root).unwrap_or(&path);
                                let rel_str = rel.to_string_lossy();
                                if exclude_patterns
                                    .iter()
                                    .any(|p| p.matches_with(&rel_str, match_opts))
                                {
                                    continue;
                                }

                                let task_orchestrator = indexing_orchestrator.clone();
                                let task_config = config_arc.clone();
                                let task_ignore_store = ignore_store_arc.clone();
                                let task_schema_registry = schema_registry_arc.clone();
                                let task_workspace_index = workspace_index_arc.clone();
                                let lang_id = lang.clone();

                                tasks.push(tokio::spawn(process_file_for_indexing(
                                    path,
                                    task_orchestrator,
                                    task_ignore_store,
                                    task_schema_registry,
                                    task_workspace_index,
                                    task_config,
                                    lang_id,
                                )));
                            }
                        }
                    }

                    for task in tasks {
                        if let Err(e) = task.await {
                            warn!("Error joining indexing task: {e}");
                        }
                    }
                    info!(root = %root.display(), "Finished workspace indexing");
                }
                tokio::time::sleep(Duration::from_secs(600)).await; // Re-index every 10 minutes
            }
        })
    };

    // Wrap stdout in Arc<Mutex> so spawned tasks can write responses concurrently.
    let stdout_arc = Arc::new(Mutex::new(tokio::io::stdout()));

    /// Send a length-prefixed protobuf response to stdout.
    async fn send_response(
        stdout: &Arc<Mutex<tokio::io::Stdout>>,
        response: Response,
    ) -> Result<()> {
        let mut out_buffer = Vec::new();
        response.encode(&mut out_buffer)?;
        let out_length = out_buffer.len() as u32;
        let mut stdout = stdout.lock().await;
        stdout.write_all(&out_length.to_be_bytes()).await?;
        stdout.write_all(&out_buffer).await?;
        stdout.flush().await?;
        Ok(())
    }

    let mut reader = stdin;

    loop {
        // Read 4-byte length prefix
        if buffer.len() < 4 {
            let mut chunk = [0u8; 4096];
            let n = reader.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..n]);
        }

        if buffer.len() < 4 {
            continue;
        }

        let mut length_buf = [0u8; 4];
        length_buf.copy_from_slice(&buffer[..4]);
        let length: usize = u32::from_be_bytes(length_buf) as usize;

        if buffer.len() < 4 + length {
            let mut chunk = [0u8; 4096];
            let n = reader.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..n]);
            continue;
        }

        buffer.advance(4);
        let msg_data = buffer.split_to(length);

        let request = match Request::decode(msg_data) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to decode request: {e}");
                let response = Response {
                    id: 0,
                    payload: Some(response::Payload::Error(ErrorResponse {
                        message: format!("Failed to decode request: {e}"),
                    })),
                };
                send_response(&stdout_arc, response).await?;
                continue;
            }
        };

        let request_id = request.id;
        let payload_kind = match &request.payload {
            Some(checker::request::Payload::Initialize(_)) => "Initialize",
            Some(checker::request::Payload::CheckProse(_)) => "CheckProse",
            Some(checker::request::Payload::GetMetadata(_)) => "GetMetadata",
            Some(checker::request::Payload::Ignore(_)) => "Ignore",
            Some(checker::request::Payload::AddDictionaryWord(_)) => "AddDictionaryWord",
            None => "Empty",
        };
        debug!(id = request_id, kind = payload_kind, "Request received");

        // Clone Arcs for the spawned task
        let orchestrator_arc = orchestrator_arc.clone();
        let config_arc = config_arc.clone();
        let ignore_store_arc = ignore_store_arc.clone();
        let dictionary_arc = dictionary_arc.clone();
        let schema_registry_arc = schema_registry_arc.clone();
        let workspace_index_arc = workspace_index_arc.clone();
        let indexing_notify = indexing_notify.clone();
        let stdout_arc_clone = stdout_arc.clone();

        // Spawn the handler so the main loop can immediately read the next request.
        // Heavy requests (CheckProse with LT) no longer block lightweight ones
        // (AddDictionaryWord, Ignore).
        tokio::spawn(async move {
            let handler_start = std::time::Instant::now();
            let response_payload = match request.payload {
            Some(checker::request::Payload::Initialize(req)) => {
                let root_path = std::path::PathBuf::from(&req.workspace_root);

                let config = Config::load(&root_path).unwrap_or_else(|_| Config::default());
                info!(
                    id = request_id,
                    harper = config.engines.harper,
                    languagetool = config.engines.languagetool,
                    english_engine = %config.engines.english_engine,
                    "Initialize: engines configured"
                );
                orchestrator_arc.lock().await.update_config(config.clone());
                *config_arc.lock().await = config.clone();

                // Load persisted ignore store and dictionary from workspace
                match Dictionary::load(&root_path) {
                    Ok(mut loaded_dict) => {
                        // Load bundled domain-specific dictionaries
                        if config.dictionaries.bundled {
                            loaded_dict.load_bundled();
                        }
                        // Load user-configured additional wordlist files
                        for path_str in &config.dictionaries.paths {
                            let path = std::path::Path::new(path_str);
                            if let Err(e) = loaded_dict.load_wordlist_file(path, &root_path) {
                                warn!(path = path_str, "Could not load wordlist: {e}");
                            }
                        }
                        info!(
                            words = loaded_dict.len(),
                            bundled = config.dictionaries.bundled,
                            extra_paths = config.dictionaries.paths.len(),
                            "Dictionary loaded"
                        );
                        *dictionary_arc.lock().await = loaded_dict;
                    }
                    Err(e) => {
                        warn!("Could not load dictionary: {e}");
                    }
                }
                match IgnoreStore::load(&root_path) {
                    Ok(loaded_store) => {
                        *ignore_store_arc.lock().await = loaded_store;
                    }
                    Err(e) => {
                        warn!("Could not load ignore store: {e}");
                    }
                }

                match SchemaRegistry::from_workspace(&root_path) {
                    Ok(schema_registry) => {
                        info!(count = schema_registry.len(), "Loaded SLS schemas");
                        *schema_registry_arc.lock().await = schema_registry;

                        match WorkspaceIndex::new(&root_path) {
                            Ok(index) => {
                                let mut idx_lock = workspace_index_arc.lock().await;
                                *idx_lock = Some(index);
                                let should_index = config.workspace.index_on_open
                                    || req.index_on_open.unwrap_or(false);
                                if should_index {
                                    info!("Workspace indexing enabled — starting background index");
                                    indexing_notify.notify_one();
                                } else {
                                    debug!("Workspace indexing disabled (workspace.index_on_open = false)");
                                }
                                Some(response::Payload::Ok(checker::OkResponse {}))
                            }
                            Err(e) => Some(response::Payload::Error(ErrorResponse {
                                message: e.to_string(),
                            })),
                        }
                    }
                    Err(e) => Some(response::Payload::Error(ErrorResponse {
                        message: format!("Failed to load SLS schemas: {e}"),
                    })),
                }
            }
            Some(checker::request::Payload::CheckProse(req)) => {
                let canonical_lang = rust_core::languages::resolve_language_id(&req.language_id);
                let file_path = req.file_path.as_deref().map(Path::new);
                debug!(
                    id = request_id,
                    language = canonical_lang,
                    file = ?file_path,
                    text_len = req.text.len(),
                    "CheckProse: starting extraction"
                );
                let extraction = {
                    let schema_registry = schema_registry_arc.lock().await;
                    let cfg = config_arc.lock().await;
                    prose::extract_with_fallback(
                        &req.text,
                        canonical_lang,
                        file_path,
                        Some(&schema_registry),
                        &cfg.languages.latex.skip_environments,
                    )
                };

                match extraction {
                    Ok(ranges) => {
                        debug!(
                            id = request_id,
                            ranges = ranges.len(),
                            "CheckProse: extraction complete, checking ranges"
                        );
                        let extraction_info = ExtractionInfo {
                            prose_ranges: ranges
                                .iter()
                                .map(|r| ExtractionProseRange {
                                    start_byte: r.start_byte as u32,
                                    end_byte: r.end_byte as u32,
                                    exclusions: r
                                        .exclusions
                                        .iter()
                                        .map(|&(s, e)| ExtractionExclusion {
                                            start_byte: s as u32,
                                            end_byte: e as u32,
                                        })
                                        .collect(),
                                })
                                .collect(),
                        };

                        let mut all_diagnostics = Vec::new();
                        let check_start = std::time::Instant::now();
                        for (range_idx, range) in ranges.iter().enumerate() {
                            let prose_text = range.extract_text(&req.text);
                            let range_start = std::time::Instant::now();

                            let mut orchestrator = orchestrator_arc.lock().await;
                            let check_result =
                                orchestrator.check(&prose_text, &req.language_id).await;
                            drop(orchestrator);

                            debug!(
                                id = request_id,
                                range = range_idx,
                                start = range.start_byte,
                                end = range.end_byte,
                                elapsed_ms = range_start.elapsed().as_millis() as u64,
                                "CheckProse: range checked"
                            );

                            let ignore_store = ignore_store_arc.lock().await;
                            let dict = dictionary_arc.lock().await;
                            if let Ok(mut diagnostics) = check_result {
                                diagnostics.retain(|d| {
                                    !range.overlaps_exclusion(d.start_byte, d.end_byte)
                                });
                                for d in &mut diagnostics {
                                    d.start_byte += range.start_byte as u32;
                                    d.end_byte += range.start_byte as u32;
                                }

                                diagnostics.retain(|d| {
                                    let fingerprint = DiagnosticFingerprint::new(
                                        &d.message,
                                        &req.text,
                                        d.start_byte as usize,
                                        d.end_byte as usize,
                                    );
                                    if ignore_store.is_ignored(&fingerprint) {
                                        return false;
                                    }
                                    if d.unified_id.starts_with("spelling.") {
                                        let word = safe_slice(
                                            &req.text,
                                            d.start_byte as usize,
                                            d.end_byte as usize,
                                        );
                                        if dict.contains(word) {
                                            return false;
                                        }
                                    }
                                    true
                                });

                                all_diagnostics.extend(diagnostics);
                            }
                        }
                        debug!(
                            id = request_id,
                            elapsed_ms = check_start.elapsed().as_millis() as u64,
                            ranges = ranges.len(),
                            diagnostics = all_diagnostics.len(),
                            "CheckProse complete"
                        );

                        // Store diagnostics and insights in workspace index (non-fatal)
                        if let Some(idx) = &*workspace_index_arc.lock().await
                            && let Some(file_path) = req.file_path.clone()
                        {
                            let insights = ProseInsights::analyze(&req.text);
                            idx.update_diagnostics(&file_path, &all_diagnostics)
                                .unwrap_or_else(|e| {
                                    warn!(file = file_path, "Error updating diagnostics: {e}");
                                });
                            idx.update_insights(&file_path, &insights)
                                .unwrap_or_else(|e| {
                                    warn!(file = file_path, "Error updating insights: {e}");
                                });
                        }
                        Some(response::Payload::CheckProse(CheckResponse {
                            diagnostics: all_diagnostics,
                            extraction: Some(extraction_info),
                        }))
                    }
                    Err(e) => Some(response::Payload::Error(ErrorResponse {
                        message: format!("Extraction error: {e}"),
                    })),
                }
            }
            Some(checker::request::Payload::GetMetadata(_)) => {
                Some(response::Payload::GetMetadata(MetadataResponse {
                    name: "Rust Core".to_string(),
                    version: "0.1.0".to_string(),
                    supported_languages: rust_core::languages::SUPPORTED_LANGUAGE_IDS
                        .iter()
                        .map(|s| (*s).to_string())
                        .collect(),
                }))
            }
            Some(checker::request::Payload::Ignore(req)) => {
                debug!(id = request_id, "Ignore: adding fingerprint");
                let mut ignore_store = ignore_store_arc.lock().await;
                let fingerprint = if req.text.is_empty() {
                    DiagnosticFingerprint::new(
                        &req.message,
                        &req.context,
                        0,
                        req.context.len(),
                    )
                } else {
                    DiagnosticFingerprint::new(
                        &req.message,
                        &req.text,
                        req.start_byte as usize,
                        req.end_byte as usize,
                    )
                };
                ignore_store.ignore(&fingerprint);

                Some(response::Payload::Ok(checker::OkResponse {}))
            }
            Some(checker::request::Payload::AddDictionaryWord(req)) => {
                debug!(id = request_id, word = %req.word, "AddDictionaryWord: persisting");
                let mut dict = dictionary_arc.lock().await;
                match dict.add_word(&req.word) {
                    Ok(()) => {
                        info!(id = request_id, word = %req.word, "Word added to dictionary");
                        Some(response::Payload::Ok(checker::OkResponse {}))
                    }
                    Err(e) => {
                        warn!(id = request_id, word = %req.word, "Failed to add word: {e}");
                        Some(response::Payload::Error(ErrorResponse {
                            message: format!("Failed to add word to dictionary: {e}"),
                        }))
                    }
                }
            }
            None => Some(response::Payload::Error(ErrorResponse {
                message: "Empty payload".to_string(),
            })),
        };

            let elapsed = handler_start.elapsed().as_millis() as u64;
            debug!(id = request_id, kind = payload_kind, elapsed_ms = elapsed, "Response ready");

            let response = Response {
                id: request_id,
                payload: response_payload,
            };
            if let Err(e) = send_response(&stdout_arc_clone, response).await {
                error!(id = request_id, "Failed to send response: {e}");
            }
        });
    }

    indexing_handle.abort();

    Ok(())
}
