//! ISC-288: the file limit, and the status that names the root it cut. (That search and link scans
//! walk a cut root is tested with the users of the index, in `users`.)

use super::testkit::*;
use super::*;

fn label_of(root: &Path) -> String {
    root.file_name()
        .expect("a folder name")
        .to_string_lossy()
        .into_owned()
}

#[test]
fn a_root_past_the_cap_stops_at_the_cap_and_is_named() {
    let dir = tree(&[
        "a/1.md", "a/2.md", "b/3.md", "b/4.md", "5.md", "6.md", "7.md", "8.md",
    ]);
    let root = root(&dir);
    let index = index();
    index.set_cap(5);
    index.add_root_now(&root);

    assert_eq!(index.entries(&root).len(), 5);
    let status = index.status();
    assert_eq!(status.cut, [label_of(&root)]);
    assert!(!status.indexing);
}

#[test]
fn a_root_exactly_at_the_cap_is_not_cut() {
    let dir = tree(&["a/1.md", "b/2.md", "3.md"]);
    let root = root(&dir);
    let index = index();
    index.set_cap(3);
    index.add_root_now(&root);
    assert_eq!(index.entries(&root).len(), 3);
    assert!(index.status().cut.is_empty());
}

#[test]
fn the_cap_counts_every_root_together_and_only_the_root_that_hit_it_is_named() {
    let one = tree(&["1.md", "2.md", "3.md"]);
    let two = tree(&["a/4.md", "a/5.md", "a/6.md", "7.md"]);
    let (one, two) = (root(&one), root(&two));
    let index = index();
    index.set_cap(5);
    index.add_root_now(&one);
    index.add_root_now(&two);

    assert_eq!(index.entries(&one).len(), 3);
    assert_eq!(index.entries(&two).len(), 2, "what room was left");
    assert_eq!(index.status().cut, [label_of(&two)]);
}

#[test]
fn removing_the_cut_root_clears_the_status() {
    let dir = tree(&["1.md", "2.md", "3.md"]);
    let root = root(&dir);
    let index = index();
    index.set_cap(2);
    index.add_root_now(&root);
    assert_eq!(index.status().cut.len(), 1);
    index.remove_root(&root);
    assert!(index.status().cut.is_empty());
}

#[test]
fn a_root_that_was_cut_is_cut_again_by_the_next_walk_and_never_grows_past_the_cap() {
    let dir = tree(&["1.md", "2.md", "3.md", "4.md"]);
    let root = root(&dir);
    let index = index();
    index.set_cap(3);
    index.add_root_now(&root);
    index.reconcile_now(&root);
    assert_eq!(index.entries(&root).len(), 3);
    assert_eq!(index.status().cut.len(), 1);
}

#[test]
fn a_new_file_past_the_cap_is_not_added_and_marks_the_root_cut() {
    let dir = tree(&["1.md", "2.md"]);
    let root = root(&dir);
    let index = index();
    index.set_cap(2);
    index.add_root_now(&root);
    assert!(index.status().cut.is_empty());
    put(&root, "3.md", "x");
    index.changed(&root.join("3.md"));
    assert_eq!(index.rels(&root), ["1.md", "2.md"]);
    assert_eq!(index.status().cut, [label_of(&root)]);
}

#[test]
fn the_cap_is_a_million_files() {
    assert_eq!(MAX_FILES, 1_000_000);
}
