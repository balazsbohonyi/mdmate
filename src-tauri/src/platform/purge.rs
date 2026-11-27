//! Removing files and folders for good, without the Recycle Bin.
//!
//! The walk is our own, the same on every OS. A link is removed and never gone through, so nothing
//! outside what was asked for is touched, and [`Platform::hold_folder`] keeps a folder from being
//! swapped for a link while what is in it is removed.

use super::Platform;
use super::bin::{self, End, Kept, Progress, Report, Stop};
use crate::error::friendly_io;
use std::any::Any;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How often a folder that just lost its last item is tried again, since the system may take a
/// moment to let go of what was removed.
const EMPTY_TRIES: u32 = 5;
const EMPTY_PAUSE: Duration = Duration::from_millis(20);

/// One thing left to do. The walk keeps these in a list, so a deep tree cannot overflow the stack.
enum Step {
    Visit(PathBuf),
    /// A folder whose contents were visited. It is let go and removed, unless something in it
    /// stayed.
    Leave {
        path: PathBuf,
        held: Box<dyn Any>,
        /// How many failures there were before it was entered.
        failures: u64,
    },
}

struct Walk<'a> {
    platform: &'a dyn Platform,
    cancel: &'a AtomicBool,
    progress: &'a dyn Fn(Progress),
    /// The items under every target, themselves included, and how many are gone.
    items: u64,
    removed: u64,
    percent: Option<u8>,
    failures: u64,
    /// The first thing of the target in hand that could not be removed, and why.
    first: Option<(PathBuf, String)>,
}

impl Walk<'_> {
    fn gone(&mut self) {
        self.removed += 1;
        // It stays below 100 until the answer, as items made meanwhile are removed too.
        let percent = (self.removed.saturating_mul(100) / self.items.max(1)).min(99) as u8;
        if self.percent != Some(percent) {
            self.percent = Some(percent);
            (self.progress)(Progress::Removing { percent });
        }
    }

    fn failed(&mut self, path: PathBuf, error: &io::Error) {
        self.failures += 1;
        if self.first.is_none() {
            self.first = Some((path, friendly_io(error)));
        }
    }

    /// Takes the answer of one removal. Something already gone counts as removed.
    fn took(&mut self, path: PathBuf, answer: io::Result<()>) {
        match answer {
            Ok(()) => self.gone(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => self.gone(),
            Err(error) => self.failed(path, &error),
        }
    }

    /// Holds a folder and lists it.
    fn enter(&self, path: &Path) -> io::Result<(Box<dyn Any>, Vec<PathBuf>)> {
        let held = self.platform.hold_folder(path)?;
        let inside = fs::read_dir(path)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<io::Result<_>>()?;
        Ok((held, inside))
    }

    fn visit(&mut self, path: PathBuf, steps: &mut Vec<Step>) {
        // Never `metadata`, which would look through a link.
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) => return self.took(path, Err(error)),
        };
        if meta.file_type().is_symlink() {
            // The link itself. Which call removes it depends on the system and on what it is.
            let answer = self.platform.remove_even_read_only(&path, &|| {
                fs::remove_file(&path).or_else(|first| fs::remove_dir(&path).map_err(|_| first))
            });
            return self.took(path, answer);
        }
        if !meta.is_dir() {
            let answer = self
                .platform
                .remove_even_read_only(&path, &|| fs::remove_file(&path));
            return self.took(path, answer);
        }
        match self.enter(&path) {
            Ok((held, inside)) => {
                let failures = self.failures;
                steps.push(Step::Leave {
                    path,
                    held,
                    failures,
                });
                steps.extend(inside.into_iter().map(Step::Visit));
            }
            Err(error) => self.took(path, Err(error)),
        }
    }

    fn remove_empty(&self, path: &Path) -> io::Result<()> {
        let mut tries = 1;
        loop {
            let answer = self
                .platform
                .remove_even_read_only(path, &|| fs::remove_dir(path));
            match answer {
                Err(error)
                    if error.kind() == io::ErrorKind::DirectoryNotEmpty && tries < EMPTY_TRIES =>
                {
                    tries += 1;
                    std::thread::sleep(EMPTY_PAUSE);
                }
                answer => return answer,
            }
        }
    }

    /// Removes one target with all that is in it. A Cancel stops it between two removals.
    fn remove(&mut self, target: &Path) -> Result<(), Stop> {
        let mut steps = vec![Step::Visit(target.to_path_buf())];
        while let Some(step) = steps.pop() {
            if self.cancel.load(Ordering::SeqCst) {
                return Err(Stop::Cancelled);
            }
            match step {
                Step::Visit(path) => self.visit(path, &mut steps),
                Step::Leave {
                    path,
                    held,
                    failures,
                } => {
                    drop(held);
                    // With something left inside, the reason is already known.
                    if self.failures == failures {
                        let answer = self.remove_empty(&path);
                        self.took(path, answer);
                    }
                }
            }
        }
        Ok(())
    }

    /// Why a target is still there, naming the item inside it that stopped it.
    fn why(&mut self, target: &Path) -> Kept {
        match self.first.take() {
            Some((path, words)) if path == target => Kept::Failed(words),
            Some((path, words)) => {
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                Kept::Failed(format!("{name}: {words}"))
            }
            None => Kept::Failed("it was not removed".into()),
        }
    }
}

