//! File operations behind the sidebar: create, rename, move, delete, and copy from a native drop.
//!
//! Every path the page names must lie inside a workspace root, and every source of a copy must be a
//! path a native drop delivered (`drops.rs`). A rename or move of a file that is open in a tab also
//! points Rust's record of that document at the new path, so a later save writes where the file is
//! now and never brings the old one back.

use crate::access::{Resolved, display_path, is_inside};
use crate::documents::AppState;
use crate::error::AppError;
use crate::links::guard::is_device_name;
use crate::platform::Platform;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Windows and most file systems stop at this many characters in one name.
const NAME_LIMIT: usize = 255;

/// An open document whose file moved, for the page to rename its tab.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct MovedDocument {
    pub(crate) id: u32,
    pub(crate) path: String,
}

/// The result of a rename or move.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Moved {
    /// Where the file or folder is now, as people read the path.
    pub(crate) path: String,
    /// The open documents that came with it.
    pub(crate) documents: Vec<MovedDocument>,
}

/// What to do with a copy whose name is taken.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Answer {
    Replace,
    KeepBoth,
    Skip,
}

/// The user's answer for one name that was already there.
#[derive(Debug, Deserialize)]
pub(crate) struct ClashAnswer {
    pub(crate) name: String,
    pub(crate) answer: Answer,
}

/// An item that could not be copied, with the reason.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct CopyFailure {
    pub(crate) name: String,
    pub(crate) message: String,
}

/// What a copy did.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyReport {
    /// The new files and folders, as people read the paths.
    pub(crate) copied: Vec<String>,
    /// Names left alone because the user said Skip (or gave no answer), or because they are links.
    pub(crate) skipped: Vec<String>,
    pub(crate) failed: Vec<CopyFailure>,
    /// How many symbolic links or junctions were left out of what was copied. They are never
    /// followed, so a link back up the tree cannot make a copy run forever.
    pub(crate) links_left: u32,
}

/// Refuses a name that Windows cannot store or reads as something else: an empty one, a path part,
/// separators and the characters a file name may not have, a trailing dot or space, and device
/// names. The rules are Windows' on every OS, so a folder behaves the same wherever it is opened.
pub(crate) fn validate_name(name: &str) -> Result<(), AppError> {
    let refuse = |why: &str| {
        Err(AppError::Invalid(format!(
            "{name:?} is not a usable name: {why}"
        )))
    };
    if name.trim().is_empty() {
        return refuse("it is empty");
    }
    if name == "." || name == ".." {
        return refuse("it is a path part");
    }
    if name.chars().count() > NAME_LIMIT {
        return refuse("it is too long");
    }
    if name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*'
            )
    }) {
        return refuse("it has a character a file name may not have");
    }
    if name.ends_with(['.', ' ']) {
        return refuse("it ends in a dot or a space");
    }
    if is_device_name(name) {
        return refuse("Windows reserves it");
    }
    Ok(())
}

/// A folder inside a root that the page may put things in.
fn folder_in_root(state: &AppState, folder: &Path) -> Result<Resolved, AppError> {
    let resolved = state.access().check_in_root(folder)?;
    if resolved.path.is_dir() {
        Ok(resolved)
    } else {
        Err(AppError::Invalid(format!(
            "{} is not a folder",
            display_path(&resolved.path)
        )))
    }
}

/// A file or folder inside a root. A root itself is not one: it leaves the workspace through
/// Remove Folder, not through a rename, move or delete.
fn entry_in_root(state: &AppState, path: &Path) -> Result<Resolved, AppError> {
    let access = state.access();
    let resolved = access.check_in_root(path)?;
    if access.is_root(&resolved) {
        return Err(AppError::Invalid(
            "a workspace folder leaves the workspace with Remove Folder".into(),
        ));
    }
    Ok(resolved)
}

fn is_taken(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// True when two paths are one file, which is how a rename that only changes case looks on a file
/// system that ignores case.
fn same_file(a: &Path, b: &Path) -> bool {
    matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(a), Ok(b)) if a == b)
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Makes an empty file named `name` in `parent`. Returns its path.
pub(crate) fn create_file(state: &AppState, parent: &Path, name: &str) -> Result<String, AppError> {
    validate_name(name)?;
    let folder = folder_in_root(state, parent)?;
    let target = folder.path.join(name);
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => Ok(display_path(&target)),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(AppError::Exists(name.to_owned()))
        }
        Err(error) => Err(error.into()),
    }
}

/// Makes a folder named `name` in `parent`. Returns its path.
pub(crate) fn create_folder(
    state: &AppState,
    parent: &Path,
    name: &str,
) -> Result<String, AppError> {
    validate_name(name)?;
    let folder = folder_in_root(state, parent)?;
    let target = folder.path.join(name);
    match fs::create_dir(&target) {
        Ok(()) => Ok(display_path(&target)),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(AppError::Exists(name.to_owned()))
        }
        Err(error) => Err(error.into()),
    }
}

/// Points the open documents at the new place and says where the entry is now.
fn finish_move(state: &AppState, was: &Resolved, now: &Path) -> Result<Moved, AppError> {
    let resolved = state.access().resolve(now)?;
    let documents = state.documents_moved(was, &resolved);
    Ok(Moved {
        path: display_path(&resolved.path),
        documents,
    })
}

