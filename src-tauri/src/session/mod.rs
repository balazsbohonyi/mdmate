//! Hot exit: what the page needs to bring the app back as it was, kept in the data folder.
//!
//! The page builds a snapshot (layout, tabs, carets and every unsaved buffer) and Rust writes it
//! with the same temp-file-and-rename the editor saves use, so a crash leaves either the last
//! snapshot or the one before it, never half of one. Rust adds the paths of the documents it has
//! open, and those become the file grants of the next run: the page cannot name a path that this
//! process did not itself open, which keeps "the page has no command that grants access" true.

use crate::access::display_path;
use crate::documents::AppState;
use crate::drafts::{self, take_back};
use crate::error::AppError;
use crate::fs::atomic::{self, Stage};
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

const FILE: &str = "session.json";
const VERSION: u32 = 1;
/// Folder, inside the data folder, for buffers the next start could not put back in a tab.
const RECOVERED: &str = "recovered";

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    grants: Vec<String>,
    page: serde_json::Value,
}

/// What a start gets back from the last run.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Loaded {
    /// Files the last run had open, to be granted again.
    pub(crate) grants: Vec<String>,
    /// The page's snapshot, as JSON text.
    pub(crate) page: String,
}

/// The session file and the folder around it.
#[derive(Debug)]
pub(crate) struct SessionStore {
    dir: PathBuf,
    /// One write at a time, so two snapshots never interleave their file operations. The page
    /// keeps its own writes in order; this only keeps the file operations themselves apart.
    writing: Mutex<()>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

impl SessionStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            writing: Mutex::new(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn dir(&self) -> &Path {
        &self.dir
    }

    fn file(&self) -> PathBuf {
        self.dir.join(FILE)
    }

    /// Replaces the session file with `page` and the paths in `grants`.
    pub(crate) fn write(&self, grants: &[String], page: &str) -> Result<(), AppError> {
        self.write_with(grants, page, |_| Ok(()))
    }

    fn write_with(
        &self,
        grants: &[String],
        page: &str,
        hook: impl Fn(Stage) -> std::io::Result<()>,
    ) -> Result<(), AppError> {
        // A snapshot that is not JSON would make the next start discard everything, so it is
        // refused here and the previous file stays.
        serde_json::from_str::<IgnoredAny>(page)
            .map_err(|error| AppError::Invalid(format!("the session snapshot: {error}")))?;
        let grants =
            serde_json::to_string(grants).map_err(|error| AppError::Invalid(error.to_string()))?;
        let body = format!("{{\"version\":{VERSION},\"grants\":{grants},\"page\":{page}}}");

        let _guard = self.writing.lock().unwrap_or_else(PoisonError::into_inner);
        std::fs::create_dir_all(&self.dir)?;
        atomic::write_atomic_with(&self.file(), body.as_bytes(), hook)
    }

    /// Reads the last run's session. A file that cannot be read back is moved aside, not deleted,
    /// and the app starts empty. Temp files left by a kill in the middle of a write are removed.
    pub(crate) fn load(&self) -> Option<Loaded> {
        self.sweep_temp_files();
        let text = std::fs::read_to_string(self.file()).ok()?;
        match serde_json::from_str::<Envelope>(&text) {
            Ok(envelope) if envelope.version == VERSION => Some(Loaded {
                grants: envelope.grants,
                page: envelope.page.to_string(),
            }),
            _ => {
                let aside = self
                    .dir
                    .join(format!("session.unreadable-{}.json", now_ms()));
                // Best effort: if even the rename fails, the next write replaces the file anyway.
                let _ = std::fs::rename(self.file(), aside);
                None
            }
        }
    }

    fn sweep_temp_files(&self) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        let prefix = format!(".{FILE}.mdmate-");
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && name.ends_with(".tmp") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    /// `recover` for the text of an untitled document: the images its text links to are copied
    /// into `recovered/assets/` first (a taken name gets `-2`, and its link is updated), so the
    /// recovered file's `assets/…` links resolve beside it. Closing the document removes its draft
    /// folder afterwards, which is why they cannot stay there. The text is never lost for the sake
    /// of its pictures: if they cannot be copied, the text is recovered as it is.
    pub(crate) fn recover_with_images(
        &self,
        state: &AppState,
        name: &str,
        text: &str,
        untitled: Option<u32>,
    ) -> Result<PathBuf, AppError> {
        let Some(number) = untitled else {
            return self.recover(name, text);
        };
        let folder = self.dir.join(RECOVERED);
        std::fs::create_dir_all(&folder)?;
        let copied = std::fs::canonicalize(&folder)
            .map_err(AppError::from)
            .and_then(|resolved| {
                drafts::adopt(state.drafts(), number, text, &resolved, state.ignore_case())
            });
        match copied {
            Ok(adopted) => self.recover(name, &adopted.text).inspect_err(|_| {
                take_back(&adopted.created);
            }),
            Err(_) => self.recover(name, text),
        }
    }

    /// Saves text the next start could not put back in a tab, in a file of its own, and returns
    /// where it went. Nothing the user typed is thrown away because a file moved or a snapshot
    /// was damaged.
    pub(crate) fn recover(&self, name: &str, text: &str) -> Result<PathBuf, AppError> {
        use std::io::Write as _;
        let folder = self.dir.join(RECOVERED);
        std::fs::create_dir_all(&folder)?;
        let stem: String = name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .take(60)
            .collect();
        let stem = if stem.is_empty() {
            "buffer".to_owned()
        } else {
            stem
        };
        let stamp = now_ms();
        for attempt in 0_u32.. {
            let suffix = if attempt == 0 {
                String::new()
            } else {
                format!("-{attempt}")
            };
            let path = folder.join(format!("{stem}-{stamp}{suffix}.md"));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    file.write_all(text.as_bytes())?;
                    file.sync_all()?;
                    return Ok(path);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        unreachable!("the loop above only ends by returning")
    }
}

/// The paths of the documents and image tabs open right now: the grants the next run starts with.
pub(crate) fn open_paths(state: &AppState) -> Vec<String> {
    let mut paths: Vec<String> = state
        .documents()
        .entries()
        .map(|(_, entry)| display_path(&entry.path))
        .collect();
    paths.extend(state.image_paths());
    paths.sort();
    paths.dedup();
    paths
}

/// Writes the page's snapshot, with the grants of the documents open now.
pub(crate) fn write(state: &AppState, store: &SessionStore, page: &str) -> Result<(), AppError> {
    store.write(&open_paths(state), page)
}

/// Reads the last run's session and grants its files again. Returns the page's snapshot.
pub(crate) fn load(state: &AppState, store: &SessionStore) -> Option<String> {
    let loaded = store.load()?;
    for path in &loaded.grants {
        // A file that is gone or unreachable simply stays ungranted; the page then cannot open it.
        let _ = state.access().grant_file(Path::new(path));
    }
    Some(loaded.page)
}

type Ask = Box<dyn Fn() -> bool + Send + Sync>;

/// Asks the page to flush before the window closes. Holds the way to ask, once the page has
/// subscribed.
#[derive(Default)]
pub(crate) struct CloseHook {
    ask: Mutex<Option<Ask>>,
}

impl std::fmt::Debug for CloseHook {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CloseHook")
    }
}

impl CloseHook {
    /// Replaces who is asked. `ask` returns false when nobody is listening any more.
    pub(crate) fn set(&self, ask: Ask) {
        *self.ask.lock().unwrap_or_else(PoisonError::into_inner) = Some(ask);
    }

