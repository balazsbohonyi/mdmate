//! All OS-specific code. Everything outside this module stays portable.

use std::path::{Path, PathBuf};

pub(crate) mod fonts;
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

    /// The family names of the installed fonts, each once and sorted, for the font fields in
    /// Settings. Where the OS has no font folders to read, it says so and the page offers no list.
    fn font_families(&self) -> std::io::Result<Vec<String>> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "listing the installed fonts is not available on this system",
        ))
    }

    /// Keeps a program the app starts from opening a console window of its own (Windows gives a
    /// console program started by a window app one, which flashes). Elsewhere there is nothing to do.
    fn hide_console(&self, _command: &mut std::process::Command) {}

    /// Where git is usually installed, in the order to look, for when it is not on the PATH.
    fn standard_git_paths(&self) -> Vec<PathBuf> {
        Vec::new()
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

    /// Starts a native drag of these files out of the window, as copies, and returns when it ends:
    /// true when they were dropped somewhere, false when it was cancelled. It blocks while the
    /// OS runs the drag, so it must be called on the thread that owns the window. The caller has
    /// checked every path. Where this OS has no such drag, it says so and nothing starts.
    fn drag_files_out(
        &self,
        _window: &tauri::WebviewWindow,
        _paths: Vec<std::path::PathBuf>,
    ) -> std::io::Result<bool> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "dragging files out of the window is not available on this system",
        ))
    }

    /// Turns off the web view's own browser shortcuts (reload, view source, zoom, find and the
    /// like), so only the app's keybindings act. Developer tools stay reachable through
    /// `open_devtools`. Where the web view has no such shortcuts, this does nothing.
    fn disable_browser_keys(&self, _window: &tauri::WebviewWindow) {}
}

/// The trash crate's call, shared by every OS. On Windows it asks the shell for an undoable
/// delete and reports a drive with no Recycle Bin as an error instead of deleting for good.
fn trash_item(path: &Path) -> std::io::Result<()> {
    trash::delete(path)
        .map_err(|error| std::io::Error::other(crate::error::plain_text(&error.to_string())))
}

/// What a fake program does, for tests of code that starts programs.
#[cfg(test)]
pub(crate) enum FakeProgram<'a> {
    /// Ends at once with this exit code.
    Exit(i32),
    /// Waits about this many seconds, then ends well.
    Sleep { seconds: u64 },
    /// Writes the arguments it was given to this file and ends well.
    Record { to: &'a Path },
}

/// Writes a small program for this OS into `dir` and returns its path (a `.cmd` file on Windows, an
/// executable `sh` script elsewhere), for tests of code that must run a program it does not control.
#[cfg(test)]
pub(crate) fn write_fake_program(
    dir: &Path,
    name: &str,
    behaviour: &FakeProgram<'_>,
) -> std::io::Result<PathBuf> {
    #[cfg(windows)]
    {
        let body = match behaviour {
            FakeProgram::Exit(code) => format!("@echo off\r\nexit /b {code}\r\n"),
            FakeProgram::Sleep { seconds } => {
                format!("@echo off\r\nping -n {} 127.0.0.1 >nul\r\n", seconds + 1)
            }
            FakeProgram::Record { to } => {
                format!("@echo off\r\necho %* > \"{}\"\r\n", to.display())
            }
        };
        let path = dir.join(format!("{name}.cmd"));
        std::fs::write(&path, body)?;
        Ok(path)
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let body = match behaviour {
            FakeProgram::Exit(code) => format!("#!/bin/sh\nexit {code}\n"),
            FakeProgram::Sleep { seconds } => format!("#!/bin/sh\nsleep {seconds}\n"),
            FakeProgram::Record { to } => {
                format!("#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\n", to.display())
            }
        };
        let path = dir.join(name);
        std::fs::write(&path, body)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
        Ok(path)
    }
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
