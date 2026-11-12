//! "files to include" and "files to exclude" for folder search.
//!
//! The two fields take what VS Code's Search view takes: globs, not regular expressions, separated
//! by commas (a comma inside `{}` or `[]` does not split).
//!
//! - `*` matches within one path segment, `?` one character, `**` any number of segments, `{a,b}`
//!   alternatives, `[abc]` and `[!abc]` a character from a set or not in it. A backslash reads as
//!   `/`. Case is ignored where the file system ignores it. There is no `!`.
//! - A bare pattern (`*.ts`, `src`, `src/**/include`) matches at any depth, and one that names a
//!   folder covers what is inside it: `p` stands for `**/p` and `**/p/**`.
//! - `./p` is anchored to the top of a root and covers what is inside it. With two or more roots
//!   open the first segment names the root by its folder name (`./KnowledgeBase/notes`), as in
//!   VS Code; a name no root has is an error. An absolute path is matched against the whole path.
//!
//! Matching is lexical, on the path relative to each root that holds the file, so a file under two
//! nested roots matches when it matches under either. Include narrows, exclude removes.

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use std::path::{Path, PathBuf};

/// Which box a pattern came from, for the words of an error.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Field {
    Include,
    Exclude,
}

impl Field {
    /// The name the page gives the field, and the label it shows.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Field::Include => "include",
            Field::Exclude => "exclude",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Field::Include => "files to include",
            Field::Exclude => "files to exclude",
        }
    }
}

/// A pattern that cannot be used, and the box it was typed in.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct FilterError {
    pub(crate) field: Field,
    pub(crate) message: String,
}

/// What a rule is matched against.
enum Anchor {
    /// The path relative to any root that holds the file.
    Roots,
    /// The path relative to the roots at these places in the list.
    Root(Vec<usize>),
    /// The whole path.
    Absolute,
}

struct Rule {
    anchor: Anchor,
    /// The pattern, and the same pattern with everything inside a folder of that name.
    set: GlobSet,
    /// Folders a walk may enter to reach what the rule matches, as lists of path pieces; `None` for
    /// a rule that can match anywhere. Only used for the include side.
    reach: Option<Vec<Vec<String>>>,
}

/// The two fields, compiled for a set of roots.
pub(crate) struct Filters {
    include: Vec<Rule>,
    exclude: Vec<Rule>,
    roots: Vec<PathBuf>,
    ignore_case: bool,
}

impl Filters {
    /// Reads both fields. An empty or blank field matches everything (include) or nothing (exclude).
    pub(crate) fn parse(
        include: &str,
        exclude: &str,
        roots: &[PathBuf],
        ignore_case: bool,
    ) -> Result<Self, FilterError> {
        let mut filters = Filters {
            include: Vec::new(),
            exclude: Vec::new(),
            roots: roots.to_vec(),
            ignore_case,
        };
        filters.include = filters.rules(Field::Include, include)?;
        filters.exclude = filters.rules(Field::Exclude, exclude)?;
        Ok(filters)
    }

    /// True when neither field has a pattern, so a search is not narrowed at all.
    pub(crate) fn is_empty(&self) -> bool {
        self.include.is_empty() && self.exclude.is_empty()
    }

    /// True when a file is to be searched: it matches include (or there is none) and not exclude.
    pub(crate) fn keeps_file(&self, path: &Path) -> bool {
        if self.is_empty() {
            return true;
        }
        let places = self.places(path);
        let included =
            self.include.is_empty() || self.include.iter().any(|rule| rule.matches(&places));
        included && !self.exclude.iter().any(|rule| rule.matches(&places))
    }

    /// True when a folder is not to be entered: exclude names it or something it is inside, or no
    /// include pattern can match anything below it.
    pub(crate) fn skips_folder(&self, folder: &Path) -> bool {
        if self.is_empty() {
            return false;
        }
        let places = self.places(folder);
        if self.exclude.iter().any(|rule| rule.matches(&places)) {
            return true;
        }
        !self.may_hold_included(folder)
    }

