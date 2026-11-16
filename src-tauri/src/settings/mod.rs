//! `settings.json`: the file that holds what the user changed, in the app data folder.
//!
//! Rust keeps the file and nothing else about it: it reads and writes the text, writes it
//! atomically, says when another program changed it, and hands the page the one file it may open as
//! a tab. What the text means is the page's to decide, through one validator. The few values Rust
//! acts on by itself reach it from the page after that check, and `runtime` checks the ones that
//! guard something again. The file is read from the data folder only: no call takes a path, so
//! nothing in an opened workspace can stand in for it.
//!
//! Until the page can name the environment variable's value itself, what a rename does about links
//! can also come from `MDMATE_LINKS_ON_RENAME`, which wins over the file for that run.

pub(crate) mod runtime;
pub(crate) mod themes;

use crate::error::AppError;
use crate::fs::atomic;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// The file's name inside the data folder.
pub(crate) const FILE: &str = "settings.json";

/// The shortcuts file's name inside the data folder. It is kept by the same code as the settings
/// file, under a name fixed here, so the page names no path for either.
pub(crate) const KEYBINDINGS_FILE: &str = "keybindings.json";

/// What a new file holds, so an opened `settings.json` is a valid object to type into.
const EMPTY: &str = "{}\n";

/// A bigger file is not a settings file. The page refuses it before it reads.
const MAX_BYTES: usize = 1024 * 1024;

/// How long the file must stay quiet before the page is told. One save raises several events.
const QUIET: Duration = Duration::from_millis(100);

/// Names what a rename or move does about the links that point at the file: `ask`, `update` or
/// `never`. A launch-time override for tests and one-off runs: while it holds one of the three
/// values it wins over the file, and the page locks the row.
pub(crate) const LINKS_ON_RENAME_ENV: &str = "MDMATE_LINKS_ON_RENAME";

/// The value of [`LINKS_ON_RENAME_ENV`] when it is one of the three, spaces and case aside. Anything
/// else, including nothing, is None and the file's value (or the default, `never`) stands.
pub(crate) fn links_on_rename(value: Option<OsString>) -> Option<&'static str> {
    let value = value?;
    match value.to_str()?.trim().to_ascii_lowercase().as_str() {
        "ask" => Some("ask"),
        "update" => Some("update"),
        "never" => Some("never"),
        _ => None,
    }
}

/// [`links_on_rename`] with the value read from the environment.
pub(crate) fn links_on_rename_from_env() -> Option<&'static str> {
    links_on_rename(std::env::var_os(LINKS_ON_RENAME_ENV))
}

pub(super) type Sink = Box<dyn Fn() + Send + Sync>;

/// The settings file in the data folder, and who hears about changes to it.
pub(crate) struct SettingsStore {
    dir: PathBuf,
    /// The file's name inside `dir`: one of the two constants above, never from the page.
    name: &'static str,
    sink: Arc<Mutex<Option<Sink>>>,
    /// Kept alive so the watch lasts as long as the app.
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl std::fmt::Debug for SettingsStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SettingsStore")
    }
}

pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The shortcuts file: the same store as the settings file, a second managed value so each
/// command asks for its own.
pub(crate) struct KeybindingsStore(SettingsStore);

impl KeybindingsStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self(SettingsStore::named(dir, KEYBINDINGS_FILE))
    }
}

impl std::ops::Deref for KeybindingsStore {
    type Target = SettingsStore;
    fn deref(&self) -> &SettingsStore {
        &self.0
    }
}

impl std::fmt::Debug for KeybindingsStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("KeybindingsStore")
    }
}

