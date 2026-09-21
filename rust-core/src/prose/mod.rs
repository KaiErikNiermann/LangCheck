mod bibtex;
mod forester;
pub mod gap;
pub mod latex;
mod org;
mod query;
mod rst;
mod shared;
mod sweave;
mod tinylang;
mod typst;

use anyhow::{Result, anyhow};
use std::ops::Range;
use std::path::Path;
use tracing::warn;
use tree_sitter::{Language, Parser};

use crate::checker::Diagnostic;
use crate::ignore_rules::{DirectiveRegion, IgnoreParser};
use crate::scoping::{ScopeParser, ScopedRegion};

use crate::sls::SchemaRegistry;

pub struct ProseExtractor {
    parser: Parser,
    language: Language,
}

impl ProseExtractor {
    pub fn new(language: Language) -> Result<Self> {
        let mut parser = Parser::new();
        parser.set_language(&language)?;
        Ok(Self { parser, language })
    }

    pub fn extract(
        &mut self,
        text: &str,
        lang_id: &str,
        latex_extras: &latex::LatexExtras,
    ) -> Result<Vec<ProseRange>> {
        let tree = self
            .parser
            .parse(text, None)
            .ok_or_else(|| anyhow!("Failed to parse text"))?;

        let root = tree.root_node();

        let ranges = match lang_id {
            "latex" => latex::extract(text, root, latex_extras),
            "sweave" => sweave::extract(text, root, latex_extras),
            "forester" => forester::extract(text, root),
            "tinylang" => tinylang::extract(text, root),
            "rst" => rst::extract(text, root),
            "bibtex" => bibtex::extract(text, root),
            "org" => org::extract(text, root),
            "typst" => typst::extract(text, root),
            lang => query::extract(text, root, &self.language, lang)?,
        };

        // Merge prose blocks split across markup boundaries (e.g. \p{…} math
        // \p{…}) so a continuation isn't flagged as a new, uncapitalized
        // sentence. Honors explicit `lang-check-begin block` overrides.
        let force_regions = crate::ignore_rules::IgnoreParser::block_regions(text);
        let mut ranges = shared::merge_continuations(ranges, text, &force_regions);
        // Here rather than only in the pipeline below, so the invariant holds
        // for every producer of ranges: what reaches an engine must not open
        // with the blanks an exclusion left behind.
        for range in &mut ranges {
            shared::trim_leading_blanks(range, text);
        }
        ranges.retain(|range| range.start_byte < range.end_byte);
        Ok(ranges)
    }
}

/// Extract prose using a built-in tree-sitter extractor or an SLS fallback.
///
/// When the file extension matches a loaded SLS schema and that extension has
/// no built-in tree-sitter extractor, the schema takes over. Built-in
/// extensions always keep precedence.
pub fn extract_with_fallback(
    text: &str,
    lang_id: &str,
    path: Option<&Path>,
    schema_registry: Option<&SchemaRegistry>,
    latex_extras: &latex::LatexExtras,
) -> Result<Vec<ProseRange>> {
    extract_reporting_syntax(text, lang_id, path, schema_registry, latex_extras)
        .map(|extraction| extraction.ranges)
}

/// One document's prose, and the grammar it was read with.
#[derive(Debug, Clone)]
pub struct Extraction {
    pub ranges: Vec<ProseRange>,
    /// What the text was actually parsed as, for the inspector to show: the
    /// canonical language id, or an SLS schema's name when one took over. The
    /// editor's own language id is not always what the core used, and that gap
    /// is exactly what a user checking the parse needs to see.
    pub syntax: String,
}

/// [`extract_with_fallback`], also reporting which grammar was chosen.
pub fn extract_reporting_syntax(
    text: &str,
    lang_id: &str,
    path: Option<&Path>,
    schema_registry: Option<&SchemaRegistry>,
    latex_extras: &latex::LatexExtras,
) -> Result<Extraction> {
    extract_with_range_limit(
        text,
        lang_id,
        path,
        schema_registry,
        latex_extras,
        crate::config::PerformanceConfig::default().max_range_bytes,
    )
}

/// [`extract_reporting_syntax`], with the range size limit supplied.
pub fn extract_with_range_limit(
    text: &str,
    lang_id: &str,
    path: Option<&Path>,
    schema_registry: Option<&SchemaRegistry>,
    latex_extras: &latex::LatexExtras,
    max_range_bytes: usize,
) -> Result<Extraction> {
    if let Some(ext) = path
        .and_then(|value| value.extension())
        .and_then(|value| value.to_str())
        && crate::languages::builtin_language_for_extension(ext).is_none()
        && let Some(schema) = schema_registry.and_then(|registry| registry.find_by_extension(ext))
    {
        return Ok(Extraction {
            ranges: shared::split_oversized(schema.extract(text), text, max_range_bytes),
            syntax: schema.name.clone(),
        });
    }

    let canonical_lang = crate::languages::resolve_language_id(lang_id);
    let language = crate::languages::resolve_ts_language(canonical_lang);
    let mut extractor = ProseExtractor::new(language)?;
    let mut ranges = extractor.extract(text, canonical_lang, latex_extras)?;

    let directives = IgnoreParser::parse_directives(text);
    let resolved = IgnoreParser::resolve_all(text, &directives);
    let type_regions: Vec<_> = resolved
        .regions
        .iter()
        .filter(|r| r.options.doc_type.is_some())
        .collect();
    if !type_regions.is_empty() {
        ranges = apply_type_overrides(text, ranges, &type_regions, latex_extras)?;
    }

    apply_language_overrides(
        text,
        &mut ranges,
        &resolved.regions,
        &ScopeParser::parse(text),
    );
    // Before the split, so a chunk never begins with the blanks an exclusion
    // left: the engines read a leading whitespace run as sentence structure.
    for range in &mut ranges {
        shared::trim_leading_blanks(range, text);
    }
    ranges.retain(|range| range.start_byte < range.end_byte);
    // Last, so a chunk inherits the language of the range it came from and a
    // split never lands inside an exclusion the extractors just installed.
    Ok(Extraction {
        ranges: shared::split_oversized(ranges, text, max_range_bytes),
        syntax: canonical_lang.to_string(),
    })
}

