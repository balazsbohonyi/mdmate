//! All OS-specific code. Everything outside this module stays portable.

use std::path::Path;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
use linux::Native;
#[cfg(target_os = "macos")]
use macos::Native;
#[cfg(target_os = "windows")]
use windows::Native;

/// What the app needs from the OS.
pub(crate) trait Platform {
    /// The OS name.
    fn name(&self) -> &'static str;

    /// Whether the file system treats `A.md` and `a.md` as one file. Two spellings of a path must
    /// then count as the same document.
    fn paths_ignore_case(&self) -> bool;

    /// Whether a read failed only because another program has the file locked for a moment, as
    /// Windows reports while a file is being replaced. Such a read is worth trying again shortly.
    fn file_is_busy(&self, error: &std::io::Error) -> bool;

    /// Plain words for an OS error code that `std::io::ErrorKind` has no name for, or None to let
    /// the caller word it by kind. The words follow "Could not save a.md:", so they start in lower
    /// case and have no full stop.
    fn os_error_words(&self, _error: &std::io::Error) -> Option<&'static str> {
        None
    }

    /// Hands a URL or a file path to the app the OS uses for it. Only the link guard calls this,
    /// with a target it approved (`links::guard::Approved`); nothing else may.
    fn open_external(&self, target: &str) -> std::io::Result<()>;

    /// Moves a file or a folder to the Recycle Bin (the Trash). It never deletes for good: where
    /// the OS has no bin for the item, it fails and the item stays.
    fn move_to_trash(&self, path: &Path) -> std::io::Result<()>;

    /// Shows the item in the system's file manager, selected where the OS can do that.
    fn reveal(&self, path: &Path) -> std::io::Result<()>;

    /// Opens a folder itself in the system's file manager. The caller has checked it is a folder:
    /// the same call on a file would launch the program the OS has for it.
    fn show_folder(&self, path: &Path) -> std::io::Result<()>;
}

/// The trash crate's call, shared by every OS. On Windows it asks the shell for an undoable
/// delete and reports a drive with no Recycle Bin as an error instead of deleting for good.
fn trash_item(path: &Path) -> std::io::Result<()> {
    trash::delete(path)
        .map_err(|error| std::io::Error::other(crate::error::plain_text(&error.to_string())))
}

/// Holds a file open so that no other reader can open it, for tests of a copy that fails partway.
/// None where the OS has no such lock (a Unix file can always be read by its owner).
#[cfg(test)]
pub(crate) fn hold_exclusively(path: &Path) -> Option<std::fs::File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(path)
            .ok()
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

/// Makes `link` a link to the folder `target` (a junction on Windows, which needs no privilege,
/// and a symbolic link elsewhere), for tests of code that must not follow links.
#[cfg(test)]
pub(crate) fn make_folder_link(target: &Path, link: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()?;
        if made.status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other("mklink failed"))
        }
    }
    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(target, link)
    }
}

/// The implementation for this OS.
pub(crate) fn current() -> impl Platform {
    Native
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_platform_is_named_after_this_os() {
        let expected = if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        };
        assert_eq!(current().name(), expected);
    }

    #[test]
    fn case_sensitivity_matches_the_default_file_system_of_this_os() {
        let expected = !cfg!(target_os = "linux");
        assert_eq!(current().paths_ignore_case(), expected);
    }
    #[test]
    fn codes_with_no_error_kind_are_named_on_windows_and_left_to_the_kind_elsewhere() {
        let words = |code| current().os_error_words(&std::io::Error::from_raw_os_error(code));
        if cfg!(target_os = "windows") {
            assert_eq!(words(32), Some("another program is using it"));
            assert_eq!(words(33), Some("another program is using it"));
            assert_eq!(words(123), Some("that name is not valid"));
            assert_eq!(words(206), Some("the path is too long"));
            // Access denied has a kind, so the caller words it, not this.
            assert_eq!(words(5), None);
        } else {
            assert_eq!(words(32), None);
        }
    }
}
