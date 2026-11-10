//! The link scanner: finds link targets, with byte offsets, in any text.
//!
//! [`scan`] is pure: it reads a string and returns every link that points at a local file, in
//! order. A [`Link`] carries the byte span of the path part of its target and nothing else: not
//! the `<` `>` or quotes around it, not a `#fragment`, not a `"title"`. Replacing that span
//! therefore keeps the anchor and the title without any extra care ([`splice`]).
//!
//! Offsets are into the string it was given, line endings as they are. The walker scans the text a
//! file decodes to before its line endings are normalised, so an edit made at these offsets and
//! written back with the file's own encoding changes only the target bytes.
//!
//! What counts as a link: inline links and images, reference definitions, and the `src` of
//! `<img>` and the `href` of `<a>`. Not links, so never found: anything inside a fenced code block
//! or an inline code span, a reference *usage* (`[text][id]`: only its definition has a target),
//! wikilinks, `srcset`, web and mail addresses, anchors that stay in the page, and absolute or
//! network paths (the link guard refuses to follow those, and a rename cannot change them).

use super::guard::{decode, scheme_of};
use std::ops::Range;

/// How a link was written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Form {
    /// `[text](target)`
    Inline,
    /// `![alt](target)`
    Image,
    /// `[label]: target "title"`
    Reference,
    /// `<img src="target">`
    HtmlImage,
    /// `<a href="target">`
    HtmlAnchor,
}

/// What surrounds the target in the text, which the edit puts back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Wrapping {
    Bare,
    /// `<target>` in Markdown.
    Angle,
    /// `"target"` in an HTML attribute.
    Double,
    /// `'target'` in an HTML attribute.
    Single,
}

/// One link to a local file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Link {
    pub(crate) form: Form,
    /// Bytes of the path part of the target, as written.
    pub(crate) span: Range<usize>,
    /// The text of `span`.
    pub(crate) raw: String,
    /// The path with escapes undone, still relative and still using the separators it was written
    /// with. Where it leads is up to the caller.
    pub(crate) path: String,
    pub(crate) wrapping: Wrapping,
    /// True when the target uses `%XX` escapes, so an edit writes escapes too.
    pub(crate) percent: bool,
    /// Line of the start of the target, from 1.
    pub(crate) line: usize,
}

/// A change to the text: `text` goes where `span` was.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Edit {
    pub(crate) span: Range<usize>,
    pub(crate) text: String,
}

/// Finds every link to a local file in `text`.
pub(crate) fn scan(text: &str) -> Vec<Link> {
    let mut found = Vec::new();
    let mut open: Option<usize> = None;
    let mut fence: Option<(u8, usize)> = None;
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let start = offset;
        offset += line.len();
        if let Some(opening) = fence {
            if closes_fence(line, opening) {
                fence = None;
            }
            continue;
        }
        if let Some(opening) = opens_fence(line) {
            flush(text, &mut open, start, &mut found);
            fence = Some(opening);
            continue;
        }
        if line.trim().is_empty() {
            flush(text, &mut open, start, &mut found);
            continue;
        }
        if let Some(link) = reference_definition(text, start, offset) {
            flush(text, &mut open, start, &mut found);
            found.push(link);
            continue;
        }
        open.get_or_insert(start);
    }
    flush(text, &mut open, offset, &mut found);
    found.sort_by_key(|link| link.span.start);
    let mut line = 1;
    let mut at = 0;
    for link in &mut found {
        line += text.as_bytes()[at..link.span.start]
            .iter()
            .filter(|byte| **byte == b'\n')
            .count();
        at = link.span.start;
        link.line = line;
    }
    found
}

/// Scans the lines gathered so far as one paragraph.
fn flush(text: &str, open: &mut Option<usize>, end: usize, found: &mut Vec<Link>) {
    if let Some(start) = open.take() {
        inline(text, start..end, found);
    }
}

/// The text with `edits` applied. The spans must not overlap; they may come in any order.
pub(crate) fn apply(text: &str, edits: &[Edit]) -> String {
    let mut sorted: Vec<&Edit> = edits.iter().collect();
    sorted.sort_by_key(|edit| edit.span.start);
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for edit in sorted {
        out.push_str(&text[at..edit.span.start]);
        out.push_str(&edit.text);
        at = edit.span.end;
    }
    out.push_str(&text[at..]);
    out
}

