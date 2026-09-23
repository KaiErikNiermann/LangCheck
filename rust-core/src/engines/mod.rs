pub mod hunspell;
mod proselint;
mod vale;

pub use proselint::ProselintEngine;
pub use vale::ValeEngine;

use crate::checker::{Diagnostic, Severity};
use anyhow::Result;
use extism::{Manifest, Plugin, Wasm};
use harper_core::{
    Dialect, Document, Lrc,
    linting::{LintGroup, Linter},
    parsers::Markdown,
    spell::FstDictionary,
};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{debug, warn};

#[async_trait::async_trait]
pub trait Engine {
    fn name(&self) -> &'static str;
    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>>;
    /// Downcast hooks for the two engines whose markup support is configured.
    ///
    /// A narrow alternative to putting `extensions` on every engine, most of
    /// which are handed prose a grammar already chose and have no opinion.
    fn as_external(&self) -> Option<&ExternalEngine> {
        None
    }
    fn as_wasm(&self) -> Option<&WasmEngine> {
        None
    }

    /// BCP-47 tags this engine handles. Empty means every language.
    ///
    /// `String` rather than `&'static str` because the answer is not always
    /// compiled in: an external provider or a WASM plugin declares its
    /// languages in config, and until it could, every one of them claimed
    /// every language -- which made `engines_ran` non-zero for a language
    /// nothing could actually read, and so suppressed the report saying so.
    fn supported_languages(&self) -> Vec<String> {
        Vec::new()
    }

    /// Check a batch of independent texts, returning one result per input in
    /// order.
    ///
    /// A document is checked one prose range at a time, so a single check is
    /// hundreds of calls. Engines whose work is latency-bound (a network round
    /// trip, a subprocess spawn) override this to overlap them; the default is
    /// the same sequential loop callers would write by hand.
    async fn check_many(
        &mut self,
        texts: &[String],
        language_id: &str,
    ) -> Vec<Result<Vec<Diagnostic>>> {
        let mut results = Vec::with_capacity(texts.len());
        for text in texts {
            results.push(self.check(text, language_id).await);
        }
        results
    }
}

/// Returns `true` if `engine` supports the given BCP-47 `lang_tag`.
///
/// Matching is on the primary subtag: `"en-US"` matches an engine that
/// advertises `"en"`. An engine with an empty list is a wildcard (supports all).
pub fn engine_supports_language(engine: &(dyn Engine + Send), lang_tag: &str) -> bool {
    let supported = engine.supported_languages();
    if supported.is_empty() {
        return true;
    }
    let primary = lang_tag.split('-').next().unwrap_or(lang_tag);
    supported.iter().any(|declared| {
        // Declared `en` matches asked-for `en-GB`, and declared `en-GB`
        // matches asked-for `en`: a provider naming a variant still speaks the
        // language, and one naming the language still speaks the variant.
        let declared_primary = declared.split(['-', '_']).next().unwrap_or(declared);
        declared_primary.eq_ignore_ascii_case(primary)
    })
}

/// Whether a declared extension list covers the document being checked.
///
/// An empty list, or an extension the list does not name, is handled by the
/// two callers' shared rule: a provider is skipped only when it has said which
/// formats it parses and this is not one of them. A leading dot in the config
/// is accepted, since `extensions: [".md"]` is the obvious way to write it.
pub(crate) fn declares_extension(declared: &[String], extension: Option<&str>) -> bool {
    if declared.is_empty() {
        return true;
    }
    extension.is_some_and(|ext| {
        declared
            .iter()
            // nosemgrep: declared-extensions-through-declares-extension -- this is the helper.
            .any(|entry| entry.trim_start_matches('.').eq_ignore_ascii_case(ext))
    })
}

/// Whether `engine` parses the markup of the document being checked.
///
/// Only the two config-driven engines declare this; everything else is built
/// around a grammar the extractor already chose, so the question does not
/// arise for them.
#[must_use]
pub fn engine_handles_extension(engine: &(dyn Engine + Send), extension: Option<&str>) -> bool {
    if let Some(external) = engine.as_external() {
        return external.handles_extension(extension);
    }
    if let Some(wasm) = engine.as_wasm() {
        return wasm.handles_extension(extension);
    }
    true
}

/// Build a lookup from Unicode-scalar (char) index → UTF-8 byte offset, with a
/// final entry for the end-of-text index (char count → `text.len()`).
///
/// The wire protocol reports diagnostic spans as UTF-8 byte offsets, but some
/// engines count in `char`s (e.g. Harper, which operates on a `Vec<char>`).
/// Without this conversion, any multi-byte character (em-dash `—`, accented
/// letters, …) before a diagnostic shifts every later underline.
fn char_to_byte_table(text: &str) -> Vec<u32> {
    #[allow(clippy::cast_possible_truncation)]
    let mut table: Vec<u32> = text.char_indices().map(|(b, _)| b as u32).collect();
    #[allow(clippy::cast_possible_truncation)]
    table.push(text.len() as u32);
    table
}

/// Build a lookup from UTF-16 code-unit index → UTF-8 byte offset, with a final
/// entry for the end-of-text index.
///
/// Used for engines that report UTF-16 offsets (e.g. `LanguageTool`, a Java
/// service whose char offsets are UTF-16 code units). Astral chars occupy two
/// UTF-16 units; both map to the char's starting byte.
fn utf16_to_byte_table(text: &str) -> Vec<u32> {
    let mut table: Vec<u32> = Vec::with_capacity(text.len() + 1);
    for (byte_idx, ch) in text.char_indices() {
        #[allow(clippy::cast_possible_truncation)]
        let b = byte_idx as u32;
        for _ in 0..ch.len_utf16() {
            table.push(b);
        }
    }
    #[allow(clippy::cast_possible_truncation)]
    table.push(text.len() as u32);
    table
}