/// Stamp the language a comment declares onto the ranges it covers.
///
/// Three sources, strongest first:
///
/// 1. `lang-check-begin lang:xx` … `lang-check-end`, innermost region winning;
/// 2. a `lang: xx` scope marker, which runs until the next marker;
/// 3. whatever the markup itself said, which the extractor already set — a
///    Typst `#set text(lang: "de")`, for instance.
///
/// A directive is an instruction to the checker and beats what the markup says,
/// which is how a `#set text(lang: "de")` meant for hyphenation gets overridden
/// for one quoted passage without touching the typesetting.
fn apply_language_overrides(
    text: &str,
    ranges: &mut [ProseRange],
    regions: &[DirectiveRegion],
    scopes: &[ScopedRegion],
) {
    let with_language: Vec<&DirectiveRegion> = regions
        .iter()
        .filter(|region| region.options.language.is_some())
        .collect();
    if with_language.is_empty() && scopes.is_empty() {
        return;
    }
    for range in ranges {
        let innermost = with_language
            .iter()
            .filter(|region| region.byte_range.contains(&range.start_byte))
            .min_by_key(|region| region.byte_range.end - region.byte_range.start);
        if let Some(region) = innermost {
            range.language.clone_from(&region.options.language);
            range.language_span = region.directive_range.as_ref().map(|line| {
                declaration_span(text, line.clone(), region.options.language.as_deref())
            });
        } else if let Some(scope) = scopes
            .iter()
            .find(|s| s.byte_range.contains(&range.start_byte))
        {
            range.language = Some(scope.language.clone());
            range.language_span = Some(declaration_span(
                text,
                scope.marker_range.clone(),
                Some(&scope.language),
            ));
        }
    }
}

/// Narrow a declaration line to the `lang:` token that named the language.
///
/// The parsers record the whole line, because a line is what they scan. What
/// a reader changes is the key and the tag, so `<!-- lang-check-begin lang:he
/// -->` is reported against `lang:he` and `<!-- lang: fr -->` against `lang:
/// fr`. The `lang-check-begin` in front of it is how the region is opened,
/// not how its language was chosen.
///
/// `tag` is matched literally, so a line that mentions `lang:` more than once
/// -- `lang-check-begin match:/lang:xx/ lang:he` -- is narrowed to the token
/// that actually declared the language. The whole line is kept when no token
/// matches, which is what a declaration written some other way gets.
fn declaration_span(text: &str, line: Range<usize>, tag: Option<&str>) -> (usize, usize) {
    let whole = (line.start, line.end);
    let Some(tag) = tag.filter(|t| !t.is_empty()) else {
        return whole;
    };
    let slice = &text[line.clone()];

    for (key, _) in slice.match_indices("lang:") {
        // A token ending in `lang:` -- `slang:`, `xlang:` -- is not this key.
        if slice[..key]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
        {
            continue;
        }
        let after_colon = key + "lang:".len();
        let value =
            after_colon + slice[after_colon..].len() - slice[after_colon..].trim_start().len();
        if !slice[value..].starts_with(tag) {
            continue;
        }
        let end = value + tag.len();
        // `lang:he` must not match the `lang:hex` of a longer tag.
        if slice[end..]
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_')
        {
            continue;
        }
        return (line.start + key, line.start + end);
    }

    whole
}

