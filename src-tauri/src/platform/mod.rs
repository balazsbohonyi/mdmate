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
}

/// The implementation for this OS.
pub(crate) fn current() -> impl Platform {
    Native
}
