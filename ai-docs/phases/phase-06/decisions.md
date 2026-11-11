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

## P6-T6: rewrite UI

**Scenario `typing-during-scan` (ISC-129), written down before its first run.** It is the `typing-1mb` scenario with nothing changed: the same 1 MB document, caret, keys (30 warm-up and 300 kept, 50 ms apart plus the random frame jitter) and the same measure, work per key, p95 against 16 ms. The only addition is a real `rewritePlan` scan over a large workspace running the whole time: when one scan ends the next starts at once, so every key, warm-up keys included, is typed while Rust reads the workspace. Each plan is discarded and nothing on disk changes. The workspace is generated by `scripts/lib/workspaceFixture.ts` into `tests/fixtures/generated/workspace-large`: 8,001 Markdown notes (9.6 MB) in 80 folders, about 825 of them linking to `target.md`, which the scans plan to rename. It is a separate script, not part of `fixtures.mjs`, so the fixture tests and their pinned file list are unchanged. The run reports the scan time, the number of scans completed, the files read and links found per scan, and the longest gap between two scans; the claim is read from the typing numbers, and a scan that did not overlap the keys would show as a large gap. The page mounts only the editor, as every typing scenario does; the sidebar banner is not part of the measure. If p95 is at or above 16 ms I stop, record the numbers and the cause here, and ask.

**Flow.** A rename or move is two Rust calls. `rewrite_plan` runs first: it validates the move (`rename_target` or `move_target`, the same checks the move itself uses), scans every root in the background, keeps the plan in app state under a token and returns the counts. The page asks, and `rewrite_move(token, buffers)` then does the move (`carry_out`) and applies the plan. A plan is taken only by its own token and used once; Cancel, Don't update and a new plan all drop the old one, and Don't update moves with `move_entry` as before. Scan progress arrives on a channel, at most once every 75 ms, and Stop sets a flag the scan checks as it reads files.

**Open documents.** The engine never writes a file that is open in a tab. A clean tab is written like a closed file and named in the result so the page reloads it. A dirty tab is edited in the editor: the plan leaves its file out and Rust works out the same edits from the text the page sends, read from where the document was before the move, so a document that moves with its folder is still read correctly. The page sends the ids of the documents that are dirty when the answer comes plus those dirty when the plan was made, and applies the edits as one undoable step only if the text is still what it sent; if it changed, the file is listed as failed and nothing is applied. The edits keep the document dirty and never touch the disk.

**Setting.** There is no settings system yet (P8-T1 writes `settings.json`). `links.confirmRewrite` is a small reactive object in `src/lib/settings.ts` with the default true, so the behavior and its tests exist now and P8-T1 only has to fill it from the file. Until then the user cannot turn the prompt off, which is in untested.md and in the final report as a question.

**Mock host.** The browser host rewrites inline links only, enough to show the prompt and the result in `pnpm dev`; every other link form is proven by the Rust tests, and the real window run used the real engine.

**Evidence.**