/// Re-extract prose for regions tagged with `type:FORMAT`.
///
/// For each type-override region, slices the document text, runs the specified
/// format's extractor, and rebases the resulting ranges to document-level
/// offsets. Base ranges whose `start_byte` falls inside a type-override region
/// are removed and replaced with the re-extracted ranges.
fn apply_type_overrides(
    text: &str,
    base_ranges: Vec<ProseRange>,
    type_regions: &[&DirectiveRegion],
    latex_extras: &latex::LatexExtras,
) -> Result<Vec<ProseRange>> {
    let override_spans: Vec<&Range<usize>> = type_regions.iter().map(|r| &r.byte_range).collect();

    // Keep base ranges that don't start inside any type-override region.
    let mut result: Vec<ProseRange> = base_ranges
        .into_iter()
        .filter(|r| {
            !override_spans
                .iter()
                .any(|span| span.contains(&r.start_byte))
        })
        .collect();

    for region in type_regions {
        let doc_type = region.options.doc_type.as_deref().unwrap();
        let canonical = crate::languages::resolve_language_id(doc_type);

        if !crate::languages::SUPPORTED_LANGUAGE_IDS.contains(&canonical) {
            warn!(
                doc_type,
                "`type:` directive names an unsupported language; skipping region"
            );
            continue;
        }

        let slice = &text[region.byte_range.clone()];
        let ts_lang = crate::languages::resolve_ts_language(canonical);
        let mut ext = ProseExtractor::new(ts_lang)?;
        let sub_ranges = ext.extract(slice, canonical, latex_extras)?;

        let offset = region.byte_range.start;
        for mut r in sub_ranges {
            r.start_byte += offset;
            r.end_byte += offset;
            r.exclusions = r
                .exclusions
                .into_iter()
                .map(|(s, e)| (s + offset, e + offset))
                .collect();
            result.push(r);
        }
    }

    result.sort_by_key(|r| r.start_byte);
    Ok(result)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseRange {
    pub start_byte: usize,
    pub end_byte: usize,
    /// Byte ranges (document-level) within this prose range that should be
    /// excluded from grammar checking (e.g. display math). These regions are
    /// replaced with spaces when extracting text, preserving byte offsets.
    pub exclusions: Vec<(usize, usize)>,
    /// The natural language this prose is written in, as a BCP-47 tag, when the
    /// document says so — a `lang-check-begin lang:` directive, or the format's
    /// own declaration such as Typst's `#set text(lang: "fr")`. `None` means the
    /// configured `spell_language` applies.
    pub language: Option<String>,
    /// Where the language was declared, when something declared it.
    ///
    /// A `lang-check-begin lang:he`, a `<!-- lang: he -->` marker, or a Typst
    /// `#set text(lang: "he")`. `None` means nothing said so and the
    /// configured default applies.
    ///
    /// Carried because "nothing reads this language" is a finding about the
    /// declaration when there is one: the comment is what the reader changes,
    /// and the passage is only where the consequence shows. With no
    /// declaration the prose is all there is to point at.
    pub language_span: Option<(usize, usize)>,
}

impl ProseRange {
    /// Extract the prose text from the full document, replacing any excluded
    /// regions with spaces so that byte offsets remain stable.
    #[must_use]
    pub fn extract_text<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        let slice = &text[self.start_byte..self.end_byte];
        if self.exclusions.is_empty() {
            return std::borrow::Cow::Borrowed(slice);
        }
        // Each exclusion must be a char-aligned byte range: we blank it with
        // ASCII spaces, and overwriting only part of a multibyte character
        // would corrupt the UTF-8 buffer (UB via the `as_bytes_mut` write).
        // Exclusion boundaries originate from tree-sitter node offsets and
        // prose-range boundaries, which are always char-aligned — assert it in
        // debug builds so a regression fails loudly instead of silently.
        #[cfg(debug_assertions)]
        for &(exc_start, exc_end) in &self.exclusions {
            let s = exc_start.saturating_sub(self.start_byte).min(slice.len());
            let e = exc_end.saturating_sub(self.start_byte).min(slice.len());
            debug_assert!(
                slice.is_char_boundary(s) && slice.is_char_boundary(e),
                "exclusion ({s}, {e}) is not on a char boundary in {slice:?}"
            );
        }

        let mut buf = slice.to_string();
        // SAFETY: every write below blanks a whole, char-aligned byte range
        // with ASCII spaces (0x20), which preserves the UTF-8 validity of `buf`.
        let bytes = unsafe { buf.as_bytes_mut() };
        let mut blanked: Vec<(usize, usize)> = Vec::with_capacity(self.exclusions.len());
        for &(exc_start, exc_end) in &self.exclusions {
            // Convert document-level offsets to slice-local offsets, clamping
            // both ends into range so a stray exclusion can never index OOB.
            let local_start = exc_start.saturating_sub(self.start_byte).min(bytes.len());
            let local_end = exc_end.saturating_sub(self.start_byte).min(bytes.len());
            if local_start < local_end {
                bytes[local_start..local_end].fill(b' ');
                blanked.push((local_start, local_end));
            }
        }
        strip_unmatched_brackets(bytes);
        reseat_quotes_across_blanks(bytes, &blanked);
        std::borrow::Cow::Owned(buf)
    }

    /// Check whether a local byte range (relative to this prose range)
    /// overlaps with any exclusion zone.
    #[must_use]
    #[allow(clippy::cast_possible_truncation)]
    pub fn overlaps_exclusion(&self, local_start: u32, local_end: u32) -> bool {
        let doc_start = self.start_byte as u32 + local_start;
        let doc_end = self.start_byte as u32 + local_end;
        self.exclusions.iter().any(|&(exc_start, exc_end)| {
            let es = exc_start as u32;
            let ee = exc_end as u32;
            doc_start < ee && doc_end > es
        })
    }

    /// Classify how a diagnostic (range-local byte span) sits relative to the
    /// skipped (excluded) segments in this range. Excluded segments are blanked
    /// to spaces before checking, which breaks the surrounding sentence and
    /// provokes false positives on the flanking text — this drives which of
    /// those to suppress (see [`Self::suppresses_diagnostic`]).
    #[must_use]
    pub fn exclusion_adjacency(
        &self,
        text: &str,
        local_start: u32,
        local_end: u32,
    ) -> ExclusionAdjacency {
        if self.overlaps_exclusion(local_start, local_end) {
            return ExclusionAdjacency::Overlapping;
        }
        let doc_start = self.start_byte + local_start as usize;
        let doc_end = self.start_byte + local_end as usize;
        let mut best = ExclusionAdjacency::None;
        for &(es, ee) in &self.exclusions {
            // No overlap, so the diagnostic lies entirely before or after this
            // skip; the gap is the text between the two. When that gap is empty,
            // the skip edge char decides glued-vs-adjacent: exclusion ranges can
            // swallow a flanking space (e.g. inline-math delimiters), so a skip
            // edge that is itself whitespace still means a real word separated by
            // space, not a word-fragment fused to skip content.
            let rel = if doc_start >= ee {
                classify_gap(text, ee, doc_start, byte_before_separates(text, ee))
            } else {
                classify_gap(text, doc_end, es, byte_at_separates(text, es))
            };
            best = best.max_severity(rel);
            if best == ExclusionAdjacency::Glued {
                break; // strongest reachable here (overlap already handled)
            }
        }
        best
    }

    /// Whether a diagnostic should be dropped as a skip-induced false positive.
    ///
    /// - Overlapping a skip, or glued to one with no character between them
    ///   (blanking split a real word into a fragment): always suppressed.
    /// - Separated from a skip by whitespace only (a real word flanking the
    ///   cut): suppressed unless it is a spelling diagnostic. Removing a
    ///   neighbour cannot misspell a real word, so genuine typos beside formulas
    ///   are kept; the structural grammar/typography/style noise is dropped.
    /// - Otherwise: kept.
    #[must_use]
    pub fn suppresses_diagnostic(
        &self,
        text: &str,
        local_start: u32,
        local_end: u32,
        unified_id: &str,
    ) -> bool {
        match self.exclusion_adjacency(text, local_start, local_end) {
            ExclusionAdjacency::Overlapping | ExclusionAdjacency::Glued => true,
            ExclusionAdjacency::WhitespaceAdjacent => !is_spelling_category(unified_id),
            ExclusionAdjacency::None => false,
        }
    }

    /// Take ownership of an engine's findings for this range: drop the
    /// skip-induced false positives, then rebase the survivors from range-local
    /// onto document byte offsets.
    #[allow(clippy::cast_possible_truncation)]
    pub fn adopt_diagnostics(&self, text: &str, diagnostics: &mut Vec<Diagnostic>) {
        diagnostics
            .retain(|d| !self.suppresses_diagnostic(text, d.start_byte, d.end_byte, &d.unified_id));
        for d in diagnostics {
            d.start_byte += self.start_byte as u32;
            d.end_byte += self.start_byte as u32;
        }
    }
}

