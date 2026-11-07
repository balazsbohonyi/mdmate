//! Windows implementation.

use super::Platform;

#[derive(Debug)]
pub(crate) struct Native;

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
}
