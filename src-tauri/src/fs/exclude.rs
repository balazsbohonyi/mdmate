//! Folders that Quick Open, the link scans and folder search never go into.
//!
//! The list is built in and applies wherever the name appears. `.gitignore` is not read: a folder of
//! Markdown notes kept out of version control must stay searchable, and a root-level `.gitignore`
//! would hide it. The tree still shows every folder, and a file under one of these still opens from
//! there; only the workspace index, and so the three features that read from it, leave them out.
//!
//! One predicate serves the workspace index, its file watcher and the walk each feature falls back
//! on, so a result from the index and a result from a walk cannot disagree about what is excluded.
//! Phase 8 makes the list editable in settings.

use std::ffi::OsStr;
use xxhash_rust::xxh3::xxh3_64;

/// Folder names skipped wherever they appear, compared without regard to ASCII case.
pub(crate) const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".venv",
    "venv",
    "__pycache__",
    ".gradle",
    "bin",
    "obj",
    ".vs",
    ".idea",
];

/// True when a folder with this name is left out.
pub(crate) fn is_excluded_dir(name: &OsStr) -> bool {
    EXCLUDED_DIRS
        .iter()
        .any(|excluded| name.eq_ignore_ascii_case(excluded))
}

/// True when any folder part of `rel` (a path relative to a root, parts split by `/`) is excluded.
/// The last part is the file's own name, so it is not checked.
pub(crate) fn has_excluded_folder(rel: &str) -> bool {
    let mut parts = rel.split('/');
    parts.next_back();
    parts.any(|part| is_excluded_dir(OsStr::new(part)))
}

/// Changes whenever the list does, so a cached index made with another list is rebuilt.
pub(crate) fn signature() -> u64 {
    xxh3_64(EXCLUDED_DIRS.join("\n").as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_name_is_excluded_in_any_case_and_nothing_else_is() {
        for name in EXCLUDED_DIRS {
            assert!(is_excluded_dir(OsStr::new(name)), "{name}");
            assert!(is_excluded_dir(OsStr::new(&name.to_uppercase())), "{name}");
        }
        for name in ["docs", "notes", "builds", "my-target", "src", ".github", ""] {
            assert!(!is_excluded_dir(OsStr::new(name)), "{name}");
        }
    }

    #[test]
    fn a_path_is_excluded_by_its_folders_and_not_by_its_file_name() {
        assert!(has_excluded_folder("a/node_modules/b.md"));
        assert!(has_excluded_folder("target/x.rs"));
        assert!(has_excluded_folder("a/b/Build/c/d.md"));
        assert!(!has_excluded_folder("a/b.md"));
        // A file may be called `build` or `out`: only a folder of that name is skipped.
        assert!(!has_excluded_folder("docs/build"));
        assert!(!has_excluded_folder("out"));
    }
}
