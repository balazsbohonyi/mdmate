//! The file index behind Ctrl+P: every file under the workspace roots, found by a few typed
//! letters.
//!
//! The index is built the first time the page asks (nothing is read at startup) and rebuilt
//! whenever the page opens the picker, so a file made by another program a moment ago is there.
//! A query runs against the last finished index while a rebuild goes on, so typing never waits
//! for a walk. Matching is done here, so only the few best results cross to the page.
//!
//! What is listed: every file except those in a folder called `.git`, at any depth, and links are
//! not followed (the same walk the link rewrite uses). The tree hides nothing, so neither does this.
//! A workspace of more than [`MAX_FILES`] files is cut there and the answer says so.

use crate::access::display_path;
use crate::documents::AppState;
use crate::links::walk::{Scope, walk};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

/// Files indexed before the walk stops. A root that is a whole drive would otherwise read the
/// drive.
pub(crate) const MAX_FILES: usize = 250_000;

/// The longest query that is matched; the rest is ignored.
const MAX_QUERY: usize = 64;

/// What one indexed file is.
#[derive(Debug)]
struct Entry {
    path: PathBuf,
    /// The path as shown: relative to its root with `/`, led by the root's name when more than one
    /// folder is open.
    rel: Vec<char>,
    /// The same, folded for matching.
    folded: Vec<char>,
    /// Where the file's own name starts in `rel`.
    name_start: usize,
}

/// Every file under the roots at one moment.
#[derive(Debug, Default)]
pub(crate) struct Index {
    entries: Vec<Entry>,
    truncated: bool,
}

/// One result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Item {
    /// The file, as people read paths; the page opens it as a tree row does.
    pub(crate) path: String,
    pub(crate) rel: String,
    /// Where the file's name starts in `rel`, in UTF-16 units like `matches`.
    #[serde(rename = "nameStart")]
    pub(crate) name_start: usize,
    /// The letters of `rel` that matched, as UTF-16 offsets.
    pub(crate) matches: Vec<usize>,
}

/// The best results for a query.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Answer {
    pub(crate) items: Vec<Item>,
    /// How many files matched, of which `items` holds the best.
    pub(crate) total: usize,
    /// How many files the index holds.
    pub(crate) indexed: usize,
    /// True when the workspace had more files than are indexed.
    pub(crate) truncated: bool,
}

fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// The name a root is shown by.
fn root_label(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(root))
}

/// Reads every file under `roots`.
pub(crate) fn build(roots: &[PathBuf], max_files: usize) -> Index {
    let several = roots.len() > 1;
    let mut index = Index::default();
    'roots: for root in roots {
        let label = root_label(root);
        let mut over = false;
        walk(root, Scope::Everything, |file| {
            if index.entries.len() >= max_files {
                over = true;
                return false;
            }
            let Ok(inside) = file.strip_prefix(root) else {
                return true;
            };
            let mut rel = String::new();
            if several {
                rel.push_str(&label);
                rel.push('/');
            }
            let parts: Vec<String> = inside
                .components()
                .map(|part| part.as_os_str().to_string_lossy().into_owned())
                .collect();
            rel.push_str(&parts.join("/"));
            let rel: Vec<char> = rel.chars().collect();
            let name_start = rel
                .iter()
                .rposition(|c| *c == '/')
                .map_or(0, |slash| slash + 1);
            let folded = rel.iter().map(|c| fold(*c)).collect();
            index.entries.push(Entry {
                path: file.to_path_buf(),
                rel,
                folded,
                name_start,
            });
            true
        });
        if over {
            index.truncated = true;
            break 'roots;
        }
    }
    index
}

/// Points for how a letter was matched. Chosen so that a name beats a folder, a run beats scattered
/// letters, and the start of a word beats the middle of one; the tests pin each of those.
const BASE: i32 = 16;
const RUN: i32 = 18;
const GAP: i32 = 3;
const LEADING_GAP: i32 = 1;
const LEADING_GAP_MAX: i32 = 12;
const IN_NAME: i32 = 8;
const EXACT_CASE: i32 = 2;
const AFTER_SLASH: i32 = 24;
const AFTER_SEPARATOR: i32 = 20;
const CAMEL: i32 = 16;

