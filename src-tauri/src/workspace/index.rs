//! The workspace index: every file under the workspace roots, held in memory so that finding a
//! file, its links or a word starts from a list mdmate already has instead of a walk of the disk.
//!
//! An entry is a file's path (relative to its root), kind, size and modified time. Contents are not
//! indexed. Folders on the built-in exclusion list (`crate::fs::exclude`) are never entered, and
//! links, junctions and mount points are not followed (the walk is `links::walk`'s).
//!
//! **Roots.** Each root keeps its own list, sorted by path. A file under two nested roots is held
//! once, by the innermost root that holds it: a root's walk leaves out the roots inside it, adding a
//! root drops its files from the root around it, and removing one reads that folder again for the
//! root around it.
//!
//! **Keeping it.** One worker thread builds the lists. A root with a cache file (see
//! [`cachefile`]) answers from it at once while the worker reads the disk and replaces the list when
//! it is done; a root with none fills in as the walk goes. mdmate's own file operations update the
//! live list at once (`changed`, `removed`, `moved`), a recursive watcher per root catches what
//! other programs do, and while a walk is running every such change is also written to a journal
//! that is replayed on the new list, so a change made during a reconcile is never lost to it. A
//! cache file is written a moment after a root changes, and again when a reconcile ends.
//!
//! **Using it.** Quick Open scores against it; the link scans and folder search take their file
//! list from it for a root that is fully read, and walk the root themselves otherwise.

mod cachefile;
mod watch;

#[cfg(test)]
mod builds;
#[cfg(test)]
mod cache;
#[cfg(test)]
mod cap;
#[cfg(test)]
mod excludes;
#[cfg(test)]
mod nested;
#[cfg(test)]
mod own_ops;
#[cfg(test)]
mod reconcile;
#[cfg(test)]
mod testkit;
#[cfg(test)]
mod users;
#[cfg(test)]
mod users_exclude;
#[cfg(test)]
mod watcher;

use crate::access::display_path;
use crate::fs::exclude::{has_excluded_folder, is_excluded_dir};
use crate::fs::kind::{FileKind, kind_of};
use crate::links::walk::{SKIPPED, Scope, walk_entries};
use serde::Serialize;
use std::cell::Cell;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs::{DirEntry, Metadata};
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as Atomic};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Files held across all roots. A root past it is cut, and what reads from the index walks it.
pub(crate) const MAX_FILES: usize = 1_000_000;

/// How long after a change a cache file is written, so a run of changes is one write.
const SAVE_DELAY: Duration = Duration::from_millis(500);

/// How often a status goes to the page while a walk runs.
const STATUS_EVERY: Duration = Duration::from_millis(100);

/// Files a first index shows before the walk ends, in batches this big.
const PARTIAL_BATCH: usize = 2_000;

/// Changes remembered while a walk runs. Past it the root is read again.
const JOURNAL_LIMIT: usize = 5_000;

/// A burst of this many events in one quiet spell is read as a watcher that may have lost some.
///
/// On Windows the watcher's 16 KB buffer holds between about 30 and 230 events (an event is 12
/// bytes and the path in UTF-16), and notify 8.2.1 does not say when it overflows. A quiet spell
/// with this many events could have overflowed, so the root is read again. It is a guess that
/// errs toward reading: a false alarm costs one walk, a miss leaves the index wrong until the next.
const BURST: usize = 64;

/// A letter in lower case, which is how paths are compared and sorted.
pub(crate) fn fold(c: char) -> char {
    if c.is_ascii() {
        c.to_ascii_lowercase()
    } else {
        c.to_lowercase().next().unwrap_or(c)
    }
}

/// The order of the lists: by the path in lower case, then by the path as written.
pub(crate) fn cmp_rel(a: &str, b: &str) -> Ordering {
    a.chars()
        .map(fold)
        .cmp(b.chars().map(fold))
        .then_with(|| a.cmp(b))
}

/// One file the index holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FileEntry {
    /// The path below its root, with `/` between the parts.
    pub(crate) rel: Box<str>,
    pub(crate) kind: FileKind,
    pub(crate) size: u64,
    /// Milliseconds since the Unix epoch; zero when the file system did not say.
    pub(crate) modified: i64,
}

impl FileEntry {
    /// Where the file's own name starts in `rel`, in bytes.
    #[cfg(test)]
    pub(crate) fn name_start(&self) -> usize {
        self.rel.rfind('/').map_or(0, |slash| slash + 1)
    }
}

/// The files of one root, as Quick Open reads them.
#[derive(Debug)]
pub(crate) struct Listing<'a> {
    /// What leads each path as shown: the root's name and a slash when more than one folder is
    /// open, so the same name in two folders can be told apart. Empty with one folder.
    pub(crate) prefix: String,
    pub(crate) root: &'a Path,
    /// Sorted by path, except for a root still being read for the first time.
    pub(crate) entries: &'a [FileEntry],
}

/// What the status bar shows.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Status {
    /// A root is being read: for the first time, or again to check it against the disk.
    pub(crate) indexing: bool,
    /// How far along, 0 to 99 while indexing and 0 otherwise.
    pub(crate) percent: u8,
    /// The names of the roots cut at the file limit.
    pub(crate) cut: Vec<String>,
}

/// Hears each status.
pub(crate) type StatusSink = Box<dyn Fn(Status) + Send + Sync>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    /// Nothing known yet: a first index is queued or running.
    Empty,
    /// The list is a cache file's, and a reconcile with the disk is queued or running.
    Loaded,
    /// The list is what the last walk saw, kept up to date since.
    Ready,
}

#[derive(Debug)]
struct RootIndex {
    id: u64,
    path: PathBuf,
    /// `path` as people read it; what every other path is compared with.
    shown: String,
    label: String,
    entries: Vec<FileEntry>,
    /// False while a first index is filling `entries` in walk order.
    sorted: bool,
    phase: Phase,
    cut: bool,
    folders: u32,
    unreadable: u32,
    /// A walk of this root is running; changes are also written to `journal`.
    scanning: bool,
    journal: Vec<(String, bool)>,
    journal_full: bool,
    /// A walk is queued or running.
    queued: bool,
    /// Another walk was asked for while one ran.
    again: bool,
    /// The cache file is behind the list.
    dirty: bool,
    cancel: Arc<AtomicBool>,
}

