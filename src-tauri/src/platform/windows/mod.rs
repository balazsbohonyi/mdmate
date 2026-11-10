//! Windows implementation.
#![allow(
    unsafe_code,
    reason = "opening a link needs the shell's ShellExecuteW and COM's apartment calls, which are FFI; each block says why it is sound"
)]

use super::Platform;
use std::ffi::c_void;
use std::os::windows::process::CommandExt as _;
use std::path::Path;
use std::ptr::{null, null_mut};

#[derive(Debug)]
pub(crate) struct Native;

#[link(name = "shell32")]
unsafe extern "system" {
    fn ShellExecuteW(
        hwnd: *mut c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> *mut c_void;
}

#[link(name = "ole32")]
unsafe extern "system" {
    fn CoInitializeEx(reserved: *const c_void, coinit: u32) -> i32;
    fn CoUninitialize();
}

const COINIT_APARTMENTTHREADED: u32 = 0x2;
const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
const SW_SHOWNORMAL: i32 = 1;

/// A NUL-terminated UTF-16 copy of `text`.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

impl Platform for Native {
    fn name(&self) -> &'static str {
        "windows"
    }

    fn paths_ignore_case(&self) -> bool {
        true
    }

    fn file_is_busy(&self, error: &std::io::Error) -> bool {
        // 32 and 33 are the sharing and lock violations. Access denied joins them because a file
        // that is being swapped for a new one answers that way for a moment.
        matches!(error.raw_os_error(), Some(32 | 33))
            || error.kind() == std::io::ErrorKind::PermissionDenied
    }

    fn open_external(&self, target: &str) -> std::io::Result<()> {
        if target.contains('\0') {
            return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
        }
        let (verb, file) = (wide("open"), wide(target));
        // A fresh thread, so COM can be set up the way the shell's docs ask (single-threaded
        // apartment, no OLE1 DDE) whatever the calling thread already uses.
        let opened = std::thread::spawn(move || {
            // SAFETY: the reserved argument must be null, and the flags are valid COINIT values.
            let initialized = unsafe {
                CoInitializeEx(null(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
            };
            // SAFETY: `verb` and `file` are NUL-terminated and outlive the call; a null window,
            // null parameters and a null folder are all allowed by the API. No parameters are
            // passed, so the target is never read as a command line.
            let result = unsafe {
                ShellExecuteW(
                    null_mut(),
                    verb.as_ptr(),
                    file.as_ptr(),
                    null(),
                    null(),
                    SW_SHOWNORMAL,
                )
            };
            if initialized >= 0 {
                // SAFETY: balances the successful CoInitializeEx above, on the same thread.
                unsafe { CoUninitialize() };
            }
            // Values above 32 mean success; the rest are error codes.
            result.addr() > 32
        })
        .join()
        .map_err(|_| std::io::Error::other("the shell call panicked"))?;
        if opened {
            Ok(())
        } else {
            Err(std::io::Error::other("the shell refused to open it"))
        }
    }

    fn move_to_trash(&self, path: &Path) -> std::io::Result<()> {
        super::trash_item(path)
    }

    fn reveal(&self, path: &Path) -> std::io::Result<()> {
        // Explorer reads `/select,"path"` as one raw argument; quoting it the way Rust does for
        // an argument with spaces ("/select,path" in quotes) makes it open Documents instead.
        let shown = crate::access::display_path(path);
        if shown.contains('"') || shown.contains('\0') {
            return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
        }
        let mut child = std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{shown}\""))
            .spawn()?;
        // Explorer exits with 1 even when it worked, so the result is not read.
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}
