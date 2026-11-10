//! Walks a folder for the files to scan and reads each one.
//!
//! Every file counts except what is in a folder called `.git` and what is binary. A folder the
//! tree would hide, or one a search would leave out, is walked all the same: a link to a renamed
//! file can sit anywhere. Links, junctions and mount points are not followed, which also keeps a
//! loop from running forever.

use super::scan::{Link, scan};
use crate::fs::encoding::{self, Decoded, Encoding, Format};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The folder (or file, for a worktree) that is never walked.
const SKIPPED: &str = ".git";

/// How much of a file is read before it is called binary.
const SNIFF: usize = 8192;

/// What reading one file found.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Scan {
    /// A text file mdmate can write back, with the encoding to write it in and its links.
    Links { format: Format, links: Vec<Link> },
    /// A file with a NUL byte that is not UTF-16 text. Not scanned.
    Binary,
    /// Text in an encoding mdmate does not write. It would open read-only, so a rewrite leaves it
    /// alone; the caller reports it.
    Encoding,
}

/// What a walk found besides files.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Walked {
    pub(crate) files: usize,
    /// Links, junctions and mount points that were not followed.
    pub(crate) links_left: usize,
    /// Folders that could not be read.
    pub(crate) unreadable: Vec<PathBuf>,
}

/// Calls `visit` for every file under `root`, depth first. `visit` returns false to stop.
pub(crate) fn walk(root: &Path, mut visit: impl FnMut(&Path) -> bool) -> Walked {
    let mut walked = Walked::default();
    let mut pending = vec![root.to_path_buf()];
    while let Some(folder) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            walked.unreadable.push(folder);
            continue;
        };
        let mut subfolders = Vec::new();
        for entry in entries.flatten() {
            if entry.file_name().eq_ignore_ascii_case(SKIPPED) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                walked.links_left += 1;
            } else if kind.is_dir() {
                subfolders.push(entry.path());
            } else if kind.is_file() {
                walked.files += 1;
                if !visit(&entry.path()) {
                    return walked;
                }
            }
        }
        // Reverse, so the first folder in the listing is the next one walked.
        pending.extend(subfolders.into_iter().rev());
    }
    walked
}

/// Reads a file and scans it. A binary file is recognised from its first bytes, without reading
/// the rest.
#[cfg(test)]
pub(crate) fn scan_file(path: &Path) -> std::io::Result<Scan> {
    Ok(read_unless_binary(path)?.map_or(Scan::Binary, |bytes| scan_bytes(&bytes)))
}

/// The bytes of a file, or `None` when its first bytes say it is binary, in which case the rest is
/// never read.
pub(crate) fn read_unless_binary(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let mut file = File::open(path)?;
    let mut bytes = Vec::new();
    file.by_ref().take(SNIFF as u64).read_to_end(&mut bytes)?;
    if looks_binary(&bytes) {
        return Ok(None);
    }
    file.read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}

/// Scans the bytes of a file.
pub(crate) fn scan_bytes(bytes: &[u8]) -> Scan {
    match encoding::decode(bytes) {
        Decoded::Text { format, text } => {
            // A NUL in text that is not UTF-16 is a binary file that happens to be valid UTF-8.
            if format.encoding == Encoding::Utf8 && bytes.contains(&0) {
                Scan::Binary
            } else {
                Scan::Links {
                    format,
                    links: scan(&text),
                }
            }
        }
        Decoded::Unsupported { .. } if has_utf16_mark(bytes) => Scan::Encoding,
        Decoded::Unsupported { .. } if bytes.contains(&0) => Scan::Binary,
        Decoded::Unsupported { .. } => Scan::Encoding,
    }
}

fn has_utf16_mark(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\xFF\xFE") || bytes.starts_with(b"\xFE\xFF")
}

