//! Giving a document a file: the first save of an untitled tab, and Save As.
//!
//! The page never names the path. It sends the text and a suggested file name; Rust shows the
//! system's save dialog, and the path the user picks is granted here, written, and becomes the
//! document's file. The original file of a Save As is never opened for writing, so its bytes cannot
//! change. A document keeps the encoding and byte-order mark of its file; an untitled one, and one
//! whose own encoding mdmate cannot write, is written as UTF-8 with no byte-order mark.

use crate::access::{Resolved, display_path};
use crate::documents::{self, AppState};
use crate::error::AppError;
use crate::fs::encoding::{Encoding, Format};
use crate::fs::kind::kind_of;
use crate::fs::{self, atomic, eol, frame};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// What the dialog is asked to show.
#[derive(Debug)]
pub(crate) struct SaveRequest {
    /// The file name to suggest, already cleaned.
    pub(crate) name: String,
    /// The folder to start in, when the page suggested one that exists.
    pub(crate) folder: Option<PathBuf>,
}

/// Where the user chose to save, or nothing when they cancelled. The real one shows the system
/// dialog; the tests pass one that answers at once.
pub(crate) type Chooser<'a> = &'a dyn Fn(&SaveRequest) -> Option<PathBuf>;

/// What a Save As wrote, for the page to follow.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedAs {
    pub(crate) path: String,
    pub(crate) name: String,
    /// Hash of the bytes now on disk, 32 hex digits.
    pub(crate) hash: String,
    pub(crate) size: u64,
    pub(crate) kind: &'static str,
    pub(crate) encoding: &'static str,
    pub(crate) bom: bool,
}

/// The format of a file mdmate creates.
const NEW_FILE: Format = Format {
    encoding: Encoding::Utf8,
    bom: false,
};

/// Names Windows will not let a file have, whatever its extension.
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

const MAX_NAME: usize = 120;

/// A file name safe to suggest: no folders, no characters Windows forbids, no reserved name, no
/// trailing dots or spaces, a sensible length. Falls back to `Untitled.md`.
pub(crate) fn clean_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let kept: String = last
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"|?*".contains(*c))
        .collect();
    let kept = kept.trim().trim_end_matches(['.', ' ']).to_owned();
    if kept.is_empty() {
        return "Untitled.md".to_owned();
    }
    let (stem, extension) = match kept.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => {
            (stem.to_owned(), Some(extension.to_owned()))
        }
        _ => (kept.clone(), None),
    };
    let stem: String = stem.chars().take(MAX_NAME).collect();
    let stem = if RESERVED.contains(&stem.to_lowercase().as_str()) {
        format!("_{stem}")
    } else {
        stem
    };
    match extension {
        Some(extension) => format!("{stem}.{}", extension.chars().take(16).collect::<String>()),
        None => stem,
    }
}

/// The path as Windows and Rust need it to write: its folder resolved, its name as chosen. A file
/// that exists is resolved whole, so a link to it is followed and the target is what gets replaced.
fn final_path(chosen: &Path) -> Result<PathBuf, AppError> {
    if let Ok(whole) = std::fs::canonicalize(chosen) {
        return Ok(whole);
    }
    let name = chosen
        .file_name()
        .ok_or_else(|| AppError::Invalid("the chosen path has no file name".into()))?;
    let folder = chosen
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| AppError::Invalid("the chosen path has no folder".into()))?;
    Ok(std::fs::canonicalize(folder)?.join(name))
}

/// The key a path has in the table of open documents, for a file that may not exist yet.
fn key_of(state: &AppState, path: &Path) -> String {
    let text = path.to_string_lossy();
    // The path was resolved by `final_path`, so this only has to fold case as the access check does.
    if state.ignore_case() {
        text.to_lowercase()
    } else {
        text.into_owned()
    }
}