    /// False only when every include pattern is anchored and none of them can match below `folder`.
    fn may_hold_included(&self, folder: &Path) -> bool {
        if self.include.is_empty() {
            return true;
        }
        let here = pieces(folder, self.ignore_case);
        for rule in &self.include {
            let Some(reach) = &rule.reach else {
                return true;
            };
            let on_the_way = reach
                .iter()
                .any(|target| here.starts_with(target) || target.starts_with(&here));
            if on_the_way {
                return true;
            }
        }
        false
    }

    /// `path` relative to each root that holds it: the root's place in the list and the relative
    /// path with `/`.
    fn places(&self, path: &Path) -> Places {
        let here = pieces(path, self.ignore_case);
        let raw: Vec<String> = pieces(path, false);
        let mut relative = Vec::new();
        for (index, root) in self.roots.iter().enumerate() {
            let base = pieces(root, self.ignore_case);
            if here.len() >= base.len() && here.starts_with(&base) {
                relative.push((index, raw[base.len()..].join("/")));
            }
        }
        Places {
            relative,
            whole: path.to_string_lossy().replace('\\', "/"),
        }
    }

    fn rules(&self, field: Field, text: &str) -> Result<Vec<Rule>, FilterError> {
        let mut rules = Vec::new();
        for segment in split_patterns(text) {
            rules.push(self.rule(field, &segment)?);
        }
        Ok(rules)
    }

    fn rule(&self, field: Field, segment: &str) -> Result<Rule, FilterError> {
        let fail = |message: String| FilterError { field, message };
        let text = segment.replace('\\', "/");
        let patterns_of = |pattern: &str| -> Vec<String> {
            let pattern = pattern.trim_end_matches('/');
            if pattern.ends_with("**") {
                vec![pattern.to_owned()]
            } else {
                vec![pattern.to_owned(), format!("{pattern}/**")]
            }
        };
        let compile = |patterns: Vec<String>| -> Result<GlobSet, FilterError> {
            let mut set = GlobSetBuilder::new();
            for pattern in patterns {
                let glob = GlobBuilder::new(&pattern)
                    .literal_separator(true)
                    .case_insensitive(self.ignore_case)
                    .backslash_escape(false)
                    .build()
                    .map_err(|error| {
                        fail(format!(
                            "{}: {segment} is not a valid pattern ({}).",
                            field.label(),
                            error.kind()
                        ))
                    })?;
                set.add(glob);
            }
            set.build()
                .map_err(|error| fail(format!("{}: {error}", field.label())))
        };

        if text.starts_with("../") || text == ".." {
            return Err(fail(format!(
                "{}: {segment} reaches above a folder, which a search cannot do.",
                field.label()
            )));
        }
        if let Some(rest) = text.strip_prefix("./").or((text == ".").then_some("")) {
            let rest = rest.trim_matches('/');
            let many = self.roots.len() >= 2;
            let (anchor, inner) = if many && !rest.is_empty() {
                let (name, inner) = rest.split_once('/').unwrap_or((rest, ""));
                let named: Vec<usize> = self
                    .roots
                    .iter()
                    .enumerate()
                    .filter(|(_, root)| {
                        root.file_name().is_some_and(|folder| {
                            let folder = folder.to_string_lossy();
                            if self.ignore_case {
                                folder.to_lowercase() == name.to_lowercase()
                            } else {
                                folder == name
                            }
                        })
                    })
                    .map(|(index, _)| index)
                    .collect();
                if named.is_empty() {
                    return Err(fail(format!(
                        "{}: Workspace folder does not exist: {name}",
                        field.label()
                    )));
                }
                (Anchor::Root(named), inner.to_owned())
            } else {
                (
                    Anchor::Root((0..self.roots.len()).collect()),
                    rest.to_owned(),
                )
            };
            let patterns = if inner.is_empty() {
                vec!["**".to_owned()]
            } else {
                patterns_of(&inner)
            };
            let reach = match &anchor {
                Anchor::Root(indices) => Some(
                    indices
                        .iter()
                        .map(|index| {
                            let mut target = pieces(&self.roots[*index], self.ignore_case);
                            target.extend(self.literal_prefix(&inner));
                            target
                        })
                        .collect(),
                ),
                _ => None,
            };
            return Ok(Rule {
                anchor,
                set: compile(patterns)?,
                reach,
            });
        }
        let bytes = text.as_bytes();
        let absolute = text.starts_with('/')
            || (bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && bytes[2] == b'/');
        if absolute {
            // Its pieces (a drive, the root) differ by platform, so a walk is not pruned for it.
            return Ok(Rule {
                anchor: Anchor::Absolute,
                set: compile(patterns_of(&text))?,
                reach: None,
            });
        }
        let bare = text.trim_end_matches('/');
        let patterns = if bare == "**" || bare.starts_with("**/") {
            patterns_of(bare)
        } else {
            patterns_of(&format!("**/{bare}"))
        };
        Ok(Rule {
            anchor: Anchor::Roots,
            set: compile(patterns)?,
            reach: None,
        })
    }

