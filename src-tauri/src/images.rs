//! Images the page asks Rust to save next to a document: a pasted screenshot, a copied file.
//!
//! The page never names a path. It sends the document id and the bytes; the folder comes from
//! Rust's own record of the document, the file name is built here, and the type is read from the
//! bytes rather than taken from the page's word for it. A hostile document cannot make the app
//! write anywhere else, or under another name, by what it asks the page to do.

use crate::access::{display_path, is_inside};
use crate::documents::AppState;
use crate::error::AppError;
use crate::fs::kind::{FileKind, kind_of};
use serde::Serialize;
use std::io::{ErrorKind, Write as _};
use std::path::{Component, Path, PathBuf};

/// The folder pasted and copied images go to, next to the document. A constant until P8-T1 adds
/// the `images.pasteFolder` setting (ISC-330).
pub(crate) const IMAGES_FOLDER: &str = "assets";

/// The largest image the app will write. A screenshot of several monitors is a few megabytes.
const MAX_BYTES: usize = 64 * 1024 * 1024;

/// How many times a taken name is tried again with `-2`, `-3` and so on.
const MAX_SUFFIX: u32 = 999;

/// The image formats the app saves, told apart by their first bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ImageType {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl ImageType {
    /// What the bytes are, or `None` for anything that is not one of the four.
    pub(crate) fn sniff(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some(Self::Png)
        } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(Self::Jpeg)
        } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            Some(Self::Gif)
        } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(Self::Webp)
        } else {
            None
        }
    }

    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }
}

/// An image that was saved: its file name, and the path a link written in the document uses.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct SavedImage {
    pub(crate) name: String,
    /// Relative to the document's folder, with `/` as the separator on every OS.
    pub(crate) link: String,
}

/// The time part of a file name, `YYYYMMDD-HHMMSS`. The page knows the local time; Rust holds it to
/// exactly this shape so the name can never carry a path or anything else.
pub(crate) fn valid_stamp(stamp: &str) -> bool {
    let bytes = stamp.as_bytes();
    bytes.len() == 15
        && bytes[8] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(at, byte)| at == 8 || byte.is_ascii_digit())
}

/// Writes `bytes` as a new file in `folder/IMAGES_FOLDER`, creating that folder on the first use.
/// A name that is taken gets `-2`, `-3`, and a file that is there is never opened for writing: the
/// file is created in the same step that checks the name, so two pastes in one second cannot meet.
///
/// `folder` is the folder of the document, already resolved. A `assets` that is not a folder, or
/// that leads out of `folder` (a link or junction), is refused: an image saved there would not load,
/// and the write would reach a place the document does not own.
pub(crate) fn save_into(
    folder: &Path,
    ignore_case: bool,
    stamp: &str,
    bytes: &[u8],
) -> Result<SavedImage, AppError> {
    if !valid_stamp(stamp) {
        return Err(AppError::Invalid("bad image name stamp".into()));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::Invalid("the image is too large".into()));
    }
    let Some(kind) = ImageType::sniff(bytes) else {
        return Err(AppError::Invalid(
            "not a PNG, JPEG, GIF or WebP image".into(),
        ));
    };

    let images = folder.join(IMAGES_FOLDER);
    match std::fs::symlink_metadata(&images) {
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => std::fs::create_dir(&images)?,
        Err(error) => return Err(error.into()),
    }
    let resolved = std::fs::canonicalize(&images)?;
    if !resolved.is_dir() {
        return Err(AppError::Invalid(format!(
            "{IMAGES_FOLDER} is not a folder"
        )));
    }
    let key = |path: &Path| {
        let text = display_path(path);
        if ignore_case {
            text.to_lowercase()
        } else {
            text
        }
    };
    if !is_inside(&key(&resolved), &key(&std::fs::canonicalize(folder)?)) {
        return Err(AppError::NotAllowed(format!(
            "{IMAGES_FOLDER} leads out of the document's folder"
        )));
    }

    let ext = kind.extension();
    for attempt in 1..=MAX_SUFFIX {
        let name = if attempt == 1 {
            format!("image-{stamp}.{ext}")
        } else {
            format!("image-{stamp}-{attempt}.{ext}")
        };
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(resolved.join(&name))
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        // A half-written file under a name this call created is this call's to clean up.
        if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = std::fs::remove_file(resolved.join(&name));
            return Err(error.into());
        }
        return Ok(SavedImage {
            link: format!("{IMAGES_FOLDER}/{name}"),
            name,
        });
    }
    Err(AppError::Exists(format!("image-{stamp}.{ext}")))
}

