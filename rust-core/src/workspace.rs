use crate::checker::Diagnostic;
use crate::insights::ProseInsights;
use anyhow::Result;
use redb::{Database, DatabaseError, ReadableDatabase, StorageError, TableDefinition};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tracing::warn;

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
/// for the same reason. The loaded SLS schemas, because a schema decides which
/// lines of a document are prose at all. And the Hunspell packs on disk,
/// because installing one is how a language stops being unreadable. And the version of this program, because an upgrade
/// changes what the engines say without any of the above moving.
///
/// `stable_hash` and not `content_hash`: this value is written to disk in one
/// process and compared in another.
#[must_use]
pub fn check_fingerprint(
    text: &str,
    config: &crate::config::Config,
    _dictionary: &crate::dictionary::Dictionary,
    _ignore_store: &crate::hashing::IgnoreStore,
    names_enabled: bool,
    schemas: u64,
) -> u64 {
    let config_repr = serde_json::to_string(config).unwrap_or_default();
    // Installing a dictionary changes neither the document nor the config, so
    // the packs have to be looked at directly or a language the user has just
    // made readable goes on being reported as unreadable.
    let packs = if config.engines.hunspell.enabled {
        crate::packs::PackRegistry::for_hunspell(&config.engines.hunspell)
            .fingerprint(&config.engines.hunspell.languages)
    } else {
        0
    };
    // The dictionary and the ignore store are deliberately absent. Both are
    // filters applied after the engines have run, so what is stored is what
    // the engines said and both are re-applied on the way out. Including them
    // meant a single word added to the dictionary invalidated every stored
    // result in the workspace -- re-running the engines, a LanguageTool round
    // trip per prose range, to reach the answer already held and discard one
    // more of it. They are still parameters so a caller cannot silently stop
    // passing what it must go on applying.
    //
    // The build, not only the version. A released binary has one of each, so
    // an upgrade retires the results of the version before it either way;
    // during development the version stands still while the code moves, and a
    // result stored by the previous build is an answer the current engines no
    // longer give. `build.rs` derives the id from this crate's sources, so an
    // unchanged checkout keeps its stored results.
    crate::hashing::stable_hash(&format!(
        "{}\x1e{}\x1e{}\x1e{}\x1e{}\x1e{}\x1e{}",
        crate::hashing::stable_hash(text),
        crate::hashing::stable_hash(&config_repr),
        names_enabled,
        schemas,
        packs,
        env!("CARGO_PKG_VERSION"),
        env!("LANG_CHECK_BUILD_ID"),
    ))
}

/// A check's result, with what it was computed from.
///
/// The fingerprint covers everything that can change what the *engines*
/// produce -- the document text, the config, whether name detection is on, the
/// installed packs, and the version of this program. A stored result is served
/// only when it still matches, so there is one decision to get right rather
/// than one per input.
///
/// What it deliberately leaves out is the dictionary and the ignore store.
/// Those filter the engines' output rather than change it, and they are
/// re-applied to a stored result on the way out.
///
/// Storing the result without it was the previous state of things: every check
/// wrote here and nothing ever read it back.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedCheck {
    pub fingerprint: u64,
    pub diagnostics: Vec<Diagnostic>,
}

/// Who has a workspace index open, as the server that opened it wrote down.
///
/// The version and the path are what tell an old copy of the server, left in
/// another folder, from the one the editor meant to start.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexOwner {
    pub pid: u32,
    pub version: String,
    pub executable: String,
}

impl IndexOwner {
    /// This process, as it records itself.
    #[must_use]
    pub fn this_process() -> Self {
        Self {
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            executable: std::env::current_exe()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        }
    }

    fn file_for(db: &Path) -> PathBuf {
        let mut name = db.as_os_str().to_owned();
        name.push(".owner.json");
        PathBuf::from(name)
    }

    fn read(db: &Path) -> Option<Self> {
        let text = std::fs::read_to_string(Self::file_for(db)).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// Best effort: without the record a second server can still say that
    /// the index is taken, only not by whom.
    fn write(&self, db: &Path) {
        if let Ok(text) = serde_json::to_string(self)
            && let Err(e) = std::fs::write(Self::file_for(db), text)
        {
            warn!(path = %db.display(), "Could not record the index owner: {e}");
        }
    }
}

impl fmt::Display for IndexOwner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "version {}, process {}", self.version, self.pid)?;
        if !self.executable.is_empty() {
            write!(f, ", at {}", self.executable)?;
        }
        Ok(())
    }
}

