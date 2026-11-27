//! Running git for the status of a repository.
//!
//! Git is only asked to read: `--no-optional-locks` keeps `status` from refreshing the index file
//! while the owner works in another program, which could make their own git command fail on a lock.
//! A repository is untrusted content, so `core.fsmonitor` is forced off: a config that names a
//! program there would have `status` run it. What stays is the filter programs a repository's
//! config and `.gitattributes` can name (`filter.<name>.clean`), which `status` runs only for a file
//! whose stat data is stale; git offers no switch that turns them all off, so that risk is written
//! down in the architecture doc rather than closed here.
//! The program is started with no console window (the platform decides how), with no input and no
//! error output, and under a timeout: one that runs out is killed. A start that fails, an exit that
//! is not a success and a timeout all give None, and the repository simply has no colours.
//!
//! At most [`PARALLEL`] runs are alive at once in the whole app, however many repositories a root
//! holds and however many questions arrive together.

use crate::platform::{self, Platform as _};
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// How long one status run may take before it is stopped.
pub(crate) const TIMEOUT: Duration = Duration::from_secs(20);

/// How many runs may be alive at once.
pub(crate) const PARALLEL: usize = 4;

/// A fixed number of places, taken for the length of one piece of work.
pub(crate) struct Gate {
    free: Mutex<usize>,
    changed: Condvar,
}

/// A place held in a gate, given back when it is dropped, even when the work panics.
struct Place<'a>(&'a Gate);

impl Drop for Place<'_> {
    fn drop(&mut self) {
        *self.0.free.lock().unwrap_or_else(PoisonError::into_inner) += 1;
        self.0.changed.notify_one();
    }
}

impl Gate {
    pub(crate) const fn new(places: usize) -> Self {
        Self {
            free: Mutex::new(places),
            changed: Condvar::new(),
        }
    }

    /// Waits for a place, runs `work`, and gives the place back.
    pub(crate) fn run<T>(&self, work: impl FnOnce() -> T) -> T {
        let mut free = self.free.lock().unwrap_or_else(PoisonError::into_inner);
        while *free == 0 {
            free = self
                .changed
                .wait(free)
                .unwrap_or_else(PoisonError::into_inner);
        }
        *free -= 1;
        drop(free);
        let _place = Place(self);
        work()
    }
}

/// The one gate every status run passes through.
static GATE: Gate = Gate::new(PARALLEL);

/// A git command that only reads the repository in `repo`.
fn reading(git: &Path, repo: &Path, subcommand: &[&str]) -> Command {
    let mut command = Command::new(git);
    command
        .arg("--no-optional-locks")
        // A repository's own config can name a program for `core.fsmonitor`, and `status` would run
        // it. A folder from the internet is untrusted, so the command line switches it off: `-c`
        // beats the repository's config.
        .args(["-c", "core.fsmonitor=false"])
        .arg("-C")
        .arg(repo)
        .args(subcommand)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // Never wait for a person: a status has nothing to ask.
        .env("GIT_TERMINAL_PROMPT", "0");
    platform::current().hide_console(&mut command);
    command
}

/// The command that reads the status of the repository in `repo`, with the branch in its headers.
/// How far the branch is ahead or behind is not asked for, since counting it walks the history.
pub(crate) fn status_command(git: &Path, repo: &Path) -> Command {
    let status = [
        "status",
        "--porcelain=v2",
        "-z",
        "--ignored=matching",
        "--branch",
        "--no-ahead-behind",
    ];
    reading(git, repo, &status)
}

/// The command that names the branch of HEAD; it fails when HEAD is detached.
fn head_name_command(git: &Path, repo: &Path) -> Command {
    reading(git, repo, &["symbolic-ref", "-q", "--short", "HEAD"])
}

/// The command that gives the short id of the commit HEAD is at.
fn head_id_command(git: &Path, repo: &Path) -> Command {
    let id = ["rev-parse", "-q", "--verify", "--short=7", "HEAD"];
    reading(git, repo, &id)
}

