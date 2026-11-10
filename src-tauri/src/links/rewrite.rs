//! The rewrite engine: when a file or folder moves, which links must change, and the change.
//!
//! [`plan`] runs before the move, so the user can still say no and nothing has changed. It reads
//! every text file under the workspace roots and works out, for each link, where it leads now and
//! where that place will be once the move is done:
//!
//! - a link to the moved file, or to something inside the moved folder, has to point at the new
//!   place;
//! - a relative link inside a file that is itself moving has to be written again from the new
//!   folder, even when its target stays where it is;
//! - a link whose target and file move together, so that the relative path is unchanged, is left
//!   alone, and so is every link that still resolves to the right place.
//!
//! An edit replaces the path part of one target and nothing else ([`super::scan`]). [`apply`] runs
//! after the move, writes each changed file through the atomic writer in the encoding the file
//! had, and collects what failed instead of stopping at the first failure. A file that changed
//! since it was read is never overwritten.

use super::scan::{self, Link};
use super::walk::{Scan, read_unless_binary, scan_bytes, walk};
use crate::error::AppError;
use crate::fs::atomic::{self, Stage};
use crate::fs::document::content_hash;
use crate::fs::encoding::{self, Decoded};
use std::collections::HashSet;
use std::ops::Range;
use std::path::{Component, Path, PathBuf, Prefix};

/// A file or folder going from `from` to `to`. Both are full paths; `to` need not exist yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Move {
    pub(crate) from: PathBuf,
    pub(crate) to: PathBuf,
}

/// One target to change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LinkEdit {
    /// Bytes of the path part of the target, in the text of the file as it was planned.
    pub(crate) span: Range<usize>,
    /// The target as it is written now, so an apply can tell the text is the one it planned for.
    pub(crate) old: String,
    /// The target as it will be written.
    pub(crate) new: String,
    pub(crate) line: usize,
}

/// The edits for one file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FileEdits {
    /// Where the file is while the plan is made.
    pub(crate) before: PathBuf,
    /// Where it is after the move: the same path, or under the new folder.
    pub(crate) after: PathBuf,
    /// Hash of its bytes when it was read. An apply refuses a file that no longer matches.
    pub(crate) hash: u128,
    pub(crate) edits: Vec<LinkEdit>,
}

/// A file the plan could not check.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Skipped {
    pub(crate) path: PathBuf,
    pub(crate) reason: String,
}

/// What the links in a workspace need when something moves.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Plan {
    pub(crate) files: Vec<FileEdits>,
    /// Files that could not be read, or are in an encoding mdmate does not write.
    pub(crate) skipped: Vec<Skipped>,
    /// Text files read.
    pub(crate) scanned: usize,
    /// Files left out as binary.
    pub(crate) binary: usize,
    /// Links that cannot be written as a relative path, because the file and the target end up on
    /// different drives. They are left as they are.
    pub(crate) unrelatable: usize,
}

impl Plan {
    /// How many targets change, over all files.
    pub(crate) fn links(&self) -> usize {
        self.files.iter().map(|file| file.edits.len()).sum()
    }
}

/// A file that could not be rewritten, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Failure {
    pub(crate) path: PathBuf,
    pub(crate) reason: String,
}

/// What an apply did.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Report {
    pub(crate) written: Vec<PathBuf>,
    pub(crate) failed: Vec<Failure>,
}

// ---- paths --------------------------------------------------------------------------------

/// An absolute path as names, so two spellings of one place compare equal and nothing touches
/// the disk: the old place of a moved file no longer exists once it has moved.
#[derive(Clone, Debug)]
struct Abs {
    prefix: String,
    parts: Vec<String>,
}

fn fold(text: &str, ignore_case: bool) -> String {
    if ignore_case {
        text.to_lowercase()
    } else {
        text.to_owned()
    }
}

fn same_name(a: &str, b: &str, ignore_case: bool) -> bool {
    a == b || (ignore_case && fold(a, true) == fold(b, true))
}

