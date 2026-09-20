use crate::checker::Diagnostic;
use serde::{Deserialize, Serialize};
use crate::insights::ProseInsights;
use anyhow::Result;
use redb::{Database, ReadableDatabase, TableDefinition};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Every table in the index maps a file path to an opaque byte blob, so one
/// pair of accessors serves all three.
type Table = TableDefinition<'static, &'static str, &'static [u8]>;

const DIAGNOSTICS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("diagnostics");
const INSIGHTS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("insights");
const FILE_HASHES_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("file_hashes");

/// What a check's answer depends on, as one value.
///
/// A stored result is served only when this still matches, so every input that
/// can change the answer has to be in here. The document text, because an
/// edited buffer must be re-checked -- VS Code restores unsaved buffers across
/// a reload, so a cache keyed on the file path alone would answer a dirty
/// buffer with diagnostics computed from the saved version: right words, wrong
/// offsets. The config, because it decides which engines run and at what
/// severity. The dictionary and the ignored set, because both remove
/// diagnostics after the engines produced them. Whether names are detected,
/// for the same reason. And the version of this program, because an upgrade
/// changes what the engines say without any of the above moving.
///
/// `stable_hash` and not `content_hash`: this value is written to disk in one
/// process and compared in another.
#[must_use]
pub fn check_fingerprint(
    text: &str,
    config: &crate::config::Config,
    dictionary: &crate::dictionary::Dictionary,
    ignore_store: &crate::hashing::IgnoreStore,
    names_enabled: bool,
) -> u64 {
    let config_repr = serde_json::to_string(config).unwrap_or_default();
    crate::hashing::stable_hash(&format!(
        "{}\x1e{}\x1e{}\x1e{}\x1e{}\x1e{}",
        crate::hashing::stable_hash(text),
        crate::hashing::stable_hash(&config_repr),
        dictionary.fingerprint(),
        ignore_store.fingerprint(),
        names_enabled,
        env!("CARGO_PKG_VERSION"),
    ))
}

/// A check's result, with what it was computed from.
///
/// The fingerprint covers everything that can change the answer -- the
/// document text, the config, the user dictionary, the ignored diagnostics,
/// whether name detection is on, and the version of this program. A stored
/// result is served only when the fingerprint still matches, so there is one
/// decision to get right rather than one per input.
///
/// Storing the result without it was the previous state of things: every check
/// wrote here and nothing ever read it back.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedCheck {
    pub fingerprint: u64,
    pub diagnostics: Vec<Diagnostic>,
}

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
        let new_hash = crate::hashing::content_hash(content);
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
        let hash = crate::hashing::content_hash(content);
        self.put_bytes(FILE_HASHES_TABLE, file_path, hash.to_le_bytes().as_slice())
    }


    pub fn update_insights(&self, file_path: &str, insights: &ProseInsights) -> Result<()> {
        self.put_cbor(INSIGHTS_TABLE, file_path, &insights)
    }


    pub fn get_insights(&self, file_path: &str) -> Result<Option<ProseInsights>> {
        self.get_cbor(INSIGHTS_TABLE, file_path)
    }

    /// The stored result for `file_path`, if it still applies.
    ///
    /// A fingerprint mismatch is a miss, and so is anything unreadable: an
    /// index written by an older version holds a different shape, and failing
    /// a check because of it would be worse than doing the work again.
    #[must_use]
    pub fn cached_check(&self, file_path: &str, fingerprint: u64) -> Option<Vec<Diagnostic>> {
        let stored: CachedCheck = self.get_cbor(DIAGNOSTICS_TABLE, file_path).ok()??;
        (stored.fingerprint == fingerprint).then_some(stored.diagnostics)
    }

    /// Record a check's result together with what produced it.
    pub fn store_check(
        &self,
        file_path: &str,
        fingerprint: u64,
        diagnostics: &[Diagnostic],
    ) -> Result<()> {
        self.put_cbor(
            DIAGNOSTICS_TABLE,
            file_path,
            &CachedCheck {
                fingerprint,
                diagnostics: diagnostics.to_vec(),
            },
        )
    }

    /// Write `bytes` under `key`, in a transaction of its own.
    fn put_bytes(&self, table: Table, key: &str, bytes: &[u8]) -> Result<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(table)?;
            table.insert(key, bytes)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Write `value` under `key` as CBOR.
    fn put_cbor<T: serde::Serialize>(&self, table: Table, key: &str, value: &T) -> Result<()> {
        let mut data = Vec::new();
        // nosemgrep: workspace-blobs-through-cbor-helpers -- this is the helper.
        ciborium::into_writer(value, &mut data)?;
        self.put_bytes(table, key, &data)
    }

    /// Read back what [`Self::put_cbor`] stored, if anything is under `key`.
    fn get_cbor<T: serde::de::DeserializeOwned>(
        &self,
        table: Table,
        key: &str,
    ) -> Result<Option<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(table)?;
        let Some(data) = table.get(key)? else {
            return Ok(None);
        };
        // nosemgrep: workspace-blobs-through-cbor-helpers -- this is the helper.
        Ok(Some(ciborium::from_reader(data.value())?))
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

    let mut hasher = DefaultHasher::new(); // nosemgrep: use-content-hash — hashes a PATH
    // into a database filename, not a file's contents
    // into a cache key, and the result is written to
    // disk. `hashing::content_hash` is documented as
    // same-process only, so pointing this at it would
    // make the two uses look interchangeable.
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
            language: String::new(),
            pack_installable: false,
        }];

        idx.store_check("test.md", 7, &diags).unwrap();
        let retrieved = idx.cached_check("test.md", 7).unwrap();
        assert_eq!(retrieved.len(), 1);
        assert_eq!(retrieved[0].message, "test error");
        assert_eq!(retrieved[0].start_byte, 0);
        assert_eq!(retrieved[0].suggestions, vec!["fix"]);

        cleanup(&dir);
    }

    #[test]
    fn diagnostics_missing_file_returns_none() {
        let (idx, dir) = temp_workspace("diag_none");
        let result = idx.cached_check("nonexistent.md", 7);
        assert!(result.is_none());
        cleanup(&dir);
    }

    #[test]
    fn a_stored_result_is_not_served_under_a_different_fingerprint() {
        // The whole safety of the cache. A config change, an added dictionary
        // word, an edited buffer -- each moves the fingerprint, and each must
        // make the stored answer stop applying rather than come back stale.
        let (idx, dir) = temp_workspace("fingerprint_guard");
        let diags = vec![Diagnostic {
            start_byte: 0,
            end_byte: 4,
            message: "stale".to_string(),
            suggestions: Vec::new(),
            rule_id: "spelling.typo".to_string(),
            severity: 2,
            unified_id: "spelling.typo".to_string(),
            confidence: 0.8,
            language: String::new(),
            pack_installable: false,
        }];
        idx.store_check("f.md", 100, &diags).unwrap();

        assert!(idx.cached_check("f.md", 100).is_some(), "the same inputs must hit");
        assert!(idx.cached_check("f.md", 101).is_none(), "changed inputs must miss");

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
        idx.store_check("f.md", 1, &diags1).unwrap();

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
        idx.store_check("f.md", 2, &diags2).unwrap();

        let retrieved = idx.cached_check("f.md", 2).unwrap();
        assert_eq!(retrieved.len(), 2);
        assert_eq!(retrieved[0].message, "second");

        cleanup(&dir);
    }
}
