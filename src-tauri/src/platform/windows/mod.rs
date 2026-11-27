//! Windows implementation.
#![allow(
    unsafe_code,
    reason = "opening a link needs the shell's ShellExecuteW and COM's apartment calls, which are FFI; each block says why it is sound"
)]

use super::Platform;
use super::bin::{self, BinRoom, BinWatcher};
use std::ffi::c_void;
use std::os::windows::process::CommandExt as _;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::Arc;

mod shell_bin;

#[derive(Debug)]
pub(crate) struct Native;

/// The process creation flag that gives a console program no console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where Git for Windows installs by default, in the order to look: under each Program Files
/// folder the environment names, under the user's programs folder, then the usual spellings.
/// `env` reads one environment variable; it is a parameter so a test can name the folders.
fn git_install_paths(env: impl Fn(&str) -> Option<std::ffi::OsString>) -> Vec<std::path::PathBuf> {
    let mut found: Vec<std::path::PathBuf> = Vec::new();
    let mut add = |path: std::path::PathBuf| {
        if !found.contains(&path) {
            found.push(path);
        }
    };
    for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(base) = env(variable) {
            add(Path::new(&base).join(r"Git\cmd\git.exe"));
        }
    }
    if let Some(base) = env("LocalAppData") {
        add(Path::new(&base).join(r"Programs\Git\cmd\git.exe"));
    }
    add(Path::new(r"C:\Program Files\Git\cmd\git.exe").to_path_buf());
    add(Path::new(r"C:\Program Files (x86)\Git\cmd\git.exe").to_path_buf());
    found
}

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

    fn font_families(&self) -> std::io::Result<Vec<String>> {
        Ok(super::fonts::installed_families())
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

    fn os_error_words(&self, error: &std::io::Error) -> Option<&'static str> {
        match error.raw_os_error()? {
            32 | 33 => Some("another program is using it"),
            123 | 161 => Some("that name is not valid"),
            206 => Some("the path is too long"),
            _ => None,
        }
    }

    fn hide_console(&self, command: &mut std::process::Command) {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    fn standard_git_paths(&self) -> Vec<std::path::PathBuf> {
        git_install_paths(|name| std::env::var_os(name))
    }

    fn program_extensions(&self) -> &'static [&'static str] {
        &["exe"]
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
        // Through the guard, since the shell can destroy what its bin cannot take.
        bin::one(self, path)
    }

    fn bin_room(&self, path: &Path) -> BinRoom {
        shell_bin::bin_room(path)
    }

    fn recycle(
        &self,
        paths: &[PathBuf],
        owner: Option<isize>,
        watcher: Arc<dyn BinWatcher>,
    ) -> std::io::Result<()> {
        shell_bin::recycle(paths, owner, watcher)
    }

    fn hold_folder(&self, path: &Path) -> std::io::Result<Box<dyn std::any::Any>> {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        // Sharing reads only: while this handle lives, nothing can rename or remove the folder
        // to put a link in its place. Opening it never goes through a link.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ.0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)?;
        if !held.metadata()?.is_dir() {
            return Err(std::io::Error::other("it is no longer a folder"));
        }
        Ok(Box::new(held))
    }

    fn remove_even_read_only(
        &self,
        path: &Path,
        remove: &dyn Fn() -> std::io::Result<()>,
    ) -> std::io::Result<()> {
        let Err(refused) = remove() else {
            return Ok(());
        };
        let Ok(meta) = std::fs::symlink_metadata(path) else {
            return Err(refused);
        };
        // A link keeps its mark: changing it would change what the link leads to.
        if refused.kind() != std::io::ErrorKind::PermissionDenied
            || meta.file_type().is_symlink()
            || !meta.permissions().readonly()
        {
            return Err(refused);
        }
        let mut writable = meta.permissions();
        // Clearing the mark is all this does on Windows, whatever the lint fears for Unix.
        #[expect(
            clippy::permissions_set_readonly_false,
            reason = "on Windows this only clears the read-only attribute"
        )]
        writable.set_readonly(false);
        std::fs::set_permissions(path, writable)?;
        let removed = remove();
        if removed.is_err() {
            // The item stays, so it stays as it was.
            let _ = std::fs::set_permissions(path, meta.permissions());
        }
        removed
    }

    fn window_handle(&self, window: &tauri::WebviewWindow) -> Option<isize> {
        window.hwnd().ok().map(|handle| handle.0 as isize)
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

    fn drag_files_out(
        &self,
        window: &tauri::WebviewWindow,
        paths: Vec<std::path::PathBuf>,
    ) -> std::io::Result<bool> {
        use std::sync::atomic::{AtomicBool, Ordering};
        // OLE's drag runs its own message loop inside this call and reports through the callback
        // before it returns. Copy is the only effect offered, so a drop can never move the file.
        let dropped = Arc::new(AtomicBool::new(false));
        let seen = Arc::clone(&dropped);
        drag::start_drag(
            window,
            drag::DragItem::Files(paths),
            drag::Image::Raw(Vec::new()),
            move |result, _| {
                seen.store(
                    matches!(result, drag::DragResult::Dropped),
                    Ordering::SeqCst,
                )
            },
            drag::Options::default(),
        )
        .map_err(std::io::Error::other)?;
        Ok(dropped.load(Ordering::SeqCst))
    }

    fn show_folder(&self, path: &Path) -> std::io::Result<()> {
        let shown = crate::access::display_path(path);
        if shown.contains('"') || shown.contains('\0') {
            return Err(std::io::Error::from(std::io::ErrorKind::InvalidInput));
        }
        let mut child = std::process::Command::new("explorer.exe")
            .raw_arg(format!("\"{shown}\""))
            .spawn()?;
        // Explorer exits with 1 even when it worked, so the result is not read.
        std::thread::spawn(move || child.wait());
        Ok(())
    }

    fn disable_browser_keys(&self, window: &tauri::WebviewWindow) {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_core::Interface as _;

        let asked = window.with_webview(|webview| {
            // SAFETY: the closure runs on the thread that owns the web view, as `with_webview`
            // promises, and the controller it hands over stays valid for the whole call. Each COM
            // call only reads a settings object or sets one flag, and its result is checked.
            let result = (|| unsafe {
                let settings = webview.controller().CoreWebView2()?.Settings()?;
                settings
                    .cast::<ICoreWebView2Settings3>()?
                    .SetAreBrowserAcceleratorKeysEnabled(false)
            })();
            if let Err(error) = result {
                eprintln!("Could not turn off the browser shortcuts: {error}");
            }
        });
        if let Err(error) = asked {
            eprintln!("Could not reach the web view: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn delete_permanent_holds_a_folder_against_a_swap() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let folder = dir.path().join("folder");
        std::fs::create_dir_all(&folder).expect("folder");
        std::fs::write(folder.join("a.txt"), b"x").expect("written");
        let held = Native.hold_folder(&folder).expect("held");
        assert!(std::fs::rename(&folder, dir.path().join("other")).is_err());
        // What is inside it can still go.
        std::fs::remove_file(folder.join("a.txt")).expect("removed");
        drop(held);
        std::fs::rename(&folder, dir.path().join("other")).expect("let go");
        let link = dir.path().join("link");
        crate::platform::make_folder_link(&dir.path().join("other"), &link).expect("link");
        assert!(
            Native.hold_folder(&link).is_err(),
            "a link is no folder to hold"
        );
    }

    #[test]
    fn delete_permanent_keeps_a_file_in_use_and_says_which() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let tree = dir.path().join("tree");
        std::fs::create_dir_all(tree.join("sub")).expect("folders");
        std::fs::write(tree.join("sub/busy.txt"), b"x").expect("written");
        std::fs::write(tree.join("sub/free.txt"), b"x").expect("written");
        std::fs::write(tree.join("free.txt"), b"x").expect("written");
        let busy = crate::platform::hold_exclusively(&tree.join("sub/busy.txt")).expect("locked");
        let report = crate::platform::purge::run(
            &Native,
            std::slice::from_ref(&tree),
            &std::sync::atomic::AtomicBool::new(false),
            &|_| {},
        );
        let [bin::End::Kept(why)] = report.ends.as_slice() else {
            panic!("kept: {:?}", report.ends);
        };
        assert_eq!(why.words(), "busy.txt: another program is using it");
        assert!(tree.join("sub/busy.txt").exists());
        assert!(!tree.join("sub/free.txt").exists() && !tree.join("free.txt").exists());
        drop(busy);
    }

    #[test]
    fn the_no_window_flag_is_the_documented_value() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
    }

    #[test]
    fn git_is_looked_for_under_each_program_files_then_the_users_programs_then_the_usual_spellings()
    {
        let env = |name: &str| -> Option<OsString> {
            match name {
                "ProgramFiles" | "ProgramW6432" => Some(r"D:\Apps".into()),
                "LocalAppData" => Some(r"C:\Users\me\AppData\Local".into()),
                _ => None,
            }
        };
        let shown: Vec<String> = git_install_paths(env)
            .iter()
            .map(|path| path.display().to_string())
            .collect();
        assert_eq!(
            shown,
            [
                r"D:\Apps\Git\cmd\git.exe",
                r"C:\Users\me\AppData\Local\Programs\Git\cmd\git.exe",
                r"C:\Program Files\Git\cmd\git.exe",
                r"C:\Program Files (x86)\Git\cmd\git.exe",
            ]
        );
    }

    /// The program a child runs to say whether it has a console window: PowerShell asks Windows for
    /// its console window handle and prints it (0 means none).
    fn console_window_of_a_child(hide: bool) -> Option<i64> {
        let script = "Add-Type -Namespace T -Name C -MemberDefinition \
            '[System.Runtime.InteropServices.DllImport(\"kernel32.dll\")] public static extern System.IntPtr GetConsoleWindow();'; \
            [Console]::Out.Write([int64][T.C]::GetConsoleWindow())";
        let mut command = std::process::Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        if hide {
            Native.hide_console(&mut command);
        }
        let output = command.output().ok()?;
        String::from_utf8_lossy(&output.stdout).trim().parse().ok()
    }

    /// Only meaningful when this run has a console of its own to share: the control child (started
    /// without the flag) must see a window, or "no window" would hold either way. It is skipped, out
    /// loud, otherwise; the claim never leans on it.
    #[test]
    fn a_program_started_through_hide_console_has_no_console_window() {
        let shared = console_window_of_a_child(false).expect("the control answered");
        if shared == 0 {
            eprintln!(
                "SKIPPED a_program_started_through_hide_console: this run has no console, so the control shows nothing"
            );
            return;
        }
        let hidden = console_window_of_a_child(true).expect("the child answered");
        assert_eq!(hidden, 0, "no console window for the hidden child");
    }

    #[test]
    fn with_no_environment_the_usual_spellings_remain() {
        assert_eq!(git_install_paths(|_| None).len(), 2);
    }
}
