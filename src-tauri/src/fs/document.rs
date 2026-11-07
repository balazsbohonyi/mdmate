//! A file as the editor sees it: `\n`-only text, the ending of every break, and the format needed
//! to write the same bytes back. This is where bytes become text and back, so it holds the round
//! trip guard that makes "saving an unedited file never changes a byte" true for any input.

use super::encoding::{self, Decoded, Format};
use super::eol::{self, Endings};
use crate::error::AppError;
use xxhash_rust::xxh3::xxh3_128;

/// Why a document cannot be saved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadOnlyReason {
    /// Not UTF-8 or UTF-16 with a byte-order mark, for example Latin-1.
    UnsupportedEncoding,
    /// Decoding and encoding again would not give the same bytes, so a save could change some.
    NotRoundTrippable,
}

impl ReadOnlyReason {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::UnsupportedEncoding => "unsupported-encoding",
            Self::NotRoundTrippable => "not-round-trippable",
        }
    }
}

/// What opening a file's bytes produced.
#[derive(Debug)]
pub(crate) struct Opened {
    /// How to write the text back. `None` when the document is read-only for its encoding.
    pub(crate) format: Option<Format>,
    pub(crate) text: String,
    pub(crate) endings: Endings,
    pub(crate) read_only: Option<ReadOnlyReason>,
    /// The size of the file on disk, in bytes.
    pub(crate) size: u64,
    /// The hash of the bytes as read; the watcher compares disk content against it.
    pub(crate) hash: u128,
}

/// A fingerprint of file content. XXH3 is fixed by its specification, so a hash written to the
/// journal in one session means the same thing in the next.
pub(crate) fn content_hash(bytes: &[u8]) -> u128 {
    xxh3_128(bytes)
}

/// Turns a file's bytes into an editable document.
pub(crate) fn open_bytes(bytes: &[u8]) -> Opened {
    let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let hash = content_hash(bytes);
    match encoding::decode(bytes) {
        Decoded::Unsupported { display } => {
            let (text, endings) = eol::split(&display);
            Opened {
                format: None,
                text,
                endings,
                read_only: Some(ReadOnlyReason::UnsupportedEncoding),
                size,
                hash,
            }
        }
        Decoded::Text { format, text } => {
            let (text, endings) = eol::split(&text);
            // The guard: if writing this back would not reproduce the file, never allow a save.
            let faithful = save_bytes(&text, &endings, format).is_ok_and(|again| again == bytes);
            Opened {
                format: faithful.then_some(format),
                text,
                endings,
                read_only: (!faithful).then_some(ReadOnlyReason::NotRoundTrippable),
                size,
                hash,
            }
        }
    }
}

/// Turns the editor's text and endings into the bytes to write.
pub(crate) fn save_bytes(
    text: &str,
    endings: &Endings,
    format: Format,
) -> Result<Vec<u8>, AppError> {
    let joined = eol::join(text, endings)?;
    Ok(encoding::encode(&joined, format))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::eol::Ending;

    #[test]
    fn a_plain_file_opens_editable_with_its_bytes_hashed() {
        let opened = open_bytes(b"# Title\r\nbody\r\n");
        assert_eq!(opened.text, "# Title\nbody\n");
        assert_eq!(opened.endings.dominant, Ending::CrLf);
        assert!(opened.read_only.is_none());
        assert_eq!(opened.size, 15);
        assert_eq!(opened.hash, content_hash(b"# Title\r\nbody\r\n"));
    }

    #[test]
    fn latin1_opens_read_only_for_its_encoding() {
        let opened = open_bytes(b"caf\xE9\n");
        assert_eq!(opened.read_only, Some(ReadOnlyReason::UnsupportedEncoding));
        assert!(opened.format.is_none());
        assert_eq!(opened.text, "caf\u{e9}\n");
    }

    #[test]
    fn saving_what_was_opened_gives_the_same_bytes() {
        let bytes = b"\xEF\xBB\xBFone\r\ntwo\nthree\rend";
        let opened = open_bytes(bytes);
        let format = opened.format.expect("this file is editable");
        assert_eq!(
            save_bytes(&opened.text, &opened.endings, format).expect("saves"),
            bytes
        );
    }

    #[test]
    fn a_save_with_a_carriage_return_in_the_text_is_refused() {
        let opened = open_bytes(b"a\nb");
        let format = opened.format.expect("editable");
        assert!(save_bytes("a\r\nb", &opened.endings, format).is_err());
    }

    #[test]
    fn the_hash_is_stable_and_tells_content_apart() {
        assert_eq!(content_hash(b"abc"), content_hash(b"abc"));
        assert_ne!(content_hash(b"abc"), content_hash(b"abd"));
        // XXH3-128 of the empty input is fixed by the specification.
        assert_eq!(content_hash(b""), 0x99aa_06d3_0147_98d8_6001_c324_468d_497f);
    }
}
