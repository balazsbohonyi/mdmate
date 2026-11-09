//! The folder listing behind the sidebar tree. One folder at a time: the page asks for a folder
//! when the user opens it, so a huge workspace costs nothing until it is looked at.

use crate::error::AppError;
use serde::Serialize;
use std::cmp::Ordering;
use std::path::Path;

/// What a tree row is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EntryKind {
    File,
    Folder,
}

/// One row of a folder listing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct TreeEntry {
    pub(crate) name: String,
    pub(crate) kind: EntryKind,
}

/// Folders first, then files, each group in name order with case ignored (so `b.md` sorts between
/// `A.md` and `c.md`). Equal names in different case keep a fixed order, so a listing never
/// reshuffles between two reads.
fn compare(a: &TreeEntry, b: &TreeEntry) -> Ordering {
    let group = |entry: &TreeEntry| u8::from(entry.kind == EntryKind::File);
    group(a)
        .cmp(&group(b))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.name.cmp(&b.name))
}

/// Lists a folder: its files and its folders, sorted. A link to a folder counts as a folder and a
/// link to a file (or a link that leads nowhere) as a file; whether the page may open it is
/// decided when it asks, against the workspace roots with the link resolved.
///
/// An entry whose type cannot be read is left out rather than failing the whole listing.
pub(crate) fn list_dir(dir: &Path) -> Result<Vec<TreeEntry>, AppError> {
    let mut entries = Vec::new();
    for item in std::fs::read_dir(dir)? {
        let Ok(item) = item else { continue };
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let is_folder = if file_type.is_symlink() {
            std::fs::metadata(item.path()).is_ok_and(|meta| meta.is_dir())
        } else {
            file_type.is_dir()
        };
        entries.push(TreeEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            kind: if is_folder {
                EntryKind::Folder
            } else {
                EntryKind::File
            },
        });
    }
    entries.sort_by(compare);
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    fn names(entries: &[TreeEntry]) -> Vec<String> {
        entries
            .iter()
            .map(|entry| {
                let mark = if entry.kind == EntryKind::Folder {
                    "/"
                } else {
                    ""
                };
                format!("{}{mark}", entry.name)
            })
            .collect()
    }

    #[test]
    fn folders_come_first_then_files_each_in_name_order_ignoring_case() {
        let dir = temp();
        for name in ["b.md", "A.md", "c.txt", "Z.png"] {
            std::fs::write(dir.path().join(name), b"x").expect("writes");
        }
        for name in ["zeta", "Alpha", "beta"] {
            std::fs::create_dir(dir.path().join(name)).expect("creates");
        }
        let listed = list_dir(dir.path()).expect("lists");
        assert_eq!(
            names(&listed),
            ["Alpha/", "beta/", "zeta/", "A.md", "b.md", "c.txt", "Z.png"]
        );
    }

    #[test]
    fn it_lists_one_folder_and_nothing_below_it() {
        let dir = temp();
        std::fs::create_dir_all(dir.path().join("a/b/c")).expect("creates");
        std::fs::write(dir.path().join("a/b/deep.md"), b"x").expect("writes");
        let listed = list_dir(dir.path()).expect("lists");
        assert_eq!(names(&listed), ["a/"]);
    }

    #[test]
    fn a_missing_folder_is_an_error_and_an_empty_one_is_an_empty_list() {
        let dir = temp();
        assert!(list_dir(&dir.path().join("missing")).is_err());
        assert!(list_dir(dir.path()).expect("lists").is_empty());
    }

    #[test]
    fn a_file_is_not_a_folder() {
        let dir = temp();
        let file = dir.path().join("a.md");
        std::fs::write(&file, b"x").expect("writes");
        assert!(list_dir(&file).is_err());
    }

    #[test]
    fn names_with_odd_characters_come_through_whole() {
        let dir = temp();
        for name in ["with space.md", "naïve.md", "[draft] {x}.md", "日本語.md"] {
            std::fs::write(dir.path().join(name), b"x").expect("writes");
        }
        let listed = names(&list_dir(dir.path()).expect("lists"));
        for name in ["with space.md", "naïve.md", "[draft] {x}.md", "日本語.md"] {
            assert!(listed.contains(&name.to_owned()), "{name} in {listed:?}");
        }
    }

    #[test]
    fn ten_thousand_entries_list_in_order() {
        let dir = temp();
        for index in 0..10_000 {
            std::fs::write(dir.path().join(format!("note-{index:05}.md")), b"").expect("writes");
        }
        let listed = list_dir(dir.path()).expect("lists");
        assert_eq!(listed.len(), 10_000);
        assert_eq!(listed[0].name, "note-00000.md");
        assert_eq!(listed[9_999].name, "note-09999.md");
    }
}