impl RootIndex {
    fn new(id: u64, path: &Path) -> Self {
        let shown = display_path(path);
        let label = path
            .file_name()
            .map_or_else(|| shown.clone(), |name| name.to_string_lossy().into_owned());
        Self {
            id,
            path: path.to_path_buf(),
            shown,
            label,
            entries: Vec::new(),
            sorted: true,
            phase: Phase::Empty,
            cut: false,
            folders: 0,
            unreadable: 0,
            scanning: false,
            journal: Vec::new(),
            journal_full: false,
            queued: false,
            again: false,
            dirty: false,
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Where `rel` is, or would go, in the sorted list.
    fn find(&self, rel: &str) -> Result<usize, usize> {
        self.entries
            .binary_search_by(|entry| cmp_rel(&entry.rel, rel))
    }

    /// Adds a file, or updates the one with its path. True when the set of files changed.
    fn upsert(&mut self, entry: FileEntry) -> bool {
        match self.find(&entry.rel) {
            Ok(at) => {
                let same = self.entries[at] == entry;
                let structural = self.entries[at].kind != entry.kind;
                self.entries[at] = entry;
                !same && structural
            }
            Err(at) => {
                self.entries.insert(at, entry);
                true
            }
        }
    }

    /// Removes the file `rel` and everything below `rel/`, and says whether anything went.
    fn remove_tree(&mut self, rel: &str, ignore_case: bool) -> bool {
        let mut removed = false;
        if let Ok(at) = self.find(rel) {
            self.entries.remove(at);
            removed = true;
        }
        removed | self.remove_below(rel, ignore_case)
    }

    /// Removes everything below `rel/`, and says whether anything went. The list is sorted by
    /// folded path, so what lies below a folder is one run of it, found without reading the rest.
    fn remove_below(&mut self, rel: &str, ignore_case: bool) -> bool {
        let prefix = format!("{rel}/");
        let folded: Vec<char> = prefix.chars().map(fold).collect();
        let before = |entry: &FileEntry| entry.rel.chars().map(fold).lt(folded.iter().copied());
        let start = self.entries.partition_point(before);
        let inside = |entry: &FileEntry| {
            let mut have = entry.rel.chars().map(fold);
            folded.iter().all(|&want| have.next() == Some(want))
        };
        let run = self.entries[start..]
            .iter()
            .take_while(|entry| inside(entry))
            .count();
        if run == 0 {
            return false;
        }
        let taken: Vec<FileEntry> = self.entries.drain(start..start + run).collect();
        // Where names differ in case, `Notes/` and `notes/` are two folders: put back the ones
        // that are not the folder asked for.
        let kept: Vec<FileEntry> = taken
            .into_iter()
            .filter(|entry| !ignore_case && !entry.rel.starts_with(&prefix))
            .collect();
        let removed = kept.len() != run;
        self.entries.splice(start..start, kept);
        removed
    }

    fn note(&mut self, rel: &str, structural: bool) {
        if !self.scanning {
            return;
        }
        if self.journal.len() >= JOURNAL_LIMIT {
            self.journal_full = true;
        } else {
            self.journal.push((rel.to_owned(), structural));
        }
    }
}

#[derive(Debug, Default)]
struct Roots {
    list: Vec<RootIndex>,
    next_id: u64,
}

impl Roots {
    fn position(&self, id: u64) -> Option<usize> {
        self.list.iter().position(|root| root.id == id)
    }

    fn get_mut(&mut self, id: u64) -> Option<&mut RootIndex> {
        self.list.iter_mut().find(|root| root.id == id)
    }

    fn total(&self) -> usize {
        self.list.iter().map(|root| root.entries.len()).sum()
    }
}

/// The part of `path` below `root`, with `/` between parts; empty for the root itself.
fn below<'a>(path: &'a str, root: &str, ignore_case: bool) -> Option<std::borrow::Cow<'a, str>> {
    let head = path.get(..root.len())?;
    let same = if ignore_case {
        head.eq_ignore_ascii_case(root)
    } else {
        head == root
    };
    if !same {
        return None;
    }
    let rest = &path[root.len()..];
    let rest = if rest.is_empty() || root.ends_with(MAIN_SEPARATOR) {
        rest
    } else {
        rest.strip_prefix(MAIN_SEPARATOR)?
    };
    Some(if MAIN_SEPARATOR == '/' {
        rest.into()
    } else {
        rest.replace(MAIN_SEPARATOR, "/").into()
    })
}

fn rel_string(inside: &Path) -> String {
    let text = inside.to_string_lossy();
    if MAIN_SEPARATOR == '/' {
        text.into_owned()
    } else {
        text.replace(MAIN_SEPARATOR, "/")
    }
}

/// The path of a file from its root and its path below it.
pub(crate) fn abs_of(root: &Path, rel: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    path.extend(rel.split('/'));
    path
}

fn millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| {
        i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
    })
}

fn entry_of(rel: String, path: &Path, meta: &Metadata) -> FileEntry {
    FileEntry {
        kind: kind_of(path),
        size: meta.len(),
        modified: meta.modified().map_or(0, millis),
        rel: rel.into_boxed_str(),
    }
}

fn entry_from_listing(root: &Path, path: &Path, listed: &DirEntry) -> Option<FileEntry> {
    let rel = rel_string(path.strip_prefix(root).ok()?);
    let meta = listed.metadata().ok();
    Some(FileEntry {
        kind: kind_of(path),
        size: meta.as_ref().map_or(0, Metadata::len),
        modified: meta
            .as_ref()
            .and_then(|meta| meta.modified().ok())
            .map_or(0, millis),
        rel: rel.into_boxed_str(),
    })
}

/// How far along a walk is, from 0 up to 0.99 (a walk that is running is never all the way).
///
/// A root that has been read before knows how many folders it held, so the share is the folders
/// entered out of those. A first index knows only its top level, so the share is the top-level
/// entries finished out of all of them.
fn walk_share(known_folders: u32, folders: u32, top_done: usize, top_total: usize) -> f32 {
    let share = if known_folders > 0 {
        folders as f32 / known_folders as f32
    } else if top_total > 0 {
        top_done as f32 / top_total as f32
    } else {
        0.0
    };
    share.clamp(0.0, 0.99)
}

/// What one root's walk is told.
struct ScanPlan {
    id: u64,
    path: PathBuf,
    /// Roots inside this one, which their own lists hold.
    nested: HashSet<String>,
    budget: usize,
    cancel: Arc<AtomicBool>,
    /// Folders the last walk entered, or zero; the percent counts against it.
    known_folders: u32,
    /// Show files as they are found: a first index has no list to answer from.
    publish: bool,
}