impl Abs {
    /// `None` for a path that is not absolute or that climbs above its root.
    fn of(path: &Path) -> Option<Self> {
        let mut prefix = String::new();
        let mut rooted = false;
        let mut parts = Vec::new();
        for component in path.components() {
            match component {
                Component::Prefix(p) => {
                    // `\\?\C:\x` and `C:\x` are one place.
                    prefix = match p.kind() {
                        Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
                            format!("{}:", char::from(d).to_ascii_uppercase())
                        }
                        _ => p.as_os_str().to_string_lossy().to_lowercase(),
                    };
                }
                Component::RootDir => rooted = true,
                Component::CurDir => {}
                Component::ParentDir => {
                    parts.pop()?;
                }
                Component::Normal(name) => parts.push(name.to_string_lossy().into_owned()),
            }
        }
        rooted.then_some(Self { prefix, parts })
    }

    fn to_path(&self) -> PathBuf {
        let mut path = PathBuf::from(format!("{}{}", self.prefix, std::path::MAIN_SEPARATOR));
        for part in &self.parts {
            path.push(part);
        }
        path
    }

    fn parent(&self) -> Self {
        let mut parts = self.parts.clone();
        parts.pop();
        Self {
            prefix: self.prefix.clone(),
            parts,
        }
    }

    /// Where a link written `link_path` in this folder leads. `None` when it climbs too far.
    fn join_link(&self, link_path: &str) -> Option<Self> {
        let mut parts = self.parts.clone();
        for segment in link_path.split(['/', '\\']) {
            match segment {
                "" | "." => {}
                ".." => {
                    parts.pop()?;
                }
                name => parts.push(name.to_owned()),
            }
        }
        Some(Self {
            prefix: self.prefix.clone(),
            parts,
        })
    }

    fn same_as(&self, other: &Self, ignore_case: bool) -> bool {
        self.prefix == other.prefix
            && self.parts.len() == other.parts.len()
            && self.starts_with(other, ignore_case)
    }

    /// The names after `base`, when `self` is `base` or lies under it.
    fn under<'a>(&'a self, base: &Self, ignore_case: bool) -> Option<&'a [String]> {
        (self.prefix == base.prefix && self.starts_with(base, ignore_case))
            .then(|| &self.parts[base.parts.len()..])
    }

    fn starts_with(&self, base: &Self, ignore_case: bool) -> bool {
        self.parts.len() >= base.parts.len()
            && base
                .parts
                .iter()
                .zip(&self.parts)
                .all(|(a, b)| same_name(a, b, ignore_case))
    }

    /// The path from this folder to `target` as names (`..` for each step up), or `None` when
    /// they are on different drives.
    fn relative_to(&self, target: &Self, ignore_case: bool) -> Option<Vec<String>> {
        if self.prefix != target.prefix {
            return None;
        }
        let common = self
            .parts
            .iter()
            .zip(&target.parts)
            .take_while(|(a, b)| same_name(a, b, ignore_case))
            .count();
        let mut out = vec!["..".to_owned(); self.parts.len() - common];
        out.extend(target.parts[common..].iter().cloned());
        Some(out)
    }
}

/// The two ends of a move, as names.
struct Moves {
    from: Abs,
    to: Abs,
}

impl Moves {
    /// Where something at `place` is once the move is done.
    fn after(&self, place: &Abs, ignore_case: bool) -> Abs {
        match place.under(&self.from, ignore_case) {
            Some(rest) => {
                let mut parts = self.to.parts.clone();
                parts.extend(rest.iter().cloned());
                Abs {
                    prefix: self.to.prefix.clone(),
                    parts,
                }
            }
            None => place.clone(),
        }
    }
}

// ---- planning -----------------------------------------------------------------------------

/// The edits one file needs. `links` are the links in the file at `file`, as they are now.
fn edits_for(
    links: &[Link],
    file: &Abs,
    moves: &Moves,
    ignore_case: bool,
    unrelatable: &mut usize,
) -> Vec<LinkEdit> {
    let new_dir = moves.after(file, ignore_case).parent();
    let old_dir = file.parent();
    let mut edits = Vec::new();
    for link in links {
        let Some(target) = old_dir.join_link(&link.path) else {
            continue;
        };
        let new_target = moves.after(&target, ignore_case);
        // Still right from where the file will be: leave the bytes alone. The spelling counts, so a
        // rename that only changes case still changes the links.
        if new_dir
            .join_link(&link.path)
            .is_some_and(|resolved| resolved.same_as(&new_target, false))
        {
            continue;
        }
        let Some(relative) = new_dir.relative_to(&new_target, ignore_case) else {
            *unrelatable += 1;
            continue;
        };
        edits.push(LinkEdit {
            span: link.span.clone(),
            old: link.raw.clone(),
            new: written(link, &relative),
            line: link.line,
        });
    }
    edits
}

/// The new target for `link`, in the style it was written: `./` and a trailing slash are kept,
/// and the escaping follows [`Link::render`].
fn written(link: &Link, relative: &[String]) -> String {
    let slash = link.raw.ends_with(['/', '\\']);
    let mut path = if relative.is_empty() {
        String::from(if slash { "./" } else { "." })
    } else {
        relative.join("/")
    };
    if slash && !path.ends_with('/') {
        path.push('/');
    }
    let climbs = relative.first().is_some_and(|part| part == "..");
    if link.raw.starts_with("./") && !climbs && !relative.is_empty() {
        path.insert_str(0, "./");
    }
    link.render(&path)
}

/// Works out every edit for moving `mv`, reading the files under `roots`. Call it before the
/// move. `progress` gets each file about to be read and returns false to stop early; what was
/// found until then is the plan.
pub(crate) fn plan(
    roots: &[PathBuf],
    mv: &Move,
    ignore_case: bool,
    mut progress: impl FnMut(&Path) -> bool,
) -> Result<Plan, AppError> {
    let (Some(from), Some(to)) = (Abs::of(&mv.from), Abs::of(&mv.to)) else {
        return Err(AppError::Invalid("a move needs full paths".into()));
    };
    let moves = Moves { from, to };
    let mut plan = Plan::default();
    let mut seen: HashSet<String> = HashSet::new();
    let mut stopped = false;
    for root in roots {
        if stopped {
            break;
        }
        walk(root, |path| {
            let Some(file) = Abs::of(path) else {
                return true;
            };
            // Roots can lie inside one another; a file is read once.
            let key = fold(&file.to_path().to_string_lossy(), ignore_case);
            if !seen.insert(key) {
                return true;
            }
            if !progress(path) {
                stopped = true;
                return false;
            }
            let bytes = match read_unless_binary(path) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => {
                    plan.binary += 1;
                    return true;
                }
                Err(error) => {
                    plan.skipped.push(Skipped {
                        path: path.to_path_buf(),
                        reason: error.to_string(),
                    });
                    return true;
                }
            };
            match scan_bytes(&bytes) {
                Scan::Binary => plan.binary += 1,
                Scan::Encoding => plan.skipped.push(Skipped {
                    path: path.to_path_buf(),
                    reason: "its encoding is not one mdmate writes".into(),
                }),
                Scan::Links { links, .. } => {
                    plan.scanned += 1;
                    let edits =
                        edits_for(&links, &file, &moves, ignore_case, &mut plan.unrelatable);
                    if !edits.is_empty() {
                        plan.files.push(FileEdits {
                            before: path.to_path_buf(),
                            after: moves.after(&file, ignore_case).to_path(),
                            hash: content_hash(&bytes),
                            edits,
                        });
                    }
                }
            }
            true
        });
    }
    Ok(plan)
}