/// The bonus for matching the letter at `at`, from what comes before it.
fn boundary(rel: &[char], at: usize) -> i32 {
    let Some(before) = at.checked_sub(1).and_then(|i| rel.get(i)) else {
        return AFTER_SLASH;
    };
    match before {
        '/' => AFTER_SLASH,
        '-' | '_' | ' ' | '.' => AFTER_SEPARATOR,
        c if c.is_lowercase() && rel.get(at).is_some_and(|here| here.is_uppercase()) => CAMEL,
        _ => 0,
    }
}

/// Reusable working space, so matching many files does not allocate for each.
#[derive(Default)]
struct Scratch {
    score: Vec<i32>,
    from: Vec<usize>,
}

const NONE: i32 = i32::MIN / 2;

/// Scores `query` (folded, spaces removed) against a file and says which letters matched, or None
/// when it is not a subsequence. Letters are matched in order; the best placement is chosen.
fn score(
    query: &[char],
    typed: &[char],
    entry: &Entry,
    scratch: &mut Scratch,
) -> Option<(i32, Vec<usize>)> {
    let hay = &entry.folded;
    let (m, n) = (query.len(), hay.len());
    if m == 0 || m > n {
        return None;
    }
    // A cheap first pass: is it a subsequence at all?
    let mut next = 0;
    for c in hay {
        if next < m && *c == query[next] {
            next += 1;
        }
    }
    if next < m {
        return None;
    }
    scratch.score.clear();
    scratch.score.resize(m * n, NONE);
    scratch.from.clear();
    scratch.from.resize(m * n, usize::MAX);
    for i in 0..m {
        // For letter i at place j, the best earlier placement of letter i-1 at k <= j-2, after
        // paying GAP for each letter skipped: score[k] - GAP*(j-k-1) = (score[k] + GAP*k) - GAP*(j-1).
        // So one running best of score[k] + GAP*k is enough.
        let mut spaced = NONE;
        let mut spaced_at = usize::MAX;
        // `j` is a place in the text and also an offset into the score table, so it is the index.
        #[allow(clippy::needless_range_loop)]
        for j in i..n {
            if i > 0 && j >= 2 {
                let k = j - 2;
                let earlier = scratch.score[(i - 1) * n + k];
                if earlier > NONE && earlier + GAP * k as i32 > spaced {
                    spaced = earlier + GAP * k as i32;
                    spaced_at = k;
                }
            }
            if hay[j] != query[i] {
                continue;
            }
            let mut here = BASE + boundary(&entry.rel, j);
            if j >= entry.name_start {
                here += IN_NAME;
            }
            if entry.rel[j] == typed[i] {
                here += EXACT_CASE;
            }
            let (from_score, from_at) = if i == 0 {
                (-(LEADING_GAP * (j as i32).min(LEADING_GAP_MAX)), usize::MAX)
            } else {
                let mut choice = if spaced > NONE {
                    (spaced - GAP * (j as i32 - 1), spaced_at)
                } else {
                    (NONE, usize::MAX)
                };
                let adjacent = if j >= 1 {
                    scratch.score[(i - 1) * n + (j - 1)]
                } else {
                    NONE
                };
                if adjacent > NONE && adjacent + RUN >= choice.0 {
                    choice = (adjacent + RUN, j - 1);
                }
                choice
            };
            if from_score <= NONE {
                continue;
            }
            scratch.score[i * n + j] = from_score + here;
            scratch.from[i * n + j] = from_at;
        }
    }
    let last = (m - 1) * n;
    let (end, best) = (0..n)
        .filter(|j| scratch.score[last + j] > NONE)
        .map(|j| (j, scratch.score[last + j]))
        .max_by_key(|(_, s)| *s)?;
    let mut at = vec![0; m];
    let mut j = end;
    for i in (0..m).rev() {
        at[i] = j;
        if i > 0 {
            j = scratch.from[i * n + j];
        }
    }
    Some((best, at))
}

/// Where each letter starts, in UTF-16 units, with the total as a last entry.
fn utf16_offsets(rel: &[char]) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(rel.len() + 1);
    let mut units = 0;
    for c in rel {
        offsets.push(units);
        units += c.len_utf16();
    }
    offsets.push(units);
    offsets
}

