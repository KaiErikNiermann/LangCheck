//! Finding, naming and validating Hunspell dictionary packs.
//!
//! A pack is an `.aff`/`.dic` pair for one language, in the format Hunspell
//! established and Nuspell, `LibreOffice`, Firefox and every desktop spell
//! checker reads. `lang-check` ships none of them: Hspell, which supplies
//! Hebrew, is AGPL-3.0, and the Latin dictionary is GPL, so bundling either
//! into an MIT binary published to crates.io and the Marketplace is not
//! something a licence permits. They are installed on request instead, into
//! the user's own data directory, which is how VS Code, Firefox and
//! `LibreOffice` handle the same problem.
//!
//! Resolution is deliberately generous about where a pack may already be,
//! because a Linux user who has run `pacman -S hunspell-he` should not be
//! asked to download a second copy.

use std::fmt;
use std::path::{Path, PathBuf};

/// Where a resolved pack came from, which decides what the user is told when
/// it misbehaves: a system pack is the distribution's to fix, a managed one is
/// ours to re-install.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackSource {
    /// Named outright in `engines.hunspell.dictionary_paths`.
    Configured,
    /// Already on the machine, in a directory the platform's spell checkers use.
    System,
    /// Installed by `lang-check` into the user data directory.
    Managed,
}

impl fmt::Display for PackSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Configured => "configured",
            Self::System => "system",
            Self::Managed => "managed",
        })
    }
}

/// An `.aff`/`.dic` pair that exists on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPack {
    /// The tag asked for, as given: `he`, `la`, `en-GB`.
    pub language: String,
    /// The pack's own stem, which is often more specific: `he_IL` for `he`.
    pub stem: String,
    pub aff: PathBuf,
    pub dic: PathBuf,
    pub source: PackSource,
}

/// Why a pack could not be used.
///
/// Separate variants rather than one string because the caller acts on them
/// differently: a missing pack is an offer to install, a malformed one is a
/// bug report against whoever shipped it, and neither should read as "the
/// spell checker is broken".
#[derive(Debug)]
pub enum PackError {
    /// No `.aff`/`.dic` pair for this language anywhere that was looked.
    NotFound {
        language: String,
        searched: Vec<PathBuf>,
    },
    /// Half a pack: one file of the pair is there and the other is not.
    Incomplete { language: String, missing: PathBuf },
    /// On disk but unreadable — permissions, a broken symlink, a bad encoding.
    Unreadable { path: PathBuf, detail: String },
    /// Readable, and rejected by the parser.
    ///
    /// Real dictionaries carry real defects. The 2013 Latin pack has two lines
    /// reading `SFK` where `SFX` belongs, so its affix header promises 129
    /// rows and the parser finds 2. Hunspell skips a line it does not
    /// recognise and Nuspell does not, which is why a pack can work in
    /// `LibreOffice` and fail here -- and why saying which file and which line
    /// matters more than the parser's own wording.
    Malformed { path: PathBuf, detail: String },
}

impl fmt::Display for PackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { language, searched } => {
                write!(f, "no Hunspell dictionary for \"{language}\"")?;
                if !searched.is_empty() {
                    write!(f, "; looked in ")?;
                    let shown: Vec<String> =
                        searched.iter().map(|p| p.display().to_string()).collect();
                    write!(f, "{}", shown.join(", "))?;
                }
                Ok(())
            }
            Self::Incomplete { language, missing } => write!(
                f,
                "the Hunspell dictionary for \"{language}\" is missing {}; an .aff and a .dic are both needed",
                missing.display()
            ),
            Self::Unreadable { path, detail } => {
                write!(f, "cannot read {}: {detail}", path.display())
            }
            Self::Malformed { path, detail } => write!(
                f,
                "{} is not a dictionary this checker can read: {detail}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for PackError {}

impl PackError {
    /// Whether installing a pack would fix this.
    ///
    /// The editor offers an install for exactly this case and stays quiet for
    /// the rest, because re-downloading a pack that is present and broken
    /// helps nobody.
    #[must_use]
    pub const fn is_installable(&self) -> bool {
        matches!(self, Self::NotFound { .. })
    }
}

/// Directories to look in, and the packs found in them.
#[derive(Debug, Clone, Default)]
pub struct PackRegistry {
    /// `language` -> a directory or an `.aff`/`.dic` stem named in config.
    overrides: Vec<(String, PathBuf)>,
    /// Searched in order after the overrides.
    search_paths: Vec<PathBuf>,
}

/// Where `lang-check` installs packs it fetches.
///
/// Beside the workspace databases, under the same `language-check` directory,
/// so everything the tool writes for a user lives in one place.
#[must_use]
pub fn managed_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("language-check").join("dictionaries"))
}

