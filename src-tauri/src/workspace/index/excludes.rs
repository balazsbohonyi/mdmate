//! ISC-282: the built-in exclusion list, `.gitignore` left alone, and the tree still showing it all.

use super::testkit::*;
use crate::fs::exclude::EXCLUDED_DIRS;
use crate::workspace::tree::{EntryKind, list_dir};

#[test]
fn no_file_under_an_excluded_name_is_held_at_any_depth() {
    let dir = tree(&["keep.md", "a/keep.md", "a/b/c/keep.md"]);
    let root = root(&dir);
    for name in EXCLUDED_DIRS {
        put(&root, &format!("{name}/inside.md"), "x");
        put(&root, &format!("a/{name}/inside.md"), "x");
        put(&root, &format!("a/b/c/{name}/deeper/inside.md"), "x");
        put(&root, &format!("{}/shouting.md", name.to_uppercase()), "x");
    }
    let index = index();
    index.add_root_now(&root);
    assert_eq!(
        index.rels(&root),
        ["a/b/c/keep.md", "a/keep.md", "keep.md"],
        "only the files outside every excluded folder"
    );
}

#[test]
fn a_gitignore_is_not_read_so_a_folder_it_names_is_still_indexed() {
    let dir = tree(&["notes/ideas.md", "docs/guide.md", "src/main.rs"]);
    let root = root(&dir);
    put(&root, ".gitignore", "docs/\nnotes/\n*.md\n");
    let index = index();
    index.add_root_now(&root);
    assert_eq!(
        index.rels(&root),
        [
            ".gitignore",
            "docs/guide.md",
            "notes/ideas.md",
            "src/main.rs"
        ]
    );
}

#[test]
fn a_folder_that_only_looks_like_an_excluded_name_is_indexed() {
    let dir = tree(&["builds/a.md", "my-target/b.md", "outer/c.md", "binary/d.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert_eq!(index.rels(&root).len(), 4);
}

#[test]
fn a_file_called_after_an_excluded_name_is_indexed() {
    let dir = tree(&["build", "out", "node_modules"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert_eq!(index.rels(&root), ["build", "node_modules", "out"]);
}

#[test]
fn the_tree_still_lists_the_excluded_folders_and_their_files() {
    let dir = tree(&["node_modules/pkg/readme.md", "target/x.md", "src/a.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert_eq!(index.rels(&root), ["src/a.md"]);

    let top = list_dir(&root).expect("the root lists");
    let folders: Vec<&str> = top
        .iter()
        .filter(|entry| entry.kind == EntryKind::Folder)
        .map(|entry| entry.name.as_str())
        .collect();
    assert_eq!(folders, ["node_modules", "src", "target"]);
    let inside = list_dir(&root.join("node_modules").join("pkg")).expect("lists");
    assert_eq!(inside.len(), 1);
    assert_eq!(inside[0].name, "readme.md");
}