/// Clamp-safe lookup into an offset table built by [`char_to_byte_table`] or
/// [`utf16_to_byte_table`]. Out-of-range indices map to end-of-text.
fn lookup_offset(table: &[u32], idx: usize) -> u32 {
    table
        .get(idx)
        .copied()
        .unwrap_or_else(|| table.last().copied().unwrap_or(0))
}

pub struct HarperEngine {
    linter: LintGroup,
    dict: Lrc<FstDictionary>,
}

impl HarperEngine {
    #[must_use]
    pub fn new(config: &crate::config::HarperConfig) -> Self {
        let dialect = match config.dialect.as_str() {
            "British" => Dialect::British,
            "Canadian" => Dialect::Canadian,
            "Australian" => Dialect::Australian,
            _ => Dialect::American,
        };
        let dict = FstDictionary::curated();
        let mut linter = LintGroup::new_curated(dict.clone(), dialect);

        for (rule, enabled) in &config.linters {
            linter.config.set_rule_enabled(rule, *enabled);
        }

        Self { linter, dict }
    }
}

#[async_trait::async_trait]
impl Engine for HarperEngine {
    fn name(&self) -> &'static str {
        "harper"
    }

    fn supported_languages(&self) -> Vec<String> {
        vec!["en".to_string()]
    }

    async fn check(&mut self, text: &str, _language_id: &str) -> Result<Vec<Diagnostic>> {
        let document = Document::new(text, &Markdown::default(), self.dict.as_ref());
        let lints = self.linter.lint(&document);

        // Harper spans are char indices; the protocol wants UTF-8 byte offsets.
        let char_to_byte = char_to_byte_table(text);

        let diagnostics = lints
            .into_iter()
            .map(|lint| {
                let suggestions = lint
                    .suggestions
                    .into_iter()
                    .map(|s| match s {
                        harper_core::linting::Suggestion::ReplaceWith(chars) => {
                            chars.into_iter().collect::<String>()
                        }
                        harper_core::linting::Suggestion::InsertAfter(chars) => {
                            let content: String = chars.into_iter().collect();
                            format!("Insert \"{content}\"")
                        }
                        // Empty string replacement = delete the diagnostic range
                        harper_core::linting::Suggestion::Remove => String::new(),
                    })
                    .collect();

                Diagnostic {
                    start_byte: lookup_offset(&char_to_byte, lint.span.start),
                    end_byte: lookup_offset(&char_to_byte, lint.span.end),
                    message: lint.message,
                    suggestions,
                    rule_id: format!("harper.{:?}", lint.lint_kind),
                    severity: Severity::Warning as i32,
                    unified_id: String::new(), // Will be filled by normalizer
                    confidence: 0.8,
                    language: String::new(),
                    pack_installable: false,
                }
            })
            .collect();

        Ok(diagnostics)
    }
}

pub struct LanguageToolEngine {
    url: String,
    level: String,
    mother_tongue: Option<String>,
    disabled_rules: Vec<String>,
    enabled_rules: Vec<String>,
    disabled_categories: Vec<String>,
    enabled_categories: Vec<String>,
    max_concurrent_requests: usize,
    max_request_bytes: usize,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct LTResponse {
    matches: Vec<LTMatch>,
}

#[derive(Deserialize)]
struct LTMatch {
    message: String,
    offset: usize,
    length: usize,
    replacements: Vec<LTReplacement>,
    rule: LTRule,
}

#[derive(Deserialize)]
struct LTReplacement {
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LTRule {
    id: String,
    issue_type: String,
}

impl LanguageToolEngine {
    #[must_use]
    pub fn new(config: &crate::config::LanguageToolConfig) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(3))
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        Self {
            url: config.url.clone(),
            level: config.level.clone(),
            mother_tongue: config.mother_tongue.clone(),
            disabled_rules: config.disabled_rules.clone(),
            enabled_rules: config.enabled_rules.clone(),
            disabled_categories: config.disabled_categories.clone(),
            enabled_categories: config.enabled_categories.clone(),
            max_concurrent_requests: config.max_concurrent_requests.max(1),
            max_request_bytes: config.max_request_bytes,
            client,
        }
    }

    /// The form fields every request shares — everything except `text`.
    fn base_form(&self, language_id: &str) -> Vec<(&'static str, String)> {
        // language_id is a BCP-47 tag from the orchestrator (e.g. "en-US", "de-DE").
        let mut form: Vec<(&'static str, String)> = vec![("language", language_id.to_string())];
        if self.level != "default" {
            form.push(("level", self.level.clone()));
        }
        if let Some(ref mt) = self.mother_tongue {
            form.push(("motherTongue", mt.clone()));
        }
        if !self.disabled_rules.is_empty() {
            form.push(("disabledRules", self.disabled_rules.join(",")));
        }
        if !self.enabled_rules.is_empty() {
            form.push(("enabledRules", self.enabled_rules.join(",")));
        }
        if !self.disabled_categories.is_empty() {
            form.push(("disabledCategories", self.disabled_categories.join(",")));
        }
        if !self.enabled_categories.is_empty() {
            form.push(("enabledCategories", self.enabled_categories.join(",")));
        }
        form
    }
}

/// An engine that cannot check a language at all, as distinct from one that
/// failed.
///
/// `LanguageTool` has no Hebrew, so a Hebrew passage in an otherwise French
/// document answers HTTP 400 — which, read as a failure, marks a healthy
/// server as down and tells the user in the status bar that `LanguageTool` is
/// unreachable. It is neither a failure nor a clean check: the prose went
/// unchecked and the user should be told which language nothing could read.
#[derive(Debug)]
pub struct UnsupportedLanguage {
    pub engine: &'static str,
    pub language: String,
}

impl std::fmt::Display for UnsupportedLanguage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} cannot check \"{}\"", self.engine, self.language)
    }
}

