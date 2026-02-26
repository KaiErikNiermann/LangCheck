use anyhow::Result;
use bytes::{BytesMut, Buf};
use prost::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub mod checker {
    include!(concat!(env!("OUT_DIR"), "/languagecheck.rs"));
}

pub mod prose;
pub mod engines;
pub mod orchestrator;

use checker::{Request, Response, response, ErrorResponse, CheckResponse, MetadataResponse};
use prose::ProseExtractor;
use engines::{HarperEngine, LanguageToolEngine};
use orchestrator::Orchestrator;

#[tokio::main]
async fn main() -> Result<()> {
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut buffer = BytesMut::with_capacity(4096);

    let language = tree_sitter_markdown::language();
    let mut extractor = ProseExtractor::new(language)?;
    
    let mut orchestrator = Orchestrator::new();
    orchestrator.add_engine(Box::new(HarperEngine::new()));
    orchestrator.add_engine(Box::new(LanguageToolEngine::new("http://localhost:8010".to_string())));

    loop {
        // Read 4-byte length prefix
        if buffer.len() < 4 {
            let mut chunk = [0u8; 4096];
            let n = stdin.read(&mut chunk).await?;
            if n == 0 { break; }
            buffer.extend_from_slice(&chunk[..n]);
        }

        if buffer.len() < 4 { continue; }

        let mut length_buf = [0u8; 4];
        length_buf.copy_from_slice(&buffer[..4]);
        let length = u32::from_be_bytes(length_buf) as usize;

        if buffer.len() < 4 + length {
            let mut chunk = [0u8; 4096];
            let n = stdin.read(&mut chunk).await?;
            if n == 0 { break; }
            buffer.extend_from_slice(&chunk[..n]);
            continue;
        }

        buffer.advance(4);
        let msg_data = buffer.split_to(length);
        
        let request = Request::decode(msg_data)?;
        let response_payload = match request.payload {
            Some(checker::request::Payload::CheckProse(req)) => {
                match extractor.extract(&req.text) {
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
                    supported_languages: vec!["markdown".to_string()],
                }))
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
