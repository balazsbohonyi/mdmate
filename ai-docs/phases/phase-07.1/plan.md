# Phase 7.1: Workspace index

**Goal:** finding a file, its links or a word in a large workspace starts from a list mdmate already holds, not from a fresh walk of the disk.

**Why now:** with `D:\develop\projects` open as a root (79,456 files, 38.8 GB), Ctrl+P and search are slow. Quick Open keeps an index in memory (`src-tauri/src/workspace/quick.rs`), but `src/features/palette/PaletteHost.vue` rebuilds it with a full walk every time the picker opens. Link scans (`links/rewrite.rs`, `links/references.rs`) and folder search (`search/mod.rs`) walk the disk on every request. No file event updates any of them, and the tree watcher (`workspace/folders.rs`) covers only the folders that are open. The decisions below were settled with the owner on 2026-11-12.

## What the index is

- **Contents:** one entry per file under the workspace roots, holding its path, name, kind, size and modified time. File contents are not indexed. Folder search still reads the files it searches, but it gets the list from the index.
- **Exclusions:** `.gitignore` is not read. A folder of Markdown notes kept out of version control must stay searchable, and a root-level `.gitignore` would hide it. Instead, a built-in list of folder names is skipped wherever they appear: `.git`, `node_modules`, `target`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.cache`, `.parcel-cache`, `.venv`, `venv`, `__pycache__`, `.gradle`, `bin`, `obj`, `.vs`, `.idea`.
  - **Where it applies:** to Quick Open, link scans and folder search alike. This changes Quick Open, which lists `node_modules` today.
  - **The tree:** still shows every folder, and a file under an excluded folder still opens from there.
  - **Later:** Phase 8 makes the list editable in settings.
  - **Known cost:** a folder of your own named `bin` or `obj` drops out of Ctrl+P and search.
- **Nested roots:** a file under two roots (`projects` and `projects\KnowledgeBase`) appears once, relative to the innermost root that holds it. This is the same default Reveal uses.
- **Cap:** 1,000,000 files across all roots, raised from Quick Open's 250,000. Past it, the status bar names the root that was cut, and search and link scans walk that root as they do today.
- **No sidebar file-name filter.** Ctrl+P is the file-name search.

## How it is kept

- **On disk:** one versioned cache file per root in the app data folder, holding paths and metadata only.
  - **Rebuilt** when its version, the exclusion list or the root changes, or when it cannot be read.
  - **Deleted** when the root is removed from the workspace.
- **At start:** Ctrl+P answers from the cache at once, while a reconcile against the disk runs in the background. Results update when it finishes, so for a few seconds a missing file can still be listed. Opening one gives the usual not-found message.
- **While running:**
  - **mdmate's own operations** (new file or folder, rename, move, delete, copy on drop) update the index and its cache at once.
  - **Other programs' changes** are caught by a recursive watcher per root, which ignores excluded folders.
  - **Dropped events:** when Windows drops events (buffer overflow), that root is reconciled again.
- **Status bar:** an **Indexing** label and a thin percent bar on the right of `src/shell/StatusBar.vue`, shown only while a root is indexed or reconciled. Clicking it does nothing.
  - **With a cache:** the percent is folders checked out of the folders in the cache.
  - **First index of a root:** the percent is the share of its top-level entries done, so it moves in steps.

## P7.1-T1: The index

A Rust module (`src-tauri/src/workspace/index.rs`) builds, caches, reconciles and watches the index, and reports progress to the page over a Tauri channel.

- **Reuse:** it builds on `links/walk.rs` (`walk_until`, and its rule that links, junctions and mount points are not followed). The exclusion list lives next to `fs/kind.rs`.
- **Updates from mdmate:** `src/features/tree/ops.ts` calls into the index through Rust commands after each new, rename, move, delete and copy.
- **Status bar:** shows Indexing with its percent while a root is built or reconciled.
- **Perf setup:**
  - **Fixture:** `scripts/lib/workspaceFixture.ts` gains a 100,000-file workspace.
  - **Scenario:** a new perf scenario, `typing-during-indexing`, types while that workspace is indexed.

**Done when:** a root is indexed in the background with the status bar showing it, and the cache brings it back after a restart. A file changed by mdmate or by another program shows in the index, and typing stays under 16 ms p95 work per key while a root is indexed.

## P7.1-T2: Quick Open from the index

`quick.rs` scores against the shared index with its existing subsequence scorer, and the picker no longer asks for a rebuild when it opens. Add a `quick-open-query` perf scenario.

**Done when:** Ctrl+P answers in under 50 ms p95 on the 100,000-file workspace. It also answers from the cache right after a start.

## P7.1-T3: Link scans and folder search from the index

The rename and move rewrite, Find File References and folder search take their file list from the index, filtered by their scope (Markdown only for the link scans). Each keeps its walk as a fallback for a root that is not indexed yet or was cut by the cap.

**Done when:** none of the three walks a root that is indexed, results match a walk on the test fixtures, and the existing typing-during-scan and typing-during-search gates still hold.

## Checks for the phase

- **Rust tests:** index build, the exclusion list, reconcile against a changed tree, updates from mdmate's own operations, watcher events and a dropped-event reconcile, cache version and corruption, nested-root dedupe, and the cap.
- **Page tests:** the status bar element, Quick Open with no rebuild on open, and the walk fallbacks.
- **Real debug window:** open `D:\develop\projects` and watch Indexing and its percent.
  - **Ctrl+P:** instant once the index is built, and instant from the cache after a restart.
  - **Updates:** a file renamed in mdmate and a file created by another program both show in Ctrl+P.
  - **Exclusions:** files under `node_modules` and `target` are absent from Ctrl+P and search.
- **Release perf run:** `quick-open-query` and `typing-during-indexing` plus the existing typing gates. Record, without gating, the first index time and the start-up reconcile time of the 100,000-file workspace.
