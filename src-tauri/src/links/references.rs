//! Find File References: every link in the workspace that leads to one file.
//!
//! It reads the same files the rename reads and resolves a link with the same rule
//! ([`Wanted::linked_from`] is built on the rename's own path code), so the list shown here and
//! the links a rename would change cannot disagree about what leads where. A document that is open
//! with unsaved edits is read from the text the page sends, so a line number is the one the editor
//! shows.

use super::flow::{Buffer, Problem};
use super::rewrite::{Wanted, place_key};
use super::scan::{self, Link};
use super::walk::{Scan, Scope, read_unless_binary, scan_bytes, walk_indexed};
use crate::access::display_path;
use crate::documents::AppState;
use crate::error::{AppError, friendly_io};
use crate::fs::encoding::{self, Decoded};
use crate::workspace::index::WorkspaceIndex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// The most references listed. A workspace with more shows the first ones and says so.
pub(crate) const MAX_REFERENCES: usize = 2000;

/// The longest line text kept for the list.
const MAX_EXCERPT: usize = 200;

/// One link that leads to the file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reference {
    /// The file the link is written in, as people read the path.
    pub(crate) path: String,
    /// Line of the link, from 1.
    pub(crate) line: usize,
    /// UTF-16 units from the start of that line to the start of the link's target.
    pub(crate) column: usize,
    /// The line, trimmed and cut, for the list.
    pub(crate) text: String,
}

/// What a search found.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Found {
    /// By file, then by line.
    pub(crate) references: Vec<Reference>,
    /// How many files hold at least one.
    pub(crate) files: usize,
    /// Text files read.
    pub(crate) scanned: usize,
    /// Files that could not be read or that mdmate does not write; their links were not checked.
    pub(crate) skipped: Vec<Problem>,
    /// There were more than [`MAX_REFERENCES`]; the rest are not listed.
    pub(crate) truncated: bool,
}

/// The line a link is on, cut for a list.
fn excerpt(line: &str) -> String {
    line.trim().chars().take(MAX_EXCERPT).collect()
}

fn add(found: &mut Found, path: &Path, text: &str, hits: &[&Link]) {
    let shown = display_path(path);
    let mut any = false;
    for link in hits {
        if found.references.len() >= MAX_REFERENCES {
            found.truncated = true;
            break;
        }
        let start = link.span.start;
        let line_start = text
            .get(..start)
            .and_then(|head| head.rfind('\n'))
            .map_or(0, |at| at + 1);
        let line_end = text
            .get(line_start..)
            .and_then(|rest| rest.find('\n'))
            .map_or(text.len(), |at| line_start + at);
        let line = text.get(line_start..line_end).unwrap_or_default();
        let column = text
            .get(line_start..start)
            .map_or(0, |head| head.encode_utf16().count());
        found.references.push(Reference {
            path: shown.clone(),
            line: link.line,
            column,
            text: excerpt(line),
        });
        any = true;
    }
    if any {
        found.files += 1;
    }
}

