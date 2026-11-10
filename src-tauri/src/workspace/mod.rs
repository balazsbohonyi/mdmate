//! The workspace: the folders the sidebar shows, their listings and their changes.

pub(crate) mod folders;
pub(crate) mod ops;
pub(crate) mod roots;
pub(crate) mod tree;
pub(crate) mod watch;

use crate::access::display_path;
use crate::documents::AppState;
use crate::error::AppError;
use roots::RootStore;
use serde::Serialize;
use std::path::Path;

/// What a dropped path is, for the page to decide what a drop means.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DropKind {
    File,
    Folder,
    /// Gone by now, or not a file or folder.
    Other,
}

/// A path a native drop delivered, as people read it, and what it is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct DroppedItem {
    pub(crate) path: String,
    pub(crate) kind: DropKind,
}

/// Says what each path is, if a native drop delivered every one of them. One path that no drop
/// delivered refuses the whole request, so a page cannot slip a path in among real ones.
pub(crate) fn describe_drops(
    state: &AppState,
    paths: &[String],
) -> Result<Vec<DroppedItem>, AppError> {
    let mut items = Vec::with_capacity(paths.len());
    for wanted in paths {
        let recorded = state.drops().lookup(wanted)?;
        let kind = match std::fs::metadata(&recorded) {
            Ok(meta) if meta.is_dir() => DropKind::Folder,
            Ok(meta) if meta.is_file() => DropKind::File,
            _ => DropKind::Other,
        };
        items.push(DroppedItem {
            path: display_path(&recorded),
            kind,
        });
    }
    Ok(items)
}

/// Makes a dropped folder a workspace root. The path must be one a native drop delivered.
pub(crate) fn add_dropped_root(
    state: &AppState,
    store: &RootStore,
    path: &str,
) -> Result<String, AppError> {
    let recorded = state.drops().lookup(path)?;
    if !recorded.is_dir() {
        return Err(AppError::Invalid("not a folder".into()));
    }
    roots::add(state, store, Path::new(&recorded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    #[test]
    fn a_dropped_folder_becomes_a_root_and_a_dropped_file_does_not() {
        let dir = temp();
        let folder = dir.path().join("notes");
        std::fs::create_dir(&folder).expect("creates");
        let file = dir.path().join("a.md");
        std::fs::write(&file, b"x").expect("writes");
        let state = AppState::new(false);
        let store = RootStore::new(dir.path().join("data"));
        state.drops().record(&[folder.clone(), file.clone()]);

        let items = describe_drops(
            &state,
            &[
                folder.to_string_lossy().into_owned(),
                file.to_string_lossy().into_owned(),
            ],
        )
        .expect("both were dropped");
        assert_eq!(items[0].kind, DropKind::Folder);
        assert_eq!(items[1].kind, DropKind::File);

        add_dropped_root(&state, &store, &folder.to_string_lossy()).expect("a folder drop");
        assert_eq!(roots::current(&state).len(), 1);
        assert!(
            add_dropped_root(&state, &store, &file.to_string_lossy()).is_err(),
            "a file is not a folder"
        );
        assert_eq!(roots::current(&state).len(), 1);
    }

    #[test]
    fn a_folder_nobody_dropped_cannot_become_a_root() {
        let dir = temp();
        let state = AppState::new(false);
        let store = RootStore::new(dir.path().join("data"));
        let error = add_dropped_root(&state, &store, &dir.path().to_string_lossy())
            .expect_err("no drop delivered it");
        assert_eq!(error.kind(), "not-allowed");
        assert!(roots::current(&state).is_empty());
        assert!(!dir.path().join("data").exists(), "nothing was saved");
    }

    #[test]
    fn one_undelivered_path_refuses_the_whole_request() {
        let dir = temp();
        let real = dir.path().join("a.md");
        std::fs::write(&real, b"x").expect("writes");
        let state = AppState::new(false);
        state.drops().record(std::slice::from_ref(&real));
        let sneaky = PathBuf::from(dir.path()).join("secret.md");
        let result = describe_drops(
            &state,
            &[
                real.to_string_lossy().into_owned(),
                sneaky.to_string_lossy().into_owned(),
            ],
        );
        assert_eq!(
            result.expect_err("one was never dropped").kind(),
            "not-allowed"
        );
    }
}
