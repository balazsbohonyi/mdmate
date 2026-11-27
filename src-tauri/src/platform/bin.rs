//! Moving items to the Recycle Bin (the Trash) as one operation, without removing one for good.
//!
//! Everything here is the same on every OS: the walk that counts, the check of what the bin takes,
//! the phases the page is told about, and the report. [`Platform::recycle`] does the moving and
//! [`Platform::bin_room`] says what a volume's bin takes.
//!
//! What an item ended as is read from the disk, not from the system's result: Windows answers
//! "aborted" after a delete that went through, so only what is still there counts as kept.
#![cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "only the Windows shell can destroy an item or has a bin limit"
    )
)]

use super::Platform;
use crate::access::display_path;
use crate::error::{friendly_io, plain_text};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// What the bin of an item's volume takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BinRoom {
    /// Items of up to this many bytes.
    Limit(u64),
    /// Nothing: the volume has no bin, or is set to remove items for good.
    NoBin,
    /// The system does not say. It must then refuse, or ask about, what its bin cannot take.
    Unknown,
}

/// What the page is told while a delete runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub(crate) enum Progress {
    /// Nothing has moved, so a Cancel still stops all of it. The percent is absent until the system
    /// counts.
    Counting { percent: Option<u8> },
    /// Items are moving: there is no figure, and a Cancel no longer acts.
    Moving,
}

/// What the system means to do with an item it is about to remove.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    ToBin,
    /// Remove it for good.
    ForGood,
}

/// How the system finished with one item.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Handled {
    /// It is in the bin.
    InBin,
    /// It was removed and is not in the bin.
    Destroyed,
    /// It was not removed, with the reason.
    Failed(String),
}

/// What [`Platform::recycle`] tells while it runs. `target` is the position of a queued item, and
/// absent for something inside one.
pub(crate) trait BinWatcher: Send + Sync {
    /// One step of the system's count, before anything moves. False stops the operation.
    fn counted(&self) -> bool;

    /// `path` is about to be removed, the way `route` says. False refuses it, which ends the
    /// operation.
    fn moving(&self, target: Option<usize>, path: &Path, route: Route) -> bool;

    /// What became of `path`.
    fn handled(&self, target: Option<usize>, path: &Path, how: Handled);
}

/// Why an item was left where it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Kept {
    Cancelled,
    /// Bigger than its volume's bin takes.
    TooBig,
    NoBin,
    /// The system would have removed it for good, so it was refused.
    Permanent,
    /// In the system's words, or ours.
    Failed(String),
}

impl Kept {
    /// The reason, to follow "Could not delete a.md:".
    pub(crate) fn words(&self) -> String {
        match self {
            Self::Cancelled => "the delete was cancelled".into(),
            Self::TooBig => "it is too big for the Recycle Bin".into(),
            Self::NoBin => "its drive has no Recycle Bin".into(),
            Self::Permanent => {
                "it can only be removed for good, not moved to the Recycle Bin".into()
            }
            Self::Failed(words) => words.clone(),
        }
    }
}

/// What one item of a delete ended as.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum End {
    InBin,
    Kept(Kept),
    /// Gone, and not into the bin.
    Destroyed,
}

/// What a delete did.
#[derive(Debug)]
pub(crate) struct Report {
    /// One for each target, in the order asked.
    pub(crate) ends: Vec<End>,
    /// Items inside a target that were removed and did not reach the bin.
    pub(crate) destroyed_inside: Vec<PathBuf>,
    /// A Cancel stopped something.
    pub(crate) cancelled: bool,
}

/// What an item holds: itself and everything under it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Size {
    items: u64,
    bytes: u64,
}

#[derive(Debug)]
enum Stop {
    Cancelled,
    Io(io::Error),
}