impl std::error::Error for UnsupportedLanguage {}

/// Whether this result is an engine declining a language rather than failing.
#[must_use]
pub fn is_unsupported_language<T>(result: &Result<T>) -> bool {
    result
        .as_ref()
        .err()
        .is_some_and(|e| e.downcast_ref::<UnsupportedLanguage>().is_some())
}

/// Prose ranges gathered into one `/v2/check`.
///
/// `LanguageTool` costs roughly a flat 8 ms per request plus 20.6 us per byte,
/// so a document sent one prose range at a time pays the flat cost a hundred
/// times over for 35 kB of text. Ranges are joined by a blank line, which is
/// what separates them in the document anyway, and each one's diagnostics are
/// handed back to it by offset.
struct Pack {
    text: String,
    /// `(index into the caller's texts, byte offset of that text in `text`)`,
    /// ascending by offset.
    members: Vec<(usize, usize)>,
}

/// The blank line between two packed ranges.
///
/// Two newlines, so `LanguageTool` treats the members as separate paragraphs
/// and no rule reaches across a join that does not exist in the document.
const PACK_SEPARATOR: &str = "\n\n";

impl Pack {
    /// Split this pack's diagnostics back out per member, rebasing offsets.
    ///
    /// A diagnostic that starts inside a separator belongs to no member and is
    /// dropped; one that runs past its member's end is clamped to it.
    fn scatter(
        &self,
        texts: &[String],
        diagnostics: Vec<Diagnostic>,
    ) -> Vec<(usize, Vec<Diagnostic>)> {
        let mut out: Vec<(usize, Vec<Diagnostic>)> = self
            .members
            .iter()
            .map(|&(idx, _)| (idx, Vec::new()))
            .collect();

        for mut d in diagnostics {
            let start = d.start_byte as usize;
            // The last member whose offset is at or before the diagnostic.
            let Some(slot) = self
                .members
                .partition_point(|&(_, offset)| offset <= start)
                .checked_sub(1)
            else {
                continue;
            };
            let (idx, offset) = self.members[slot];
            let end = offset + texts[idx].len();
            if start >= end {
                continue; // landed in the separator after this member
            }
            #[allow(clippy::cast_possible_truncation)]
            {
                d.start_byte = (start - offset) as u32;
                d.end_byte = ((d.end_byte as usize).min(end) - offset) as u32;
            }
            out[slot].1.push(d);
        }
        out
    }
}

/// Gather `texts` into requests of at most `limit` bytes, in order.
///
/// Empty texts take no room and are left out: they have no diagnostics to
/// find, and the caller fills their slot without a request. A text longer than
/// `limit` gets a pack of its own — splitting it would cut a sentence. A
/// `limit` of zero means one text per pack.
fn pack_texts(texts: &[String], limit: usize) -> Vec<Pack> {
    let mut packs: Vec<Pack> = Vec::new();
    let mut current: Option<Pack> = None;

    for (idx, text) in texts.iter().enumerate() {
        if text.is_empty() {
            continue;
        }
        let fits = current
            .as_ref()
            .is_some_and(|pack| pack.text.len() + PACK_SEPARATOR.len() + text.len() <= limit);
        if !fits && let Some(pack) = current.take() {
            packs.push(pack);
        }
        match current {
            Some(ref mut pack) => {
                pack.members
                    .push((idx, pack.text.len() + PACK_SEPARATOR.len()));
                pack.text.push_str(PACK_SEPARATOR);
                pack.text.push_str(text);
            }
            None => {
                current = Some(Pack {
                    text: text.clone(),
                    members: vec![(idx, 0)],
                });
            }
        }
    }
    packs.extend(current);
    packs
}

/// One `POST /v2/check`.
///
/// Free-standing rather than a method so a batch can drive many at once from
/// cloned handles — `reqwest::Client` is an `Arc` internally, so the clones
/// Whether `url` is something a request can be sent to, and what is wrong if not.
///
/// The message is the whole point: it names the setting, says what is wrong
/// with the value, and gives one that works. `reqwest` says "builder error".
pub(crate) fn usable_languagetool_url(url: &str) -> std::result::Result<(), String> {
    if url.trim().is_empty() {
        return Err(
            "LanguageTool is enabled but engines.languagetool.url is empty. \
             Set it to the server's address, for example http://localhost:8010, \
             or set engines.languagetool.enabled to false."
                .to_string(),
        );
    }
    match reqwest::Url::parse(url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => Ok(()),
        Ok(parsed) => Err(format!(
            "engines.languagetool.url is \"{url}\", whose scheme is \"{}\". \
             LanguageTool is reached over http or https, for example \
             http://localhost:8010.",
            parsed.scheme()
        )),
        Err(e) => Err(format!(
            "engines.languagetool.url is \"{url}\", which is not a URL ({e}). \
             It should look like http://localhost:8010."
        )),
    }
}

