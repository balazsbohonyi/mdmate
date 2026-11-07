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
}
