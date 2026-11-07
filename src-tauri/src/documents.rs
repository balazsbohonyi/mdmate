//! The documents that are open, and the operations the page runs on them: open, save, close.
//!
//! The page never names a path to save to. It opens a file, gets a document id back, and saves by
//! that id, so a save can only reach a file Rust has already checked. Ids come from Rust.

use crate::access::{Access, Resolved, display_path};
use crate::error::AppError;
use crate::fs::document::{Opened, ReadOnlyReason};
use crate::fs::encoding::Format;
use crate::fs::{self, Saved, atomic, frame};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

/// What Rust remembers about an open document.
#[derive(Clone, Debug)]
pub(crate) struct DocEntry {
    pub(crate) path: PathBuf,
    pub(crate) key: String,
    /// How to write it back; `None` when it is read-only.
    pub(crate) format: Option<Format>,
    /// The hash of the content last read from or written to disk. The watcher compares with it.
    pub(crate) known_hash: u128,
}

#[derive(Debug, Default)]
pub(crate) struct Documents {
    next_id: u32,
    by_id: HashMap<u32, DocEntry>,
    by_key: HashMap<String, u32>,
}

impl Documents {
    /// Adds a document, or refreshes it when the same file is already open. Returns its id.
    pub(crate) fn register(
        &mut self,
        resolved: &Resolved,
        format: Option<Format>,
        hash: u128,
    ) -> u32 {
        let id = match self.by_key.get(&resolved.key) {
            Some(&id) => id,
            None => {
                self.next_id += 1;
                self.by_key.insert(resolved.key.clone(), self.next_id);
                self.next_id
            }
        };
        self.by_id.insert(
            id,
            DocEntry {
                path: resolved.path.clone(),
                key: resolved.key.clone(),
                format,
                known_hash: hash,
            },
        );
        id
    }

    pub(crate) fn get(&self, id: u32) -> Option<&DocEntry> {
        self.by_id.get(&id)
    }

    pub(crate) fn set_known_hash(&mut self, id: u32, hash: u128) {
        if let Some(entry) = self.by_id.get_mut(&id) {
            entry.known_hash = hash;
        }
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
    access: Mutex<Access>,
    documents: Mutex<Documents>,
}

impl AppState {
    pub(crate) fn new(ignore_case: bool) -> Self {
        Self {
            access: Mutex::new(Access::new(ignore_case)),
            documents: Mutex::new(Documents::default()),
        }
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
    let saved = fs::save_path_with(&entry.path, frame.text, &frame.endings, format, hook)?;
    // Record what we just wrote, so the watcher's event for it is recognized and ignored.
    state.documents().set_known_hash(id, saved.hash);
    Ok(saved)
}

/// Forgets a document. Its tab is gone, so it no longer needs watching or saving.
pub(crate) fn close_document(state: &AppState, id: u32) {
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