/// Counts an item and sizes it. A link is one item with no bytes and is never followed, as the
/// Windows shell counts it. What cannot be read inside a folder is left out of the figures, so the
/// system's own refusal or question still has to cover it.
fn measure(path: &Path, cancel: &AtomicBool) -> Result<Size, Stop> {
    let meta = fs::symlink_metadata(path).map_err(Stop::Io)?;
    let mut size = Size { items: 1, bytes: 0 };
    if meta.file_type().is_symlink() {
        return Ok(size);
    }
    if !meta.is_dir() {
        size.bytes = meta.len();
        return Ok(size);
    }
    let mut folders = vec![path.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            if cancel.load(Ordering::SeqCst) {
                return Err(Stop::Cancelled);
            }
            size.items += 1;
            // The entry's own metadata, which never follows a link.
            let Ok(meta) = entry.metadata() else { continue };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                folders.push(entry.path());
            } else {
                size.bytes += meta.len();
            }
        }
    }
    Ok(size)
}

/// What an operation has told so far.
#[derive(Debug, Default)]
struct Seen {
    calls: u64,
    percent: Option<u8>,
    moving: bool,
    cancelled: bool,
    in_bin: Vec<bool>,
    failed: Vec<(Option<usize>, PathBuf, String)>,
    refused: Vec<PathBuf>,
    destroyed_inside: Vec<PathBuf>,
}

struct Watch {
    cancel: Arc<AtomicBool>,
    /// The items under every queued target, themselves included.
    items: u64,
    seen: Mutex<Seen>,
    progress: Box<dyn Fn(Progress) + Send + Sync>,
}

impl std::fmt::Debug for Watch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The progress callback has nothing to show.
        f.debug_struct("Watch")
            .field("items", &self.items)
            .field("seen", &self.seen)
            .finish_non_exhaustive()
    }
}

