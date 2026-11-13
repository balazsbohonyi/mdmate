//! Watching every index root for changes other programs make.
//!
//! One recursive watcher covers each root, so a folder nobody has opened in the sidebar is watched
//! all the same. The operating system cannot be told to skip `node_modules`, so every event is
//! filtered here before it is counted: an event under an excluded folder, or outside every root,
//! never reaches the index. What is left is gathered until things go quiet and handed over in one
//! [`Batch`].
//!
//! A watcher can lose events. notify reports that on Linux and macOS as a rescan flag; on Windows,
//! notify 8.2.1 gives no sign at all when the OS buffer overflows (it reads the empty buffer as an
//! ordinary event). So a batch also says how many events it gathered, and the index treats a very
//! large burst the way it treats a rescan flag: it reads the root again instead of trusting the
//! paths it was given.

use crate::error::AppError;
use notify::event::{Flag, ModifyKind};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// How long the events must stay quiet before they are handed over. A save raises several events in
/// a row; one batch after they finish is enough.
const QUIET: Duration = Duration::from_millis(150);

/// A steady stream of events is handed over at least this often.
const MAX_WAIT: Duration = Duration::from_secs(1);

/// What one quiet spell of events came to.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Batch {
    /// Each path an event named, and whether something was created, removed or renamed there (a
    /// folder is read again only for those; a folder that merely "changed" is its children's news).
    pub(super) paths: BTreeMap<PathBuf, bool>,
    /// How many events were gathered after the filter.
    pub(super) events: usize,
    /// The watcher said it lost events, or failed.
    pub(super) rescan: bool,
}

/// Decides whether an event for a path matters: inside an index root and not under an excluded
/// folder.
pub(super) type Relevant = Box<dyn Fn(&Path) -> bool + Send + Sync>;

/// Hears each batch.
pub(super) type Sink = Box<dyn Fn(Batch) + Send + Sync>;

pub(super) struct Watching {
    watcher: Mutex<RecommendedWatcher>,
    watched: Mutex<HashSet<PathBuf>>,
}

impl std::fmt::Debug for Watching {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Watching")
    }
}

impl Watching {
    /// Starts the watcher and the thread that gathers its events.
    pub(super) fn start(relevant: Relevant, sink: Sink) -> Result<Self, AppError> {
        let (tx, rx) = mpsc::channel();
        let watcher =
            notify::recommended_watcher(tx).map_err(|error| AppError::Watch(error.to_string()))?;
        std::thread::Builder::new()
            .name("mdmate-index-watch".into())
            .spawn(move || run(&rx, relevant.as_ref(), sink.as_ref()))
            .map_err(|error| AppError::Watch(error.to_string()))?;
        Ok(Self {
            watcher: Mutex::new(watcher),
            watched: Mutex::new(HashSet::new()),
        })
    }

    /// Watches exactly these folders, each with everything below it. A folder that cannot be
    /// watched (just deleted, say) is skipped; the next reconcile still reads it.
    pub(super) fn set_roots(&self, roots: &[PathBuf]) {
        let wanted: HashSet<PathBuf> = roots.iter().cloned().collect();
        let mut watcher = self.watcher.lock().unwrap_or_else(PoisonError::into_inner);
        let mut watched = self.watched.lock().unwrap_or_else(PoisonError::into_inner);
        for gone in watched.difference(&wanted).cloned().collect::<Vec<_>>() {
            let _ = watcher.unwatch(&gone);
            watched.remove(&gone);
        }
        for added in wanted.difference(&watched.clone()) {
            if watcher.watch(added, RecursiveMode::Recursive).is_ok() {
                watched.insert(added.clone());
            }
        }
    }

    #[cfg(test)]
    pub(super) fn watched(&self) -> HashSet<PathBuf> {
        self.watched
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

/// True when something was created, removed or renamed, which a folder must be read again for.
fn is_structural(kind: EventKind) -> bool {
    match kind {
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Any => true,
        EventKind::Modify(ModifyKind::Name(_)) => true,
        EventKind::Modify(_) | EventKind::Access(_) | EventKind::Other => false,
    }
}

/// Gathers events into batches until the channel closes.
pub(super) fn run(
    rx: &Receiver<notify::Result<notify::Event>>,
    relevant: &dyn Fn(&Path) -> bool,
    sink: &dyn Fn(Batch),
) {
    let mut batch = Batch::default();
    let mut first: Option<Instant> = None;
    let mut last = Instant::now();
    loop {
        let waiting = first.is_some();
        let message = if waiting {
            let due = (last + QUIET).min(first.map_or(last, |at| at + MAX_WAIT));
            rx.recv_timeout(due.saturating_duration_since(Instant::now()))
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        match message {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                if event.flag() == Some(Flag::Rescan) {
                    batch.rescan = true;
                } else {
                    let structural = is_structural(event.kind);
                    for path in event.paths.iter().filter(|path| relevant(path)) {
                        let entry = batch.paths.entry(path.clone()).or_insert(false);
                        *entry |= structural;
                        batch.events += 1;
                    }
                    if batch.events == 0 {
                        continue;
                    }
                }
                first.get_or_insert_with(Instant::now);
                last = Instant::now();
            }
            // The watcher failed: nothing can be said about what changed.
            Ok(Err(_)) => {
                batch.rescan = true;
                first.get_or_insert_with(Instant::now);
                last = Instant::now();
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                if first.is_some() {
                    sink(std::mem::take(&mut batch));
                }
                return;
            }
        }
        let Some(started) = first else { continue };
        if last.elapsed() >= QUIET || started.elapsed() >= MAX_WAIT {
            first = None;
            sink(std::mem::take(&mut batch));
        }
    }
}
