//! The workspace roots: which folders the sidebar shows, kept across runs.
//!
//! Rust keeps the list itself, in the data folder, and grants the folders again at start. The
//! page's session snapshot never names a root, so a damaged or hostile snapshot cannot widen what
//! the page may read. Roots are written the moment they change, not on the session journal's
//! timer, so a force-kill right after Open Folder keeps the folder.

use crate::access::display_path;
use crate::documents::AppState;
use crate::error::AppError;
use crate::fs::atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

const FILE: &str = "workspace.json";
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    roots: Vec<String>,
}

/// The file that remembers the roots.
#[derive(Debug)]
pub(crate) struct RootStore {
    dir: PathBuf,
    /// One write at a time, so two changes never interleave their file operations.
    writing: Mutex<()>,
}

impl RootStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            writing: Mutex::new(()),
        }
    }

    fn file(&self) -> PathBuf {
        self.dir.join(FILE)
    }

    /// The roots the last run left, as written. A file that is missing or cannot be read gives an
    /// empty list: the workspace starts empty, and the next change writes a fresh file.
    pub(crate) fn load(&self) -> Vec<String> {
        let Ok(text) = std::fs::read_to_string(self.file()) else {
            return Vec::new();
        };
        match serde_json::from_str::<Envelope>(&text) {
            Ok(envelope) if envelope.version == VERSION => envelope.roots,
            _ => Vec::new(),
        }
    }

    /// Replaces the list on disk.
    pub(crate) fn save(&self, roots: &[String]) -> Result<(), AppError> {
        let body = serde_json::to_vec(&Envelope {
            version: VERSION,
            roots: roots.to_vec(),
        })
        .map_err(|error| AppError::Invalid(error.to_string()))?;
        let _guard = self.writing.lock().unwrap_or_else(PoisonError::into_inner);
        std::fs::create_dir_all(&self.dir)?;
        atomic::write_atomic_with(&self.file(), &body, |_| Ok(()))
    }
}

/// The roots as people read them, in the order the tree shows them.
pub(crate) fn current(state: &AppState) -> Vec<String> {
    state
        .access()
        .roots()
        .iter()
        .map(|root| display_path(&root.path))
        .collect()
}

/// Makes a folder a workspace root and remembers it. Adding a folder that already is a root
/// changes nothing. Returns the folder as people read it.
pub(crate) fn add(state: &AppState, store: &RootStore, path: &Path) -> Result<String, AppError> {
    let resolved = state.access().grant_root(path)?;
    store.save(&current(state))?;
    Ok(display_path(&resolved.path))
}

/// Takes a folder out of the workspace and revokes the page's access to it. Files the user
/// opened one by one stay open and savable.
pub(crate) fn remove(state: &AppState, store: &RootStore, path: &Path) -> Result<(), AppError> {
    let was_root = state.access().revoke_root(path);
    if !was_root {
        return Err(AppError::Invalid("not a workspace folder".into()));
    }
    store.save(&current(state))
}

