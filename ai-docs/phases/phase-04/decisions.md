# Phase 4 decisions

Deviations from the plan and choices it left open. Numbers carry the OS they came from.

## Checking the UI (all of Phase 4)

- **Two places, every UI claim.** Interceptor on `pnpm dev` (mock host), and the real app: `cargo run --features perf` from `src-tauri` against the Vite server on port 1420, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, `MDMATE_DATA_DIR` pointing at a temp folder, trusted key and mouse events and screenshots over the DevTools port. Files are opened through `perf_grant_file` and the page's own store.
- **Interceptor does run on Windows here** (version 2.1.6, test profile `interceptor-test`). The pinned skill text is written for macOS, but the preflight, `open`, `eval --main`, `click`, `keys` and `screenshot --save` all worked. `screenshot --save` writes to the current folder, and `--out` is not a flag.
- **Opening a document in the mock-host page.** The page's modules carry Vite's `?t=` stamp, so importing `/src/...` gives a second copy with its own host. The helper reads the exact URL from `performance.getEntriesByType('resource')` and imports that. The scripts live in the session scratchpad, not in the repo.
- **Rust tests never touch real files**, as in Phase 2.

## P4-T1: block layer and tables

- **The transaction filter is needed, but not the one Phase 3 deferred.** Phase 3 left open a filter that keeps a caret out of a replacement that stays hidden while touched. Phase 4 has no such replacement: every block is removed in the same transaction that moves a selection onto it, so no selection is ever inside one (ISC-183, tested for every offset, 400 random ranges and 300 transactions). Found by the real browser instead: ArrowDown from the blank line above a table landed on the blank line below it, so the keyboard could never enter a table (ISC-60 and ISC-65 both fail that way). `stepIntoBlock` fixes it: a keyboard step onto the line just past a drawn block becomes a step onto the block's first line (down) or last line (up), which reveals its source. Verified with real keys in the browser and in the real window, in both directions, seven presses each: every source line is visited and the table draws again on leaving.
- **jsdom cannot see this.** It has no layout, so `moveVertically` never ran in the unit tests. The unit tests pin the filter's rules (what it redirects and what it leaves alone); only the real runs show that CodeMirror needs it.
- **Only top-level tables are drawn.** A table in a list item or a quote stays as source, because the replaced lines would lose their prefix. Deviation from "render GFM tables": nested tables are rare, and a wrong rendering would hide text.
- **A scan returns a table whole whenever the rescanned stretch touches it,** and the removal filter uses the same strict overlap, so a table that only touches the edge of a rescanned stretch is neither removed nor lost. I first widened rescans to whole tables, then removed that code when a mutation showed it was not needed for correctness.
- **CSS found by looking at the page:** CodeMirror's wrapped lines set `white-space: break-spaces` and `overflow-wrap: anywhere`, which squeezed every column to a few letters until the table set its own. The table's wrapper sets `overflow-y: hidden`, since `overflow-x: auto` made the screenshot draw a vertical scrollbar.
- **Mutation checks** (each broke the code on purpose and the tests failed): drawing touched blocks anyway (10 tests failed), ignoring selection moves (7), skipping the rescan after an edit (2), ignoring the parser advancing (3), not mapping through edits (4), `eq` always false (1). One mutation survived (an inclusive removal filter), because no test puts the parse frontier exactly on a table's end; the strict filter stays for the reason above.

## P4-T2: images

