//! ISC-294: Quick Open, the link scans and folder search offer no file under an excluded folder,
//! through the index and through a walk alike.

use super::testkit::*;
use super::*;
use crate::documents::AppState;
use crate::links::references;
use crate::links::rewrite::{self, Move};
use crate::search::{self, Inputs, Request};
use std::collections::HashMap;

/// A workspace that also holds files that match everything, under every kind of excluded folder,
/// at the top and deep inside.
fn with_excluded_files(root: &Path) {
    put(root, "old.md", "# old needle\n");
    put(root, "index.md", "[a](old.md) needle\n");
    put(root, "docs/deep/guide.md", "[a](../../old.md) needle\n");
    for folder in [
        "node_modules/pkg",
        "target/debug",
        "docs/build",
        "a/b/.git",
        "a/dist",
    ] {
        put(
            root,
            &format!("{folder}/hidden.md"),
            "[a](../old.md) needle\n",
        );
        put(root, &format!("{folder}/hidden.txt"), "needle\n");
    }
}

fn is_excluded_path(text: &str) -> bool {
    let text = text.replace('\\', "/");
    ["/node_modules/", "/target/", "/build/", "/.git/", "/dist/"]
        .iter()
        .any(|part| text.contains(part))
}

fn request() -> Request {
    Request {
        id: 1,
        query: "needle".into(),
        case_sensitive: false,
        whole_word: false,
        regexp: false,
        include: String::new(),
        exclude: String::new(),
    }
}

fn found_by_search(root: &Path, index: Option<&WorkspaceIndex>) -> Vec<String> {
    let roots = vec![root.to_path_buf()];
    let held = HashMap::new();
    let mut hits = Vec::new();
    search::run(
        &Inputs {
            roots: &roots,
            index,
            held: &held,
            ignore_case: ignore_case(),
        },
        &request(),
        &|| false,
        &mut |batch| hits.extend(batch.hits),
    );
    hits.into_iter().map(|hit| hit.path).collect()
}

#[test]
fn folder_search_reads_no_file_under_an_excluded_folder_through_the_index_or_a_walk() {
    let dir = tree(&[]);
    let root = root(&dir);
    with_excluded_files(&root);
    let index = index();
    index.add_root_now(&root);
    for through in [Some(&index), None] {
        let hits = found_by_search(&root, through);
        assert_eq!(hits.len(), 3, "{hits:?}");
        assert!(hits.iter().all(|path| !is_excluded_path(path)), "{hits:?}");
    }
}

#[test]
fn a_rename_reads_and_rewrites_no_file_under_an_excluded_folder() {
    let dir = tree(&[]);
    let root = root(&dir);
    with_excluded_files(&root);
    let index = index();
    index.add_root_now(&root);
    let mv = Move {
        from: root.join("old.md"),
        to: root.join("renamed.md"),
    };
    for through in [Some(&index), None] {
        let plan = rewrite::plan(
            std::slice::from_ref(&root),
            through,
            &mv,
            ignore_case(),
            |_| true,
        )
        .expect("planned");
        let touched: Vec<String> = plan
            .files
            .iter()
            .map(|file| file.before.to_string_lossy().into_owned())
            .collect();
        assert_eq!(touched.len(), 2, "{touched:?}");
        assert!(
            touched.iter().all(|path| !is_excluded_path(path)),
            "{touched:?}"
        );
        assert_eq!(
            plan.scanned, 3,
            "old.md, index.md and guide.md are the only Markdown read"
        );
    }
}

#[test]
fn find_file_references_reads_no_file_under_an_excluded_folder() {
    let dir = tree(&[]);
    let root = root(&dir);
    with_excluded_files(&root);
    let index = index();
    index.add_root_now(&root);
    for through in [Some(&index), None] {
        let found = references::find(
            std::slice::from_ref(&root),
            through,
            &root.join("old.md"),
            ignore_case(),
            &[],
        )
        .expect("found");
        assert_eq!(found.references.len(), 2, "{:?}", found.references);
        assert!(
            found.references.iter().all(|r| !is_excluded_path(&r.path)),
            "{:?}",
            found.references
        );
        assert_eq!(found.scanned, 3);
    }
}

#[test]
fn quick_open_offers_no_file_under_an_excluded_folder() {
    let dir = tree(&[]);
    let root = root(&dir);
    with_excluded_files(&root);
    let state = AppState::new(ignore_case());
    state.index().add_root_now(&root);
    let answer = crate::workspace::quick::query(&state, "", 100);
    assert_eq!(answer.indexed, 3, "{:?}", answer.items);
    assert!(
        answer
            .items
            .iter()
            .all(|item| !is_excluded_path(&format!("/{}", item.rel)))
    );
    // A query for what the excluded folders hold finds nothing.
    let hidden = crate::workspace::quick::query(&state, "hidden", 100);
    assert_eq!(hidden.total, 0);
}