/// The branch of the repository in `repo` from its HEAD alone, or the short id of the commit when
/// HEAD is detached. No file of the working folder is looked at. Waits for a place in the gate.
pub(crate) fn run_head(git: &Path, repo: &Path, timeout: Duration) -> Option<String> {
    GATE.run(|| {
        // The first fails for a detached HEAD, and only then is the second needed.
        let output = run_for_output(head_name_command(git, repo), timeout)
            .or_else(|| run_for_output(head_id_command(git, repo), timeout))?;
        let text = String::from_utf8_lossy(&output).trim().to_owned();
        (!text.is_empty()).then_some(text)
    })
}

/// Runs `command` and returns what it wrote, or None when it could not start, ran past `timeout`
/// (it is killed) or did not end well.
fn run_for_output(mut command: Command, timeout: Duration) -> Option<Vec<u8>> {
    let started = Instant::now();
    let mut child = command.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    // A reader thread keeps the pipe empty, so a long answer never blocks the program. It is not
    // joined: a program the child started can hold the pipe open after the child is killed.
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let read = stdout.read_to_end(&mut bytes).map(|_| bytes);
        let _ = send.send(read);
    });
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let left = timeout.saturating_sub(started.elapsed());
                return receive
                    .recv_timeout(left.max(Duration::from_secs(1)))
                    .ok()?
                    .ok();
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(5));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// The status output of the repository in `repo`, or None. Waits for a place in the app-wide gate.
pub(crate) fn run_status(git: &Path, repo: &Path, timeout: Duration) -> Option<Vec<u8>> {
    GATE.run(|| run_for_output(status_command(git, repo), timeout))
}

