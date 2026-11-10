//! Link guard, scan and rewrite.
//!
//! The page hands over a document id and the target as it is written in the text. Rust rebuilds
//! everything from those two: the folder comes from its own record of the document, and the guard
//! ([`guard`]) decides what the target may do. The page never names a path or a URL to open.

pub(crate) mod guard;
// The scanner, the walker and the rewrite engine are called by the commands P6-T6 adds; until then
// only tests do.
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "P6-T6 wires the commands that call it")
)]
pub(crate) mod rewrite;
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "P6-T6 wires the commands that call it")
)]
pub(crate) mod scan;
#[cfg_attr(
    not(test),
    expect(dead_code, reason = "P6-T6 wires the commands that call it")
)]
pub(crate) mod walk;

use crate::access::display_path;
use crate::error::AppError;
use guard::{Approved, FileKind, FileSystem, Target};
use serde::Serialize;
use std::path::Path;

/// Hands an approved target to the OS. The real one goes through the platform layer.
pub(crate) trait Opener {
    fn open(&self, target: &Approved) -> Result<(), AppError>;
}

/// The real opener: the platform layer's `open_external`.
#[derive(Debug)]
pub(crate) struct PlatformOpener;

impl Opener for PlatformOpener {
    fn open(&self, target: &Approved) -> Result<(), AppError> {
        use crate::platform::Platform as _;
        crate::platform::current()
            .open_external(target.as_str())
            .map_err(|error| AppError::Open(error.to_string()))
    }
}

/// What a link leads to, for the page to style or describe it. Nothing is opened or granted.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum LinkInfo {
    Anchor {
        fragment: String,
    },
    Web {
        url: String,
    },
    Markdown {
        path: String,
        fragment: Option<String>,
    },
    Image {
        path: String,
    },
    /// Opens in its default app after the user says yes.
    File {
        path: String,
    },
    Missing {
        path: String,
    },
    Refused {
        reason: &'static str,
    },
}

/// What following a link did.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Followed {
    /// A heading in the same document; the page moves the caret.
    Anchor { fragment: String },
    /// Handed to the browser, the mail app or a file's default app.
    Opened,
    /// A Markdown file Rust has now let the page open, by this path.
    Document {
        path: String,
        fragment: Option<String>,
    },
}

fn target_of(href: &str, folder: &Path, fs: &impl FileSystem) -> Result<Target, guard::Refusal> {
    guard::classify(href).and_then(|lexical| guard::resolve(lexical, folder, fs))
}

/// Describes where `href`, written in a document in `folder`, leads.
pub(crate) fn describe(href: &str, folder: &Path, fs: &impl FileSystem) -> LinkInfo {
    match target_of(href, folder, fs) {
        Err(refusal) => LinkInfo::Refused {
            reason: refusal.as_str(),
        },
        Ok(Target::Anchor(fragment)) => LinkInfo::Anchor { fragment },
        Ok(Target::Web(url)) => LinkInfo::Web {
            url: url.as_str().to_owned(),
        },
        Ok(Target::Missing(path)) => LinkInfo::Missing {
            path: display_path(&path),
        },
        Ok(Target::File {
            path,
            kind,
            fragment,
        }) => {
            let path = display_path(&path);
            match kind {
                FileKind::Markdown => LinkInfo::Markdown { path, fragment },
                FileKind::Image => LinkInfo::Image { path },
                FileKind::Other => LinkInfo::File { path },
            }
        }
    }
}

/// The most targets one [`missing`] call checks, so one request stays a short piece of work.
pub(crate) const CHECK_LIMIT: usize = 500;

/// For each target, whether it is a relative path to a file that is not there. Refused, web and
/// anchor targets are not missing: the guard has its own answer for those.
pub(crate) fn missing(hrefs: &[String], folder: &Path, fs: &impl FileSystem) -> Vec<bool> {
    hrefs
        .iter()
        .map(|href| matches!(target_of(href, folder, fs), Ok(Target::Missing(_))))
        .collect()
}

