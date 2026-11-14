//! Installed or portable data folder.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Names a folder to use instead of the usual one. Tests and the perf harness set it to a fresh
/// temp folder, so nothing they do reaches the user's real session.
pub(crate) const DATA_DIR_ENV: &str = "MDMATE_DATA_DIR";

/// A file with this name beside the exe turns on portable mode: the data lives in `data` next to
/// the exe, so the whole folder can be carried to another machine or a USB stick.
pub(crate) const PORTABLE_MARKER: &str = "mdmate.portable";

/// The folder, beside the exe, that holds everything in portable mode.
const PORTABLE_DATA: &str = "data";

/// Whether `exe_dir` holds the portable marker. It must be a file: a folder that happens to carry
/// the name, or a marker somewhere other than beside the exe, does not count.
fn is_portable(exe_dir: &Path) -> bool {
    std::fs::metadata(exe_dir.join(PORTABLE_MARKER)).is_ok_and(|meta| meta.is_file())
}

/// The folder for what the app keeps between runs: the session, recent lists, settings,
/// keybindings, themes and the recovered buffers.
///
/// In this order: `override_dir` when set and non-empty (the explicit choice always wins, so tests
/// and the perf harness never touch a portable folder); `<exe_dir>/data` when the portable marker
/// is beside the exe; otherwise `usual` is asked for the platform's app-data folder, and a temp
/// folder stands in if even that is unknown. An exe folder that could not be read (`None`) means
/// no portable mode, never a failure.
pub(crate) fn data_dir(
    override_dir: Option<OsString>,
    exe_dir: Option<&Path>,
    usual: impl FnOnce() -> Option<PathBuf>,
) -> PathBuf {
    if let Some(dir) = override_dir.filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(exe_dir) = exe_dir.filter(|dir| is_portable(dir)) {
        return exe_dir.join(PORTABLE_DATA);
    }
    usual().unwrap_or_else(|| std::env::temp_dir().join("mdmate"))
}

/// [`data_dir`] with the override read from the environment and the exe folder from the running
/// exe's own path.
pub(crate) fn data_dir_from_env(usual: impl FnOnce() -> Option<PathBuf>) -> PathBuf {
    let exe = std::env::current_exe().ok();
    data_dir(
        std::env::var_os(DATA_DIR_ENV),
        exe.as_deref().and_then(Path::parent),
        usual,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder standing in for the exe's folder, removed when dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "mdmate-paths-{name}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("scratch folder");
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn usual() -> Option<PathBuf> {
        Some("usual".into())
    }

    #[test]
    fn the_override_wins_over_the_usual_folder() {
        let dir = data_dir(Some("override".into()), None, usual);
        assert_eq!(dir, PathBuf::from("override"));
    }

    #[test]
    fn an_empty_override_counts_as_none() {
        let dir = data_dir(Some(OsString::new()), None, usual);
        assert_eq!(dir, PathBuf::from("usual"));
    }

    #[test]
    fn an_unknown_usual_folder_falls_back_to_a_temp_one() {
        let dir = data_dir(None, None, || None);
        assert!(dir.starts_with(std::env::temp_dir()));
    }

    #[test]
    fn portable_paths_marker_beside_the_exe_puts_data_in_its_data_folder() {
        let exe = Scratch::new("marker");
        std::fs::write(exe.0.join(PORTABLE_MARKER), "").unwrap();
        let dir = data_dir(None, Some(&exe.0), usual);
        assert_eq!(dir, exe.0.join("data"));
    }

    #[test]
    fn portable_paths_no_marker_uses_the_usual_folder() {
        let exe = Scratch::new("none");
        let dir = data_dir(None, Some(&exe.0), usual);
        assert_eq!(dir, PathBuf::from("usual"));
    }

    #[test]
    fn portable_paths_a_folder_with_the_marker_name_is_no_marker() {
        let exe = Scratch::new("dir");
        std::fs::create_dir(exe.0.join(PORTABLE_MARKER)).unwrap();
        let dir = data_dir(None, Some(&exe.0), usual);
        assert_eq!(dir, PathBuf::from("usual"));
    }

    #[test]
    fn portable_paths_a_marker_anywhere_but_beside_the_exe_is_ignored() {
        let exe = Scratch::new("elsewhere");
        // In the folder above the exe's, in a folder below it, and in the folder the exe's
        // `data` would be: none of them is "beside the exe".
        let inner = exe.0.join("bin");
        std::fs::create_dir_all(inner.join("deeper")).unwrap();
        std::fs::write(exe.0.join(PORTABLE_MARKER), "").unwrap();
        std::fs::write(inner.join("deeper").join(PORTABLE_MARKER), "").unwrap();
        assert_eq!(data_dir(None, Some(&inner), usual), PathBuf::from("usual"));
    }

    #[test]
    fn portable_paths_the_override_wins_over_the_marker() {
        let exe = Scratch::new("override");
        std::fs::write(exe.0.join(PORTABLE_MARKER), "").unwrap();
        let dir = data_dir(Some("override".into()), Some(&exe.0), usual);
        assert_eq!(dir, PathBuf::from("override"));
    }

    #[test]
    fn portable_paths_an_empty_override_does_not_beat_the_marker() {
        let exe = Scratch::new("empty-override");
        std::fs::write(exe.0.join(PORTABLE_MARKER), "").unwrap();
        let dir = data_dir(Some(OsString::new()), Some(&exe.0), usual);
        assert_eq!(dir, exe.0.join("data"));
    }

    #[test]
    fn portable_paths_an_unreadable_exe_folder_uses_the_usual_folder() {
        assert_eq!(data_dir(None, None, usual), PathBuf::from("usual"));
        // A folder that does not exist cannot hold a marker either.
        let gone = std::env::temp_dir().join("mdmate-paths-does-not-exist");
        assert_eq!(data_dir(None, Some(&gone), usual), PathBuf::from("usual"));
    }

    #[test]
    fn portable_paths_the_real_exe_is_not_portable_and_the_lookup_does_not_panic() {
        // The test binary's own folder has no marker, so the lookup falls through to `usual`.
        let dir = data_dir_from_env(usual);
        // With MDMATE_DATA_DIR set by the outer environment the answer is that folder instead.
        match std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
            Some(set) => assert_eq!(dir, PathBuf::from(set)),
            None => assert_eq!(dir, PathBuf::from("usual")),
        }
    }
}
