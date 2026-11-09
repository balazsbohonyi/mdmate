# Phase 6: Workspace

**Goal:** the sidebar manages real files, and a rename can never strand a link.

## P6-T1: File tree

Lazy per-folder listing in Rust, virtualized rendering, multiple roots, non-Markdown dimmed, and live updates from the watcher.

Roots come in through **Open Folder…** (Ctrl+Shift+O, the system folder picker in Rust, which grants the root) and through a folder dropped from Explorer anywhere outside the tree. **Remove Folder from Workspace** on a root's context menu takes it out and revokes its access. The session restores the roots.

**Done when:** a 10,000-entry folder renders under 200 rows, external changes appear, and roots added by dialog or drop come back after a restart (ISC-192 to ISC-195).

## P6-T2: File operations

Create a file or a folder (named inline in the tree), rename, move by pointer drag, delete through the `trash` crate behind `platform/`, and reveal in Explorer.

Files and folders dropped from Explorer **onto a tree folder are copied into it**, folders whole. A name clash raises a banner with Replace, Keep both and Skip (and "apply to all"); Keep both names the copy `notes (2).md`, and Replace sends the old file to the Recycle Bin first. The tree then reveals and selects the copies; nothing opens, and links inside copies are copied as written.

**Done when:** each operation works, delete lands in the Recycle Bin, and a drop onto a folder copies with every clash answer (ISC-196 to ISC-199).

## P6-T3: Text and image tabs

Other text files open as plain source. Images open in an image tab with fit, zoom, pan, dimensions and size. SVG loads through `<img>`.

**Drop to open.** Markdown and text files dropped from Explorer open in tabs in the pane they land on; an image dropped anywhere but a document's text opens in an image tab (on the text, P9-T2 inserts a link). Rust records the paths of each native drop from Tauri's own drop event, and opening or copying from a drop accepts only those paths, so the page never names a path to read.

**Done when:** a script inside an SVG stays inert, dropped files open where they land, and a path no drop delivered is refused (ISC-200 to ISC-202).

## P6-T4: Link scanner

`src-tauri/src/links/` finds link targets with byte offsets in any text file: inline links, images, reference definitions, `<img src>`, `<a href>`, percent-encoded and angle-bracket forms. Only `.git` and binary files are skipped, using a NUL-byte sniff. `folder_exclude_patterns` never apply here.

**Done when:** scanner fixtures cover every listed form.

## P6-T5: Rewrite engine

Given an old and a new path, plan edits for inbound links and for relative links inside moved files. Files and folders are both handled. Edits change only target bytes, keeping encoding style and `#anchor`. Files are saved atomically, and failures are collected.

**Done when:** after any rename or move in the fixture workspace, a rescan finds zero links to the old path, and byte diffs show only targets changed.

## P6-T6: Rewrite UI

The scan runs in the background with progress. The prompt shows N links in M files, and `links.confirmRewrite: false` skips it. Dirty tabs get undoable edits and stay unsaved, and clean open tabs reload. Failures are listed.

**Done when:** typing stays under 16 ms during a large scan.

## P6-T7: Quick open and palette

Ctrl+P uses a Rust file index with fuzzy matching. Ctrl+Shift+P lists the command registry. Both load on first use.

**Done when:** both work from the keyboard alone.

## P6-T8: Untitled files, Save As, Revert, Close All, Open Recent

- **Ctrl+N** opens an empty untitled Markdown tab (`Untitled-1`, numbered per session). The first Ctrl+S shows the system save dialog in Rust, which grants the chosen path, and writes UTF-8 with no BOM and LF. The dialog suggests a name from the first heading (`# Meeting notes` becomes `meeting-notes.md`, else `Untitled.md`) in the active pane's root, else the folder of the last file opened or saved. Unsaved untitled tabs are kept by hot exit; closing one with text asks like any dirty tab; F2 on one acts as Save As.
- **Save As** (Ctrl+Shift+S) writes to the chosen path and the tab follows the new file, undo history kept; the original is never touched. On a read-only document (an unsupported encoding) it writes UTF-8 and the tab becomes editable.
- **Revert File** discards unsaved edits and reloads from disk after a confirm in the pane banner; disabled for untitled tabs and for files missing on disk.
- **Close All** (Ctrl+Shift+W) closes every tab, asking once for each dirty document with the existing pane banner.
- **Open Recent**: the last 10 files and 5 folders, kept by Rust in the data folder and granted again when chosen; entries that no longer exist are dropped when the list is shown; "Clear Recent" at the bottom. Untitled tabs never enter it.

**Done when:** every item works from the menu and its shortcut, Save As leaves the original's bytes unchanged, and an untitled buffer survives a forced restart (ISC-203 to ISC-212).

## P6-T9: Tab context menu and Find File References

Right-clicking a tab offers Close, Close Others, Close All, Copy Path, Copy Relative Path (from the containing root with forward slashes, or the absolute path outside every root), Reveal in Explorer, Reveal in Sidebar (disabled outside every root), Rename (F2, through the P6-T6 rewrite flow) and **Find File References**: a "References" panel in the sidebar lists every file and line that links to the file, from the P6-T4 scanner, and a click opens the file at the link. Runs after P6-T6 and P6-T7, since it needs the scanner and the rewrite UI.

**Done when:** each menu item works on the active and on a background tab, and references match a rescan of the fixture workspace (ISC-213 to ISC-218).