/// Grants the folders the last run had, skipping any that are gone, and returns the roots now.
/// Called once at start.
pub(crate) fn restore(state: &AppState, store: &RootStore) -> Vec<String> {
    for path in store.load() {
        // A folder that was deleted, or a drive that is not there, is simply not a root any more.
        let _ = state.access().grant_root(Path::new(&path));
    }
    current(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    fn state() -> AppState {
        AppState::new(false)
    }

    fn folder(base: &Path, name: &str) -> PathBuf {
        let path = base.join(name);
        std::fs::create_dir_all(&path).expect("creates");
        path
    }

    #[test]
    fn two_roots_both_show_in_the_order_they_were_added() {
        let dir = temp();
        let (a, b) = (folder(dir.path(), "a"), folder(dir.path(), "b"));
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        add(&state, &store, &b).expect("adds b");
        add(&state, &store, &a).expect("adds a");
        let roots = current(&state);
        assert_eq!(roots.len(), 2);
        assert!(
            roots[0].ends_with('b') && roots[1].ends_with('a'),
            "{roots:?}"
        );
    }

    #[test]
    fn multiple_roots_each_open_their_own_files_and_nothing_else() {
        let dir = temp();
        let (a, b) = (folder(dir.path(), "a"), folder(dir.path(), "b"));
        let outside = folder(dir.path(), "c");
        for (folder, name) in [(&a, "x.md"), (&b, "y.md"), (&outside, "z.md")] {
            std::fs::write(folder.join(name), b"x").expect("writes");
        }
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        add(&state, &store, &a).expect("adds");
        add(&state, &store, &b).expect("adds");
        assert!(state.access().check(&a.join("x.md")).is_ok());
        assert!(state.access().check(&b.join("y.md")).is_ok());
        assert_eq!(
            state
                .access()
                .check(&outside.join("z.md"))
                .expect_err("not a root")
                .kind(),
            "not-allowed"
        );
    }

    #[test]
    fn adding_a_root_twice_lists_it_once() {
        let dir = temp();
        let a = folder(dir.path(), "a");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        let first = add(&state, &store, &a).expect("adds");
        let second = add(&state, &store, &a.join("..").join("a")).expect("adds again");
        assert_eq!(first, second);
        assert_eq!(current(&state).len(), 1);
    }

    #[test]
    fn a_file_or_a_missing_folder_cannot_be_a_root() {
        let dir = temp();
        let file = dir.path().join("a.md");
        std::fs::write(&file, b"x").expect("writes");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        assert!(add(&state, &store, &file).is_err());
        assert!(add(&state, &store, &dir.path().join("missing")).is_err());
        assert!(current(&state).is_empty());
        assert!(
            !dir.path().join("data").join(FILE).exists(),
            "nothing was saved"
        );
    }

    #[test]
    fn open_folder_lists_the_root_and_what_is_in_it() {
        let dir = temp();
        let a = folder(dir.path(), "a");
        std::fs::write(a.join("note.md"), b"x").expect("writes");
        std::fs::create_dir(a.join("sub")).expect("creates");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        let shown = add(&state, &store, &a).expect("adds");
        assert_eq!(current(&state), std::slice::from_ref(&shown));
        let allowed = state
            .access()
            .check(Path::new(&shown))
            .expect("a root is allowed");
        let listed = super::super::tree::list_dir(&allowed.path).expect("lists");
        let names: Vec<_> = listed.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["sub", "note.md"]);
    }

    #[test]
    fn remove_root_revokes_access_to_everything_inside() {
        let dir = temp();
        let a = folder(dir.path(), "a");
        let file = a.join("note.md");
        std::fs::write(&file, b"x").expect("writes");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        add(&state, &store, &a).expect("adds");
        assert!(state.access().check(&file).is_ok());
        remove(&state, &store, &a).expect("removes");
        assert_eq!(
            state.access().check(&file).expect_err("revoked").kind(),
            "not-allowed"
        );
        assert!(current(&state).is_empty());
        assert!(store.load().is_empty(), "the removal was saved");
    }

    #[test]
    fn remove_root_keeps_a_file_the_user_opened_one_by_one() {
        let dir = temp();
        let a = folder(dir.path(), "a");
        let file = a.join("note.md");
        std::fs::write(&file, b"x").expect("writes");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        add(&state, &store, &a).expect("adds");
        state.access().grant_file(&file).expect("opened by hand");
        remove(&state, &store, &a).expect("removes");
        assert!(state.access().check(&file).is_ok());
    }

    #[test]
    fn a_root_deleted_from_disk_can_still_be_removed() {
        let dir = temp();
        let a = folder(dir.path(), "a");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        // The page only ever sends back the path it was shown. That is the resolved one, which can
        // differ from the temp dir's own spelling (a Windows 8.3 short name such as RUNNER~1), and
        // a folder that is gone can no longer be resolved to compare by.
        let shown = add(&state, &store, &a).expect("adds");
        std::fs::remove_dir_all(&a).expect("deletes");
        remove(&state, &store, Path::new(&shown)).expect("removes a folder that is gone");
        assert!(current(&state).is_empty());
    }

    #[test]
    fn removing_something_that_is_not_a_root_is_refused() {
        let dir = temp();
        let a = folder(dir.path(), "a");
        let state = state();
        let store = RootStore::new(dir.path().join("data"));
        assert!(remove(&state, &store, &a).is_err());
    }

    #[test]
    fn roots_come_back_after_a_restart_and_a_vanished_one_does_not() {
        let dir = temp();
        let (a, b) = (folder(dir.path(), "a"), folder(dir.path(), "b"));
        std::fs::write(a.join("note.md"), b"x").expect("writes");
        let data = dir.path().join("data");
        {
            let state = state();
            let store = RootStore::new(data.clone());
            add(&state, &store, &a).expect("adds");
            add(&state, &store, &b).expect("adds");
        }
        std::fs::remove_dir_all(&b).expect("b is gone before the next run");
        let state = state();
        let store = RootStore::new(data);
        assert_eq!(
            state
                .access()
                .check(&a.join("note.md"))
                .expect_err("not yet")
                .kind(),
            "not-allowed"
        );
        let roots = restore(&state, &store);
        assert_eq!(roots.len(), 1, "{roots:?}");
        assert!(roots[0].ends_with('a'));
        assert!(state.access().check(&a.join("note.md")).is_ok());
    }

    #[test]
    fn an_unreadable_or_foreign_file_starts_the_workspace_empty() {
        let dir = temp();
        let store = RootStore::new(dir.path().to_path_buf());
        assert!(store.load().is_empty(), "no file yet");
        std::fs::write(dir.path().join(FILE), b"not json").expect("writes");
        assert!(store.load().is_empty());
        std::fs::write(dir.path().join(FILE), br#"{"version":99,"roots":["/x"]}"#).expect("writes");
        assert!(store.load().is_empty());
    }
}
