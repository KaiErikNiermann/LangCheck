use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};

use lru::LruCache;

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
        let hash = Self::hash_content(content);
        self.cache
            .get(path)
            .filter(|entry| entry.content_hash == hash)
            .map(|entry| entry.prose_ranges.clone())
    }

    /// Insert (or update) a cache entry for the given file.
    pub fn put(&mut self, path: PathBuf, content: &str, prose_ranges: Vec<ProseRange>) {
        let entry = ParseCacheEntry {
            content_hash: Self::hash_content(content),
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

    fn hash_content(content: &str) -> u64 {
        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        hasher.finish()
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
}
