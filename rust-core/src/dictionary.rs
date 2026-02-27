use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Manages custom dictionaries for the language checker.
/// Words in the dictionary are excluded from spelling diagnostics.
pub struct Dictionary {
    words: HashSet<String>,
    workspace_path: Option<PathBuf>,
}

impl Default for Dictionary {
    fn default() -> Self {
        Self::new()
    }
}

impl Dictionary {
    #[must_use]
    pub fn new() -> Self {
        Self {
            words: HashSet::new(),
            workspace_path: None,
        }
    }

    /// Load dictionaries from a workspace root.
    /// Reads from .languagecheck/dictionary.txt (one word per line).
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let mut dict = Self::new();
        let dict_path = workspace_root.join(".languagecheck").join("dictionary.txt");
        dict.workspace_path = Some(dict_path.clone());

        if dict_path.exists() {
            let content = std::fs::read_to_string(&dict_path)?;
            for line in content.lines() {
                let word = line.trim();
                if !word.is_empty() && !word.starts_with('#') {
                    dict.words.insert(word.to_lowercase());
                }
            }
        }

        Ok(dict)
    }

    /// Add a word to the dictionary and persist to disk.
    pub fn add_word(&mut self, word: &str) -> Result<()> {
        let lower = word.to_lowercase();
        if self.words.insert(lower) {
            self.persist()?;
        }
        Ok(())
    }

    /// Check if a word is in the dictionary (case-insensitive).
    #[must_use]
    pub fn contains(&self, word: &str) -> bool {
        self.words.contains(&word.to_lowercase())
    }

    /// Return all words in the dictionary.
    pub fn words(&self) -> impl Iterator<Item = &String> {
        self.words.iter()
    }

    fn persist(&self) -> Result<()> {
        let Some(path) = &self.workspace_path else {
            return Ok(());
        };

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut words: Vec<&str> = self.words.iter().map(String::as_str).collect();
        words.sort_unstable();
        let content = words.join("\n");
        std::fs::write(path, content + "\n")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_dictionary_is_empty() {
        let dict = Dictionary::new();
        assert!(!dict.contains("anything"));
    }

    #[test]
    fn add_and_contains() {
        let mut dict = Dictionary::new();
        dict.words.insert("hello".to_string());
        assert!(dict.contains("hello"));
        assert!(dict.contains("Hello")); // case-insensitive
        assert!(dict.contains("HELLO"));
    }

    #[test]
    fn persistence_roundtrip() {
        let dir = std::env::temp_dir().join("lang_check_test_dict");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Write
        {
            let mut dict = Dictionary::load(&dir).unwrap();
            dict.add_word("kubernetes").unwrap();
            dict.add_word("terraform").unwrap();
        }

        // Read back
        {
            let dict = Dictionary::load(&dir).unwrap();
            assert!(dict.contains("kubernetes"));
            assert!(dict.contains("Kubernetes")); // case-insensitive
            assert!(dict.contains("terraform"));
            assert!(!dict.contains("nonexistent"));
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skips_comments_and_blank_lines() {
        let dir = std::env::temp_dir().join("lang_check_test_dict_comments");
        let _ = std::fs::remove_dir_all(&dir);
        let dict_dir = dir.join(".languagecheck");
        std::fs::create_dir_all(&dict_dir).unwrap();
        std::fs::write(
            dict_dir.join("dictionary.txt"),
            "# This is a comment\n\nkubernetes\n  \n# Another comment\nterraform\n",
        )
        .unwrap();

        let dict = Dictionary::load(&dir).unwrap();
        assert!(dict.contains("kubernetes"));
        assert!(dict.contains("terraform"));
        assert_eq!(dict.words().count(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_duplicate_word_is_idempotent() {
        let mut dict = Dictionary::new();
        dict.words.insert("test".to_string());
        let initial_count = dict.words().count();
        dict.words.insert("test".to_string());
        assert_eq!(dict.words().count(), initial_count);
    }

    #[test]
    fn words_iterator() {
        let mut dict = Dictionary::new();
        dict.words.insert("alpha".to_string());
        dict.words.insert("beta".to_string());
        assert_eq!(dict.words().count(), 2);
    }
}