/// A NUL in the start of a file that carries no UTF-16 mark.
fn looks_binary(head: &[u8]) -> bool {
    head.contains(&0) && !has_utf16_mark(head)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::links::scan::{Edit, apply};
    use std::fs;

    fn put(root: &Path, name: &str, bytes: &[u8]) {
        let path = root.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("a folder can be made");
        }
        fs::write(path, bytes).expect("a file can be written");
    }

    fn visited(root: &Path) -> Vec<String> {
        let mut names = Vec::new();
        walk(root, |path| {
            let relative = path.strip_prefix(root).unwrap_or(path);
            names.push(relative.to_string_lossy().replace('\\', "/"));
            true
        });
        names.sort();
        names
    }

    /// What a rewrite of one file does at this level: decode, point every link at `to`, encode
    /// again in the file's own format.
    fn rewritten(path: &Path, to: &str) -> Option<Vec<u8>> {
        let bytes = fs::read(path).ok()?;
        let Scan::Links { format, links } = scan_bytes(&bytes) else {
            return None;
        };
        let Decoded::Text { text, .. } = encoding::decode(&bytes) else {
            return None;
        };
        let edits: Vec<Edit> = links
            .iter()
            .map(|link| Edit {
                span: link.span.clone(),
                text: link.render(to),
            })
            .collect();
        Some(encoding::encode(&apply(&text, &edits), format))
    }

    #[test]
    fn rewrite_excluded() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        for name in [
            "node_modules/pkg/readme.md",
            ".obsidian/note.md",
            "build/out/x.md",
            ".github/workflows/w.md",
            "kept/a.md",
        ] {
            put(root, name, b"[a](old.md)\n");
        }
        put(root, ".git/config.md", b"[a](old.md)\n");
        put(root, "deep/.git/x.md", b"[a](old.md)\n");
        put(root, "deep/.GIT/y.md", b"[a](old.md)\n");

        let names = visited(root);
        assert_eq!(
            names,
            [
                ".github/workflows/w.md",
                ".obsidian/note.md",
                "build/out/x.md",
                "kept/a.md",
                "node_modules/pkg/readme.md"
            ]
        );
        // The links in the folders a tree would hide are found and rewritten, byte for byte.
        for name in &names {
            assert_eq!(
                rewritten(&root.join(name), "new.md"),
                Some(b"[a](new.md)\n".to_vec()),
                "{name}"
            );
        }
        // And the `.git` ones were not touched.
        assert_eq!(
            fs::read(root.join(".git/config.md")).expect("it is there"),
            b"[a](old.md)\n"
        );
    }

    #[test]
    fn rewrite_text_files() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(
            root,
            "notes.txt",
            b"see [the old one](old.md#top) for more\n",
        );
        put(
            root,
            "page.html",
            b"<p><a href=\"old.md\">x</a> <img src='old.md' alt=y></p>\n",
        );
        put(root, "data.json", b"{\"link\": \"[a](old.md)\"}\n");
        put(root, "README", b"[a]: old.md \"T\"\n");
        let mut changed = std::collections::BTreeMap::new();
        for name in visited(root) {
            let out = rewritten(&root.join(&name), "dir/new.md").expect("it is text");
            changed.insert(name, String::from_utf8(out).expect("still UTF-8"));
        }
        assert_eq!(
            changed["notes.txt"],
            "see [the old one](dir/new.md#top) for more\n"
        );
        assert_eq!(
            changed["page.html"],
            "<p><a href=\"dir/new.md\">x</a> <img src='dir/new.md' alt=y></p>\n"
        );
        assert_eq!(changed["data.json"], "{\"link\": \"[a](dir/new.md)\"}\n");
        assert_eq!(changed["README"], "[a]: dir/new.md \"T\"\n");
    }

    #[test]
    fn an_edit_keeps_crlf_and_a_byte_order_mark_and_changes_only_the_target() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(
            root,
            "crlf.md",
            b"one\r\n[a](old.md#h)\r\n\r\ntwo\n[b](old.md)\r\n",
        );
        put(root, "bom.md", b"\xEF\xBB\xBF[a](old.md)\r\n");
        let crlf = rewritten(&root.join("crlf.md"), "x.md").expect("text");
        assert_eq!(crlf, b"one\r\n[a](x.md#h)\r\n\r\ntwo\n[b](x.md)\r\n");
        let bom = rewritten(&root.join("bom.md"), "x.md").expect("text");
        assert_eq!(bom, b"\xEF\xBB\xBF[a](x.md)\r\n");
    }

    #[test]
    fn a_utf16_file_is_scanned_not_skipped_as_binary() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        for (name, little) in [("le.md", true), ("be.md", false)] {
            let text = "héllo [a](<old é.md#x>)\r\n[b](<old é.md>)\r\n";
            let mut bytes: Vec<u8> = if little {
                vec![0xFF, 0xFE]
            } else {
                vec![0xFE, 0xFF]
            };
            for unit in text.encode_utf16() {
                bytes.extend(if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            put(root, name, &bytes);
            let Scan::Links { format, links } = scan_file(&root.join(name)).expect("readable")
            else {
                panic!("{name} was not scanned");
            };
            assert!(format.bom);
            assert_eq!(links.len(), 2, "{name}");
            let out = rewritten(&root.join(name), "n.md").expect("text");
            let expected = text.replace("old é.md", "n.md");
            let mut want: Vec<u8> = if little {
                vec![0xFF, 0xFE]
            } else {
                vec![0xFE, 0xFF]
            };
            for unit in expected.encode_utf16() {
                want.extend(if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            assert_eq!(out, want, "{name}");
        }
    }

    #[test]
    fn binary_files_and_other_encodings_are_not_scanned_and_say_so() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        // A NUL early on, and a NUL after 8 KiB of text that is otherwise valid UTF-8.
        put(root, "a.bin", b"\x00\x01[a](old.md)\n");
        let mut late = b"[a](old.md)\n".to_vec();
        late.extend(vec![b'x'; 9000]);
        late.push(0);
        put(root, "late.dat", &late);
        // Latin-1 text and UTF-16 without a mark.
        put(root, "latin.txt", b"caf\xE9 [a](old.md)\n");
        put(root, "nomark.md", b"[\0a\0]\0(\0o\0.\0m\0d\0)\0");
        assert_eq!(
            scan_file(&root.join("a.bin")).expect("readable"),
            Scan::Binary
        );
        assert_eq!(
            scan_file(&root.join("late.dat")).expect("readable"),
            Scan::Binary
        );
        assert_eq!(
            scan_file(&root.join("latin.txt")).expect("readable"),
            Scan::Encoding
        );
        assert_eq!(
            scan_file(&root.join("nomark.md")).expect("readable"),
            Scan::Binary
        );
    }

    #[test]
    fn the_walk_stops_when_asked_and_counts_what_it_saw() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        for name in ["a.md", "b.md", "c/d.md"] {
            put(root, name, b"x");
        }
        let mut seen = 0;
        walk(root, |_| {
            seen += 1;
            seen < 2
        });
        assert_eq!(seen, 2);
        let walked = walk(root, |_| true);
        assert_eq!(walked.files, 3);
        assert!(walked.unreadable.is_empty());
        let missing = walk(&root.join("nope"), |_| true);
        assert_eq!(missing.unreadable.len(), 1);
    }

    #[test]
    fn a_folder_link_is_not_followed() {
        let dir = tempfile::tempdir().expect("a temp dir can be made");
        let root = dir.path();
        put(root, "real/x.md", b"[a](old.md)\n");
        let link = root.join("alias");
        // The shell's own tool makes the link, so no code here depends on the OS: a junction on
        // Windows (it needs no privilege, a symbolic link does) and a symbolic link elsewhere.
        let target = root.join("real");
        let made = if std::env::consts::OS == "windows" {
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&target)
                .output()
        } else {
            std::process::Command::new("ln")
                .arg("-s")
                .arg(&target)
                .arg(&link)
                .output()
        }
        .is_ok_and(|out| out.status.success());
        if !made {
            // The machine would not make a link; the gap is listed in untested.md.
            return;
        }
        let mut names = Vec::new();
        let walked = walk(root, |path| {
            names.push(path.to_string_lossy().into_owned());
            true
        });
        assert_eq!(names.len(), 1, "{names:?}");
        assert_eq!(walked.links_left, 1);
    }
}
