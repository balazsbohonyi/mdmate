//! ISC-287: a file under two roots is held once, by the innermost root.

use super::testkit::*;
use super::*;

fn two_roots(order_inner_first: bool) -> (tempfile::TempDir, PathBuf, PathBuf, WorkspaceIndex) {
    let dir = tree(&["top.md", "other.md", "notes/n.md", "notes/deep/d.md"]);
    let outer = root(&dir);
    let inner = outer.join("notes");
    let index = index();
    if order_inner_first {
        index.add_root_now(&inner);
        index.add_root_now(&outer);
    } else {
        index.add_root_now(&outer);
        index.add_root_now(&inner);
    }
    (dir, outer, inner, index)
}

#[test]
fn a_file_of_the_inner_root_is_held_once_relative_to_the_inner_root() {
    for inner_first in [false, true] {
        let (_dir, outer, inner, index) = two_roots(inner_first);
        assert_eq!(index.rels(&inner), ["deep/d.md", "n.md"], "{inner_first}");
        assert_eq!(index.rels(&outer), ["other.md", "top.md"], "{inner_first}");
    }
}

#[test]
fn removing_the_inner_root_gives_its_files_back_to_the_outer_root() {
    let (_dir, outer, inner, index) = two_roots(false);
    index.remove_root(&inner);
    // The outer root reads the folder again on the worker; do the same step here.
    index.changed(&inner);
    assert_eq!(
        index.rels(&outer),
        ["notes/deep/d.md", "notes/n.md", "other.md", "top.md"]
    );
    assert!(index.rels(&inner).is_empty());
}

#[test]
fn a_change_in_the_inner_folder_goes_to_the_inner_root_only() {
    let (_dir, outer, inner, index) = two_roots(false);
    put(&outer, "notes/new.md", "x");
    index.changed(&outer.join("notes").join("new.md"));
    assert_eq!(index.rels(&inner), ["deep/d.md", "n.md", "new.md"]);
    assert_eq!(index.rels(&outer), ["other.md", "top.md"]);
}

#[test]
fn a_walk_of_the_outer_root_leaves_the_inner_folder_to_the_inner_root() {
    let (_dir, outer, inner, index) = two_roots(false);
    index.reconcile_now(&outer);
    assert_eq!(index.rels(&outer), ["other.md", "top.md"]);
    assert_eq!(index.rels(&inner), ["deep/d.md", "n.md"]);
}

#[test]
fn three_levels_each_hold_their_own_files() {
    let dir = tree(&["a.md", "b/b.md", "b/c/c.md", "b/c/d/d.md"]);
    let top = root(&dir);
    let index = index();
    index.add_root_now(&top);
    index.add_root_now(&top.join("b").join("c"));
    index.add_root_now(&top.join("b"));
    assert_eq!(index.rels(&top), ["a.md"]);
    assert_eq!(index.rels(&top.join("b")), ["b.md"]);
    assert_eq!(index.rels(&top.join("b").join("c")), ["c.md", "d/d.md"]);
}
