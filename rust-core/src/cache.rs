use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};

use lru::LruCache;

use crate::checker::Diagnostic;
use crate::prose::ProseRange;

/// A cached parse result for a single file.
#[derive(Debug, Clone)]
pub struct ParseCacheEntry {
    pub content_hash: u64,
    pub prose_ranges: Vec<ProseRange>,
}

/// LRU cache for parsed prose extraction results keyed by file path.
///
/// Only returns cached results when the content hash matches, ensuring
/// stale entries are automatically invalidated on file change.
pub struct ParseCache {
    cache: LruCache<PathBuf, ParseCacheEntry>,
}

impl ParseCache {
    /// Create a new cache with the given capacity (number of files).
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: LruCache::new(
                NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(128).unwrap()),
            ),
        }
    }

    /// Look up cached prose ranges for a file. Returns `None` if the file is not
    /// cached or the content has changed since the last parse.
    #[must_use]
    pub fn get(&mut self, path: &Path, content: &str) -> Option<Vec<ProseRange>> {
        let hash = crate::hashing::content_hash(content);
        self.cache
            .get(path)
            .filter(|entry| entry.content_hash == hash)
            .map(|entry| entry.prose_ranges.clone())
    }

    /// Insert (or update) a cache entry for the given file.
    pub fn put(&mut self, path: PathBuf, content: &str, prose_ranges: Vec<ProseRange>) {
        let entry = ParseCacheEntry {
            content_hash: crate::hashing::content_hash(content),
            prose_ranges,
        };
        self.cache.put(path, entry);
    }

    /// Number of entries currently in the cache.
    #[must_use]
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Whether the cache is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Evict a specific file from the cache.
    pub fn invalidate(&mut self, path: &Path) {
        self.cache.pop(path);
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.cache.clear();
    }
}

/// What identifies one engine's answer for one prose range.
///
/// The language and the engine are part of it because the same prose gets a
/// different answer from Harper than from `LanguageTool`, and a different one
/// again in `en-GB` than in `en-US`. Everything else that changes an answer
/// lives in the engine's own config, and a config change rebuilds the engines,
/// which clears the cache outright.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ResultKey {
    engine: &'static str,
    language: String,
    content: u64,
}

/// LRU cache of engine answers, keyed by the prose that produced them.
///
/// A keystroke re-checks the whole document: the prose is re-extracted and
/// every range goes back to the engines, though only the edited one changed.
/// For `LanguageTool` that is the difference between one small request and a
/// hundred — measured on a 36 kB Typst file against a 4-CPU server, 838 ms per
/// keystroke pause against 108 ms.
///
/// Answers are cached as the engine returned them: offsets relative to the
/// range, rule ids not yet normalised. Normalisation and the severity
/// overrides run over cached answers as over fresh ones, so changing a rule's
/// severity takes effect without waiting for the cache to turn over.
pub struct ResultCache {
    /// `None` when the cache is switched off, so the caller needs no second
    /// code path for that.
    cache: Option<LruCache<ResultKey, Vec<Diagnostic>>>,
}