/// What a walk found.
#[derive(Default)]
struct Walked {
    entries: Vec<FileEntry>,
    folders: u32,
    unreadable: u32,
    cut: bool,
    stopped: bool,
}

/// What the disk says about one path.
enum Fresh {
    /// Not a file or folder the index holds, or not there now.
    Gone,
    /// Nothing to change: excluded, or a folder that only "changed".
    Ignore,
    File(FileEntry),
    /// A folder, and the files below it.
    Folder(Vec<FileEntry>),
}

enum Job {
    /// Bring a root up to date with the disk.
    Scan(u64),
    /// Read a folder again, for the root around a root that was removed.
    Resync(PathBuf),
    /// Look at the cache timer.
    Wake,
}

#[derive(Debug, Default)]
struct Progress {
    total: usize,
    done: usize,
    fraction: f32,
    sent: Option<(Status, Instant)>,
}

/// Everything the worker, the watcher and the callers share.
struct Shared {
    ignore_case: bool,
    cap: AtomicUsize,
    roots: RwLock<Roots>,
    cache_dir: Mutex<Option<PathBuf>>,
    /// Held while a cache file is written or deleted, so a root removed during a write cannot
    /// leave its file behind.
    cache_io: Mutex<()>,
    save_at: Mutex<Option<Instant>>,
    progress: Mutex<Progress>,
    sink: Mutex<Option<StatusSink>>,
    queue: Mutex<Option<Sender<Job>>>,
    watching: Mutex<Option<watch::Watching>>,
    /// False in tests that must not start a real watcher.
    watch_enabled: AtomicBool,
    /// How many walks the worker has finished and how long it has spent walking, for the perf
    /// harness, which has to show that typing happened while Rust was really reading.
    #[cfg(feature = "perf")]
    walk_stats: Mutex<WalkStats>,
}

#[cfg(feature = "perf")]
#[derive(Debug, Default)]
struct WalkStats {
    done: u64,
    busy: Duration,
    running_since: Option<Instant>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Shared {
    fn read(&self) -> RwLockReadGuard<'_, Roots> {
        self.roots.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> RwLockWriteGuard<'_, Roots> {
        self.roots.write().unwrap_or_else(PoisonError::into_inner)
    }

    fn cap(&self) -> usize {
        self.cap.load(Atomic::Relaxed)
    }

    fn cache_dir(&self) -> Option<PathBuf> {
        lock(&self.cache_dir).clone()
    }

    fn key(&self, text: &str) -> String {
        if self.ignore_case {
            text.to_lowercase()
        } else {
            text.to_owned()
        }
    }

    // ---- status ------------------------------------------------------------------------

    fn status(&self) -> Status {
        let cut = self
            .read()
            .list
            .iter()
            .filter(|root| root.cut)
            .map(|root| root.label.clone())
            .collect();
        let progress = lock(&self.progress);
        let indexing = progress.total > progress.done;
        let percent = if indexing {
            let share = (progress.done as f32 + progress.fraction) / progress.total as f32;
            (share * 100.0).clamp(0.0, 99.0) as u8
        } else {
            0
        };
        Status {
            indexing,
            percent,
            cut,
        }
    }

    /// Tells the page, unless nothing changed or it heard a moment ago and only the percent moved.
    fn emit(&self, force: bool) {
        let status = self.status();
        {
            let mut progress = lock(&self.progress);
            if let Some((last, at)) = &progress.sent {
                if *last == status {
                    return;
                }
                let steady = last.indexing == status.indexing && last.cut == status.cut;
                if !force && steady && at.elapsed() < STATUS_EVERY {
                    return;
                }
            }
            progress.sent = Some((status.clone(), Instant::now()));
        }
        if let Some(sink) = lock(&self.sink).as_ref() {
            sink(status);
        }
    }

    fn job_queued(&self) {
        lock(&self.progress).total += 1;
        self.emit(true);
    }

    fn set_fraction(&self, fraction: f32) {
        lock(&self.progress).fraction = fraction.clamp(0.0, 1.0);
        self.emit(false);
    }

    fn job_ended(&self) {
        {
            let mut progress = lock(&self.progress);
            progress.done += 1;
            progress.fraction = 0.0;
            if progress.done >= progress.total {
                progress.total = 0;
                progress.done = 0;
            }
        }
        self.emit(true);
    }

    // ---- the worker --------------------------------------------------------------------

    /// Hands the worker a job, starting it the first time. Without a worker (in a test that runs
    /// scans itself) the job is dropped.
    fn send(self: &Arc<Self>, job: Job) {
        let mut queue = lock(&self.queue);
        if queue.is_none() {
            let (tx, rx) = mpsc::channel();
            let weak = Arc::downgrade(self);
            let started = std::thread::Builder::new()
                .name("mdmate-index".into())
                .spawn(move || worker(&weak, &rx));
            if started.is_err() {
                return;
            }
            *queue = Some(tx);
        }
        if let Some(tx) = queue.as_ref() {
            let _ = tx.send(job);
        }
    }

    /// Asks for a walk of a root; one already waiting or running is asked to go round again.
    fn queue_scan(self: &Arc<Self>, id: u64) {
        {
            let mut st = self.write();
            let Some(root) = st.get_mut(id) else { return };
            if root.queued {
                root.again = true;
                return;
            }
            root.queued = true;
        }
        self.job_queued();
        self.send(Job::Scan(id));
    }

    fn save_due(&self) -> Option<Instant> {
        *lock(&self.save_at)
    }

    fn schedule_save(self: &Arc<Self>) {
        {
            let mut at = lock(&self.save_at);
            if at.is_none() {
                *at = Some(Instant::now() + SAVE_DELAY);
            }
        }
        // The worker may be waiting with no timer.
        if lock(&self.queue).is_some() {
            self.send(Job::Wake);
        }
    }

    /// Writes the cache file of every root whose list is complete and behind its file.
    fn save_dirty(&self) {
        *lock(&self.save_at) = None;
        let Some(dir) = self.cache_dir() else { return };
        let due: Vec<(u64, String, Vec<u8>)> = {
            let mut st = self.write();
            st.list
                .iter_mut()
                .filter(|root| root.dirty && root.phase == Phase::Ready && root.sorted)
                .map(|root| {
                    root.dirty = false;
                    (
                        root.id,
                        root.shown.clone(),
                        cachefile::encode(&root.shown, root.folders, root.cut, &root.entries),
                    )
                })
                .collect()
        };
        for (id, shown, bytes) in due {
            let _io = lock(&self.cache_io);
            // The root may have been removed while its file was being made.
            if self.read().position(id).is_none() {
                continue;
            }
            if cachefile::save(&dir, &shown, &bytes).is_err()
                && let Some(root) = self.write().get_mut(id)
            {
                root.dirty = true;
            }
        }
    }

