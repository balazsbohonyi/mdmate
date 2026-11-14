//! Draft folders: where the images of a document with no file yet are kept (P9-T5).
//!
//! An untitled document has no folder of its own to put `assets` next to, so each one gets
//! `<data folder>/drafts/<n>/`, `n` being the number in its name (`Untitled-3`), which the session
//! stores and brings back. A pasted or copied image goes to `drafts/<n>/assets/` and is linked
//! with the same relative link as anywhere else; for loading images that draft folder is the
//! document's folder. The first Save As copies the images the text uses beside the saved file; the
//! draft goes when its tab is finally closed, and a start-up sweep removes any that no tab holds.
//!
//! This module deletes folders, so every path it removes is built here from a validated number,
//! never taken from the page, and nothing that is a link is ever followed or removed through.

use crate::access::{display_path, is_inside};
use crate::error::AppError;
use crate::images::{IMAGES_FOLDER, clean_stem, save_into_where};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The folder of the drafts, set once the data folder is known.
#[derive(Debug, Default)]
pub(crate) struct Drafts {
    root: OnceLock<PathBuf>,
}

/// An image copied by [`adopt`], for the caller to take back if the save that follows fails.
#[derive(Debug, Default)]
pub(crate) struct Adopted {
    /// The text with the links of renamed images updated.
    pub(crate) text: String,
    /// Draft file name to the name it got beside the saved file, only where they differ.
    pub(crate) renames: BTreeMap<String, String>,
    /// The files that were created, so a failed save can remove them again.
    pub(crate) created: Vec<PathBuf>,
}

/// Fewer than this many images are looked at in one draft; no draft holds anywhere near it.
const MAX_IMAGES: usize = 10_000;

impl Drafts {
    pub(crate) fn set_root(&self, root: PathBuf) {
        let _ = self.root.set(root);
    }

    fn root(&self) -> Result<&Path, AppError> {
        self.root
            .get()
            .map(PathBuf::as_path)
            .ok_or_else(|| AppError::Invalid("the draft folder is not set up".into()))
    }

    /// The draft folder of untitled document `number`, which may not exist yet.
    pub(crate) fn folder(&self, number: u32) -> Result<PathBuf, AppError> {
        if number == 0 {
            return Err(AppError::Invalid("a draft number starts at 1".into()));
        }
        Ok(self.root()?.join(number.to_string()))
    }

    /// The draft folder of `number`, created when it is not there, as it really is on disk. Refuses a
    /// `drafts` folder or a draft folder that is a link, which would lead out of the data folder.
    pub(crate) fn ensure(&self, number: u32) -> Result<PathBuf, AppError> {
        let root = self.root()?;
        match std::fs::symlink_metadata(root) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err(AppError::NotAllowed(
                    "the draft folder is not a folder".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir_all(root)?;
            }
            Err(error) => return Err(error.into()),
        }
        let folder = self.folder(number)?;
        match std::fs::symlink_metadata(&folder) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err(AppError::NotAllowed(
                    "a draft folder is not a folder".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match std::fs::create_dir(&folder) {
                    Ok(()) => {}
                    // Made by another call a moment ago, which is as good as making it.
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
            }
            Err(error) => return Err(error.into()),
        }
        Ok(std::fs::canonicalize(folder)?)
    }

    /// Whether the draft folder of `number` is on disk.
    pub(crate) fn exists(&self, number: u32) -> bool {
        self.folder(number)
            .ok()
            .and_then(|folder| std::fs::symlink_metadata(folder).ok())
            .is_some_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
    }

    /// Removes the draft folder of `number`. A folder that is a link is left alone, and so is
    /// anything that fails to go: the next start-up sweep tries again.
    pub(crate) fn remove(&self, number: u32) -> bool {
        remove_draft(self.root().ok(), &self.folder(number).ok())
    }

    /// Removes every draft folder whose number is not in `keep`. Only a direct child of the draft
    /// folder whose name is a plain number is looked at, and one that is a link is never entered.
    /// Returns how many were removed.
    pub(crate) fn sweep(&self, keep: &HashSet<u32>) -> usize {
        let Ok(root) = self.root() else { return 0 };
        let root_is_plain = std::fs::symlink_metadata(root)
            .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink());
        if !root_is_plain {
            return 0;
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            return 0;
        };
        let mut removed = 0;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(number) = name.parse::<u32>() else {
                continue;
            };
            // `007` and `+7` parse but are not a number this module ever made.
            if number == 0 || number.to_string() != name || keep.contains(&number) {
                continue;
            }
            if remove_draft(Some(root), &Some(entry.path())) {
                removed += 1;
            }
        }
        removed
    }

    /// Whether `path` (a file that may not exist yet) is inside the draft folder, so a save there
    /// would be deleted with its draft.
    pub(crate) fn holds(&self, path: &Path, ignore_case: bool) -> bool {
        let Ok(root) = self.root() else { return false };
        // The nearest part that exists is resolved; what is below it cannot be a link to anywhere.
        let mut probe = path;
        let resolved = loop {
            if let Ok(done) = std::fs::canonicalize(probe) {
                break done;
            }
            match probe.parent() {
                Some(parent) => probe = parent,
                None => return false,
            }
        };
        let Ok(root) = std::fs::canonicalize(root) else {
            return false;
        };
        let key = |path: &Path| {
            let text = display_path(path);
            if ignore_case {
                text.to_lowercase()
            } else {
                text
            }
        };
        is_inside(&key(&resolved), &key(&root))
    }
}

