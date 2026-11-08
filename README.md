# mdmate

A fast desktop Markdown editor. Markdown renders where you type, and the syntax shows up only at the caret.

mdmate opens any Markdown file almost instantly, lets you edit it in place the way Obsidian's live preview does, and leaves the file on disk exactly as you wrote it. The window works like Sublime Text: tabs, a folder sidebar, free splits and command palettes.

## Why it exists

Good inline Markdown editing usually comes bundled with something heavy. Note-taking apps want you to build a vault and live inside it. Fast editors like Sublime Text show you raw Markdown and nothing else. Viewers render nicely but can't edit.

I wanted the small thing in between: double-click a README, see it rendered at once, and start typing. No vault, no sync, no account, no plugin system. Just files and folders you already have.

I'm building it first for myself, as the Markdown tool I'd open every day. If it works for me, it should work for anyone who keeps notes and docs in folders and git repos.

## What it's for

- Reading and editing Markdown in repos, docs folders and note collections.
- Writing without switching between a source pane and a preview pane.
- Working with many files at once: tabs, splits, the same file in two panes.
- Renaming and moving files without breaking the links between them.

## Principles

- **Your file belongs to you.** The Markdown text is the document. mdmate never parses and re-serializes it, so git diffs show only the lines you changed. Line endings, encodings and odd formatting survive a save untouched.
- **Speed is a feature, with numbers.** Startup, opening a large file, switching tabs and typing all have targets, measured on real files in the release build.
- **Never lose work.** Unsaved edits survive closing the app or a crash. Close it mid-sentence and your words are there tomorrow.
- **Other people's files are untrusted.** Opening a hostile document should be harmless.
- **Everything is a file.** Settings, keybindings and themes are plain files you can edit, not menus.

## Why Rust

mdmate is built with [Tauri](https://tauri.app), so the app has two halves. The interface and the editor run in the system web view (Vue and CodeMirror 6). Everything that touches the operating system runs in Rust.

I chose that split for four reasons:

- **Small and quick to start.** A Markdown editor should feel lighter than the browser tab it replaces. Tauri uses the web view already on the machine instead of shipping a whole browser.
- **File safety in one place.** All file access goes through our own Rust commands. Reading, encoding, line endings, atomic saves, change detection and link rewriting all live there, so the page can't write to a path it wasn't given.
- **Work that shouldn't block typing.** Searching a folder, scanning links and watching for changes happen in Rust, off the editor's thread.
- **Portable by design.** Anything OS-specific sits behind traits, so macOS and Linux need new implementations of those traits and not a rewrite.

## Platforms

Windows 11 comes first. The code is kept portable, but macOS and Linux builds aren't part of the first release.

## Scope

mdmate stays small on purpose. It has no math or diagram rendering, wiki links, multi-cursor, spellcheck, plugins, sync, export, accounts or telemetry. Those are different products.

## Documentation

The reasoning and the details live in the repo:

- [`ISA.md`](ISA.md): what must be true, as checkable claims
- [`ai-docs/project.md`](ai-docs/project.md): who it's for and why
- [`ai-docs/architecture/architecture.md`](ai-docs/architecture/architecture.md): how it fits together

## License

mdmate is open source under the [MIT License](LICENSE).
