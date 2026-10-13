//! The dictionary of the site a document is edited on.
//!
//! Typst keeps a personal dictionary and Overleaf a list of learned words,
//! each per user. The web extension reads it in the page and sends it here
//! (`SiteDictionaryRequest`); it is coerced into words this checker can use,
//! written to `.languagecheck/site-dictionary.txt` in the workspace so a
//! restart keeps it, and accepted beside or instead of this checker's own
//! dictionary as `dictionaries.site` says ([`crate::config::SiteDictionaryMode`]).
//!
//! Coercion, because the input is a web page's: entries are trimmed, and one
//! that is not a single word (empty, whitespace or control characters inside,
//! longer than any word) is dropped and counted, so the config page can say
//! how many were. The count is bounded, duplicates fold case-insensitively.
//!
//! The file is the workspace's ordinary wordlist format with a header:
//!
//! ```text
//! # site: typst
//! # received: 1791932040
//! # dropped: 1
//! Databricks
//! Vrije
//! ```

use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// The most words taken from a site. Typst caps its own at 100.
pub const MAX_WORDS: usize = 10_000;

/// Longer than any word, shorter than a sentence pasted by mistake.
pub const MAX_WORD_CHARS: usize = 64;

/// A site's name: what the file and the config page call it.
const MAX_SOURCE_LEN: usize = 32;

/// The site's words as this checker keeps them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteWords {
    /// Who sent them (`typst`, `overleaf`).
    pub source: String,
    /// The words, as the site spelled them, in the order it gave them.
    pub words: Vec<String>,
    /// Entries that were not one word, or past [`MAX_WORDS`].
    pub dropped: usize,
    /// When they arrived, in seconds since the Unix epoch.
    pub received: u64,
}

impl SiteWords {
    /// What the site sent, as words; `None` when `source` is not a site's name.
    #[must_use]
    pub fn coerce(source: &str, entries: &[String], received: u64) -> Option<Self> {
        let sound_source = !source.is_empty()
            && source.len() <= MAX_SOURCE_LEN
            && source
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
        if !sound_source {
            return None;
        }
        let mut seen = HashSet::new();
        let mut words = Vec::new();
        let mut dropped = 0;
        for entry in entries {
            let word = entry.trim();
            let one_word = !word.is_empty()
                && word.chars().count() <= MAX_WORD_CHARS
                && !word.chars().any(|c| c.is_whitespace() || c.is_control());
            if !one_word || words.len() >= MAX_WORDS {
                dropped += 1;
            } else if seen.insert(word.to_lowercase()) {
                words.push(word.to_string());
            }
        }
        Some(Self {
            source: source.to_string(),
            words,
            dropped,
            received,
        })
    }

    /// Where a workspace keeps them.
    #[must_use]
    pub fn path(workspace_root: &Path) -> PathBuf {
        workspace_root
            .join(".languagecheck")
            .join("site-dictionary.txt")
    }

    /// The workspace's copy, if it has one that reads as one.
    #[must_use]
    pub fn load(workspace_root: &Path) -> Option<Self> {
        let text = std::fs::read_to_string(Self::path(workspace_root)).ok()?;
        let mut source = None;
        let mut received = 0;
        let mut dropped = 0;
        let mut words = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if let Some(comment) = line.strip_prefix('#') {
                match comment.trim().split_once(':') {
                    Some(("site", v)) => source = Some(v.trim().to_string()),
                    Some(("received", v)) => received = v.trim().parse().unwrap_or(0),
                    Some(("dropped", v)) => dropped = v.trim().parse().unwrap_or(0),
                    _ => {}
                }
            } else if !line.is_empty() {
                words.push(line.to_string());
            }
        }
        // Read back through coerce, so a hand-edited file is held to the same rules.
        let mut loaded = Self::coerce(&source?, &words, received)?;
        loaded.dropped += dropped;
        Some(loaded)
    }

    /// Writes them to the workspace, unless the copy there already holds the
    /// same words from the same site; says whether it wrote.
    pub fn store(&self, workspace_root: &Path) -> Result<bool> {
        if Self::load(workspace_root).is_some_and(|old| {
            old.source == self.source && old.words == self.words && old.dropped == self.dropped
        }) {
            return Ok(false);
        }
        let mut text = format!(
            "# site: {}\n# received: {}\n# dropped: {}\n",
            self.source, self.received, self.dropped
        );
        for word in &self.words {
            text.push_str(word);
            text.push('\n');
        }
        let path = Self::path(workspace_root);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        crate::fs_util::write_replacing(&path, text.as_bytes())?;
        Ok(true)
    }

    /// The site's name as people know it, for the config page.
    #[must_use]
    pub fn title(&self) -> String {
        match self.source.as_str() {
            "typst" => "Typst personal dictionary".to_string(),
            "overleaf" => "Overleaf learned words".to_string(),
            other => format!("{other} dictionary"),
        }
    }
}

/// Now, in seconds since the Unix epoch.
#[must_use]
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(words: &[&str]) -> Vec<String> {
        words.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn entries_that_are_not_one_word_are_dropped_and_counted() {
        let words = SiteWords::coerce(
            "typst",
            &entries(&[
                "Databricks",
                "  Vrije ",
                "New York",
                "",
                "a\tb",
                "x\u{7}",
                &"w".repeat(65),
                "databricks",
            ]),
            7,
        )
        .unwrap();
        assert_eq!(words.words, ["Databricks", "Vrije"]);
        assert_eq!(words.dropped, 5);
    }

    #[test]
    fn a_source_that_could_not_be_a_site_name_is_refused() {
        for source in ["", "Typst", "typst.app", &"t".repeat(33)] {
            assert_eq!(
                SiteWords::coerce(source, &entries(&["word"]), 0),
                None,
                "{source}"
            );
        }
    }

    #[test]
    fn at_most_max_words_are_taken() {
        let many: Vec<String> = (0..MAX_WORDS + 3).map(|i| format!("w{i}")).collect();
        let words = SiteWords::coerce("overleaf", &many, 0).unwrap();
        assert_eq!(words.words.len(), MAX_WORDS);
        assert_eq!(words.dropped, 3);
    }

    #[test]
    fn stored_and_loaded_back_the_same_and_rewritten_only_on_a_change() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(SiteWords::load(dir.path()), None);
        let words = SiteWords::coerce(
            "typst",
            &entries(&["Databricks", "New York"]),
            1_791_932_040,
        )
        .unwrap();
        assert!(words.store(dir.path()).unwrap());
        assert_eq!(SiteWords::load(dir.path()), Some(words.clone()));
        // The same words a minute later: nothing to write.
        let later = SiteWords {
            received: 1_791_932_100,
            ..words
        };
        assert!(!later.store(dir.path()).unwrap());
        let changed =
            SiteWords::coerce("typst", &entries(&["Databricks", "Vue"]), 1_791_932_100).unwrap();
        assert!(changed.store(dir.path()).unwrap());
        assert_eq!(
            SiteWords::load(dir.path()).unwrap().words,
            ["Databricks", "Vue"]
        );
    }

    #[test]
    fn a_hand_edited_file_is_held_to_the_same_rules() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".languagecheck")).unwrap();
        std::fs::write(
            SiteWords::path(dir.path()),
            "# site: overleaf\nfine\ntwo words\n",
        )
        .unwrap();
        let loaded = SiteWords::load(dir.path()).unwrap();
        assert_eq!(loaded.words, ["fine"]);
        assert_eq!(loaded.dropped, 1);
        std::fs::write(SiteWords::path(dir.path()), "no header\n").unwrap();
        assert_eq!(SiteWords::load(dir.path()), None);
    }
}
