//! Which files a config selects for checking, and why the rest were skipped.
//!
//! `include`, `exclude` and `file_types` decide what a project checks, and
//! until the answer is visible the only way to find out is to run a check and
//! count. A pattern that matches nothing and one that swallows a directory
//! nobody meant to drop both look exactly like a checker that is working.
//! The CLI's `config files` and the editor's Inspector both answer from here,
//! so they cannot disagree.

use std::path::{Component, Path, PathBuf};

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
            selection.sort_in(config, root, found, with_rejected);
        }
    }
    selection.finish()
}

/// Sort documents with no files on disk, as `select_files` sorts files.
///
/// A browser site's project is on the site, so its documents arrive as a
/// list rather than from a walk.
/// Each path is workspace-relative (`document_path` vets it); one whose
/// extension no grammar claims is left out, as the walk never finds it.
/// Paths come back under `root`.
#[must_use]
pub fn select_documents<'a>(
    config: &Config,
    root: &Path,
    documents: impl IntoIterator<Item = &'a str>,
    with_rejected: bool,
) -> Selection {
    let claimed: Vec<String> = crate::languages::all_file_patterns(config)
        .into_iter()
        .filter_map(|(pattern, _)| pattern.strip_prefix("**/*.").map(str::to_owned))
        .collect();
    let mut selection = Selection::default();
    for relative in documents.into_iter().filter_map(document_path) {
        let candidate = relative
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|ext| claimed.iter().any(|c| c.eq_ignore_ascii_case(ext)));
        if candidate {
            selection.sort_in(config, root, root.join(relative), with_rejected);
        }
    }
    selection.finish()
}

/// `raw` as a path inside a workspace, or `None`.
///
/// It must be relative and `/`-separated, every segment a plain name, so
/// `None` for anything that could leave the workspace or name it in another
/// way (`..`, `.`, an absolute path, a backslash, an empty segment, a
/// drive-like segment, a control character), and for anything over 1024
/// bytes. A colon elsewhere is a name's own (a Notion page "Week 1: Logic").
#[must_use]
pub fn document_path(raw: &str) -> Option<PathBuf> {
    let sound = !raw.is_empty()
        && raw.len() <= MAX_DOCUMENT_PATH_BYTES
        && !raw.contains('\\')
        && !raw.chars().any(char::is_control)
        // One plain name per segment: no `.` or `..`, and on Windows no
        // drive letter (`C:`), which the platform reads as a prefix.
        && raw.split('/').all(|segment| {
            let mut parts = Path::new(segment).components();
            !is_drive_like(segment)
                && matches!(parts.next(), Some(Component::Normal(_)))
                && parts.next().is_none()
        });
    sound.then(|| raw.split('/').collect())
}

/// Whether `segment` starts as Windows writes a drive (`C:`, `C:notes`).
/// Refused on every platform, so a page's path means the same everywhere
/// (the extension's `isDocumentPath` refuses it too).
const fn is_drive_like(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// The longest `document_path` taken, in bytes.
pub const MAX_DOCUMENT_PATH_BYTES: usize = 1024;

impl Selection {
    /// Put `path` with the files `config` checks, or with those it turned
    /// away (when they are wanted), naming the list that did it.
    fn sort_in(&mut self, config: &Config, root: &Path, path: PathBuf, with_rejected: bool) {
        if config.checks(&path, root) {
            self.selected.push(path);
        } else if with_rejected {
            let by = if !config.admits_type(&path) {
                RejectedBy::FileTypes
            } else if config.includes(&path, root) {
                RejectedBy::Exclude
            } else {
                RejectedBy::Include
            };
            self.rejected.push((path, by));
        }
    }

    fn finish(mut self) -> Self {
        self.selected.sort();
        self.selected.dedup();
        self.rejected.sort();
        self.rejected.dedup();
        self
    }
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

    #[test]
    fn documents_without_files_are_sorted_as_the_walk_sorts_files() {
        let dir = workspace(&[], "exclude: [\"chapters/drafts/**\", \"Journal/**\"]\n");
        let config = Config::load(dir.path()).unwrap();
        let selection = select_documents(
            &config,
            dir.path(),
            [
                "main.tex",
                "chapters/drafts/old.tex",
                "figures/plot.png",
                "Journal/Monday.md",
                "../outside.md",
                "/etc/hosts.md",
            ],
            true,
        );

        assert_eq!(relative(dir.path(), selection.selected), ["main.tex"]);
        let rejected: Vec<(String, RejectedBy)> = selection
            .rejected
            .into_iter()
            .map(|(p, by)| (relative(dir.path(), [p]).remove(0), by))
            .collect();
        // The image is no grammar's, so it is not listed at all, as on disk.
        assert_eq!(
            rejected,
            [
                ("Journal/Monday.md".into(), RejectedBy::Exclude),
                ("chapters/drafts/old.tex".into(), RejectedBy::Exclude),
            ]
        );
    }

    #[test]
    fn an_escaped_title_excludes_that_document_alone() {
        // What "Exclude Current File" writes for a title with glob characters
        // in it (globEscape in extension/src/config/edits.ts).
        let dir = workspace(&[], "exclude: [\"Notes/[[]draft[]] [*].md\"]\n");
        let config = Config::load(dir.path()).unwrap();
        let selection = select_documents(
            &config,
            dir.path(),
            ["Notes/[draft] *.md", "Notes/d plan.md"],
            true,
        );
        assert_eq!(
            relative(dir.path(), selection.selected),
            ["Notes/d plan.md"]
        );
        assert_eq!(selection.rejected.len(), 1);
    }

    #[test]
    fn a_document_path_never_leaves_the_workspace() {
        for bad in [
            "",
            "/abs.md",
            "../up.md",
            "a/../b.md",
            "./a.md",
            "a//b.md",
            "a/",
            "a\\b.md",
            "a\nb.md",
            "C:notes.md",
            "dir/c:x.md",
        ] {
            assert_eq!(document_path(bad), None, "{bad:?}");
        }
        assert_eq!(
            document_path(&"a".repeat(MAX_DOCUMENT_PATH_BYTES + 1)),
            None
        );
        assert_eq!(
            document_path("University Courses/Logical Verification.md"),
            Some(PathBuf::from("University Courses").join("Logical Verification.md"))
        );
    }
}
