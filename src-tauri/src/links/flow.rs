//! The rewrite as the app runs it, in two calls around a rename or move.
//!
//! [`plan`] runs first, before anything has moved: it checks the rename the way the move itself
//! will, reads the workspace for the links that would change and keeps what it found under a
//! token. The page shows the counts and asks. [`finish`] then does the move and the rewrite in
//! one go, so no other change can come between them, and says what the page has to do for the
//! documents that are open.
//!
//! An open document is never written here. One with unsaved edits is rescanned from the text the
//! page sends, and the answer is a list of edits for the editor, which keeps them undoable. One
//! without is written like any closed file and the page reloads it.

use super::rewrite::{self, BufferEdit, Move, Plan};
use crate::access::{Resolved, display_path};
use crate::documents::AppState;
use crate::error::AppError;
use crate::workspace::ops::{self, Moved};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

/// What the user asked for.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Change {
    Rename { name: String },
    Move { into: String },
}

/// The text of an open document, as the editor holds it now.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Buffer {
    pub(crate) id: u32,
    pub(crate) text: String,
}

/// A file the scan could not use, and why.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Problem {
    pub(crate) path: String,
    pub(crate) reason: String,
}

/// What a plan found, for the question the page asks.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Planned {
    /// Names this plan in [`finish`]. Zero when there is nothing to do.
    pub(crate) token: u64,
    pub(crate) links: usize,
    pub(crate) files: usize,
    /// Text files read.
    pub(crate) scanned: usize,
    /// Files left out as binary.
    pub(crate) binary: usize,
    /// Files that could not be read or that mdmate does not write.
    pub(crate) skipped: Vec<Problem>,
    /// Links that cannot be written relative, which stay as they are.
    pub(crate) unrelatable: usize,
    /// The user stopped the scan; nothing was kept.
    pub(crate) cancelled: bool,
    /// The open documents whose text was counted here instead of the file's.
    pub(crate) buffers: Vec<u32>,
}

/// A plan kept until the page answers.
#[derive(Debug)]
pub(crate) struct Pending {
    token: u64,
    source: Resolved,
    target: PathBuf,
    plan: Plan,
}

/// The edits one open document needs.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct DocumentEdits {
    pub(crate) id: u32,
    pub(crate) changes: Vec<Change16>,
}

/// One change to the text, in UTF-16 units.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Change16 {
    pub(crate) from: usize,
    pub(crate) to: usize,
    pub(crate) insert: String,
}

/// What the rewrite did.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Done {
    pub(crate) moved: Moved,
    /// Files written, as people read the paths.
    pub(crate) written: Vec<String>,
    /// Files that could not be written, with the reason. Each is left as it was.
    pub(crate) failed: Vec<Problem>,
    /// Open documents without edits whose file was written: the page reloads them.
    pub(crate) reload: Vec<u32>,
    /// Open documents the page was holding edits in: the page applies these to the text.
    pub(crate) edits: Vec<DocumentEdits>,
    pub(crate) unrelatable: usize,
}

/// An open document and the edits its text needs.
struct Held {
    key: String,
    id: u32,
    edits: Vec<BufferEdit>,
    unrelatable: usize,
}

fn problem(path: &Path, reason: &str) -> Problem {
    Problem {
        path: display_path(path),
        reason: reason.to_owned(),
    }
}

/// Scans the texts of open documents for the links a move changes. Call it before the move: the
/// path a document has now is the one its links are read from.
fn hold(state: &AppState, buffers: &[Buffer], mv: &Move) -> Result<Vec<Held>, AppError> {
    let mut held = Vec::new();
    for buffer in buffers {
        let path = match state.documents().get(buffer.id) {
            Some(entry) => entry.path.clone(),
            None => continue,
        };
        let (edits, unrelatable) =
            rewrite::buffer_edits(&path, &buffer.text, mv, state.ignore_case())?;
        held.push(Held {
            key: state.spelling_key(&path),
            id: buffer.id,
            edits,
            unrelatable,
        });
    }
    Ok(held)
}

