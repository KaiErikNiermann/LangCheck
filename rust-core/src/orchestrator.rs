use crate::cache::ResultCache;
use crate::checker::{Diagnostic, EngineHealth, Severity};
use crate::config::Config;
use crate::engines::hunspell::HunspellEngine;
use crate::engines::{
    Engine, ExternalEngine, HarperEngine, LanguageToolEngine, ProselintEngine, ValeEngine,
    WasmEngine, engine_handles_extension, engine_supports_language, is_unsupported_language,
};
use crate::packs::PackRegistry;
use crate::prose::ProseUnit;
use crate::rules::RuleNormalizer;
use anyhow::Result;
use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tracing::{debug, warn};

/// What the engines are told about the document a check came from.
///
/// Separate from [`ProseUnit`], which describes one range: an extension is a
/// fact about the file, and every range in it shares one.
#[derive(Debug, Clone, Default)]
pub struct CheckContext {
    /// The document's file extension, without the dot.
    pub extension: Option<String>,
}

impl CheckContext {
    /// The context for a document at `path`.
    #[must_use]
    pub fn for_path(path: Option<&std::path::Path>) -> Self {
        Self {
            extension: path
                .and_then(std::path::Path::extension)
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase),
        }
    }
}

#[derive(Default)]
struct EngineHealthTracker {
    consecutive_failures: u32,
    last_error: Option<String>,
    last_success: Option<Instant>,
    last_success_epoch_ms: u64,
}

pub struct Orchestrator {
    engines: Vec<Box<dyn Engine + Send>>,
    normalizer: RuleNormalizer,
    config: Config,
    engine_health: HashMap<String, EngineHealthTracker>,
    results: ResultCache,
}

impl Orchestrator {
    #[must_use]
    pub fn new(config: Config) -> Self {
        let mut orchestrator = Self {
            engines: Vec::new(),
            normalizer: RuleNormalizer::new(),
            results: ResultCache::new(config.performance.result_cache_entries),
            config,
            engine_health: HashMap::new(),
        };

        orchestrator.initialize_engines();
        orchestrator
    }

    fn initialize_engines(&mut self) {
        self.engines.clear();
        let hpm = self.config.performance.high_performance_mode;

        if self.config.engines.harper.enabled {
            self.engines
                .push(Box::new(HarperEngine::new(&self.config.engines.harper)));
        }

        // In HPM, skip LanguageTool and external providers for speed
        if !hpm {
            if self.config.engines.languagetool.enabled {
                self.engines.push(Box::new(LanguageToolEngine::new(
                    &self.config.engines.languagetool,
                )));
            }

            if self.config.engines.vale.enabled {
                self.engines.push(Box::new(ValeEngine::new(
                    self.config.engines.vale.config.clone(),
                )));
            }

            if self.config.engines.proselint.enabled {
                self.engines.push(Box::new(ProselintEngine::new(
                    self.config.engines.proselint.config.clone(),
                )));
            }

            if self.config.engines.hunspell.enabled {
                let hunspell = &self.config.engines.hunspell;
                let mut registry = PackRegistry::new();
                for dir in &hunspell.search_paths {
                    registry = registry.with_search_path(dir);
                }
                for (language, path) in &hunspell.dictionary_paths {
                    registry = registry.with_override(language, path);
                }
                self.engines.push(Box::new(HunspellEngine::new(
                    registry,
                    hunspell.languages.clone(),
                )));
            }

            for provider in &self.config.engines.external {
                self.engines.push(Box::new(ExternalEngine::new(
                    provider.name.clone(),
                    provider.command.clone(),
                    provider.args.clone(),
                    provider.extensions.clone(),
                    provider.languages.clone(),
                )));
            }

            for wasm_plugin in &self.config.engines.wasm_plugins {
                match WasmEngine::new(
                    wasm_plugin.name.clone(),
                    std::path::PathBuf::from(&wasm_plugin.path),
                    wasm_plugin.extensions.clone(),
                    wasm_plugin.languages.clone(),
                ) {
                    Ok(engine) => self.engines.push(Box::new(engine)),
                    Err(e) => warn!(
                        plugin = %wasm_plugin.name,
                        path = %wasm_plugin.path,
                        "Failed to load WASM plugin: {e}"
                    ),
                }
            }
        }
    }

    pub fn update_config(&mut self, config: Config) {
        // Every cached answer was produced by the engines that are about to be
        // rebuilt, under settings that may have just changed.
        self.results = ResultCache::new(config.performance.result_cache_entries);
        self.config = config;
        self.initialize_engines();
        // Preserve health state across config changes — don't clear engine_health
    }

    #[must_use]
    pub const fn get_config(&self) -> &Config {
        &self.config
    }

