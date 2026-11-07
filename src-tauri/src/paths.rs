//! Installed or portable data folder.

use std::ffi::OsString;
use std::path::PathBuf;

/// Names a folder to use instead of the usual one. Tests and the perf harness set it to a fresh
/// temp folder, so nothing they do reaches the user's real session.
pub(crate) const DATA_DIR_ENV: &str = "MDMATE_DATA_DIR";

/// The folder for what the app keeps between runs: the session and the recovered buffers.
///
/// `override_dir` wins when set and non-empty; otherwise `usual` is asked for the platform's
/// app-data folder, and a temp folder stands in if even that is unknown.
pub(crate) fn data_dir(
    override_dir: Option<OsString>,
    usual: impl FnOnce() -> Option<PathBuf>,
) -> PathBuf {
    match override_dir.filter(|dir| !dir.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => usual().unwrap_or_else(|| std::env::temp_dir().join("mdmate")),
    }
}

/// [`data_dir`] with the override read from the environment.
pub(crate) fn data_dir_from_env(usual: impl FnOnce() -> Option<PathBuf>) -> PathBuf {
    data_dir(std::env::var_os(DATA_DIR_ENV), usual)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_override_wins_over_the_usual_folder() {
        let dir = data_dir(Some("override".into()), || Some("usual".into()));
        assert_eq!(dir, PathBuf::from("override"));
    }

    #[test]
    fn an_empty_override_counts_as_none() {
        let dir = data_dir(Some(OsString::new()), || Some("usual".into()));
        assert_eq!(dir, PathBuf::from("usual"));
    }

    #[test]
    fn an_unknown_usual_folder_falls_back_to_a_temp_one() {
        let dir = data_dir(None, || None);
        assert!(dir.starts_with(std::env::temp_dir()));
    }
}