/// Saves the document `id` to a file the user picks. `body` is the frame the page sends for any
/// save, with a `name` (suggested file name) and a `folder` (suggested start folder) in its header.
/// Returns nothing when the user cancels, and then nothing has changed.
///
/// An untitled document gets its file. A document that has one is written to the new path and
/// follows it, with the original left as it was; a document whose encoding mdmate cannot write is
/// written as UTF-8 and becomes editable.
pub(crate) fn save_as(
    state: &AppState,
    id: u32,
    body: &[u8],
    choose: Chooser<'_>,
) -> Result<Option<SavedAs>, AppError> {
    let frame = frame::decode(body)?;
    let name = frame
        .header
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(clean_name)
        .unwrap_or_else(|| "Untitled.md".to_owned());
    let folder = frame
        .header
        .get("folder")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .filter(|path| path.is_dir());

    let (untitled, entry) = {
        let documents = state.documents();
        (documents.is_untitled(id), documents.get(id).cloned())
    };
    if !untitled && entry.is_none() {
        return Err(AppError::NotOpen(id));
    }
    // Only a file whose bytes were read back faithfully keeps its own encoding.
    let format = entry
        .as_ref()
        .and_then(|entry| entry.format)
        .unwrap_or(NEW_FILE);

    let Some(chosen) = choose(&SaveRequest { name, folder }) else {
        return Ok(None);
    };
    let mut target = final_path(&chosen)?;
    if untitled && target.extension().is_none() {
        // A name with no extension would open as plain text; this is a Markdown editor.
        let with_extension = target.with_extension("md");
        if with_extension.exists() {
            return Err(AppError::Exists(display_path(&with_extension)));
        }
        target = with_extension;
    }
    let key = key_of(state, &target);

    // Saving over the document's own file is an ordinary save, with its guard against a change made
    // behind the app's back. A file mdmate cannot write back is never replaced: that would change
    // the original's bytes.
    if let Some(entry) = &entry
        && entry.key == key
    {
        if entry.format.is_none() {
            return Err(AppError::ReadOnly(
                "choose a different file name; the original is left as it is".into(),
            ));
        }
        let saved = documents::save_document(state, id, body)?;
        return Ok(Some(described(&entry.path, saved.hash, saved.size, format)));
    }
    if state.documents().path_is_open_elsewhere(&key, id) {
        return Err(AppError::Invalid(format!(
            "{} is open in another tab; close it or choose another name",
            target
                .file_name()
                .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
        )));
    }

    let joined = eol::join(frame.text, &frame.endings)?;
    let bytes = crate::fs::encoding::encode(&joined, format);
    let hash = fs::document::content_hash(&bytes);
    let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    atomic::write_atomic_with(&target, &bytes, |_| Ok(()))?;

    // The file is on disk: grant it, and point the document at it.
    let resolved: Resolved = state.access().grant_file(&target)?;
    let moved = {
        let mut documents = state.documents();
        if untitled {
            documents.promote(id, &resolved, Some(format), hash)
        } else if documents.rebind(id, &resolved) {
            if let Some(entry) = documents.get_mut(id) {
                entry.format = Some(format);
                entry.known_hash = hash;
                entry.reported_hash = None;
            }
            true
        } else {
            false
        }
    };
    if !moved {
        return Err(AppError::Invalid(
            "the document could not be given that file".into(),
        ));
    }
    if let Some(watcher) = state.watcher() {
        watcher.unwatch(id);
        watcher.watch(id, &resolved.path);
    }
    Ok(Some(described(&resolved.path, hash, size, format)))
}