    /// Returns health status for each engine that has been tracked.
    #[must_use]
    pub fn engine_health_report(&self) -> Vec<EngineHealth> {
        self.engine_health
            .iter()
            .map(|(name, tracker)| {
                let status = if tracker.consecutive_failures == 0 {
                    "ok"
                } else if tracker.consecutive_failures <= 2 {
                    "degraded"
                } else {
                    "down"
                };
                EngineHealth {
                    name: name.clone(),
                    status: status.to_string(),
                    consecutive_failures: tracker.consecutive_failures,
                    last_error: tracker.last_error.clone().unwrap_or_default(),
                    last_success_epoch_ms: tracker.last_success_epoch_ms,
                }
            })
            .collect()
    }

    /// Check a single text. Thin wrapper over [`Self::check_batch`].
    pub async fn check(&mut self, text: &str, language: &str) -> Result<Vec<Diagnostic>> {
        let texts = [text.to_string()];
        let mut batch = self.check_batch(&texts, language).await?;
        Ok(batch.pop().unwrap_or_default())
    }

    /// What the engines need to know about the document, as opposed to about
    /// one range of it.
    ///
    /// Only the extension so far. A provider that declares which markup it
    /// parses has to be told what it is being handed, and a prose range on its
    /// own does not say.
    ///
    /// Check one document's prose, each range in the language it is written in.
    ///
    /// A document is not always in one language — a French thesis quoting
    /// English, a German paper with an English abstract — and the engines have
    /// to be told which, or `LanguageTool` reports every correctly spelled word
    /// as a misspelling. Ranges are grouped by language and each group checked
    /// on its own, so a group still batches.
    pub async fn check_units(&mut self, units: &[ProseUnit]) -> Result<Vec<Vec<Diagnostic>>> {
        self.check_units_in(units, &CheckContext::default()).await
    }

    /// [`Self::check_units`], told what document the prose came from.
    pub async fn check_units_in(
        &mut self,
        units: &[ProseUnit],
        context: &CheckContext,
    ) -> Result<Vec<Vec<Diagnostic>>> {
        // First-seen order, so a single-language document keeps its one batch
        // and the common case is unchanged.
        let mut groups: Vec<(&str, Vec<usize>)> = Vec::new();
        for (idx, unit) in units.iter().enumerate() {
            match groups.iter_mut().find(|(lang, _)| *lang == unit.language) {
                Some((_, slots)) => slots.push(idx),
                None => groups.push((&unit.language, vec![idx])),
            }
        }

        let mut out: Vec<Vec<Diagnostic>> = vec![Vec::new(); units.len()];
        for (language, slots) in groups {
            let texts: Vec<String> = slots.iter().map(|&i| units[i].text.clone()).collect();
            let checked = self.check_batch_in(&texts, language, context).await?;
            for (&slot, diagnostics) in slots.iter().zip(checked) {
                out[slot] = diagnostics;
            }
        }
        Ok(out)
    }

    /// Check independent texts, all in `language`, returning one diagnostic
    /// list per input, in order.
    ///
    /// Batching exists so latency-bound engines can overlap their work: checking
    /// range-by-range turns a page of prose into hundreds of serial round trips.
    /// Engines still run one after another — most hold mutable state — but each
    /// sees the whole batch and decides its own concurrency (see
    /// [`Engine::check_many`]).
    #[allow(clippy::too_many_lines)]
    pub async fn check_batch(
        &mut self,
        texts: &[String],
        language: &str,
    ) -> Result<Vec<Vec<Diagnostic>>> {
        self.check_batch_in(texts, language, &CheckContext::default())
            .await
    }