/// share one connection pool.
#[allow(clippy::cast_possible_truncation)]
async fn languagetool_request(
    client: &reqwest::Client,
    url: &str,
    base_form: &[(&'static str, String)],
    text: &str,
    language: &str,
) -> Result<Vec<Diagnostic>> {
    debug!(url = %url, text_len = text.len(), "LanguageTool request");

    let mut form_params: Vec<(&str, String)> = Vec::with_capacity(base_form.len() + 1);
    form_params.push(("text", text.to_string()));
    form_params.extend(base_form.iter().map(|(k, v)| (*k, v.clone())));

    let request_start = std::time::Instant::now();
    let response = match client.post(url).form(&form_params).send().await {
        Ok(r) => {
            let status = r.status();
            debug!(
                status = %status,
                elapsed_ms = request_start.elapsed().as_millis() as u64,
                "LanguageTool HTTP response"
            );
            if !status.is_success() {
                let body = r.text().await.unwrap_or_default();
                // A server that does not speak this language is not a broken
                // server, and saying so keeps it out of the health report.
                if body.contains("is not a language code known to LanguageTool") {
                    debug!(language, "LanguageTool has no such language");
                    return Err(anyhow::Error::new(UnsupportedLanguage {
                        engine: "languagetool",
                        language: language.to_string(),
                    }));
                }
                warn!(
                    status = %status,
                    body = %body,
                    "LanguageTool returned non-200"
                );
                return Err(anyhow::anyhow!("LanguageTool HTTP {status}: {body}"));
            }
            r
        }
        Err(e) => {
            warn!(
                elapsed_ms = request_start.elapsed().as_millis() as u64,
                "LanguageTool connection error: {e}"
            );
            return Err(anyhow::anyhow!("LanguageTool connection error: {e}"));
        }
    };

    let res = match response.json::<LTResponse>().await {
        Ok(r) => r,
        Err(e) => {
            warn!("LanguageTool JSON parse error: {e}");
            return Err(anyhow::anyhow!("LanguageTool JSON parse error: {e}"));
        }
    };

    debug!(
        matches = res.matches.len(),
        elapsed_ms = request_start.elapsed().as_millis() as u64,
        "LanguageTool check complete"
    );

    // LanguageTool reports offsets in UTF-16 code units; convert to bytes.
    let utf16_to_byte = utf16_to_byte_table(text);

    Ok(res
        .matches
        .into_iter()
        .map(|m| {
            let severity = match m.rule.issue_type.as_str() {
                "misspelling" => Severity::Error,
                "typographical" => Severity::Warning,
                _ => Severity::Information,
            };

            Diagnostic {
                start_byte: lookup_offset(&utf16_to_byte, m.offset),
                end_byte: lookup_offset(&utf16_to_byte, m.offset + m.length),
                message: m.message,
                suggestions: m.replacements.into_iter().map(|r| r.value).collect(),
                rule_id: format!("languagetool.{}", m.rule.id),
                severity: severity as i32,
                unified_id: String::new(), // Will be filled by normalizer
                confidence: 0.8,
                language: String::new(),
                pack_installable: false,
            }
        })
        .collect())
}

#[allow(clippy::too_many_lines, clippy::cast_possible_truncation)]
#[async_trait::async_trait]
impl Engine for LanguageToolEngine {
    fn name(&self) -> &'static str {
        "languagetool"
    }

    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        // Checked before the request, because reqwest reports a URL it
        // cannot use as "builder error" and nothing else -- which reached the
        // user as "LanguageTool connection error: builder error", naming
        // neither the setting at fault nor what is wrong with it.
        usable_languagetool_url(&self.url).map_err(|reason| anyhow::anyhow!("{reason}"))?;
        let url = format!("{}/v2/check", self.url);
        languagetool_request(
            &self.client,
            &url,
            &self.base_form(language_id),
            text,
            language_id,
        )
        .await
    }

    /// Pack the prose ranges into as few requests as the size limit allows,
    /// and overlap those.
    ///
    /// Both halves matter, and the first more than the second. `LanguageTool`
    /// charges about 8 ms per request before it reads a byte, so a document
    /// sent one range at a time pays that flat cost once per range — for a
    /// 36 kB Typst file, 109 times, which is most of the wall clock. Packing
    /// to [`LanguageToolConfig::max_request_bytes`] cuts that to ten requests.
    /// What remains is round-trip latency, and that is what the concurrency
    /// limit hides; requests are capped at `max_concurrent_requests` in flight
    /// so a shared server is not swamped.
    async fn check_many(
        &mut self,
        texts: &[String],
        language_id: &str,
    ) -> Vec<Result<Vec<Diagnostic>>> {
        let mut slots: Vec<Option<Result<Vec<Diagnostic>>>> = texts.iter().map(|_| None).collect();
        let packs = pack_texts(texts, self.max_request_bytes);
        if packs.is_empty() {
            return slots.into_iter().map(|_| Ok(Vec::new())).collect();
        }

        // One answer per input, so a bad URL is reported for every text
        // rather than short-circuiting the batch: each range still has to say
        // why it went unchecked.
        if let Err(reason) = usable_languagetool_url(&self.url) {
            return texts
                .iter()
                .map(|_| Err(anyhow::anyhow!("{reason}")))
                .collect();
        }
        let url = Arc::new(format!("{}/v2/check", self.url));
        let base_form = Arc::new(self.base_form(language_id));
        let permits = Arc::new(Semaphore::new(self.max_concurrent_requests.max(1)));
        let packs = Arc::new(packs);
        let language: Arc<str> = Arc::from(language_id);
        let mut tasks = JoinSet::new();

        for pack_idx in 0..packs.len() {
            let client = self.client.clone();
            let url = Arc::clone(&url);
            let base_form = Arc::clone(&base_form);
            let permits = Arc::clone(&permits);
            let packs = Arc::clone(&packs);
            let language = Arc::clone(&language);
            tasks.spawn(async move {
                // The semaphore is never closed, so acquiring only fails if the
                // runtime is shutting down — treat that as "no slot, run anyway".
                let _permit = permits.acquire().await.ok();
                let result = languagetool_request(
                    &client,
                    &url,
                    &base_form,
                    &packs[pack_idx].text,
                    &language,
                )
                .await;
                (pack_idx, result)
            });
        }

        while let Some(joined) = tasks.join_next().await {
            let Ok((pack_idx, result)) = joined else {
                warn!("LanguageTool batch task failed to join");
                continue;
            };
            let pack = &packs[pack_idx];
            match result {
                Ok(diagnostics) => {
                    for (idx, own) in pack.scatter(texts, diagnostics) {
                        slots[idx] = Some(Ok(own));
                    }
                }
                // One failed request costs every range it carried, so each of
                // them reports the failure rather than reading as clean. The
                // error is rebuilt rather than cloned, keeping the distinction
                // between a failure and a language the engine cannot read.
                Err(e) => {
                    let unsupported = e
                        .downcast_ref::<UnsupportedLanguage>()
                        .map(|u| (u.engine, u.language.clone()));
                    for &(idx, _) in &pack.members {
                        slots[idx] = Some(Err(match &unsupported {
                            Some((engine, language)) => anyhow::Error::new(UnsupportedLanguage {
                                engine,
                                language: language.clone(),
                            }),
                            None => anyhow::anyhow!("{e}"),
                        }));
                    }
                }
            }
        }

        // Empty texts were never packed, and a dropped task leaves a hole.
        slots
            .into_iter()
            .enumerate()
            .map(|(idx, slot)| {
                slot.unwrap_or_else(|| {
                    if texts[idx].is_empty() {
                        Ok(Vec::new())
                    } else {
                        Err(anyhow::anyhow!("LanguageTool task dropped"))
                    }
                })
            })
            .collect()
    }
}

