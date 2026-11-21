//! Reading `git status --porcelain=v2 -z --ignored=matching` into one status per path.
//!
//! With `-z` every record ends in a NUL and no path is quoted or escaped, so a name with spaces, a
//! quote or a non-ASCII character comes through as it is. Paths are relative to the repository's
//! top folder. A folder that is wholly untracked or wholly ignored is one record ending in `/`
//! (`--ignored=matching` and the default untracked mode), so such a folder is one entry here, with
//! `folder` set: everything below it has that status.
//!
//! The six statuses are the ones the tree shows. A deleted file has no row, so a deletion counts as
//! a modification (it colours the folders above it); a type change does too; an intent-to-add file
//! (`git add -N`) is Added; a copy is Added; every record of the "unmerged" kind is a conflict.

use serde::Serialize;

/// What git says about a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GitStatus {
    Untracked,
    Added,
    Modified,
    Renamed,
    Conflicted,
    Ignored,
}

/// One path git reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Change {
    /// Relative to the repository's top folder, with `/` between parts and no trailing `/`.
    pub(crate) path: String,
    pub(crate) status: GitStatus,
    /// A folder git reports as a whole: everything below it has `status`.
    pub(crate) folder: bool,
}

/// The status a changed (`1`) record's two status letters mean.
fn ordinary(letters: &[u8]) -> GitStatus {
    if letters.contains(&b'A') {
        GitStatus::Added
    } else {
        GitStatus::Modified
    }
}

/// The status a renamed or copied (`2`) record's two status letters mean.
fn renamed_or_copied(letters: &[u8]) -> GitStatus {
    if letters.first() == Some(&b'C') || letters.get(1) == Some(&b'C') {
        GitStatus::Added
    } else {
        GitStatus::Renamed
    }
}

fn change(path: &[u8], status: GitStatus) -> Change {
    let text = String::from_utf8_lossy(path);
    match text.strip_suffix('/') {
        Some(folder) => Change {
            path: folder.to_owned(),
            status,
            folder: true,
        },
        None => Change {
            path: text.into_owned(),
            status,
            folder: false,
        },
    }
}

/// The text after the `count`th space of a record, where the path starts: the path is the last
/// field and may hold spaces itself.
fn after_spaces(record: &[u8], count: usize) -> Option<&[u8]> {
    let mut seen = 0;
    for (at, byte) in record.iter().enumerate() {
        if *byte == b' ' {
            seen += 1;
            if seen == count {
                return record.get(at + 1..);
            }
        }
    }
    None
}

