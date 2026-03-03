use crate::checker::Diagnostic;
use crate::insights::ProseInsights;
use anyhow::Result;
use redb::{Database, ReadableDatabase, TableDefinition};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

const DIAGNOSTICS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("diagnostics");
const INSIGHTS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("insights");
const FILE_HASHES_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("file_hashes");

pub struct WorkspaceIndex {
    db: Database,
    root_path: PathBuf,
}

impl WorkspaceIndex {
    /// Create or open a workspace index.
    ///
    /// If `db_path` is provided, the database is created at that exact path.
    /// Otherwise, the database is stored in the user data directory
    /// (`~/.local/share/language-check/dbs/` on Linux,
    ///  `~/Library/Application Support/language-check/dbs/` on macOS,
    ///  `%APPDATA%/language-check/dbs/` on Windows),
    /// named by a hash of the workspace root to avoid collisions.
    pub fn new(workspace_root: &Path, db_path: Option<&Path>) -> Result<Self> {
        let resolved_path = match db_path {
            Some(p) => p.to_path_buf(),
            None => default_db_path(workspace_root)?,
        };

        if let Some(parent) = resolved_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db = Database::create(&resolved_path)?;

        let write_txn = db.begin_write()?;
        {
            let _table = write_txn.open_table(DIAGNOSTICS_TABLE)?;
            let _table = write_txn.open_table(INSIGHTS_TABLE)?;
            let _table = write_txn.open_table(FILE_HASHES_TABLE)?;
        }
        write_txn.commit()?;

        Ok(Self {
            db,
            root_path: workspace_root.to_path_buf(),
        })
    }

    #[must_use]
    pub fn get_root_path(&self) -> Option<&Path> {
        Some(&self.root_path)
    }

    /// Check if a file's content has changed since last indexing.
    /// Returns true if unchanged (cache hit), false if changed or new.
    #[must_use]
    pub fn is_file_unchanged(&self, file_path: &str, content: &str) -> bool {
        let new_hash = Self::hash_content(content);
        let Ok(read_txn) = self.db.begin_read() else {
            return false;
        };
        let Ok(table) = read_txn.open_table(FILE_HASHES_TABLE) else {
            return false;
        };
        let Ok(Some(stored)) = table.get(file_path) else {
            return false;
        };

        stored.value() == new_hash.to_le_bytes()
    }

    /// Store the content hash for a file after indexing.
    pub fn update_file_hash(&self, file_path: &str, content: &str) -> Result<()> {
        let hash = Self::hash_content(content);
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(FILE_HASHES_TABLE)?;
            table.insert(file_path, hash.to_le_bytes().as_slice())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    fn hash_content(content: &str) -> u64 {
        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        hasher.finish()
    }

    pub fn update_diagnostics(&self, file_path: &str, diagnostics: &[Diagnostic]) -> Result<()> {
        let mut data = Vec::new();
        ciborium::into_writer(&diagnostics, &mut data)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(DIAGNOSTICS_TABLE)?;
            table.insert(file_path, data.as_slice())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn update_insights(&self, file_path: &str, insights: &ProseInsights) -> Result<()> {
        let mut data = Vec::new();
        ciborium::into_writer(&insights, &mut data)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(INSIGHTS_TABLE)?;
            table.insert(file_path, data.as_slice())?;
        }
        write_txn.commit()?;
        Ok(())
    }

    pub fn get_diagnostics(&self, file_path: &str) -> Result<Option<Vec<Diagnostic>>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(DIAGNOSTICS_TABLE)?;
        let result = table.get(file_path)?;

        if let Some(data) = result {
            let diagnostics = ciborium::from_reader(data.value())?;
            Ok(Some(diagnostics))
        } else {
            Ok(None)
        }
    }

    pub fn get_insights(&self, file_path: &str) -> Result<Option<ProseInsights>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(INSIGHTS_TABLE)?;
        let result = table.get(file_path)?;

        if let Some(data) = result {
            let insights = ciborium::from_reader(data.value())?;
            Ok(Some(insights))
        } else {
            Ok(None)
        }
    }
}