// ---- applying -----------------------------------------------------------------------------

/// Writes the plan's edits, after the move. A file that fails is listed and the rest go on.
pub(crate) fn apply(plan: &Plan) -> Report {
    apply_with(plan, |_| Ok(()))
}

/// [`apply`] with a hook at each stage of every write, so a test can make one fail.
pub(crate) fn apply_with(plan: &Plan, hook: impl Fn(Stage) -> std::io::Result<()>) -> Report {
    let mut report = Report::default();
    for file in &plan.files {
        match write_one(file, &hook) {
            Ok(()) => report.written.push(file.after.clone()),
            Err(reason) => report.failed.push(Failure {
                path: file.after.clone(),
                reason,
            }),
        }
    }
    report
}

fn write_one(file: &FileEdits, hook: &impl Fn(Stage) -> std::io::Result<()>) -> Result<(), String> {
    let path = &file.after;
    let meta = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if meta.permissions().readonly() {
        return Err("the file is read-only".into());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    if content_hash(&bytes) != file.hash {
        return Err("the file changed after the links were read".into());
    }
    let Decoded::Text { format, text } = encoding::decode(&bytes) else {
        return Err("its encoding is not one mdmate writes".into());
    };
    let mut edits = Vec::with_capacity(file.edits.len());
    for edit in &file.edits {
        if text.get(edit.span.clone()) != Some(edit.old.as_str()) {
            return Err("a link is not where it was read".into());
        }
        edits.push(scan::Edit {
            span: edit.span.clone(),
            text: edit.new.clone(),
        });
    }
    let out = encoding::encode(&scan::apply(&text, &edits), format);
    if out == bytes {
        return Ok(());
    }
    atomic::write_atomic_with(path, &out, hook).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::encoding::{Encoding, Format};
    use std::fs;

    // ---- pure cases: strings in, strings out --------------------------------------------

    /// Plans the links of one file in memory and returns its text rewritten.
    fn rewritten(file: &str, text: &str, from: &str, to: &str, ignore_case: bool) -> String {
        let moves = Moves {
            from: Abs::of(Path::new(from)).expect("an absolute path"),
            to: Abs::of(Path::new(to)).expect("an absolute path"),
        };
        let file = Abs::of(Path::new(file)).expect("an absolute path");
        let mut lost = 0;
        let edits = edits_for(&scan::scan(text), &file, &moves, ignore_case, &mut lost);
        assert_eq!(lost, 0);
        let edits: Vec<scan::Edit> = edits
            .into_iter()
            .map(|edit| scan::Edit {
                span: edit.span,
                text: edit.new,
            })
            .collect();
        scan::apply(text, &edits)
    }

    #[test]
    fn a_link_to_a_renamed_file_follows_it() {
        let text = "[a](old.md) [b](<old.md#top>) ![c](old.md \"T\")\n[d]: old.md\n";
        assert_eq!(
            rewritten("/w/index.md", text, "/w/old.md", "/w/new.md", false),
            "[a](new.md) [b](<new.md#top>) ![c](new.md \"T\")\n[d]: new.md\n"
        );
    }

    #[test]
    fn links_from_other_folders_are_written_from_where_they_are() {
        assert_eq!(
            rewritten(
                "/w/a/b/page.md",
                "[x](../../old.md)\n",
                "/w/old.md",
                "/w/z/new.md",
                false
            ),
            "[x](../../z/new.md)\n"
        );
        assert_eq!(
            rewritten(
                "/w/z/page.md",
                "[x](../old.md)\n",
                "/w/old.md",
                "/w/z/new.md",
                false
            ),
            "[x](new.md)\n"
        );
        // The style of the link survives: a leading `./`, a trailing slash, escapes.
        assert_eq!(
            rewritten(
                "/w/p.md",
                "[x](./old.md)\n",
                "/w/old.md",
                "/w/sub/new.md",
                false
            ),
            "[x](./sub/new.md)\n"
        );
        assert_eq!(
            rewritten(
                "/w/p.md",
                "[x](my%20old/)\n",
                "/w/my old",
                "/w/new dir",
                false
            ),
            "[x](new%20dir/)\n"
        );
    }

    #[test]
    fn a_moved_file_has_its_relative_links_written_again() {
        let text = "[b](b.md) [img](../img/p.png) ![i](<pics/my pic.png>) [up](../top.md)\n";
        assert_eq!(
            rewritten(
                "/w/notes/a.md",
                text,
                "/w/notes/a.md",
                "/w/archive/old/a.md",
                false
            ),
            "[b](../../notes/b.md) [img](../../img/p.png) ![i](<../../notes/pics/my pic.png>) [up](../../top.md)\n"
        );
    }

    #[test]
    fn a_link_that_is_still_right_is_left_alone() {
        // The file moves, but into a folder from which the same text reaches the same place.
        assert_eq!(
            rewritten(
                "/w/a/x.md",
                "[t](../top.md) [u](./y.md)\n",
                "/w/a/x.md",
                "/w/b/x.md",
                false
            ),
            "[t](../top.md) [u](../a/y.md)\n"
        );
        // A link elsewhere, to something that does not move, is not touched.
        let text = "[t](other.md) [w](https://x.test/old.md) [h](#old.md)\n";
        assert_eq!(
            rewritten("/w/p.md", text, "/w/old.md", "/w/new.md", false),
            text
        );
    }

    #[test]
    fn a_folder_that_moves_keeps_the_links_inside_it_and_fixes_the_ones_to_it() {
        // Inside the folder, links between its own files and to its own subfolders stay as they are.
        let inside = "[a](b.md) [c](deep/c.md) [d](./deep/d.md)\n";
        assert_eq!(
            rewritten("/w/notes/a.md", inside, "/w/notes", "/w/journal", false),
            inside
        );
        // A link out of the folder to a file that stays now has to climb from the new place.
        assert_eq!(
            rewritten(
                "/w/notes/a.md",
                "[t](../top.md)\n",
                "/w/notes",
                "/w/x/journal",
                false
            ),
            "[t](../../top.md)\n"
        );
        // Links to the folder and to files in it.
        assert_eq!(
            rewritten(
                "/w/p.md",
                "[a](notes/) [b](notes/deep/c.md#h) [c](notes)\n",
                "/w/notes",
                "/w/journal",
                false
            ),
            "[a](journal/) [b](journal/deep/c.md#h) [c](journal)\n"
        );
    }

    #[test]
    fn a_link_to_a_moved_folder_from_a_moved_file_is_right_after_both() {
        // Both move together as one folder: nothing to change.
        assert_eq!(
            rewritten("/w/f/a.md", "[b](sub/b.md)\n", "/w/f", "/w/g/h", false),
            "[b](sub/b.md)\n"
        );
    }

    #[test]
    fn case_is_ignored_when_the_file_system_ignores_it() {
        let text = "[a](Old.md) [b](OLD.MD#x)\n";
        assert_eq!(
            rewritten("/w/p.md", text, "/w/old.md", "/w/new.md", true),
            "[a](new.md) [b](new.md#x)\n"
        );
        assert_eq!(
            rewritten("/w/p.md", text, "/w/old.md", "/w/new.md", false),
            text
        );
        // A rename that changes only the case still changes the spelling of the links.
        assert_eq!(
            rewritten(
                "/w/p.md",
                "[a](Old.md) [b](old.md)\n",
                "/w/Old.md",
                "/w/old.md",
                true
            ),
            "[a](old.md) [b](old.md)\n"
        );
    }

    #[test]
    fn a_link_that_climbs_above_the_root_is_skipped_and_one_across_drives_is_counted() {
        let moves = Moves {
            from: Abs::of(Path::new("/w/old.md")).expect("absolute"),
            to: Abs::of(Path::new("/w/new.md")).expect("absolute"),
        };
        let file = Abs::of(Path::new("/w/p.md")).expect("absolute");
        let mut lost = 0;
        assert!(
            edits_for(
                &scan::scan("[a](../../../old.md)\n"),
                &file,
                &moves,
                false,
                &mut lost
            )
            .is_empty()
        );
        // The same place on two drives cannot be written relative to each other.
        let on_c = Abs {
            prefix: "C:".into(),
            parts: vec!["a".into()],
        };
        let on_d = Abs {
            prefix: "D:".into(),
            parts: vec!["b".into()],
        };
        assert_eq!(on_c.relative_to(&on_d, true), None);
    }

    #[test]
    fn a_verbatim_windows_path_is_the_same_place_as_the_plain_one() {
        if std::env::consts::OS != "windows" {
            return;
        }
        let plain = Abs::of(Path::new(r"C:\Users\x\a.md")).expect("absolute");
        let verbatim = Abs::of(Path::new(r"\\?\C:\Users\x\a.md")).expect("absolute");
        assert!(plain.same_as(&verbatim, true));
    }

    #[test]
    fn a_move_needs_full_paths() {
        let result = plan(
            &[],
            &Move {
                from: "a.md".into(),
                to: "/w/b.md".into(),
            },
            false,
            |_| true,
        );
        assert!(matches!(result, Err(AppError::Invalid(_))));
    }

    // ---- on disk ------------------------------------------------------------------------

    fn put(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("a folder can be made");
        }
        fs::write(&path, bytes).expect("a file can be written");
        path
    }

    fn ignore_case() -> bool {
        std::env::consts::OS == "windows"
    }

    /// Plans, moves on disk, applies.
    fn run(root: &Path, from: &Path, to: &Path) -> (Plan, Report) {
        let plan = plan(
            &[root.to_path_buf()],
            &Move {
                from: from.to_path_buf(),
                to: to.to_path_buf(),
            },
            ignore_case(),
            |_| true,
        )
        .expect("the paths are absolute");
        fs::rename(from, to).expect("the move works");
        let report = apply(&plan);
        (plan, report)
    }

    #[test]
    fn rewrite_closed() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        put(root, "old.md", b"# old\n");
        put(
            root,
            "index.md",
            b"[a](old.md#h)\r\n\r\n[b](notes/n.md)\r\n",
        );
        put(root, "bom.md", b"\xEF\xBB\xBF[a](old.md)\n");
        put(root, "notes/n.md", b"[a](../old.md) and [b](sibling.md)\n");
        put(root, "notes/sibling.md", b"nothing here\n");
        let mut utf16 = vec![0xFF, 0xFE];
        for unit in "[a](old.md)\r\n".encode_utf16() {
            utf16.extend(unit.to_le_bytes());
        }
        put(root, "wide.md", &utf16);
        let untouched = put(root, "other.txt", b"no links at all\n");
        let before_untouched = fs::metadata(&untouched)
            .expect("metadata")
            .modified()
            .expect("mtime");

        let (plan, report) = run(root, &root.join("old.md"), &root.join("notes/renamed.md"));

        assert_eq!(report.failed, []);
        assert_eq!(plan.links(), 4);
        assert_eq!(plan.files.len(), 4);
        assert_eq!(
            fs::read(root.join("index.md")).expect("read"),
            b"[a](notes/renamed.md#h)\r\n\r\n[b](notes/n.md)\r\n"
        );
        assert_eq!(
            fs::read(root.join("bom.md")).expect("read"),
            b"\xEF\xBB\xBF[a](notes/renamed.md)\n"
        );
        assert_eq!(
            fs::read(root.join("notes/n.md")).expect("read"),
            b"[a](renamed.md) and [b](sibling.md)\n"
        );
        let mut want = vec![0xFF, 0xFE];
        for unit in "[a](notes/renamed.md)\r\n".encode_utf16() {
            want.extend(unit.to_le_bytes());
        }
        assert_eq!(fs::read(root.join("wide.md")).expect("read"), want);
        // A file with nothing to change was not written at all.
        assert_eq!(
            fs::metadata(&untouched)
                .expect("metadata")
                .modified()
                .expect("mtime"),
            before_untouched
        );
        let mut written: Vec<String> = report
            .written
            .iter()
            .map(|p| p.file_name().expect("name").to_string_lossy().into_owned())
            .collect();
        written.sort();
        assert_eq!(written, ["bom.md", "index.md", "n.md", "wide.md"]);
    }

    #[test]
    fn a_moved_file_is_written_at_its_new_place() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        put(root, "a/x.md", b"[b](b.md) [i](../img/p.png)\n");
        put(root, "a/b.md", b"b\n");
        put(root, "img/p.png", b"png");
        fs::create_dir_all(root.join("z/deep")).expect("a folder");
        let (_, report) = run(root, &root.join("a/x.md"), &root.join("z/deep/x.md"));
        assert_eq!(report.failed, []);
        assert_eq!(
            fs::read(root.join("z/deep/x.md")).expect("read"),
            b"[b](../../a/b.md) [i](../../img/p.png)\n"
        );
    }

    #[test]
    fn a_plan_that_does_not_match_the_text_is_refused_even_when_the_hash_does() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        let bytes = b"[a](old.md)\n";
        let path = put(root, "a.md", bytes);
        let edit = |span: Range<usize>, old: &str| Plan {
            files: vec![FileEdits {
                before: path.clone(),
                after: path.clone(),
                hash: content_hash(bytes),
                edits: vec![LinkEdit {
                    span,
                    old: old.to_owned(),
                    new: "new.md".to_owned(),
                    line: 1,
                }],
            }],
            ..Plan::default()
        };
        // The text there is not the one planned; a span past the end; a span that stops short.
        for plan in [
            edit(4..7, "xyz"),
            edit(4..400, "old.md"),
            edit(4..9, "old.md"),
        ] {
            let report = apply(&plan);
            assert_eq!(report.written, Vec::<PathBuf>::new());
            assert_eq!(report.failed.len(), 1);
            assert!(report.failed[0].reason.contains("not where"));
            assert_eq!(fs::read(&path).expect("read"), bytes);
        }
        // The right one goes through.
        assert_eq!(apply(&edit(4..10, "old.md")).failed, []);
        assert_eq!(fs::read(&path).expect("read"), b"[a](new.md)\n");
    }

    #[test]
    fn rewrite_failures() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        put(root, "old.md", b"x\n");
        put(root, "ok.md", b"[a](old.md)\n");
        let locked = put(root, "locked.md", b"[a](old.md)\n");
        let changed = put(root, "changed.md", b"[a](old.md)\n");
        let gone = put(root, "gone.md", b"[a](old.md)\n");
        let plan = plan(
            &[root.to_path_buf()],
            &Move {
                from: root.join("old.md"),
                to: root.join("new.md"),
            },
            ignore_case(),
            |_| true,
        )
        .expect("the paths are absolute");
        assert_eq!(plan.files.len(), 4);
        fs::rename(root.join("old.md"), root.join("new.md")).expect("move");

        let mut permissions = fs::metadata(&locked).expect("metadata").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&locked, permissions).expect("read-only");
        fs::write(&changed, b"[a](old.md) edited since the scan\n").expect("edit");
        fs::remove_file(&gone).expect("remove");

        let report = apply(&plan);

        // The one that could be written was, and each of the others is listed with a reason.
        assert_eq!(
            fs::read(root.join("ok.md")).expect("read"),
            b"[a](new.md)\n"
        );
        assert_eq!(report.written, [root.join("ok.md")]);
        let mut failed: Vec<(String, String)> = report
            .failed
            .iter()
            .map(|f| {
                (
                    f.path
                        .file_name()
                        .expect("name")
                        .to_string_lossy()
                        .into_owned(),
                    f.reason.clone(),
                )
            })
            .collect();
        failed.sort();
        assert_eq!(failed.len(), 3, "{failed:?}");
        assert_eq!(failed[0].0, "changed.md");
        assert!(failed[0].1.contains("changed"), "{failed:?}");
        assert_eq!(failed[1].0, "gone.md");
        assert_eq!(failed[2].0, "locked.md");
        assert!(failed[2].1.contains("read-only"), "{failed:?}");
        // Neither the locked file nor the edited one was touched.
        assert_eq!(fs::read(&locked).expect("read"), b"[a](old.md)\n");
        assert_eq!(
            fs::read(&changed).expect("read"),
            b"[a](old.md) edited since the scan\n"
        );
    }

    #[test]
    fn a_write_that_fails_leaves_the_file_as_it_was_and_no_temp_file() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        put(root, "old.md", b"x\n");
        put(root, "a.md", b"[a](old.md)\n");
        let plan = plan(
            &[root.to_path_buf()],
            &Move {
                from: root.join("old.md"),
                to: root.join("new.md"),
            },
            ignore_case(),
            |_| true,
        )
        .expect("the paths are absolute");
        fs::rename(root.join("old.md"), root.join("new.md")).expect("move");
        let report = apply_with(&plan, |stage| match stage {
            Stage::BeforeRename => Err(std::io::Error::other("disk full")),
            Stage::AfterRename => Ok(()),
        });
        assert_eq!(report.written, Vec::<PathBuf>::new());
        assert_eq!(report.failed.len(), 1);
        assert!(
            report.failed[0].reason.contains("disk full"),
            "{:?}",
            report.failed
        );
        assert_eq!(fs::read(root.join("a.md")).expect("read"), b"[a](old.md)\n");
        let mut names: Vec<String> = fs::read_dir(root)
            .expect("list")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["a.md", "new.md"]);
    }

    #[test]
    fn the_plan_reports_what_it_could_not_read_and_stops_when_asked() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        put(root, "old.md", b"x\n");
        put(root, "a.md", b"[a](old.md)\n");
        put(root, "latin.txt", b"caf\xE9 [a](old.md)\n");
        put(root, "blob.bin", b"\x00\x01\x02");
        let mv = Move {
            from: root.join("old.md"),
            to: root.join("new.md"),
        };
        let plan = plan(
            &[root.to_path_buf(), root.to_path_buf()],
            &mv,
            ignore_case(),
            |_| true,
        )
        .expect("planned");
        assert_eq!(plan.links(), 1);
        assert_eq!(plan.binary, 1);
        assert_eq!(plan.skipped.len(), 1);
        assert!(plan.skipped[0].path.ends_with("latin.txt"));
        // Two roots that overlap read each file once.
        assert_eq!(plan.scanned, 2);
        // A "no" from the progress callback ends the walk: it is asked once and never again.
        let mut asked = 0;
        let both = [root.to_path_buf(), root.to_path_buf()];
        let stopped = super::plan(&both, &mv, ignore_case(), |_| {
            asked += 1;
            false
        })
        .expect("planned");
        assert_eq!(stopped.scanned, 0);
        assert_eq!(asked, 1);
    }

    #[test]
    fn the_shortest_path_is_found_even_when_a_folder_is_spelled_two_ways() {
        // On a file system that ignores case, `Notes` and `notes` are one folder.
        let out = rewritten(
            "/w/Notes/p.md",
            "[x](../old.md)\n",
            "/w/old.md",
            "/w/notes/sub/new.md",
            true,
        );
        assert_eq!(out, "[x](sub/new.md)\n");
    }

    // ---- property tests: a random workspace, a random move, the whole workspace read again ----

    struct Rng(u64);

    impl Rng {
        fn below(&mut self, n: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            usize::try_from(self.0 >> 33).unwrap_or(0) % n
        }
        fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
            &items[self.below(items.len())]
        }
    }

    const FOLDERS: [&str; 8] = [
        "notes", "my docs", "日本", "img", "a b", "deep", "x.y", "dir(1)",
    ];
    const STEMS: [&str; 9] = ["a", "b", "c d", "é", "日本", "n(1)", "readme", "x-y", "x_y"];
    const EXTS: [&str; 4] = ["md", "md", "txt", "html"];
    const NEW_NAMES: [&str; 5] = ["zz", "new name", "Ünï", "q(2)", "moved"];

    type Rel = Vec<String>;

    struct World {
        folders: Vec<Rel>,
        files: Vec<Rel>,
    }

    fn path_of(root: &Path, rel: &[String]) -> PathBuf {
        let mut path = root.to_path_buf();
        for part in rel {
            path.push(part);
        }
        path
    }

    /// Percent-escapes everything outside the unreserved set, as a link writer would.
    fn escaped(part: &str) -> String {
        let mut out = String::new();
        for c in part.chars() {
            if c.is_ascii_alphanumeric() || "-._~".contains(c) {
                out.push(c);
            } else {
                let mut buffer = [0; 4];
                for byte in c.encode_utf8(&mut buffer).bytes() {
                    out.push_str(&format!("%{byte:02X}"));
                }
            }
        }
        out
    }

    /// The relative path from folder `from` to `to`, worked out with plain names.
    fn relative(from: &[String], to: &[String]) -> Rel {
        let common = from.iter().zip(to).take_while(|(a, b)| a == b).count();
        let mut out = vec!["..".to_owned(); from.len() - common];
        out.extend(to[common..].iter().cloned());
        out
    }

    fn link_line(rng: &mut Rng, rel: &[String], is_dir: bool) -> String {
        let join = |escape: bool| {
            let mut text = if rel.is_empty() {
                ".".to_owned()
            } else {
                rel.iter()
                    .map(|p| {
                        if escape && p != ".." {
                            escaped(p)
                        } else {
                            p.clone()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("/")
            };
            if is_dir && !text.ends_with('/') {
                text.push('/');
            }
            text
        };
        match rng.below(9) {
            0 => format!("[t]({})", join(true)),
            1 => format!("[t](<{}>)", join(false)),
            2 => format!("![t]({})", join(true)),
            3 => format!("[id]: {} \"title\"", join(true)),
            4 => format!("<img src=\"{}\">", join(true)),
            5 => format!("<a href='{}#frag'>t</a>", join(true)),
            6 => format!("[t]({}#h \"T\")", join(true)),
            7 if rel.first().is_none_or(|p| p != "..") => format!("[t](./{})", join(true)),
            7 => format!("[t]({})", join(true)),
            _ => format!("[t](<{}>)", join(true)),
        }
    }

    fn build(rng: &mut Rng, root: &Path) -> World {
        let mut folders: Vec<Rel> = vec![Vec::new()];
        for _ in 0..2 + rng.below(3) {
            let name = (*rng.pick(&FOLDERS)).to_owned();
            if !folders.contains(&vec![name.clone()]) {
                folders.push(vec![name.clone()]);
                if rng.below(2) == 0 {
                    let child = (*rng.pick(&FOLDERS)).to_owned();
                    if child != name {
                        folders.push(vec![name.clone(), child]);
                    }
                }
            }
        }
        let mut files: Vec<Rel> = Vec::new();
        for _ in 0..10 + rng.below(5) {
            let mut rel = rng.pick(&folders).clone();
            rel.push(format!("{}.{}", rng.pick(&STEMS), rng.pick(&EXTS)));
            if !files.contains(&rel) {
                files.push(rel);
            }
        }
        for folder in &folders {
            fs::create_dir_all(path_of(root, folder)).expect("a folder");
        }
        for file in &files {
            let mut lines = vec!["# title".to_owned()];
            let dir: Rel = file[..file.len() - 1].to_vec();
            for _ in 0..rng.below(6) {
                let roll = rng.below(20);
                let (target, is_dir) = if roll < 16 {
                    (rng.pick(&files).clone(), false)
                } else if roll < 19 {
                    (rng.pick(&folders).clone(), true)
                } else {
                    let mut gone = rng.pick(&folders).clone();
                    gone.push("gone.md".to_owned());
                    (gone, false)
                };
                lines.push(link_line(rng, &relative(&dir, &target), is_dir));
            }
            if rng.below(4) == 0 {
                let target = rng.pick(&files).clone();
                lines.push(format!(
                    "```\n[never]({})\n```",
                    relative(&dir, &target).join("/")
                ));
            }
            let ending = if rng.below(3) == 0 { "\r\n" } else { "\n" };
            let text = lines.join(&format!("{ending}{ending}")) + ending;
            let format = match rng.below(7) {
                0 => Format {
                    encoding: Encoding::Utf8,
                    bom: true,
                },
                1 => Format {
                    encoding: Encoding::Utf16Le,
                    bom: true,
                },
                _ => Format {
                    encoding: Encoding::Utf8,
                    bom: false,
                },
            };
            fs::write(path_of(root, file), encoding::encode(&text, format)).expect("a file");
        }
        World { folders, files }
    }

    #[derive(Clone, Copy, Debug)]
    enum Op {
        RenameFile,
        RenameFolder,
        MoveFile,
        MoveFolder,
    }

    /// Picks a move that is possible in this world, as full paths.
    fn choose(rng: &mut Rng, world: &World, root: &Path, op: Op) -> Option<(PathBuf, PathBuf)> {
        let exists = |rel: &Rel| world.files.contains(rel) || world.folders.contains(rel);
        match op {
            Op::RenameFile | Op::RenameFolder => {
                let from: Rel = if matches!(op, Op::RenameFile) {
                    rng.pick(&world.files).clone()
                } else {
                    let candidates: Vec<&Rel> =
                        world.folders.iter().filter(|f| !f.is_empty()).collect();
                    (*candidates.get(rng.below(candidates.len().max(1)))?).clone()
                };
                let mut to = from[..from.len() - 1].to_vec();
                let name = rng.pick(&NEW_NAMES);
                to.push(if matches!(op, Op::RenameFile) {
                    format!("{name}.md")
                } else {
                    (*name).to_owned()
                });
                (!exists(&to)).then(|| (path_of(root, &from), path_of(root, &to)))
            }
            Op::MoveFile | Op::MoveFolder => {
                let from: Rel = if matches!(op, Op::MoveFile) {
                    rng.pick(&world.files).clone()
                } else {
                    let candidates: Vec<&Rel> =
                        world.folders.iter().filter(|f| !f.is_empty()).collect();
                    (*candidates.get(rng.below(candidates.len().max(1)))?).clone()
                };
                let target_folder = rng.pick(&world.folders).clone();
                let inside_itself = target_folder.starts_with(&from);
                let mut to = target_folder.clone();
                to.push(from[from.len() - 1].clone());
                (!inside_itself && target_folder != from[..from.len() - 1] && !exists(&to))
                    .then(|| (path_of(root, &from), path_of(root, &to)))
            }
        }
    }

    /// Where a path is after the move.
    fn moved(path: &Path, from: &Path, to: &Path) -> PathBuf {
        match path.strip_prefix(from) {
            Ok(rest) if rest.as_os_str().is_empty() => to.to_path_buf(),
            Ok(rest) => to.join(rest),
            Err(_) => path.to_path_buf(),
        }
    }

    /// `rel` resolved against `dir` with plain names and nothing from the disk.
    fn lexical(dir: &Path, rel: &str) -> PathBuf {
        let mut path = dir.to_path_buf();
        for part in rel.split(['/', '\\']) {
            match part {
                "" | "." => {}
                ".." => {
                    path.pop();
                }
                name => path.push(name),
            }
        }
        path
    }

    fn links_of(bytes: &[u8]) -> (Format, String, Vec<scan::Link>) {
        let Decoded::Text { format, text } = encoding::decode(bytes) else {
            panic!("a fixture file is not text");
        };
        let links = scan::scan(&text);
        (format, text, links)
    }

    /// The text with every link target blanked out: what an edit must leave alone.
    fn masked(text: &str, links: &[scan::Link]) -> String {
        let edits: Vec<scan::Edit> = links
            .iter()
            .map(|l| scan::Edit {
                span: l.span.clone(),
                text: "\u{0}".to_owned(),
            })
            .collect();
        scan::apply(text, &edits)
    }

    /// One random workspace, one move, and every claim checked against what is on disk after.
    fn check_case(seed: u64, ops: &[Op]) -> bool {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path();
        let world = build(&mut rng, root);
        let op = *rng.pick(ops);
        let Some((from, to)) = choose(&mut rng, &world, root, op) else {
            return false;
        };

        // Before: every file, its bytes, and where each of its links leads and whether it exists.
        struct Before {
            path: PathBuf,
            bytes: Vec<u8>,
            targets: Vec<(PathBuf, bool)>,
        }
        let mut before = Vec::new();
        for file in &world.files {
            let path = path_of(root, file);
            let bytes = fs::read(&path).expect("read");
            let (_, _, links) = links_of(&bytes);
            let dir = path.parent().expect("a parent").to_path_buf();
            let targets = links
                .iter()
                .map(|l| {
                    let target = lexical(&dir, &l.path);
                    let exists = target.exists();
                    (target, exists)
                })
                .collect();
            before.push(Before {
                path,
                bytes,
                targets,
            });
        }

        let (plan, report) = run(root, &from, &to);
        let context = format!("seed {seed} {op:?} {} -> {}", from.display(), to.display());
        assert_eq!(report.failed, [], "{context}");

        let planned: Vec<PathBuf> = plan.files.iter().map(|f| f.after.clone()).collect();
        for case in &before {
            let after_path = moved(&case.path, &from, &to);
            let bytes = fs::read(&after_path)
                .unwrap_or_else(|e| panic!("{context}: {} {e}", after_path.display()));
            let (format_before, text_before, links_before) = links_of(&case.bytes);
            let (format_after, text_after, links_after) = links_of(&bytes);
            let after_dir = after_path.parent().expect("a parent").to_path_buf();

            // The same links, in the same order.
            assert_eq!(
                links_before.len(),
                links_after.len(),
                "{context}: {}",
                after_path.display()
            );
            assert_eq!(format_before, format_after, "{context}");

            // Zero links to the old path; every link that worked still works and leads to the
            // same file (ISC-113 to ISC-115).
            for (index, link) in links_after.iter().enumerate() {
                let target = lexical(&after_dir, &link.path);
                assert!(
                    !target.starts_with(&from),
                    "{context}: {} still links to {}",
                    after_path.display(),
                    link.raw
                );
                let (was, existed) = &case.targets[index];
                if *existed {
                    let want = moved(was, &from, &to);
                    assert!(
                        target.exists(),
                        "{context}: {} {} is broken",
                        after_path.display(),
                        link.raw
                    );
                    assert_eq!(
                        fs::canonicalize(&target).expect("it exists"),
                        fs::canonicalize(&want).unwrap_or_else(|e| panic!(
                            "{context}: want {} was {} in {}: {e}",
                            want.display(),
                            was.display(),
                            after_path.display()
                        )),
                        "{context}: {} {}",
                        after_path.display(),
                        link.raw
                    );
                }
            }

            // Only the targets changed, and a file with nothing to change was not written
            // (ISC-125).
            assert_eq!(
                masked(&text_before, &links_before),
                masked(&text_after, &links_after),
                "{context}: {}",
                after_path.display()
            );
            if !planned.contains(&after_path) {
                assert_eq!(
                    bytes,
                    case.bytes,
                    "{context}: {} changed without a plan",
                    after_path.display()
                );
            } else {
                assert_ne!(
                    text_before,
                    text_after,
                    "{context}: {} planned and not changed",
                    after_path.display()
                );
            }
        }
        true
    }

    fn property(ops: &[Op], cases: u64) {
        let mut ran = 0;
        for seed in 0..cases {
            if check_case(seed, ops) {
                ran += 1;
            }
        }
        assert!(
            ran > cases / 3,
            "only {ran} of {cases} random moves were possible"
        );
    }

    #[test]
    fn rewrite_inbound() {
        property(&[Op::RenameFile, Op::RenameFolder], 120);
    }

    #[test]
    fn rewrite_outbound() {
        property(&[Op::MoveFile], 120);
    }

    #[test]
    fn rewrite_folder() {
        property(&[Op::RenameFolder, Op::MoveFolder], 120);
    }

    #[test]
    fn rewrite_minimal() {
        property(
            &[
                Op::RenameFile,
                Op::RenameFolder,
                Op::MoveFile,
                Op::MoveFolder,
            ],
            160,
        );
    }
}
