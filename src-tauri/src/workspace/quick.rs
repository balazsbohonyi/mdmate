//! Ctrl+P: the files of the workspace index, found by a few typed letters.
//!
//! The index is `workspace::index`'s: every file under the roots, kept up to date in the
//! background. A query here only reads it. Opening the picker walks nothing and builds nothing, so a
//! workspace of any size answers as fast as it can be scored. Matching is done here, so only the few
//! best results cross to the page.
//!
//! A query with no slash is matched against file names only, so a folder never makes a file match;
//! a query with a slash is matched against the whole path. The typed text must appear in the name
//! as it was typed (case aside, spaces ignored); only when no file has it does the search fall back
//! to letters in order, still within names, so `pln` finds `plan.md`.
//!
//! What is listed is what the index holds: every file except those under a folder on the built-in
//! exclusion list (`crate::fs::exclude`), at any depth. The tree hides nothing; this does. While a
//! root is read for the first time, the files found so far are offered.

use crate::access::display_path;
use crate::documents::AppState;
use crate::workspace::index::{FileEntry, Listing, abs_of, fold};
use serde::Serialize;
use std::cmp::Ordering;
use std::sync::atomic::{AtomicUsize, Ordering as Atomic};

/// The longest query that is matched; the rest is ignored.
const MAX_QUERY: usize = 64;

/// Files scored by one worker in one go.
const CHUNK: usize = 16_384;

/// Below this many files one thread does it all: starting threads costs more than it saves.
const PARALLEL_FROM: usize = 40_000;

/// The most workers a query uses.
const MAX_WORKERS: usize = 8;

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

/// The text of one file as it is scored: the letters as shown, the same folded, and where the
/// file's own name starts. Filled in place for each file that might match, so scoring many files
/// does not allocate for each.
#[derive(Default)]
struct Hay {
    rel: Vec<char>,
    folded: Vec<char>,
    name_start: usize,
}

impl Hay {
    fn fill(&mut self, list: &Listing<'_>, entry: &FileEntry) {
        self.rel.clear();
        self.rel.extend(list.prefix.chars());
        self.rel.extend(entry.rel.chars());
        self.folded.clear();
        self.folded.extend(self.rel.iter().map(|c| fold(*c)));
        self.name_start = self
            .rel
            .iter()
            .rposition(|c| *c == '/')
            .map_or(0, |slash| slash + 1);
    }
}

/// Reusable working space, so matching many files does not allocate for each.
#[derive(Default)]
struct Scratch {
    score: Vec<i32>,
    from: Vec<usize>,
    hay: Hay,
}

const NONE: i32 = i32::MIN / 2;

/// Whether `query` (folded) is a subsequence of the folded letters of what is searched: the whole
/// path as shown, or only the file's name. The cheap test that most files fail, run without
/// building the letters.
fn could_match(query: &[char], prefix: &str, rel: &str, name_only: bool) -> bool {
    let mut next = 0;
    let searched = if name_only {
        rel.rsplit('/').next().unwrap_or(rel)
    } else {
        rel
    };
    let prefix = if name_only { "" } else { prefix };
    for c in prefix.chars().chain(searched.chars()) {
        if next < query.len() && fold(c) == query[next] {
            next += 1;
        }
    }
    next == query.len()
}

/// Where `query` sits as an unbroken run in `text` (both folded), as the start of the run: the
/// first one that begins a word, else the first one. `rel` is the same text as shown.
fn literal_start(rel: &[char], text: &[char], query: &[char]) -> Option<usize> {
    let (m, n) = (query.len(), text.len());
    if m == 0 || m > n {
        return None;
    }
    let mut first = None;
    for start in 0..=n - m {
        if text[start..start + m] == *query {
            if boundary(rel, start) > 0 {
                return Some(start);
            }
            first = first.or(Some(start));
        }
    }
    first
}