/// The checkable text of every range, in order — the input to
/// [`crate::orchestrator::Orchestrator::check_batch`].
#[must_use]
pub fn range_texts(ranges: &[ProseRange], text: &str) -> Vec<String> {
    ranges
        .iter()
        .map(|r| r.extract_text(text).into_owned())
        .collect()
}

/// One prose range's text, with the natural language to check it in.
///
/// The two travel together because a document can hold more than one language
/// and the engines have to be told which: Harper has no French, and
/// `LanguageTool` asked for the wrong language reports every correctly spelled
/// word as a misspelling.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProseUnit {
    pub text: String,
    /// A BCP-47 tag, resolved: the range's own language when the document
    /// declares one, and `default_language` otherwise.
    pub language: String,
}

/// The prose ranges as checkable units, each carrying its resolved language.
#[must_use]
pub fn range_units(ranges: &[ProseRange], text: &str, default_language: &str) -> Vec<ProseUnit> {
    ranges
        .iter()
        .map(|r| ProseUnit {
            text: r.extract_text(text).into_owned(),
            language: r.language.as_ref().map_or_else(
                || default_language.to_string(),
                |declared| crate::languages::resolve_spell_language(declared, default_language),
            ),
        })
        .collect()
}

/// Move an unchecked-language report onto the declaration that caused it.
///
/// The orchestrator emits the report at the start of the passage, because
/// that is all it can see -- it is handed text and a language, not a
/// document. Where the language came from a comment, the comment is the thing
/// to change, so the report is relocated here, after the offsets have been
/// rebased onto the document.
///
/// A passage with no declaration keeps the report at its first word.
pub fn place_language_reports(range: &ProseRange, diagnostics: &mut [crate::checker::Diagnostic]) {
    let Some((start, end)) = range.language_span else {
        return;
    };
    for diagnostic in diagnostics
        .iter_mut()
        .filter(|d| d.rule_id == "languagecheck.no-provider")
    {
        #[allow(clippy::cast_possible_truncation)]
        {
            diagnostic.start_byte = start as u32;
            diagnostic.end_byte = end as u32;
        }
    }
}

/// How a diagnostic span sits relative to a range's skipped segments.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExclusionAdjacency {
    /// The diagnostic span intersects a skip.
    Overlapping,
    /// The diagnostic directly abuts a skip with no character between them.
    Glued,
    /// The diagnostic is separated from a skip by whitespace only.
    WhitespaceAdjacent,
    /// The diagnostic is not near any skip.
    None,
}

impl ExclusionAdjacency {
    const fn rank(self) -> u8 {
        match self {
            Self::None => 0,
            Self::WhitespaceAdjacent => 1,
            Self::Glued => 2,
            Self::Overlapping => 3,
        }
    }

    /// The stronger (higher-priority) of two classifications.
    #[must_use]
    const fn max_severity(self, other: Self) -> Self {
        if other.rank() > self.rank() {
            other
        } else {
            self
        }
    }
}

/// Classify the document text in `[lo, hi)` as the gap between a diagnostic and
/// a skip: an all-whitespace (non-empty) gap is
/// [`ExclusionAdjacency::WhitespaceAdjacent`], anything else (a real word lies
/// between) is [`ExclusionAdjacency::None`]. When the gap is empty the two touch
/// directly, and `skip_edge_separates` (the skip's boundary char) decides:
/// a separator there means a real, whole word next to the cut
/// ([`ExclusionAdjacency::WhitespaceAdjacent`]); otherwise the diagnostic is a
/// word-fragment fused to skip content ([`ExclusionAdjacency::Glued`]).
fn classify_gap(text: &str, lo: usize, hi: usize, skip_edge_separates: bool) -> ExclusionAdjacency {
    if lo == hi {
        return if skip_edge_separates {
            ExclusionAdjacency::WhitespaceAdjacent
        } else {
            ExclusionAdjacency::Glued
        };
    }
    match text.get(lo..hi) {
        Some(gap) if gap.chars().all(char::is_whitespace) => ExclusionAdjacency::WhitespaceAdjacent,
        _ => ExclusionAdjacency::None,
    }
}

/// Whether a skip's boundary character guarantees the word beside it is whole.
///
/// Whitespace does: an exclusion that swallowed a space still leaves a real
/// word on the other side. A square bracket does too, because it delimits a
/// group rather than carrying text -- in `#emph[a word]` the exclusion is
/// `" #emph["` and `a` touches its `[`, but `a` is a complete word, not the
/// tail of a blanked one. Other characters do not: `$k$th` blanks to `   th`,
/// where `th` really is a fragment fused to the formula.
///
/// The inline-emphasis delimiters are the bracket case in another spelling.
/// `_réception_` blanks to ` réception `, a whole word touching the skip on
/// both sides, and without them here every emphasised word in a Markdown or
/// Typst document is dropped as a fragment and never checked at all. The cost
/// is `a**b**c`, where the delimiters really do sit inside a word and the
/// halves are now offered to the speller; intra-word emphasis is rare enough
/// to be the better trade against silently skipping every italic.
const fn separates_words(c: char) -> bool {
    c.is_whitespace() || matches!(c, '[' | ']' | '_' | '*' | '`')
}

/// Whether the character ending at byte `pos` (i.e. just before it) separates words.
fn byte_before_separates(text: &str, pos: usize) -> bool {
    text.get(..pos)
        .and_then(|s| s.chars().next_back())
        .is_some_and(separates_words)
}

/// Whether the character starting at byte `pos` separates words.
fn byte_at_separates(text: &str, pos: usize) -> bool {
    text.get(pos..)
        .and_then(|s| s.chars().next())
        .is_some_and(separates_words)
}

/// Whether a unified rule id denotes a spelling diagnostic (e.g. `spelling.typo`).
#[must_use]
pub fn is_spelling_category(unified_id: &str) -> bool {
    unified_id.starts_with("spelling.")
}

