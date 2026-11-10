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

## P6-T2: file operations and copy on drop

**Rust owns every path.** `workspace/ops.rs` creates, renames, moves, deletes and copies. A path comes only from a workspace root (`Access::check_in_root`) or from the record of native drops, never from the page's say-so. A root cannot be renamed, moved or deleted from the tree; Remove Folder is the way. Names are checked on both sides (`validate_name` and `lib/fileNames.ts`): no separators or `\ / : * ? " < > |`, no control characters, no trailing dot or space, no Windows device names.

**Delete.** It goes to the Recycle Bin through the `trash` crate behind `Platform::move_to_trash`, with no confirmation, because the bin is the undo. Replace on a copy does the same to the old item first.

**Copy.** A file is written to `.{name}.mdmate-copy` and renamed into place, so a failed copy leaves nothing half-written. Links and junctions are skipped and counted (`links_left`), not followed. Keep both gives `name (2).ext`; for folders and dotfiles the number goes at the end. A copy onto itself is forced to Keep both. An unanswered clash counts as Skip, and a drop that arrives while the banner is open is ignored.

**Move and rename.** A move across volumes is refused (`CrossesDevices`); the user can copy and delete. A case-only rename works (same-file check by canonical path). Every open document under the renamed or moved path is rebound in Rust (`Documents::rebind`) and the page's tabs follow (`documentMoved`), so a later save writes the new path (ISC-219). Links to the renamed file are not rewritten yet; T5 and T6 do that.

**UI.** The name box commits on Enter and cancels on Escape or blur. A new file or folder is selected and revealed; a file is not opened. Pointer-drag moves use window pointer listeners with a 5 px threshold, Escape cancels, and the click that ends a drag is swallowed. There is no autoscroll while dragging. F2 and Delete work when the tree itself has focus; clicking a Markdown row moves focus into the editor, so they do nothing until a folder or a non-Markdown row is clicked. A folder dropped on blank tree space becomes a root; on a row it is copied into that folder (a file row means its parent). The mock host's folder copy skips empty subfolders; Rust's does not.

**Focus bug found in the real window.** After Rename from the context menu, typed text went into the editor, because the menu handed focus back to the row. `onMenuClosed` now focuses the name box, or the tree. Unit tests could not see it; the first real run did.

**Evidence.** Rust: 194 tests pass. Web: `tests/features/fileOps.test.ts`, `copyDrop.test.ts` (19), `tests/lib/fileNames.test.ts`. Real window (debug build, DevTools port, Windows 11, display scale 100%): 27 of 27 checks, including four real OLE drops. Breaks on purpose in Rust and in the page each failed a test.

**The drag-script flake, explained.** In T1 and again at the start of T2 the native-drop helper hung for 45 seconds with no output. A log showed the mouse-down reached the source window and `DoDragDrop` started, then nothing: `DoDragDrop` runs a modal loop on the UI thread, and the timer that drove the mouse lived on the same thread, so it stopped ticking. The fix is a second helper (`drag2.ps1`) that moves the mouse from a second runspace; it worked on all four drops since. The helper is outside the repo.

**Test cleanup.** Test files sent to the Recycle Bin were restored into the temp fixture and deleted again. One "Replace or Skip Files" prompt from Explorer appeared during the restore and was cleared. The real Recycle Bin holds none of them now.

## P6-T3: text and image tabs, drop to open

**What a file opens as.** By extension only, in Rust (`fs/kind.rs`): Markdown (md, markdown, mdown, mkd, mdx), image (png, jpg, jpeg, gif, webp, svg, bmp, ico, avif), anything else text. A text tab is the same document with `parser: false`, so it has no highlighting, preview, link checks, smart paste or list editing. The format keys (bold, italic, code) still act on a text tab, as they do in large-file plain source; I left that alone rather than add a second rule. A binary file opens read-only under the existing encoding notice (seen in the real window).

**One tree click opens any file.** It used to open Markdown only. Image and text rows are no longer dimmed-and-inert.

