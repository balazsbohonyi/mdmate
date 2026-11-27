//! The Windows side of [`crate::platform::bin`]: `IFileOperation` with its progress sink, and the
//! Recycle Bin settings of a volume.
//!
//! What the shell does here was measured first (P9.1-T50 in the phase's decisions). It calls
//! `UpdateProgress` about once per item while it counts, then moves with no further call, and an
//! item queued as a file keeps the recycle flag even when it is about to be destroyed. So the size
//! check before queuing is the first guard, and Windows' own question (`FOF_WANTNUKEWARNING`) stays
//! on behind it.
#![allow(
    unsafe_code,
    reason = "IFileOperation, the volume lookups and the registry are FFI; each block says why it is sound"
)]

use crate::access::display_path;
use crate::error::plain_text;
use crate::platform::bin::{BinRoom, BinWatcher, Handled, Route};
use std::ffi::c_void;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use windows::Win32::Foundation::{E_ABORT, HWND};
use windows::Win32::Storage::FileSystem::{
    GetDriveTypeW, GetVolumeNameForVolumeMountPointW, GetVolumePathNameW,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance, CoInitializeEx,
    CoTaskMemFree, CoUninitialize,
};
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};
use windows::Win32::UI::Shell::{
    COPYENGINE_E_ACCESS_DENIED_SRC, COPYENGINE_E_REQUIRES_ELEVATION,
    COPYENGINE_E_SHARING_VIOLATION_SRC, COPYENGINE_E_USER_CANCELLED,
    COPYENGINE_S_DONT_PROCESS_CHILDREN, FOF_ALLOWUNDO, FOF_NO_UI, FOF_WANTNUKEWARNING,
    FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl,
    IShellItem, SHCreateItemFromParsingName, SIGDN_FILESYSPATH, TSF_DELETE_RECYCLE_IF_POSSIBLE,
};
use windows::core::{ComObject, HRESULT, PCWSTR, Ref, implement};

/// `GetDriveTypeW`'s answer for a disk that is part of the machine.
const DRIVE_FIXED: u32 = 3;

/// The flag of `PreDeleteItem` that says the shell means to recycle the item.
const RECYCLE_IF_POSSIBLE: u32 = TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32;

/// A NUL-terminated UTF-16 copy of `text`.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// What a shell code means, to follow "Could not delete a.md:".
fn words(code: HRESULT) -> String {
    if code == COPYENGINE_E_USER_CANCELLED {
        "Windows asked about it and it was not removed".into()
    } else if code == COPYENGINE_E_SHARING_VIOLATION_SRC {
        "another program is using it".into()
    } else if code == COPYENGINE_E_ACCESS_DENIED_SRC {
        "permission was denied".into()
    } else if code == COPYENGINE_E_REQUIRES_ELEVATION {
        "it needs administrator rights".into()
    } else {
        let said = windows::core::Error::from(code).message();
        plain_text(&format!(
            "Windows could not move it ({:#010x}) {said}",
            code.0 as u32
        ))
    }
}

fn failure(error: windows::core::Error) -> io::Error {
    io::Error::other(words(HRESULT::from(error)))
}

/// The file system path of a shell item.
fn shown(item: &IShellItem) -> Option<String> {
    // SAFETY: the item is alive; the string it returns is ours to free.
    let name = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }.ok()?;
    // SAFETY: the shell returned a NUL-terminated string.
    let text = unsafe { name.to_string() }.ok();
    // SAFETY: freed once, after the copy above, with the allocator that made it.
    unsafe { CoTaskMemFree(Some(name.0 as *const c_void)) };
    text
}

#[implement(IFileOperationProgressSink)]
struct Sink {
    /// The paths of the queued items, as the shell spells them, in queue order.
    names: Vec<String>,
    watcher: Arc<dyn BinWatcher>,
}

impl Sink {
    /// The path of a callback's item, and its place in the queue if it was queued itself.
    fn place(&self, item: Ref<'_, IShellItem>) -> (Option<usize>, PathBuf) {
        let path = item.as_ref().and_then(shown).unwrap_or_default();
        let lower = path.to_lowercase();
        let target = self
            .names
            .iter()
            .position(|name| name.to_lowercase() == lower);
        (target, PathBuf::from(path))
    }
}