/// Every link under `roots` that leads to `target`. `open` is the text of the documents that are
/// open with unsaved edits, by the file they are showing; it is read instead of the file.
pub(crate) fn find(
    roots: &[PathBuf],
    index: Option<&WorkspaceIndex>,
    target: &Path,
    ignore_case: bool,
    open: &[(PathBuf, String)],
) -> Result<Found, AppError> {
    let wanted =
        Wanted::of(target).ok_or_else(|| AppError::Invalid("a file needs a full path".into()))?;
    let held: HashMap<String, &str> = open
        .iter()
        .filter_map(|(path, text)| place_key(path, ignore_case).map(|key| (key, text.as_str())))
        .collect();
    let mut found = Found::default();
    let mut seen: HashSet<String> = HashSet::new();
    for root in roots {
        if found.truncated {
            break;
        }
        walk_indexed(
            index,
            root,
            Scope::Markdown,
            || false,
            |_| false,
            |path| {
                let Some(key) = place_key(path, ignore_case) else {
                    return true;
                };
                // Roots can lie inside one another; a file is read once.
                if !seen.insert(key.clone()) {
                    return true;
                }
                if let Some(text) = held.get(&key) {
                    found.scanned += 1;
                    let links = scan::scan(text);
                    let hits = wanted.linked_from(path, &links, ignore_case);
                    add(&mut found, path, text, &hits);
                    return !found.truncated;
                }
                let bytes = match read_unless_binary(path) {
                    Ok(Some(bytes)) => bytes,
                    Ok(None) => return true,
                    Err(error) => {
                        found.skipped.push(Problem {
                            path: display_path(path),
                            reason: friendly_io(&error),
                        });
                        return true;
                    }
                };
                match scan_bytes(&bytes) {
                    Scan::Binary => {}
                    Scan::Encoding => found.skipped.push(Problem {
                        path: display_path(path),
                        reason: "its encoding is not one mdmate writes".into(),
                    }),
                    Scan::Links { links, .. } => {
                        found.scanned += 1;
                        let hits = wanted.linked_from(path, &links, ignore_case);
                        // The text is decoded again only for a file that has something to show.
                        if !hits.is_empty()
                            && let Decoded::Text { text, .. } = encoding::decode(&bytes)
                        {
                            add(&mut found, path, &text, &hits);
                        }
                    }
                }
                !found.truncated
            },
        );
    }
    // By file name. The sort is stable and each file's links come in the order they are written,
    // so the links of one file stay in line order.
    found
        .references
        .sort_by_cached_key(|reference| reference.path.to_lowercase());
    Ok(found)
}

