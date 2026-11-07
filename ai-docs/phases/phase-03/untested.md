# Phase 3: what was not tested, and how to test it later

Everything below was skipped on purpose or could not be done in the Phase 3 runs. Each entry says why, and how to check it when there is time. The decisions behind them are in [decisions.md](decisions.md).

| # | Gap | Why it was skipped | How to test it |
|---|---|---|---|
| 1 | The light theme | Every check ran in the dark theme, and no Phase 3 claim names a theme. | Switch the theme in `pnpm tauri dev`, open a document with every element, and look at headings, links, quotes, rules and code for contrast and a visible caret. |
| 2 | IME composition inside or next to hidden syntax | No harness drives an IME. | With a Japanese or Chinese IME, compose text inside a bold span and a link and at the start of a heading. The composition should not jump, and nothing should reveal mid-composition in a way that loses it. |
| 3 | Touch input | The app is mouse and keyboard on Windows. | On a touch screen, tap into rendered bold text and in the margin of a heading, and check the caret lands near the tap. |
| 4 | A drag selection that starts on a hidden marker | The press lands on the nearest edge, which was seen but not tested as a drag. | In the real window, press on a hidden closing `**` and drag across the next line; the selection should start at the edge of the span. |
| 5 | Elements nested in other elements: a heading, code block or image inside a quote or list; emphasis inside link text; an image next to a link | Only the common nestings have tests. | Add cases to `tests/editor/` for each, then walk them with the caret in `tests/editor/caretWalk.test.ts`. |
| 6 | Vertical moves in a plain-source tab | There is no preview layer there, so nothing to compare. | Open a file above 3 MiB, hold ArrowDown through it and check no line is skipped. |
| 7 | Copy in a plain-source tab, drag-out of a selection to another application, paste of mixed line endings | Copy in a plain-source tab uses the same filter and no layer; the other two sit outside the claims. | Copy from a large file and paste into Notepad (check CRLF in a hex view); drag a selection into another app; paste text with mixed endings and check the document picks them up. |
| 8 | The raw-source menu entry in the native macOS menu | There is no Mac in the lab. | Build on a Mac and check Cmd+E toggles the active pane. |
| 9 | The real 10 MB `realistic-10mb.md` for the decoration-scale claim | The scenario repeats the 1 MB fixture ten times so both views show the same text; the generated file shows different content. | Run the scan at several places in the real file and compare against a 1 MB window of similar content. |
| 10 | Why the late-file scan is about 20% slower at 10 MB | The claim moved to 35% on the measurement without profiling the cause. It is read as the cost of finding a place in a bigger syntax tree. | Profile `scanPreview` late in a 10 MB document and look for time in tree resolution; if the cost grows with size, find what walks from the root. |
| 11 | Startup after a reboot, or on a slower machine | Fresh-profile launches took 693 to 893 ms on this machine, close enough to 1000 ms that a slower one could miss. | Reboot, launch the release build once with a stopwatch or `pnpm perf startup --fresh-profile --runs 1 --warmups 0`, and compare with 1000 ms. |
| 12 | Typing at exactly 3 MiB | The 3 MB fixture is 3,146,134 bytes, 406 over the cutoff, so it stands in for the largest parsed file. | Make a file of exactly 3 MiB, open it, and confirm it keeps the parser and types within 16 ms. |