/// Scores `query` (folded, spaces removed) against the filled `scratch.hay`, from letter `from` on
/// (the start of the name when only names are searched), and says which letters matched when `at` is
/// given, or None when it is not a subsequence. Letters are matched in order; the best placement is
/// chosen.
fn score(
    query: &[char],
    typed: &[char],
    scratch: &mut Scratch,
    from: usize,
    at: Option<&mut Vec<usize>>,
) -> Option<i32> {
    let hay = &scratch.hay.folded[from..];
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
    let (rel, name_start) = (
        &scratch.hay.rel[from..],
        scratch.hay.name_start.saturating_sub(from),
    );
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
            let mut here = BASE + boundary(rel, j);
            if j >= name_start {
                here += IN_NAME;
            }
            if rel[j] == typed[i] {
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
    if let Some(at) = at {
        at.clear();
        at.resize(m, 0);
        let mut j = end;
        for i in (0..m).rev() {
            at[i] = j;
            if i > 0 {
                j = scratch.from[i * n + j];
            }
        }
        for place in at.iter_mut() {
            *place += from;
        }
    }
    Some(best)
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

/// A file that matched: its points and where it is. Twelve bytes, so a query that matches most of a
/// 100,000-file workspace keeps little.
#[derive(Clone, Copy)]
struct Candidate {
    points: i32,
    list: u32,
    entry: u32,
}

/// The path as shown, folded, for ordering.
fn shown_folded<'a>(
    list: &'a Listing<'_>,
    entry: &'a FileEntry,
) -> impl Iterator<Item = char> + 'a {
    list.prefix.chars().chain(entry.rel.chars()).map(fold)
}

fn shown_len(list: &Listing<'_>, entry: &FileEntry) -> usize {
    list.prefix.chars().count() + entry.rel.chars().count()
}

fn entry_of<'a>(lists: &'a [Listing<'_>], c: Candidate) -> (&'a Listing<'a>, &'a FileEntry) {
    let list = &lists[c.list as usize];
    (list, &list.entries[c.entry as usize])
}

/// Path order: the folded path as shown.
fn by_path(lists: &[Listing<'_>], a: Candidate, b: Candidate) -> Ordering {
    let (la, ea) = entry_of(lists, a);
    let (lb, eb) = entry_of(lists, b);
    shown_folded(la, ea).cmp(shown_folded(lb, eb))
}

/// Best first: more points, then the shorter path, then path order.
fn better(lists: &[Listing<'_>], a: Candidate, b: Candidate) -> Ordering {
    b.points.cmp(&a.points).then_with(|| {
        let (la, ea) = entry_of(lists, a);
        let (lb, eb) = entry_of(lists, b);
        shown_len(la, ea)
            .cmp(&shown_len(lb, eb))
            .then_with(|| by_path(lists, a, b))
    })
}

/// What was typed: as typed, and folded for matching.
#[derive(Clone, Copy)]
struct Query<'a> {
    typed: &'a [char],
    folded: &'a [char],
    /// Only the file's name is searched: the query holds no slash.
    name_only: bool,
    /// The query must appear in what is searched as one unbroken run; when false, letters in order
    /// are enough.
    literal: bool,
}

impl Query<'_> {
    /// The first letter of the searched text in a filled `Hay`.
    fn from(self, hay: &Hay) -> usize {
        if self.name_only { hay.name_start } else { 0 }
    }
}

