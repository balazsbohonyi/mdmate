//! Folders that Quick Open, the link scans and folder search never go into.
//!
//! The list is built in and applies wherever the name appears. `.gitignore` is not read: a folder of
//! Markdown notes kept out of version control must stay searchable, and a root-level `.gitignore`
//! would hide it. The tree still shows every folder, and a file under one of these still opens from
//! there; only the workspace index, and so the three features that read from it, leave them out.
//!
//! One predicate serves the workspace index, its file watcher and the walk each feature falls back
//! on, so a result from the index and a result from a walk cannot disagree about what is excluded.
//! The list is the built-in one until `workspace.excludedFolders` in settings.json replaces it (P8-T1b).

use std::ffi::OsStr;
use std::sync::{Arc, LazyLock, PoisonError, RwLock};
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

/// The list in force: the built-in names until the settings say otherwise (`workspace.excludedFolders`).
static CURRENT: LazyLock<RwLock<Arc<Vec<String>>>> =
    LazyLock::new(|| RwLock::new(Arc::new(builtin())));

/// The built-in names, as owned strings.
pub(crate) fn builtin() -> Vec<String> {
    EXCLUDED_DIRS
        .iter()
        .map(|name| (*name).to_owned())
        .collect()
}

fn current() -> Arc<Vec<String>> {
    Arc::clone(&CURRENT.read().unwrap_or_else(PoisonError::into_inner))
}

/// Makes `names` the list in force. True when that is a change, so the caller knows to look again.
/// Every walk, watcher event and cache file reads the list through this module, so none of them can
/// keep using the old one.
pub(crate) fn set(names: &[String]) -> bool {
    let mut held = CURRENT.write().unwrap_or_else(PoisonError::into_inner);
    if held.as_slice() == names {
        return false;
    }
    *held = Arc::new(names.to_vec());
    true
}

fn listed(list: &[String], name: &OsStr) -> bool {
    list.iter()
        .any(|excluded| name.eq_ignore_ascii_case(excluded))
}

/// True when a folder with this name is left out.
pub(crate) fn is_excluded_dir(name: &OsStr) -> bool {
    listed(&current(), name)
}

/// True when any folder part of `rel` (a path relative to a root, parts split by `/`) is excluded.
/// The last part is the file's own name, so it is not checked.
pub(crate) fn has_excluded_folder(rel: &str) -> bool {
    let list = current();
    let mut parts = rel.split('/');
    parts.next_back();
    parts.any(|part| listed(&list, OsStr::new(part)))
}

fn signature_of(list: &[String]) -> u64 {
    xxh3_64(list.join("\n").as_bytes())
}

/// Changes whenever the list does, so a cached index made with another list is rebuilt.
pub(crate) fn signature() -> u64 {
    signature_of(&current())
}

/// Tests that need the list to stay as it is hold this; the one that changes it holds the other end.
#[cfg(test)]
pub(crate) static LIST_GUARD: RwLock<()> = RwLock::new(());

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
    fn a_list_from_settings_replaces_the_built_in_one_and_changes_the_signature() {
        let _alone = LIST_GUARD.write().unwrap_or_else(PoisonError::into_inner);
        let before = signature();
        let mut list = builtin();
        list.push("zz-skipped-by-settings".into());
        assert!(set(&list), "a new list is a change");
        assert!(!set(&list), "the same list again is not");
        assert!(is_excluded_dir(OsStr::new("ZZ-Skipped-By-Settings")));
        assert!(has_excluded_folder("a/zz-skipped-by-settings/b.md"));
        assert_ne!(
            signature(),
            before,
            "a cache made with the old list is not trusted"
        );
        assert_eq!(current().as_ref(), &list);

        assert!(set(&builtin()));
        assert_eq!(signature(), before, "the built-in list has one signature");
        assert!(is_excluded_dir(OsStr::new("node_modules")));
        assert!(!is_excluded_dir(OsStr::new("zz-skipped-by-settings")));
    }

    #[test]
    fn a_list_without_a_built_in_name_stops_skipping_it_because_the_owner_chose() {
        let list = ["only-this".to_owned()];
        assert!(listed(&list, OsStr::new("Only-This")));
        assert!(!listed(&list, OsStr::new("node_modules")));
        assert_ne!(signature_of(&list), signature_of(&builtin()));
        assert!(
            !listed(&[], OsStr::new("node_modules")),
            "an empty list skips nothing"
        );
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
