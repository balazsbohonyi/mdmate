//! Streaming folder search (Ctrl+Shift+F).
//!
//! It walks every open folder and reads each text file once: every file except what a text search
//! has no use for, which is `.git`, `node_modules`, links and junctions, binary files, files above
//! [`MAX_FILE_BYTES`] and text in an encoding mdmate does not write. A document that is open with
//! unsaved edits is read from the text the page sends, so a line number is the one the editor shows.
//!
//! Matching is by line, on the text the app's own decode gives, with `\r\n`, `\n` and a lone `\r`
//! as breaks like the editor, so a line number and a UTF-16 column here are the ones the editor
//! uses to put the caret on the match. The pattern language is Rust's `regex`: the plain-text,
//! case and whole-word options mean the same as Find in a file, and a pattern means the same except
//! that `regex` has no look-around and no back-references and `\w` and `\d` read Unicode; the
//! parity table in `tests/fixtures/search-parity.json` is run by both engines.
//!
//! Hits stream to the page in batches, at most one per [`BATCH_INTERVAL`]. A search is stopped by
//! starting another one (the page names each search with an increasing id) or by asking; it is
//! checked between folder entries, every [`STOP_EVERY_LINES`] lines of a file and between files.

use crate::access::display_path;
use crate::documents::AppState;
use crate::fs::encoding::{self, Decoded, Encoding};
use crate::links::flow::Buffer;
use crate::links::rewrite::place_key;
use crate::links::walk::{Scope, read_unless_binary, walk_until};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// The most hits listed. A search with more shows the first ones and says so.
pub(crate) const MAX_HITS: usize = 10_000;

/// The largest file read. A bigger one is counted as skipped: reading it would take longer than
/// anyone waits and hold the whole file in memory twice.
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// A batch of hits goes to the page at most this often, and the page draws once per batch.
const BATCH_INTERVAL: Duration = Duration::from_millis(50);

/// A batch is also sent when this many hits are waiting, so a fast search is not held back.
const BATCH_HITS: usize = 200;

/// How many lines of one file are read between looks at the stop flag.
const STOP_EVERY_LINES: usize = 512;

/// How much of a line is kept for the list, in bytes, and how much of the match is shown.
const EXCERPT_BYTES: usize = 240;
const EXCERPT_BEFORE: usize = 60;
const MATCH_SHOWN: usize = 160;

/// What the page asks for.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    /// Names this search. Starting one with a higher id stops the one before it.
    pub(crate) id: u64,
    pub(crate) query: String,
    pub(crate) case_sensitive: bool,
    pub(crate) whole_word: bool,
    pub(crate) regexp: bool,
}

/// One match.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Hit {
    /// The file, as people read the path.
    pub(crate) path: String,
    /// Line of the match, from 1.
    pub(crate) line: usize,
    /// UTF-16 units from the start of the line to the start of the match.
    pub(crate) column: usize,
    /// The line, trimmed and cut round the match, for the list.
    pub(crate) text: String,
    /// Where the match starts in `text`, in UTF-16 units.
    pub(crate) start: usize,
    /// How long the shown part of the match is, in UTF-16 units.
    pub(crate) length: usize,
}

/// What a search found since the last batch.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Batch {
    pub(crate) id: u64,
    pub(crate) hits: Vec<Hit>,
    /// Text files read so far, for the "searching" line.
    pub(crate) scanned: usize,
}

/// How a search ended.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    pub(crate) id: u64,
    /// Text files read.
    pub(crate) scanned: usize,
    /// Files with at least one hit.
    pub(crate) files: usize,
    pub(crate) hits: usize,
    /// Files and folders that were not read: too large, unreadable, or in an encoding mdmate does
    /// not write.
    pub(crate) skipped: usize,
    /// There were more than [`MAX_HITS`]; the rest are not listed.
    pub(crate) truncated: bool,
    /// Another search began, or this one was cancelled, before it finished.
    pub(crate) stopped: bool,
    /// Why nothing was searched: a pattern the engine cannot run.
    pub(crate) error: Option<String>,
}