/// Removes `folder` when it is a plain folder directly inside `root`, which is itself not a link.
fn remove_draft(root: Option<&Path>, folder: &Option<PathBuf>) -> bool {
    let (Some(root), Some(folder)) = (root, folder) else {
        return false;
    };
    if folder.parent() != Some(root) {
        return false;
    }
    let plain = |path: &Path| {
        std::fs::symlink_metadata(path)
            .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
    };
    plain(root) && plain(folder) && std::fs::remove_dir_all(folder).is_ok()
}

/// Whether `c` could be part of a path or a name, so a link found next to it is a different link.
fn name_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-')
}

/// Where each of `names` is used as `assets/<name>` in `text`: `(start of the name, its end, which
/// name)`. A use is `assets/` after a character that is not part of a path (or after `./` that
/// follows one), and the name up to a character that is not part of a name, so `myassets/a.png`,
/// `../assets/a.png` and `assets/a.png2` are other links. Both sides of every use are the same in
/// the page, which has the same rule (`draftLinks.ts`); one fixture holds the cases for both.
pub(crate) fn link_uses<'a>(
    text: &str,
    names: impl IntoIterator<Item = &'a str> + Clone,
) -> Vec<(usize, usize, &'a str)> {
    let prefix = format!("{IMAGES_FOLDER}/");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(offset) = text[from..].find(&prefix) {
        let at = from + offset;
        from = at + 1;
        let before = &text[..at];
        // `./assets/` counts, as long as what is before the `./` is not part of a path.
        let boundary = if let Some(rest) = before.strip_suffix("./") {
            rest.chars().next_back().is_none_or(|c| !path_char(c))
        } else {
            before.chars().next_back().is_none_or(|c| !path_char(c))
        };
        if !boundary {
            continue;
        }
        let start = at + prefix.len();
        for name in names.clone() {
            if !text[start..].starts_with(name) {
                continue;
            }
            let end = start + name.len();
            let mut after = text[end..].chars();
            let ends_here = match after.next() {
                None => true,
                Some('.') => after.next().is_none_or(|c| !c.is_alphanumeric()),
                Some(c) => !name_char(c),
            };
            if ends_here {
                found.push((start, end, name));
                break;
            }
        }
    }
    found
}

/// Characters that make `assets/` part of a longer path rather than the start of a link.
fn path_char(c: char) -> bool {
    name_char(c) || matches!(c, '.' | '/' | '\\' | ':')
}

/// `text` with each use of a renamed image's link pointing at its new name, all in one pass, so a
/// name that is another's new name is not renamed twice.
pub(crate) fn rewrite_links(text: &str, renames: &BTreeMap<String, String>) -> String {
    if renames.is_empty() {
        return text.to_owned();
    }
    let uses = link_uses(text, renames.keys().map(String::as_str));
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (start, end, name) in uses {
        out.push_str(&text[last..start]);
        out.push_str(renames.get(name).map_or(name, String::as_str));
        last = end;
    }
    out.push_str(&text[last..]);
    out
}

/// The name of a draft image without its extension (`cat` for `cat.png`), or `None` when the file
/// is not one of the four kinds of image this app saves or its name is not one the app would make.
fn image_stem(name: &str) -> Option<&str> {
    let (stem, extension) = name.rsplit_once('.')?;
    let known = ["png", "jpg", "gif", "webp"]
        .iter()
        .any(|known| extension.eq_ignore_ascii_case(known));
    (known && clean_stem(stem)).then_some(stem)
}