    /// [`Self::check_batch`], told what document the prose came from.
    #[allow(clippy::too_many_lines)]
    pub async fn check_batch_in(
        &mut self,
        texts: &[String],
        language: &str,
        context: &CheckContext,
    ) -> Result<Vec<Vec<Diagnostic>>> {
        // Texts over max_file_size are skipped, but keep their slot so the
        // caller's results still line up one-to-one with its inputs.
        let max = self.config.performance.max_file_size;
        let skipped: Vec<bool> = texts.iter().map(|t| max > 0 && t.len() > max).collect();
        let subset: Option<Vec<String>> = skipped.iter().any(|&s| s).then(|| {
            texts
                .iter()
                .zip(&skipped)
                .filter(|&(_, &s)| !s)
                .map(|(t, _)| t.clone())
                .collect()
        });
        let batch: &[String] = subset.as_deref().unwrap_or(texts);

        let spell_language = language.to_string();
        let mut per_text: Vec<Vec<Diagnostic>> = vec![Vec::new(); batch.len()];
        let mut engines_ran = 0u32;
        // Engines that ran and failed outright, with why. A failure that only
        // reaches the log leaves the prose looking checked and clean, which is
        // the worst of the three possible answers.
        let mut engine_failures: Vec<String> = Vec::new();
        // Decided once: whether this language is one a pack can be fetched for.
        let installable = crate::packs::catalogue::find(&spell_language).is_some();

        for engine in &mut self.engines {
            let engine_name = engine.name();

            // Skip engines that don't support the configured language
            if !engine_supports_language(engine.as_ref(), &spell_language) {
                continue;
            }

            // And ones that parse a markup this document is not written in.
            // Declining on either axis is declining, not failing: the engine
            // has nothing to say here, which is what no-provider reports.
            if !engine_handles_extension(engine.as_ref(), context.extension.as_deref()) {
                continue;
            }

            // Serve what this engine has already answered for and ask only for
            // the rest. On a keystroke that is one range out of a hundred.
            let mut results: Vec<Option<Result<Vec<Diagnostic>>>> = Vec::with_capacity(batch.len());
            let mut misses: Vec<String> = Vec::new();
            let mut miss_slots: Vec<usize> = Vec::new();
            for (slot, text) in batch.iter().enumerate() {
                let cached = self.results.get(engine_name, &spell_language, text);
                if cached.is_none() {
                    miss_slots.push(slot);
                    misses.push(text.clone());
                }
                results.push(cached.map(Ok));
            }
            let hits = batch.len() - misses.len();

            let fresh = if misses.is_empty() {
                Vec::new()
            } else {
                engine.check_many(&misses, &spell_language).await
            };
            for (&slot, result) in miss_slots.iter().zip(fresh) {
                if let Ok(ref diagnostics) = result {
                    self.results.put(
                        engine_name,
                        &spell_language,
                        &batch[slot],
                        diagnostics.clone(),
                    );
                }
                results[slot] = Some(result);
            }
            let results: Vec<Result<Vec<Diagnostic>>> = results
                .into_iter()
                .map(|slot| slot.unwrap_or_else(|| Ok(Vec::new())))
                .collect();

            // An engine that has no dictionary for this language has not run,
            // has not failed, and must not count towards either. LanguageTool
            // answers 400 for a language it was never built with -- Hebrew, for
            // one -- and reading that as a failure reports a healthy server as
            // unreachable.
            if !results.is_empty() && results.iter().all(is_unsupported_language) {
                debug!(
                    engine = engine_name,
                    language = %spell_language,
                    "Engine cannot check this language"
                );
                continue;
            }
            engines_ran += 1;

            debug!(
                engine = engine_name,
                hits,
                misses = miss_slots.len(),
                "Result cache"
            );

            // A batch is healthy if the engine answered at all: one bad text
            // among hundreds says nothing about reachability, whereas a down
            // server fails every one of them. A partial failure still costs the
            // user diagnostics on those texts, so say so rather than only
            // flipping health when everything breaks.
            //
            // A batch served entirely from cache says nothing either way, so it
            // leaves health alone rather than reporting a server it never
            // reached as reachable.
            if misses.is_empty() {
                adopt_results(&self.normalizer, &self.config, &mut per_text, results);
                continue;
            }

            let first_error = results.iter().find_map(|r| r.as_ref().err());
            let failed = results.iter().filter(|r| r.is_err()).count();
            if failed > 0 && failed < results.len() {
                warn!(
                    engine = engine_name,
                    failed,
                    total = results.len(),
                    "Some texts went unchecked; their diagnostics are missing"
                );
            }
            let tracker = self
                .engine_health
                .entry(engine_name.to_string())
                .or_default();
            match first_error {
                Some(e) if failed == results.len() => {
                    tracker.consecutive_failures += 1;
                    tracker.last_error = Some(e.to_string());
                    warn!(engine = engine_name, "Engine error: {e}");
                    engine_failures.push(format!("{engine_name}: {e}"));
                }
                _ => {
                    tracker.consecutive_failures = 0;
                    tracker.last_error = None;
                    tracker.last_success = Some(Instant::now());
                    #[allow(clippy::cast_possible_truncation)]
                    {
                        tracker.last_success_epoch_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis()
                            as u64;
                    }
                }
            }

            adopt_results(&self.normalizer, &self.config, &mut per_text, results);
        }

        for all_diagnostics in &mut per_text {
            // Say so when nothing could read this language, rather than
            // leaving prose that was never checked looking clean. Covers both
            // an engine that declines the language up front (Harper outside
            // English) and one that declines it on the wire (LanguageTool
            // without the language module).
            if engines_ran == 0 && all_diagnostics.is_empty() {
                all_diagnostics.push(Diagnostic {
                    start_byte: 0,
                    end_byte: 0,
                    message: format!(
                        "No enabled engine reads \"{spell_language}\", \
                         so this passage went unchecked."
                    ),
                    suggestions: Vec::new(),
                    rule_id: "languagecheck.no-provider".to_string(),
                    severity: Severity::Information as i32,
                    unified_id: "languagecheck.no-provider".to_string(),
                    confidence: 1.0,
                    // Carried rather than left for the editor to recover from
                    // the message: a tag parsed out of prose is exactly where a
                    // spurious install prompt would come from.
                    language: spell_language.clone(),
                    pack_installable: installable,
                });
            } else if !engine_failures.is_empty() && all_diagnostics.is_empty() {
                // Every engine that took this on failed. Without this the
                // passage reads as clean and the reason is a line in a log the
                // user has no reason to open -- a broken dictionary would
                // silently stop checking a language and look like success.
                all_diagnostics.push(Diagnostic {
                    start_byte: 0,
                    end_byte: 0,
                    message: format!(
                        "This passage went unchecked: {}",
                        engine_failures.join("; ")
                    ),
                    suggestions: Vec::new(),
                    rule_id: "languagecheck.engine-error".to_string(),
                    severity: Severity::Warning as i32,
                    unified_id: "languagecheck.engine-error".to_string(),
                    confidence: 1.0,
                    language: spell_language.clone(),
                    // A pack that is present and broken is not fixed by
                    // fetching it again, so nothing is offered.
                    pack_installable: false,
                });
            }
            *all_diagnostics = merge_duplicates(std::mem::take(all_diagnostics));
        }

        if subset.is_none() {
            return Ok(per_text);
        }
        // Re-expand: skipped texts get an empty result in their original slot.
        let mut checked = per_text.into_iter();
        Ok(skipped
            .into_iter()
            .map(|s| {
                if s {
                    Vec::new()
                } else {
                    checked.next().unwrap_or_default()
                }
            })
            .collect())
    }
}

