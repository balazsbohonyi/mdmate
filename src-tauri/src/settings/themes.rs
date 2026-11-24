//! User theme files: `themes/<name>.json` in the app data folder.
//!
//! Rust keeps the files and nothing about what is in them: it lists them, reads and writes their
//! text, says when the folder changes, and shows the folder. The page decides what a file means,
//! through one validator, and only values that pass it reach the window's styles. No call takes a
//! path: a theme is named by its plain name, checked here with the same rules the page uses
//! (`tests/data/theme-names.json` holds the cases both read), and the folder is always the one in
//! the data folder, so nothing in an opened workspace can supply a theme file.
//!
//! Limits: a file over [`MAX_BYTES`] is not read, and only the first [`MAX_FILES`] files (by name)
//! are listed. A directory, a link or anything but a plain file is skipped and never followed.

use super::Sink;
#[cfg(test)]
use super::folder_store;
use super::folder_store::{FolderEntry, JsonFolderStore};
use crate::error::AppError;
use std::path::{Path, PathBuf};

/// The folder's name inside the data folder.
pub(crate) const FOLDER: &str = "themes";

/// A bigger file is not a theme. The page is told, and the file is not read.
#[cfg(test)]
pub(crate) const MAX_BYTES: u64 = folder_store::MAX_BYTES;

/// The most files listed; the rest, by name, are left out.
#[cfg(test)]
pub(crate) const MAX_FILES: usize = folder_store::MAX_FILES;

/// A theme name: the file's name without `.json`, or why it is refused.
#[cfg(test)]
pub(crate) fn clean_name(raw: &str) -> Result<(), &'static str> {
    folder_store::clean_name(raw, "Name a theme.")
}

/// One file in the folder, as the page gets it: its name, and its text or why it has none.
pub(crate) type ThemeEntry = FolderEntry;

/// The theme files of the data folder, and who hears about changes to them.
#[derive(Debug)]
pub(crate) struct ThemeStore(JsonFolderStore);

impl ThemeStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self(JsonFolderStore::new(
            dir,
            FOLDER,
            "theme",
            "Name a theme.",
            "mdmate-themes-watch",
        ))
    }

    /// Where the themes are, whether or not the folder exists yet.
    #[cfg(test)]
    pub(crate) fn folder(&self) -> PathBuf {
        self.0.folder()
    }

    /// Makes the folder when it is missing and says where it is.
    pub(crate) fn ensure_folder(&self) -> Result<PathBuf, AppError> {
        self.0.ensure_folder()
    }

    /// Every plain `*.json` file directly in the folder, by name, with its text or the reason it
    /// has none. A missing folder is an empty list.
    pub(crate) fn list(&self) -> Result<Vec<ThemeEntry>, AppError> {
        self.0.list()
    }

    /// The text of one theme file, or None when it is not there.
    pub(crate) fn read(&self, name: &str) -> Result<Option<String>, AppError> {
        self.0.read(name)
    }

    /// Writes one theme file, atomically.
    pub(crate) fn write(&self, name: &str, text: &str, create: bool) -> Result<(), AppError> {
        self.0.write(name, text, create)
    }

    /// Gives a theme file another name.
    pub(crate) fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.0.rename(from, to)
    }

    /// Takes a theme file out of the folder by handing it to `trash`.
    pub(crate) fn delete(
        &self,
        name: &str,
        trash: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
        self.0.delete(name, trash)
    }

    /// Tells `sink` each time a theme file is added, changed or removed.
    pub(crate) fn watch(&self, sink: Sink) -> Result<(), AppError> {
        self.0.watch(sink)
    }
}

#[cfg(test)]
mod tests {
    use super::folder_store::in_order;
    use super::*;
    use serde::Deserialize;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    fn store() -> (tempfile::TempDir, ThemeStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = ThemeStore::new(dir.path().join("data"));
        (dir, store)
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        ok: bool,
    }

    #[test]
    fn theme_names_follow_the_cases_the_page_reads_too() {
        let text = include_str!("../../../tests/data/theme-names.json");
        let cases: Vec<Case> = serde_json::from_str(text).expect("the cases parse");
        assert!(cases.len() > 30, "the shared list has been emptied");
        for case in cases {
            assert_eq!(
                clean_name(&case.name).is_ok(),
                case.ok,
                "{:?} should be {}",
                case.name,
                if case.ok { "allowed" } else { "refused" }
            );
        }
    }