fn described(path: &Path, hash: u128, size: u64, format: Format) -> SavedAs {
    SavedAs {
        path: display_path(path),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        hash: documents::hash_hex(hash),
        size,
        kind: kind_of(path).name(),
        encoding: format.encoding.name(),
        bom: format.bom,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::eol::{Ending, Endings};
    use serde_json::Map;
    use std::cell::RefCell;

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

    fn state() -> AppState {
        AppState::new(false)
    }

    /// A frame as the page sends it, with the name and folder the dialog is asked to show.
    fn frame_for(text: &str, endings: &Endings, name: &str) -> Vec<u8> {
        let mut header = Map::new();
        header.insert("name".into(), name.into());
        frame::encode(header, endings, text)
    }

    fn lf() -> Endings {
        Endings {
            dominant: Ending::Lf,
            exceptions: Vec::new(),
        }
    }

    /// Opens a file the way the page does: granted by the user, then opened.
    fn open(state: &AppState, path: &Path) -> u32 {
        state.access().grant_file(path).expect("granted");
        let bytes = documents::open_document(state, path).expect("opens");
        let frame = frame::decode(&bytes).expect("frame");
        u32::try_from(frame.header["id"].as_u64().expect("id")).expect("small id")
    }

    #[test]
    fn save_new_file_writes_utf8_with_lf_and_no_byte_order_mark() {
        let dir = temp();
        let state = state();
        let id = state.documents().register_untitled();
        let target = dir.path.join("notes.md");
        let asked = RefCell::new(None);
        let saved = save_as(
            &state,
            id,
            &frame_for("# Café\nsecond line\n", &lf(), "café.md"),
            &|request| {
                *asked.borrow_mut() = Some((request.name.clone(), request.folder.clone()));
                Some(target.clone())
            },
        )
        .expect("saves")
        .expect("not cancelled");
        assert_eq!(
            std::fs::read(&target).expect("read"),
            "# Café\nsecond line\n".as_bytes()
        );
        assert!(
            !std::fs::read(&target)
                .expect("read")
                .starts_with(b"\xEF\xBB\xBF")
        );
        assert!(!std::fs::read(&target).expect("read").contains(&b'\r'));
        assert_eq!(
            asked.borrow().as_ref().map(|a| a.0.as_str()),
            Some("café.md")
        );
        assert_eq!(saved.path, display_path(&target));
        assert_eq!(
            (saved.kind, saved.encoding, saved.bom),
            ("markdown", "utf-8", false)
        );
        // The document now has that file: Rust grants it and a save by id writes it.
        assert!(state.access().check(&target).is_ok());
        assert!(
            !state.documents().is_untitled(id),
            "it is a file, not a new tab, from now on"
        );
        let entry = state.documents().get(id).cloned().expect("has a file now");
        assert_eq!(display_path(&entry.path), display_path(&target));
        documents::save_document(&state, id, &frame_for("# Café\nthird\n", &lf(), ""))
            .expect("a second save goes to the same file");
        assert_eq!(
            std::fs::read_to_string(&target).expect("read"),
            "# Café\nthird\n"
        );
    }

    #[test]
    fn save_new_file_cleans_the_suggested_name_before_the_dialog_sees_it() {
        let dir = temp();
        let state = state();
        let id = state.documents().register_untitled();
        let asked = RefCell::new(String::new());
        // A page that sends a name with folders and characters Windows forbids.
        save_as(
            &state,
            id,
            &frame_for("x\n", &lf(), r"evil/dir\b:c?.md"),
            &|request| {
                *asked.borrow_mut() = request.name.clone();
                None
            },
        )
        .expect("cancelling is fine");
        assert_eq!(asked.borrow().as_str(), "bc.md");
        assert_eq!(std::fs::read_dir(&dir.path).expect("dir").count(), 0);
    }

    #[test]
    fn save_new_file_writes_the_endings_it_is_given_and_never_a_stray_return() {
        let dir = temp();
        let state = state();
        let id = state.documents().register_untitled();
        let target = dir.path.join("crlf.md");
        let endings = Endings {
            dominant: Ending::CrLf,
            exceptions: Vec::new(),
        };
        save_as(&state, id, &frame_for("a\nb\n", &endings, "x.md"), &|_| {
            Some(target.clone())
        })
        .expect("saves");
        assert_eq!(std::fs::read(&target).expect("read"), b"a\r\nb\r\n");
    }

    #[test]
    fn save_new_file_cancelled_changes_nothing() {
        let dir = temp();
        let state = state();
        let id = state.documents().register_untitled();
        let answer = save_as(&state, id, &frame_for("text", &lf(), "x.md"), &|_| None)
            .expect("cancelling is not an error");
        assert!(answer.is_none());
        assert!(state.documents().is_untitled(id));
        assert_eq!(std::fs::read_dir(&dir.path).expect("dir").count(), 0);
    }

    #[test]
    fn save_new_file_adds_md_to_a_name_with_no_extension_and_never_replaces_a_file_for_it() {
        let dir = temp();
        let state = state();
        let id = state.documents().register_untitled();
        let bare = dir.path.join("plain");
        save_as(&state, id, &frame_for("hello\n", &lf(), "x.md"), &|_| {
            Some(bare.clone())
        })
        .expect("saves");
        assert_eq!(
            std::fs::read(dir.path.join("plain.md")).expect("read"),
            b"hello\n"
        );
        assert!(!bare.exists());

        // A second untitled tab, with plain.md already there: the dialog never asked about
        // plain.md, so nothing is replaced and the user is told.
        let other = state.documents().register_untitled();
        let error = save_as(&state, other, &frame_for("new\n", &lf(), "x.md"), &|_| {
            Some(bare.clone())
        })
        .expect_err("refused");
        assert_eq!(error.kind(), "exists");
        assert_eq!(
            std::fs::read(dir.path.join("plain.md")).expect("read"),
            b"hello\n"
        );
        assert!(state.documents().is_untitled(other));
    }

    #[test]
    fn save_new_file_refuses_a_file_that_is_open_in_another_tab() {
        let dir = temp();
        let state = state();
        let taken = dir.path.join("taken.md");
        std::fs::write(&taken, b"mine\n").expect("written");
        let open_id = open(&state, &taken);
        let id = state.documents().register_untitled();
        let error = save_as(&state, id, &frame_for("other\n", &lf(), "x.md"), &|_| {
            Some(taken.clone())
        })
        .expect_err("refused");
        assert_eq!(error.kind(), "invalid");
        assert_eq!(std::fs::read(&taken).expect("read"), b"mine\n");
        assert!(state.documents().is_untitled(id));
        assert!(state.documents().get(open_id).is_some());
    }

    #[test]
    fn save_new_file_is_not_a_listed_file_before_it_has_one() {
        let state = state();
        let id = state.documents().register_untitled();
        assert!(state.documents().get(id).is_none());
        assert_eq!(state.documents().entries().count(), 0);
        let error =
            documents::save_document(&state, id, &frame_for("x", &lf(), "")).expect_err("refused");
        assert_eq!(error.kind(), "not-open");
        documents::close_document(&state, id);
        assert!(!state.documents().is_untitled(id));
    }

    #[test]
    fn save_as_original_stays_byte_for_byte_the_same() {
        let dir = temp();
        let state = state();
        let original = dir.path.join("original.md");
        let bytes: &[u8] = b"\xEF\xBB\xBF# One\r\ntwo\nthree\r\n";
        std::fs::write(&original, bytes).expect("written");
        let id = open(&state, &original);
        let copy = dir.path.join("copy.md");
        let saved = save_as(
            &state,
            id,
            &frame_for("# One\nedited\n", &lf(), "copy.md"),
            &|_| Some(copy.clone()),
        )
        .expect("saves")
        .expect("not cancelled");
        assert_eq!(std::fs::read(&original).expect("read"), bytes);
        // The copy keeps the file's own encoding, with its byte-order mark.
        assert_eq!(
            std::fs::read(&copy).expect("read"),
            b"\xEF\xBB\xBF# One\nedited\n"
        );
        assert_eq!((saved.encoding, saved.bom), ("utf-8", true));
        // The tab follows the copy: a save by id writes it, and the original is not touched again.
        documents::save_document(&state, id, &frame_for("# One\nlater\n", &lf(), ""))
            .expect("saves the copy");
        assert_eq!(std::fs::read(&original).expect("read"), bytes);
        assert_eq!(
            std::fs::read(&copy).expect("read"),
            b"\xEF\xBB\xBF# One\nlater\n"
        );
    }

    #[test]
    fn save_as_original_is_not_opened_again_when_the_copy_is_made_over_another_file() {
        let dir = temp();
        let state = state();
        let original = dir.path.join("original.md");
        std::fs::write(&original, b"keep me\n").expect("written");
        let id = open(&state, &original);
        let other = dir.path.join("other.md");
        std::fs::write(&other, b"old other\n").expect("written");
        // The dialog already asked about replacing other.md; this is the user's answer.
        save_as(&state, id, &frame_for("new\n", &lf(), "other.md"), &|_| {
            Some(other.clone())
        })
        .expect("saves");
        assert_eq!(std::fs::read(&other).expect("read"), b"new\n");
        assert_eq!(std::fs::read(&original).expect("read"), b"keep me\n");
    }

    #[test]
    fn save_as_to_the_same_file_is_a_plain_save_and_guards_a_change_made_elsewhere() {
        let dir = temp();
        let state = state();
        let file = dir.path.join("same.md");
        std::fs::write(&file, b"one\n").expect("written");
        let id = open(&state, &file);
        save_as(
            &state,
            id,
            &frame_for("edited\n", &lf(), "same.md"),
            &|_| Some(file.clone()),
        )
        .expect("saves");
        assert_eq!(std::fs::read(&file).expect("read"), b"edited\n");
        std::fs::write(&file, b"changed by another program\n").expect("written");
        let error = save_as(&state, id, &frame_for("mine\n", &lf(), "same.md"), &|_| {
            Some(file.clone())
        })
        .expect_err("the guard refuses");
        assert_eq!(error.kind(), "disk-changed");
        assert_eq!(
            std::fs::read(&file).expect("read"),
            b"changed by another program\n"
        );
    }

    #[test]
    fn save_as_read_only_writes_utf8_and_makes_the_document_editable() {
        let dir = temp();
        let state = state();
        // "café" in Latin-1: the é is one byte, 0xE9.
        let latin1 = dir.path.join("latin1.md");
        let bytes: &[u8] = b"caf\xE9\r\nna\xEFve\r\n";
        std::fs::write(&latin1, bytes).expect("written");
        let id = open(&state, &latin1);
        assert!(state.documents().get(id).expect("open").format.is_none());
        // The page holds the text as Rust showed it: each byte as the letter with that number.
        let crlf = Endings {
            dominant: Ending::CrLf,
            exceptions: Vec::new(),
        };
        let copy = dir.path.join("utf8.md");
        let saved = save_as(
            &state,
            id,
            &frame_for("caf\u{e9}\nna\u{ef}ve\n", &crlf, "utf8.md"),
            &|_| Some(copy.clone()),
        )
        .expect("saves")
        .expect("not cancelled");
        // Real bytes: é is C3 A9 and ï is C3 AF, no byte-order mark, the original's CRLF kept.
        assert_eq!(
            std::fs::read(&copy).expect("read"),
            b"caf\xC3\xA9\r\nna\xC3\xAFve\r\n"
        );
        assert_eq!((saved.encoding, saved.bom), ("utf-8", false));
        assert_eq!(std::fs::read(&latin1).expect("read"), bytes);
        // The document can be saved now.
        assert!(state.documents().get(id).expect("open").format.is_some());
        documents::save_document(&state, id, &frame_for("caf\u{e9}\nmore\n", &crlf, ""))
            .expect("editable");
        assert_eq!(
            std::fs::read(&copy).expect("read"),
            b"caf\xC3\xA9\r\nmore\r\n"
        );
        assert_eq!(std::fs::read(&latin1).expect("read"), bytes);
    }

    #[test]
    fn save_as_read_only_never_replaces_its_own_original() {
        let dir = temp();
        let state = state();
        let latin1 = dir.path.join("latin1.md");
        let bytes: &[u8] = b"caf\xE9\n";
        std::fs::write(&latin1, bytes).expect("written");
        let id = open(&state, &latin1);
        let error = save_as(
            &state,
            id,
            &frame_for("caf\u{e9}\n", &lf(), "latin1.md"),
            &|_| Some(latin1.clone()),
        )
        .expect_err("refused");
        assert_eq!(error.kind(), "read-only");
        assert_eq!(std::fs::read(&latin1).expect("read"), bytes);
    }

    #[test]
    fn save_as_moves_the_watch_to_the_new_file() {
        let dir = temp();
        let state = state();
        let original = dir.path.join("a.md");
        std::fs::write(&original, b"x\n").expect("written");
        let id = open(&state, &original);
        let copy = dir.path.join("b.md");
        save_as(&state, id, &frame_for("y\n", &lf(), "b.md"), &|_| {
            Some(copy.clone())
        })
        .expect("saves");
        // The record's hash is the new file's, so the watcher sees nothing to report for it, and
        // the original is no longer this document's file.
        let entry = state.documents().get(id).cloned().expect("open");
        assert_eq!(
            entry.known_hash,
            fs::document::content_hash(&std::fs::read(&copy).expect("read"))
        );
        assert!(
            crate::workspace::watch::check_path(&state, &copy).is_empty(),
            "the app's own write is not news"
        );
        std::fs::write(&original, b"changed\n").expect("written");
        assert!(
            crate::workspace::watch::check_path(&state, &original).is_empty(),
            "the original is not watched for this document any more"
        );
    }

    #[test]
    fn clean_name_makes_a_name_the_dialog_can_show() {
        assert_eq!(clean_name("meeting-notes.md"), "meeting-notes.md");
        assert_eq!(clean_name("a/b\\c.md"), "c.md");
        assert_eq!(clean_name("what? <is> \"this\".md"), "what is this.md");
        assert_eq!(clean_name("trailing. . "), "trailing");
        assert_eq!(clean_name(""), "Untitled.md");
        assert_eq!(clean_name("???"), "Untitled.md");
        assert_eq!(clean_name("CON.md"), "_CON.md");
        assert_eq!(clean_name("nul"), "_nul");
        assert_eq!(
            clean_name("Árvíztűrő tükörfúrógép.md"),
            "Árvíztűrő tükörfúrógép.md"
        );
        assert!(
            clean_name(&format!("{}.md", "x".repeat(500)))
                .chars()
                .count()
                <= MAX_NAME + 3
        );
    }
}