/// How severe a severity is, which is not the order the numbers are in.
///
/// `SEVERITY_HINT` is 4 and the *least* severe of the four, so comparing the
/// raw values makes a hint outrank an error.
const fn severity_rank(severity: i32) -> u8 {
    match severity {
        3 => 3, // error
        2 => 2, // warning
        1 => 1, // information
        _ => 0, // hint, and anything unrecognised
    }
}

/// Fold diagnostics that several engines reported for the same thing into one.
///
/// Two engines agreeing is the common case for spelling -- Harper, Hunspell
/// and `LanguageTool` all normalise a misspelling to `spelling.typo` -- and
/// what used to happen was that the later ones were dropped outright. Dropping
/// lost three things: the higher severity (`LanguageTool` calls a misspelling
/// an error, Harper a warning, and Harper registers first, so the error went),
/// every suggestion the loser had, and any severity override keyed on the
/// loser's native rule id.
///
/// Identity is still the exact `(start, end, unified_id)` triple. Engines
/// tokenise independently, so spans that differ by a byte are left as separate
/// diagnostics rather than guessed at.
fn merge_duplicates(diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    let mut merged: Vec<Diagnostic> = Vec::with_capacity(diagnostics.len());
    // One list of suggestions per contributing engine, per surviving slot.
    let mut contributions: Vec<Vec<Vec<String>>> = Vec::new();
    let mut index: HashMap<(u32, u32, String), usize> = HashMap::new();

    for mut diagnostic in diagnostics {
        let key = (
            diagnostic.start_byte,
            diagnostic.end_byte,
            diagnostic.unified_id.clone(),
        );
        let suggestions = std::mem::take(&mut diagnostic.suggestions);
        if let Some(&slot) = index.get(&key) {
            if severity_rank(diagnostic.severity) > severity_rank(merged[slot].severity) {
                merged[slot].severity = diagnostic.severity;
            }
            contributions[slot].push(suggestions);
        } else {
            index.insert(key, merged.len());
            merged.push(diagnostic);
            contributions.push(vec![suggestions]);
        }
    }

    for (slot, from_each_engine) in merged.iter_mut().zip(contributions) {
        slot.suggestions = interleave_suggestions(&from_each_engine);
    }
    merged
}

/// Take one suggestion from each engine in turn, best first.
///
/// Concatenating instead would be worse than dropping: `LanguageTool` alone
/// answers a French misspelling with eighty replacements, which would bury
/// every other engine's first guess under one engine's tail -- and the tail is
/// what fills a nine-slot `SpeedFix` panel or pushes "add to dictionary" off the
/// bottom of the lightbulb. Round-robin puts each engine's best pick at the
/// top and keeps each engine's own ranking within its own picks.
fn interleave_suggestions(from_each_engine: &[Vec<String>]) -> Vec<String> {
    let deepest = from_each_engine.iter().map(Vec::len).max().unwrap_or(0);
    let mut out = Vec::new();
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for round in 0..deepest {
        for engine in from_each_engine {
            if let Some(suggestion) = engine.get(round)
                && seen.insert(suggestion.as_str())
            {
                out.push(suggestion.clone());
            }
        }
    }
    out
}

