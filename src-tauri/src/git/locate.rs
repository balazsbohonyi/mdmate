//! Finding the git program: the owner's `git.path`, then the PATH, then the usual install folders.
//!
//! Nothing here runs git. A `git.path` that names no file does not stop the search: the next place
//! is tried, so a stale setting costs the colours nothing while git is installed somewhere usual.
//! When none is found there is no error either; the tree simply has no git colours.

use crate::platform::{self, Platform as _};
use std::ffi::OsStr;
use std::path::PathBuf;

/// The file name of the git program on this OS.
fn program_name() -> String {
    format!("git{}", std::env::consts::EXE_SUFFIX)
}

/// The git program to use, or None. `setting` is `git.path` (empty for "find it"), `path_var` the
/// PATH, `standard` the usual install places in the order to look. All three are parameters so a
/// test can name a fixture for each.
pub(crate) fn locate(
    setting: &str,
    path_var: Option<&OsStr>,
    standard: &[PathBuf],
) -> Option<PathBuf> {
    let set = setting.trim();
    if !set.is_empty() {
        let chosen = PathBuf::from(set);
        if chosen.is_file() {
            return Some(chosen);
        }
    }
    if let Some(var) = path_var {
        for folder in std::env::split_paths(var) {
            if folder.as_os_str().is_empty() {
                continue;
            }
            let candidate = folder.join(program_name());
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    standard
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
}

/// The git program on this machine for this `git.path`, or None.
pub(crate) fn find(setting: &str) -> Option<PathBuf> {
    locate(
        setting,
        std::env::var_os("PATH").as_deref(),
        &platform::current().standard_git_paths(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder with a file named like the git program in it.
    fn with_git(parent: &std::path::Path, name: &str) -> (PathBuf, PathBuf) {
        let folder = parent.join(name);
        std::fs::create_dir_all(&folder).expect("makes the folder");
        let program = folder.join(program_name());
        std::fs::write(&program, b"not really git").expect("writes it");
        (folder, program)
    }

    fn path_of(folders: &[&PathBuf]) -> std::ffi::OsString {
        std::env::join_paths(folders).expect("a PATH can be joined")
    }

    #[test]
    fn the_setting_comes_first_then_the_path_then_the_standard_folders() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (on_path, on_path_git) = with_git(dir.path(), "on-path");
        let (_, standard_git) = with_git(dir.path(), "standard");
        let (_, chosen) = with_git(dir.path(), "chosen");
        let var = path_of(&[&on_path]);
        let standard = [standard_git.clone()];

        let all_three = locate(chosen.to_str().expect("utf8"), Some(&var), &standard);
        assert_eq!(all_three, Some(chosen));
        let path_and_standard = locate("", Some(&var), &standard);
        assert_eq!(path_and_standard, Some(on_path_git));
        let only_standard = locate("", Some(OsStr::new("")), &standard);
        assert_eq!(only_standard, Some(standard_git));
    }

    #[test]
    fn the_path_is_read_in_order_and_empty_or_missing_entries_are_skipped() {
        let dir = tempfile::tempdir().expect("temp dir");
        let empty = dir.path().join("empty");
        std::fs::create_dir_all(&empty).expect("makes it");
        let missing = dir.path().join("missing");
        let (second, second_git) = with_git(dir.path(), "second");
        let (third, _) = with_git(dir.path(), "third");
        let var = path_of(&[&empty, &missing, &second, &third]);
        assert_eq!(locate("", Some(&var), &[]), Some(second_git));
    }

    #[test]
    fn a_setting_that_names_no_file_falls_through_to_the_next_place() {
        let dir = tempfile::tempdir().expect("temp dir");
        let (on_path, on_path_git) = with_git(dir.path(), "on-path");
        let var = path_of(&[&on_path]);
        let missing = dir.path().join("nope").join(program_name());
        let a_folder = dir.path().join("on-path");
        for setting in [
            missing.to_str().expect("utf8"),
            a_folder.to_str().expect("utf8"),
        ] {
            assert_eq!(
                locate(setting, Some(&var), &[]),
                Some(on_path_git.clone()),
                "{setting}"
            );
        }
        // A setting with spaces round it is read as the path it holds.
        let spaced = format!("  {}  ", on_path_git.display());
        assert_eq!(locate(&spaced, None, &[]), Some(on_path_git));
    }

    #[test]
    fn with_none_found_the_answer_is_none_and_nothing_fails() {
        let dir = tempfile::tempdir().expect("temp dir");
        let nothing = dir.path().join("nothing");
        std::fs::create_dir_all(&nothing).expect("makes it");
        let var = path_of(&[&nothing]);
        let missing = dir.path().join("missing").join(program_name());
        assert_eq!(locate("", Some(&var), std::slice::from_ref(&missing)), None);
        assert_eq!(locate("", None, &[]), None);
        assert_eq!(locate("   ", Some(OsStr::new("")), &[]), None);
    }

    #[test]
    fn the_real_search_does_not_fail_whether_or_not_git_is_installed() {
        // The answer depends on the machine; asking must never panic, and a hit is a file.
        if let Some(found) = find("") {
            assert!(found.is_file());
        }
        assert!(find("/definitely/not/a/file/git").is_none() || find("").is_some());
    }
}
