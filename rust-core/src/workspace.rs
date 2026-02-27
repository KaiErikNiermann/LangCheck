use std::path::Path;
use anyhow::Result;
use redb::{Database, TableDefinition};
use crate::checker::Diagnostic;

const DIAGNOSTICS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("diagnostics");

pub struct WorkspaceIndex {
    db: Database,
}

impl WorkspaceIndex {
    pub fn new(path: &Path) -> Result<Self> {
        let db = Database::create(path.join(".languagecheck.db"))?;
        
        // Ensure table exists
        let write_txn = db.begin_write()?;
        {
            let _table = write_txn.open_table(DIAGNOSTICS_TABLE)?;
        }
        write_txn.commit()?;
        
        Ok(Self { db })
    }

    pub fn update_diagnostics(&self, file_path: &str, diagnostics: Vec<Diagnostic>) -> Result<()> {
        let data = serde_cbor::to_vec(&diagnostics)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(DIAGNOSTICS_TABLE)?;
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
            let diagnostics = serde_cbor::from_slice(data.value())?;
            Ok(Some(diagnostics))
        } else {
            Ok(None)
        }
    }
}
