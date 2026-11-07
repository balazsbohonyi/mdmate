//! All OS-specific code. Everything outside this module stays portable.

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
}