/// Takes the files of the held documents out of a plan, so none of them is written to disk.
fn leave_out(plan: &mut Plan, state: &AppState, held: &[Held]) {
    let keys: HashSet<&str> = held.iter().map(|doc| doc.key.as_str()).collect();
    plan.files
        .retain(|file| !keys.contains(state.spelling_key(&file.before).as_str()));
}

/// The file or folder a change would move, and where to. None when it would change nothing (the
/// same name, the same folder). Refuses a change the move itself would refuse.
fn target_of(
    state: &AppState,
    path: &Path,
    change: &Change,
) -> Result<Option<(Resolved, PathBuf)>, AppError> {
    match change {
        Change::Rename { name } => ops::rename_target(state, path, name),
        Change::Move { into } => ops::move_target(state, path, Path::new(into)),
    }
}

/// Checks a change the way the move itself will, without reading the workspace: true when
/// something would move. Refuses as [`plan`] does, so the page can ask whether to look for links
/// only after it knows the change can be done.
pub(crate) fn check(state: &AppState, path: &Path, change: &Change) -> Result<bool, AppError> {
    Ok(target_of(state, path, change)?.is_some())
}

/// Checks the change, reads the workspace the file is in for the links it would break, and keeps
/// the answer.
/// `progress` hears how many files were read so far. Nothing on disk changes.
pub(crate) fn plan(
    state: &AppState,
    path: &Path,
    change: &Change,
    buffers: &[Buffer],
    mut progress: impl FnMut(usize),
) -> Result<Planned, AppError> {
    let Some((source, target)) = target_of(state, path, change)? else {
        return Ok(Planned::default());
    };
    // Only the workspaces the file lies in: another root is another project, and reading it would
    // cost time for links that are not to this file. Roots that hold the file together (one inside
    // the other) are all read.
    let roots = state.access().roots_containing(&source);
    let mv = Move {
        from: source.path.clone(),
        to: target.clone(),
    };
    state.rewrite_stop().store(false, Ordering::Relaxed);
    let mut read = 0;
    let mut plan = rewrite::plan(
        &roots,
        Some(state.index()),
        &mv,
        state.ignore_case(),
        |_| {
            read += 1;
            progress(read);
            !state.rewrite_stop().load(Ordering::Relaxed)
        },
    )?;
    if state.rewrite_stop().load(Ordering::Relaxed) {
        *state.rewrite_slot() = None;
        return Ok(Planned {
            cancelled: true,
            ..Planned::default()
        });
    }
    let held = hold(state, buffers, &mv)?;
    leave_out(&mut plan, state, &held);
    let links = plan.links() + held.iter().map(|doc| doc.edits.len()).sum::<usize>();
    let files = plan.files.len() + held.iter().filter(|doc| !doc.edits.is_empty()).count();
    let planned = Planned {
        token: state.next_token(),
        links,
        files,
        scanned: plan.scanned,
        binary: plan.binary,
        skipped: plan
            .skipped
            .iter()
            .map(|skipped| problem(&skipped.path, &skipped.reason))
            .collect(),
        unrelatable: plan.unrelatable + held.iter().map(|doc| doc.unrelatable).sum::<usize>(),
        cancelled: false,
        buffers: held.iter().map(|doc| doc.id).collect(),
    };
    *state.rewrite_slot() = Some(Pending {
        token: planned.token,
        source,
        target,
        plan,
    });
    Ok(planned)
}