/// Directories the platform's own spell checkers keep dictionaries in.
///
/// Listed so a pack the user already installed through their package manager
/// is found rather than downloaded a second time.
#[must_use]
pub fn system_dirs() -> Vec<PathBuf> {
    let mut dirs_out: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            dirs_out.push(home.join("Library/Spelling"));
        }
        dirs_out.push(PathBuf::from("/Library/Spelling"));
        dirs_out.push(PathBuf::from("/System/Library/Spelling"));
    }

    #[cfg(target_os = "windows")]
    {
        // Windows has no shared convention; LibreOffice keeps its own, and a
        // user who wants one elsewhere names it in config.
        if let Some(data) = dirs::data_dir() {
            dirs_out.push(data.join("hunspell"));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        dirs_out.push(PathBuf::from("/usr/share/hunspell"));
        dirs_out.push(PathBuf::from("/usr/share/myspell"));
        dirs_out.push(PathBuf::from("/usr/share/myspell/dicts"));
        dirs_out.push(PathBuf::from("/usr/local/share/hunspell"));
        if let Some(home) = dirs::home_dir() {
            dirs_out.push(home.join(".local/share/hunspell"));
        }
    }

    dirs_out
}

impl PackRegistry {
    /// A registry searching the managed directory and the system ones.
    #[must_use]
    pub fn new() -> Self {
        let mut search_paths = Vec::new();
        // The managed directory first: a pack the user asked us to install
        // beats a stale system one.
        search_paths.extend(managed_dir());
        search_paths.extend(system_dirs());
        Self {
            overrides: Vec::new(),
            search_paths,
        }
    }

    /// Point one language at a directory or an explicit `.aff`/`.dic` stem.
    ///
    /// An override wins over everything, including a pack we installed, so a
    /// user can pin a dictionary they prefer and know it is the one in use.
    #[must_use]
    pub fn with_override(mut self, language: &str, path: impl Into<PathBuf>) -> Self {
        self.overrides.push((normalise_tag(language), path.into()));
        self
    }

    /// Add a directory to search after the overrides and before the defaults.
    #[must_use]
    pub fn with_search_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.search_paths.insert(0, path.into());
        self
    }

    /// Replace the default search paths entirely. For tests, and for a
    /// deployment that wants nothing but what it names.
    #[must_use]
    pub fn with_only_search_paths(mut self, paths: Vec<PathBuf>) -> Self {
        self.search_paths = paths;
        self
    }

    /// The directories this registry would look in, in order.
    #[must_use]
    pub fn search_paths(&self) -> &[PathBuf] {
        &self.search_paths
    }

    /// Find the pack for `language`, or say precisely why there is none.
    ///
    /// `language` is a BCP-47 tag. Hunspell packs are named with an underscore
    /// and are often more specific than the tag asked for -- `he` is shipped
    /// as `he_IL` -- so an exact match is tried first, then the primary subtag
    /// alone, then any pack whose primary subtag agrees.
    pub fn resolve(&self, language: &str) -> Result<ResolvedPack, PackError> {
        let tag = normalise_tag(language);

        for (over_lang, path) in &self.overrides {
            if over_lang != &tag {
                continue;
            }
            return resolve_override(language, path);
        }

        let mut searched = Vec::new();
        for dir in &self.search_paths {
            if !dir.is_dir() {
                continue;
            }
            searched.push(dir.clone());
            if let Some(stem) = find_stem(dir, &tag) {
                let source = if managed_dir().is_some_and(|m| dir.starts_with(&m)) {
                    PackSource::Managed
                } else {
                    PackSource::System
                };
                return complete_pair(language, dir, &stem, source);
            }
        }

        Err(PackError::NotFound {
            language: language.to_string(),
            searched,
        })
    }

    /// Every language this registry can resolve, for the inspector and for
    /// `language-check packs list`.
    #[must_use]
    pub fn installed(&self) -> Vec<ResolvedPack> {
        let mut found: Vec<ResolvedPack> = Vec::new();
        for dir in &self.search_paths {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "aff")
                    && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
                {
                    let source = if managed_dir().is_some_and(|m| dir.starts_with(&m)) {
                        PackSource::Managed
                    } else {
                        PackSource::System
                    };
                    if let Ok(pack) = complete_pair(stem, dir, stem, source)
                        && !found.iter().any(|p| p.stem == pack.stem)
                    {
                        found.push(pack);
                    }
                }
            }
        }
        found.sort_by(|a, b| a.stem.cmp(&b.stem));
        found
    }
}