/// Reads the output of the status command. A record that is not understood is left out.
pub(crate) fn parse(output: &[u8]) -> Vec<Change> {
    let mut changes = Vec::new();
    let mut records = output.split(|byte| *byte == 0);
    while let Some(record) = records.next() {
        let Some(kind) = record.first() else { continue };
        // The status letters follow the kind and a space: `1 .M N...`.
        let letters = record.get(2..4).unwrap_or_default();
        match kind {
            b'?' => {
                if let Some(path) = record.get(2..) {
                    changes.push(change(path, GitStatus::Untracked));
                }
            }
            b'!' => {
                if let Some(path) = record.get(2..) {
                    changes.push(change(path, GitStatus::Ignored));
                }
            }
            // `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`
            b'1' => {
                if let Some(path) = after_spaces(record, 8) {
                    changes.push(change(path, ordinary(letters)));
                }
            }
            // `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`, then the old path as the
            // next record.
            b'2' => {
                let path = after_spaces(record, 9);
                // The old path is its own record: read it past, whether or not this one was usable.
                let _old = records.next();
                if let Some(path) = path {
                    changes.push(change(path, renamed_or_copied(letters)));
                }
            }
            // `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
            b'u' => {
                if let Some(path) = after_spaces(record, 10) {
                    changes.push(change(path, GitStatus::Conflicted));
                }
            }
            // `# branch.…` headers (not asked for) and anything newer are not paths.
            _ => {}
        }
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
    const ZERO: &str = "0000000000000000000000000000000000000000";

    /// A recorded `1` record: the two letters and the path are what vary.
    fn one(letters: &str, path: &str) -> String {
        format!("1 {letters} N... 100644 100644 100644 {HASH} {HASH} {path}")
    }

    /// Joins records the way `-z` does, each ending in a NUL.
    fn z(records: &[&str]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for record in records {
            bytes.extend_from_slice(record.as_bytes());
            bytes.push(0);
        }
        bytes
    }

    fn got(output: &[u8]) -> Vec<(String, GitStatus, bool)> {
        parse(output)
            .into_iter()
            .map(|c| (c.path, c.status, c.folder))
            .collect()
    }

    #[test]
    fn each_kind_of_change_gets_its_status() {
        let added = format!("1 A. N... 000000 100644 100644 {ZERO} {HASH} new.md");
        let renamed = format!("2 R. N... 100644 100644 100644 {HASH} {HASH} R100 renamed.md");
        let conflict =
            format!("u UU N... 100644 100644 100644 100644 {HASH} {HASH} {HASH} conflict.md");
        let output = z(&[
            &one(".M", "modified.md"),
            &one("M.", "staged.md"),
            &one("MM", "both.md"),
            &added,
            &renamed,
            "old-name.md",
            &conflict,
            "? untracked.md",
            "! ignored.log",
        ]);
        assert_eq!(
            got(&output),
            [
                ("modified.md".into(), GitStatus::Modified, false),
                ("staged.md".into(), GitStatus::Modified, false),
                ("both.md".into(), GitStatus::Modified, false),
                ("new.md".into(), GitStatus::Added, false),
                ("renamed.md".into(), GitStatus::Renamed, false),
                ("conflict.md".into(), GitStatus::Conflicted, false),
                ("untracked.md".into(), GitStatus::Untracked, false),
                ("ignored.log".into(), GitStatus::Ignored, false),
            ]
        );
    }

    #[test]
    fn the_old_name_of_a_rename_is_not_an_entry_of_its_own() {
        let renamed = format!("2 R. N... 100644 100644 100644 {HASH} {HASH} R100 b.md");
        let output = z(&[&renamed, "a.md", "? c.md"]);
        assert_eq!(
            got(&output),
            [
                ("b.md".into(), GitStatus::Renamed, false),
                ("c.md".into(), GitStatus::Untracked, false),
            ]
        );
    }

    #[test]
    fn a_name_with_spaces_or_non_ascii_characters_comes_through_whole() {
        let output = z(&[
            &one(".M", "notes/with spaces.md"),
            &one(".M", "naïve café.md"),
            "? 日本語/メモ.md",
            "? it's \"quoted\".md",
        ]);
        let paths: Vec<String> = parse(&output).into_iter().map(|c| c.path).collect();
        assert_eq!(
            paths,
            [
                "notes/with spaces.md",
                "naïve café.md",
                "日本語/メモ.md",
                "it's \"quoted\".md"
            ]
        );
    }

    #[test]
    fn an_ignored_or_untracked_folder_is_one_entry_marked_as_a_folder() {
        let output = z(&[
            "! node_modules/",
            "? scratch/",
            "? scratch.md",
            "! target/debug/",
        ]);
        assert_eq!(
            got(&output),
            [
                ("node_modules".into(), GitStatus::Ignored, true),
                ("scratch".into(), GitStatus::Untracked, true),
                ("scratch.md".into(), GitStatus::Untracked, false),
                ("target/debug".into(), GitStatus::Ignored, true),
            ]
        );
    }

    #[test]
    fn a_deletion_or_type_change_is_a_modification_and_an_intent_to_add_is_added() {
        let output = z(&[
            &one(".D", "gone.md"),
            &one("D.", "removed.md"),
            &one(".T", "link.md"),
            &one(".A", "planned.md"),
            &format!("2 C. N... 100644 100644 100644 {HASH} {HASH} C75 copy.md"),
            "source.md",
        ]);
        assert_eq!(
            got(&output),
            [
                ("gone.md".into(), GitStatus::Modified, false),
                ("removed.md".into(), GitStatus::Modified, false),
                ("link.md".into(), GitStatus::Modified, false),
                ("planned.md".into(), GitStatus::Added, false),
                ("copy.md".into(), GitStatus::Added, false),
            ]
        );
    }

    #[test]
    fn headers_empty_output_and_garbage_give_nothing_and_never_panic() {
        assert!(parse(b"").is_empty());
        assert!(parse(b"\0\0\0").is_empty());
        assert!(parse(b"# branch.oid abc\0# branch.head main\0").is_empty());
        assert!(parse(b"1 .M\0").is_empty());
        assert!(parse(b"2 R. N...\0").is_empty());
        assert!(parse(b"u UU\0").is_empty());
        assert!(parse(b"?\0!\0").is_empty());
        assert!(parse(b"z what is this\0").is_empty());
    }

    #[test]
    fn a_name_that_is_not_utf8_is_read_with_replacement_characters_and_does_not_stop_the_rest() {
        let mut output = b"? bad-".to_vec();
        output.push(0xff);
        output.extend_from_slice(b".md\0? good.md\0");
        let changes = parse(&output);
        assert_eq!(changes.len(), 2);
        assert!(changes[0].path.contains('\u{fffd}'));
        assert_eq!(changes[1].path, "good.md");
    }

    #[test]
    fn real_git_output_is_read_with_each_status() {
        use crate::git::{run, testing};
        let Some(git) = testing::require_git("real_git_output_is_read_with_each_status") else {
            return;
        };
        let (_keep, root) = testing::temp();
        testing::init_repo(&git, &root);
        testing::write(&root.join(".gitignore"), "*.log\nbuild/\n");
        testing::write(&root.join("kept.md"), "kept\n");
        testing::write(&root.join("edited.md"), "one\n");
        testing::write(
            &root.join("old name.md"),
            "a long enough body to be a rename\nsecond line\n",
        );
        testing::write(&root.join("naïve café.md"), "x\n");
        testing::commit_all(&git, &root);
        testing::write(&root.join("edited.md"), "two\n");
        testing::run_git(&git, &root, &["mv", "old name.md", "new name.md"]);
        testing::write(&root.join("added.md"), "new\n");
        testing::run_git(&git, &root, &["add", "added.md"]);
        testing::write(&root.join("naïve café.md"), "y\n");
        testing::write(&root.join("fresh dir/inside.md"), "u\n");
        testing::write(&root.join("trace.log"), "ignored\n");
        testing::write(&root.join("build/out.txt"), "ignored folder\n");

        let output = run::run_status(&git, &root, std::time::Duration::from_secs(30))
            .expect("git status runs");
        let by_path: std::collections::HashMap<String, (GitStatus, bool)> = parse(&output)
            .into_iter()
            .map(|c| (c.path, (c.status, c.folder)))
            .collect();
        assert_eq!(
            by_path.get("edited.md"),
            Some(&(GitStatus::Modified, false))
        );
        assert_eq!(
            by_path.get("naïve café.md"),
            Some(&(GitStatus::Modified, false))
        );
        assert_eq!(by_path.get("added.md"), Some(&(GitStatus::Added, false)));
        assert_eq!(
            by_path.get("new name.md"),
            Some(&(GitStatus::Renamed, false))
        );
        assert_eq!(
            by_path.get("fresh dir"),
            Some(&(GitStatus::Untracked, true))
        );
        assert_eq!(by_path.get("trace.log"), Some(&(GitStatus::Ignored, false)));
        assert_eq!(by_path.get("build"), Some(&(GitStatus::Ignored, true)));
        assert!(!by_path.contains_key("kept.md"));
        assert!(!by_path.contains_key("old name.md"));
    }
}