/// Saves an image pasted into the open document `id`, next to its file.
///
/// A document with no file has no folder to put `assets` in (until P9-T5 gives it a draft folder),
/// and a read-only one takes no pasted text either, so both are refused.
pub(crate) fn save_pasted(
    state: &AppState,
    id: u32,
    stamp: &str,
    bytes: &[u8],
) -> Result<SavedImage, AppError> {
    let (_, folder) = document_for_images(state, id)?;
    save_into(&folder, state.ignore_case(), stamp, bytes)
}

/// The file of the open document `id` and the folder `assets` goes in: refused for a document with
/// no file (until P9-T5 gives it a draft folder), for one that cannot be edited, and for an unknown id.
fn document_for_images(state: &AppState, id: u32) -> Result<(PathBuf, PathBuf), AppError> {
    let entry = {
        let documents = state.documents();
        if documents.is_untitled(id) {
            return Err(AppError::Invalid(
                "a document with no file has no folder for the image".into(),
            ));
        }
        documents.get(id).cloned().ok_or(AppError::NotOpen(id))?
    };
    if entry.format.is_none() {
        return Err(AppError::ReadOnly("it cannot be edited".into()));
    }
    let folder = entry
        .path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::Invalid("the document has no folder".into()))?;
    Ok((entry.path, folder))
}

/// What a dropped picture came to: the path to write in the link, and whether the file had to be
/// copied into `assets` to get there (false: the link points at the file where it lies).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct DroppedImage {
    pub(crate) link: String,
    pub(crate) copied: bool,
}

