//! Spelling for the languages no other engine here reads.
//!
//! Harper is English-only and `LanguageTool` covers about forty languages,
//! which leaves real gaps: no Hebrew, no Latin, no Old English. Hunspell
//! dictionaries exist for all of them and for a long tail besides, so this
//! engine reads that format and fills the gap with spelling -- and only
//! spelling. There are no grammar rules here, and a language served by this
//! engine alone gets a narrower check than one `LanguageTool` supports. That
//! is still the difference between checked and unchecked.
//!
//! The dictionaries are not bundled and cannot be; see [`crate::packs`].
//! Parsing is [`spellbook`], a Rust implementation of Nuspell, so nothing here
//! links a C library and the release binaries stay static.

use std::collections::HashMap;

use anyhow::Result;

use crate::checker::{Diagnostic, Severity};
use crate::packs::{PackError, PackRegistry, ResolvedPack};

/// How many suggestions to ask for.
///
/// Hunspell suggestion generation is far more expensive than the lookup that
/// found the misspelling, and a list longer than this is not read -- the
/// editor shows the first few and the rest are scrolled past.
const MAX_SUGGESTIONS: usize = 8;

/// A loaded dictionary, and where it came from.
struct LoadedPack {
    dictionary: spellbook::Dictionary,
    pack: ResolvedPack,
}

/// Checks spelling against Hunspell dictionaries, one per language.
pub struct HunspellEngine {
    registry: PackRegistry,
    /// Languages this engine is allowed to answer for. Empty means any
    /// language with a pack behind it.
    languages: Vec<String>,
    /// Loaded on first use and kept: a 7.8 MB Hebrew dictionary parses in
    /// about 60 ms, which is once per session rather than once per keystroke.
    loaded: HashMap<String, LoadedPack>,
    /// Languages already found to have no usable pack, so a document full of
    /// them does not re-walk the filesystem for every range.
    failed: HashMap<String, String>,
}

impl HunspellEngine {
    #[must_use]
    pub fn new(registry: PackRegistry, languages: Vec<String>) -> Self {
        Self {
            registry,
            languages,
            loaded: HashMap::new(),
            failed: HashMap::new(),
        }
    }

    /// The pack for `language`, loading it if this is the first ask.
    fn dictionary(&mut self, language: &str) -> Result<&LoadedPack, PackError> {
        let key = language.to_ascii_lowercase();
        if let Some(reason) = self.failed.get(&key) {
            return Err(PackError::Unreadable {
                path: std::path::PathBuf::from(language),
                detail: reason.clone(),
            });
        }
        if !self.loaded.contains_key(&key) {
            let loaded = self.load(language)?;
            self.loaded.insert(key.clone(), loaded);
        }
        Ok(&self.loaded[&key])
    }

    fn load(&mut self, language: &str) -> Result<LoadedPack, PackError> {
        let pack = self.registry.resolve(language)?;
        let aff = std::fs::read_to_string(&pack.aff).map_err(|e| PackError::Unreadable {
            path: pack.aff.clone(),
            detail: e.to_string(),
        })?;
        let dic = std::fs::read_to_string(&pack.dic).map_err(|e| PackError::Unreadable {
            path: pack.dic.clone(),
            detail: e.to_string(),
        })?;

        match spellbook::Dictionary::new(&aff, &dic) {
            Ok(dictionary) => Ok(LoadedPack { dictionary, pack }),
            Err(e) => {
                // Remembered, because a pack that will not parse will not
                // parse on the next range either, and re-reading 7 MB to
                // rediscover that is the difference between a slow check and
                // an unusable one.
                let detail = e.to_string();
                self.failed
                    .insert(language.to_ascii_lowercase(), detail.clone());
                Err(PackError::Malformed {
                    path: pack.aff,
                    detail,
                })
            }
        }
    }

    /// Which languages currently have a usable pack, for the inspector.
    #[must_use]
    pub fn available(&self) -> Vec<ResolvedPack> {
        self.registry.installed()
    }
}