/// A word character for "whole word": a letter, a digit or an underscore, in any script.
fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Find's whole-word rule: a match may not touch a word character on a side where it ends in one.
/// (The same test CodeMirror's search runs, so the two agree.)
fn word_ok(line: &str, start: usize, end: usize) -> bool {
    let first = line[start..].chars().next();
    let last = line[..end].chars().next_back();
    let before = line[..start].chars().next_back();
    let after = line[end..].chars().next();
    let free = |near: Option<char>, edge: Option<char>| {
        near.is_none_or(|c| !is_word(c)) || edge.is_none_or(|c| !is_word(c))
    };
    free(before, first) && free(after, last)
}

/// The words for a pattern the engine will not take.
fn explain(error: &regex::Error) -> String {
    let text = error.to_string();
    if text.contains("look-around") || text.contains("backreference") {
        "Folder search cannot run look-around or back-references, which Find in a file can. Write the pattern without them."
            .into()
    } else {
        "This is not a valid regular expression.".into()
    }
}

/// A compiled query.
pub(crate) struct Matcher {
    re: Regex,
    whole_word: bool,
}

impl Matcher {
    pub(crate) fn new(request: &Request) -> Result<Self, String> {
        if request.query.is_empty() {
            return Err("Type something to search for.".into());
        }
        let source = if request.regexp {
            request.query.clone()
        } else {
            regex::escape(&request.query)
        };
        RegexBuilder::new(&source)
            .case_insensitive(!request.case_sensitive)
            .build()
            .map(|re| Self {
                re,
                whole_word: request.whole_word,
            })
            .map_err(|error| explain(&error))
    }

    /// The matches in one line as byte ranges, left to right. An empty match is no match.
    pub(crate) fn hits<'t>(&'t self, line: &'t str) -> impl Iterator<Item = (usize, usize)> + 't {
        self.re
            .find_iter(line)
            .filter(|found| !found.is_empty())
            .filter(move |found| !self.whole_word || word_ok(line, found.start(), found.end()))
            .map(|found| (found.start(), found.end()))
    }
}

/// The lines of a text: `\r\n`, `\n` and a lone `\r` end one, as in the editor.
pub(crate) fn lines(text: &str) -> impl Iterator<Item = &str> {
    let mut rest = Some(text);
    std::iter::from_fn(move || {
        let current = rest?;
        match current.find(['\r', '\n']) {
            Some(at) => {
                let width = if current[at..].starts_with("\r\n") {
                    2
                } else {
                    1
                };
                rest = Some(&current[at + width..]);
                Some(&current[..at])
            }
            None => {
                rest = None;
                Some(current)
            }
        }
    })
}

/// The part of a line shown in the list, with the match's place in it.
fn excerpt(line: &str, start: usize, end: usize) -> (String, usize, usize) {
    // Leading white space goes, unless the match is in it.
    let base = (line.len() - line.trim_start().len()).min(start);
    let mut from = start.saturating_sub(EXCERPT_BEFORE).max(base);
    while from > base && !line.is_char_boundary(from) {
        from -= 1;
    }
    let mut shown_end = end.min(start + MATCH_SHOWN);
    while shown_end > start && !line.is_char_boundary(shown_end) {
        shown_end -= 1;
    }
    let mut to = line.len().min(from + EXCERPT_BYTES).max(shown_end);
    while to < line.len() && !line.is_char_boundary(to) {
        to += 1;
    }
    let before = from > base;
    let after = to < line.len() && !line[to..].trim().is_empty();
    let mut text = String::with_capacity(to - from + 6);
    if before {
        text.push('…');
    }
    text.push_str(line[from..to].trim_end());
    if after {
        text.push('…');
    }
    let offset = usize::from(before) + line[from..start].encode_utf16().count();
    let length = line[start..shown_end].encode_utf16().count();
    (text, offset, length)
}

/// The state of one running search.
struct Run<'a> {
    id: u64,
    matcher: &'a Matcher,
    stop: &'a dyn Fn() -> bool,
    emit: &'a mut dyn FnMut(Batch),
    pending: Vec<Hit>,
    last_flush: Instant,
    scanned: usize,
    sent_scanned: usize,
    files: usize,
    hits: usize,
    skipped: usize,
    truncated: bool,
}