/// An external checker engine that communicates with a subprocess via stdin/stdout JSON.
pub struct ExternalEngine {
    name: String,
    command: String,
    args: Vec<String>,
    /// File extensions it parses; empty means every one.
    extensions: Vec<String>,
    /// BCP-47 tags it checks; empty means every one.
    languages: Vec<String>,
}

impl ExternalEngine {
    #[must_use]
    pub const fn new(
        name: String,
        command: String,
        args: Vec<String>,
        extensions: Vec<String>,
        languages: Vec<String>,
    ) -> Self {
        Self {
            name,
            command,
            args,
            extensions,
            languages,
        }
    }

    /// Whether this provider parses the markup of the document being checked.
    ///
    /// Unknown extension counts as a match: a provider is skipped only when it
    /// has said which formats it handles and this is not one of them.
    #[must_use]
    pub fn handles_extension(&self, extension: Option<&str>) -> bool {
        declares_extension(&self.extensions, extension)
    }
}

/// JSON request sent to the external process on stdin.
#[derive(serde::Serialize)]
struct ExternalRequest<'a> {
    text: &'a str,
    language_id: &'a str,
}

/// JSON diagnostic returned by the external process on stdout.
#[derive(Deserialize)]
struct ExternalDiagnostic {
    start_byte: u32,
    end_byte: u32,
    message: String,
    #[serde(default)]
    suggestions: Vec<String>,
    #[serde(default)]
    rule_id: String,
    #[serde(default = "default_severity_value")]
    severity: i32,
    #[serde(default)]
    confidence: f32,
}

const fn default_severity_value() -> i32 {
    Severity::Warning as i32
}

#[async_trait::async_trait]
impl Engine for ExternalEngine {
    fn name(&self) -> &'static str {
        "external"
    }

    fn supported_languages(&self) -> Vec<String> {
        self.languages.clone()
    }

    fn as_external(&self) -> Option<&Self> {
        Some(self)
    }

    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        use tokio::process::Command;

        let request = ExternalRequest { text, language_id };
        let input = serde_json::to_string(&request)?;

        let output = match Command::new(&self.command)
            .args(&self.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                use tokio::io::AsyncWriteExt;
                if let Some(mut stdin) = child.stdin.take() {
                    // Ignore write errors — the process may exit before reading stdin.
                    let _ = stdin.write_all(input.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                }
                child.wait_with_output().await?
            }
            Err(e) => {
                warn!(provider = %self.name, "Failed to spawn external provider: {e}");
                return Ok(vec![]);
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(
                provider = %self.name,
                status = %output.status,
                stderr = stderr.trim(),
                "External provider exited with error"
            );
            return Ok(vec![]);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let ext_diagnostics: Vec<ExternalDiagnostic> = match serde_json::from_str(&stdout) {
            Ok(d) => d,
            Err(e) => {
                warn!(provider = %self.name, "Failed to parse external provider output: {e}");
                return Ok(vec![]);
            }
        };

        let diagnostics = ext_diagnostics
            .into_iter()
            .map(|ed| {
                let rule_id = if ed.rule_id.is_empty() {
                    format!("external.{}", self.name)
                } else {
                    format!("external.{}.{}", self.name, ed.rule_id)
                };
                Diagnostic {
                    start_byte: ed.start_byte,
                    end_byte: ed.end_byte,
                    message: ed.message,
                    suggestions: ed.suggestions,
                    rule_id,
                    severity: ed.severity,
                    unified_id: String::new(),
                    confidence: if ed.confidence > 0.0 {
                        ed.confidence
                    } else {
                        0.7
                    },
                    language: String::new(),
                    pack_installable: false,
                }
            })
            .collect();

        Ok(diagnostics)
    }
}

