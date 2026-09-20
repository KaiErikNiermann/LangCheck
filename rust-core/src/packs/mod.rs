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

pub mod catalogue;
pub mod install;

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
    /// A registry built the way the Hunspell engine's is.
    ///
    /// Shared so the engine and the check cache cannot disagree about which
    /// packs are in play -- the cache has to look at exactly what the engine
    /// would find, or it will serve an answer from before a pack was there.
    #[must_use]
    pub fn for_hunspell(config: &crate::config::HunspellConfig) -> Self {
        let mut registry = Self::new();
        for dir in &config.search_paths {
            registry = registry.with_search_path(dir);
        }
        for (language, path) in &config.dictionary_paths {
            registry = registry.with_override(language, path);
        }
        registry
    }

    /// A value that changes when the packs available for `languages` do.
    ///
    /// Read by the check cache. Installing a dictionary changes neither the
    /// document nor the config, so without this the stored result from before
    /// the install still applied -- and a language the user had just made
    /// readable went on being reported as unreadable until they edited
    /// something.
    ///
    /// Size and modification time are in it as well as the path, so replacing
    /// a pack in place counts as a change.
    #[must_use]
    pub fn fingerprint(&self, languages: &[String]) -> u64 {
        let mut parts: Vec<String> = Vec::new();

        let describe = |path: &Path| -> String {
            std::fs::metadata(path).map_or_else(
                |_| "missing".to_string(),
                |meta| {
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map_or(0, |d| d.as_secs());
                    format!("{}:{modified}", meta.len())
                },
            )
        };

        if languages.is_empty() {
            // Discovery mode: any pack in the managed directory may be used,
            // so the directory's contents are what matters.
            if let Some(dir) = managed_dir()
                && let Ok(entries) = std::fs::read_dir(&dir)
            {
                let mut listed: Vec<String> = entries
                    .flatten()
                    .map(|entry| {
                        format!(
                            "{}={}",
                            entry.file_name().to_string_lossy(),
                            describe(&entry.path())
                        )
                    })
                    .collect();
                listed.sort_unstable();
                parts.extend(listed);
            }
        } else {
            for language in languages {
                match self.resolve(language) {
                    Ok(pack) => parts.push(format!(
                        "{language}={}|{}|{}",
                        pack.stem,
                        describe(&pack.aff),
                        describe(&pack.dic),
                    )),
                    Err(_) => parts.push(format!("{language}=none")),
                }
            }
        }

        crate::hashing::stable_hash(&parts.join("\x1e"))
    }

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

/// Something wrong with a pack that does not stop it being used.
///
/// Separate from [`PackError`] because the two need opposite handling: an
/// error means the language goes unchecked, a warning means it is checked and
/// something about the pack is worth saying out loud.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackWarning {
    pub path: PathBuf,
    pub detail: String,
}

impl fmt::Display for PackWarning {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path.display(), self.detail)
    }
}

/// What validation found.
#[derive(Debug, Clone)]
pub struct PackReport {
    pub pack: ResolvedPack,
    /// Entries counted in the `.dic`, which is not always what it declares.
    pub entries: usize,
    pub warnings: Vec<PackWarning>,
}

/// How far the declared entry count may drift, in percent, before it is
/// worth mentioning.
///
/// Real dictionaries disagree with their own header: Hspell's Hebrew declares
/// 469,509 and carries 469,750, the Latin pack declares 129,290 and carries
/// 129,285. Hunspell treats the number as a hint for sizing a table, so this
/// cannot be an invariant -- enforcing it would reject both. A large gap still
/// suggests a truncated download, which is the case worth catching.
const COUNT_DRIFT_PERCENT: usize = 5;

/// How many `.dic` entries to feed back through the loaded dictionary.
///
/// The parser accepting a file does not mean the affix rules survived it. A
/// word taken from the dictionary's own list must be spelled correctly by the
/// dictionary that contains it; if it is not, something is wrong that no
/// amount of structural checking would have found.
const SELFTEST_SAMPLE: usize = 64;