impl Run<'_> {
    /// False once the search has ended, by cap or by a stop.
    fn go_on(&self) -> bool {
        !self.truncated && !(self.stop)()
    }

    /// Sends what is waiting when there is enough of it or enough time has passed; `force` sends
    /// it now.
    fn flush(&mut self, force: bool) {
        let due = force
            || self.pending.len() >= BATCH_HITS
            || self.last_flush.elapsed() >= BATCH_INTERVAL;
        if !due || (self.pending.is_empty() && self.scanned == self.sent_scanned) {
            return;
        }
        self.last_flush = Instant::now();
        self.sent_scanned = self.scanned;
        (self.emit)(Batch {
            id: self.id,
            hits: std::mem::take(&mut self.pending),
            scanned: self.scanned,
        });
    }

    /// Looks for the query in one file's text.
    fn search(&mut self, path: &Path, text: &str) {
        self.scanned += 1;
        let shown = display_path(path);
        let matcher = self.matcher;
        let mut found = false;
        'file: for (index, line) in lines(text).enumerate() {
            if index % STOP_EVERY_LINES == STOP_EVERY_LINES - 1 && (self.stop)() {
                break;
            }
            // The column counts up from the previous match, so a long line is read once.
            let mut last_byte = 0;
            let mut last_column = 0;
            for (start, end) in matcher.hits(line) {
                if self.hits >= MAX_HITS {
                    self.truncated = true;
                    break 'file;
                }
                let column = last_column + line[last_byte..start].encode_utf16().count();
                last_byte = start;
                last_column = column;
                let (excerpt, offset, length) = excerpt(line, start, end);
                self.pending.push(Hit {
                    path: shown.clone(),
                    line: index + 1,
                    column,
                    text: excerpt,
                    start: offset,
                    length,
                });
                self.hits += 1;
                found = true;
                self.flush(false);
            }
        }
        if found {
            self.files += 1;
        }
        self.flush(false);
    }
}

fn has_utf16_mark(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF])
}

/// What a search reads besides the disk.
pub(crate) struct Inputs<'a> {
    pub(crate) roots: &'a [PathBuf],
    /// The text of open documents that have edits not yet saved, by `place_key` of their file.
    pub(crate) held: &'a HashMap<String, String>,
    pub(crate) ignore_case: bool,
}

/// Runs a search to its end, or until `stop` says so. `emit` hears each batch as it is ready.
pub(crate) fn run(
    inputs: &Inputs<'_>,
    request: &Request,
    stop: &dyn Fn() -> bool,
    emit: &mut dyn FnMut(Batch),
) -> Summary {
    let matcher = match Matcher::new(request) {
        Ok(matcher) => matcher,
        Err(message) => {
            return Summary {
                id: request.id,
                error: Some(message),
                ..Summary::default()
            };
        }
    };
    let mut run = Run {
        id: request.id,
        matcher: &matcher,
        stop,
        emit,
        pending: Vec::new(),
        last_flush: Instant::now(),
        scanned: 0,
        sent_scanned: 0,
        files: 0,
        hits: 0,
        skipped: 0,
        truncated: false,
    };
    // Roots can lie inside one another; a file is read once.
    let mut seen: HashSet<String> = HashSet::new();
    for root in inputs.roots {
        if !run.go_on() {
            break;
        }
        let walked = walk_until(root, Scope::Text, stop, |path| {
            let Some(key) = place_key(path, inputs.ignore_case) else {
                return true;
            };
            if !seen.insert(key.clone()) {
                return true;
            }
            if let Some(text) = inputs.held.get(&key) {
                run.search(path, text);
                return run.go_on();
            }
            match std::fs::metadata(path) {
                Ok(meta) if meta.len() <= MAX_FILE_BYTES => {}
                _ => {
                    run.skipped += 1;
                    return true;
                }
            }
            let bytes = match read_unless_binary(path) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => return true,
                Err(_) => {
                    run.skipped += 1;
                    return true;
                }
            };
            match encoding::decode(&bytes) {
                // A NUL in text that is not UTF-16 is a binary file that happens to be valid UTF-8.
                Decoded::Text { format, text } => {
                    if format.encoding != Encoding::Utf8 || !bytes.contains(&0) {
                        run.search(path, &text);
                    }
                }
                Decoded::Unsupported { .. } => {
                    if has_utf16_mark(&bytes) || !bytes.contains(&0) {
                        run.skipped += 1;
                    }
                }
            }
            run.go_on()
        });
        run.skipped += walked.unreadable.len();
    }
    run.flush(true);
    Summary {
        id: request.id,
        scanned: run.scanned,
        files: run.files,
        hits: run.hits,
        skipped: run.skipped,
        truncated: run.truncated,
        stopped: stop(),
        error: None,
    }
}

