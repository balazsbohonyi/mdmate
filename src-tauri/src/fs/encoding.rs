//! Text encodings. mdmate edits UTF-8 and UTF-16 (with a byte-order mark) and writes each back the
//! way it came. Anything else opens read-only: guessing at Latin-1 or Windows-1252 would risk
//! changing bytes.

/// The encodings mdmate can write back byte for byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

impl Encoding {
    /// The name the page sees.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Utf8 => "utf-8",
            Self::Utf16Le => "utf-16le",
            Self::Utf16Be => "utf-16be",
        }
    }
}

/// An encoding and whether the file started with its byte-order mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Format {
    pub(crate) encoding: Encoding,
    pub(crate) bom: bool,
}

const BOM_UTF8: &[u8] = b"\xEF\xBB\xBF";
const BOM_UTF16_LE: &[u8] = b"\xFF\xFE";
const BOM_UTF16_BE: &[u8] = b"\xFE\xFF";

/// What reading a file's bytes found.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Decoded {
    /// Text mdmate can edit and write back.
    Text { format: Format, text: String },
    /// Bytes in an encoding mdmate does not write. `display` is a best-effort view for reading.
    Unsupported { display: String },
}

/// Works out the encoding from the byte-order mark, or from UTF-8 validity when there is none,
/// and decodes. Never fails: bytes it cannot trust come back as `Unsupported`.
pub(crate) fn decode(bytes: &[u8]) -> Decoded {
    if let Some(rest) = bytes.strip_prefix(BOM_UTF8) {
        return match std::str::from_utf8(rest) {
            Ok(text) => Decoded::Text {
                format: Format {
                    encoding: Encoding::Utf8,
                    bom: true,
                },
                text: text.to_owned(),
            },
            Err(_) => unsupported(bytes),
        };
    }
    for (bom, encoding) in [
        (BOM_UTF16_LE, Encoding::Utf16Le),
        (BOM_UTF16_BE, Encoding::Utf16Be),
    ] {
        if let Some(rest) = bytes.strip_prefix(bom) {
            return match decode_utf16(rest, encoding) {
                Some(text) => Decoded::Text {
                    format: Format {
                        encoding,
                        bom: true,
                    },
                    text,
                },
                None => Decoded::Unsupported {
                    display: lossy_utf16(rest, encoding),
                },
            };
        }
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Decoded::Text {
            format: Format {
                encoding: Encoding::Utf8,
                bom: false,
            },
            text: text.to_owned(),
        },
        Err(_) => unsupported(bytes),
    }
}

/// Every byte shown as the character with the same number (Latin-1), so nothing is dropped.
fn unsupported(bytes: &[u8]) -> Decoded {
    Decoded::Unsupported {
        display: bytes.iter().map(|&byte| char::from(byte)).collect(),
    }
}

fn units(bytes: &[u8], encoding: Encoding) -> impl Iterator<Item = u16> + '_ {
    bytes.chunks_exact(2).map(move |pair| {
        let pair = [pair[0], pair[1]];
        match encoding {
            Encoding::Utf16Be => u16::from_be_bytes(pair),
            _ => u16::from_le_bytes(pair),
        }
    })
}

/// `None` for an odd byte count or a lone surrogate, which could not be written back.
fn decode_utf16(bytes: &[u8], encoding: Encoding) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    char::decode_utf16(units(bytes, encoding))
        .collect::<Result<String, _>>()
        .ok()
}

fn lossy_utf16(bytes: &[u8], encoding: Encoding) -> String {
    char::decode_utf16(units(bytes, encoding))
        .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

/// Encodes text the way the file was: the same encoding, with its byte-order mark if it had one.
pub(crate) fn encode(text: &str, format: Format) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 4);
    match format.encoding {
        Encoding::Utf8 => {
            if format.bom {
                out.extend_from_slice(BOM_UTF8);
            }
            out.extend_from_slice(text.as_bytes());
        }
        Encoding::Utf16Le | Encoding::Utf16Be => {
            let big = format.encoding == Encoding::Utf16Be;
            if format.bom {
                out.extend_from_slice(if big { BOM_UTF16_BE } else { BOM_UTF16_LE });
            }
            for unit in text.encode_utf16() {
                out.extend_from_slice(&if big {
                    unit.to_be_bytes()
                } else {
                    unit.to_le_bytes()
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(decoded: Decoded) -> (Format, String) {
        match decoded {
            Decoded::Text { format, text } => (format, text),
            Decoded::Unsupported { .. } => panic!("expected supported text"),
        }
    }

    #[test]
    fn plain_utf8_has_no_bom() {
        let (format, text) = text_of(decode("caf\u{e9}".as_bytes()));
        assert_eq!(format.encoding, Encoding::Utf8);
        assert!(!format.bom);
        assert_eq!(text, "caf\u{e9}");
    }

    #[test]
    fn a_utf8_bom_is_remembered_and_kept_out_of_the_text() {
        let (format, text) = text_of(decode(b"\xEF\xBB\xBFhi"));
        assert!(format.bom);
        assert_eq!(text, "hi");
    }

    #[test]
    fn utf16_is_read_in_both_byte_orders() {
        let (le, le_text) = text_of(decode(b"\xFF\xFEh\0i\0"));
        let (be, be_text) = text_of(decode(b"\xFE\xFF\0h\0i"));
        assert_eq!(
            (le.encoding, be.encoding),
            (Encoding::Utf16Le, Encoding::Utf16Be)
        );
        assert_eq!((le_text.as_str(), be_text.as_str()), ("hi", "hi"));
    }

    #[test]
    fn latin1_bytes_are_unsupported_but_shown() {
        match decode(b"caf\xE9") {
            Decoded::Unsupported { display } => assert_eq!(display, "caf\u{e9}"),
            Decoded::Text { .. } => panic!("Latin-1 must not be treated as text"),
        }
    }

    #[test]
    fn broken_utf16_is_unsupported() {
        // An odd byte count, and a lone high surrogate.
        assert!(matches!(
            decode(b"\xFF\xFEh\0i"),
            Decoded::Unsupported { .. }
        ));
        assert!(matches!(
            decode(b"\xFF\xFE\x00\xD8"),
            Decoded::Unsupported { .. }
        ));
    }

    #[test]
    fn invalid_utf8_after_a_bom_is_unsupported() {
        assert!(matches!(
            decode(b"\xEF\xBB\xBFcaf\xE9"),
            Decoded::Unsupported { .. }
        ));
    }

    #[test]
    fn encode_reverses_decode_for_every_supported_form() {
        for bytes in [
            &b"plain"[..],
            b"\xEF\xBB\xBFwith bom",
            b"\xFF\xFEh\0i\0",
            b"\xFE\xFF\0h\0i",
            b"",
            b"\xFF\xFE",
            "\u{1F600} emoji".as_bytes(),
        ] {
            let (format, text) = text_of(decode(bytes));
            assert_eq!(encode(&text, format), bytes);
        }
    }

    #[test]
    fn utf16_with_astral_characters_round_trips() {
        let source = "a\u{1F600}b";
        let format = Format {
            encoding: Encoding::Utf16Le,
            bom: true,
        };
        let bytes = encode(source, format);
        assert_eq!(text_of(decode(&bytes)), (format, source.to_owned()));
    }
}
