//! Which paths a native drop delivered.
//!
//! A file dragged from Explorer onto the window reaches Rust as a window event with real paths.
//! The page hears about it too, but the page is never trusted to name a path: anything that
//! opens or copies a dropped file asks this record first, and a path no native drop delivered is
//! refused. A hostile document cannot make the app read a file by claiming it was dropped.
//!
//! Only the last few drops are kept, and the record ends with the app.

use crate::access::display_path;
use crate::error::AppError;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// How many drops are remembered. A person drops one thing at a time, and acting on a drop takes
/// a moment, so a short history covers a quick second drop without keeping old ones forever.
const KEPT: usize = 4;

#[derive(Debug)]
pub(crate) struct DropRegistry {
    ignore_case: bool,
    recent: Mutex<VecDeque<Vec<PathBuf>>>,
}

impl DropRegistry {
    pub(crate) fn new(ignore_case: bool) -> Self {
        Self {
            ignore_case,
            recent: Mutex::new(VecDeque::new()),
        }
    }

    /// How two spellings of one path compare: the way people read it, folded where the file
    /// system ignores case.
    fn key(&self, path: &Path) -> String {
        let text = display_path(path);
        if self.ignore_case {
            text.to_lowercase()
        } else {
            text
        }
    }

    /// Notes the paths of one native drop. Only the window's own drop event calls this.
    pub(crate) fn record(&self, paths: &[PathBuf]) {
        if paths.is_empty() {
            return;
        }
        let mut recent = self.recent.lock().unwrap_or_else(PoisonError::into_inner);
        recent.push_back(paths.to_vec());
        while recent.len() > KEPT {
            recent.pop_front();
        }
    }

    /// The path as the native drop delivered it, or a refusal when no recent drop carried it.
    /// What comes back is Rust's own copy, never the page's spelling.
    pub(crate) fn lookup(&self, wanted: &str) -> Result<PathBuf, AppError> {
        let key = self.key(Path::new(wanted));
        let recent = self.recent.lock().unwrap_or_else(PoisonError::into_inner);
        recent
            .iter()
            .flatten()
            .find(|path| self.key(path) == key)
            .cloned()
            .ok_or_else(|| AppError::NotAllowed("a path no drop delivered".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn a_dropped_path_is_found_and_another_is_not() {
        let registry = DropRegistry::new(false);
        registry.record(&paths(&["/a/one.md", "/a/two.md"]));
        assert_eq!(
            registry.lookup("/a/one.md").expect("dropped"),
            PathBuf::from("/a/one.md")
        );
        assert_eq!(
            registry
                .lookup("/a/three.md")
                .expect_err("never dropped")
                .kind(),
            "not-allowed"
        );
    }

    #[test]
    fn nothing_is_found_before_any_drop() {
        let registry = DropRegistry::new(false);
        assert!(registry.lookup("/a/one.md").is_err());
        registry.record(&[]);
        assert!(registry.lookup("").is_err());
    }

    #[test]
    fn a_neighbour_or_a_parent_of_a_dropped_path_is_not_dropped() {
        let registry = DropRegistry::new(false);
        registry.record(&paths(&["/a/folder"]));
        for other in ["/a", "/a/folder/inner.md", "/a/folder2", "/a/folde"] {
            assert!(registry.lookup(other).is_err(), "{other}");
        }
    }

    #[test]
    fn only_the_last_few_drops_are_kept() {
        let registry = DropRegistry::new(false);
        for index in 0..=KEPT {
            registry.record(&paths(&[&format!("/drop/{index}.md")]));
        }
        assert!(
            registry.lookup("/drop/0.md").is_err(),
            "the oldest was dropped"
        );
        for index in 1..=KEPT {
            assert!(registry.lookup(&format!("/drop/{index}.md")).is_ok());
        }
    }

    #[test]
    fn case_counts_only_where_the_file_system_cares() {
        let folding = DropRegistry::new(true);
        folding.record(&paths(&["/a/Note.md"]));
        assert!(folding.lookup("/A/NOTE.md").is_ok());
        let exact = DropRegistry::new(false);
        exact.record(&paths(&["/a/Note.md"]));
        assert!(exact.lookup("/A/NOTE.md").is_err());
    }

    #[test]
    fn the_answer_is_the_recorded_path_not_the_pages_spelling() {
        let registry = DropRegistry::new(true);
        registry.record(&paths(&["/a/Note.md"]));
        assert_eq!(
            registry.lookup("/A/note.md").expect("dropped"),
            PathBuf::from("/a/Note.md")
        );
    }
}
