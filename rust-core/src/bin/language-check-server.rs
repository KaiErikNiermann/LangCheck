use anyhow::Result;
use bytes::{BytesMut, Buf};
use prost::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::{Mutex, Notify};
use rust_core::{checker, prose, orchestrator, hashing, workspace, config, insights};
use checker::{Request, Response, response, ErrorResponse, CheckResponse, MetadataResponse};
use prose::ProseExtractor;
use orchestrator::Orchestrator;
use hashing::{IgnoreStore, DiagnosticFingerprint};
use workspace::WorkspaceIndex;
use config::Config;
use insights::ProseInsights;
use std::time::Duration;
use tokio::fs;
use glob::glob;
use std::path::{Path, PathBuf};

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
    
    let mut extractor = ProseExtractor::new(ts_lang)?;
    
    let ranges = extractor.extract(&text, &lang_id)?;
    let mut all_diagnostics = Vec::new();

    let mut orchestrator_lock = orchestrator_arc.lock().await; // Lock orchestrator here
    let ignore_store_lock = ignore_store_arc.lock().await; // Lock ignore store here

    for range in ranges {
        let prose_text = &text[range.start_byte..range.end_byte];
        if let Ok(mut diagnostics) = orchestrator_lock.check(prose_text, &lang_id).await {
            for d in &mut diagnostics {
                d.start_byte += range.start_byte as u32;
                d.end_byte += range.start_byte as u32;
            }
            diagnostics.retain(|d| {
                let fingerprint = DiagnosticFingerprint::new(&d.message, &text, d.start_byte as usize, d.end_byte as usize);
                !ignore_store_lock.is_ignored(&fingerprint)
            });
            all_diagnostics.extend(diagnostics);
        }
    }

    if let Some(idx) = &*workspace_index_arc.lock().await {
        if let Some(file_path_str) = file_path.to_str() {
            let insights = ProseInsights::analyze(&text);
            idx.update_diagnostics(file_path_str, all_diagnostics).unwrap_or_else(|e| eprintln!("Error updating diagnostics for {}: {}", file_path_str, e));
            idx.update_insights(file_path_str, insights).unwrap_or_else(|e| eprintln!("Error updating insights for {}: {}", file_path_str, e));
        }
    }

    Ok(())
}


