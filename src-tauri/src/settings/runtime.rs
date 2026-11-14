//! The settings Rust acts on by itself, pushed by the page after it has validated the file.
//!
//! Rust never reads `settings.json`. The page does, with its one validator, and tells Rust the
//! handful of values that guard something Rust does alone: where a pasted image is written, how
//! many recent files are kept, which folders the index skips, and whether the developer tools may
//! open. Every one of those is checked again here, with the same rules (`tests/data/paste-folders.json`
//! holds the cases both sides read), because a path that decides where a file is written is not
//! taken on the page's word.

use crate::error::AppError;
use crate::images::reserved_name;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{PoisonError, RwLock};

/// The folder pasted and copied images go to when the setting is not changed, and the folder of an
/// untitled document's draft, which is not a setting: the choice applies when the document is saved.
pub(crate) const DEFAULT_PASTE_FOLDER: &str = "assets";

/// The most entries either recent list may be told to keep.
pub(crate) const MAX_RECENT: usize = 50;

/// The most names the exclusion list holds, and the longest name.
const MAX_EXCLUDED: usize = 200;
const MAX_NAME: usize = 100;

/// What the page sends: the keys Rust needs, already validated there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Applied {
    pub(crate) paste_folder: String,
    pub(crate) recent_files: usize,
    pub(crate) recent_folders: usize,
    pub(crate) excluded_folders: Vec<String>,
    pub(crate) devtools: bool,
}

/// `Applied` after Rust's own check, with the paste folder in its one spelling.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Checked {
    pub(crate) paste_folder: String,
    pub(crate) recent_files: usize,
    pub(crate) recent_folders: usize,
    pub(crate) excluded_folders: Vec<String>,
    pub(crate) devtools: bool,
}

/// A folder name or a relative path under a document's folder, in its one spelling (`/` between
/// parts), or why it is refused. Parts are letters, digits, `-`, `_` and `.` only, so the link made
/// from it is plain Markdown and a real folder name on every system; the folder is never absolute
/// and never leaves the document's folder.
pub(crate) fn clean_paste_folder(raw: &str) -> Result<String, &'static str> {
    let text = raw.trim().replace('\\', "/");
    if text.is_empty() {
        return Err("Name a folder.");
    }
    if text.chars().count() > MAX_NAME {
        return Err("Use at most 100 characters.");
    }
    let mut chars = text.chars();
    let first = chars.next().unwrap_or_default();
    if first == '/' || first == '~' || (first.is_ascii_alphabetic() && chars.next() == Some(':')) {
        return Err("Use a folder inside the document’s folder, not a full path.");
    }
    let mut parts = Vec::new();
    for part in text.split('/') {
        if part.is_empty() {
            return Err("Leave out empty parts such as // or a trailing /.");
        }
        if part == ".." {
            return Err("The folder cannot leave the document’s folder.");
        }
        if part == "." {
            return Err("Leave out . parts.");
        }
        if !part
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err("Use letters, digits, - _ and . only, so the link stays plain.");
        }
        if part.ends_with('.') {
            return Err("A folder name cannot end with a dot or a space.");
        }
        if reserved_name(part) {
            return Err("That is a name Windows keeps.");
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

/// One name for the exclusion list: a name, not a path.
fn clean_excluded_name(raw: &str) -> Option<String> {
    let text = raw.trim();
    let ok = !text.is_empty()
        && text.chars().count() <= MAX_NAME
        && !text
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control());
    ok.then(|| text.to_owned())
}

