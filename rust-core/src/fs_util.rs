//! Filesystem helpers shared by the loaders that read a config directory.

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
