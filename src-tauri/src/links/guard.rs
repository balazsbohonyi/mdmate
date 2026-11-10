//! The link guard: the one place that decides what a target written in a document may do.
//!
//! A document is untrusted, so every link target in it is too. The guard works in two steps, and
//! the order is the point:
//!
//! 1. [`classify`] reads the target as text and nothing else. It refuses every scheme except
//!    `http`, `https` and `mailto`, every network path (`\\host\share`, `//host/share`,
//!    `\\?\UNC\...`, `file://host/`, and their percent-encoded spellings), every absolute or
//!    rooted path, and every file type that runs code. No file system call happens here, so a
//!    refused target never makes Windows contact a host.
//! 2. [`resolve`] takes what passed and, for a relative path only, asks the file system where it
//!    leads (through [`FileSystem`], so tests can count the calls). The resolved path is checked
//!    again, since a junction can still point at a share.
//!
//! Only an [`Approved`] value reaches the opener, and only this module can make one.

use std::path::{Path, PathBuf};

/// Why a target was refused. The page shows the reason; the string never changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// Nothing to follow.
    Empty,
    /// A control character, which browsers would strip and so could hide a scheme.
    ControlCharacter,
    /// A scheme other than `http`, `https` and `mailto`, `file:` included.
    Scheme,
    /// A web address that is not well formed, or carries a user name or password.
    BadWebAddress,
    /// A network path, in any spelling.
    Network,
    /// An absolute or rooted path, or a drive letter. Links are relative to the document.
    Absolute,
    /// A name Windows treats specially, or a character no file name may hold.
    BadName,
    /// A file that runs code when opened.
    Executable,
    /// A folder.
    Folder,
    /// A percent escape that is not valid UTF-8.
    BadEscape,
}

impl Refusal {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::ControlCharacter => "control-character",
            Self::Scheme => "scheme",
            Self::BadWebAddress => "bad-web-address",
            Self::Network => "network",
            Self::Absolute => "absolute",
            Self::BadName => "bad-name",
            Self::Executable => "executable",
            Self::Folder => "folder",
            Self::BadEscape => "bad-escape",
        }
    }
}

/// What a target is, from its text alone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Lexical {
    /// `#heading` in the same document. The fragment is percent-decoded.
    Anchor(String),
    /// A web or mail address, normalized: lower-case scheme, unsafe characters percent-encoded.
    Web(String),
    /// A path relative to the document's folder, as plain names and `..` steps.
    Relative {
        steps: Vec<Step>,
        fragment: Option<String>,
    },
}

/// One step of a relative path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Up,
    Name(String),
}

/// What kind of file a path names, from its extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FileKind {
    /// Opens in a tab.
    Markdown,
    /// Opens in its default app with no question.
    Image,
    /// Opens in its default app after the user says yes.
    Other,
}

/// What a target leads to once the file system has been asked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Target {
    Anchor(String),
    Web(Approved),
    File {
        path: PathBuf,
        kind: FileKind,
        fragment: Option<String>,
    },
    /// A relative target that does not exist. The page draws it as broken.
    Missing(PathBuf),
}

/// A target the opener may receive. Only this module constructs one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Approved(String);

impl Approved {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// A file the guard resolved, for its default app. Only [`super`] calls this, with a path that
    /// came out of [`resolve`] as an image or a file the user confirmed.
    pub(super) fn file(path: &Path) -> Self {
        Self(path.to_string_lossy().into_owned())
    }
}

/// The file system calls the guard needs. The real one is [`RealFileSystem`].
pub(crate) trait FileSystem {
    /// The canonical path, with links and `..` resolved. `NotFound` when nothing is there.
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf>;
    fn is_dir(&self, path: &Path) -> bool;
}

#[derive(Debug)]
pub(crate) struct RealFileSystem;

impl FileSystem for RealFileSystem {
    fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
        std::fs::canonicalize(path)
    }
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }
}

/// Extensions that open in a tab.
const MARKDOWN: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];

/// Extensions that open in their default app with no question.
const IMAGES: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "tif", "tiff",
];

