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

use super::{Sink, lock, run};
use crate::error::AppError;
use crate::fs::atomic;
use crate::images::reserved_name;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

/// The folder's name inside the data folder.
pub(crate) const FOLDER: &str = "themes";

/// The one extension a theme file has.
const EXTENSION: &str = ".json";

/// A bigger file is not a theme. The page is told, and the file is not read.
pub(crate) const MAX_BYTES: u64 = 256 * 1024;

/// The most files listed; the rest, by name, are left out.
pub(crate) const MAX_FILES: usize = 200;

/// The longest theme name, in characters.
const MAX_NAME: usize = 64;

/// A theme name: the file's name without `.json`, or why it is refused. Letters, digits, spaces and
/// `_ - .` only (so it is a real file name on every system and never a path), at most 64
/// characters, no space or dot at either end, no `..`, and not a name Windows keeps for a device.
pub(crate) fn clean_name(raw: &str) -> Result<(), &'static str> {
    if raw.is_empty() {
        return Err("Name a theme.");
    }
    if raw.chars().count() > MAX_NAME {
        return Err("Use at most 64 characters.");
    }
    if !raw
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.'))
    {
        return Err("Use letters, digits, spaces and - _ . only.");
    }
    if raw.starts_with([' ', '.']) || raw.ends_with([' ', '.']) {
        return Err("A name cannot start or end with a space or a dot.");
    }
    if raw.contains("..") {
        return Err("A name cannot hold two dots in a row.");
    }
    if reserved_name(raw) {
        return Err("That is a name Windows keeps.");
    }
    Ok(())
}

/// One file in the folder, as the page gets it: its name, and its text or why it has none.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeEntry {
    pub(crate) name: String,
    pub(crate) text: Option<String>,
    pub(crate) error: Option<String>,
}

/// The theme files of the data folder, and who hears about changes to them.
pub(crate) struct ThemeStore {
    /// The data folder; the themes are in its `themes` folder.
    dir: PathBuf,
    sink: Arc<Mutex<Option<Sink>>>,
    /// Kept alive so the watch lasts as long as the app.
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl std::fmt::Debug for ThemeStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ThemeStore")
    }
}