    /// True when the page was asked and will end the app itself, so the close must wait.
    pub(crate) fn ask(&self) -> bool {
        self.ask
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .is_some_and(|ask| ask())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (tempfile::TempDir, SessionStore) {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = SessionStore::new(dir.path().join("data"));
        (dir, store)
    }

    #[test]
    fn a_session_comes_back_as_written() {
        let (_keep, store) = store();
        let page = json!({"layout": {"root": 1}, "buffers": [{"text": "a \"quoted\"\nline"}]});
        store
            .write(&["C:/a.md".into(), "C:/b.md".into()], &page.to_string())
            .expect("writes");

        let loaded = store.load().expect("loads");
        assert_eq!(loaded.grants, ["C:/a.md", "C:/b.md"]);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&loaded.page).expect("json"),
            page
        );
    }

    #[test]
    fn the_latest_write_is_the_one_that_loads() {
        let (_keep, store) = store();
        store.write(&[], "{\"n\":1}").expect("writes");
        store.write(&[], "{\"n\":2}").expect("writes");
        assert_eq!(store.load().expect("loads").page, "{\"n\":2}");
    }

    #[test]
    fn nothing_to_load_before_the_first_write() {
        let (_keep, store) = store();
        assert_eq!(store.load(), None);
    }

    #[test]
    fn a_snapshot_that_is_not_json_is_refused_and_the_last_one_stays() {
        let (_keep, store) = store();
        store.write(&[], "{\"n\":1}").expect("writes");
        let error = store.write(&[], "{not json").expect_err("refused");
        assert_eq!(error.kind(), "invalid");
        assert_eq!(store.load().expect("loads").page, "{\"n\":1}");
    }

