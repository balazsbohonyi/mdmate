//! The documents that are open, and the operations the page runs on them: open, save, close.
//!
//! The page never names a path to save to. It opens a file, gets a document id back, and saves by
//! that id, so a save can only reach a file Rust has already checked. Ids come from Rust.

use crate::access::{Access, Resolved, display_path};
use crate::drops::DropRegistry;
use crate::error::AppError;
use crate::fs::document::{Opened, ReadOnlyReason, content_hash};
use crate::fs::encoding::Format;
use crate::fs::{self, Saved, atomic, frame};
use crate::workspace::folders::{self, FolderWatcher};
use crate::workspace::watch::{DiskChange, Watcher};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

/// What Rust remembers about an open document.
#[derive(Clone, Debug)]
pub(crate) struct DocEntry {
    pub(crate) path: PathBuf,
    pub(crate) key: String,
    /// How to write it back; `None` when it is read-only.
    pub(crate) format: Option<Format>,
    /// The hash of the content last read from or written to disk. The watcher compares with it.
    pub(crate) known_hash: u128,
    /// The hash of a change from outside that the page was already told about, so one change is
    /// reported once however many events the file system raises for it.
    pub(crate) reported_hash: Option<u128>,
}

#[derive(Debug, Default)]
pub(crate) struct Documents {
    next_id: u32,
    by_id: HashMap<u32, DocEntry>,
    by_key: HashMap<String, u32>,
}

impl Documents {
    /// Adds a document and returns its id. A file that is already open keeps its entry as it is:
    /// the page still holds the text it read earlier, and the recorded hash and format describe
    /// that text. The page sees the new content in the frame and decides what it means.
    pub(crate) fn register(
        &mut self,
        resolved: &Resolved,
        format: Option<Format>,
        hash: u128,
    ) -> u32 {
        if let Some(&id) = self.by_key.get(&resolved.key) {
            return id;
        }
        self.next_id += 1;
        let id = self.next_id;
        self.by_key.insert(resolved.key.clone(), id);
        self.by_id.insert(
            id,
            DocEntry {
                path: resolved.path.clone(),
                key: resolved.key.clone(),
                format,
                known_hash: hash,
                reported_hash: None,
            },
        );
        id
    }

    pub(crate) fn get(&self, id: u32) -> Option<&DocEntry> {
        self.by_id.get(&id)
    }

    pub(crate) fn get_mut(&mut self, id: u32) -> Option<&mut DocEntry> {
        self.by_id.get_mut(&id)
    }

    /// Every open document with its id.
    pub(crate) fn entries(&self) -> impl Iterator<Item = (u32, &DocEntry)> {
        self.by_id.iter().map(|(&id, entry)| (id, entry))
    }

    /// Records the content now on disk as the one the document is in step with.
    pub(crate) fn set_known_hash(&mut self, id: u32, hash: u128) {
        if let Some(entry) = self.by_id.get_mut(&id) {
            entry.known_hash = hash;
            entry.reported_hash = None;
        }
    }

    /// Points a document at the file's new path after a rename or move. False when another open
    /// document already has that path, which a rename never allows, so nothing changes then.
    pub(crate) fn rebind(&mut self, id: u32, now: &Resolved) -> bool {
        if self.by_key.get(&now.key).is_some_and(|&other| other != id) {
            return false;
        }
        let Some(entry) = self.by_id.get_mut(&id) else {
            return false;
        };
        self.by_key.remove(&entry.key);
        entry.path = now.path.clone();
        entry.key = now.key.clone();
        self.by_key.insert(now.key.clone(), id);
        true
    }

    pub(crate) fn remove(&mut self, id: u32) -> Option<DocEntry> {
        let entry = self.by_id.remove(&id)?;
        self.by_key.remove(&entry.key);
        Some(entry)
    }
}

/// Everything the commands share. Held in Tauri's managed state.
#[derive(Debug)]
pub(crate) struct AppState {
    ignore_case: bool,
    access: Mutex<Access>,
    documents: Mutex<Documents>,
    /// Started when the page first asks for changes; see [`AppState::start_watcher`].
    watcher: OnceLock<Watcher>,
    /// Watches the folders the sidebar has open; see [`AppState::start_folder_watcher`].
    folder_watcher: OnceLock<FolderWatcher>,
    /// The paths native drops delivered.
    drops: DropRegistry,
}

