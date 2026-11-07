//! Which paths the page may read and save.
//!
//! The page runs Markdown it did not write, so a hostile document could script it. The page is
//! therefore never trusted to say which files it may touch: a path becomes readable only when Rust
//! itself saw the user pick it (the open dialog, a restored session) or when it sits inside a
//! workspace root the user opened. Every other request is refused here.
//!
//! Paths are compared in their canonical form, with symlinks and `..` resolved, so a link inside a
//! root cannot lead out of it. Network (UNC) paths are refused outright, because reading one makes
//! Windows contact that host.

use crate::error::AppError;
use std::collections::HashSet;
use std::path::{MAIN_SEPARATOR, Path, PathBuf};

/// A path that has been resolved, together with the text two spellings of it share.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Resolved {
    /// The resolved path, safe to hand to the file system.
    pub(crate) path: PathBuf,
    /// Equal for any two spellings of one file. Lower-cased where the file system ignores case.
    pub(crate) key: String,
}

#[derive(Debug)]
pub(crate) struct Access {
    ignore_case: bool,
    roots: Vec<Resolved>,
    files: HashSet<String>,
}

impl Access {
    /// `ignore_case` says whether this OS treats `A.md` and `a.md` as one file.
    pub(crate) fn new(ignore_case: bool) -> Self {
        Self {
            ignore_case,
            roots: Vec::new(),
            files: HashSet::new(),
        }
    }

    /// Resolves a path that exists. Refuses network paths.
    pub(crate) fn resolve(&self, path: &Path) -> Result<Resolved, AppError> {
        let canonical = std::fs::canonicalize(path)?;
        let text = canonical.to_string_lossy();
        // `\\?\UNC\server\share` is how Windows spells a network path once resolved.
        if text.starts_with(r"\\?\UNC\") || (text.starts_with(r"\\") && !text.starts_with(r"\\?\"))
        {
            return Err(AppError::NotAllowed("network paths".into()));
        }
        let key = if self.ignore_case {
            text.to_lowercase()
        } else {
            text.into_owned()
        };
        Ok(Resolved {
            path: canonical,
            key,
        })
    }

    /// Lets the page read and save this one file. Only Rust's own events call this.
    pub(crate) fn grant_file(&mut self, path: &Path) -> Result<Resolved, AppError> {
        let resolved = self.resolve(path)?;
        if !resolved.path.is_file() {
            return Err(AppError::Invalid("not a file".into()));
        }
        self.files.insert(resolved.key.clone());
        Ok(resolved)
    }

    /// Lets the page read and save anything inside this folder, however deep.
    #[cfg_attr(
        not(feature = "perf"),
        allow(
            dead_code,
            reason = "workspace folders arrive in Phase 6; today only perf builds open one"
        )
    )]
    pub(crate) fn grant_root(&mut self, path: &Path) -> Result<Resolved, AppError> {
        let resolved = self.resolve(path)?;
        if !resolved.path.is_dir() {
            return Err(AppError::Invalid("not a folder".into()));
        }
        if !self.roots.iter().any(|root| root.key == resolved.key) {
            self.roots.push(resolved.clone());
        }
        Ok(resolved)
    }

    /// Stops allowing a folder, for when a workspace closes.
    // Dead until Phase 6: a workspace can only close once something can open one.
    #[allow(dead_code, reason = "see the comment above")]
    pub(crate) fn revoke_root(&mut self, path: &Path) {
        if let Ok(resolved) = self.resolve(path) {
            self.roots.retain(|root| root.key != resolved.key);
        }
    }

    /// Resolves a path the page asked for, or refuses it when it was never granted.
    pub(crate) fn check(&self, path: &Path) -> Result<Resolved, AppError> {
        let resolved = self.resolve(path)?;
        if self.files.contains(&resolved.key)
            || self
                .roots
                .iter()
                .any(|root| is_inside(&resolved.key, &root.key))
        {
            Ok(resolved)
        } else {
            Err(AppError::NotAllowed(display_path(&resolved.path)))
        }
    }
}

/// True when `key` is `root` itself or sits below it. Whole path parts only, so `/a/bc` is not
/// inside `/a/b`.
fn is_inside(key: &str, root: &str) -> bool {
    match key.strip_prefix(root) {
        Some("") => true,
        Some(rest) => root.ends_with(MAIN_SEPARATOR) || rest.starts_with(MAIN_SEPARATOR),
        None => false,
    }
}