/// Checks everything the page sent. The first problem refuses the lot: the page validated these, so
/// a failure here is a page that disagrees with Rust, and nothing half applied is better than that.
pub(crate) fn check(applied: &Applied) -> Result<Checked, AppError> {
    let paste_folder = clean_paste_folder(&applied.paste_folder)
        .map_err(|why| AppError::Invalid(format!("images.pasteFolder: {why}")))?;
    if applied.recent_files > MAX_RECENT || applied.recent_folders > MAX_RECENT {
        return Err(AppError::Invalid(format!(
            "recent: use a number from 0 to {MAX_RECENT}"
        )));
    }
    if applied.excluded_folders.len() > MAX_EXCLUDED {
        return Err(AppError::Invalid(format!(
            "workspace.excludedFolders: use at most {MAX_EXCLUDED} names"
        )));
    }
    let mut excluded: Vec<String> = Vec::new();
    for raw in &applied.excluded_folders {
        let name = clean_excluded_name(raw).ok_or_else(|| {
            AppError::Invalid("workspace.excludedFolders: use a folder name, not a path".into())
        })?;
        if !excluded.iter().any(|seen| seen.eq_ignore_ascii_case(&name)) {
            excluded.push(name);
        }
    }
    Ok(Checked {
        paste_folder,
        recent_files: applied.recent_files,
        recent_folders: applied.recent_folders,
        excluded_folders: excluded,
        devtools: applied.devtools,
    })
}

/// The values in force, read by whatever needs them at the moment it needs them.
#[derive(Debug)]
pub(crate) struct Runtime {
    paste_folder: RwLock<String>,
    devtools: AtomicBool,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            paste_folder: RwLock::new(DEFAULT_PASTE_FOLDER.to_owned()),
            devtools: AtomicBool::new(false),
        }
    }
}

impl Runtime {
    /// Where a pasted or copied image goes, relative to the document's folder.
    pub(crate) fn paste_folder(&self) -> String {
        self.paste_folder
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn set_paste_folder(&self, folder: &str) {
        *self
            .paste_folder
            .write()
            .unwrap_or_else(PoisonError::into_inner) = folder.to_owned();
    }

    /// Whether the developer tools may be opened now.
    pub(crate) fn devtools(&self) -> bool {
        self.devtools.load(Ordering::Relaxed)
    }

    pub(crate) fn set_devtools(&self, on: bool) {
        self.devtools.store(on, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Case {
        input: String,
        folder: Option<String>,
    }

    /// The cases the page's validator reads too: both sides must say the same about each one.
    #[test]
    fn the_paste_folder_rules_are_the_pages_rules() {
        let text = include_str!("../../../tests/data/paste-folders.json");
        let cases: Vec<Case> = serde_json::from_str(text).expect("the shared cases");
        assert!(cases.len() > 20, "the shared cases are not empty");
        for case in cases {
            let got = clean_paste_folder(&case.input).ok();
            assert_eq!(got, case.folder, "{:?}", case.input);
        }
    }

    fn applied() -> Applied {
        Applied {
            paste_folder: "assets".into(),
            recent_files: 10,
            recent_folders: 5,
            excluded_folders: vec!["node_modules".into(), "Target".into(), "target".into()],
            devtools: false,
        }
    }

    #[test]
    fn what_the_page_sends_is_checked_and_a_repeated_name_is_one_name() {
        let checked = check(&applied()).expect("fine");
        assert_eq!(checked.excluded_folders, ["node_modules", "Target"]);
        assert_eq!(checked.paste_folder, "assets");
    }

    #[test]
    fn one_bad_value_refuses_the_lot() {
        for change in [
            |a: &mut Applied| a.paste_folder = "../x".into(),
            |a: &mut Applied| a.paste_folder = "C:/x".into(),
            |a: &mut Applied| a.recent_files = MAX_RECENT + 1,
            |a: &mut Applied| a.recent_folders = 500,
            |a: &mut Applied| a.excluded_folders = vec!["a/b".into()],
            |a: &mut Applied| a.excluded_folders = vec![String::new()],
            |a: &mut Applied| a.excluded_folders = vec!["x".into(); MAX_EXCLUDED + 1],
        ] {
            let mut bad = applied();
            change(&mut bad);
            assert!(check(&bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_runtime_starts_on_the_defaults_and_holds_what_it_is_told() {
        let runtime = Runtime::default();
        assert_eq!(runtime.paste_folder(), "assets");
        assert!(!runtime.devtools());
        runtime.set_paste_folder("media/img");
        runtime.set_devtools(true);
        assert_eq!(runtime.paste_folder(), "media/img");
        assert!(runtime.devtools());
    }
}
