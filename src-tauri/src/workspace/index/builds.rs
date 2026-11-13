//! ISC-281: what the index holds for a tree, an empty folder and a folder that is not there.

use super::testkit::*;
use super::*;

#[test]
fn every_file_is_listed_once_with_its_path_name_kind_size_and_time() {
    let dir = tree(&[]);
    let root = root(&dir);
    put(&root, "a.md", "hello");
    put(&root, "sub/b.txt", "twelve chars");
    put(&root, "sub/deep/c.png", "png");
    put(&root, "d.rs", "");
    let earlier = millis(SystemTime::now()) - 120_000;
    let index = index();
    index.add_root_now(&root);

    let entries = index.entries(&root);
    let rels: Vec<&str> = entries.iter().map(|entry| &*entry.rel).collect();
    assert_eq!(rels, ["a.md", "d.rs", "sub/b.txt", "sub/deep/c.png"]);
    let names: Vec<&str> = entries
        .iter()
        .map(|entry| &entry.rel[entry.name_start()..])
        .collect();
    assert_eq!(names, ["a.md", "d.rs", "b.txt", "c.png"]);
    let kinds: Vec<FileKind> = entries.iter().map(|entry| entry.kind).collect();
    assert_eq!(
        kinds,
        [
            FileKind::Markdown,
            FileKind::Text,
            FileKind::Text,
            FileKind::Image
        ]
    );
    let sizes: Vec<u64> = entries.iter().map(|entry| entry.size).collect();
    assert_eq!(sizes, [5, 0, 12, 3]);
    for entry in &entries {
        assert!(
            entry.modified >= earlier,
            "{} has a modified time of now, not {}",
            entry.rel,
            entry.modified
        );
    }
    assert!(index.is_ready(&root));
}

#[test]
fn the_index_is_what_a_walk_of_the_disk_finds() {
    let dir = tree(&[
        "a.md",
        "Zed.md",
        "b/c.md",
        "b/d/e.txt",
        "b/d/f/g.md",
        "docs/readme.md",
        "docs/images/p.png",
        "é/ü.md",
        "empty/",
    ]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert_eq!(index.rels(&root), walked_paths(&root));
    assert_eq!(index.rels(&root).len(), 9 - 1);
}

#[test]
fn an_empty_folder_gives_an_empty_finished_index() {
    let dir = tree(&[]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert!(index.rels(&root).is_empty());
    assert!(index.is_ready(&root));
    assert_eq!(index.status(), Status::default());
}

#[test]
fn a_folder_that_cannot_be_read_gives_an_empty_index_and_no_panic() {
    let dir = tree(&[]);
    let gone = root(&dir).join("not-there");
    let index = index();
    index.add_root_now(&gone);
    assert!(index.rels(&gone).is_empty());
    assert_eq!(index.status(), Status::default());
}

#[test]
fn adding_a_root_twice_holds_it_once() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert!(index.register_only(&root).is_none());
    assert_eq!(index.rels(&root), ["a.md"]);
}

#[test]
fn a_file_without_an_extension_and_a_dotfile_are_listed() {
    let dir = tree(&["Makefile", ".env", "x/.hidden.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    assert_eq!(index.rels(&root), [".env", "Makefile", "x/.hidden.md"]);
}