**Images.** An image tab holds a path and a size, and Rust holds no document for it. `image_info` adds that one file to the asset scope, which cannot shrink until restart (the same Tauri limit as roots; this is the user's call to revisit). Rust keeps a list of shown images so `session::open_paths` grants them at the next start, and `image_closed` drops one when its last tab closes. The page loads the picture through `<img>`, never inline. Zoom and pan are not kept across tab switches (the view is keyed by tab).

**Drops.** `drop_open` describes every path first and grants only if all were delivered, so one stray path grants nothing. The page opens each file in the pane under the pointer (found by `data-pane-id`), or the active pane over blank tree space. A file already open in another pane opens a second tab in the pane it was dropped on. An image dropped on document text does nothing; inserting a link there is P9-T2.

**Mock host.** Images come from `platform/demoImages.ts` (two generated PNGs), and a scripted SVG for the inertness check. The hex colour in the mock was replaced by a named one for check-arch.

**Evidence.** Rust: 202 tests pass; T3 added tests in `fs/kind`, `workspace` (`drop_paths_only`, 5 in all, and the image command) and `session` (the image grant). Web: `kinds` (12), `dropOpen` (10), `imageView` (11), `frame` (9), plus new cases in `tree`, `fileOps` and `session`. On `pnpm dev`: fit, zoom 42% to 89%, pan, details, and an SVG whose script did not run while the same file in `<object>` did. Real window (debug build, Windows 11, display scale 125%, devicePixelRatio 1.25): 17 of 17 checks, with two real OLE drops on a right pane while the left was active, a PNG on the tab strip, a PNG on text (nothing opened), refusals from Rust, and an image tab restored after a restart. Twelve page breaks and six Rust breaks each failed a test.

**Two script mistakes in the real run, not app bugs.** A split clones the open file into the new pane, so the right pane started with `a.md`; and only the active tab draws its image, so the restart check had to select the image tab first.

## P6-T4: link scanner

**The split with P6-T5.** The claims ISC-116 to ISC-121 and ISC-124 say "rewrite covers X" and their tests are named `rewrite_*`, but the task is the scanner. T4 therefore also builds the pure edit step for one link, and each claim is proven by scan, edit and exact output. T5 keeps the planning: which links point at the old path, the new relative path, links inside moved files, folders, atomic writes and collected failures. ISC-125 (nothing outside targets changes) stays with T5; T4 only shows the decode, edit and encode round trip for CRLF, a BOM and UTF-16.

**Output shape.** `scan(&str) -> Vec<Link>`; each `Link` has `form` (inline, image, reference, html image, html anchor), `span` (bytes of the path part only, without `<>`, quotes, `#fragment` or title), `raw`, `path` (escapes undone), `wrapping`, `percent` and `line`. T6 and T9 call the same function, and the walker is separate so T6 can report progress per file.

**Offsets and line endings.** The frame normalises line endings to `\n`, so offsets from a normalised string would not match the file. The scanner takes the decoded text before that step and `\r\n` stays in it; T5 splices that string and encodes it with the file's own `Format`. For an open document the page works on the normalised text, and a scan is line-ending agnostic.

**What is skipped.** Fenced code (also inside quotes and list items) and inline code spans: a code sample is never rewritten. A reference usage has no target; only its definition does, and only when it sits on one line. Absolute and network paths, any target with a colon (a scheme, a drive, a stream), anchors and empty targets. Indented code blocks are not recognised, because an indented line can be a list continuation, so a link-shaped line in one is rewritten. Wikilinks and `srcset` are not in the plan.

**The walker.** Every file counts except anything named `.git`, links, junctions and mount points (counted, not followed) and binary files. The tree hides nothing today and `folder_exclude_patterns` appears only in the plan, so I built no setting; `rewrite_excluded` proves that `node_modules`, `.obsidian` and similar folders are walked. A file is binary when its first 8 KiB, or its whole text when it is valid UTF-8, has a NUL byte and no UTF-16 mark. UTF-16 without a mark looks like UTF-8 full of NULs and is skipped as binary. A file in an encoding mdmate cannot write (Latin-1) is reported as `Encoding` and never rewritten, which narrows the plan's "only `.git` and binary files are skipped"; I chose it because the app refuses to save such a file, so rewriting one would break its own rule. This is an open question for the user.

**Escaping on write.** A new path keeps the style of the link: an escaped link stays escaped, `<...>` keeps spaces and parentheses raw, a bare link gets a space as `%20`, and a character the form cannot hold raw is escaped whatever the style. A randomised round trip over ten forms and 4,400 names checks that what is written reads back as the same path.

**Lint.** The scanner and walker have no caller outside tests until T5, so the modules carry `#[cfg_attr(not(test), expect(dead_code, ...))]`; T5 must remove it, and the compiler will say so.

**Evidence.** Rust: 227 tests pass, 25 of them new (18 in `links::scan`, 7 in `links::walk`). Each of the seven `rewrite_*` test names in the ISA matches exactly one test. 22 breaks on purpose were tried (fences, spans, the anchor split, indentation, angle and escape rules, tag and attribute case, escapes, parentheses, line counting, `.git`, an extra skipped folder, UTF-16, NUL, link counting) and 19 failed a test at once. Three survived and were dealt with: a scheme check that the later colon check already covers was removed; the link-skip test had returned early because creating a symbolic link needs a privilege, so it now makes a junction, then both link breaks failed it; the early NUL sniff only saves reading and changes no result, so it stays a survivor.

**Real window.** None for T4: nothing in the app calls the scanner yet, so there is no command to drive. P6-T6 runs it in the app, and the first real-window rename in T6 is where it gets looked at on screen.

## P6-T5: rewrite engine

**Two calls around the move.** `plan` runs before the move and `apply` after it. The prompt in P6-T6 can therefore show "N links in M files" and, on No, nothing has changed. A plan holds, for each changed file, where it is now, where it will be, the hash of the bytes read, and each edit as span, old text and new text.

**When a link is edited.** For each link the engine finds where it leads now (names only, with `.` and `..` worked out), where that place will be after the move, and where the file itself will be. If the same link text, read from the file's new folder, reaches the new place exactly as spelled, it is left alone. That one rule covers a link to the moved thing, a relative link in a moved file, a link to a moved folder, and the case where a file and its target move together. A link that climbs above the root of its path is skipped. A link between different drives cannot be written relative; it is counted in `unrelatable` and left as it is.

**Case.** Whether a link points into the moved thing ignores case where the file system does (the caller passes `ignore_case`), but whether it is still right compares the spelling, so renaming `Old.md` to `old.md` rewrites links to `Old.md`.

**Style.** The new target is the relative path with forward slashes, in the escaping style of the old link (`Link::render`), with a leading `./` and a trailing slash kept. A link written with backslashes comes back with forward slashes.

**Apply.** Each file is checked in this order: read-only, then the hash of its bytes against the plan, then that each span still holds the planned text, then written through the atomic writer in its own encoding. Any failure is listed with its path and reason and the others go on. A file whose bytes would not change is not written. Read-only is checked by the engine (a rename over a read-only file would succeed on Linux and macOS), so the failure reads the same everywhere.

**Roots.** The plan takes every workspace root and reads a file once, however many roots hold it. Links in files outside every root are not read. Open documents are P6-T6: the engine writes closed files, and T6 must keep it from writing a file that is open (a dirty tab gets undoable edits from the same plan).

**Evidence.** Rust: 248 tests pass. The four named property tests use a seeded generator (no crate), so a run repeats; each builds a workspace, plans, moves on disk, applies, then reads every file again and checks against the OS, not against the engine's own path code. 20 tried (the choice of what counts as still right, mapping of targets and of the moved file, the steps up, case, the trailing slash and leading ./, the hash, read-only and span checks, verbatim paths, cancel, two roots, reporting, writing at the new place, and stopping at the first failure): 17 failed a test at once, and 3 survived and were fixed with a stronger test (the progress callback is now counted, a case-spelling path case was added, and a shell-escaping slip in one mutation was redone)

**Real window.** None for T5: nothing in the app calls the engine yet. P6-T6 wires it up and checks it on screen.
