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

    /// Load the bundled dictionaries that ship with the extension.
    /// These contain domain-specific technical terms from open-source wordlists.
    pub fn load_bundled(&mut self) {
        for words_str in bundled::ALL {
            parse_wordlist_into(words_str, &mut self.words);
        }
    }

    /// Load additional words from a file path. The file is expected to contain
    /// one word per line; lines starting with `#` and blank lines are skipped.
    ///
    /// Paths are resolved relative to `base` if they are not absolute.
    pub fn load_wordlist_file(&mut self, path: &Path, base: &Path) -> Result<()> {
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else {
            base.join(path)
        };

        let resolved = resolved.canonicalize().map_err(|e| {
            anyhow::anyhow!("Cannot resolve wordlist path {}: {e}", resolved.display())
        })?;

        // Security: refuse to read files outside the workspace or common config dirs
        if !resolved.starts_with(base)
            && !resolved.starts_with(dirs::config_dir().unwrap_or_default())
            && !resolved.starts_with(dirs::home_dir().unwrap_or_default().join(".config"))
        {
            anyhow::bail!(
                "Wordlist path {} is outside the workspace and known config directories",
                resolved.display()
            );
        }

        let content = std::fs::read_to_string(&resolved).map_err(|e| {
            anyhow::anyhow!("Cannot read wordlist {}: {e}", resolved.display())
        })?;
        parse_wordlist_into(&content, &mut self.words);
        Ok(())
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

    /// Return the total number of words loaded.
    #[must_use]
    pub fn len(&self) -> usize {
        self.words.len()
    }

    /// Whether the dictionary is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.words.is_empty()
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

/// Parse a wordlist string (one word per line) into a set.
fn parse_wordlist_into(content: &str, set: &mut HashSet<String>) {
    for line in content.lines() {
        let word = line.trim();
        if !word.is_empty() && !word.starts_with('#') {
            set.insert(word.to_lowercase());
        }
    }
}

/// Bundled dictionary data embedded at compile time.
/// See `dictionaries/THIRD_PARTY_NOTICES.md` for attribution and licensing.
pub mod bundled {
    /// Software development terms, tools, acronyms, and compound words.
    /// Sources: cspell-dicts (software-terms, cpp). License: MIT.
    pub const SOFTWARE_TERMS: &str =
        include_str!("../dictionaries/bundled/software-terms.txt");

    /// TypeScript and JavaScript keywords, builtins, and API terms.
    /// Source: cspell-dicts (typescript). License: MIT.
    pub const TYPESCRIPT: &str =
        include_str!("../dictionaries/bundled/typescript.txt");

    /// Well-known company and brand names.
    /// Source: cspell-dicts (companies). License: MIT.
    pub const COMPANIES: &str =
        include_str!("../dictionaries/bundled/companies.txt");

    /// Computing jargon, hardware terms, and domain-specific vocabulary.
    /// Sources: hunspell-jargon (MIT), `SpellCheckDic` (MIT),
    ///          autoware-spell-check-dict (Apache-2.0).
    pub const JARGON: &str =
        include_str!("../dictionaries/bundled/jargon.txt");

    /// All bundled wordlists for convenient iteration.
    pub const ALL: &[&str] = &[SOFTWARE_TERMS, TYPESCRIPT, COMPANIES, JARGON];
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

    #[test]
    fn bundled_dictionaries_load() {
        let mut dict = Dictionary::new();
        dict.load_bundled();

        // Should have thousands of words from bundled sources
        assert!(
            dict.len() > 5000,
            "Expected > 5000 bundled words, got {}",
            dict.len()
        );

        // Spot-check some well-known terms from each category
        assert!(dict.contains("kubernetes"), "software-terms should include kubernetes");
        assert!(dict.contains("webpack"), "software-terms should include webpack");
        assert!(dict.contains("instanceof"), "typescript should include instanceof");
        assert!(dict.contains("stdout"), "jargon should include stdout");
    }

    #[test]
    fn bundled_plus_user_words() {
        let mut dict = Dictionary::new();
        dict.load_bundled();
        let bundled_count = dict.len();

        dict.words.insert("myprojectword".to_string());
        assert_eq!(dict.len(), bundled_count + 1);
        assert!(dict.contains("myprojectword"));
        // Bundled words still present
        assert!(dict.contains("kubernetes"));
    }

    #[test]
    fn load_wordlist_file_works() {
        let dir = std::env::temp_dir().join("lang_check_test_wordlist");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let wordlist = dir.join("custom.txt");
        std::fs::write(&wordlist, "# My custom words\nfoobar\nbazqux\n").unwrap();

        let mut dict = Dictionary::new();
        dict.load_wordlist_file(&wordlist, &dir).unwrap();

        assert!(dict.contains("foobar"));
        assert!(dict.contains("bazqux"));
        assert_eq!(dict.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_wordlist_file_relative_path() {
        let dir = std::env::temp_dir().join("lang_check_test_wordlist_rel");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(dir.join("terms.txt"), "myterm\n").unwrap();

        let mut dict = Dictionary::new();
        dict.load_wordlist_file(Path::new("terms.txt"), &dir).unwrap();

        assert!(dict.contains("myterm"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