/// Check a pack completely, before anything depends on it.
///
/// Run at install time rather than at first use, so a pack that downloads
/// cleanly and then will not load fails while the user is looking at the
/// install rather than three keystrokes into a paragraph.
///
/// # Errors
///
/// Returns [`PackError`] when the pack cannot be used at all: a path that is
/// not a readable file, a `.dic` without its entry count, a file the parser
/// rejects, or a dictionary that misspells its own entries.
pub fn validate(pack: &ResolvedPack) -> Result<PackReport, PackError> {
    let mut warnings = Vec::new();

    let aff = read_pack_file(&pack.aff)?;
    let dic = read_pack_file(&pack.dic)?;

    // The .dic opens with its entry count. A file that does not is either not
    // a dictionary or has lost its head.
    let mut lines = dic.lines();
    let header = lines
        .next()
        .unwrap_or_default()
        .trim_start_matches('\u{feff}');
    let declared: usize = header
        .split_whitespace()
        .next()
        .unwrap_or("")
        .parse()
        .map_err(|_| PackError::Malformed {
            path: pack.dic.clone(),
            detail: format!(
                "the first line should be the entry count, and reads {:?}",
                header.chars().take(40).collect::<String>()
            ),
        })?;

    let entries: Vec<&str> = lines.filter(|l| !l.trim().is_empty()).collect();
    let counted = entries.len();
    if declared > 0 {
        // Integer ratio, so no cast has to be justified for counts that can
        // reach the hundreds of thousands.
        let gap = counted.abs_diff(declared);
        if gap * 100 > declared * COUNT_DRIFT_PERCENT {
            warnings.push(PackWarning {
                path: pack.dic.clone(),
                detail: format!(
                    "declares {declared} entries and carries {counted}; \
                     the file may be truncated"
                ),
            });
        }
    }

    // Encoding is declared in the .aff. Without it Hunspell assumes Latin-1,
    // which is wrong for every language this engine exists to serve.
    if !aff.lines().any(|l| l.trim_start().starts_with("SET ")) {
        warnings.push(PackWarning {
            path: pack.aff.clone(),
            detail: "no SET line, so the encoding is assumed rather than declared".to_string(),
        });
    }

    let dictionary = spellbook::Dictionary::new(&aff, &dic).map_err(|e| PackError::Malformed {
        path: pack.aff.clone(),
        detail: e.to_string(),
    })?;

    // The dictionary must agree with itself.
    let step = (counted / SELFTEST_SAMPLE).max(1);
    let mut checked = 0usize;
    let mut rejected = Vec::new();
    for entry in entries.iter().step_by(step).take(SELFTEST_SAMPLE) {
        // An entry is `word/FLAGS`, sometimes with a morphological field after
        // a tab; only the stem is a word.
        let word = entry.split(['/', '\t']).next().unwrap_or_default().trim();
        if word.is_empty() || word.starts_with('#') {
            continue;
        }
        checked += 1;
        if !dictionary.check(word) {
            rejected.push(word.to_string());
        }
    }
    if checked > 0 && rejected.len() * 2 > checked {
        return Err(PackError::Malformed {
            path: pack.dic.clone(),
            detail: format!(
                "the dictionary rejects its own entries ({} of {checked} sampled, \
                 including {:?}); the affix rules do not match the word list",
                rejected.len(),
                rejected.iter().take(3).collect::<Vec<_>>()
            ),
        });
    }

    Ok(PackReport {
        pack: pack.clone(),
        entries: counted,
        warnings,
    })
}

/// Read one half of a pack, saying which path failed and how.
///
/// Checked rather than assumed: a resolved path can still be a directory, a
/// symlink to nothing, unreadable, or empty, and each of those produces a
/// different unhelpful error further down if it is not caught here.
fn read_pack_file(path: &Path) -> Result<String, PackError> {
    let metadata = std::fs::metadata(path).map_err(|e| PackError::Unreadable {
        path: path.to_path_buf(),
        detail: e.to_string(),
    })?;
    if !metadata.is_file() {
        return Err(PackError::Unreadable {
            path: path.to_path_buf(),
            detail: "not a regular file".to_string(),
        });
    }
    if metadata.len() == 0 {
        return Err(PackError::Unreadable {
            path: path.to_path_buf(),
            detail: "the file is empty".to_string(),
        });
    }
    std::fs::read_to_string(path).map_err(|e| PackError::Unreadable {
        path: path.to_path_buf(),
        detail: if e.kind() == std::io::ErrorKind::InvalidData {
            "not valid UTF-8; the pack may use a legacy encoding this build cannot read".to_string()
        } else {
            e.to_string()
        },
    })
}

#[cfg(test)]
mod tests {

