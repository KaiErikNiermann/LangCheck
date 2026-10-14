use std::num::NonZeroUsize;

use lru::LruCache;

use crate::checker::Diagnostic;

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
///
/// Bounded twice: by entries (the config's `result_cache_entries`) and by
/// what the answers hold ([`MAX_HELD_BYTES`]). The entry cap has to be
/// large, since a document with more ranges than it evicts every answer
/// before the next check asks for it; the byte budget keeps a long session
/// of finding-dense text from holding more memory than that is worth.
pub struct ResultCache {
    /// `None` when the cache is switched off, so the caller needs no second
    /// code path for that.
    cache: Option<LruCache<ResultKey, Vec<Diagnostic>>>,
    /// What the held answers weigh, by [`weight`].
    held: usize,
}

/// Most the cached answers may hold, by [`weight`].
///
/// Most ranges have no findings and weigh about a hundred bytes, so this is far past what the
/// entry cap allows for ordinary prose; it binds on text that is all findings.
pub const MAX_HELD_BYTES: usize = 64 * 1024 * 1024;

/// About what one answer holds on the heap: its key and its diagnostics,
/// with their strings.
fn weight(diagnostics: &[Diagnostic]) -> usize {
    size_of::<ResultKey>()
        + diagnostics
            .iter()
            .map(|d| {
                size_of::<Diagnostic>()
                    + d.message.len()
                    + d.rule_id.len()
                    + d.unified_id.len()
                    + d.language.len()
                    + d.suggestions
                        .iter()
                        .map(|s| size_of::<String>() + s.len())
                        .sum::<usize>()
            })
            .sum::<usize>()
}

impl ResultCache {
    /// A cache holding `capacity` answers, or a disabled one when that is zero.
    ///
    /// A disabled cache misses every lookup and stores nothing.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: NonZeroUsize::new(capacity).map(LruCache::new),
            held: 0,
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
        let Some(cache) = self.cache.as_mut() else {
            return;
        };
        let added = weight(&diagnostics);
        // One answer past the whole budget would only push everything else out.
        if added > MAX_HELD_BYTES {
            return;
        }
        self.held += added;
        // `push` hands back what it displaced: the old answer for this key,
        // or the least recently used one at the entry cap.
        if let Some((_, displaced)) = cache.push(Self::key(engine, language, text), diagnostics) {
            self.held -= weight(&displaced);
        }
        while self.held > MAX_HELD_BYTES {
            let Some((_, evicted)) = cache.pop_lru() else {
                break;
            };
            self.held -= weight(&evicted);
        }
    }

    /// What the held answers weigh, by [`weight`].
    #[must_use]
    pub const fn held_bytes(&self) -> usize {
        self.held
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
        self.held = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            language: String::new(),
            pack_installable: false,
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
    fn answers_past_the_byte_budget_evict_the_oldest() {
        let mut cache = ResultCache::new(1_000_000);
        // A megabyte of message an answer: the budget holds 64 of them.
        let heavy = || {
            let mut d = diagnostic("harper.Spelling");
            d.message = "x".repeat(1024 * 1024);
            vec![d]
        };
        for i in 0..100 {
            cache.put("harper", "en-US", &format!("range {i}"), heavy());
        }
        assert!(cache.held_bytes() <= MAX_HELD_BYTES);
        assert!(cache.len() < 64);
        assert!(cache.get("harper", "en-US", "range 0").is_none());
        assert!(cache.get("harper", "en-US", "range 99").is_some());
    }

    #[test]
    fn replacing_or_clearing_keeps_the_weight_right() {
        let mut cache = ResultCache::new(2);
        cache.put("harper", "en-US", "one", vec![diagnostic("a")]);
        let one = cache.held_bytes();
        cache.put("harper", "en-US", "one", vec![diagnostic("a")]);
        assert_eq!(cache.held_bytes(), one);
        cache.put("harper", "en-US", "two", Vec::new());
        cache.put("harper", "en-US", "three", Vec::new());
        assert_eq!(cache.held_bytes(), 2 * weight(&[]));
        cache.clear();
        assert_eq!(cache.held_bytes(), 0);
    }

    #[test]
    fn a_zero_capacity_cache_is_switched_off() {
        let mut cache = ResultCache::new(0);
        cache.put("harper", "en-US", "one", Vec::new());
        assert!(cache.get("harper", "en-US", "one").is_none());
        assert!(cache.is_empty());
    }
}
