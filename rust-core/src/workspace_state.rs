//! What the server knows about the workspace, published as one value.
//!
//! A check reads the config, the dictionary, the ignore store, the morphology,
//! the name filter and the schemas. These used to sit behind a mutex each, and
//! a handler took the ones it needed one after another. Two handlers taking
//! the same pair in opposite orders deadlocked the server, and a check running
//! beside an Initialize could read the old config next to the new dictionary.
//!
//! Here they are one immutable [`WorkspaceState`]. A reader takes a snapshot,
//! an `Arc`, without waiting on anyone and keeps it for the whole request.
//! A writer -- Initialize, or a request that adds a word or ignores a finding
//! -- builds the next state off to the side and publishes it in one store, so
//! every reader sees either the state before or the state after, never a mix.
//! Writers queue on one lock, so two of them cannot each start from the same
//! state and drop the other's change.

use std::path::PathBuf;
use std::sync::Arc;

use arc_swap::ArcSwap;
use tokio::sync::{Mutex, MutexGuard};

use crate::config::Config;
use crate::dictionary::Dictionary;
use crate::hashing::IgnoreStore;
use crate::morphology::AffixAnalyzer;
use crate::names::NameFilter;
use crate::prose::latex::LatexExtras;
use crate::sls::SchemaRegistry;
use crate::suppression::{InlineDirectives, SuppressionContext};

/// Everything a check reads about the workspace, at one moment.
///
/// Each part is behind an `Arc`, so the next state shares whatever did not
/// change with this one, and a request that changes one part copies only it.
#[derive(Clone, Default)]
pub struct WorkspaceState {
    /// The workspace root. `exclude` patterns are written relative to it, and
    /// a check request carries an absolute path.
    pub root: Option<PathBuf>,
    pub config: Arc<Config>,
    pub dictionary: Arc<Dictionary>,
    pub ignores: Arc<IgnoreStore>,
    pub morphology: Option<Arc<AffixAnalyzer>>,
    pub names: Option<Arc<NameFilter>>,
    pub schemas: Arc<SchemaRegistry>,
}

impl WorkspaceState {
    /// What a check of `text` depends on, for looking a stored result up.
    #[must_use]
    pub fn fingerprint(&self, text: &str) -> u64 {
        crate::workspace::check_fingerprint(
            text,
            &self.config,
            &self.dictionary,
            &self.ignores,
            self.names.is_some(),
            self.schemas.fingerprint(),
        )
    }

    /// The LaTeX environments and commands the config skips.
    #[must_use]
    pub fn latex_extras(&self) -> LatexExtras<'_> {
        LatexExtras {
            skip_envs: &self.config.languages.latex.skip_environments,
            skip_commands: &self.config.languages.latex.skip_commands,
        }
    }

    /// The filters a check's diagnostics pass through, for a document whose
    /// inline directives are `directives`.
    #[must_use]
    pub fn suppression<'a>(&'a self, directives: &'a InlineDirectives) -> SuppressionContext<'a> {
        let mut context = SuppressionContext::new()
            .with_ignore(&self.ignores)
            .with_dictionary(&self.dictionary)
            .with_directives(directives);
        if let Some(analyzer) = &self.morphology {
            context = context.with_morphology(analyzer);
        }
        if let Some(filter) = &self.names {
            context = context.with_names(filter);
        }
        context
    }
}

/// The current [`WorkspaceState`], and the lock its writers queue on.
#[derive(Default)]
pub struct SharedState {
    current: ArcSwap<WorkspaceState>,
    writer: Mutex<()>,
}

/// Held while a writer builds the next state. Only [`SharedState::writer`]
/// makes one, so publishing without having queued does not compile.
pub struct Writing<'a> {
    shared: &'a SharedState,
    _queued: MutexGuard<'a, ()>,
}

impl SharedState {
    /// The state as it is now. Never waits; hold it for as long as needed.
    #[must_use]
    pub fn snapshot(&self) -> Arc<WorkspaceState> {
        self.current.load_full()
    }

    /// Wait for the other writers, then start building the next state.
    pub async fn writer(&self) -> Writing<'_> {
        Writing {
            shared: self,
            _queued: self.writer.lock().await,
        }
    }

    /// Change the state in one step: queue as a writer, apply `change` to a
    /// copy of the current state, publish the copy, and return what `change`
    /// returned.
    pub async fn update<R>(&self, change: impl FnOnce(&mut WorkspaceState) -> R) -> R {
        let writing = self.writer().await;
        let mut next = (*writing.current()).clone();
        let result = change(&mut next);
        writing.publish(next);
        result
    }
}

impl Writing<'_> {
    /// The state this writer starts from. No other writer can replace it
    /// while this one is held.
    #[must_use]
    pub fn current(&self) -> Arc<WorkspaceState> {
        self.shared.snapshot()
    }

    /// Make `next` the state every later snapshot sees.
    pub fn publish(&self, next: WorkspaceState) {
        self.shared.current.store(Arc::new(next));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_snapshot_keeps_the_state_it_was_taken_from() {
        let shared = SharedState::default();
        let before = shared.snapshot();
        shared
            .update(|state| state.root = Some(PathBuf::from("/w")))
            .await;
        assert_eq!(before.root, None);
        assert_eq!(shared.snapshot().root, Some(PathBuf::from("/w")));
    }

    #[tokio::test]
    async fn concurrent_updates_each_keep_the_others_change() {
        let shared = Arc::new(SharedState::default());
        let mut tasks = tokio::task::JoinSet::new();
        for i in 0..64 {
            let shared = shared.clone();
            tasks.spawn(async move {
                shared
                    .update(|state| {
                        let mut ignores = (*state.ignores).clone();
                        ignores.ignore(&crate::hashing::DiagnosticFingerprint::new(
                            &format!("message {i}"),
                            "context",
                            0,
                            7,
                        ));
                        state.ignores = Arc::new(ignores);
                    })
                    .await;
            });
        }
        while tasks.join_next().await.is_some() {}
        // A writer that started from a stale copy would have dropped someone
        // else's ignore: the fingerprint counts every one that survived.
        let mut expected = IgnoreStore::new();
        for i in 0..64 {
            expected.ignore(&crate::hashing::DiagnosticFingerprint::new(
                &format!("message {i}"),
                "context",
                0,
                7,
            ));
        }
        assert_eq!(
            shared.snapshot().ignores.fingerprint(),
            expected.fingerprint()
        );
    }
}