    #[test]
    fn the_fingerprint_changes_when_a_pack_appears() {
        // Installing a dictionary changes neither the document nor the
        // config, so this is the only thing that can tell the check cache
        // that a language has become readable.
        let dir = std::env::temp_dir().join(format!("lc_packfp_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let registry = PackRegistry::new().with_only_search_paths(vec![dir.clone()]);
        let asked = vec!["he".to_string()];

        let before = registry.fingerprint(&asked);
        std::fs::write(dir.join("he_IL.aff"), "SET UTF-8\n").unwrap();
        std::fs::write(dir.join("he_IL.dic"), "1\nword\n").unwrap();
        let after = registry.fingerprint(&asked);

        assert_ne!(before, after, "a newly installed pack went unnoticed");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_fingerprint_is_stable_while_nothing_changes() {
        // Otherwise every check would miss the cache and the whole stored
        // result would be pointless.
        let dir = std::env::temp_dir().join(format!("lc_packfp_stable_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("he_IL.aff"), "SET UTF-8\n").unwrap();
        std::fs::write(dir.join("he_IL.dic"), "1\nword\n").unwrap();
        let registry = PackRegistry::new().with_only_search_paths(vec![dir.clone()]);
        let asked = vec!["he".to_string()];

        assert_eq!(registry.fingerprint(&asked), registry.fingerprint(&asked));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn replacing_a_pack_in_place_counts_as_a_change() {
        // The path is the same, so the path alone would say nothing changed.
        let dir = std::env::temp_dir().join(format!("lc_packfp_replace_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("he_IL.aff"), "SET UTF-8\n").unwrap();
        std::fs::write(dir.join("he_IL.dic"), "1\nword\n").unwrap();
        let registry = PackRegistry::new().with_only_search_paths(vec![dir.clone()]);
        let asked = vec!["he".to_string()];

        let before = registry.fingerprint(&asked);
        std::fs::write(dir.join("he_IL.dic"), "2\nword\nanother\n").unwrap();
        assert_ne!(before, registry.fingerprint(&asked));

        std::fs::remove_dir_all(&dir).ok();
    }
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

    // ── validation ─────────────────────────────────────────────────────────

    /// A pack whose halves are written verbatim, so a test can break one.
    fn raw_pack(aff: &str, dic: &str) -> (tempfile::TempDir, ResolvedPack) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("xx.aff"), aff).unwrap();
        std::fs::write(dir.path().join("xx.dic"), dic).unwrap();
        let pack = ResolvedPack {
            language: "xx".to_string(),
            stem: "xx".to_string(),
            aff: dir.path().join("xx.aff"),
            dic: dir.path().join("xx.dic"),
            source: PackSource::Managed,
        };
        (dir, pack)
    }

    const GOOD_AFF: &str = "SET UTF-8\n";
    const GOOD_DIC: &str = "3\nalpha\nbeta\ngamma\n";

    #[test]
    fn a_sound_pack_validates_without_warnings() {
        let (_dir, pack) = raw_pack(GOOD_AFF, GOOD_DIC);
        let report = validate(&pack).expect("should validate");
        assert_eq!(report.entries, 3);
        assert_eq!(
            report.warnings,
            Vec::new(),
            "a sound pack has nothing to report"
        );
    }

    #[test]
    fn a_dic_without_its_entry_count_is_malformed() {
        // Not a dictionary, or one that lost its head to a bad download.
        let (_dir, pack) = raw_pack(GOOD_AFF, "alpha\nbeta\n");
        let err = validate(&pack).unwrap_err();
        assert!(matches!(err, PackError::Malformed { .. }), "{err}");
        assert!(err.to_string().contains("entry count"), "{err}");
    }

    #[test]
    fn an_affix_file_the_parser_rejects_names_the_file() {
        // The real defect: the 2013 Latin pack says SFK where SFX belongs, so
        // its header promises 129 rows and the parser finds 2. Hunspell skips
        // the unknown line; Nuspell and this do not.
        let (_dir, pack) = raw_pack("SET UTF-8\nSFX k Y 129\nSFK k idis idos idis\n", GOOD_DIC);
        let err = validate(&pack).unwrap_err();
        assert!(matches!(err, PackError::Malformed { .. }), "{err}");
        assert!(err.to_string().contains("xx.aff"), "{err}");
    }

    #[test]
    fn a_truncated_dic_is_flagged_without_being_rejected() {
        // Still usable, and the user should know a third of the words are gone.
        let mut dic = String::from("300\n");
        for i in 0..100 {
            use std::fmt::Write as _;
            let _ = writeln!(dic, "word{i}a");
        }
        let (_dir, pack) = raw_pack(GOOD_AFF, &dic);
        let report = validate(&pack).expect("a short file is still a usable one");
        assert_eq!(report.entries, 100);
        assert_eq!(report.warnings.len(), 1, "{:?}", report.warnings);
        assert!(
            report.warnings[0].detail.contains("truncated"),
            "{:?}",
            report.warnings
        );
    }

    #[test]
    fn a_small_count_disagreement_is_not_worth_mentioning() {
        // Every real dictionary disagrees with its own header a little.
        let mut dic = String::from("100\n");
        for i in 0..99 {
            use std::fmt::Write as _;
            let _ = writeln!(dic, "word{i}a");
        }
        let (_dir, pack) = raw_pack(GOOD_AFF, &dic);
        assert_eq!(validate(&pack).unwrap().warnings, Vec::new());
    }

    #[test]
    fn an_affix_file_with_no_declared_encoding_is_flagged() {
        let (_dir, pack) = raw_pack("# no SET line here\n", GOOD_DIC);
        let report = validate(&pack).expect("still usable");
        assert!(
            report
                .warnings
                .iter()
                .any(|w| w.detail.contains("encoding")),
            "{:?}",
            report.warnings
        );
    }

    #[test]
    fn an_empty_file_is_reported_as_such() {
        let (_dir, pack) = raw_pack("", GOOD_DIC);
        let err = validate(&pack).unwrap_err();
        assert!(matches!(err, PackError::Unreadable { .. }), "{err}");
        assert!(err.to_string().contains("empty"), "{err}");
    }

    #[test]
    fn a_directory_where_a_file_belongs_is_reported_as_such() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("xx.aff")).unwrap();
        std::fs::write(dir.path().join("xx.dic"), GOOD_DIC).unwrap();
        let pack = ResolvedPack {
            language: "xx".to_string(),
            stem: "xx".to_string(),
            aff: dir.path().join("xx.aff"),
            dic: dir.path().join("xx.dic"),
            source: PackSource::Managed,
        };
        let err = validate(&pack).unwrap_err();
        assert!(err.to_string().contains("not a regular file"), "{err}");
    }

    #[test]
    fn a_missing_file_is_reported_with_its_path() {
        let dir = tempfile::tempdir().unwrap();
        let pack = ResolvedPack {
            language: "xx".to_string(),
            stem: "xx".to_string(),
            aff: dir.path().join("gone.aff"),
            dic: dir.path().join("gone.dic"),
            source: PackSource::Managed,
        };
        let err = validate(&pack).unwrap_err();
        assert!(matches!(err, PackError::Unreadable { .. }), "{err}");
        assert!(err.to_string().contains("gone.aff"), "{err}");
    }

    #[test]
    fn a_non_utf8_file_says_so_rather_than_failing_obscurely() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("xx.aff"),
            [0x53, 0x45, 0x54, 0x20, 0xff, 0xfe],
        )
        .unwrap();
        std::fs::write(dir.path().join("xx.dic"), GOOD_DIC).unwrap();
        let pack = ResolvedPack {
            language: "xx".to_string(),
            stem: "xx".to_string(),
            aff: dir.path().join("xx.aff"),
            dic: dir.path().join("xx.dic"),
            source: PackSource::Managed,
        };
        let err = validate(&pack).unwrap_err();
        assert!(err.to_string().contains("UTF-8"), "{err}");
    }

    #[test]
    fn a_dictionary_that_rejects_its_own_entries_is_malformed() {
        // Structure intact, parser happy, and the affix rules do not match the
        // word list -- which no amount of shape checking would have caught.
        let aff = "SET UTF-8\nFORBIDDENWORD X\n";
        let dic = "3\nalpha/X\nbeta/X\ngamma/X\n";
        let (_dir, pack) = raw_pack(aff, dic);
        let err = validate(&pack).unwrap_err();
        assert!(matches!(err, PackError::Malformed { .. }), "{err}");
        assert!(err.to_string().contains("its own entries"), "{err}");
    }

    #[test]
    fn a_byte_order_mark_does_not_hide_the_entry_count() {
        // The Latin pack ships one; without stripping it the count fails to
        // parse and a perfectly good dictionary reads as malformed.
        let (_dir, pack) = raw_pack(GOOD_AFF, "\u{feff}3\nalpha\nbeta\ngamma\n");
        assert_eq!(validate(&pack).expect("BOM is not corruption").entries, 3);
    }
}
