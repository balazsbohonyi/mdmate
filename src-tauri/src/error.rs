//! The one error type every command returns.

use serde::{Serialize, Serializer, ser::SerializeStruct};

/// The words for an I/O failure, in a short plain sentence with no code in it. What the page shows
/// after "Could not save a.md:", so it starts in lower case and has no full stop.
///
/// The kind decides first, since it means the same on every OS. A few Windows codes the standard
/// library has no kind for are named by number, and only on Windows, where they mean what is said.
pub(crate) fn friendly_io(error: &std::io::Error) -> String {
    use std::io::ErrorKind as K;
    #[cfg(windows)]
    match error.raw_os_error() {
        Some(32 | 33) => return "another program is using it".into(),
        Some(123 | 161) => return "that name is not valid".into(),
        Some(206) => return "the path is too long".into(),
        _ => {}
    }
    match error.kind() {
        K::NotFound => "the file or folder was not found, it may have been moved or deleted".into(),
        K::PermissionDenied => {
            "permission was denied, the file may be read-only or you may not have access to it"
                .into()
        }
        K::AlreadyExists => "a file or folder with that name already exists".into(),
        K::StorageFull => "the disk is full".into(),
        K::ReadOnlyFilesystem => "the disk is read-only".into(),
        K::ResourceBusy => "another program is using it".into(),
        K::DirectoryNotEmpty => "the folder is not empty".into(),
        K::NotADirectory => "that is a file, not a folder".into(),
        K::IsADirectory => "that is a folder, not a file".into(),
        K::InvalidInput => "that name is not valid".into(),
        K::TimedOut => "the operation timed out".into(),
        _ => plain_text(&error.to_string()),
    }
}

