//! Finding the git repositories under a workspace root.
//!
//! A root can sit inside a repository, hold several, or hold a repository inside a repository, so
//! three searches run: up from the root to the repository that holds it, down a few levels (the
//! built-in excluded folder names are skipped, so a `node_modules` full of packages is never
//! walked), and one level down from each folder the tree has listed, which reaches a repository
//! deeper than the scan. A repository is a folder with a `.git` in it, which is a folder, or a file
//! for a worktree or a submodule. Links are not followed: one could lead out of the root or round
//! in a circle.
//!
//! The innermost repository decides about a path ([`innermost`]); a repository's own folder counts
//! as inside it.

use crate::fs::exclude::is_excluded_dir;
use std::path::{Path, PathBuf};

/// How many levels below the root the scan goes.
pub(crate) const SCAN_DEPTH: usize = 3;

/// The most folders the scan looks at, so a root with a huge tree of folders does not stall it.
const SCAN_BUDGET: usize = 5000;

fn has_git(folder: &Path) -> bool {
    folder.join(".git").exists()
}

/// The folders directly in `folder`, except links and the excluded names, in order.
fn child_folders(folder: &Path) -> Vec<PathBuf> {
    let Ok(read) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = read
        .flatten()
        .filter(|item| item.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|item| !is_excluded_dir(&item.file_name()))
        .map(|item| item.path())
        .collect();
    found.sort();
    found
}

/// The repositories to read for a root: the one that holds it (the innermost), the ones in the
/// folders under it, and the ones one level under each folder in `listed`. Sorted, each once; an
/// outer repository comes before the ones inside it.
pub(crate) fn discover(root: &Path, listed: &[PathBuf]) -> Vec<PathBuf> {
    discover_with(root, listed, SCAN_DEPTH, SCAN_BUDGET)
}

/// The innermost repository that is `folder` or holds it.
pub(crate) fn holder(folder: &Path) -> Option<&Path> {
    folder.ancestors().find(|folder| has_git(folder))
}

fn discover_with(root: &Path, listed: &[PathBuf], depth: usize, budget: usize) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    if let Some(holder) = holder(root) {
        found.push(holder.to_path_buf());
    }
    let mut level = vec![root.to_path_buf()];
    let mut spent = 0;
    'scan: for _ in 0..depth {
        let mut next = Vec::new();
        for folder in &level {
            for child in child_folders(folder) {
                spent += 1;
                if spent > budget {
                    break 'scan;
                }
                if has_git(&child) {
                    found.push(child.clone());
                }
                next.push(child);
            }
        }
        level = next;
    }
    for folder in listed {
        found.extend(
            child_folders(folder)
                .into_iter()
                .filter(|child| has_git(child)),
        );
    }
    found.sort();
    found.dedup();
    found
}