/// A WASM checker plugin loaded via Extism.
///
/// The plugin must export a `check` function that accepts a JSON string
/// `{"text": "...", "language_id": "..."}` and returns a JSON array of
/// diagnostics matching the `ExternalDiagnostic` schema.
pub struct WasmEngine {
    name: String,
    plugin: Plugin,
    /// File extensions it parses; empty means every one.
    extensions: Vec<String>,
    /// BCP-47 tags it checks; empty means every one.
    languages: Vec<String>,
}

// SAFETY: Extism Plugin is not Send by default because it wraps a wasmtime Store
// which holds raw pointers. However, we only ever access the plugin from a single
// &mut self call at a time (the Engine trait takes &mut self), so this is safe
// as long as we don't share across threads simultaneously.
unsafe impl Send for WasmEngine {}

impl WasmEngine {
    /// Create a new WASM engine from a `.wasm` file path.
    pub fn new(
        name: String,
        wasm_path: PathBuf,
        extensions: Vec<String>,
        languages: Vec<String>,
    ) -> Result<Self> {
        let wasm = Wasm::file(wasm_path);
        let manifest = Manifest::new([wasm]);
        let plugin = Plugin::new(&manifest, [], true)?;
        Ok(Self {
            name,
            plugin,
            extensions,
            languages,
        })
    }

    /// Whether this plugin parses the markup of the document being checked.
    #[must_use]
    pub fn handles_extension(&self, extension: Option<&str>) -> bool {
        declares_extension(&self.extensions, extension)
    }

    /// Create a new WASM engine from raw bytes (useful for testing).
    pub fn from_bytes(name: String, wasm_bytes: &[u8]) -> Result<Self> {
        let wasm = Wasm::data(wasm_bytes.to_vec());
        let manifest = Manifest::new([wasm]);
        let plugin = Plugin::new(&manifest, [], true)?;
        Ok(Self {
            name,
            plugin,
            extensions: Vec::new(),
            languages: Vec::new(),
        })
    }
}

#[async_trait::async_trait]
impl Engine for WasmEngine {
    fn supported_languages(&self) -> Vec<String> {
        self.languages.clone()
    }

    fn as_wasm(&self) -> Option<&WasmEngine> {
        Some(self)
    }

    fn name(&self) -> &'static str {
        "wasm"
    }

    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        let request = serde_json::json!({
            "text": text,
            "language_id": language_id,
        });
        let input = request.to_string();

        let output = match self.plugin.call::<&str, &str>("check", &input) {
            Ok(result) => result.to_string(),
            Err(e) => {
                warn!(plugin = %self.name, "WASM plugin call failed: {e}");
                return Ok(vec![]);
            }
        };

        let ext_diagnostics: Vec<ExternalDiagnostic> = match serde_json::from_str(&output) {
            Ok(d) => d,
            Err(e) => {
                warn!(plugin = %self.name, "Failed to parse WASM plugin output: {e}");
                return Ok(vec![]);
            }
        };

        let diagnostics = ext_diagnostics
            .into_iter()
            .map(|ed| {
                let rule_id = if ed.rule_id.is_empty() {
                    format!("wasm.{}", self.name)
                } else {
                    format!("wasm.{}.{}", self.name, ed.rule_id)
                };
                Diagnostic {
                    start_byte: ed.start_byte,
                    end_byte: ed.end_byte,
                    message: ed.message,
                    suggestions: ed.suggestions,
                    rule_id,
                    severity: ed.severity,
                    unified_id: String::new(),
                    confidence: if ed.confidence > 0.0 {
                        ed.confidence
                    } else {
                        0.7
                    },
                    language: String::new(),
                    pack_installable: false,
                }
            })
            .collect();

        Ok(diagnostics)
    }
}

