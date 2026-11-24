//! User font preset files: `font-presets/<name>.json` in the app data folder (P9.1-T40).
//!
//! Backed by [`JsonFolderStore`] with the same security model as [`super::themes::ThemeStore`]:
//! no path from the page, plain validated names, 256 KB & 200-file limits, plain files only,
//! atomic writes, Recycle Bin delete, live watcher, and open folder.

use super::Sink;
#[cfg(test)]
use super::folder_store;
use super::folder_store::{FolderEntry, JsonFolderStore};
use crate::error::AppError;
use std::path::{Path, PathBuf};

/// The folder's name inside the data folder.
pub(crate) const FOLDER: &str = "font-presets";

pub(crate) type FontPresetEntry = FolderEntry;

#[cfg(test)]
pub(crate) fn clean_name(raw: &str) -> Result<(), &'static str> {
    folder_store::clean_name(raw, "Name a font preset.")
}

#[derive(Debug)]
pub(crate) struct FontPresetStore(JsonFolderStore);

impl FontPresetStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self(JsonFolderStore::new(
            dir,
            FOLDER,
            "font preset",
            "Name a font preset.",
            "mdmate-font-presets-watch",
        ))
    }

    pub(crate) fn ensure_folder(&self) -> Result<PathBuf, AppError> {
        self.0.ensure_folder()
    }

    pub(crate) fn list(&self) -> Result<Vec<FontPresetEntry>, AppError> {
        self.0.list()
    }

    pub(crate) fn read(&self, name: &str) -> Result<Option<String>, AppError> {
        self.0.read(name)
    }

    pub(crate) fn write(&self, name: &str, text: &str, create: bool) -> Result<(), AppError> {
        self.0.write(name, text, create)
    }

    pub(crate) fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        self.0.rename(from, to)
    }

    pub(crate) fn delete(
        &self,
        name: &str,
        trash: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
        self.0.delete(name, trash)
    }

    pub(crate) fn watch(&self, sink: Sink) -> Result<(), AppError> {
        self.0.watch(sink)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::folder_store::{MAX_BYTES, MAX_FILES};
    use serde::Deserialize;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    fn store() -> (tempfile::TempDir, FontPresetStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = FontPresetStore::new(dir.path().join("data"));
        (dir, store)
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        ok: bool,
    }

    #[test]
    fn font_preset_names_follow_the_shared_name_cases() {
        let text = include_str!("../../../tests/data/theme-names.json");
        let cases: Vec<Case> = serde_json::from_str(text).expect("the cases parse");
        assert!(cases.len() > 30);
        for case in cases {
            assert_eq!(
                clean_name(&case.name).is_ok(),
                case.ok,
                "case {:?}",
                case.name
            );
        }
    }

    #[test]
    fn list_read_write_rename_and_delete_round_trip() {
        let (_dir, store) = store();
        assert_eq!(store.list().expect("empty list"), Vec::new());

        let body = r#"{"name":"Study","size":19}"#;
        store.write("Study", body, true).expect("create");
        assert!(matches!(
            store.write("Study", body, true),
            Err(AppError::Exists(_))
        ));
        assert_eq!(store.read("Study").expect("read").as_deref(), Some(body));

        let updated = r#"{"name":"Study","size":20}"#;
        store.write("Study", updated, false).expect("update");
        assert_eq!(
            store.read("Study").expect("read updated").as_deref(),
            Some(updated)
        );

        store.rename("Study", "Reading").expect("rename");
        assert_eq!(store.read("Study").expect("old gone"), None);
        assert_eq!(
            store.read("Reading").expect("new present").as_deref(),
            Some(updated)
        );

        let listed = store.list().expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Reading");
        assert_eq!(listed[0].text.as_deref(), Some(updated));

        let mut trashed = Vec::new();
        store
            .delete("Reading", |path| {
                trashed.push(path.to_path_buf());
                std::fs::remove_file(path)
            })
            .expect("delete");
        assert_eq!(trashed.len(), 1);
        assert_eq!(store.list().expect("empty after delete"), Vec::new());
    }

    #[test]
    fn refuses_oversized_files_and_caps_file_count() {
        let (_dir, store) = store();
        let big = "a".repeat(MAX_BYTES as usize + 1);
        assert!(matches!(
            store.write("TooBig", &big, true),
            Err(AppError::Invalid(_))
        ));

        let folder = store.ensure_folder().expect("folder");
        for i in 0..(MAX_FILES + 5) {
            std::fs::write(folder.join(format!("p{i:03}.json")), "{}").expect("seed");
        }
        assert_eq!(store.list().expect("capped").len(), MAX_FILES);
    }

    #[test]
    fn watch_notifies_on_json_file_write() {
        let (_dir, store) = store();
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&hits);
        store
            .watch(Box::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
            }))
            .expect("watch");
        store.write("Live", "{}", true).expect("write");
        for _ in 0..40 {
            if hits.load(Ordering::SeqCst) > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(hits.load(Ordering::SeqCst) > 0);
    }
}