impl Index {
    /// The best `limit` files for what was typed. Spaces in the query are ignored, and case does
    /// not matter. An empty query lists files in path order.
    pub(crate) fn search(&self, typed: &str, limit: usize) -> Answer {
        let typed: Vec<char> = typed
            .chars()
            .filter(|c| !c.is_whitespace())
            .take(MAX_QUERY)
            .collect();
        let query: Vec<char> = typed.iter().map(|c| fold(*c)).collect();
        let mut found: Vec<(i32, usize, Vec<usize>)> = Vec::new();
        let mut total = 0;
        if query.is_empty() {
            let mut order: Vec<usize> = (0..self.entries.len()).collect();
            order.sort_by(|a, b| self.entries[*a].folded.cmp(&self.entries[*b].folded));
            total = order.len();
            found.extend(order.into_iter().take(limit).map(|i| (0, i, Vec::new())));
        } else {
            let mut scratch = Scratch::default();
            for (i, entry) in self.entries.iter().enumerate() {
                if let Some((points, at)) = score(&query, &typed, entry, &mut scratch) {
                    total += 1;
                    found.push((points, i, at));
                }
            }
            found.sort_by(|a, b| {
                b.0.cmp(&a.0)
                    .then_with(|| {
                        self.entries[a.1]
                            .rel
                            .len()
                            .cmp(&self.entries[b.1].rel.len())
                    })
                    .then_with(|| self.entries[a.1].folded.cmp(&self.entries[b.1].folded))
            });
            found.truncate(limit);
        }
        let items = found
            .into_iter()
            .map(|(_, i, at)| {
                let entry = &self.entries[i];
                let offsets = utf16_offsets(&entry.rel);
                Item {
                    path: display_path(&entry.path),
                    rel: entry.rel.iter().collect(),
                    name_start: offsets[entry.name_start],
                    matches: at.into_iter().map(|c| offsets[c]).collect(),
                }
            })
            .collect();
        Answer {
            items,
            total,
            indexed: self.entries.len(),
            truncated: self.truncated,
        }
    }
}

/// The index the app keeps, and the lock that keeps two walks from running at once.
#[derive(Debug, Default)]
pub(crate) struct QuickOpen {
    index: Mutex<Option<Arc<Index>>>,
    building: Mutex<()>,
}

impl QuickOpen {
    /// True once an index exists. Nothing is built before the first query.
    #[cfg(test)]
    pub(crate) fn is_built(&self) -> bool {
        self.index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }

