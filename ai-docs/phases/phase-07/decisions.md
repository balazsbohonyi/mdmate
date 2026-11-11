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
