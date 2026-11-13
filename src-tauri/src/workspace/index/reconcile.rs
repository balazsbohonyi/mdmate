//! ISC-284: a root answers from its cache at once and is corrected by the walk that follows; a
//! change made during the walk survives it.

use super::testkit::*;
use super::*;

#[test]
fn a_root_answers_from_its_cache_before_the_walk_and_is_corrected_after() {
    let dir = tree(&["a.md", "b.md"]);
    let root = root(&dir);
    let cache = tempfile::tempdir().expect("a temp dir");

    let first = index();
    first.set_cache_dir(cache.path().to_path_buf());
    first.add_root_now(&root);
    first.flush_cache();
    drop(first);

    // The disk moves on while the app is closed.
    remove(&root, "b.md");
    put(&root, "c.md", "x");

    let second = index();
    second.set_cache_dir(cache.path().to_path_buf());
    second.register_only(&root);
    assert!(second.load_cached_now(&root), "the cache is found");
    assert_eq!(
        second.rels(&root),
        ["a.md", "b.md"],
        "answers from the cache"
    );
    assert!(!second.is_ready(&root), "the disk has not been read yet");

    second.reconcile_now(&root);
    assert_eq!(
        second.rels(&root),
        ["a.md", "c.md"],
        "corrected by the walk"
    );
    assert!(second.is_ready(&root));
}

#[test]
fn a_root_with_no_cache_has_nothing_until_it_is_read() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let cache = tempfile::tempdir().expect("a temp dir");
    let index = index();
    index.set_cache_dir(cache.path().to_path_buf());
    index.register_only(&root);
    assert!(!index.load_cached_now(&root));
    assert!(index.rels(&root).is_empty());
    index.reconcile_now(&root);
    assert_eq!(index.rels(&root), ["a.md"]);
}

#[test]
fn a_root_that_becomes_unreadable_keeps_the_list_it_loaded() {
    let dir = tree(&["a.md", "b.md"]);
    let root = root(&dir);
    let cache = tempfile::tempdir().expect("a temp dir");
    let first = index();
    first.set_cache_dir(cache.path().to_path_buf());
    first.add_root_now(&root);
    first.flush_cache();
    drop(first);

    // The folder is gone, as when a drive is unplugged.
    let moved = root.with_file_name("moved-away");
    std::fs::rename(&root, &moved).expect("the folder moves away");

    let second = index();
    second.set_cache_dir(cache.path().to_path_buf());
    second.register_only(&root);
    assert!(second.load_cached_now(&root));
    second.reconcile_now(&root);
    assert_eq!(
        second.rels(&root),
        ["a.md", "b.md"],
        "a folder that cannot be read says nothing about its files"
    );
    assert!(!second.is_ready(&root), "so features keep walking it");

    std::fs::rename(&moved, &root).expect("the folder comes back");
}

#[test]
fn a_change_made_while_a_walk_runs_is_not_lost_to_it() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let index = index();
    let id = index.register_only(&root).expect("registered");
    let shared = index.shared();

    // The walk reads the disk as it is now: a.md only.
    let plan = shared.begin_scan(id).expect("a plan");
    let walked = shared.walk_root(&plan);
    assert_eq!(walked.entries.len(), 1);

    // Then the disk changes, and mdmate hears about it before the walk's answer is put in place.
    put(&root, "b.md", "x");
    index.changed(&root.join("b.md"));
    remove(&root, "a.md");
    index.removed(&root.join("a.md"));

    shared.finish(id, walked);
    assert_eq!(
        index.rels(&root),
        ["b.md"],
        "the stale walk did not bring a.md back or drop b.md"
    );
}

#[test]
fn a_walk_asked_for_twice_runs_again_after_the_first() {
    let dir = tree(&["a.md"]);
    let root = root(&dir);
    let index = index();
    index.add_root_now(&root);
    put(&root, "late.md", "x");
    index.reconcile_now(&root);
    assert_eq!(index.rels(&root), ["a.md", "late.md"]);
}

#[test]
fn a_root_removed_during_a_walk_is_left_alone_by_it() {
    let dir = tree(&["a.md", "b/c.md"]);
    let root = root(&dir);
    let index = index();
    let id = index.register_only(&root).expect("registered");
    let shared = index.shared();
    let plan = shared.begin_scan(id).expect("a plan");
    index.remove_root(&root);
    assert!(
        plan.cancel.load(Atomic::Relaxed),
        "the walk is told to stop"
    );
    let walked = shared.walk_root(&plan);
    assert!(walked.stopped);
    assert!(index.rels(&root).is_empty());
}

#[test]
fn status_reports_a_walk_only_while_it_runs() {
    let dir = tree(&["a.md", "b/c.md", "b/d.md"]);
    let root = root(&dir);
    let index = index();
    let seen = Arc::new(Mutex::new(Vec::<Status>::new()));
    let sink = seen.clone();
    index.set_status_sink(Box::new(move |status| lock(&sink).push(status)));
    index.add_root_now(&root);

    let seen = lock(&seen).clone();
    assert_eq!(
        seen.first(),
        Some(&Status::default()),
        "idle when it starts"
    );
    assert!(
        seen.iter().any(|status| status.indexing),
        "indexing was reported while the walk ran: {seen:?}"
    );
    assert!(
        seen.iter().all(|status| status.percent <= 99),
        "never 100 while it runs: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&Status::default()), "idle when it ends");
    assert_eq!(index.status(), Status::default());
}

// ---- the percent shown while a walk runs (ISC-289) ----------------------------------------------

#[test]
fn a_first_index_counts_top_level_entries_done() {
    // Nothing is known of the folders below, so the share is finished top-level entries of all.
    assert!((walk_share(0, 7, 0, 4) - 0.0).abs() < f32::EPSILON);
    assert!((walk_share(0, 50, 1, 4) - 0.25).abs() < f32::EPSILON);
    assert!((walk_share(0, 90, 3, 4) - 0.75).abs() < f32::EPSILON);
}

#[test]
fn a_reconcile_counts_folders_entered_out_of_the_cached_folders() {
    // The top level is irrelevant once the folder count is known.
    assert!((walk_share(200, 50, 0, 4) - 0.25).abs() < f32::EPSILON);
    assert!((walk_share(200, 100, 3, 4) - 0.5).abs() < f32::EPSILON);
}

#[test]
fn a_running_walk_never_shows_all_the_way_and_an_empty_one_shows_nothing() {
    // More folders than the cache knew of, or every top-level entry done: still under 100%.
    assert!(walk_share(100, 250, 0, 0) <= 0.99);
    assert!(walk_share(0, 5, 4, 4) <= 0.99);
    assert!(walk_share(0, 0, 0, 0).abs() < f32::EPSILON);
}

#[test]
fn the_status_percent_is_whole_and_under_100_while_indexing() {
    let index = index();
    let shared = index.shared();
    {
        let mut progress = lock(&shared.progress);
        progress.total = 1;
        progress.done = 0;
        progress.fraction = 0.999;
    }
    let status = shared.status();
    assert!(status.indexing);
    assert_eq!(status.percent, 99);
    {
        let mut progress = lock(&shared.progress);
        progress.fraction = 0.25;
        progress.total = 2;
    }
    assert_eq!(shared.status().percent, 12, "a quarter of one of two jobs");
}
