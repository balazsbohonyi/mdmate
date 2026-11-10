//! Open Recent: the last files and folders the user opened, kept across runs.
//!
//! Rust keeps the list itself, in the data folder, and is the only thing that adds to it: the page
//! cannot put a path on it. Choosing an entry goes through Rust too, which refuses a path that is
//! not on the list before it grants anything, the same way a dropped path is checked against the
//! drop record. A file or folder that no longer exists is dropped when the list is read.
//! Untitled tabs never reach this module, since they have no path.

use crate::access::display_path;
use crate::documents::AppState;
use crate::error::AppError;
use crate::fs::atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

const FILE: &str = "recent.json";
const VERSION: u32 = 1;
/// How many files and folders are kept.
pub(crate) const MAX_FILES: usize = 10;
pub(crate) const MAX_FOLDERS: usize = 5;

/// What the menu shows: newest first.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Lists {
    pub(crate) files: Vec<String>,
    pub(crate) folders: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default)]
    folders: Vec<String>,
}

/// The file that remembers the lists.
#[derive(Debug)]
pub(crate) struct RecentStore {
    dir: PathBuf,
    ignore_case: bool,
    /// One change at a time: every change reads the file, edits the lists and writes them back.
    changing: Mutex<()>,
}

/// Two spellings of one path are one entry where the file system ignores case.
fn same(a: &str, b: &str, ignore_case: bool) -> bool {
    if ignore_case {
        a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

/// Puts `path` first, drops any older entry for the same path, and keeps at most `max`.
fn push_front(list: &mut Vec<String>, path: &str, max: usize, ignore_case: bool) {
    list.retain(|old| !same(old, path, ignore_case));
    list.insert(0, path.to_owned());
    list.truncate(max);
}

impl RecentStore {
    pub(crate) fn new(dir: PathBuf, ignore_case: bool) -> Self {
        Self {
            dir,
            ignore_case,
            changing: Mutex::new(()),
        }
    }

    fn file(&self) -> PathBuf {
        self.dir.join(FILE)
    }

    /// The lists as written. A file that is missing, damaged or from another version is an empty
    /// list: nothing is lost that mattered, and the next change writes a fresh file.
    fn read(&self) -> Lists {
        let Ok(text) = std::fs::read_to_string(self.file()) else {
            return Lists::default();
        };
        match serde_json::from_str::<Envelope>(&text) {
            Ok(envelope) if envelope.version == VERSION => {
                let mut lists = Lists {
                    files: envelope.files,
                    folders: envelope.folders,
                };
                // Whatever the file holds, the limits hold.
                lists.files.truncate(MAX_FILES);
                lists.folders.truncate(MAX_FOLDERS);
                lists
            }
            _ => Lists::default(),
        }
    }

    fn write(&self, lists: &Lists) -> Result<(), AppError> {
        let body = serde_json::to_vec(&Envelope {
            version: VERSION,
            files: lists.files.clone(),
            folders: lists.folders.clone(),
        })
        .map_err(|error| AppError::Invalid(error.to_string()))?;
        std::fs::create_dir_all(&self.dir)?;
        atomic::write_atomic_with(&self.file(), &body, |_| Ok(()))
    }

    /// Notes that a file was opened. A file already first on the list changes nothing, so
    /// opening the same file again does not write anything.
    pub(crate) fn record_file(&self, path: &Path) -> Result<(), AppError> {
        let shown = display_path(path);
        let _guard = self.changing.lock().unwrap_or_else(PoisonError::into_inner);
        let mut lists = self.read();
        if lists.files.first().is_some_and(|first| first == &shown) {
            return Ok(());
        }
        push_front(&mut lists.files, &shown, MAX_FILES, self.ignore_case);
        self.write(&lists)
    }

    /// Notes that a folder was opened.
    pub(crate) fn record_folder(&self, path: &Path) -> Result<(), AppError> {
        let shown = display_path(path);
        let _guard = self.changing.lock().unwrap_or_else(PoisonError::into_inner);
        let mut lists = self.read();
        if lists.folders.first().is_some_and(|first| first == &shown) {
            return Ok(());
        }
        push_front(&mut lists.folders, &shown, MAX_FOLDERS, self.ignore_case);
        self.write(&lists)
    }

    /// The lists for the menu, with entries that no longer exist dropped (and the file rewritten
    /// when any were).
    pub(crate) fn list(&self) -> Lists {
        let _guard = self.changing.lock().unwrap_or_else(PoisonError::into_inner);
        let lists = self.read();
        let kept = Lists {
            files: lists
                .files
                .iter()
                .filter(|path| Path::new(path).is_file())
                .cloned()
                .collect(),
            folders: lists
                .folders
                .iter()
                .filter(|path| Path::new(path).is_dir())
                .cloned()
                .collect(),
        };
        if kept != lists {
            // Best effort: the menu is right either way, and the next read prunes again.
            let _ = self.write(&kept);
        }
        kept
    }

    /// Empties both lists.
    pub(crate) fn clear(&self) -> Result<(), AppError> {
        let _guard = self.changing.lock().unwrap_or_else(PoisonError::into_inner);
        self.write(&Lists::default())
    }

    /// Whether `path` is a file on the list, spelled as the list spells it.
    pub(crate) fn has_file(&self, path: &str) -> bool {
        self.read()
            .files
            .iter()
            .any(|entry| same(entry, path, self.ignore_case))
    }

    /// Whether `path` is a folder on the list.
    pub(crate) fn has_folder(&self, path: &str) -> bool {
        self.read()
            .folders
            .iter()
            .any(|entry| same(entry, path, self.ignore_case))
    }
}

/// Lets the page open a file on the list: grants it, and moves it to the top. A path that is not on
/// the list is refused, whatever the page says, and nothing is granted.
pub(crate) fn grant_file(
    state: &AppState,
    store: &RecentStore,
    path: &str,
) -> Result<String, AppError> {
    if !store.has_file(path) {
        return Err(AppError::NotAllowed(path.to_owned()));
    }
    let resolved = state.access().grant_file(Path::new(path))?;
    let _ = store.record_file(&resolved.path);
    Ok(display_path(&resolved.path))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dir {
        _guard: tempfile::TempDir,
        path: PathBuf,
    }

    fn temp() -> Dir {
        let guard = tempfile::tempdir().expect("temp dir");
        let path = std::fs::canonicalize(guard.path()).expect("canonical");
        Dir {
            _guard: guard,
            path,
        }
    }

    fn store(dir: &Dir) -> RecentStore {
        RecentStore::new(dir.path.join("data"), false)
    }

    /// Files and folders that exist, so the list does not drop them.
    fn make(dir: &Dir, count: usize) -> (Vec<PathBuf>, Vec<PathBuf>) {
        let files = (0..count)
            .map(|n| {
                let path = dir.path.join(format!("file-{n}.md"));
                std::fs::write(&path, b"x").expect("written");
                path
            })
            .collect();
        let folders = (0..count)
            .map(|n| {
                let path = dir.path.join(format!("folder-{n}"));
                std::fs::create_dir_all(&path).expect("made");
                path
            })
            .collect();
        (files, folders)
    }

    #[test]
    fn recent_list_keeps_the_newest_ten_files_and_five_folders_across_a_reload() {
        let dir = temp();
        let (files, folders) = make(&dir, 14);
        let first = store(&dir);
        for path in &files {
            first.record_file(path).expect("recorded");
        }
        for path in &folders {
            first.record_folder(path).expect("recorded");
        }
        // A new store over the same folder is a new run.
        let second = store(&dir);
        let lists = second.list();
        let shown = |paths: &[PathBuf]| -> Vec<String> {
            paths.iter().rev().map(|p| display_path(p)).collect()
        };
        assert_eq!(lists.files, shown(&files)[..MAX_FILES]);
        assert_eq!(lists.folders, shown(&folders)[..MAX_FOLDERS]);
        assert_eq!(lists.files.len(), 10);
        assert_eq!(lists.folders.len(), 5);
    }

    #[test]
    fn recent_list_moves_a_file_opened_again_to_the_top_without_a_second_copy() {
        let dir = temp();
        let (files, _) = make(&dir, 3);
        let recent = store(&dir);
        for path in &files {
            recent.record_file(path).expect("recorded");
        }
        recent.record_file(&files[0]).expect("recorded");
        recent.record_file(&files[0]).expect("recorded again");
        let want: Vec<String> = [0, 2, 1].iter().map(|&n| display_path(&files[n])).collect();
        assert_eq!(recent.list().files, want);
    }

    #[test]
    fn recent_list_treats_two_spellings_as_one_where_the_file_system_ignores_case() {
        let dir = temp();
        let (files, _) = make(&dir, 1);
        let recent = RecentStore::new(dir.path.join("data"), true);
        recent.record_file(&files[0]).expect("recorded");
        let shouted = PathBuf::from(display_path(&files[0]).to_uppercase());
        recent.record_file(&shouted).expect("recorded");
        assert_eq!(recent.read().files.len(), 1);
        assert!(recent.has_file(&display_path(&files[0]).to_lowercase()));
    }

    #[test]
    fn recent_list_drops_what_no_longer_exists_when_it_is_shown() {
        let dir = temp();
        let (files, folders) = make(&dir, 3);
        let recent = store(&dir);
        for path in &files {
            recent.record_file(path).expect("recorded");
        }
        for path in &folders {
            recent.record_folder(path).expect("recorded");
        }
        std::fs::remove_file(&files[1]).expect("deleted");
        std::fs::remove_dir(&folders[2]).expect("deleted");
        let lists = recent.list();
        assert_eq!(
            lists.files,
            [display_path(&files[2]), display_path(&files[0])]
        );
        assert_eq!(
            lists.folders,
            [display_path(&folders[1]), display_path(&folders[0])]
        );
        // And the file no longer holds them.
        assert_eq!(recent.read(), lists);
    }

    #[test]
    fn recent_list_clear_empties_both_lists_for_good() {
        let dir = temp();
        let (files, folders) = make(&dir, 2);
        let recent = store(&dir);
        recent.record_file(&files[0]).expect("recorded");
        recent.record_folder(&folders[0]).expect("recorded");
        recent.clear().expect("cleared");
        assert_eq!(store(&dir).list(), Lists::default());
    }

    #[test]
    fn recent_list_only_says_yes_to_what_it_holds() {
        let dir = temp();
        let (files, folders) = make(&dir, 2);
        let recent = store(&dir);
        recent.record_file(&files[0]).expect("recorded");
        recent.record_folder(&folders[0]).expect("recorded");
        assert!(recent.has_file(&display_path(&files[0])));
        assert!(!recent.has_file(&display_path(&files[1])));
        assert!(
            !recent.has_file(&display_path(&folders[0])),
            "a folder is not a file entry"
        );
        assert!(recent.has_folder(&display_path(&folders[0])));
        assert!(!recent.has_folder(&display_path(&folders[1])));
    }

    #[test]
    fn recent_list_refuses_a_path_it_does_not_hold_and_grants_one_it_does() {
        let dir = temp();
        let (files, _) = make(&dir, 2);
        let recent = store(&dir);
        let state = AppState::new(false);
        recent.record_file(&files[0]).expect("recorded");
        let error = grant_file(&state, &recent, &display_path(&files[1])).expect_err("refused");
        assert_eq!(error.kind(), "not-allowed");
        assert!(
            state.access().check(&files[1]).is_err(),
            "nothing was granted"
        );
        // The page cannot make a path acceptable by spelling it differently either.
        let dotted = dir.path.join(".").join("file-1.md");
        assert!(grant_file(&state, &recent, &display_path(&dotted)).is_err());
        let shown = grant_file(&state, &recent, &display_path(&files[0])).expect("granted");
        assert_eq!(shown, display_path(&files[0]));
        assert!(state.access().check(&files[0]).is_ok());
    }

    #[test]
    fn recent_list_starts_empty_from_a_damaged_or_foreign_file() {
        let dir = temp();
        let recent = store(&dir);
        std::fs::create_dir_all(dir.path.join("data")).expect("made");
        std::fs::write(recent.file(), b"{ not json").expect("written");
        assert_eq!(recent.list(), Lists::default());
        // The file it names exists, so only the version can make the list empty.
        let (files, _) = make(&dir, 1);
        let foreign = serde_json::json!({
            "version": 99,
            "files": [display_path(&files[0])],
            "folders": [],
        });
        std::fs::write(recent.file(), foreign.to_string()).expect("written");
        assert_eq!(recent.list(), Lists::default());
        // A change after that writes a fresh, valid file.
        recent.record_file(&files[0]).expect("recorded");
        assert_eq!(recent.list().files, [display_path(&files[0])]);
    }

    #[test]
    fn recent_list_holds_the_limits_even_when_the_file_holds_more() {
        let dir = temp();
        let recent = store(&dir);
        std::fs::create_dir_all(dir.path.join("data")).expect("made");
        let many: Vec<String> = (0..40).map(|n| format!("C:/nowhere/{n}.md")).collect();
        let body = serde_json::json!({ "version": 1, "files": many, "folders": many });
        std::fs::write(recent.file(), body.to_string()).expect("written");
        let lists = recent.read();
        assert_eq!(
            (lists.files.len(), lists.folders.len()),
            (MAX_FILES, MAX_FOLDERS)
        );
    }
}