/// Normalise each engine answer and fold it into the per-text results.
///
/// A free function because the caller holds `&mut self.engines` for the length
/// of the engine loop, so a method on `self` would not borrow-check; it needs
/// the normaliser and the config, which are disjoint fields.
fn adopt_results(
    normalizer: &RuleNormalizer,
    config: &Config,
    per_text: &mut [Vec<Diagnostic>],
    results: Vec<Result<Vec<Diagnostic>>>,
) {
    for (slot, result) in per_text.iter_mut().zip(results) {
        let Ok(mut diagnostics) = result else {
            continue;
        };

        for d in &mut diagnostics {
            let provider = if d.rule_id.starts_with("harper") {
                "harper"
            } else if d.rule_id.starts_with("hunspell.") {
                "hunspell"
            } else if d.rule_id.starts_with("vale.") {
                "vale"
            } else if d.rule_id.starts_with("proselint.") {
                "proselint"
            } else if d.rule_id.starts_with("wasm.") {
                "wasm"
            } else if d.rule_id.starts_with("external.") {
                "external"
            } else {
                "languagetool"
            };
            d.unified_id = normalizer.normalize(provider, &d.rule_id);

            // Apply rule severity overrides from config.
            if let Some(severity) = rule_override_severity(config, &d.rule_id, &d.unified_id) {
                d.severity = severity;
            }
        }

        diagnostics.retain(|d| d.severity != -1);
        slot.extend(diagnostics);
    }
}

