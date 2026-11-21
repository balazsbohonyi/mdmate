//! The page's one question about git: the status of every path under an open workspace root.
//!
//! The answer lists the repositories found (their folders, `/` between parts) and one entry per
//! path git reports, each tagged with the index of its repository. A path is coloured by the
//! innermost repository that holds it, so an entry of an outer repository that lies at or inside an
//! inner one is dropped here; an outer folder entry that merely contains an inner repository stays
//! (it describes the rest of that folder), and the page applies the same rule to the paths it draws:
//! an entry counts for a path only when its `repo` is the innermost repository of that path.
//!
//! Nothing is an error that is only "no git": git off, git not found, a root in no repository, a
//! repository whose run failed or timed out all answer with less or nothing. The root must be one
//! the user opened (`Access::is_root`), and folders the page names for the deeper search are
//! dropped without a word unless they lie inside it.

use super::discover;
use super::locate;
use super::run;
use super::status::{self, GitStatus};
use crate::access::{Access, display_path, is_inside};
use crate::documents::AppState;
use crate::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// One path git reports, with the repository that reported it.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitEntry {
    /// The index of the repository in [`GitReport::repos`].
    pub(crate) repo: usize,
    /// The full path, `/` between parts.
    pub(crate) path: String,
    pub(crate) status: GitStatus,
    /// A folder git reports as a whole: everything below it has `status`.
    pub(crate) folder: bool,
}

/// The answer: the repositories under a root and what they report.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitReport {
    pub(crate) repos: Vec<String>,
    pub(crate) entries: Vec<GitEntry>,
}

/// A root the page may ask about and the listed folders inside it, as plain paths git can use.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Request {
    pub(crate) root: PathBuf,
    pub(crate) folders: Vec<PathBuf>,
}

/// Checks the root against the open roots and the folders against the root.
pub(crate) fn resolve_request(
    access: &Access,
    root: &Path,
    folders: &[PathBuf],
) -> Result<Request, AppError> {
    let resolved = access.check_in_root(root)?;
    if !access.is_root(&resolved) {
        return Err(AppError::NotAllowed(display_path(&resolved.path)));
    }
    let listed = folders
        .iter()
        .filter_map(|folder| access.check_in_root(folder).ok())
        .filter(|folder| is_inside(&folder.key, &resolved.key) && folder.path.is_dir())
        .map(|folder| PathBuf::from(display_path(&folder.path)))
        .collect();
    // Git is given the folder as people read it: the `\\?\` form is for the file system only.
    Ok(Request {
        root: PathBuf::from(display_path(&resolved.path)),
        folders: listed,
    })
}

fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Reads every repository under the request's root with `run` (which gets one repository's folder
/// and answers its status output, or None) and puts the answers together.
pub(crate) fn read(
    request: &Request,
    run_one: impl Fn(&Path) -> Option<Vec<u8>> + Sync,
) -> GitReport {
    let repos = discover::discover(&request.root, &request.folders);
    if repos.is_empty() {
        return GitReport::default();
    }
    let outputs = run::run_all(&repos, run::PARALLEL, run_one);
    let mut entries = Vec::new();
    for (index, (repo, output)) in repos.iter().zip(outputs).enumerate() {
        let Some(output) = output else { continue };
        for change in status::parse(&output) {
            let path = repo.join(&change.path);
            // The innermost repository decides, so what an outer one says about an inner one's
            // folder is not an answer.
            if discover::innermost(&repos, &path) != Some(index) {
                continue;
            }
            // A repository above the root reports files outside it too; those are not asked for.
            // A whole folder that holds the root is kept, since the root inherits from it.
            if !path.starts_with(&request.root) && !request.root.starts_with(&path) {
                continue;
            }
            entries.push(GitEntry {
                repo: index,
                path: slash(&path),
                status: change.status,
                folder: change.folder,
            });
        }
    }
    GitReport {
        repos: repos.iter().map(|repo| slash(repo)).collect(),
        entries,
    }
}

