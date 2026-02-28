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
use checker::{CheckResponse, ErrorResponse, MetadataResponse, Request, Response, response};
use config::Config;
use dictionary::Dictionary;
use glob::glob;
use hashing::{DiagnosticFingerprint, IgnoreStore};
use insights::ProseInsights;
use orchestrator::Orchestrator;
use prose::ProseExtractor;
use prost::Message;
use rust_core::{checker, config, dictionary, hashing, insights, orchestrator, prose, workspace};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Notify};
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
    orchestrator_arc: Arc<Mutex<Orchestrator>>,
    ignore_store_arc: Arc<Mutex<IgnoreStore>>,
    workspace_index_arc: Arc<Mutex<Option<WorkspaceIndex>>>,
    lang_id: String,
    ts_lang: tree_sitter::Language,
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

    let mut extractor = ProseExtractor::new(ts_lang)?;

    let ranges = extractor.extract(&text, &lang_id)?;
    let mut all_diagnostics = Vec::new();

    // Acquire/release locks per-range to avoid starving foreground requests
    for range in ranges {
        let prose_text = range.extract_text(&text);

        let mut orchestrator_lock = orchestrator_arc.lock().await;
        let check_result = orchestrator_lock.check(&prose_text, &lang_id).await;
        drop(orchestrator_lock);

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

        // Yield to let foreground requests acquire the lock
        tokio::task::yield_now().await;
    }

    if let Some(idx) = &*workspace_index_arc.lock().await
        && let Some(file_path_str) = file_path.to_str()
    {
        let insights = ProseInsights::analyze(&text);
        idx.update_diagnostics(file_path_str, &all_diagnostics)
            .unwrap_or_else(|e| {
                eprintln!("Error updating diagnostics for {file_path_str}: {e}");
            });
        idx.update_insights(file_path_str, &insights)
            .unwrap_or_else(|e| eprintln!("Error updating insights for {file_path_str}: {e}"));
        idx.update_file_hash(file_path_str, &text)
            .unwrap_or_else(|e| eprintln!("Error updating file hash for {file_path_str}: {e}"));
    }

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut buffer = BytesMut::with_capacity(4096);

    let orchestrator_arc: Arc<Mutex<Orchestrator>> =
        Arc::new(Mutex::new(Orchestrator::new(Config::default())));
    let ignore_store_arc: Arc<Mutex<IgnoreStore>> = Arc::new(Mutex::new(IgnoreStore::new()));
    let dictionary_arc: Arc<Mutex<Dictionary>> = Arc::new(Mutex::new(Dictionary::new()));
    let workspace_index_arc: Arc<Mutex<Option<WorkspaceIndex>>> = Arc::new(Mutex::new(None));
    let indexing_notify = Arc::new(Notify::new());

    // Background indexing task
    let indexing_handle = {
        let orchestrator_arc = orchestrator_arc.clone();
        let ignore_store_arc = ignore_store_arc.clone();
        let workspace_index_arc = workspace_index_arc.clone();
        let indexing_notify = indexing_notify.clone();

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
                    eprintln!("Starting workspace indexing for {}", root.display());
                    let config = orchestrator_arc.lock().await.get_config().clone();

                    // Build exclude matchers from config.
                    // We use MatchOptions with require_literal_separator = false
                    // so that "node_modules/**" matches "node_modules/a/b/c".
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

                    use tree_sitter_language::LanguageFn;
                    let file_types: &[(&str, &str, LanguageFn)] = &[
                        ("**/*.md", "markdown", tree_sitter_md::LANGUAGE),
                        ("**/*.html", "html", tree_sitter_html::LANGUAGE),
                        ("**/*.htm", "html", tree_sitter_html::LANGUAGE),
                        ("**/*.tex", "latex", codebook_tree_sitter_latex::LANGUAGE),
                        ("**/*.tree", "forester", rust_core::forester_ts::LANGUAGE),
                    ];

                    for &(pattern_suffix, lang, ts_lang_fn) in file_types {
                        let full_pattern = format!("{}/{}", root.to_string_lossy(), pattern_suffix);
                        if let Ok(entries) = glob(&full_pattern) {
                            for path in entries.flatten() {
                                // Skip files matching exclude patterns
                                let rel = path.strip_prefix(&root).unwrap_or(&path);
                                let rel_str = rel.to_string_lossy();
                                if exclude_patterns.iter().any(|p| p.matches_with(&rel_str, match_opts)) {
                                    continue;
                                }

                                let task_orchestrator = orchestrator_arc.clone();
                                let task_ignore_store = ignore_store_arc.clone();
                                let task_workspace_index = workspace_index_arc.clone();
                                let lang_id = lang.to_string();

                                tasks.push(tokio::spawn(process_file_for_indexing(
                                    path,
                                    task_orchestrator,
                                    task_ignore_store,
                                    task_workspace_index,
                                    lang_id,
                                    ts_lang_fn.into(),
                                )));
                            }
                        }
                    }

                    for task in tasks {
                        if let Err(e) = task.await {
                            eprintln!("Error joining indexing task: {e}");
                        }
                    }
                    eprintln!("Finished workspace indexing for {}", root.display());
                }
                tokio::time::sleep(Duration::from_secs(600)).await; // Re-index every 10 minutes
            }
        })
    };

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
                eprintln!("Failed to decode request: {e}");
                // Send error response with id=0 since we can't read the request id
                let response = Response {
                    id: 0,
                    payload: Some(response::Payload::Error(ErrorResponse {
                        message: format!("Failed to decode request: {e}"),
                    })),
                };
                let mut out_buffer = Vec::new();
                response.encode(&mut out_buffer)?;
                let out_length = out_buffer.len() as u32;
                stdout.write_all(&out_length.to_be_bytes()).await?;
                stdout.write_all(&out_buffer).await?;
                stdout.flush().await?;
                continue;
            }
        };
        let response_payload = match request.payload {
            Some(checker::request::Payload::Initialize(req)) => {
                let root_path = std::path::PathBuf::from(&req.workspace_root);

                let config = Config::load(&root_path).unwrap_or_else(|_| Config::default());
                orchestrator_arc.lock().await.update_config(config.clone());

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
                                eprintln!("Warning: could not load wordlist {path_str}: {e}");
                            }
                        }
                        eprintln!(
                            "Dictionary loaded: {} words (bundled={}, extra_paths={})",
                            loaded_dict.len(),
                            config.dictionaries.bundled,
                            config.dictionaries.paths.len(),
                        );
                        *dictionary_arc.lock().await = loaded_dict;
                    }
                    Err(e) => {
                        eprintln!("Warning: could not load dictionary: {e}");
                    }
                }
                match IgnoreStore::load(&root_path) {
                    Ok(loaded_store) => {
                        *ignore_store_arc.lock().await = loaded_store;
                    }
                    Err(e) => {
                        eprintln!("Warning: could not load ignore store: {e}");
                    }
                }

                match WorkspaceIndex::new(&root_path) {
                    Ok(index) => {
                        let mut idx_lock = workspace_index_arc.lock().await;
                        *idx_lock = Some(index);
                        indexing_notify.notify_one();
                        Some(response::Payload::Ok(checker::OkResponse {}))
                    }
                    Err(e) => Some(response::Payload::Error(ErrorResponse {
                        message: e.to_string(),
                    })),
                }
            }
            Some(checker::request::Payload::CheckProse(req)) => {
                let ts_lang: tree_sitter::Language = match req.language_id.as_str() {
                    "html" => tree_sitter_html::LANGUAGE.into(),
                    "latex" => codebook_tree_sitter_latex::LANGUAGE.into(),
                    "forester" => rust_core::forester_ts::LANGUAGE.into(),
                    _ => tree_sitter_md::LANGUAGE.into(),
                };

                match ProseExtractor::new(ts_lang) {
                    Ok(mut extractor) => match extractor.extract(&req.text, &req.language_id) {
                        Ok(ranges) => {
                            let mut all_diagnostics = Vec::new();
                            let mut orchestrator = orchestrator_arc.lock().await;
                            let ignore_store = ignore_store_arc.lock().await;
                            let dict = dictionary_arc.lock().await;
                            for range in ranges {
                                let prose_text = range.extract_text(&req.text);
                                if let Ok(mut diagnostics) =
                                    orchestrator.check(&prose_text, &req.language_id).await
                                {
                                    diagnostics.retain(|d| !range.overlaps_exclusion(d.start_byte, d.end_byte));
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
                                        // Skip spelling diagnostics for dictionary words
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

                            // Store diagnostics and insights in workspace index (non-fatal)
                            if let Some(idx) = &*workspace_index_arc.lock().await
                                && let Some(file_path) = req.file_path.clone()
                            {
                                let insights = ProseInsights::analyze(&req.text);
                                idx.update_diagnostics(&file_path, &all_diagnostics)
                                    .unwrap_or_else(|e| {
                                        eprintln!(
                                            "Error updating diagnostics for {file_path}: {e}"
                                        );
                                    });
                                idx.update_insights(&file_path, &insights)
                                    .unwrap_or_else(|e| {
                                        eprintln!("Error updating insights for {file_path}: {e}");
                                    });
                            }
                            Some(response::Payload::CheckProse(CheckResponse {
                                diagnostics: all_diagnostics,
                            }))
                        }
                        Err(e) => Some(response::Payload::Error(ErrorResponse {
                            message: format!("Extraction error: {e}"),
                        })),
                    },
                    Err(e) => Some(response::Payload::Error(ErrorResponse {
                        message: format!("Failed to create prose extractor: {e}"),
                    })),
                }
            }
            Some(checker::request::Payload::GetMetadata(_)) => {
                Some(response::Payload::GetMetadata(MetadataResponse {
                    name: "Rust Core".to_string(),
                    version: "0.1.0".to_string(),
                    supported_languages: vec![
                        "markdown".to_string(),
                        "html".to_string(),
                        "latex".to_string(),
                        "forester".to_string(),
                    ],
                }))
            }
            Some(checker::request::Payload::Ignore(req)) => {
                let mut ignore_store = ignore_store_arc.lock().await;
                let fingerprint =
                    DiagnosticFingerprint::new(&req.message, &req.context, 0, req.context.len());
                ignore_store.ignore(&fingerprint);

                Some(response::Payload::Ok(checker::OkResponse {}))
            }
            Some(checker::request::Payload::AddDictionaryWord(req)) => {
                let mut dict = dictionary_arc.lock().await;
                match dict.add_word(&req.word) {
                    Ok(()) => Some(response::Payload::Ok(checker::OkResponse {})),
                    Err(e) => Some(response::Payload::Error(ErrorResponse {
                        message: format!("Failed to add word to dictionary: {e}"),
                    })),
                }
            }
            None => Some(response::Payload::Error(ErrorResponse {
                message: "Empty payload".to_string(),
            })),
        };

        let response = Response {
            id: request.id,
            payload: response_payload,
        };

        let mut out_buffer = Vec::new();
        response.encode(&mut out_buffer)?;

        let out_length = out_buffer.len() as u32;
        stdout.write_all(&out_length.to_be_bytes()).await?;
        stdout.write_all(&out_buffer).await?;
        stdout.flush().await?;
    }

    indexing_handle.abort();

    Ok(())
}
