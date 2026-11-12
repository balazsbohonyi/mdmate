//! The outline panel's heading scan.
//!
//! The scan reads the text of one document, line by line, and lists its headings. It does not use
//! a parser, so it covers the whole file however far the editor's own parser has got, and a 10 MB
//! file is read in the time a thread takes to walk it. The rules are the ones `headingAnchors` in
//! `src/editor/headingSlug.ts` follows for `#fragment` links, and the table
//! `tests/fixtures/outline-parity.json` is run by both:
//!
//! - ATX headings (`#` to `######`, up to three spaces in front, an optional closing run of `#`)
//!   and setext headings (a paragraph line over `===` or `---`) are headings;
//! - fenced code (backtick or tilde fences, closed by a fence of the same character at least as
//!   long) and the frontmatter block at the top (`---` to `---` or `...` within 200 lines) are not
//!   scanned;
//! - headings inside lists and quotes are not found, like the anchors.
//!
//! A heading comes back with its level, its 1-based line and its raw text; the page turns the
//! line into a position with the document it has, so line endings never shift a jump.
//!
//! The page sends the text of a document with unsaved edits and a path for one without. The path
//! is checked against the files and folders the user opened, like every other read.

use crate::documents::AppState;
use crate::error::AppError;
use crate::fs;
use crate::search::lines;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

/// The most headings listed. A document with more shows the first ones and says so.
pub(crate) const MAX_HEADINGS: usize = 50_000;

/// How far down a frontmatter block may close, like the editor.
const FRONTMATTER_MAX_LINES: usize = 200;

/// A heading.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Heading {
    /// 1 for `#` and `===`, up to 6.
    pub(crate) level: u8,
    /// The line the heading starts on, from 1.
    pub(crate) line: usize,
    /// What the heading says, as written: markers and all, but not the `#` signs.
    pub(crate) text: String,
}

/// What the page asks for. One of `text` and `path` names the document.
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct Request {
    /// The page numbers its scans; the answer carries it back so a late one can be dropped.
    pub(crate) id: u64,
    /// The text of a document with edits not yet saved, or of one with no file yet.
    pub(crate) text: Option<String>,
    /// A file of a document with nothing unsaved.
    pub(crate) path: Option<String>,
}

/// What the scan found.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct Answer {
    pub(crate) id: u64,
    pub(crate) headings: Vec<Heading>,
    /// There were more than [`MAX_HEADINGS`], and the rest are not listed.
    pub(crate) truncated: bool,
}

static ATX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$").expect("a valid pattern")
});
static FENCE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^ {0,3}(`{3,}|~{3,})").expect("a valid pattern"));
static SETEXT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^ {0,3}(=+|-+)[ \t]*$").expect("a valid pattern"));
/// A line that cannot be the first line of a setext heading: indented code, a quote or a list item.
static NOT_PARAGRAPH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^( {4}|\t| {0,3}[>*+-]| {0,3}\d+[.)])").expect("a valid pattern")
});
static FRONT_OPEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^---[ \t]*$").expect("a valid pattern"));
static FRONT_CLOSE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:---|\.\.\.)[ \t]*$").expect("a valid pattern"));

/// The line the frontmatter block ends on, from 1, or None when the text has none.
fn frontmatter_end(all: &[&str]) -> Option<usize> {
    if all.len() < 2 || !FRONT_OPEN.is_match(all[0]) {
        return None;
    }
    let last = all.len().min(FRONTMATTER_MAX_LINES);
    (2..=last).find(|n| FRONT_CLOSE.is_match(all[n - 1]))
}

/// Every heading of `text`, in order, up to [`MAX_HEADINGS`]; the flag says there were more.
pub(crate) fn scan(text: &str) -> (Vec<Heading>, bool) {
    let all: Vec<&str> = lines(text).collect();
    let skip_to = frontmatter_end(&all).unwrap_or(0);
    let mut found: Vec<Heading> = Vec::new();
    let mut truncated = false;
    let mut fence: Option<String> = None;
    // The last line that could be the first line of a setext heading, with its number.
    let mut previous: Option<(usize, &str)> = None;
    for (index, line) in all.iter().enumerate() {
        let number = index + 1;
        if number <= skip_to {
            continue;
        }
        let fence_match = FENCE
            .captures(line)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str());
        if let Some(open) = &fence {
            if let Some(run) = fence_match
                && run.starts_with(open.chars().next().unwrap_or('`'))
                && run.len() >= open.len()
            {
                fence = None;
            }
            continue;
        }
        if let Some(run) = fence_match {
            fence = Some(run.to_string());
            previous = None;
            continue;
        }
        let heading = if let Some(atx) = ATX.captures(line) {
            let level = atx.get(1).map_or(1, |m| m.as_str().len());
            let text = atx.get(2).map_or("", |m| m.as_str());
            previous = None;
            Some((level, number, text))
        } else if let Some((above, above_text)) = previous
            && let Some(bar) = SETEXT.captures(line)
        {
            previous = None;
            let level = if bar.get(1).is_some_and(|m| m.as_str().starts_with('=')) {
                1
            } else {
                2
            };
            Some((level, above, above_text))
        } else {
            // A paragraph line can become a setext heading; indented code, quotes and lists cannot.
            previous = if line.trim().is_empty() || NOT_PARAGRAPH.is_match(line) {
                None
            } else {
                Some((number, line))
            };
            None
        };
        if let Some((level, at, text)) = heading {
            if found.len() == MAX_HEADINGS {
                truncated = true;
                break;
            }
            found.push(Heading {
                level: u8::try_from(level).unwrap_or(6),
                line: at,
                text: text.to_string(),
            });
        }
    }
    (found, truncated)
}

