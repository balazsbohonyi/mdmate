//! Watching the files of open documents for changes other programs make.
//!
//! One `notify` watcher watches the folders that hold open documents, never the files themselves:
//! an editor that saves by replacing a file (which mdmate does too) drops a watch on the file on
//! some systems. The watcher only says "something happened to this path". The decision is made by
//! content, on a dedicated thread: it waits for a path to go quiet, reads the file, and compares
//! the hash with the one the document is in step with. The app's own saves record their hash before
//! they write, so they match and say nothing.

use crate::access::display_path;
use crate::documents::{AppState, hash_hex};
use crate::error::AppError;
use crate::fs::{self, document::content_hash};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant};

/// How long a path must stay quiet before its file is read. One save raises several events in a
/// row (a temp file, a rename, a metadata change); this lets them finish.
const QUIET: Duration = Duration::from_millis(100);

/// A change another program made to an open document's file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiskChange {
    pub(crate) id: u32,
    /// The hash of the content now on disk, 32 hex digits.
    pub(crate) hash: String,
}

type Sink = Box<dyn Fn(DiskChange) + Send + Sync>;

/// The folders being watched and who gets told. Lives in the app state.
pub(crate) struct Watcher {
    folders: Mutex<Folders>,
    sink: Arc<Mutex<Sink>>,
}

struct Folders {
    watcher: RecommendedWatcher,
    /// The open documents in each watched folder. A folder is watched while it has any.
    by_folder: HashMap<PathBuf, HashSet<u32>>,
}

impl std::fmt::Debug for Watcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Watcher")
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Watcher {
    /// Starts the watcher and the thread that decides what its events mean.
    pub(crate) fn start(state: &Arc<AppState>, sink: Sink) -> Result<Self, AppError> {
        let (tx, rx) = mpsc::channel();
        let watcher =
            notify::recommended_watcher(tx).map_err(|e| AppError::Watch(e.to_string()))?;
        let sink = Arc::new(Mutex::new(sink));
        // The thread holds the state weakly, so it ends with the app instead of keeping it alive.
        let (weak, shared) = (Arc::downgrade(state), Arc::clone(&sink));
        std::thread::Builder::new()
            .name("mdmate-watch".into())
            .spawn(move || run(&rx, &weak, &shared))
            .map_err(|e| AppError::Watch(e.to_string()))?;
        Ok(Self {
            folders: Mutex::new(Folders {
                watcher,
                by_folder: HashMap::new(),
            }),
            sink,
        })
    }

    /// Replaces who gets told, for a page that subscribes again after reloading.
    pub(crate) fn set_sink(&self, sink: Sink) {
        *lock(&self.sink) = sink;
    }

    /// Watches the folder of a document's file. Does nothing for a document already watched.
    pub(crate) fn watch(&self, id: u32, path: &Path) {
        let Some(folder) = path
            .parent()
            .map(|parent| PathBuf::from(display_path(parent)))
        else {
            return;
        };
        let mut folders = lock(&self.folders);
        let Folders { watcher, by_folder } = &mut *folders;
        // A folder that cannot be watched leaves its documents unwatched; saving still checks the
        // file against the hash, so nothing is lost.
        if !by_folder.contains_key(&folder)
            && watcher.watch(&folder, RecursiveMode::NonRecursive).is_err()
        {
            return;
        }
        by_folder.entry(folder).or_default().insert(id);
    }

    /// Stops watching for a document, and for its folder when no other document is in it.
    pub(crate) fn unwatch(&self, id: u32) {
        let mut folders = lock(&self.folders);
        let Folders { watcher, by_folder } = &mut *folders;
        let mut emptied = Vec::new();
        for (folder, ids) in by_folder.iter_mut() {
            if ids.remove(&id) && ids.is_empty() {
                emptied.push(folder.clone());
            }
        }
        for folder in emptied {
            by_folder.remove(&folder);
            let _ = watcher.unwatch(&folder);
        }
    }
}

