use anyhow::Result;
use bytes::{BytesMut, Buf};
use prost::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::Mutex;
use rust_core::{checker, prose, engines, orchestrator, hashing, workspace};
use checker::{Request, Response, response, ErrorResponse, CheckResponse, MetadataResponse};
use prose::ProseExtractor;
use engines::{HarperEngine, LanguageToolEngine};
use orchestrator::Orchestrator;
use hashing::{IgnoreStore, DiagnosticFingerprint};
use workspace::WorkspaceIndex;

#[tokio::main]
async fn main() -> Result<()> {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut buffer = BytesMut::with_capacity(4096);

    let mut orchestrator = Orchestrator::new();
    orchestrator.add_engine(Box::new(HarperEngine::new()));
    orchestrator.add_engine(Box::new(LanguageToolEngine::new("http://localhost:8010".to_string())));

    let mut ignore_store = IgnoreStore::new();
    let workspace_index: Arc<Mutex<Option<WorkspaceIndex>>> = Arc::new(Mutex::new(None));

    let mut reader = stdin;

    loop {
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
        let length = u32::from_be_bytes(length_buf) as usize;

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
                match WorkspaceIndex::new(&root_path) {
                    Ok(index) => {
                        let mut idx_lock = workspace_index.lock().await;
                        *idx_lock = Some(index);
                        Some(response::Payload::Ok(checker::OkResponse {}))
                    }
                    Err(e) => Some(response::Payload::Error(ErrorResponse { message: e.to_string() })),
                }
            }
            Some(checker::request::Payload::CheckProse(req)) => {
                // Determine TS language based on request language_id
                let ts_lang = match req.language_id.as_str() {
                    "markdown" => tree_sitter_markdown::language(),
                    "html" => tree_sitter_html::language(),
                    _ => tree_sitter_markdown::language(),
                };
                
                // Re-init extractor if language changed (simplified for now)
                let mut extractor = ProseExtractor::new(ts_lang)?;

                match extractor.extract(&req.text, &req.language_id) {
                    Ok(ranges) => {
                        let mut all_diagnostics = Vec::new();
                        for range in ranges {
                            let prose_text = &req.text[range.start_byte..range.end_byte];
                            if let Ok(mut diagnostics) = orchestrator.check(prose_text, &req.language_id).await {
                                // Offset the diagnostics back to the original document coordinates
                                for d in &mut diagnostics {
                                    d.start_byte += range.start_byte as u32;
                                    d.end_byte += range.start_byte as u32;
                                }
                                
                                // Filter out ignored
                                diagnostics.retain(|d| {
                                    let fingerprint = DiagnosticFingerprint::new(&d.message, &req.text, d.start_byte as usize, d.end_byte as usize);
                                    !ignore_store.is_ignored(&fingerprint)
                                });

                                all_diagnostics.extend(diagnostics);
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

    Ok(())
}