/// Follows `href`, written in a document in `folder`. Web and mail links and images open at once;
/// another file opens in its default app only when `confirmed`; a Markdown file is granted through
/// `grant` (which returns the path the page may open it by) and never opened outside the app.
pub(crate) fn follow(
    href: &str,
    folder: &Path,
    confirmed: bool,
    fs: &impl FileSystem,
    opener: &impl Opener,
    grant: impl FnOnce(&Path) -> Result<String, AppError>,
) -> Result<Followed, AppError> {
    match target_of(href, folder, fs).map_err(|refusal| AppError::LinkRefused(refusal.as_str()))? {
        Target::Anchor(fragment) => Ok(Followed::Anchor { fragment }),
        Target::Web(url) => {
            opener.open(&url)?;
            Ok(Followed::Opened)
        }
        Target::Missing(path) => Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            display_path(&path),
        ))),
        Target::File {
            path,
            kind,
            fragment,
        } => match kind {
            FileKind::Markdown => Ok(Followed::Document {
                path: grant(&path)?,
                fragment,
            }),
            FileKind::Other if !confirmed => Err(AppError::NeedsConfirmation(display_path(&path))),
            FileKind::Image | FileKind::Other => {
                // The OS gets the plain spelling: some handlers cannot read `\\?\` paths.
                opener.open(&Approved::file(Path::new(&display_path(&path))))?;
                Ok(Followed::Opened)
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::guard::tests::{CountingFs, Lcg, folder};
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    #[derive(Default)]
    struct RecordingOpener {
        opened: RefCell<Vec<String>>,
    }

    impl Opener for RecordingOpener {
        fn open(&self, target: &Approved) -> Result<(), AppError> {
            self.opened.borrow_mut().push(target.as_str().to_owned());
            Ok(())
        }
    }

    fn no_grant(_: &Path) -> Result<String, AppError> {
        panic!("nothing in this test may be granted")
    }

    fn is_allowed_web(target: &str) -> bool {
        target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("mailto:")
    }

    /// Every scheme in `tests/fixtures/hostile.md`, and others Windows hands to a handler.
    const HOSTILE: &[&str] = &[
        "ms-msdt:/id/TestOnly",
        r"search-ms:query=hostile&crumb=location:\\host.invalid\share",
        "javascript:alert(1)",
        "vbscript:msgbox(1)",
        "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        "file:///C:/Windows/System32/calc.exe",
        "JaVaScRiPt:alert(1)",
        " javascript:alert(1)",
        "java\tscript:alert(1)",
        "java\nscript:alert(1)",
        "javascript%3Aalert(1)",
        "ms-settings:",
        "ms-excel:ofe|u|https://example.invalid/a.xlsx",
        "shell:startup",
        "mk:@MSITStore:C:\\x.chm::/a.htm",
        "its:C:\\x.chm::/a.htm",
        "res://ieframe.dll/",
        "about:blank",
        "ftp://example.invalid/",
        "smb://host.invalid/share",
        "tel:123",
        "steam://run/1",
        "x-apple.systempreferences:",
        "https:\\\\example.com",
        "http:example.com",
        "https://user:pass@example.com/",
        "https://example.com@evil.invalid/",
        "mailto://x",
        "mailto:",
    ];

    #[test]
    fn opener_schemes_hostile_table_never_reaches_the_opener() {
        for &href in HOSTILE {
            let opener = RecordingOpener::default();
            let fs = CountingFs::default();
            let outcome = follow(href, &folder(), true, &fs, &opener, no_grant);
            assert!(outcome.is_err(), "{href:?} gave {outcome:?}");
            assert!(opener.opened.borrow().is_empty(), "{href:?} was opened");
        }
    }

    #[test]
    fn opener_schemes_allows_the_three_in_any_case() {
        for (href, expected) in [
            ("https://example.com/a b", "https://example.com/a%20b"),
            ("HTTP://example.com", "http://example.com"),
            ("hTtPs://example.com/é", "https://example.com/%C3%A9"),
            ("MailTo:a@example.com", "mailto:a@example.com"),
            ("<https://example.com/x>", "https://example.com/x"),
            ("  https://example.com  ", "https://example.com"),
        ] {
            let opener = RecordingOpener::default();
            let outcome = follow(
                href,
                &folder(),
                false,
                &CountingFs::default(),
                &opener,
                no_grant,
            );
            assert_eq!(outcome.ok(), Some(Followed::Opened), "{href:?}");
            assert_eq!(*opener.opened.borrow(), [expected], "{href:?}");
        }
    }

    #[test]
    fn opener_schemes_property_only_three_schemes_ever_reach_the_opener() {
        let schemes = [
            "http",
            "https",
            "mailto",
            "HTTP",
            "Https",
            "MAILTO",
            "javascript",
            "vbscript",
            "data",
            "file",
            "ms-msdt",
            "search-ms",
            "ms-settings",
            "shell",
            "about",
            "ftp",
            "smb",
            "tel",
            "sms",
            "steam",
            "zoommtg",
            "ms-word",
            "jar",
            "view-source",
            "blob",
            "x",
            "c",
            "a+b",
            "https.evil",
            "http-x",
            "mailto2",
            "hxxp",
            "ht",
            "httpss",
        ];
        let separators = [
            "://", ":", ":\\\\", ":/", "%3A//", ": //", "://\t", "\u{0}://",
        ];
        let noise = [
            "", " ", "\t", "\n", "\u{1}", "\u{7f}", "%20", "<", "\u{feff}",
        ];
        let rests = [
            "example.com/",
            "host.invalid/share",
            "@evil.invalid",
            "user@example.com",
            "a@b.c",
            "",
            "/x",
            "\\\\host\\share",
            "%5C%5Chost",
            "example.com/a b é",
        ];
        let mut rng = Lcg(0x5EED_0016);
        let (mut reached, mut runs) = (0, 0);
        for _ in 0..20_000 {
            runs += 1;
            let mut scheme = rng.pick(&schemes).to_owned();
            // Sometimes hide noise inside the scheme itself.
            if rng.below(5) == 0 && scheme.len() > 1 {
                let at = rng.below(scheme.len() - 1) + 1;
                scheme.insert_str(at, rng.pick(&noise));
            }
            let href = format!(
                "{}{}{}{}",
                rng.pick(&noise),
                scheme,
                rng.pick(&separators),
                rng.pick(&rests)
            );
            let opener = RecordingOpener::default();
            let fs = CountingFs::default();
            let _ = follow(&href, &folder(), true, &fs, &opener, |_| Ok(String::new()));
            for target in opener.opened.borrow().iter() {
                reached += 1;
                assert!(is_allowed_web(target), "{href:?} opened {target:?}");
                assert!(
                    target.bytes().all(|b| b.is_ascii_graphic()),
                    "{href:?} opened {target:?}, which is not plain ASCII"
                );
                assert!(!target.contains('\\'), "{href:?} opened {target:?}");
            }
        }
        // The check must be able to fail: plenty of runs did reach the opener.
        assert!(
            reached >= 100,
            "only {reached} of {runs} runs reached the opener"
        );
    }

    fn files_fs(names: &[&str]) -> CountingFs {
        CountingFs {
            files: names.iter().map(|name| folder().join(name)).collect(),
            ..CountingFs::default()
        }
    }

    #[test]
    fn default_app_policy_by_file_type() {
        // Markdown opens in a tab and images open with no question; everything else asks.
        let asks = [
            "a.pdf", "a.txt", "a.docx", "a.svg", "a.html", "README", "a.PDF", "a.zip",
        ];
        let opens = ["a.png", "a.JPG", "a.gif", "a.webp"];
        let refused = [
            "a.exe",
            "a.EXE",
            "installer.lnk",
            "payload.hta",
            "run.bat",
            "a.cmd",
            "a.ps1",
            "a.vbs",
            "a.js",
            "a.msi",
            "a.scr",
            "a.reg",
            "a.url",
            "a.jar",
            "a.iso",
            "a.app",
            "a.sh",
        ];
        let mut all: Vec<&str> = vec!["a.md", "a.markdown"];
        all.extend(asks.iter().chain(&opens).chain(&refused));
        let fs = files_fs(&all);

        for name in ["a.md", "a.markdown"] {
            let opener = RecordingOpener::default();
            let granted = RefCell::new(None);
            let outcome = follow(name, &folder(), false, &fs, &opener, |path| {
                *granted.borrow_mut() = Some(path.to_path_buf());
                Ok("granted".into())
            });
            assert_eq!(
                outcome.ok(),
                Some(Followed::Document {
                    path: "granted".into(),
                    fragment: None
                }),
                "{name}"
            );
            assert_eq!(*granted.borrow(), Some(folder().join(name)));
            assert!(
                opener.opened.borrow().is_empty(),
                "{name} must never open outside the app"
            );
        }
        for name in opens {
            let opener = RecordingOpener::default();
            assert_eq!(
                follow(name, &folder(), false, &fs, &opener, no_grant).ok(),
                Some(Followed::Opened),
                "{name}"
            );
            assert_eq!(opener.opened.borrow().len(), 1, "{name}");
        }
        for name in asks {
            let opener = RecordingOpener::default();
            let first = follow(name, &folder(), false, &fs, &opener, no_grant);
            assert!(
                matches!(first, Err(AppError::NeedsConfirmation(_))),
                "{name} must ask first, got {first:?}"
            );
            assert!(
                opener.opened.borrow().is_empty(),
                "{name} opened before the answer"
            );
            assert_eq!(
                follow(name, &folder(), true, &fs, &opener, no_grant).ok(),
                Some(Followed::Opened),
                "{name}"
            );
            assert_eq!(opener.opened.borrow().len(), 1, "{name}");
        }
        for name in refused {
            let opener = RecordingOpener::default();
            let outcome = follow(name, &folder(), true, &fs, &opener, no_grant);
            assert!(
                matches!(outcome, Err(AppError::LinkRefused("executable"))),
                "{name} gave {outcome:?}"
            );
            assert!(opener.opened.borrow().is_empty(), "{name} was opened");
        }
    }

    #[test]
    fn default_app_policy_reads_the_resolved_name_not_the_written_one() {
        // A link written as a PDF that resolves to a program is refused, even when confirmed.
        let written = folder().join("doc.pdf");
        let fs = CountingFs {
            redirects: vec![(written, PathBuf::from(r"C:\Windows\System32\calc.exe"))],
            ..CountingFs::default()
        };
        let opener = RecordingOpener::default();
        let outcome = follow("doc.pdf", &folder(), true, &fs, &opener, no_grant);
        assert!(
            matches!(outcome, Err(AppError::LinkRefused("executable"))),
            "{outcome:?}"
        );
        // Windows drops trailing dots, so a resolved `run.bat.` would run `run.bat`.
        assert_eq!(guard::kind_of(Path::new("run.bat.")), None);
        assert_eq!(guard::kind_of(Path::new("run.bat . ")), None);
        assert!(opener.opened.borrow().is_empty());
    }

    #[test]
    fn default_app_policy_refuses_the_hostile_fixture_links() {
        let fs = files_fs(&["installer.lnk", "payload.hta", "run.bat"]);
        for href in [
            "installer.lnk",
            "payload.hta",
            "run.bat",
            r"..\..\Windows\System32\calc.exe",
            "file:///C:/Windows/System32/calc.exe",
        ] {
            let opener = RecordingOpener::default();
            let outcome = follow(href, &folder(), true, &fs, &opener, no_grant);
            assert!(
                matches!(outcome, Err(AppError::LinkRefused(_))),
                "{href} gave {outcome:?}"
            );
            assert!(opener.opened.borrow().is_empty(), "{href}");
            // The name alone settles it, so the disk is never asked.
            assert_eq!(fs.calls.get(), 0, "{href} touched the file system");
        }
    }

    #[test]
    fn missing_marks_only_relative_targets_that_are_not_there() {
        let fs = files_fs(&["a.md", "sub/b.md", "a.png"]);
        let hrefs: Vec<String> = [
            "a.md",
            "sub/b.md#x",
            "a.png",
            "gone.md",
            "sub/gone.md#x",
            "#nowhere",
            "https://example.invalid/missing",
            r"\\host\share\gone.md",
            "javascript:x",
        ]
        .iter()
        .map(|href| (*href).to_owned())
        .collect();
        assert_eq!(
            missing(&hrefs, &folder(), &fs),
            [false, false, false, true, true, false, false, false, false]
        );
    }

    #[test]
    fn describe_reports_each_kind_without_opening_or_granting() {
        let fs = files_fs(&["a.md", "a.png", "a.pdf"]);
        let path = |name: &str| display_path(&folder().join(name));
        assert_eq!(
            describe("a.md#x", &folder(), &fs),
            LinkInfo::Markdown {
                path: path("a.md"),
                fragment: Some("x".into())
            }
        );
        assert_eq!(
            describe("a.png", &folder(), &fs),
            LinkInfo::Image {
                path: path("a.png")
            }
        );
        assert_eq!(
            describe("a.pdf", &folder(), &fs),
            LinkInfo::File {
                path: path("a.pdf")
            }
        );
        assert_eq!(
            describe("b.md", &folder(), &fs),
            LinkInfo::Missing { path: path("b.md") }
        );
        assert_eq!(
            describe("#Top", &folder(), &fs),
            LinkInfo::Anchor {
                fragment: "Top".into()
            }
        );
        assert_eq!(
            describe("https://example.com", &folder(), &fs),
            LinkInfo::Web {
                url: "https://example.com".into()
            }
        );
        assert_eq!(
            describe(r"\\host\share", &folder(), &fs),
            LinkInfo::Refused { reason: "network" }
        );
    }
}