/// Scores one stretch (`from..to`) of one list. Returns what matched.
fn score_range(
    lists: &[Listing<'_>],
    list: usize,
    (from, to): (usize, usize),
    q: Query<'_>,
    scratch: &mut Scratch,
    out: &mut Vec<Candidate>,
) {
    let one = &lists[list];
    for (i, entry) in one.entries[from..to].iter().enumerate() {
        if !could_match(q.folded, &one.prefix, &entry.rel, q.name_only) {
            continue;
        }
        scratch.hay.fill(one, entry);
        let begin = q.from(&scratch.hay);
        if q.literal
            && literal_start(
                &scratch.hay.rel[begin..],
                &scratch.hay.folded[begin..],
                q.folded,
            )
            .is_none()
        {
            continue;
        }
        if let Some(points) = score(q.folded, q.typed, scratch, begin, None) {
            out.push(Candidate {
                points,
                list: u32::try_from(list).unwrap_or(u32::MAX),
                entry: u32::try_from(from + i).unwrap_or(u32::MAX),
            });
        }
    }
}

/// Every file that matches, scored, using as many threads as the workspace is worth.
fn matches(lists: &[Listing<'_>], q: Query<'_>) -> Vec<Candidate> {
    let total: usize = lists.iter().map(|list| list.entries.len()).sum();
    let mut tasks: Vec<(usize, usize, usize)> = Vec::new();
    for (list, one) in lists.iter().enumerate() {
        let mut from = 0;
        while from < one.entries.len() {
            let to = (from + CHUNK).min(one.entries.len());
            tasks.push((list, from, to));
            from = to;
        }
    }
    let workers = if total < PARALLEL_FROM {
        1
    } else {
        std::thread::available_parallelism()
            .map_or(1, std::num::NonZero::get)
            .clamp(1, MAX_WORKERS)
            .min(tasks.len())
    };
    let next = AtomicUsize::new(0);
    let work = || {
        let mut scratch = Scratch::default();
        let mut found = Vec::new();
        loop {
            let at = next.fetch_add(1, Atomic::Relaxed);
            let Some(&(list, from, to)) = tasks.get(at) else {
                return found;
            };
            score_range(lists, list, (from, to), q, &mut scratch, &mut found);
        }
    };
    if workers <= 1 {
        return work();
    }
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers).map(|_| scope.spawn(work)).collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap_or_default())
            .collect()
    })
}

/// The best `limit` files of these lists for what was typed. Spaces in the query are ignored, and
/// case does not matter. A query with no slash is looked for in file names only; one with a slash
/// (a backslash counts as one) in the whole path. The typed text must appear as one unbroken run;
/// only when no file has it are files with the letters in order listed. An empty query lists files
/// in path order.
pub(crate) fn search(lists: &[Listing<'_>], cut: bool, typed: &str, limit: usize) -> Answer {
    let typed: Vec<char> = typed
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| if c == '\\' { '/' } else { c })
        .take(MAX_QUERY)
        .collect();
    let query: Vec<char> = typed.iter().map(|c| fold(*c)).collect();
    let indexed: usize = lists.iter().map(|list| list.entries.len()).sum();
    let mut how = Query {
        typed: &typed,
        folded: &query,
        name_only: !typed.contains(&'/'),
        literal: true,
    };
    let mut found: Vec<Candidate> = if query.is_empty() {
        lists
            .iter()
            .enumerate()
            .flat_map(|(list, one)| {
                (0..one.entries.len()).map(move |entry| Candidate {
                    points: 0,
                    list: u32::try_from(list).unwrap_or(u32::MAX),
                    entry: u32::try_from(entry).unwrap_or(u32::MAX),
                })
            })
            .collect()
    } else {
        let mut found = matches(lists, how);
        if found.is_empty() {
            how.literal = false;
            found = matches(lists, how);
        }
        found
    };
    let total = found.len();
    let order = |a: &Candidate, b: &Candidate| {
        if query.is_empty() {
            by_path(lists, *a, *b)
        } else {
            better(lists, *a, *b)
        }
    };
    // Only the best `limit` need to be in order; the rest only need to be known to be worse.
    if found.len() > limit {
        if limit > 0 {
            found.select_nth_unstable_by(limit - 1, order);
        }
        found.truncate(limit);
    }
    found.sort_by(order);

    let mut scratch = Scratch::default();
    let mut at = Vec::new();
    let items = found
        .into_iter()
        .map(|c| {
            let (list, entry) = entry_of(lists, c);
            scratch.hay.fill(list, entry);
            at.clear();
            if !query.is_empty() {
                let from = how.from(&scratch.hay);
                if how.literal {
                    let hay = &scratch.hay;
                    if let Some(start) =
                        literal_start(&hay.rel[from..], &hay.folded[from..], &query)
                    {
                        at.extend(from + start..from + start + query.len());
                    }
                } else {
                    score(&query, &typed, &mut scratch, from, Some(&mut at));
                }
            }
            let offsets = utf16_offsets(&scratch.hay.rel);
            Item {
                path: display_path(&abs_of(list.root, &entry.rel)),
                rel: scratch.hay.rel.iter().collect(),
                name_start: offsets[scratch.hay.name_start],
                matches: at.iter().map(|&c| offsets[c]).collect(),
            }
        })
        .collect();
    Answer {
        items,
        total,
        indexed,
        truncated: cut,
    }
}

