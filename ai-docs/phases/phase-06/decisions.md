# Phase 6 decisions

Deviations from the plan and choices it left open. Numbers carry the OS they came from.

## Checking the UI (all of Phase 6)

- Same two places as Phase 5: Claude in Chrome on `pnpm dev` (mock host), and the real app, `target/debug/mdmate.exe` built with `--features perf` against my own Vite server on port 1420, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, `MDMATE_DATA_DIR` in a temp folder, driven over the DevTools port. I stop the Vite server I started when I am done with it.
- Scripts live in the session scratchpad, not in the repo.
- **Native drops are checked with a real OLE drag**: a small WinForms window offers the paths as a file drop, and real mouse input (`mouse_event`) carries them over the app and releases. It produces the same `DragDropEvent::Drop` Explorer does. It ran at display scale 100% on this machine (`devicePixelRatio` 1); Phase 5 ran at 125% on the laptop screen.

## P6-T1: file tree, Open and Remove Folder

**Where the roots live.** Rust keeps them in `workspace.json` in the data folder (`{"version":1,"roots":[...]}`, written with the same temp-file-and-rename as a save). At start it reads the file, drops any folder that is gone, grants the rest, and the page asks `workspace_load` for the list. The session snapshot only says which folders were open, and the page ignores one outside every root. Why: a file the page writes must never be able to grant access, and a snapshot is exactly that. It also means a damaged or missing `session.json` still brings the roots back (tested, and a snapshot that names a root adds none).

**Listing and watching.** `list_dir` lists one folder and the page asks again at every open, so a closed folder never goes stale. Folders first, then case-insensitive name, then raw name (the same order in the mock host). Rust watches exactly the folders the page has open (`watch_folders`), not recursively, and sends the folder's path over one `Channel` when something in it changes, debounced 150 ms; the page lists that folder again and the newest answer wins. A folder that fails to list keeps what it showed and draws the reason under it.

**Virtual rows.** The tree is a flat list of rows (`flatten`) drawn through a window of the visible rows plus 8 on each side, 24 px per row, so a 10,000-file folder draws fewer than 200 rows. Rows are `absolute` at `index * 24`; nothing measures a row.

**Remove Folder and the image scope.** Removing a root revokes Rust's file access right away (`remove_root`, tested). The asset-protocol scope that lets the page show images from a folder cannot shrink: Tauri has no call for it, and `forbid_directory` is permanent and beats every later allow, which would block adding the same folder again. So `add_root_and_allow_images` grows the scope when a root is added, and Remove does nothing to it. An image in a removed folder can still be shown until the app restarts. This closes the first half of the old Remaining Work item about the asset scope. **Your call**: if you would rather forbid on remove and accept that a removed folder cannot come back until restart, it is one line in `remove_root`.

**Drops.** `on_window_event` records the paths of each `DragDropEvent::Drop` in a `DropRegistry` that keeps the last four drops. `drop_describe` and `add_dropped_root` accept only paths from it, and a request for any other path answers `not-allowed`. The page works out meaning from where the drop landed: a folder outside the tree becomes a root, a folder over the tree does nothing yet (T2 copies into it), and files do nothing yet (T3 opens them). All-or-nothing: if one path of a drop is unknown, `drop_describe` refuses the lot. Positions come in physical pixels and are divided by `devicePixelRatio` in `toCssPosition` (unit-tested; see untested.md for 125%).

**Shortcut.** Ctrl+Shift+O, menu entry Open Folder… under Open…. The Mac label is ⇧⌘O.

**Not in the plan, small.** The mock host has `pickFolder`, `roots`, `simulateDrop` and `simulateDrag` options so tests and `pnpm dev` can use a workspace; the demo has a `/demo/docs` folder with a Markdown, a text and an image file. `pnpm dev` Open Folder opens `/demo`.

**Rust mutation checks that survived.** Two breaks are not visible in any output a test can read: watching recursively instead of non-recursively, and never calling `unwatch` for a folder that closed. Both only change how many OS handles are held. I removed a test that claimed to cover the second one and did not. The behavior is covered the other way round: the page test shows a closed folder gets no rows from changes while it is closed, and `watched()` is asserted in the Rust test for the set of folders.

**Evidence.** Rust: 158 tests pass (`cargo test`), 36 of them new in `workspace/{tree,roots,folders,mod}.rs` and `drops.rs`. Web: `tests/features/tree.test.ts` (25), `tests/features/workspaceSession.test.ts` (10), `tests/platform/workspace.test.ts` (4). Deliberate page-side breaks, all caught: a window that shows every row, a stale listing overwriting a newer one, restore trusting folders outside the roots, a folder dropped on the tree becoming a root, every extension counting as Markdown, non-Markdown not dimmed, removing a root keeping its rows, ignoring tree events, the session forgetting open folders, the pixel ratio ignored. Real window, 17 of 17 checks (restore, listing by Rust, order, outside folder refused, undelivered drop refused, watcher adds and removes, dimming, open by click, session, context menu Remove, revoked access, removal persists), and 5 of 5 for the native drop script.

**A flake worth knowing about.** Two runs of the drag script in the middle of the session moved nothing and printed nothing, while the first and the last worked. I did not find the cause; the script is outside the repo and the run does not depend on it.