/// Does the move the plan named and rewrites the links. `buffers` are the open documents the page
/// is holding edits in now, which may be more than when the plan was made, and fewer: every
/// document in `Planned::buffers` must be among them, since the plan left it out.
pub(crate) fn finish(state: &AppState, token: u64, buffers: &[Buffer]) -> Result<Done, AppError> {
    let pending = {
        let mut slot = state.rewrite_slot();
        // A plan is taken only by its own token: a stale call must not throw away the current one.
        if slot.as_ref().is_none_or(|pending| pending.token != token) {
            return Err(AppError::Invalid(
                "the plan is out of date: start the rename again".into(),
            ));
        }
        slot.take()
            .ok_or_else(|| AppError::Invalid("the plan is gone".into()))?
    };
    let mv = Move {
        from: pending.source.path.clone(),
        to: pending.target.clone(),
    };
    // Read the open documents where they are now; the move changes their paths.
    let held = hold(state, buffers, &mv)?;
    let mut plan = pending.plan;
    leave_out(&mut plan, state, &held);

    let moved = ops::carry_out(state, &pending.source, &pending.target)?;
    let report = rewrite::apply(&plan);

    let written: HashSet<String> = report
        .written
        .iter()
        .map(|path| state.spelling_key(path))
        .collect();
    let reload = state
        .documents()
        .entries()
        .filter(|(_, entry)| written.contains(&state.spelling_key(&entry.path)))
        .map(|(id, _)| id)
        .collect();
    let unrelatable = plan.unrelatable + held.iter().map(|doc| doc.unrelatable).sum::<usize>();
    Ok(Done {
        moved,
        written: report
            .written
            .iter()
            .map(|path| display_path(path))
            .collect(),
        failed: report
            .failed
            .iter()
            .map(|failure| problem(&failure.path, &failure.reason))
            .collect(),
        reload,
        edits: held
            .into_iter()
            .filter(|doc| !doc.edits.is_empty())
            .map(|doc| DocumentEdits {
                id: doc.id,
                changes: doc
                    .edits
                    .into_iter()
                    .map(|edit| Change16 {
                        from: edit.from,
                        to: edit.to,
                        insert: edit.insert,
                    })
                    .collect(),
            })
            .collect(),
        unrelatable,
    })
}