    // ---- walking -----------------------------------------------------------------------

    fn is_nested(&self, plan: &ScanPlan, dir: &Path) -> bool {
        !plan.nested.is_empty() && plan.nested.contains(&self.key(&display_path(dir)))
    }

    /// Reads one root from the disk. The top level is listed first, so a first index can say how
    /// many of its top-level entries are done.
    fn walk_root(&self, plan: &ScanPlan) -> Walked {
        let mut out = Walked::default();
        let stop = || plan.cancel.load(Atomic::Relaxed);
        let Ok(listing) = std::fs::read_dir(&plan.path) else {
            out.unreadable = 1;
            return out;
        };
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        for entry in listing.flatten() {
            let name = entry.file_name();
            if name.eq_ignore_ascii_case(SKIPPED) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                let path = entry.path();
                if !is_excluded_dir(&name) && !self.is_nested(plan, &path) {
                    dirs.push(path);
                }
            } else if kind.is_file() {
                files.push(entry);
            }
        }
        let top_total = files.len() + dirs.len();
        let folders = Cell::new(1 + u32::try_from(dirs.len()).unwrap_or(0));
        let top_done = Cell::new(0_usize);
        let mut published = 0;
        let mut reported = Instant::now();
        let progress = |folders: u32, top_done: usize| {
            self.set_fraction(walk_share(plan.known_folders, folders, top_done, top_total));
        };
        for listed in files {
            if stop() {
                out.stopped = true;
                return out;
            }
            if out.entries.len() >= plan.budget {
                out.cut = true;
                break;
            }
            if let Some(entry) = entry_from_listing(&plan.path, &listed.path(), &listed) {
                out.entries.push(entry);
            }
            top_done.set(top_done.get() + 1);
        }
        for dir in dirs {
            if out.cut {
                break;
            }
            let mut cut = false;
            walk_entries(
                &dir,
                Scope::Everything,
                stop,
                |folder| {
                    folders.set(folders.get() + 1);
                    self.is_nested(plan, folder)
                },
                |path, listed| {
                    if out.entries.len() >= plan.budget {
                        cut = true;
                        return false;
                    }
                    if let Some(entry) = entry_from_listing(&plan.path, path, listed) {
                        out.entries.push(entry);
                    }
                    if plan.publish && out.entries.len() - published >= PARTIAL_BATCH {
                        self.publish_partial(plan.id, &out.entries[published..]);
                        published = out.entries.len();
                    }
                    if reported.elapsed() >= Duration::from_millis(50) {
                        reported = Instant::now();
                        progress(folders.get(), top_done.get());
                    }
                    true
                },
            );
            out.cut |= cut;
            top_done.set(top_done.get() + 1);
            progress(folders.get(), top_done.get());
            if stop() {
                out.stopped = true;
                return out;
            }
        }
        if plan.publish && published < out.entries.len() {
            self.publish_partial(plan.id, &out.entries[published..]);
        }
        out.folders = folders.get();
        out
    }

    /// Adds the files a first index has found so far to the list Quick Open answers from.
    fn publish_partial(&self, id: u64, found: &[FileEntry]) {
        let mut st = self.write();
        if let Some(root) = st.get_mut(id)
            && root.phase == Phase::Empty
        {
            root.sorted = false;
            root.entries.extend_from_slice(found);
        }
    }

    /// Reads the disk for one root and replaces its list with what it finds.
    fn scan(self: &Arc<Self>, id: u64) {
        self.scan_root(id);
        let again = {
            let mut st = self.write();
            match st.get_mut(id) {
                Some(root) => {
                    root.scanning = false;
                    let again = std::mem::take(&mut root.again) || root.journal_full;
                    root.journal_full = false;
                    root.journal.clear();
                    root.queued = again;
                    again
                }
                None => false,
            }
        };
        if again {
            self.job_queued();
            self.send(Job::Scan(id));
        }
        self.job_ended();
    }

    fn scan_root(self: &Arc<Self>, id: u64) {
        #[cfg(feature = "perf")]
        {
            lock(&self.walk_stats).running_since = Some(Instant::now());
        }
        self.scan_root_inner(id);
        #[cfg(feature = "perf")]
        {
            let mut stats = lock(&self.walk_stats);
            if let Some(since) = stats.running_since.take() {
                stats.busy += since.elapsed();
            }
            stats.done += 1;
        }
    }

    fn scan_root_inner(self: &Arc<Self>, id: u64) {
        let Some(mut plan) = self.begin_scan(id) else {
            return;
        };
        // A root with nothing yet answers from its cache file while the walk goes; one with
        // neither fills in as the walk finds files.
        let first = self.adopt_cache(&mut plan);
        plan.publish = first;
        if first {
            plan.known_folders = 0;
        }
        self.emit(true);
        let walked = self.walk_root(&plan);
        if walked.stopped {
            return;
        }
        self.finish(id, walked);
        self.schedule_save();
    }

    /// Marks a root as being walked and says what the walk is to do. `None` for a root that is gone.
    fn begin_scan(&self, id: u64) -> Option<ScanPlan> {
        let mut st = self.write();
        let pos = st.position(id)?;
        let cap = self.cap();
        let others = st.total() - st.list[pos].entries.len();
        let nested = self.nested_of(&st, pos);
        let root = &mut st.list[pos];
        root.scanning = true;
        root.journal.clear();
        root.journal_full = false;
        Some(ScanPlan {
            id,
            path: root.path.clone(),
            nested: nested
                .iter()
                .map(|path| self.key(&display_path(path)))
                .collect(),
            budget: cap.saturating_sub(others),
            cancel: root.cancel.clone(),
            known_folders: root.folders,
            publish: false,
        })
    }

    /// Fills a root that has nothing yet from its cache file. True when the root is empty and has
    /// no good cache file, so it is a first index; false when there is a list to answer from.
    fn adopt_cache(&self, plan: &mut ScanPlan) -> bool {
        let empty = self
            .read()
            .list
            .iter()
            .find(|root| root.id == plan.id)
            .is_some_and(|root| root.phase == Phase::Empty && root.entries.is_empty());
        if !empty {
            return false;
        }
        let shown = display_path(&plan.path);
        let Some(cached) = self
            .cache_dir()
            .and_then(|dir| cachefile::load(&dir, &shown))
        else {
            return true;
        };
        let mut st = self.write();
        if let Some(root) = st.get_mut(plan.id)
            && root.phase == Phase::Empty
            && root.entries.is_empty()
        {
            root.entries = cached.entries;
            root.sorted = true;
            root.phase = Phase::Loaded;
            root.cut = cached.cut;
            root.folders = cached.folders;
            plan.known_folders = cached.folders;
        }
        false
    }

    /// Roots strictly inside the root at `pos`.
    fn nested_of(&self, st: &Roots, pos: usize) -> Vec<PathBuf> {
        let outer = &st.list[pos];
        st.list
            .iter()
            .enumerate()
            .filter(|&(i, root)| {
                i != pos
                    && below(&root.shown, &outer.shown, self.ignore_case)
                        .is_some_and(|rel| !rel.is_empty())
            })
            .map(|(_, root)| root.path.clone())
            .collect()
    }

    /// Puts a finished walk in place of the list, then replays what changed while it ran.
    fn finish(self: &Arc<Self>, id: u64, walked: Walked) {
        {
            let mut st = self.write();
            let Some(pos) = st.position(id) else { return };
            let nested: Vec<String> = self
                .nested_of(&st, pos)
                .iter()
                .filter_map(|path| {
                    below(&display_path(path), &st.list[pos].shown, self.ignore_case)
                        .map(std::borrow::Cow::into_owned)
                })
                .collect();
            let root = &mut st.list[pos];
            // A folder that could not be read at all (a drive that went away) says nothing about
            // what is in it, so a list that was loaded from the cache stays as it is.
            if walked.unreadable > 0 && walked.entries.is_empty() && root.phase == Phase::Loaded {
                root.unreadable = walked.unreadable;
                return;
            }
            let mut entries = walked.entries;
            // A root added while the walk ran sits inside this one now; its files are its own.
            if !nested.is_empty() {
                let prefixes: Vec<String> = nested.iter().map(|rel| format!("{rel}/")).collect();
                entries
                    .retain(|entry| !prefixes.iter().any(|prefix| entry.rel.starts_with(prefix)));
            }
            entries.sort_unstable_by(|a, b| cmp_rel(&a.rel, &b.rel));
            root.entries = entries;
            root.sorted = true;
            root.phase = Phase::Ready;
            root.cut = walked.cut;
            root.folders = walked.folders;
            root.unreadable = walked.unreadable;
            root.dirty = true;
        }
        self.replay(id);
        self.emit(true);
    }

    /// Reads every path that changed while a walk ran, until none is left.
    fn replay(self: &Arc<Self>, id: u64) {
        for _ in 0..8 {
            let batch = {
                let mut st = self.write();
                let Some(root) = st.get_mut(id) else { return };
                std::mem::take(&mut root.journal)
            };
            if batch.is_empty() {
                return;
            }
            for (rel, structural) in batch {
                let Some(located) = self.locate_rel(id, &rel) else {
                    return;
                };
                let fresh = self.read_path(&located, structural);
                self.apply(id, &rel, structural, fresh, false);
            }
        }
    }

    // ---- changes -----------------------------------------------------------------------

    /// The root that holds `path` (the innermost one) and the path below it.
    fn locate(&self, path: &Path) -> Option<Located> {
        let shown = display_path(path);
        let st = self.read();
        let (pos, rel) = st
            .list
            .iter()
            .enumerate()
            .filter_map(|(i, root)| {
                below(&shown, &root.shown, self.ignore_case).map(|rel| (i, rel.into_owned()))
            })
            .max_by_key(|&(i, _)| st.list[i].shown.len())?;
        Some(self.located(&st, pos, rel))
    }

    fn locate_rel(&self, id: u64, rel: &str) -> Option<Located> {
        let st = self.read();
        let pos = st.position(id)?;
        Some(self.located(&st, pos, rel.to_owned()))
    }

    fn located(&self, st: &Roots, pos: usize, rel: String) -> Located {
        let nested = self.nested_of(st, pos);
        Located {
            id: st.list[pos].id,
            root: st.list[pos].path.clone(),
            nested: nested
                .iter()
                .map(|path| self.key(&display_path(path)))
                .collect(),
            rel,
        }
    }

    /// What the disk says about the path a change names.
    fn read_path(&self, at: &Located, structural: bool) -> Fresh {
        let rel = at.rel.as_str();
        if rel.is_empty() || has_excluded_folder(rel) {
            return Fresh::Ignore;
        }
        let path = abs_of(&at.root, rel);
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            return Fresh::Gone;
        };
        let kind = meta.file_type();
        let name = path.file_name().unwrap_or_default();
        if kind.is_symlink() {
            return Fresh::Gone;
        }
        if name.eq_ignore_ascii_case(SKIPPED) {
            return Fresh::Ignore;
        }
        if kind.is_file() {
            return Fresh::File(entry_of(rel.to_owned(), &path, &meta));
        }
        if !kind.is_dir() || is_excluded_dir(name) || !structural {
            return Fresh::Ignore;
        }
        if at.nested.contains(&self.key(&display_path(&path))) {
            return Fresh::Ignore;
        }
        let mut found = Vec::new();
        walk_entries(
            &path,
            Scope::Everything,
            || false,
            |folder| at.nested.contains(&self.key(&display_path(folder))),
            |file, listed| {
                if let Some(entry) = entry_from_listing(&at.root, file, listed) {
                    found.push(entry);
                }
                true
            },
        );
        Fresh::Folder(found)
    }

    /// Puts what the disk said into the live list, and into the journal while a walk runs.
    fn apply(self: &Arc<Self>, id: u64, rel: &str, structural: bool, fresh: Fresh, journal: bool) {
        let changed = {
            let mut st = self.write();
            let cap = self.cap();
            let total = st.total();
            let Some(root) = st.get_mut(id) else { return };
            if journal {
                root.note(rel, structural);
            }
            // A first index in progress is not in order; the walk and the journal will cover this.
            if !root.sorted {
                return;
            }
            let mut changed = false;
            match fresh {
                Fresh::Ignore => {}
                Fresh::Gone => changed = root.remove_tree(rel, self.ignore_case),
                Fresh::File(entry) => {
                    // A file that took the place of a folder: what was held below it is gone.
                    changed |= root.remove_below(rel, self.ignore_case);
                    if total < cap || root.find(&entry.rel).is_ok() {
                        changed |= root.upsert(entry);
                    } else {
                        root.cut = true;
                    }
                }
                Fresh::Folder(entries) => {
                    changed |= root.remove_tree(rel, self.ignore_case);
                    let room = cap.saturating_sub(total);
                    if entries.len() > room {
                        root.cut = true;
                    }
                    let added = entries.len().min(room);
                    changed |= added > 0;
                    root.entries.extend(entries.into_iter().take(room));
                    root.entries
                        .sort_unstable_by(|a, b| cmp_rel(&a.rel, &b.rel));
                }
            }
            if changed {
                root.dirty = true;
            }
            changed
        };
        if changed {
            self.schedule_save();
        }
    }

    /// Reads `path` again and brings the index in line with it.
    fn changed(self: &Arc<Self>, path: &Path, structural: bool) {
        let Some(at) = self.locate(path) else { return };
        let fresh = self.read_path(&at, structural);
        self.apply(at.id, &at.rel, structural, fresh, true);
        self.emit(false);
    }

    /// Takes out a file or a folder's files.
    fn removed(self: &Arc<Self>, path: &Path) {
        let Some(at) = self.locate(path) else { return };
        if at.rel.is_empty() {
            return;
        }
        self.apply(at.id, &at.rel, true, Fresh::Gone, true);
    }

    /// Moves what is held under `from` to `to`, with no read of the disk when the files are known.
    fn moved(self: &Arc<Self>, from: &Path, to: &Path) {
        let taken = self.take_tree(from);
        let Some(landing) = self.locate(to) else {
            return;
        };
        if taken.is_empty() {
            // A file the index did not hold, an empty folder, or a folder that was excluded:
            // look at the new place.
            self.changed(to, true);
            return;
        }
        let mut dirty = false;
        let mut by_root: Vec<(u64, Vec<FileEntry>)> = Vec::new();
        for (suffix, mut entry) in taken {
            let target = if suffix.is_empty() {
                to.to_path_buf()
            } else {
                abs_of(to, &suffix)
            };
            let Some(at) = self.locate(&target) else {
                continue;
            };
            if has_excluded_folder(&at.rel) || at.rel.is_empty() {
                continue;
            }
            entry.kind = kind_of(Path::new(&at.rel));
            entry.rel = at.rel.into_boxed_str();
            match by_root.iter_mut().find(|(id, _)| *id == at.id) {
                Some((_, list)) => list.push(entry),
                None => by_root.push((at.id, vec![entry])),
            }
        }
        {
            let mut st = self.write();
            let cap = self.cap();
            let mut total = st.total();
            for (id, list) in by_root {
                let Some(root) = st.get_mut(id) else { continue };
                root.note(&landing.rel, true);
                if !root.sorted {
                    continue;
                }
                for entry in list {
                    if total >= cap {
                        root.cut = true;
                        break;
                    }
                    total += usize::from(root.find(&entry.rel).is_err());
                    dirty |= root.upsert(entry);
                }
                root.dirty |= dirty;
            }
        }
        if dirty {
            self.schedule_save();
        }
    }

    /// Removes and returns every entry at or under `path`, with its path below `path`.
    fn take_tree(self: &Arc<Self>, path: &Path) -> Vec<(String, FileEntry)> {
        let Some(at) = self.locate(path) else {
            return Vec::new();
        };
        if at.rel.is_empty() {
            return Vec::new();
        }
        let mut st = self.write();
        let Some(root) = st.get_mut(at.id) else {
            return Vec::new();
        };
        root.note(&at.rel, true);
        if !root.sorted {
            return Vec::new();
        }
        let below = format!("{}/", at.rel);
        let ignore_case = self.ignore_case;
        let matches = |rel: &str| -> Option<String> {
            if rel == at.rel || (ignore_case && rel.eq_ignore_ascii_case(&at.rel)) {
                return Some(String::new());
            }
            let head = rel.get(..below.len())?;
            let same = if ignore_case {
                head.eq_ignore_ascii_case(&below)
            } else {
                head == below
            };
            same.then(|| rel[below.len()..].to_owned())
        };
        let mut taken = Vec::new();
        let mut kept = Vec::with_capacity(root.entries.len());
        for entry in std::mem::take(&mut root.entries) {
            match matches(&entry.rel) {
                Some(suffix) => taken.push((suffix, entry)),
                None => kept.push(entry),
            }
        }
        root.entries = kept;
        if !taken.is_empty() {
            root.dirty = true;
        }
        taken
    }

    // ---- the watcher -------------------------------------------------------------------

    /// True when an event for this path matters to some root.
    fn is_relevant(&self, path: &Path) -> bool {
        self.locate(path)
            .is_some_and(|at| !at.rel.is_empty() && !has_excluded_folder(&at.rel))
    }

    /// Makes the watcher cover exactly the roots that no other root contains.
    fn refresh_watch(self: &Arc<Self>) {
        if !self.watch_enabled.load(Atomic::Relaxed) {
            return;
        }
        let top: Vec<PathBuf> = {
            let st = self.read();
            st.list
                .iter()
                .filter(|root| {
                    !st.list.iter().any(|other| {
                        other.id != root.id
                            && below(&root.shown, &other.shown, self.ignore_case)
                                .is_some_and(|rel| !rel.is_empty())
                    })
                })
                .map(|root| PathBuf::from(&root.shown))
                .collect()
        };
        let mut watching = lock(&self.watching);
        if watching.is_none() && !top.is_empty() {
            let (weak_relevant, weak_batch) = (Arc::downgrade(self), Arc::downgrade(self));
            *watching = watch::Watching::start(
                Box::new(move |path| {
                    weak_relevant
                        .upgrade()
                        .is_some_and(|shared| shared.is_relevant(path))
                }),
                Box::new(move |batch| {
                    if let Some(shared) = weak_batch.upgrade() {
                        shared.on_batch(batch);
                    }
                }),
            )
            .ok();
        }
        if let Some(watching) = watching.as_ref() {
            watching.set_roots(&top);
        }
    }

    /// What the watcher gathered: read each path, or, when events may have been lost, each root.
    fn on_batch(self: &Arc<Self>, batch: watch::Batch) {
        if batch.rescan || batch.events >= BURST {
            let ids: Vec<u64> = {
                let st = self.read();
                if batch.rescan && batch.paths.is_empty() {
                    st.list.iter().map(|root| root.id).collect()
                } else {
                    let mut ids = Vec::new();
                    for path in batch.paths.keys() {
                        let shown = display_path(path);
                        let owner = st
                            .list
                            .iter()
                            .filter(|root| below(&shown, &root.shown, self.ignore_case).is_some())
                            .max_by_key(|root| root.shown.len());
                        if let Some(root) = owner
                            && !ids.contains(&root.id)
                        {
                            ids.push(root.id);
                        }
                    }
                    ids
                }
            };
            for id in ids {
                self.queue_scan(id);
            }
            return;
        }
        // A folder that was created, removed or renamed is read whole, so the paths under it that
        // were also reported need no read of their own.
        let mut covered: Option<&PathBuf> = None;
        for (path, structural) in &batch.paths {
            if covered.is_some_and(|folder| path.starts_with(folder)) {
                continue;
            }
            if *structural {
                covered = Some(path);
            }
            self.changed(path, *structural);
        }
    }
}