impl ResultCache {
    /// A cache holding `capacity` answers, or a disabled one when that is zero.
    ///
    /// A disabled cache misses every lookup and stores nothing.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: NonZeroUsize::new(capacity).map(LruCache::new),
        }
    }

    fn key(engine: &'static str, language: &str, text: &str) -> ResultKey {
        ResultKey {
            engine,
            language: language.to_string(),
            content: crate::hashing::content_hash(text),
        }
    }

    /// The engine's last answer for this prose, if it is still held.
    #[must_use]
    pub fn get(
        &mut self,
        engine: &'static str,
        language: &str,
        text: &str,
    ) -> Option<Vec<Diagnostic>> {
        self.cache
            .as_mut()?
            .get(&Self::key(engine, language, text))
            .cloned()
    }

    /// Remember what the engine answered for this prose.
    pub fn put(
        &mut self,
        engine: &'static str,
        language: &str,
        text: &str,
        diagnostics: Vec<Diagnostic>,
    ) {
        if let Some(cache) = self.cache.as_mut() {
            cache.put(Self::key(engine, language, text), diagnostics);
        }
    }

    /// Number of answers currently held.
    #[must_use]
    pub fn len(&self) -> usize {
        self.cache.as_ref().map_or(0, LruCache::len)
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drop everything, for when a config change invalidates every answer.
    pub fn clear(&mut self) {
        if let Some(cache) = self.cache.as_mut() {
            cache.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_miss_on_empty() {
        let mut cache = ParseCache::new(10);
        assert!(cache.get(Path::new("foo.md"), "hello").is_none());
    }

    #[test]
    fn cache_hit_after_put() {
        let mut cache = ParseCache::new(10);
        let ranges = vec![ProseRange {
            start_byte: 0,
            end_byte: 5,
            exclusions: vec![],
        }];
        cache.put(PathBuf::from("foo.md"), "hello", ranges.clone());
        let result = cache.get(Path::new("foo.md"), "hello");
        assert_eq!(result, Some(ranges));
    }

    #[test]
    fn cache_invalidated_on_content_change() {
        let mut cache = ParseCache::new(10);
        let ranges = vec![ProseRange {
            start_byte: 0,
            end_byte: 5,
            exclusions: vec![],
        }];
        cache.put(PathBuf::from("foo.md"), "hello", ranges);
        assert!(cache.get(Path::new("foo.md"), "hello world").is_none());
    }

    #[test]
    fn cache_eviction_at_capacity() {
        let mut cache = ParseCache::new(2);
        let r = vec![ProseRange {
            start_byte: 0,
            end_byte: 1,
            exclusions: vec![],
        }];
        cache.put(PathBuf::from("a.md"), "a", r.clone());
        cache.put(PathBuf::from("b.md"), "b", r.clone());
        cache.put(PathBuf::from("c.md"), "c", r.clone());

        // "a.md" should have been evicted (LRU)
        assert!(cache.get(Path::new("a.md"), "a").is_none());
        assert!(cache.get(Path::new("b.md"), "b").is_some());
        assert!(cache.get(Path::new("c.md"), "c").is_some());
    }

    #[test]
    fn explicit_invalidation() {
        let mut cache = ParseCache::new(10);
        let r = vec![ProseRange {
            start_byte: 0,
            end_byte: 1,
            exclusions: vec![],
        }];
        cache.put(PathBuf::from("foo.md"), "x", r);
        cache.invalidate(Path::new("foo.md"));
        assert!(cache.get(Path::new("foo.md"), "x").is_none());
    }

    #[test]
    fn len_and_clear() {
        let mut cache = ParseCache::new(10);
        assert!(cache.is_empty());
        cache.put(PathBuf::from("a.md"), "a", vec![]);
        cache.put(PathBuf::from("b.md"), "b", vec![]);
        assert_eq!(cache.len(), 2);
        cache.clear();
        assert!(cache.is_empty());
    }

    fn diagnostic(rule: &str) -> Diagnostic {
        Diagnostic {
            start_byte: 0,
            end_byte: 4,
            message: String::new(),
            suggestions: Vec::new(),
            rule_id: rule.to_string(),
            severity: 2,
            unified_id: String::new(),
            confidence: 1.0,
        }
    }

    #[test]
    fn an_answer_comes_back_for_the_same_prose() {
        let mut cache = ResultCache::new(10);
        assert!(cache.get("harper", "en-US", "some prose").is_none());
        cache.put(
            "harper",
            "en-US",
            "some prose",
            vec![diagnostic("harper.Spelling")],
        );
        let hit = cache.get("harper", "en-US", "some prose").expect("hit");
        assert_eq!(hit[0].rule_id, "harper.Spelling");
    }

    #[test]
    fn changed_prose_misses() {
        let mut cache = ResultCache::new(10);
        cache.put(
            "harper",
            "en-US",
            "some prose",
            vec![diagnostic("harper.Spelling")],
        );
        assert!(cache.get("harper", "en-US", "some prose edited").is_none());
    }

    #[test]
    fn another_engine_or_language_misses() {
        let mut cache = ResultCache::new(10);
        cache.put(
            "harper",
            "en-US",
            "some prose",
            vec![diagnostic("harper.Spelling")],
        );
        assert!(cache.get("languagetool", "en-US", "some prose").is_none());
        assert!(cache.get("harper", "fr", "some prose").is_none());
    }

    #[test]
    fn the_oldest_answer_is_evicted_at_capacity() {
        let mut cache = ResultCache::new(2);
        cache.put("harper", "en-US", "one", Vec::new());
        cache.put("harper", "en-US", "two", Vec::new());
        cache.put("harper", "en-US", "three", Vec::new());
        assert_eq!(cache.len(), 2);
        assert!(cache.get("harper", "en-US", "one").is_none());
        assert!(cache.get("harper", "en-US", "three").is_some());
    }

    #[test]
    fn a_zero_capacity_cache_is_switched_off() {
        let mut cache = ResultCache::new(0);
        cache.put("harper", "en-US", "one", Vec::new());
        assert!(cache.get("harper", "en-US", "one").is_none());
        assert!(cache.is_empty());
    }
}