/// Answers a request: the text it carries, or the file it names.
pub(crate) fn answer(state: &Arc<AppState>, request: &Request) -> Result<Answer, AppError> {
    let (headings, truncated) = if let Some(text) = &request.text {
        scan(text)
    } else if let Some(path) = &request.path {
        // The same guard every read of the user's files goes through: only a file or a folder the
        // user opened.
        let resolved = state.access().check(&PathBuf::from(path))?;
        let opened = fs::open_path(&resolved.path)?;
        scan(&opened.text)
    } else {
        return Err(AppError::Invalid(
            "An outline needs the text of a document or the path of a file.".to_string(),
        ));
    };
    Ok(Answer {
        id: request.id,
        headings,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(text: &str) -> Vec<(u8, usize, String)> {
        scan(text)
            .0
            .into_iter()
            .map(|h| (h.level, h.line, h.text))
            .collect()
    }

    fn h(level: u8, line: usize, text: &str) -> (u8, usize, String) {
        (level, line, text.to_string())
    }

    #[test]
    fn atx_levels_one_to_six_and_not_seven() {
        let text = "# a\n## b\n### c\n#### d\n##### e\n###### f\n####### g\n";
        assert_eq!(
            plain(text),
            vec![
                h(1, 1, "a"),
                h(2, 2, "b"),
                h(3, 3, "c"),
                h(4, 4, "d"),
                h(5, 5, "e"),
                h(6, 6, "f")
            ]
        );
    }

    #[test]
    fn atx_needs_a_space_after_the_hashes_and_allows_up_to_three_before() {
        assert_eq!(plain("#nospace\n"), vec![]);
        assert_eq!(plain("   # three\n"), vec![h(1, 1, "three")]);
        assert_eq!(plain("    # four\n"), vec![]);
        assert_eq!(plain("\t# tab\n"), vec![]);
    }

    #[test]
    fn a_closing_run_of_hashes_and_trailing_blanks_are_not_the_text() {
        assert_eq!(plain("## Title ##\n"), vec![h(2, 1, "Title")]);
        assert_eq!(plain("## Title   \n"), vec![h(2, 1, "Title")]);
        assert_eq!(plain("## C# and F#\n"), vec![h(2, 1, "C# and F#")]);
        assert_eq!(plain("##\n"), vec![h(2, 1, "")]);
    }

    #[test]
    fn setext_headings_take_the_paragraph_line_above() {
        let text = "Title\n=====\n\nSub\n---\n";
        assert_eq!(plain(text), vec![h(1, 1, "Title"), h(2, 4, "Sub")]);
    }

    #[test]
    fn a_setext_bar_needs_a_paragraph_line_above_it() {
        // Nothing above, a blank line above, a list item above and a quote above: no heading.
        assert_eq!(plain("---\n"), vec![]);
        assert_eq!(plain("text\n\n===\n"), vec![]);
        assert_eq!(plain("- item\n---\n"), vec![]);
        assert_eq!(plain("> quote\n===\n"), vec![]);
        assert_eq!(plain("    code\n---\n"), vec![]);
        assert_eq!(plain("1. one\n===\n"), vec![]);
    }

    #[test]
    fn fenced_code_is_not_scanned_and_a_longer_fence_closes_a_shorter_one() {
        let text =
            "```\n# not a heading\n```\n# real\n~~~~\n# no\n~~~\n# still in\n~~~~\n# after\n";
        assert_eq!(plain(text), vec![h(1, 4, "real"), h(1, 10, "after")]);
    }

    #[test]
    fn a_fence_of_the_other_character_does_not_close() {
        let text = "```\n# in\n~~~\n# still in\n```\n# out\n";
        assert_eq!(plain(text), vec![h(1, 6, "out")]);
    }

    #[test]
    fn an_unclosed_fence_hides_the_rest() {
        assert_eq!(plain("# a\n```\n# b\n# c\n"), vec![h(1, 1, "a")]);
    }

    #[test]
    fn frontmatter_is_skipped_when_it_closes_within_200_lines() {
        assert_eq!(
            plain("---\n# yaml comment\ntitle: x\n---\n# real\n"),
            vec![h(1, 5, "real")]
        );
        assert_eq!(plain("---\ntitle: x\n...\n# real\n"), vec![h(1, 4, "real")]);
        // No closing line: the dashes are only a rule, and the heading below is a heading.
        assert_eq!(plain("---\n# a\n"), vec![h(1, 2, "a")]);
        // Not on the first line: not frontmatter.
        assert_eq!(plain("\n---\n# a\n---\n"), vec![h(1, 3, "a")]);
    }

    #[test]
    fn frontmatter_that_closes_after_200_lines_is_not_frontmatter() {
        let mut text = String::from("---\n");
        for _ in 0..205 {
            text.push_str("key: v\n");
        }
        text.push_str("---\n# late\n");
        // The closing dashes after a paragraph line read as a setext bar, as they do in the editor.
        assert_eq!(plain(&text), vec![h(2, 206, "key: v"), h(1, 208, "late")]);
        let mut text = String::from("---\n");
        for _ in 0..198 {
            text.push_str("key: v\n");
        }
        text.push_str("---\n# early\n");
        assert_eq!(plain(&text), vec![h(1, 201, "early")]);
    }

    #[test]
    fn lines_break_on_lf_crlf_and_a_lone_cr_like_the_editor() {
        let text = "# one\r\n## two\r\n\r\n### three\r# four\n";
        assert_eq!(
            plain(text),
            vec![
                h(1, 1, "one"),
                h(2, 2, "two"),
                h(3, 4, "three"),
                h(1, 5, "four")
            ]
        );
    }

    #[test]
    fn headings_in_lists_and_quotes_are_not_found() {
        assert_eq!(plain("- # in a list\n> # in a quote\n"), vec![]);
    }

    #[test]
    fn text_keeps_its_inline_markup_for_the_page_to_render() {
        assert_eq!(
            plain("# A **bold** [link](x.md) `code`\n"),
            vec![h(1, 1, "A **bold** [link](x.md) `code`")]
        );
    }

    #[test]
    fn an_empty_document_has_no_headings() {
        assert_eq!(plain(""), vec![]);
        assert_eq!(plain("\n\n"), vec![]);
    }

    #[test]
    fn the_scan_stops_at_the_cap_and_says_so() {
        let text = "# h\n".repeat(MAX_HEADINGS + 5);
        let (found, truncated) = scan(&text);
        assert_eq!(found.len(), MAX_HEADINGS);
        assert!(truncated);
        let exact = "# h\n".repeat(MAX_HEADINGS);
        let (found, truncated) = scan(&exact);
        assert_eq!(found.len(), MAX_HEADINGS);
        assert!(!truncated);
    }

    #[test]
    fn outline_large_reaches_the_last_heading_of_a_10_mb_text() {
        let mut text = String::new();
        let mut sections = 0usize;
        while text.len() < 10 * 1024 * 1024 {
            sections += 1;
            text.push_str(&format!("## Section {sections}\n\n"));
            for _ in 0..8 {
                text.push_str("A paragraph of plain words that fills the section out a little.\n");
            }
            text.push_str("\n```\n# a comment in code\n```\n\n");
        }
        let started = std::time::Instant::now();
        let (found, truncated) = scan(&text);
        let took = started.elapsed();
        assert!(!truncated);
        assert_eq!(found.len(), sections);
        let last = found.last().expect("headings");
        assert_eq!(last.text, format!("Section {sections}"));
        // The line of the last heading is where it is in the text.
        assert_eq!(
            text.lines().nth(last.line - 1),
            Some(format!("## Section {sections}").as_str())
        );
        eprintln!(
            "scanned {} bytes, {} headings in {took:?}",
            text.len(),
            found.len()
        );
    }

    #[test]
    fn the_real_10_mb_fixture_is_read_to_its_last_heading_when_it_is_there() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/generated/realistic-10mb.md");
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!("skipped: {} is not generated here", path.display());
            return;
        };
        let (found, truncated) = scan(&text);
        assert!(!truncated);
        let last_atx = text
            .lines()
            .enumerate()
            .filter(|(_, l)| l.starts_with("# ") || l.starts_with("## ") || l.starts_with("### "))
            .last()
            .map(|(i, _)| i + 1)
            .expect("the fixture has headings");
        assert!(found.last().expect("headings").line >= last_atx);
    }

    #[derive(Deserialize)]
    struct Case {
        name: String,
        text: String,
        headings: Vec<(u8, usize, String)>,
    }

    #[test]
    fn the_parity_table_agrees_with_the_editors_scan() {
        let table = include_str!("../../../tests/fixtures/outline-parity.json");
        let cases: Vec<Case> = serde_json::from_str(table).expect("the table parses");
        assert!(cases.len() >= 20, "the table has {} cases", cases.len());
        for case in cases {
            assert_eq!(plain(&case.text), case.headings, "case: {}", case.name);
        }
    }
}
