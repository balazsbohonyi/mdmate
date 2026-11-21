//! The installed font families, for the font fields in Settings. Shared by every OS: `fontdb` reads
//! the system's font folders on Windows, macOS and Linux alike, so each platform only says it can
//! (`Platform::font_families`), and a platform with no such folders keeps the Unsupported default.

use fontdb::Database;

/// The family names of everything installed, each once, sorted without regard to case, with no
/// empty name. Reading the font folders takes a moment (hundreds of files), so the caller runs this
/// off the UI thread and only when a font field first opens.
pub(crate) fn installed_families() -> Vec<String> {
    let mut database = Database::new();
    database.load_system_fonts();
    families_of(&database)
}

/// The families of the faces in `database`. A face lists its names in several languages; the first
/// is the English one where the font has it, and the only one used, so a font does not show up
/// under every language it is named in.
pub(crate) fn families_of(database: &Database) -> Vec<String> {
    unique_sorted(
        database
            .faces()
            .filter_map(|face| face.families.first().map(|(name, _language)| name.clone())),
    )
}

/// `names` trimmed, with the empty ones dropped, sorted without regard to case, and each name once
/// (two spellings that differ only in case count as one; the first in sorted order is kept).
pub(crate) fn unique_sorted(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut names: Vec<String> = names
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .collect();
    names.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    names.dedup_by(|later, earlier| later.to_lowercase() == earlier.to_lowercase());
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn fonts_are_listed_once_each_sorted_and_without_empty_names() {
        let listed = unique_sorted(owned(&[
            "Segoe UI",
            "arial",
            "Arial",
            "",
            "  ",
            "Cascadia Code",
            "Arial",
            " Consolas ",
        ]));
        assert_eq!(
            listed,
            owned(&["Arial", "Cascadia Code", "Consolas", "Segoe UI"])
        );
    }

    #[test]
    fn fonts_that_differ_only_in_case_count_as_one_and_keep_the_same_spelling_every_time() {
        let one = unique_sorted(owned(&["arial", "Arial"]));
        let two = unique_sorted(owned(&["Arial", "arial"]));
        assert_eq!(one.len(), 1);
        assert_eq!(one, two);
    }

    #[test]
    fn fonts_of_an_empty_database_are_none() {
        assert!(families_of(&Database::new()).is_empty());
    }

    #[test]
    fn fonts_installed_here_are_sorted_unique_and_named() {
        let families = installed_families();
        // A Linux build machine may have no fonts at all; Windows and macOS always have some.
        if cfg!(any(target_os = "windows", target_os = "macos")) {
            assert!(!families.is_empty(), "no font family found on this system");
        }
        assert!(families.iter().all(|name| !name.trim().is_empty()));
        assert_eq!(
            families,
            unique_sorted(families.clone()),
            "sorted and unique"
        );
    }
}