impl ThemeStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            sink: Arc::new(Mutex::new(None)),
            watcher: Mutex::new(None),
        }
    }

    /// Where the themes are, whether or not the folder exists yet.
    pub(crate) fn folder(&self) -> PathBuf {
        self.dir.join(FOLDER)
    }

    fn file(&self, name: &str) -> Result<PathBuf, AppError> {
        clean_name(name).map_err(|why| AppError::Invalid(format!("theme name: {why}")))?;
        Ok(self.folder().join(format!("{name}{EXTENSION}")))
    }

    /// Makes the folder when it is missing and says where it is.
    pub(crate) fn ensure_folder(&self) -> Result<PathBuf, AppError> {
        let folder = self.folder();
        std::fs::create_dir_all(&folder)?;
        Ok(folder)
    }

    /// Every plain `*.json` file directly in the folder, by name, with its text or the reason it
    /// has none. A missing folder is an empty list.
    pub(crate) fn list(&self) -> Result<Vec<ThemeEntry>, AppError> {
        let reader = match std::fs::read_dir(self.folder()) {
            Ok(reader) => reader,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut found: Vec<(String, PathBuf)> = Vec::new();
        for entry in reader {
            let Ok(entry) = entry else { continue };
            // `file_type` does not follow a link, so a link to a file is not a plain file here.
            if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Some(stem) = file_name.strip_suffix(EXTENSION) else {
                continue;
            };
            found.push((stem.to_owned(), entry.path()));
        }
        Ok(in_order(found)
            .into_iter()
            .map(|(name, path)| {
                let outcome = match clean_name(&name) {
                    Err(why) => Err(why.to_owned()),
                    Ok(()) => read_plain(&path),
                };
                match outcome {
                    Ok(text) => ThemeEntry {
                        name,
                        text: Some(text),
                        error: None,
                    },
                    Err(error) => ThemeEntry {
                        name,
                        text: None,
                        error: Some(error),
                    },
                }
            })
            .collect())
    }

    /// The text of one theme file, or None when it is not there. A refused name is an error; a file
    /// that is not a plain file, is too big or is not UTF-8 text is an error too, never a guess.
    pub(crate) fn read(&self, name: &str) -> Result<Option<String>, AppError> {
        let path = self.file(name)?;
        match std::fs::symlink_metadata(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        read_plain(&path).map(Some).map_err(AppError::Invalid)
    }

    /// Writes one theme file, atomically. With `create` it makes a new file and refuses if one is
    /// there already (a link or folder of that name counts); without it, it replaces a plain file
    /// that exists and refuses otherwise, so a write never creates a file by accident and never
    /// writes through a link.
    pub(crate) fn write(&self, name: &str, text: &str, create: bool) -> Result<(), AppError> {
        let path = self.file(name)?;
        if text.len() as u64 > MAX_BYTES {
            return Err(AppError::Invalid(format!(
                "{name}.json would be larger than 256 KB"
            )));
        }
        match (std::fs::symlink_metadata(&path), create) {
            (Ok(_), true) => return Err(AppError::Exists(format!("{name}.json"))),
            (Ok(meta), false) if !meta.is_file() => {
                return Err(AppError::NotAllowed(format!(
                    "{name}.json, not a plain file"
                )));
            }
            (Ok(_), false) => {}
            (Err(error), _) if error.kind() == std::io::ErrorKind::NotFound => {
                if !create {
                    return Err(error.into());
                }
            }
            (Err(error), _) => return Err(error.into()),
        }
        std::fs::create_dir_all(self.folder())?;
        atomic::write_atomic_with(&path, text.as_bytes(), |_| Ok(())).map_err(|error| match error {
            AppError::FileReadOnly => {
                std::io::Error::from(std::io::ErrorKind::PermissionDenied).into()
            }
            other => other,
        })
    }

    /// Tells `sink` each time a theme file is added, changed or removed, whoever did it, the app's
    /// own writes included (the page compares text). The folder is made first, since a missing
    /// folder cannot be watched. A second call replaces the sink.
    pub(crate) fn watch(&self, sink: Sink) -> Result<(), AppError> {
        *lock(&self.sink) = Some(sink);
        let mut watcher = lock(&self.watcher);
        if watcher.is_some() {
            return Ok(());
        }
        let folder = self.ensure_folder()?;
        let (tx, rx) = mpsc::channel();
        let mut made =
            notify::recommended_watcher(tx).map_err(|error| AppError::Watch(error.to_string()))?;
        made.watch(&folder, RecursiveMode::NonRecursive)
            .map_err(|error| AppError::Watch(error.to_string()))?;
        let sink = Arc::clone(&self.sink);
        std::thread::Builder::new()
            .name("mdmate-themes-watch".into())
            .spawn(move || run(&rx, &sink, theme_event))
            .map_err(|error| AppError::Watch(error.to_string()))?;
        *watcher = Some(made);
        Ok(())
    }
}

/// The files by name with case ignored, and no more than `MAX_FILES` of them: the same list on
/// every file system, whatever order the system hands them over in.
fn in_order(mut found: Vec<(String, PathBuf)>) -> Vec<(String, PathBuf)> {
    found.sort_by_key(|(name, _)| name.to_lowercase());
    found.truncate(MAX_FILES);
    found
}

/// The text of a plain file, or the reason it is not usable.
fn read_plain(path: &Path) -> Result<String, String> {
    let meta =
        std::fs::symlink_metadata(path).map_err(|error| crate::error::friendly_io(&error))?;
    if !meta.is_file() {
        return Err("it is not a plain file".into());
    }
    if meta.len() > MAX_BYTES {
        return Err("it is larger than 256 KB".into());
    }
    let bytes = std::fs::read(path).map_err(|error| crate::error::friendly_io(&error))?;
    String::from_utf8(bytes).map_err(|_| "it is not UTF-8 text".into())
}

/// Whether a file-system event can change the themes: a change to a `.json` name (a temp file that
/// saved it has another name and is not one), or a signal that events were lost. A read is not.
fn theme_event(event: &notify::Event) -> bool {
    event.need_rescan()
        || (!matches!(event.kind, EventKind::Access(_))
            && event.paths.iter().any(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(EXTENSION))
            }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
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
}