/// `text` with the target of `link` pointing at `new_path` (forward slashes), written the way the
/// link was.
pub(crate) fn splice(text: &str, link: &Link, new_path: &str) -> String {
    apply(
        text,
        &[Edit {
            span: link.span.clone(),
            text: link.render(new_path),
        }],
    )
}

impl Link {
    /// How `new_path` is written in this link's place: the same escaping style, and a character
    /// the form cannot hold raw is escaped whatever the style.
    pub(crate) fn render(&self, new_path: &str) -> String {
        let mut out = String::with_capacity(new_path.len());
        let angle = self.wrapping == Wrapping::Angle && !self.percent;
        for c in new_path.chars() {
            let plain = c.is_ascii_alphanumeric() || "-._~/!$+,;@".contains(c);
            let raw_here = !self.percent
                && (!c.is_ascii() || (angle && (c == ' ' || c == '(' || c == ')')))
                && !c.is_control();
            if plain || raw_here {
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
}

// ---- blocks -------------------------------------------------------------------------------

/// Skips the container prefix of a line: spaces, tabs, block-quote marks and one list marker.
fn after_prefix(line: &[u8]) -> usize {
    let mut i = 0;
    let skip = |mut i: usize| {
        while matches!(line.get(i), Some(b' ' | b'\t' | b'>')) {
            i += 1;
        }
        i
    };
    i = skip(i);
    let digits = line[i..].iter().take_while(|b| b.is_ascii_digit()).count();
    let marker = if matches!(line.get(i), Some(b'-' | b'*' | b'+')) {
        1
    } else if (1..=9).contains(&digits) && matches!(line.get(i + digits), Some(b'.' | b')')) {
        digits + 1
    } else {
        0
    };
    if marker > 0 && matches!(line.get(i + marker), Some(b' ' | b'\t')) {
        i = skip(i + marker);
    }
    i
}

/// The character and length of a code fence this line opens.
fn opens_fence(line: &str) -> Option<(u8, usize)> {
    let bytes = line.as_bytes();
    let i = after_prefix(bytes);
    let c = *bytes.get(i)?;
    if c != b'`' && c != b'~' {
        return None;
    }
    let run = bytes[i..].iter().take_while(|b| **b == c).count();
    if run < 3 {
        return None;
    }
    // A backtick fence's info string cannot hold a backtick, or it is a code span.
    if c == b'`' && bytes[i + run..].contains(&b'`') {
        return None;
    }
    Some((c, run))
}

/// True when `line` closes the fence: the same character, at least as long, then nothing.
fn closes_fence(line: &str, (c, len): (u8, usize)) -> bool {
    let bytes = line.as_bytes();
    let mut i = 0;
    while matches!(bytes.get(i), Some(b' ' | b'\t' | b'>')) {
        i += 1;
    }
    let run = bytes[i..].iter().take_while(|b| **b == c).count();
    run >= len && line[i + run..].trim().is_empty()
}

// ---- inline -------------------------------------------------------------------------------

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C)
}

/// Looks for the end of a code span that opened with `len` backticks, from `from`.
fn code_span_end(bytes: &[u8], from: usize, end: usize, len: usize) -> Option<usize> {
    let mut i = from;
    while i < end {
        if bytes[i] == b'`' {
            let run = bytes[i..end].iter().take_while(|b| **b == b'`').count();
            if run == len {
                return Some(i + run);
            }
            i += run;
        } else {
            i += 1;
        }
    }
    None
}

/// Scans one paragraph: links, images and the tags of `<img>` and `<a>`.
fn inline(text: &str, range: Range<usize>, found: &mut Vec<Link>) {
    let bytes = text.as_bytes();
    let end = range.end;
    let mut i = range.start;
    let mut openers: Vec<usize> = Vec::new();
    while i < end {
        match bytes[i] {
            b'\\' => {
                i += if bytes.get(i + 1).is_some_and(u8::is_ascii_punctuation) {
                    2
                } else {
                    1
                };
            }
            b'`' => {
                let run = bytes[i..end].iter().take_while(|b| **b == b'`').count();
                i = code_span_end(bytes, i + run, end, run).unwrap_or(i + run);
            }
            b'<' => i = tag(text, i, end, found),
            b'[' => {
                openers.push(i);
                i += 1;
            }
            b']' => {
                let opener = openers.pop();
                if let Some(open) = opener
                    && bytes.get(i + 1) == Some(&b'(')
                    && let Some((dest, wrapping, next)) = inline_destination(bytes, i + 1, end)
                {
                    let image = open > range.start && bytes[open - 1] == b'!';
                    let form = if image { Form::Image } else { Form::Inline };
                    found.extend(link_at(text, dest, wrapping, form, true));
                    i = next;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
}

/// Reads the destination of an inline link whose `(` is at `open`: the span of the target, how it
/// is wrapped, and the index after the closing `)`. `None` when it is not a link after all.
fn inline_destination(
    bytes: &[u8],
    open: usize,
    end: usize,
) -> Option<(Range<usize>, Wrapping, usize)> {
    let mut i = skip_space(bytes, open + 1, end);
    let (dest, wrapping, after) = destination(bytes, i, end, true)?;
    i = after;
    let before_title = i;
    i = skip_space(bytes, i, end);
    if i != before_title
        && let Some(after_title) = title(bytes, i, end)
    {
        i = skip_space(bytes, after_title, end);
    }
    (bytes.get(i) == Some(&b')')).then_some((dest, wrapping, i + 1))
}

/// Skips spaces, tabs and at most one line break.
fn skip_space(bytes: &[u8], mut i: usize, end: usize) -> usize {
    let mut breaks = 0;
    while i < end && is_space(bytes[i]) {
        if bytes[i] == b'\n' {
            breaks += 1;
            if breaks > 1 {
                break;
            }
        }
        i += 1;
    }
    i
}

/// Reads a destination at `i`: `<...>` or a run with balanced parentheses and no space. In a
/// link a `)` at depth zero ends it; in a definition it makes the destination invalid.
fn destination(
    bytes: &[u8],
    i: usize,
    end: usize,
    in_link: bool,
) -> Option<(Range<usize>, Wrapping, usize)> {
    if *bytes.get(i)? == b'<' && i < end {
        let start = i + 1;
        let mut j = start;
        while j < end {
            match bytes[j] {
                b'>' => return Some((start..j, Wrapping::Angle, j + 1)),
                b'\n' | b'<' => return None,
                b'\\' if bytes.get(j + 1).is_some_and(u8::is_ascii_punctuation) => j += 2,
                _ => j += 1,
            }
        }
        return None;
    }
    let start = i;
    let mut j = i;
    let mut depth = 0;
    while j < end {
        match bytes[j] {
            b'\\' if bytes.get(j + 1).is_some_and(u8::is_ascii_punctuation) => j += 2,
            b'(' => {
                depth += 1;
                j += 1;
            }
            b')' => {
                if depth == 0 {
                    if in_link {
                        break;
                    }
                    return None;
                }
                depth -= 1;
                j += 1;
            }
            byte if byte <= b' ' || byte == 0x7F => break,
            _ => j += 1,
        }
    }
    (j > start && depth == 0).then_some((start..j, Wrapping::Bare, j))
}

/// Reads a title at `i` (`"..."`, `'...'` or `(...)`) and returns the index after it.
fn title(bytes: &[u8], i: usize, end: usize) -> Option<usize> {
    let close = match *bytes.get(i)? {
        b'"' => b'"',
        b'\'' => b'\'',
        b'(' => b')',
        _ => return None,
    };
    let mut j = i + 1;
    while j < end {
        match bytes[j] {
            b'\\' if bytes.get(j + 1).is_some_and(u8::is_ascii_punctuation) => j += 2,
            byte if byte == close => return Some(j + 1),
            b'(' if close == b')' => return None,
            _ => j += 1,
        }
    }
    None
}

// ---- reference definitions ----------------------------------------------------------------

/// `[label]: target "title"` on one line, in a quote or not.
fn reference_definition(text: &str, start: usize, end: usize) -> Option<Link> {
    let bytes = text.as_bytes();
    let mut i = start;
    let mut indent = 0;
    while i < end {
        match bytes[i] {
            b' ' => indent += 1,
            b'\t' => indent += 4,
            b'>' => indent = 0,
            _ => break,
        }
        i += 1;
    }
    if indent > 3 || bytes.get(i) != Some(&b'[') {
        return None;
    }
    i += 1;
    let label = i;
    while i < end {
        match bytes[i] {
            b'\\' if bytes.get(i + 1).is_some_and(u8::is_ascii_punctuation) => i += 2,
            b'[' => return None,
            b']' => break,
            _ => i += 1,
        }
    }
    if i >= end || bytes[label..i].iter().all(|b| is_space(*b)) || bytes.get(i + 1) != Some(&b':') {
        return None;
    }
    i += 2;
    while i < end && matches!(bytes[i], b' ' | b'\t') {
        i += 1;
    }
    let (dest, wrapping, after) = destination(bytes, i, end, false)?;
    let mut j = after;
    while j < end && matches!(bytes[j], b' ' | b'\t') {
        j += 1;
    }
    if j > after && j < end && !is_space(bytes[j]) {
        j = title(bytes, j, end)?;
        while j < end && matches!(bytes[j], b' ' | b'\t') {
            j += 1;
        }
    }
    if !text[j..end].trim().is_empty() {
        return None;
    }
    link_at(text, dest, wrapping, Form::Reference, true)
}

// ---- HTML ---------------------------------------------------------------------------------

/// Handles a `<` at `i`: the tag of an `<img>` or `<a>`, or a web autolink to step over. Returns
/// where scanning goes on.
fn tag(text: &str, i: usize, end: usize, found: &mut Vec<Link>) -> usize {
    let bytes = text.as_bytes();
    let mut j = i + 1;
    while j < end && bytes[j].is_ascii_alphabetic() {
        j += 1;
    }
    let name = text[i + 1..j].to_ascii_lowercase();
    let wanted = match name.as_str() {
        "img" => Some(("src", Form::HtmlImage)),
        "a" => Some(("href", Form::HtmlAnchor)),
        _ => None,
    };
    let Some((attribute, form)) = wanted else {
        // `<https://...>` and `<mailto:...>` hold no local link; step over them.
        if scheme_of(&text[i + 1..end]).is_some()
            && let Some(close) = bytes[i..end].iter().position(|b| *b == b'>')
            && !bytes[i..i + close].iter().any(|b| is_space(*b))
        {
            return i + close + 1;
        }
        return i + 1;
    };
    if j < end && !(is_space(bytes[j]) || matches!(bytes[j], b'/' | b'>')) {
        return i + 1;
    }
    let mut value: Option<(Range<usize>, Wrapping)> = None;
    loop {
        while j < end && is_space(bytes[j]) {
            j += 1;
        }
        let Some(&byte) = bytes.get(j).filter(|_| j < end) else {
            return i + 1;
        };
        match byte {
            b'>' => break,
            b'/' => {
                j += 1;
                continue;
            }
            _ => {}
        }
        let name_start = j;
        while j < end && !is_space(bytes[j]) && !b"\"'<>/=".contains(&bytes[j]) {
            j += 1;
        }
        if j == name_start {
            return i + 1;
        }
        let attr = text[name_start..j].to_ascii_lowercase();
        while j < end && is_space(bytes[j]) {
            j += 1;
        }
        if bytes.get(j) != Some(&b'=') || j >= end {
            continue;
        }
        j += 1;
        while j < end && is_space(bytes[j]) {
            j += 1;
        }
        let (span, wrapping) = match bytes.get(j) {
            Some(&quote @ (b'"' | b'\'')) if j < end => {
                let start = j + 1;
                let Some(len) = bytes[start..end].iter().position(|b| *b == quote) else {
                    return i + 1;
                };
                j = start + len + 1;
                let wrapping = if quote == b'"' {
                    Wrapping::Double
                } else {
                    Wrapping::Single
                };
                (start..start + len, wrapping)
            }
            _ => {
                let start = j;
                while j < end && !is_space(bytes[j]) && !b"\"'=<>`".contains(&bytes[j]) {
                    j += 1;
                }
                let mut stop = j;
                if stop > start && bytes[stop - 1] == b'/' && bytes.get(j) == Some(&b'>') {
                    stop -= 1;
                }
                (start..stop, Wrapping::Bare)
            }
        };
        if attr == attribute && value.is_none() {
            value = Some((span, wrapping));
        }
    }
    if let Some((span, wrapping)) = value {
        found.extend(link_at(text, span, wrapping, form, false));
    }
    j + 1
}

// ---- targets ------------------------------------------------------------------------------

/// Turns the text of a target into a link, or nothing when it does not lead to a local file: it
/// is empty, an anchor, a web address, absolute, or an escape that cannot be read. `markdown` says
/// whether a backslash escapes the character after it.
fn link_at(
    text: &str,
    target: Range<usize>,
    wrapping: Wrapping,
    form: Form,
    markdown: bool,
) -> Option<Link> {
    let whole = text.get(target.clone())?;
    let (raw, _) = whole.split_once('#').unwrap_or((whole, ""));
    if raw.is_empty() || raw.starts_with(['/', '\\']) || raw.chars().any(char::is_control) {
        return None;
    }
    let unescaped = if markdown {
        unescape(raw)
    } else {
        raw.to_owned()
    };
    let path = decode(&unescaped).ok()?;
    if path.contains(':') || path.chars().any(char::is_control) {
        return None;
    }
    let percent = raw
        .as_bytes()
        .windows(3)
        .any(|w| w[0] == b'%' && w[1].is_ascii_hexdigit() && w[2].is_ascii_hexdigit());
    let span = target.start..target.start + raw.len();
    Some(Link {
        form,
        span,
        raw: raw.to_owned(),
        path,
        wrapping,
        percent,
        line: 0,
    })
}

/// Undoes backslash escapes: `\(` is `(`.
fn unescape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\'
            && let Some(next) = chars.peek().filter(|next| next.is_ascii_punctuation())
        {
            out.push(*next);
            chars.next();
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raws(text: &str) -> Vec<String> {
        scan(text).into_iter().map(|link| link.raw).collect()
    }

    /// Points every link in `text` at `to`: scan, render, splice.
    fn rewrite_all(text: &str, to: &str) -> String {
        let edits: Vec<Edit> = scan(text)
            .iter()
            .map(|link| Edit {
                span: link.span.clone(),
                text: link.render(to),
            })
            .collect();
        apply(text, &edits)
    }

    #[test]
    fn rewrite_reference() {
        let text = "[a]: old.md\n[b]: <my old.md> \"Title\"\n[c]: old.md 'T'\n[d]: old.md (T)\n  [e]: old.md\n> [f]: old.md\n";
        assert_eq!(
            raws(text),
            [
                "old.md",
                "my old.md",
                "old.md",
                "old.md",
                "old.md",
                "old.md"
            ]
        );
        assert!(scan(text).iter().all(|l| l.form == Form::Reference));
        assert_eq!(
            rewrite_all(text, "new.md"),
            "[a]: new.md\n[b]: <new.md> \"Title\"\n[c]: new.md 'T'\n[d]: new.md (T)\n  [e]: new.md\n> [f]: new.md\n"
        );
    }

    #[test]
    fn a_reference_usage_or_a_broken_definition_has_no_target() {
        for text in [
            "see [t][old.md] and [old.md][] and [old.md]\n",
            "    [g]: old.md\n",
            "[h]: \n",
            "[a]: old.md trailing words\n",
            "[a]: <old.md\n",
            "[]: old.md\n",
            "[a] old.md\n",
            "[a]: old(.md\n",
        ] {
            assert_eq!(raws(text), Vec::<String>::new(), "{text:?}");
        }
    }

    #[test]
    fn rewrite_img_tag() {
        let text = "<img src=\"old.png\" alt=\"a\">\n\n<IMG SRC='old.png'>\n\n<img alt=\"x\" src=old.png width=3>\n\n<img\n  src=\"old.png\"\n/>\n\n<a href=\"old.md\">t</a> <a class=\"c\" href='old.md'>t</a>\n";
        let links = scan(text);
        assert_eq!(links.len(), 6);
        assert_eq!(
            links.iter().map(|l| l.form).collect::<Vec<_>>(),
            [
                Form::HtmlImage,
                Form::HtmlImage,
                Form::HtmlImage,
                Form::HtmlImage,
                Form::HtmlAnchor,
                Form::HtmlAnchor
            ]
        );
        assert_eq!(
            links.iter().map(|l| l.wrapping).collect::<Vec<_>>(),
            [
                Wrapping::Double,
                Wrapping::Single,
                Wrapping::Bare,
                Wrapping::Double,
                Wrapping::Double,
                Wrapping::Single
            ]
        );
        assert_eq!(
            rewrite_all(text, "new.png"),
            "<img src=\"new.png\" alt=\"a\">\n\n<IMG SRC='new.png'>\n\n<img alt=\"x\" src=new.png width=3>\n\n<img\n  src=\"new.png\"\n/>\n\n<a href=\"new.png\">t</a> <a class=\"c\" href='new.png'>t</a>\n"
        );
    }

    #[test]
    fn html_that_holds_no_local_link_is_left_alone() {
        for text in [
            "<img src=\"https://x.test/old.png\">\n",
            "<img data-src=\"old.png\">\n",
            "<imgx src=\"old.png\">\n",
            "<a name=\"old.md\">x</a>\n",
            "<a href>x</a>\n",
            "<img src=\"\">\n",
            "<video src=\"old.mp4\"></video>\n",
            "<img src=\"old.png\n",
            "<https://x.test/old.md>\n",
        ] {
            assert_eq!(raws(text), Vec::<String>::new(), "{text:?}");
        }
    }

    #[test]
    fn rewrite_percent() {
        let text = "[a](my%20old%20file.md) [b](caf%C3%A9.md) ![c](a%2Fb.png)\n";
        let links = scan(text);
        assert_eq!(
            links.iter().map(|l| l.path.as_str()).collect::<Vec<_>>(),
            ["my old file.md", "café.md", "a/b.png"]
        );
        assert!(links.iter().all(|l| l.percent));
        // A rewrite keeps writing escapes, and writes the new name's characters as bytes.
        assert_eq!(
            rewrite_all(text, "dir/new name é.md"),
            "[a](dir/new%20name%20%C3%A9.md) [b](dir/new%20name%20%C3%A9.md) ![c](dir/new%20name%20%C3%A9.md)\n"
        );
    }

    #[test]
    fn a_bad_percent_escape_skips_that_link_and_no_other() {
        // `%FF` is not UTF-8, so the first link cannot be read; the others still are.
        assert_eq!(
            raws("[a](%FF.md) [b](ok.md)\n[c](bad%ZZ.md)\n"),
            ["ok.md", "bad%ZZ.md"]
        );
        let kept = scan("[c](bad%ZZ.md)\n");
        assert_eq!(kept[0].path, "bad%ZZ.md");
        assert!(!kept[0].percent);
    }

    #[test]
    fn rewrite_angle() {
        let text =
            "[a](<my old.md>) [b](<my old.md> \"t\") ![i](<my old.png>)\n[c](<my%20old.md>)\n";
        assert_eq!(
            raws(text),
            ["my old.md", "my old.md", "my old.png", "my%20old.md"]
        );
        assert!(
            scan(text)
                .iter()
                .take(3)
                .all(|l| l.wrapping == Wrapping::Angle)
        );
        // Angle brackets stay, spaces and parentheses stay raw, escaped targets stay escaped.
        assert_eq!(
            rewrite_all(text, "new dir/(new).md"),
            "[a](<new dir/(new).md>) [b](<new dir/(new).md> \"t\") ![i](<new dir/(new).md>)\n[c](<new%20dir/%28new%29.md>)\n"
        );
        // A bare link cannot hold a space, so it is written escaped.
        assert_eq!(
            rewrite_all("[a](old.md)\n", "new name.md"),
            "[a](new%20name.md)\n"
        );
    }

    #[test]
    fn rewrite_anchor() {
        let text = "[a](old.md#heading) [b](<old.md#a b>) [c](old.md#h \"T\")\n<a href=\"old.md#x\">t</a>\n[d]: old.md#sec\n[e](#local)\n";
        assert_eq!(
            raws(text),
            ["old.md", "old.md", "old.md", "old.md", "old.md"]
        );
        assert_eq!(
            rewrite_all(text, "dir/new.md"),
            "[a](dir/new.md#heading) [b](<dir/new.md#a b>) [c](dir/new.md#h \"T\")\n<a href=\"dir/new.md#x\">t</a>\n[d]: dir/new.md#sec\n[e](#local)\n"
        );
    }

    #[test]
    fn scan_inline_edge_cases() {
        let text = concat!(
            "[a](old.md \"t\") [b](old.md 't') [c](old.md (t))\n",
            "[a [b] c](nested.md)\n",
            "![alt](pic.png) and [![alt](inner.png)](outer.md)\n",
            "[p](old(1).md) [q](esc\\(1\\).md)\n",
            "[n](\n  newline.md\n)\n",
        );
        let links = scan(text);
        assert_eq!(
            links.iter().map(|l| l.raw.as_str()).collect::<Vec<_>>(),
            [
                "old.md",
                "old.md",
                "old.md",
                "nested.md",
                "pic.png",
                "inner.png",
                "outer.md",
                "old(1).md",
                "esc\\(1\\).md",
                "newline.md"
            ]
        );
        assert_eq!(links[4].form, Form::Image);
        assert_eq!(links[5].form, Form::Image);
        assert_eq!(links[6].form, Form::Inline);
        assert_eq!(links[8].path, "esc(1).md");
        assert_eq!(links[9].line, 6);
    }

    #[test]
    fn scan_leaves_what_is_not_a_link() {
        for text in [
            "\\[a](old.md)\n",
            "[a]()\n",
            "[a](old.md\n",
            "[a] (old.md)\n",
            "[a](<old.md)\n",
            "[a](old.md \"unclosed)\n",
            "[a](two words.md)\n",
            "text ](old.md)\n",
        ] {
            assert_eq!(raws(text), Vec::<String>::new(), "{text:?}");
        }
    }

    #[test]
    fn scan_skips_targets_that_are_not_local_files() {
        for target in [
            "https://x.test/a.md",
            "http://x.test/a.md",
            "mailto:x@y.test",
            "ftp://x.test/a.md",
            "file:///x/a.md",
            "#top",
            "/abs/a.md",
            "\\\\host\\share\\a.md",
            "//cdn.test/a.md",
            "C:\\x\\a.md",
            "C:/x/a.md",
            "a%3Ab.md",
        ] {
            let text = format!("[a]({target})\n[b]: {target}\n<a href=\"{target}\">x</a>\n");
            assert_eq!(raws(&text), Vec::<String>::new(), "{target}");
        }
    }

    #[test]
    fn code_is_never_scanned() {
        let text = concat!(
            "```\n[a](code1.md)\n```\n",
            "~~~md\n[a](code2.md)\n~~~\n",
            "````\n```\n[a](code3.md)\n```\n````\n",
            "- ```\n  [a](code4.md)\n  ```\n",
            "> ```\n> [a](code5.md)\n> ```\n",
            "`[a](span1.md)` and ``[a](span2.md) ` more`` then [a](real1.md)\n",
            "\n",
            "an unmatched ` tick, then [a](real2.md)\n",
            "\n",
            "```not a fence``` but a span, then [a](real3.md)\n",
            "\n",
            "```\n[a](code6.md)\n",
        );
        assert_eq!(raws(text), ["real1.md", "real2.md", "real3.md"]);
    }

    #[test]
    fn edits_apply_in_any_order() {
        let text = "[a](one.md) [b](two.md)\n";
        let links = scan(text);
        let edits = [
            Edit {
                span: links[1].span.clone(),
                text: "2".to_owned(),
            },
            Edit {
                span: links[0].span.clone(),
                text: "1".to_owned(),
            },
        ];
        assert_eq!(apply(text, &edits), "[a](1) [b](2)\n");
    }

    #[test]
    fn a_line_after_a_closed_fence_is_scanned_again() {
        assert_eq!(raws("```\nx\n```\n[a](after.md)\n"), ["after.md"]);
        assert_eq!(
            raws("```\nx\n``\n[a](still-code.md)\n"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn offsets_are_byte_offsets_and_lines_count_from_one() {
        let text = "é日本 😀 [a](old.md)\r\n\r\n[b](<naïve dir/x.md#é>)\r\n[c]: caf%C3%A9.md\r\n";
        let links = scan(text);
        assert_eq!(links.len(), 3);
        for link in &links {
            assert_eq!(&text[link.span.clone()], link.raw);
        }
        assert_eq!(links.iter().map(|l| l.line).collect::<Vec<_>>(), [1, 3, 4]);
        // Line endings are part of the text, so an edit leaves every one of them where it was.
        assert_eq!(
            rewrite_all(text, "n.md"),
            "é日本 😀 [a](n.md)\r\n\r\n[b](<n.md#é>)\r\n[c]: n.md\r\n"
        );
    }

    #[test]
    fn splice_changes_only_the_target_bytes() {
        let text = "before [a](old.md#h \"t\") after\n";
        let link = &scan(text)[0];
        let out = splice(text, link, "x/new.md");
        assert_eq!(out, "before [a](x/new.md#h \"t\") after\n");
        assert_eq!(&out[..link.span.start], &text[..link.span.start]);
        assert_eq!(
            &out[link.span.start + "x/new.md".len()..],
            &text[link.span.end..]
        );
    }

    /// A tiny generator, so the property test needs no crate and every run is the same.
    struct Lcg(u64);

    impl Lcg {
        fn below(&mut self, n: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            usize::try_from(self.0 >> 33).unwrap_or(0) % n
        }
    }

    #[test]
    fn every_form_reads_back_the_target_it_was_given() {
        // `{}` is the target. Each shape is tried with each way of writing it first.
        let shapes = [
            "[a]({})",
            "[a](<{}>)",
            "[a]({} \"t\")",
            "![a]({}#frag)",
            "[a]: {}",
            "[a]: <{}> 'x'",
            "<img src=\"{}\">",
            "<img src='{}'>",
            "<img alt=x src={}>",
            "<a href=\"{}#frag\">t</a>",
        ];
        let starts = ["old.md", "my%20old.md", "my old.md"];
        let pieces = [
            "a", "b c", "d(e)", "é", "日本", "x%y", "h#i", "q?r", "a&b", "it's", "\"q\"", "<t>",
            "~", "-", "_", "+", "!", "100%", "x\\y", "[b]", "a`b",
        ];
        let mut random = Lcg(7);
        let mut checked = 0;
        for shape in shapes {
            for start in starts {
                // A space is only legal in a written target inside `<...>`.
                if start.contains(' ') && !shape.contains("<{}>") {
                    continue;
                }
                for _ in 0..200 {
                    let segments = 1 + random.below(3);
                    let name = (0..segments)
                        .map(|_| pieces[random.below(pieces.len())])
                        .collect::<Vec<_>>()
                        .join("/");
                    let text = format!("lead\n\n{}\n\ntail\n", shape.replace("{}", start));
                    let links = scan(&text);
                    assert_eq!(links.len(), 1, "{text:?}");
                    let out = splice(&text, &links[0], &name);
                    let again = scan(&out);
                    assert_eq!(again.len(), 1, "{shape} {name:?} gave {out:?}");
                    assert_eq!(again[0].path, name, "{shape} {name:?} gave {out:?}");
                    assert_eq!(again[0].form, links[0].form, "{out:?}");
                    // Nothing outside the target moved.
                    assert!(out.starts_with(&text[..links[0].span.start]));
                    assert!(out.ends_with(&text[links[0].span.end..]));
                    checked += 1;
                }
            }
        }
        assert!(checked > 1000);
    }

    #[test]
    fn spans_are_in_order_and_never_overlap() {
        let text =
            "[![a](1.png)](2.md) <a href=3.md><img src=4.png></a> [x]: 5.md\n[b](6.md \"7.md\")\n";
        let links = scan(text);
        assert_eq!(links.len(), 5);
        for pair in links.windows(2) {
            assert!(pair[0].span.end <= pair[1].span.start);
        }
    }
}
