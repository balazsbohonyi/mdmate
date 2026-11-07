//! Read, atomic write, encoding and line-ending detection.

pub(crate) mod atomic;
pub(crate) mod document;
pub(crate) mod encoding;
pub(crate) mod eol;
pub(crate) mod frame;

use crate::error::AppError;
use crate::platform::{self, Platform as _};
use document::{Opened, content_hash, open_bytes, save_bytes};
use encoding::Format;
use eol::Endings;
use std::path::Path;

/// Reads a whole file as raw bytes: no decoding and no line-ending changes.
pub(crate) fn read_bytes(path: &Path) -> Result<Vec<u8>, AppError> {
    Ok(std::fs::read(path)?)
}

/// Reads a file that another program may be in the middle of replacing. A few short retries ride
/// out the moment it is locked; a file that is not there fails at once.
pub(crate) fn read_bytes_settled(path: &Path) -> Result<Vec<u8>, AppError> {
    let mut attempt = 0;
    loop {
        match std::fs::read(path) {
            Ok(bytes) => return Ok(bytes),
            Err(error) if attempt < 5 && platform::current().file_is_busy(&error) => {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// Reads a file and turns it into an editable document.
pub(crate) fn open_path(path: &Path) -> Result<Opened, AppError> {
    Ok(open_bytes(&read_bytes_settled(path)?))
}

/// What a save wrote.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Saved {
    /// The hash of the bytes now on disk; the watcher uses it to ignore this write's own event.
    pub(crate) hash: u128,
    pub(crate) size: u64,
}

/// Joins the endings back, encodes the way the file was, and writes with a temp file and rename.
///
/// `before_write` gets the hash of the bytes about to be written, after they are made and before
/// anything touches the file. It can refuse the save, and it is where the caller records the hash
/// so that the file watcher, which may see the new file before this function returns, already
/// knows it is the app's own write.
///
/// `hook` can make the write fail just before the rename, or run just after it; tests use it,
/// production passes one that never fails.
pub(crate) fn save_path_guarded(
    path: &Path,
    text: &str,
    endings: &Endings,
    format: Format,
    before_write: impl FnOnce(u128) -> Result<(), AppError>,
    hook: impl Fn(atomic::Stage) -> std::io::Result<()>,
) -> Result<Saved, AppError> {
    let bytes = save_bytes(text, endings, format)?;
    let hash = content_hash(&bytes);
    before_write(hash)?;
    atomic::write_atomic_with(path, &bytes, hook)?;
    Ok(Saved {
        hash,
        size: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
    })
}

/// [`save_path_guarded`] with nothing to check first.
#[cfg(test)]
pub(crate) fn save_path_with(
    path: &Path,
    text: &str,
    endings: &Endings,
    format: Format,
    hook: impl Fn(atomic::Stage) -> std::io::Result<()>,
) -> Result<Saved, AppError> {
    save_path_guarded(path, text, endings, format, |_| Ok(()), hook)
}

#[cfg(test)]
mod tests {
    use super::*;
    use document::ReadOnlyReason;
    use encoding::Encoding;
    use std::path::PathBuf;

    fn save_path(
        path: &Path,
        text: &str,
        endings: &Endings,
        format: Format,
    ) -> Result<Saved, AppError> {
        save_path_with(path, text, endings, format, |_| Ok(()))
    }

    fn fixtures_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures")
    }

    fn fixture(name: &str) -> PathBuf {
        fixtures_dir().join(name)
    }

    /// The committed fixtures, plus the generated ones when `pnpm fixtures` has been run.
    fn all_fixtures() -> Vec<PathBuf> {
        let mut found = Vec::new();
        for dir in [fixtures_dir(), fixtures_dir().join("generated")] {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "md") {
                    found.push(path);
                }
            }
        }
        found.sort();
        found
    }

    /// A small seeded generator, so a failing run replays.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }
        fn below(&mut self, n: usize) -> usize {
            usize::try_from(self.next()).unwrap_or(0) % n
        }
    }

    #[test]
    fn roundtrip_unedited_gives_back_every_byte_of_every_fixture() {
        let fixtures = all_fixtures();
        assert!(fixtures.len() >= 8, "the committed fixtures are present");
        for path in fixtures {
            let bytes = read_bytes(&path).expect("the fixture is readable");
            let opened = open_bytes(&bytes);
            let name = path.file_name().expect("a file name").to_string_lossy();
            if name == "latin1.md" {
                assert!(opened.format.is_none(), "{name} opens read-only");
                continue;
            }
            let format = opened
                .format
                .unwrap_or_else(|| panic!("{name} should be editable"));
            let again = save_bytes(&opened.text, &opened.endings, format).expect("saves");
            assert_eq!(content_hash(&again), content_hash(&bytes), "{name}");
            assert!(again == bytes, "{name} changed on a save with no edit");
        }
    }

    #[test]
    fn roundtrip_unedited_through_the_file_system_keeps_the_hash() {
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        for path in all_fixtures() {
            let name = path.file_name().expect("a file name").to_owned();
            if name == "latin1.md" {
                continue;
            }
            let copy = dir.path().join(&name);
            std::fs::copy(&path, &copy).expect("the fixture can be copied");
            let before = content_hash(&std::fs::read(&copy).expect("readable"));

            let opened = open_path(&copy).expect("opens");
            let format = opened.format.expect("editable");
            let saved = save_path(&copy, &opened.text, &opened.endings, format).expect("saves");

            let after = content_hash(&std::fs::read(&copy).expect("readable"));
            assert_eq!(before, after, "{name:?}");
            assert_eq!(saved.hash, after, "{name:?}");
        }
    }

    #[test]
    fn roundtrip_unedited_holds_for_random_bytes_of_every_shape() {
        let pieces = [
            "a",
            "caf\u{e9}",
            "\u{1F600}",
            " ",
            "# h",
            "\n",
            "\r\n",
            "\r",
            "\u{feff}",
            "\0",
        ];
        let mut rng = Lcg(20_261_107);
        for run in 0..3000 {
            let mut text = String::new();
            for _ in 0..rng.below(40) {
                text.push_str(pieces[rng.below(pieces.len())]);
            }
            let utf16 = |encoding| Format {
                encoding,
                bom: true,
            };
            let mut bytes = match rng.below(4) {
                0 => text.clone().into_bytes(),
                1 => [b"\xEF\xBB\xBF".as_slice(), text.as_bytes()].concat(),
                2 => encoding::encode(&text, utf16(Encoding::Utf16Le)),
                _ => encoding::encode(&text, utf16(Encoding::Utf16Be)),
            };
            // Now and then damage the bytes, to meet invalid input as well as valid.
            if rng.below(4) == 0 && !bytes.is_empty() {
                let at = rng.below(bytes.len());
                bytes[at] = u8::try_from(rng.below(256)).unwrap_or(0);
            }
            let opened = open_bytes(&bytes);
            if let Some(format) = opened.format {
                let again = save_bytes(&opened.text, &opened.endings, format).expect("saves");
                assert!(
                    again == bytes,
                    "run {run}: {bytes:?} came back as {again:?}"
                );
            } else {
                assert!(opened.read_only.is_some(), "run {run}");
            }
        }
    }

    /// The raw text for some `\n`-only text and the ending of each of its breaks, in order.
    fn raw_of(chars: &[char], ends: &[eol::Ending]) -> String {
        let mut raw = String::new();
        let mut next = 0;
        for &c in chars {
            if c == '\n' {
                raw.push_str(ends[next].as_str());
                next += 1;
            } else {
                raw.push(c);
            }
        }
        raw
    }

    /// Edits the way the page does: replace a range of the `\n`-only text, where the breaks the edit
    /// adds take the ending of the line they came from and every other break keeps its own. The
    /// model is a plain list with one ending per break, so it shares nothing with `eol.rs`.
    #[test]
    fn edit_isolation_leaves_every_byte_outside_an_edit_unchanged() {
        let pieces = [
            "a",
            "caf\u{e9}",
            "\u{1F600}",
            " ",
            "# h",
            "\n",
            "\r\n",
            "\r",
            "\u{feff}",
            "\0",
        ];
        let inserts = [
            "x",
            "\u{e9}\u{e9}",
            "\u{1F600}",
            "",
            "\n",
            "a\nb",
            "\n\n",
            "q\n",
            "\u{feff}",
        ];
        let formats = [
            Format {
                encoding: Encoding::Utf8,
                bom: false,
            },
            Format {
                encoding: Encoding::Utf8,
                bom: true,
            },
            Format {
                encoding: Encoding::Utf16Le,
                bom: true,
            },
            Format {
                encoding: Encoding::Utf16Be,
                bom: true,
            },
        ];
        let mut rng = Lcg(20_261_108);
        let mut edited = 0;
        for run in 0..1000 {
            let mut raw = String::new();
            for _ in 0..rng.below(40) {
                raw.push_str(pieces[rng.below(pieces.len())]);
            }
            let bytes = encoding::encode(&raw, formats[rng.below(formats.len())]);
            let opened = open_bytes(&bytes);
            // Every file built here is valid text in a supported encoding, so each must open for
            // editing. One that opens read-only means the round trip is broken.
            let Some(format) = opened.format else {
                panic!(
                    "run {run}: {raw:?} opened read-only: {:?}",
                    opened.read_only
                );
            };

            // The model: the text as characters, and the ending of every break.
            let chars: Vec<char> = opened.text.chars().collect();
            let breaks = chars.iter().filter(|&&c| c == '\n').count();
            let dominant = opened.endings.dominant;
            let mut ends = vec![dominant; breaks];
            for &(index, ending) in &opened.endings.exceptions {
                ends[usize::try_from(index).expect("an index fits")] = ending;
            }
            assert!(
                encoding::encode(&raw_of(&chars, &ends), format) == bytes,
                "run {run}: the model does not give the file back"
            );

            // One edit.
            let from = rng.below(chars.len() + 1);
            let to = chars.len().min(from + rng.below(6));
            let insert: Vec<char> = inserts[rng.below(inserts.len())].chars().collect();
            if from == to && insert.is_empty() {
                continue;
            }
            let first = chars[..from].iter().filter(|&&c| c == '\n').count();
            let removed = chars[from..to].iter().filter(|&&c| c == '\n').count();
            let added = insert.iter().filter(|&&c| c == '\n').count();
            let inherited = ends
                .get(first)
                .or_else(|| first.checked_sub(1).and_then(|i| ends.get(i)))
                .copied()
                .unwrap_or(dominant);

            let mut new_ends = ends.clone();
            new_ends.splice(
                first..first + removed,
                std::iter::repeat_n(inherited, added),
            );
            let mut new_chars = chars[..from].to_vec();
            new_chars.extend(&insert);
            new_chars.extend(&chars[to..]);
            let new_text: String = new_chars.iter().collect();
            let new_endings = eol::Endings {
                dominant,
                exceptions: new_ends
                    .iter()
                    .enumerate()
                    .filter(|&(_, &ending)| ending != dominant)
                    .map(|(i, &ending)| (u32::try_from(i).expect("an index fits"), ending))
                    .collect(),
            };

            // What the file must look like: its own bytes before the edit and after it, and the
            // new text, with its endings, between them.
            let bare = Format {
                bom: false,
                ..format
            };
            let before = encoding::encode(&raw_of(&chars[..from], &ends[..first]), format);
            let after = encoding::encode(&raw_of(&chars[to..], &ends[first + removed..]), bare);
            let middle = encoding::encode(&raw_of(&insert, &vec![inherited; added]), bare);
            assert_eq!(
                bytes.len(),
                before.len()
                    + after.len()
                    + encoding::encode(
                        &raw_of(&chars[from..to], &ends[first..first + removed]),
                        bare
                    )
                    .len(),
                "run {run}: the pieces do not add up to the file"
            );

            let saved = save_bytes(&new_text, &new_endings, format).expect("saves");
            assert!(
                saved[..before.len()] == bytes[..before.len()],
                "run {run}: bytes before the edit changed"
            );
            assert!(
                saved[saved.len() - after.len()..] == bytes[bytes.len() - after.len()..],
                "run {run}: bytes after the edit changed"
            );
            assert!(
                saved == [before.as_slice(), middle.as_slice(), after.as_slice()].concat(),
                "run {run}: the edit itself was written wrong"
            );
            edited += 1;
        }
        assert!(edited >= 900, "only {edited} of 1000 runs made an edit");
    }

    #[test]
    fn unsupported_encoding_opens_the_latin1_fixture_read_only_with_its_text_shown() {
        let opened = open_path(&fixture("latin1.md")).expect("opens");
        assert_eq!(opened.read_only, Some(ReadOnlyReason::UnsupportedEncoding));
        assert!(opened.format.is_none());
        assert!(
            opened.text.contains('\u{e9}'),
            "the accented text is visible"
        );
    }

    #[test]
    fn unsupported_encoding_covers_broken_utf8_and_broken_utf16() {
        for bytes in [&b"\xE9t\xE9"[..], b"ok \xC3", b"\xFF\xFE\x00\xDC\x00\x00"] {
            let opened = open_bytes(bytes);
            assert_eq!(
                opened.read_only,
                Some(ReadOnlyReason::UnsupportedEncoding),
                "{bytes:?}"
            );
        }
    }

    /// The fixture's characters, decoded without going through the code under test.
    fn independent_decode(name: &str, bytes: &[u8]) -> String {
        match name {
            "utf16le.md" | "utf16be.md" => {
                let big = name == "utf16be.md";
                let units: Vec<u16> = bytes[2..]
                    .chunks_exact(2)
                    .map(|p| {
                        if big {
                            u16::from_be_bytes([p[0], p[1]])
                        } else {
                            u16::from_le_bytes([p[0], p[1]])
                        }
                    })
                    .collect();
                String::from_utf16(&units).expect("the fixture is valid UTF-16")
            }
            "utf8-bom.md" => String::from_utf8(bytes[3..].to_vec()).expect("valid UTF-8"),
            _ => String::from_utf8(bytes.to_vec()).expect("valid UTF-8"),
        }
    }

    #[test]
    fn save_writes_edits_in_every_supported_encoding() {
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        for name in [
            "lf.md",
            "crlf.md",
            "mixed-eol.md",
            "utf8-bom.md",
            "utf16le.md",
            "utf16be.md",
        ] {
            let copy = dir.path().join(name);
            std::fs::copy(fixture(name), &copy).expect("the fixture can be copied");
            let before = std::fs::read(&copy).expect("readable");
            let opened = open_path(&copy).expect("opens");
            let format = opened.format.expect("editable");

            // The edit: the word "EDITED" typed at the very start of the text.
            let edited = format!("EDITED{}", opened.text);
            let saved = save_path(&copy, &edited, &opened.endings, format).expect("saves");

            // The file should now be the original with the same edit, encoded the same way.
            let expected = encoding::encode(
                &format!("EDITED{}", independent_decode(name, &before)),
                format,
            );
            let on_disk = std::fs::read(&copy).expect("readable");
            assert!(
                on_disk == expected,
                "{name}: the saved bytes are the original plus the edit"
            );
            assert_eq!(saved.hash, content_hash(&on_disk), "{name}");
            assert_eq!(
                saved.size,
                u64::try_from(on_disk.len()).unwrap_or(0),
                "{name}"
            );
        }
    }

    #[test]
    fn save_writes_edits_without_touching_the_other_lines_endings() {
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        let copy = dir.path().join("mixed.md");
        std::fs::write(&copy, b"one\r\ntwo\nthree\rfour\r\n").expect("written");
        let opened = open_path(&copy).expect("opens");
        let format = opened.format.expect("editable");
        let edited = opened.text.replace("two", "TWO");
        save_path(&copy, &edited, &opened.endings, format).expect("saves");
        assert_eq!(
            std::fs::read(&copy).expect("readable"),
            b"one\r\nTWO\nthree\rfour\r\n"
        );
    }

    #[test]
    fn returns_every_byte_untouched() {
        // A BOM, CRLF and a lone CR, a Latin-1 byte that is not valid UTF-8, and a NUL.
        let bytes: &[u8] = b"\xEF\xBB\xBFline\r\nnext\rcaf\xE9\0end";
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        let path = dir.path().join("raw.md");
        std::fs::write(&path, bytes).expect("the fixture file can be written");
        assert_eq!(read_bytes(&path).expect("the file is readable"), bytes);
    }

    #[test]
    fn reads_a_ten_megabyte_file() {
        let bytes = vec![b'a'; 10 * 1024 * 1024];
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        let path = dir.path().join("big.md");
        std::fs::write(&path, &bytes).expect("the fixture file can be written");
        assert_eq!(
            read_bytes(&path).expect("the file is readable").len(),
            bytes.len()
        );
    }

    #[test]
    fn reports_a_missing_file_as_not_found() {
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        let error =
            read_bytes(&dir.path().join("missing.md")).expect_err("the file does not exist");
        assert_eq!(error.kind(), "not-found");
    }

    #[test]
    fn reports_a_folder_as_an_io_error() {
        let dir = tempfile::tempdir().expect("a temp dir can be created");
        assert!(read_bytes(dir.path()).is_err());
    }
}
