//! Helpers for the tests that need a real git and a real repository.

use std::path::{Path, PathBuf};
use std::process::Command;

/// The git on this machine, or None. A test that needs one calls [`require_git`] and returns when
/// there is none, with a note in the test output, so a machine without git does not fail.
pub(crate) fn installed() -> Option<PathBuf> {
    super::locate::find("")
}

/// The git on this machine, or None after saying in the test output that `test` was skipped.
pub(crate) fn require_git(test: &str) -> Option<PathBuf> {
    let found = installed();
    if found.is_none() {
        eprintln!("SKIPPED {test}: git is not installed, so no repository can be made");
    }
    found
}

/// Runs git in `dir` and panics if it fails.
pub(crate) fn run_git(git: &Path, dir: &Path, args: &[&str]) {
    let output = Command::new(git)
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .expect("git can be started");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Makes `dir` (and the folders above it) and turns it into a repository with a known identity.
pub(crate) fn init_repo(git: &Path, dir: &Path) {
    std::fs::create_dir_all(dir).expect("the folder can be made");
    run_git(git, dir, &["init", "-q"]);
    run_git(git, dir, &["config", "user.name", "mdmate test"]);
    run_git(git, dir, &["config", "user.email", "test@example.invalid"]);
}

/// Writes a file, making its folders first.
pub(crate) fn write(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("the folder can be made");
    }
    std::fs::write(path, text).expect("the file can be written");
}

/// Stages everything and commits it.
pub(crate) fn commit_all(git: &Path, dir: &Path) {
    run_git(git, dir, &["add", "-A"]);
    run_git(git, dir, &["commit", "-q", "-m", "test"]);
}

/// A temp folder, canonical so two spellings of it do not differ.
pub(crate) fn temp() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("a temp dir can be created");
    let path = PathBuf::from(crate::access::display_path(
        &std::fs::canonicalize(dir.path()).expect("it resolves"),
    ));
    (dir, path)
}
