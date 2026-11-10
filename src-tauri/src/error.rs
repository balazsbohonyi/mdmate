//! The one error type every command returns.

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub(crate) enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
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
    fn serializes_to_kind_and_message_only() {
        let error = AppError::from(Error::from(ErrorKind::NotFound));
        let value = serde_json::to_value(&error).expect("an AppError always serializes");
        assert_eq!(value["kind"], "not-found");
        assert_eq!(value["message"], error.to_string());
        assert_eq!(value.as_object().map(serde_json::Map::len), Some(2));
    }
}