/// Searches the open folders. `buffers` are the open documents with edits not yet saved.
pub(crate) fn search_for(
    state: &AppState,
    request: &Request,
    buffers: &[Buffer],
    emit: &mut dyn FnMut(Batch),
) -> Summary {
    let roots: Vec<PathBuf> = state
        .access()
        .roots()
        .iter()
        .map(|root| root.path.clone())
        .collect();
    let ignore_case = state.ignore_case();
    let held: HashMap<String, String> = buffers
        .iter()
        .filter_map(|buffer| {
            let path = state
                .documents()
                .get(buffer.id)
                .map(|entry| entry.path.clone())?;
            Some((place_key(&path, ignore_case)?, buffer.text.clone()))
        })
        .collect();
    let id = request.id;
    let stop = move || state.search_current() != id;
    run(
        &Inputs {
            roots: &roots,
            held: &held,
            ignore_case,
        },
        request,
        &stop,
        emit,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn request(query: &str) -> Request {
        Request {
            id: 1,
            query: query.into(),
            case_sensitive: false,
            whole_word: false,
            regexp: false,
        }
    }

    struct Outcome {
        hits: Vec<Hit>,
        batches: usize,
        summary: Summary,
    }

    fn search_with(
        roots: &[&Path],
        held: &[(&Path, &str)],
        request: &Request,
        stop: &dyn Fn() -> bool,
    ) -> Outcome {
        let roots: Vec<PathBuf> = roots.iter().map(|root| root.to_path_buf()).collect();
        let held: HashMap<String, String> = held
            .iter()
            .filter_map(|(path, text)| Some((place_key(path, false)?, (*text).to_owned())))
            .collect();
        let mut hits = Vec::new();
        let mut batches = 0;
        let summary = run(
            &Inputs {
                roots: &roots,
                held: &held,
                ignore_case: false,
            },
            request,
            stop,
            &mut |batch| {
                batches += 1;
                hits.extend(batch.hits);
            },
        );
        Outcome {
            hits,
            batches,
            summary,
        }
    }

    fn search(root: &Path, request: &Request) -> Outcome {
        search_with(&[root], &[], request, &|| false)
    }

    fn write(root: &Path, name: &str, body: &[u8]) {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("folder");
        }
        fs::write(path, body).expect("file");
    }

    fn places(outcome: &Outcome) -> Vec<(String, usize, usize)> {
        let mut found: Vec<_> = outcome
            .hits
            .iter()
            .map(|hit| {
                let name = hit.path.rsplit(['/', '\\']).next().unwrap_or_default();
                (name.to_owned(), hit.line, hit.column)
            })
            .collect();
        found.sort();
        found
    }

    // ---- matching -------------------------------------------------------------------------

    #[test]
    fn finds_every_match_in_every_file_with_line_and_utf16_column() {
        let dir = tempfile::tempdir().expect("dir");
        write(
            dir.path(),
            "a.md",
            "one\ntwo needle\n😀 needle needle\n".as_bytes(),
        );
        write(dir.path(), "sub/b.txt", b"needle");
        let outcome = search(dir.path(), &request("needle"));
        assert_eq!(
            places(&outcome),
            vec![
                ("a.md".to_owned(), 2, 4),
                // The emoji is two UTF-16 units, as the editor counts it.
                ("a.md".to_owned(), 3, 3),
                ("a.md".to_owned(), 3, 10),
                ("b.txt".to_owned(), 1, 0),
            ]
        );
        assert_eq!(outcome.summary.hits, 4);
        assert_eq!(outcome.summary.files, 2);
        assert_eq!(outcome.summary.scanned, 2);
        assert!(!outcome.summary.stopped && !outcome.summary.truncated);
    }

    #[test]
    fn plain_text_is_literal_case_is_ignored_unless_asked() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"a.b A.B axb\n");
        let loose = search(dir.path(), &request("a.b"));
        assert_eq!(loose.hits.len(), 2, "the dot is a dot, and case is ignored");
        let mut exact = request("a.b");
        exact.case_sensitive = true;
        assert_eq!(search(dir.path(), &exact).hits.len(), 1);
    }

    #[test]
    fn a_pattern_runs_and_a_bad_one_is_explained() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"abc 123 def 45\n");
        let mut pattern = request(r"\d+");
        pattern.regexp = true;
        let outcome = search(dir.path(), &pattern);
        assert_eq!(outcome.hits.len(), 2);
        assert_eq!(outcome.hits[0].length, 3);

        pattern.query = "(".into();
        let broken = search(dir.path(), &pattern);
        assert_eq!(
            broken.summary.error.as_deref(),
            Some("This is not a valid regular expression.")
        );
        assert!(broken.hits.is_empty());

        // What Find in a file can do and this engine cannot is named, not just refused.
        for unsupported in ["(?=a)a", r"(a)\1"] {
            pattern.query = unsupported.into();
            let refused = search(dir.path(), &pattern);
            let message = refused.summary.error.unwrap_or_default();
            assert!(
                message.contains("look-around or back-references"),
                "{unsupported}: {message}"
            );
        }
    }

    #[test]
    fn an_empty_query_searches_nothing() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"x\n");
        let outcome = search(dir.path(), &request(""));
        assert!(outcome.summary.error.is_some());
        assert_eq!(outcome.summary.scanned, 0);
    }

    #[test]
    fn whole_word_skips_a_match_inside_a_longer_word_in_any_script() {
        let dir = tempfile::tempdir().expect("dir");
        write(
            dir.path(),
            "a.md",
            "cat concat category cat_ (cat) über über_ x-über\n".as_bytes(),
        );
        let mut cat = request("cat");
        cat.whole_word = true;
        let columns: Vec<usize> = search(dir.path(), &cat)
            .hits
            .iter()
            .map(|h| h.column)
            .collect();
        assert_eq!(
            columns,
            vec![0, 26],
            "cat and (cat) only; cat_ has an underscore after it"
        );
        let mut uber = request("über");
        uber.whole_word = true;
        let columns: Vec<usize> = search(dir.path(), &uber)
            .hits
            .iter()
            .map(|h| h.column)
            .collect();
        assert_eq!(columns, vec![31, 44], "über and x-über, not über_");
        // Without the switch, every one of them.
        assert_eq!(search(dir.path(), &request("cat")).hits.len(), 5);
    }

    #[test]
    fn a_match_that_starts_or_ends_with_a_symbol_may_touch_a_letter() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"a(b) (b)x\n");
        let mut open = request("(b)");
        open.whole_word = true;
        // "(b)" is next to "a" and next to "x", but its edges are not word characters.
        assert_eq!(search(dir.path(), &open).hits.len(), 2);
    }

    #[test]
    fn empty_matches_are_not_matches() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"aaa\n");
        let mut pattern = request("x*");
        pattern.regexp = true;
        assert!(search(dir.path(), &pattern).hits.is_empty());
    }

    // ---- lines and columns ----------------------------------------------------------------

    #[test]
    fn lines_break_on_crlf_lf_and_a_lone_cr_like_the_editor() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"x\r\nneedle\rneedle\nlast needle");
        let found = places(&search(dir.path(), &request("needle")));
        assert_eq!(
            found,
            vec![
                ("a.md".to_owned(), 2, 0),
                ("a.md".to_owned(), 3, 0),
                ("a.md".to_owned(), 4, 5)
            ]
        );
    }

    #[test]
    fn a_utf8_byte_order_mark_and_utf16_files_are_read_as_text() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "bom.md", b"\xEF\xBB\xBFneedle\n");
        let mut wide = vec![0xFF, 0xFE];
        for unit in "a\nneedle".encode_utf16() {
            wide.extend_from_slice(&unit.to_le_bytes());
        }
        write(dir.path(), "wide.txt", &wide);
        let found = places(&search(dir.path(), &request("needle")));
        assert_eq!(
            found,
            vec![("bom.md".to_owned(), 1, 0), ("wide.txt".to_owned(), 2, 0)],
            "the mark is not part of the first line"
        );
    }

    #[test]
    fn a_long_line_is_cut_round_the_match_and_the_offsets_point_into_the_cut() {
        let dir = tempfile::tempdir().expect("dir");
        let line = format!("{}needle{}", "é".repeat(500), "z".repeat(500));
        write(dir.path(), "a.md", line.as_bytes());
        let outcome = search(dir.path(), &request("needle"));
        let hit = &outcome.hits[0];
        assert_eq!(hit.column, 500);
        assert!(hit.text.starts_with('…') && hit.text.ends_with('…'));
        assert!(hit.text.len() < EXCERPT_BYTES + 12);
        let units: Vec<u16> = hit.text.encode_utf16().collect();
        let shown = String::from_utf16_lossy(&units[hit.start..hit.start + hit.length]);
        assert_eq!(shown, "needle");
    }

    #[test]
    fn leading_white_space_is_dropped_from_the_excerpt() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"      \t  needle here  \n");
        let hit = &search(dir.path(), &request("needle")).hits[0];
        assert_eq!(hit.text, "needle here");
        assert_eq!((hit.start, hit.length, hit.column), (0, 6, 9));
    }

    // ---- what is read ---------------------------------------------------------------------

    #[test]
    fn reads_every_text_file_but_not_git_node_modules_binaries_or_links() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"needle");
        write(dir.path(), "code/main.rs", b"needle");
        write(dir.path(), "data.json", b"needle");
        write(dir.path(), ".docs/hidden.md", b"needle");
        write(dir.path(), ".git/config", b"needle");
        write(dir.path(), "node_modules/pkg/index.js", b"needle");
        write(dir.path(), "image.bin", b"needle\0needle");
        write(dir.path(), "binary-utf8.dat", b"needle\0");
        // A NUL after the first 8 KB is past the look at the start; the decoded text catches it.
        let mut late = "needle ".repeat(2000).into_bytes();
        late.push(0);
        write(dir.path(), "late-nul.dat", &late);
        let found = places(&search(dir.path(), &request("needle")));
        let names: Vec<&str> = found.iter().map(|(name, _, _)| name.as_str()).collect();
        assert_eq!(names, vec!["a.md", "data.json", "hidden.md", "main.rs"]);
    }

    #[test]
    fn an_encoding_mdmate_does_not_write_is_skipped_and_counted() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "latin.txt", b"caf\xE9 needle");
        write(dir.path(), "ok.txt", b"needle");
        let outcome = search(dir.path(), &request("needle"));
        assert_eq!(outcome.hits.len(), 1);
        assert_eq!(outcome.summary.skipped, 1);
    }

    #[test]
    fn nested_roots_list_a_file_once() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "notes/a.md", b"needle");
        let outer = dir.path();
        let inner = dir.path().join("notes");
        let outcome = search_with(&[outer, &inner], &[], &request("needle"), &|| false);
        assert_eq!(outcome.hits.len(), 1);
    }

    #[test]
    fn an_open_document_is_read_from_its_unsaved_text() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"old text on disk\n");
        write(dir.path(), "b.md", b"needle on disk\n");
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        let outcome = search_with(
            &[dir.path()],
            &[(&a, "typed needle\n"), (&b, "no match any more\n")],
            &request("needle"),
            &|| false,
        );
        assert_eq!(places(&outcome), vec![("a.md".to_owned(), 1, 6)]);
    }

    // ---- limits and stopping --------------------------------------------------------------

    #[test]
    fn stops_listing_at_the_cap_and_says_so() {
        let dir = tempfile::tempdir().expect("dir");
        write(
            dir.path(),
            "a.md",
            "needle\n".repeat(MAX_HITS + 50).as_bytes(),
        );
        write(dir.path(), "b.md", b"needle\n");
        let outcome = search(dir.path(), &request("needle"));
        assert_eq!(outcome.hits.len(), MAX_HITS);
        assert!(outcome.summary.truncated);
        assert_eq!(outcome.summary.hits, MAX_HITS);
    }

    #[test]
    fn exactly_the_cap_is_not_truncated() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", "needle\n".repeat(MAX_HITS).as_bytes());
        let outcome = search(dir.path(), &request("needle"));
        assert_eq!(outcome.hits.len(), MAX_HITS);
        assert!(!outcome.summary.truncated);
    }

    #[test]
    fn hits_arrive_in_batches_not_all_at_the_end() {
        let dir = tempfile::tempdir().expect("dir");
        write(
            dir.path(),
            "a.md",
            "needle\n".repeat(BATCH_HITS * 3 + 1).as_bytes(),
        );
        let outcome = search(dir.path(), &request("needle"));
        assert_eq!(outcome.hits.len(), BATCH_HITS * 3 + 1);
        assert!(outcome.batches >= 4, "{} batches", outcome.batches);
    }

    #[test]
    fn a_stop_ends_the_walk_within_an_entry_and_the_summary_says_so() {
        let dir = tempfile::tempdir().expect("dir");
        for n in 0..200 {
            write(dir.path(), &format!("d{n}/f.md"), b"needle");
        }
        let asked = AtomicUsize::new(0);
        let stop = || asked.fetch_add(1, Ordering::Relaxed) > 30;
        let outcome = search_with(&[dir.path()], &[], &request("needle"), &stop);
        assert!(outcome.summary.stopped);
        assert!(outcome.hits.len() < 100, "{} hits", outcome.hits.len());
        assert!(asked.load(Ordering::Relaxed) < 200);
    }

    #[test]
    fn a_stop_in_a_long_file_ends_it_within_a_few_hundred_lines() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", "needle\n".repeat(5000).as_bytes());
        let asked = AtomicUsize::new(0);
        // The walk asks twice per entry; after that only the line counter asks.
        let stop = || asked.fetch_add(1, Ordering::Relaxed) >= 4;
        let outcome = search_with(&[dir.path()], &[], &request("needle"), &stop);
        assert!(outcome.summary.stopped);
        assert!(
            outcome.hits.len() <= STOP_EVERY_LINES * 2,
            "{} hits",
            outcome.hits.len()
        );
    }

    #[test]
    fn a_file_above_the_size_limit_is_skipped_and_counted() {
        let dir = tempfile::tempdir().expect("dir");
        let big = dir.path().join("big.txt");
        let file = fs::File::create(&big).expect("file");
        file.set_len(MAX_FILE_BYTES + 1).expect("length");
        write(dir.path(), "ok.txt", b"needle");
        let outcome = search(dir.path(), &request("needle"));
        assert_eq!(outcome.hits.len(), 1);
        assert_eq!(outcome.summary.skipped, 1);
    }

    #[test]
    fn a_file_with_no_match_sends_progress_without_hits() {
        let dir = tempfile::tempdir().expect("dir");
        write(dir.path(), "a.md", b"nothing here");
        let mut counts = Vec::new();
        let roots = vec![dir.path().to_path_buf()];
        let held = HashMap::new();
        let summary = run(
            &Inputs {
                roots: &roots,
                held: &held,
                ignore_case: false,
            },
            &request("needle"),
            &|| false,
            &mut |batch| counts.push((batch.hits.len(), batch.scanned)),
        );
        assert_eq!(summary.scanned, 1);
        assert_eq!(
            counts,
            vec![(0, 1)],
            "the one forced batch at the end carries the count"
        );
    }

    // ---- the shared parity table ----------------------------------------------------------

    /// One row of `tests/fixtures/search-parity.json`. The page runs the same rows through Find.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        text: String,
        query: String,
        #[serde(default)]
        regexp: bool,
        #[serde(default)]
        case_sensitive: bool,
        #[serde(default)]
        whole_word: bool,
        /// `[line, start, end]` in UTF-16 units, for both engines unless `rust` says otherwise.
        matches: Vec<[usize; 3]>,
        /// Where Rust's `regex` is known to differ from JavaScript's.
        #[serde(default)]
        rust: Option<Vec<[usize; 3]>>,
    }

    #[test]
    fn the_parity_table_agrees_with_find() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../../tests/fixtures/search-parity.json"))
                .expect("the table parses");
        assert!(cases.len() >= 20, "{} cases", cases.len());
        for case in cases {
            let mut asked = request(&case.query);
            asked.regexp = case.regexp;
            asked.case_sensitive = case.case_sensitive;
            asked.whole_word = case.whole_word;
            let matcher = Matcher::new(&asked).expect(&case.name);
            let mut found = Vec::new();
            for (index, line) in lines(&case.text).enumerate() {
                for (start, end) in matcher.hits(line) {
                    let from = line[..start].encode_utf16().count();
                    found.push([
                        index + 1,
                        from,
                        from + line[start..end].encode_utf16().count(),
                    ]);
                }
            }
            let expected = case.rust.as_ref().unwrap_or(&case.matches);
            assert_eq!(&found, expected, "{}", case.name);
        }
    }
}