/// The answer for a request: nothing when git is off or was not found, otherwise what `run_one`
/// (given git's path and a repository) reads.
pub(crate) fn answer(
    request: &Request,
    enabled: bool,
    git: Option<&Path>,
    run_one: impl Fn(&Path, &Path) -> Option<Vec<u8>> + Sync,
) -> GitReport {
    match git {
        Some(git) if enabled => read(request, |repo| run_one(git, repo)),
        _ => GitReport::default(),
    }
}

/// The page's question, against the live settings and the real git.
pub(crate) fn status(
    state: &AppState,
    root: &Path,
    folders: &[PathBuf],
) -> Result<GitReport, AppError> {
    // The lock on the open roots is let go before git is started: a run can take seconds.
    let request = {
        let access = state.access();
        resolve_request(&access, root, folders)?
    };
    let runtime = state.runtime();
    let git = locate::find(&runtime.git_path());
    Ok(answer(
        &request,
        runtime.git_enabled(),
        git.as_deref(),
        |git, repo| run::run_status(git, repo, run::TIMEOUT),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testing;
    use crate::platform::{self, Platform as _};
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn access_with(root: &Path) -> Access {
        let mut access = Access::new(platform::current().paths_ignore_case());
        access.grant_root(root).expect("the root is granted");
        access
    }

    fn by_path(report: &GitReport) -> BTreeMap<String, (usize, GitStatus, bool)> {
        report
            .entries
            .iter()
            .map(|e| (e.path.clone(), (e.repo, e.status, e.folder)))
            .collect()
    }

    fn rel(report: &GitReport, root: &Path) -> BTreeMap<String, (usize, GitStatus, bool)> {
        let prefix = format!("{}/", slash(root));
        by_path(report)
            .into_iter()
            .map(|(path, value)| {
                (
                    path.strip_prefix(&prefix).unwrap_or(&path).to_owned(),
                    value,
                )
            })
            .collect()
    }

    /// A repository with one file of each kind of change, returned as (guard, root).
    fn repo_with_changes(git: &Path) -> (tempfile::TempDir, PathBuf) {
        let (keep, root) = testing::temp();
        testing::init_repo(git, &root);
        testing::write(&root.join(".gitignore"), "*.log\n");
        testing::write(&root.join("clean.md"), "clean\n");
        testing::write(&root.join("edited.md"), "one\n");
        testing::commit_all(git, &root);
        testing::write(&root.join("edited.md"), "two\n");
        testing::write(&root.join("sub dir/new file.md"), "new\n");
        testing::write(&root.join("trace.log"), "ignored\n");
        (keep, root)
    }

    #[test]
    fn an_open_root_answers_with_its_repository_and_every_status() {
        let Some(git) = testing::require_git("an_open_root_answers_with_its_repository") else {
            return;
        };
        let (_keep, root) = repo_with_changes(&git);
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let report = answer(&request, true, Some(&git), |git, repo| {
            run::run_status(git, repo, Duration::from_secs(30))
        });
        assert_eq!(report.repos, [slash(&root)]);
        let seen = rel(&report, &root);
        assert_eq!(
            seen.get("edited.md"),
            Some(&(0, GitStatus::Modified, false))
        );
        assert_eq!(seen.get("sub dir"), Some(&(0, GitStatus::Untracked, true)));
        assert_eq!(seen.get("trace.log"), Some(&(0, GitStatus::Ignored, false)));
        assert!(!seen.contains_key("clean.md"));
    }

    use std::time::Duration;

    #[test]
    fn a_path_outside_every_root_and_a_folder_that_is_not_a_root_are_refused() {
        let (_keep, root) = testing::temp();
        let (_other, outside) = testing::temp();
        let inside = root.join("inside");
        std::fs::create_dir_all(&inside).expect("makes it");
        let access = access_with(&root);
        assert!(matches!(
            resolve_request(&access, &outside, &[]),
            Err(AppError::NotAllowed(_))
        ));
        // A folder inside a root is not itself a root: only the roots the user opened are asked.
        assert!(matches!(
            resolve_request(&access, &inside, &[]),
            Err(AppError::NotAllowed(_))
        ));
        assert!(resolve_request(&access, &root, &[]).is_ok());
        // A path that does not exist cannot be resolved and is an error too, not an answer.
        assert!(resolve_request(&access, &root.join("gone"), &[]).is_err());
    }

    #[test]
    fn listed_folders_outside_the_root_or_gone_are_dropped_without_a_word() {
        let (_keep, root) = testing::temp();
        let (_other, outside) = testing::temp();
        let inside = root.join("inside");
        std::fs::create_dir_all(&inside).expect("makes it");
        let access = access_with(&root);
        let request = resolve_request(
            &access,
            &root,
            &[inside.clone(), outside, root.join("gone")],
        )
        .expect("the root is open");
        assert_eq!(request.folders, [inside]);
    }

    #[test]
    fn with_git_off_or_not_found_nothing_runs_and_the_answer_is_empty() {
        let (_keep, root) = testing::temp();
        std::fs::create_dir_all(root.join(".git")).expect("a repository marker");
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let runs = AtomicUsize::new(0);
        let counting = |_: &Path, _: &Path| {
            runs.fetch_add(1, Ordering::SeqCst);
            Some(b"? x.md\0".to_vec())
        };
        let git = Path::new("git");
        assert_eq!(
            answer(&request, false, Some(git), counting),
            GitReport::default()
        );
        assert_eq!(answer(&request, true, None, counting), GitReport::default());
        assert_eq!(runs.load(Ordering::SeqCst), 0, "nothing was started");
        // With git on and found the same request does run.
        let report = answer(&request, true, Some(git), counting);
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        assert_eq!(report.entries.len(), 1);
    }

    #[test]
    fn a_root_in_no_repository_answers_with_nothing_and_runs_nothing() {
        let (_keep, root) = testing::temp();
        std::fs::create_dir_all(root.join("a")).expect("makes it");
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let runs = AtomicUsize::new(0);
        // Whatever is run answers with a real record, so an empty report can only mean that no
        // repository under the root was found.
        let report = answer(&request, true, Some(Path::new("git")), |_, repo| {
            // A machine whose temp folder lies inside a repository finds that one above the root;
            // it is the only repository there can be.
            assert!(!repo.starts_with(&root) || repo == root, "{repo:?}");
            runs.fetch_add(1, Ordering::SeqCst);
            Some(b"? x.md ".to_vec())
        });
        let inside = |repo: &String| repo.starts_with(&slash(&root));
        assert!(!report.repos.iter().any(inside), "{:?}", report.repos);
        assert!(
            !report
                .entries
                .iter()
                .any(|e| e.path.starts_with(&slash(&root)))
        );
        assert_eq!(runs.load(Ordering::SeqCst), report.repos.len());
        if report.repos.is_empty() {
            assert_eq!(report, GitReport::default());
            assert_eq!(runs.load(Ordering::SeqCst), 0, "nothing was started");
        }
    }

    #[test]
    fn a_repository_whose_run_fails_leaves_the_others_and_shows_no_error() {
        let (_keep, root) = testing::temp();
        std::fs::create_dir_all(root.join("a").join(".git")).expect("a");
        std::fs::create_dir_all(root.join("b").join(".git")).expect("b");
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let report = answer(&request, true, Some(Path::new("git")), |_, repo| {
            if repo.ends_with("a") {
                None
            } else {
                Some(b"? new.md\0".to_vec())
            }
        });
        assert!(report.repos.iter().any(|repo| repo.ends_with("/a")));
        let seen = rel(&report, &root);
        assert_eq!(seen.keys().cloned().collect::<Vec<_>>(), ["b/new.md"]);
    }

    #[test]
    fn the_innermost_repository_decides_the_entries_and_an_outer_one_says_nothing_inside_it() {
        let (_keep, root) = testing::temp();
        std::fs::create_dir_all(root.join(".git")).expect("outer");
        std::fs::create_dir_all(root.join("inner").join(".git")).expect("inner");
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let report = answer(&request, true, Some(Path::new("git")), |_, repo| {
            if repo == root {
                // The outer repository sees the inner folder as untracked, and a file of its own.
                Some(b"? inner/\0? outer.md\0".to_vec())
            } else {
                Some(b"1 .M N... 100644 100644 100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 inner.md\0".to_vec())
            }
        });
        assert_eq!(
            report.repos,
            [slash(&root), format!("{}/inner", slash(&root))]
        );
        let seen = rel(&report, &root);
        assert_eq!(
            seen,
            BTreeMap::from([
                ("outer.md".to_owned(), (0, GitStatus::Untracked, false)),
                ("inner/inner.md".to_owned(), (1, GitStatus::Modified, false)),
            ])
        );
    }

    #[test]
    fn a_repository_above_the_root_reports_only_what_is_under_the_root() {
        let (_keep, outer) = testing::temp();
        std::fs::create_dir_all(outer.join(".git")).expect("outer");
        let root = outer.join("work");
        std::fs::create_dir_all(&root).expect("work");
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let report = answer(&request, true, Some(Path::new("git")), |_, _| {
            Some(b"? elsewhere.md\0? work/mine.md\0? work2/other.md\0".to_vec())
        });
        let seen = rel(&report, &root);
        assert_eq!(seen.keys().cloned().collect::<Vec<_>>(), ["mine.md"]);
    }

    #[test]
    fn real_nested_repositories_each_decide_their_own_files() {
        let Some(git) =
            testing::require_git("real_nested_repositories_each_decide_their_own_files")
        else {
            return;
        };
        let (_keep, root) = testing::temp();
        testing::init_repo(&git, &root);
        testing::write(&root.join("outer.md"), "o\n");
        testing::commit_all(&git, &root);
        let inner = root.join("projects").join("inner");
        testing::init_repo(&git, &inner);
        testing::write(&inner.join("kept.md"), "k\n");
        testing::commit_all(&git, &inner);
        testing::write(&inner.join("kept.md"), "k2\n");
        testing::write(&root.join("outer.md"), "o2\n");
        let access = access_with(&root);
        let request = resolve_request(&access, &root, &[]).expect("an open root");
        let report = answer(&request, true, Some(&git), |git, repo| {
            run::run_status(git, repo, Duration::from_secs(30))
        });
        assert_eq!(report.repos.len(), 2);
        let seen = rel(&report, &root);
        assert_eq!(seen.get("outer.md"), Some(&(0, GitStatus::Modified, false)));
        assert_eq!(
            seen.get("projects/inner/kept.md"),
            Some(&(1, GitStatus::Modified, false))
        );
        // The outer repository calls `projects` untracked, since only the inner repository is in
        // it: that describes the folder and stays. What it says about the inner repository's own
        // folder is not an answer, so there is no entry for `projects/inner` from repository 0.
        assert_eq!(seen.get("projects"), Some(&(0, GitStatus::Untracked, true)));
        assert!(!seen.contains_key("projects/inner"));
    }

    #[test]
    fn the_report_is_what_the_page_reads() {
        let report = GitReport {
            repos: vec!["C:/work".into()],
            entries: vec![GitEntry {
                repo: 0,
                path: "C:/work/a.md".into(),
                status: GitStatus::Modified,
                folder: false,
            }],
        };
        let json = serde_json::to_value(&report).expect("serializes");
        assert_eq!(
            json,
            serde_json::json!({
                "repos": ["C:/work"],
                "entries": [{ "repo": 0, "path": "C:/work/a.md", "status": "modified", "folder": false }]
            })
        );
    }
}