/// Where a path is in the index.
struct Located {
    id: u64,
    root: PathBuf,
    /// Roots inside the root, as compared keys.
    nested: HashSet<String>,
    rel: String,
}

fn worker(weak: &Weak<Shared>, rx: &Receiver<Job>) {
    loop {
        let wait = {
            let Some(shared) = weak.upgrade() else { return };
            shared
                .save_due()
                .map(|at| at.saturating_duration_since(Instant::now()))
        };
        let message = match wait {
            Some(wait) => rx.recv_timeout(wait),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        let Some(shared) = weak.upgrade() else { return };
        match message {
            Ok(Job::Scan(id)) => shared.scan(id),
            Ok(Job::Resync(path)) => shared.changed(&path, true),
            Ok(Job::Wake) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if shared.save_due().is_some_and(|at| at <= Instant::now()) {
            shared.save_dirty();
        }
    }
}

/// The workspace index the app keeps.
pub(crate) struct WorkspaceIndex {
    shared: Arc<Shared>,
}

impl std::fmt::Debug for WorkspaceIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WorkspaceIndex")
    }
}

impl WorkspaceIndex {
    pub(crate) fn new(ignore_case: bool) -> Self {
        Self {
            shared: Arc::new(Shared {
                ignore_case,
                cap: AtomicUsize::new(MAX_FILES),
                roots: RwLock::new(Roots::default()),
                cache_dir: Mutex::new(None),
                cache_io: Mutex::new(()),
                save_at: Mutex::new(None),
                progress: Mutex::new(Progress::default()),
                sink: Mutex::new(None),
                queue: Mutex::new(None),
                watching: Mutex::new(None),
                watch_enabled: AtomicBool::new(true),
                #[cfg(feature = "perf")]
                walk_stats: Mutex::new(WalkStats::default()),
            }),
        }
    }