/// Replace provably-unmatched brackets `()[]{}` with spaces.
///
/// Uses a single O(n) pass with per-type stacks. Only brackets that have no
/// matching partner anywhere in the text are replaced — correctly paired
/// brackets (even across exclusion gaps) are left untouched.
fn strip_unmatched_brackets(bytes: &mut [u8]) {
    let mut paren_stack: Vec<usize> = Vec::new();
    let mut bracket_stack: Vec<usize> = Vec::new();
    let mut brace_stack: Vec<usize> = Vec::new();
    let mut unmatched: Vec<usize> = Vec::new();

    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'(' => paren_stack.push(i),
            b')' if paren_stack.pop().is_none() => {
                unmatched.push(i);
            }
            b'[' => bracket_stack.push(i),
            b']' if bracket_stack.pop().is_none() => {
                unmatched.push(i);
            }
            b'{' => brace_stack.push(i),
            b'}' if brace_stack.pop().is_none() => {
                unmatched.push(i);
            }
            _ => {}
        }
    }

    unmatched.extend(paren_stack);
    unmatched.extend(bracket_stack);
    unmatched.extend(brace_stack);

    for idx in unmatched {
        bytes[idx] = b' ';
    }
}

/// Whether the character covering byte `i` is alphanumeric — the neighbour test
/// behind a quote's role: a quote hugging a word is an opener on the word's left
/// and a closer on its right.
///
/// `bytes` is always a valid UTF-8 buffer, so the character `i` falls inside is
/// decoded rather than assuming every non-ASCII byte is a letter — an em-dash
/// must not read as a word.
fn is_word_byte(bytes: &[u8], i: usize) -> bool {
    if i >= bytes.len() {
        return false;
    }
    // Walk back off any continuation byte (`0b10xxxxxx`) to the char's lead byte.
    let mut start = i;
    while start > 0 && bytes[start] & 0b1100_0000 == 0b1000_0000 {
        start -= 1;
    }
    (1..=4)
        .find_map(|len| std::str::from_utf8(bytes.get(start..start + len)?).ok())
        .and_then(|s| s.chars().next())
        .is_some_and(char::is_alphanumeric)
}

