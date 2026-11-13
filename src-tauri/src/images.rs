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
    /// True when a file with exactly these bytes was already in the folder and nothing was written:
    /// the link points at that file. Its owner is not this call, so nobody may remove it again.
    #[serde(skip)]
    pub(crate) reused: bool,
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

/// The name, without its extension, of a picture that has no name of its own (a pasted one):
/// `image-YYYYMMDD-HHMMSS`.
pub(crate) fn stamp_stem(stamp: &str) -> Result<String, AppError> {
    if valid_stamp(stamp) {
        Ok(format!("image-{stamp}"))
    } else {
        Err(AppError::Invalid("bad image name stamp".into()))
    }
}

/// The longest name, without its extension, that is made from a dropped file's own name.
const MAX_STEM: usize = 100;

/// Characters a copied picture's name never keeps. The first nine are the ones Windows forbids in a
/// file name; `#`, `%` and `&` are legal there but would need escaping in a link or in an `<img>`
/// tag, and the name is written into the document as it is.
fn forbidden_in_name(c: char) -> bool {
    c.is_control()
        // Invisible characters that reorder or hide text, so a name cannot pose as another.
        || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
        || matches!(
            c,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '#' | '%' | '&'
        )
}

/// Names Windows keeps for devices, with or without an extension (`con.png` is `con`).
fn reserved_name(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or_default().trim_end();
    let upper = base.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            upper
                .strip_prefix(prefix)
                .is_some_and(|rest| matches!(rest.as_bytes(), [b'1'..=b'9']))
        })
}

/// A name, without its extension, that is safe to create and to write into a link as it is.
pub(crate) fn clean_stem(stem: &str) -> bool {
    !stem.is_empty()
        && !stem.chars().any(forbidden_in_name)
        && !stem.ends_with(['.', ' '])
        && !reserved_name(stem)
}

/// The name a copied picture keeps from the file it was dropped as: its own name, minus what
/// cannot stay (see `forbidden_in_name`), cut to 100 characters, with a name Windows keeps for a
/// device made into another one. Empty when the file had no name to keep. Spaces, dots inside the
/// name and non-ASCII letters stay: the link handles them.
pub(crate) fn safe_stem(original: &str) -> String {
    let mut stem: String = original
        .chars()
        .map(|c| if forbidden_in_name(c) { '-' } else { c })
        .take(MAX_STEM)
        .collect();
    // A name cannot end in a dot or a space on Windows, and a cut can leave one.
    let kept = stem.trim_end_matches(['.', ' ']).len();
    let trailing = stem.len() - kept;
    stem.truncate(kept);
    stem.push_str(&"-".repeat(trailing));
    if reserved_name(&stem) {
        stem = format!("image-{stem}");
    }
    stem
}

/// Writes `bytes` as a new file in `folder/IMAGES_FOLDER`, creating that folder on the first use,
/// unless a file with exactly these bytes is already there: then nothing is written and the link
/// is to that file (`reused`). A name that is taken by another image gets `-2`, `-3`, and a file
/// that is there is never opened for writing: the file is created in the same step that checks the
/// name, so two pastes in one second cannot meet.
///
/// `stem` is the name without its extension, which comes from what the bytes are. `folder` is the
/// folder of the document, already resolved. A `assets` that is not a folder, or that leads out of
/// `folder` (a link or junction), is refused: an image saved there would not load, and the write
/// would reach a place the document does not own.
pub(crate) fn save_into(
    folder: &Path,
    ignore_case: bool,
    stem: &str,
    bytes: &[u8],
) -> Result<SavedImage, AppError> {
    save_into_where(folder, ignore_case, stem, bytes, |_| true)
}

/// [`save_into`], reusing an identical file only when `may_reuse` accepts its name.
pub(crate) fn save_into_where(
    folder: &Path,
    ignore_case: bool,
    stem: &str,
    bytes: &[u8],
    may_reuse: impl Fn(&str) -> bool,
) -> Result<SavedImage, AppError> {
    if !clean_stem(stem) {
        return Err(AppError::Invalid("bad image name".into()));
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

    // The same picture dropped or pasted again is the same file: one image, one copy.
    if let Some(name) = find_identical(&resolved, bytes, may_reuse) {
        return Ok(SavedImage {
            link: format!("{IMAGES_FOLDER}/{name}"),
            name,
            reused: true,
        });
    }

    let ext = kind.extension();
    for attempt in 1..=MAX_SUFFIX {
        let name = if attempt == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}-{attempt}.{ext}")
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
            reused: false,
        });
    }
    Err(AppError::Exists(format!("{stem}.{ext}")))
}