impl SettingsStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self::named(dir, FILE)
    }

    fn named(dir: PathBuf, name: &'static str) -> Self {
        Self {
            dir,
            name,
            sink: Arc::new(Mutex::new(None)),
            watcher: Mutex::new(None),
        }
    }

    /// Where the file is, whether or not it exists yet.
    pub(crate) fn file(&self) -> PathBuf {
        self.dir.join(self.name)
    }

    /// The file's text, or None when there is no file yet. Text that is not UTF-8 is an error the
    /// page shows, never a lossy guess.
    pub(crate) fn read(&self) -> Result<Option<String>, AppError> {
        let bytes = match std::fs::read(self.file()) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if bytes.len() > MAX_BYTES {
            return Err(AppError::Invalid(format!(
                "{} is larger than 1 MB",
                self.name
            )));
        }
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| AppError::Invalid(format!("{} is not UTF-8 text", self.name)))
    }

    /// Replaces the file with `text`, atomically: the old file stays whole until the new one is
    /// completely written. Makes the data folder first when this is the first write.
    pub(crate) fn write(&self, text: &str) -> Result<(), AppError> {
        if text.len() > MAX_BYTES {
            return Err(AppError::Invalid(format!(
                "{} would be larger than 1 MB",
                self.name
            )));
        }
        std::fs::create_dir_all(&self.dir)?;
        atomic::write_atomic_with(&self.file(), text.as_bytes(), |_| Ok(())).map_err(|error| {
            // The save path's "use Save As" advice means nothing here: say it is a permission.
            match error {
                AppError::FileReadOnly => {
                    std::io::Error::from(std::io::ErrorKind::PermissionDenied).into()
                }
                other => other,
            }
        })
    }

    /// Makes the file when it is missing, so the page can open it, and says where it is.
    pub(crate) fn ensure_file(&self) -> Result<PathBuf, AppError> {
        std::fs::create_dir_all(&self.dir)?;
        let file = self.file();
        if !file.exists() {
            atomic::write_atomic_with(&file, EMPTY.as_bytes(), |_| Ok(()))?;
        }
        Ok(file)
    }

    /// Tells `sink` each time the file changes, whoever changed it, the app's own writes included
    /// (the page compares text and ignores one it already holds). A second call replaces the sink.
    pub(crate) fn watch(&self, sink: Sink) -> Result<(), AppError> {
        *lock(&self.sink) = Some(sink);
        let mut watcher = lock(&self.watcher);
        if watcher.is_some() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.dir)?;
        let (tx, rx) = mpsc::channel();
        let mut made =
            notify::recommended_watcher(tx).map_err(|error| AppError::Watch(error.to_string()))?;
        // The folder, not the file: a program that saves by replacing the file would otherwise end
        // the watch on some systems (the same reason `workspace/watch.rs` watches folders).
        made.watch(&self.dir, RecursiveMode::NonRecursive)
            .map_err(|error| AppError::Watch(error.to_string()))?;
        let (sink, name) = (Arc::clone(&self.sink), self.name);
        std::thread::Builder::new()
            .name("mdmate-settings-watch".into())
            .spawn(move || run(&rx, &sink, |event| about_event(event, name)))
            .map_err(|error| AppError::Watch(error.to_string()))?;
        *watcher = Some(made);
        Ok(())
    }
}

/// Whether an event is about the settings file itself: its name, whatever temp file saved it.
fn about(path: &Path, name: &str) -> bool {
    path.file_name().is_some_and(|found| found == name)
}

/// Whether an event concerns the named file, or says events were lost. A read does not count.
fn about_event(event: &notify::Event, name: &str) -> bool {
    event.need_rescan()
        || (!matches!(event.kind, EventKind::Access(_))
            && event.paths.iter().any(|path| about(path, name)))
}