    #[test]
    fn a_missing_folder_lists_nothing_and_ensure_folder_makes_it() {
        let (_dir, store) = store();
        assert!(store.list().expect("listed").is_empty());
        let folder = store.ensure_folder().expect("made");
        assert!(folder.is_dir());
        assert_eq!(folder, store.folder());
        assert!(store.list().expect("listed").is_empty());
    }

    #[test]
    fn a_created_file_reads_back_and_is_listed_with_its_text() {
        let (_dir, store) = store();
        store
            .write("Night owl", "{\"base\": \"dark\"}", true)
            .expect("created");
        assert_eq!(
            store.read("Night owl").expect("read").as_deref(),
            Some("{\"base\": \"dark\"}")
        );
        let listed = store.list().expect("listed");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Night owl");
        assert_eq!(listed[0].text.as_deref(), Some("{\"base\": \"dark\"}"));
        assert_eq!(listed[0].error, None);
        assert_eq!(store.read("nobody").expect("read"), None);
    }

    #[test]
    fn a_create_never_replaces_a_file_and_a_write_never_makes_one() {
        let (_dir, store) = store();
        store.write("a", "{\"v\": 1}", true).expect("created");
        let again = store.write("a", "{\"v\": 2}", true).expect_err("refused");
        assert_eq!(again.kind(), "exists");
        assert_eq!(
            store.read("a").expect("read").as_deref(),
            Some("{\"v\": 1}")
        );
        store.write("a", "{\"v\": 3}", false).expect("replaced");
        assert_eq!(
            store.read("a").expect("read").as_deref(),
            Some("{\"v\": 3}")
        );
        let missing = store.write("b", "{}", false).expect_err("refused");
        assert_eq!(missing.kind(), "not-found");
        assert_eq!(store.read("b").expect("read"), None);
        // Writing leaves no temp file in the folder.
        let names: Vec<String> = std::fs::read_dir(store.folder())
            .expect("listed")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, ["a.json"]);
    }

    #[test]
    fn a_name_that_is_not_a_plain_name_is_refused_everywhere() {
        let (_dir, store) = store();
        for name in [
            "..", "../x", "a/b", "a\\b", "C:x", "con", "x.", " x", "a..b", "",
        ] {
            assert_eq!(
                store.read(name).expect_err("read refused").kind(),
                "invalid",
                "read {name:?}"
            );
            assert_eq!(
                store
                    .write(name, "{}", true)
                    .expect_err("write refused")
                    .kind(),
                "invalid",
                "write {name:?}"
            );
        }
        // Nothing was made, not even the folder, by a refused name.
        assert!(!store.folder().exists());
    }

    #[test]
    fn a_big_file_is_listed_with_a_reason_and_not_read_or_written() {
        let (_dir, store) = store();
        let folder = store.ensure_folder().expect("made");
        std::fs::write(folder.join("big.json"), vec![b' '; MAX_BYTES as usize + 1]).expect("big");
        std::fs::write(folder.join("bytes.json"), [0xff, 0xfe, 0x00]).expect("not utf-8");
        let listed = store.list().expect("listed");
        let big = listed.iter().find(|e| e.name == "big").expect("big listed");
        assert_eq!(big.text, None);
        assert!(big.error.as_deref().is_some_and(|e| e.contains("256 KB")));
        let bytes = listed.iter().find(|e| e.name == "bytes").expect("listed");
        assert!(bytes.error.as_deref().is_some_and(|e| e.contains("UTF-8")));
        assert_eq!(store.read("big").expect_err("refused").kind(), "invalid");
        let long = " ".repeat(MAX_BYTES as usize + 1);
        assert_eq!(
            store
                .write("big2", &long, true)
                .expect_err("refused")
                .kind(),
            "invalid"
        );
    }

    #[test]
    fn only_plain_json_files_in_the_folder_are_listed() {
        let (_dir, store) = store();
        let folder = store.ensure_folder().expect("made");
        std::fs::write(folder.join("ok.json"), "{}").expect("ok");
        std::fs::write(folder.join("notes.txt"), "x").expect("other extension");
        std::fs::write(folder.join("UPPER.JSON"), "{}").expect("other case of the extension");
        std::fs::create_dir(folder.join("dir.json")).expect("a directory with the name");
        std::fs::create_dir(folder.join("nested")).expect("nested");
        std::fs::write(folder.join("nested").join("deep.json"), "{}").expect("deep");
        std::fs::write(folder.join("bad..name.json"), "{}").expect("a refused name");
        // A theme file outside the folder, in the data folder itself, is never looked at.
        std::fs::write(folder.parent().expect("data").join("outside.json"), "{}").expect("outside");
        let listed = store.list().expect("listed");
        let names: Vec<&str> = listed.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["bad..name", "ok"]);
        assert!(listed[0].text.is_none() && listed[0].error.is_some());
        assert_eq!(listed[1].text.as_deref(), Some("{}"));
    }

    #[test]
    fn a_directory_named_like_a_theme_is_neither_read_nor_written() {
        let (_dir, store) = store();
        let folder = store.ensure_folder().expect("made");
        std::fs::create_dir(folder.join("x.json")).expect("dir");
        assert_eq!(
            store.write("x", "{}", true).expect_err("exists").kind(),
            "exists"
        );
        assert_eq!(
            store.write("x", "{}", false).expect_err("refused").kind(),
            "not-allowed"
        );
        assert_eq!(store.read("x").expect_err("not a file").kind(), "invalid");
    }

    #[test]
    fn files_are_put_in_name_order_with_case_ignored_and_cut_at_the_cap() {
        let named = |names: &[&str]| -> Vec<(String, PathBuf)> {
            names
                .iter()
                .map(|name| ((*name).to_owned(), PathBuf::from(name)))
                .collect()
        };
        let names = |list: Vec<(String, PathBuf)>| -> Vec<String> {
            list.into_iter().map(|(name, _)| name).collect()
        };
        assert_eq!(
            names(in_order(named(&["c", "B2", "a", "b", "A2"]))),
            ["a", "A2", "b", "B2", "c"]
        );
        let many: Vec<String> = (0..MAX_FILES + 3)
            .map(|i| format!("t{i:03}"))
            .rev()
            .collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        let kept = names(in_order(named(&refs)));
        assert_eq!(kept.len(), MAX_FILES);
        assert_eq!(kept[0], "t000");
        assert_eq!(kept[MAX_FILES - 1], format!("t{:03}", MAX_FILES - 1));
    }

    #[test]
    fn the_list_stops_at_the_cap_and_is_sorted_by_name() {
        let (_dir, store) = store();
        let folder = store.ensure_folder().expect("made");
        for i in 0..MAX_FILES + 5 {
            std::fs::write(folder.join(format!("t{i:03}.json")), "{}").expect("file");
        }
        let listed = store.list().expect("listed");
        assert_eq!(listed.len(), MAX_FILES);
        assert_eq!(listed[0].name, "t000");
        assert_eq!(listed[MAX_FILES - 1].name, format!("t{:03}", MAX_FILES - 1));
    }

    #[test]
    fn a_link_is_not_a_plain_file_and_is_never_followed() {
        let (dir, store) = store();
        let folder = store.ensure_folder().expect("made");
        let target = dir.path().join("secret.json");
        std::fs::write(&target, "{\"secret\": true}").expect("target");
        // A symbolic link needs a privilege on Windows; without it the check cannot be made.
        #[allow(deprecated)] // soft_link is the one call that makes a file link on every OS
        let linked = std::fs::soft_link(&target, folder.join("link.json"));
        if linked.is_err() {
            eprintln!("link test skipped: this account cannot make a symbolic link");
            return;
        }
        assert!(
            store.list().expect("listed").is_empty(),
            "a link is skipped"
        );
        assert_eq!(store.read("link").expect_err("refused").kind(), "invalid");
        assert_eq!(
            store
                .write("link", "{}", false)
                .expect_err("refused")
                .kind(),
            "not-allowed"
        );
        assert_eq!(
            store.write("link", "{}", true).expect_err("exists").kind(),
            "exists"
        );
        assert_eq!(
            std::fs::read_to_string(&target).expect("target"),
            "{\"secret\": true}"
        );
    }

    #[test]
    fn a_change_to_a_theme_file_is_heard_and_one_to_a_neighbour_is_not() {
        let (_dir, store) = store();
        let heard = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&heard);
        store
            .watch(Box::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
            }))
            .expect("watching");
        std::fs::write(store.folder().join("notes.txt"), b"x").expect("a neighbour");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(
            heard.load(Ordering::SeqCst),
            0,
            "a text file is not a theme"
        );
        store.write("a", "{}", true).expect("created");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(heard.load(Ordering::SeqCst), 1, "one save is one report");
        std::fs::remove_file(store.folder().join("a.json")).expect("removed");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(heard.load(Ordering::SeqCst), 2, "a removal is heard too");
    }

    #[test]
    fn a_rename_moves_the_file_and_never_replaces_another() {
        let (_dir, store) = store();
        store.write("old", "{\"a\": 1}", true).expect("created");
        store.write("taken", "{\"b\": 2}", true).expect("created");
        store.rename("old", "new name").expect("renamed");
        assert_eq!(store.read("old").expect("read"), None);
        assert_eq!(
            store.read("new name").expect("read").as_deref(),
            Some("{\"a\": 1}")
        );
        let error = store
            .rename("new name", "taken")
            .expect_err("target exists");
        assert_eq!(error.kind(), "exists");
        assert_eq!(
            store.read("taken").expect("read").as_deref(),
            Some("{\"b\": 2}"),
            "the other theme is untouched"
        );
        assert!(
            store.read("new name").expect("read").is_some(),
            "and so is the source"
        );
    }

    #[test]
    fn a_rename_checks_both_names_and_the_source() {
        let (_dir, store) = store();
        store.write("a", "{}", true).expect("created");
        for bad in ["", "../x", "a/b", "con", " lead", "x..y"] {
            assert_eq!(
                store.rename("a", bad).expect_err("bad target").kind(),
                "invalid",
                "{bad:?}"
            );
            assert_eq!(
                store.rename(bad, "b").expect_err("bad source").kind(),
                "invalid",
                "{bad:?}"
            );
        }
        assert_eq!(
            store.rename("ghost", "b").expect_err("no such file").kind(),
            "not-found"
        );
        assert!(store.read("a").expect("read").is_some());
        // A folder named like a theme file is not a theme: it is never moved.
        std::fs::create_dir_all(store.folder().join("dir.json")).expect("a folder");
        assert_eq!(
            store.rename("dir", "moved").expect_err("folder").kind(),
            "not-allowed"
        );
        assert!(store.folder().join("dir.json").is_dir());
        assert!(!store.folder().join("moved.json").exists());
    }

    #[test]
    fn a_rename_to_the_same_name_changes_nothing_and_a_case_change_is_allowed() {
        let (_dir, store) = store();
        store.write("night", "{}", true).expect("created");
        store.rename("night", "night").expect("same name");
        store.rename("night", "Night").expect("case only");
        let names: Vec<String> = store
            .list()
            .expect("listed")
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, ["Night"]);
    }

    #[test]
    fn a_delete_hands_the_file_to_the_bin_and_a_failed_bin_leaves_it() {
        let (_dir, store) = store();
        store.write("gone", "{}", true).expect("created");
        let mut handed = None;
        store
            .delete("gone", |path| {
                handed = Some(path.to_path_buf());
                std::fs::remove_file(path)
            })
            .expect("deleted");
        assert_eq!(handed, Some(store.folder().join("gone.json")));
        assert_eq!(store.read("gone").expect("read"), None);

        store.write("stays", "{}", true).expect("created");
        let error = store
            .delete("stays", |_| {
                Err(std::io::Error::other("no recycle bin on this drive"))
            })
            .expect_err("the bin failed");
        assert!(!error.to_string().is_empty());
        assert!(
            store.read("stays").expect("read").is_some(),
            "the file stays"
        );
    }

    #[test]
    fn a_delete_refuses_a_bad_name_a_missing_file_and_a_folder() {
        let (_dir, store) = store();
        let never = |_: &Path| -> std::io::Result<()> { panic!("must not be called") };
        assert_eq!(
            store.delete("../x", never).expect_err("bad").kind(),
            "invalid"
        );
        assert_eq!(
            store.delete("ghost", never).expect_err("missing").kind(),
            "not-found"
        );
        std::fs::create_dir_all(store.folder().join("dir.json")).expect("a folder");
        assert_eq!(
            store.delete("dir", never).expect_err("folder").kind(),
            "not-allowed"
        );
    }
}