/// The watcher thread: waits for paths to go quiet, checks them, and reports what changed.
fn run(rx: &Receiver<notify::Result<notify::Event>>, state: &Weak<AppState>, sink: &Mutex<Sink>) {
    let mut due: HashMap<PathBuf, Instant> = HashMap::new();
    // Set when events may have been lost, so every open document gets checked.
    let mut everything: Option<Instant> = None;
    loop {
        let next = due.values().copied().chain(everything).min();
        let message = match next {
            Some(when) => rx.recv_timeout(when.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match message {
            Ok(Ok(event)) if event.need_rescan() => everything = Some(Instant::now() + QUIET),
            Ok(Ok(event)) if !matches!(event.kind, EventKind::Access(_)) => {
                for path in event.paths {
                    due.insert(path, Instant::now() + QUIET);
                }
            }
            Ok(Ok(_)) | Err(RecvTimeoutError::Timeout) => {}
            Ok(Err(_)) => everything = Some(Instant::now() + QUIET),
            Err(RecvTimeoutError::Disconnected) => return,
        }

        let now = Instant::now();
        let ready: Vec<PathBuf> = due
            .iter()
            .filter(|&(_, &when)| when <= now)
            .map(|(path, _)| path.clone())
            .collect();
        let all_ready = everything.is_some_and(|when| when <= now);
        if ready.is_empty() && !all_ready {
            continue;
        }
        let Some(state) = state.upgrade() else {
            return;
        };
        let mut changes = Vec::new();
        for path in ready {
            due.remove(&path);
            changes.extend(check_path(&state, &path));
        }
        if all_ready {
            everything = None;
            changes.extend(check_all(&state));
        }
        let sink = lock(sink);
        for change in changes {
            sink(change);
        }
    }
}

/// What a file system event for `path` means for the open documents: a change, or nothing.
pub(crate) fn check_path(state: &AppState, path: &Path) -> Vec<DiskChange> {
    let key = state.spelling_key(path);
    let ids: Vec<u32> = state
        .documents()
        .entries()
        .filter(|(_, entry)| state.spelling_key(&entry.path) == key)
        .map(|(id, _)| id)
        .collect();
    ids.into_iter()
        .filter_map(|id| check_document(state, id))
        .collect()
}

/// Checks every open document, for when events may have been missed.
fn check_all(state: &AppState) -> Vec<DiskChange> {
    let ids: Vec<u32> = state.documents().entries().map(|(id, _)| id).collect();
    ids.into_iter()
        .filter_map(|id| check_document(state, id))
        .collect()
}

/// Reads a document's file and says whether its content is something the document is not already
/// in step with, and the page has not been told about. A file that is missing or locked says
/// nothing: the tab keeps its text, and the next event or save sorts it out.
fn check_document(state: &AppState, id: u32) -> Option<DiskChange> {
    let path = state.documents().get(id)?.path.clone();
    let bytes = fs::read_bytes_settled(&path).ok()?;
    let hash = content_hash(&bytes);
    let mut documents = state.documents();
    let entry = documents.get_mut(id)?;
    if hash == entry.known_hash {
        // Back to what the document is in step with, so the next change is news again.
        entry.reported_hash = None;
        return None;
    }
    if entry.reported_hash == Some(hash) {
        return None;
    }
    entry.reported_hash = Some(hash);
    Some(DiskChange {
        id,
        hash: hash_hex(hash),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::{close_document, open_document, reload_document, save_document_with};
    use crate::fs::atomic::Stage;
    use crate::fs::eol::{Ending, Endings};
    use crate::fs::frame;
    use serde_json::Map;
    use std::cell::RefCell;

    const START: &[u8] = b"one\r\ntwo\r\n";

    /// A state with one granted and opened file, and the id it got.
    fn opened(dir: &Path, name: &str) -> (Arc<AppState>, u32, PathBuf) {
        let state = Arc::new(AppState::new(false));
        let path = dir.join(name);
        std::fs::write(&path, START).expect("written");
        state.access().grant_file(&path).expect("grants");
        let bytes = open_document(&state, &path).expect("opens");
        let id = frame::decode(&bytes)
            .expect("a frame")
            .header
            .get("id")
            .and_then(serde_json::Value::as_u64)
            .and_then(|id| u32::try_from(id).ok())
            .expect("an id");
        // The path the document stores, which is canonical. The temp folder may be spelled with
        // 8.3 short names (as on the CI runner), and the watcher only ever sees the stored one.
        let stored = state
            .documents()
            .get(id)
            .expect("the document")
            .path
            .clone();
        (state, id, stored)
    }

    fn edit_frame(text: &str) -> Vec<u8> {
        frame::encode(Map::new(), &Endings::uniform(Ending::CrLf), text)
    }

    fn hash_of(bytes: &[u8]) -> String {
        hash_hex(content_hash(bytes))
    }

    /// The watcher test helper: a started watcher whose changes land in a channel.
    fn listening(state: &Arc<AppState>) -> Receiver<DiskChange> {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        state
            .start_watcher(Box::new(move |change| {
                let _ = lock(&tx).send(change);
            }))
            .expect("the watcher starts");
        rx
    }

    #[test]
    fn own_save_ignored_when_the_event_arrives_after_the_save() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        crate::documents::save_document(&state, id, &edit_frame("one\nTWO\n")).expect("saves");
        assert_eq!(std::fs::read(&path).expect("readable"), b"one\r\nTWO\r\n");

        // The watcher's event for the save, delivered now.
        assert_eq!(check_path(&state, &path), Vec::new());
    }

    #[test]
    fn own_save_ignored_when_the_event_arrives_before_the_save_returns() {
        // The watcher thread can see the renamed file before the save function has returned. The
        // hash must already be recorded by then, which is why it is recorded before the write.
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        let seen = RefCell::new(None);
        let saved = save_document_with(&state, id, &edit_frame("one\nTWO\n"), |stage| {
            if stage == Stage::AfterRename {
                *seen.borrow_mut() = Some(check_path(&state, &path));
            }
            Ok(())
        })
        .expect("saves");
        assert_eq!(
            seen.into_inner(),
            Some(Vec::new()),
            "no change for our own write"
        );
        assert_eq!(
            state.documents().get(id).map(|entry| entry.known_hash),
            Some(saved.hash)
        );
    }

    #[test]
    fn own_save_ignored_by_the_running_watcher() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, _path) = opened(dir.path(), "a.md");
        let changes = listening(&state);
        crate::documents::save_document(&state, id, &edit_frame("one\nTWO\n")).expect("saves");
        assert_eq!(
            changes.recv_timeout(Duration::from_millis(700)),
            Err(RecvTimeoutError::Timeout),
            "the app's own write is not news"
        );
    }

    #[test]
    fn the_running_watcher_reports_an_outside_write_once() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        let changes = listening(&state);
        std::fs::write(&path, b"changed from outside\n").expect("written");

        let change = changes
            .recv_timeout(Duration::from_secs(5))
            .expect("the change is reported");
        assert_eq!(
            change,
            DiskChange {
                id,
                hash: hash_of(b"changed from outside\n")
            }
        );
        assert_eq!(
            changes.recv_timeout(Duration::from_millis(500)),
            Err(RecvTimeoutError::Timeout),
            "one change is reported once"
        );
    }

    #[test]
    fn the_watcher_covers_a_document_opened_before_it_started_and_one_opened_after() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, _first, path) = opened(dir.path(), "a.md");
        let changes = listening(&state);
        let second = dir.path().join("b.md");
        std::fs::write(&second, START).expect("written");
        state.access().grant_file(&second).expect("grants");
        open_document(&state, &second).expect("opens");

        for file in [&path, &second] {
            std::fs::write(file, b"new\n").expect("written");
            assert!(
                changes.recv_timeout(Duration::from_secs(5)).is_ok(),
                "{} is watched",
                file.display()
            );
        }
    }

    #[test]
    fn a_closed_document_is_no_longer_watched() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        let changes = listening(&state);
        close_document(&state, id);
        std::fs::write(&path, b"after close\n").expect("written");
        assert_eq!(
            changes.recv_timeout(Duration::from_millis(700)),
            Err(RecvTimeoutError::Timeout)
        );
    }

    #[test]
    fn an_outside_change_is_reported_once_until_the_file_goes_back() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        std::fs::write(&path, b"theirs\n").expect("written");

        let first = check_path(&state, &path);
        assert_eq!(
            first,
            vec![DiskChange {
                id,
                hash: hash_of(b"theirs\n")
            }]
        );
        assert_eq!(
            check_path(&state, &path),
            Vec::new(),
            "the same content again"
        );

        std::fs::write(&path, START).expect("written");
        assert_eq!(
            check_path(&state, &path),
            Vec::new(),
            "back to what we hold"
        );
        std::fs::write(&path, b"theirs\n").expect("written");
        assert_eq!(
            check_path(&state, &path),
            first,
            "news again after going back"
        );
    }

    #[test]
    fn a_change_to_some_other_file_in_the_folder_is_not_ours() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, _id, _path) = opened(dir.path(), "a.md");
        let other = dir.path().join("other.md");
        std::fs::write(&other, b"x").expect("written");
        assert_eq!(check_path(&state, &other), Vec::new());
    }

    #[test]
    fn a_file_that_vanished_says_nothing_and_keeps_its_document() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        std::fs::remove_file(&path).expect("removed");
        assert_eq!(check_path(&state, &path), Vec::new());
        assert!(state.documents().get(id).is_some());
    }

    #[test]
    fn paths_match_without_regard_to_case_where_the_file_system_ignores_it() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = Arc::new(AppState::new(true));
        let path = dir.path().join("Mixed.md");
        std::fs::write(&path, START).expect("written");
        state.access().grant_file(&path).expect("grants");
        open_document(&state, &path).expect("opens");
        std::fs::write(&path, b"theirs\n").expect("written");
        // Use the path the document stores: the temp folder may be spelled with 8.3 short names.
        let path = state
            .documents()
            .entries()
            .next()
            .map(|(_, entry)| entry.path.clone())
            .expect("the document");
        let shouted = PathBuf::from(path.to_string_lossy().to_uppercase());
        assert_eq!(check_path(&state, &shouted).len(), 1);
    }

    #[test]
    fn reloading_puts_the_document_in_step_with_the_disk() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened(dir.path(), "a.md");
        std::fs::write(&path, b"theirs\r\nmore\r\n").expect("written");

        let bytes = reload_document(&state, id).expect("reloads");
        let frame = frame::decode(&bytes).expect("a frame");
        assert_eq!(frame.text, "theirs\nmore\n");
        assert_eq!(
            frame.header.get("hash"),
            Some(&serde_json::Value::from(hash_of(b"theirs\r\nmore\r\n")))
        );
        assert_eq!(
            check_path(&state, &path),
            Vec::new(),
            "nothing left to report"
        );
        assert_eq!(
            crate::documents::reload_document(&state, 99)
                .expect_err("not open")
                .kind(),
            "not-open"
        );
    }
}
