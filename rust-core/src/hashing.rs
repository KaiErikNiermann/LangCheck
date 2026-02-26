use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub struct DiagnosticFingerprint {
    pub message_hash: u64,
    pub context_hash: u64,
}

impl DiagnosticFingerprint {
    pub fn new(message: &str, text: &str, start_byte: usize, end_byte: usize) -> Self {
        let mut message_hasher = DefaultHasher::new();
        message.hash(&mut message_hasher);
        
        // Extract context: up to 20 characters before and after
        let start = start_byte.saturating_sub(20);
        let end = (end_byte + 20).min(text.len());
        let context = &text[start..end];
        
        let mut context_hasher = DefaultHasher::new();
        context.hash(&mut context_hasher);
        
        Self {
            message_hash: message_hasher.finish(),
            context_hash: context_hasher.finish(),
        }
    }
}

pub struct IgnoreStore {
    ignored_fingerprints: Vec<u64>, // For simplicity, just store a combined hash
}

impl IgnoreStore {
    pub fn new() -> Self {
        Self {
            ignored_fingerprints: Vec::new(),
        }
    }

    pub fn ignore(&mut self, fingerprint: &DiagnosticFingerprint) {
        let combined = self.combine(fingerprint);
        if !self.ignored_fingerprints.contains(&combined) {
            self.ignored_fingerprints.push(combined);
        }
    }

    pub fn is_ignored(&self, fingerprint: &DiagnosticFingerprint) -> bool {
        self.ignored_fingerprints.contains(&self.combine(fingerprint))
    }

    fn combine(&self, f: &DiagnosticFingerprint) -> u64 {
        let mut hasher = DefaultHasher::new();
        f.message_hash.hash(&mut hasher);
        f.context_hash.hash(&mut hasher);
        hasher.finish()
    }
}