#[allow(non_snake_case)] // the method names are COM's
impl IFileOperationProgressSink_Impl for Sink_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, _result: HRESULT) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreRenameItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostRenameItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
        _result: HRESULT,
        _new_item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _destination: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostMoveItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _destination: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
        _result: HRESULT,
        _new_item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _destination: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostCopyItem(
        &self,
        _flags: u32,
        _item: Ref<'_, IShellItem>,
        _destination: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
        _result: HRESULT,
        _new_item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreDeleteItem(&self, flags: u32, item: Ref<'_, IShellItem>) -> windows::core::Result<()> {
        let (target, path) = self.place(item);
        let route = if flags & RECYCLE_IF_POSSIBLE != 0 {
            Route::ToBin
        } else {
            Route::ForGood
        };
        if self.watcher.moving(target, &path, route) {
            Ok(())
        } else {
            Err(E_ABORT.into())
        }
    }
    fn PostDeleteItem(
        &self,
        _flags: u32,
        item: Ref<'_, IShellItem>,
        result: HRESULT,
        new_item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        let how = if result.is_err() {
            Some(Handled::Failed(words(result)))
        } else if new_item.as_ref().is_some() {
            Some(Handled::InBin)
        } else if result == COPYENGINE_S_DONT_PROCESS_CHILDREN {
            // Done with the item and nothing in the bin to show for it.
            Some(Handled::Destroyed)
        } else {
            // "Not handled": the shell goes on to what is inside.
            None
        };
        if let Some(how) = how {
            let (target, path) = self.place(item);
            self.watcher.handled(target, &path, how);
        }
        Ok(())
    }
    fn PreNewItem(
        &self,
        _flags: u32,
        _destination: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostNewItem(
        &self,
        _flags: u32,
        _destination: Ref<'_, IShellItem>,
        _new_name: &PCWSTR,
        _template_name: &PCWSTR,
        _attributes: u32,
        _result: HRESULT,
        _new_item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _total: u32, _so_far: u32) -> windows::core::Result<()> {
        if self.watcher.counted() {
            Ok(())
        } else {
            Err(E_ABORT.into())
        }
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
}

/// Queues every path in one operation and runs it, on a thread whose apartment is set up.
fn perform(
    names: &[String],
    owner: Option<isize>,
    watcher: Arc<dyn BinWatcher>,
) -> windows::core::Result<()> {
    // SAFETY: a system COM class, created in an initialized apartment.
    let operation: IFileOperation = unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_ALL) }?;
    // `FOF_WANTNUKEWARNING` makes Windows ask before it destroys what the bin cannot take, even
    // though `FOF_NO_UI` silences every other question.
    // SAFETY: valid flags on a live operation.
    unsafe { operation.SetOperationFlags(FOF_NO_UI | FOF_ALLOWUNDO | FOF_WANTNUKEWARNING) }?;
    if let Some(handle) = owner {
        // SAFETY: the app's own window, which the shell only uses to place a question.
        unsafe { operation.SetOwnerWindow(HWND(handle as *mut c_void)) }?;
    }
    let mut spelled = Vec::with_capacity(names.len());
    for name in names {
        let path = wide(name);
        // SAFETY: the path is NUL-terminated and outlives the call.
        let item: IShellItem = unsafe { SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None) }?;
        spelled.push(shown(&item).unwrap_or_else(|| name.clone()));
        // SAFETY: a live item on a live operation.
        unsafe { operation.DeleteItem(&item, None) }?;
    }
    let sink = ComObject::new(Sink {
        names: spelled,
        watcher,
    });
    let face: IFileOperationProgressSink = sink.to_interface();
    // SAFETY: the sink is a live COM object, and is taken off again below.
    let cookie = unsafe { operation.Advise(&face) }?;
    // SAFETY: everything queued above is still alive.
    let performed = unsafe { operation.PerformOperations() };
    // SAFETY: the cookie `Advise` gave for this operation.
    let removed = unsafe { operation.Unadvise(cookie) };
    performed.and(removed)
}

/// Moves the paths to the Recycle Bin as one operation. It blocks until the shell is done.
pub(super) fn recycle(
    paths: &[PathBuf],
    owner: Option<isize>,
    watcher: Arc<dyn BinWatcher>,
) -> io::Result<()> {
    let names: Vec<String> = paths.iter().map(|path| display_path(path)).collect();
    // A thread of its own, for the single-threaded apartment the shell asks for.
    std::thread::spawn(move || -> io::Result<()> {
        // SAFETY: no reserved pointer and valid flags.
        let started =
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        started.ok().map_err(failure)?;
        let done = perform(&names, owner, watcher);
        // SAFETY: balances the successful call above, on the same thread, with every COM object
        // of `perform` already dropped.
        unsafe { CoUninitialize() };
        done.map_err(failure)
    })
    .join()
    .map_err(|_| io::Error::other("the delete stopped unexpectedly"))?
}

/// The `{…}` part of a volume's name, which the bin's settings are filed under.
fn volume_id(volume: &str) -> Option<&str> {
    let from = volume.find('{')?;
    let to = volume.find('}')?;
    volume.get(from..=to)
}

/// What the two settings of a volume's bin mean.
fn room_from(limit_mb: Option<u32>, remove_for_good: Option<u32>) -> BinRoom {
    if remove_for_good.is_some_and(|set| set != 0) {
        return BinRoom::NoBin;
    }
    limit_mb.map_or(BinRoom::Unknown, |mb| {
        BinRoom::Limit(u64::from(mb) * 1024 * 1024)
    })
}

/// A number from the current user's registry, if it is there.
fn setting(key: &[u16], name: &str) -> Option<u32> {
    let name = wide(name);
    let mut value = 0_u32;
    let mut size = 4_u32;
    // SAFETY: both strings are NUL-terminated, only a number is accepted, and `value` has the
    // `size` bytes the call is told about.
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            PCWSTR(name.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some((&raw mut value).cast()),
            Some(&raw mut size),
        )
    };
    read.is_ok().then_some(value)
}