/// `text` without any "(os error N)" the standard library adds to an OS error's message.
pub(crate) fn plain_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(" (os error ") {
        out.push_str(&rest[..at]);
        let after = &rest[at + " (os error ".len()..];
        match after.find(')') {
            Some(end) if after[..end].bytes().all(|b| b.is_ascii_digit()) => {
                rest = &after[end + 1..]
            }
            _ => {
                out.push_str(" (os error ");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AppError {
    #[error("{}", friendly_io(.0))]
    Io(#[from] std::io::Error),
    /// A save to a file the OS marks read-only. The page shows it after "Could not save a.md:".
    #[error("the file is read-only on disk. Use Save As to keep your changes in a new file")]
    FileReadOnly,
    #[error("a background task failed: {0}")]
    Task(String),
    /// The page asked for a path it was never given access to.
    #[error("access to {0} is not allowed")]
    NotAllowed(String),
    /// The request is malformed: a bad frame, bad line endings, a missing header.
    #[error("invalid request: {0}")]
    Invalid(String),
    /// A save for a document the app cannot write back byte for byte.
    #[error("the document is read-only: {0}")]
    ReadOnly(String),
    /// A document id that is not open.
    #[error("no open document has id {0}")]
    NotOpen(u32),
    /// The file on disk is no longer what the document last read or wrote, so a save would
    /// overwrite a change someone else made.
    #[error("the file changed on disk since it was opened or last saved")]
    DiskChanged,
    /// The file watcher could not start.
    #[error("could not watch files: {0}")]
    Watch(String),
    /// The link guard refused a target written in a document. The reason is a stable name.
    #[error("this link may not be followed: {0}")]
    LinkRefused(&'static str),
    /// A file that opens in its default app only after the user says yes.
    #[error("opening {0} needs a confirmation first")]
    NeedsConfirmation(String),
    /// The OS could not hand a target to its app.
    #[error("could not open the link: {0}")]
    Open(String),
    /// A file or folder with that name is already there.
    #[error("{0} already exists")]
    Exists(String),
}

impl AppError {
    /// A stable name the frontend can branch on. The message may change; this does not.
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Io(error) => match error.kind() {
                std::io::ErrorKind::NotFound => "not-found",
                std::io::ErrorKind::PermissionDenied => "permission-denied",
                _ => "io",
            },
            Self::FileReadOnly => "file-read-only",
            Self::Task(_) => "task",
            Self::NotAllowed(_) => "not-allowed",
            Self::Invalid(_) => "invalid",
            Self::ReadOnly(_) => "read-only",
            Self::NotOpen(_) => "not-open",
            Self::DiskChanged => "disk-changed",
            Self::Watch(_) => "watch",
            Self::LinkRefused(_) => "link-refused",
            Self::NeedsConfirmation(_) => "needs-confirmation",
            Self::Open(_) => "open",
            Self::Exists(_) => "exists",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn io_errors_get_stable_kinds() {
        let kind = |k| AppError::from(Error::from(k)).kind();
        assert_eq!(kind(ErrorKind::NotFound), "not-found");
        assert_eq!(kind(ErrorKind::PermissionDenied), "permission-denied");
        assert_eq!(kind(ErrorKind::TimedOut), "io");
        assert_eq!(AppError::Task("x".into()).kind(), "task");
        assert_eq!(AppError::NotAllowed("x".into()).kind(), "not-allowed");
        assert_eq!(AppError::Invalid("x".into()).kind(), "invalid");
        assert_eq!(AppError::ReadOnly("x".into()).kind(), "read-only");
        assert_eq!(AppError::NotOpen(1).kind(), "not-open");
        assert_eq!(AppError::DiskChanged.kind(), "disk-changed");
        assert_eq!(AppError::Watch("x".into()).kind(), "watch");
        assert_eq!(AppError::LinkRefused("scheme").kind(), "link-refused");
        assert_eq!(
            AppError::NeedsConfirmation("x".into()).kind(),
            "needs-confirmation"
        );
        assert_eq!(AppError::Open("x".into()).kind(), "open");
    }

    #[test]
    fn io_errors_are_worded_without_an_os_code() {
        let say = |k| friendly_io(&Error::from(k));
        assert!(say(ErrorKind::PermissionDenied).contains("read-only"));
        assert!(say(ErrorKind::NotFound).contains("not found"));
        assert!(say(ErrorKind::AlreadyExists).contains("already exists"));
        assert_eq!(say(ErrorKind::StorageFull), "the disk is full");
        assert!(say(ErrorKind::ResourceBusy).contains("another program"));
        // A raw code the standard library words itself is cleaned, and one it has a kind for is
        // worded by kind: this is Windows "access denied" (5), as the owner saw it on a save.
        let denied = Error::from_raw_os_error(5);
        let text = AppError::from(denied).to_string();
        assert!(!text.contains("os error"), "{text}");
        assert!(!text.contains('5'), "{text}");
        let text = AppError::from(Error::other("odd (os error 87)")).to_string();
        assert_eq!(text, "odd");
    }

    #[cfg(windows)]
    #[test]
    fn windows_codes_with_no_kind_are_named() {
        let say = |code| friendly_io(&Error::from_raw_os_error(code));
        assert_eq!(say(32), "another program is using it");
        assert_eq!(say(33), "another program is using it");
        assert_eq!(say(123), "that name is not valid");
        assert_eq!(say(206), "the path is too long");
    }

    #[test]
    fn plain_text_drops_only_a_real_os_code() {
        assert_eq!(
            plain_text("Access is denied. (os error 5)"),
            "Access is denied."
        );
        assert_eq!(plain_text("a (os error 2) b (os error 3)"), "a b");
        assert_eq!(
            plain_text("keep (os error x) this"),
            "keep (os error x) this"
        );
        assert_eq!(
            plain_text("keep (os error 12 this"),
            "keep (os error 12 this"
        );
        assert_eq!(plain_text("no code"), "no code");
    }

    #[test]
    fn a_save_to_a_read_only_file_has_its_own_kind_and_words() {
        let error = AppError::FileReadOnly;
        assert_eq!(error.kind(), "file-read-only");
        assert!(error.to_string().contains("Save As"));
        assert!(!error.to_string().contains("error"));
    }

    #[test]
    fn serializes_to_kind_and_message_only() {
        let error = AppError::from(Error::from(ErrorKind::NotFound));
        let value = serde_json::to_value(&error).expect("an AppError always serializes");
        assert_eq!(value["kind"], "not-found");
        assert_eq!(value["message"], error.to_string());
        assert_eq!(value.as_object().map(serde_json::Map::len), Some(2));
    }
}
