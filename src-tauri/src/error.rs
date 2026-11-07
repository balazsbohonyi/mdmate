//! The one error type every command returns.

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub(crate) enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("a background task failed: {0}")]
    Task(String),
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
