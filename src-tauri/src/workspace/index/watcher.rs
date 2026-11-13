//! ISC-286: changes other programs make reach the index; excluded folders do not; a watcher that
//! may have lost events makes the root be read again.
//!
//! Three layers are tested apart, and then together. The filter and batching of [`watch::run`] get
//! made-up notify events; the index's handling of a [`watch::Batch`] gets batches over real disk
//! changes; and one test uses the real operating-system watcher end to end.

use super::testkit::*;
use super::*;
use notify::event::{CreateKind, RemoveKind};
use notify::{Event, EventKind};
use std::collections::BTreeMap;
use std::time::Instant;

/// Waits for `ready` to hold, up to a deadline. The index reads the disk on its own threads.
fn eventually(what: &str, ready: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if ready() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("gave up waiting for: {what}");
}

fn batch_of(paths: &[(PathBuf, bool)], rescan: bool) -> watch::Batch {
    let paths: BTreeMap<PathBuf, bool> = paths.iter().cloned().collect();
    watch::Batch {
        events: paths.len(),
        paths,
        rescan,
    }
}

// ---- the filter and the batching ----------------------------------------------------------

/// Runs the gatherer over these events and returns every batch it handed over.
fn gathered(index: &WorkspaceIndex, events: Vec<notify::Result<Event>>) -> Vec<watch::Batch> {
    let (tx, rx) = std::sync::mpsc::channel();
    for event in events {
        tx.send(event).expect("sent");
    }
    drop(tx);
    let seen = std::sync::Mutex::new(Vec::new());
    let shared = index.shared().clone();
    watch::run(&rx, &|path| shared.is_relevant(path), &|batch| {
        lock(&seen).push(batch);
    });
    seen.into_inner().expect("the batches")
}

fn created(path: &Path) -> notify::Result<Event> {
    Ok(Event::new(EventKind::Create(CreateKind::File)).add_path(path.to_path_buf()))
}

#[test]
fn an_event_under_an_excluded_folder_or_outside_every_root_never_becomes_a_batch() {
    let dir = tree(&["keep.md", "node_modules/pkg/a.js", "src/b.md"]);
    let other = tree(&[]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);

    let batches = gathered(
        &index,
        vec![
            created(&abs_of(&root, "node_modules/pkg/new.js")),
            created(&abs_of(&root, "target/debug/x.md")),
            created(&abs_of(&root, "a/.git/index")),
            created(&other.path().join("elsewhere.md")),
        ],
    );
    assert!(batches.is_empty(), "{batches:?}");
}

#[test]
fn events_for_the_same_path_are_one_entry_and_a_creation_wins_over_a_modification() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    let path = abs_of(&root, "a.md");
    let modified =
        Ok(Event::new(EventKind::Modify(notify::event::ModifyKind::Any)).add_path(path.clone()));
    let batches = gathered(
        &index,
        vec![
            modified,
            created(&path),
            created(&abs_of(&root, "excluded/node_modules/x")),
            created(&abs_of(&root, "b.md")),
        ],
    );
    assert_eq!(batches.len(), 1, "{batches:?}");
    assert_eq!(batches[0].paths.len(), 2);
    assert_eq!(batches[0].paths.get(&path), Some(&true));
    assert!(!batches[0].rescan);
}

#[test]
fn a_rescan_flag_or_a_watcher_error_marks_the_batch_as_possibly_incomplete() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);

    let flagged = Ok(Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan));
    let batches = gathered(&index, vec![flagged]);
    assert_eq!(batches.len(), 1);
    assert!(batches[0].rescan);

    let failed = Err(notify::Error::generic("the buffer overflowed"));
    let batches = gathered(&index, vec![failed]);
    assert_eq!(batches.len(), 1);
    assert!(batches[0].rescan);
}

// ---- what the index does with a batch ------------------------------------------------------