    fn current(&self) -> Option<Arc<Index>> {
        self.index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn roots(state: &AppState) -> Vec<PathBuf> {
        state
            .access()
            .roots()
            .iter()
            .map(|root| root.path.clone())
            .collect()
    }

    fn rebuild(&self, state: &AppState, max_files: usize) -> Arc<Index> {
        let fresh = Arc::new(build(&Self::roots(state), max_files));
        *self.index.lock().unwrap_or_else(PoisonError::into_inner) = Some(fresh.clone());
        fresh
    }

    /// The index to answer with: the last finished one, or, the very first time, one built now.
    fn ready(&self, state: &AppState, max_files: usize) -> Arc<Index> {
        if let Some(index) = self.current() {
            return index;
        }
        let _building = self.building.lock().unwrap_or_else(PoisonError::into_inner);
        // Another query may have built it while this one waited.
        if let Some(index) = self.current() {
            return index;
        }
        self.rebuild(state, max_files)
    }

    /// The best `limit` files for a query.
    pub(crate) fn query(&self, state: &AppState, typed: &str, limit: usize) -> Answer {
        self.ready(state, MAX_FILES).search(typed, limit)
    }

    /// Walks the roots again and swaps the result in. Does nothing, and says false, when another
    /// walk is already going: that one will land soon enough.
    pub(crate) fn refresh(&self, state: &AppState) -> bool {
        let Ok(_building) = self.building.try_lock() else {
            return false;
        };
        self.rebuild(state, MAX_FILES);
        true
    }

    #[cfg(test)]
    fn query_with_cap(&self, state: &AppState, typed: &str, limit: usize, cap: usize) -> Answer {
        self.ready(state, cap).search(typed, limit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{self, Platform as _};
    use std::fs;

    /// An index of the given relative paths, as one root would give them.
    fn of(paths: &[&str]) -> Index {
        let entries = paths
            .iter()
            .map(|p| {
                let rel: Vec<char> = p.chars().collect();
                let name_start = rel.iter().rposition(|c| *c == '/').map_or(0, |s| s + 1);
                Entry {
                    path: PathBuf::from(format!("/root/{p}")),
                    folded: rel.iter().map(|c| fold(*c)).collect(),
                    rel,
                    name_start,
                }
            })
            .collect();
        Index {
            entries,
            truncated: false,
        }
    }

    fn names(answer: &Answer) -> Vec<&str> {
        answer.items.iter().map(|i| i.rel.as_str()).collect()
    }

    #[test]
    fn only_files_that_hold_the_letters_in_order_match() {
        let index = of(&[
            "notes/plan.md",
            "plan.md",
            "pla.md",
            "docs/explain.md",
            "nap.md",
        ]);
        let answer = index.search("plan", 10);
        let found = names(&answer);
        assert!(found.contains(&"plan.md") && found.contains(&"notes/plan.md"));
        assert!(found.contains(&"docs/explain.md"));
        assert!(
            !found.contains(&"pla.md") && !found.contains(&"nap.md"),
            "{found:?}"
        );
        assert_eq!(answer.total, 3);
    }

    #[test]
    fn case_and_spaces_in_the_query_do_not_matter() {
        let index = of(&["Meeting-Notes.md", "other.md"]);
        assert_eq!(
            names(&index.search("meeting notes", 10)),
            ["Meeting-Notes.md"]
        );
        assert_eq!(
            names(&index.search("MEETINGNOTES", 10)),
            ["Meeting-Notes.md"]
        );
        assert_eq!(names(&index.search("  m n  ", 10)), ["Meeting-Notes.md"]);
    }

    #[test]
    fn the_start_of_a_name_beats_the_middle_of_one() {
        let index = of(&["a/denote.md", "a/note.md", "not.md", "a/b/anote.md"]);
        let found = index.search("not", 10);
        assert_eq!(
            names(&found)[..2],
            ["not.md", "a/note.md"],
            "{:?}",
            names(&found)
        );
    }

    #[test]
    fn a_run_of_letters_beats_scattered_ones() {
        let index = of(&["axbxc.md", "a-b-c.md", "abc.md"]);
        assert_eq!(names(&index.search("abc", 10))[0], "abc.md");
        let second = index.search("abc", 10);
        assert_eq!(names(&second)[1], "a-b-c.md", "word starts beat plain gaps");
    }

    #[test]
    fn a_match_in_the_name_beats_the_same_match_in_a_folder() {
        let index = of(&["foo/bar.md", "bar/foo.md"]);
        assert_eq!(
            names(&index.search("foo", 10)),
            ["bar/foo.md", "foo/bar.md"]
        );
    }

    #[test]
    fn the_start_of_a_word_beats_the_middle_of_a_word() {
        let index = of(&["xtodo.md", "x-todo.md", "xTodo.md"]);
        let found = index.search("todo", 10);
        assert_eq!(
            names(&found).last(),
            Some(&"xtodo.md"),
            "{:?}",
            names(&found)
        );
    }

    #[test]
    fn fewer_skipped_letters_beat_more_even_when_the_path_is_longer() {
        // Both have the two letters apart; the one with the shorter gap wins although it is longer.
        let index = of(&["a-------b.md", "a-b-with-a-longer-name.md"]);
        assert_eq!(
            names(&index.search("ab", 10))[0],
            "a-b-with-a-longer-name.md"
        );
    }

    #[test]
    fn a_match_nearer_the_start_beats_one_further_in() {
        // Neither is at a word start, so only the distance from the start tells them apart; the
        // nearer one is longer, so length alone would pick the other.
        let index = of(&["mmmmmmmmmmnote-aaa.md", "mnote-aaaaaaaaaaaaaaaaaaaa.md"]);
        assert_eq!(
            names(&index.search("note", 10))[0],
            "mnote-aaaaaaaaaaaaaaaaaaaa.md"
        );
    }

    #[test]
    fn the_case_that_was_typed_breaks_a_tie() {
        let index = of(&["plan.md", "Plan.md"]);
        assert_eq!(names(&index.search("Plan", 10)), ["Plan.md", "plan.md"]);
        assert_eq!(names(&index.search("plan", 10)), ["plan.md", "Plan.md"]);
    }

    #[test]
    fn a_shorter_path_comes_first_among_equal_scores() {
        // The letter matches at the very start of both, so the points are equal; only length differs.
        // The longer one sorts first alphabetically, so only the length rule puts the other first.
        let index = of(&["a.mdx", "a.zz"]);
        assert_eq!(names(&index.search("a", 10)), ["a.zz", "a.mdx"]);
    }

    #[test]
    fn the_start_of_a_name_after_a_slash_beats_the_middle_of_a_word() {
        // The middle-of-a-word match is nearer the start, so only the word-start bonus puts the other first.
        let index = of(&["abn.md", "abc/n.md"]);
        assert_eq!(names(&index.search("n", 10))[0], "abc/n.md");
    }

    #[test]
    fn only_the_first_sixty_four_letters_of_a_query_count() {
        let name = "a".repeat(64);
        let index = of(&[&format!("{name}.md")]);
        let long = format!("{name}zzzzzz");
        assert_eq!(index.search(&long, 10).total, 1);
        assert_eq!(index.search(&format!("{name}a"), 10).total, 1);
    }

    #[test]
    fn a_folder_and_a_name_can_share_the_query() {
        let index = of(&["notes/plan.md", "notes/idea.md", "plan/notes.md"]);
        assert_eq!(names(&index.search("notes/pla", 10))[0], "notes/plan.md");
    }

    #[test]
    fn matches_say_which_letters_and_where_the_name_starts() {
        let index = of(&["docs/plan.md"]);
        let answer = index.search("pl", 10);
        let [item] = answer.items.as_slice() else {
            panic!("{answer:?}")
        };
        assert_eq!(item.matches, [5, 6]);
        assert_eq!(item.name_start, 5);
        assert_eq!(item.rel, "docs/plan.md");
    }

    #[test]
    fn match_offsets_count_utf16_units_not_letters() {
        // The smiley is two UTF-16 units and one letter; the offsets must skip both.
        let index = of(&["😀/日本.md"]);
        let answer = index.search("日本", 10);
        let [item] = answer.items.as_slice() else {
            panic!("{answer:?}")
        };
        assert_eq!(item.matches, [3, 4]);
        assert_eq!(item.name_start, 3);
    }

    #[test]
    fn the_limit_cuts_the_list_but_not_the_count() {
        let paths: Vec<String> = (0..30).map(|i| format!("n{i:02}.md")).collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let answer = of(&refs).search("n", 5);
        assert_eq!(
            (answer.items.len(), answer.total, answer.indexed),
            (5, 30, 30)
        );
    }

    #[test]
    fn an_empty_query_lists_files_in_path_order() {
        let index = of(&["b.md", "A.md", "a/z.md"]);
        assert_eq!(names(&index.search("", 10)), ["A.md", "a/z.md", "b.md"]);
        assert_eq!(index.search("   ", 10).total, 3);
    }

    #[test]
    fn a_query_longer_than_the_path_finds_nothing() {
        assert!(of(&["a.md"]).search("abcdefgh", 10).items.is_empty());
    }

    // ---- the index on disk

    fn state_with(roots: &[&Path]) -> Arc<AppState> {
        let state = Arc::new(AppState::new(platform::current().paths_ignore_case()));
        for root in roots {
            state.access().grant_root(root).expect("granted");
        }
        state
    }

    /// A folder that is removed when it goes out of scope, resolved so the roots and the files
    /// compare the way Access sees them.
    struct Dir {
        _guard: tempfile::TempDir,
        path: PathBuf,
    }

    impl Dir {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    fn temp() -> Dir {
        let guard = tempfile::tempdir().expect("temp dir");
        let path = fs::canonicalize(guard.path()).expect("canonical");
        Dir {
            _guard: guard,
            path,
        }
    }

    fn put(path: &Path) {
        fs::create_dir_all(path.parent().expect("parent")).expect("dirs");
        fs::write(path, "x").expect("file");
    }

    #[test]
    fn nothing_is_read_until_the_first_query() {
        let dir = temp();
        put(&dir.path().join("a.md"));
        let state = state_with(&[dir.path()]);
        let quick = QuickOpen::default();
        assert!(!quick.is_built(), "built before anyone asked");
        let answer = quick.query(&state, "a", 10);
        assert!(quick.is_built());
        assert_eq!(names(&answer), ["a.md"]);
    }

    #[test]
    fn files_at_any_depth_are_listed_and_git_is_not() {
        let dir = temp();
        put(&dir.path().join("top.md"));
        put(&dir.path().join("a/b/c/deep.md"));
        put(&dir.path().join(".git/config"));
        put(&dir.path().join("sub/.git/HEAD"));
        let state = state_with(&[dir.path()]);
        let answer = QuickOpen::default().query(&state, "", 50);
        let mut found = names(&answer);
        found.sort_unstable();
        assert_eq!(found, ["a/b/c/deep.md", "top.md"]);
    }

    #[test]
    fn every_kind_of_file_is_listed_even_in_node_modules_unlike_the_link_scans() {
        let dir = temp();
        put(&dir.path().join("a.md"));
        put(&dir.path().join("notes.txt"));
        put(&dir.path().join("pic.png"));
        put(&dir.path().join("node_modules/pkg/index.js"));
        let state = state_with(&[dir.path()]);
        let answer = QuickOpen::default().query(&state, "", 50);
        let mut found = names(&answer);
        found.sort_unstable();
        assert_eq!(
            found,
            ["a.md", "node_modules/pkg/index.js", "notes.txt", "pic.png"]
        );
    }

    #[test]
    fn a_refresh_picks_up_a_new_file_and_drops_a_deleted_one() {
        let dir = temp();
        put(&dir.path().join("old.md"));
        let state = state_with(&[dir.path()]);
        let quick = QuickOpen::default();
        assert_eq!(names(&quick.query(&state, "", 10)), ["old.md"]);
        put(&dir.path().join("fresh/new.md"));
        fs::remove_file(dir.path().join("old.md")).expect("removed");
        // Until the picker asks again, the last index answers.
        assert_eq!(names(&quick.query(&state, "", 10)), ["old.md"]);
        assert!(quick.refresh(&state));
        assert_eq!(names(&quick.query(&state, "", 10)), ["fresh/new.md"]);
    }

    #[test]
    fn a_refresh_follows_roots_added_and_removed() {
        let (one, two) = (temp(), temp());
        put(&one.path().join("in-one.md"));
        put(&two.path().join("in-two.md"));
        let state = state_with(&[one.path()]);
        let quick = QuickOpen::default();
        assert_eq!(names(&quick.query(&state, "", 10)), ["in-one.md"]);
        state.access().grant_root(two.path()).expect("granted");
        assert!(quick.refresh(&state));
        let both = quick.query(&state, "", 10);
        // With two folders open each name is led by its folder's name, so the same name in two
        // folders can be told apart.
        let one_name = one
            .path()
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        let two_name = two
            .path()
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        let mut found = names(&both);
        found.sort_unstable();
        let mut want = [
            format!("{one_name}/in-one.md"),
            format!("{two_name}/in-two.md"),
        ];
        want.sort_unstable();
        assert_eq!(found, want.iter().map(String::as_str).collect::<Vec<_>>());
        state.access().revoke_root(one.path());
        assert!(quick.refresh(&state));
        assert_eq!(names(&quick.query(&state, "", 10)), ["in-two.md"]);
    }

    #[test]
    fn a_refresh_while_another_walk_is_going_does_nothing() {
        let dir = temp();
        put(&dir.path().join("a.md"));
        let state = state_with(&[dir.path()]);
        let quick = QuickOpen::default();
        let _held = quick.building.lock().expect("lock");
        assert!(!quick.refresh(&state));
    }

    #[test]
    fn a_workspace_bigger_than_the_cap_is_cut_and_says_so() {
        let dir = temp();
        for i in 0..12 {
            put(&dir.path().join(format!("f{i:02}.md")));
        }
        let state = state_with(&[dir.path()]);
        let answer = QuickOpen::default().query_with_cap(&state, "", 50, 5);
        assert_eq!((answer.indexed, answer.truncated), (5, true));
        let whole = QuickOpen::default().query(&state, "", 50);
        assert_eq!((whole.indexed, whole.truncated), (12, false));
    }

    #[test]
    fn a_result_names_the_file_the_tree_would_open() {
        let dir = temp();
        put(&dir.path().join("docs/plan.md"));
        let state = state_with(&[dir.path()]);
        let answer = QuickOpen::default().query(&state, "plan", 10);
        let [item] = answer.items.as_slice() else {
            panic!("{answer:?}")
        };
        let wanted = display_path(&dir.path().join("docs").join("plan.md"));
        assert_eq!(item.path, wanted);
        // Read from disk, the name starts after the slash.
        assert_eq!((item.rel.as_str(), item.name_start), ("docs/plan.md", 5));
        // What the page sends back to open is checked by Rust again like any other path.
        assert!(state.access().check(Path::new(&item.path)).is_ok());
    }
}