/// Where a rename would put `path`, after every check that does not touch the disk. `None` when
/// the name is the one it already has. A name that only differs in case from the old one is fine
/// where the file system ignores case; any other name that is taken is refused.
pub(crate) fn rename_target(
    state: &AppState,
    path: &Path,
    new_name: &str,
) -> Result<Option<(Resolved, PathBuf)>, AppError> {
    validate_name(new_name)?;
    let source = entry_in_root(state, path)?;
    let parent = source
        .path
        .parent()
        .ok_or_else(|| AppError::Invalid("it has no folder".into()))?;
    let target = parent.join(new_name);
    if target == source.path {
        return Ok(None);
    }
    if is_taken(&target) && !same_file(&source.path, &target) {
        return Err(AppError::Exists(new_name.to_owned()));
    }
    Ok(Some((source, target)))
}

/// Where a move would put `path`, after every check that does not touch the disk. `None` when it
/// is in that folder already. Moving a folder into itself is refused, and so is a name that is
/// taken.
pub(crate) fn move_target(
    state: &AppState,
    path: &Path,
    into: &Path,
) -> Result<Option<(Resolved, PathBuf)>, AppError> {
    let source = entry_in_root(state, path)?;
    let folder = folder_in_root(state, into)?;
    if is_inside(&folder.key, &source.key) {
        return Err(AppError::Invalid(
            "a folder cannot be moved into itself".into(),
        ));
    }
    let name = source
        .path
        .file_name()
        .ok_or_else(|| AppError::Invalid("it has no name".into()))?;
    let target = folder.path.join(name);
    if target == source.path {
        return Ok(None);
    }
    if is_taken(&target) {
        return Err(AppError::Exists(name.to_string_lossy().into_owned()));
    }
    Ok(Some((source, target)))
}

/// Does the move `rename_target` or `move_target` found, and points the open documents at the new
/// place. A move to another drive is refused: it is a copy and a delete, which is for the user to
/// ask for.
pub(crate) fn carry_out(
    state: &AppState,
    source: &Resolved,
    target: &Path,
) -> Result<Moved, AppError> {
    match fs::rename(&source.path, target) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::CrossesDevices => {
            return Err(AppError::Invalid(
                "it is on another drive: copy it there and delete the original".into(),
            ));
        }
        Err(error) => return Err(error.into()),
    }
    finish_move(state, source, target)
}

/// What a move that changes nothing answers.
fn unmoved(source: &Path) -> Moved {
    Moved {
        path: display_path(source),
        documents: Vec::new(),
    }
}

/// Renames a file or folder in place.
pub(crate) fn rename_entry(
    state: &AppState,
    path: &Path,
    new_name: &str,
) -> Result<Moved, AppError> {
    match rename_target(state, path, new_name)? {
        None => Ok(unmoved(&entry_in_root(state, path)?.path)),
        Some((source, target)) => carry_out(state, &source, &target),
    }
}

/// Moves a file or folder into another folder of the workspace, under the same name.
pub(crate) fn move_entry(state: &AppState, path: &Path, into: &Path) -> Result<Moved, AppError> {
    match move_target(state, path, into)? {
        None => Ok(unmoved(&entry_in_root(state, path)?.path)),
        Some((source, target)) => carry_out(state, &source, &target),
    }
}

/// Sends a file or folder to the Recycle Bin. Open tabs keep their text; a later save brings the
/// file back, like any file that vanishes under an open document.
pub(crate) fn delete_entry(
    state: &AppState,
    platform: &dyn Platform,
    path: &Path,
) -> Result<(), AppError> {
    let source = entry_in_root(state, path)?;
    platform.move_to_trash(&source.path)?;
    Ok(())
}

/// Shows an entry of the workspace in the system's file manager.
pub(crate) fn reveal_entry(
    state: &AppState,
    platform: &dyn Platform,
    path: &Path,
) -> Result<(), AppError> {
    let resolved = state.access().check(path)?;
    platform.reveal(&resolved.path)?;
    Ok(())
}

/// The paths a native drop delivered, or a refusal for any other.
fn dropped_sources(state: &AppState, paths: &[String]) -> Result<Vec<PathBuf>, AppError> {
    paths
        .iter()
        .map(|path| state.drops().lookup(path))
        .collect()
}

/// Which names a copy of `paths` into `into` would find taken. Nothing is changed.
pub(crate) fn copy_clashes(
    state: &AppState,
    into: &Path,
    paths: &[String],
) -> Result<Vec<String>, AppError> {
    let folder = folder_in_root(state, into)?;
    Ok(dropped_sources(state, paths)?
        .iter()
        .map(|source| name_of(source))
        .filter(|name| is_taken(&folder.path.join(name)))
        .collect())
}

/// Copies what a native drop delivered into a folder of the workspace. Each name that is already
/// there is handled by the user's answer for it, and Skip when there is none: nothing is replaced
/// without an explicit Replace. Replace sends the old one to the Recycle Bin first, so it can be
/// got back. A source is never changed. Links are not followed or copied.
pub(crate) fn copy_into(
    state: &AppState,
    platform: &dyn Platform,
    into: &Path,
    paths: &[String],
    answers: &[ClashAnswer],
) -> Result<CopyReport, AppError> {
    let folder = folder_in_root(state, into)?;
    let sources = dropped_sources(state, paths)?;
    let mut report = CopyReport::default();
    for source in sources {
        copy_one(platform, &folder, &source, answers, &mut report);
    }
    Ok(report)
}