    #[test]
    fn a_kill_before_the_rename_leaves_the_previous_session_whole() {
        let (_keep, store) = store();
        store.write(&["x".into()], "{\"n\":1}").expect("writes");
        let error = store
            .write_with(&["y".into()], "{\"n\":2}", |stage| match stage {
                Stage::BeforeRename => Err(std::io::Error::other("killed here")),
                Stage::AfterRename => Ok(()),
            })
            .expect_err("interrupted");
        assert_eq!(error.kind(), "io");
        let loaded = store.load().expect("loads");
        assert_eq!(loaded.grants, ["x"]);
        assert_eq!(loaded.page, "{\"n\":1}");
    }

    #[test]
    fn an_unreadable_file_is_moved_aside_and_the_start_is_empty() {
        let (_keep, store) = store();
        std::fs::create_dir_all(store.dir()).expect("dir");
        std::fs::write(store.file(), "{\"version\":1,\"grants\":[").expect("written");

        assert_eq!(store.load(), None);
        let names: Vec<String> = std::fs::read_dir(store.dir())
            .expect("readable")
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            names.iter().any(|n| n.starts_with("session.unreadable-")),
            "{names:?}"
        );
        assert!(!names.iter().any(|n| n == FILE), "{names:?}");
    }

    #[test]
    fn a_version_from_another_release_is_moved_aside_too() {
        let (_keep, store) = store();
        std::fs::create_dir_all(store.dir()).expect("dir");
        std::fs::write(store.file(), "{\"version\":99,\"grants\":[],\"page\":{}}")
            .expect("written");
        assert_eq!(store.load(), None);
        assert!(!store.file().exists());
    }

    #[test]
    fn temp_files_from_a_killed_write_are_swept_on_load() {
        let (_keep, store) = store();
        store.write(&[], "{}").expect("writes");
        let stray = store.dir().join(".session.json.mdmate-123-4.tmp");
        std::fs::write(&stray, "half").expect("written");
        let other = store.dir().join("notes.tmp");
        std::fs::write(&other, "not ours").expect("written");

        store.load().expect("loads");

        assert!(!stray.exists());
        assert!(other.exists(), "only our own temp files are removed");
    }

    #[test]
    fn recovered_text_lands_in_its_own_file_and_never_overwrites() {
        let (_keep, store) = store();
        let first = store
            .recover("my notes: draft?.md", "one")
            .expect("recovers");
        let second = store
            .recover("my notes: draft?.md", "two")
            .expect("recovers");

        assert_ne!(first, second);
        assert!(first.starts_with(store.dir().join(RECOVERED)));
        assert_eq!(std::fs::read_to_string(&first).expect("readable"), "one");
        assert_eq!(std::fs::read_to_string(&second).expect("readable"), "two");
        let name = first
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        assert!(name.starts_with("my_notes__draft__md-"), "{name}");
    }

    #[test]
    fn open_documents_are_what_the_next_run_may_open() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::new(false);
        let (a, b) = (dir.path().join("a.md"), dir.path().join("b.md"));
        for path in [&a, &b] {
            std::fs::write(path, "x").expect("written");
            state.access().grant_file(path).expect("grants");
            crate::documents::open_document(&state, path).expect("opens");
        }
        let paths = open_paths(&state);
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().all(|p| !p.starts_with("\\\\?\\")), "{paths:?}");

        // A fresh state, as in the next run, can open them after load, and nothing else.
        let store = SessionStore::new(dir.path().join("data"));
        write(&state, &store, "{\"layout\":1}").expect("writes");
        let next = AppState::new(false);
        let outside = dir.path().join("c.md");
        std::fs::write(&outside, "x").expect("written");
        assert!(
            crate::documents::open_document(&next, &a).is_err(),
            "before load"
        );
        assert_eq!(load(&next, &store).as_deref(), Some("{\"layout\":1}"));
        assert!(crate::documents::open_document(&next, &a).is_ok());
        assert!(crate::documents::open_document(&next, &b).is_ok());
        assert!(
            crate::documents::open_document(&next, &outside).is_err(),
            "never named"
        );
    }

    #[test]
    fn the_close_hook_waits_only_while_someone_listens() {
        let hook = CloseHook::default();
        assert!(!hook.ask(), "nobody subscribed: the window closes at once");
        hook.set(Box::new(|| true));
        assert!(hook.ask());
        hook.set(Box::new(|| false));
        assert!(
            !hook.ask(),
            "a page that is gone cannot ask the close to wait"
        );
    }
    #[test]
    fn an_open_image_tab_is_granted_again_and_a_closed_one_is_not() {
        let dir = tempfile::tempdir().expect("temp dir");
        let state = AppState::new(false);
        let (shown, closed) = (dir.path().join("shown.png"), dir.path().join("closed.png"));
        for path in [&shown, &closed] {
            std::fs::write(path, [0_u8; 3]).expect("written");
            state.access().grant_file(path).expect("grants");
            crate::workspace::image_info(&state, &path.to_string_lossy()).expect("shown");
        }
        state.forget_image(&closed);
        let paths = open_paths(&state);
        assert_eq!(paths.len(), 1, "{paths:?}");
        assert!(paths[0].ends_with("shown.png"));

        let store = SessionStore::new(dir.path().join("data"));
        write(&state, &store, "{}").expect("writes");
        let next = AppState::new(false);
        let ask = |state: &AppState, path: &std::path::Path| {
            crate::workspace::image_info(state, &path.to_string_lossy())
        };
        assert!(ask(&next, &shown).is_err(), "before load");
        load(&next, &store);
        assert!(ask(&next, &shown).is_ok(), "the open tab came back");
        assert_eq!(
            ask(&next, &closed).expect_err("closed").kind(),
            "not-allowed",
            "the closed one stays closed"
        );
    }

    #[test]
    fn draft_images_recovered_untitled_text_takes_its_images_along() {
        const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-pretend-pixels-";
        let (keep, store) = store();
        let state = AppState::new(false);
        state.drafts().set_root(keep.path().join("drafts"));
        let draft = state.drafts().ensure(3).expect("draft folder");
        std::fs::create_dir_all(draft.join("assets")).expect("assets");
        std::fs::write(draft.join("assets").join("image-20261113-153000.png"), PNG).expect("image");
        std::fs::write(draft.join("assets").join("image-20261113-153001.png"), PNG)
            .expect("unused");
        let text = "![a](assets/image-20261113-153000.png)\n";

        let path = store
            .recover_with_images(&state, "Untitled-3", text, Some(3))
            .expect("recovers");
        assert_eq!(std::fs::read_to_string(&path).expect("readable"), text);
        let assets = store.dir().join(RECOVERED).join("assets");
        assert_eq!(
            std::fs::read(assets.join("image-20261113-153000.png")).expect("copied"),
            PNG
        );
        assert!(!assets.join("image-20261113-153001.png").exists());

        // A second recovered text that links the same name gets its own copy and its link follows.
        let again = store
            .recover_with_images(&state, "Untitled-3", text, Some(3))
            .expect("recovers");
        assert_eq!(
            std::fs::read_to_string(&again).expect("readable"),
            "![a](assets/image-20261113-153000-2.png)\n"
        );
        assert!(assets.join("image-20261113-153000-2.png").is_file());
    }

    #[test]
    fn draft_images_recovered_text_without_a_draft_is_kept_as_it_is() {
        let (keep, store) = store();
        let state = AppState::new(false);
        state.drafts().set_root(keep.path().join("drafts"));
        let text = "![a](assets/image-20261113-153000.png)\n";
        let path = store
            .recover_with_images(&state, "Untitled-9", text, Some(9))
            .expect("recovers");
        assert_eq!(std::fs::read_to_string(path).expect("readable"), text);
        let plain = store
            .recover_with_images(&state, "x", text, None)
            .expect("recovers");
        assert_eq!(std::fs::read_to_string(plain).expect("readable"), text);
    }
}
