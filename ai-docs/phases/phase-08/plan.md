# Phase 8: Configuration

**Goal:** everything changeable is a file, applied the moment it is saved, and everything common can also be changed on a settings screen that edits the same file.

The files are the source of truth. The screen reads and writes them and holds no state of its own, so a change made on the screen and a change made by hand in the file always agree. The design session of 2026-11-14 is recorded in the `ISA.md` Decisions (ISC-343 to ISC-385).

Files live in the app data folder, next to `session.json`, and move with portable mode: `settings.json`, `keybindings.json` and a `themes/` folder. Nothing in an opened workspace can supply any of them (ISC-173, ISC-384).

## P8-T1: Settings core

`settings.json` is read at start, watched, validated and applied live. Data enters as `unknown` and passes through one validator. Invalid input keeps the last good values: a file that is not JSON shows a banner on the screen naming the line, a bad single value is ignored and flagged on its row (ISC-148, ISC-352, ISC-353).

A change from the screen writes only the key it touched and keeps every other key, unknown ones too; a value equal to the default removes the key (ISC-349, ISC-350). The file is strict JSON, two-space indent, written atomically; comments are not supported. A hand edit made in the `settings.json` tab updates the screen with no reload (ISC-351). If that tab holds unsaved edits, a change on the screen asks Save, Discard or Cancel first (ISC-354).

**Keys (defaults in brackets).** `theme` (`dark`), `fonts.heading`, `fonts.body`, `fonts.code` (empty, meaning the built-in stack), `fonts.size` (15), `fonts.codeSize` (14), `fonts.headingScale` (`[1.7, 1.45, 1.25, 1.1, 1, 0.95]`, today's heading sizes), `editor.wordWrap` (`true`), `images.pasteFolder` (`assets`), `links.onRename` (`never`), `files.largeFileMB` (3), `recent.files` (10), `recent.folders` (5), `workspace.excludedFolders` (the 20 built-in names; the key is stored only once changed), `devtools` (`false` in a release build).

**Environment variable.** `MDMATE_LINKS_ON_RENAME` stays as a launch-time override for tests and one-off runs. While it is set, the Links row shows its value read-only with the variable named (ISC-369).

## P8-T1b: The behaviour behind each key

- `images.pasteFolder` (ISC-330, ISC-368): replaces the Rust constant `IMAGES_FOLDER`. A folder name or relative path under the document's folder, never absolute and never leaving it; read at paste, drop and Save As time.
- `editor.wordWrap` (ISC-359): a CodeMirror compartment around `EditorView.lineWrapping`.
- `files.largeFileMB` (ISC-364), `recent.files` and `recent.folders` (ISC-365).
- `workspace.excludedFolders` (ISC-366): replaces the constant list in `fs/exclude.rs`; a change re-indexes (the index cache already keys on the list).
- `devtools` (ISC-249): needs Tauri's `devtools` feature compiled in, then `open_devtools` and `close_devtools` at runtime; F12 only does something while the setting is on. The release default is off.
- `links.onRename` (ISC-320): filled from the file; the three behaviours exist since P7.1-T5.

## P8-T1c: The Settings tab

A new tab kind `settings`, a singleton. Opening it again focuses it (ISC-343); it restores with the session at the same category (ISC-344); splitting does not clone it (ISC-345). Opened by `Mod+,` (ISC-346), the title bar menu and the palette, which also offer Open settings.json (ISC-347), and a gear button (ISC-348). The view loads lazily, like the palette and the search panel.

## P8-T1d: The screen

Categories on the left: **Appearance** (theme, fonts), **Editor**, **Files & Workspace**, **Keyboard**, **Advanced** (developer tools, Open settings.json, Open keybindings.json, Open themes folder). Settings on the right, a search box on top filtering by label, description and key across all categories (ISC-357).

Every row is the same component: a label, a one-line description, the control on the right, the JSON key in muted text, a modified dot and a reset icon while the value differs from the default, and an error under a control that takes text or a number (ISC-355, ISC-356). The excluded-folders list is chips with an add field and Reset to built-in list (ISC-367). The screen reads well in every built-in theme (ISC-358).

## P8-T1e: Fonts

Three families (headings, body, code), one base size, a separate code size, and a multiplier per heading level (ISC-360 to ISC-363). They apply to document content only, not to menus or the sidebar. An empty or uninstalled family falls back to the built-in stack. Each field shows a live sample line.

## P8-T1f: Palette toggles

Toggle Word Wrap and Toggle Developer Tools show their current state in the palette row and the menu; Switch Theme opens a pick list (ISC-153, ISC-370, ISC-371). A `Command` gains a state read reactively; today its title is a static string.

## P8-T2: Keybindings

`keybindings.json` maps a command id to a `Mod+...` shortcut, one binding per command, using `Mod` so bindings carry across OSes. A saved rebinding works immediately (ISC-149). An invalid entry keeps that command's default and shows a notice (ISC-376).

The Keyboard category lists every command with its shortcut (ISC-372). Clicking a row records the next key combination and rebinds at once (ISC-373). A combination already in use names the other command and offers Replace, which unbinds it (ISC-374). Each row can be reset, and Reset all clears the file (ISC-375).

## P8-T3: Themes

Built-ins: **Dark** (the default), **Light**, **Sepia** and **System** (follows the operating system, live). Sepia ports MarkdownWeave's palette (cream `#fdf6e3` background, brown `#3b2f1e` text, brown links), darkens the greys that fail the contrast floors, and designs the syntax colours, which MarkdownWeave never had. The theme contract test covers three themes (ISC-377 to ISC-379).

User theme files in `themes/` override any token, are read as data, and reload on save (ISC-150, ISC-151). **Customize** copies the selected theme into `themes/` and selects the copy; built-ins are never written (ISC-380, ISC-385). The colour editor shows all 54 tokens in groups (Core, Sidebar, Chrome, Editor, Syntax), writes the theme file as you change a colour, and warns when a required pair drops under its contrast floor (ISC-381 to ISC-383).

**Done when:** saving a theme updates the running app, and the built-ins are reviewed as original (ISC-146).

## P8-T4: Portable mode

A `mdmate.portable` file beside the exe moves all data there, following Riftle's `paths.rs` approach, so settings, keybindings and themes move too.

**Done when:** path tests pass with and without the marker (ISC-152).

## Risks

- Anything that reads `.dark` as a class (`@custom-variant dark`, `tests/styles/themes.test.ts`, `index.html`, the Tauri `backgroundColor`) must be revisited for three themes.
- The `devtools` Cargo feature changes release builds; confirm with the owner's build before merging.
- Editing the excluded list re-indexes; check the cost on a large workspace.
- A screen write against a dirty `settings.json` tab needs a real-window run.