/// Why a workspace index could not be used.
#[derive(Debug)]
pub enum IndexUnavailable {
    /// Another process holds the index's lock; `owner` is what it recorded.
    HeldByAnotherServer {
        owner: Option<IndexOwner>,
    },
    Failed(anyhow::Error),
}

impl fmt::Display for IndexUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HeldByAnotherServer { owner: Some(owner) } => {
                write!(
                    f,
                    "another language-check server ({owner}) is using this workspace's index"
                )
            }
            Self::HeldByAnotherServer { owner: None } => {
                write!(
                    f,
                    "another language-check server is using this workspace's index"
                )
            }
            Self::Failed(e) => write!(f, "the workspace index could not be opened: {e}"),
        }
    }
}

impl std::error::Error for IndexUnavailable {}

/// An opened index, and where the unreadable file it replaced was moved.
pub struct OpenedIndex {
    pub index: WorkspaceIndex,
    pub set_aside: Option<PathBuf>,
}

/// Where an unreadable index is moved: beside it, named for when.
fn aside_path(db: &Path) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut name = db.as_os_str().to_owned();
    name.push(format!(".unreadable-{stamp}"));
    PathBuf::from(name)
}

pub struct WorkspaceIndex {
    db: Database,
    root_path: PathBuf,
}

impl WorkspaceIndex {
    /// Create or open a workspace index, failing on anything short of an
    /// index that is ready to use. See [`Self::open`] for why it failed.
    pub fn new(workspace_root: &Path, db_path: Option<&Path>) -> Result<Self> {
        Ok(Self::open(workspace_root, db_path)?.index)
    }

    /// Create or open a workspace index.
    ///
    /// If `db_path` is provided, the database is created at that exact path.
    /// Otherwise, the database is stored in the user data directory
    /// (`~/.local/share/language-check/dbs/` on Linux,
    ///  `~/Library/Application Support/language-check/dbs/` on macOS,
    ///  `%APPDATA%/language-check/dbs/` on Windows),
    /// named by a hash of the workspace root to avoid collisions.
    ///
    /// The index is only a cache, so a file that cannot be read as one --
    /// corrupted, or from an older format -- is moved aside and a new one
    /// started, rather than failing every session after it. Once the lock is
    /// held, who holds it is written next to the database: the lock turns a
    /// second server away, and the record is how that server says which one
    /// is already running.
    pub fn open(
        workspace_root: &Path,
        db_path: Option<&Path>,
    ) -> Result<OpenedIndex, IndexUnavailable> {
        let path = match db_path {
            Some(p) => p.to_path_buf(),
            None => default_db_path(workspace_root).map_err(IndexUnavailable::Failed)?,
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| IndexUnavailable::Failed(e.into()))?;
        }

        let mut set_aside = None;
        let db = match Database::create(&path) {
            Ok(db) => db,
            Err(DatabaseError::DatabaseAlreadyOpen) => {
                return Err(IndexUnavailable::HeldByAnotherServer {
                    owner: IndexOwner::read(&path),
                });
            }
            // A file that is not a redb database at all is reported as I/O
            // of kind InvalidData; any other I/O error -- permissions, a full
            // disk -- is not the file's fault, and it is left where it is.
            Err(
                DatabaseError::Storage(StorageError::Corrupted(_))
                | DatabaseError::UpgradeRequired(_)
                | DatabaseError::RepairAborted,
            ) => Self::replace_unreadable(&path, &mut set_aside)?,
            Err(DatabaseError::Storage(StorageError::Io(e)))
                if e.kind() == std::io::ErrorKind::InvalidData =>
            {
                Self::replace_unreadable(&path, &mut set_aside)?
            }
            Err(e) => return Err(IndexUnavailable::Failed(e.into())),
        };

        let tables = || -> Result<()> {
            let write_txn = db.begin_write()?;
            {
                let _table = write_txn.open_table(DIAGNOSTICS_TABLE)?;
                let _table = write_txn.open_table(INSIGHTS_TABLE)?;
                let _table = write_txn.open_table(FILE_HASHES_TABLE)?;
            }
            write_txn.commit()?;
            Ok(())
        };
        tables().map_err(IndexUnavailable::Failed)?;