impl AppState {
    pub(crate) fn new(ignore_case: bool) -> Self {
        Self {
            ignore_case,
            access: Mutex::new(Access::new(ignore_case)),
            documents: Mutex::new(Documents::default()),
            watcher: OnceLock::new(),
            folder_watcher: OnceLock::new(),
            drops: DropRegistry::new(ignore_case),
        }
    }

    /// Moves every open document that was at `old` (or below it, when `old` was a folder) to the
    /// same place under `new`, so that a save by id writes the new path and the watcher follows
    /// the file. Returns the documents that moved, for the page to rename their tabs.
    pub(crate) fn documents_moved(
        &self,
        old: &Resolved,
        new: &Resolved,
    ) -> Vec<crate::workspace::ops::MovedDocument> {
        // The lock on the documents is never held while asking Access, so the two never wait on
        // each other.
        let affected: Vec<(u32, PathBuf)> = self
            .documents()
            .entries()
            .filter(|(_, entry)| crate::access::is_inside(&entry.key, &old.key))
            .map(|(id, entry)| (id, entry.path.clone()))
            .collect();
        let mut moved = Vec::new();
        for (id, was) in affected {
            let now = match was.strip_prefix(&old.path) {
                Ok(rest) if rest.as_os_str().is_empty() => new.path.clone(),
                Ok(rest) => new.path.join(rest),
                Err(_) => continue,
            };
            let Ok(resolved) = self.access().resolve(&now) else {
                continue;
            };
            if !self.documents().rebind(id, &resolved) {
                continue;
            }
            if let Some(watcher) = self.watcher() {
                watcher.unwatch(id);
                watcher.watch(id, &resolved.path);
            }
            moved.push(crate::workspace::ops::MovedDocument {
                id,
                path: display_path(&resolved.path),
            });
        }
        moved
    }

    /// A path as the watcher compares it: the way people read it, lower-cased where the file
    /// system ignores case. Event paths and document paths both go through this.
    pub(crate) fn spelling_key(&self, path: &Path) -> String {
        let text = display_path(path);
        if self.ignore_case {
            text.to_lowercase()
        } else {
            text
        }
    }

    /// Starts watching the folders of the open documents, and sends every change another program
    /// makes to `sink`. Called again, it only replaces the sink, so a page that reloads does not
    /// start a second watcher.
    pub(crate) fn start_watcher(
        self: &Arc<Self>,
        sink: Box<dyn Fn(DiskChange) + Send + Sync>,
    ) -> Result<(), AppError> {
        if let Some(watcher) = self.watcher.get() {
            watcher.set_sink(sink);
            return Ok(());
        }
        let watcher = Watcher::start(self, sink)?;
        let open: Vec<(u32, PathBuf)> = self
            .documents()
            .entries()
            .map(|(id, entry)| (id, entry.path.clone()))
            .collect();
        for (id, path) in open {
            watcher.watch(id, &path);
        }
        // Losing the race to another call leaves that one's watcher in place, which is fine.
        let _ = self.watcher.set(watcher);
        Ok(())
    }

    pub(crate) fn watcher(&self) -> Option<&Watcher> {
        self.watcher.get()
    }

    /// Starts the watcher for the sidebar's open folders and sends the folder whose listing went
    /// out of date to `sink`. Called again, it only replaces the sink.
    pub(crate) fn start_folder_watcher(&self, sink: folders::Sink) -> Result<(), AppError> {
        if let Some(watcher) = self.folder_watcher.get() {
            watcher.set_sink(sink);
            return Ok(());
        }
        // Losing the race to another call leaves that one's watcher in place, which is fine.
        let _ = self.folder_watcher.set(FolderWatcher::start(sink)?);
        Ok(())
    }

    pub(crate) fn folder_watcher(&self) -> Option<&FolderWatcher> {
        self.folder_watcher.get()
    }

    /// The paths native drops delivered.
    pub(crate) fn drops(&self) -> &DropRegistry {
        &self.drops
    }

