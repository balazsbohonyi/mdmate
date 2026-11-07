//! The frame that carries a document between Rust and the page, in both directions, as raw bytes.
//!
//! ```text
//! u32 LE   header length
//! bytes    header, UTF-8 JSON
//! 0..3     zero bytes, so what follows starts on a 4-byte boundary
//! u32 LE   pairs of (break index, ending code), `exceptions` of them
//! bytes    the text, UTF-8, with `\n` as its only line break
//! ```
//!
//! The header always holds `dominant` (an ending code) and `exceptions` (the pair count); callers
//! add their own fields. The 4-byte alignment lets the page read the pairs as a `Uint32Array`
//! without copying. `src/platform/frame.ts` is the page's half of this and must change with it.

use super::eol::{Ending, Endings};
use crate::error::AppError;
use serde_json::{Map, Value};

fn padding(offset: usize) -> usize {
    (4 - offset % 4) % 4
}

/// Builds a frame. `header` gains the `dominant` and `exceptions` fields.
pub(crate) fn encode(mut header: Map<String, Value>, endings: &Endings, text: &str) -> Vec<u8> {
    header.insert("dominant".into(), endings.dominant.code().into());
    header.insert("exceptions".into(), endings.exceptions.len().into());
    let header = serde_json::to_vec(&Value::Object(header))
        .expect("a JSON object made of plain values always serializes");
    let header_len = u32::try_from(header.len()).expect("a header is far smaller than 4 GB");

    let start = 4 + header.len();
    let mut out = Vec::with_capacity(start + 3 + endings.exceptions.len() * 8 + text.len());
    out.extend_from_slice(&header_len.to_le_bytes());
    out.extend_from_slice(&header);
    out.resize(start + padding(start), 0);
    for &(index, ending) in &endings.exceptions {
        out.extend_from_slice(&index.to_le_bytes());
        out.extend_from_slice(&ending.code().to_le_bytes());
    }
    out.extend_from_slice(text.as_bytes());
    out
}

/// A frame taken apart.
#[derive(Debug)]
pub(crate) struct Frame<'a> {
    // Saves read only the endings and text; the header's own fields are checked by the tests.
    #[cfg_attr(not(test), allow(dead_code, reason = "only the tests read the header"))]
    pub(crate) header: Map<String, Value>,
    pub(crate) endings: Endings,
    pub(crate) text: &'a str,
}

fn invalid(what: &str) -> AppError {
    AppError::Invalid(format!("bad document frame: {what}"))
}

