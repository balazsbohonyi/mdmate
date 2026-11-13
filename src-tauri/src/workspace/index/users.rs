//! ISC-293: the rename and move rewrite, Find File References and folder search take their file
//! list from the index on a root it holds, walk a root it does not, and give the answer a walk
//! gives. (Each user also has its own tests, in its own module, for its details.)

use super::testkit::*;
use super::*;
use crate::links::references;
use crate::links::rewrite::{self, Move};
use crate::search::{self, Inputs, Request};
use std::collections::HashMap;

fn linked(root: &Path) {
    put(root, "old.md", "# old needle\n");
    put(
        root,
        "index.md",
        "[a](old.md#h)\n\nneedle [b](notes/n.md)\n",
    );
    put(root, "notes/n.md", "[a](../old.md) and needle\n");
    put(root, "notes/sibling.md", "nothing here\n");
    put(root, "other.txt", "needle in text\n");
    put(root, "pic.png", "needle in a picture\n");
}

fn request(include: &str, exclude: &str) -> Request {
    Request {
        id: 1,
        query: "needle".into(),
        case_sensitive: false,
        whole_word: false,
        regexp: false,
        include: include.into(),
        exclude: exclude.into(),
    }
}

/// The hits of a folder search, by file and line, with how it ended.
fn searched(root: &Path, index: Option<&WorkspaceIndex>, request: &Request) -> Vec<String> {
    let roots = vec![root.to_path_buf()];
    let held = HashMap::new();
    let mut hits = Vec::new();
    let summary = search::run(
        &Inputs {
            roots: &roots,
            index,
            held: &held,
            ignore_case: ignore_case(),
        },
        request,
        &|| false,
        &mut |batch| hits.extend(batch.hits),
    );
    let mut found: Vec<String> = hits
        .iter()
        .map(|hit| {
            format!(
                "{}:{}:{}",
                hit.path.replace('\\', "/"),
                hit.line,
                hit.column
            )
        })
        .collect();
    found.sort();
    found.push(format!(
        "scanned {} files {}",
        summary.scanned, summary.files
    ));
    found
}

fn planned(root: &Path, index: Option<&WorkspaceIndex>) -> Vec<String> {
    let mv = Move {
        from: root.join("old.md"),
        to: root.join("renamed.md"),
    };
    let plan = rewrite::plan(&[root.to_path_buf()], index, &mv, ignore_case(), |_| true)
        .expect("the move is planned");
    let mut found: Vec<String> = plan
        .files
        .iter()
        .map(|file| format!("{} -> {:?}", file.before.display(), file.edits))
        .collect();
    found.sort();
    found.push(format!("scanned {} binary {}", plan.scanned, plan.binary));
    found
}

fn referenced(root: &Path, index: Option<&WorkspaceIndex>) -> Vec<String> {
    let found = references::find(
        &[root.to_path_buf()],
        index,
        &root.join("old.md"),
        ignore_case(),
        &[],
    )
    .expect("the references are found");
    let mut list: Vec<String> = found
        .references
        .iter()
        .map(|r| format!("{}:{}", r.path.replace('\\', "/"), r.line))
        .collect();
    list.sort();
    list.push(format!("scanned {} files {}", found.scanned, found.files));
    list
}

#[test]
fn an_indexed_root_gives_every_user_the_answer_a_walk_gives() {
    let dir = tree(&[]);
    let root = root(&dir);
    linked(&root);
    let index = index();
    index.add_root_now(&root);
    assert!(index.is_ready(&root));

    assert_eq!(planned(&root, Some(&index)), planned(&root, None));
    assert_eq!(referenced(&root, Some(&index)), referenced(&root, None));
    for (include, exclude) in [("", ""), ("*.md", ""), ("", "notes"), ("notes", "")] {
        assert_eq!(
            searched(&root, Some(&index), &request(include, exclude)),
            searched(&root, None, &request(include, exclude)),
            "include {include:?} exclude {exclude:?}"
        );
    }
}

#[test]
fn an_indexed_root_is_not_walked_and_one_not_indexed_yet_is() {
    let dir = tree(&[]);
    let root = root(&dir);
    linked(&root);
    let index = index();
    index.add_root_now(&root);
    // A file only a walk can see: the index has not been told of it.
    put(&root, "late.md", "[a](old.md) needle\n");
    let from_list = referenced(&root, Some(&index));
    let from_walk = referenced(&root, None);
    assert_ne!(
        from_list, from_walk,
        "the list was used, so late.md is not in it"
    );
    assert_eq!(from_walk.len(), from_list.len() + 1);

    let unread = self::index();
    unread.register_only(&root);
    assert!(!unread.is_ready(&root));
    assert_eq!(referenced(&root, Some(&unread)), from_walk, "walked");
    assert_eq!(
        searched(&root, Some(&unread), &request("", "")),
        searched(&root, None, &request("", ""))
    );
    assert_eq!(planned(&root, Some(&unread)), planned(&root, None));
}

#[test]
fn a_root_cut_by_the_cap_is_walked_by_every_user() {
    let dir = tree(&[]);
    let root = root(&dir);
    linked(&root);
    let index = index();
    index.set_cap(2);
    index.add_root_now(&root);
    assert_eq!(index.entries(&root).len(), 2);
    assert_eq!(planned(&root, Some(&index)), planned(&root, None));
    assert_eq!(referenced(&root, Some(&index)), referenced(&root, None));
    assert_eq!(
        searched(&root, Some(&index), &request("", "")),
        searched(&root, None, &request("", ""))
    );
}

#[test]
fn a_file_made_while_the_app_runs_reaches_every_user_once_the_index_is_told() {
    let dir = tree(&[]);
    let root = root(&dir);
    linked(&root);
    let index = index();
    index.add_root_now(&root);
    put(&root, "fresh/new.md", "[a](../old.md) needle\n");
    index.changed(&root.join("fresh/new.md"));
    assert_eq!(referenced(&root, Some(&index)), referenced(&root, None));
    assert_eq!(planned(&root, Some(&index)), planned(&root, None));
    assert_eq!(
        searched(&root, Some(&index), &request("", "")),
        searched(&root, None, &request("", ""))
    );
}
