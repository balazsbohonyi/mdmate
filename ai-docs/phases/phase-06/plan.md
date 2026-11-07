# Phase 6: Workspace

**Goal:** the sidebar manages real files, and a rename can never strand a link.

## P6-T1: File tree

Lazy per-folder listing in Rust, virtualized rendering, multiple roots, non-Markdown dimmed, and live updates from the watcher.

**Done when:** a 10,000-entry folder renders under 200 rows, and external changes appear.

## P6-T2: File operations

Create, rename, move by pointer drag, delete through the `trash` crate behind `platform/`, and reveal in Explorer.

**Done when:** each operation works, and delete lands in the Recycle Bin.

## P6-T3: Text and image tabs

Other text files open as plain source. Images open in an image tab with fit, zoom, pan, dimensions and size. SVG loads through `<img>`.

**Done when:** a script inside an SVG stays inert.

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