/// The index of the innermost repository that holds `path`, or None for a path no repository holds.
pub(crate) fn innermost(repos: &[PathBuf], path: &Path) -> Option<usize> {
    repos
        .iter()
        .enumerate()
        .filter(|(_, repo)| path.starts_with(repo))
        .max_by_key(|(_, repo)| repo.components().count())
        .map(|(at, _)| at)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_at(path: &Path) {
        std::fs::create_dir_all(path.join(".git")).expect("makes the .git folder");
    }

    fn names(root: &Path, found: &[PathBuf]) -> Vec<String> {
        found
            .iter()
            .map(|path| {
                path.strip_prefix(root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    /// A root inside a repository that holds three repositories two levels down, one of them with
    /// another inside it, and `node_modules` folders that each hold a repository.
    fn layout() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let outer = dir.path().to_path_buf();
        repo_at(&outer);
        let root = outer.join("work");
        for name in ["one", "two", "three"] {
            repo_at(&root.join("group").join(name));
        }
        repo_at(&root.join("group").join("one").join("inner"));
        repo_at(&root.join("node_modules").join("package"));
        repo_at(&root.join("group").join("node_modules").join("package"));
        (dir, outer, root)
    }

    #[test]
    fn the_enclosing_repository_and_the_ones_two_levels_down_are_found_and_node_modules_is_not_walked()
     {
        let (_keep, outer, root) = layout();
        let found = discover(&root, &[]);
        assert_eq!(
            names(&outer, &found),
            [
                "",
                "work/group/one",
                "work/group/one/inner",
                "work/group/three",
                "work/group/two",
            ]
        );
    }

    #[test]
    fn a_root_that_is_itself_a_repository_is_one_and_is_not_listed_twice() {
        let dir = tempfile::tempdir().expect("temp dir");
        repo_at(dir.path());
        repo_at(&dir.path().join("sub"));
        let found = discover(dir.path(), &[]);
        assert_eq!(names(dir.path(), &found), ["", "sub"]);
    }

    #[test]
    fn a_dot_git_file_counts_as_a_repository_for_worktrees_and_submodules() {
        let dir = tempfile::tempdir().expect("temp dir");
        let worktree = dir.path().join("worktree");
        std::fs::create_dir_all(&worktree).expect("makes it");
        std::fs::write(worktree.join(".git"), "gitdir: ../main/.git/worktrees/w\n")
            .expect("writes the file");
        let found = discover(dir.path(), &[]);
        assert_eq!(names(dir.path(), &found), ["worktree"]);
    }

    #[test]
    fn a_root_in_no_repository_with_none_under_it_has_none() {
        let dir = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(dir.path().join("a").join("b")).expect("makes it");
        // The temp folder may itself lie inside a repository on some machine; only what is under
        // the root is certain, so look at that.
        let found = discover(dir.path(), &[]);
        assert!(
            found
                .iter()
                .all(|repo| !repo.starts_with(dir.path()) || repo == dir.path())
        );
        assert!(
            found
                .iter()
                .all(|repo| !repo.starts_with(dir.path().join("a")))
        );
    }

    #[test]
    fn the_scan_stops_three_levels_down_and_a_listed_folder_reaches_one_more() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().to_path_buf();
        let level3 = root.join("a").join("b").join("c");
        let level4 = level3.join("d");
        repo_at(&level3);
        repo_at(&level4);
        let found = discover(&root, &[]);
        assert_eq!(names(&root, &found), ["a/b/c"]);
        // The tree listed `a/b/c`, so the folders directly in it are checked for a repository.
        let listed = discover(&root, std::slice::from_ref(&level3));
        assert_eq!(names(&root, &listed), ["a/b/c", "a/b/c/d"]);
        assert_eq!(SCAN_DEPTH, 3);
    }

    #[test]
    fn the_excluded_names_are_skipped_in_a_listed_folder_too() {
        let dir = tempfile::tempdir().expect("temp dir");
        let listed = dir.path().join("deep");
        repo_at(&listed.join("node_modules"));
        repo_at(&listed.join("kept"));
        let found = discover(dir.path(), std::slice::from_ref(&listed));
        assert_eq!(names(dir.path(), &found), ["deep/kept"]);
    }

    #[test]
    fn a_link_is_not_followed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let elsewhere = tempfile::tempdir().expect("another temp dir");
        repo_at(&elsewhere.path().join("hidden"));
        let root = dir.path().join("root");
        std::fs::create_dir_all(&root).expect("makes it");
        if crate::platform::make_folder_link(elsewhere.path(), &root.join("link")).is_err() {
            eprintln!("SKIPPED a_link_is_not_followed: no link could be made here");
            return;
        }
        let found = discover(&root, &[]);
        assert!(
            found
                .iter()
                .all(|repo| !repo.to_string_lossy().contains("hidden")),
            "{found:?}"
        );
    }

    #[test]
    fn a_scan_that_runs_out_of_budget_stops_with_what_it_has() {
        let dir = tempfile::tempdir().expect("temp dir");
        for name in ["a", "b", "c", "d"] {
            repo_at(&dir.path().join(name));
        }
        let found = discover_with(dir.path(), &[], 3, 2);
        assert_eq!(found.len(), 2, "{found:?}");
    }

    #[test]
    fn the_innermost_repository_decides_and_a_repository_folder_is_inside_itself() {
        let repos = vec![
            PathBuf::from("/w"),
            PathBuf::from("/w/group/one"),
            PathBuf::from("/w/group/one/inner"),
            PathBuf::from("/w/group/two"),
        ];
        let at = |path: &str| innermost(&repos, Path::new(path));
        assert_eq!(at("/w/readme.md"), Some(0));
        assert_eq!(at("/w/group/one/a.md"), Some(1));
        assert_eq!(at("/w/group/one"), Some(1));
        assert_eq!(at("/w/group/one/inner"), Some(2));
        assert_eq!(at("/w/group/one/inner/deep/x.md"), Some(2));
        assert_eq!(at("/w/group/two/x.md"), Some(3));
        // Whole path parts only: `one-more` is not inside `one`.
        assert_eq!(at("/w/group/one-more/x.md"), Some(0));
        assert_eq!(at("/elsewhere/x.md"), None);
        assert_eq!(innermost(&[], Path::new("/w")), None);
    }
}