/// Split prose into the words a speller should judge, with byte offsets.
///
/// Not `split_whitespace`: a word carries punctuation that is not part of it,
/// and an apostrophe or a hyphen inside one is. Digits end a word's candidacy
/// outright -- `v0.5.3`, `3rd` and `A4` are not misspellings and a dictionary
/// has no opinion worth hearing about them.
fn words(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut run_start: Option<usize> = None;
    let mut has_digit = false;

    for (offset, ch) in text.char_indices() {
        let joins = matches!(ch, '\'' | '\u{2019}' | '-' | '\u{2010}')
            && run_start.is_some()
            && text[offset + ch.len_utf8()..]
                .chars()
                .next()
                .is_some_and(char::is_alphanumeric);
        if ch.is_alphanumeric() || joins {
            run_start.get_or_insert(offset);
            has_digit |= ch.is_numeric();
        } else if let Some(from) = run_start.take() {
            push_run(text, from, offset, has_digit, &mut out);
            has_digit = false;
        }
    }
    if let Some(from) = run_start {
        push_run(text, from, text.len(), has_digit, &mut out);
    }
    out
}

/// Record one run as a candidate, unless a digit disqualified it.
///
/// The run's edges are trimmed of anything not a letter, so a trailing
/// apostrophe in `dogs'` is dropped while the one in `don't` is kept.
fn push_run<'a>(
    text: &'a str,
    from: usize,
    to: usize,
    has_digit: bool,
    out: &mut Vec<(usize, &'a str)>,
) {
    if has_digit {
        return;
    }
    let run = &text[from..to];
    let trimmed = run.trim_matches(|c: char| !c.is_alphabetic());
    if trimmed.is_empty() {
        return;
    }
    let lead = run.len() - run.trim_start_matches(|c: char| !c.is_alphabetic()).len();
    out.push((from + lead, trimmed));
}