/// Takes a frame apart, refusing anything that is cut short, misaligned or inconsistent.
pub(crate) fn decode(bytes: &[u8]) -> Result<Frame<'_>, AppError> {
    let header_len = bytes
        .get(..4)
        .and_then(|b| <[u8; 4]>::try_from(b).ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| invalid("no length"))?;
    let header_end = 4usize
        .checked_add(header_len as usize)
        .ok_or_else(|| invalid("header too long"))?;
    let header_bytes = bytes
        .get(4..header_end)
        .ok_or_else(|| invalid("header cut short"))?;
    let Value::Object(header) =
        serde_json::from_slice(header_bytes).map_err(|_| invalid("header is not JSON"))?
    else {
        return Err(invalid("header is not an object"));
    };

    let dominant = header
        .get("dominant")
        .and_then(Value::as_u64)
        .and_then(|code| u32::try_from(code).ok())
        .and_then(Ending::from_code)
        .ok_or_else(|| invalid("no dominant ending"))?;
    let count = header
        .get("exceptions")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| invalid("no exception count"))?;

    let pairs_start = header_end + padding(header_end);
    let pairs_end = count
        .checked_mul(8)
        .and_then(|len| pairs_start.checked_add(len))
        .ok_or_else(|| invalid("too many exceptions"))?;
    let pair_bytes = bytes
        .get(pairs_start..pairs_end)
        .ok_or_else(|| invalid("exceptions cut short"))?;
    let mut exceptions = Vec::with_capacity(count);
    for pair in pair_bytes.chunks_exact(8) {
        let word = |at: usize| {
            <[u8; 4]>::try_from(&pair[at..at + 4])
                .map(u32::from_le_bytes)
                .map_err(|_| invalid("exception cut short"))
        };
        let ending = Ending::from_code(word(4)?).ok_or_else(|| invalid("unknown ending code"))?;
        exceptions.push((word(0)?, ending));
    }

    let text =
        std::str::from_utf8(&bytes[pairs_end..]).map_err(|_| invalid("text is not UTF-8"))?;
    Ok(Frame {
        header,
        endings: Endings {
            dominant,
            exceptions,
        },
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(path: &str) -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("path".into(), path.into());
        map
    }

    fn mixed() -> Endings {
        Endings {
            dominant: Ending::CrLf,
            exceptions: vec![(1, Ending::Lf), (5, Ending::Cr)],
        }
    }

    #[test]
    fn a_frame_comes_back_as_it_went() {
        let bytes = encode(header("caf\u{e9}.md"), &mixed(), "a\nb\n\u{1F600}");
        let frame = decode(&bytes).expect("a valid frame decodes");
        assert_eq!(frame.header.get("path"), Some(&Value::from("caf\u{e9}.md")));
        assert_eq!(frame.endings, mixed());
        assert_eq!(frame.text, "a\nb\n\u{1F600}");
    }

    /// The same bytes are pinned in `tests/platform/frame.test.ts`, so the two halves cannot drift.
    #[test]
    fn the_bytes_match_what_the_page_expects() {
        let endings = Endings {
            dominant: Ending::CrLf,
            exceptions: vec![(1, Ending::Lf)],
        };
        let mut expected = vec![43, 0, 0, 0];
        expected.extend_from_slice(br#"{"dominant":1,"exceptions":1,"name":"a.md"}"#);
        expected.push(0); // pads the 47 bytes so far to 48
        expected.extend_from_slice(&[1, 0, 0, 0, 0, 0, 0, 0]);
        expected.extend_from_slice(b"x\ny");
        assert_eq!(encode(header_named("a.md"), &endings, "x\ny"), expected);
    }

    fn header_named(name: &str) -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("name".into(), name.into());
        map
    }

    #[test]
    fn the_pairs_start_on_a_four_byte_boundary_whatever_the_header_length() {
        for name in ["", "a", "ab", "abc", "abcd", "abcde"] {
            let bytes = encode(header(name), &mixed(), "x");
            let header_len = u32::from_le_bytes(bytes[..4].try_into().expect("4 bytes")) as usize;
            let after_header = 4 + header_len;
            let pairs_start = after_header + padding(after_header);
            assert_eq!(pairs_start % 4, 0, "name {name:?}");
            // The first pair is (1, Lf = 0): the index sits right at the boundary.
            assert_eq!(&bytes[pairs_start..pairs_start + 4], &1u32.to_le_bytes());
        }
    }

    #[test]
    fn empty_text_and_no_exceptions_are_fine() {
        let bytes = encode(Map::new(), &Endings::uniform(Ending::Lf), "");
        let frame = decode(&bytes).expect("decodes");
        assert_eq!(frame.text, "");
        assert!(frame.endings.exceptions.is_empty());
    }

    #[test]
    fn cut_short_frames_are_refused() {
        let bytes = encode(header("p"), &mixed(), "text");
        for cut in [0, 2, 4, 6, bytes.len() - "text".len() - 1] {
            assert!(decode(&bytes[..cut]).is_err(), "cut at {cut}");
        }
    }

    #[test]
    fn a_header_that_lies_is_refused() {
        // Header length far beyond the data.
        let mut bytes = encode(header("p"), &mixed(), "t");
        bytes[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode(&bytes).is_err());
        // Not JSON.
        let mut junk = 3u32.to_le_bytes().to_vec();
        junk.extend_from_slice(b"abc");
        assert!(decode(&junk).is_err());
    }

    #[test]
    fn text_that_is_not_utf8_is_refused() {
        let mut bytes = encode(Map::new(), &Endings::uniform(Ending::Lf), "");
        bytes.push(0xFF);
        assert!(decode(&bytes).is_err());
    }

    #[test]
    fn an_unknown_ending_code_is_refused() {
        let mut bytes = encode(Map::new(), &mixed(), "a\nb\nc\nd\ne\nf\ng");
        let header_len = u32::from_le_bytes(bytes[..4].try_into().expect("4 bytes")) as usize;
        let pairs_start = 4 + header_len + padding(4 + header_len);
        bytes[pairs_start + 4..pairs_start + 8].copy_from_slice(&9u32.to_le_bytes());
        assert!(decode(&bytes).is_err());
    }
}