/// Drops a plan the page will not use.
pub(crate) fn discard(state: &AppState, token: u64) {
    let mut slot = state.rewrite_slot();
    if slot.as_ref().is_some_and(|pending| pending.token == token) {
        *slot = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::open_document;
    use crate::platform::{self, Platform as _};
    use std::fs;

    struct Workspace {
        _dir: tempfile::TempDir,
        root: PathBuf,
        state: AppState,
    }

    fn workspace() -> Workspace {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = fs::canonicalize(dir.path())
            .expect("canonical")
            .join("root");
        fs::create_dir_all(&root).expect("root");
        let state = AppState::new(platform::current().paths_ignore_case());
        state.access().grant_root(&root).expect("granted");
        Workspace {
            _dir: dir,
            root,
            state,
        }
    }

    fn put(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent");
        }
        fs::write(path, text).expect("written");
    }

    fn rename(name: &str) -> Change {
        Change::Rename { name: name.into() }
    }

    fn id_of(state: &AppState, path: &Path) -> u32 {
        let key = state.spelling_key(path);
        state
            .documents()
            .entries()
            .find(|(_, entry)| state.spelling_key(&entry.path) == key)
            .map(|(id, _)| id)
            .expect("the document is open")
    }

    fn plan_of(w: &Workspace, path: &Path, change: &Change, buffers: &[Buffer]) -> Planned {
        plan(&w.state, path, change, buffers, |_| {}).expect("planned")
    }

    #[test]
    fn rewrite_flow_plans_without_changing_anything_and_then_moves_and_rewrites() {
        let w = workspace();
        let old = w.root.join("old.md");
        put(&old, "# old\n");
        put(&w.root.join("a.md"), "[x](old.md) and [y](old.md#h)\n");
        put(&w.root.join("sub/b.md"), "![i](../old.md)\n");
        put(&w.root.join("none.md"), "nothing\n");

        let planned = plan_of(&w, &old, &rename("new.md"), &[]);
        assert_eq!((planned.links, planned.files), (3, 2));
        assert_ne!(planned.token, 0);
        assert!(!planned.cancelled);
        // The question comes first: nothing moved or changed.
        assert!(old.exists());
        assert_eq!(
            fs::read_to_string(w.root.join("a.md")).expect("read"),
            "[x](old.md) and [y](old.md#h)\n"
        );

        let done = finish(&w.state, planned.token, &[]).expect("done");
        assert!(!old.exists());
        assert!(w.root.join("new.md").exists());
        assert_eq!(done.failed, []);
        assert_eq!(
            fs::read_to_string(w.root.join("a.md")).expect("read"),
            "[x](new.md) and [y](new.md#h)\n"
        );
        assert_eq!(
            fs::read_to_string(w.root.join("sub/b.md")).expect("read"),
            "![i](../new.md)\n"
        );
        assert_eq!(done.written.len(), 2);
    }

    #[test]
    fn renaming_one_of_two_files_with_the_same_name_leaves_the_links_to_the_other_alone() {
        let w = workspace();
        put(
            &w.root.join("A/a.md"),
            "# A
[self](a.md) [other](../B/a.md)
",
        );
        put(
            &w.root.join("B/a.md"),
            "# B
[self](a.md) [other](../A/a.md)
",
        );
        put(
            &w.root.join("index.md"),
            "[a](A/a.md) [b](B/a.md) [a2](./A/a.md#x) [b2](./B/a.md#x)
",
        );

        let planned = plan_of(&w, &w.root.join("A/a.md"), &rename("b.md"), &[]);
        let done = finish(&w.state, planned.token, &[]).expect("done");
        assert_eq!(done.failed, []);
        assert_eq!(
            fs::read_to_string(w.root.join("index.md")).expect("read"),
            "[a](A/b.md) [b](B/a.md) [a2](./A/b.md#x) [b2](./B/a.md#x)
"
        );
        // The renamed file keeps pointing at itself and at the other one.
        assert_eq!(
            fs::read_to_string(w.root.join("A/b.md")).expect("read"),
            "# A
[self](b.md) [other](../B/a.md)
"
        );
        // The other file points at the renamed one by its new name, and at itself as before.
        assert_eq!(
            fs::read_to_string(w.root.join("B/a.md")).expect("read"),
            "# B
[self](a.md) [other](../A/b.md)
"
        );
    }

    #[test]
    fn a_plan_with_nothing_to_do_has_no_token_and_a_name_that_is_taken_is_refused_first() {
        let w = workspace();
        put(&w.root.join("a.md"), "x\n");
        put(&w.root.join("b.md"), "y\n");
        assert_eq!(
            plan_of(&w, &w.root.join("a.md"), &rename("a.md"), &[]),
            Planned::default()
        );
        let refused = plan(&w.state, &w.root.join("a.md"), &rename("b.md"), &[], |_| {});
        assert_eq!(refused.expect_err("taken").kind(), "exists");
        let bad = plan(&w.state, &w.root.join("a.md"), &rename("a/b"), &[], |_| {});
        assert_eq!(bad.expect_err("bad name").kind(), "invalid");
        // Nothing was kept for a plan that did not happen.
        assert!(w.state.rewrite_slot().is_none());
    }

    #[test]
    fn a_check_says_whether_anything_would_move_and_reads_no_file_for_links() {
        let w = workspace();
        put(&w.root.join("a.md"), "x\n");
        put(&w.root.join("b.md"), "y\n");
        put(&w.root.join("sub/c.md"), "[a](../a.md)\n");
        let a = w.root.join("a.md");
        assert!(check(&w.state, &a, &rename("new.md")).expect("checked"));
        // The same name or the same folder changes nothing.
        assert!(!check(&w.state, &a, &rename("a.md")).expect("checked"));
        let same = Change::Move {
            into: w.root.display().to_string(),
        };
        assert!(!check(&w.state, &a, &same).expect("checked"));
        let into = Change::Move {
            into: w.root.join("sub").display().to_string(),
        };
        assert!(check(&w.state, &a, &into).expect("checked"));
        // A check keeps nothing and changes nothing.
        assert!(w.state.rewrite_slot().is_none());
        assert!(a.exists());
    }

    #[test]
    fn a_check_refuses_what_the_move_would_refuse() {
        let w = workspace();
        put(&w.root.join("a.md"), "x\n");
        put(&w.root.join("b.md"), "y\n");
        let a = w.root.join("a.md");
        assert_eq!(
            check(&w.state, &a, &rename("b.md"))
                .expect_err("taken")
                .kind(),
            "exists"
        );
        assert_eq!(
            check(&w.state, &a, &rename("x/y")).expect_err("bad").kind(),
            "invalid"
        );
        let outside = tempfile::tempdir().expect("outside");
        let stray = outside.path().join("o.md");
        put(&stray, "o\n");
        assert!(check(&w.state, &stray, &rename("p.md")).is_err());
    }

    /// A second workspace root next to the first, with its own files.
    fn other_root(w: &Workspace) -> PathBuf {
        let other = w
            .root
            .parent()
            .expect("the root has a parent")
            .join("other");
        fs::create_dir_all(&other).expect("other root");
        w.state.access().grant_root(&other).expect("granted");
        other
    }

    #[test]
    fn a_plan_reads_only_the_workspace_the_file_is_in() {
        let w = workspace();
        let other = other_root(&w);
        put(&w.root.join("old.md"), "# old\n");
        put(&w.root.join("a.md"), "[x](old.md)\n");
        // A link from the other workspace, written so that it does reach the file.
        put(&other.join("b.md"), "[x](../root/old.md)\n");
        put(&other.join("c.md"), "[x](old.md)\n");

        let planned = plan_of(&w, &w.root.join("old.md"), &rename("new.md"), &[]);
        assert_eq!((planned.links, planned.files), (1, 1));
        // old.md and a.md: nothing in the other root was read.
        assert_eq!(planned.scanned, 2);
        finish(&w.state, planned.token, &[]).expect("done");
        assert_eq!(
            fs::read_to_string(w.root.join("a.md")).expect("a"),
            "[x](new.md)\n"
        );
        assert_eq!(
            fs::read_to_string(other.join("b.md")).expect("b"),
            "[x](../root/old.md)\n"
        );
    }

    #[test]
    fn a_plan_reads_every_root_that_holds_the_file_when_roots_lie_inside_each_other() {
        let w = workspace();
        let inner = w.root.join("inner");
        fs::create_dir_all(&inner).expect("inner");
        w.state.access().grant_root(&inner).expect("granted");
        put(&inner.join("x.md"), "# x\n");
        put(&w.root.join("top.md"), "[x](inner/x.md)\n");
        put(&inner.join("near.md"), "[x](x.md)\n");

        let planned = plan_of(&w, &inner.join("x.md"), &rename("y.md"), &[]);
        // The link from the outer root is found, and each file is read once.
        assert_eq!((planned.links, planned.files), (2, 2));
        assert_eq!(planned.scanned, 3);
    }

    #[test]
    fn a_plan_is_used_once_and_only_by_its_own_token() {
        let w = workspace();
        put(&w.root.join("old.md"), "x\n");
        put(&w.root.join("a.md"), "[x](old.md)\n");
        let first = plan_of(&w, &w.root.join("old.md"), &rename("new.md"), &[]);
        let second = plan_of(&w, &w.root.join("old.md"), &rename("newer.md"), &[]);
        assert_ne!(first.token, second.token);
        let stale = finish(&w.state, first.token, &[]).expect_err("replaced by the second plan");
        assert_eq!(stale.kind(), "invalid");
        assert!(w.root.join("old.md").exists());
        // A wrong token must not throw the right plan away.
        finish(&w.state, second.token, &[]).expect("the second plan is still kept");
        assert!(w.root.join("newer.md").exists());
        let again = finish(&w.state, second.token, &[]).expect_err("used once");
        assert_eq!(again.kind(), "invalid");
    }

    #[test]
    fn rewrite_cancel_stops_the_scan_and_keeps_nothing() {
        let w = workspace();
        put(&w.root.join("old.md"), "x\n");
        for n in 0..20 {
            put(&w.root.join(format!("f{n}.md")), "[x](old.md)\n");
        }
        let mut reads = 0;
        let planned = plan(
            &w.state,
            &w.root.join("old.md"),
            &rename("new.md"),
            &[],
            |read| {
                reads = read;
                if read == 3 {
                    w.state
                        .rewrite_stop()
                        .store(true, std::sync::atomic::Ordering::Relaxed);
                }
            },
        )
        .expect("answered");
        assert!(planned.cancelled);
        assert_eq!(planned.token, 0);
        assert!(reads < 20, "{reads} files were read after the stop");
        assert!(w.state.rewrite_slot().is_none());
        assert!(w.root.join("old.md").exists());
    }

    #[test]
    fn rewrite_dirty_open_documents_are_edited_in_the_editor_and_never_on_disk() {
        let w = workspace();
        let old = w.root.join("old.md");
        let page = w.root.join("page.md");
        put(&old, "x\n");
        put(&page, "disk text [a](old.md)\n");
        open_document(&w.state, &page).expect("opened");
        let id = id_of(&w.state, &page);
        // The buffer differs from the disk: an accent and an emoji (two UTF-16 units) come first.
        let text = "é😀 buffer [a](old.md)\n";
        let buffer = Buffer {
            id,
            text: text.into(),
        };

        let planned = plan_of(&w, &old, &rename("new.md"), std::slice::from_ref(&buffer));
        assert_eq!((planned.links, planned.files), (1, 1));
        assert_eq!(planned.buffers, [id]);

        let done = finish(&w.state, planned.token, &[buffer]).expect("done");
        assert_eq!(done.written, Vec::<String>::new());
        assert_eq!(done.reload, Vec::<u32>::new());
        assert_eq!(
            fs::read_to_string(&page).expect("read"),
            "disk text [a](old.md)\n",
            "the file of a document with unsaved edits is not touched"
        );
        let units: Vec<u16> = text.encode_utf16().collect();
        let [one] = done.edits.as_slice() else {
            panic!("{:?}", done.edits)
        };
        assert_eq!(one.id, id);
        let [change] = one.changes.as_slice() else {
            panic!("{:?}", one.changes)
        };
        assert_eq!(
            String::from_utf16(&units[change.from..change.to]).expect("utf16"),
            "old.md"
        );
        assert_eq!(change.insert, "new.md");
    }

    #[test]
    fn rewrite_clean_open_documents_are_written_and_named_for_reload() {
        let w = workspace();
        let old = w.root.join("old.md");
        let page = w.root.join("page.md");
        put(&old, "x\n");
        put(&page, "[a](old.md)\n");
        open_document(&w.state, &page).expect("opened");
        let id = id_of(&w.state, &page);
        let planned = plan_of(&w, &old, &rename("new.md"), &[]);
        let done = finish(&w.state, planned.token, &[]).expect("done");
        assert_eq!(fs::read_to_string(&page).expect("read"), "[a](new.md)\n");
        assert_eq!(done.reload, [id]);
        assert_eq!(done.edits, []);
    }

    #[test]
    fn a_document_that_became_dirty_after_the_plan_is_not_written_to_disk() {
        let w = workspace();
        let old = w.root.join("old.md");
        let page = w.root.join("page.md");
        put(&old, "x\n");
        put(&page, "[a](old.md)\n");
        open_document(&w.state, &page).expect("opened");
        let id = id_of(&w.state, &page);
        let planned = plan_of(&w, &old, &rename("new.md"), &[]);
        assert_eq!(planned.buffers, Vec::<u32>::new());
        // The user typed while the question was open; the page sends the text it holds now.
        let typed = Buffer {
            id,
            text: "typed [a](old.md)\n".into(),
        };
        let done = finish(&w.state, planned.token, &[typed]).expect("done");
        assert_eq!(fs::read_to_string(&page).expect("read"), "[a](old.md)\n");
        assert_eq!(done.written, Vec::<String>::new());
        assert_eq!(done.reload, Vec::<u32>::new());
        assert_eq!(done.edits.len(), 1);
    }

    #[test]
    fn a_dirty_document_that_moves_with_a_folder_is_read_from_where_it_was() {
        let w = workspace();
        put(&w.root.join("top.md"), "t\n");
        let page = w.root.join("dir/page.md");
        put(&page, "disk\n");
        fs::create_dir_all(w.root.join("deep")).expect("target folder");
        open_document(&w.state, &page).expect("opened");
        let id = id_of(&w.state, &page);
        let buffer = Buffer {
            id,
            text: "[up](../top.md) [own](./page.md)\n".into(),
        };
        let planned = plan_of(
            &w,
            &w.root.join("dir"),
            &Change::Move {
                into: display_path(&w.root.join("deep")),
            },
            std::slice::from_ref(&buffer),
        );
        let done = finish(&w.state, planned.token, &[buffer]).expect("done");
        // `../top.md` has to climb one more folder from its new place; `./page.md` moved with it.
        let [one] = done.edits.as_slice() else {
            panic!("{:?}", done.edits)
        };
        let [change] = one.changes.as_slice() else {
            panic!("{:?}", one.changes)
        };
        assert_eq!(change.insert, "../../top.md");
        assert_eq!(done.moved.documents.len(), 1);
    }

    #[test]
    fn discard_drops_only_the_plan_it_is_told_about() {
        let w = workspace();
        put(
            &w.root.join("old.md"),
            "x
",
        );
        put(
            &w.root.join("a.md"),
            "[x](old.md)
",
        );
        let planned = plan_of(&w, &w.root.join("old.md"), &rename("new.md"), &[]);
        discard(&w.state, planned.token + 1);
        assert!(
            w.state.rewrite_slot().is_some(),
            "another token took the plan away"
        );
        discard(&w.state, planned.token);
        assert!(w.state.rewrite_slot().is_none());
        let late = finish(&w.state, planned.token, &[]).expect_err("discarded");
        assert_eq!(late.kind(), "invalid");
        assert!(w.root.join("old.md").exists());
    }

    #[test]
    fn a_target_with_wide_characters_is_cut_out_by_units_not_bytes() {
        let w = workspace();
        let old = w.root.join("日本.md");
        let page = w.root.join("page.md");
        put(
            &old, "x
",
        );
        put(
            &page, "disk
",
        );
        open_document(&w.state, &page).expect("opened");
        let id = id_of(&w.state, &page);
        let text = "😀 [a](日本.md) tail
";
        let buffer = Buffer {
            id,
            text: text.into(),
        };
        let planned = plan_of(&w, &old, &rename("新.md"), std::slice::from_ref(&buffer));
        let done = finish(&w.state, planned.token, &[buffer]).expect("done");
        let [one] = done.edits.as_slice() else {
            panic!("{:?}", done.edits)
        };
        let [change] = one.changes.as_slice() else {
            panic!("{:?}", one.changes)
        };
        let units: Vec<u16> = text.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&units[change.from..change.to]).expect("utf16"),
            "日本.md"
        );
        assert_eq!(change.insert, "新.md");
    }

    #[test]
    fn a_stopped_scan_also_drops_the_plan_made_before_it() {
        let w = workspace();
        put(
            &w.root.join("old.md"),
            "x
",
        );
        put(
            &w.root.join("a.md"),
            "[x](old.md)
",
        );
        put(
            &w.root.join("b.md"),
            "[x](old.md)
",
        );
        let first = plan_of(&w, &w.root.join("old.md"), &rename("new.md"), &[]);
        let stopped = plan(
            &w.state,
            &w.root.join("old.md"),
            &rename("newer.md"),
            &[],
            |_| {
                w.state
                    .rewrite_stop()
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            },
        )
        .expect("answered");
        assert!(stopped.cancelled);
        assert!(w.state.rewrite_slot().is_none());
        assert_eq!(
            finish(&w.state, first.token, &[])
                .expect_err("replaced")
                .kind(),
            "invalid"
        );
    }
}