    // A thread that panicked while holding a lock must not take the whole app down with it, so a
    // poisoned lock is used as it is.
    pub(crate) fn access(&self) -> MutexGuard<'_, Access> {
        self.access.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn documents(&self) -> MutexGuard<'_, Documents> {
        self.documents
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Reads any file the page was given access to. The bytes come back untouched.
pub(crate) fn read_allowed(state: &AppState, path: &Path) -> Result<Vec<u8>, AppError> {
    let resolved = state.access().check(path)?;
    fs::read_bytes(&resolved.path)
}

/// Opens a file the page was given access to, registers it, and returns the frame to send back.
pub(crate) fn open_document(state: &AppState, path: &Path) -> Result<Vec<u8>, AppError> {
    let resolved = state.access().check(path)?;
    let opened = fs::open_path(&resolved.path)?;
    let id = state
        .documents()
        .register(&resolved, opened.format, opened.hash);
    if let Some(watcher) = state.watcher() {
        watcher.watch(id, &resolved.path);
    }
    Ok(open_frame(id, &resolved, &opened))
}

/// Reads an open document's file again, for when the page asks for what is on disk now. The
/// document is then in step with that content, so the watcher stays quiet about it. The page
/// decides whether to show it (load theirs) or only to remember it (keep mine).
pub(crate) fn reload_document(state: &AppState, id: u32) -> Result<Vec<u8>, AppError> {
    let entry = state
        .documents()
        .get(id)
        .cloned()
        .ok_or(AppError::NotOpen(id))?;
    let opened = fs::open_path(&entry.path)?;
    {
        let mut documents = state.documents();
        // The document may have closed while the file was read.
        let current = documents.get_mut(id).ok_or(AppError::NotOpen(id))?;
        current.format = opened.format;
        current.known_hash = opened.hash;
        current.reported_hash = None;
    }
    let resolved = Resolved {
        path: entry.path,
        key: entry.key,
    };
    Ok(open_frame(id, &resolved, &opened))
}

fn open_frame(id: u32, resolved: &Resolved, opened: &Opened) -> Vec<u8> {
    let mut header = Map::new();
    header.insert("id".into(), id.into());
    header.insert("path".into(), display_path(&resolved.path).into());
    let name = resolved
        .path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    header.insert("name".into(), name.into());
    header.insert(
        "encoding".into(),
        opened
            .format
            .map_or("unsupported", |format| format.encoding.name())
            .into(),
    );
    header.insert("bom".into(), opened.format.is_some_and(|f| f.bom).into());
    header.insert(
        "readOnly".into(),
        opened
            .read_only
            .map_or(Value::Null, |reason: ReadOnlyReason| reason.name().into()),
    );
    header.insert("size".into(), opened.size.into());
    header.insert("hash".into(), hash_hex(opened.hash).into());
    frame::encode(header, &opened.endings, &opened.text)
}

/// A hash as the page sees it: 32 hex digits.
pub(crate) fn hash_hex(hash: u128) -> String {
    format!("{hash:032x}")
}

/// Saves a frame of text and endings into the open document `id`.
pub(crate) fn save_document(state: &AppState, id: u32, body: &[u8]) -> Result<Saved, AppError> {
    save_document_with(state, id, body, |_| Ok(()))
}

/// Like [`save_document`], with a hook that can make the write fail, for tests.
pub(crate) fn save_document_with(
    state: &AppState,
    id: u32,
    body: &[u8],
    hook: impl Fn(atomic::Stage) -> std::io::Result<()>,
) -> Result<Saved, AppError> {
    let entry = state
        .documents()
        .get(id)
        .cloned()
        .ok_or(AppError::NotOpen(id))?;
    let Some(format) = entry.format else {
        return Err(AppError::ReadOnly(
            "its encoding is not one mdmate can write back".into(),
        ));
    };
    let frame = frame::decode(body)?;
    let recorded = std::cell::Cell::new(None);
    let saved = fs::save_path_guarded(
        &entry.path,
        frame.text,
        &frame.endings,
        format,
        |hash| {
            // Saving over a file that changed behind the app's back would lose that change, so it
            // is refused and the page asks the user. A file that cannot be read (it is gone, or
            // locked) is not a reason to refuse: the save recreates it or fails on its own.
            if let Ok(current) = fs::read_bytes_settled(&entry.path)
                && content_hash(&current) != entry.known_hash
            {
                return Err(AppError::DiskChanged);
            }
            // The watcher can see the new file before this function returns, and must find the
            // hash it is looking for already recorded. So it is recorded before the write, and put
            // back if the write fails.
            state.documents().set_known_hash(id, hash);
            recorded.set(Some(hash));
            Ok(())
        },
        hook,
    );
    // The write failed after the hash went in: the file is as it was, so the record goes back too.
    // Only if nothing else has moved it on in the meantime.
    if saved.is_err()
        && let Some(hash) = recorded.get()
        && let Some(current) = state.documents().get_mut(id)
        && current.known_hash == hash
    {
        current.known_hash = entry.known_hash;
        current.reported_hash = entry.reported_hash;
    }
    saved
}

/// Forgets a document. Its tab is gone, so it no longer needs watching or saving.
pub(crate) fn close_document(state: &AppState, id: u32) {
    if let Some(watcher) = state.watcher() {
        watcher.unwatch(id);
    }
    state.documents().remove(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::eol::{Ending, Endings};

    fn state_with(dir: &Path, names: &[&str]) -> AppState {
        let state = AppState::new(false);
        for name in names {
            std::fs::write(dir.join(name), b"one\r\ntwo\r\n").expect("written");
        }
        state
    }

    fn edit_frame(text: &str) -> Vec<u8> {
        frame::encode(Map::new(), &Endings::uniform(Ending::CrLf), text)
    }

    #[test]
    fn a_path_nobody_granted_cannot_be_read_or_opened() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = state_with(dir.path(), &["a.md"]);
        let path = dir.path().join("a.md");
        assert_eq!(
            read_allowed(&state, &path).expect_err("refused").kind(),
            "not-allowed"
        );
        assert_eq!(
            open_document(&state, &path).expect_err("refused").kind(),
            "not-allowed"
        );
    }

    #[test]
    fn a_granted_file_opens_and_arrives_as_text_plus_endings() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = state_with(dir.path(), &["a.md"]);
        let path = dir.path().join("a.md");
        state.access().grant_file(&path).expect("grants");

        let bytes = open_document(&state, &path).expect("opens");
        let frame = frame::decode(&bytes).expect("a valid frame");
        assert_eq!(frame.text, "one\ntwo\n");
        assert_eq!(frame.endings.dominant, Ending::CrLf);
        assert_eq!(frame.header.get("name"), Some(&Value::from("a.md")));
        assert_eq!(frame.header.get("encoding"), Some(&Value::from("utf-8")));
        assert_eq!(frame.header.get("readOnly"), Some(&Value::Null));
        assert_eq!(read_allowed(&state, &path).expect("readable").len(), 10);
    }