/// Removes the targets and everything in them for good. A target inside another ends as that one
/// does. `cancel` stops it between two removals, and what is gone by then stays gone. A target
/// that went ends as [`End::Removed`].
pub(crate) fn run(
    platform: &dyn Platform,
    targets: &[PathBuf],
    cancel: &AtomicBool,
    progress: &dyn Fn(Progress),
) -> Report {
    progress(Progress::Counting { percent: None });
    let holder = bin::holders(targets, platform.paths_ignore_case());
    let mut ends: Vec<Option<End>> = vec![None; targets.len()];
    let mut queued: Vec<usize> = Vec::new();
    let mut walk = Walk {
        platform,
        cancel,
        progress,
        items: 0,
        removed: 0,
        percent: None,
        failures: 0,
        first: None,
    };
    let mut cancelled = false;
    for ((at, target), end) in targets.iter().enumerate().zip(ends.iter_mut()) {
        if holder.get(at) != Some(&at) {
            continue;
        }
        match bin::measure(target, cancel) {
            Err(Stop::Cancelled) => {
                cancelled = true;
                break;
            }
            Err(Stop::Io(error)) => *end = Some(End::Kept(Kept::Failed(friendly_io(&error)))),
            Ok(size) => {
                walk.items += size.items;
                queued.push(at);
            }
        }
    }
    for at in queued {
        let (Some(target), Some(end)) = (targets.get(at), ends.get_mut(at)) else {
            continue;
        };
        if cancelled {
            break;
        }
        walk.first = None;
        let walked = walk.remove(target);
        cancelled = walked.is_err();
        *end = Some(if bin::is_gone(target) {
            End::Removed
        } else if cancelled {
            End::Kept(Kept::Cancelled)
        } else {
            End::Kept(walk.why(target))
        });
    }
    // What has no end yet was never reached, which only a Cancel causes.
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
        destroyed_inside: Vec::new(),
        cancelled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{current, make_file_link, make_folder_link};
    use std::sync::Mutex;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir")
    }

    fn file(folder: &Path, name: &str) -> PathBuf {
        let path = folder.join(name);
        fs::create_dir_all(path.parent().expect("a parent")).expect("folders");
        fs::write(&path, b"keep").expect("written");
        path
    }

    /// Runs a removal and returns its report with every step it told.
    fn removal(targets: &[PathBuf], cancel_at_first_removal: bool) -> (Report, Vec<Progress>) {
        let cancel = AtomicBool::new(false);
        let told = Mutex::new(Vec::new());
        let report = run(&current(), targets, &cancel, &|step| {
            if cancel_at_first_removal && matches!(step, Progress::Removing { .. }) {
                cancel.store(true, Ordering::SeqCst);
            }
            told.lock().expect("lock").push(step);
        });
        (report, told.into_inner().expect("lock"))
    }

    #[test]
    fn delete_permanent_removes_a_tree_and_tells_how_far_it_is() {
        let dir = temp();
        let tree = dir.path().join("tree");
        for number in 0..40 {
            file(&tree, &format!("a/b/{number}.txt"));
        }
        // Deeper than the 260 characters old Windows calls stop at.
        let deep = ["a-folder-with-a-rather-long-name"; 10].join("/");
        file(&tree, &format!("{deep}/end.txt"));
        let single = file(dir.path(), "single.txt");
        let beside = file(dir.path(), "beside.txt");
        let (report, told) = removal(&[tree.clone(), single.clone()], false);
        assert_eq!(report.ends, [End::Removed, End::Removed]);
        assert!(!report.cancelled);
        assert!(!tree.exists() && !single.exists() && beside.exists());
        assert_eq!(told.first(), Some(&Progress::Counting { percent: None }));
        let percents: Vec<u8> = told
            .iter()
            .skip(1)
            .map(|step| match step {
                Progress::Removing { percent } => *percent,
                other => panic!("an unexpected step: {other:?}"),
            })
            .collect();
        assert!(percents.len() > 10, "{percents:?}");
        assert!(percents.is_sorted(), "{percents:?}");
        assert_eq!(percents.last(), Some(&99));
    }

    #[test]
    fn delete_permanent_removes_a_read_only_file() {
        let dir = temp();
        let locked = file(dir.path(), "tree/read-only.txt");
        let mut permissions = fs::metadata(&locked).expect("meta").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&locked, permissions).expect("marked");
        let (report, _) = removal(&[dir.path().join("tree")], false);
        assert_eq!(report.ends, [End::Removed]);
        assert!(!dir.path().join("tree").exists());
    }

    #[test]
    fn delete_permanent_cancel_stops_it_and_keeps_the_rest() {
        let dir = temp();
        let tree = dir.path().join("tree");
        for number in 0..30 {
            file(&tree, &format!("{number}.txt"));
        }
        let after = file(dir.path(), "after.txt");
        let (report, _) = removal(&[tree.clone(), after.clone()], true);
        assert!(report.cancelled);
        assert_eq!(
            report.ends,
            [End::Kept(Kept::Cancelled), End::Kept(Kept::Cancelled)]
        );
        let left = fs::read_dir(&tree).expect("still there").count();
        assert_eq!(left, 29, "one went before the Cancel was heard");
        assert!(after.exists());
    }

    #[test]
    fn delete_permanent_reports_what_was_never_there() {
        let dir = temp();
        let (report, _) = removal(&[dir.path().join("gone.txt")], false);
        assert!(matches!(
            report.ends.as_slice(),
            [End::Kept(Kept::Failed(_))]
        ));
    }

    #[test]
    fn permanent_keeps_link_targets() {
        let dir = temp();
        let outside = dir.path().join("outside");
        let kept = file(&outside.join("deep"), "kept.txt");
        let tree = dir.path().join("tree");
        file(&tree, "own.txt");
        file(&tree.join("sub"), "own.txt");
        // Joined part by part: `mklink` reads a forward slash as the start of a switch.
        make_folder_link(&outside, &tree.join("sub").join("folder-link")).expect("a folder link");
        match make_file_link(&kept, &tree.join("file-link")) {
            Ok(()) => {}
            Err(error) => eprintln!("SKIPPED the file link half, no link was made: {error}"),
        }
        let alone = dir.path().join("alone-link");
        make_folder_link(&outside, &alone).expect("a folder link");
        let (report, _) = removal(&[tree.clone(), alone.clone()], false);
        assert_eq!(report.ends, [End::Removed, End::Removed]);
        assert!(!tree.exists());
        assert!(fs::symlink_metadata(&alone).is_err(), "the link is gone");
        assert_eq!(fs::read(&kept).expect("the target is there"), b"keep");
        assert_eq!(
            fs::read_dir(outside.join("deep")).expect("listed").count(),
            1
        );
    }
}