- **Asset protocol turned on for real, in every build.** Changes, exactly: `src-tauri/Cargo.toml` — `tauri = { version = "2", features = ["protocol-asset"] }` (was `features = []`), and the `perf` feature went from `["tauri/protocol-asset"]` to `[]` because the protocol no longer belongs to it. `src-tauri/tauri.conf.json` — `app.security.assetProtocol = { "enable": true, "scope": [] }`. The scope is empty on purpose: nothing is readable until Rust grants a folder. The CSP already allowed `asset:`, `http://asset.localhost` and `https:` for images, so it did not change. `scripts/perf.ts` no longer writes a config of its own or restores `Cargo.toml` afterwards, since the real config now says the same thing.
- **Rust grants, the page never asks.** `open_file` computes the document's folder from the path Rust resolved (`access::asset_folder`) and calls `asset_protocol_scope().allow_directory(folder, true)`. There is no command the page can call to widen the scope. Tauri escapes the folder before it becomes a pattern, so a folder named `[draft] {notes}` works (tested for the function; the real window showed an ordinary folder only).
- **What `asset_folder` refuses (ISC-181):** a network path (`\host\share`, `\?\UNC\...`), and a document that sits at the root of a disk, because allowing the whole disk so one file can show a picture is far too much. Deviation worth knowing: a document at `C:\x.md` shows its images as placeholders.
- **The scope only grows.** Tauri has no call that takes a folder back out, so every folder a session opened stays readable until the app quits. The page can still only ask for a path the resolver below produced, so this widens what a *compromised* page could read, not what a document can make load. The perf lab already showed the scope can grow at runtime (Phase 0); shrinking was never possible.
- **Real-window evidence for ISC-181 (2026-11-08, Windows 11, WebView2):** with a document opened from `...\ui\real\docs`, a `fetch` of the asset URL of `pic.svg` in that folder returned **200** and of `...\ui\real\outside\secret.png` returned **403**. The same page showed the SVG, the PNG in a subfolder and two badges; a file that does not exist became the grey dashed placeholder (160 px) with its alt text.
- **The address rule (ISC-180) is an allowlist, in one function** (`resolveImageAddress`). A relative path that stays inside the document's folder, or `https`; nothing else. It is checked in this order: any scheme means "not relative" (`C:\`, `file:`, `data:` all die here, and only `https:` goes on); percent escapes are decoded *before* the checks, so `%2e%2e/` and `%5C%5Chost` are caught; a separator at the start (`/x`, `\x`, `//host`, `\host`) is refused; `..` may not climb above the folder; characters Windows forbids in a name (`< > : " | ? *`), control characters, Windows device names (`NUL.png`, `COM1`) and names ending in a dot or space are refused; `https` with a user name or password is refused (it would be sent to that host). A fuzz of 6000 random addresses finds no path outside the folder and no non-https remote.
- **A relative path that leaves the folder is refused, even when it is harmless** (`../images/a.png`). That is a common way to write a README. Allowing it would mean granting the parent folder too, which is the very thing ISC-181 rules out. A real limit, listed in `untested.md`.
- **Images are drawn in top-level paragraphs only.** An image in a list item, a quote or a table cell stays as Markdown, for the same reason a table in a list does (the line prefix would be lost). A row of badges, and an image inside a link, do work.
- **A refused or failed image is drawn as a placeholder with its alt text**, not left as source: the author sees that something did not load, and the box does not move when the real answer arrives. The refused box says why in its tooltip.
- **Referrer.** Remote images are requested with `referrerPolicy = no-referrer`, so the page address never leaves the machine.
- **Reserved space.** The first time an image is drawn it holds a fixed box (160 px for a block, 20 px inside text). When it loads, the box takes the image's aspect ratio and width (up to its natural size) and asks CodeMirror to measure. The size is remembered by address (at most 1000 entries, oldest dropped first), so the same image drawn again reserves exactly its real size from the first frame.
- **Mock host:** `assetUrl` serves an `.svg` it holds as a `data:` address and gives anything else an address that cannot load. The mock never runs in the shipped app, so the CSP (which does not allow `data:`) does not matter.

## P4-T2: ISC-72, scroll stability (closed after five attempts)

`pnpm perf scroll-stability` (scenario in `src/perf/scrollStability.ts`, lab files from `scripts/lib/scrollLab.ts`): 80 sections, each with an image of its own size (320x140 up to about 880x640) that has never loaded, scrolled 60 px at a time from the bottom to the top and back. After each step the first text line fully in view is looked up and compared with where the scroll alone puts it. Limit: 2 px. The same walk runs over a control, an image widget with no reserved space and no measure request, which must drift by at least 10 px or the check proves nothing.

