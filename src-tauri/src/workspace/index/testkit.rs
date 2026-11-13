//! Helpers the index tests share: a quiet index, and trees made in a temp folder.

use super::*;
use std::fs;
use tempfile::TempDir;

/// An index with no real watcher and no cache folder, so a test controls every change.
pub(super) fn index() -> WorkspaceIndex {
    WorkspaceIndex::new(ignore_case()).without_watcher()
}

/// A temp folder holding these paths. A name ending in `/` is an empty folder; any other is a file
/// holding the text `x`.
pub(super) fn tree(names: &[&str]) -> TempDir {
    let dir = tempfile::tempdir().expect("a temp dir can be created");
    for name in names {
        if let Some(folder) = name.strip_suffix('/') {
            fs::create_dir_all(dir.path().join(folder)).expect("the folder is made");
        } else {
            put(dir.path(), name, "x");
        }
    }
    dir
}

/// The folder as the app names a root: canonical, which is what `Access` hands the index.
pub(super) fn root(dir: &TempDir) -> PathBuf {
    fs::canonicalize(dir.path()).expect("the temp dir resolves")
}

/// Writes a file below `root`, with its folders.
pub(super) fn put(root: &Path, rel: &str, text: &str) {
    let path = abs_of(root, rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("the folders are made");
    }
    fs::write(path, text).expect("the file is written");
}

/// Deletes a file below `root`.
pub(super) fn remove(root: &Path, rel: &str) {
    fs::remove_file(abs_of(root, rel)).expect("the file is removed");
}

/// What a walk of the disk finds under `root`, by the rules the index follows, sorted the way the
/// index sorts. The independent answer a test compares the index with.
pub(super) fn walked_paths(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(&folder).expect("readable").flatten() {
            let kind = entry.file_type().expect("typed");
            let name = entry.file_name();
            if kind.is_dir() {
                if !crate::fs::exclude::is_excluded_dir(&name) {
                    folders.push(entry.path());
                }
            } else if kind.is_file() {
                found.push(rel_string(
                    entry.path().strip_prefix(root).expect("inside the root"),
                ));
            }
        }
    }
    found.sort_by(|a, b| cmp_rel(a, b));
    found
}

/// Whether this machine's file system treats names that differ in case as one.
pub(super) fn ignore_case() -> bool {
    use crate::platform::Platform as _;
    crate::platform::current().paths_ignore_case()
}