/// Whether a name can be written into a link as it is: letters, digits, `-`, `_` and `.` only, no
/// space or bracket that would make the link need `<...>`.
fn plain_name(name: &str) -> bool {
    name.chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Copies the images of draft `number` that `text` links to into `target_folder/assets`, under the
/// names they had when those are free and `-2`, `-3` when they are not, and returns the text with
/// the links of the renamed ones updated. An image whose bytes are already in that folder under
/// another name is not copied: the links go to the file that is there. Images the text does not
/// use stay behind, so a picture that was pasted and then undone does not end up in the folder.
/// Nothing is overwritten. If any copy fails, the ones this call made are removed again (never one
/// that was already there) and the error is returned.
pub(crate) fn adopt(
    drafts: &Drafts,
    number: u32,
    text: &str,
    target_folder: &Path,
    ignore_case: bool,
) -> Result<Adopted, AppError> {
    let mut adopted = Adopted {
        text: text.to_owned(),
        ..Adopted::default()
    };
    let images = drafts.folder(number)?.join(IMAGES_FOLDER);
    let plain = std::fs::symlink_metadata(&images)
        .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink());
    if !plain {
        return Ok(adopted);
    }
    let mut names: Vec<String> = std::fs::read_dir(&images)?
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| image_stem(name).is_some())
        .take(MAX_IMAGES)
        .collect();
    names.sort();
    let used: HashSet<&str> = link_uses(text, names.iter().map(String::as_str))
        .into_iter()
        .map(|(_, _, name)| name)
        .collect();

    for name in names.iter().filter(|name| used.contains(name.as_str())) {
        let copied = std::fs::read(images.join(name))
            .map_err(AppError::from)
            .and_then(|bytes| {
                let stem = image_stem(name).unwrap_or_default();
                // The links are rewritten as plain text, so an existing file under a name that
                // would need `<...>` in a link is only reused when the link is to it already.
                save_into_where(target_folder, ignore_case, stem, &bytes, |existing| {
                    existing == name || plain_name(existing)
                })
            });
        match copied {
            Ok(saved) => {
                // A file that was already there is not this call's to take back.
                if !saved.reused {
                    adopted
                        .created
                        .push(target_folder.join(IMAGES_FOLDER).join(&saved.name));
                }
                if saved.name != *name {
                    adopted.renames.insert(name.clone(), saved.name);
                }
            }
            Err(error) => {
                take_back(&adopted.created);
                return Err(error);
            }
        }
    }
    adopted.text = rewrite_links(text, &adopted.renames);
    Ok(adopted)
}