/// Extensions refused outright, on every OS: programs, scripts, shortcuts, installers, and
/// containers that Windows mounts or runs. The owner chose refusing over asking (Phase 5
/// decisions), because one confirmation would otherwise run code. SVG is left out of the image
/// list on purpose: its default app is usually a browser, which runs its scripts, so it asks first.
const EXECUTABLE: &[&str] = &[
    // Windows programs and libraries
    "exe",
    "com",
    "scr",
    "pif",
    "cpl",
    "dll",
    "sys",
    "drv",
    "ocx",
    "msc",
    // Windows scripts
    "bat",
    "cmd",
    "ps1",
    "ps1xml",
    "ps2",
    "ps2xml",
    "psc1",
    "psc2",
    "psd1",
    "psm1",
    "vb",
    "vbs",
    "vbe",
    "js",
    "jse",
    "ws",
    "wsf",
    "wsc",
    "wsh",
    "hta",
    "sct",
    "jar",
    // Shortcuts and shell files
    "lnk",
    "url",
    "scf",
    "inf",
    "reg",
    "chm",
    "hlp",
    "appref-ms",
    "application",
    "gadget",
    "settingcontent-ms",
    "library-ms",
    "search-ms",
    "searchconnector-ms",
    "website",
    "xbap",
    "diagcab",
    "theme",
    "themepack",
    // Installers and mountable images
    "msi",
    "msp",
    "mst",
    "msix",
    "msixbundle",
    "appx",
    "appxbundle",
    "iso",
    "img",
    "vhd",
    "vhdx",
    // macOS and Linux
    "app",
    "command",
    "tool",
    "terminal",
    "workflow",
    "pkg",
    "dmg",
    "sh",
    "bash",
    "zsh",
    "csh",
    "run",
    "desktop",
    "appimage",
    "deb",
    "rpm",
];

/// Windows device names, which are special in any folder and with any extension.
const DEVICES: &[&str] = &[
    "con", "prn", "aux", "nul", "conin$", "conout$", "clock$", "com0", "com1", "com2", "com3",
    "com4", "com5", "com6", "com7", "com8", "com9", "com¹", "com²", "com³", "lpt0", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "lpt¹", "lpt²", "lpt³",
];

/// Reads a target as text and decides what it is, with no file system call.
pub(crate) fn classify(href: &str) -> Result<Lexical, Refusal> {
    let mut text = href.trim_matches(|c: char| c == ' ' || c == '\t' || c == '\n' || c == '\r');
    if let Some(inner) = text.strip_prefix('<').and_then(|t| t.strip_suffix('>')) {
        text = inner.trim_matches(' ');
    }
    if text.is_empty() {
        return Err(Refusal::Empty);
    }
    if text.chars().any(char::is_control) {
        return Err(Refusal::ControlCharacter);
    }
    if let Some(fragment) = text.strip_prefix('#') {
        return Ok(Lexical::Anchor(decode(fragment)?));
    }
    if let Some(scheme) = scheme_of(text) {
        // One letter before the colon is a drive (`C:\x`), not a scheme.
        if scheme.len() == 1 {
            return Err(Refusal::Absolute);
        }
        let rest = &text[scheme.len() + 1..];
        return match scheme.to_ascii_lowercase().as_str() {
            "http" | "https" => web(&scheme.to_ascii_lowercase(), rest),
            "mailto" => mail(rest),
            _ => Err(Refusal::Scheme),
        };
    }
    relative(text)
}