/// The best `limit` files for a query, from the workspace index. Reads the index where it is; never
/// walks the disk.
pub(crate) fn query(state: &AppState, typed: &str, limit: usize) -> Answer {
    state
        .index()
        .listings(|lists, cut| search(lists, cut, typed, limit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::kind::FileKind;
    use crate::platform::{self, Platform as _};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;

    /// One root holding the given relative paths, as the index would list them.
    struct Of {
        entries: Vec<FileEntry>,
    }

    fn entry(rel: &str) -> FileEntry {
        FileEntry {
            rel: rel.into(),
            kind: FileKind::Markdown,
            size: 0,
            modified: 0,
        }
    }

    fn of(paths: &[&str]) -> Of {
        Of {
            entries: paths.iter().map(|p| entry(p)).collect(),
        }
    }

    impl Of {
        fn search(&self, typed: &str, limit: usize) -> Answer {
            let list = Listing {
                prefix: String::new(),
                root: Path::new("/root"),
                entries: &self.entries,
            };
            search(&[list], false, typed, limit)
        }
    }

    fn names(answer: &Answer) -> Vec<&str> {
        answer.items.iter().map(|i| i.rel.as_str()).collect()
    }

    #[test]
    fn the_typed_text_must_appear_in_the_name_as_typed() {
        // `explain.md` holds the letters of "plan" in order but not together: it is not offered
        // while a file has them together.
        let index = of(&[
            "notes/plan.md",
            "plan.md",
            "pla.md",
            "docs/explain.md",
            "nap.md",
        ]);
        let answer = index.search("plan", 10);
        let found = names(&answer);
        assert_eq!(answer.total, 2, "{found:?}");
        assert!(found.contains(&"plan.md") && found.contains(&"notes/plan.md"));
    }

    #[test]
    fn letters_in_order_are_offered_only_when_no_file_has_the_text() {
        let index = of(&["notes/plan.md", "docs/explain.md", "pla.md", "nap.md"]);
        let answer = index.search("pln", 10);
        let found = names(&answer);
        assert!(
            found.contains(&"notes/plan.md") && found.contains(&"docs/explain.md"),
            "{found:?}"
        );
        assert!(!found.contains(&"pla.md") && !found.contains(&"nap.md"));
        // One file with the text together hides the scattered ones.
        let with_text = of(&["notes/plan.md", "docs/explain.md", "xplnx.md"]);
        assert_eq!(names(&with_text.search("pln", 10)), ["xplnx.md"]);
    }

    #[test]
    fn a_name_is_not_found_through_its_folder_unless_the_query_has_a_slash() {
        let index = of(&["agents/Max.md", "extract_agents/system.md", "agents.md"]);
        assert_eq!(names(&index.search("agents.md", 10)), ["agents.md"]);
        assert_eq!(names(&index.search("agents", 10)), ["agents.md"]);
        let with_slash = index.search("agents/ma", 10);
        assert_eq!(names(&with_slash), ["agents/Max.md"]);
        assert_eq!(names(&index.search("agents\\ma", 10)), ["agents/Max.md"]);
    }

    #[test]
    fn a_search_for_agents_md_offers_only_files_named_that() {
        // What the owner saw in Ctrl+P with the loose matching, each with how it used to match.
        let index = of(&[
            "AGENTS.md",
            "projects/mdmate/AGENTS.md",
            "agents.md",
            "AgentSystem.md",
            "multi-agent-support-plan.md",
            "create-agents-md.md",
            "LeveragePoints.md",
            "agent-instructions.md",
            "windows.ai.agents.mcp.idl",
            "2026-06-05-user-global-storage-requirements.md",
            "2026-01-22_ai-agent-spec-writing-workflow.md",
            "install/agents/Max.md",
            "install/agents/Grok.md",
            "Patterns/extract_wisdom_agents/system.md",
            "extensions/agents/SKILL.md",
        ]);
        let answer = index.search("agents.md", 20);
        let mut found = names(&answer);
        found.sort_unstable();
        assert_eq!(
            found,
            ["AGENTS.md", "agents.md", "projects/mdmate/AGENTS.md"]
        );
        assert_eq!(answer.total, 3);
        let item = &answer.items[0];
        assert_eq!(item.matches.len(), "agents.md".len());
        assert_eq!(item.matches[0], item.name_start);
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
    fn scattered_letters_rank_by_word_starts_when_no_file_has_the_text() {
        let index = of(&["axbxc.md", "a-b-c.md"]);
        let found = index.search("abc", 10);
        assert_eq!(names(&found), ["a-b-c.md", "axbxc.md"]);
    }

    #[test]
    fn a_whole_name_beats_a_name_that_holds_the_text() {
        let index = of(&["xabc.md", "abc.md", "my-abc.md"]);
        assert_eq!(names(&index.search("abc", 10))[0], "abc.md");
    }

    #[test]
    fn the_matched_letters_are_the_unbroken_run_in_the_name() {
        let index = of(&["docs/my-agents.md"]);
        let answer = index.search("agents", 10);
        let [item] = answer.items.as_slice() else {
            panic!("{answer:?}")
        };
        assert_eq!(item.matches, [8, 9, 10, 11, 12, 13]);
    }

    #[test]
    fn a_folder_alone_never_makes_a_file_match() {
        let index = of(&["foo/bar.md", "bar/foo.md"]);
        assert_eq!(names(&index.search("foo", 10)), ["bar/foo.md"]);
        assert_eq!(names(&index.search("foo/", 10)), ["foo/bar.md"]);
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
        assert_eq!(names(&index.search("notes/pla", 10)), ["notes/plan.md"]);
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

    #[test]
    fn a_big_workspace_scored_by_many_threads_gives_what_one_thread_gives() {
        // Past PARALLEL_FROM the files are split across workers; the answer must not depend on it.
        let entries: Vec<FileEntry> = (0..PARALLEL_FROM + 5_000)
            .map(|i| entry(&format!("d{}/sub{}/note-{i}.md", i % 97, i % 13)))
            .collect();
        let lists = [Listing {
            prefix: String::new(),
            root: Path::new("/root"),
            entries: &entries,
        }];
        let typed: Vec<char> = "nt7".chars().collect();
        let query: Vec<char> = typed.iter().map(|c| fold(*c)).collect();
        let q = Query {
            typed: &typed,
            folded: &query,
            name_only: true,
            literal: false,
        };
        let mut one = Vec::new();
        let mut scratch = Scratch::default();
        score_range(&lists, 0, (0, entries.len()), q, &mut scratch, &mut one);
        let mut many = matches(&lists, q);
        let key = |c: &Candidate| (c.list, c.entry);
        one.sort_by_key(key);
        many.sort_by_key(key);
        assert!(!one.is_empty());
        assert_eq!(one.len(), many.len());
        assert!(
            one.iter()
                .zip(&many)
                .all(|(a, b)| key(a) == key(b) && a.points == b.points)
        );
    }

    #[test]
    fn several_folders_lead_each_path_with_the_folder_name() {
        let (one, two) = (of(&["a.md"]), of(&["b.md"]));
        let lists = [
            Listing {
                prefix: "one/".into(),
                root: Path::new("/one"),
                entries: &one.entries,
            },
            Listing {
                prefix: "two/".into(),
                root: Path::new("/two"),
                entries: &two.entries,
            },
        ];
        let answer = search(&lists, false, "", 10);
        let found: Vec<&str> = answer.items.iter().map(|i| i.rel.as_str()).collect();
        assert_eq!(found, ["one/a.md", "two/b.md"]);
        assert_eq!(answer.items[1].name_start, 4);
    }

    // ---- the workspace index

    fn state() -> Arc<AppState> {
        Arc::new(AppState::new(platform::current().paths_ignore_case()))
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

    fn shown(answer: &Answer) -> Vec<&str> {
        answer.items.iter().map(|i| i.rel.as_str()).collect()
    }

    #[test]
    fn a_query_reads_the_index_and_walks_nothing() {
        let dir = temp();
        put(&dir.path().join("a.md"));
        let state = state();
        state.index().add_root_now(dir.path());
        // A file made after the index was built is not seen until the index hears of it: the query
        // never goes to the disk.
        put(&dir.path().join("later.md"));
        assert_eq!(shown(&query(&state, "", 10)), ["a.md"]);
        state.index().changed(&dir.path().join("later.md"));
        assert_eq!(shown(&query(&state, "", 10)), ["a.md", "later.md"]);
    }

    #[test]
    fn files_at_any_depth_are_listed_and_the_excluded_folders_are_not() {
        let dir = temp();
        put(&dir.path().join("top.md"));
        put(&dir.path().join("a/b/c/deep.md"));
        put(&dir.path().join("notes.txt"));
        put(&dir.path().join("pic.png"));
        put(&dir.path().join(".git/config"));
        put(&dir.path().join("sub/.git/HEAD"));
        put(&dir.path().join("node_modules/pkg/index.js"));
        put(&dir.path().join("target/debug/x.rs"));
        let state = state();
        state.index().add_root_now(dir.path());
        let answer = query(&state, "", 50);
        assert_eq!(
            shown(&answer),
            ["a/b/c/deep.md", "notes.txt", "pic.png", "top.md"]
        );
    }

    #[test]
    fn a_rename_and_a_delete_by_the_app_show_at_once() {
        let dir = temp();
        put(&dir.path().join("old.md"));
        put(&dir.path().join("gone.md"));
        let state = state();
        state.index().add_root_now(dir.path());
        fs::rename(dir.path().join("old.md"), dir.path().join("new.md")).expect("renamed");
        fs::remove_file(dir.path().join("gone.md")).expect("removed");
        state
            .index()
            .moved(&dir.path().join("old.md"), &dir.path().join("new.md"));
        state.index().removed(&dir.path().join("gone.md"));
        assert_eq!(shown(&query(&state, "", 10)), ["new.md"]);
    }

    #[test]
    fn roots_added_and_removed_are_followed_and_named_when_there_are_several() {
        let (one, two) = (temp(), temp());
        put(&one.path().join("in-one.md"));
        put(&two.path().join("in-two.md"));
        let state = state();
        state.index().add_root_now(one.path());
        assert_eq!(shown(&query(&state, "", 10)), ["in-one.md"]);
        state.index().add_root_now(two.path());
        let label = |dir: &Dir| {
            dir.path()
                .file_name()
                .expect("name")
                .to_string_lossy()
                .into_owned()
        };
        let both = query(&state, "", 10);
        let mut found = shown(&both);
        found.sort_unstable();
        let mut want = [
            format!("{}/in-one.md", label(&one)),
            format!("{}/in-two.md", label(&two)),
        ];
        want.sort_unstable();
        assert_eq!(found, want.iter().map(String::as_str).collect::<Vec<_>>());
        state.index().remove_root(one.path());
        assert_eq!(shown(&query(&state, "", 10)), ["in-two.md"]);
    }

    #[test]
    fn a_workspace_bigger_than_the_cap_is_cut_and_says_so() {
        let dir = temp();
        for i in 0..12 {
            put(&dir.path().join(format!("f{i:02}.md")));
        }
        let state = state();
        state.index().set_cap(5);
        state.index().add_root_now(dir.path());
        let answer = query(&state, "", 50);
        assert_eq!((answer.indexed, answer.truncated), (5, true));
    }

    #[test]
    fn a_result_names_the_file_the_tree_would_open() {
        let dir = temp();
        put(&dir.path().join("docs/plan.md"));
        let state = state();
        state.access().grant_root(dir.path()).expect("granted");
        state.index().add_root_now(dir.path());
        let answer = query(&state, "plan", 10);
        let [item] = answer.items.as_slice() else {
            panic!("{answer:?}")
        };
        let wanted = display_path(&dir.path().join("docs").join("plan.md"));
        assert_eq!(item.path, wanted);
        assert_eq!((item.rel.as_str(), item.name_start), ("docs/plan.md", 5));
        // What the page sends back to open is checked by Rust again like any other path.
        assert!(state.access().check(Path::new(&item.path)).is_ok());
    }

    #[test]
    fn nothing_is_listed_before_a_root_is_known() {
        let answer = query(&state(), "a", 10);
        assert_eq!(
            (answer.items.len(), answer.indexed, answer.truncated),
            (0, 0, false)
        );
    }
}