/// What the Recycle Bin takes on the volume that holds `path`. A drive that is not part of the
/// machine (a network or removable one) is taken to have no bin.
pub(super) fn bin_room(path: &Path) -> BinRoom {
    let name = wide(&display_path(path));
    let mut mount = [0_u16; 261];
    // SAFETY: a NUL-terminated path and a buffer whose length the binding passes on.
    if unsafe { GetVolumePathNameW(PCWSTR(name.as_ptr()), &mut mount) }.is_err() {
        return BinRoom::Unknown;
    }
    // SAFETY: the call above left a NUL-terminated path in `mount`.
    if unsafe { GetDriveTypeW(PCWSTR(mount.as_ptr())) } != DRIVE_FIXED {
        return BinRoom::NoBin;
    }
    let mut volume = [0_u16; 64];
    // SAFETY: as above, with a buffer long enough for a volume name.
    if unsafe { GetVolumeNameForVolumeMountPointW(PCWSTR(mount.as_ptr()), &mut volume) }.is_err() {
        return BinRoom::NoBin;
    }
    let volume = String::from_utf16_lossy(&volume);
    let Some(id) = volume_id(&volume) else {
        return BinRoom::Unknown;
    };
    let key = wide(&format!(
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\{id}"
    ));
    room_from(setting(&key, "MaxCapacity"), setting(&key, "NukeOnDelete"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::bin::{self, End, Kept, Progress};
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    #[ignore = "puts two tiny items in the real Recycle Bin; run by hand"]
    fn real_shell_recycles_a_file_and_a_folder() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let file = dir.path().join("mdmate-delete-test.txt");
        let folder = dir.path().join("mdmate-delete-test-folder");
        std::fs::write(&file, "x").expect("written");
        std::fs::create_dir(&folder).expect("folder");
        std::fs::write(folder.join("inside.txt"), "x").expect("written");
        let told = Arc::new(Mutex::new(Vec::new()));
        let into = Arc::clone(&told);
        let report = bin::run(
            &crate::platform::current(),
            &[file.clone(), folder.clone()],
            None,
            Arc::default(),
            Box::new(move |step| into.lock().expect("lock").push(step)),
        );
        let told = told.lock().expect("lock").clone();
        assert_eq!(report.ends, [End::InBin, End::InBin], "{told:?}");
        assert!(report.destroyed_inside.is_empty() && !report.cancelled);
        assert!(!file.exists() && !folder.exists());
        assert_eq!(told.last(), Some(&Progress::Moving), "{told:?}");
        assert!(
            told.iter()
                .any(|step| matches!(step, Progress::Counting { percent: Some(_) })),
            "{told:?}"
        );
    }

    #[test]
    #[ignore = "asks the real shell to delete, and cancels; run by hand"]
    fn real_shell_cancel_while_counting_removes_nothing() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let folder = dir.path().join("mdmate-cancel-test-folder");
        std::fs::create_dir(&folder).expect("folder");
        for number in 0..300 {
            std::fs::write(folder.join(format!("{number}.txt")), "x").expect("written");
        }
        let cancel: Arc<AtomicBool> = Arc::default();
        let asks = Arc::clone(&cancel);
        let report = bin::run(
            &crate::platform::current(),
            std::slice::from_ref(&folder),
            None,
            cancel,
            Box::new(move |step| {
                if matches!(step, Progress::Counting { percent: Some(_) }) {
                    asks.store(true, Ordering::SeqCst);
                }
            }),
        );
        assert_eq!(report.ends, [End::Kept(Kept::Cancelled)]);
        assert!(report.cancelled);
        assert_eq!(std::fs::read_dir(&folder).expect("there").count(), 300);
    }

    #[test]
    fn recycle_never_permanent_reads_the_bin_settings_of_a_volume() {
        assert_eq!(
            volume_id("\\\\?\\Volume{623ab0a1-13c1}\\\0\0"),
            Some("{623ab0a1-13c1}")
        );
        assert_eq!(volume_id("D:\\"), None);
        assert_eq!(room_from(Some(2), Some(0)), BinRoom::Limit(2 * 1024 * 1024));
        assert_eq!(room_from(Some(2), None), BinRoom::Limit(2 * 1024 * 1024));
        assert_eq!(room_from(Some(2), Some(1)), BinRoom::NoBin);
        assert_eq!(room_from(None, Some(0)), BinRoom::Unknown);
    }

    #[test]
    fn recycle_never_permanent_finds_a_bin_for_the_temp_folder() {
        // Reads the registry only. The temp folder is on a disk of the machine, which has a bin.
        assert_ne!(bin_room(&std::env::temp_dir()), BinRoom::NoBin);
    }

    #[test]
    fn recycle_never_permanent_words_a_no_to_windows_question() {
        assert!(words(COPYENGINE_E_USER_CANCELLED).contains("not removed"));
        assert_eq!(
            words(COPYENGINE_E_SHARING_VIOLATION_SRC),
            "another program is using it"
        );
    }
}