    /// The leading pieces of a relative pattern that have no wildcard in them.
    fn literal_prefix(&self, pattern: &str) -> Vec<String> {
        pattern
            .split('/')
            .take_while(|piece| !piece.is_empty() && !piece.contains(['*', '?', '[', '{']))
            .map(|piece| {
                if self.ignore_case {
                    piece.to_lowercase()
                } else {
                    piece.to_owned()
                }
            })
            .collect()
    }
}

/// Where a path is, as the rules read it.
struct Places {
    relative: Vec<(usize, String)>,
    whole: String,
}

impl Rule {
    fn matches(&self, places: &Places) -> bool {
        match &self.anchor {
            Anchor::Absolute => self.set.is_match(&places.whole),
            Anchor::Roots => places
                .relative
                .iter()
                .any(|(_, path)| self.set.is_match(path)),
            Anchor::Root(roots) => places
                .relative
                .iter()
                .any(|(index, path)| roots.contains(index) && self.set.is_match(path)),
        }
    }
}

/// The pieces of a path, lowercased when case does not matter.
fn pieces(path: &Path, lower: bool) -> Vec<String> {
    path.components()
        .map(|piece| {
            let text = piece.as_os_str().to_string_lossy().into_owned();
            if lower { text.to_lowercase() } else { text }
        })
        .collect()
}