/// Slide straight double quotes across an adjacent blanked region so that
/// blanking cannot flip their open/close role.
///
/// Exclusions are blanked to spaces in place to keep byte offsets stable, which
/// strands a quote against whitespace that was not there in the source:
/// `"#{m} is a map"` becomes `"␣␣␣␣␣is a map"`. Grammar engines infer a quote's
/// role from its neighbours — `LanguageTool`'s `EN_UNPAIRED_QUOTES` reads a
/// quote followed by a space as a *closing* quote — so the opener is misread and
/// the genuine closer is reported as unpaired. Swapping the quote with the space
/// that now hugs the word restores the neighbour it had in the source, and since
/// it is a swap the buffer's length and offsets are untouched.
///
/// Only ASCII `"` is reseated: curly quotes are multi-byte and could not be
/// swapped with a one-byte space, and `'` is ambiguous with apostrophes. The
/// scan crosses plain spaces only, so a quote never migrates over a line break.
///
/// A reseated quote can land inside the skip it crossed, so a report about a
/// quote that really is unpaired next to math is dropped by
/// [`ProseRange::suppresses_diagnostic`] — the same trade the skip machinery
/// already makes for structural noise around excluded regions.
fn reseat_quotes_across_blanks(bytes: &mut [u8], blanked: &[(usize, usize)]) {
    for &(start, end) in blanked {
        if start >= end {
            continue;
        }
        // `"␣␣R` → `␣␣"R`: an opener (no word in front of it) stranded before the
        // blank, with a word past the run to re-attach to.
        if start > 0
            && bytes[start - 1] == b'"'
            && !start.checked_sub(2).is_some_and(|i| is_word_byte(bytes, i))
        {
            let word = (end..bytes.len())
                .find(|&i| bytes[i] != b' ')
                .filter(|&i| is_word_byte(bytes, i));
            if let Some(word) = word {
                bytes[start - 1] = b' ';
                bytes[word - 1] = b'"';
                continue;
            }
        }
        // `R␣␣"` → `R"␣␣`: the mirror case, a closer stranded behind the blank.
        if bytes.get(end) == Some(&b'"') && !is_word_byte(bytes, end + 1) {
            let after_word = (0..start)
                .rev()
                .find(|&i| bytes[i] != b' ')
                .filter(|&i| is_word_byte(bytes, i))
                .map(|i| i + 1);
            if let Some(after_word) = after_word {
                bytes[end] = b' ';
                bytes[after_word] = b'"';
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use latex::LatexExtras;

    // ---- extract_text byte-blanking (FFI-free; also exercised under Miri) ----

    #[test]
    fn a_declaration_span_covers_the_tag_and_its_key() {
        let text = "<!-- lang-check-begin lang:he -->\n";
        let span = declaration_span(text, 0..32, Some("he"));
        assert_eq!(&text[span.0..span.1], "lang:he");
    }

    #[test]
    fn a_declaration_span_keeps_the_space_a_marker_writes() {
        let text = "<!-- lang: fr -->\n";
        let span = declaration_span(text, 0..17, Some("fr"));
        assert_eq!(&text[span.0..span.1], "lang: fr");
    }

    #[test]
    fn a_declaration_span_skips_a_tag_a_filter_only_mentions() {
        let text = "<!-- lang-check-begin match:/lang:xx/ lang:he -->\n";
        let span = declaration_span(text, 0..48, Some("he"));
        assert_eq!(&text[span.0..span.1], "lang:he");
    }

    #[test]
    fn a_declaration_span_does_not_stop_inside_a_longer_tag() {
        let text = "<!-- lang-check-begin lang:de-CH -->\n";
        let span = declaration_span(text, 0..35, Some("de-CH"));
        assert_eq!(&text[span.0..span.1], "lang:de-CH");
    }

    #[test]
    fn a_line_with_no_such_token_keeps_the_whole_line() {
        // A Typst set rule writes the tag in quotes and is recorded by the
        // Typst extractor, which does not come through here. This is the
        // fallback any other declaration form gets.
        let text = "#set text(lang: \"he\")\n";
        let span = declaration_span(text, 0..21, Some("he"));
        assert_eq!(span, (0, 21));
    }

    #[test]
    fn extract_text_no_exclusions_is_borrowed() {
        let text = "café — touché";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: Vec::new(),
            language: None,
            language_span: None,
        };
        let out = range.extract_text(text);
        assert!(matches!(out, std::borrow::Cow::Borrowed(_)));
        assert_eq!(out, text);
    }

    #[test]
    fn extract_text_blanks_excluded_ascii_keeping_multibyte() {
        // "café" keeps its multibyte 'é'; the ascii 'X' region is blanked.
        let text = "café X tea";
        let x = text.find('X').unwrap();
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(x, x + 1)],
            language: None,
            language_span: None,
        };
        let out = range.extract_text(text);
        assert_eq!(out, "café   tea");
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
    }

    #[test]
    fn extract_text_blanks_a_whole_multibyte_char() {
        // Excluding the em-dash (3 UTF-8 bytes) must blank all 3 and stay valid.
        let text = "a—b";
        let dash_start = text.find('—').unwrap();
        let dash_end = dash_start + '—'.len_utf8();
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(dash_start, dash_end)],
            language: None,
            language_span: None,
        };
        let out = range.extract_text(text);
        assert_eq!(out, "a   b");
    }

    #[test]
    fn extract_text_handles_document_level_offsets() {
        // Range starts partway into the document; exclusions are document-level.
        let text = "PREFIX café — done";
        let start = text.find("café").unwrap();
        let dash = text.find('—').unwrap();
        let range = ProseRange {
            start_byte: start,
            end_byte: text.len(),
            exclusions: vec![(dash, dash + '—'.len_utf8())],
            language: None,
            language_span: None,
        };
        // " — " → space + 3 blanked em-dash bytes + space = 5 spaces.
        let out = range.extract_text(text);
        assert_eq!(out, "café     done");
    }

    fn range_excluding(text: &str, excluded: &str) -> ProseRange {
        let start = text.find(excluded).unwrap();
        ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(start, start + excluded.len())],
            language: None,
            language_span: None,
        }
    }

    #[test]
    fn extract_text_reseats_opening_quote_stranded_by_a_blank() {
        // Without the reseat the opener reads as a closer (it is followed by the
        // blank), so engines report the real closing quote as unpaired.
        let text = r##"He said "#{m} is fine"."##;
        let out = range_excluding(text, "#{m}").extract_text(text);
        assert_eq!(out, r#"He said      "is fine"."#);
    }

    #[test]
    fn extract_text_reseats_closing_quote_stranded_by_a_blank() {
        let text = r#"He said "it is #{m}"."#;
        let out = range_excluding(text, "#{m}").extract_text(text);
        assert_eq!(out, r#"He said "it is"     ."#);
    }

    #[test]
    fn extract_text_leaves_quotes_that_still_hug_their_word() {
        let text = r#"He said "fine #{m} here"."#;
        let out = range_excluding(text, "#{m}").extract_text(text);
        assert_eq!(out, r#"He said "fine      here"."#);
    }

    #[test]
    fn extract_text_reseat_keeps_utf8_valid_around_multibyte_words() {
        let text = r##"Il dit "#{m} café"."##;
        let out = range_excluding(text, "#{m}").extract_text(text);
        assert_eq!(out, r#"Il dit      "café"."#);
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
    }

    fn diagnostic(start: u32, end: u32, unified_id: &str) -> Diagnostic {
        Diagnostic {
            start_byte: start,
            end_byte: end,
            message: String::new(),
            suggestions: Vec::new(),
            rule_id: String::new(),
            severity: 2,
            unified_id: unified_id.to_string(),
            confidence: 1.0,
            language: String::new(),
            pack_installable: false,
        }
    }

    #[test]
    fn adopt_diagnostics_rebases_survivors_onto_document_offsets() {
        let text = "PREFIX one two";
        let start = text.find("one").unwrap();
        let range = ProseRange {
            start_byte: start,
            end_byte: text.len(),
            exclusions: Vec::new(),
            language: None,
            language_span: None,
        };
        // "two" is at range-local 4..7.
        let mut diagnostics = vec![diagnostic(4, 7, "spelling.typo")];
        range.adopt_diagnostics(text, &mut diagnostics);

        assert_eq!(diagnostics.len(), 1);
        let d = &diagnostics[0];
        assert_eq!(
            &text[d.start_byte as usize..d.end_byte as usize],
            "two",
            "rebased span must slice the same word out of the document"
        );
    }

    #[test]
    fn adopt_diagnostics_drops_skip_induced_false_positives() {
        let text = "one XXX two";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(4, 7)],
            language: None,
            language_span: None,
        };
        // Overlapping the skip, and a non-spelling diagnostic beside it.
        let mut diagnostics = vec![
            diagnostic(4, 7, "spelling.typo"),
            diagnostic(8, 11, "typography.capitalization"),
        ];
        range.adopt_diagnostics(text, &mut diagnostics);

        assert!(diagnostics.is_empty(), "got: {diagnostics:?}");
    }

    #[test]
    fn range_texts_matches_per_range_extraction() {
        let text = "alpha SKIP beta";
        let ranges = vec![
            ProseRange {
                start_byte: 0,
                end_byte: 5,
                exclusions: Vec::new(),
                language: None,
                language_span: None,
            },
            ProseRange {
                start_byte: 6,
                end_byte: text.len(),
                exclusions: vec![(6, 10)],
                language: None,
                language_span: None,
            },
        ];
        let texts = range_texts(&ranges, text);

        assert_eq!(texts.len(), ranges.len());
        for (range, extracted) in ranges.iter().zip(&texts) {
            assert_eq!(*extracted, range.extract_text(text));
        }
    }

    #[test]
    fn extract_text_reseat_does_not_cross_a_line_break() {
        // A quote must not migrate onto the next line, so the scan stops at `\n`.
        let text = "He said \"#{m}\nis fine\".";
        let out = range_excluding(text, "#{m}").extract_text(text);
        assert_eq!(out, "He said \"    \nis fine\".");
    }

    #[test]
    fn test_markdown_extraction() -> Result<()> {
        let language: tree_sitter::Language = tree_sitter_md::LANGUAGE.into();
        let mut extractor = ProseExtractor::new(language)?;

        let text =
            "# Header\n\nThis is a paragraph.\n\n```rust\nfn main() {}\n```\n\nAnother paragraph.";
        let ranges = extractor.extract(text, "markdown", &LatexExtras::default())?;

        assert!(ranges.len() >= 3);

        let extracted_texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();
        assert!(extracted_texts.iter().any(|t| t.contains("Header")));
        assert!(
            extracted_texts
                .iter()
                .any(|t| t.contains("This is a paragraph"))
        );
        assert!(
            extracted_texts
                .iter()
                .any(|t| t.contains("Another paragraph"))
        );

        Ok(())
    }

    #[test]
    fn test_overlaps_exclusion() {
        let range = ProseRange {
            start_byte: 100,
            end_byte: 300,
            exclusions: vec![(150, 200)],
            language: None,
            language_span: None,
        };

        // Diagnostic entirely inside exclusion
        assert!(range.overlaps_exclusion(50, 100)); // local 50..100 = doc 150..200
        // Diagnostic partially overlapping exclusion
        assert!(range.overlaps_exclusion(40, 60)); // doc 140..160 overlaps 150..200
        assert!(range.overlaps_exclusion(90, 110)); // doc 190..210 overlaps 150..200
        // Diagnostic entirely outside exclusion
        assert!(!range.overlaps_exclusion(0, 40)); // doc 100..140, before exclusion
        assert!(!range.overlaps_exclusion(110, 130)); // doc 210..230, after exclusion
    }

    #[test]
    fn test_exclusion_adjacency_classifies_position() {
        // "a #{i} is b" — skip #{i} occupies bytes [2, 6).
        let text = "a #{i} is b";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(2, 6)],
            language: None,
            language_span: None,
        };
        // "is" at [7, 9): one space after the skip → whitespace-adjacent.
        assert_eq!(
            range.exclusion_adjacency(text, 7, 9),
            ExclusionAdjacency::WhitespaceAdjacent
        );
        // A span landing inside the skip → overlapping.
        assert_eq!(
            range.exclusion_adjacency(text, 3, 5),
            ExclusionAdjacency::Overlapping
        );
        // "b" at [10, 11): a real word ("is") lies between it and the skip → none.
        assert_eq!(
            range.exclusion_adjacency(text, 10, 11),
            ExclusionAdjacency::None
        );
    }

    #[test]
    fn test_exclusion_adjacency_detects_glued_fragment() {
        // "#{n}th word" — skip #{n} is [0, 4); "th" is glued to it at [4, 6).
        let text = "#{n}th word";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(0, 4)],
            language: None,
            language_span: None,
        };
        assert_eq!(
            range.exclusion_adjacency(text, 4, 6),
            ExclusionAdjacency::Glued
        );
    }

    #[test]
    fn test_exclusion_swallowing_flanking_space_is_not_glued() {
        // Inline-math delimiter exclusions can include the flanking space, so the
        // skip range starts at the space (byte 3), not at `#`. A real word ending
        // exactly where the exclusion begins must still read as whitespace-
        // separated, not glued.  Regression for spelling typos beside #{X}.
        let text = "teh #{G} ok"; // exclusion ` #{` = bytes [3, 6)
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(3, 6)],
            language: None,
            language_span: None,
        };
        assert_eq!(
            range.exclusion_adjacency(text, 0, 3),
            ExclusionAdjacency::WhitespaceAdjacent
        );
        // A genuine typo here is kept; only the grammar/structure noise is dropped.
        assert!(!range.suppresses_diagnostic(text, 0, 3, "spelling.typo"));
        assert!(range.suppresses_diagnostic(text, 0, 3, "typography.capitalization"));
    }

    #[test]
    fn test_suppresses_diagnostic_keeps_spelling_near_skip() {
        // "a #{i} wrd b" — skip at [2, 6); the misspelling "wrd" is at [7, 10),
        // whitespace-adjacent to the skip.
        let text = "a #{i} wrd b";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(2, 6)],
            language: None,
            language_span: None,
        };
        // Grammar/typography noise flanking the cut is suppressed...
        assert!(range.suppresses_diagnostic(text, 7, 10, "typography.capitalization"));
        // ...but a genuine adjacent typo is kept.
        assert!(!range.suppresses_diagnostic(text, 7, 10, "spelling.typo"));
    }

    #[test]
    fn test_content_bracket_edge_is_not_glued() {
        // "a #emph[wrd] b" — the merged exclusion ` #emph[` is [1, 8), so the
        // word "wrd" starts exactly where it ends. The skip's last char is `[`,
        // a group delimiter, so "wrd" is a whole word and not a fragment.
        let text = "a #emph[wrd] b";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(1, 8), (11, 13)],
            language: None,
            language_span: None,
        };
        assert_eq!(
            range.exclusion_adjacency(text, 8, 11),
            ExclusionAdjacency::WhitespaceAdjacent
        );
        // First and last word of the content block both keep their typos.
        assert!(!range.suppresses_diagnostic(text, 8, 11, "spelling.typo"));
    }

    #[test]
    fn test_math_delimiter_edge_is_still_glued() {
        // The bracket exception must not reach `$`: blanking `$k$` out of
        // "$k$th" leaves "th", which really is a fragment.
        let text = "$k$th word";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(0, 3)],
            language: None,
            language_span: None,
        };
        assert_eq!(
            range.exclusion_adjacency(text, 3, 5),
            ExclusionAdjacency::Glued
        );
        assert!(range.suppresses_diagnostic(text, 3, 5, "spelling.typo"));
    }

    #[test]
    fn test_suppresses_diagnostic_drops_glued_fragment_spelling() {
        // "#{n}th word" — "th" is a fragment created by cutting the skip, so even
        // a spelling diagnostic on it is suppressed.
        let text = "#{n}th word";
        let range = ProseRange {
            start_byte: 0,
            end_byte: text.len(),
            exclusions: vec![(0, 4)],
            language: None,
            language_span: None,
        };
        assert!(range.suppresses_diagnostic(text, 4, 6, "spelling.typo"));
        // A real word with text between it and the skip is untouched.
        assert!(!range.suppresses_diagnostic(text, 7, 11, "spelling.typo"));
    }

    #[test]
    fn type_override_latex_in_markdown() -> Result<()> {
        let text = "\
# Title

Some intro text.

<!-- lang-check-begin type:latex -->
\\emph{Hello} world and \\textbf{bold} text.
<!-- lang-check-end -->

Final paragraph.";

        let ranges = extract_with_fallback(text, "markdown", None, None, &LatexExtras::default())?;

        let texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // Surrounding markdown prose is preserved.
        assert!(texts.iter().any(|t| t.contains("Title")));
        assert!(texts.iter().any(|t| t.contains("intro text")));
        assert!(texts.iter().any(|t| t.contains("Final paragraph")));

        // The LaTeX region was re-extracted: the prose content from
        // \emph{Hello} and \textbf{bold} should appear in ranges.
        assert!(
            texts.iter().any(|t| t.contains("Hello")),
            "expected LaTeX extractor to produce range containing 'Hello', got: {texts:?}"
        );

        Ok(())
    }

    #[test]
    fn type_override_unknown_skipped() -> Result<()> {
        let text = "\
# Title

<!-- lang-check-begin type:foobar -->
Some content here.
<!-- lang-check-end -->

Trailing text.";

        let ranges = extract_with_fallback(text, "markdown", None, None, &LatexExtras::default())?;

        let texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // Surrounding ranges preserved.
        assert!(texts.iter().any(|t| t.contains("Title")));
        assert!(texts.iter().any(|t| t.contains("Trailing text")));

        // The unknown-type region's base ranges were filtered out, and no
        // re-extraction happened, so "Some content" should be absent.
        assert!(
            !texts.iter().any(|t| t.contains("Some content")),
            "expected unknown type region to be skipped, got: {texts:?}"
        );

        Ok(())
    }

    #[test]
    fn type_override_preserves_surrounding() -> Result<()> {
        let text = "\
First paragraph before.

<!-- lang-check-begin type:latex -->
\\section{Test}
Some LaTeX prose.
<!-- lang-check-end -->

Last paragraph after.";

        let ranges = extract_with_fallback(text, "markdown", None, None, &LatexExtras::default())?;

        let texts: Vec<&str> = ranges
            .iter()
            .map(|r| &text[r.start_byte..r.end_byte])
            .collect();

        // Both surrounding paragraphs must be present and unmodified.
        assert!(
            texts.iter().any(|t| t.contains("First paragraph before")),
            "pre-region range missing: {texts:?}"
        );
        assert!(
            texts.iter().any(|t| t.contains("Last paragraph after")),
            "post-region range missing: {texts:?}"
        );

        Ok(())
    }

    #[test]
    fn strip_unmatched_orphan_close() {
        let mut bytes = b"hello } world".to_vec();
        strip_unmatched_brackets(&mut bytes);
        assert_eq!(&bytes, b"hello   world");
    }

    #[test]
    fn strip_unmatched_orphan_open() {
        let mut bytes = b"hello ( world".to_vec();
        strip_unmatched_brackets(&mut bytes);
        assert_eq!(&bytes, b"hello   world");
    }

    #[test]
    fn strip_unmatched_preserves_matched() {
        let mut bytes = b"f(x) and [y]".to_vec();
        strip_unmatched_brackets(&mut bytes);
        assert_eq!(&bytes, b"f(x) and [y]");
    }

    #[test]
    fn strip_unmatched_mixed() {
        // '}' is unmatched, '(x)' is matched
        let mut bytes = b"value } is f(x)".to_vec();
        strip_unmatched_brackets(&mut bytes);
        assert_eq!(&bytes, b"value   is f(x)");
    }

    #[test]
    fn strip_unmatched_via_extract_text() {
        let range = ProseRange {
            start_byte: 0,
            end_byte: 20,
            exclusions: vec![(5, 10)],
            language: None,
            language_span: None,
        };
        // "text } rest" after blanking exclusion [5,10) -> "text      rest"
        // but if original is "text #{x+y} rest", after blanking the #{x+y}
        // region we get "text        rest" with no unmatched brackets.
        let text = "text #{x+y} rest____";
        let clean = range.extract_text(text);
        // The #{x+y} was blanked, no unmatched brackets remain
        assert!(!clean.contains('#'));
        assert!(!clean.contains('{'));
        assert!(!clean.contains('}'));
    }

    /// `(prose, resolved language)` for every range, through the whole
    /// extraction path so the language sources are exercised in the order they
    /// actually resolve.
    fn languages_of(text: &str, lang_id: &str, default_language: &str) -> Vec<(String, String)> {
        let ranges =
            extract_with_fallback(text, lang_id, None, None, &latex::LatexExtras::default())
                .expect("extraction");
        range_units(&ranges, text, default_language)
            .into_iter()
            .map(|unit| (unit.text.trim().to_string(), unit.language))
            .collect()
    }

    #[test]
    fn a_scope_marker_runs_until_the_next_one() {
        let text = "English here.\n\n<!-- lang: fr -->\n\nDu francais ici.\n\n                    <!-- lang: en-GB -->\n\nEnglish again.\n";
        let tagged: Vec<String> = languages_of(text, "markdown", "en-US")
            .into_iter()
            .map(|(_, lang)| lang)
            .collect();
        assert_eq!(tagged, vec!["en-US", "fr", "en-GB"]);
    }

    #[test]
    fn a_begin_directive_beats_a_scope_marker() {
        let text = "<!-- lang: fr -->\n\nDu francais ici.\n\n                    <!-- lang-check-begin lang:de -->\nEin deutscher Satz.\n                    <!-- lang-check-end -->\n";
        let languages = languages_of(text, "markdown", "en-US");
        assert_eq!(languages[0].1, "fr");
        assert_eq!(
            languages[1].1, "de-DE",
            "the directive wins, and `de` resolves to a variant"
        );
    }

    #[test]
    fn prose_before_the_first_marker_takes_the_configured_language() {
        let text = "Before any marker.\n\n<!-- lang: fr -->\n\nApres.\n";
        assert_eq!(languages_of(text, "markdown", "en-GB")[0].1, "en-GB");
    }
}