/// `en-GB` and `en_GB` name the same pack; compare them the same way.
fn normalise_tag(language: &str) -> String {
    language.replace('-', "_").to_ascii_lowercase()
}

/// An override may name a directory, or an `.aff`/`.dic` stem, or either file
/// of the pair. All three are what a user reaches for, so all three work.
fn resolve_override(language: &str, path: &Path) -> Result<ResolvedPack, PackError> {
    let tag = normalise_tag(language);
    if path.is_dir() {
        return find_stem(path, &tag).map_or_else(
            || {
                Err(PackError::NotFound {
                    language: language.to_string(),
                    searched: vec![path.to_path_buf()],
                })
            },
            |stem| complete_pair(language, path, &stem, PackSource::Configured),
        );
    }

    // A file, or a stem with no extension.
    let stem_path = if matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("aff" | "dic")
    ) {
        path.with_extension("")
    } else {
        path.to_path_buf()
    };
    let dir = stem_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = stem_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string();
    complete_pair(language, dir, &stem, PackSource::Configured)
}

/// The best-matching pack stem in `dir`, if one is there.
fn find_stem(dir: &Path, tag: &str) -> Option<String> {
    let mut stems: Vec<String> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            (path.extension()? == "aff")
                .then(|| path.file_stem()?.to_str().map(str::to_string))
                .flatten()
        })
        .collect();
    stems.sort();

    // Exact: `he_il` for `he_il`.
    if let Some(hit) = stems.iter().find(|s| normalise_tag(s) == tag) {
        return Some(hit.clone());
    }
    // The tag's primary subtag as a whole stem: `la` for `la_la`.
    let primary = tag.split('_').next().unwrap_or(tag);
    if let Some(hit) = stems.iter().find(|s| normalise_tag(s) == primary) {
        return Some(hit.clone());
    }
    // Any pack of the same language: `he_il` for `he`. Sorted, so the choice
    // is the same on every machine rather than whatever the directory yields.
    stems
        .iter()
        .find(|s| {
            normalise_tag(s)
                .split('_')
                .next()
                .is_some_and(|p| p == primary)
        })
        .cloned()
}