fn copy_one(
    platform: &dyn Platform,
    folder: &Resolved,
    source: &Path,
    answers: &[ClashAnswer],
    report: &mut CopyReport,
) {
    let name = name_of(source);
    let mut fail = |message: String| {
        report.failed.push(CopyFailure {
            name: name.clone(),
            message,
        });
    };
    let meta = match fs::symlink_metadata(source) {
        Ok(meta) => meta,
        Err(error) => return fail(error.to_string()),
    };
    if meta.file_type().is_symlink() {
        report.skipped.push(name);
        report.links_left += 1;
        return;
    }
    let is_folder = meta.is_dir();
    if is_folder
        && fs::canonicalize(source).is_ok_and(|canonical| folder.path.starts_with(canonical))
    {
        return fail("a folder cannot be copied into itself".into());
    }
    let mut target = folder.path.join(&name);
    if is_taken(&target) {
        // Copying a file onto itself would make Replace delete the only copy.
        let answer = if same_file(source, &target) {
            Answer::KeepBoth
        } else {
            answers
                .iter()
                .find(|clash| clash.name == name)
                .map_or(Answer::Skip, |clash| clash.answer)
        };
        match answer {
            Answer::Skip => {
                report.skipped.push(name);
                return;
            }
            Answer::KeepBoth => target = free_name(&folder.path, &name, is_folder),
            Answer::Replace => {
                let existing_is_folder =
                    fs::symlink_metadata(&target).is_ok_and(|meta| meta.is_dir());
                if existing_is_folder != is_folder {
                    return fail("a file and a folder cannot replace each other".into());
                }
                if let Err(error) = platform.move_to_trash(&target) {
                    return fail(format!("the old one could not be recycled: {error}"));
                }
            }
        }
    }
    let mut done = 0;
    match copy_node(source, &target, &mut report.links_left, &mut done) {
        Ok(()) => report.copied.push(display_path(&target)),
        Err(error) => fail(format!(
            "{error}; {done} {} copied before it stopped",
            if done == 1 { "item was" } else { "items were" }
        )),
    }
}

/// `name`, then `name (2)`, `name (3)` and so on, until one is free. The number goes before the
/// extension of a file; a folder or a dotfile takes it at the end.
fn free_name(folder: &Path, name: &str, is_folder: bool) -> PathBuf {
    let (stem, extension) = if is_folder {
        (name, "")
    } else {
        match name.rfind('.') {
            Some(dot) if dot > 0 && dot + 1 < name.len() => (&name[..dot], &name[dot..]),
            _ => (name, ""),
        }
    };
    (2_u32..)
        .map(|number| folder.join(format!("{stem} ({number}){extension}")))
        .find(|candidate| !is_taken(candidate))
        .unwrap_or_else(|| folder.join(name))
}

/// Copies a file or a whole folder tree. `done` counts what was made, for the message when a copy
/// stops partway.
fn copy_node(source: &Path, target: &Path, links: &mut u32, done: &mut u64) -> io::Result<()> {
    let meta = fs::symlink_metadata(source)?;
    if meta.file_type().is_symlink() {
        *links += 1;
        return Ok(());
    }
    if meta.is_dir() {
        fs::create_dir(target)?;
        *done += 1;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_node(&entry.path(), &target.join(entry.file_name()), links, done)?;
        }
        return Ok(());
    }
    copy_file(source, target)?;
    *done += 1;
    Ok(())
}