/// How many entries of `assets` are looked at for a copy of an image; no folder holds anywhere near
/// it, and a folder that does is not worth reading in full on every paste.
const MAX_COMPARED: usize = 20_000;

/// The name of a file in `images` that holds exactly `bytes`, and that `may_reuse` accepts. Only
/// plain files are looked at (a link is never followed), and only those of the same size are read.
fn find_identical(images: &Path, bytes: &[u8], may_reuse: impl Fn(&str) -> bool) -> Option<String> {
    let mut names: Vec<String> = std::fs::read_dir(images)
        .ok()?
        .flatten()
        .take(MAX_COMPARED)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter(|entry| {
            entry
                .metadata()
                .is_ok_and(|meta| meta.len() == bytes.len() as u64)
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| may_reuse(name))
        .collect();
    // The same answer every time, whatever order the file system lists in.
    names.sort();
    names
        .into_iter()
        .find(|name| std::fs::read(images.join(name)).is_ok_and(|held| held == bytes))
}

/// Saves an image pasted into the open document `id`, next to its file.
///
/// A document with no file puts `assets` in its draft folder (`drafts.rs`), and a read-only one takes
/// no pasted text, so it is refused.
pub(crate) fn save_pasted(
    state: &AppState,
    id: u32,
    stamp: &str,
    bytes: &[u8],
) -> Result<SavedImage, AppError> {
    let stem = stamp_stem(stamp)?;
    let home = document_for_images(state, id)?;
    save_into(&home.folder, state.ignore_case(), &stem, bytes)
}

/// Where the images of a document go.
pub(crate) struct ImageHome {
    /// The document's file, or `None` for an untitled document, which has a draft folder instead.
    pub(crate) file: Option<PathBuf>,
    /// The folder `assets` goes in, as it really is on disk.
    pub(crate) folder: PathBuf,
}

/// The folder `assets` goes in for the open document `id`: beside its file, or in the draft folder
/// of an untitled document (made now, since it is only made when the first image comes). Refused for
/// a document that cannot be edited and for an unknown id.
pub(crate) fn document_for_images(state: &AppState, id: u32) -> Result<ImageHome, AppError> {
    let entry = {
        let documents = state.documents();
        if let Some(number) = documents.untitled_number(id) {
            drop(documents);
            return Ok(ImageHome {
                file: None,
                folder: state.drafts().ensure(number)?,
            });
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
    Ok(ImageHome {
        file: Some(entry.path),
        folder,
    })
}

/// What a dropped picture came to: the path to write in the link, and whether the link goes to a
/// copy in `assets` (true: a copy made now, or one of the same bytes that was already there) or
/// points at the file where it lies (false).
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
/// from there. Any other is copied into `assets`, under its own name, and linked there, because a
/// path outside would never load (ISC-180). The same picture dropped again is not copied again: the
/// link goes to the file that is already there. A link that goes through a link or junction to a file
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
    let home = document_for_images(state, id)?;
    let folder = home.folder;
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
    // An untitled document has no workspace: its draft folder is the whole of what it may link to,
    // so a dropped picture is always copied there.
    let boundary = match &home.file {
        Some(document_path) => {
            let access = state.access();
            let document = access.resolve(document_path)?;
            // The innermost root that holds the document, as the page picks its boundary.
            access
                .roots_containing(&document)
                .into_iter()
                .filter_map(|root| std::fs::canonicalize(root).ok())
                .max_by_key(|root| display_path(root).len())
        }
        None => None,
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
    // The copy keeps the file's own name, as the owner dropped it; a file with no usable name is
    // named like a pasted one. The name comes from the path the drop delivered, not from the page.
    let own = dropped
        .file_stem()
        .map(|stem| safe_stem(&stem.to_string_lossy()))
        .unwrap_or_default();
    let stem = if own.is_empty() {
        stamp_stem(stamp)?
    } else {
        own
    };
    let saved = save_into(&folder, ignore_case, &stem, &bytes)?;
    Ok(DroppedImage {
        link: saved.link,
        // True also when the copy was already there: the link goes to `assets`, not to the original.
        copied: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-pretend-pixels-";
    /// Another picture: the same bytes are the same picture, so tests that mean two need two.
    const PNG_B: &[u8] = b"\x89PNG\r\n\x1a\n-pretend-pixelsB";
    const STAMP: &str = "20261113-153000";
    const STEM: &str = "image-20261113-153000";

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    #[test]
    fn paste_image_saved_in_assets_next_to_the_document() {
        let dir = temp();
        let saved = save_into(dir.path(), false, STEM, PNG).expect("saves");
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
        save_into(dir.path(), false, STEM, PNG).expect("first");
        save_into(dir.path(), false, "image-20261113-153001", PNG_B).expect("second");
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
        let second = save_into(dir.path(), false, STEM, PNG).expect("saves");
        assert_eq!(second.name, "image-20261113-153000-2.png");
        let third = save_into(dir.path(), false, STEM, PNG_B).expect("saves");
        assert_eq!(third.name, "image-20261113-153000-3.png");
        assert_eq!(
            std::fs::read(&original).expect("still there"),
            b"the owner's own file",
            "the taken name keeps its bytes"
        );
    }

    #[test]
    fn paste_image_saved_twice_is_one_file() {
        let dir = temp();
        let first = save_into(dir.path(), false, STEM, PNG).expect("first");
        assert!(!first.reused);
        // The same bytes a second later, and under another name: still the one file.
        let second = save_into(dir.path(), false, "image-20261113-153001", PNG).expect("second");
        assert!(second.reused);
        assert_eq!(second.link, first.link);
        assert_eq!(
            std::fs::read_dir(dir.path().join("assets"))
                .expect("lists")
                .count(),
            1
        );
    }

    #[test]
    fn paste_image_saved_reuses_a_file_the_owner_put_there_under_any_name() {
        let dir = temp();
        std::fs::create_dir(dir.path().join("assets")).expect("creates");
        std::fs::write(dir.path().join("assets").join("my cat.png"), PNG).expect("writes");
        let saved = save_into(dir.path(), false, STEM, PNG).expect("saves");
        assert!(saved.reused);
        assert_eq!(saved.link, "assets/my cat.png");
    }

    #[test]
    fn paste_image_saved_with_the_same_size_but_other_bytes_is_a_new_file() {
        let dir = temp();
        assert_eq!(PNG.len(), PNG_B.len(), "the test needs equal sizes");
        save_into(dir.path(), false, STEM, PNG).expect("first");
        let other = save_into(dir.path(), false, STEM, PNG_B).expect("second");
        assert!(!other.reused);
        assert_eq!(other.name, "image-20261113-153000-2.png");
    }

    #[test]
    fn paste_image_saved_never_reuses_a_refused_image() {
        let dir = temp();
        std::fs::create_dir(dir.path().join("assets")).expect("creates");
        std::fs::write(dir.path().join("assets").join("note.png"), b"# a note").expect("writes");
        let error = save_into(dir.path(), false, STEM, b"# a note").expect_err("not an image");
        assert_eq!(error.kind(), "invalid");
    }

    #[test]
    fn paste_image_saved_looks_for_a_copy_only_among_files_of_the_folder() {
        let dir = temp();
        std::fs::create_dir_all(dir.path().join("assets").join("sub")).expect("creates");
        std::fs::write(dir.path().join("assets").join("sub").join("p.png"), PNG).expect("writes");
        let saved = save_into(dir.path(), false, STEM, PNG).expect("saves");
        assert!(!saved.reused, "a file in a folder below is not looked at");
    }

    #[test]
    fn paste_image_saved_with_the_extension_of_what_the_bytes_are() {
        let dir = temp();
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
        assert_eq!(
            save_into(dir.path(), false, STEM, &jpeg)
                .expect("jpeg")
                .name,
            "image-20261113-153000.jpg"
        );
        assert_eq!(
            save_into(dir.path(), false, STEM, b"GIF89a-bytes")
                .expect("gif")
                .name,
            "image-20261113-153000.gif"
        );
        assert_eq!(
            save_into(dir.path(), false, STEM, b"RIFF\0\0\0\0WEBPVP8 ")
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
            let error = save_into(dir.path(), false, STEM, bytes).expect_err("not an image");
            assert_eq!(error.kind(), "invalid");
        }
        assert!(
            !dir.path().join("assets").exists(),
            "a refused paste creates nothing"
        );
    }

    #[test]
    fn paste_image_saved_only_with_a_stamp_that_cannot_name_a_path() {
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
            let error = stamp_stem(stamp).expect_err(stamp);
            assert_eq!(error.kind(), "invalid", "{stamp}");
        }
        assert_eq!(stamp_stem(STAMP).expect("a good stamp"), STEM);
    }

    #[test]
    fn paste_image_saved_only_under_a_name_that_cannot_name_a_path() {
        let dir = temp();
        for stem in [
            "", "..", "../x", "a/b", "a\\b", "a:b", "cat.", "cat ", "con", "NUL.x", "a#b", "a%b",
        ] {
            let error = save_into(dir.path(), false, stem, PNG).expect_err(stem);
            assert_eq!(error.kind(), "invalid", "{stem}");
        }
        assert!(!dir.path().join("assets").exists());
    }

    #[test]
    fn paste_image_saved_refuses_an_assets_that_is_a_file() {
        let dir = temp();
        std::fs::write(dir.path().join("assets"), b"a file").expect("writes");
        assert!(save_into(dir.path(), false, STEM, PNG).is_err());
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
        let error = save_into(&document, false, STEM, PNG).expect_err("leads out");
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

    /// A state whose drafts live in `dir`.
    fn state_with_drafts(dir: &Path) -> AppState {
        let state = AppState::new(false);
        state.drafts().set_root(dir.join("drafts"));
        state
    }

    #[test]
    fn draft_images_paste_into_an_untitled_document_lands_in_its_draft_folder() {
        let dir = temp();
        let state = state_with_drafts(dir.path());
        let id = state
            .documents()
            .register_untitled_numbered(3)
            .expect("number 3");
        let saved = save_pasted(&state, id, STAMP, PNG).expect("saves");
        assert_eq!(saved.link, "assets/image-20261113-153000.png");
        let file = dir
            .path()
            .join("drafts")
            .join("3")
            .join("assets")
            .join(&saved.name);
        assert_eq!(std::fs::read(file).expect("written"), PNG);
        // The same picture again is the same file; another one in the same second does not
        // replace it.
        let same = save_pasted(&state, id, STAMP, PNG).expect("saves");
        assert_eq!(same.link, "assets/image-20261113-153000.png");
        let again = save_pasted(&state, id, STAMP, PNG_B).expect("saves");
        assert_eq!(again.link, "assets/image-20261113-153000-2.png");
        // Another untitled document has a folder of its own.
        let other = state
            .documents()
            .register_untitled_numbered(4)
            .expect("number 4");
        let there = save_pasted(&state, other, STAMP, PNG).expect("saves");
        assert_eq!(there.link, "assets/image-20261113-153000.png");
        assert!(dir.path().join("drafts").join("4").join("assets").is_dir());
    }

    #[test]
    fn draft_images_paste_without_a_draft_folder_set_up_is_refused() {
        let state = AppState::new(false);
        let untitled = state.documents().register_untitled();
        assert_eq!(
            save_pasted(&state, untitled, STAMP, PNG)
                .expect_err("no folder")
                .kind(),
            "invalid"
        );
    }

    #[test]
    fn paste_image_saved_refuses_an_unknown_document() {
        let state = AppState::new(false);
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
                link: "assets/holiday.png".into(),
                copied: true
            }
        );
        let copy = dir.path().join("notes/assets/holiday.png");
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
    fn draft_images_a_dropped_picture_is_copied_into_the_draft_folder_whatever_it_is() {
        let dir = temp();
        let outside = temp();
        let state = state_with_drafts(dir.path());
        // Even a file inside a workspace folder is copied: an untitled document has no workspace.
        state.access().grant_root(outside.path()).expect("granted");
        let file = outside.path().join("p.png");
        write_png(&file);
        let text = dropped(&state, &file);
        let id = state
            .documents()
            .register_untitled_numbered(2)
            .expect("number 2");
        let got = drop_image(&state, id, &text, STAMP).expect("copied");
        assert!(got.copied);
        assert_eq!(got.link, "assets/p.png");
        assert!(
            dir.path()
                .join("drafts")
                .join("2")
                .join("assets")
                .join("p.png")
                .is_file()
        );
    }

    #[test]
    fn drop_image_refuses_an_unknown_document() {
        let dir = temp();
        let file = dir.path().join("p.png");
        write_png(&file);
        let state = AppState::new(false);
        let text = dropped(&state, &file);
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
        assert_eq!(done.link, "assets/p.png");
    }

    #[test]
    fn drop_image_dropped_ten_times_is_one_file_and_the_original_stays() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        let file = outside.path().join("p.png");
        write_png(&file);
        let text = dropped(&state, &file);
        for _ in 0..10 {
            let done = drop_image(&state, id, &text, STAMP).expect("drops");
            assert_eq!(done.link, "assets/p.png");
        }
        assert_eq!(
            std::fs::read_dir(dir.path().join("assets"))
                .expect("lists")
                .count(),
            1
        );
        assert_eq!(std::fs::read(&file).expect("the original"), PNG);
    }

    #[test]
    fn drop_image_the_same_picture_under_another_name_is_still_one_file() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        let one = outside.path().join("cat.png");
        let two = outside.path().join("copy of cat.png");
        write_png(&one);
        write_png(&two);
        let first = drop_image(&state, id, &dropped(&state, &one), STAMP).expect("first");
        let second = drop_image(&state, id, &dropped(&state, &two), STAMP).expect("second");
        assert_eq!(first.link, "assets/cat.png");
        assert_eq!(second.link, "assets/cat.png");
    }

    #[test]
    fn drop_image_another_picture_with_the_same_name_gets_a_number() {
        let dir = temp();
        let outside = temp();
        let other = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        let one = outside.path().join("cat.png");
        let two = other.path().join("cat.png");
        write_png(&one);
        std::fs::write(&two, PNG_B).expect("writes");
        let first = drop_image(&state, id, &dropped(&state, &one), STAMP).expect("first");
        let second = drop_image(&state, id, &dropped(&state, &two), STAMP).expect("second");
        assert_eq!(first.link, "assets/cat.png");
        assert_eq!(second.link, "assets/cat-2.png");
    }

    #[test]
    fn drop_image_keeps_the_dropped_files_name_cleaned_for_a_link() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        for (given, kept) in [
            ("my cat (1).png", "my cat (1).png"),
            ("Café ünï.png", "Café ünï.png"),
            ("a#b%c&d.png", "a-b-c-d.png"),
            ("trailing.. .png", "trailing---.png"),
            ("UPPER.PNG", "UPPER.png"),
        ] {
            let file = outside.path().join(given);
            write_png(&file);
            // One picture under several names would be one file, so each gets its own bytes.
            let mut bytes = PNG.to_vec();
            bytes.extend_from_slice(given.as_bytes());
            std::fs::write(&file, bytes).expect("writes");
            let done = drop_image(&state, id, &dropped(&state, &file), STAMP).expect(given);
            assert_eq!(done.link, format!("assets/{kept}"), "{given}");
        }
    }

    #[test]
    fn drop_image_names_the_extension_after_what_the_bytes_are() {
        let dir = temp();
        let outside = temp();
        let (state, id) = open_in(dir.path(), "a.md");
        let file = outside.path().join("photo.png");
        std::fs::write(&file, [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).expect("writes");
        let done = drop_image(&state, id, &dropped(&state, &file), STAMP).expect("copies");
        assert_eq!(done.link, "assets/photo.jpg");
    }

    #[test]
    fn drop_image_into_an_untitled_document_twice_is_one_file() {
        let dir = temp();
        let outside = temp();
        let state = state_with_drafts(dir.path());
        let file = outside.path().join("p.png");
        write_png(&file);
        let id = state
            .documents()
            .register_untitled_numbered(2)
            .expect("number 2");
        let text = dropped(&state, &file);
        drop_image(&state, id, &text, STAMP).expect("first");
        let again = drop_image(&state, id, &text, STAMP).expect("again");
        assert_eq!(again.link, "assets/p.png");
        assert_eq!(
            std::fs::read_dir(dir.path().join("drafts").join("2").join("assets"))
                .expect("lists")
                .count(),
            1
        );
    }

    #[test]
    fn name_rules_safe_stem_keeps_what_can_stay_and_nothing_else() {
        assert_eq!(safe_stem("cat"), "cat");
        assert_eq!(safe_stem("my cat (1)"), "my cat (1)");
        assert_eq!(safe_stem("a<b>c:d\"e/f\\g|h?i*j"), "a-b-c-d-e-f-g-h-i-j");
        assert_eq!(safe_stem("tab\there"), "tab-here");
        assert_eq!(safe_stem("1.2.3 final"), "1.2.3 final");
        assert_eq!(safe_stem("end. "), "end--");
        assert_eq!(safe_stem(""), "");
        assert_eq!(safe_stem("COM1"), "image-COM1");
        assert_eq!(safe_stem("lpt9.backup"), "image-lpt9.backup");
        assert_eq!(safe_stem("com10"), "com10", "COM10 is not a device name");
        assert_eq!(safe_stem("console"), "console");
        let long = "x".repeat(250);
        assert_eq!(safe_stem(&long).chars().count(), MAX_STEM);
        // A cut that ends on a space must not leave one.
        let cut = format!("{} y", "x".repeat(MAX_STEM - 1));
        assert!(clean_stem(&safe_stem(&cut)));
        assert_eq!(safe_stem("x\u{202e}y"), "x-y");
        for name in ["?", ". ", "..."] {
            let stem = safe_stem(name);
            assert!(stem.is_empty() || clean_stem(&stem), "{name:?} -> {stem:?}");
        }
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