- Web tests: 22 in `tests/documents/rewrite.test.ts` and `tests/features/rename.test.ts`, 1124 in the whole web suite on the last full run. The full suite failed on one editor test in each of two earlier runs (`checkbox` and then `blockquotes`), a different one each time, and each passes alone and the third full run passed; I did not capture those failure messages, so the cause is not known.
- Rust: 259 tests pass; the flow has its own tests (plan changes nothing, cancel keeps nothing, dirty and clean open documents, a document that became dirty after the plan, a dirty document that moves with its folder, one-use tokens, no plan when nothing links, wide characters cut by UTF-16 units, a stopped scan dropping the older plan).
- Real window (`real4`, debug build): 13 checks passed, listed in ISA Verification for ISC-123 and ISC-175. The first two attempts failed on my script (F2 went to the editor because opening a row gives it focus, and the live preview hides a link's target unless the caret is inside it); the app was right both times.
- Performance: `pnpm perf typing-during-scan` p95 8.90 ms against 16 ms; numbers in ISA Verification for ISC-129. The gate was met, so nothing was changed to make it pass. The first batch had a run in which the single scan was still unfinished when the keys ended (no scan completed), which I do not understand; I did not see it again in the second batch (25 scans in every run).


## P6-T7: quick open and command palette

**One picker, two modes.** Ctrl+P (`file.quickOpen`, "Go to File...") and Ctrl+Shift+P (`view.commandPalette`, "Show Command Palette...") open the same component with a different list. It loads the first time one opens: `AppShell` holds it with `defineAsyncComponent` behind `v-if`, and everything else knows only `features/palette/state.ts`. A source-map build shows the picker and its row code in their own chunk, `fuzzy.ts` in another, and only `state.ts` in the entry; the `palette-lazy` arch rule fails any static import of the picker or its row code from outside the folder.

**What the file index holds.** Every file under every root except `.git` (the walk the link scan uses; symlinks are not followed). Not just Markdown: the tree opens text files and shows images, so the picker finds them too. With more than one root the path starts with the root's folder name. The index is built on the first query, so nothing is read before the first Ctrl+P, and it is rebuilt in the background every time the picker opens, so a file made by another program a moment ago is there on the next look; a second build never starts while one is running. A watcher would be more exact but costs a standing process, and the tree already has its own listing. The index stops at 250,000 files and the footer says so.

**Matching.** The letters must appear in order. Case does not matter and spaces in the query are ignored. Ranking by points: a letter after a slash scores most, after `-`, `_`, space or a dot a little less, a lower-to-upper change less again, a run of adjacent letters beats scattered ones, a letter in the file's own name beats one in a folder, a gap and a late start cost a little, and the case that was typed adds two. Ties go to the shorter path, then alphabetical. For nothing typed the files are listed in path order. Positions of the matched letters are UTF-16 offsets, so the page can mark them in a string without converting. A query is cut at 64 letters.

**Two scorers.** Rust for the files (it runs against the real index) and TypeScript for command titles and the browser stand-in; the constants are the same and each has its own tests. The browser stand-in is not the Rust code and proves only the page.

**Commands.** The list is the registered commands, by title for nothing typed. A command that cannot run now is shown greyed with its shortcut and does nothing when chosen, with the palette left open, so the user sees it exists instead of wondering where it went. The two commands that open a picker are not listed in it. The palette closes before the command runs, since many commands act on the focused editor.

**Keyboard.** Arrows move and wrap, PageUp and PageDown move eight rows and stop at the ends, Enter chooses, Escape closes, Tab does nothing (focus stays in the box). The same key that opened a picker closes it and the other key switches. Every other shortcut is held off while one is open, so Ctrl+S or Ctrl+W cannot act on a document the user cannot see. Closing gives focus back to where it was, unless something else took it meanwhile.

**Evidence.**

- Rust: 284 tests pass, 25 of them for the index. Web: 1174 tests, 46 for the picker and the scorer, and 4 for the arch rule. `pnpm check` and `pnpm check:rust` exit 0.
- Real window (`real5`, debug build): 20 checks passed, listed in ISA Verification for ISC-130 and ISC-131. A real OS Ctrl+P and Ctrl+Shift+P, sent to the app window while it was in the foreground, opened the pickers and WebView2 did not open Print.
- Mutations: 24 in Rust and 39 in the page, listed in ISA Verification. The first stale-answer test was timing dependent (it passed once with the guard removed); it now releases the slow answer itself.
- No speed gate is named for the picker, and none was measured; the first query in a very large workspace is in untested.md.

## P6-T8: untitled tabs, Save As, Revert, Close All, Open Recent

**An untitled document is an id.** Rust keeps a set of ids for it and nothing else: no path, no entry in the table of open documents. So the watcher never sees it, the workspace never lists it and no recent entry can point at it. The first save writes the file, then `promote` gives the id its path; if the write fails or the dialog is cancelled the id stays untitled. `promote` refuses a path another document has open, and the same check runs first in `save_as`, so the user gets a plain message instead of two documents on one file.

**Save As is one Rust command.** `save_as(state, id, body, chooser)` takes the dialog as a parameter, so tests choose a path without a window. Rules: a file open in another tab is refused (nothing is written); the original of a document that cannot be written (the Latin-1 case) is never the target; the document's own file is a plain save, with the disk-changed guard; a name with no extension gets `.md` and is refused if that file exists; the format is the file's own encoding and BOM when it has them and UTF-8 with no BOM when it has none; line endings default to LF. A hint sent by the page (name, folder) is cleaned in Rust (folders and characters Windows forbids removed) before the dialog sees it.

**The page keeps the document.** Save As moves the same `Document` to the new file (`relocate`), so undo history and the caret stay. The saved baseline is the text that was written, so the tab is clean. Two things do not change: the kind of tab and the plain-source choice made when the file opened (a copy of a large file stays plain source; a .md copy of a text file stays a text tab until reopened).

**Name and folder offered.** The name is the first heading as a slug (letters and digits, accents kept, 60 characters at most, fences skipped, `#tag` is not a heading), else `Untitled.md`. The brief says "the active pane's root"; I read it as the workspace root that holds the first file tab (the active tab first, then the other tabs of the pane), else the folder of the last file opened or saved. If the owner meant something else (the root the tree has selected, say) it is one function.

**Recent files.** `recent.json` in the data folder: newest first, 10 files and 5 folders, written atomically, pruned of paths that no longer exist each time it is read. Only Rust adds to it: `open_file` with `remember` (every open the user makes: the dialog, a tree click, the picker, Open Recent; a session restore does not remember), `open_folder` and Save As. A recent entry is granted access again only if it is on the list, so a forged id cannot grant a path. The page cannot write the list.

**Hot exit for untitled tabs.** The tab entry is `{id, path: '', caret, kind: 'untitled', untitled: n}` and the buffer carries the same number. A restart makes a new id in Rust per untitled tab and puts the text back as an edited document (so it is unsaved, not empty). Numbers rise during a run and are not reused. Text with no tab (a layout that lost the tab) goes to `recovered/Untitled-N` with a notice, and a damaged line-ending record does the same.

**Close All.** `closeTabs(tabs)` asks once per dirty document, in tab order, through the pane banner; Cancel stops the queue and closes nothing that was not answered. A question replaced by another resolves as cancel; a document released by another route resolves as gone, so the queue moves on. P6-T9's Close Others uses the same call.

**Revert File.** The question is a pane banner (Revert, Cancel). The command is off for an untitled tab and for a file known to be gone. "Gone" is looked at when the active document changes, when the window gets focus, when the menu opens and again at the moment of the request, so the menu state can be stale for the time between those (a file deleted while the window has focus and the menu is closed). A request on a stale "present" looks again and says so instead of asking for nothing.

**F2** is the same command as Rename. For an untitled tab it is Save As (there is no name to change); for a file on disk it stays off until P6-T9 wires the rewrite flow to it.

**Finding for the owner (ISC-209).** Save As on a read-only document writes what the page shows as UTF-8. That is lossless only for true Latin-1. A file in another encoding that mdmate cannot read (UTF-16 with no BOM, for instance) is shown through the same fallback, so its UTF-8 copy holds the characters shown, not the original ones. The original is never touched. Not fixed here: a second decoder is not in the plan. Written in untested.md.

**Evidence.**

- Rust: 308 tests pass. Web: 1251 tests (untitled 17, Save As 11, Revert 11, Close All 9, recent 8, session additions). `pnpm check` and `pnpm check:rust` exit 0.
- Real window (`real6`, debug build with the perf feature, Windows 11): 45 checks passed, listed in ISA Verification for ISC-203 to ISC-212. Real OS Ctrl+N, Ctrl+S, Ctrl+Shift+S and Ctrl+Shift+W went to the app window while it was in the foreground, and the Windows Save As dialog (and its own overwrite question) was driven through UI Automation. A forced kill kept an untitled buffer.
- Mutations: 27 in Rust and 42 in the page, listed in ISA Verification; 7 survived and were fixed with new tests, all caught on a second run.
- Screenshots: the first Open Recent menu showed every file name cut to "old....", "readme..."; fixed (the name never shrinks, the folder path does) and checked again with a long name.

## P6-T9: tab context menu and Find File References

**The menu works on the tab that was clicked.** Every function in `workbench/tabMenu.ts` takes a tab id, so Copy Path, Close Others and the rest work on a tab in the background. A right-click does not activate the tab (the pane already takes focus on the pointer press). Close on a background tab with unsaved edits uses `requestCloseTab`, which selects the tab and shows the pane banner, so the question is never about a tab you cannot see.

**Close Others** closes the other tabs of that pane only (`closeTabs`, the call Close All uses), asking once per dirty document; Cancel stops. The kept tab is the only one left, so it is the one shown; a `selectTab` after the call did nothing and was removed.

**Copy Path and Copy Relative Path.** (Separator changed 2026-11-11, ISC-243: the relative path uses the same separator as the full path, so on Windows both use backslashes; the sentence below about "/" is the first version.) The path is copied as the tab holds it (native separators on Windows), through `navigator.clipboard`. The brief allows a plugin only if WebView2 refused; it did not (`Get-Clipboard` read back the path), so no plugin was added. The relative path is from the innermost open folder that holds the file, with `/`; a file outside every folder copies its full path. `rootOf` now returns the innermost of two nested folders (before, the first match won).

**What is off.** Copy and Reveal in File Explorer need a path, so they are off for an untitled tab. Reveal in Sidebar and Rename need the file inside an open folder (the tree has no row for another file), so both are off outside every folder. **Open question:** a file outside every folder cannot be renamed from the tab. A rename of such a file would need a way to ask Rust for access to its folder; it is not in the plan, so I left it off and said so in the menu state, not in a message. Rename on an untitled tab is Save As.

**Rename and F2.** The menu item and F2 run one function: show the sidebar's folder list, reveal the row, open the tree's name box. So the question about links, the report and the tab following the file are the rename's own (the same path a rename from the tree takes), and a page test shows both. F2 stays Save As for an untitled tab.

**A bug only the real window showed.** After Rename the menu closed and Radix gave focus back to the tab, which blurred the name box; the box cancels on blur, so the rename vanished and the typed name went into the editor. The tree's own menu has a guard for this (`@close-auto-focus`); the tab menu now has the same one (`keepNameBoxFocus`), with a page test and the real run.

**Find File References is a Rust command.** `find_references` walks every open folder, reads each file once (an open document with unsaved edits is read from its buffer), and keeps the links that lead to the target. It uses the rename's own resolution (`Wanted`, which uses the same path joining and comparison as the rewrite plan), so the list is what a rename would rewrite; a test compares the two, including a file's link to itself. Limits: 2000 links (a line is cut at 200 characters) with a flag that says so; files it could not read are listed. Columns are UTF-16 units, as the editor counts them. The order is by file name ignoring case; the links of one file stay in the order written (the sort is stable). The mock host reads inline links only, so the page tests prove the page and the Rust tests prove the search.

**The panel.** A References panel in the sidebar: a title ("Links to name"), "N links in M files", files with line number and text, click to open the file with the caret on the link. The sidebar header gets Folders and References buttons and a close button while a list exists. The list is a snapshot: it is not refreshed after later edits or renames. A click on a reference opens the file even if it changed since; the caret is kept inside the line.

**Finding for the owner (ISC-218).** The claim says "the active file". The command works on any tab (menu) and on the active tab (command palette: "Find File References"); there is no key for it. Say if you want one.

**Evidence.**

- Rust: 318 tests pass (10 for references). Web: 1300 tests (tabMenu 30, references 15, rename 18). `pnpm check` and `pnpm check:rust` exit 0. The full web suite failed once in the third full run on the known flaky `checkbox` test (untested.md row 24); it passes alone and on the next full run.
- Real window (`real9`, debug build with the perf feature, Windows 11): 29 checks passed, listed in ISA Verification for ISC-213 to ISC-218. The first run found the name-box focus bug (above); two of my script's own mistakes (a wrong element for the banner, a lost backslash in a template) were fixed in the script, not the app.
- Mutations: 26 in the page and 12 in Rust, plus 2 on the focus guard; listed in ISA Verification. Survivors were dead code (removed), missing tests (added), and one that changes no output (kept).
- Screenshots (looked at): the menu on a background tab, Reveal in Sidebar, the question on a dirty background tab, the rename question, the References panel, and a reference opened at its line.

## P6-T9 follow-up: Rename outside a folder and a key for Find File References

**Rename of a file outside every open folder stays off, with a reason.** Rust could grant the parent folder, but that would let the page read and write every file beside it (Downloads, a desktop, a home folder), which `Access` is built to prevent. A narrower route exists (rename a file the user opened by itself, inside its own folder, and grant only the new name), but the tree has no row for such a file, so it needs a name field in the pane. The owner chose not to build it. The Rename item stays visible and off, and its tooltip says "Only a file in an open folder can be renamed." The reason is shown by the shadcn `Tooltip` (a trigger on a wrapper around the item, because a disabled item takes no pointer events), drawn with the menu's own tokens (`bg-popover`, `text-popover-foreground`, a ring), so it follows the dark and light themes. A first version used the native `title`; the owner ruled that tooltips are always the shadcn component. One `TooltipProvider` sits in `App.vue` (300 ms delay). Save As still makes a renamed copy. **Limit:** the reason shows on mouse hover only; keyboard, touch and screen reader users do not get it (untested.md).

**All native `title` tooltips converted (ISC-222).** The owner said to convert every one, not only Rename. The eight sites are now `HoverHint` (a thin wrapper holding the shadcn Tooltip): the tab (bottom), a tree row (right; none while the row is a name box), a recent item in the title-bar menu (right), the two paths in the rewrite banner, and the References target, file group and "could not be checked" list. A scan test fails the build on a new native `title`. **Speed after the conversion** (release build with the perf driver, Windows 11, not the same display as the first speed run): launch 509.5 ms (1500), tab-switch p95 15.6 ms (50; one of five runs 27.4, not repeatable, as before), reveal p95 4.3 ms (16), typing-1mb p95 6.4 ms (16). One Tooltip per tab and per drawn tree row did not move a gate. Hover tests cover the tab, a tree row, a References file and the name-box case; the title-bar item and the banner paths are covered by the scan and the real-window run only.

**Shift+F12 runs Find File References.** It is the key VS Code uses for Find All References and means nothing to the browser. Ctrl+Shift+R was not used: WebView2 treats it as hard reload and the app does not turn the accelerator keys off. The menus show the shortcuts from the commands (F2 and Shift+F12) instead of fixed text.

## Phase 6 end

**Speed set.** Run on a fresh release build with the perf driver after P6-T9, Windows 11 Pro 10.0.26200, one built-in display (1536 x 960 logical) at the Windows scale setting of 125% (AppliedDPI 120). The perf report does not record the window's devicePixelRatio, so that label comes from the system setting. All gates are within target; none was changed and no scenario's way of measuring was touched.

| Claim | Scenario | Result | Target |
|---|---|---|---|
| ISC-4 | startup, launch to editable | 590.2 ms (5 runs, repeatable) | 1500 ms |
| ISC-5 | open-1mb, warm open | 27.1 ms (repeatable) | 100 ms |
| ISC-6 | tab-switch, p95 | 20.0 ms (19.2 to 24.9; flagged not repeatable, one run 25% high) | 50 ms |
| ISC-7 | typing-1mb, work per key p95 | 7.8 ms (repeatable) | 16 ms |
| ISC-129 | typing-during-scan, p95 | 8.9 ms (scan 961 ms) | 16 ms |
| ISC-58 | reveal, work per leave p95 | 6.3 ms | 16 ms |
| ISC-63 | decorations-scale, worst deviation | 0.233 (middle 1.05, late 1.23; same work both sizes) | 0.35 |
| ISC-72 | scroll-stability, worst drift | 1 px up, 0.15 px down (control 628 px) | 2 px |

**Also run (T8 changed hot exit).** Same build, 5 runs: crash-restore restored 5 tabs and 3 unsaved buffers in 153.8 ms, everything exactly as it was (journal 829 ms after the last edit, interval 1000 ms); typing-1mb-trusted work per key p95 8.4 ms against 16, repeatable. Not rerun: journal-cost and asset-scope (open fog items) and ISC-138 (no scenario yet, claim open).

**Display scale, corrected.** The scale above is the Windows setting read before the run (one built-in display). When the follow-up real-window run was made a second display (1920 x 1200) was attached and the app window opened on it with devicePixelRatio 1, so the scale the speed run's own window had is not recorded and cannot be recovered from the report.

**Fast probes.** All `check-arch` rules pass. `languages-lazy` and `palette-lazy` were inspected on a build with source maps (`vite build --sourcemap` into a temp folder, then `--dist`); the plain `pnpm check` run says "build not inspected" for the bundle half because the default build has no source maps, so that half is only read when the build is made that way. ISC-8, ISC-99 and ISC-182 test files pass.

**ISC-63 watch.** Held: same work at both sizes, worst deviation 0.233 against 0.35.

**Fog.** The ISA's `Not yet specified` section is empty, so there is no fog to resolve or turn into claims.

**Note on ISC-6.** The tab-switch spread is run 4 alone (24.9 ms); medians are 17.2 ms and the other four p95 values are 19.2 to 20.5 ms.

## Owner UAT findings (ISC-223 to ISC-233)

The owner walked `.docs/uat-phase-06.md` on 2026-11-11 and sent 11 findings. A grilling round settled every design question and the owner agreed with all of it. Each finding below is one commit.

**Tab menu and tab hints (ISC-223, ISC-224).** The reported "no context menu on tabs" did not reproduce at the commit before the fix: a real OS right click opened the menu with the hint showing and without. I could not find a cause, so it is recorded as not reproduced. The hint still moved off the tab onto its label, which restores the old shape (`ContextMenuTrigger` wraps the tab alone) and is where the truncation check belongs. A tab hint shows only while the name is cut off; tabs and tree rows wait 1 s (`SLOW_HINT_DELAY`); other hints keep 300 ms. The provider's skip delay is 0, otherwise a second hint right after the first would open at once. A tree row still shows its full path when its name fits, because the path is not otherwise on screen.

**Tooltip arrow (ISC-225).** The arrow was a rotated square with a full ring, so its inner half drew over the box. Now only its two outer edges carry a border (the popper turns the arrow for each side, so they are always the outer pair), and its fill is the popover color, which also cuts a clean notch in the box edge. Looked at on the bottom and right sides, in both themes; top and left are the same code and were not captured.

**Hints drawn inside the editor (ISC-226).** The editor is a CodeMirror DOM, outside Vue, so the shadcn Tooltip cannot wrap what is drawn in it. Three native titles lived there: the broken link ("Missing file"), the frontmatter pill and the reason an image did not load. They are now `data-hint` attributes, and one small plugin (\`src/editor/hoverHints.ts\`, in the state every tab gets) draws a hint for any element that has one: 300 ms wait, popover colors, ring, shadow and an arrow, so it follows dark and light like the shadcn tooltip. It hides on leave, press, key, scroll, edit and when the view goes. It does not use CodeMirror's own \`hoverTooltip\`, which finds things by text position and cannot reach a widget. The no-native-title scan now covers \`.ts\` files; a Markdown image's own title stays native because it is document content.

**Delete asks first, and closes the tabs (ISC-227, ISC-228).** This reverses the P6-T2 call that Delete asks nothing because the Recycle Bin is the undo: the owner wants a confirmation, in a themed shadcn dialog and not a native one. It is a modal `AlertDialog` (the first in the app; every other question stays an inline banner), shown by the menu's Delete and by the Delete key alike. It names the file or folder, says it goes to the Recycle Bin (the Trash off Windows), counts the open tabs that close and warns about unsaved edits, which are lost. Cancel has the focus, so a stray Enter does not delete. Confirming deletes, then closes every tab of the file or under the folder with no save prompt, since the dialog already said so (Sublime Text does the same). A host that cannot delete leaves every tab alone. A workspace root skips the question: it is refused with the Remove Folder hint. The generated overlay used `bg-black/10`, which the no-hard-coded-colors rule refuses, so it is `bg-background/60` now; a fresh `pnpm ui:add alert-dialog --overwrite` would put it back. A file deleted outside the app still keeps its "missing" marker.

**The sidebar menu gets the tab menu's path items, and the file-manager items are named for what they do (ISC-229, ISC-230).** A file has Copy Path, Copy Relative Path, Open Containing Folder and Find File References (with the Shift+F12 hint, read from the command like the tab menu's). A folder has the two copy items and Open Folder; a workspace folder has Copy Path and Open Folder, since its path from itself is empty. The copy code is the tab menu's: `copyPath` and `copyRelativePath` in `workbench/tabMenu.ts` take a path, and the tab versions call them. "Reveal in File Explorer / Finder / Show in File Manager" is gone: a file's item is "Open Containing Folder" on every system, tab menu included, and still selects the file where the OS can (Linux opens the folder, as before). "Open Folder" is a new host call, `show_folder` (the name `open_folder` was taken by the folder picker): `explorer.exe "<path>"` on Windows, `open <path>` on macOS, `xdg-open <path>` on Linux. It goes through the same access check as every path and refuses a file, because opening a file would launch whatever program the OS has for it.

**The sidebar is resized by its right edge, and the width is part of the session (ISC-231).** The edge is a 4 px separator (`role=separator`, focusable): drag it, press Left or Right on it for 16 px steps, or double click to go back to the default 15rem. It is held between 12rem (192 px) and half the window; the CSS carries the same limits (`min-w-48 max-w-[50vw]`) so a window that shrinks afterwards still shows a legal width. The Folders and References panels share one width, and hiding and showing the sidebar leaves it alone, because the width lives in `workbench/sidebar.ts` and not in the component. It is saved in the session snapshot's `workspace` object as `sidebarWidth` (px, left out at the default, version stays 1, read back only when it is a safe integer, then clamped to the window it is restored in), and a change to it is written by the journal like any other. I used a small pointer handle and not `ResizablePanelGroup`: that component sizes in percent and would resize the sidebar whenever the window does, which is not what a fixed-width sidebar does. `currentWindowWidth()` falls back to 1920 where there is no window, so the Node unit tests can restore a session.

**An image path may climb out of the document folder, up to the workspace folder (ISC-232).** `![pic](../img/p.png)` in `notes/b.md` drew only its alt text; it loaded only when `img` was moved into `notes`. The Phase 4 rule (an image must stay in the document's own folder) was cautious, because the parent folder was never granted. A workspace folder is granted to the image protocol as a whole when it is opened, so the limit can move up to it without a Rust change: `resolveImageAddress` takes a boundary, the workspace folder that holds the document (`rootOf`, handed to every document through `provideImageBoundary`), counts how many folders lie between the two, and lets `..` climb that many times and no more. Folder names are compared whole (`/wor` is not `/work`). A document in no workspace folder keeps the old rule. A path out of the workspace folder is still refused, and the protocol itself still answers 403 for a file outside it (checked in the real window: 200 for the file in the workspace folder, 403 for one beside it). The refused-image tooltip now names the workspace folder as well. The boundary is read when the images are scanned, so a folder added after a document opened is picked up the next time its images are scanned (an edit); the placeholder stays until then.

**An image tab keeps its zoom and pan (ISC-233).** The pane mounts an `ImageView` for the active tab only and gives it a `:key` of the tab, so a tab switch threw the view away and the next one fitted the picture again. The view is now written down on every change, per tab, in a module-level map in `workbench/imageView.ts`: the zoom and the spot of the picture at the centre of the pane (not the corner's position, so a pane of another size, as after a split or a window resize, still shows the same place), plus whether the tab was ever touched. A touched tab is recalled when its picture loads; an untouched one still fits, and still refits when its pane is resized. Nothing is written before the picture has loaded, because a click on a zoom button then would replace what is remembered. A closed tab is dropped through `onTabClosed`; nothing is saved across a restart (agreed, so that a restart fits every picture again).

**Speed set after the UAT follow-ups.** Run on a fresh release build with the perf driver after the last of the eleven (same machine and scale as the P6-T9 set: Windows 11 Pro 10.0.26200, 125% scale), 5 runs each. No gate was changed and no scenario's way of measuring was touched.

| Claim | Scenario | Result | Target | Before |
|---|---|---|---|---|
| ISC-4 | startup, launch to editable | 517.5 ms (repeatable) | 1500 ms | 590.2 ms |
| ISC-5 | open-1mb, warm open | 24.1 ms (repeatable) | 100 ms | 27.1 ms |
| ISC-6 | tab-switch, p95 | 16.9 ms (16.6 to 19.1; flagged not repeatable, one run 13% high) | 50 ms | 20.0 ms |
| ISC-7 | typing-1mb, work per key p95 | 7.3 ms (repeatable) | 16 ms | 7.8 ms |
| ISC-129 | typing-during-scan, p95 | 7.7 ms (scan 734 ms) | 16 ms | 8.9 ms |
| ISC-58 | reveal, work per leave p95 | 5.2 ms (repeatable) | 16 ms | 6.3 ms |
| ISC-63 | decorations-scale, worst deviation | 0.273 (same work at both sizes) | 0.35 | 0.233 |

The tab-switch run is flagged not repeatable again, as in the earlier set; every run is well inside the target. The decorations-scale deviation is higher than before (0.233 to 0.273) but inside the 0.35 limit, with the same decoration work in both sizes; I did not look into why, and no follow-up change touched that code.

## Keys shown in the context menus (ISC-234)

The owner saw F2 beside Rename in the tab menu but not in the tree menu, while both showed Shift+F12. The review found three menus that each decided for themselves: the title bar menu reads every key from the command registry, the tab menu wired two items by hand, the tree menu one. Option A was chosen: every item whose action has a key shows it.

- **Tab menu:** Close (Ctrl+W) and Close All (Ctrl+Shift+W) join Rename (F2) and Find File References (Shift+F12). Close Others has no key and shows none.
- **Tree menu:** Rename shows F2, Delete shows the Delete key, Find File References keeps Shift+F12, and Rename reads "Rename..." like the tab menu.
- **Delete is not a command.** The tree handles the key itself, so its label is a constant, `TREE_DELETE_KEY` in `features/tree/ops.ts`, used by both the key handler and the menu. Changing the key in one place changes both.
- **Known and accepted (untested.md row 44).** Ctrl+W, F2 and Shift+F12 act on the active tab, so a hint on a right-clicked background tab, or on a tree row other than the active tab's file, names the key that works on the active tab. Option B (show them only for the active tab) was not chosen.
- **Evidence.** Web tests for both menus; four deliberate breaks, each caught; real debug window shows the keys in the tree file menu, the tree folder menu and the tab menu (4 of 4 checks, a screenshot read).
- **Also fixed while writing this.** Earlier edits had left stray backticks at the start of lines in this file and in `untested.md` (tables did not render) and a few `§` placeholders; both are restored.

## UAT findings, round 2 (ISC-236 onward)

**Frontmatter pill (ISC-238).** The pill shows the word "Frontmatter" and nothing else. The key-listing code was deleted, not hidden: `frontmatterKeys`, the `keys` field on the scan item and the widget, and the style rule. The keys are still one click away, in the YAML the pill gives way to.

**Pointer cursor on Ctrl+hover (ISC-239).** The editor carries a class while Ctrl (Cmd on macOS) is held over a link that Ctrl+click would follow, and a rule in the links extension turns the cursor into a pointer then. It lives in `editor/links.ts` next to the click, so both ask `linkAt`. Excluded on purpose: links the check marked missing and links drawn inside table cells, because Ctrl+click does not follow those. Alt or Shift held cancels it, the same as for the click.

**Cursors while dragging a tree row (ISC-240).** A closed hand (`grabbing`) over a folder the row may move into, a `not-allowed` sign over any place it may not (itself, its own folder, empty space, the editor). The state is the `data-tree-drag` attribute on the root element, set by `features/tree/dragCursor.ts`; `tokens.css` maps it to a cursor on every element with `!important`. The same `moveProblem` that refuses a drop decides the sign, so the two cannot disagree.

**Handles take focus when pressed (ISC-241).** The sidebar edge and the splitters between panes are focusable separators, but a mouse press did not focus them: the sidebar handle cancels the press to stop text selection, and reka's splitter hears the press on the whole page, where the editor next to the 1 px handle gets it. The arrow keys therefore went to the editor's caret. The sidebar handle now focuses itself on a left press; a split handle is focused from reka's `dragging` event. The step sizes are unchanged: 16 px for the sidebar, reka's own step for splits.

**No browser menu (ISC-242).** One document-level capture listener (`lib/nativeMenu.ts`) cancels the browser's right-click menu except on editor text and text boxes, where cut, copy and paste have no other mouse route, and on the elements an app menu opens from. The second exception is the one that matters: reka opens its menu only when the event is not yet cancelled, so cancelling everywhere would have closed the tab and tree menus; the menu cancels the browser's own when it opens. Because Inspect lives in the browser menu, it can still be reached from editor text; F12 and DevTools are left to the Phase 8 setting (ISC-246).

**One path separator for both copies (ISC-243).** Copy Relative Path used to turn backslashes into slashes while Copy Path kept them, so on Windows the two looked different (`C:\uat\ws\notes\b.md` and `notes/b.md`). Both now use the separator of the full path, through `separatorOf` in `features/tree/model.ts`, which `joinPath` already used. A path with both kinds of separator gets slashes. Markdown link targets still use slashes (the link rewrite engine is untouched).

**Plain error messages (ISC-244).** The save error the owner saw came from the OS word for code 5. Rust now words I/O failures itself in `friendly_io`: by kind first, then a short list of Windows codes with no kind (kept in the platform layer as `Platform::os_error_words`, since the architecture check keeps OS-specific code there), then, for anything else, the OS text with the "(os error N)" cut off. `AppError::Io` shows that wording, so every command that returned an I/O error is covered, and the places that built their own strings (copy, link rewrite, references, opening a link, the Recycle Bin call) use the same function. A save to a read-only file gets its own kind (`file-read-only`) and the sentence "the file is read-only on disk. Use Save As to keep your changes in a new file", found by asking the file's attribute when the rename is refused. A file with the read-only attribute still opens as editable and fails at save (untested.md); that is how it behaved before.

**Scroll position per tab (ISC-245).** A pane reuses one editor view for every tab it holds, and the view kept its scroll offset when another tab's text was put in it. So a file opened after a scrolled one started scrolled, and a tab you left came back at the top. Each tab now remembers its place as a CodeMirror scroll snapshot (a spot in the text, mapped through edits made while the tab was in the background) and gets it back when shown. A tab shown for the first time scrolls to its caret. Returning lands 8 px below the saved pixel offset, constantly and with no drift. The place is kept in memory only; it is not part of the saved session.