/// `file` as a path relative to `folder`, `/`-separated, climbing with `..` where it has to; None
/// when they are on different drives or `file` is the folder itself. Both must be resolved paths.
/// Parts compare folded where the file system ignores case, and the link keeps the file's own
/// spelling.
fn relative_link(folder: &Path, file: &Path, ignore_case: bool) -> Option<String> {
    let fold = |part: &std::ffi::OsStr| {
        let text = part.to_string_lossy().into_owned();
        if ignore_case {
            text.to_lowercase()
        } else {
            text
        }
    };
    let folder_parts: Vec<Component<'_>> = folder.components().collect();
    let file_parts: Vec<Component<'_>> = file.components().collect();
    let same = |a: &Component<'_>, b: &Component<'_>| fold(a.as_os_str()) == fold(b.as_os_str());
    let common = folder_parts
        .iter()
        .zip(&file_parts)
        .take_while(|(a, b)| same(a, b))
        .count();
    // Different drives (or shares) share no first part.
    if common == 0 || common >= file_parts.len() {
        return None;
    }
    let mut parts: Vec<String> = vec!["..".into(); folder_parts.len() - common];
    for part in &file_parts[common..] {
        match part {
            Component::Normal(name) => parts.push(name.to_string_lossy().into_owned()),
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

/// Handles a picture dropped onto the text of the open document `id`. The path must be one a native
/// drop delivered (the page is never trusted to name a file).
///
/// A file inside the document's workspace folder (the innermost one that holds the document, or
/// the document's own folder when it is in none) is linked where it lies, because the image loads
/// from there. Any other is copied into `assets` under a new name and linked there, because a path
/// outside would never load (ISC-180). A link that goes through a link or junction to a file
/// outside counts as outside: the real file is what is checked.
pub(crate) fn drop_image(
    state: &AppState,
    id: u32,
    path: &str,
    stamp: &str,
) -> Result<DroppedImage, AppError> {
    let dropped = state.drops().lookup(path)?;
    if kind_of(&dropped) != FileKind::Image {
        return Err(AppError::Invalid("not an image".into()));
    }
    let (document_path, folder) = document_for_images(state, id)?;
    let resolved_folder = std::fs::canonicalize(&folder)?;
    let resolved_file = std::fs::canonicalize(&dropped)?;
    if !resolved_file.is_file() {
        return Err(AppError::Invalid("not a file".into()));
    }

    let ignore_case = state.ignore_case();
    let key = |path: &Path| {
        let text = display_path(path);
        if ignore_case {
            text.to_lowercase()
        } else {
            text
        }
    };
    let boundary = {
        let access = state.access();
        let document = access.resolve(&document_path)?;
        // The innermost root that holds the document, as the page picks its boundary.
        access
            .roots_containing(&document)
            .into_iter()
            .filter_map(|root| std::fs::canonicalize(root).ok())
            .max_by_key(|root| display_path(root).len())
    }
    .unwrap_or_else(|| resolved_folder.clone());
    if is_inside(&key(&resolved_file), &key(&boundary))
        && let Some(link) = relative_link(&resolved_folder, &resolved_file, ignore_case)
    {
        return Ok(DroppedImage {
            link,
            copied: false,
        });
    }

    let size = std::fs::metadata(&resolved_file)?.len();
    if size > MAX_BYTES as u64 {
        return Err(AppError::Invalid("the image is too large".into()));
    }
    let bytes = std::fs::read(&resolved_file)?;
    let saved = save_into(&folder, ignore_case, stamp, &bytes)?;
    Ok(DroppedImage {
        link: saved.link,
        copied: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-pretend-pixels-";
    const STAMP: &str = "20261113-153000";

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    #[test]
    fn paste_image_saved_in_assets_next_to_the_document() {
        let dir = temp();
        let saved = save_into(dir.path(), false, STAMP, PNG).expect("saves");
        assert_eq!(saved.name, "image-20261113-153000.png");
        assert_eq!(saved.link, "assets/image-20261113-153000.png");
        let on_disk = dir.path().join("assets").join(&saved.name);
        assert_eq!(std::fs::read(on_disk).expect("the file is there"), PNG);
    }

    #[test]
    fn paste_image_saved_creates_the_folder_once_and_reuses_it() {
        let dir = temp();
        assert!(
            !dir.path().join("assets").exists(),
            "nothing before a paste"
        );
        save_into(dir.path(), false, STAMP, PNG).expect("first");
        save_into(dir.path(), false, "20261113-153001", PNG).expect("second");
        let count = std::fs::read_dir(dir.path().join("assets"))
            .expect("lists")
            .count();
        assert_eq!(count, 2);
    }

    #[test]
    fn paste_image_saved_never_overwrites_a_taken_name() {
        let dir = temp();
        std::fs::create_dir(dir.path().join("assets")).expect("creates");
        let original = dir.path().join("assets").join("image-20261113-153000.png");
        std::fs::write(&original, b"the owner's own file").expect("writes");
        let second = save_into(dir.path(), false, STAMP, PNG).expect("saves");
        assert_eq!(second.name, "image-20261113-153000-2.png");
        let third = save_into(dir.path(), false, STAMP, PNG).expect("saves");
        assert_eq!(third.name, "image-20261113-153000-3.png");
        assert_eq!(
            std::fs::read(&original).expect("still there"),
            b"the owner's own file",
            "the taken name keeps its bytes"
        );
    }

    #[test]
    fn paste_image_saved_with_the_extension_of_what_the_bytes_are() {
        let dir = temp();
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
        assert_eq!(
            save_into(dir.path(), false, STAMP, &jpeg)
                .expect("jpeg")
                .name,
            "image-20261113-153000.jpg"
        );
        assert_eq!(
            save_into(dir.path(), false, STAMP, b"GIF89a-bytes")
                .expect("gif")
                .name,
            "image-20261113-153000.gif"
        );
        assert_eq!(
            save_into(dir.path(), false, STAMP, b"RIFF\0\0\0\0WEBPVP8 ")
                .expect("webp")
                .name,
            "image-20261113-153000.webp"
        );
    }

    #[test]
    fn paste_image_saved_refuses_what_is_not_an_image() {
        let dir = temp();
        for bytes in [
            &b""[..],
            b"# a note",
            b"<svg onload=alert(1)>",
            b"MZ\x90\x00",
        ] {
            let error = save_into(dir.path(), false, STAMP, bytes).expect_err("not an image");
            assert_eq!(error.kind(), "invalid");
        }
        assert!(
            !dir.path().join("assets").exists(),
            "a refused paste creates nothing"
        );
    }

    #[test]
    fn paste_image_saved_only_with_a_stamp_that_cannot_name_a_path() {
        let dir = temp();
        for stamp in [
            "",
            "..",
            "../../x",
            "20261113_153000",
            "2026111-1153000",
            "20261113-15300",
            "20261113-1530000",
            "2026111a-153000",
            "20261113-153000/..",
        ] {
            let error = save_into(dir.path(), false, stamp, PNG).expect_err(stamp);
            assert_eq!(error.kind(), "invalid", "{stamp}");
        }
        assert!(!dir.path().join("assets").exists());
    }

    #[test]
    fn paste_image_saved_refuses_an_assets_that_is_a_file() {
        let dir = temp();
        std::fs::write(dir.path().join("assets"), b"a file").expect("writes");
        assert!(save_into(dir.path(), false, STAMP, PNG).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("assets")).expect("untouched"),
            b"a file"
        );
    }

    #[test]
    fn paste_image_saved_refuses_an_assets_that_leads_out_of_the_folder() {
        let dir = temp();
        let outside = temp();
        let document = dir.path().join("doc");
        std::fs::create_dir(&document).expect("creates");
        crate::platform::make_folder_link(outside.path(), &document.join("assets"))
            .expect("a folder link can be made here");
        let error = save_into(&document, false, STAMP, PNG).expect_err("leads out");
        assert_eq!(error.kind(), "not-allowed");
        assert_eq!(
            std::fs::read_dir(outside.path()).expect("lists").count(),
            0,
            "nothing was written outside"
        );
    }

    #[test]
    fn paste_image_saved_into_a_document_by_its_id() {
        let dir = temp();
        let file = dir.path().join("note.md");
        std::fs::write(&file, b"hello").expect("writes");
        let state = AppState::new(false);
        state.access().grant_file(&file).expect("granted");
        crate::documents::open_document(&state, &file).expect("opens");
        let id = state
            .documents()
            .entries()
            .next()
            .map(|(id, _)| id)
            .expect("one document");
        let saved = save_pasted(&state, id, STAMP, PNG).expect("saves");
        assert_eq!(saved.link, "assets/image-20261113-153000.png");
        assert!(dir.path().join("assets").join(&saved.name).is_file());
    }

    #[test]
    fn paste_image_saved_refuses_an_untitled_or_unknown_document() {
        let state = AppState::new(false);
        let untitled = state.documents().register_untitled();
        assert_eq!(
            save_pasted(&state, untitled, STAMP, PNG)
                .expect_err("no folder")
                .kind(),
            "invalid"
        );
        assert_eq!(
            save_pasted(&state, 999, STAMP, PNG)
                .expect_err("not open")
                .kind(),
            "not-open"
        );
    }

    /// A state with `root` granted as a workspace folder, the document `rel` below it open, and
    /// the id of that document.
    fn open_in(root: &Path, rel: &str) -> (AppState, u32) {
        let file = root.join(rel);
        std::fs::create_dir_all(file.parent().expect("a parent")).expect("creates");
        std::fs::write(&file, b"hello").expect("writes");
        let state = AppState::new(false);
        state.access().grant_root(root).expect("granted");
        crate::documents::open_document(&state, &file).expect("opens");
        let id = state
            .documents()
            .entries()
            .next()
            .map(|(id, _)| id)
            .expect("one document");
        (state, id)
    }

    fn dropped(state: &AppState, path: &Path) -> String {
        state
            .drops()
            .record(std::slice::from_ref(&path.to_path_buf()));
        path.to_string_lossy().into_owned()
    }

    fn write_png(path: &Path) {
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("creates");
        std::fs::write(path, PNG).expect("writes");
    }

    #[test]
    fn drop_image_links_a_file_inside_the_workspace_where_it_lies() {
        let dir = temp();
        let (state, id) = open_in(dir.path(), "notes/a.md");
        for (rel, link) in [
            ("notes/pic.png", "pic.png"),
            ("notes/sub/deep pic (1).png", "sub/deep pic (1).png"),
            ("img/p.png", "../img/p.png"),
            ("p.png", "../p.png"),
        ] {
            let file = dir.path().join(rel);
            write_png(&file);
            let text = dropped(&state, &file);
            let done = drop_image(&state, id, &text, STAMP).expect(rel);
            assert_eq!(
                done,
                DroppedImage {
                    link: link.into(),
                    copied: false
                },
                "{rel}"
            );
        }
        assert!(
            !dir.path().join("notes/assets").exists(),
            "nothing was copied for a file inside the workspace"
        );
    }

    #[test]
    fn drop_image_copies_a_file_outside_the_workspace_into_assets() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "notes/a.md");
        let file = outside.path().join("holiday.png");
        write_png(&file);
        let text = dropped(&state, &file);
        let done = drop_image(&state, id, &text, STAMP).expect("copies");
        assert_eq!(
            done,
            DroppedImage {
                link: "assets/image-20261113-153000.png".into(),
                copied: true
            }
        );
        let copy = dir.path().join("notes/assets/image-20261113-153000.png");
        assert_eq!(std::fs::read(copy).expect("copied"), PNG);
        assert!(file.is_file(), "the original is left where it was");
    }

    #[test]
    fn drop_image_in_a_document_in_no_workspace_links_only_inside_its_own_folder() {
        let dir = temp();
        let outside = temp();
        let file = dir.path().join("notes/a.md");
        std::fs::create_dir_all(file.parent().expect("a parent")).expect("creates");
        std::fs::write(&file, b"x").expect("writes");
        let state = AppState::new(false);
        state.access().grant_file(&file).expect("granted");
        crate::documents::open_document(&state, &file).expect("opens");
        let id = state
            .documents()
            .entries()
            .next()
            .map(|(id, _)| id)
            .expect("one");

        let beside = dir.path().join("notes/img/p.png");
        write_png(&beside);
        let text = dropped(&state, &beside);
        assert_eq!(
            drop_image(&state, id, &text, STAMP).expect("beside").link,
            "img/p.png"
        );
        // A neighbour folder is outside the document's folder, so it is copied.
        let sibling = dir.path().join("other/p.png");
        write_png(&sibling);
        let text = dropped(&state, &sibling);
        assert!(
            drop_image(&state, id, &text, STAMP)
                .expect("sibling")
                .copied
        );
        let far = outside.path().join("p.png");
        write_png(&far);
        let text = dropped(&state, &far);
        assert!(
            drop_image(&state, id, &text, "20261113-153001")
                .expect("far")
                .copied
        );
    }

    #[test]
    fn drop_image_uses_the_innermost_workspace_folder_the_page_does() {
        let dir = temp();
        let (state, id) = open_in(dir.path(), "outer/inner/a.md");
        let inner = dir.path().join("outer/inner");
        state.access().grant_root(&inner).expect("inner root");
        // Inside the outer root but outside the inner one, the folder the page lets links climb to.
        let file = dir.path().join("outer/pics/p.png");
        write_png(&file);
        let text = dropped(&state, &file);
        assert!(drop_image(&state, id, &text, STAMP).expect("copies").copied);
    }

    #[test]
    fn drop_image_refuses_a_path_no_drop_delivered_and_a_file_that_is_not_an_image() {
        let dir = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        let never = dir.path().join("never.png");
        write_png(&never);
        assert_eq!(
            drop_image(&state, id, &never.to_string_lossy(), STAMP)
                .expect_err("not dropped")
                .kind(),
            "not-allowed"
        );
        let text = dir.path().join("notes.txt");
        std::fs::write(&text, b"hi").expect("writes");
        let named = dropped(&state, &text);
        assert_eq!(
            drop_image(&state, id, &named, STAMP)
                .expect_err("not an image")
                .kind(),
            "invalid"
        );
        assert!(!dir.path().join("assets").exists(), "nothing was written");
    }

    #[test]
    fn drop_image_refuses_an_untitled_document_and_an_unknown_one() {
        let dir = temp();
        let file = dir.path().join("p.png");
        write_png(&file);
        let state = AppState::new(false);
        let text = dropped(&state, &file);
        let untitled = state.documents().register_untitled();
        assert_eq!(
            drop_image(&state, untitled, &text, STAMP)
                .expect_err("no folder")
                .kind(),
            "invalid"
        );
        assert_eq!(
            drop_image(&state, 999, &text, STAMP)
                .expect_err("not open")
                .kind(),
            "not-open"
        );
    }

    #[test]
    fn drop_image_treats_a_link_to_a_file_outside_the_workspace_as_outside() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        write_png(&outside.path().join("p.png"));
        let junction = dir.path().join("gate");
        crate::platform::make_folder_link(outside.path(), &junction)
            .expect("a folder link can be made here");
        let text = dropped(&state, &junction.join("p.png"));
        let done = drop_image(&state, id, &text, STAMP).expect("copies");
        assert!(
            done.copied,
            "the real file is outside, whatever the path says"
        );
        assert_eq!(done.link, "assets/image-20261113-153000.png");
    }

    #[test]
    fn drop_image_never_overwrites_and_keeps_the_original() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        let file = outside.path().join("p.png");
        write_png(&file);
        let text = dropped(&state, &file);
        let first = drop_image(&state, id, &text, STAMP).expect("first");
        let second = drop_image(&state, id, &text, STAMP).expect("second");
        assert_eq!(first.link, "assets/image-20261113-153000.png");
        assert_eq!(second.link, "assets/image-20261113-153000-2.png");
    }

    #[test]
    fn drop_image_relative_links_fold_case_only_where_the_file_system_does() {
        let one = Path::new("/w/Notes");
        let two = Path::new("/w/notes/pic.png");
        assert_eq!(relative_link(one, two, true).as_deref(), Some("pic.png"));
        assert_eq!(
            relative_link(one, two, false).as_deref(),
            Some("../notes/pic.png")
        );
        assert_eq!(
            relative_link(one, one, true),
            None,
            "the folder itself is not a file in it"
        );
    }
}
