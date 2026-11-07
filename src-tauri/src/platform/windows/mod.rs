//! Windows implementation.

use super::Platform;

#[derive(Debug)]
pub(crate) struct Native;

impl Platform for Native {
    fn name(&self) -> &'static str {
        "windows"
    }
}
