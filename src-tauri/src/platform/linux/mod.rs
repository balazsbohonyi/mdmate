//! Linux implementation.

use super::Platform;
use std::path::Path;

#[derive(Debug)]
pub(crate) struct Native;

impl Platform for Native {
    fn name(&self) -> &'static str {
        "linux"
    }

    fn paths_ignore_case(&self) -> bool {
        false
    }

    fn file_is_busy(&self, _error: &std::io::Error) -> bool {
        false
    }

    fn open_external(&self, target: &str) -> std::io::Result<()> {
        // The target is one argument with no shell in between. The guard only hands over an
        // absolute path or a URL with a scheme, so it can never read as an option.
        let mut child = std::process::Command::new("xdg-open").arg(target).spawn()?;
        std::thread::spawn(move || child.wait());
        Ok(())
    }

    fn move_to_trash(&self, path: &Path) -> std::io::Result<()> {
        super::trash_item(path)
    }

    fn reveal(&self, path: &Path) -> std::io::Result<()> {
        // There is no portable "select this file", so the folder that holds it opens.
        let folder = path.parent().unwrap_or(path);
        let mut child = std::process::Command::new("xdg-open").arg(folder).spawn()?;
        std::thread::spawn(move || child.wait());
        Ok(())
    }
}