/// Both halves of a pair, or a report of which half is missing.
fn complete_pair(
    language: &str,
    dir: &Path,
    stem: &str,
    source: PackSource,
) -> Result<ResolvedPack, PackError> {
    let aff = dir.join(format!("{stem}.aff"));
    let dic = dir.join(format!("{stem}.dic"));
    for path in [&aff, &dic] {
        if !path.is_file() {
            return Err(PackError::Incomplete {
                language: language.to_string(),
                missing: path.clone(),
            });
        }
    }
    Ok(ResolvedPack {
        language: language.to_string(),
        stem: stem.to_string(),
        aff,
        dic,
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory holding the named `.aff`/`.dic` stems, plus any lone files.
    fn pack_dir(stems: &[&str], lone: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        for stem in stems {
            std::fs::write(dir.path().join(format!("{stem}.aff")), "SET UTF-8\n").unwrap();
            std::fs::write(dir.path().join(format!("{stem}.dic")), "1\nword\n").unwrap();
        }
        for name in lone {
            std::fs::write(dir.path().join(name), "").unwrap();
        }
        dir
    }

    fn registry(dir: &tempfile::TempDir) -> PackRegistry {
        PackRegistry::new().with_only_search_paths(vec![dir.path().to_path_buf()])
    }

    #[test]
    fn an_exact_tag_wins() {
        let dir = pack_dir(&["en_GB", "en_US"], &[]);
        assert_eq!(registry(&dir).resolve("en-GB").unwrap().stem, "en_GB");
    }

    #[test]
    fn a_bare_tag_finds_the_regional_pack_it_is_shipped_as() {
        // Hspell ships Hebrew as he_IL; a document that says `lang: "he"` has
        // to find it or the language is unsupported for no good reason.
        let dir = pack_dir(&["he_IL"], &[]);
        let pack = registry(&dir).resolve("he").unwrap();
        assert_eq!(pack.stem, "he_IL");
        assert_eq!(pack.language, "he");
    }

    #[test]
    fn a_bare_stem_is_found_for_a_bare_tag() {
        let dir = pack_dir(&["la"], &[]);
        assert_eq!(registry(&dir).resolve("la").unwrap().stem, "la");
    }

    #[test]
    fn a_bare_stem_beats_a_regional_one_for_a_bare_tag() {
        let dir = pack_dir(&["la", "la_LA"], &[]);
        assert_eq!(registry(&dir).resolve("la").unwrap().stem, "la");
    }

    #[test]
    fn the_choice_among_regional_packs_is_the_same_every_run() {
        // Directory order is not stable, and a checker that picks en_AU on one
        // machine and en_ZA on another is not reproducible.
        let dir = pack_dir(&["en_ZA", "en_AU", "en_CA"], &[]);
        for _ in 0..8 {
            assert_eq!(registry(&dir).resolve("en").unwrap().stem, "en_AU");
        }
    }

    #[test]
    fn a_language_with_no_pack_says_where_it_looked() {
        let dir = pack_dir(&["en_GB"], &[]);
        let err = registry(&dir).resolve("he").unwrap_err();
        assert!(err.is_installable(), "a missing pack is installable");
        let message = err.to_string();
        assert!(message.contains("\"he\""), "{message}");
        assert!(
            message.contains(&dir.path().display().to_string()),
            "{message}"
        );
    }

    #[test]
    fn half_a_pack_is_not_a_missing_one() {
        // An .aff with no .dic is a broken install, not an absent one, and
        // offering to download over it would hide the real problem.
        let dir = pack_dir(&[], &["he_IL.aff"]);
        let err = registry(&dir).resolve("he").unwrap_err();
        assert!(matches!(err, PackError::Incomplete { .. }), "{err}");
        assert!(!err.is_installable());
        assert!(err.to_string().contains("he_IL.dic"), "{err}");
    }

    #[test]
    fn an_override_beats_every_search_path() {
        let installed = pack_dir(&["he_IL"], &[]);
        let preferred = pack_dir(&["he_IL"], &[]);
        let pack = registry(&installed)
            .with_override("he", preferred.path())
            .resolve("he")
            .unwrap();
        assert_eq!(pack.source, PackSource::Configured);
        assert!(pack.aff.starts_with(preferred.path()), "{:?}", pack.aff);
    }

    #[test]
    fn an_override_may_name_a_directory_a_stem_or_either_file() {
        let dir = pack_dir(&["he_IL"], &[]);
        let stem = dir.path().join("he_IL");
        for form in [
            dir.path().to_path_buf(),
            stem.clone(),
            stem.with_extension("aff"),
            stem.with_extension("dic"),
        ] {
            let pack = PackRegistry::new()
                .with_only_search_paths(Vec::new())
                .with_override("he", &form)
                .resolve("he")
                .unwrap_or_else(|e| panic!("override {form:?} did not resolve: {e}"));
            assert_eq!(pack.stem, "he_IL");
            assert_eq!(pack.source, PackSource::Configured);
        }
    }

    #[test]
    fn an_override_pointing_nowhere_reports_the_path_it_was_given() {
        let missing = PathBuf::from("/nonexistent/dictionaries/he_IL");
        let err = PackRegistry::new()
            .with_only_search_paths(Vec::new())
            .with_override("he", &missing)
            .resolve("he")
            .unwrap_err();
        assert!(matches!(err, PackError::Incomplete { .. }), "{err}");
        assert!(err.to_string().contains("he_IL"), "{err}");
    }

    #[test]
    fn an_earlier_search_path_wins() {
        let first = pack_dir(&["he_IL"], &[]);
        let second = pack_dir(&["he_IL"], &[]);
        let pack = PackRegistry::new()
            .with_only_search_paths(vec![
                first.path().to_path_buf(),
                second.path().to_path_buf(),
            ])
            .resolve("he")
            .unwrap();
        assert!(pack.aff.starts_with(first.path()));
    }

    #[test]
    fn listing_installed_packs_reports_each_stem_once() {
        let first = pack_dir(&["he_IL", "la"], &[]);
        let second = pack_dir(&["he_IL", "en_GB"], &[]);
        let installed = PackRegistry::new()
            .with_only_search_paths(vec![
                first.path().to_path_buf(),
                second.path().to_path_buf(),
            ])
            .installed();
        let stems: Vec<&str> = installed.iter().map(|p| p.stem.as_str()).collect();
        assert_eq!(stems, vec!["en_GB", "he_IL", "la"]);
    }

    #[test]
    fn a_missing_directory_is_skipped_rather_than_fatal() {
        let dir = pack_dir(&["he_IL"], &[]);
        let pack = PackRegistry::new()
            .with_only_search_paths(vec![
                PathBuf::from("/nonexistent/one"),
                dir.path().to_path_buf(),
            ])
            .resolve("he")
            .unwrap();
        assert_eq!(pack.stem, "he_IL");
    }

    #[test]
    fn tags_compare_without_case_or_separator() {
        let dir = pack_dir(&["en_GB"], &[]);
        for tag in ["en-GB", "en_gb", "EN-gb", "en_GB"] {
            assert_eq!(registry(&dir).resolve(tag).unwrap().stem, "en_GB", "{tag}");
        }
    }
}
