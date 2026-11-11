//! Telling the sidebar when a folder it shows changes.
//!
//! The open documents have a watcher of their own (`watch.rs`) that compares content. This one is
//! for the tree: the page says which folders are open on screen, Rust watches exactly those, not
//! recursively, and reports the folder whose listing is now out of date. The page lists it again.
//! Watching only what is on screen keeps a workspace with `node_modules` in it cheap.

use crate::access::display_path;
use crate::error::AppError;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

/// How long a folder must stay quiet before it is reported. A save raises several events in a
/// row; one report after they finish is enough.
const QUIET: Duration = Duration::from_millis(150);

/// Called with the folder (as people read the path) whose listing changed.
pub(crate) type Sink = Box<dyn Fn(String) + Send + Sync>;

type Watched = Arc<Mutex<HashSet<PathBuf>>>;

pub(crate) struct FolderWatcher {
    watcher: Mutex<RecommendedWatcher>,
    watched: Watched,
    sink: Arc<Mutex<Sink>>,
}

impl std::fmt::Debug for FolderWatcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FolderWatcher")
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl FolderWatcher {
    /// Starts the watcher and the thread that turns its events into reports.
    pub(crate) fn start(sink: Sink) -> Result<Self, AppError> {
        let (tx, rx) = mpsc::channel();
        let watcher =
            notify::recommended_watcher(tx).map_err(|e| AppError::Watch(e.to_string()))?;
        let sink = Arc::new(Mutex::new(sink));
        let watched: Watched = Arc::default();
        let (reporting, known) = (Arc::clone(&sink), Arc::clone(&watched));
        std::thread::Builder::new()
            .name("mdmate-tree-watch".into())
            .spawn(move || run(&rx, &known, &reporting))
            .map_err(|e| AppError::Watch(e.to_string()))?;
        Ok(Self {
            watcher: Mutex::new(watcher),
            watched,
            sink,
        })
    }

    /// Replaces who gets told, for a page that subscribes again after reloading.
    pub(crate) fn set_sink(&self, sink: Sink) {
        *lock(&self.sink) = sink;
    }

    /// Watches exactly these folders from now on. A folder that cannot be watched (it was just
    /// deleted, say) is skipped; the page lists it again when it next opens it.
    pub(crate) fn set_folders(&self, folders: &[PathBuf]) {
        let wanted: HashSet<PathBuf> = folders.iter().cloned().collect();
        let mut watcher = lock(&self.watcher);
        let mut watched = lock(&self.watched);
        for gone in watched.difference(&wanted).cloned().collect::<Vec<_>>() {
            let _ = watcher.unwatch(&gone);
            watched.remove(&gone);
        }
        for added in wanted.difference(&watched.clone()) {
            if watcher.watch(added, RecursiveMode::NonRecursive).is_ok() {
                watched.insert(added.clone());
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn watched(&self) -> HashSet<PathBuf> {
        lock(&self.watched).clone()
    }
}

/// The folders an event for `path` makes out of date: the folder that holds it, and the path
/// itself when it is a watched folder (it may have been renamed or deleted).
fn stale_folders(path: &Path, watched: &HashSet<PathBuf>) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(parent) = path.parent() {
        folders.push(PathBuf::from(display_path(parent)));
    }
    let own = PathBuf::from(display_path(path));
    if watched.contains(&own) {
        folders.push(own);
    }
    folders
}

fn run(rx: &Receiver<notify::Result<notify::Event>>, watched: &Watched, sink: &Mutex<Sink>) {
    // Folders waiting to go quiet, with when they may be reported.
    let mut due: HashMap<PathBuf, Instant> = HashMap::new();
    loop {
        let message = match due.values().min() {
            Some(&when) => rx.recv_timeout(when.saturating_duration_since(Instant::now())),
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match message {
            Ok(Ok(event)) if !matches!(event.kind, EventKind::Access(_)) => {
                let watched = lock(watched);
                for path in &event.paths {
                    for folder in stale_folders(path, &watched) {
                        if watched.contains(&folder) {
                            due.insert(folder, Instant::now() + QUIET);
                        }
                    }
                }
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let now = Instant::now();
        let ready: Vec<PathBuf> = due
            .iter()
            .filter(|&(_, &when)| when <= now)
            .map(|(folder, _)| folder.clone())
            .collect();
        if ready.is_empty() {
            continue;
        }
        let sink = lock(sink);
        for folder in ready {
            due.remove(&folder);
            sink(folder.to_string_lossy().into_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    const WAIT: Duration = Duration::from_secs(10);

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir can be created")
    }

    fn listening() -> (FolderWatcher, Receiver<String>) {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let watcher = FolderWatcher::start(Box::new(move |folder| {
            let _ = lock(&tx).send(folder);
        }))
        .expect("the watcher starts");
        (watcher, rx)
    }

    /// The folder in the form the watcher reports: no `\\?\` prefix.
    fn shown(path: &Path) -> String {
        display_path(&std::fs::canonicalize(path).expect("exists"))
    }

    #[test]
    fn watcher_new_file_in_a_watched_folder_is_reported() {
        let dir = temp();
        let folder = PathBuf::from(shown(dir.path()));
        let (watcher, rx) = listening();
        watcher.set_folders(std::slice::from_ref(&folder));
        std::fs::write(folder.join("new.md"), b"x").expect("writes");
        let reported = rx.recv_timeout(WAIT).expect("the folder is reported");
        assert_eq!(reported, folder.to_string_lossy());
    }

    #[test]
    fn a_burst_of_changes_is_one_report() {
        let dir = temp();
        let folder = PathBuf::from(shown(dir.path()));
        let (watcher, rx) = listening();
        watcher.set_folders(std::slice::from_ref(&folder));
        for index in 0..20 {
            std::fs::write(folder.join(format!("n{index}.md")), b"x").expect("writes");
        }
        rx.recv_timeout(WAIT).expect("reported once");
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "no second report for the same burst"
        );
    }

    #[test]
    fn a_folder_the_page_did_not_ask_for_says_nothing() {
        let dir = temp();
        let (watched, other) = (dir.path().join("open"), dir.path().join("closed"));
        std::fs::create_dir(&watched).expect("creates");
        std::fs::create_dir(&other).expect("creates");
        let (watcher, rx) = listening();
        watcher.set_folders(&[PathBuf::from(shown(&watched))]);
        std::fs::write(other.join("new.md"), b"x").expect("writes");
        assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
    }

    /// Feeds `run` events a test makes up, so what it does with them can be checked without the OS.
    fn fed(
        watched: &[&str],
    ) -> (
        mpsc::Sender<notify::Result<notify::Event>>,
        Receiver<String>,
    ) {
        let (event_tx, event_rx) = mpsc::channel();
        let (report_tx, report_rx) = channel();
        let set: Watched = Arc::new(Mutex::new(watched.iter().map(PathBuf::from).collect()));
        let sink: Arc<Mutex<Sink>> = Arc::new(Mutex::new(Box::new(move |folder| {
            let _ = report_tx.send(folder);
        })));
        std::thread::spawn(move || run(&event_rx, &set, &sink));
        (event_tx, report_rx)
    }

    fn created(path: &str) -> notify::Result<notify::Event> {
        Ok(
            notify::Event::new(EventKind::Create(notify::event::CreateKind::File))
                .add_path(path.into()),
        )
    }

    #[test]
    fn an_event_is_reported_on_its_folder_only_when_that_folder_is_watched() {
        let sep = std::path::MAIN_SEPARATOR;
        let (open, closed) = (format!("{sep}w{sep}open"), format!("{sep}w{sep}closed"));
        let (events, reports) = fed(&[&open]);
        events
            .send(created(&format!("{closed}{sep}a.md")))
            .expect("sends");
        events
            .send(created(&format!("{open}{sep}sub{sep}deep.md")))
            .expect("sends");
        assert!(
            reports.recv_timeout(Duration::from_millis(700)).is_err(),
            "nothing is open there"
        );
        events
            .send(created(&format!("{open}{sep}a.md")))
            .expect("sends");
        assert_eq!(reports.recv_timeout(WAIT).expect("reported"), open);
    }

    #[test]
    fn a_watched_folder_that_changes_itself_is_reported_with_its_parent() {
        let sep = std::path::MAIN_SEPARATOR;
        let (parent, child) = (format!("{sep}w"), format!("{sep}w{sep}child"));
        let (events, reports) = fed(&[&parent, &child]);
        events.send(created(&child)).expect("sends");
        let mut seen = HashSet::new();
        while let Ok(folder) = reports.recv_timeout(Duration::from_millis(700)) {
            seen.insert(folder);
        }
        assert_eq!(seen, HashSet::from([parent, child]));
    }

    #[test]
    fn events_in_a_burst_are_one_report_per_folder() {
        let sep = std::path::MAIN_SEPARATOR;
        let open = format!("{sep}w{sep}open");
        let (events, reports) = fed(&[&open]);
        for index in 0..50 {
            events
                .send(created(&format!("{open}{sep}n{index}.md")))
                .expect("sends");
        }
        assert_eq!(reports.recv_timeout(WAIT).expect("reported"), open);
        assert!(reports.recv_timeout(Duration::from_millis(600)).is_err());
    }

    #[test]
    fn a_new_folder_is_reported_on_its_parent() {
        let dir = temp();
        let folder = PathBuf::from(shown(dir.path()));
        let (watcher, rx) = listening();
        watcher.set_folders(std::slice::from_ref(&folder));
        std::fs::create_dir(folder.join("made")).expect("creates");
        assert_eq!(
            rx.recv_timeout(WAIT).expect("reported"),
            folder.to_string_lossy()
        );
    }

    #[test]
    fn replacing_the_set_stops_watching_what_closed() {
        let dir = temp();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        std::fs::create_dir(&a).expect("creates");
        std::fs::create_dir(&b).expect("creates");
        let (a, b) = (PathBuf::from(shown(&a)), PathBuf::from(shown(&b)));
        let (watcher, rx) = listening();
        watcher.set_folders(&[a.clone(), b.clone()]);
        assert_eq!(watcher.watched().len(), 2);
        watcher.set_folders(std::slice::from_ref(&b));
        assert_eq!(watcher.watched(), HashSet::from([b.clone()]));
        std::fs::write(a.join("x.md"), b"x").expect("writes");
        assert!(
            rx.recv_timeout(Duration::from_millis(800)).is_err(),
            "a is closed"
        );
        std::fs::write(b.join("x.md"), b"x").expect("writes");
        assert_eq!(
            rx.recv_timeout(WAIT).expect("b still reports"),
            b.to_string_lossy()
        );
    }

    #[test]
    fn a_folder_that_is_gone_is_skipped_without_failing_the_rest() {
        let dir = temp();
        let folder = PathBuf::from(shown(dir.path()));
        let (watcher, _rx) = listening();
        watcher.set_folders(&[dir.path().join("missing"), folder.clone()]);
        assert_eq!(watcher.watched(), HashSet::from([folder]));
    }

    #[test]
    fn a_watched_folder_that_is_deleted_is_reported_so_the_page_can_drop_it() {
        let dir = temp();
        let parent = PathBuf::from(shown(dir.path()));
        let child = parent.join("child");
        std::fs::create_dir(&child).expect("creates");
        let child = PathBuf::from(shown(&child));
        let (watcher, rx) = listening();
        watcher.set_folders(&[parent.clone(), child.clone()]);
        std::fs::remove_dir(&child).expect("deletes");
        let mut seen = HashSet::new();
        while let Ok(folder) = rx.recv_timeout(Duration::from_secs(2)) {
            seen.insert(folder);
        }
        assert!(seen.contains(parent.to_string_lossy().as_ref()), "{seen:?}");
    }
}
