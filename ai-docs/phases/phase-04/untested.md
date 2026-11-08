# Phase 4: what was not tested, and how to test it later

Everything below was skipped on purpose or could not be done in the Phase 4 runs. Each entry says why, and how to check it when there is time. The decisions behind them are in [decisions.md](decisions.md).

| # | Gap | Why it was skipped | How to test it |
|---|---|---|---|
| 1 | The parse frontier landing exactly on the end of a table | A mutation of the removal filter survived: no test can put the frontier there on demand. | Open a very large document with many tables in the real app, scroll to the bottom while parsing catches up, and check that no table is missing or drawn twice. |
| 2 | Tables wider than the pane | The wrapper scrolls sideways, but no check looked at a wide table. | Open a table with ten long columns in a narrow pane and scroll it sideways. |
| 3 | The light theme | As in Phase 3, every visual check ran in the dark theme. | Switch to the light theme and look at the table header, borders and inline code. |
| 4 | A relative image path that leaves the document's folder (`../images/a.png`) | Refused on purpose: allowing it means granting the parent folder, which ISC-181 rules out. | Decide whether a workspace root (a later phase) should widen where an image may come from, then open a document in a subfolder of a workspace. |
| 5 | Scrolling with a real wheel or trackpad over images | The scroll check moves `scrollTop` in steps; no trusted wheel events were sent. | Send trusted wheel events over the DevTools port in the real window and watch the top line. |
| 6 | Images in a list item, a quote or a table cell | Left as Markdown on purpose: a block replacement there would lose the line prefix. | Open a README with images in list items and decide if that needs a block layer that keeps prefixes. |
| 7 | Animated GIFs, very large images, images that take seconds to load | Only PNG and SVG of at most 880 px were tried. | Open a document with a 20 MB PNG and an animated GIF and watch memory and scrolling. |
| 8 | Images in the light theme | Every visual check ran in the dark theme. | Switch theme and look at the placeholder border and label colours. |
| 9 | A document at the root of a disk (`C:/x.md`) | Rust refuses to grant a whole disk, so its images show placeholders; checked in a unit test only. | Open a document at the root of a drive and confirm the placeholder. |
| 10 | The asset scope only grows | Tauri has no way to take a folder back out. | Nothing to test; revisit if Tauri adds revocation. |
| 11 | Scroll stability beyond the lab walk | ISC-72 passes 6 of 6 runs, but only on one lab document, in 60 px steps set through `scrollTop`, with local images. | Try trusted wheel events and a trackpad over the lab document, scrolling down into images not yet seen, and an `https` image that loads late. |
| 12 | The 12 px anchor point | It is a constant copied from CodeMirror 6.43.15 (`scrollAnchorAt`); the check would notice a change, but nothing else watches it. | After a CodeMirror update, rerun `pnpm perf scroll-stability`. |
