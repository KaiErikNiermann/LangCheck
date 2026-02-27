use std::path::{Path, PathBuf};
use anyhow::Result;
use redb::{Database, TableDefinition};
use crate::checker::Diagnostic;
use crate::insights::ProseInsights;
use serde::{Serialize, Deserialize};

const DIAGNOSTICS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("diagnostics");
const INSIGHTS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("insights");

pub struct WorkspaceIndex {
    db: Database,
    root_path: PathBuf,
}

impl WorkspaceIndex {
    pub fn new(path: &Path) -> Result<Self> {
        let db = Database::create(path.join(".languagecheck.db"))?;
        
        let write_txn = db.begin_write()?;
        {
            let _table = write_txn.open_table(DIAGNOSTICS_TABLE)?;
            let _table = write_txn.open_table(INSIGHTS_TABLE)?;
        }
        write_txn.commit()?;
        
        Ok(Self { db, root_path: path.to_path_buf() })
    }

    pub fn get_root_path(&self) -> Option<&PathBuf> {
        Some(&self.root_path)
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

    pub fn update_insights(&self, file_path: &str, insights: ProseInsights) -> Result<()> {
        let data = serde_cbor::to_vec(&insights)?;
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
            let diagnostics = serde_cbor::from_slice(data.value())?;
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
            let insights = serde_cbor::from_slice(data.value())?;
            Ok(Some(insights))
        } else {
            Ok(None)
        }
    }
}