/// Runs `one` for each repository on up to `threads` threads and returns the answers in the order
/// of `repos`. How many programs run at once is `one`'s business (it passes through the gate).
pub(crate) fn run_all<F>(repos: &[PathBuf], threads: usize, one: F) -> Vec<Option<Vec<u8>>>
where
    F: Fn(&Path) -> Option<Vec<u8>> + Sync,
{
    let answers: Mutex<Vec<Option<Vec<u8>>>> = Mutex::new(vec![None; repos.len()]);
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..threads.min(repos.len()) {
            scope.spawn(|| {
                loop {
                    let at = next.fetch_add(1, Ordering::Relaxed);
                    let Some(repo) = repos.get(at) else { break };
                    let answer = one(repo);
                    answers.lock().unwrap_or_else(PoisonError::into_inner)[at] = answer;
                }
            });
        }
    });
    answers.into_inner().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{FakeProgram, write_fake_program};
    use std::sync::atomic::AtomicUsize;

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn the_command_reads_only_and_takes_no_lock() {
        let command = status_command(Path::new("git"), Path::new("/repo"));
        let args = args_of(&command);
        assert_eq!(
            args,
            [
                "--no-optional-locks",
                "-c",
                "core.fsmonitor=false",
                "-C",
                "/repo",
                "status",
                "--porcelain=v2",
                "-z",
                "--ignored=matching",
                "--branch",
                "--no-ahead-behind"
            ]
        );
        // These are git options, so they come before the subcommand.
        let status = args.iter().position(|a| a == "status");
        for option in ["--no-optional-locks", "core.fsmonitor=false"] {
            let at = args.iter().position(|a| a == option);
            assert!(at.is_some() && at < status, "{option} before status");
        }
    }

    #[test]
    fn a_program_named_by_the_repositorys_own_config_is_not_run() {
        use crate::git::testing;
        let Some(git) = testing::require_git("a_program_named_by_the_repositorys_own_config")
        else {
            return;
        };
        let (_keep, root) = testing::temp();
        testing::init_repo(&git, &root);
        testing::write(&root.join("a.md"), "a\n");
        let marker = root.join("fsmonitor-ran");
        // Git runs the setting through a shell with its own arguments added; the `#` ends the
        // command before them.
        let hook = format!(
            "echo ran > \"{}\" #",
            marker.display().to_string().replace('\\', "/")
        );
        testing::run_git(&git, &root, &["config", "core.fsmonitor", &hook]);

        // The control: git left alone runs the program, so the check below can fail.
        let plain = Command::new(&git)
            .arg("-C")
            .arg(&root)
            .args(["status", "--porcelain"])
            .output()
            .expect("git runs");
        if !plain.status.success() || !marker.exists() {
            eprintln!(
                "SKIPPED a_program_named_by_the_repositorys_own_config: this git does not run the setting here ({})",
                String::from_utf8_lossy(&plain.stderr)
            );
            return;
        }
        std::fs::remove_file(&marker).expect("clears the marker");

        let answer = run_status(&git, &root, Duration::from_secs(30));
        assert!(answer.is_some(), "the status still runs");
        assert!(!marker.exists(), "the repository's program was started");
    }

    #[test]
    fn the_head_commands_read_only_and_take_no_lock() {
        let (git, repo) = (Path::new("git"), Path::new("/repo"));
        for (command, subcommand) in [
            (head_name_command(git, repo), "symbolic-ref"),
            (head_id_command(git, repo), "rev-parse"),
        ] {
            assert_eq!(
                args_of(&command)[..6],
                [
                    "--no-optional-locks",
                    "-c",
                    "core.fsmonitor=false",
                    "-C",
                    "/repo",
                    subcommand
                ]
            );
        }
    }

    #[test]
    fn a_fake_git_is_started_with_those_arguments_and_its_good_exit_gives_an_answer() {
        let dir = tempfile::tempdir().expect("temp dir");
        let record = dir.path().join("args.txt");
        let fake = write_fake_program(dir.path(), "git", &FakeProgram::Record { to: &record })
            .expect("fake git");
        let repo = dir.path().join("repo");
        let answer = run_status(&fake, &repo, Duration::from_secs(20));
        assert_eq!(answer, Some(Vec::new()));
        let seen = std::fs::read_to_string(&record).expect("the fake wrote its arguments");
        for wanted in [
            "--no-optional-locks",
            "status",
            "--porcelain=v2",
            "-z",
            "--ignored=matching",
        ] {
            assert!(seen.contains(wanted), "{wanted} in {seen}");
        }
        assert!(seen.contains("repo"), "{seen}");
    }

    #[test]
    fn a_failing_git_gives_no_answer_and_no_panic() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = write_fake_program(dir.path(), "git", &FakeProgram::Exit(128)).expect("fake");
        assert_eq!(run_status(&fake, dir.path(), Duration::from_secs(20)), None);
    }

    #[test]
    fn a_git_that_cannot_start_gives_no_answer() {
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("no-such-git");
        assert_eq!(
            run_status(&missing, dir.path(), Duration::from_secs(20)),
            None
        );
    }

    #[test]
    fn a_slow_git_is_stopped_at_the_timeout_and_gives_no_answer() {
        let dir = tempfile::tempdir().expect("temp dir");
        let fake = write_fake_program(dir.path(), "git", &FakeProgram::Sleep { seconds: 30 })
            .expect("fake");
        let started = Instant::now();
        let answer = run_status(&fake, dir.path(), Duration::from_millis(300));
        let took = started.elapsed();
        assert_eq!(answer, None);
        assert!(took < Duration::from_secs(10), "stopped after {took:?}");
    }

    #[test]
    fn a_gate_never_lets_more_than_its_places_run_together() {
        let gate = Gate::new(2);
        let now = AtomicUsize::new(0);
        let most = AtomicUsize::new(0);
        let repos: Vec<PathBuf> = (0..12).map(|n| PathBuf::from(format!("/r{n}"))).collect();
        let answers = run_all(&repos, 8, |repo| {
            gate.run(|| {
                let alive = now.fetch_add(1, Ordering::SeqCst) + 1;
                most.fetch_max(alive, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(20));
                now.fetch_sub(1, Ordering::SeqCst);
                Some(repo.to_string_lossy().into_owned().into_bytes())
            })
        });
        assert!(most.load(Ordering::SeqCst) <= 2, "at most 2 at once");
        assert!(most.load(Ordering::SeqCst) >= 2, "and the places were used");
        assert_eq!(answers.len(), 12);
        // Answers come back in the order of the repositories, whatever order they finished in.
        for (n, answer) in answers.iter().enumerate() {
            assert_eq!(answer.as_deref(), Some(format!("/r{n}").as_bytes()));
        }
    }

    #[test]
    fn a_place_is_given_back_when_the_work_panics() {
        let gate = Gate::new(1);
        let failed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            gate.run(|| panic!("the work failed"));
        }));
        assert!(failed.is_err());
        assert_eq!(gate.run(|| 7), 7);
    }

    #[test]
    fn the_app_wide_limit_is_a_few() {
        assert!((1..=8).contains(&PARALLEL));
        assert_eq!(TIMEOUT, Duration::from_secs(20));
    }
}