/// Resolve a configured severity override for a diagnostic.
///
/// Overrides may be keyed by the **native** rule id shown on the diagnostic
/// (e.g. `languagetool.ARROWS`, what the "Deactivate rule" action writes) or by
/// the **unified** category id (e.g. `typography.capitalization`). The native id
/// is matched first. Returns the new severity (`-1` marks the diagnostic for
/// removal), or `None` when there is no applicable override.
fn rule_override_severity(config: &Config, rule_id: &str, unified_id: &str) -> Option<i32> {
    let rule_config = config
        .rules
        .get(rule_id)
        .or_else(|| config.rules.get(unified_id))?;
    let severity = rule_config.severity.as_ref()?;
    match severity.to_lowercase().as_str() {
        "error" => Some(Severity::Error as i32),
        "warning" => Some(Severity::Warning as i32),
        "info" => Some(Severity::Information as i32),
        "hint" => Some(Severity::Hint as i32),
        "off" => Some(-1),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::config::RuleConfig;

    fn config_with_rule(key: &str, severity: &str) -> Config {
        let mut config = Config::default();
        config.rules.insert(
            key.to_string(),
            RuleConfig {
                severity: Some(severity.to_string()),
            },
        );
        config
    }

    #[test]
    fn override_matches_native_rule_id() {
        // The user keys the override by the native id (what diagnostics show).
        let config = config_with_rule("languagetool.ARROWS", "off");
        assert_eq!(
            rule_override_severity(&config, "languagetool.ARROWS", "style.unknown"),
            Some(-1)
        );
    }

    #[test]
    fn override_matches_unified_id() {
        let config = config_with_rule("typography.capitalization", "off");
        assert_eq!(
            rule_override_severity(
                &config,
                "languagetool.UPPERCASE_SENTENCE_START",
                "typography.capitalization"
            ),
            Some(-1)
        );
    }

    #[test]
    fn override_absent_returns_none() {
        let config = config_with_rule("languagetool.OTHER", "off");
        assert_eq!(
            rule_override_severity(&config, "languagetool.ARROWS", "style.unknown"),
            None
        );
    }

    #[test]
    fn override_maps_named_severities() {
        let config = config_with_rule("languagetool.ARROWS", "Error");
        assert_eq!(
            rule_override_severity(&config, "languagetool.ARROWS", "x"),
            Some(Severity::Error as i32)
        );
    }

    /// Reports one diagnostic per text, carrying that text as its message, so a
    /// batch's results can be matched back to the inputs that produced them.
    struct EchoEngine;

    #[async_trait::async_trait]
    impl Engine for EchoEngine {
        fn name(&self) -> &'static str {
            "external"
        }

        async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
            Ok(vec![Diagnostic {
                start_byte: 0,
                end_byte: 0,
                message: text.to_string(),
                suggestions: Vec::new(),
                rule_id: "external.echo".to_string(),
                severity: Severity::Warning as i32,
                unified_id: String::new(),
                confidence: 1.0,
                language: String::new(),
                pack_installable: false,
            }])
        }
    }

    /// Echoes each text and counts how many reached it, so a test can tell a
    /// cache hit from a re-check.
    #[derive(Default)]
    struct CountingEngine {
        seen: Arc<AtomicUsize>,
    }

    #[async_trait::async_trait]
    impl Engine for CountingEngine {
        fn name(&self) -> &'static str {
            "external"
        }

        async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
            self.seen.fetch_add(1, Ordering::SeqCst);
            Ok(vec![Diagnostic {
                start_byte: 0,
                end_byte: 0,
                message: text.to_string(),
                suggestions: Vec::new(),
                rule_id: "external.echo".to_string(),
                severity: Severity::Warning as i32,
                unified_id: String::new(),
                confidence: 1.0,
                language: String::new(),
                pack_installable: false,
            }])
        }
    }

    fn orchestrator_with_echo(config: Config) -> Orchestrator {
        let mut orchestrator = Orchestrator::new(config);
        orchestrator.engines = vec![Box::new(EchoEngine)];
        orchestrator
    }

    fn messages(batch: &[Vec<Diagnostic>]) -> Vec<Option<&str>> {
        batch
            .iter()
            .map(|d| d.first().map(|d| d.message.as_str()))
            .collect()
    }

    #[tokio::test]
    async fn check_batch_returns_one_result_per_text_in_order() {
        let mut orchestrator = orchestrator_with_echo(Config::default());
        let texts = ["alpha".to_string(), "beta".to_string(), "gamma".to_string()];
        let batch = orchestrator.check_batch(&texts, "en-US").await.unwrap();

        assert_eq!(
            messages(&batch),
            vec![Some("alpha"), Some("beta"), Some("gamma")]
        );
    }

    #[tokio::test]
    async fn check_batch_keeps_a_slot_for_oversized_texts() {
        // Callers zip results against their ranges, so a text skipped for size
        // must still occupy its position rather than shift everything after it.
        let mut config = Config::default();
        config.performance.max_file_size = 5;
        let mut orchestrator = orchestrator_with_echo(config);
        let texts = [
            "ok".to_string(),
            "far too long".to_string(),
            "fine".to_string(),
        ];
        let batch = orchestrator.check_batch(&texts, "en-US").await.unwrap();

        assert_eq!(messages(&batch), vec![Some("ok"), None, Some("fine")]);
    }

    #[tokio::test]
    async fn check_is_the_single_text_case_of_check_batch() {
        let mut orchestrator = orchestrator_with_echo(Config::default());
        let diagnostics = orchestrator.check("solo", "en-US").await.unwrap();

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "solo");
    }

    #[tokio::test]
    async fn check_batch_marks_an_engine_healthy_when_it_answers() {
        let mut orchestrator = orchestrator_with_echo(Config::default());
        let texts = ["one".to_string(), "two".to_string()];
        orchestrator.check_batch(&texts, "en-US").await.unwrap();

        let health = orchestrator.engine_health_report();
        assert_eq!(health.len(), 1);
        assert_eq!(health[0].status, "ok");
    }

    /// `(orchestrator, how many texts have reached the engine)`
    fn orchestrator_with_counter(cache_entries: usize) -> (Orchestrator, Arc<AtomicUsize>) {
        let mut config = Config::default();
        config.performance.result_cache_entries = cache_entries;
        let seen = Arc::new(AtomicUsize::new(0));
        let mut orchestrator = Orchestrator::new(config);
        orchestrator.engines = vec![Box::new(CountingEngine {
            seen: Arc::clone(&seen),
        })];
        (orchestrator, seen)
    }

    #[tokio::test]
    async fn only_the_changed_text_goes_back_to_the_engine() {
        let (mut orchestrator, seen) = orchestrator_with_counter(64);
        let first = ["alpha".to_string(), "beta".to_string(), "gamma".to_string()];
        orchestrator.check_batch(&first, "en-US").await.unwrap();
        assert_eq!(seen.load(Ordering::SeqCst), 3);

        // The edit a keystroke makes: one range differs, the rest are identical.
        let second = [
            "alpha".to_string(),
            "beta!".to_string(),
            "gamma".to_string(),
        ];
        let batch = orchestrator.check_batch(&second, "en-US").await.unwrap();
        assert_eq!(seen.load(Ordering::SeqCst), 4);
        assert_eq!(
            messages(&batch),
            vec![Some("alpha"), Some("beta!"), Some("gamma")]
        );
    }

    #[tokio::test]
    async fn a_disabled_cache_rechecks_everything() {
        let (mut orchestrator, seen) = orchestrator_with_counter(0);
        let texts = ["alpha".to_string(), "beta".to_string()];
        orchestrator.check_batch(&texts, "en-US").await.unwrap();
        orchestrator.check_batch(&texts, "en-US").await.unwrap();
        assert_eq!(seen.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn a_config_change_drops_every_cached_answer() {
        let (mut orchestrator, seen) = orchestrator_with_counter(64);
        let texts = ["alpha".to_string()];
        orchestrator.check_batch(&texts, "en-US").await.unwrap();

        let mut config = Config::default();
        config.performance.result_cache_entries = 64;
        orchestrator.update_config(config);
        // update_config rebuilds the engines from config, so put the counting
        // one back before asking again.
        orchestrator.engines = vec![Box::new(CountingEngine {
            seen: Arc::clone(&seen),
        })];

        orchestrator.check_batch(&texts, "en-US").await.unwrap();
        assert_eq!(seen.load(Ordering::SeqCst), 2);
    }

    /// Declines every text, the way `LanguageTool` answers for a language it was
    /// never built with.
    struct DecliningEngine;

    #[async_trait::async_trait]
    impl Engine for DecliningEngine {
        fn name(&self) -> &'static str {
            "languagetool"
        }

        async fn check(&mut self, _text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
            Err(anyhow::Error::new(crate::engines::UnsupportedLanguage {
                engine: "languagetool",
                language: language_id.to_string(),
            }))
        }
    }

    /// A custom checker that named the one language it speaks, the way an
    /// `engines.external` entry with `languages: ["en"]` does.
    struct CustomEnglishEngine;

    #[async_trait::async_trait]
    impl Engine for CustomEnglishEngine {
        fn name(&self) -> &'static str {
            "external"
        }

        fn supported_languages(&self) -> Vec<String> {
            vec!["en".to_string()]
        }

        async fn check(&mut self, _text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
            Ok(Vec::new())
        }
    }

    /// Fails every text, the way an engine with a broken dictionary does.
    struct FailingEngine;

    #[async_trait::async_trait]
    impl Engine for FailingEngine {
        fn name(&self) -> &'static str {
            "hunspell"
        }

        async fn check(&mut self, _text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
            Err(anyhow::anyhow!(
                "he_IL.dic is not a dictionary this checker can read"
            ))
        }
    }

    /// A diagnostic over the same span, from a named engine.
    fn at(span: (u32, u32), rule: &str, severity: i32, suggestions: &[&str]) -> Diagnostic {
        Diagnostic {
            start_byte: span.0,
            end_byte: span.1,
            message: format!("from {rule}"),
            suggestions: suggestions.iter().map(|s| (*s).to_string()).collect(),
            rule_id: rule.to_string(),
            severity,
            unified_id: "spelling.typo".to_string(),
            confidence: 0.8,
            language: String::new(),
            pack_installable: false,
        }
    }

    const ERROR: i32 = 3;
    const WARNING: i32 = 2;
    const HINT: i32 = 4;

    #[test]
    fn two_engines_reporting_the_same_thing_become_one() {
        let merged = merge_duplicates(vec![
            at((0, 5), "harper.Spelling", WARNING, &["definitely"]),
            at((0, 5), "hunspell.spelling", WARNING, &["definitely"]),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].rule_id, "harper.Spelling",
            "the first engine's report survives"
        );
    }

    #[test]
    fn the_merged_report_keeps_the_highest_severity() {
        // LanguageTool calls a misspelling an error and Harper a warning, and
        // Harper registers first. Dropping the later one dropped the error.
        let merged = merge_duplicates(vec![
            at((0, 5), "harper.Spelling", WARNING, &[]),
            at((0, 5), "languagetool.MORFOLOGIK_RULE_EN_US", ERROR, &[]),
        ]);
        assert_eq!(merged[0].severity, ERROR);
    }

    #[test]
    fn a_hint_does_not_outrank_an_error() {
        // SEVERITY_HINT is 4 and the least severe of the four, so comparing
        // the raw numbers gets this backwards.
        let merged = merge_duplicates(vec![
            at((0, 5), "a.rule", ERROR, &[]),
            at((0, 5), "b.rule", HINT, &[]),
        ]);
        assert_eq!(merged[0].severity, ERROR);

        let other_way = merge_duplicates(vec![
            at((0, 5), "a.rule", HINT, &[]),
            at((0, 5), "b.rule", ERROR, &[]),
        ]);
        assert_eq!(other_way[0].severity, ERROR);
    }

    #[test]
    fn suggestions_are_taken_one_from_each_engine_in_turn() {
        let merged = merge_duplicates(vec![
            at((0, 5), "harper.Spelling", WARNING, &["h1", "h2", "h3"]),
            at((0, 5), "hunspell.spelling", WARNING, &["u1", "u2"]),
            at((0, 5), "languagetool.X", WARNING, &["l1"]),
        ]);
        assert_eq!(
            merged[0].suggestions,
            vec!["h1", "u1", "l1", "h2", "u2", "h3"],
            "each engine's best pick comes before any engine's second"
        );
    }

    #[test]
    fn one_engines_long_tail_does_not_bury_the_others() {
        // The case that makes a plain union worse than dropping: LanguageTool
        // answers a French misspelling with dozens of replacements, and the
        // SpeedFix panel only has nine slots.
        let many: Vec<String> = (0..50).map(|i| format!("lt{i}")).collect();
        let many_refs: Vec<&str> = many.iter().map(String::as_str).collect();
        let merged = merge_duplicates(vec![
            at((0, 5), "languagetool.X", WARNING, &many_refs),
            at((0, 5), "hunspell.spelling", WARNING, &["u1"]),
            at((0, 5), "harper.Spelling", WARNING, &["h1"]),
        ]);
        assert_eq!(
            &merged[0].suggestions[..3],
            &["lt0", "u1", "h1"],
            "the first three slots are one per engine, not three from one"
        );
    }

    #[test]
    fn the_same_suggestion_from_two_engines_is_offered_once() {
        let merged = merge_duplicates(vec![
            at(
                (0, 5),
                "harper.Spelling",
                WARNING,
                &["definitely", "definite"],
            ),
            at(
                (0, 5),
                "hunspell.spelling",
                WARNING,
                &["definitely", "defiantly"],
            ),
        ]);
        assert_eq!(
            merged[0].suggestions,
            vec!["definitely", "definite", "defiantly"]
        );
    }

    #[test]
    fn a_different_span_is_a_different_diagnostic() {
        // Engines tokenise independently, so a span differing by one byte is
        // left alone rather than guessed at.
        let merged = merge_duplicates(vec![
            at((0, 5), "harper.Spelling", WARNING, &[]),
            at((0, 6), "hunspell.spelling", WARNING, &[]),
        ]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn a_different_rule_at_the_same_span_is_a_different_diagnostic() {
        let mut grammar = at((0, 5), "languagetool.X", WARNING, &[]);
        grammar.unified_id = "grammar.agreement".to_string();
        let merged = merge_duplicates(vec![at((0, 5), "harper.Spelling", WARNING, &[]), grammar]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn merging_preserves_the_order_diagnostics_arrived_in() {
        let merged = merge_duplicates(vec![
            at((10, 15), "a.rule", WARNING, &[]),
            at((0, 5), "b.rule", WARNING, &[]),
            at((10, 15), "c.rule", WARNING, &[]),
        ]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].start_byte, 10, "first seen stays first");
        assert_eq!(merged[1].start_byte, 0);
    }

    #[tokio::test]
    async fn an_engine_that_fails_outright_says_so_on_the_document() {
        // Reported where the user is looking, not only in a log: prose that
        // went unchecked because a dictionary is broken must not come back
        // indistinguishable from prose that is clean.
        let mut orchestrator = Orchestrator::new(Config::default());
        orchestrator.engines = vec![Box::new(FailingEngine)];

        let batch = orchestrator
            .check_batch(&["shalom".to_string()], "he")
            .await
            .unwrap();
        assert_eq!(batch[0].len(), 1, "{:?}", batch[0]);
        assert_eq!(batch[0][0].unified_id, "languagecheck.engine-error");
        assert!(
            batch[0][0].message.contains("he_IL.dic"),
            "the report must name what broke: {}",
            batch[0][0].message
        );
    }

    #[tokio::test]
    async fn a_failure_does_not_mask_another_engines_findings() {
        // One engine down must not hide what a working one found, so the
        // notice only appears when nothing came back at all.
        let mut orchestrator = Orchestrator::new(Config::default());
        orchestrator.engines = vec![Box::new(FailingEngine), Box::new(CountingEngine::default())];

        let batch = orchestrator
            .check_batch(&["alpha".to_string()], "en-US")
            .await
            .unwrap();
        assert!(
            !batch[0]
                .iter()
                .any(|d| d.unified_id == "languagecheck.engine-error"),
            "{:?}",
            batch[0]
        );
    }

    #[tokio::test]
    async fn a_language_the_engine_cannot_read_is_reported_not_passed() {
        let mut orchestrator = Orchestrator::new(Config::default());
        orchestrator.engines = vec![Box::new(DecliningEngine)];
        let texts = ["\u{5e9}\u{5dc}\u{5d5}\u{5dd} \u{5e2}\u{5d5}\u{5dc}\u{5dd}".to_string()];

        let batch = orchestrator.check_batch(&texts, "he").await.unwrap();
        assert_eq!(batch[0][0].unified_id, "languagecheck.no-provider");
        assert!(batch[0][0].message.contains("he"));
    }

    #[tokio::test]
    async fn a_custom_checker_that_speaks_the_language_stops_the_notice() {
        // Someone whose only engine is their own checker, declaring `en`, is
        // covered for English -- so the passage must not be reported as
        // unchecked, and the editor must not offer them a dictionary for a
        // language they already check. Returning nothing is a clean result,
        // not an absent one.
        let mut orchestrator = Orchestrator::new(Config::default());
        orchestrator.engines = vec![Box::new(CustomEnglishEngine)];

        let batch = orchestrator
            .check_batch(&["alpha beta".to_string()], "en-US")
            .await
            .unwrap();
        assert!(
            batch[0].is_empty(),
            "a checker that speaks the language answered for it: {:?}",
            batch[0]
        );
    }

    #[tokio::test]
    async fn a_custom_checker_only_covers_what_it_declared() {
        // The same engine, asked for a language it did not name. It is still
        // installed and still useful, which is why the notice says no *enabled
        // engine reads this language* and not that nothing is installed.
        let mut orchestrator = Orchestrator::new(Config::default());
        orchestrator.engines = vec![Box::new(CustomEnglishEngine)];

        let batch = orchestrator
            .check_batch(&["\u{5e9}\u{5dc}\u{5d5}\u{5dd}".to_string()], "he")
            .await
            .unwrap();
        assert_eq!(batch[0][0].unified_id, "languagecheck.no-provider");
        assert_eq!(batch[0][0].language, "he");
    }

    #[tokio::test]
    async fn declining_a_language_does_not_mark_the_engine_unhealthy() {
        let mut orchestrator = Orchestrator::new(Config::default());
        orchestrator.engines = vec![Box::new(DecliningEngine)];
        orchestrator
            .check_batch(&["shalom".to_string()], "he")
            .await
            .unwrap();

        // A server that answers "I have no Hebrew" is a server that answered.
        assert!(
            orchestrator.engine_health_report().is_empty(),
            "health should not record a language gap as a failure"
        );
    }
}