/// Finds the links to `path` under the open folders the file lies in, the same ones a rename reads;
/// for a file no folder holds (opened on its own), under all of them. `buffers` are the open
/// documents with edits not yet saved.
pub(crate) fn find_for(
    state: &AppState,
    path: &Path,
    buffers: &[Buffer],
) -> Result<Found, AppError> {
    let target = state.access().check(path)?;
    let roots = {
        let access = state.access();
        let held = access.roots_containing(&target);
        if held.is_empty() {
            access
                .roots()
                .iter()
                .map(|root| root.path.clone())
                .collect()
        } else {
            held
        }
    };
    let open: Vec<(PathBuf, String)> = buffers
        .iter()
        .filter_map(|buffer| {
            let entry_path = state
                .documents()
                .get(buffer.id)
                .map(|entry| entry.path.clone())?;
            Some((entry_path, buffer.text.clone()))
        })
        .collect();
    find(
        &roots,
        Some(state.index()),
        &target.path,
        state.ignore_case(),
        &open,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn put(root: &Path, name: &str, bytes: &[u8]) {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("a folder can be made");
        }
        fs::write(path, bytes).expect("a file can be written");
    }

    /// `file:line:column` for each reference, with the root cut off the path.
    fn listed(root: &Path, found: &Found) -> Vec<String> {
        let prefix = format!("{}/", display_path(root).replace('\\', "/"));
        found
            .references
            .iter()
            .map(|r| {
                let path = r.path.replace('\\', "/");
                let relative = path.strip_prefix(&prefix).unwrap_or(&path);
                format!("{relative}:{}", r.line)
            })
            .collect()
    }

    fn workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "docs/target.md", b"# target\n\nme [me](target.md)\n");
        put(
            root,
            "index.md",
            b"# Index\n\
              [a](docs/target.md)\n\
              ![i](docs/target.md#top)\n\
              [ref]: docs/target.md \"T\"\n\
              <a href=\"docs/target.md\">x</a>\n\
              [angle](<docs/target.md>)\n\
              [pct](docs/tar%67et.md)\n\
              [other](docs/other.md)\n\
              `[code](docs/target.md)`\n\
              [web](https://example.com/docs/target.md)\n",
        );
        put(
            root,
            "docs/sub/deep.md",
            b"[up](../target.md)\n[dot](./../target.md)\n[sibling](../other.md)\n",
        );
        put(root, "docs/notes.txt", b"see [t](target.md)\n");
        put(root, ".git/config.md", b"[a](../docs/target.md)\n");
        put(root, "bin.dat", b"\x00\x01[a](docs/target.md)\n");
        put(root, "latin.md", b"caf\xE9 [a](docs/target.md)\n");
        dir
    }

    #[test]
    fn references_every_form_in_the_fixture_workspace() {
        let dir = workspace();
        let root = dir.path();
        let found = find(
            &[root.to_path_buf()],
            None,
            &root.join("docs/target.md"),
            true,
            &[],
        )
        .expect("a search runs");
        // Written by hand, from the fixture above: one entry per link that leads to the file.
        assert_eq!(
            listed(root, &found),
            [
                "docs/sub/deep.md:1",
                "docs/sub/deep.md:2",
                "docs/target.md:3",
                "index.md:2",
                "index.md:3",
                "index.md:4",
                "index.md:5",
                "index.md:6",
                "index.md:7",
            ]
        );
        // notes.txt and bin.dat are not Markdown, so they are never read.
        assert_eq!(found.files, 3); // deep.md, target.md itself, index.md
        assert!(!found.truncated);
        // The Latin-1 file could not be checked, and says so; the binary file is just not text.
        assert_eq!(found.skipped.len(), 1, "{:?}", found.skipped);
        assert!(found.skipped[0].path.ends_with("latin.md"));
    }

    #[test]
    fn references_match_what_a_rename_would_rewrite() {
        let dir = workspace();
        let root = dir.path();
        let target = root.join("docs/target.md");
        let found = find(&[root.to_path_buf()], None, &target, true, &[]).expect("a search runs");
        let plan = super::super::rewrite::plan(
            &[root.to_path_buf()],
            None,
            &super::super::rewrite::Move {
                from: target.clone(),
                to: root.join("docs/renamed.md"),
            },
            true,
            |_| true,
        )
        .expect("a plan is made");
        // Every link the rename would change is a reference, and the other way round (the self
        // link in the moved file is rewritten too, since the name it points at changes).
        let mut renamed: Vec<String> = plan
            .files
            .iter()
            .flat_map(|file| {
                let prefix = format!("{}/", display_path(root).replace('\\', "/"));
                let path = display_path(&file.before).replace('\\', "/");
                let relative = path.strip_prefix(&prefix).unwrap_or(&path).to_owned();
                file.edits
                    .iter()
                    .map(move |edit| format!("{relative}:{}", edit.line))
            })
            .collect();
        renamed.sort();
        let mut references = listed(root, &found);
        references.sort();
        assert_eq!(references, renamed);
    }

    #[test]
    fn references_use_the_text_of_an_open_document_instead_of_its_file() {
        let dir = workspace();
        let root = dir.path();
        let open = [(
            root.join("index.md"),
            "no links here\n\n\n[typed](docs/target.md)\n".to_owned(),
        )];
        let found = find(
            &[root.to_path_buf()],
            None,
            &root.join("docs/target.md"),
            true,
            &open,
        )
        .expect("a search runs");
        let from_index: Vec<String> = listed(root, &found)
            .into_iter()
            .filter(|entry| entry.starts_with("index.md"))
            .collect();
        assert_eq!(from_index, ["index.md:4"]);
    }

    #[test]
    fn references_show_the_last_line_of_a_file_that_has_no_final_newline() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "t.md", b"x\n");
        put(root, "a.md", b"first\nlast [y](t.md)");
        let found = find(&[root.to_path_buf()], None, &root.join("t.md"), true, &[]).expect("runs");
        assert_eq!(found.references.len(), 1);
        assert_eq!(found.references[0].line, 2);
        assert_eq!(found.references[0].text, "last [y](t.md)");
    }

    #[test]
    fn references_are_ordered_by_file_name_ignoring_case() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "t.md", b"x\n");
        put(root, "B.md", b"[y](t.md)\n");
        put(root, "a.md", b"[y](t.md)\n");
        put(root, "C.md", b"[y](t.md)\n");
        let found = find(&[root.to_path_buf()], None, &root.join("t.md"), true, &[]).expect("runs");
        assert_eq!(listed(root, &found), ["a.md:1", "B.md:1", "C.md:1"]);
    }

    #[test]
    fn references_report_the_column_in_utf16_units_and_the_line() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "t.md", b"x\n");
        put(
            root,
            "a.md",
            "  \u{1F600} é [x](t.md) and more\r\nplain [y](t.md)\r\n".as_bytes(),
        );
        let found = find(&[root.to_path_buf()], None, &root.join("t.md"), true, &[]).expect("runs");
        let columns: Vec<(usize, usize)> = found
            .references
            .iter()
            .map(|r| (r.line, r.column))
            .collect();
        // "  😀 é [x](" is 2 + 2 (one astral character) + 1 + 1 (é) + 1 + 4 = 11 units; "plain [y](" is 10.
        assert_eq!(columns, [(1, 11), (2, 10)]);
        assert_eq!(found.references[0].text, "\u{1F600} é [x](t.md) and more");
    }

    #[test]
    fn references_ignore_case_only_where_the_file_system_does() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "Target.md", b"x\n");
        put(root, "a.md", b"[x](TARGET.md)\n");
        let target = root.join("Target.md");
        let folded = find(&[root.to_path_buf()], None, &target, true, &[]).expect("runs");
        let exact = find(&[root.to_path_buf()], None, &target, false, &[]).expect("runs");
        assert_eq!(folded.references.len(), 1);
        assert_eq!(exact.references.len(), 0);
    }

    #[test]
    fn references_are_cut_at_the_limit_and_say_so() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "t.md", b"x\n");
        let many = "[x](t.md)\n".repeat(MAX_REFERENCES + 5);
        put(root, "a.md", many.as_bytes());
        let found = find(&[root.to_path_buf()], None, &root.join("t.md"), true, &[]).expect("runs");
        assert_eq!(found.references.len(), MAX_REFERENCES);
        assert!(found.truncated);
    }

    #[test]
    fn references_read_a_file_once_when_roots_lie_inside_each_other() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "t.md", b"x\n");
        put(root, "sub/a.md", b"[x](../t.md)\n");
        let found = find(
            &[root.to_path_buf(), root.join("sub")],
            None,
            &root.join("t.md"),
            true,
            &[],
        )
        .expect("runs");
        assert_eq!(found.references.len(), 1);
        assert_eq!(found.scanned, 2);
    }

    #[test]
    fn references_need_a_full_path() {
        let error = find(&[], None, Path::new("relative.md"), true, &[]).expect_err("refused");
        assert_eq!(error.kind(), "invalid");
    }
    // ---- Phase 7.1: the file list comes from the index

    fn indexed(root: &Path) -> WorkspaceIndex {
        let index = WorkspaceIndex::new(true).without_watcher();
        index.add_root_now(root);
        index
    }

    fn sorted(root: &Path, found: &Found) -> Vec<String> {
        let mut list = listed(root, found);
        list.sort();
        list
    }

    #[test]
    fn the_index_gives_the_references_a_walk_gives() {
        let dir = workspace();
        let root = dir.path();
        let index = indexed(root);
        let target = root.join("docs/target.md");
        let walked = find(&[root.to_path_buf()], None, &target, true, &[]).expect("a walk");
        let through = find(&[root.to_path_buf()], Some(&index), &target, true, &[]).expect("index");
        assert_eq!(sorted(root, &through), sorted(root, &walked));
        assert!(!through.references.is_empty());
        assert_eq!(
            (
                through.files,
                through.scanned,
                through.skipped.len(),
                through.truncated
            ),
            (
                walked.files,
                walked.scanned,
                walked.skipped.len(),
                walked.truncated
            )
        );
    }

    #[test]
    fn a_search_through_the_index_reads_the_list_and_a_walk_reads_the_disk() {
        let dir = workspace();
        let root = dir.path();
        let index = indexed(root);
        let target = root.join("docs/target.md");
        let before = find(&[root.to_path_buf()], Some(&index), &target, true, &[]).expect("runs");
        // A file made by another program that the index has not heard of yet.
        put(root, "late.md", b"[t](docs/target.md)\n");
        let held = find(&[root.to_path_buf()], Some(&index), &target, true, &[]).expect("runs");
        assert_eq!(held.references.len(), before.references.len());
        index.changed(&root.join("late.md"));
        let told = find(&[root.to_path_buf()], Some(&index), &target, true, &[]).expect("runs");
        assert_eq!(told.references.len(), before.references.len() + 1);
        let walked = find(&[root.to_path_buf()], None, &target, true, &[]).expect("runs");
        assert_eq!(sorted(root, &walked), sorted(root, &told));
    }

    #[test]
    fn a_root_the_index_has_not_read_yet_or_has_cut_is_walked() {
        let dir = workspace();
        let root = dir.path();
        let target = root.join("docs/target.md");
        let walked = find(&[root.to_path_buf()], None, &target, true, &[]).expect("a walk");

        let unread = WorkspaceIndex::new(true).without_watcher();
        unread.register_only(root);
        let through = find(&[root.to_path_buf()], Some(&unread), &target, true, &[]).expect("runs");
        assert_eq!(sorted(root, &through), sorted(root, &walked));

        let cut = WorkspaceIndex::new(true).without_watcher();
        cut.set_cap(2);
        cut.add_root_now(root);
        let through = find(&[root.to_path_buf()], Some(&cut), &target, true, &[]).expect("runs");
        assert_eq!(sorted(root, &through), sorted(root, &walked));
        assert!(!through.references.is_empty());
    }

    #[test]
    fn references_are_looked_for_in_the_workspace_the_file_is_in() {
        use crate::platform::Platform as _;
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let base = fs::canonicalize(dir.path()).expect("canonical");
        let (a, b) = (base.join("a"), base.join("b"));
        put(&a, "t.md", b"# t\n");
        put(&a, "x.md", b"[t](t.md)\n");
        put(&b, "y.md", b"[t](../a/t.md)\n");
        put(&base, "c/o.md", b"# o\n");
        put(&a, "p.md", b"[o](../c/o.md)\n");
        put(&b, "q.md", b"[o](../c/o.md)\n");
        let state = AppState::new(crate::platform::current().paths_ignore_case());
        state.access().grant_root(&a).expect("granted");
        state.access().grant_root(&b).expect("granted");

        // A file in the first workspace: only that workspace's links.
        let found = find_for(&state, &a.join("t.md"), &[]).expect("found");
        assert_eq!(found.references.len(), 1, "{found:?}");
        assert!(found.references[0].path.ends_with("x.md"));

        // A file no workspace holds is looked for in all of them.
        state
            .access()
            .grant_file(&base.join("c/o.md"))
            .expect("granted");
        let found = find_for(&state, &base.join("c/o.md"), &[]).expect("found");
        assert_eq!(found.references.len(), 2, "{found:?}");
    }

    #[test]
    fn roots_inside_one_another_read_each_file_once_through_the_index() {
        let dir = workspace();
        let root = dir.path();
        let inner = root.join("docs");
        let index = WorkspaceIndex::new(true).without_watcher();
        index.add_root_now(root);
        index.add_root_now(&inner);
        let target = root.join("docs/target.md");
        let both = [root.to_path_buf(), inner];
        let walked = find(&both, None, &target, true, &[]).expect("a walk");
        let through = find(&both, Some(&index), &target, true, &[]).expect("index");
        assert_eq!(sorted(root, &through), sorted(root, &walked));
        assert_eq!(through.scanned, walked.scanned);
    }
}