/// Splits on commas that are not inside `{}` or `[]`, trims, and drops empty entries.
fn split_patterns(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let (mut braces, mut brackets) = (0usize, 0usize);
    for c in text.chars() {
        match c {
            '{' => braces += 1,
            '}' => braces = braces.saturating_sub(1),
            '[' => brackets += 1,
            ']' => brackets = brackets.saturating_sub(1),
            ',' if braces == 0 && brackets == 0 => {
                let piece = current.trim();
                if !piece.is_empty() {
                    out.push(piece.to_owned());
                }
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(c);
    }
    let piece = current.trim();
    if !piece.is_empty() {
        out.push(piece.to_owned());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(list: &[&str]) -> Vec<PathBuf> {
        list.iter().map(PathBuf::from).collect()
    }

    fn filters(include: &str, exclude: &str, list: &[&str], ignore_case: bool) -> Filters {
        Filters::parse(include, exclude, &roots(list), ignore_case).expect("patterns")
    }

    fn keeps(include: &str, exclude: &str, path: &str) -> bool {
        filters(include, exclude, &["/w"], false).keeps_file(Path::new(path))
    }

    #[test]
    fn commas_split_except_inside_braces_and_brackets() {
        assert_eq!(
            split_patterns("*.ts, src/**/include"),
            ["*.ts", "src/**/include"]
        );
        assert_eq!(
            split_patterns("{**/*.html,**/*.txt}, a"),
            ["{**/*.html,**/*.txt}", "a"]
        );
        assert_eq!(split_patterns("[a,b],c"), ["[a,b]", "c"]);
        assert_eq!(split_patterns(" , ,"), Vec::<String>::new());
    }

    #[test]
    fn a_bare_pattern_matches_at_any_depth() {
        assert!(keeps("*.ts", "", "/w/a.ts"));
        assert!(keeps("*.ts", "", "/w/x/y/b.ts"));
        assert!(!keeps("*.ts", "", "/w/a.tsx"));
        assert!(keeps("src/**/include", "", "/w/src/a/b/include"));
        assert!(keeps("src/**/include", "", "/w/lib/src/include"));
        assert!(!keeps("src/**/include", "", "/w/other/include"));
    }

    #[test]
    fn a_name_covers_everything_inside_a_folder_of_that_name() {
        assert!(keeps("src", "", "/w/src/a.ts"));
        assert!(keeps("src", "", "/w/lib/src/deep/a.ts"));
        assert!(!keeps("src", "", "/w/srcs/a.ts"));
        assert!(!keeps("", "example", "/w/a/example/b.md"));
        assert!(keeps("", "example", "/w/a/other/b.md"));
    }

    #[test]
    fn star_does_not_cross_a_slash_and_double_star_does() {
        assert!(!keeps("a/*.md", "", "/w/a/b/c.md"));
        assert!(keeps("a/**/*.md", "", "/w/a/b/c.md"));
        assert!(keeps("a/**/*.md", "", "/w/a/c.md"));
        assert!(keeps("?.md", "", "/w/a.md"));
        assert!(!keeps("?.md", "", "/w/ab.md"));
    }

    #[test]
    fn braces_and_character_classes() {
        assert!(keeps("*.{ts,vue}", "", "/w/a.vue"));
        assert!(!keeps("*.{ts,vue}", "", "/w/a.js"));
        assert!(keeps("[ab].md", "", "/w/a.md"));
        assert!(!keeps("[ab].md", "", "/w/c.md"));
        assert!(keeps("[!ab].md", "", "/w/c.md"));
        assert!(!keeps("[!ab].md", "", "/w/a.md"));
        assert!(keeps("{**/*.html,**/*.txt}", "", "/w/x/y.txt"));
    }

    #[test]
    fn backslashes_read_as_slashes() {
        assert!(keeps(r"src\a\*.ts", "", "/w/src/a/b.ts"));
    }

    #[test]
    fn dot_slash_anchors_to_the_top_of_a_root() {
        assert!(keeps("./src", "", "/w/src/a.ts"));
        assert!(!keeps("./src", "", "/w/lib/src/a.ts"));
        assert!(keeps("./src/**/*.ts", "", "/w/src/a/b.ts"));
        assert!(!keeps("", "./build", "/w/build/x.o"));
        assert!(keeps("", "./build", "/w/lib/build/x.o"));
    }

    #[test]
    fn include_narrows_and_exclude_removes_and_both_together() {
        assert!(keeps("*.md, *.txt", "drafts", "/w/a.md"));
        assert!(!keeps("*.md, *.txt", "drafts", "/w/drafts/a.md"));
        assert!(!keeps("*.md, *.txt", "drafts", "/w/a.rs"));
        assert!(keeps("", "", "/w/anything"));
    }

    #[test]
    fn case_follows_the_platform() {
        let strict = filters("*.TS", "", &["/w"], false);
        assert!(!strict.keeps_file(Path::new("/w/a.ts")));
        let loose = filters("*.TS", "", &["/w"], true);
        assert!(loose.keeps_file(Path::new("/w/a.ts")));
        // A root typed in another case still holds the file where case is ignored.
        let other = filters("./src", "", &["/W"], true);
        assert!(other.keeps_file(Path::new("/w/SRC/a.ts")));
    }

    #[test]
    fn several_roots_name_the_root_first() {
        let two = ["/a/KnowledgeBase", "/a/projects"];
        let f = filters("./KnowledgeBase/notes", "", &two, false);
        assert!(f.keeps_file(Path::new("/a/KnowledgeBase/notes/x.md")));
        assert!(!f.keeps_file(Path::new("/a/KnowledgeBase/other/x.md")));
        assert!(!f.keeps_file(Path::new("/a/projects/notes/x.md")));
        let whole = filters("./projects", "", &two, false);
        assert!(whole.keeps_file(Path::new("/a/projects/p/x.md")));
        assert!(!whole.keeps_file(Path::new("/a/KnowledgeBase/x.md")));
        let error = Filters::parse("./Nope/x", "", &roots(&two), false)
            .err()
            .expect("error");
        assert_eq!(error.field, Field::Include);
        assert!(
            error
                .message
                .contains("Workspace folder does not exist: Nope")
        );
    }

    #[test]
    fn a_file_under_two_nested_roots_matches_under_either() {
        let nested = ["/w", "/w/notes"];
        // Named by the outer root, which holds the file as `notes/a.md`.
        assert!(
            filters("./w/notes/a.md", "", &nested, false).keeps_file(Path::new("/w/notes/a.md"))
        );
        // Named by the inner root, which holds it as `a.md`.
        assert!(filters("./notes/a.md", "", &nested, false).keeps_file(Path::new("/w/notes/a.md")));
        // Neither root holds it under that name.
        assert!(
            !filters("./notes/zzz.md", "", &nested, false).keeps_file(Path::new("/w/notes/a.md"))
        );
        // Excluding under either name removes it.
        assert!(
            !filters("", "./notes/a.md", &nested, false).keeps_file(Path::new("/w/notes/a.md"))
        );
        assert!(!filters("", "./w/notes", &nested, false).keeps_file(Path::new("/w/notes/a.md")));
    }

    #[test]
    fn a_bad_pattern_names_its_field_and_says_why() {
        let roots = roots(&["/w"]);
        let broken = Filters::parse("src/[abc", "", &roots, false)
            .err()
            .expect("error");
        assert_eq!(broken.field, Field::Include);
        assert!(
            broken
                .message
                .starts_with("files to include: src/[abc is not a valid pattern")
        );
        let open = Filters::parse("", "{a,b", &roots, false)
            .err()
            .expect("error");
        assert_eq!(open.field, Field::Exclude);
        assert!(open.message.starts_with("files to exclude:"));
        let above = Filters::parse("../x", "", &roots, false)
            .err()
            .expect("error");
        assert!(above.message.contains("above a folder"));
    }

    #[test]
    fn an_excluded_folder_is_skipped_and_an_anchored_include_prunes_the_rest() {
        let f = filters("./docs/guide", "**/target", &["/w"], false);
        assert!(f.skips_folder(Path::new("/w/docs/target")));
        assert!(
            f.skips_folder(Path::new("/w/src")),
            "off the way to docs/guide"
        );
        assert!(!f.skips_folder(Path::new("/w/docs")), "on the way");
        assert!(!f.skips_folder(Path::new("/w/docs/guide")));
        assert!(
            !f.skips_folder(Path::new("/w/docs/guide/deeper")),
            "inside it"
        );
        // A bare include could match anywhere, so nothing is pruned for it.
        let bare = filters("*.md", "", &["/w"], false);
        assert!(!bare.skips_folder(Path::new("/w/src")));
        // A wildcard in the first piece reaches everywhere.
        let wild = filters("./*/guide", "", &["/w"], false);
        assert!(!wild.skips_folder(Path::new("/w/src")));
        // Several roots: a folder of the other root is skipped, the named root's path is entered.
        let two = filters("./b/x", "", &["/a", "/b"], false);
        assert!(two.skips_folder(Path::new("/a/x")));
        assert!(!two.skips_folder(Path::new("/b/x")));
        assert!(two.skips_folder(Path::new("/b/y")));
    }

    #[test]
    fn empty_fields_change_nothing() {
        let none = filters("", "  ", &["/w"], false);
        assert!(none.is_empty());
        assert!(none.keeps_file(Path::new("/w/a")));
        assert!(!none.skips_folder(Path::new("/w/a")));
    }
}