/// The watcher thread: waits for the files to go quiet, then tells the sink once. `relevant` says
/// whether an event is about a file this watch is for. Shared with the theme files' watcher.
pub(super) fn run(
    rx: &mpsc::Receiver<notify::Result<notify::Event>>,
    sink: &Mutex<Option<Sink>>,
    relevant: impl Fn(&notify::Event) -> bool,
) {
    let mut due: Option<Instant> = None;
    loop {
        let message = match due {
            Some(when) => rx.recv_timeout(when.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match message {
            Ok(Ok(event)) => {
                if relevant(&event) {
                    due = Some(Instant::now() + QUIET);
                }
            }
            Ok(Err(_)) => due = Some(Instant::now() + QUIET),
            Err(RecvTimeoutError::Timeout) => {
                due = None;
                if let Some(sink) = lock(sink).as_ref() {
                    sink();
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn read(value: &str) -> Option<&'static str> {
        links_on_rename(Some(value.into()))
    }

    fn store() -> (tempfile::TempDir, SettingsStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = SettingsStore::new(dir.path().join("data"));
        (dir, store)
    }

    #[test]
    fn the_three_values_are_read_whatever_the_case_and_spaces() {
        assert_eq!(read("ask"), Some("ask"));
        assert_eq!(read("UPDATE"), Some("update"));
        assert_eq!(read("  Never \r\n"), Some("never"));
    }

    #[test]
    fn nothing_empty_or_unknown_is_left_to_the_file_and_the_default() {
        assert_eq!(links_on_rename(None), None);
        assert_eq!(read(""), None);
        assert_eq!(read("   "), None);
        assert_eq!(read("always"), None);
        assert_eq!(read("true"), None);
        assert_eq!(read("ask update"), None);
    }

    #[test]
    fn a_missing_file_reads_as_nothing_and_a_written_one_reads_back_exactly() {
        let (_dir, store) = store();
        assert_eq!(store.read().expect("read"), None);
        let text = "{\n  \"fonts\": {\n    \"size\": 18\n  }\n}\n";
        store.write(text).expect("written");
        assert_eq!(store.read().expect("read").as_deref(), Some(text));
        // The data folder was made by the first write.
        assert!(store.file().is_file());
    }

    #[test]
    fn a_write_replaces_the_file_whole_and_leaves_no_temp_file_behind() {
        let (_dir, store) = store();
        store.write("{\"a\": 1}\n").expect("written");
        store.write("{}\n").expect("written again");
        assert_eq!(store.read().expect("read").as_deref(), Some("{}\n"));
        let names: Vec<String> = std::fs::read_dir(&store.dir)
            .expect("listed")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, [FILE]);
    }

    #[test]
    fn a_failed_write_keeps_the_old_file() {
        let (_dir, store) = store();
        store.write("{\"keep\": true}\n").expect("written");
        // A folder where the temp file must go is the easiest failure to cause: take the data
        // folder's place with a file, so the next write cannot create anything inside it.
        let moved = store.dir.with_file_name("data-moved");
        std::fs::rename(&store.dir, &moved).expect("moved away");
        std::fs::write(&store.dir, b"in the way").expect("a file in its place");
        assert!(store.write("{\"new\": true}\n").is_err());
        std::fs::remove_file(&store.dir).expect("cleared");
        std::fs::rename(&moved, &store.dir).expect("moved back");
        assert_eq!(
            store.read().expect("read").as_deref(),
            Some("{\"keep\": true}\n")
        );
    }

    #[test]
    fn a_read_only_file_stays_as_it_was_and_the_error_is_a_permission_not_save_as() {
        let (_dir, store) = store();
        store.write("{\"keep\": true}\n").expect("written");
        let mut permissions = std::fs::metadata(store.file()).expect("meta").permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(store.file(), permissions.clone()).expect("read-only");
        let error = store.write("{\"new\": true}\n").expect_err("refused");
        assert_eq!(error.kind(), "permission-denied");
        assert!(!error.to_string().contains("Save As"), "{error}");
        // Undoes the test's own read-only flag, which is the only reason the lint would fire here.
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(store.file(), permissions).expect("writable again");
        assert_eq!(
            store.read().expect("read").as_deref(),
            Some("{\"keep\": true}\n")
        );
    }

    #[test]
    fn a_file_that_is_not_utf8_or_is_too_big_is_refused_not_guessed() {
        let (_dir, store) = store();
        std::fs::create_dir_all(&store.dir).expect("made");
        std::fs::write(store.file(), [0xff, 0xfe, 0x00, 0x7b]).expect("written");
        assert_eq!(store.read().expect_err("refused").kind(), "invalid");
        std::fs::write(store.file(), vec![b' '; MAX_BYTES + 1]).expect("written");
        assert_eq!(store.read().expect_err("refused").kind(), "invalid");
        assert_eq!(
            store
                .write(&" ".repeat(MAX_BYTES + 1))
                .expect_err("refused")
                .kind(),
            "invalid"
        );
    }

    #[test]
    fn ensure_file_makes_an_empty_object_once_and_never_replaces_a_file() {
        let (_dir, store) = store();
        let path = store.ensure_file().expect("made");
        assert_eq!(std::fs::read_to_string(&path).expect("read"), EMPTY);
        store.write("{\"devtools\": true}\n").expect("written");
        store.ensure_file().expect("again");
        assert_eq!(
            store.read().expect("read").as_deref(),
            Some("{\"devtools\": true}\n")
        );
    }

    #[test]
    fn only_the_settings_file_counts_as_a_change() {
        assert!(about(Path::new("C:/data/settings.json"), FILE));
        assert!(!about(Path::new("C:/data/session.json"), FILE));
        assert!(!about(Path::new("C:/data/settings.json.tmp"), FILE));
        assert!(!about(
            Path::new("C:/data/.settings.json.mdmate-1-0.tmp"),
            FILE
        ));
    }

    #[test]
    fn a_change_to_the_file_is_heard_once_and_one_to_a_neighbour_is_not() {
        let (_dir, store) = store();
        let heard = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&heard);
        store
            .watch(Box::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
            }))
            .expect("watching");
        std::fs::write(store.dir.join("session.json"), b"{}").expect("a neighbour");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(
            heard.load(Ordering::SeqCst),
            0,
            "a neighbour is not the file"
        );
        store.write("{\"a\": 1}\n").expect("written");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(heard.load(Ordering::SeqCst), 1, "one save is one report");
    }

    #[test]
    fn the_shortcuts_file_is_its_own_file_and_each_store_hears_only_its_own() {
        let dir = tempfile::tempdir().expect("temp dir");
        let data = dir.path().join("data");
        let settings = SettingsStore::new(data.clone());
        let keys = KeybindingsStore::new(data.clone());
        assert_eq!(keys.file(), data.join("keybindings.json"));
        assert_eq!(settings.file(), data.join("settings.json"));

        settings
            .write(
                "{\"theme\": \"light\"}
",
            )
            .expect("settings written");
        keys.write(
            "{\"file.new\": null}
",
        )
        .expect("keys written");
        assert_eq!(
            settings.read().expect("read"),
            Some(
                "{\"theme\": \"light\"}
"
                .to_string()
            )
        );
        assert_eq!(
            keys.read().expect("read"),
            Some(
                "{\"file.new\": null}
"
                .to_string()
            )
        );

        let heard = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&heard);
        keys.watch(Box::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        }))
        .expect("watching");
        settings
            .write(
                "{}
",
            )
            .expect("settings again");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(
            heard.load(Ordering::SeqCst),
            0,
            "the settings file is not the shortcuts file"
        );
        keys.write(
            "{}
",
        )
        .expect("keys again");
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(heard.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_too_big_shortcuts_file_is_refused_by_its_own_name() {
        let dir = tempfile::tempdir().expect("temp dir");
        let keys = KeybindingsStore::new(dir.path().join("data"));
        let big = "x".repeat(MAX_BYTES + 1);
        let message = keys.write(&big).expect_err("too big").to_string();
        assert!(message.contains("keybindings.json"), "{message}");
    }
}