/// Discover WASM plugins from a directory (e.g. `.languagecheck/plugins/`).
/// Returns a list of (name, path) pairs for each `.wasm` file found.
#[must_use]
pub fn discover_wasm_plugins(plugin_dir: &std::path::Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(plugin_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "wasm") {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                Some((name, path))
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {

    #[test]
    fn an_empty_languagetool_url_says_which_setting_is_empty() {
        // What the user saw instead was "LanguageTool connection error:
        // builder error", which names neither the setting nor the problem.
        let reason = usable_languagetool_url("").expect_err("an empty url is not usable");
        assert!(reason.contains("engines.languagetool.url"), "{reason}");
        assert!(reason.contains("http://localhost:8010"), "{reason}");
    }

    #[test]
    fn a_url_with_the_wrong_scheme_says_so() {
        let reason = usable_languagetool_url("ftp://example.org")
            .expect_err("ftp is not a scheme LanguageTool is reached over");
        assert!(reason.contains("ftp"), "{reason}");
    }

    #[test]
    fn something_that_is_not_a_url_says_so() {
        let reason =
            usable_languagetool_url("localhost:8010").expect_err("no scheme, so not a url");
        assert!(reason.contains("engines.languagetool.url"), "{reason}");
    }

    #[test]
    fn an_ordinary_url_is_accepted() {
        usable_languagetool_url("http://localhost:8010").expect("the documented value");
        usable_languagetool_url("https://api.languagetool.org/v2").expect("a hosted one");
    }
    use super::*;

    #[test]
    fn char_to_byte_handles_multibyte() {
        // "a—b": 'a'=1 byte, '—'(U+2014)=3 bytes, 'b'=1 byte.
        let table = char_to_byte_table("a—b");
        assert_eq!(table, vec![0, 1, 4, 5]); // char idx 0,1,2 -> bytes; 3 -> len
        assert_eq!(lookup_offset(&table, 2), 4); // 'b' starts at byte 4, not 2
        assert_eq!(lookup_offset(&table, 3), 5); // end-of-text
        assert_eq!(lookup_offset(&table, 99), 5); // clamp
    }

    #[test]
    fn utf16_to_byte_handles_astral() {
        // "a😀b": 'a'=1 byte/1 unit, '😀'(U+1F600)=4 bytes/2 units, 'b'=1 byte.
        let table = utf16_to_byte_table("a😀b");
        // units: 0->'a'@0, 1&2->'😀'@1, 3->'b'@5, 4->end@6
        assert_eq!(table, vec![0, 1, 1, 5, 6]);
        assert_eq!(lookup_offset(&table, 3), 5); // 'b' after surrogate pair
    }

    #[test]
    fn em_dash_does_not_shift_byte_offsets() {
        // A char-index span (Harper-style) for "b" in "a—b" is (2, 3); after
        // conversion it must point at bytes (4, 5), not (2, 3).
        let table = char_to_byte_table("a—b");
        assert_eq!(lookup_offset(&table, 2), 4);
        assert_eq!(lookup_offset(&table, 3), 5);
    }

    #[tokio::test]
    async fn test_harper_engine() -> Result<()> {
        let mut engine = HarperEngine::new(&crate::config::HarperConfig::default());
        let text = "This is an test.";
        let diagnostics = engine.check(text, "en-US").await?;

        // Harper should find "an test" error
        assert!(!diagnostics.is_empty());

        Ok(())
    }

    #[tokio::test]
    async fn harper_offsets_are_bytes_after_em_dash() -> Result<()> {
        // An em-dash before the error must not shift the diagnostic's byte span.
        let mut engine = HarperEngine::new(&crate::config::HarperConfig::default());
        let text = "Some prose — this is an test.";
        let diagnostics = engine.check(text, "en-US").await?;
        assert!(!diagnostics.is_empty(), "Harper should flag 'an test'");

        // Every diagnostic span must land on valid UTF-8 byte boundaries of the
        // ORIGINAL text and slice to non-empty content (char-index spans would
        // fall short by 2 bytes per em-dash and could split the multibyte char).
        for d in &diagnostics {
            let (s, e) = (d.start_byte as usize, d.end_byte as usize);
            assert!(text.is_char_boundary(s), "start {s} not a char boundary");
            assert!(text.is_char_boundary(e), "end {e} not a char boundary");
            assert!(s <= e && e <= text.len(), "span ({s},{e}) out of range");
        }
        Ok(())
    }

    #[tokio::test]
    async fn external_engine_with_echo() -> Result<()> {
        // Use a simple shell command that echoes a valid JSON response
        let mut engine = ExternalEngine::new(
            "test-provider".to_string(),
            "sh".to_string(),
            vec![
                "-c".to_string(),
                r#"cat > /dev/null; echo '[{"start_byte":0,"end_byte":4,"message":"test issue","suggestions":["fix"],"rule_id":"test.rule","severity":2}]'"#.to_string(),
            ],
            Vec::new(),
            Vec::new(),
        );

        let diagnostics = engine.check("some text", "markdown").await?;
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "test issue");
        assert_eq!(diagnostics[0].rule_id, "external.test-provider.test.rule");
        assert_eq!(diagnostics[0].suggestions, vec!["fix"]);
        assert_eq!(diagnostics[0].start_byte, 0);
        assert_eq!(diagnostics[0].end_byte, 4);

        Ok(())
    }

    #[tokio::test]
    async fn external_engine_missing_binary() -> Result<()> {
        let mut engine = ExternalEngine::new(
            "nonexistent".to_string(),
            "/nonexistent/binary".to_string(),
            vec![],
            Vec::new(),
            Vec::new(),
        );

        // Should not error, just return empty
        let diagnostics = engine.check("text", "markdown").await?;
        assert!(diagnostics.is_empty());

        Ok(())
    }

    #[tokio::test]
    async fn external_engine_bad_json_output() -> Result<()> {
        let mut engine = ExternalEngine::new(
            "bad-json".to_string(),
            "echo".to_string(),
            vec!["not json".to_string()],
            Vec::new(),
            Vec::new(),
        );

        // Should not error, just return empty
        let diagnostics = engine.check("text", "markdown").await?;
        assert!(diagnostics.is_empty());

        Ok(())
    }

    #[test]
    fn wasm_engine_invalid_bytes_returns_error() {
        let result = WasmEngine::from_bytes("bad-plugin".to_string(), b"not a wasm file");
        assert!(result.is_err());
    }

    #[test]
    fn wasm_engine_missing_file_returns_error() {
        let result = WasmEngine::new(
            "missing".to_string(),
            PathBuf::from("/nonexistent/plugin.wasm"),
            Vec::new(),
            Vec::new(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn discover_wasm_plugins_empty_dir() {
        let dir = std::env::temp_dir().join("lang_check_test_wasm_empty");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let plugins = discover_wasm_plugins(&dir);
        assert!(plugins.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_wasm_plugins_finds_wasm_files() {
        let dir = std::env::temp_dir().join("lang_check_test_wasm_discover");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Create fake .wasm files and a non-wasm file
        std::fs::write(dir.join("checker.wasm"), b"fake").unwrap();
        std::fs::write(dir.join("linter.wasm"), b"fake").unwrap();
        std::fs::write(dir.join("readme.txt"), b"not a plugin").unwrap();

        let mut plugins = discover_wasm_plugins(&dir);
        plugins.sort_by(|a, b| a.0.cmp(&b.0));

        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0].0, "checker");
        assert_eq!(plugins[1].0, "linter");
        assert!(plugins[0].1.ends_with("checker.wasm"));
        assert!(plugins[1].1.ends_with("linter.wasm"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_wasm_plugins_nonexistent_dir() {
        let plugins = discover_wasm_plugins(std::path::Path::new("/nonexistent/dir"));
        assert!(plugins.is_empty());
    }

    /// Live integration test — requires LT Docker on localhost:8010.
    /// Run with: `cargo test lt_engine_live -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn lt_engine_live() -> Result<()> {
        // Initialize tracing for visible output
        let _ = tracing_subscriber::fmt()
            .with_env_filter("debug")
            .with_writer(std::io::stderr)
            .with_target(false)
            .try_init();

        let mut engine = LanguageToolEngine::new(&crate::config::LanguageToolConfig::default());
        let text = "This is a sentnce with erors.";
        let diagnostics = engine.check(text, "markdown").await?;

        println!("LT returned {} diagnostics:", diagnostics.len());
        for d in &diagnostics {
            println!(
                "  [{}-{}] {} (rule: {}, suggestions: {:?})",
                d.start_byte, d.end_byte, d.message, d.rule_id, d.suggestions
            );
        }

        assert!(
            diagnostics.len() >= 2,
            "Expected at least 2 spelling errors, got {}",
            diagnostics.len()
        );
        Ok(())
    }

    #[test]
    fn lt_response_deserializes_camel_case() {
        // Real LanguageTool API response (trimmed) — uses camelCase `issueType`
        let json = r#"{
            "matches": [{
                "message": "Possible spelling mistake found.",
                "offset": 10,
                "length": 7,
                "replacements": [{"value": "sentence"}],
                "rule": {
                    "id": "MORFOLOGIK_RULE_EN_US",
                    "description": "Possible spelling mistake",
                    "issueType": "misspelling",
                    "category": {"id": "TYPOS", "name": "Possible Typo"}
                }
            }]
        }"#;
        let res: LTResponse = serde_json::from_str(json).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].rule.id, "MORFOLOGIK_RULE_EN_US");
        assert_eq!(res.matches[0].rule.issue_type, "misspelling");
        assert_eq!(res.matches[0].offset, 10);
        assert_eq!(res.matches[0].length, 7);
        assert_eq!(res.matches[0].replacements[0].value, "sentence");
    }

    /// A diagnostic over `[start, end)` of whatever text it was found in.
    fn span(start: u32, end: u32) -> Diagnostic {
        Diagnostic {
            start_byte: start,
            end_byte: end,
            message: String::new(),
            suggestions: Vec::new(),
            rule_id: "languagetool.TEST".to_string(),
            severity: 2,
            unified_id: String::new(),
            confidence: 0.8,
            language: String::new(),
            pack_installable: false,
        }
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn packing_fills_a_request_up_to_the_limit() {
        let texts = strings(&["aaaa", "bbbb", "cccc"]);
        // Two members plus the separator is 10 bytes; a third would be 16.
        let packs = pack_texts(&texts, 12);
        assert_eq!(packs.len(), 2);
        assert_eq!(packs[0].text, "aaaa\n\nbbbb");
        assert_eq!(packs[0].members, vec![(0, 0), (1, 6)]);
        assert_eq!(packs[1].text, "cccc");
        assert_eq!(packs[1].members, vec![(2, 0)]);
    }

    #[test]
    fn a_text_over_the_limit_gets_its_own_request() {
        let texts = strings(&["short", "an altogether longer range", "tail"]);
        let packs = pack_texts(&texts, 8);
        assert_eq!(packs.len(), 3);
        assert_eq!(packs[1].text, "an altogether longer range");
        assert_eq!(packs[1].members, vec![(1, 0)]);
    }

    #[test]
    fn a_zero_limit_sends_one_text_per_request() {
        let texts = strings(&["one", "two", "three"]);
        let packs = pack_texts(&texts, 0);
        assert_eq!(packs.len(), 3);
        assert!(packs.iter().all(|p| p.members.len() == 1));
    }

    #[test]
    fn empty_texts_are_left_out_of_every_pack() {
        let texts = strings(&["", "real prose", ""]);
        let packs = pack_texts(&texts, 4096);
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].members, vec![(1, 0)]);
    }

    #[test]
    fn scatter_returns_each_diagnostic_to_its_own_range() {
        let texts = strings(&["first text", "second text"]);
        let packs = pack_texts(&texts, 4096);
        // "first text\n\nsecond text": offsets 0 and 12.
        let scattered = packs[0].scatter(&texts, vec![span(6, 10), span(12, 18)]);
        assert_eq!(scattered[0].0, 0);
        assert_eq!(scattered[0].1[0].start_byte, 6);
        assert_eq!(scattered[0].1[0].end_byte, 10);
        assert_eq!(scattered[1].0, 1);
        assert_eq!(scattered[1].1[0].start_byte, 0);
        assert_eq!(scattered[1].1[0].end_byte, 6);
    }

    #[test]
    fn scatter_drops_a_diagnostic_that_starts_in_a_separator() {
        let texts = strings(&["first text", "second text"]);
        let packs = pack_texts(&texts, 4096);
        let scattered = packs[0].scatter(&texts, vec![span(10, 12)]);
        assert!(
            scattered
                .iter()
                .all(|(_, diagnostics)| diagnostics.is_empty())
        );
    }

    #[test]
    fn scatter_clamps_a_diagnostic_that_runs_past_its_range() {
        let texts = strings(&["first text", "second text"]);
        let packs = pack_texts(&texts, 4096);
        let scattered = packs[0].scatter(&texts, vec![span(6, 14)]);
        assert_eq!(scattered[0].1[0].end_byte, 10);
    }
}