#[tokio::main]
async fn main() -> Result<()> {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut buffer = BytesMut::with_capacity(4096);

    let orchestrator_arc: Arc<Mutex<Orchestrator>> = Arc::new(Mutex::new(Orchestrator::new(Config::default())));
    let ignore_store_arc: Arc<Mutex<IgnoreStore>> = Arc::new(Mutex::new(IgnoreStore::new()));
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
                
                let workspace_root = {
                    let idx_lock = workspace_index_arc.lock().await;
                    if let Some(idx) = idx_lock.as_ref() {
                        idx.get_root_path().map(|p| p.to_path_buf())
                    } else {
                        None
                    }
                };

                if let Some(root) = workspace_root {
                    println!("Starting workspace indexing for {:?}", root);
                    let config = orchestrator_arc.lock().await.get_config().clone(); // Get current config to decide what to index

                    let mut tasks = Vec::new();
                    // Iterate through configured file patterns and languages
                    // For now, hardcode markdown. Later, use config.
                    let markdown_pattern = format!("{}/**/*.md", root.to_string_lossy());
                    let ts_lang_md = tree_sitter_markdown::language(); // Markdown language
                    
                    if let Ok(entries) = glob(&markdown_pattern) {
                        for entry in entries {
                            if let Ok(path) = entry {
                                let task_orchestrator = orchestrator_arc.clone();
                                let task_ignore_store = ignore_store_arc.clone();
                                let task_workspace_index = workspace_index_arc.clone();
                                let lang_id = "markdown".to_string();
                                
                                tasks.push(tokio::spawn(process_file_for_indexing(
                                    path,
                                    task_orchestrator,
                                    task_ignore_store,
                                    task_workspace_index,
                                    lang_id,
                                    ts_lang_md,
                                )));
                            }
                        }
                    }

                    for task in tasks {
                        if let Err(e) = task.await {
                            eprintln!("Error joining indexing task: {}", e);
                        }
                    }
                    println!("Finished workspace indexing for {:?}", root);
                }
                tokio::time::sleep(Duration::from_secs(600)).await; // Re-index every 10 minutes
            }
        })
    };

    let mut reader = stdin;

    loop {
        let length: usize;

        // Read 4-byte length prefix
        if buffer.len() < 4 {
            let mut chunk = [0u8; 4096];
            let n = reader.read(&mut chunk).await?;
            if n == 0 { break; }
            buffer.extend_from_slice(&chunk[..n]);
        }

        if buffer.len() < 4 { continue; }

        let mut length_buf = [0u8; 4];
        length_buf.copy_from_slice(&buffer[..4]);
        length = u32::from_be_bytes(length_buf) as usize;

        if buffer.len() < 4 + length {
            let mut chunk = [0u8; 4096];
            let n = reader.read(&mut chunk).await?;
            if n == 0 { break; }
            buffer.extend_from_slice(&chunk[..n]);
            continue;
        }

        buffer.advance(4);
        let msg_data = buffer.split_to(length);
        
        let request = Request::decode(msg_data)?;
        let response_payload = match request.payload {
            Some(checker::request::Payload::Initialize(req)) => {
                let root_path = std::path::PathBuf::from(&req.workspace_root);
                
                let config = Config::load(&root_path).unwrap_or_else(|_| Config::default());
                orchestrator_arc.lock().await.update_config(config);

                match WorkspaceIndex::new(&root_path) {
                    Ok(index) => {
                        let mut idx_lock = workspace_index_arc.lock().await;
                        *idx_lock = Some(index);
                        indexing_notify.notify_one();
                        Some(response::Payload::Ok(checker::OkResponse {}))
                    }
                    Err(e) => Some(response::Payload::Error(ErrorResponse { message: e.to_string() })),
                }
            }
            Some(checker::request::Payload::CheckProse(req)) => {
                let ts_lang = match req.language_id.as_str() {
                    "markdown" => tree_sitter_markdown::language(),
                    "html" => tree_sitter_html::language(),
                    _ => tree_sitter_markdown::language(),
                };
                
                let mut extractor = ProseExtractor::new(ts_lang)?;

                match extractor.extract(&req.text, &req.language_id) {
                    Ok(ranges) => {
                        let mut all_diagnostics = Vec::new();
                        let mut orchestrator = orchestrator_arc.lock().await;
                        let ignore_store = ignore_store_arc.lock().await;
                        for range in ranges {
                            let prose_text = &req.text[range.start_byte..range.end_byte];
                            if let Ok(mut diagnostics) = orchestrator.check(prose_text, &req.language_id).await {
                                for d in &mut diagnostics {
                                    d.start_byte += range.start_byte as u32;
                                    d.end_byte += range.start_byte as u32;
                                }
                                
                                diagnostics.retain(|d| {
                                    let fingerprint = DiagnosticFingerprint::new(&d.message, &req.text, d.start_byte as usize, d.end_byte as usize);
                                    !ignore_store.is_ignored(&fingerprint)
                                });

                                all_diagnostics.extend(diagnostics);
                            }
                        }
                        
                        // Store diagnostics and insights in workspace index
                        if let Some(idx) = &*workspace_index_arc.lock().await {
                            if let Some(file_path) = req.file_path.clone() {
                                let insights = ProseInsights::analyze(&req.text);
                                idx.update_diagnostics(&file_path, all_diagnostics.clone())?;
                                idx.update_insights(&file_path, insights)?;
                            }
                        }
                        Some(response::Payload::CheckProse(CheckResponse { diagnostics: all_diagnostics }))
                    }
                    Err(e) => Some(response::Payload::Error(ErrorResponse { message: e.to_string() })),
                }
            }
            Some(checker::request::Payload::GetMetadata(_)) => {
                Some(response::Payload::GetMetadata(MetadataResponse {
                    name: "Rust Core".to_string(),
                    version: "0.1.0".to_string(),
                    supported_languages: vec!["markdown".to_string(), "html".to_string(), "latex".to_string()],
                }))
            }
            Some(checker::request::Payload::Ignore(req)) => {
                let mut ignore_store = ignore_store_arc.lock().await;
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                use std::hash::{Hash, Hasher};
                req.message.hash(&mut hasher);
                let m_hash = hasher.finish();
                
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                req.context.hash(&mut hasher);
                let c_hash = hasher.finish();
                
                ignore_store.ignore(&DiagnosticFingerprint {
                    message_hash: m_hash,
                    context_hash: c_hash,
                });
                
                Some(response::Payload::Ok(checker::OkResponse {}))
            }
            None => Some(response::Payload::Error(ErrorResponse { message: "Empty payload".to_string() })),
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
