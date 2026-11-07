//! Read, atomic write, encoding and line-ending detection.

use crate::error::AppError;
use std::path::Path;

/// Reads a whole file as raw bytes: no decoding and no line-ending changes.
pub(crate) fn read_bytes(path: &Path) -> Result<Vec<u8>, AppError> {
    Ok(std::fs::read(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

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
