//! Saving without a window where the file is half written: write a temp file next to the target,
//! flush it to disk, then rename it over the target. Until the rename, the original is untouched.

use crate::error::AppError;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// The point in a save where a test can make it fail. Production passes a hook that never does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stage {
    /// The temp file is fully written and flushed; the rename has not happened.
    BeforeRename,
    /// The rename is done and the new bytes are the file. What the hook returns is ignored, since
    /// the file has already been replaced. Tests use this stage to act as another thread that
    /// sees the new file before the save has returned.
    AfterRename,
}

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn temp_path_for(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map_or_else(|| "file".into(), |name| name.to_string_lossy().into_owned());
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    target.with_file_name(format!(
        ".{name}.mdmate-{}-{unique}.tmp",
        std::process::id()
    ))
}

/// Replaces `target` with `bytes`. The target must already be its final path (symlinks resolved),
/// so the temp file lands in the same folder and the rename stays on one volume.
///
/// `hook` is called at each [`Stage`]; one that returns an error stops the save there. This is how
/// the failure tests reach the point just before the rename.
pub(crate) fn write_atomic_with(
    target: &Path,
    bytes: &[u8],
    hook: impl Fn(Stage) -> std::io::Result<()>,
) -> Result<(), AppError> {
    let temp = temp_path_for(target);
    let result = write_then_swap(target, &temp, bytes, &hook);
    if result.is_err() {
        // Best effort: a leftover temp file is clutter, never a reason to hide the real error.
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn write_then_swap(
    target: &Path,
    temp: &Path,
    bytes: &[u8],
    hook: &impl Fn(Stage) -> std::io::Result<()>,
) -> Result<(), AppError> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    // Keep the original's permissions (a read-only flag then makes the rename fail, which is right:
    // the file stays as it was).
    if let Ok(meta) = std::fs::metadata(target) {
        std::fs::set_permissions(temp, meta.permissions())?;
    }
    hook(Stage::BeforeRename)?;
    std::fs::rename(temp, target).map_err(|error| {
        // A read-only file refuses the rename with "access denied", which says nothing; name it.
        if error.kind() == std::io::ErrorKind::PermissionDenied
            && std::fs::metadata(target).is_ok_and(|meta| meta.permissions().readonly())
        {
            AppError::FileReadOnly
        } else {
            AppError::Io(error)
        }
    })?;
    let _ = hook(Stage::AfterRename);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), AppError> {
        write_atomic_with(target, bytes, |_| Ok(()))
    }

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .expect("the folder is readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn replaces_the_file_and_leaves_no_temp_file() {
        let dir = dir();
        let path = dir.path().join("note.md");
        std::fs::write(&path, b"old").expect("the file can be written");
        write_atomic(&path, b"new").expect("the save succeeds");
        assert_eq!(std::fs::read(&path).expect("readable"), b"new");
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn creates_a_file_that_is_not_there_yet() {
        let dir = dir();
        let path = dir.path().join("fresh.md");
        write_atomic(&path, b"hello").expect("the save succeeds");
        assert_eq!(std::fs::read(&path).expect("readable"), b"hello");
    }

    #[test]
    fn atomic_save_failure_before_the_rename_leaves_the_original_intact() {
        let dir = dir();
        let path = dir.path().join("note.md");
        let original = b"precious words\r\nline two\r\n";
        std::fs::write(&path, original).expect("the file can be written");

        let error = write_atomic_with(&path, b"half-written replacement", |stage| match stage {
            Stage::BeforeRename => Err(std::io::Error::other("injected failure")),
            Stage::AfterRename => Ok(()),
        })
        .expect_err("the hook makes the save fail");

        assert_eq!(error.kind(), "io");
        assert_eq!(std::fs::read(&path).expect("readable"), original);
        assert!(
            leftovers(dir.path()).is_empty(),
            "the temp file is cleaned up"
        );
    }

    #[test]
    fn atomic_save_failure_leaves_a_missing_file_missing() {
        let dir = dir();
        let path = dir.path().join("new.md");
        write_atomic_with(&path, b"x", |_| {
            Err(std::io::Error::other("injected failure"))
        })
        .expect_err("the hook makes the save fail");
        assert!(!path.exists());
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn atomic_save_failure_when_the_rename_itself_fails_keeps_the_original() {
        let dir = dir();
        // A folder where the file should be: the rename cannot replace it.
        let path = dir.path().join("blocked.md");
        std::fs::create_dir(&path).expect("the folder can be created");
        std::fs::write(path.join("inside.txt"), b"keep").expect("the file can be written");
        write_atomic(&path, b"new").expect_err("a folder cannot be replaced by a file");
        assert_eq!(
            std::fs::read(path.join("inside.txt")).expect("readable"),
            b"keep"
        );
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn a_read_only_file_stays_as_it_was() {
        let dir = dir();
        let path = dir.path().join("locked.md");
        std::fs::write(&path, b"locked").expect("the file can be written");
        let mut permissions = std::fs::metadata(&path).expect("metadata").permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).expect("permissions can be set");

        let result = write_atomic(&path, b"new");

        // Windows refuses the rename; Unix lets the owner replace a file in a writable folder.
        if let Err(error) = &result {
            assert_eq!(std::fs::read(&path).expect("readable"), b"locked");
            // And it says why in words, with no OS code: the file is read-only.
            assert_eq!(error.kind(), "file-read-only");
            let message = error.to_string();
            assert!(message.contains("read-only"), "{message}");
            assert!(!message.contains("os error"), "{message}");
        }
        assert!(leftovers(dir.path()).is_empty());
        let mut permissions = std::fs::metadata(&path).expect("metadata").permissions();
        // Test cleanup on a temp file: the file must be writable again before the folder is removed.
        #[allow(
            clippy::permissions_set_readonly_false,
            reason = "see the comment above"
        )]
        permissions.set_readonly(false);
        std::fs::set_permissions(&path, permissions).expect("permissions can be reset");
    }
}
