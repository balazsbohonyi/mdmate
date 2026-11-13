//! ISC-285: mdmate's own new file or folder, rename, move, delete and copy on drop reach the index
//! and its cache at once, without a walk.
//!
//! "Without a walk" is shown by a file another program makes first: a walk would find it, and the
//! index must not, since nothing has read the disk but the one path each operation touched.

use super::testkit::*;
use super::*;
use crate::documents::AppState;
use crate::platform::Platform;
use crate::workspace::ops;
use std::fs;
use std::io;

/// A stand-in for the Recycle Bin: "trashing" moves the item into a folder outside the workspace.
struct Bin(PathBuf);

impl Platform for Bin {
    fn name(&self) -> &'static str {
        "test"
    }
    fn paths_ignore_case(&self) -> bool {
        ignore_case()
    }
    fn file_is_busy(&self, _error: &io::Error) -> bool {
        false
    }
    fn open_external(&self, _target: &str) -> io::Result<()> {
        Ok(())
    }
    fn move_to_trash(&self, path: &Path) -> io::Result<()> {
        fs::create_dir_all(&self.0)?;
        let taken = fs::read_dir(&self.0)?.count();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        fs::rename(path, self.0.join(format!("{taken}-{name}")))
    }
    fn reveal(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }
    fn show_folder(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }
}

struct Workspace {
    _dir: tempfile::TempDir,
    _cache: tempfile::TempDir,
    cache: PathBuf,
    root: PathBuf,
    outside: PathBuf,
    bin: Bin,
    state: AppState,
}

fn workspace(files: &[&str]) -> Workspace {
    let dir = tree(&[]);
    let base = root(&dir);
    let root = base.join("root");
    let outside = base.join("outside");
    fs::create_dir_all(&root).expect("root");
    fs::create_dir_all(&outside).expect("outside");
    for name in files {
        put(&root, name, "x");
    }
    let cache = tempfile::tempdir().expect("a cache dir");
    let state = AppState::new(ignore_case());
    state.access().grant_root(&root).expect("granted");
    state.index().set_cache_dir(cache.path().to_path_buf());
    state.index().add_root_now(&root);
    // Another program adds a file; only a walk would see it.
    put(&root, "sneaky.md", "x");
    Workspace {
        bin: Bin(base.join("bin")),
        cache: cache.path().to_path_buf(),
        _cache: cache,
        _dir: dir,
        root,
        outside,
        state,
    }
}

impl Workspace {
    fn rels(&self) -> Vec<String> {
        self.state.index().rels(&self.root)
    }

    /// What the cache file holds once the index writes it.
    fn cached(&self) -> Vec<String> {
        self.state.index().flush_cache();
        cachefile::load(&self.cache, &display_path(&self.root))
            .expect("a cache file")
            .entries
            .iter()
            .map(|entry| entry.rel.to_string())
            .collect()
    }

    fn shown(&self, rel: &str) -> PathBuf {
        abs_of(&self.root, rel)
    }
}

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn a_new_file_and_a_new_folder_are_held_at_once() {
    let w = workspace(&["a.md"]);
    ops::create_file(&w.state, &w.root, "new.md").expect("created");
    ops::create_folder(&w.state, &w.root, "sub").expect("created");
    ops::create_file(&w.state, &w.shown("sub"), "inner.txt").expect("created");
    let expected = names(&["a.md", "new.md", "sub/inner.txt"]);
    assert_eq!(w.rels(), expected, "and the walk's sneaky.md is not there");
    assert_eq!(w.cached(), expected);
}

#[test]
fn a_renamed_file_and_a_renamed_folder_carry_their_files() {
    let w = workspace(&["a.md", "dir/b.md", "dir/deep/c.txt"]);
    ops::rename_entry(&w.state, &w.shown("a.md"), "renamed.md").expect("renamed");
    ops::rename_entry(&w.state, &w.shown("dir"), "folder").expect("renamed");
    let expected = names(&["folder/b.md", "folder/deep/c.txt", "renamed.md"]);
    assert_eq!(w.rels(), expected);
    assert_eq!(w.cached(), expected);
    // Each kept its size and its kind.
    let entries = w.state.index().entries(&w.root);
    assert!(entries.iter().all(|entry| entry.size == 1));
    assert_eq!(entries[2].kind, FileKind::Markdown);
}

#[test]
fn a_rename_that_changes_the_extension_changes_the_kind() {
    let w = workspace(&["a.md"]);
    ops::rename_entry(&w.state, &w.shown("a.md"), "a.png").expect("renamed");
    let entries = w.state.index().entries(&w.root);
    assert_eq!(entries[0].kind, FileKind::Image);
}

#[test]
fn a_rename_that_only_changes_case_leaves_one_entry() {
    let w = workspace(&["Note.md"]);
    ops::rename_entry(&w.state, &w.shown("Note.md"), "note.md").expect("renamed");
    assert_eq!(w.rels(), names(&["note.md"]));
}

#[test]
fn a_moved_file_and_a_moved_folder_are_held_in_their_new_place() {
    let w = workspace(&["a.md", "b/c.md", "b/d/e.md", "dest/keep.md"]);
    ops::move_entry(&w.state, &w.shown("a.md"), &w.shown("dest")).expect("moved");
    ops::move_entry(&w.state, &w.shown("b"), &w.shown("dest")).expect("moved");
    let expected = names(&["dest/a.md", "dest/b/c.md", "dest/b/d/e.md", "dest/keep.md"]);
    assert_eq!(w.rels(), expected);
    assert_eq!(w.cached(), expected);
}

#[test]
fn a_deleted_file_and_a_deleted_folder_are_gone() {
    let w = workspace(&["a.md", "b.md", "dir/c.md", "dir/deep/d.md", "keep/e.md"]);
    ops::delete_entry(&w.state, &w.bin, &w.shown("a.md")).expect("deleted");
    ops::delete_entry(&w.state, &w.bin, &w.shown("dir")).expect("deleted");
    let expected = names(&["b.md", "keep/e.md"]);
    assert_eq!(w.rels(), expected);
    assert_eq!(w.cached(), expected);
}

#[test]
fn a_copy_on_drop_holds_what_was_copied() {
    let w = workspace(&["a.md"]);
    put(&w.outside, "one.md", "1");
    put(&w.outside, "tree/two.txt", "2");
    put(&w.outside, "tree/deep/three.md", "3");
    let dropped = [w.outside.join("one.md"), w.outside.join("tree")];
    w.state.drops().record(&dropped);
    let paths: Vec<String> = dropped.iter().map(|path| display_path(path)).collect();
    ops::copy_into(&w.state, &w.bin, &w.root, &paths, &[]).expect("copied");
    let expected = names(&["a.md", "one.md", "tree/deep/three.md", "tree/two.txt"]);
    assert_eq!(w.rels(), expected);
    assert_eq!(w.cached(), expected);
}

#[test]
fn what_the_index_holds_matches_the_disk_after_a_run_of_operations() {
    let w = workspace(&["a.md", "b/c.md"]);
    ops::create_folder(&w.state, &w.root, "n").expect("created");
    ops::move_entry(&w.state, &w.shown("a.md"), &w.shown("n")).expect("moved");
    ops::rename_entry(&w.state, &w.shown("b"), "bee").expect("renamed");
    ops::create_file(&w.state, &w.shown("bee"), "x.md").expect("created");
    ops::delete_entry(&w.state, &w.bin, &w.shown("bee/c.md")).expect("deleted");
    remove(&w.root, "sneaky.md");
    assert_eq!(w.rels(), walked_paths(&w.root));
}