impl Watch {
    fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl BinWatcher for Watch {
    fn counted(&self) -> bool {
        let mut seen = self.seen();
        if seen.moving {
            return true;
        }
        if self.cancel.load(Ordering::SeqCst) {
            seen.cancelled = true;
            return false;
        }
        seen.calls += 1;
        // The system counts about once per item. It stays below 100 until the items have moved.
        let percent = (seen.calls.saturating_mul(100) / self.items.max(1)).min(99) as u8;
        if seen.percent != Some(percent) {
            seen.percent = Some(percent);
            drop(seen);
            (self.progress)(Progress::Counting {
                percent: Some(percent),
            });
        }
        true
    }

    fn moving(&self, _target: Option<usize>, path: &Path, route: Route) -> bool {
        let mut seen = self.seen();
        let first = !seen.moving;
        if first && self.cancel.load(Ordering::SeqCst) {
            seen.cancelled = true;
            return false;
        }
        seen.moving = true;
        if route == Route::ForGood {
            seen.refused.push(path.to_path_buf());
        }
        drop(seen);
        if first {
            (self.progress)(Progress::Moving);
        }
        route == Route::ToBin
    }

    fn handled(&self, target: Option<usize>, path: &Path, how: Handled) {
        let mut seen = self.seen();
        match how {
            Handled::InBin => {
                if let Some(slot) = target.and_then(|at| seen.in_bin.get_mut(at)) {
                    *slot = true;
                }
            }
            // A queued item that went this way is found by the look at the disk afterwards.
            Handled::Destroyed => {
                if target.is_none() {
                    seen.destroyed_inside.push(path.to_path_buf());
                }
            }
            Handled::Failed(words) => seen.failed.push((target, path.to_path_buf(), words)),
        }
    }
}

/// A path as it is compared: without the Windows prefix, and in one case where the file system
/// does not tell cases apart.
fn key(path: &Path, ignore_case: bool) -> PathBuf {
    let text = display_path(path);
    PathBuf::from(if ignore_case {
        text.to_lowercase()
    } else {
        text
    })
}

/// Whether `path` is `folder` or lies inside it.
fn within(path: &Path, folder: &Path, ignore_case: bool) -> bool {
    key(path, ignore_case).starts_with(key(folder, ignore_case))
}

/// For each target, the one that moves it: the outermost target that holds it, or itself. A repeat
/// goes with the first.
fn holders(targets: &[PathBuf], ignore_case: bool) -> Vec<usize> {
    let keys: Vec<PathBuf> = targets.iter().map(|path| key(path, ignore_case)).collect();
    keys.iter()
        .enumerate()
        .map(|(at, path)| {
            keys.iter()
                .enumerate()
                .filter(|(_, other)| path.starts_with(other))
                .min_by_key(|(holder, other)| (other.components().count(), *holder))
                .map_or(at, |(holder, _)| holder)
        })
        .collect()
}

/// Only a missing item counts as gone: one that cannot be looked at is taken to be there.
fn is_gone(path: &Path) -> bool {
    matches!(fs::symlink_metadata(path), Err(error) if error.kind() == io::ErrorKind::NotFound)
}

/// Why a queued item that is still there was not moved.
fn why_kept(
    seen: &Seen,
    slot: usize,
    path: &Path,
    ignore_case: bool,
    result: &io::Result<()>,
) -> Kept {
    let inside = |item: &Path| within(item, path, ignore_case);
    if seen.refused.iter().any(|refused| inside(refused)) {
        return Kept::Permanent;
    }
    if seen.cancelled {
        return Kept::Cancelled;
    }
    let said = seen
        .failed
        .iter()
        .find(|(target, failed, _)| *target == Some(slot) || (target.is_none() && inside(failed)));
    if let Some((_, _, words)) = said {
        return Kept::Failed(words.clone());
    }
    match result {
        Err(error) => Kept::Failed(plain_text(&error.to_string())),
        Ok(()) => Kept::Failed("the delete stopped before it was moved".into()),
    }
}

/// Moves the targets to the bin as one operation. A target the bin of its volume cannot take is
/// left out and reported as kept, and one inside another target ends as that one does. `cancel`
/// stops everything until the first item moves.
pub(crate) fn run(
    platform: &dyn Platform,
    targets: &[PathBuf],
    owner: Option<isize>,
    cancel: Arc<AtomicBool>,
    progress: Box<dyn Fn(Progress) + Send + Sync>,
) -> Report {
    progress(Progress::Counting { percent: None });
    let ignore_case = platform.paths_ignore_case();
    let holder = holders(targets, ignore_case);
    let mut ends: Vec<Option<End>> = vec![None; targets.len()];
    let mut queued: Vec<(usize, PathBuf)> = Vec::new();
    let mut items = 0;
    let mut cancelled = false;
    for ((at, target), end) in targets.iter().enumerate().zip(ends.iter_mut()) {
        if holder.get(at) != Some(&at) {
            continue;
        }
        match measure(target, &cancel) {
            Err(Stop::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(Stop::Io(error)) => *end = Some(End::Kept(Kept::Failed(friendly_io(&error)))),
            Ok(size) => match platform.bin_room(target) {
                BinRoom::NoBin => *end = Some(End::Kept(Kept::NoBin)),
                BinRoom::Limit(limit) if size.bytes > limit => {
                    *end = Some(End::Kept(Kept::TooBig));
                }
                BinRoom::Limit(_) | BinRoom::Unknown => {
                    items += size.items;
                    queued.push((at, target.clone()));
                }
            },
        }
    }
    cancelled |= cancel.load(Ordering::SeqCst);
    let mut destroyed_inside = Vec::new();
    if !cancelled && !queued.is_empty() {
        let paths: Vec<PathBuf> = queued.iter().map(|(_, path)| path.clone()).collect();
        let watch = Arc::new(Watch {
            cancel,
            items,
            seen: Mutex::new(Seen {
                in_bin: vec![false; paths.len()],
                ..Seen::default()
            }),
            progress,
        });
        let result = platform.recycle(&paths, owner, Arc::clone(&watch) as Arc<dyn BinWatcher>);
        let seen = watch.seen();
        for (slot, (at, path)) in queued.iter().enumerate() {
            let end = if !is_gone(path) {
                End::Kept(why_kept(&seen, slot, path, ignore_case, &result))
            } else if seen.in_bin.get(slot) == Some(&true) {
                End::InBin
            } else {
                End::Destroyed
            };
            if let Some(place) = ends.get_mut(*at) {
                *place = Some(end);
            }
        }
        cancelled = seen.cancelled;
        destroyed_inside = seen.destroyed_inside.clone();
    }
    // What has no end yet was never queued or never reached, which only a Cancel causes.
    let ends = holder
        .iter()
        .map(|&at| {
            ends.get(at)
                .cloned()
                .flatten()
                .unwrap_or(End::Kept(Kept::Cancelled))
        })
        .collect();
    Report {
        ends,
        destroyed_inside,
        cancelled,
    }
}

/// Moves one item to the bin, or says why it did not. For [`Platform::move_to_trash`] where the
/// system can remove an item for good.
pub(crate) fn one(platform: &dyn Platform, path: &Path) -> io::Result<()> {
    let report = run(
        platform,
        &[path.to_path_buf()],
        None,
        Arc::default(),
        Box::new(|_| {}),
    );
    if !report.destroyed_inside.is_empty() {
        return Err(io::Error::other(
            "part of it was removed for good, not moved to the Recycle Bin",
        ));
    }
    match report.ends.first() {
        Some(End::InBin) => Ok(()),
        Some(End::Kept(why)) => Err(io::Error::other(why.words())),
        Some(End::Destroyed) | None => Err(io::Error::other(
            "it was removed for good, not moved to the Recycle Bin",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::make_folder_link;

    /// What the fake system does with the queued paths.
    type Shell = dyn Fn(&[PathBuf], &dyn BinWatcher) -> io::Result<()> + Send + Sync;

    /// A stand-in for the OS that replays what the Windows shell was seen to do (P9.1-T50). It
    /// "recycles" by removing files of the test's own temporary folder.
    struct Fake {
        room: BinRoom,
        shell: Box<Shell>,
        asked: Mutex<Vec<Vec<PathBuf>>>,
    }

    impl Fake {
        fn new(
            room: BinRoom,
            shell: impl Fn(&[PathBuf], &dyn BinWatcher) -> io::Result<()> + Send + Sync + 'static,
        ) -> Self {
            Self {
                room,
                shell: Box::new(shell),
                asked: Mutex::new(Vec::new()),
            }
        }

        fn asked(&self) -> Vec<Vec<PathBuf>> {
            self.asked.lock().expect("lock").clone()
        }
    }

    impl Platform for Fake {
        fn name(&self) -> &'static str {
            "test"
        }
        fn paths_ignore_case(&self) -> bool {
            true
        }
        fn file_is_busy(&self, _error: &io::Error) -> bool {
            false
        }
        fn open_external(&self, _target: &str) -> io::Result<()> {
            Ok(())
        }
        fn move_to_trash(&self, path: &Path) -> io::Result<()> {
            one(self, path)
        }
        fn reveal(&self, _path: &Path) -> io::Result<()> {
            Ok(())
        }
        fn show_folder(&self, _path: &Path) -> io::Result<()> {
            Ok(())
        }
        fn bin_room(&self, _path: &Path) -> BinRoom {
            self.room
        }
        fn recycle(
            &self,
            paths: &[PathBuf],
            _owner: Option<isize>,
            watcher: Arc<dyn BinWatcher>,
        ) -> io::Result<()> {
            self.asked.lock().expect("lock").push(paths.to_vec());
            (self.shell)(paths, watcher.as_ref())
        }
    }

    fn aborted() -> io::Error {
        io::Error::other("Operation aborted")
    }

    fn remove(path: &Path) {
        if path.is_dir() {
            fs::remove_dir_all(path).expect("removed");
        } else {
            fs::remove_file(path).expect("removed");
        }
    }

    /// A normal recycle: `counts` steps of counting, then each item moves into the bin.
    fn recycles(counts: usize, paths: &[PathBuf], watcher: &dyn BinWatcher) -> io::Result<()> {
        for _ in 0..counts {
            if !watcher.counted() {
                return Err(aborted());
            }
        }
        for (at, path) in paths.iter().enumerate() {
            if !watcher.moving(Some(at), path, Route::ToBin) {
                return Err(aborted());
            }
            remove(path);
            watcher.handled(Some(at), path, Handled::InBin);
        }
        // The shell's last progress call comes after the items have moved.
        watcher.counted();
        Ok(())
    }

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir")
    }

    fn file(folder: &Path, name: &str, bytes: usize) -> PathBuf {
        let path = folder.join(name);
        fs::create_dir_all(path.parent().expect("a parent")).expect("folders");
        fs::write(&path, vec![b'x'; bytes]).expect("written");
        path
    }

    fn folder_of(base: &Path, name: &str, files: usize) -> PathBuf {
        let folder = base.join(name);
        fs::create_dir_all(&folder).expect("folder");
        for number in 0..files {
            file(&folder, &format!("{number}.txt"), 1);
        }
        folder
    }

    /// Runs a delete and collects what the page would be told.
    fn watched(
        platform: &Fake,
        targets: &[PathBuf],
        cancel: &Arc<AtomicBool>,
    ) -> (Report, Vec<Progress>) {
        let told = Arc::new(Mutex::new(Vec::new()));
        let into = Arc::clone(&told);
        let report = run(
            platform,
            targets,
            None,
            Arc::clone(cancel),
            Box::new(move |step| into.lock().expect("lock").push(step)),
        );
        let told = told.lock().expect("lock").clone();
        (report, told)
    }

    fn percents(told: &[Progress]) -> Vec<u8> {
        told.iter()
            .filter_map(|step| match step {
                Progress::Counting { percent } => *percent,
                Progress::Moving => None,
            })
            .collect()
    }

    #[test]
    fn delete_progress_counts_without_a_figure_then_rises_then_says_moving() {
        let dir = temp();
        let target = folder_of(dir.path(), "big", 10);
        // 11 items, and the shell was seen to count one time more than there are items.
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            recycles(12, paths, watcher)
        });
        let (report, told) = watched(&os, &[target], &Arc::default());
        assert_eq!(report.ends, [End::InBin]);
        assert_eq!(told.first(), Some(&Progress::Counting { percent: None }));
        let figures = percents(&told);
        assert_eq!(figures.first(), Some(&9));
        assert!(
            figures.windows(2).all(|pair| pair[0] < pair[1]),
            "{figures:?}"
        );
        assert_eq!(figures.last(), Some(&99), "never 100 while it counts");
        assert_eq!(told.last(), Some(&Progress::Moving));
        assert_eq!(told.iter().filter(|s| **s == Progress::Moving).count(), 1);
    }

    #[test]
    fn delete_cancel_while_the_system_counts_removes_nothing() {
        let dir = temp();
        let target = folder_of(dir.path(), "big", 10);
        let cancel: Arc<AtomicBool> = Arc::default();
        let asks = Arc::clone(&cancel);
        let os = Fake::new(BinRoom::Unknown, move |paths, watcher| {
            assert!(watcher.counted() && watcher.counted());
            asks.store(true, Ordering::SeqCst);
            recycles(3, paths, watcher)
        });
        let (report, told) = watched(&os, std::slice::from_ref(&target), &cancel);
        assert_eq!(report.ends, [End::Kept(Kept::Cancelled)]);
        assert!(report.cancelled);
        assert_eq!(fs::read_dir(&target).expect("there").count(), 10);
        assert!(!told.contains(&Progress::Moving));
    }

    #[test]
    fn delete_cancel_before_the_system_is_asked_asks_it_nothing() {
        let dir = temp();
        let target = folder_of(dir.path(), "big", 3);
        let cancel = Arc::new(AtomicBool::new(true));
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            recycles(1, paths, watcher)
        });
        let (report, _) = watched(&os, std::slice::from_ref(&target), &cancel);
        assert_eq!(report.ends, [End::Kept(Kept::Cancelled)]);
        assert!(report.cancelled && os.asked().is_empty() && target.exists());
    }

    #[test]
    fn delete_cancel_between_the_count_and_the_first_move_still_stops_it() {
        let dir = temp();
        let target = file(dir.path(), "a.md", 1);
        let cancel: Arc<AtomicBool> = Arc::default();
        let asks = Arc::clone(&cancel);
        let os = Fake::new(BinRoom::Unknown, move |paths, watcher| {
            assert!(watcher.counted());
            asks.store(true, Ordering::SeqCst);
            assert!(!watcher.moving(Some(0), &paths[0], Route::ToBin));
            Err(aborted())
        });
        let (report, told) = watched(&os, std::slice::from_ref(&target), &cancel);
        assert_eq!(report.ends, [End::Kept(Kept::Cancelled)]);
        assert!(report.cancelled && target.exists());
        assert!(!told.contains(&Progress::Moving));
    }

    #[test]
    fn delete_cancel_after_the_move_starts_no_longer_acts() {
        let dir = temp();
        let targets = [file(dir.path(), "a.md", 1), file(dir.path(), "b.md", 1)];
        let cancel: Arc<AtomicBool> = Arc::default();
        let asks = Arc::clone(&cancel);
        let os = Fake::new(BinRoom::Unknown, move |paths, watcher| {
            assert!(watcher.moving(Some(0), &paths[0], Route::ToBin));
            asks.store(true, Ordering::SeqCst);
            remove(&paths[0]);
            watcher.handled(Some(0), &paths[0], Handled::InBin);
            assert!(watcher.counted(), "a late progress call is not refused");
            assert!(watcher.moving(Some(1), &paths[1], Route::ToBin));
            remove(&paths[1]);
            watcher.handled(Some(1), &paths[1], Handled::InBin);
            // Windows was seen to answer "aborted" after everything had moved.
            Err(aborted())
        });
        let (report, _) = watched(&os, &targets, &cancel);
        assert_eq!(report.ends, [End::InBin, End::InBin]);
        assert!(!report.cancelled);
    }

    #[test]
    fn recycle_never_permanent_leaves_out_what_is_bigger_than_the_bin() {
        let dir = temp();
        let big = file(dir.path(), "big.bin", 11);
        let small = file(dir.path(), "small.bin", 10);
        // Each file fits, and together they do not: a folder counts as a whole.
        let both = dir.path().join("both");
        file(&both, "a.bin", 6);
        file(&both, "b.bin", 6);
        let os = Fake::new(BinRoom::Limit(10), |paths, watcher| {
            recycles(1, paths, watcher)
        });
        let targets = [big.clone(), small.clone(), both.clone()];
        let (report, _) = watched(&os, &targets, &Arc::default());
        assert_eq!(
            report.ends,
            [End::Kept(Kept::TooBig), End::InBin, End::Kept(Kept::TooBig)]
        );
        assert_eq!(os.asked(), [vec![small]]);
        assert!(big.exists() && both.join("b.bin").exists());
    }

    #[test]
    fn recycle_never_permanent_asks_nothing_where_there_is_no_bin() {
        let dir = temp();
        let target = file(dir.path(), "a.md", 1);
        let os = Fake::new(BinRoom::NoBin, |paths, watcher| recycles(1, paths, watcher));
        let (report, _) = watched(&os, std::slice::from_ref(&target), &Arc::default());
        assert_eq!(report.ends, [End::Kept(Kept::NoBin)]);
        assert!(os.asked().is_empty() && target.exists() && !report.cancelled);
        let error = one(&os, &target).expect_err("kept");
        assert_eq!(error.to_string(), "its drive has no Recycle Bin");
    }

    #[test]
    fn recycle_never_permanent_refuses_a_call_without_the_recycle_flag() {
        let dir = temp();
        let target = folder_of(dir.path(), "big", 1);
        // The shell does not take the folder whole, then goes to what is inside without the flag.
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            assert!(watcher.moving(Some(0), &paths[0], Route::ToBin));
            let child = paths[0].join("0.txt");
            assert!(!watcher.moving(None, &child, Route::ForGood), "refused");
            watcher.handled(None, &child, Handled::Failed("Operation aborted".into()));
            Err(aborted())
        });
        let (report, _) = watched(&os, std::slice::from_ref(&target), &Arc::default());
        assert_eq!(report.ends, [End::Kept(Kept::Permanent)]);
        assert!(target.join("0.txt").exists());
    }

    #[test]
    fn recycle_never_permanent_reports_what_was_destroyed_and_what_was_kept_on_a_no() {
        let dir = temp();
        // Windows asked and the answer was Yes: gone, with no item in the bin.
        let gone = file(dir.path(), "gone.bin", 1);
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            assert!(watcher.moving(Some(0), &paths[0], Route::ToBin));
            remove(&paths[0]);
            watcher.handled(Some(0), &paths[0], Handled::Destroyed);
            Ok(())
        });
        let (report, _) = watched(&os, std::slice::from_ref(&gone), &Arc::default());
        assert_eq!(report.ends, [End::Destroyed]);
        let again = file(dir.path(), "gone.bin", 1);
        let error = one(&os, &again).expect_err("not in the bin");
        assert!(error.to_string().contains("removed for good"), "{error}");

        // The answer was No: the item stays, with the system's reason.
        let stays = file(dir.path(), "stays.bin", 1);
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            assert!(watcher.moving(Some(0), &paths[0], Route::ToBin));
            watcher.handled(
                Some(0),
                &paths[0],
                Handled::Failed("it was not removed".into()),
            );
            Err(aborted())
        });
        let (report, _) = watched(&os, std::slice::from_ref(&stays), &Arc::default());
        assert_eq!(
            report.ends,
            [End::Kept(Kept::Failed("it was not removed".into()))]
        );
        assert!(stays.exists() && !report.cancelled);
    }

    #[test]
    fn recycle_never_permanent_trusts_the_disk_over_what_the_system_says() {
        let dir = temp();
        let silent = file(dir.path(), "silent.md", 1);
        let claimed = file(dir.path(), "claimed.md", 1);
        let inside = folder_of(dir.path(), "inside", 2);
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            // Gone without a word of the bin, and said to be in the bin but still there.
            remove(&paths[0]);
            watcher.handled(Some(1), &paths[1], Handled::InBin);
            let child = paths[2].join("0.txt");
            remove(&child);
            watcher.handled(None, &child, Handled::Destroyed);
            Ok(())
        });
        let targets = [silent, claimed, inside.clone()];
        let (report, _) = watched(&os, &targets, &Arc::default());
        assert_eq!(report.ends[0], End::Destroyed);
        assert!(matches!(report.ends[1], End::Kept(Kept::Failed(_))));
        assert!(matches!(report.ends[2], End::Kept(Kept::Failed(_))));
        assert_eq!(report.destroyed_inside, [inside.join("0.txt")]);
    }

    #[test]
    fn recycle_never_permanent_counts_a_link_as_one_item_and_not_what_it_leads_to() {
        let dir = temp();
        let target = dir.path().join("target");
        file(&target, "large.bin", 100);
        let parent = dir.path().join("parent");
        fs::create_dir_all(&parent).expect("parent");
        make_folder_link(&target, &parent.join("link")).expect("a link");
        let size = measure(&parent, &AtomicBool::new(false))
            .map_err(|_| "unreadable")
            .expect("measured");
        assert_eq!(size, Size { items: 2, bytes: 0 });
    }

    #[test]
    fn delete_many_is_one_operation_in_whichever_order_the_system_reports() {
        let dir = temp();
        let targets = [file(dir.path(), "a.md", 1), folder_of(dir.path(), "b", 2)];
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            for (at, path) in paths.iter().enumerate() {
                assert!(watcher.moving(Some(at), path, Route::ToBin));
            }
            for (at, path) in paths.iter().enumerate() {
                remove(path);
                watcher.handled(Some(at), path, Handled::InBin);
            }
            Ok(())
        });
        let (report, told) = watched(&os, &targets, &Arc::default());
        assert_eq!(report.ends, [End::InBin, End::InBin]);
        assert_eq!(os.asked(), [targets.to_vec()]);
        assert_eq!(told.iter().filter(|s| **s == Progress::Moving).count(), 1);
    }

    #[test]
    fn delete_many_takes_an_item_inside_another_one_along_with_it() {
        let dir = temp();
        let folder = folder_of(dir.path(), "a", 2);
        let inside = folder.join("0.txt");
        let beside = file(dir.path(), "ab.md", 1);
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            recycles(1, paths, watcher)
        });
        let targets = [inside, folder.clone(), beside.clone(), folder.clone()];
        let (report, _) = watched(&os, &targets, &Arc::default());
        assert_eq!(report.ends, vec![End::InBin; 4]);
        assert_eq!(os.asked(), [vec![folder, beside]]);
    }

    #[test]
    fn delete_many_has_one_total_and_one_cancel() {
        let dir = temp();
        let targets = [folder_of(dir.path(), "a", 4), folder_of(dir.path(), "b", 4)];
        // 10 items between them: five counts are half of all of it.
        let cancel: Arc<AtomicBool> = Arc::default();
        let asks = Arc::clone(&cancel);
        let os = Fake::new(BinRoom::Unknown, move |paths, watcher| {
            for _ in 0..5 {
                assert!(watcher.counted());
            }
            asks.store(true, Ordering::SeqCst);
            recycles(1, paths, watcher)
        });
        let (report, told) = watched(&os, &targets, &cancel);
        assert_eq!(percents(&told).last(), Some(&50));
        assert_eq!(
            report.ends,
            [End::Kept(Kept::Cancelled), End::Kept(Kept::Cancelled)]
        );
        assert!(targets.iter().all(|target| target.exists()));
    }

    #[test]
    fn delete_many_reports_each_item_when_the_operation_stops_partway() {
        let dir = temp();
        let missing = dir.path().join("missing.md");
        let targets = [
            file(dir.path(), "a.md", 1),
            file(dir.path(), "b.md", 1),
            file(dir.path(), "c.md", 1),
            missing,
        ];
        let os = Fake::new(BinRoom::Unknown, |paths, watcher| {
            assert!(watcher.moving(Some(0), &paths[0], Route::ToBin));
            remove(&paths[0]);
            watcher.handled(Some(0), &paths[0], Handled::InBin);
            assert!(watcher.moving(Some(1), &paths[1], Route::ToBin));
            watcher.handled(
                Some(1),
                &paths[1],
                Handled::Failed("another program is using it".into()),
            );
            Ok(())
        });
        let (report, _) = watched(&os, &targets, &Arc::default());
        assert_eq!(report.ends[0], End::InBin);
        assert_eq!(
            report.ends[1],
            End::Kept(Kept::Failed("another program is using it".into()))
        );
        assert!(
            matches!(&report.ends[2], End::Kept(Kept::Failed(words)) if words.contains("stopped"))
        );
        assert!(
            matches!(&report.ends[3], End::Kept(Kept::Failed(words)) if words.contains("not found"))
        );
        assert_eq!(os.asked()[0].len(), 3, "the missing one is never queued");
    }
}
