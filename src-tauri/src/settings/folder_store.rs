//! Named JSON files in a fixed subfolder of the app data folder (e.g. `themes/` and
//! `font-presets/`).
//!
//! Rust keeps the files and nothing about what is in them: it lists them, reads and writes their
//! text atomically, renames them without replacing another file, moves them to the Recycle Bin,
//! watches the folder, and shows the folder in the file manager. No call takes a path: each entry
//! is named by its plain stem (checked by [`clean_name`]), and the folder is always fixed inside
//! the data folder, so nothing in an opened workspace can supply a file here.
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

/// The one extension entries have.
const EXTENSION: &str = ".json";

/// A bigger file is rejected before it is read.
pub(crate) const MAX_BYTES: u64 = 256 * 1024;

/// The most files listed; the rest, by name, are left out.
pub(crate) const MAX_FILES: usize = 200;

/// The longest entry name, in characters.
const MAX_NAME: usize = 64;

/// A plain file stem (without `.json`), or why it is refused. Letters, digits, spaces and `_ - .`
/// only (so it is a real file name on every system and never a path), at most 64 characters, no
/// space or dot at either end, no `..`, and not a name Windows keeps for a device.
pub(crate) fn clean_name(raw: &str, empty_message: &'static str) -> Result<(), &'static str> {
    if raw.is_empty() {
        return Err(empty_message);
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
pub(crate) struct FolderEntry {
    pub(crate) name: String,
    pub(crate) text: Option<String>,
    pub(crate) error: Option<String>,
}

/// A managed folder of `*.json` files inside the app data folder, with a live watcher.
pub(crate) struct JsonFolderStore {
    dir: PathBuf,
    folder_name: &'static str,
    noun: &'static str,
    empty_message: &'static str,
    thread_name: &'static str,
    sink: Arc<Mutex<Option<Sink>>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl std::fmt::Debug for JsonFolderStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JsonFolderStore")
            .field("folder", &self.folder_name)
            .finish()
    }
}

impl JsonFolderStore {
    pub(crate) fn new(
        dir: PathBuf,
        folder_name: &'static str,
        noun: &'static str,
        empty_message: &'static str,
        thread_name: &'static str,
    ) -> Self {
        Self {
            dir,
            folder_name,
            noun,
            empty_message,
            thread_name,
            sink: Arc::new(Mutex::new(None)),
            watcher: Mutex::new(None),
        }
    }

    /// Where the files live, whether or not the folder exists yet.
    pub(crate) fn folder(&self) -> PathBuf {
        self.dir.join(self.folder_name)
    }

    fn file(&self, name: &str) -> Result<PathBuf, AppError> {
        clean_name(name, self.empty_message)
            .map_err(|why| AppError::Invalid(format!("{} name: {why}", self.noun)))?;
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
    pub(crate) fn list(&self) -> Result<Vec<FolderEntry>, AppError> {
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
                let outcome = match clean_name(&name, self.empty_message) {
                    Err(why) => Err(why.to_owned()),
                    Ok(()) => read_plain(&path),
                };
                match outcome {
                    Ok(text) => FolderEntry {
                        name,
                        text: Some(text),
                        error: None,
                    },
                    Err(error) => FolderEntry {
                        name,
                        text: None,
                        error: Some(error),
                    },
                }
            })
            .collect())
    }

    /// The text of one file, or None when it is not there.
    pub(crate) fn read(&self, name: &str) -> Result<Option<String>, AppError> {
        let path = self.file(name)?;
        match std::fs::symlink_metadata(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        read_plain(&path).map(Some).map_err(AppError::Invalid)
    }

    /// Writes one file atomically. With `create` it makes a new file and refuses if one exists;
    /// without it, it replaces an existing plain file and refuses otherwise.
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

    /// Gives a file another name without replacing any other file.
    pub(crate) fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        let source = self.file(from)?;
        let target = self.file(to)?;
        match std::fs::symlink_metadata(&source) {
            Ok(meta) if meta.is_file() => {}
            Ok(_) => {
                return Err(AppError::NotAllowed(format!(
                    "{from}.json, not a plain file"
                )));
            }
            Err(error) => return Err(error.into()),
        }
        if from == to {
            return Ok(());
        }
        if std::fs::symlink_metadata(&target).is_ok() {
            let same_file = from.eq_ignore_ascii_case(to)
                && matches!(
                    (std::fs::canonicalize(&source), std::fs::canonicalize(&target)),
                    (Ok(a), Ok(b)) if a == b
                );
            if !same_file {
                return Err(AppError::Exists(format!("{to}.json")));
            }
        }
        std::fs::rename(&source, &target)?;
        Ok(())
    }

    /// Moves a plain file to the Recycle Bin via `trash`.
    pub(crate) fn delete(
        &self,
        name: &str,
        trash: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
        let path = self.file(name)?;
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() => {}
            Ok(_) => {
                return Err(AppError::NotAllowed(format!(
                    "{name}.json, not a plain file"
                )));
            }
            Err(error) => return Err(error.into()),
        }
        trash(&path)?;
        Ok(())
    }

    /// Tells `sink` each time a `.json` file in the folder is added, changed, or removed.
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
            .name(self.thread_name.into())
            .spawn(move || run(&rx, &sink, json_event))
            .map_err(|error| AppError::Watch(error.to_string()))?;
        *watcher = Some(made);
        Ok(())
    }
}

pub(super) fn in_order(mut found: Vec<(String, PathBuf)>) -> Vec<(String, PathBuf)> {
    found.sort_by_key(|(name, _)| name.to_lowercase());
    found.truncate(MAX_FILES);
    found
}

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

fn json_event(event: &notify::Event) -> bool {
    event.need_rescan()
        || (!matches!(event.kind, EventKind::Access(_))
            && event.paths.iter().any(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(EXTENSION))
            }))
}