    /// Where the cache files go. Without it the index lives in memory only.
    pub(crate) fn set_cache_dir(&self, dir: PathBuf) {
        *lock(&self.shared.cache_dir) = Some(dir);
    }

    /// Hands `read` the files of every root, and whether any root was cut at the file limit. The
    /// lists are read where they are, under a read lock that waits out an update in progress and
    /// holds the next one off until `read` returns, so `read` should be quick. Nothing is walked.
    pub(crate) fn listings<R>(&self, read: impl FnOnce(&[Listing<'_>], bool) -> R) -> R {
        let st = self.shared.read();
        let several = st.list.len() > 1;
        let lists: Vec<Listing<'_>> = st
            .list
            .iter()
            .map(|root| Listing {
                prefix: if several {
                    format!("{}/", root.label)
                } else {
                    String::new()
                },
                root: &root.path,
                entries: &root.entries,
            })
            .collect();
        read(&lists, st.list.iter().any(|root| root.cut))
    }

    /// The files of `scope` under `root`, in path order, when the index holds the root whole: it has
    /// finished reading it and did not stop at the file limit. Otherwise None, and the caller walks
    /// the folder itself, which is what it did before there was an index. Files of a root inside
    /// `root` belong to that root and are not here; a caller that goes through every root reads them
    /// from there.
    pub(crate) fn files_of(&self, root: &Path, scope: Scope) -> Option<Vec<PathBuf>> {
        let shared = &self.shared;
        let key = shared.key(&display_path(root));
        let st = shared.read();
        let held = st
            .list
            .iter()
            .find(|held| shared.key(&held.shown) == key)
            .filter(|held| held.phase == Phase::Ready && !held.cut)?;
        Some(
            held.entries
                .iter()
                .filter(|entry| scope.offers(Path::new(&*entry.rel)))
                .map(|entry| abs_of(&held.path, &entry.rel))
                .collect(),
        )
    }

    /// Files held across every root.
    #[cfg(feature = "perf")]
    pub(crate) fn file_count(&self) -> usize {
        self.shared.read().total()
    }

    /// Replaces who hears the status, and tells the new listener where things stand.
    pub(crate) fn set_status_sink(&self, sink: StatusSink) {
        sink(self.shared.status());
        *lock(&self.shared.sink) = Some(sink);
    }

    #[cfg(any(test, feature = "perf"))]
    pub(crate) fn status(&self) -> Status {
        self.shared.status()
    }

    /// Starts indexing a folder in the background. A folder that is already a root changes nothing.
    pub(crate) fn add_root(&self, path: &Path) {
        if let Some(id) = self.register(path) {
            self.shared.queue_scan(id);
        }
        self.shared.refresh_watch();
    }

    /// Records a root without reading it.
    fn register(&self, path: &Path) -> Option<u64> {
        let shared = &self.shared;
        let shown = display_path(path);
        let mut st = shared.write();
        if st
            .list
            .iter()
            .any(|root| shared.key(&root.shown) == shared.key(&shown))
        {
            return None;
        }
        st.next_id += 1;
        let root = RootIndex::new(st.next_id, path);
        // The root around this one no longer holds its files.
        for outer in &mut st.list {
            if let Some(rel) = below(&root.shown, &outer.shown, shared.ignore_case)
                && !rel.is_empty()
            {
                outer.note(&rel, true);
                if outer.remove_tree(&rel, shared.ignore_case) {
                    outer.dirty = true;
                }
            }
        }
        let id = root.id;
        st.list.push(root);
        drop(st);
        shared.schedule_save();
        Some(id)
    }

    /// Stops indexing a folder and deletes its cache file.
    pub(crate) fn remove_root(&self, path: &Path) {
        let shared = &self.shared;
        let shown = display_path(path);
        let removed = {
            let mut st = shared.write();
            let Some(pos) = st
                .list
                .iter()
                .position(|root| shared.key(&root.shown) == shared.key(&shown))
            else {
                return;
            };
            let root = st.list.remove(pos);
            root.cancel.store(true, Atomic::Relaxed);
            let outer = st.list.iter().any(|other| {
                below(&root.shown, &other.shown, shared.ignore_case)
                    .is_some_and(|rel| !rel.is_empty())
            });
            (root, outer)
        };
        let (root, outer) = removed;
        if let Some(dir) = shared.cache_dir() {
            let _io = lock(&shared.cache_io);
            cachefile::delete(&dir, &root.shown);
        }
        if outer {
            shared.send(Job::Resync(root.path.clone()));
        }
        shared.refresh_watch();
        shared.emit(true);
    }

    /// Walks finished so far and the milliseconds spent walking, counting the walk in progress.
    #[cfg(feature = "perf")]
    pub(crate) fn walk_stats(&self) -> (u64, f64) {
        let stats = lock(&self.shared.walk_stats);
        let running = stats
            .running_since
            .map_or(Duration::ZERO, |since| since.elapsed());
        (stats.done, (stats.busy + running).as_secs_f64() * 1000.0)
    }

    /// Reads a root again and replaces its list with what the disk holds. False when no root is
    /// registered under that path.
    #[cfg(feature = "perf")]
    pub(crate) fn reconcile(&self, path: &Path) -> bool {
        let shown = display_path(path);
        let id = self
            .shared
            .read()
            .list
            .iter()
            .find(|root| self.shared.key(&root.shown) == self.shared.key(&shown))
            .map(|root| root.id);
        let Some(id) = id else { return false };
        self.shared.queue_scan(id);
        true
    }

    /// A file or folder was made here by mdmate itself, or may have changed.
    pub(crate) fn changed(&self, path: &Path) {
        self.shared.changed(path, true);
    }

    /// A file or folder was deleted by mdmate itself.
    pub(crate) fn removed(&self, path: &Path) {
        self.shared.removed(path);
    }

    /// A file or folder was renamed or moved by mdmate itself.
    pub(crate) fn moved(&self, from: &Path, to: &Path) {
        self.shared.moved(from, to);
    }

    /// Writes every cache file that is behind its list, now.
    pub(crate) fn flush_cache(&self) {
        self.shared.save_dirty();
    }

    // ---- for tests ---------------------------------------------------------------------

    /// Lowers the file limit.
    #[cfg(test)]
    pub(crate) fn set_cap(&self, cap: usize) {
        self.shared.cap.store(cap, Atomic::Relaxed);
    }

    /// Stops the real watcher from starting, for tests that feed it events themselves.
    #[cfg(test)]
    pub(crate) fn without_watcher(self) -> Self {
        self.shared.watch_enabled.store(false, Atomic::Relaxed);
        self
    }

    /// The shared state, for tests that drive the steps of a scan themselves.
    #[cfg(test)]
    fn shared(&self) -> &Arc<Shared> {
        &self.shared
    }

    /// The id a root was given, if it is one.
    #[cfg(test)]
    fn id_of(&self, path: &Path) -> Option<u64> {
        let shown = display_path(path);
        self.shared
            .read()
            .list
            .iter()
            .find(|root| self.shared.key(&root.shown) == self.shared.key(&shown))
            .map(|root| root.id)
    }

    /// Records a root without reading it.
    #[cfg(test)]
    pub(crate) fn register_only(&self, path: &Path) -> Option<u64> {
        self.register(path)
    }

    /// Fills a recorded root from its cache file, as the start of a scan does.
    #[cfg(test)]
    pub(crate) fn load_cached_now(&self, path: &Path) -> bool {
        let Some(id) = self.id_of(path) else {
            return false;
        };
        let Some(mut plan) = self.shared.begin_scan(id) else {
            return false;
        };
        let first = self.shared.adopt_cache(&mut plan);
        if let Some(root) = self.shared.write().get_mut(id) {
            root.scanning = false;
        }
        !first
    }

    /// Records a root and reads it on this thread, so a test sees a finished index.
    #[cfg(test)]
    pub(crate) fn add_root_now(&self, path: &Path) {
        if let Some(id) = self.register(path) {
            self.scan_now(id);
        }
        self.shared.refresh_watch();
    }

    #[cfg(test)]
    fn scan_now(&self, id: u64) {
        {
            let mut st = self.shared.write();
            if let Some(root) = st.get_mut(id) {
                root.queued = true;
            }
        }
        self.shared.job_queued();
        self.shared.scan(id);
    }

    /// Reads a root again on this thread.
    #[cfg(test)]
    pub(crate) fn reconcile_now(&self, path: &Path) {
        let shown = display_path(path);
        let id = self
            .shared
            .read()
            .list
            .iter()
            .find(|root| self.shared.key(&root.shown) == self.shared.key(&shown))
            .map(|root| root.id);
        if let Some(id) = id {
            self.scan_now(id);
        }
    }

    /// The paths a root holds, in the list's order.
    #[cfg(test)]
    pub(crate) fn rels(&self, path: &Path) -> Vec<String> {
        let shown = display_path(path);
        self.shared
            .read()
            .list
            .iter()
            .find(|root| self.shared.key(&root.shown) == self.shared.key(&shown))
            .map(|root| {
                root.entries
                    .iter()
                    .map(|entry| entry.rel.to_string())
                    .collect()
            })
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub(crate) fn entries(&self, path: &Path) -> Vec<FileEntry> {
        let shown = display_path(path);
        self.shared
            .read()
            .list
            .iter()
            .find(|root| self.shared.key(&root.shown) == self.shared.key(&shown))
            .map(|root| root.entries.clone())
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn feed(&self, batch: watch::Batch) {
        self.shared.on_batch(batch);
    }

    #[cfg(test)]
    pub(crate) fn is_ready(&self, path: &Path) -> bool {
        let shown = display_path(path);
        self.shared
            .read()
            .list
            .iter()
            .find(|root| self.shared.key(&root.shown) == self.shared.key(&shown))
            .is_some_and(|root| root.phase == Phase::Ready)
    }
}