/// A path as people expect to read it: Windows' `\\?\` prefix dropped.
pub(crate) fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => rest.to_owned(),
        _ => text.into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    fn file(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("the folder can be created");
        }
        std::fs::write(&path, b"x").expect("the file can be written");
        path
    }

    #[test]
    fn nothing_is_readable_until_it_is_granted() {
        let dir = temp();
        let path = file(dir.path(), "a.md");
        let access = Access::new(false);
        let error = access.check(&path).expect_err("never granted");
        assert_eq!(error.kind(), "not-allowed");
        // The page shows this text, so it must not carry Windows' verbatim `\\?\` prefix.
        assert!(!error.to_string().contains(r"\\?\"), "{error}");
    }

    #[test]
    fn a_granted_file_is_readable_and_its_neighbour_is_not() {
        let dir = temp();
        let a = file(dir.path(), "a.md");
        let b = file(dir.path(), "b.md");
        let mut access = Access::new(false);
        access.grant_file(&a).expect("grants");
        assert!(access.check(&a).is_ok());
        assert_eq!(
            access.check(&b).expect_err("not granted").kind(),
            "not-allowed"
        );
    }

    #[test]
    fn a_root_allows_everything_below_it_and_nothing_beside_it() {
        let dir = temp();
        let inside = file(dir.path(), "notes/deep/a.md");
        let sibling = file(dir.path(), "notes-other/b.md");
        let mut access = Access::new(false);
        access
            .grant_root(&dir.path().join("notes"))
            .expect("grants");
        assert!(access.check(&inside).is_ok());
        // Same text prefix, different folder: must not count as inside.
        assert_eq!(
            access.check(&sibling).expect_err("outside").kind(),
            "not-allowed"
        );
    }

    #[test]
    fn dot_dot_cannot_climb_out_of_a_root() {
        let dir = temp();
        file(dir.path(), "notes/a.md");
        let secret = file(dir.path(), "secret.md");
        let mut access = Access::new(false);
        access
            .grant_root(&dir.path().join("notes"))
            .expect("grants");
        let sneaky = dir.path().join("notes").join("..").join("secret.md");
        assert!(sneaky.exists());
        assert_eq!(
            access.check(&sneaky).expect_err("resolves outside").kind(),
            "not-allowed"
        );
        assert!(access.check(&secret).is_err());
    }

    #[test]
    fn a_revoked_root_stops_allowing() {
        let dir = temp();
        let path = file(dir.path(), "notes/a.md");
        let mut access = Access::new(false);
        let root = dir.path().join("notes");
        access.grant_root(&root).expect("grants");
        assert!(access.check(&path).is_ok());
        access.revoke_root(&root);
        assert!(access.check(&path).is_err());
    }

    #[test]
    fn case_differences_are_one_file_where_the_system_ignores_case() {
        let dir = temp();
        let path = file(dir.path(), "Note.md");
        let upper = dir.path().join("NOTE.MD");
        let mut access = Access::new(true);
        let first = access.grant_file(&path).expect("grants");
        // Only meaningful on a case-insensitive file system; elsewhere the upper path is missing.
        if upper.exists() {
            assert_eq!(access.check(&upper).expect("same file").key, first.key);
        }
        assert_eq!(first.key, first.key.to_lowercase());
    }

    #[test]
    fn granting_checks_the_kind_of_path() {
        let dir = temp();
        let path = file(dir.path(), "a.md");
        let mut access = Access::new(false);
        assert!(access.grant_root(&path).is_err(), "a file is not a root");
        assert!(
            access.grant_file(dir.path()).is_err(),
            "a folder is not a file"
        );
        assert_eq!(
            access
                .grant_file(&dir.path().join("missing.md"))
                .expect_err("missing")
                .kind(),
            "not-found"
        );
    }

    #[test]
    fn network_paths_are_refused() {
        let access = Access::new(true);
        // A UNC path cannot be resolved here, but the check must fail either way and never allow.
        assert!(access.check(Path::new(r"\\server\share\a.md")).is_err());
        assert!(
            access
                .check(Path::new(r"\\?\UNC\server\share\a.md"))
                .is_err()
        );
    }

    #[test]
    fn is_inside_compares_whole_path_parts() {
        let sep = MAIN_SEPARATOR;
        assert!(is_inside(&format!("{sep}a{sep}b"), &format!("{sep}a")));
        assert!(is_inside(&format!("{sep}a"), &format!("{sep}a")));
        assert!(!is_inside(&format!("{sep}ab"), &format!("{sep}a")));
    }

    #[test]
    fn display_path_drops_the_windows_prefix_but_keeps_network_paths_marked() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\notes\a.md")),
            r"C:\notes\a.md"
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\srv\share")),
            r"\\?\UNC\srv\share"
        );
        assert_eq!(display_path(Path::new("/home/a.md")), "/home/a.md");
    }
}
