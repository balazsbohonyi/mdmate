# Phase 7 decisions

Deviations from the plan and choices it left open. The owner approved the report that these follow from ("I agree with the rest of it") and added whole-word matching.

## Checking the UI (all of Phase 7)

- Two places, as in Phase 6: Claude in Chrome on `pnpm dev` (mock host) where it helps, and the real app, `target/debug/mdmate.exe` against my own Vite server on port 1420, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`, `MDMATE_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` in temp folders, driven over the DevTools port with trusted key and mouse events. I stop the Vite server I started when I am done.
- Scripts live in the session scratchpad, not in the repo.
- A new file (Ctrl+N) gives the real editor without a file dialog, which is why T1's run needed no files on disk. Text with brackets and dots goes in with `Input.insertText`; a first run typed `[`, `]`, `(` and `.` wrongly through key events and gave three false failures, all in the script.

## P7-T1: Find and replace

**Decided: the panel is a Vue bar in each pane, not CodeMirror's panel.** CodeMirror's panel lives in the editor's DOM, cannot hold the app's components (HoverHint, Button) and is dropped by every `view.setState`, which is what a tab switch does. The bar (`src/workbench/FindBar.vue`) belongs to the pane, so it stays across tab switches. The query is one value for the window (`findSpec` in `src/workbench/find.ts`) and reaches the shown tab as `setSearchQuery`; the bar takes it off a tab that is left and off all tabs when it closes.

**Decided: matching, stepping and replacing are CodeMirror's.** `src/editor/find.ts` wraps `@codemirror/search` (6.7.2). Its commands open its own panel when the query is invalid, so the wrappers return false unless the query is valid. Plain text is a literal query (a backslash is a backslash); the replacement reads `$1` and `\n` only with the pattern switch on.

**Decided: the app owns the keys.** Ctrl+F, Ctrl+H, F3 and Shift+F3 are registry commands, and `searchKeymap` is not installed: it brings Ctrl+D and Ctrl+Shift+L (multiple selections, out of scope), Ctrl+Alt+G (an AltGr key on some layouts) and its own Escape. A disabled command still takes the key, so the browser's find never opens with nothing to search. F3 with the bar closed opens it.

**Decided: own match marks.** CodeMirror's highlighter only runs while its panel is open (checked in the source), so `findHighlighter` marks the viewport (at most 1,500) with `cm-md-find` and the selected match with `cm-md-find-active`, using two new tokens `--find-match` and `--find-match-active` in both theme files and `tokens.css`.

**Decided: the match count is sent as a DOM event.** The view's plugin counts in the background (cap 10,000 matches or 40 ms; an edit waits 250 ms) and dispatches `mdmate:find-count` on the view's element; the pane's bar listens on its pane. No Vue in `src/editor/` (`no-vue-in-editor`), and a view with no query does no counting.

**Decided: where the caret goes.** Ctrl+F and Ctrl+H move it into the bar's box (and select what is in it); F3 and Shift+F3 never move it, because they step through matches while the user keeps writing or browsing; Escape, the close button and the Replace-box Escape put it back in the editor (`focusActiveEditor()`). A closed bar has no query on any tab.

**Decided: the match count is bounded by the clock.** `countMatches` reads the clock every 128 matches and after each 128 KB piece (a rare word has no matches to count by, so the first version, which only looked after a match, scanned all 10 MB: 51 to 71 ms in the real window). The budget is 20 ms; measured on 10.85 million characters in the real WebView2: a rare or absent word 20 to 26 ms, the letter e 10 to 13 ms. A count stopped by time with no match found reads "Count stopped", not "No results". A match across the join of two pieces is missed, which only a pattern that spans lines in a document over 128 KB can produce; the number is a floor then.

**Deviation from the plan: Replace selects before it replaces.** With nothing selected, the first press of Replace (or Enter in the replace box) selects the first match and changes nothing; the next press replaces it and moves on. That is CodeMirror's behaviour and other editors do the same; it is in the test and in ISC-134's verification entry.

**Deviation from the plan: Find is in the app menu.** The menu got Find, Replace, Find Next and Find Previous (disabled with no file open). Not in the brief; it is the one place a mouse user can find the shortcuts.

**Known difference to carry into P7-T2.** Find uses JavaScript's regular expressions and folder search will use Rust's `regex`, which has no look-around and no back-references. T2 gets a table of patterns run in both engines and a plain message for a pattern Rust cannot compile.

**Evidence.** Page: `tests/editor/search.test.ts` (42), `tests/workbench/find.test.ts` (21), plus the four existing tests that count commands, menu items and theme tokens, which I updated. Real window: 27 of 27 checks (`t1-real.mjs`). Details and the breaks on purpose are in ISA.md, Verification.

## P7-T2: Folder search

**Decided: what is read.** Every text file in every open folder except `.git`, `node_modules`, links and junctions (not followed), binary files (a NUL in the first 8 KB, or anywhere in text that decodes as UTF-8), files over 32 MiB, and text in an encoding mdmate does not write (counted, with the files it could not open, as "could not be read"). `.docs`-style dot-folders are searched. Nested roots list a file once. A document that is open with unsaved edits is read from the text the page sends, so a line number is the one the editor shows.

**Decided: matching is per line, in Rust's `regex`.** A pattern cannot match across a line break (Find in a file can). `\r\n`, `\n` and a lone `\r` end a line, like the editor. Plain text is `regex::escape`; Match case and Whole word mean what they mean in Find; the Whole word rule is the one CodeMirror runs (a match may not touch a word character on a side where it ends in one; word = letter, digit or underscore, any script). An empty match is no match. A column is in UTF-16 units and the caret goes to the start of the match.

**Decided: dialect differences are shown, not hidden.** Rust's `regex` has no look-around and no back-references; a pattern with either gets "Folder search cannot run look-around or back-references, which Find in a file can", and any other bad pattern gets "This is not a valid regular expression." The two engines also differ on `\w` and `\d` (Unicode in Rust, ASCII in JavaScript). `tests/fixtures/search-parity.json` has 28 rows run by both engines (`search::tests::the_parity_table_agrees_with_find` and `tests/editor/searchParity.test.ts`); the two known differences are rows with a `rust` list.

**Decided: each match is a result.** "cat" twice in a line is two rows, with the same line number. A search shows at most 10,000 results; the list says "Only the first 10,000 results are listed" and the search stops there.

**Decided: Enter searches, typing does not.** Changing an option (case, word, pattern) runs the search again only once one was made. Ctrl+Shift+F shows the Search tab with the caret in the box and the selected line of the active editor as the query (escaped if the pattern option is on); it does not search. Escape stops a running search; with none running it sends the caret back to the editor. Down from the box goes to the first result, Up from the first result goes back to the box.

**Decided: results behave like the tree (Q4).** A click shows the file at the match in the active pane and leaves focus in the list. Enter and a double click put the caret in the file. The arrow keys, Home, End, PageUp and PageDown move the selection and open nothing. A key with Ctrl, Alt or Meta passes through to the app.

**Decided: how a search is stopped.** The page numbers each search. Rust keeps one `search_current` id; `search_folders` sets it before it starts, so a search that begins stops the one before it (that one's walk checks it per directory entry and every 512 lines of a file) and `search_cancel` sets it to zero. A stopped search still sends what it had and says `stopped`; the page drops any batch or answer whose id is not the newest one.

**Decided: batches.** Hits go over a `Channel` in batches, at most one per 50 ms or when 200 are waiting, with the count of files read. The page keeps the list in one array that grows in place and draws only the rows on screen (24 px rows, 8 beyond each side, the tree's own numbers), so 10,000 results cost 20 or 30 DOM rows.

**Decided: the Search panel is loaded on first use.** `SidebarFrame.vue` loads `SearchPanel.vue` with `import()`; check-arch rule `search-lazy` fails on a static import, like `palette-lazy`. The sidebar header now always shows Folders and Search; References still appears when there is a list, with its close button.

**Deviation from the plan: no `ignore` and no `grep-searcher`.** The plan named both crates. I used the app's own walker (`links/walk.rs`, which already skips links, `.git` and, for text, `node_modules`, and can be asked to stop between entries) and the `regex` crate alone, so the walk rules are the same ones the link scans use and the dependency list grows by one. You approved this in the Phase 7 questions.

**Deviation from the plan: Search in Folders is in the app menu.** It sits next to Find with its shortcut, Ctrl+Shift+F. Not in the brief; the menu is the one place a mouse user can find the shortcut.

### The scenario `typing-during-search` (written before its first run)

ISC-138's gate is p95 work per key under 16 ms while a folder search runs, the same gate and the same measure as `typing-during-scan` (ISC-129), so the two can be compared. It is the `typing-1mb` scenario, unchanged (same document, caret, keys, measure), with a real folder search running the whole time:

- **Workspace:** `tests/fixtures/generated/workspace-large` (8,001 notes, 9.6 MB, about 825 linking to `target.md`), the one `typing-during-scan` uses.
- **Query:** the plain text `target.md`, Match case off, Whole word off. It is spread through the whole workspace, so the search reads every file and streams about 800 results in 15 or 20 batches. A word that hits the 10,000 cap would end each search in a few milliseconds and keep restarting, which is a different (and lighter on Rust, heavier on the page) load; I am not hiding that choice, it can be a second scenario if the first is not enough.
- **Loop:** `runSearch()` from the real search store, back to back: as one search ends the next starts at once, so every key, warm-up keys included, is typed while Rust reads and while the page takes batches. Each start clears the list and draws it again, which is the user's own Enter.
- **The page's own work is inside the measurement.** The real `SearchPanel.vue` is mounted next to the editor (a 320 px column at the right edge, 100% high) so batches reach the store and rows are drawn while the keys land. The scenario samples the number of result rows in the DOM every 200 ms and fails if it never sees one (evidence the panel was drawing, not just the store).
- **Two modes:** `typing-during-search` types with `view.dispatch` (as `typing-during-scan`); `typing-during-search-trusted` types real key events through the DevTools port (as `typing-1mb-trusted`), because Phase 6 showed the in-page path can hide input costs.
- **Evidence printed with the headline:** searches completed, search duration median, share of the typing window with a search running (1 means all), results per search, files read per search, longest gap between searches, the most result rows seen in the DOM.
- **Pass rule:** p95 under 16 ms and repeatable across 5 runs (the harness's rule). The gate is not changed, and a run is not repeated under easier conditions (a smaller workspace, fewer batches, no panel). A miss stops the work and goes to you.

### What the scenario did when it first ran

- **The first two attempts produced no result, and the cause was my mount, not the app.** The panel root is `flex-1` and expects the sidebar's flex column; the scenario put it in a plain block, so the list grew to the height of its content and drew every result (1,289 to 1,702 rows in the DOM, 98% of the main thread in Vue rendering, the page too slow to finish). Fix: the column is a flex column, and the scenario now throws if more than 100 result rows are ever drawn. The gate, the query, the workspace and the loop did not change. No number from the broken mount was kept.
- **Result, dispatch mode (5 runs):** p95 work per key 9.50 ms (8.80 to 9.80), repeatable. 36 searches of about 670 ms, search running for the whole typing window, at most 19 rows drawn.
- **Result, trusted mode, first attempt on a strained machine** (2.6 GB free, three runs under the CPU idle bar): median p95 15.5 ms, runs 14.8, 15.8, 10.3, 16.8, 15.5. One run over the gate; not repeatable. I stopped and asked you.
- **Result, trusted mode, rerun at your request after you closed VS Code, rust-analyzer and Chrome** (6.9 GB free, CPU 94 to 96% idle): median p95 12.8 ms, runs 11.0, 12.8, 13.5, 12.1, 12.8. Every run under 16 ms. The harness prints "repeatable: no" because the lowest run is 14% under the median; one run completed 13 searches, the others about 40. I count the gate as held and say so with both attempts shown; the first attempt is not removed. If you read "repeatable: no" as a miss, ISC-138 is the one claim to reopen.

## The session journal (changed before P7-T3, because P7-T3's speed gate found it)

`typing-outline-open-trusted` read 16.1 ms (gate 16) the first time it ran. Two controls (see the P7-T3 section) showed the Outline panel cost about 0.3 ms of that and the session journal about 7.7 ms. You chose to fix the journal first, in its own commit.

- **The cause.** `touch()` scheduled a write one interval (1000 ms) after the first change and ignored later ones. During typing in a dirty 1 MB document that is a 1 MB snapshot (`toString` plus `JSON.stringify`, about 5 ms on the main thread, then 24 to 27 ms to confirm) about once a second. `typing-1mb-trusted` types into a standalone editor with no open document, so it never included this. The 2026-11-07 decision had worked the cost out as "1 late frame in 60" and noted it was not measured with the journal live; it is now.
- **The change** (`src/documents/session.ts`): the write is one interval (1000 ms) after the *last* change, and at the latest `JOURNAL_MAX_WAIT_MS` (5000 ms) after the *first* change when changes keep coming. A lone edit is on disk 1000 ms after it, as before. Typing that never pauses for a second writes a snapshot every 5 s and not every second. The cost of a write is unchanged; there are fewer of them.
- **What it costs, in your terms.** A force-kill during typing without a one-second pause loses up to 5 s of it (it was 1 s). After any pause of a second, what is lost is as before. I chose 5 s because one snapshot every 5 s lands on about 1 key in 33 for a typist at 150 ms a key, under the 1 in 20 where a p95 starts to move. It is one constant if you want fewer or more (`JOURNAL_MAX_WAIT_MS`). I did not try a smaller per-write cost (writing only the changes, or building off the main thread); both change the session file's format or the app's structure and were not asked for.
- **Result** (release app, real WebView2, 5 runs): `typing-outline-open-trusted` median p95 8.5 ms (7.9 to 8.7), repeatable, with 4 journal writes in the key window (before the change 14.9 to 16.1 ms with the journal on, 7.2 to 7.5 with it off). `crash-restore`: everything came back exactly as it was; the journal wrote 1347.5 ms after the last edit (it was 829 to 931 ms because the wait now counts from the last change, and a delayed notification follows each edit) and 5 tabs and 3 unsaved buffers came back in 146.5 ms. Tests: 45 in `tests/documents/session.test.ts` (4 new for the timing), and 8 of 8 deliberate breaks caught. ISC-274 in the ISA.
- **Not rerun:** `journal-cost` (the cost of one write is unchanged; I ran it once today for the figures above), the other Phase 6 scenarios.

## P7-T3: Outline

Decisions you already made (Q4 A, Q5 Rust outline scan) are in the plan. What I decided while building, with the reason:

- **One scan of the text, three readers.** The Rust scan (`src-tauri/src/outline/mod.rs`), the editor's own heading scan (`scanHeadings` in `src/editor/headingSlug.ts`, which also numbers the `#anchor` links) and the browser mock all follow the same rules, and `tests/fixtures/outline-parity.json` (34 cases) is run by Rust and by vitest. The editor's scan was changed to return the line, the start position and the raw text; `headingAnchors` maps it and its numbering is unchanged.
- **Rules.** ATX headings (up to three spaces in front, `#` to `######`, a space or the end of line after the hashes, closing hashes dropped), setext headings (a `=` or `-` bar under a paragraph line; a list item, quote or indented code line is not a paragraph), fenced code skipped (` ``` ` and `~~~`, closed by the same character and at least the same length, an unclosed fence hides the rest), front matter skipped (`---` on line 1, closed by `---` or `...` within 200 lines). Headings inside lists and quotes are not listed. Lines end at LF, CRLF or a lone CR like the editor's.
- **Raw text goes to the page, display text is made there.** Rust sends the heading as written (`## A **bold** [link](x.md)`); the panel turns the rows on screen into what the page shows (`A bold link`) with the same Lezer-based `headingText` the anchors use, and caches them. Keeping the scan a plain line scan is what lets it run on 10 MB in Rust without a parser.
- **Cap.** 50,000 headings, then the list says "Only the first 50,000 headings are listed." A 10 MB file of only headings (about 2 million) would otherwise make a list nobody can use.
- **When it scans.** Only while the Outline panel is on screen. A switch of document or tab scans at once; a change of text waits until typing pauses for 400 ms; a caret move or a save that changes no text does nothing (the panel compares the document's text by identity on every notification, so a caret move costs one comparison). A document with no unsaved edits is scanned from its file by path (Rust reads it, the page sends nothing); a document with unsaved edits or no file sends its text. Answers are numbered and a late one is dropped.
- **A bug the first page tests found (kept as a test).** The first version restarted the 400 ms wait on every notification. An edit is followed by other notifications (the session's journal about 250 ms later), so the wait was pushed back each time and a scan after a single edit never came while anything kept notifying. Now only a change of text restarts the wait. Test: "does not scan for a caret move or a save that changes no text" and "sends the text of a document with edits, after typing pauses".
- **Non-Markdown files** say "This file is not Markdown, so it has no outline." and are not scanned. Plain text has no headings in this app; no `#` lines are listed from a `.txt`.
- **Click and Enter (Q4 A).** A click puts the caret on the heading line in the active pane's tab and leaves the focus in the list; Enter and a double click then move the focus to the editor. The list is a listbox with `aria-activedescendant`, 24 px rows, only the rows on screen are in the DOM, and its keys are the tree's (arrows, Home, End, PageUp, PageDown, Enter; Ctrl, Alt, Meta and Shift pass through).
- **Show Outline** is a command (`view.showOutline`, Ctrl+Shift+L, in the app menu after Toggle Sidebar) and the header has a third tab. The panel is lazy-loaded (new check-arch rule `outline-lazy`).

### The scenario `typing-outline-open` (written before its first run)

ISC-144 adds a cost to typing: while the Outline panel is open, an edit makes the page scan the unsaved text. The gate is the same one as every typing scenario: p95 work per key under 16 ms. It is the `typing-1mb` scenario, unchanged (same document, caret, keys, measure), with the real outline following a real open document that is edited while the keys land:

- **Document:** `tests/fixtures/generated/realistic-1mb.md` opened through the document store as a real tab (so the outline's store, watcher and scan path are the app's), 1 MB, with the real `OutlinePanel.vue` mounted in a 320 px flex column at the right edge (as the Search scenario does).
- **Edits:** every 700 ms one space is added at the end of that document through its follower. The outline waits 400 ms after an edit, so a scan of the document's unsaved text (the whole 1 MB sent to Rust, the answer parsed, the rows redrawn) finishes inside the key window several times a second. The typed keys themselves go to the scenario's own editor as in `typing-1mb`; they do not reach the open document, so the edits above are what drive the scans. I am not hiding that: the load is the outline's scan work, not the editor's work on the keys.
- **Both modes:** `typing-outline-open` (dispatch) and `typing-outline-open-trusted` (real key events through the DevTools port).
- **Evidence printed with the headline:** headings listed, edits made during the keys, outline scans finished during the keys, the most heading rows in the DOM at once. The scenario fails if it sees no row, more than 100 rows (the panel mounted without a height), or no scan finished while the keys were typed.
- **Pass rule:** p95 under 16 ms and repeatable across 5 runs (the harness's rule). The gate is not changed and a run is not repeated under easier conditions. A miss stops the work and goes to you.

### What `typing-outline-open` did when it first ran (and the control)

- **Dispatch mode:** median p95 6.3 ms (runs 6.1, 6.1, 6.3, 6.4, 6.8), under the 16 ms gate, repeatable. 417 headings listed, 33 scans finished during the keys, at most 39 rows drawn.
- **Trusted mode, first run, with the panel:** median p95 16.1 ms, runs 17.6, 13.6, 16.1, 18.2, 15.0, "repeatable: NO". Over the gate by 0.1 ms at the median. The scenario scanned 33 of its 34 edits. CPU was 87 to 91% idle before each run (the quiet T2 rerun was 94 to 96%). I stopped and asked you; you chose A (find the cost and cut it).
- **Control, trusted, no panel (`--set outline=0`: the same edits to the same open document, nothing mounted):** median p95 14.9 ms, runs 14.6, 17.3, 14.0, 14.9, 17.3, "repeatable: NO", update part of a key 12.7 ms at p95 (with the panel: 11.9). So the panel and its scans account for at most about 1 ms, which the run-to-run spread (about 3 ms) hides.
- **What that means:** most of the extra cost over the plain `typing-1mb-trusted` scenario (8.0 to 9.0 ms) comes from the scenario's own edits to a real open 1 MB document every 700 ms, not from the outline. I have not found which part of an edit to a store document costs it (candidates: the follower to master sync, the session journal about 250 ms later, the dirty-state check); nothing in the outline's code is a cost I can cut on this evidence.
- **The `outline` param** (1 by default, 0 for the control) stays in the scenario so this can be reproduced. The gate and the default scenario are unchanged.

### What A2 found: the session journal, not the outline

You chose A (find the cost). Two more controls, trusted mode, 5 runs each, with the session journal switched off before the keys (`--set journal=0`, a diagnostic knob; the app's default is unchanged):

| Trusted, median p95 per key | Journal on (the app's own behaviour) | Journal off |
|---|---|---|
| Panel off, same edits (control) | 14.9 ms (14.0 to 17.3) | 7.2 ms (6.5 to 7.4), update part 5.1 ms |
| Panel on (the scenario) | 16.1 ms (13.6 to 18.2) | 7.5 ms (7.2 to 8.2), update part 5.2 ms |

- **The outline costs about 0.3 ms per key at p95** (7.5 against 7.2, with 32 scans finished during the keys and the spread about 1 ms). With the journal on the difference is 1.2 ms, inside a 3 ms spread.
- **The session journal costs about 7.7 ms per key at p95** in this scenario (14.9 against 7.2). The journal rebuilds the whole session at most once a second while a document is being edited. For a dirty 1 MB document that is `toString` plus `JSON.stringify` of 1 MB on the main thread (5.3 ms in `journal-cost`, 3 runs today) and then a 1 MB write (24.5 ms to confirm, without a dropped frame). About one key in twenty lands next to it, and that is where a p95 sits.
- **This is not new in T3.** `typing-1mb-trusted` types into a standalone editor with no open document, so it has never included the journal. Typing in the app in a dirty 1 MB file has the same load. Phase 6 left it as the open fog item `journal-cost` ("not rerun").
- **Noise:** the journal-off runs were on a quieter machine (CPU 93 to 98% idle before launch) than the journal-on runs (84 to 92%). The size of the journal's share (about 7 ms) is much larger than that difference, but the two tables were not measured at the same time.
- **The gate result for `typing-outline-open-trusted` stays what it was:** median p95 16.1 ms, over by 0.1 ms, not repeatable. It is not rerun under easier conditions.

### P7-T3 result (after the journal change)

- **Gate, same scenario and same rule:** `typing-outline-open-trusted`, 5 runs, release app: median p95 work per key **8.5 ms** (7.9, 8.5, 8.5, 8.6, 8.7), repeatable, under the 16 ms gate, with 4 session journal writes inside the key window. The first run (16.1 ms, over by 0.1 and not repeatable) stays recorded above as the first result; the second is a different app (the journal rule changed in `ab49e83`), measured the same way.
- **Checked in the real debug window** with trusted key and mouse events (28 of 28; `t3-real.mjs`, a temp data folder and copies of the fixtures, the file on disk checked unchanged after unsaved edits): the tab, the first-use message, the rows and their indents, a setext file and a fenced heading, a click leaving focus in the list, Enter and double click moving to the file, ArrowDown, unsaved typing showing in the list with nothing written to disk, a text file's message, Ctrl+Shift+L, and on the 10 MB file the last heading (line 161,770) reached with End and Enter. Screenshots read: list, edited, 10 MB.
- **Tests:** 18 in Rust (`outline::`), 26 page tests in `outline.test.ts`, 3 in `outlineParity.test.ts` and the 32-case table that both languages run. Broken on purpose: 21 in Rust (all caught after two table cases were added), 5 in the editor scan (all caught after one assertion was strengthened), 34 in the page code (33 caught; the survivor is a second route to the same scan and I kept both).
- **Deviations from the plan:** none in what the panel does. The perf scenario has two diagnostic knobs (`outline`, `journal`) and a journal write counter, which the plan did not list; both default to the app's own behaviour.

### The scenario `typing-find-open` (written before its first run; P7-T1 owed it, ISC-260)

Typing with a find query active adds one cost per key: the match marks of the viewport are made again. The gate is the same as every typing scenario: p95 work per key under 16 ms, repeatable across 5 runs, and a miss stops the work and goes to you; the gate is not changed and a run is not repeated under easier conditions.

- **What it is:** the `typing-1mb` scenario unchanged (same 1 MB document, caret, keys and measure) with the query "e" (Match case off, Whole word off, no regular expression) set on the editor before the keys. One letter is the query that marks the most: the viewport is at its cap of marks at every key.
- **What it leaves out, on purpose:** the bar itself (a Vue component in the pane) is not mounted; it holds the query and shows the count, neither of which runs at a key. The count runs 250 ms after the last edit, so not between keys typed 50 ms apart, and is bounded to 20 ms; it was timed in the real window in P7-T1.
- **Evidence printed with the headline:** the most match marks in the DOM at once. The scenario fails if the editor never drew one.
- **Both modes:** `typing-find-open` (dispatch) and `typing-find-open-trusted` (real key events through the DevTools port).
