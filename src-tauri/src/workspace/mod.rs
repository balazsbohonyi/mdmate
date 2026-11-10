//! The workspace: the folders the sidebar shows, their listings and their changes.

pub(crate) mod folders;
pub(crate) mod ops;
pub(crate) mod roots;
pub(crate) mod tree;
pub(crate) mod watch;

use crate::access::display_path;
use crate::documents::AppState;
use crate::error::AppError;
use crate::fs::kind::{FileKind, kind_of};
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
    /// What a file opens as; absent for a folder or anything else.
    #[serde(rename = "fileKind", skip_serializing_if = "Option::is_none")]
    pub(crate) file_kind: Option<FileKind>,
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
            file_kind: (kind == DropKind::File).then(|| kind_of(&recorded)),
        });
    }
    Ok(items)
}

/// Lets the page open the files of a native drop: each path must be one a drop delivered, and
/// each file is granted the way a choice in the open dialog is. Folders and anything else are
/// described but not granted. One path that no drop delivered refuses the whole request, before
/// anything is granted.
pub(crate) fn open_drops(state: &AppState, paths: &[String]) -> Result<Vec<DroppedItem>, AppError> {
    let items = describe_drops(state, paths)?;
    let mut access = state.access();
    for item in &items {
        if item.kind == DropKind::File {
            access.grant_file(Path::new(&item.path))?;
        }
    }
    Ok(items)
}

/// What a file the page may read opens as. Paths the page was never given refuse.
pub(crate) fn file_kind(state: &AppState, path: &str) -> Result<FileKind, AppError> {
    let resolved = state.access().check(Path::new(path))?;
    Ok(kind_of(&resolved.path))
}

/// An image the page may show: where it is as people read it, and its size on disk.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ImageInfo {
    pub(crate) path: String,
    pub(crate) size: u64,
}

/// Checks that an image may be shown and says how big it is. The caller widens the image
/// protocol's scope to the one file this names, so the page cannot ask for more.
pub(crate) fn image_info(
    state: &AppState,
    path: &str,
) -> Result<(ImageInfo, std::path::PathBuf), AppError> {
    let resolved = state.access().check(Path::new(path))?;
    if kind_of(&resolved.path) != FileKind::Image {
        return Err(AppError::Invalid("not an image".into()));
    }
    let meta = std::fs::metadata(&resolved.path)?;
    if !meta.is_file() {
        return Err(AppError::Invalid("not a file".into()));
    }
    state.note_image(&resolved);
    let info = ImageInfo {
        path: display_path(&resolved.path),
        size: meta.len(),
    };
    Ok((info, resolved.path))
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
    fn text_of(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn drop_paths_only_a_delivered_file_opens_and_its_neighbour_does_not() {
        let dir = temp();
        let delivered = dir.path().join("a.md");
        let neighbour = dir.path().join("b.md");
        std::fs::write(&delivered, b"a").expect("writes");
        std::fs::write(&neighbour, b"b").expect("writes");
        let state = AppState::new(false);
        state.drops().record(std::slice::from_ref(&delivered));
        assert!(state.access().check(&delivered).is_err(), "not yet granted");

        let items = open_drops(&state, &[text_of(&delivered)]).expect("a delivered file");
        assert_eq!(items[0].file_kind, Some(FileKind::Markdown));
        assert!(state.access().check(&delivered).is_ok(), "now granted");
        assert_eq!(
            state.access().check(&neighbour).expect_err("never").kind(),
            "not-allowed"
        );
    }

    #[test]
    fn drop_paths_only_a_path_no_drop_delivered_is_refused_to_open_and_grants_nothing() {
        let dir = temp();
        let delivered = dir.path().join("a.md");
        let never = dir.path().join("secret.txt");
        std::fs::write(&delivered, b"a").expect("writes");
        std::fs::write(&never, b"s").expect("writes");
        let state = AppState::new(false);
        state.drops().record(std::slice::from_ref(&delivered));

        let error = open_drops(&state, &[text_of(&never)]).expect_err("no drop delivered it");
        assert_eq!(error.kind(), "not-allowed");
        // One undelivered path among real ones refuses the whole request and grants none of it.
        assert!(open_drops(&state, &[text_of(&delivered), text_of(&never)]).is_err());
        assert!(state.access().check(&delivered).is_err());
        assert!(state.access().check(&never).is_err());
    }

    #[test]
    fn drop_paths_only_a_dropped_folder_is_described_but_never_granted_as_a_file() {
        let dir = temp();
        let folder = dir.path().join("notes");
        std::fs::create_dir(&folder).expect("creates");
        let state = AppState::new(false);
        state.drops().record(std::slice::from_ref(&folder));
        let items = open_drops(&state, &[text_of(&folder)]).expect("described");
        assert_eq!(items[0].kind, DropKind::Folder);
        assert_eq!(items[0].file_kind, None);
        assert!(
            state.access().check(&folder).is_err(),
            "a folder drop opens nothing"
        );
    }

    #[test]
    fn drop_paths_only_an_image_is_shown_only_after_a_drop_or_a_choice_granted_it() {
        let dir = temp();
        let image = dir.path().join("pic.png");
        std::fs::write(&image, [0_u8; 7]).expect("writes");
        let state = AppState::new(false);
        assert_eq!(
            image_info(&state, &text_of(&image))
                .expect_err("never granted")
                .kind(),
            "not-allowed"
        );
        state.drops().record(std::slice::from_ref(&image));
        open_drops(&state, &[text_of(&image)]).expect("a delivered file");
        let (info, resolved) = image_info(&state, &text_of(&image)).expect("granted now");
        assert_eq!(info.size, 7);
        assert!(resolved.ends_with("pic.png"));
    }

    #[test]
    fn an_image_command_refuses_what_is_not_an_image() {
        let dir = temp();
        let text = dir.path().join("a.txt");
        std::fs::write(&text, b"x").expect("writes");
        let state = AppState::new(false);
        state.access().grant_file(&text).expect("granted");
        assert_eq!(
            image_info(&state, &text_of(&text))
                .expect_err("a text file")
                .kind(),
            "invalid"
        );
        assert_eq!(
            file_kind(&state, &text_of(&text)).expect("kind"),
            FileKind::Text
        );
    }
}
