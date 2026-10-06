//! Filesystem helpers: the loaders that read a config directory, and the
//! writer for the files the core keeps in the workspace.

use std::io::Write;
use std::path::Path;

use anyhow::Result;

/// Call `load` for every `.yaml`/`.yml` file directly in `dir`, summing what
/// each call returns.
///
/// A missing directory is not an error: an absent `.langcheck/` means no
/// schemas and no style rules, which is the normal case for a project that
/// configures neither.
pub fn load_yaml_dir(dir: &Path, mut load: impl FnMut(&Path) -> Result<usize>) -> Result<usize> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut total = 0;
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|ext| ext == "yaml" || ext == "yml")
        {
            total += load(&path)?;
        }
    }
    Ok(total)
}

/// Replace `path` with `contents`, creating its parent directories.
///
/// Written to a temporary file beside it and renamed over it, so a reader
/// never sees half a file and a crash leaves the old one. The rename also
/// replaces a symlink at `path` rather than writing through it: these files
/// live in a repository someone else may have written, and a
/// `.languagecheck/dictionary.txt` linked to `~/.bashrc` must not get it
/// overwritten with a word list.
pub fn write_replacing(path: &Path, contents: &[u8]) -> Result<()> {
    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    std::fs::create_dir_all(parent)?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    tmp.write_all(contents)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_replacing_creates_parents_and_replaces_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".languagecheck/dictionary.txt");
        write_replacing(&path, b"one\n").unwrap();
        write_replacing(&path, b"two\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two\n");
    }

    #[cfg(unix)]
    #[test]
    fn write_replacing_does_not_write_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, "precious\n").unwrap();
        let link = dir.path().join("dictionary.txt");
        std::os::unix::fs::symlink(&outside, &link).unwrap();

        write_replacing(&link, b"word\n").unwrap();

        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "precious\n");
        assert!(!std::fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "word\n");
    }
}
