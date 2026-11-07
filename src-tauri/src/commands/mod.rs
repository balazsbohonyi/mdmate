//! Thin Tauri handlers. Logic lives in the modules they call.

use crate::platform::{self, Platform as _};

/// Reports the OS name from the platform layer.
#[tauri::command]
pub(crate) fn platform_name() -> &'static str {
    platform::current().name()
}
