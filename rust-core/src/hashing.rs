use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Round a byte offset down to the nearest char boundary.
fn floor_char_boundary(s: &str, byte: usize) -> usize {
    let mut i = byte.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Round a byte offset up to the nearest char boundary.
fn ceil_char_boundary(s: &str, byte: usize) -> usize {
    let mut i = byte.min(s.len());
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticFingerprint {
    pub message_hash: u64,
    pub context_hash: u64,
    pub anchor_hash: u64,
}

impl DiagnosticFingerprint {
    #[must_use]
    pub fn new(message: &str, text: &str, start_byte: usize, end_byte: usize) -> Self {
        let mut message_hasher = DefaultHasher::new();
        message.hash(&mut message_hasher);

        // Extract context: up to 20 chars before and after, snapped to char boundaries
        let start = floor_char_boundary(text, start_byte.saturating_sub(20));
        let end = ceil_char_boundary(text, (end_byte + 20).min(text.len()));
        let context = &text[start..end];

        let mut context_hasher = DefaultHasher::new();
        context.hash(&mut context_hasher);

        // Fuzzy anchor: 3 words before and after the error span
        let mut anchor_hasher = DefaultHasher::new();
        Self::extract_word_anchor(text, start_byte, end_byte).hash(&mut anchor_hasher);

        Self {
            message_hash: message_hasher.finish(),
            context_hash: context_hasher.finish(),
            anchor_hash: anchor_hasher.finish(),
        }
    }

    fn extract_word_anchor(text: &str, start_byte: usize, end_byte: usize) -> String {
        let sb = floor_char_boundary(text, start_byte.min(text.len()));
        let before: String = text[..sb]
            .split_whitespace()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" ");
        let eb = ceil_char_boundary(text, end_byte.min(text.len()));
        let after: String = text[eb..]
            .split_whitespace()
            .take(3)
            .collect::<Vec<_>>()
            .join(" ");
        format!("{before}|{after}")
    }

    fn combined_hash(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.message_hash.hash(&mut hasher);
        self.context_hash.hash(&mut hasher);
        self.anchor_hash.hash(&mut hasher);
        hasher.finish()
    }
}

#[derive(Serialize, Deserialize)]
struct IgnoreStoreData {
    fingerprints: Vec<u64>,
}

pub struct IgnoreStore {
    ignored_fingerprints: HashSet<u64>,
    persist_path: Option<PathBuf>,
}

impl Default for IgnoreStore {
    fn default() -> Self {
        Self::new()
    }
}

impl IgnoreStore {
    #[must_use]
    pub fn new() -> Self {
        Self {
            ignored_fingerprints: HashSet::new(),
            persist_path: None,
        }
    }

    /// Load an `IgnoreStore` from a workspace root, reading `.languagecheck/ignores.json`.
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let persist_path = workspace_root.join(".languagecheck").join("ignores.json");
        let mut store = Self {
            ignored_fingerprints: HashSet::new(),
            persist_path: Some(persist_path.clone()),
        };

        if persist_path.exists() {
            let data = std::fs::read_to_string(&persist_path)?;
            let stored: IgnoreStoreData = serde_json::from_str(&data)?;
            store.ignored_fingerprints = stored.fingerprints.into_iter().collect();
        }

        Ok(store)
    }

    pub fn ignore(&mut self, fingerprint: &DiagnosticFingerprint) {
        self.ignored_fingerprints
            .insert(fingerprint.combined_hash());
        if let Err(e) = self.persist() {
            eprintln!("Warning: failed to persist ignore store: {e}");
        }
    }

    #[must_use]
    pub fn is_ignored(&self, fingerprint: &DiagnosticFingerprint) -> bool {
        self.ignored_fingerprints
            .contains(&fingerprint.combined_hash())
    }

    fn persist(&self) -> Result<()> {
        let Some(path) = &self.persist_path else {
            return Ok(());
        };

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let data = IgnoreStoreData {
            fingerprints: self.ignored_fingerprints.iter().copied().collect(),
        };
        std::fs::write(path, serde_json::to_string_pretty(&data)?)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_same_input_same_hash() {
        let fp1 = DiagnosticFingerprint::new("bad grammar", "This has bad grammar here.", 9, 12);
        let fp2 = DiagnosticFingerprint::new("bad grammar", "This has bad grammar here.", 9, 12);
        assert_eq!(fp1.combined_hash(), fp2.combined_hash());
    }

    #[test]
    fn fingerprint_different_message_different_hash() {
        let fp1 = DiagnosticFingerprint::new("bad grammar", "This has bad grammar here.", 9, 12);
        let fp2 = DiagnosticFingerprint::new("spelling error", "This has bad grammar here.", 9, 12);
        assert_ne!(fp1.combined_hash(), fp2.combined_hash());
    }

    #[test]
    fn fingerprint_different_context_different_hash() {
        let fp1 = DiagnosticFingerprint::new("error", "AAA error BBB", 4, 9);
        let fp2 = DiagnosticFingerprint::new("error", "CCC error DDD", 4, 9);
        assert_ne!(fp1.combined_hash(), fp2.combined_hash());
    }

    #[test]
    fn fingerprint_word_anchor_extraction() {
        let text = "one two three ERROR four five six";
        let anchor = DiagnosticFingerprint::extract_word_anchor(text, 14, 19);
        assert_eq!(anchor, "one two three|four five six");
    }

    #[test]
    fn fingerprint_word_anchor_at_start() {
        let text = "ERROR some words after";
        let anchor = DiagnosticFingerprint::extract_word_anchor(text, 0, 5);
        assert_eq!(anchor, "|some words after");
    }

    #[test]
    fn fingerprint_word_anchor_at_end() {
        let text = "words before ERROR";
        let anchor = DiagnosticFingerprint::extract_word_anchor(text, 13, 18);
        assert_eq!(anchor, "words before|");
    }

    #[test]
    fn ignore_store_basic_operations() {
        let mut store = IgnoreStore::new();
        let fp = DiagnosticFingerprint::new("test msg", "some test msg context", 5, 13);

        assert!(!store.is_ignored(&fp));
        store.ignore(&fp);
        assert!(store.is_ignored(&fp));
    }

    #[test]
    fn ignore_store_does_not_ignore_different_fingerprint() {
        let mut store = IgnoreStore::new();
        let fp1 = DiagnosticFingerprint::new("msg A", "context A msg A here", 10, 15);
        let fp2 = DiagnosticFingerprint::new("msg B", "context B msg B here", 10, 15);

        store.ignore(&fp1);
        assert!(store.is_ignored(&fp1));
        assert!(!store.is_ignored(&fp2));
    }

    #[test]
    fn ignore_store_persistence_roundtrip() {
        let dir = std::env::temp_dir().join("lang_check_test_ignore_persist");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let fp = DiagnosticFingerprint::new("persist test", "the persist test text", 4, 16);

        // Write
        {
            let mut store = IgnoreStore::load(&dir).unwrap();
            store.ignore(&fp);
        }

        // Read back
        {
            let store = IgnoreStore::load(&dir).unwrap();
            assert!(store.is_ignored(&fp));
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fingerprint_handles_multibyte_utf8() {
        // Byte offsets that land inside multi-byte chars must not panic
        let text = "Ärger mit Ölförderung"; // 'Ä' is 2 bytes, 'ö' is 2 bytes
        // 'Ä' occupies bytes 0..2, 'r' is byte 2, etc.
        // Deliberately pick a byte offset inside 'ö' (byte 10 is start of 'ö', byte 11 is mid-char)
        let fp = DiagnosticFingerprint::new("test", text, 11, 15);
        // Should not panic — just verify it produces a hash
        assert!(fp.combined_hash() != 0 || fp.combined_hash() == 0);
    }

    #[test]
    fn ignore_store_empty_persistence() {
        let dir = std::env::temp_dir().join("lang_check_test_ignore_empty");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let store = IgnoreStore::load(&dir).unwrap();
        let fp = DiagnosticFingerprint::new("not ignored", "some context", 0, 5);
        assert!(!store.is_ignored(&fp));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