/// The scheme at the start of `text`, if it has one: a letter, then letters, digits, `+`, `-` or
/// `.`, then a colon.
fn scheme_of(text: &str) -> Option<&str> {
    let end = text.find(':')?;
    let scheme = &text[..end];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    (first.is_ascii_alphabetic()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then_some(scheme)
}

fn web(scheme: &str, rest: &str) -> Result<Lexical, Refusal> {
    // A backslash is read as a slash by browsers, so `https:\\host` would still be a web link,
    // but it is also how a path to a share looks. Refusing it keeps one spelling.
    if rest.contains('\\') {
        return Err(Refusal::BadWebAddress);
    }
    let Some(after) = rest.strip_prefix("//") else {
        return Err(Refusal::BadWebAddress);
    };
    let authority_end = after.find(['/', '?', '#']).unwrap_or(after.len());
    let authority = &after[..authority_end];
    // A user name or password in a link would be sent to that host, and `trusted.com@evil.com`
    // reads as one host while going to another.
    if authority.is_empty() || authority.contains('@') || authority.starts_with(':') {
        return Err(Refusal::BadWebAddress);
    }
    Ok(Lexical::Web(format!("{scheme}://{}", encode_unsafe(after))))
}

fn mail(rest: &str) -> Result<Lexical, Refusal> {
    if rest.is_empty() || rest.starts_with('/') || rest.contains('\\') {
        return Err(Refusal::BadWebAddress);
    }
    Ok(Lexical::Web(format!("mailto:{}", encode_unsafe(rest))))
}

/// Percent-encodes every character that is not printable ASCII or that a URL may not hold
/// as is, so the opener gets plain ASCII. Existing escapes are kept.
fn encode_unsafe(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_graphic()
            && !matches!(c, '"' | '<' | '>' | '\\' | '^' | '`' | '{' | '|' | '}')
        {
            out.push(c);
        } else {
            let mut buffer = [0; 4];
            for byte in c.encode_utf8(&mut buffer).bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    out
}

fn relative(text: &str) -> Result<Lexical, Refusal> {
    // The fragment is split off before decoding, so `%23` stays part of a file name.
    let (raw_path, raw_fragment) = match text.split_once('#') {
        Some((path, fragment)) => (path, Some(fragment)),
        None => (text, None),
    };
    // Decoded exactly once, before every check, so `%5C%5Chost` is caught as `\\host`.
    let path = decode(raw_path)?;
    if path.chars().any(char::is_control) {
        return Err(Refusal::ControlCharacter);
    }
    if path.starts_with(['/', '\\']) {
        let second = path[1..].chars().next();
        return Err(if matches!(second, Some('/' | '\\')) {
            Refusal::Network
        } else {
            Refusal::Absolute
        });
    }
    // A colon is a drive letter, an alternate data stream, or a scheme hidden by an escape.
    if path.contains(':') {
        return Err(Refusal::Absolute);
    }
    let mut steps = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => steps.push(Step::Up),
            name => {
                check_name(name)?;
                steps.push(Step::Name(name.to_owned()));
            }
        }
    }
    let Some(Step::Name(last)) = steps.last() else {
        // A path made of `..` and `.` names a folder; an empty one with a fragment is an anchor.
        return if steps.is_empty() {
            match raw_fragment {
                Some(fragment) => Ok(Lexical::Anchor(decode(fragment)?)),
                None => Err(Refusal::Empty),
            }
        } else {
            Err(Refusal::Folder)
        };
    };
    if is_executable(last) {
        return Err(Refusal::Executable);
    }
    let fragment = raw_fragment.map(decode).transpose()?;
    Ok(Lexical::Relative { steps, fragment })
}

/// Refuses names Windows treats specially or cannot store, on every OS, so a document behaves the
/// same wherever it is opened.
fn check_name(name: &str) -> Result<(), Refusal> {
    if name.contains(['<', '>', '"', '|', '?', '*']) || name.ends_with(['.', ' ']) {
        return Err(Refusal::BadName);
    }
    if is_device_name(name) {
        return Err(Refusal::BadName);
    }
    Ok(())
}

/// True for a name Windows reads as a device (`con`, `nul.txt`, `COM1`), whatever its extension.
pub(crate) fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    DEVICES.contains(&stem.to_lowercase().as_str())
}

fn extension_of(name: &str) -> Option<String> {
    let (_, extension) = name.rsplit_once('.')?;
    Some(extension.to_lowercase())
}

fn is_executable(name: &str) -> bool {
    extension_of(name).is_some_and(|ext| EXECUTABLE.contains(&ext.as_str()))
}

/// The kind of a file the guard may open, or `None` for one it must refuse.
pub(crate) fn kind_of(path: &Path) -> Option<FileKind> {
    let name = path.file_name()?.to_string_lossy();
    // Windows drops trailing dots and spaces, so `run.bat.` would run `run.bat`.
    let name = name.trim_end_matches(['.', ' ']);
    if is_executable(name) {
        return None;
    }
    Some(match extension_of(name) {
        Some(ext) if MARKDOWN.contains(&ext.as_str()) => FileKind::Markdown,
        Some(ext) if IMAGES.contains(&ext.as_str()) => FileKind::Image,
        _ => FileKind::Other,
    })
}