        IndexOwner::this_process().write(&path);
        Ok(OpenedIndex {
            index: Self {
                db,
                root_path: workspace_root.to_path_buf(),
            },
            set_aside,
        })
    }

    /// Move an unreadable index aside, kept for anyone who wants to look, and
    /// start a new one in its place.
    fn replace_unreadable(
        path: &Path,
        set_aside: &mut Option<PathBuf>,
    ) -> Result<Database, IndexUnavailable> {
        let aside = aside_path(path);
        std::fs::rename(path, &aside).map_err(|e| IndexUnavailable::Failed(e.into()))?;
        warn!(path = %path.display(), aside = %aside.display(), "Workspace index unreadable; set aside and starting a new one");
        *set_aside = Some(aside);
        Database::create(path).map_err(|e| IndexUnavailable::Failed(e.into()))
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

    /// A dictionary edit must not invalidate a stored result.
    ///
    /// The dictionary is applied as a suppression *after* the engines have
    /// run, exactly as a severity override is. A word added to it can only
    /// remove findings from an answer already computed, so re-running the
    /// engines reaches the same raw result and discards one more of it --
    /// which for LanguageTool is a network round trip per prose range, paid
    /// to learn nothing.
    ///
    /// The same holds for the ignore store, which is the other post-engine
    /// filter.
    #[test]
    fn a_dictionary_edit_does_not_invalidate_a_stored_result() {
        let config = crate::config::Config::default();
        let ignores = crate::hashing::IgnoreStore::default();
        let mut dictionary = crate::dictionary::Dictionary::default();
        let before = check_fingerprint("some prose", &config, &dictionary, &ignores, false, 0);

        //  inserts before it persists; the persist has nowhere to
        // go in a test and its failure is not what is being measured.
        let _ = dictionary.add_word("zorblat");
        let after = check_fingerprint("some prose", &config, &dictionary, &ignores, false, 0);

        assert_eq!(
            before, after,
            "adding a word re-ran the engines to reach the answer already stored"
        );
    }

    #[test]
    fn the_things_that_do_change_the_answer_still_change_the_fingerprint() {
        // The other half: a fingerprint that ignored everything would serve a
        // stale result for ever.
        let config = crate::config::Config::default();
        let ignores = crate::hashing::IgnoreStore::default();
        let dictionary = crate::dictionary::Dictionary::default();
        let base = check_fingerprint("some prose", &config, &dictionary, &ignores, false, 0);

        assert_ne!(
            base,
            check_fingerprint("other prose", &config, &dictionary, &ignores, false, 0),
            "the text"
        );
        let mut other = crate::config::Config::default();
        other.engines.languagetool.enabled = !other.engines.languagetool.enabled;
        assert_ne!(
            base,
            check_fingerprint("some prose", &other, &dictionary, &ignores, false, 0),
            "the config"
        );
        assert_ne!(
            base,
            check_fingerprint("some prose", &config, &dictionary, &ignores, true, 0),
            "name detection"
        );
        assert_ne!(
            base,
            check_fingerprint("some prose", &config, &dictionary, &ignores, false, 7),
            "the schemas"
        );
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
    fn a_second_opener_is_turned_away_and_told_who_holds_the_index() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index.redb");
        let first = WorkspaceIndex::open(dir.path(), Some(&db)).expect("the first opener gets it");
        match WorkspaceIndex::open(dir.path(), Some(&db)) {
            Err(IndexUnavailable::HeldByAnotherServer { owner: Some(owner) }) => {
                assert_eq!(owner, IndexOwner::this_process());
            }
            Err(other) => panic!("turned away for the wrong reason: {other}"),
            Ok(_) => panic!("two openers of one index"),
        }
        drop(first);
        assert!(
            WorkspaceIndex::open(dir.path(), Some(&db)).is_ok(),
            "released with its holder"
        );
    }

    #[test]
    fn an_unreadable_index_is_set_aside_and_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("index.redb");
        std::fs::write(
            &db,
            b"this was never a database, and it is long enough to be read as one's header"
                .repeat(64),
        )
        .unwrap();
        let opened = WorkspaceIndex::open(dir.path(), Some(&db))
            .expect("a cache that cannot be read is replaced");
        let aside = opened
            .set_aside
            .expect("the unreadable file is kept, not deleted");
        assert!(aside.exists() && db.exists());
        drop(opened.index);
        assert!(
            WorkspaceIndex::open(dir.path(), Some(&db))
                .unwrap()
                .set_aside
                .is_none()
        );
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

        assert!(
            idx.cached_check("f.md", 100).is_some(),
            "the same inputs must hit"
        );
        assert!(
            idx.cached_check("f.md", 101).is_none(),
            "changed inputs must miss"
        );

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