#[test]
fn a_new_changed_and_deleted_file_reach_the_index_from_a_batch() {
    let dir = tree(&["a.md", "b.md", "sub/c.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);

    put(&root, "from-outside.md", "x");
    put(&root, "sub/also.md", "x");
    remove(&root, "a.md");
    put(&root, "b.md", "now longer");
    index.feed(batch_of(
        &[
            (abs_of(&root, "from-outside.md"), true),
            (abs_of(&root, "sub/also.md"), true),
            (abs_of(&root, "a.md"), true),
            (abs_of(&root, "b.md"), false),
        ],
        false,
    ));
    assert_eq!(
        index.rels(&root),
        ["b.md", "from-outside.md", "sub/also.md", "sub/c.md"]
    );
    let entries = index.entries(&root);
    assert_eq!(
        entries[0].size,
        "now longer".len() as u64,
        "the size follows"
    );
}

#[test]
fn a_folder_made_deleted_or_renamed_from_outside_is_read_as_a_whole() {
    let dir = tree(&["old/a.md", "old/deep/b.md", "gone/c.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);

    // A whole folder appears at once, as when another program copies one in or unpacks an archive.
    put(&root, "made/one.md", "x");
    put(&root, "made/deeper/two.md", "x");
    // One is deleted.
    std::fs::remove_dir_all(abs_of(&root, "gone")).expect("removed");
    // One is renamed.
    std::fs::rename(abs_of(&root, "old"), abs_of(&root, "new")).expect("renamed");
    index.feed(batch_of(
        &[
            (abs_of(&root, "made"), true),
            (abs_of(&root, "made/one.md"), true),
            (abs_of(&root, "gone"), true),
            (abs_of(&root, "old"), true),
            (abs_of(&root, "new"), true),
        ],
        false,
    ));
    assert_eq!(index.rels(&root), walked_paths(&root));
    assert_eq!(
        index.rels(&root),
        [
            "made/deeper/two.md",
            "made/one.md",
            "new/a.md",
            "new/deep/b.md"
        ]
    );
}

#[test]
fn a_file_that_takes_the_place_of_a_folder_drops_what_was_below_it() {
    let dir = tree(&["thing/a.md", "thing/b/c.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    std::fs::remove_dir_all(abs_of(&root, "thing")).expect("removed");
    put(&root, "thing", "now a file");
    index.feed(batch_of(&[(abs_of(&root, "thing"), true)], false));
    assert_eq!(index.rels(&root), ["thing"]);
}

#[test]
fn an_overflow_reads_the_root_again_so_missed_changes_arrive() {
    let dir = tree(&["a.md", "b.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);

    // Changes the watcher never reported.
    put(&root, "missed.md", "x");
    remove(&root, "b.md");
    index.feed(batch_of(&[], true));
    eventually("the root to be read again", || {
        index.rels(&root) == ["a.md", "missed.md"] && index.status() == Status::default()
    });
}

#[test]
fn a_burst_of_events_is_read_as_a_possible_overflow() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    put(&root, "unreported.md", "x");
    let burst = watch::Batch {
        paths: BTreeMap::from([(abs_of(&root, "a.md"), false)]),
        events: BURST,
        rescan: false,
    };
    index.feed(burst);
    eventually("the root to be read again", || {
        index.rels(&root) == ["a.md", "unreported.md"]
    });
}

// ---- the real watcher -----------------------------------------------------------------------

#[test]
fn the_real_watcher_brings_in_what_another_program_does_and_ignores_excluded_folders() {
    let dir = tree(&["a.md", "node_modules/pkg/x.js"]);
    let root = root(&dir);
    let index = WorkspaceIndex::new(ignore_case());
    index.add_root_now(&root);
    assert_eq!(index.rels(&root), ["a.md"]);

    put(&root, "node_modules/pkg/ignored.js", "x");
    put(&root, "target/debug/ignored.md", "x");
    put(&root, "made-outside.md", "x");
    put(&root, "folder/inside.md", "x");
    eventually("created files to show", || {
        index.rels(&root) == ["a.md", "folder/inside.md", "made-outside.md"]
    });

    remove(&root, "made-outside.md");
    std::fs::remove_dir_all(abs_of(&root, "folder")).expect("removed");
    eventually("deleted files to go", || index.rels(&root) == ["a.md"]);
    assert_eq!(index.rels(&root), walked_paths(&root));
}

#[test]
fn one_watcher_covers_the_outermost_roots_only() {
    let dir = tree(&["a.md", "inner/b.md"]);
    let outer = root(&dir);
    let inner = outer.join("inner");
    let index = WorkspaceIndex::new(ignore_case());
    index.add_root_now(&inner);
    index.add_root_now(&outer);
    let watched = || {
        lock(&index.shared().watching)
            .as_ref()
            .map(watch::Watching::watched)
            .unwrap_or_default()
    };
    assert_eq!(watched(), [PathBuf::from(display_path(&outer))].into());
    index.remove_root(&outer);
    assert_eq!(watched(), [PathBuf::from(display_path(&inner))].into());
}

#[test]
fn a_removal_event_names_what_it_says() {
    // `RemoveKind` is the one notify kind with a folder variant: both count as structural.
    let dir = tree(&["a/b.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    let event = Ok(Event::new(EventKind::Remove(RemoveKind::Folder)).add_path(abs_of(&root, "a")));
    let batches = gathered(&index, vec![event]);
    assert_eq!(batches[0].paths.get(&abs_of(&root, "a")), Some(&true));
}