/// Decodes `%XX` escapes once. A `%` with no two hex digits after it stays as it is; bytes that
/// are not UTF-8 are refused.
fn decode(text: &str) -> Result<String, Refusal> {
    if !text.contains('%') {
        return Ok(text.to_owned());
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'%'
            && let (Some(high), Some(low)) = (
                bytes.get(index + 1).and_then(|b| hex(*b)),
                bytes.get(index + 2).and_then(|b| hex(*b)),
            )
        {
            out.push(high * 16 + low);
            index += 3;
        } else {
            out.push(byte);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| Refusal::BadEscape)
}

fn hex(byte: u8) -> Option<u8> {
    char::from(byte)
        .to_digit(16)
        .and_then(|digit| u8::try_from(digit).ok())
}

/// True for any spelling of a network path once a path is resolved.
pub(crate) fn is_network(path: &Path) -> bool {
    let text = path.to_string_lossy();
    if text.starts_with(r"\\?\UNC\") || text.starts_with(r"\\.\UNC\") {
        return true;
    }
    if text.starts_with(r"\\?\") || text.starts_with(r"\\.\") {
        return false;
    }
    text.starts_with(r"\\") || text.starts_with("//")
}

/// Finds where a classified target leads. `folder` is the folder of the document the link is in,
/// already resolved and never a network path. Only a relative target touches the file system.
pub(crate) fn resolve(
    lexical: Lexical,
    folder: &Path,
    fs: &impl FileSystem,
) -> Result<Target, Refusal> {
    let (steps, fragment) = match lexical {
        Lexical::Anchor(fragment) => return Ok(Target::Anchor(fragment)),
        Lexical::Web(url) => return Ok(Target::Web(Approved(url))),
        Lexical::Relative { steps, fragment } => (steps, fragment),
    };
    if is_network(folder) {
        return Err(Refusal::Network);
    }
    // Built step by step from plain names, never with `Path::join` on the target text: a rooted
    // or network argument to `join` would replace the folder.
    let mut path = folder.to_path_buf();
    for step in steps {
        match step {
            Step::Up => {
                path.pop();
            }
            Step::Name(name) => path.push(name),
        }
    }
    let canonical = match fs.canonicalize(&path) {
        Ok(canonical) => canonical,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Target::Missing(path));
        }
        // A path the system cannot read is treated like one that is not there.
        Err(_) => return Ok(Target::Missing(path)),
    };
    // A junction or symlink can still lead to a share.
    if is_network(&canonical) {
        return Err(Refusal::Network);
    }
    if fs.is_dir(&canonical) {
        return Err(Refusal::Folder);
    }
    let kind = kind_of(&canonical).ok_or(Refusal::Executable)?;
    Ok(Target::File {
        path: canonical,
        kind,
        fragment,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::Cell;

    /// A file system that counts every call and answers from a list of existing files.
    #[derive(Default)]
    pub(crate) struct CountingFs {
        pub(crate) calls: Cell<usize>,
        pub(crate) files: Vec<PathBuf>,
        pub(crate) dirs: Vec<PathBuf>,
        /// What canonicalize maps a path to, for links that lead elsewhere.
        pub(crate) redirects: Vec<(PathBuf, PathBuf)>,
    }

    impl FileSystem for CountingFs {
        fn canonicalize(&self, path: &Path) -> std::io::Result<PathBuf> {
            self.calls.set(self.calls.get() + 1);
            if let Some((_, to)) = self.redirects.iter().find(|(from, _)| from == path) {
                return Ok(to.clone());
            }
            if self.files.iter().chain(&self.dirs).any(|p| p == path) {
                Ok(path.to_path_buf())
            } else {
                Err(std::io::Error::from(std::io::ErrorKind::NotFound))
            }
        }
        fn is_dir(&self, path: &Path) -> bool {
            self.calls.set(self.calls.get() + 1);
            self.dirs.iter().any(|p| p == path)
        }
    }

    /// An absolute local folder on any OS. The file system in these tests is a fake, so nothing
    /// in it is ever read.
    pub(crate) fn folder() -> PathBuf {
        std::env::temp_dir().join("docs").join("notes")
    }

    /// Every spelling of a network or rooted path the guard must refuse without touching the disk:
    /// the plan's table, every UNC form in `tests/fixtures/hostile.md`, and their neighbours.
    const PATH_TABLE: &[&str] = &[
        // The plan's four
        r"\\host\share",
        "//host/share",
        r"\\?\UNC\host\share",
        "%5C%5Chost",
        // hostile.md
        r"\\host.invalid\share\a.png",
        "//host.invalid/share/a.png",
        "file://host.invalid/share/a.png",
        "file:////host.invalid/share/a.png",
        r"<\\host.invalid\share\with space.png>",
        r"\\host.invalid\share\b.png",
        r"search-ms:query=hostile&crumb=location:\\host.invalid\share",
        // Neighbours
        "%5c%5chost",
        "%5C%5Chost%5Cshare%5Ca.md",
        "%2F%2Fhost/share",
        "%2f%2fhost",
        "%5C/host",
        r"\/host/share",
        r"/\host\share",
        r"\\.\UNC\host\share",
        r"\\.\C:\x.md",
        r"\\?\C:\x.md",
        r"\\?\UNC\host\share\a.md",
        "//?/UNC/host/share",
        "file://host/share/a.md",
        "FILE://host/share",
        "file:///C:/x.md",
        "file:/C:/x.md",
        "file:x.md",
        r"C:\x.md",
        "C:/x.md",
        "c:x.md",
        "C%3A/x.md",
        "/etc/passwd",
        r"\Windows\x.md",
        "%2Fetc/passwd",
        "  \\\\host\\share  ",
        "\\\\host\\share#frag",
        "a.md:stream",
        "a.md%3Astream",
        "https:\\\\host\\share",
        "http:host/share",
        "http:/host/share",
        "https:///share",
        "smb://host/share",
        "cifs://host/share",
        "nfs://host/share",
        "webdav://host/share",
        "dav://host/share",
        "ftp://host/share",
    ];

    #[test]
    fn unc_refused_for_every_spelling_before_any_file_system_call() {
        for &target in PATH_TABLE {
            let fs = CountingFs::default();
            let outcome = classify(target).and_then(|lexical| resolve(lexical, &folder(), &fs));
            assert!(
                outcome.is_err(),
                "{target:?} must be refused, got {outcome:?}"
            );
            assert_eq!(fs.calls.get(), 0, "{target:?} touched the file system");
        }
    }

    #[test]
    fn unc_refused_names_the_network_for_the_plain_spellings() {
        for target in [
            r"\\host\share",
            "//host/share",
            r"\\?\UNC\host\share",
            "%5C%5Chost",
            "%2F%2Fhost",
            r"\/host",
            r"/\host",
        ] {
            assert_eq!(classify(target), Err(Refusal::Network), "{target:?}");
        }
    }

    #[test]
    fn unc_refused_when_a_resolved_link_leads_to_a_share() {
        // A junction in the document's folder that points at a share.
        let link = folder().join("share.md");
        let fs = CountingFs {
            redirects: vec![(link, PathBuf::from(r"\\?\UNC\host\share\a.md"))],
            ..CountingFs::default()
        };
        let lexical = classify("share.md").expect("a plain name passes the text check");
        assert_eq!(resolve(lexical, &folder(), &fs), Err(Refusal::Network));
    }

    #[test]
    fn unc_refused_for_a_document_whose_own_folder_is_a_share() {
        let fs = CountingFs::default();
        let lexical = classify("a.md").expect("passes");
        let share = PathBuf::from(r"\\host\share");
        assert_eq!(resolve(lexical, &share, &fs), Err(Refusal::Network));
        assert_eq!(fs.calls.get(), 0);
    }

    #[test]
    fn unc_refused_by_is_network_in_every_resolved_form() {
        for path in [
            r"\\host\share\a.md",
            r"\\?\UNC\host\share\a.md",
            r"\\.\UNC\host\share\a.md",
            "//host/share/a.md",
        ] {
            assert!(is_network(Path::new(path)), "{path}");
        }
        for path in [r"\\?\C:\docs\a.md", r"C:\docs\a.md", "/docs/a.md"] {
            assert!(!is_network(Path::new(path)), "{path}");
        }
    }

    /// The small seeded generator used across the crate's property tests, so a failure replays.
    pub(crate) struct Lcg(pub(crate) u64);
    impl Lcg {
        pub(crate) fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }
        pub(crate) fn below(&mut self, n: usize) -> usize {
            usize::try_from(self.next()).unwrap_or(0) % n
        }
        pub(crate) fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
            items[self.below(items.len())]
        }
    }

    #[test]
    fn unc_refused_property_random_prefixes_and_escapes_never_reach_the_disk() {
        // Builds two separators from every spelling (raw, either escape case) and a host, with
        // noise around them; no result may touch the file system, and none may be a file.
        let separators = ["/", "\\", "%2F", "%2f", "%5C", "%5c"];
        let noise = ["", " ", "<", "./", "?/", "?\\", "UNC/", "UNC\\"];
        let mut rng = Lcg(0x5EED_0017);
        for _ in 0..5000 {
            let mut target = String::new();
            if rng.below(4) == 0 {
                target.push_str(rng.pick(&["file:", "FILE:", "file://", "File:///"]));
            }
            target.push_str(rng.pick(&separators));
            target.push_str(rng.pick(&separators));
            target.push_str(rng.pick(&noise));
            target.push_str(rng.pick(&["host", "host.invalid", "127.0.0.1", "?", "."]));
            target.push_str(rng.pick(&separators));
            target.push_str(rng.pick(&["share", "share/a.md", "c$", "a.png"]));
            let fs = CountingFs::default();
            let outcome = classify(&target).and_then(|lexical| resolve(lexical, &folder(), &fs));
            assert!(outcome.is_err(), "{target:?} gave {outcome:?}");
            assert_eq!(fs.calls.get(), 0, "{target:?} touched the file system");
        }
    }

    #[test]
    fn relative_targets_are_built_from_the_document_folder() {
        let target = folder().join("sub").join("b.md");
        let fs = CountingFs {
            files: vec![target.clone()],
            ..CountingFs::default()
        };
        let lexical = classify("sub/b.md#Intro").expect("passes");
        assert_eq!(
            resolve(lexical, &folder(), &fs),
            Ok(Target::File {
                path: target,
                kind: FileKind::Markdown,
                fragment: Some("Intro".into())
            })
        );
    }

    #[test]
    fn parent_steps_are_allowed_and_never_join_a_rooted_string() {
        let up = folder().parent().expect("has a parent").join("other.md");
        let fs = CountingFs {
            files: vec![up.clone()],
            ..CountingFs::default()
        };
        let outcome = classify(r"..\other.md").and_then(|l| resolve(l, &folder(), &fs));
        assert!(matches!(outcome, Ok(Target::File { path, .. }) if path == up));
    }

    #[test]
    fn a_missing_target_is_reported_as_missing() {
        let fs = CountingFs::default();
        let outcome = classify("gone.md").and_then(|l| resolve(l, &folder(), &fs));
        assert_eq!(outcome, Ok(Target::Missing(folder().join("gone.md"))));
    }

    #[test]
    fn anchors_and_empty_paths() {
        assert_eq!(classify("#Intro"), Ok(Lexical::Anchor("Intro".into())));
        assert_eq!(classify("#caf%C3%A9"), Ok(Lexical::Anchor("café".into())));
        assert_eq!(classify("./#x"), Ok(Lexical::Anchor("x".into())));
        assert_eq!(classify(""), Err(Refusal::Empty));
        assert_eq!(classify("   "), Err(Refusal::Empty));
        assert_eq!(classify(".."), Err(Refusal::Folder));
        assert_eq!(classify("%FF.md"), Err(Refusal::BadEscape));
        assert_eq!(
            classify("a%23b.md"),
            Ok(Lexical::Relative {
                steps: vec![Step::Name("a#b.md".into())],
                fragment: None
            })
        );
    }

    #[test]
    fn control_characters_are_refused_by_name_wherever_they_sit() {
        // Browsers strip tabs and newlines, so `java\tscript:` is `javascript:` to them. Other
        // checks also refuse these, but the reason must say what is wrong.
        for target in [
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "https://exa\u{0}mple.com",
            "https://example.com/\u{7f}",
            "a\u{1}.md",
            "a%0A.md",
            "a%00.md",
        ] {
            assert_eq!(
                classify(target),
                Err(Refusal::ControlCharacter),
                "{target:?}"
            );
        }
    }

    #[test]
    fn device_names_and_forbidden_characters_are_refused() {
        for target in [
            "NUL.md",
            "con",
            "aux.png",
            "com1.txt",
            "LPT9.md",
            "conin$",
            "sub/nul/a.md",
            "a*.md",
            "a?.md",
            "a|b.md",
            "a\".md",
            "a.md.",
            "sub /a.md",
            "dir./a.md",
        ] {
            assert!(
                matches!(classify(target), Err(Refusal::BadName | Refusal::Empty)),
                "{target:?} gave {:?}",
                classify(target)
            );
        }
    }
}
