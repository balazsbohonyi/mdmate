# Phase 8: Configuration

**Goal:** everything changeable is a file, applied the moment it is saved.

## P8-T1: Settings

`settings.json` opens inside mdmate, validates on save and applies live. Invalid input keeps the last good values with a notice. Common toggles appear in the palette.

**Developer tools (ISC-249).** A `devtools` setting, with a palette toggle, turns the F12 developer tools on or off. Today they open only in a debug build and never in a release build, because `Cargo.toml` does not enable Tauri's `devtools` feature. The setting needs that feature compiled in and then switches the tools at runtime on the window (`open_devtools`, `close_devtools`), and F12 only does something while the setting is on. The release default is off.

**Link setting (ISC-320).** `links.onRename` (`ask`, `update` or `never`) is read from `settings.json` and applies to the next rename. Phase 7.1 (P7.1-T5) built the setting and its three behaviours in `src/lib/settings.ts` and `features/links/rewrite.ts`, with the default `never`, and left one temporary source: the `MDMATE_LINKS_ON_RENAME` environment variable, read by Rust (`settings/mod.rs`, command `links_on_rename_override`) and winning over the setting. This task fills `settings.links.onRename` from the file, adds a palette toggle, decides what the variable does once the file exists (retire it, or keep it as an override for tests and the perf harness) and writes that in the decisions. The default may be reconsidered then; the owner chose `never` for now because the link scan reads every Markdown file in a large workspace.

**Image paste folder (ISC-330).** Phase 9 runs first and pastes into an `assets` folder next to the document, a constant in the code. This task adds `images.pasteFolder` (default `assets`, a folder name or relative path under the document's folder, never absolute and never leaving it) and reads it at paste time.

**Done when:** a saved change applies with no restart, F12 follows the `devtools` setting in a release build, a saved `links.onRename` changes the next rename, and a saved `images.pasteFolder` changes the next paste.

## P8-T2: Keybindings

`keybindings.json` overrides the default command map, using `Mod` so bindings carry across OSes.

**Done when:** a saved rebinding works immediately.

## P8-T3: Themes

Add dark and light switching, and user theme files that override any token, reloaded on save. Theme files set token values only, read as data. They load from the settings folder, so an opened workspace cannot supply one.

**Done when:** saving a theme updates the running app, and the built-ins are reviewed as original.

## P8-T4: Portable mode

A `mdmate.portable` file beside the exe moves all data there, following Riftle's `paths.rs` approach.

**Done when:** path tests pass with and without the marker.