/// Copies through a temporary name and renames it into place, so a copy that is cut short never
/// leaves a half-written file under the real name.
fn copy_file(source: &Path, target: &Path) -> io::Result<()> {
    let temporary = target.with_file_name(format!(".{}.mdmate-copy", name_of(target)));
    if let Err(error) = fs::copy(source, &temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    fs::rename(&temporary, target).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::{open_document, save_document};
    use crate::fs::eol::{Ending, Endings};
    use crate::fs::frame;
    use crate::platform;
    use serde_json::Map;
    use std::sync::Mutex;

    /// A stand-in for the OS: "trashing" moves the item into a folder of the test, or fails.
    struct FakeOs {
        bin: PathBuf,
        full: bool,
        trashed: Mutex<Vec<PathBuf>>,
    }

    impl FakeOs {
        fn new(bin: PathBuf) -> Self {
            fs::create_dir_all(&bin).expect("bin");
            Self {
                bin,
                full: false,
                trashed: Mutex::new(Vec::new()),
            }
        }

        fn trashed(&self) -> Vec<PathBuf> {
            self.trashed.lock().expect("lock").clone()
        }
    }

    impl Platform for FakeOs {
        fn name(&self) -> &'static str {
            "test"
        }
        fn paths_ignore_case(&self) -> bool {
            platform::current().paths_ignore_case()
        }
        fn file_is_busy(&self, _error: &io::Error) -> bool {
            false
        }
        fn open_external(&self, _target: &str) -> io::Result<()> {
            Ok(())
        }
        fn move_to_trash(&self, path: &Path) -> io::Result<()> {
            if self.full {
                return Err(io::Error::other("no Recycle Bin here"));
            }
            let index = self.trashed().len();
            fs::rename(path, self.bin.join(format!("{index}-{}", name_of(path))))?;
            self.trashed.lock().expect("lock").push(path.to_path_buf());
            Ok(())
        }
        fn reveal(&self, _path: &Path) -> io::Result<()> {
            Ok(())
        }
    }

    struct Workspace {
        _dir: tempfile::TempDir,
        root: PathBuf,
        outside: PathBuf,
        state: AppState,
        os: FakeOs,
    }

    fn workspace() -> Workspace {
        let dir = tempfile::tempdir().expect("temp dir");
        let base = fs::canonicalize(dir.path()).expect("canonical");
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");
        let state = AppState::new(platform::current().paths_ignore_case());
        state.access().grant_root(&root).expect("granted");
        let os = FakeOs::new(base.join("bin"));
        Workspace {
            _dir: dir,
            root,
            outside,
            state,
            os,
        }
    }

    fn write(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, text).expect("written");
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).expect("read")
    }

    fn as_text(path: &Path) -> String {
        display_path(path)
    }

    fn edit_frame(text: &str) -> Vec<u8> {
        frame::encode(Map::new(), &Endings::uniform(Ending::Lf), text)
    }

    // ---- names ----

    #[test]
    fn names_that_cannot_be_stored_are_refused() {
        for bad in [
            "",
            " ",
            ".",
            "..",
            "a/b",
            "a\\b",
            "a:b",
            "a<b",
            "a>b",
            "a\"b",
            "a|b",
            "a?b",
            "a*b",
            "a.",
            "a ",
            "con",
            "NUL.txt",
            "com1.md",
            "tab\there",
            "nul\0",
        ] {
            assert_eq!(
                validate_name(bad).expect_err(bad).kind(),
                "invalid",
                "{bad:?}"
            );
        }
        assert!(validate_name(&"x".repeat(256)).is_err());
    }

    #[test]
    fn ordinary_names_pass() {
        for good in [
            "notes.md",
            ".gitignore",
            "a b.md",
            "résumé.md",
            "x".repeat(255).as_str(),
            "console.md",
            "v1.2",
            "a.b.c",
        ] {
            assert!(validate_name(good).is_ok(), "{good:?}");
        }
    }

    // ---- create ----

    #[test]
    fn create_file_makes_an_empty_file_and_refuses_a_name_that_is_taken() {
        let w = workspace();
        let made = create_file(&w.state, &w.root, "new.md").expect("created");
        assert_eq!(read(Path::new(&made)), "");
        assert_eq!(
            create_file(&w.state, &w.root, "new.md")
                .expect_err("taken")
                .kind(),
            "exists"
        );
        write(&w.root.join("keep.md"), "kept");
        let _ = create_file(&w.state, &w.root, "KEEP.md");
        assert_eq!(read(&w.root.join("keep.md")), "kept");
    }

    #[test]
    fn create_file_refuses_a_folder_outside_the_roots_and_a_bad_name() {
        let w = workspace();
        assert_eq!(
            create_file(&w.state, &w.outside, "x.md")
                .expect_err("outside")
                .kind(),
            "not-allowed"
        );
        assert!(!w.outside.join("x.md").exists());
        assert!(create_file(&w.state, &w.root, "../escape.md").is_err());
        assert!(!w.root.parent().expect("p").join("escape.md").exists());
        write(&w.root.join("file.md"), "");
        assert_eq!(
            create_file(&w.state, &w.root.join("file.md"), "x.md")
                .expect_err("not a folder")
                .kind(),
            "invalid"
        );
    }

    #[test]
    fn create_folder_makes_a_folder_and_refuses_a_taken_name() {
        let w = workspace();
        let made = create_folder(&w.state, &w.root, "sub").expect("created");
        assert!(Path::new(&made).is_dir());
        assert_eq!(
            create_folder(&w.state, &w.root, "sub")
                .expect_err("taken")
                .kind(),
            "exists"
        );
        let inner = create_folder(&w.state, Path::new(&made), "inner").expect("nested");
        assert!(Path::new(&inner).is_dir());
        assert_eq!(
            create_folder(&w.state, &w.outside, "x")
                .expect_err("outside")
                .kind(),
            "not-allowed"
        );
    }

    // ---- rename ----

    #[test]
    fn rename_file_changes_the_name_and_keeps_the_content() {
        let w = workspace();
        write(&w.root.join("a.md"), "text");
        let moved = rename_entry(&w.state, &w.root.join("a.md"), "b.md").expect("renamed");
        assert_eq!(moved.path, as_text(&w.root.join("b.md")));
        assert!(!w.root.join("a.md").exists());
        assert_eq!(read(&w.root.join("b.md")), "text");
    }

    #[test]
    fn rename_file_refuses_a_taken_name_and_leaves_both_files() {
        let w = workspace();
        write(&w.root.join("a.md"), "one");
        write(&w.root.join("b.md"), "two");
        assert_eq!(
            rename_entry(&w.state, &w.root.join("a.md"), "b.md")
                .expect_err("taken")
                .kind(),
            "exists"
        );
        assert_eq!(read(&w.root.join("a.md")), "one");
        assert_eq!(read(&w.root.join("b.md")), "two");
    }

    #[test]
    fn rename_file_may_only_change_the_case_where_the_file_system_ignores_it() {
        let w = workspace();
        write(&w.root.join("a.md"), "x");
        let outcome = rename_entry(&w.state, &w.root.join("a.md"), "A.md");
        if platform::current().paths_ignore_case() {
            outcome.expect("a case-only rename is not a clash with itself");
            let names: Vec<String> = fs::read_dir(&w.root)
                .expect("dir")
                .map(|entry| entry.expect("entry").file_name().to_string_lossy().into())
                .collect();
            assert_eq!(names, ["A.md"]);
        } else {
            outcome.expect("on a case-sensitive file system A.md is a new name");
        }
    }

    #[test]
    fn rename_file_to_its_own_name_is_a_quiet_no_op() {
        let w = workspace();
        write(&w.root.join("a.md"), "x");
        let moved = rename_entry(&w.state, &w.root.join("a.md"), "a.md").expect("no-op");
        assert!(moved.documents.is_empty());
        assert_eq!(read(&w.root.join("a.md")), "x");
    }

    #[test]
    fn rename_file_refuses_a_root_a_path_outside_and_a_bad_name() {
        let w = workspace();
        write(&w.outside.join("o.md"), "x");
        for (path, name, kind) in [
            (w.root.clone(), "other", "invalid"),
            (w.outside.join("o.md"), "p.md", "not-allowed"),
        ] {
            let refused = rename_entry(&w.state, &path, name).expect_err("refused");
            assert_eq!(refused.kind(), kind);
        }
        assert!(w.root.exists());
        write(&w.root.join("a.md"), "x");
        assert!(rename_entry(&w.state, &w.root.join("a.md"), "dir/b.md").is_err());
        assert!(w.root.join("a.md").exists());
    }

    // ---- move ----

    #[test]
    fn move_entry_moves_a_file_and_a_folder_with_what_is_in_it() {
        let w = workspace();
        write(&w.root.join("a.md"), "file");
        write(&w.root.join("dir/in.md"), "inner");
        fs::create_dir_all(w.root.join("target")).expect("target");
        move_entry(&w.state, &w.root.join("a.md"), &w.root.join("target")).expect("file");
        move_entry(&w.state, &w.root.join("dir"), &w.root.join("target")).expect("folder");
        assert_eq!(read(&w.root.join("target/a.md")), "file");
        assert_eq!(read(&w.root.join("target/dir/in.md")), "inner");
        assert!(!w.root.join("a.md").exists() && !w.root.join("dir").exists());
    }

    #[test]
    fn move_entry_refuses_a_folder_into_itself_or_below_and_a_taken_name() {
        let w = workspace();
        write(&w.root.join("dir/sub/x.md"), "x");
        for into in [w.root.join("dir"), w.root.join("dir/sub")] {
            assert_eq!(
                move_entry(&w.state, &w.root.join("dir"), &into)
                    .expect_err("into itself")
                    .kind(),
                "invalid"
            );
        }
        write(&w.root.join("a.md"), "one");
        write(&w.root.join("dir/a.md"), "two");
        assert_eq!(
            move_entry(&w.state, &w.root.join("a.md"), &w.root.join("dir"))
                .expect_err("taken")
                .kind(),
            "exists"
        );
        assert_eq!(read(&w.root.join("a.md")), "one");
        assert_eq!(read(&w.root.join("dir/a.md")), "two");
    }

    #[test]
    fn move_entry_refuses_anything_outside_the_roots() {
        let w = workspace();
        write(&w.root.join("a.md"), "x");
        write(&w.outside.join("o.md"), "y");
        assert!(move_entry(&w.state, &w.root.join("a.md"), &w.outside).is_err());
        assert!(move_entry(&w.state, &w.outside.join("o.md"), &w.root).is_err());
        assert!(w.root.join("a.md").exists() && w.outside.join("o.md").exists());
    }

    #[test]
    fn move_entry_into_the_folder_it_is_in_changes_nothing() {
        let w = workspace();
        write(&w.root.join("a.md"), "x");
        let moved = move_entry(&w.state, &w.root.join("a.md"), &w.root).expect("no-op");
        assert_eq!(moved.path, as_text(&w.root.join("a.md")));
        assert_eq!(read(&w.root.join("a.md")), "x");
    }

    // ---- delete and reveal ----

    #[test]
    fn delete_entry_hands_the_item_to_the_recycle_bin_and_nothing_else() {
        let w = workspace();
        write(&w.root.join("a.md"), "keep me");
        write(&w.root.join("b.md"), "other");
        delete_entry(&w.state, &w.os, &w.root.join("a.md")).expect("deleted");
        assert!(!w.root.join("a.md").exists());
        assert_eq!(w.os.trashed(), [w.root.join("a.md")]);
        assert!(w.root.join("b.md").exists());
        let bin = fs::read_dir(&w.os.bin).expect("bin").count();
        assert_eq!(bin, 1, "the file is in the bin, so it can be got back");
    }

    #[test]
    fn delete_entry_keeps_the_item_when_there_is_no_bin() {
        let mut w = workspace();
        w.os.full = true;
        write(&w.root.join("a.md"), "keep me");
        assert!(delete_entry(&w.state, &w.os, &w.root.join("a.md")).is_err());
        assert_eq!(read(&w.root.join("a.md")), "keep me");
    }

    #[test]
    fn delete_entry_refuses_a_root_and_a_path_outside_the_roots() {
        let w = workspace();
        write(&w.outside.join("o.md"), "x");
        let refused = delete_entry(&w.state, &w.os, &w.root).expect_err("root");
        assert_eq!(refused.kind(), "invalid");
        let refused = delete_entry(&w.state, &w.os, &w.outside.join("o.md")).expect_err("outside");
        assert_eq!(refused.kind(), "not-allowed");
        assert!(w.os.trashed().is_empty());
        assert!(w.root.exists() && w.outside.join("o.md").exists());
    }

    // ---- open documents follow ----

    #[test]
    fn open_documents_follow_a_rename_so_a_save_writes_the_new_path() {
        let w = workspace();
        let old = w.root.join("a.md");
        write(&old, "one\n");
        let frame = open_document(&w.state, &old).expect("opened");
        assert!(!frame.is_empty());
        let id = w
            .state
            .documents()
            .entries()
            .next()
            .map(|(id, _)| id)
            .expect("open");
        let moved = rename_entry(&w.state, &old, "b.md").expect("renamed");
        assert_eq!(
            moved.documents,
            [MovedDocument {
                id,
                path: as_text(&w.root.join("b.md"))
            }]
        );
        save_document(&w.state, id, &edit_frame("changed\n")).expect("saved");
        assert_eq!(read(&w.root.join("b.md")), "changed\n");
        assert!(!old.exists(), "the old path must not come back");
    }

    #[test]
    fn open_documents_follow_a_move() {
        let w = workspace();
        write(&w.root.join("a.md"), "one\n");
        fs::create_dir_all(w.root.join("into")).expect("into");
        open_document(&w.state, &w.root.join("a.md")).expect("opened");
        let id = w.state.documents().entries().next().expect("open").0;
        move_entry(&w.state, &w.root.join("a.md"), &w.root.join("into")).expect("moved");
        save_document(&w.state, id, &edit_frame("moved\n")).expect("saved");
        assert_eq!(read(&w.root.join("into/a.md")), "moved\n");
        assert!(!w.root.join("a.md").exists());
    }

    #[test]
    fn open_documents_follow_a_folder_that_is_renamed_or_moved() {
        let w = workspace();
        write(&w.root.join("dir/sub/deep.md"), "deep\n");
        write(&w.root.join("dir/top.md"), "top\n");
        write(&w.root.join("other.md"), "other\n");
        for name in ["dir/sub/deep.md", "dir/top.md", "other.md"] {
            open_document(&w.state, &w.root.join(name)).expect("opened");
        }
        let id_of = |name: &str| {
            let wanted = w
                .state
                .access()
                .resolve(&w.root.join(name))
                .expect("exists")
                .key;
            w.state
                .documents()
                .entries()
                .find(|(_, entry)| entry.key == wanted)
                .map(|(id, _)| id)
                .expect("open")
        };
        let (deep, top, other) = (
            id_of("dir/sub/deep.md"),
            id_of("dir/top.md"),
            id_of("other.md"),
        );
        let moved = rename_entry(&w.state, &w.root.join("dir"), "renamed").expect("renamed");
        assert_eq!(
            moved.documents.len(),
            2,
            "the file outside the folder stays"
        );
        fs::create_dir_all(w.root.join("up")).expect("up");
        let moved =
            move_entry(&w.state, &w.root.join("renamed"), &w.root.join("up")).expect("moved");
        assert_eq!(moved.documents.len(), 2);
        for (id, name, text) in [
            (deep, "up/renamed/sub/deep.md", "deep2\n"),
            (top, "up/renamed/top.md", "top2\n"),
            (other, "other.md", "other2\n"),
        ] {
            save_document(&w.state, id, &edit_frame(text)).expect("saved");
            assert_eq!(read(&w.root.join(name)), text, "{name}");
        }
        assert!(!w.root.join("dir").exists() && !w.root.join("renamed").exists());
    }

    #[test]
    fn open_documents_follow_a_case_only_rename() {
        if !platform::current().paths_ignore_case() {
            return;
        }
        let w = workspace();
        write(&w.root.join("a.md"), "one\n");
        open_document(&w.state, &w.root.join("a.md")).expect("opened");
        let id = w.state.documents().entries().next().expect("open").0;
        rename_entry(&w.state, &w.root.join("a.md"), "A.md").expect("renamed");
        save_document(&w.state, id, &edit_frame("two\n")).expect("saved");
        let names: Vec<String> = fs::read_dir(&w.root)
            .expect("dir")
            .map(|entry| entry.expect("entry").file_name().to_string_lossy().into())
            .collect();
        assert_eq!(names, ["A.md"]);
        assert_eq!(read(&w.root.join("A.md")), "two\n");
    }

    #[test]
    fn a_deleted_open_document_keeps_its_entry_and_a_save_recreates_the_file() {
        let w = workspace();
        write(&w.root.join("a.md"), "one\n");
        open_document(&w.state, &w.root.join("a.md")).expect("opened");
        let id = w.state.documents().entries().next().expect("open").0;
        delete_entry(&w.state, &w.os, &w.root.join("a.md")).expect("deleted");
        save_document(&w.state, id, &edit_frame("again\n")).expect("saved");
        assert_eq!(read(&w.root.join("a.md")), "again\n");
    }

    // ---- copy ----

    fn dropped(w: &Workspace, paths: &[&Path]) -> Vec<String> {
        let owned: Vec<PathBuf> = paths.iter().map(|path| path.to_path_buf()).collect();
        w.state.drops().record(&owned);
        paths.iter().map(|path| as_text(path)).collect()
    }

    #[test]
    fn copy_into_folder_copies_files_and_leaves_the_sources_alone() {
        let w = workspace();
        write(&w.outside.join("one.md"), "1");
        write(&w.outside.join("two.txt"), "2");
        fs::create_dir_all(w.root.join("dest")).expect("dest");
        let paths = dropped(&w, &[&w.outside.join("one.md"), &w.outside.join("two.txt")]);
        let report = copy_into(&w.state, &w.os, &w.root.join("dest"), &paths, &[]).expect("copied");
        assert_eq!(report.copied.len(), 2);
        assert!(report.failed.is_empty() && report.skipped.is_empty());
        assert_eq!(read(&w.root.join("dest/one.md")), "1");
        assert_eq!(read(&w.root.join("dest/two.txt")), "2");
        assert_eq!(read(&w.outside.join("one.md")), "1");
        assert_eq!(read(&w.outside.join("two.txt")), "2");
    }

    #[test]
    fn copy_folder_whole_copies_every_file_at_every_depth() {
        let w = workspace();
        write(&w.outside.join("tree/a.md"), "a");
        write(&w.outside.join("tree/deep/er/b.md"), "b");
        write(&w.outside.join("tree/deep/c.png"), "c");
        fs::create_dir_all(w.outside.join("tree/empty")).expect("empty");
        let paths = dropped(&w, &[&w.outside.join("tree")]);
        let report = copy_into(&w.state, &w.os, &w.root, &paths, &[]).expect("copied");
        assert_eq!(report.copied, [as_text(&w.root.join("tree"))]);
        assert_eq!(read(&w.root.join("tree/a.md")), "a");
        assert_eq!(read(&w.root.join("tree/deep/er/b.md")), "b");
        assert_eq!(read(&w.root.join("tree/deep/c.png")), "c");
        assert!(w.root.join("tree/empty").is_dir());
        assert_eq!(read(&w.outside.join("tree/deep/er/b.md")), "b");
        let leftovers: Vec<_> = fs::read_dir(w.root.join("tree"))
            .expect("dir")
            .map(|entry| name_of(&entry.expect("entry").path()))
            .filter(|name| name.ends_with(".mdmate-copy"))
            .collect();
        assert!(leftovers.is_empty(), "no temporary files remain");
    }

    #[test]
    fn a_copy_names_the_clashes_and_changes_nothing_while_asking() {
        let w = workspace();
        write(&w.outside.join("a.md"), "new a");
        write(&w.outside.join("b.md"), "new b");
        write(&w.root.join("a.md"), "old a");
        let paths = dropped(&w, &[&w.outside.join("a.md"), &w.outside.join("b.md")]);
        assert_eq!(
            copy_clashes(&w.state, &w.root, &paths).expect("planned"),
            ["a.md"]
        );
        assert_eq!(read(&w.root.join("a.md")), "old a");
        assert!(!w.root.join("b.md").exists());
    }

    #[test]
    fn each_clash_answer_does_what_it_says() {
        let w = workspace();
        for name in ["rep.md", "keep.md", "skip.md", "none.md"] {
            write(&w.outside.join(name), "new");
            write(&w.root.join(name), "old");
        }
        let paths = dropped(
            &w,
            &[
                &w.outside.join("rep.md"),
                &w.outside.join("keep.md"),
                &w.outside.join("skip.md"),
                &w.outside.join("none.md"),
            ],
        );
        let answers = [
            ClashAnswer {
                name: "rep.md".into(),
                answer: Answer::Replace,
            },
            ClashAnswer {
                name: "keep.md".into(),
                answer: Answer::KeepBoth,
            },
            ClashAnswer {
                name: "skip.md".into(),
                answer: Answer::Skip,
            },
        ];
        let report = copy_into(&w.state, &w.os, &w.root, &paths, &answers).expect("copied");
        assert_eq!(read(&w.root.join("rep.md")), "new");
        assert_eq!(read(&w.root.join("keep.md")), "old");
        assert_eq!(read(&w.root.join("keep (2).md")), "new");
        assert_eq!(read(&w.root.join("skip.md")), "old");
        assert_eq!(
            read(&w.root.join("none.md")),
            "old",
            "no answer means no change"
        );
        assert_eq!(report.skipped, ["skip.md", "none.md"]);
        assert_eq!(report.copied.len(), 2);
    }

    #[test]
    fn replace_sends_the_old_file_to_the_bin_before_the_copy() {
        let w = workspace();
        write(&w.outside.join("a.md"), "new");
        write(&w.root.join("a.md"), "old");
        let paths = dropped(&w, &[&w.outside.join("a.md")]);
        let answers = [ClashAnswer {
            name: "a.md".into(),
            answer: Answer::Replace,
        }];
        copy_into(&w.state, &w.os, &w.root, &paths, &answers).expect("copied");
        assert_eq!(w.os.trashed(), [w.root.join("a.md")]);
        let in_bin: Vec<String> = fs::read_dir(&w.os.bin)
            .expect("bin")
            .map(|entry| read(&entry.expect("entry").path()))
            .collect();
        assert_eq!(in_bin, ["old"], "the old content can be got back");
        assert_eq!(read(&w.root.join("a.md")), "new");
    }

    #[test]
    fn replace_that_cannot_recycle_keeps_the_old_file_and_copies_nothing() {
        let mut w = workspace();
        w.os.full = true;
        write(&w.outside.join("a.md"), "new");
        write(&w.root.join("a.md"), "old");
        let paths = dropped(&w, &[&w.outside.join("a.md")]);
        let answers = [ClashAnswer {
            name: "a.md".into(),
            answer: Answer::Replace,
        }];
        let report = copy_into(&w.state, &w.os, &w.root, &paths, &answers).expect("report");
        assert_eq!(report.failed.len(), 1);
        assert!(report.copied.is_empty());
        assert_eq!(read(&w.root.join("a.md")), "old");
    }

    #[test]
    fn keep_both_numbers_files_before_the_extension_and_folders_and_dotfiles_at_the_end() {
        let w = workspace();
        write(&w.root.join("note.md"), "0");
        write(&w.root.join("note (2).md"), "0");
        write(&w.root.join(".env"), "0");
        write(&w.root.join("v1.2/x"), "0");
        for name in ["note.md", ".env"] {
            write(&w.outside.join(name), "new");
        }
        write(&w.outside.join("v1.2/y"), "new");
        let paths = dropped(
            &w,
            &[
                &w.outside.join("note.md"),
                &w.outside.join(".env"),
                &w.outside.join("v1.2"),
            ],
        );
        let answers: Vec<ClashAnswer> = ["note.md", ".env", "v1.2"]
            .iter()
            .map(|name| ClashAnswer {
                name: (*name).into(),
                answer: Answer::KeepBoth,
            })
            .collect();
        copy_into(&w.state, &w.os, &w.root, &paths, &answers).expect("copied");
        assert_eq!(read(&w.root.join("note (3).md")), "new");
        assert_eq!(read(&w.root.join(".env (2)")), "new");
        assert_eq!(read(&w.root.join("v1.2 (2)/y")), "new");
    }

    #[test]
    fn copying_a_file_onto_itself_never_replaces_it() {
        let w = workspace();
        write(&w.root.join("a.md"), "mine");
        let paths = dropped(&w, &[&w.root.join("a.md")]);
        let answers = [ClashAnswer {
            name: "a.md".into(),
            answer: Answer::Replace,
        }];
        copy_into(&w.state, &w.os, &w.root, &paths, &answers).expect("copied");
        assert_eq!(read(&w.root.join("a.md")), "mine");
        assert_eq!(read(&w.root.join("a (2).md")), "mine");
        assert!(w.os.trashed().is_empty());
    }

    #[test]
    fn a_folder_cannot_be_copied_into_itself() {
        let w = workspace();
        write(&w.root.join("dir/a.md"), "a");
        let paths = dropped(&w, &[&w.root.join("dir")]);
        let report = copy_into(&w.state, &w.os, &w.root.join("dir"), &paths, &[]).expect("report");
        assert_eq!(report.failed.len(), 1);
        assert!(report.copied.is_empty());
        assert_eq!(fs::read_dir(w.root.join("dir")).expect("dir").count(), 1);
    }

    #[test]
    fn a_file_and_a_folder_cannot_replace_each_other() {
        let w = workspace();
        write(&w.outside.join("x"), "file");
        fs::create_dir_all(w.root.join("x")).expect("folder x");
        write(&w.root.join("x/inside.md"), "inside");
        let paths = dropped(&w, &[&w.outside.join("x")]);
        let answers = [ClashAnswer {
            name: "x".into(),
            answer: Answer::Replace,
        }];
        let report = copy_into(&w.state, &w.os, &w.root, &paths, &answers).expect("report");
        assert_eq!(report.failed.len(), 1);
        assert!(w.os.trashed().is_empty());
        assert_eq!(read(&w.root.join("x/inside.md")), "inside");
    }

    #[test]
    fn links_are_left_out_of_a_copy_and_never_followed() {
        let w = workspace();
        write(&w.outside.join("tree/a.md"), "a");
        write(&w.outside.join("elsewhere/secret.md"), "s");
        platform::make_folder_link(&w.outside.join("elsewhere"), &w.outside.join("tree/link"))
            .expect("a link");
        let paths = dropped(&w, &[&w.outside.join("tree")]);
        let report = copy_into(&w.state, &w.os, &w.root, &paths, &[]).expect("copied");
        assert_eq!(report.links_left, 1);
        assert_eq!(read(&w.root.join("tree/a.md")), "a");
        assert!(!w.root.join("tree/link").exists());
        assert!(!w.root.join("tree/link/secret.md").exists());
    }

    #[test]
    fn drop_paths_only_a_path_no_drop_delivered_is_refused_for_every_copy_call() {
        let w = workspace();
        write(&w.outside.join("a.md"), "a");
        write(&w.outside.join("b.md"), "b");
        let delivered = dropped(&w, &[&w.outside.join("a.md")]);
        let never = vec![as_text(&w.outside.join("b.md"))];
        assert_eq!(
            copy_clashes(&w.state, &w.root, &never)
                .expect_err("never")
                .kind(),
            "not-allowed"
        );
        assert_eq!(
            copy_into(&w.state, &w.os, &w.root, &never, &[])
                .expect_err("never")
                .kind(),
            "not-allowed"
        );
        let mixed = [delivered[0].clone(), never[0].clone()].to_vec();
        assert!(copy_into(&w.state, &w.os, &w.root, &mixed, &[]).is_err());
        assert!(
            !w.root.join("a.md").exists(),
            "a refused request copies nothing at all"
        );
    }

    #[test]
    fn a_copy_into_a_folder_outside_the_roots_is_refused() {
        let w = workspace();
        write(&w.outside.join("a.md"), "a");
        let paths = dropped(&w, &[&w.outside.join("a.md")]);
        let other = w.outside.join("other");
        fs::create_dir_all(&other).expect("other");
        assert_eq!(
            copy_into(&w.state, &w.os, &other, &paths, &[])
                .expect_err("outside")
                .kind(),
            "not-allowed"
        );
        assert!(!other.join("a.md").exists());
    }

    #[test]
    fn a_failed_copy_reports_what_was_copied_before_it_stopped() {
        let w = workspace();
        write(&w.outside.join("tree/a.md"), "a");
        write(&w.outside.join("tree/z.md"), "z");
        // A file another program holds open without sharing cannot be read, so its copy fails.
        let Some(_held) = platform::hold_exclusively(&w.outside.join("tree/z.md")) else {
            return;
        };
        let paths = dropped(&w, &[&w.outside.join("tree")]);
        let report = copy_into(&w.state, &w.os, &w.root, &paths, &[]).expect("report");
        assert!(report.copied.is_empty());
        assert_eq!(report.failed.len(), 1);
        assert!(
            report.failed[0]
                .message
                .contains("copied before it stopped"),
            "{}",
            report.failed[0].message
        );
        assert_eq!(
            read(&w.outside.join("tree/a.md")),
            "a",
            "the source is untouched"
        );
    }
}
