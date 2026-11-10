use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tracing::{debug, warn};

use crate::morphology::inflection;

/// Manages custom dictionaries for the language checker.
/// Words in the dictionary are excluded from spelling diagnostics.
///
/// Internally, user-added words and bundled words are kept in separate sets.
/// Only user words are persisted to `dictionary.txt`.
#[derive(Clone)]
pub struct Dictionary {
    user_words: HashSet<String>,
    bundled_words: HashSet<String>,
    /// Regular inflections generated from the other two sets by
    /// [`crate::morphology::inflection`].
    ///
    /// Third set rather than folded into `bundled_words` so that [`Self::persist`] is
    /// correct by construction: it reads `user_words` alone, and no derived form can
    /// ever reach the file that records what the user actually typed.
    derived_words: HashSet<String>,
    /// The site's own dictionary (`crate::site_dictionary`), lowercased, and its
    /// inflections: apart from the rest so it can be swapped whole when the site
    /// sends a new list, and left out whole when the config says so.
    site_words: HashSet<String>,
    site_derived: HashSet<String>,
    /// Which of the user's own words and the site's are accepted (`dictionaries.site`).
    use_own: bool,
    use_site: bool,
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
            user_words: HashSet::new(),
            bundled_words: HashSet::new(),
            derived_words: HashSet::new(),
            site_words: HashSet::new(),
            site_derived: HashSet::new(),
            use_own: true,
            use_site: true,
            workspace_path: None,
        }
    }

    /// Which dictionaries are accepted, as `dictionaries.site` says. Set before
    /// [`Self::derive_inflections`], which leaves out the words this turns off.
    pub const fn set_site_mode(&mut self, mode: crate::config::SiteDictionaryMode) {
        self.use_own = mode.uses_own();
        self.use_site = mode.uses_site();
    }

    /// Whether the user's own words are accepted; when not, adding one is pointless.
    #[must_use]
    pub const fn uses_own(&self) -> bool {
        self.use_own
    }

    /// Replaces the site's words, inflected when `inflect` is set.
    pub fn set_site_words(&mut self, words: &[String], inflect: bool) {
        self.site_words = words.iter().map(|w| w.to_lowercase()).collect();
        self.site_derived = if inflect {
            inflection::expand(self.site_words.iter().map(String::as_str)).unwrap_or_else(|error| {
                warn!(%error, "Could not inflect the site dictionary; exact matching only");
                HashSet::new()
            })
        } else {
            HashSet::new()
        };
    }

    /// Accepts one more of the site's words until the site's next list
    /// replaces them all: the word a user just asked to add to the site's
    /// dictionary, applied before the site has it.
    pub fn add_site_word(&mut self, word: &str, inflect: bool) {
        let lower = word.to_lowercase();
        if inflect && let Ok(forms) = inflection::expand([lower.as_str()]) {
            self.site_derived.extend(forms);
        }
        self.site_words.insert(lower);
    }

    /// Whether the site's words are accepted; when not, adding one there changes nothing here.
    #[must_use]
    pub const fn uses_site(&self) -> bool {
        self.use_site
    }

    /// How many of the site's words are loaded (accepted or not).
    #[must_use]
    pub fn site_len(&self) -> usize {
        self.site_words.len()
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
                    dict.user_words.insert(word.to_lowercase());
                }
            }
        }

        Ok(dict)
    }

    /// Load the bundled dictionaries that ship with the extension.
    /// These contain domain-specific technical terms from open-source wordlists.
    /// Bundled words are kept separate and never persisted to the user's dictionary file.
    pub fn load_bundled(&mut self) {
        self.load_bundled_except(&[]);
    }

    /// Load every bundled dictionary whose name is not listed in `disabled`.
    ///
    /// Names match those in `bundled::ALL` and the section headings of
    /// `dictionaries/THIRD_PARTY_NOTICES.md`, case-insensitively. An unrecognised
    /// name is warned about rather than rejected: a config that silently does
    /// nothing is harder to diagnose than one that says so.
    pub fn load_bundled_except(&mut self, disabled: &[String]) {
        for name in disabled {
            if !bundled::ALL
                .iter()
                .any(|(known, _)| known.eq_ignore_ascii_case(name))
            {
                warn!(
                    name,
                    known = ?bundled::NAMES,
                    "Unknown bundled dictionary in dictionaries.disabled; ignoring"
                );
            }
        }

        for (name, words_str) in bundled::ALL {
            if disabled.iter().any(|d| d.eq_ignore_ascii_case(name)) {
                debug!(name, "Skipping bundled dictionary");
                continue;
            }
            parse_wordlist_into(words_str, &mut self.bundled_words);
        }
    }

    /// Load additional words from a file path. The file is expected to contain
    /// one word per line; lines starting with `#` and blank lines are skipped.
    ///
    /// Paths are resolved relative to `base` if they are not absolute.
    pub fn load_wordlist_file(&mut self, path: &Path, base: &Path) -> Result<()> {
        let resolved = Self::wordlist_path(path, base)?;
        let content = std::fs::read_to_string(&resolved)
            .map_err(|e| anyhow::anyhow!("Cannot read wordlist {}: {e}", resolved.display()))?;
        parse_wordlist_into(&content, &mut self.bundled_words);
        Ok(())
    }

    /// Adds `word` to the wordlist file at `path`, creating it when it is not
    /// there yet, and accepts it at once with its inflections.
    ///
    /// Stricter than reading ([`Self::load_wordlist_file`], which also takes
    /// the user's config directories): a word can come from a web page, so it
    /// is written only to a file inside the workspace, and only when it is one
    /// plain token. A config naming `~/.config/fish/config.fish` would
    /// otherwise have a page's `$(...)` appended to a shell's startup file.
    /// Symlinks are followed only to check where they lead: a directory or a
    /// file linked out of the workspace is refused, and a new file is created
    /// without following anything already at its path.
    pub fn add_to_wordlist(&mut self, path: &Path, base: &Path, word: &str) -> Result<()> {
        let word = word.trim();
        anyhow::ensure!(
            !word.is_empty() && !word.chars().any(|c| c.is_whitespace() || c.is_control()),
            "{word:?} is not a single word"
        );
        let resolved = Self::writable_wordlist(path, base)?;
        let content = std::fs::read_to_string(&resolved)?;
        let lower = word.to_lowercase();
        let present = content
            .lines()
            .map(str::trim)
            .any(|line| !line.starts_with('#') && line.to_lowercase() == lower);
        if !present {
            let mut text = content;
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(word);
            text.push('\n');
            // Replaces the file by rename: a link put at its path since the
            // check is replaced, not followed.
            crate::fs_util::write_replacing(&resolved, text.as_bytes())?;
        }
        if self.bundled_words.insert(lower.clone())
            && let Ok(forms) = inflection::expand([lower.as_str()])
        {
            self.derived_words.extend(forms);
        }
        Ok(())
    }

    /// The real path of the wordlist at `path`, created empty when missing,
    /// inside the workspace `base` or refused.
    fn writable_wordlist(path: &Path, base: &Path) -> Result<PathBuf> {
        use std::path::Component;
        let root = base.canonicalize()?;
        let outside =
            || anyhow::anyhow!("Wordlist path {} is outside the workspace", path.display());
        // Lexically first: no climbing out, and an absolute path only into the workspace.
        anyhow::ensure!(
            !path.components().any(|c| c == Component::ParentDir),
            outside()
        );
        let target = if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        };
        anyhow::ensure!(target.starts_with(&root), outside());
        let name = target.file_name().ok_or_else(outside)?.to_owned();
        let parent = target.parent().ok_or_else(outside)?;
        // The nearest directory that exists must really be inside (a link
        // there would carry the new ones elsewhere); then create the rest.
        let existing = parent
            .ancestors()
            .find(|a| a.exists())
            .ok_or_else(outside)?;
        anyhow::ensure!(existing.canonicalize()?.starts_with(&root), outside());
        std::fs::create_dir_all(parent)?;
        let real_parent = parent.canonicalize()?;
        anyhow::ensure!(real_parent.starts_with(&root), outside());
        let file = real_parent.join(name);
        // create_new refuses anything already at the path, a dangling link
        // included, so a missing file is never created through one.
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
        {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
        let real = file.canonicalize().map_err(|_| outside())?;
        anyhow::ensure!(real.starts_with(&root) && real.is_file(), outside());
        Ok(real)
    }

    /// Where a wordlist path names, refused outside the workspace and the
    /// user's config directories.
    fn wordlist_path(path: &Path, base: &Path) -> Result<PathBuf> {
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else {
            base.join(path)
        };

        let resolved = resolved.canonicalize().map_err(|e| {
            anyhow::anyhow!("Cannot resolve wordlist path {}: {e}", resolved.display())
        })?;

        // Security: refuse to read files outside the workspace or common config dirs.
        // Canonicalize base too — on macOS /var → /private/var, on Windows UNC prefixes differ.
        let canonical_base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
        if !resolved.starts_with(&canonical_base)
            && !resolved.starts_with(dirs::config_dir().unwrap_or_default())
            && !resolved.starts_with(dirs::home_dir().unwrap_or_default().join(".config"))
        {
            anyhow::bail!(
                "Wordlist path {} is outside the workspace and known config directories",
                resolved.display()
            );
        }
        Ok(resolved)
    }

    /// Add a word to the user dictionary and persist to disk.
    ///
    /// The word's regular inflections are derived at the same time, so adding `functor`
    /// also accepts `functors` — that is the whole point of the feature, and a user who
    /// has to add both has not been helped. Only the word itself is written to disk.
    pub fn add_word(&mut self, word: &str) -> Result<()> {
        let lower = word.to_lowercase();
        if self.user_words.insert(lower.clone()) {
            // A failed expansion must not lose the word the user just added, so this is
            // reported and stepped over rather than propagated.
            match inflection::expand([lower.as_str()]) {
                Ok(forms) => self.derived_words.extend(forms),
                Err(error) => {
                    warn!(word = %lower, %error, "Could not inflect added word; the exact form is still accepted");
                }
            }
            self.persist()?;
        }
        Ok(())
    }

    /// Generate the regular inflections of every word loaded so far.
    ///
    /// Call once, after every wordlist is in place: the expansion is a snapshot, and
    /// words added later are inflected by [`Self::add_word`] instead.
    pub fn derive_inflections(&mut self) {
        let lemmas: Vec<&str> = self
            .user_words
            .iter()
            .filter(|_| self.use_own)
            .chain(self.bundled_words.iter())
            .map(String::as_str)
            .collect();
        match inflection::expand(lemmas) {
            Ok(forms) => {
                debug!(
                    lemmas = self.user_words.len() + self.bundled_words.len(),
                    derived = forms.len(),
                    "Generated dictionary inflections"
                );
                self.derived_words = forms;
            }
            Err(error) => warn!(%error, "Could not inflect the dictionary; exact matching only"),
        }
    }

    /// Check if a word is in the dictionary (case-insensitive).
    /// Checks both user words and bundled/external wordlists.
    ///
    /// A hyphenated compound also matches when every one of its parts is known
    /// on its own, so `Chern-Simons` resolves from `chern` and `simons`. The
    /// word handed to us is whatever span the engine reported, and the engines
    /// disagree about whether a compound is one token or two — matching both
    /// shapes here is the only place that can be correct for either.
    #[must_use]
    pub fn contains(&self, word: &str) -> bool {
        let lower = word.to_lowercase();
        if self.contains_exact(&lower) {
            return true;
        }
        self.is_known_compound(&lower)
    }

    /// Look a single already-lowercased token up in all three sets.
    fn contains_exact(&self, lower: &str) -> bool {
        (self.use_own && self.user_words.contains(lower))
            || self.bundled_words.contains(lower)
            || self.derived_words.contains(lower)
            || (self.use_site
                && (self.site_words.contains(lower) || self.site_derived.contains(lower)))
    }

    /// Whether `lower` is a hyphenated compound whose every part is known.
    ///
    /// A present hyphen always yields at least two parts, so the only shapes to
    /// reject are the ones with an empty part — a bare `-`, a trailing `chern-`,
    /// or a doubled `--` — which would otherwise decide "every part is known"
    /// over a single token, or over nothing at all.
    fn is_known_compound(&self, lower: &str) -> bool {
        const HYPHENS: [char; 3] = ['-', '\u{2010}', '\u{2011}'];
        lower.contains(HYPHENS)
            && lower
                .split(HYPHENS)
                .all(|part| !part.is_empty() && self.contains_exact(part))
    }

    /// Return every word accepted (user, bundled, site, as the config allows), excluding derived forms.
    pub fn words(&self) -> impl Iterator<Item = &String> {
        self.user_words
            .iter()
            .filter(|_| self.use_own)
            .chain(self.bundled_words.iter())
            .chain(self.site_words.iter().filter(|_| self.use_site))
    }

    /// Return the number of words loaded (user + bundled), excluding derived forms.
    /// A value that changes whenever the accepted words do.
    ///
    /// Read by the check cache. Adding a word to the dictionary must make the
    /// misspelling it covers disappear.
    ///
    /// No longer part of the check fingerprint: the dictionary filters what
    /// the engines produced rather than changing it, so a stored result keeps
    /// its raw diagnostics and this filter is re-applied on the way out. The
    /// fingerprint is still what the pack registry and the inspector compare.
    #[must_use]
    pub fn fingerprint(&self) -> u64 {
        let mut sorted: Vec<&str> = self.words().map(String::as_str).collect();
        sorted.sort_unstable();
        crate::hashing::stable_hash(&sorted.join("\u{1f}"))
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.user_words.len() + self.bundled_words.len()
    }

    /// How many inflected forms were generated from those words.
    #[must_use]
    pub fn derived_len(&self) -> usize {
        self.derived_words.len()
    }

    /// Whether the dictionary is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.user_words.is_empty() && self.bundled_words.is_empty()
    }

    /// Persist only user-added words to the workspace dictionary file.
    fn persist(&self) -> Result<()> {
        let Some(path) = &self.workspace_path else {
            return Ok(());
        };

        let mut words: Vec<&str> = self.user_words.iter().map(String::as_str).collect();
        words.sort_unstable();
        let content = words.join("\n");
        crate::fs_util::write_replacing(path, (content + "\n").as_bytes())
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
    pub const SOFTWARE_TERMS: &str = include_str!("../dictionaries/bundled/software-terms.txt");

    /// TypeScript and JavaScript keywords, builtins, and API terms.
    /// Source: cspell-dicts (typescript). License: MIT.
    pub const TYPESCRIPT: &str = include_str!("../dictionaries/bundled/typescript.txt");

    /// Well-known company and brand names.
    /// Source: cspell-dicts (companies). License: MIT.
    pub const COMPANIES: &str = include_str!("../dictionaries/bundled/companies.txt");

    /// Computing jargon, hardware terms, and domain-specific vocabulary.
    /// Sources: hunspell-jargon (MIT), `SpellCheckDic` (MIT),
    ///          autoware-spell-check-dict (Apache-2.0).
    pub const JARGON: &str = include_str!("../dictionaries/bundled/jargon.txt");

    /// Mathematics, category theory, type theory, and mathematical physics terms.
    ///
    /// Source: nLab page titles, harvested by `scripts/build-nlab-dictionary.py`.
    /// License: none formally stated; free use granted in exchange for attribution.
    pub const MATHEMATICS: &str = include_str!("../dictionaries/bundled/mathematics.txt");

    /// All bundled wordlists, keyed by the name users write in
    /// `dictionaries.disabled` to turn one off.
    pub const ALL: &[(&str, &str)] = &[
        ("software-terms", SOFTWARE_TERMS),
        ("typescript", TYPESCRIPT),
        ("companies", COMPANIES),
        ("jargon", JARGON),
        ("mathematics", MATHEMATICS),
    ];

    /// Just the names from [`ALL`], for diagnostics.
    pub const NAMES: &[&str] = &[
        "software-terms",
        "typescript",
        "companies",
        "jargon",
        "mathematics",
    ];
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
        dict.user_words.insert("hello".to_string());
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
        dict.user_words.insert("test".to_string());
        let initial_count = dict.words().count();
        dict.user_words.insert("test".to_string());
        assert_eq!(dict.words().count(), initial_count);
    }

    #[test]
    fn words_iterator() {
        let mut dict = Dictionary::new();
        dict.user_words.insert("alpha".to_string());
        dict.user_words.insert("beta".to_string());
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
        assert!(
            dict.contains("kubernetes"),
            "software-terms should include kubernetes"
        );
        assert!(
            dict.contains("webpack"),
            "software-terms should include webpack"
        );
        assert!(
            dict.contains("instanceof"),
            "typescript should include instanceof"
        );
        assert!(dict.contains("stdout"), "jargon should include stdout");
    }

    #[test]
    fn mathematics_dictionary_loads() {
        let mut dict = Dictionary::new();
        dict.load_bundled();

        for term in [
            "monoidal",
            "presheaf",
            "colimit",
            "endofunctor",
            "cobordism",
        ] {
            assert!(dict.contains(term), "mathematics should include {term}");
        }
        // Harvested with diacritics intact, and matched case-insensitively.
        assert!(dict.contains("étale"), "mathematics should include étale");
        assert!(dict.contains("Grothendieck"), "lookup is case-insensitive");
    }

    #[test]
    fn disabling_a_bundled_set_drops_only_that_set() {
        let mut dict = Dictionary::new();
        dict.load_bundled_except(&["mathematics".to_string()]);

        assert!(!dict.contains("presheaf"), "mathematics should be skipped");
        assert!(dict.contains("kubernetes"), "software-terms should remain");
        assert!(dict.contains("instanceof"), "typescript should remain");
    }

    #[test]
    fn disabled_set_names_are_case_insensitive() {
        let mut dict = Dictionary::new();
        dict.load_bundled_except(&["Mathematics".to_string()]);

        assert!(!dict.contains("presheaf"));
    }

    #[test]
    fn unknown_disabled_set_name_is_tolerated() {
        // A typo'd entry must not take the other dictionaries down with it.
        let mut dict = Dictionary::new();
        dict.load_bundled_except(&["mathmatics".to_string()]);

        assert!(
            dict.contains("presheaf"),
            "nothing should have been skipped"
        );
        assert!(dict.contains("kubernetes"));
    }

    #[test]
    fn every_bundled_set_has_a_name() {
        assert_eq!(bundled::ALL.len(), bundled::NAMES.len());
        for ((name, _), listed) in bundled::ALL.iter().zip(bundled::NAMES) {
            assert_eq!(name, listed);
        }
    }

    #[test]
    fn derived_inflections_are_accepted() {
        let mut dict = Dictionary::new();
        dict.user_words.insert("functor".to_string());
        assert!(!dict.contains("functors"));
        dict.derive_inflections();
        assert!(dict.contains("functors"));
        assert!(dict.contains("Functors"), "and case-insensitively");
    }

    #[test]
    fn derived_inflections_are_never_persisted() {
        let dir = std::env::temp_dir().join("lang_check_test_derived_persist");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut dict = Dictionary::load(&dir).unwrap();
        dict.add_word("functor").unwrap();
        assert!(dict.contains("functors"), "the plural is accepted");

        let written = std::fs::read_to_string(dir.join(".languagecheck/dictionary.txt")).unwrap();
        assert_eq!(
            written.trim(),
            "functor",
            "but only the typed word is recorded"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bundled_word_inflects_too() {
        let mut dict = Dictionary::new();
        dict.load_bundled();
        dict.derive_inflections();
        // `mathematics.txt` carries `subalgebras` but not `subalgebra`; the reverse gap
        // is what generation closes.
        assert!(dict.contains("preorders"));
        assert!(dict.derived_len() > 1000);
    }

    #[test]
    fn hyphenated_compound_matches_when_all_parts_known() {
        let mut dict = Dictionary::new();
        dict.load_bundled();

        assert!(dict.contains("Chern-Simons"));
        assert!(dict.contains("Yang-Mills"));
        assert!(dict.contains("Seiberg-Witten"));
        // Unicode hyphen (U+2010) and non-breaking hyphen (U+2011) too.
        assert!(dict.contains("Chern\u{2010}Simons"));
        assert!(dict.contains("Chern\u{2011}Simons"));
    }

    #[test]
    fn hyphenated_compound_rejected_when_a_part_is_unknown() {
        let mut dict = Dictionary::new();
        dict.user_words.insert("chern".to_string());

        assert!(!dict.contains("chern-simmmons"));
        assert!(!dict.contains("cherm-chern"));
    }

    #[test]
    fn hyphen_split_rejects_empty_parts() {
        let mut dict = Dictionary::new();
        dict.user_words.insert("chern".to_string());

        // A trailing, leading, or doubled hyphen leaves an empty part, which must
        // not collapse into "every part is known".
        for input in ["chern-", "-chern", "chern--chern", "-", "--"] {
            assert!(!dict.contains(input), "{input} must not match");
        }
    }

    #[test]
    fn hyphen_split_only_accepts_words_the_lists_already_carry() {
        // The compound rule widens what the word lists cover; it never invents
        // vocabulary. Both halves must be present independently, so an ordinary
        // hyphenated typo stays flagged.
        let mut dict = Dictionary::new();
        dict.user_words.insert("chern".to_string());
        dict.user_words.insert("simons".to_string());

        assert!(dict.contains("chern-simons"));
        assert!(!dict.contains("well-known"));
    }

    #[test]
    fn mathematics_dictionary_excludes_nlab_misspellings() {
        let mut dict = Dictionary::new();
        dict.load_bundled();

        // These appear in nLab `[[!redirects]]` aliases, which exist precisely so
        // that misspelled links keep resolving. Harvesting them would suppress
        // real typos, so the build script reads page titles only.
        for typo in [
            "alebraic",
            "cohomlogy",
            "basises",
            "automorpism",
            "geoemtric",
        ] {
            assert!(
                !dict.contains(typo),
                "{typo} must not be an accepted spelling"
            );
        }
    }

    #[test]
    fn bundled_plus_user_words() {
        let mut dict = Dictionary::new();
        dict.load_bundled();
        let bundled_count = dict.len();

        dict.user_words.insert("myprojectword".to_string());
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
    fn persistence_excludes_bundled_words() {
        let dir = std::env::temp_dir().join("lang_check_test_dict_bundled_persist");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Add a user word alongside bundled words
        {
            let mut dict = Dictionary::load(&dir).unwrap();
            dict.load_bundled();
            dict.add_word("myuserword").unwrap();
        }

        // Read the persisted file directly — should only contain user words
        let dict_path = dir.join(".languagecheck").join("dictionary.txt");
        let content = std::fs::read_to_string(&dict_path).unwrap();
        assert!(
            content.contains("myuserword"),
            "User word should be persisted"
        );
        assert!(
            !content.contains("kubernetes"),
            "Bundled words should NOT be persisted"
        );

        // Reload and verify everything still works
        {
            let mut dict = Dictionary::load(&dir).unwrap();
            dict.load_bundled();
            assert!(dict.contains("myuserword"));
            assert!(dict.contains("kubernetes"));
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_wordlist_file_relative_path() {
        let dir = std::env::temp_dir().join("lang_check_test_wordlist_rel");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(dir.join("terms.txt"), "myterm\n").unwrap();

        let mut dict = Dictionary::new();
        dict.load_wordlist_file(Path::new("terms.txt"), &dir)
            .unwrap();

        assert!(dict.contains("myterm"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_sites_words_count_as_the_config_says() {
        use crate::config::SiteDictionaryMode;
        let mut dict = Dictionary::new();
        dict.user_words.insert("ownword".to_string());
        dict.set_site_words(&["Databricks".to_string(), "functor".to_string()], true);
        assert!(dict.contains("databricks") && dict.contains("Databricks"));
        assert!(dict.contains("functors"), "the site's words inflect too");
        assert!(dict.contains("ownword"));

        dict.set_site_mode(SiteDictionaryMode::Ignore);
        assert!(!dict.contains("databricks") && !dict.contains("functors"));
        assert!(dict.contains("ownword"));

        dict.set_site_mode(SiteDictionaryMode::Only);
        assert!(dict.contains("databricks"));
        assert!(!dict.contains("ownword"));
        assert!(!dict.uses_own());

        // A new list replaces the old one whole.
        dict.set_site_mode(SiteDictionaryMode::Merge);
        dict.set_site_words(&["Vue".to_string()], true);
        assert!(dict.contains("vue") && !dict.contains("databricks"));
        assert_eq!(dict.site_len(), 1);
    }

    #[test]
    fn only_leaves_the_users_own_inflections_out_too() {
        let mut dict = Dictionary::new();
        dict.user_words.insert("functor".to_string());
        dict.set_site_mode(crate::config::SiteDictionaryMode::Only);
        dict.derive_inflections();
        assert!(!dict.contains("functors"));
    }

    #[test]
    fn a_word_is_added_to_a_wordlist_once_and_counts_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut dict = Dictionary::new();
        let path = Path::new("lists/terms.txt");
        dict.add_to_wordlist(path, dir.path(), "Functor").unwrap();
        dict.add_to_wordlist(path, dir.path(), "functor").unwrap();
        dict.add_to_wordlist(path, dir.path(), "Monad").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(path)).unwrap(),
            "Functor\nMonad\n"
        );
        assert!(dict.contains("functor") && dict.contains("functors") && dict.contains("monad"));
        assert!(!dir.path().join(".languagecheck/dictionary.txt").exists());
    }

    #[test]
    fn a_wordlist_outside_the_workspace_is_not_written() {
        let outer = tempfile::tempdir().unwrap();
        let workspace = outer.path().join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut dict = Dictionary::new();
        assert!(
            dict.add_to_wordlist(Path::new("../escape.txt"), &workspace, "word")
                .is_err()
        );
        assert!(!outer.path().join("escape.txt").exists());
    }

    #[test]
    fn a_wordlist_is_written_only_inside_the_workspace() {
        let outer = tempfile::tempdir().unwrap();
        let workspace = outer.path().join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut dict = Dictionary::new();
        let refused = |dict: &mut Dictionary, path: &Path| {
            dict.add_to_wordlist(path, &workspace, "word").is_err()
        };
        // Climbing out, or an absolute path elsewhere (a config directory included).
        assert!(refused(&mut dict, Path::new("../escape.txt")));
        assert!(refused(&mut dict, &outer.path().join("abs.txt")));
        assert!(refused(
            &mut dict,
            &dirs::config_dir().unwrap_or_default().join("lc-never.txt")
        ));
        assert!(
            !outer.path().join("escape.txt").exists() && !outer.path().join("abs.txt").exists()
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_workspace_is_neither_followed_nor_written_through() {
        use std::os::unix::fs::symlink;
        let outer = tempfile::tempdir().unwrap();
        let workspace = outer.path().join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut dict = Dictionary::new();
        // A dangling link where the new file would go.
        symlink(
            outer.path().join("target.txt"),
            workspace.join("dangling.txt"),
        )
        .unwrap();
        assert!(
            dict.add_to_wordlist(Path::new("dangling.txt"), &workspace, "word")
                .is_err()
        );
        assert!(!outer.path().join("target.txt").exists());
        // A link to an existing file outside.
        std::fs::write(outer.path().join("real.txt"), "keep\n").unwrap();
        symlink(outer.path().join("real.txt"), workspace.join("linked.txt")).unwrap();
        assert!(
            dict.add_to_wordlist(Path::new("linked.txt"), &workspace, "word")
                .is_err()
        );
        assert_eq!(
            std::fs::read_to_string(outer.path().join("real.txt")).unwrap(),
            "keep\n"
        );
        // A directory linked out, with the file to be made inside it.
        symlink(outer.path(), workspace.join("out")).unwrap();
        assert!(
            dict.add_to_wordlist(Path::new("out/new/list.txt"), &workspace, "word")
                .is_err()
        );
        assert!(!outer.path().join("new").exists());
    }

    #[test]
    fn only_a_single_plain_word_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let mut dict = Dictionary::new();
        for word in ["", "two words", "a\nb", "x\u{7}"] {
            assert!(
                dict.add_to_wordlist(Path::new("list.txt"), dir.path(), word)
                    .is_err(),
                "{word:?}"
            );
        }
        assert!(!dir.path().join("list.txt").exists());
    }
}
