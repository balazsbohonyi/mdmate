//! What kind of file a path is, decided once here so the page never guesses from a name.
//!
//! Markdown opens in the live editor, an image opens in an image tab, and every other file opens
//! as plain source. A file the app cannot decode as text opens read-only through the usual
//! document rules, so there is no sniff here: the extension alone picks the tab.

use serde::Serialize;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum FileKind {
    Markdown,
    /// Anything else, shown as plain source.
    Text,
    Image,
}

impl FileKind {
    /// The name the page knows it by.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Text => "text",
            Self::Image => "image",
        }
    }
}

/// Extensions the app edits as Markdown. The open dialog's first filter lists the same ones, and
/// the page's `isMarkdownName` keeps the same list.
const MARKDOWN: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];

/// Extensions of images the webview can draw. An SVG is drawn through `<img>`, which never runs
/// its scripts.
const IMAGES: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
];

fn is_one_of(path: &Path, list: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| list.iter().any(|name| name.eq_ignore_ascii_case(extension)))
}

/// The kind a file opens as, by its extension.
pub(crate) fn kind_of(path: &Path) -> FileKind {
    if is_one_of(path, MARKDOWN) {
        FileKind::Markdown
    } else if is_one_of(path, IMAGES) {
        FileKind::Image
    } else {
        FileKind::Text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_images_and_everything_else_are_told_apart_whatever_the_case() {
        for name in ["a.md", "A.MD", "b.markdown", "c.mdown", "d.mkd", "e.mdx"] {
            assert_eq!(kind_of(Path::new(name)), FileKind::Markdown, "{name}");
        }
        for name in [
            "a.png", "A.PNG", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.svg", "g.bmp", "h.ico",
            "i.avif",
        ] {
            assert_eq!(kind_of(Path::new(name)), FileKind::Image, "{name}");
        }
        for name in [
            "a.txt",
            "b.rs",
            "noext",
            ".gitignore",
            "c.md.bak",
            "d.pngx",
            "e.exe",
        ] {
            assert_eq!(kind_of(Path::new(name)), FileKind::Text, "{name}");
        }
    }

    #[test]
    fn a_name_that_is_only_an_extension_is_text() {
        // A dotfile has no extension: `.md` is a name, not Markdown.
        assert_eq!(kind_of(Path::new(".md")), FileKind::Text);
        assert_eq!(kind_of(Path::new("dir.png/readme")), FileKind::Text);
    }
}