    #[test]
    fn opening_the_same_file_twice_gives_the_same_id() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = state_with(dir.path(), &["a.md", "b.md"]);
        for name in ["a.md", "b.md"] {
            state
                .access()
                .grant_file(&dir.path().join(name))
                .expect("grants");
        }
        let id = |name: &str| {
            let bytes = open_document(&state, &dir.path().join(name)).expect("opens");
            let frame = frame::decode(&bytes).expect("a valid frame");
            frame
                .header
                .get("id")
                .and_then(Value::as_u64)
                .expect("an id")
        };
        let (a1, b, a2) = (id("a.md"), id("b.md"), id("a.md"));
        assert_eq!(a1, a2);
        assert_ne!(a1, b);
        // Spelled another way, it is still the same file.
        let dotted = dir.path().join(".").join("a.md");
        let bytes = open_document(&state, &dotted).expect("opens");
        let again = frame::decode(&bytes).expect("a valid frame");
        assert_eq!(again.header.get("id").and_then(Value::as_u64), Some(a1));
    }

    #[test]
    fn saving_writes_the_edit_with_the_original_endings_and_records_the_hash() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = state_with(dir.path(), &["a.md"]);
        let path = dir.path().join("a.md");
        state.access().grant_file(&path).expect("grants");
        let opened = frame::decode(&open_document(&state, &path).expect("opens"))
            .map(|f| f.header.get("id").and_then(Value::as_u64))
            .expect("a valid frame")
            .expect("an id");
        let id = u32::try_from(opened).expect("a small id");

        let saved = save_document(&state, id, &edit_frame("one\nTWO\n")).expect("saves");

        assert_eq!(std::fs::read(&path).expect("readable"), b"one\r\nTWO\r\n");
        assert_eq!(
            state.documents().get(id).map(|e| e.known_hash),
            Some(saved.hash)
        );
    }

    #[test]
    fn saving_an_unknown_document_or_a_read_only_one_is_refused() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::new(false);
        assert_eq!(
            save_document(&state, 9, &edit_frame("x"))
                .expect_err("not open")
                .kind(),
            "not-open"
        );

        let path = dir.path().join("latin1.md");
        std::fs::write(&path, b"caf\xE9").expect("written");
        state.access().grant_file(&path).expect("grants");
        let bytes = open_document(&state, &path).expect("opens read-only");
        let frame = frame::decode(&bytes).expect("a valid frame");
        assert_eq!(
            frame.header.get("readOnly"),
            Some(&Value::from("unsupported-encoding"))
        );
        let id = u32::try_from(frame.header.get("id").and_then(Value::as_u64).expect("id"))
            .expect("small");
        assert_eq!(
            save_document(&state, id, &edit_frame("x"))
                .expect_err("read-only")
                .kind(),
            "read-only"
        );
        assert_eq!(std::fs::read(&path).expect("readable"), b"caf\xE9");
    }

    #[test]
    fn a_failed_save_leaves_the_file_and_the_recorded_hash_alone() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = state_with(dir.path(), &["a.md"]);
        let path = dir.path().join("a.md");
        state.access().grant_file(&path).expect("grants");
        let bytes = open_document(&state, &path).expect("opens");
        let frame = frame::decode(&bytes).expect("a valid frame");
        let id = u32::try_from(frame.header.get("id").and_then(Value::as_u64).expect("id"))
            .expect("small");
        let before = state.documents().get(id).map(|e| e.known_hash);

        let error = save_document_with(&state, id, &edit_frame("NEW\n"), |_| {
            Err(std::io::Error::other("injected failure"))
        })
        .expect_err("the hook fails the save");

        assert_eq!(error.kind(), "io");
        assert_eq!(std::fs::read(&path).expect("readable"), b"one\r\ntwo\r\n");
        assert_eq!(state.documents().get(id).map(|e| e.known_hash), before);
    }

    /// Opens `a.md` (with "one\r\ntwo\r\n" in it) and returns the state, the id and the path.
    fn opened_a(dir: &Path) -> (AppState, u32, PathBuf) {
        let state = state_with(dir, &["a.md"]);
        let path = dir.join("a.md");
        state.access().grant_file(&path).expect("grants");
        let bytes = open_document(&state, &path).expect("opens");
        let frame = frame::decode(&bytes).expect("a frame");
        let id = u32::try_from(frame.header.get("id").and_then(Value::as_u64).expect("id"))
            .expect("small");
        (state, id, path)
    }

    #[test]
    fn a_save_over_a_file_that_changed_behind_our_back_is_refused() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened_a(dir.path());
        let known = state.documents().get(id).map(|e| e.known_hash);
        std::fs::write(&path, b"theirs\r\n").expect("written by another program");

        let error = save_document(&state, id, &edit_frame("mine\n")).expect_err("refused");

        assert_eq!(error.kind(), "disk-changed");
        assert_eq!(std::fs::read(&path).expect("readable"), b"theirs\r\n");
        assert_eq!(state.documents().get(id).map(|e| e.known_hash), known);

        // Once the page has taken a look at what is on disk, the save goes through.
        reload_document(&state, id).expect("reloads");
        save_document(&state, id, &edit_frame("mine\n")).expect("saves");
        assert_eq!(std::fs::read(&path).expect("readable"), b"mine\r\n");
    }

    #[test]
    fn opening_an_open_file_again_does_not_make_the_page_look_current() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened_a(dir.path());
        let known = state.documents().get(id).map(|e| e.known_hash);
        std::fs::write(&path, b"theirs\r\n").expect("written by another program");

        let bytes = open_document(&state, &path).expect("opens again");
        let frame = frame::decode(&bytes).expect("a frame");

        assert_eq!(
            frame.header.get("id").and_then(Value::as_u64),
            Some(u64::from(id))
        );
        assert_eq!(
            frame.text, "theirs\n",
            "the frame carries what is on disk now"
        );
        assert_eq!(state.documents().get(id).map(|e| e.known_hash), known);
        // The page still holds the old text, so a save from it must not overwrite the new file.
        let error = save_document(&state, id, &edit_frame("mine\n")).expect_err("refused");
        assert_eq!(error.kind(), "disk-changed");
    }

    #[test]
    fn a_save_recreates_a_file_that_was_deleted() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (state, id, path) = opened_a(dir.path());
        std::fs::remove_file(&path).expect("removed");
        save_document(&state, id, &edit_frame("back\n")).expect("saves");
        assert_eq!(std::fs::read(&path).expect("readable"), b"back\r\n");
    }

    #[test]
    fn a_closed_document_cannot_be_saved() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = state_with(dir.path(), &["a.md"]);
        let path = dir.path().join("a.md");
        state.access().grant_file(&path).expect("grants");
        let bytes = open_document(&state, &path).expect("opens");
        let frame = frame::decode(&bytes).expect("a valid frame");
        let id = u32::try_from(frame.header.get("id").and_then(Value::as_u64).expect("id"))
            .expect("small");
        close_document(&state, id);
        assert_eq!(
            save_document(&state, id, &edit_frame("x"))
                .expect_err("closed")
                .kind(),
            "not-open"
        );
    }
}