/// Compute the default database path for a workspace.
///
/// Uses `dirs::data_dir()` (`~/.local/share` on Linux, `~/Library/Application Support`
/// on macOS, `%APPDATA%` on Windows) as the base, then appends
/// `language-check/dbs/<hex-hash>.db` where the hash is derived from the
/// canonical workspace root path.
fn default_db_path(workspace_root: &Path) -> Result<PathBuf> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| anyhow::anyhow!("Could not determine user data directory"))?;

    let canonical = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());

    let mut hasher = DefaultHasher::new();
    canonical.to_string_lossy().hash(&mut hasher);
    let hash = hasher.finish();

    let db_dir = data_dir.join("language-check").join("dbs");
    Ok(db_dir.join(format!("{hash:016x}.db")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> (WorkspaceIndex, PathBuf) {
        let dir = std::env::temp_dir().join(format!("lang_check_ws_{}", name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Tests use explicit db_path in temp dir to avoid polluting user data dir
        let db_path = dir.join(".languagecheck.db");
        let idx = WorkspaceIndex::new(&dir, Some(&db_path)).unwrap();
        (idx, dir)
    }

    fn cleanup(dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn create_workspace_index() {
        let (idx, dir) = temp_workspace("create");
        assert_eq!(idx.get_root_path().unwrap(), &dir);
        cleanup(&dir);
    }

    #[test]
    fn diagnostics_roundtrip() {
        let (idx, dir) = temp_workspace("diag_rt");

        let diags = vec![Diagnostic {
            start_byte: 0,
            end_byte: 5,
            message: "test error".to_string(),
            suggestions: vec!["fix".to_string()],
            rule_id: "test.rule".to_string(),
            severity: 2,
            unified_id: "test.unified".to_string(),
            confidence: 0.9,
        }];

        idx.update_diagnostics("test.md", &diags).unwrap();
        let retrieved = idx.get_diagnostics("test.md").unwrap().unwrap();
        assert_eq!(retrieved.len(), 1);
        assert_eq!(retrieved[0].message, "test error");
        assert_eq!(retrieved[0].start_byte, 0);
        assert_eq!(retrieved[0].suggestions, vec!["fix"]);

        cleanup(&dir);
    }

    #[test]
    fn diagnostics_missing_file_returns_none() {
        let (idx, dir) = temp_workspace("diag_none");
        let result = idx.get_diagnostics("nonexistent.md").unwrap();
        assert!(result.is_none());
        cleanup(&dir);
    }

    #[test]
    fn insights_roundtrip() {
        let (idx, dir) = temp_workspace("insights_rt");

        let insights = ProseInsights {
            word_count: 100,
            sentence_count: 5,
            character_count: 450,
            reading_level: 8.5,
        };

        idx.update_insights("doc.md", &insights).unwrap();
        let retrieved = idx.get_insights("doc.md").unwrap().unwrap();
        assert_eq!(retrieved.word_count, 100);
        assert_eq!(retrieved.sentence_count, 5);
        assert_eq!(retrieved.character_count, 450);
        assert!((retrieved.reading_level - 8.5).abs() < 0.01);

        cleanup(&dir);
    }

    #[test]
    fn file_hash_unchanged_detection() {
        let (idx, dir) = temp_workspace("hash_unchanged");

        let content = "Hello, world!";
        idx.update_file_hash("test.md", content).unwrap();
        assert!(idx.is_file_unchanged("test.md", content));

        cleanup(&dir);
    }

    #[test]
    fn file_hash_changed_detection() {
        let (idx, dir) = temp_workspace("hash_changed");

        idx.update_file_hash("test.md", "original content").unwrap();
        assert!(!idx.is_file_unchanged("test.md", "modified content"));

        cleanup(&dir);
    }

    #[test]
    fn file_hash_new_file() {
        let (idx, dir) = temp_workspace("hash_new");
        assert!(!idx.is_file_unchanged("new.md", "any content"));
        cleanup(&dir);
    }

    #[test]
    fn overwrite_diagnostics() {
        let (idx, dir) = temp_workspace("diag_overwrite");

        let diags1 = vec![Diagnostic {
            start_byte: 0,
            end_byte: 3,
            message: "first".to_string(),
            ..Default::default()
        }];
        idx.update_diagnostics("f.md", &diags1).unwrap();

        let diags2 = vec![
            Diagnostic {
                start_byte: 0,
                end_byte: 3,
                message: "second".to_string(),
                ..Default::default()
            },
            Diagnostic {
                start_byte: 10,
                end_byte: 15,
                message: "third".to_string(),
                ..Default::default()
            },
        ];
        idx.update_diagnostics("f.md", &diags2).unwrap();

        let retrieved = idx.get_diagnostics("f.md").unwrap().unwrap();
        assert_eq!(retrieved.len(), 2);
        assert_eq!(retrieved[0].message, "second");

        cleanup(&dir);
    }
}
