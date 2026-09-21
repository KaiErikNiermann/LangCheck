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
    CheckResponse, ConfigIssue, ErrorResponse, ExtractionExclusion, ExtractionInfo,
    ExtractionProseRange, MetadataResponse, ProbeConfigResponse, Request, Response, response,
};
use config::Config;
use dictionary::Dictionary;
use glob::glob;
use hashing::{DiagnosticFingerprint, IgnoreStore};
use insights::ProseInsights;
use lang_check::morphology::AffixAnalyzer;
use lang_check::names::NameFilter;
use lang_check::sls::SchemaRegistry;
use lang_check::suppression::{InlineDirectives, SuppressionContext, retain_visible};
use lang_check::{checker, config, dictionary, hashing, insights, orchestrator, prose, workspace};
use orchestrator::Orchestrator;
use prost::Message;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, Notify};
use tracing::{debug, error, info, warn};
use workspace::WorkspaceIndex;

/// Shared handles a background indexing task needs.
///
/// Bundled rather than passed positionally so adding a source doesn't keep widening the
/// call signature.
#[derive(Clone)]
struct IndexingContext {
    orchestrator: Arc<Mutex<Orchestrator>>,
    ignore_store: Arc<Mutex<IgnoreStore>>,
    dictionary: Arc<Mutex<Dictionary>>,
    morphology: Arc<Mutex<Option<AffixAnalyzer>>>,
    name_filter: Arc<Mutex<Option<NameFilter>>>,
    schema_registry: Arc<Mutex<SchemaRegistry>>,
    workspace_index: Arc<Mutex<Option<WorkspaceIndex>>>,
    config: Arc<Mutex<Config>>,
}