**Final result** (Windows 11, WebView2, release build, six runs in a row on one build): the real widget moved the top line by 0.47 px going up and 0.25 px going down in every run; the control moved it by 288, 300, 300, 910, 300 and 300 px. The six newest `perf-results/scroll-stability-20261108-*.json` files at the time, `-104046` to `-104941`.

### What the failure was

The first visible text line moves when an image above it changes height and nothing makes up for it. CodeMirror makes up for a height change only above one block: the block that holds the point 12 px under the top of the view (`scrollAnchorAt` and the measure loop in `@codemirror/view` 6.43.15, `dist/index.js`). A block wholly above that point is covered. A block below the first visible line moves only what follows it. A block in between (the one holding the point, or one between it and the first line) is not covered, and the first line moves by all of the growth.

The scroll step is what puts an image into that middle zone: an image can load as a 188 px placeholder at the top, with the tracked line just under it, and then a 60 px scroll moves it below the anchor point. In the failing step (`img-065`, step 130 to 135 depending on the build) it grew 445 px and the line moved 445 px.

### Attempts, in order

| # | What | Runs on the release build |
|---|---|---|
| 1 | The widget as first committed: reserve on load, plain `requestMeasure()` | 4 of 7 failed, 307 to 1363 px |
| 2 | Your two ideas: hold a resize while the image crosses the top edge, apply it when the edge is clear or the view is idle, and on idle put the first line back | 1 run, failed at 445 px |
| 3 | The same hold, with the test moved to CodeMirror's anchor point (12 px under the top, 4 px of slack) | 2 of 5 passed, 445 px each time it failed (the same build with a trace added passed 6 of 8) |
| 4 | Decide in the view's measure cycle, put the first line back when the image sits in the uncovered zone; the line chosen when each image is applied | 0 of 6 passed, 445.27 px every time |
| 5 | Same, with the line chosen once in the read phase, before any image has changed | 6 of 6 passed |

### Deviations from the two ideas you gave

- **The hold (idea 1) was dropped.** It decides when the image loads, but the scroll that matters comes after. In attempt 3 the trace showed the failing image held, then released by a scroll event at the moment it stopped being the anchor, and then growing in the uncovered zone below it.
- **The restore (idea 2) stayed, but moved into the view's own measure cycle** (`requestMeasure` with a read and a write). The read decides, from where things are at that moment, whether CodeMirror will cover the change; the write applies the size and, if not, scrolls so the reference line is where it was just before.
- **The reference line is chosen in the read phase** and its position is read right before each image's own change. Attempt 4 chose it at write time, and with two images loading in one frame the first one grew 384 px and pushed hidden lines into view; the line picked for the second image was one above it, so its 445 px was never restored.
- **A plain `requestMeasure()` inside a measure cycle does nothing** (CodeMirror only adds a request when given one). The first draft called it to have the new height measured in the same cycle; a unit test that counts the passes of the measure loop caught that, and the call now carries a read of its own.

### How it was found, and what I am less sure of

- Two temporary traces, one in the widget and one in the scenario (position of each image and the first line at load, read and write), gave the events of the failing step. Both are removed. The trace reads layout, so it changed which runs passed; the clean build is the one that counts.
- All runs are on one lab document, one machine, scrolled in 60 px steps by setting `scrollTop`. Trusted wheel events, a trackpad's smooth scrolling, scrolling down into unseen images and `https` images (whose load time is not local) were not tried: see untested.md.
- The restore reads the position of an image box, so it is only as good as the 12 px figure CodeMirror uses. It is a constant copied from CodeMirror's source; if a CodeMirror update changes it, the scroll-stability check is what would notice.
- The check was written before the fix and passed the control, so it was able to fail: the real widget failed it in attempts 1 to 4.

### The system stopped a run

A queued rebuild plus up to six runs was stopped by the system for low memory (2026-11-08, about 02:00) and was not restarted until you asked for it. The runs above were done in batches of at most six, with the free memory (3 to 7 GB) checked first.
