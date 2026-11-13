//! Settings and keybinding files.
//!
//! `settings.json` arrives with P8-T1. Until then the one setting the page needs from outside the
//! page, what a rename or move does about links, is read from the environment.

use std::ffi::OsString;

/// Names what a rename or move does about the links that point at the file: `ask`, `update` or
/// `never`. Temporary: P8-T1 reads the same setting from `settings.json` and this variable can go.
pub(crate) const LINKS_ON_RENAME_ENV: &str = "MDMATE_LINKS_ON_RENAME";

/// The value of [`LINKS_ON_RENAME_ENV`] when it is one of the three, spaces and case aside. Anything
/// else, including nothing, is None and the page keeps its default (`never`).
pub(crate) fn links_on_rename(value: Option<OsString>) -> Option<&'static str> {
    let value = value?;
    match value.to_str()?.trim().to_ascii_lowercase().as_str() {
        "ask" => Some("ask"),
        "update" => Some("update"),
        "never" => Some("never"),
        _ => None,
    }
}

/// [`links_on_rename`] with the value read from the environment.
pub(crate) fn links_on_rename_from_env() -> Option<&'static str> {
    links_on_rename(std::env::var_os(LINKS_ON_RENAME_ENV))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(value: &str) -> Option<&'static str> {
        links_on_rename(Some(value.into()))
    }

    #[test]
    fn the_three_values_are_read_whatever_the_case_and_spaces() {
        assert_eq!(read("ask"), Some("ask"));
        assert_eq!(read("UPDATE"), Some("update"));
        assert_eq!(read("  Never \r\n"), Some("never"));
    }

    #[test]
    fn nothing_empty_or_unknown_is_left_to_the_page_default() {
        assert_eq!(links_on_rename(None), None);
        assert_eq!(read(""), None);
        assert_eq!(read("   "), None);
        assert_eq!(read("always"), None);
        assert_eq!(read("true"), None);
        assert_eq!(read("ask update"), None);
    }
}