async fn process_file_for_indexing(
    file_path: PathBuf,
    ctx: IndexingContext,
    lang_id: String,
) -> Result<()> {
    let IndexingContext {
        orchestrator,
        ignore_store: ignore_store_arc,
        dictionary: dictionary_arc,
        morphology: morphology_arc,
        name_filter: name_filter_arc,
        schema_registry: schema_registry_arc,
        workspace_index: workspace_index_arc,
        config: config_arc,
    } = ctx;
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
        let latex_extras = prose::latex::LatexExtras {
            skip_envs: &cfg.languages.latex.skip_environments,
            skip_commands: &cfg.languages.latex.skip_commands,
        };
        prose::extract_with_fallback(
            &text,
            &lang_id,
            Some(file_path.as_path()),
            Some(&schema_registry),
            &latex_extras,
        )?
    };
    let mut all_diagnostics = Vec::new();

    // Uses a dedicated indexing orchestrator — no contention with foreground
    let batch = {
        let mut orch = orchestrator.lock().await;
        let units = prose::range_units(&ranges, &text, &orch.get_config().engines.spell_language);
        orch.check_units_in(
            &units,
            &lang_check::orchestrator::CheckContext::for_path(Some(file_path.as_path())),
        )
        .await
    };

    let batch = batch.unwrap_or_else(|e| {
        warn!(file = %file_path.display(), "Indexing batch failed: {e}");
        Vec::new()
    });
    let directives = InlineDirectives::parse(&text);
    for (range, mut diagnostics) in ranges.iter().zip(batch) {
        range.adopt_diagnostics(&text, &mut diagnostics);
        let ignore_store_lock = ignore_store_arc.lock().await;
        let dictionary_lock = dictionary_arc.lock().await;
        let morphology_lock = morphology_arc.lock().await;
        let name_filter_lock = name_filter_arc.lock().await;
        let mut ctx = SuppressionContext::new()
            .with_ignore(&ignore_store_lock)
            .with_dictionary(&dictionary_lock)
            .with_directives(&directives);
        if let Some(analyzer) = morphology_lock.as_ref() {
            ctx = ctx.with_morphology(analyzer);
        }
        if let Some(filter) = name_filter_lock.as_ref() {
            ctx = ctx.with_names(filter);
        }
        retain_visible(&mut diagnostics, &text, &ctx);
        drop(name_filter_lock);
        drop(morphology_lock);
        drop(dictionary_lock);
        drop(ignore_store_lock);
        all_diagnostics.extend(diagnostics);

        tokio::task::yield_now().await;
    }

    if let Some(idx) = &*workspace_index_arc.lock().await
        && let Some(file_path_str) = file_path.to_str()
    {
        let insights = ProseInsights::analyze_ranges(&text, &ranges);
        let fingerprint = {
            let cfg = config_arc.lock().await;
            let dict = dictionary_arc.lock().await;
            let ignores = ignore_store_arc.lock().await;
            workspace::check_fingerprint(
                &text,
                &cfg,
                &dict,
                &ignores,
                name_filter_arc.lock().await.is_some(),
                schema_registry_arc.lock().await.fingerprint(),
            )
        };
        idx.store_check(file_path_str, fingerprint, &all_diagnostics)
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

    // --lsp flag: start the standard LSP JSON-RPC server instead of the
    // custom protobuf protocol.
    if std::env::args().any(|a| a == "--lsp") {
        lang_check::lsp::run_lsp().await;
        return Ok(());
    }

    let stdin = tokio::io::stdin();
    let mut buffer = BytesMut::with_capacity(4096);

    let orchestrator_arc: Arc<Mutex<Orchestrator>> =
        Arc::new(Mutex::new(Orchestrator::new(Config::default())));
    let config_arc: Arc<Mutex<Config>> = Arc::new(Mutex::new(Config::default()));
    let ignore_store_arc: Arc<Mutex<IgnoreStore>> = Arc::new(Mutex::new(IgnoreStore::new()));
    let dictionary_arc: Arc<Mutex<Dictionary>> = Arc::new(Mutex::new(Dictionary::new()));
    let morphology_arc: Arc<Mutex<Option<AffixAnalyzer>>> = Arc::new(Mutex::new(None));
    let name_filter_arc: Arc<Mutex<Option<NameFilter>>> = Arc::new(Mutex::new(None));
    let schema_registry_arc: Arc<Mutex<SchemaRegistry>> =
        Arc::new(Mutex::new(SchemaRegistry::new()));
    let workspace_index_arc: Arc<Mutex<Option<WorkspaceIndex>>> = Arc::new(Mutex::new(None));
    // Kept because `exclude` patterns are written relative to it, and a check
    // request carries an absolute path.
    let workspace_root_arc: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let indexing_notify = Arc::new(Notify::new());

    // Background indexing task — uses its own orchestrator to avoid mutex
    // contention with the foreground request handler.
    let indexing_handle = {
        let config_arc = config_arc.clone();
        let ignore_store_arc = ignore_store_arc.clone();
        let dictionary_arc = dictionary_arc.clone();
        let morphology_arc = morphology_arc.clone();
        let name_filter_arc = name_filter_arc.clone();
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
                    config.engines.harper.enabled = true;
                    config.engines.languagetool.enabled = false;
                    let indexing_orchestrator =
                        Arc::new(Mutex::new(Orchestrator::new(config.clone())));

                    let mut tasks = Vec::new();
                    let mut file_patterns = lang_check::languages::all_file_patterns(&config);
                    file_patterns.extend(schema_registry_arc.lock().await.fallback_file_patterns());

                    for (pattern_suffix, lang) in &file_patterns {
                        let full_pattern = format!("{}/{}", root.to_string_lossy(), pattern_suffix);
                        if let Ok(entries) = glob(&full_pattern) {
                            for path in entries.flatten() {
                                // `include` selects and `exclude` subtracts;
                                // the editor asks the same question below.
                                if !config.checks(&path, &root) {
                                    continue;
                                }

                                let task_ctx = IndexingContext {
                                    orchestrator: indexing_orchestrator.clone(),
                                    ignore_store: ignore_store_arc.clone(),
                                    dictionary: dictionary_arc.clone(),
                                    morphology: morphology_arc.clone(),
                                    name_filter: name_filter_arc.clone(),
                                    schema_registry: schema_registry_arc.clone(),
                                    workspace_index: workspace_index_arc.clone(),
                                    config: config_arc.clone(),
                                };
                                let lang_id = lang.clone();

                                tasks.push(tokio::spawn(process_file_for_indexing(
                                    path, task_ctx, lang_id,
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
                tokio::time::sleep(Duration::from_mins(10)).await;
            }
        })
    };

    // Wrap stdout in Arc<Mutex> so spawned tasks can write responses concurrently.
    let stdout_arc = Arc::new(Mutex::new(tokio::io::stdout()));

    /// Send a length-prefixed protobuf response to stdout.
    #[allow(clippy::items_after_statements)]
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
            Some(checker::request::Payload::ProbeConfig(_)) => "ProbeConfig",
            None => "Empty",
        };
        debug!(id = request_id, kind = payload_kind, "Request received");

        // Clone Arcs for the spawned task
        let orchestrator_arc = orchestrator_arc.clone();
        let config_arc = config_arc.clone();
        let ignore_store_arc = ignore_store_arc.clone();
        let dictionary_arc = dictionary_arc.clone();
        let morphology_arc = morphology_arc.clone();
        let name_filter_arc = name_filter_arc.clone();
        let schema_registry_arc = schema_registry_arc.clone();
        let workspace_index_arc = workspace_index_arc.clone();
        let workspace_root_arc = workspace_root_arc.clone();
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
                    *workspace_root_arc.lock().await = Some(root_path.clone());

                    let config = Config::load_or_warn(&root_path);
                    info!(
                        id = request_id,
                        harper = config.engines.harper.enabled,
                        languagetool = config.engines.languagetool.enabled,
                        vale = config.engines.vale.enabled,
                        proselint = config.engines.proselint.enabled,
                        "Initialize: engines configured"
                    );
                    orchestrator_arc.lock().await.update_config(config.clone());
                    *config_arc.lock().await = config.clone();

                    // The VS Code globals combine with the workspace config rather than
                    // overriding it. `bundled` defaults to true on both sides, so we
                    // cannot tell "unset" from "explicitly on" and take the restrictive
                    // reading: either side may switch the bundled lists off. The two
                    // lists simply union, so neither source silently drops the other's
                    // entries.
                    let load_bundled =
                        config.dictionaries.bundled && req.dictionaries_bundled.unwrap_or(true);
                    let mut disabled_sets = config.dictionaries.disabled.clone();
                    disabled_sets.extend(req.dictionaries_disabled.iter().cloned());
                    let mut wordlist_paths = config.dictionaries.paths.clone();
                    wordlist_paths.extend(req.dictionaries_paths.iter().cloned());

                    // Load persisted ignore store and dictionary from workspace
                    match Dictionary::load(&root_path) {
                        Ok(mut loaded_dict) => {
                            // Load bundled domain-specific dictionaries
                            if load_bundled {
                                loaded_dict.load_bundled_except(&disabled_sets);
                            }
                            // Load user-configured additional wordlist files
                            for path_str in &wordlist_paths {
                                let path = std::path::Path::new(path_str);
                                if let Err(e) = loaded_dict.load_wordlist_file(path, &root_path) {
                                    warn!(path = path_str, "Could not load wordlist: {e}");
                                }
                            }
                            info!(
                                words = loaded_dict.len(),
                                bundled = load_bundled,
                                disabled = ?disabled_sets,
                                extra_paths = wordlist_paths.len(),
                                "Dictionary loaded"
                            );
                            if config.morphology.inflections {
                                loaded_dict.derive_inflections();
                            }
                            *dictionary_arc.lock().await = loaded_dict;
                        }
                        Err(e) => {
                            warn!("Could not load dictionary: {e}");
                        }
                    }
                    // The VS Code global acts as a fallback when the workspace config
                    // doesn't set it, mirroring workspace.index_on_open.
                    *morphology_arc.lock().await = config
                        .morphology
                        .enabled
                        .then(|| AffixAnalyzer::new(&config.engines.spell_language));

                    let names_enabled = config.names.enabled || req.detect_names.unwrap_or(false);
                    *name_filter_arc.lock().await = names_enabled.then(|| {
                        info!(
                            aggressiveness = ?config.names.aggressiveness,
                            language = config.engines.spell_language,
                            "Name detection enabled"
                        );
                        NameFilter::new(config.names.aggressiveness, &config.engines.spell_language)
                    });

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

                            let db_path = req
                                .db_path
                                .as_deref()
                                .filter(|p| !p.is_empty())
                                .or(config.workspace.db_path.as_deref())
                                .map(PathBuf::from);
                            match WorkspaceIndex::new(&root_path, db_path.as_deref()) {
                                Ok(index) => {
                                    let mut idx_lock = workspace_index_arc.lock().await;
                                    *idx_lock = Some(index);
                                    let should_index = config.workspace.index_on_open
                                        || req.index_on_open.unwrap_or(false);
                                    if should_index {
                                        info!(
                                            "Workspace indexing enabled — starting background index"
                                        );
                                        indexing_notify.notify_one();
                                    } else {
                                        debug!(
                                            "Workspace indexing disabled (workspace.index_on_open = false)"
                                        );
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
                Some(checker::request::Payload::CheckProse(req)) => 'check: {
                    let canonical_lang =
                        lang_check::languages::resolve_language_id(&req.language_id);
                    let file_path = req.file_path.as_deref().map(Path::new);

                    // `include` and `exclude` are a statement about which
                    // files this project checks, so they have to hold wherever
                    // a check is asked for. They governed the background
                    // indexer alone, which meant a file in `node_modules/**`
                    // was skipped by the indexer and checked the moment
                    // someone opened it.
                    if let Some(path) = file_path {
                        let skipped = {
                            let cfg = config_arc.lock().await;
                            let root = workspace_root_arc.lock().await;
                            root.as_ref().is_some_and(|root| !cfg.checks(path, root))
                        };
                        if skipped {
                            debug!(id = request_id, file = ?path, "CheckProse: not selected by config");
                            break 'check Some(response::Payload::CheckProse(
                                CheckResponse::default(),
                            ));
                        }
                    }

                    debug!(
                        id = request_id,
                        language = canonical_lang,
                        file = ?file_path,
                        text_len = req.text.len(),
                        "CheckProse: starting extraction"
                    );
                    let (extraction, spell_language, max_range_bytes) = {
                        let schema_registry = schema_registry_arc.lock().await;
                        let cfg = config_arc.lock().await;
                        let latex_extras = prose::latex::LatexExtras {
                            skip_envs: &cfg.languages.latex.skip_environments,
                            skip_commands: &cfg.languages.latex.skip_commands,
                        };
                        let extraction = prose::extract_with_range_limit(
                            &req.text,
                            canonical_lang,
                            file_path,
                            Some(&schema_registry),
                            &latex_extras,
                            cfg.performance.max_range_bytes,
                        );
                        (
                            extraction,
                            cfg.engines.spell_language.clone(),
                            cfg.performance.max_range_bytes,
                        )
                    };

                    match extraction {
                        Ok(prose::Extraction { ranges, syntax }) => {
                            debug!(
                                id = request_id,
                                ranges = ranges.len(),
                                syntax,
                                "CheckProse: extraction complete, checking ranges"
                            );

                            // Built before the check so the inspector reports the
                            // language each range was actually sent in, not the
                            // document default it might have fallen back to.
                            let units = prose::range_units(&ranges, &req.text, &spell_language);
                            let mut extraction_info = ExtractionInfo {
                                prose_ranges: ranges
                                    .iter()
                                    .zip(&units)
                                    .map(|(r, unit)| ExtractionProseRange {
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
                                        language: unit.language.clone(),
                                    })
                                    .collect(),
                                names: Vec::new(),
                                syntax,
                                max_range_bytes: max_range_bytes as u32,
                            };

                            let mut all_diagnostics = Vec::new();
                            let mut detected_names: Vec<checker::NameSpan> = Vec::new();
                            let check_start = std::time::Instant::now();

                            // What this check depends on, computed once and used
                            // both to look the answer up and to store it.
                            let fingerprint = {
                                let cfg = config_arc.lock().await;
                                let dict = dictionary_arc.lock().await;
                                let ignores = ignore_store_arc.lock().await;
                                workspace::check_fingerprint(
                                    &req.text,
                                    &cfg,
                                    &dict,
                                    &ignores,
                                    name_filter_arc.lock().await.is_some(),
                                    schema_registry_arc.lock().await.fingerprint(),
                                )
                            };

                            // The extraction above still ran, and has to: it is
                            // a few milliseconds, the inspector reports it, and
                            // the insights are computed from it. What a stored
                            // result saves is the engines, which is where a
                            // check's time actually goes -- for LanguageTool, a
                            // network round trip per range.
                            let cached = match req.file_path.as_deref() {
                                Some(path) => workspace_index_arc
                                    .lock()
                                    .await
                                    .as_ref()
                                    .and_then(|idx| idx.cached_check(path, fingerprint)),
                                None => None,
                            };

                            let served_from_cache = cached.is_some();
                            if let Some(stored) = cached {
                                debug!(
                                    id = request_id,
                                    diagnostics = stored.len(),
                                    "CheckProse: served from the stored result"
                                );
                                all_diagnostics = stored;
                            } else {
                                // One batch, one lock: the engines decide internally
                                // how much of it to run concurrently.
                                let batch = {
                                    let mut orchestrator = orchestrator_arc.lock().await;
                                    orchestrator
                                        .check_units_in(
                                            &units,
                                            &lang_check::orchestrator::CheckContext::for_path(
                                                file_path,
                                            ),
                                        )
                                        .await
                                };
                                debug!(
                                    id = request_id,
                                    ranges = ranges.len(),
                                    elapsed_ms = check_start.elapsed().as_millis() as u64,
                                    "CheckProse: engines done"
                                );

                                let batch = batch.unwrap_or_else(|e| {
                                    warn!(id = request_id, "CheckProse: batch failed: {e}");
                                    Vec::new()
                                });
                                for (range, mut diagnostics) in ranges.iter().zip(batch) {
                                    // Offsets become document-level here, which
                                    // is what both the cache and the
                                    // suppression pass below expect.
                                    range.adopt_diagnostics(&req.text, &mut diagnostics);
                                    // And an unchecked-language report moves
                                    // onto whatever declared the language,
                                    // which the orchestrator cannot see.
                                    prose::place_language_reports(range, &mut diagnostics);
                                    all_diagnostics.extend(diagnostics);
                                }
                                debug!(
                                    id = request_id,
                                    elapsed_ms = check_start.elapsed().as_millis() as u64,
                                    ranges = ranges.len(),
                                    diagnostics = all_diagnostics.len(),
                                    "CheckProse complete"
                                );
                            }

                            // An answer produced while an engine was failing is
                            // an incomplete answer, and storing it would serve
                            // it back for as long as the document and config
                            // stay the same -- so a LanguageTool that came back
                            // up would never contribute again, and its failures
                            // would never escalate either, because the engines
                            // stop being asked once there is something to serve.
                            let engines_healthy = orchestrator_arc
                                .lock()
                                .await
                                .engine_health_report()
                                .iter()
                                .all(|health| health.consecutive_failures == 0);

                            // Stored before the suppression pass, and only
                            // when the answer was freshly computed.
                            //
                            // What goes in is what the engines said, not what
                            // survives the dictionary and the ignore store.
                            // Those are filters applied afterwards, so keeping
                            // their output would mean a word added to the
                            // dictionary invalidated every stored result --
                            // re-running the engines, a LanguageTool round trip
                            // per prose range, to reach the answer already held
                            // and discard one more of it.
                            if engines_healthy
                                && !served_from_cache
                                && let Some(idx) = &*workspace_index_arc.lock().await
                                && let Some(file_path) = req.file_path.clone()
                            {
                                let insights = ProseInsights::analyze_ranges(&req.text, &ranges);
                                idx.store_check(&file_path, fingerprint, &all_diagnostics)
                                    .unwrap_or_else(|e| {
                                        warn!(file = file_path, "Error updating diagnostics: {e}");
                                    });
                                idx.update_insights(&file_path, &insights)
                                    .unwrap_or_else(|e| {
                                        warn!(file = file_path, "Error updating insights: {e}");
                                    });
                            }

                            // One suppression pass, whichever path produced the
                            // diagnostics. A stored result has to be filtered
                            // too, or the dictionary would apply to a fresh
                            // check and not to a reused one.
                            {
                                let directives = InlineDirectives::parse(&req.text);
                                let ignore_store = ignore_store_arc.lock().await;
                                let dict = dictionary_arc.lock().await;
                                let morphology = morphology_arc.lock().await;
                                let name_filter = name_filter_arc.lock().await;
                                let mut ctx = SuppressionContext::new()
                                    .with_ignore(&ignore_store)
                                    .with_dictionary(&dict)
                                    .with_directives(&directives);
                                if let Some(analyzer) = morphology.as_ref() {
                                    ctx = ctx.with_morphology(analyzer);
                                }
                                if let Some(filter) = name_filter.as_ref() {
                                    ctx = ctx.with_names(filter);
                                }
                                detected_names.extend(
                                    retain_visible(&mut all_diagnostics, &req.text, &ctx)
                                        .into_iter()
                                        .map(|n| checker::NameSpan {
                                            start_byte: n.start_byte,
                                            end_byte: n.end_byte,
                                            confidence: n.confidence,
                                            signals: n.signals,
                                        }),
                                );
                            }
                            let engine_health =
                                orchestrator_arc.lock().await.engine_health_report();

                            extraction_info.names = detected_names;
                            Some(response::Payload::CheckProse(CheckResponse {
                                served_from_cache,
                                diagnostics: all_diagnostics,
                                extraction: Some(extraction_info),
                                engine_health,
                            }))
                        }
                        Err(e) => Some(response::Payload::Error(ErrorResponse {
                            message: format!("Extraction error: {e}"),
                        })),
                    }
                }
                Some(checker::request::Payload::GetMetadata(_)) => {
                    let cfg = config_arc.lock().await;
                    let schema_extensions = schema_registry_arc.lock().await.fallback_extensions();
                    Some(response::Payload::GetMetadata(MetadataResponse {
                        schema_extensions,
                        name: "Rust Core".to_string(),
                        version: "0.1.0".to_string(),
                        supported_languages: lang_check::languages::SUPPORTED_LANGUAGE_IDS
                            .iter()
                            .map(|s| (*s).to_string())
                            .collect(),
                        spell_language: cfg.engines.spell_language.clone(),
                    }))
                }
                Some(checker::request::Payload::ProbeConfig(req)) => {
                    // The buffer on screen, not the file on disk. The editor
                    // asks about text that may never have been saved, which
                    // is the point: the answer has to arrive while the URL is
                    // still being typed, not after the mistake is committed.
                    let root = workspace_root_arc
                        .lock()
                        .await
                        .clone()
                        .unwrap_or_else(|| PathBuf::from("."));
                    let root = req
                        .file_path
                        .as_deref()
                        .and_then(|p| Path::new(p).parent().map(Path::to_path_buf))
                        .unwrap_or(root);

                    let parsed = if req.text.is_empty() {
                        Config::load(&root).map_err(|e| e.to_string())
                    } else {
                        Config::parse_text(&req.text, &root, &req.format).map_err(|e| e.to_string())
                    };

                    match parsed {
                        Ok(config) => {
                            let probes = lang_check::config_probe::probe_config(&config, &root)
                                .await
                                .into_iter()
                                .map(lang_check::config_probe::Probe::into_wire)
                                .collect::<Vec<_>>();
                            // Unknown keys reached only the log before this,
                            // where nothing could draw them: serde drops what
                            // it does not recognise without a word, so a typo'd
                            // key looked exactly like a setting that had no
                            // effect.
                            let issues = Config::unknown_key_paths(&req.text)
                                .into_iter()
                                .map(|key| ConfigIssue {
                                    message: format!(
                                        "\"{}\" is not a setting this reads, so it has no \
                                         effect.",
                                        key.rsplit('.').next().unwrap_or(&key)
                                    ),
                                    key,
                                    severity: checker::Severity::Warning as i32,
                                })
                                .collect::<Vec<_>>();
                            debug!(
                                id = request_id,
                                probes = probes.len(),
                                issues = issues.len(),
                                "ProbeConfig: answered"
                            );
                            Some(response::Payload::ProbeConfig(ProbeConfigResponse {
                                probes,
                                issues,
                                parse_error: String::new(),
                            }))
                        }
                        // A config that does not parse is not an RPC failure:
                        // it is the ordinary state of a file being edited, and
                        // the editor draws it as one message rather than as a
                        // broken connection.
                        Err(message) => Some(response::Payload::ProbeConfig(ProbeConfigResponse {
                            probes: Vec::new(),
                            issues: Vec::new(),
                            parse_error: message,
                        })),
                    }
                }
                Some(checker::request::Payload::Ignore(req)) => {
                    debug!(id = request_id, "Ignore: adding fingerprint");
                    let mut ignore_store = ignore_store_arc.lock().await;
                    let fingerprint = if req.text.is_empty() {
                        DiagnosticFingerprint::new(&req.message, &req.context, 0, req.context.len())
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
            debug!(
                id = request_id,
                kind = payload_kind,
                elapsed_ms = elapsed,
                "Response ready"
            );

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