#[async_trait::async_trait]
impl super::Engine for HunspellEngine {
    fn name(&self) -> &'static str {
        "hunspell"
    }

    fn supported_languages(&self) -> Vec<String> {
        // Declared per installation rather than compiled in, so the engine
        // cannot advertise a language whose pack is not there. An empty list
        // is the wildcard the orchestrator already understands, and the
        // per-language load below is what actually decides.
        Vec::new()
    }

    async fn check(&mut self, text: &str, language_id: &str) -> Result<Vec<Diagnostic>> {
        // An explicit list means "only these", so a deployment can keep this
        // engine to the gaps and leave English to Harper.
        if !self.languages.is_empty() {
            let primary = language_id.split('-').next().unwrap_or(language_id);
            let wanted = self.languages.iter().any(|l| {
                let configured = l.split('-').next().unwrap_or(l);
                configured.eq_ignore_ascii_case(primary)
            });
            if !wanted {
                return Err(anyhow::Error::new(super::UnsupportedLanguage {
                    engine: "hunspell",
                    language: language_id.to_string(),
                }));
            }
        }

        let loaded = match self.dictionary(language_id) {
            Ok(loaded) => loaded,
            // No pack is not a failure of this engine, it is this engine
            // having nothing to say about this language -- which is what the
            // orchestrator reports as no-provider rather than as a fault.
            Err(e) if e.is_installable() => {
                return Err(anyhow::Error::new(super::UnsupportedLanguage {
                    engine: "hunspell",
                    language: language_id.to_string(),
                }));
            }
            Err(e) => return Err(anyhow::anyhow!("{e}")),
        };

        let mut diagnostics = Vec::new();
        for (offset, word) in words(text) {
            if loaded.dictionary.check(word) {
                continue;
            }
            let mut suggestions = Vec::new();
            loaded.dictionary.suggest(word, &mut suggestions);
            suggestions.truncate(MAX_SUGGESTIONS);

            #[allow(clippy::cast_possible_truncation)]
            diagnostics.push(Diagnostic {
                start_byte: offset as u32,
                end_byte: (offset + word.len()) as u32,
                message: format!("\"{word}\" is not in the {} dictionary", loaded.pack.stem),
                suggestions,
                rule_id: "hunspell.spelling".to_string(),
                severity: Severity::Warning as i32,
                unified_id: String::new(), // Will be filled by normalizer
                // Below Harper and LanguageTool on purpose: a wordlist with no
                // grammar behind it cannot tell a coinage from a typo.
                confidence: 0.6,
                language: String::new(),
                pack_installable: false,
            });
        }
        Ok(diagnostics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::Engine;

    /// `(byte offset, word)` for each candidate the speller would judge.
    fn candidates(text: &str) -> Vec<(usize, &str)> {
        words(text)
    }

    #[test]
    fn plain_words_are_found_with_their_offsets() {
        assert_eq!(candidates("one two"), vec![(0, "one"), (4, "two")]);
    }

    #[test]
    fn punctuation_is_not_part_of_a_word() {
        assert_eq!(
            candidates("Hello, world! Yes."),
            vec![(0, "Hello"), (7, "world"), (14, "Yes")]
        );
    }

    #[test]
    fn an_apostrophe_inside_a_word_stays() {
        // `dont` and `don't` are different questions for a speller, and
        // splitting on the apostrophe asks the wrong one.
        assert_eq!(candidates("don't"), vec![(0, "don't")]);
        assert_eq!(
            candidates("l\u{2019}autorit\u{e9}"),
            vec![(0, "l\u{2019}autorit\u{e9}")]
        );
    }

    #[test]
    fn a_quote_around_a_word_does_not() {
        assert_eq!(candidates("'quoted'"), vec![(1, "quoted")]);
    }

    #[test]
    fn a_hyphenated_word_stays_whole() {
        assert_eq!(candidates("well-known"), vec![(0, "well-known")]);
    }

    #[test]
    fn anything_with_a_digit_is_not_a_word() {
        // A dictionary has no useful opinion about a version or an identifier.
        assert!(candidates("v0").is_empty(), "{:?}", candidates("v0"));
        assert!(candidates("A4").is_empty(), "{:?}", candidates("A4"));
        assert_eq!(candidates("the 3rd time"), vec![(0, "the"), (8, "time")]);
    }

    #[test]
    fn offsets_survive_multibyte_text() {
        // Hebrew and French are the point of this engine; an offset that
        // counts characters puts every underline in the wrong place.
        let text = "caf\u{e9} na\u{ef}ve";
        let found = candidates(text);
        assert_eq!(found.len(), 2);
        for (offset, word) in found {
            assert_eq!(&text[offset..offset + word.len()], word);
        }
    }

    #[test]
    fn hebrew_is_tokenised_by_word() {
        let text = "\u{5e9}\u{5dc}\u{5d5}\u{5dd} \u{5e2}\u{5d5}\u{5dc}\u{5dd}";
        let found = candidates(text);
        assert_eq!(found.len(), 2, "{found:?}");
        for (offset, word) in found {
            assert_eq!(&text[offset..offset + word.len()], word);
        }
    }

    #[test]
    fn empty_and_punctuation_only_text_yields_nothing() {
        assert_eq!(candidates(""), Vec::new());
        assert_eq!(candidates("--- ... !!!"), Vec::new());
    }

    /// A tiny real dictionary, so the engine is exercised end to end rather
    /// than mocked.
    fn tiny_pack(dir: &std::path::Path, stem: &str, words: &[&str]) {
        std::fs::write(dir.join(format!("{stem}.aff")), "SET UTF-8\n").unwrap();
        let mut body = String::new();
        for word in words {
            use std::fmt::Write as _;
            let _ = writeln!(body, "{word}");
        }
        std::fs::write(
            dir.join(format!("{stem}.dic")),
            format!("{}\n{body}", words.len()),
        )
        .unwrap();
    }

    fn engine_over(dir: &std::path::Path, languages: Vec<String>) -> HunspellEngine {
        let registry = PackRegistry::new().with_only_search_paths(vec![dir.to_path_buf()]);
        HunspellEngine::new(registry, languages)
    }

    #[tokio::test]
    async fn a_word_outside_the_dictionary_is_reported_with_its_offset() {
        let dir = tempfile::tempdir().unwrap();
        tiny_pack(dir.path(), "xx", &["alpha", "beta"]);
        let mut engine = engine_over(dir.path(), Vec::new());

        let text = "alpha gamma beta";
        let found = engine.check(text, "xx").await.unwrap();
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].start_byte, 6);
        assert_eq!(found[0].end_byte, 11);
        assert_eq!(&text[6..11], "gamma");
        assert_eq!(found[0].rule_id, "hunspell.spelling");
    }

    #[tokio::test]
    async fn a_clean_sentence_reports_nothing() {
        let dir = tempfile::tempdir().unwrap();
        tiny_pack(dir.path(), "xx", &["alpha", "beta"]);
        let mut engine = engine_over(dir.path(), Vec::new());
        assert_eq!(engine.check("alpha beta", "xx").await.unwrap(), Vec::new());
    }

    #[tokio::test]
    async fn a_language_with_no_pack_is_declined_not_failed() {
        // The orchestrator turns this into the no-provider diagnostic and
        // leaves engine health alone; reporting it as an error would say the
        // spell checker is broken when it simply has no Hebrew.
        let dir = tempfile::tempdir().unwrap();
        tiny_pack(dir.path(), "xx", &["alpha"]);
        let mut engine = engine_over(dir.path(), Vec::new());

        let err = engine.check("shalom", "he").await.unwrap_err();
        assert!(
            crate::engines::is_unsupported_language::<Vec<Diagnostic>>(&Err(err)),
            "a missing pack must read as unsupported, not as a failure"
        );
    }

    #[tokio::test]
    async fn a_malformed_pack_is_an_error_and_is_only_read_once() {
        // The 2013 Latin dictionary really does say SFK where SFX belongs.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("xx.aff"),
            "SET UTF-8\nSFX k Y 129\nSFK k idis idos idis\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("xx.dic"), "1\nalpha\n").unwrap();
        let mut engine = engine_over(dir.path(), Vec::new());

        let first = engine.check("alpha", "xx").await.unwrap_err();
        assert!(
            !crate::engines::is_unsupported_language::<Vec<Diagnostic>>(&Err(first)),
            "a broken pack is a fault, not an absent language"
        );
        // Deleting the files proves the second call never touched the disk.
        std::fs::remove_file(dir.path().join("xx.aff")).unwrap();
        assert!(engine.check("alpha", "xx").await.is_err());
    }

    #[tokio::test]
    async fn a_language_outside_the_configured_list_is_declined() {
        let dir = tempfile::tempdir().unwrap();
        tiny_pack(dir.path(), "xx", &["alpha"]);
        tiny_pack(dir.path(), "en", &["alpha"]);
        let mut engine = engine_over(dir.path(), vec!["xx".to_string()]);

        assert!(engine.check("alpha", "xx").await.is_ok());
        let err = engine.check("alpha", "en-GB").await.unwrap_err();
        assert!(
            crate::engines::is_unsupported_language::<Vec<Diagnostic>>(&Err(err)),
            "an unlisted language must be declined, leaving it to Harper"
        );
    }

    #[tokio::test]
    async fn a_regional_tag_matches_a_configured_primary_subtag() {
        let dir = tempfile::tempdir().unwrap();
        tiny_pack(dir.path(), "en_GB", &["alpha"]);
        let mut engine = engine_over(dir.path(), vec!["en".to_string()]);
        assert!(engine.check("alpha", "en-GB").await.is_ok());
    }
}