/// Removes the files a failed Save As had copied. A file that will not go is left: it is only an
/// image in a folder the owner chose.
pub(crate) fn take_back(created: &[PathBuf]) {
    for file in created {
        let _ = std::fs::remove_file(file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n-pretend-pixels-";
    /// Two more pictures, with bytes of their own: the same bytes are the same picture.
    const PNG_B: &[u8] = b"\x89PNG\r\n\x1a\n-other-pixels-";
    const PNG_C: &[u8] = b"\x89PNG\r\n\x1a\n-third-pixels-";

    fn drafts_in(dir: &Path) -> Drafts {
        let drafts = Drafts::default();
        drafts.set_root(dir.join("drafts"));
        drafts
    }

    fn put(drafts: &Drafts, number: u32, name: &str, bytes: &[u8]) {
        let folder = drafts.ensure(number).expect("a draft folder");
        std::fs::create_dir_all(folder.join(IMAGES_FOLDER)).expect("assets");
        std::fs::write(folder.join(IMAGES_FOLDER).join(name), bytes).expect("an image");
    }

    #[test]
    fn draft_images_folder_is_built_from_the_number_only() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        assert_eq!(
            drafts.folder(7).expect("folder"),
            dir.path().join("drafts").join("7")
        );
        assert!(drafts.folder(0).is_err());
        assert!(!drafts.exists(7));
        let made = drafts.ensure(7).expect("created");
        assert!(made.is_dir());
        assert!(drafts.exists(7));
        // Asking again is fine and gives the same folder.
        assert_eq!(drafts.ensure(7).expect("again"), made);
    }

    #[test]
    fn draft_images_an_unset_root_does_nothing() {
        let drafts = Drafts::default();
        assert!(drafts.folder(1).is_err());
        assert!(drafts.ensure(1).is_err());
        assert!(!drafts.remove(1));
        assert_eq!(drafts.sweep(&HashSet::new()), 0);
        assert!(!drafts.holds(Path::new("anything"), false));
    }

    #[test]
    fn draft_images_remove_takes_one_folder_and_only_that_one() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "image-20261113-153000.png", PNG);
        put(&drafts, 2, "image-20261113-153000.png", PNG);
        assert!(drafts.remove(1));
        assert!(!drafts.exists(1));
        assert!(drafts.exists(2));
        // Nothing there is not an error, and not a removal either.
        assert!(!drafts.remove(1));
    }

    #[test]
    fn draft_images_sweep_removes_only_unowned_number_folders() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        for number in [1, 2, 3] {
            put(&drafts, number, "image-20261113-153000.png", PNG);
        }
        // Things that are not a draft folder: a file, a name that is not a plain number.
        let root = dir.path().join("drafts");
        std::fs::write(root.join("5"), b"a file").expect("file");
        std::fs::create_dir(root.join("007")).expect("007");
        std::fs::create_dir(root.join("notes")).expect("notes");
        std::fs::create_dir(root.join("-1")).expect("minus");
        let keep: HashSet<u32> = [2].into_iter().collect();
        assert_eq!(drafts.sweep(&keep), 2);
        assert!(!drafts.exists(1) && drafts.exists(2) && !drafts.exists(3));
        assert!(root.join("5").is_file());
        assert!(root.join("007").is_dir());
        assert!(root.join("notes").is_dir());
        assert!(root.join("-1").is_dir());
    }

    #[test]
    fn draft_images_sweep_never_enters_a_link_or_leaves_the_draft_folder() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).expect("outside");
        std::fs::write(outside.join("precious.txt"), b"keep").expect("file");
        let root = dir.path().join("drafts");
        std::fs::create_dir(&root).expect("root");
        crate::platform::make_folder_link(&outside, &root.join("9")).expect("a link");
        assert_eq!(drafts.sweep(&HashSet::new()), 0);
        assert!(!drafts.remove(9));
        assert!(outside.join("precious.txt").is_file());
        // And a draft folder that is a link is refused for use as well.
        assert!(drafts.ensure(9).is_err());
    }

    #[test]
    fn draft_images_a_drafts_folder_that_is_a_link_is_not_used_or_swept() {
        let dir = tempfile::tempdir().expect("temp");
        let outside = dir.path().join("elsewhere");
        std::fs::create_dir_all(outside.join("4")).expect("a folder named 4");
        std::fs::write(outside.join("4").join("keep.txt"), b"keep").expect("file");
        crate::platform::make_folder_link(&outside, &dir.path().join("drafts")).expect("a link");
        let drafts = drafts_in(dir.path());
        assert_eq!(drafts.sweep(&HashSet::new()), 0);
        assert!(drafts.ensure(4).is_err());
        assert!(!drafts.remove(4));
        assert!(outside.join("4").join("keep.txt").is_file());
    }

    #[test]
    fn draft_images_holds_says_whether_a_path_is_inside_the_drafts() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        let folder = drafts.ensure(3).expect("folder");
        assert!(drafts.holds(&folder.join("a.md"), false));
        assert!(drafts.holds(&folder.join("assets").join("deeper").join("a.md"), false));
        assert!(!drafts.holds(&dir.path().join("a.md"), false));
        assert!(!drafts.holds(&dir.path().join("drafts-not").join("a.md"), false));
    }

    #[test]
    fn draft_images_link_rule_matches_the_shared_cases() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            text: String,
            renames: BTreeMap<String, String>,
            expected: String,
            used: Vec<String>,
        }
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../tests/data/draft-links.json"))
                .expect("the shared cases are valid json");
        assert!(cases.len() >= 12, "the shared cases were not read");
        for case in cases {
            assert_eq!(
                rewrite_links(&case.text, &case.renames),
                case.expected,
                "{}",
                case.name
            );
            let names: Vec<&str> = case.renames.keys().map(String::as_str).collect();
            let used: Vec<String> = link_uses(&case.text, names.iter().copied())
                .into_iter()
                .map(|(_, _, name)| name.to_owned())
                .collect();
            assert_eq!(used, case.used, "{}", case.name);
        }
    }

    #[test]
    fn draft_images_adopt_copies_the_used_images_and_leaves_the_rest() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "image-20261113-153000.png", PNG);
        put(&drafts, 1, "image-20261113-153001.png", PNG_B);
        put(&drafts, 1, "image-20261113-153002.png", PNG_C);
        let target = dir.path().join("notes");
        std::fs::create_dir(&target).expect("target");
        let text = "![a](assets/image-20261113-153000.png) <img src=\"assets/image-20261113-153002.png\" width=\"9\">";
        let adopted = adopt(&drafts, 1, text, &target, false).expect("adopted");
        assert_eq!(adopted.text, text);
        assert!(adopted.renames.is_empty());
        let assets = target.join(IMAGES_FOLDER);
        assert!(assets.join("image-20261113-153000.png").is_file());
        assert!(!assets.join("image-20261113-153001.png").exists());
        assert!(assets.join("image-20261113-153002.png").is_file());
        assert_eq!(adopted.created.len(), 2);
    }

    #[test]
    fn draft_images_adopt_renames_a_taken_name_and_its_link_and_never_overwrites() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "image-20261113-153000.png", PNG);
        put(&drafts, 1, "image-20261113-153001.png", PNG_B);
        let target = dir.path().join("notes");
        std::fs::create_dir_all(target.join(IMAGES_FOLDER)).expect("assets");
        let theirs = b"\x89PNG\r\n\x1a\nthe-owners-picture";
        std::fs::write(
            target.join(IMAGES_FOLDER).join("image-20261113-153000.png"),
            theirs,
        )
        .expect("taken");
        let text =
            "![a](assets/image-20261113-153000.png)\n![b](assets/image-20261113-153001.png)\n";
        let adopted = adopt(&drafts, 1, text, &target, false).expect("adopted");
        assert_eq!(
            adopted.text,
            "![a](assets/image-20261113-153000-2.png)\n![b](assets/image-20261113-153001.png)\n"
        );
        assert_eq!(
            adopted
                .renames
                .get("image-20261113-153000.png")
                .map(String::as_str),
            Some("image-20261113-153000-2.png")
        );
        // The picture that was there is untouched and the new one sits beside it.
        let assets = target.join(IMAGES_FOLDER);
        assert_eq!(
            std::fs::read(assets.join("image-20261113-153000.png")).expect("read"),
            theirs
        );
        assert_eq!(
            std::fs::read(assets.join("image-20261113-153000-2.png")).expect("read"),
            PNG
        );
        assert!(assets.join("image-20261113-153001.png").is_file());
    }

    #[test]
    fn draft_images_adopt_takes_back_what_it_made_when_a_copy_fails() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "image-20261113-153000.png", PNG);
        // Not an image: the copy refuses it, after the first one was made.
        put(
            &drafts,
            1,
            "image-20261113-153001.png",
            b"not an image at all",
        );
        let target = dir.path().join("notes");
        std::fs::create_dir(&target).expect("target");
        let text = "![a](assets/image-20261113-153000.png) ![b](assets/image-20261113-153001.png)";
        assert!(adopt(&drafts, 1, text, &target, false).is_err());
        assert!(
            !target
                .join(IMAGES_FOLDER)
                .join("image-20261113-153000.png")
                .exists()
        );
        // The draft is as it was.
        assert!(drafts.exists(1));
    }

    #[test]
    fn draft_images_adopt_with_no_images_changes_nothing() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        let target = dir.path().join("notes");
        std::fs::create_dir(&target).expect("target");
        let adopted = adopt(&drafts, 1, "just text", &target, false).expect("adopted");
        assert_eq!(adopted.text, "just text");
        assert!(adopted.created.is_empty());
        assert!(!target.join(IMAGES_FOLDER).exists());
    }

    #[test]
    fn draft_images_names_are_only_ours_to_copy() {
        assert_eq!(
            image_stem("image-20261113-153000.png"),
            Some("image-20261113-153000")
        );
        assert_eq!(
            image_stem("image-20261113-153000-2.jpg"),
            Some("image-20261113-153000-2")
        );
        assert_eq!(image_stem("my cat (1).webp"), Some("my cat (1)"));
        assert_eq!(image_stem("CAT.PNG"), Some("CAT"));
        assert_eq!(image_stem("notes.txt"), None, "not an image kind");
        assert_eq!(image_stem("cat"), None, "no extension");
        assert_eq!(image_stem("con.png"), None, "a device name");
        assert_eq!(image_stem("a?b.png"), None, "a character no copy keeps");
    }

    #[test]
    fn draft_images_adopt_keeps_the_name_the_picture_has() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "my cat (1).png", PNG);
        let target = dir.path().join("notes");
        std::fs::create_dir(&target).expect("target");
        let text = "![](<assets/my cat (1).png>)";
        let adopted = adopt(&drafts, 1, text, &target, false).expect("adopted");
        assert_eq!(adopted.text, text);
        assert!(adopted.renames.is_empty());
        assert_eq!(
            std::fs::read(target.join(IMAGES_FOLDER).join("my cat (1).png")).expect("copied"),
            PNG
        );
    }

    #[test]
    fn draft_images_adopt_links_to_the_same_picture_already_in_the_folder() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "image-20261113-153000.png", PNG);
        put(&drafts, 1, "image-20261113-153001.png", PNG_B);
        let target = dir.path().join("notes");
        std::fs::create_dir_all(target.join(IMAGES_FOLDER)).expect("assets");
        std::fs::write(target.join(IMAGES_FOLDER).join("cat.png"), PNG).expect("theirs");
        let text = "![a](assets/image-20261113-153000.png) ![b](assets/image-20261113-153001.png)";
        let adopted = adopt(&drafts, 1, text, &target, false).expect("adopted");
        assert_eq!(
            adopted.text,
            "![a](assets/cat.png) ![b](assets/image-20261113-153001.png)"
        );
        assert!(
            !target
                .join(IMAGES_FOLDER)
                .join("image-20261113-153000.png")
                .exists(),
            "the same picture is not copied again"
        );
        assert_eq!(
            adopted.created,
            [target.join(IMAGES_FOLDER).join("image-20261113-153001.png")],
            "only what was made is listed to take back"
        );
    }

    #[test]
    fn draft_images_adopt_two_drafts_of_one_picture_make_one_file() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "a.png", PNG);
        put(&drafts, 1, "b.png", PNG);
        let target = dir.path().join("notes");
        std::fs::create_dir(&target).expect("target");
        let text = "![](assets/a.png) ![](assets/b.png)";
        let adopted = adopt(&drafts, 1, text, &target, false).expect("adopted");
        assert_eq!(adopted.text, "![](assets/a.png) ![](assets/a.png)");
        assert_eq!(adopted.created.len(), 1);
        assert_eq!(
            std::fs::read_dir(target.join(IMAGES_FOLDER))
                .expect("lists")
                .count(),
            1
        );
    }

    #[test]
    fn draft_images_adopt_does_not_point_a_link_at_a_name_that_needs_brackets() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "a.png", PNG);
        let target = dir.path().join("notes");
        std::fs::create_dir_all(target.join(IMAGES_FOLDER)).expect("assets");
        std::fs::write(target.join(IMAGES_FOLDER).join("my cat.png"), PNG).expect("theirs");
        let adopted = adopt(&drafts, 1, "![](assets/a.png)", &target, false).expect("adopted");
        // A link `assets/my cat.png` without brackets would stop being a link, so the picture is
        // copied under its own name instead.
        assert_eq!(adopted.text, "![](assets/a.png)");
        assert!(target.join(IMAGES_FOLDER).join("a.png").is_file());
    }

    #[test]
    fn draft_images_adopt_failing_after_a_reuse_leaves_the_file_that_was_there() {
        let dir = tempfile::tempdir().expect("temp");
        let drafts = drafts_in(dir.path());
        put(&drafts, 1, "a.png", PNG);
        // Sorted after `a.png`, so the reuse happens first; this one is refused.
        put(&drafts, 1, "b.png", b"not an image at all");
        let target = dir.path().join("notes");
        std::fs::create_dir_all(target.join(IMAGES_FOLDER)).expect("assets");
        let theirs = target.join(IMAGES_FOLDER).join("cat.png");
        std::fs::write(&theirs, PNG).expect("theirs");
        let text = "![](assets/a.png) ![](assets/b.png)";
        assert!(adopt(&drafts, 1, text, &target, false).is_err());
        assert_eq!(std::fs::read(&theirs).expect("still there"), PNG);
        assert_eq!(
            std::fs::read_dir(target.join(IMAGES_FOLDER))
                .expect("lists")
                .count(),
            1,
            "nothing else was left"
        );
    }
}
