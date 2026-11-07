//! Thin Tauri handlers. Logic lives in the modules they call.

// Public to the crate, not re-exported: `generate_handler!` finds a command's helper macro by the
// path of the module that defines it.
#[cfg(feature = "perf")]
pub(crate) mod perf;

use crate::error::AppError;
use crate::fs;
use crate::platform::{self, Platform as _};
use std::path::Path;

/// Reports the OS name from the platform layer.
#[tauri::command]
pub(crate) fn platform_name() -> &'static str {
    platform::current().name()
}

/// Returns a file's bytes untouched. The page receives an `ArrayBuffer`, with no JSON in between.
///
/// Phase 0 reads any path the page asks for. Phase 2 limits this to the open workspace.
#[tauri::command]
pub(crate) async fn read_file(path: String) -> Result<tauri::ipc::Response, AppError> {
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read_bytes(Path::new(&path)))
        .await
        .map_err(|error| AppError::Task(error.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}
