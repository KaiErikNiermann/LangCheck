//! Which files a config selects for checking, and why the rest were skipped.
//!
//! `include`, `exclude` and `file_types` decide what a project checks, and
//! until the answer is visible the only way to find out is to run a check and
//! count. A pattern that matches nothing and one that swallows a directory
//! nobody meant to drop both look exactly like a checker that is working.
//! The CLI's `config files` and the editor's Inspector both answer from here,
//! so they cannot disagree.

use std::path::{Path, PathBuf};

use glob::glob;

use crate::config::Config;

/// The config list that turned a file away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RejectedBy {
    /// Its extension is not in `file_types`.
    FileTypes,
    /// `include` is set and does not match it.
    Include,
    /// `exclude` matches it.
    Exclude,
}

impl RejectedBy {
    /// The config key, as a user writes it.
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::FileTypes => "file_types",
            Self::Include => "include",
            Self::Exclude => "exclude",
        }
    }
}

/// What a config selects, and what it turned away.
#[derive(Debug, Default)]
pub struct Selection {
    pub selected: Vec<PathBuf>,
    /// Each rejected path with the list that rejected it. Empty unless asked
    /// for, since collecting it walks every candidate twice over.
    pub rejected: Vec<(PathBuf, RejectedBy)>,
}

/// Walk the same patterns the indexer walks and sort the results by verdict.
///
/// The grammars decide which extensions are candidates, so this answers for
/// what the editor and CI will visit and not for every file on disk. Paths
/// come back as the glob found them, under `search_from`.
#[must_use]
pub fn select_files(
    config: &Config,
    root: &Path,
    search_from: &Path,
    with_rejected: bool,
) -> Selection {
    let mut patterns = crate::languages::all_file_patterns(config);
    patterns.sort();
    patterns.dedup();

    let mut selection = Selection::default();
    for (suffix, _lang) in &patterns {
        let Ok(entries) = glob(&format!("{}/{}", search_from.to_string_lossy(), suffix)) else {
            continue;
        };
        for found in entries.flatten() {
            if config.checks(&found, root) {
                selection.selected.push(found);
            } else if with_rejected {
                let by = if !config.admits_type(&found) {
                    RejectedBy::FileTypes
                } else if config.includes(&found, root) {
                    RejectedBy::Exclude
                } else {
                    RejectedBy::Include
                };
                selection.rejected.push((found, by));
            }
        }
    }
    selection.selected.sort();
    selection.selected.dedup();
    selection.rejected.sort();
    selection.rejected.dedup();
    selection
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(files: &[&str], config: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for file in files {
            let path = dir.path().join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "Some prose.\n").unwrap();
        }
        std::fs::write(dir.path().join(".languagecheck.yaml"), config).unwrap();
        dir
    }

    fn relative(root: &Path, paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
        paths
            .into_iter()
            .map(|p| {
                p.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    #[test]
    fn include_selects_and_exclude_subtracts() {
        let dir = workspace(
            &["docs/a.md", "docs/drafts/b.md", "notes.md", "page.html"],
            "include: [\"docs/**\"]\nexclude: [\"docs/drafts/**\"]\n",
        );
        let config = Config::load(dir.path()).unwrap();
        let selection = select_files(&config, dir.path(), dir.path(), true);

        assert_eq!(relative(dir.path(), selection.selected), ["docs/a.md"]);
        let rejected: Vec<(String, RejectedBy)> = selection
            .rejected
            .into_iter()
            .map(|(p, by)| (relative(dir.path(), [p]).remove(0), by))
            .collect();
        assert!(rejected.contains(&("docs/drafts/b.md".into(), RejectedBy::Exclude)));
        assert!(rejected.contains(&("notes.md".into(), RejectedBy::Include)));
        assert!(rejected.contains(&("page.html".into(), RejectedBy::Include)));
    }

    #[test]
    fn file_types_is_named_before_include() {
        let dir = workspace(&["a.md", "b.html"], "file_types: [md]\n");
        let config = Config::load(dir.path()).unwrap();
        let selection = select_files(&config, dir.path(), dir.path(), true);

        assert_eq!(relative(dir.path(), selection.selected), ["a.md"]);
        assert_eq!(selection.rejected.len(), 1);
        assert_eq!(selection.rejected[0].1, RejectedBy::FileTypes);
    }

    #[test]
    fn rejected_is_left_empty_unless_asked_for() {
        let dir = workspace(&["a.md", "b.md"], "exclude: [\"b.md\"]\n");
        let config = Config::load(dir.path()).unwrap();
        let selection = select_files(&config, dir.path(), dir.path(), false);

        assert_eq!(relative(dir.path(), selection.selected), ["a.md"]);
        assert_eq!(selection.rejected, Vec::<(PathBuf, RejectedBy)>::new());
    }
}
