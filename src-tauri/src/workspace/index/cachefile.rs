//! The index of one root as a file in the app data folder: paths and metadata, never contents.
//!
//! The file is read whole and checked before anything in it is trusted. It starts with a magic
//! word, the format version, the signature of the exclusion list, and the root it was made for; it
//! ends with a checksum of everything before it. A file with another version, another exclusion
//! list, another root, a failed checksum or a short read gives nothing, and the root is indexed
//! from scratch. Writing goes through a temp file and a rename, so a crash never leaves half a file.

use super::FileEntry;
use crate::fs::atomic;
use crate::fs::exclude;
use crate::fs::kind::FileKind;
use std::path::{Path, PathBuf};
use xxhash_rust::xxh3::xxh3_64;

/// Changes whenever the layout below does.
pub(crate) const VERSION: u32 = 1;

const MAGIC: &[u8; 8] = b"MDMIDX\0\x01";

/// What a good cache file holds.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Cached {
    pub(crate) entries: Vec<FileEntry>,
    /// How many folders the walk that made it entered, which is what a reconcile's percent counts
    /// against.
    pub(crate) folders: u32,
    /// The walk that made it stopped at the cap.
    pub(crate) cut: bool,
}

fn kind_byte(kind: FileKind) -> u8 {
    match kind {
        FileKind::Markdown => 0,
        FileKind::Text => 1,
        FileKind::Image => 2,
    }
}

fn kind_of_byte(byte: u8) -> Option<FileKind> {
    match byte {
        0 => Some(FileKind::Markdown),
        1 => Some(FileKind::Text),
        2 => Some(FileKind::Image),
        _ => None,
    }
}

/// Where the cache of a root lives: one file per root, named by a hash of the root's path.
pub(crate) fn file_for(dir: &Path, root: &str) -> PathBuf {
    let hash = xxh3_64(root.to_lowercase().as_bytes());
    dir.join(format!("index-{hash:016x}.bin"))
}

/// The bytes of a cache file, for a given format version and exclusion-list signature.
pub(crate) fn encode_with(
    version: u32,
    signature: u64,
    root: &str,
    folders: u32,
    cut: bool,
    entries: &[FileEntry],
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(64 + entries.len() * 96);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&version.to_le_bytes());
    bytes.extend_from_slice(&signature.to_le_bytes());
    put_str(&mut bytes, root);
    bytes.extend_from_slice(&folders.to_le_bytes());
    bytes.push(u8::from(cut));
    bytes.extend_from_slice(&(entries.len() as u64).to_le_bytes());
    for entry in entries {
        put_str(&mut bytes, &entry.rel);
        bytes.extend_from_slice(&entry.size.to_le_bytes());
        bytes.extend_from_slice(&entry.modified.to_le_bytes());
        bytes.push(kind_byte(entry.kind));
    }
    let checksum = xxh3_64(&bytes);
    bytes.extend_from_slice(&checksum.to_le_bytes());
    bytes
}

/// The bytes of a cache file for the current format and exclusion list.
pub(crate) fn encode(root: &str, folders: u32, cut: bool, entries: &[FileEntry]) -> Vec<u8> {
    encode_with(VERSION, exclude::signature(), root, folders, cut, entries)
}

fn put_str(bytes: &mut Vec<u8>, text: &str) {
    bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
    bytes.extend_from_slice(text.as_bytes());
}

/// A cursor over the bytes that gives `None` instead of panicking when they run out.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(count)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|slice| slice[0])
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn str(&mut self) -> Option<&'a str> {
        let length = self.u32()? as usize;
        std::str::from_utf8(self.take(length)?).ok()
    }
}

/// Reads a cache file made for `root`. `None` for anything that is not a complete, current file
/// for exactly this root.
pub(crate) fn decode(bytes: &[u8], root: &str) -> Option<Cached> {
    let body_end = bytes.len().checked_sub(8)?;
    let (body, tail) = bytes.split_at(body_end);
    if xxh3_64(body).to_le_bytes() != tail {
        return None;
    }
    let mut reader = Reader { bytes: body, at: 0 };
    if reader.take(MAGIC.len())? != MAGIC {
        return None;
    }
    if reader.u32()? != VERSION || reader.u64()? != exclude::signature() {
        return None;
    }
    if reader.str()? != root {
        return None;
    }
    let folders = reader.u32()?;
    let cut = reader.u8()? == 1;
    let count = usize::try_from(reader.u64()?).ok()?;
    // Every entry is at least 21 bytes, so a count the file cannot hold is a damaged file; this
    // also keeps a flipped length from asking for a huge allocation.
    if count > body.len() / 21 {
        return None;
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let rel = reader.str()?;
        let size = reader.u64()?;
        let modified = reader.i64()?;
        let kind = kind_of_byte(reader.u8()?)?;
        entries.push(FileEntry {
            rel: rel.into(),
            kind,
            size,
            modified,
        });
    }
    (reader.at == body.len()).then_some(Cached {
        entries,
        folders,
        cut,
    })
}

/// Reads and checks the cache file of `root`, if there is a good one.
pub(crate) fn load(dir: &Path, root: &str) -> Option<Cached> {
    decode(&std::fs::read(file_for(dir, root)).ok()?, root)
}

/// Writes the cache file of `root`.
pub(crate) fn save(dir: &Path, root: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    atomic::write_atomic_with(&file_for(dir, root), bytes, |_| Ok(()))
        .map_err(|error| std::io::Error::other(error.to_string()))
}

/// Deletes the cache file of `root`. A file that is not there is fine.
pub(crate) fn delete(dir: &Path, root: &str) {
    let _ = std::fs::remove_file(file_for(dir, root));
}
