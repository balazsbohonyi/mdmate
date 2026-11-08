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

## P4-T3: frontmatter and checkboxes

- **Frontmatter is found from the text, not from a parser extension.** I planned a block parser for `@lezer/markdown` (which would also have needed `@lezer/markdown` as a direct dependency). It has two problems. A parser sees one line at a time, so it cannot know a closing `---` exists without looking ahead, and CodeMirror reuses the parse of an unchanged first line when something is typed further down: typing the closing `---` would not have turned the block on until the document was parsed again. `src/editor/livePreview/frontmatter.ts` reads the text instead (`---` on line 1, the first following line that is `---` or `...`, within 200 lines), gives the same answer for the same text, and adds no dependency. Both layers ask it and skip everything inside the range. No new package, no `Cargo.toml` or config change in T3.
- **The cost of that choice.** The parse tree still sees a rule and a paragraph or heading inside the block, so a construct that starts inside the YAML and runs past the closing line (an unclosed code fence in a block scalar, say) would still affect the text after it. Not tried.
- **The 200-line limit is mine.** It keeps a document that starts with a lone `---` from being scanned to its end on every keystroke. A longer block is shown as plain text.
- **An open block needs its own line class.** With the caret inside, the first real-window screenshot showed the YAML bold and underlined: the syntax highlighter styles the setext heading the parser sees there. Each line of an open block now gets `cm-md-frontmatter-line`, which sets plain weight, no underline and the muted marker colour, also on the spans inside.
- **The pill label lists the top-level keys** (plain `key:` at the start of a line, not parsed as YAML, cut at 48 characters). Pressing the pill puts the caret at the start of the block.
- **Checkboxes stay in the inline layer.** A task marker is a one-line replacement that changes no height, so it does not need the block field. It is drawn only while no selection touches the marker, like other inline syntax. A native `<input type="checkbox">` with the property and the attribute set: the DOM-render screenshot of the Interceptor shows attributes only, and the first picture showed every box empty.
- **The press changes the one character between the brackets** (`' '` to `x`, `x` or `X` to `' '`), at the position `posAtDOM` gives, after checking that the three characters there still look like a marker. Line endings are not in the editor's text, so the saved file differs in that one byte whatever the endings are. `userEvent` is `input.toggle`, which the history does not join to its neighbours; two quick presses on one box undo one at a time. A read-only state returns before anything is dispatched.
- **Real-window numbers (2026-11-08, WebView2, trusted mouse and Ctrl+S/Ctrl+Z over the DevTools port):** one byte differs for an LF file (checked to open), a CRLF file (offset 88) and a mixed file (9 CRLF, 7 LF, 1 CR; offset 81); after Ctrl+Z and Ctrl+S the files are byte-identical to the originals. A file with invalid UTF-8 opened read-only; two clicks changed nothing and the file stayed identical. The same page on `pnpm dev` through Interceptor: pill, boxes, one press flipped the box and the text, the caret did not move.
- **Breaks:** 26 deliberate breaks in the T3 code, all caught in the end. The first 21 left 6 alive. Two were code that could not matter and was removed: `isolateHistory` (the event name `input.toggle` already keeps presses apart; a new test presses one box twice and fails if the event is made to look like typing) and a regex around `TaskMarker` (the parser only produces one for `[ ]`, `[x]`, `[X]`). One made the scan edge strict: a scan that starts exactly at the end of the block must not draw it again, since the field would then hold two pills. Three tightened tests: the line limit written as a literal, a `http://` line that must not be a key, and a fixture where a table and an image inside the block would really be drawn. A later round of four more breaks on the plain-line class found one more guard that an empty loop already covered; removed. The nested-block fixture first used `---` straight after the table, which the parser reads as a setext heading, so the test could not fail; it now has blank lines.
- **Subagent decisions:** none.


## P4-T4: code highlighting

- **The language list and each parser load on demand, per fence word.** `markdownSupport()` passes `codeLanguages: codeLanguage`, which returns one `LanguageDescription` per word whose `load` imports `@codemirror/language-data` only when a block asks. I chose that over handing `markdown()` the whole list (`languages` from the package) because the list is code too, and a static import of it would put it in the entry bundle and break ISC-71. The cost is that a block is plain text on first sight and colored a moment later (about 0.5 s in the jsdom test, longer on a cold disk). A block in a language that was loaded before is colored at once.
- **A fence word is looked up by name or alias, then by file extension.** The list knows Python only as `python`, so a block written ```py``` found nothing and fell through to plain text. A test that waited 15 s for a Python block written as `py` showed it. People write extensions (`py`, `rs`), so the second lookup is `LanguageDescription.matchFilename` on `file.<word>`. I had also kept a fuzzy name match (`matchLanguageName(..., true)`), first thinking it had picked the wrong language for `py`; a probe showed it found nothing the exact lookup missed (`py`, `pyt`, `language-js`, `rs` all null), so I removed it. A side effect of extensions: a one-letter word can match one (`p` is Pascal), so typing a fence word letter by letter may load a small parser or two on the way; each language loads once.
- **A word the list does not know is plain text, not an error.** It resolves to a stand-in language whose tokenizer skips the line, so the block stays plain text. Words longer than 40 characters and blank words give no description at all. Descriptions are kept per word, at most 128, then cleared.
- **ISC-71 is not literally true, and I did not change the claim; I changed what the check allows and wrote it down.** `@codemirror/lang-markdown` imports `lang-html` statically, which imports `lang-css` and `lang-javascript`. Those three parsers and their grammars are in the entry chunks whatever the app does. The rule lists the six packages by name and fails on any other language package in a chunk the page loads first. Measured on a build with source maps (2026-11-08): entry chunk 526.01 kB (188.64 kB gzip) plus one preloaded shared chunk 263.98 kB (86.18 kB gzip), 789.99 kB (274.82 kB gzip) together, against 780.04 kB (270.90 kB gzip) in one chunk before T4: about 10 kB (3.9 kB gzip) more; I did not break down what the 10 kB is. The split itself is Vite deciding that the shared `lang-*` code goes in a chunk both the entry and the lazy parsers import. **If you want the claim to hold literally**, the way is to stop `@codemirror/lang-markdown` from importing `lang-html` (a fork or a patch of that package, or giving up HTML in Markdown), which I did not do. **Reopened:** I had ticked ISC-71 under that allowance, which you have not approved, so I have un-ticked it in the ISA (and ISC-58 and ISC-63, see below); the question is whether to keep the claim as written, reword it, or close it under the allowance. **Resolved 2026-11-08:** the owner chose to reword the claim; ISC-71 now reads "The entry bundle holds no language parser beyond the ones Markdown itself imports (HTML, CSS and JavaScript); every other language loads when a fence names it." and is closed again.
- **The bundle half of the rule needs source maps.** It reads the `sources` of each eager chunk. `pnpm build` does not make maps, so `pnpm check` prints a note ("build not inspected") and passes when `dist/` has none; `--dist <dir>` makes a missing or unreadable build a failure, so evidence runs cannot pass by skipping. The evidence run used `pnpm exec vite build --sourcemap --outDir <temp dir>`. Eager chunks are found from `index.html` (script and modulepreload links) and followed through static `import`/`export … from` in the chunk text; a chunk reached only by `import()` is not eager.
- **`defaultHighlightStyle` is gone.** `tokenHighlight` (a `HighlightStyle`) replaces it in both places `create.ts` used it, so Markdown source in raw mode is also colored by the theme tokens (headings, links, quotes, markers). I looked at raw mode in the real window (same colors as the preview, dark theme) but not in the light theme.
- **New dependencies, both direct and both already in the tree one way or another:** `@codemirror/language-data` 6.5.2 (29 packages added to `pnpm-lock.yaml`, all CodeMirror language packages and their Lezer grammars) and `@lezer/highlight` 1.2.5 (for `tags`, which `@codemirror/language` uses but does not re-export). No Cargo, `tauri.conf.json` or capability change.
- **Real-window check, with a mistake of mine worth knowing:** my first attempt to open the fixture used a plain `import()` of the store, which made a second copy of it (Vite stamps changed modules with `?t=`), so the app showed an empty editor. `/tmp/ui/lib.js` imports with the exact URL the app loaded; with that the document opened. Nothing in the app was wrong.
- **Breaks:** 13 deliberate breaks, all caught: 4 in the editor code (no extension lookup, no `codeLanguages`, an unknown token name in the style, a static import of the list, for which the runtime test and the rule both failed) and 9 in the bundle check (ignoring modulepreload links, not following static imports, allowing the list, dropping `lang-css` from the allowance, widening the allowance, Windows paths, pnpm store paths, the `explicit` flag, skipping the scan).
- **A test that was already at its time limit.** Two full `pnpm test:web` runs after T4 failed one test, `caretWalk.test.ts` "atomic ranges change no caret position today", at 5.0 to 5.3 s against vitest's default 5 s timeout; the same test run alone took 4.6 to 5.0 s with the T4 edits and 4.8 to 4.9 s with them stashed (four runs each), so T4 did not slow it. It walks the caret through two large documents four times. I gave it an explicit 60 s timeout. No perf limit and no claim was loosened: it is a unit test's own timeout, and it is a correctness test (two walks must be equal), not a speed gate.
- **Subagent decisions:** none.

## Perf after T4: STOPPED, three gates missed (2026-11-08)

Release build of `d5166ab` (T4), Windows 11, Ryzen 7 8840HS, WebView2 157.0.4341.42, 5 counted runs after 2 warm-ups unless stated, `--skip-build` after one fresh build. I stopped here as the brief says: nothing was loosened, no fix was tried, and the phase is **not** done. Phase 4 tasks T1 to T4 are committed.

### What passed and what did not

| Scenario (claim) | Limit | T4 result | |
|---|---|---|---|
| startup, warm (ISC-4) | 1500 ms | 529.5 ms (510.0 to 551.7) | pass |
| startup, 3 fresh-profile first launches | 1500 ms | 629.0 ms median (573.8 to 667.9) | pass |
| open-1mb (ISC-5) | 100 ms | 28.6 ms (not repeatable within 10%: 25.6 to 30.0) | pass |
| tab-switch p95 (ISC-6) | 50 ms | 49.6 ms (48.4 to 51.0) | pass by 0.4 ms; one run was 51.0 |
| typing-1mb p95 (ISC-7) | 16 ms | 7.2 ms | pass |
| typing-1mb-trusted p95 (ISC-7) | 16 ms | 8.4 ms | pass |
| typing-2mb / 3mb p95 | 16 ms | 8.7 ms / 11.7 ms (Phase 3: 6.0 / 8.2) | pass, but 40 to 45% slower than Phase 3 |
| **typing-5mb p95** | 16 ms | **35.0 ms** (26.9 to 39.5, not repeatable) (Phase 3: 12.6) | **over** |
| **decorations-scale (ISC-63)** | 35% | **worst deviation 0.568 and 0.500** in two runs (middle ratio 1.42 / 1.36, late 1.57 / 1.50) | **failed** |
| **reveal (ISC-58)** | 16 ms | **no number**: the page stopped with "the line below the span is not in the view", on run 1, in two attempts | **could not run** |
| scroll-stability (ISC-72) | 2 px | 0.47 px up, 0.25 px down over 864 steps each way, 156 images requested; the control drifted 287.6 px (run on a fresh build of `810ffc0`, one run, so the six-run repeat was not redone) | pass |

typing-5mb belongs to the "size cutoff" fog item, not to a numbered claim, but it was inside 16 ms at the end of Phase 3 and is not now, so I treat it as a miss.

### Where it started (bisect on release builds, same machine, same session)

| Commit | typing-5mb p95 | decorations-scale worst deviation (limit 0.35) | reveal |
|---|---|---|---|
| `c98e4d0` end of Phase 3 | 12.6 ms | 0.15 to 0.28 over 7 runs; 4 of the 7 had `checkFailed` only because the limit was still 20% then (tolerance 0.2 in those files), and it was raised to 35% in Phase 3 with your confirmation, so all 7 pass the current 35% | passed: work per leave p95 4.0 ms (3.6 to 4.2; earlier Phase 3 files 3.7 to 3.8 ms) |
| `708a90c` T1, block layer and tables | 15.4 ms | 0.86 | not run |
| `449dedb` T2, images | 16.8 ms (not repeatable) | 0.63 | not run |
| `9484495` T3, frontmatter and checkboxes | 16.2 ms | 0.63 | passed runs 1 to 3, page failure on run 4 |
| `d5166ab` T4, code languages | 35.0 ms | 0.57 and 0.50 | failed on run 1, twice |

### Causes, and how sure I am of each

- **T4 nested parsers cost about 18 ms per key at 5 MB. Measured.** The same T4 build with `codeLanguages` switched off (an uncommitted one-line change, since reverted) gave typing-5mb p95 16.8 ms (16.3 to 17.9, repeatable) against 35.0 ms with it. The 5 MB fixture holds about 1500 fenced blocks in html, python, rust, ts, bash, js, css and json, so once those parsers are loaded the whole document parses as nested code. In jsdom a full parse of that document took about 1.5 s with nested parsers against 0.9 s without, but the cost of one dispatch was the same (13 to 14 ms median in both), so I do not know which part of the real window's per-key work grows; I only know it is the nested parsing.
- **Superseded, see the correction below.** (Earlier text here blamed the block layer for the decorations-scale failure from a jsdom dispatch test; that test was noisy, 5.3 to 11.1 ms in three runs, and the scenario does not time a view update.)
- **reveal: not diagnosed.** The scenario scrolls the caret line to the middle of the view and fails if the line six lines below is not on screen. It passed in Phase 3 and passed three runs at T3, so it is flaky at T3 and failing at T4. It may be the same height-drift family as the scroll-stability work (the fixture has 111 images per MB, about 1000 task lines, frontmatter and about 300 fenced blocks), or lazy-loaded languages changing nothing but timing. I did not look further.
- **Correction, decorations-scale (2026-11-08, measured from the saved perf-results files):** the scenario times `scanPreview` over the view's visible ranges and checks that both documents give the same number of items. Since T1 the two views no longer show the same text, because block widgets (tables, images) change line heights:

  | Build | visible chars, late spot, 1 MB / 10 MB | scan 1 MB / 10 MB at the late spot |
  |---|---|---|
  | `c98e4d0` | 5049 / 5027 | 0.041 / 0.048 ms |
  | `708a90c` T1 | 5205 / 7095 | 0.044 / 0.082 ms |
  | `d5166ab` T4 | 4541 / 6605 | 0.052 / 0.081 ms |

  So the ratio is partly more text scanned, not a cost that grows with the file. The scan code is unchanged since Phase 3, and a plain-state test (jsdom, 1 and 10 MB, with and without the block layer) gives the same scan time either way (0.116 / 0.146 ms without, 0.124 / 0.135 ms with). It does not fully explain the ratio: dividing by the visible text leaves 1.08 to 1.36, so some of it may be real, and I have not separated them. **This means my recommendation (windowing the block decorations) was based on a wrong reading, and I have not built it.** The viewport difference itself (why the 10 MB view lands with more text, probably estimated against measured widget heights after the jump) is not diagnosed.

### What I did not do, and the decision that is yours

- I did not change code, limits or scenarios to make a number pass. The working tree is the committed branch; `src-tauri/target/release/mdmate.exe` is a build of `810ffc0` (code identical to `d5166ab`), made for the scroll-stability run after the nested-languages-off variant.
- Options, with my recommendation first: **(1)** make the block layer cost independent of document size (for example keep decorations only for a window around the viewport and the caret, rebuilt when the view scrolls, instead of one set for the whole document), then rerun decorations-scale, reveal and typing-5mb; **(2)** for nested code, parse and color fences only inside or near the viewport, or switch nested parsing off above a size (typing-3mb was 11.7 ms with it on, typing-5mb 16.8 ms with it off), the cutoff being a number I would want you to choose; **(3)** accept the 5 MB figure and move the cutoff down (this loosens what the app promises, so it is your call, not mine). A sub-agent may not choose between these: they decide a speed gate.
- **Subagent decisions:** none.

## Perf diagnosis after your answers (2026-11-08)

You approved diagnosing in the real window and asked me to try option (b). What I found, measured in the debug app (`cargo run --features perf` against the dev server, DevTools port) and then in release builds. **Everything here that touches the perf scenarios is uncommitted in `src/perf/` (`support.ts`, `decorationScale.ts`, `reveal.ts`) until you have looked at it.** To drop it: `git checkout -- src/perf`.

### decorations-scale and reveal: the scenarios read the view at the wrong moment

- **Measured, 10 MB file, jump to the late spot, then `forceParsing` to the end of the view:** the tree grows from 104,375 to 4,702,854 characters, the block layer draws thousands of tables and images above the view, the content grows by 198,810 px, and the scroll position stays put. The caret line is then 198,810 px away (scrollTop 1,362,706, its top at 1,561,516). CodeMirror puts the view back on the next measure: 500 ms later the offset is 1 px. In the 1 MB file the same steps move nothing. Phase 3 had no block widgets, so nothing moved.
- Both scenarios call `forceParsing` and read the view in that gap, so they read other text. That is why the same-work check has failed in every run since T1 (items 286 against 409 at T4), and why reveal stopped with "the line below the span is not in the view".
- **What I changed (uncommitted):** `settleOnLine` in `support.ts` waits until the target line is in the scroller and has held still for three frames (it throws after 5 s), and both scenarios call it after the parse. `decorations-scale` also scans one fixed stretch of 5000 characters from the target line in both documents instead of `view.visibleRanges`: after settling, the two views still differed by a few percent (visible characters 5241 against 5678; 286 against 337 items) because images load at different times. The limit (35%), the 10 MB document, the control (must grow at least 3 times) and the same-work check are unchanged. This changes how the gate measures, so it needs your yes.
- **Results on a fresh release build of the current tree (app code identical to `d5166ab`):**

  | Scenario | Result |
  |---|---|
  | decorations-scale, final code, 3 runs | worst deviation 0.198, 0.192, 0.212 against 0.35; same work in both places each time (an earlier settle variant gave 0.182, 0.210, 0.207) |
  | reveal, final code, 2 runs of 5 | work per leave p95 4.10 and 4.00 ms against 16; repeatable (within 5 to 8%); the earlier settle variant gave 4.10 |
  | Before, same app code, unmodified scenarios | decorations-scale failed same-work in every run; reveal stopped on run 1, twice |

- ISC-58 and ISC-63 stay un-ticked in the ISA until you accept the scenario change, because they only pass under it.
- **Not checked:** whether a person sees the 199,000 px jump when a long jump into a big file finishes parsing (one frame or so, in a 10 MB file, which the app does not parse anyway). In the 3 MiB range I did not look.

### typing-5mb: not the nested parsers, and not a supported size

- The app opens anything above 3 MiB as plain source with no parser (`src/documents/largeFile.ts`, ISC-8, cutoff confirmed in Phase 3). `typing-5mb` forces a parser onto a size the app never gives one. The supported largest file, the 3 MB fixture (406 bytes over the cutoff), measures **11.7 ms** at T4 in the release build against 16.
- **Cause, measured in the debug app:** the scenario starts typing 300 ms after the file loads, while the background parse is still on its way to the caret. Each key then pays the parser catching up, which costs about the 25 ms work slice. Typing after the parse has finished:

  | 5 MB, debug app | p50 / p95, parse unfinished | p50 / p95, parse finished first |
  |---|---|---|
  | nested code parsers on | 28.1 / 35.7 ms | 10.4 / 15.3 ms |
  | nested code parsers off | 27.0 / 34.0 ms | 10.2 / 17.0 ms |
  | 3 MB, nested on | 6.0 / 9.6 ms | 5.3 / 7.9 ms |

  So the nested parsers do not slow a key. They make the whole parse take longer (jsdom, 5 MB: about 1.5 s against 0.9 s), so the unfinished window is longer. The earlier release comparison (35.0 against 16.8 ms) falls out of that. A CPU profile of the unfinished case puts about 7.7 of 9.3 busy seconds inside `ParseContext.work`.
- **Option (b) is not built.** Parsing and coloring fences only near the view would need a way to re-parse a fence when it scrolls into range, and CodeMirror has no clean one (a no-op edit would dirty the document). The measurement says it would fix a number at a size the app does not parse. If you want headroom above 3 MiB anyway, the cutoff is the lever, and Phase 3 already chose it with these same scenarios.
- The debug app runs the dev JavaScript, so its absolute numbers are higher than the release ones; I rely only on the comparisons within each table.
- **Subagent decisions:** none.

## Final perf set on e564f1c: one gate missed, ISC-6 tab-switch (2026-11-08)

Fresh release build of `e564f1c` (HEAD; app code identical to `d5166ab`, only `src/perf` and docs differ), Windows 11, Ryzen 7 8840HS, WebView2 157.0.4341.42, 5 counted runs after 2 warm-ups unless stated. All four gates (`pnpm check`, `check:rust`, `test:web` 797 passed, `test:rust`) exit 0.

| Scenario (claim) | Limit | Result | |
|---|---|---|---|
| startup, warm (ISC-4) | 1500 ms | 611.4 ms (601.6 to 642.2) | pass |
| startup, fresh profile, 3 first launches | 1500 ms | 691.4 ms median (627.1 to 744.1) | pass |
| open-1mb (ISC-5) | 100 ms | 29.0 ms (28.1 to 30.9) | pass |
| **tab-switch p95 (ISC-6)** | 50 ms | **52.7 ms** (51.6 to 53.3, repeatable) | **over** |
| typing-1mb / trusted (ISC-7) | 16 ms | 6.9 / 7.7 ms | pass |
| typing-2mb / 3mb | 16 ms | 8.3 / 11.1 ms | pass |
| decorations-scale (ISC-63) | 35% | worst deviation 0.2155, same work in both places | pass |
| reveal (ISC-58) | 16 ms | 4.0 ms (3.9 to 4.3) | pass |
| scroll-stability (ISC-72) | 2 px | 0.47 px up, 0.25 px down; control drifted 299.6 px | pass |

typing-5mb is dropped from the named list by your decision (it forces a parser onto a size the app opens as plain source). The scenario code and `SIZES_MB` are unchanged; I just no longer run or report it.

### ISC-6 tab-switch: numbers

| Build | switch p95 | total median | sync median | plain switch p95 | switch with a pending edit p95 |
|---|---|---|---|---|---|
| `c98e4d0` end of Phase 3 | 16.1 ms (15.5 to 16.8) | 12.5 | 1.7 | 17.3 | 11.1 |
| `708a90c` T1, block layer | 52.4 ms (52.1 to 55.1) | not read | not read | not read | not read |
| `d5166ab` T4 | 49.6 ms (48.4 to 51.0) | 37.8 | 6.0 | 52.6 | 16.2 |
| `e564f1c` HEAD | 52.7 ms (51.6 to 53.3) | 43.0 | 6.2 | 56.2 | 18.0 |

- **Measured:** the first build over 50 ms is T1, the commit that adds the block layer (tables, images, frontmatter). T2 and T3 were not measured: the bisect was killed by the system for low memory after T1, and I did not restart it. The miss was thin at T4 (49.6) and I called it a pass by 0.4 ms; it is the same code at HEAD and 3 ms over, so the T4 number was inside the noise and I should not have counted it as a clear pass.
- **Measured:** the synchronous part of a switch (`next.show(view)`) grew only from 1.7 to 6.2 ms. Most of the growth, about 26 ms in the median, is in the frame after it. Plain switches are the slow ones (56.2 ms p95); a switch that also applies a pending edit is 18.0 ms.
- **Superseded by the profile below.** (The hypothesis here, widgets drawn from nothing in general, was too wide: it is one very large table.)
- **What I did not do:** change any code or limit for this. A subagent may not decide it.
- **Options, recommendation first:** **(1)** profile one switch in the real window with the block layer on and off, then fix what the frame is spending on (for example cheaper first draw of table and image widgets); **(2)** bisect T2 and T3 too, if you want the cost split between tables and images before touching code. I would do (1) and fold (2) into it.
- **Subagent decisions:** none.

### ISC-6 tab-switch: profile in the real window (2026-11-08)

Debug app (`cargo run --features perf` against the dev server, DevTools port). A replay of the scenario: the two 1 MB fixtures, `view.setState` back and forth, 100 ms apart, 8 to 10 warm-up and 30 to 40 counted switches, time to the end of the next frame, plus the browser's own style, layout and script durations. The block layer was switched off with a temporary flag (reverted). Absolute numbers are dev JavaScript, so I rely on the comparisons.

- **Measured: the cost is the switch to `tables-heavy-1mb.md`.** Median total 51 to 56 ms (p95 63 to 75) with the block layer, 15 ms without. Switching to `realistic-1mb.md` is 12 to 14 ms with it and 10 to 11 ms without. Per switch (both documents averaged): layout 13.6 ms against 3.1, style 5.0 against 2.5, script 1.6 against 2.6; layout and style passes are 4 per two switches either way, so it is not extra passes, it is more work in each.
- **Measured: why.** The first screen of that fixture is one table of 2,907 cells (about 290 rows). With the layer the view draws it whole: a 50,794-character viewport holding 1 block widget, 6 line elements and 4,505 DOM elements; without the layer the same text is 29 lines and 1,669 elements. Building that table (`TableWidget.toDOM`) is about 6 ms; the rest is style, layout and paint of 2,907 cells. The fixture's longest table is 296 rows (4,180 table lines in the file).
- **Measured: what does not help** (tables-heavy switch, total median / p95): `table-layout: fixed` 68.4 / 91.9 ms (worse); separate borders instead of collapsed 50.4 / 59 ms; `contain: content` on the wrapper 49.3 / 65.1 ms; baseline 51 to 53.5 / 64 to 75 ms. CSS tricks on a table that is drawn whole do not change the cost.
- **Measured, upper bound for the fix:** hiding every body row after the 40th by CSS (the DOM is still built) gives 20.2 / 27.6 ms for the tables-heavy switch and 18.1 ms task time per switch against 36 to 38. A real fix that also skips building the hidden rows would be a little better.
- **Recommended fix, not built (it changes the table widget from T1, so it needs your yes):** draw a big table progressively. `toDOM` builds the header and the first rows that can be on screen (about 40) plus one spacer row for the rest at the estimated height; after the frame, idle slices append the remaining rows and remove the spacer, then `requestMeasure()` so CodeMirror takes the real height. `eq()` still keeps the DOM across edits, so only a fresh state (a tab switch, an open) pays for the first rows. Risks to check: scroll stability while the height settles (ISC-72), a click in a row that is not built yet (the caret must still land in its source), the table tests (ISC-64, ISC-65, ISC-183), and tables of 40 rows or fewer must be untouched.
- **Not done:** no app code changed. The tree is clean on `e564f1c` plus docs. T2 and T3 were not measured; the profile makes it unnecessary for this fix.
- **Subagent decisions:** none.
## ISC-6 fixed: big tables drawn in two steps (2026-11-08)

You approved building the progressive table. Commits `4a1383d`, `2fe9bdf` and `9d6f8e9`, all `[P4-T1]`, change only `src/editor/livePreview/blocks/widgets.ts` and add `tests/editor/tableProgressive.test.ts`. No Cargo, config or dependency change.

- **What it does:** a table with more than `FIRST_ROWS` = 50 body rows is built as its header, the first 50 rows and one spacer row as tall as the rest (33 px a row, the old estimate). After idle time (`requestIdleCallback`, 300 ms timeout; `setTimeout` where there is none) the table asks CodeMirror for a measure with a write step, keyed by the table's own wrapper element, and that step replaces the spacer with the real rows in one go. `estimatedHeight` is unchanged. A click on the spacer puts the caret in the row under the pointer. Destroying the widget cancels the fill. Tables of 50 rows or fewer are built as before.
- **Differs from what you approved:** the proposal said idle slices would append the remaining rows and that the first step would be about 40 rows. The build adds all the rest in one step, and the first step is 50 rows. One step means one layout of the finished table instead of many; the cost is that a table of thousands of rows becomes one long task, which I did not test (the fixture's longest table is 296 rows). 50 rather than 40 was a judgement call and is one constant.
- **Result, release build of `9d6f8e9` (the final tree), 5 runs:** tab-switch p95 **18.7 ms** (runs 20.3, 18.7, 18.7, 18.2, 20.2; repeatable) against 50; it was 52.7. Median 15.6, plain 16.3, with a change elsewhere 14.5, synchronous part 3.6. The run on `2fe9bdf` before the per-table key read 19.7 ms and was reported not repeatable (11% spread); it is superseded by this one.

| Scenario (claim) | Limit | Result | |
|---|---|---|---|
| startup, warm (ISC-4) | 1500 ms | 594.3 ms, repeatable | pass |
| startup, fresh profile, 3 launches | 1500 ms | 590.2, 605.8, 592.4 ms (median 592.4) | pass |
| open-1mb (ISC-5) | 100 ms | 24.6 ms | pass |
| tab-switch p95 (ISC-6) | 50 ms | 18.7 ms (18.2 to 20.3) | pass |
| typing-1mb / trusted (ISC-7) | 16 ms | 6.9 / 7.7 ms | pass |
| typing-2mb / 3mb | 16 ms | 8.0 / 10.8 ms | pass |
| decorations-scale (ISC-63) | 35% | worst deviation 0.213, same work in both places, control 5.3 ms (1 MB) and 59.8 ms (10 MB) | pass |
| reveal (ISC-58) | 16 ms | 4.1 ms | pass |
| scroll-stability (ISC-72) | 2 px | 0.47 px up, 0.25 px down; control drifted 299.6 px (image document, see below) | pass |

Gates on `9d6f8e9`: `pnpm check`, `check:rust`, `test:web` (807 passed), `test:rust` (102 passed) all exit 0. Two earlier release runs of this set are not used: one was killed by the system for low memory after typing-2mb (I did not restart it until you freed memory), and one was on `2fe9bdf`, before the per-table key.

### Scroll stability while the rest fills (the ISC-72 risk named in the proposal)

- **The release scenario does not cover it.** `scroll-stability` walks its own image document with no table over 50 rows. I measured the case in the debug app instead (dev JavaScript, not a gate): the line right under the first big table of `tables-heavy-1mb.md` parked at the top of the view, its position read from the height map every frame.
- **First version (idle swap outside CodeMirror's cycle): a real miss.** In 8 runs the line moved 0.1 px in 5, 18 px in 1 and **107 px** in 2. The old widget held still in the same probe. I do not call that CodeMirror's own drift: the old widget does not show it.
- **Fix:** do the swap in a `requestMeasure` write step, so CodeMirror sees the DOM change and the height change in one pass. 14 runs with it: the 107 px move did not recur; the line settles at -18.6 px, where the old widget leaves it (-18.5), in 13 runs and stayed at -0.4 in one. The first-sample difference (-0.4 against -18.6) in some runs is CodeMirror's first measure of the lines above, which the old widget makes too.
- **What the fix costs:** a tab opened already scrolled into the rest of a big table shows the blank spacer for 2 to 3 frames (52 to 80 ms, six samples) instead of 1 to 2 (39 to 45 ms). I judged that better than a line moving up to 107 px; it is untested.md row 29.
- **The fill frame:** 45 to 64 ms against 17 ms in the debug app (dev JavaScript), so about 30 to 45 ms of work, not the "about 25 ms" I first wrote. With the old widget the equivalent frame, which drew the whole table, took 99 to 148 ms. Release not measured.
- **Found along the way, not caused by this change:** with the old widget too, a view parked deep (about 13,400 px) right after open moves about 3,000 px when the parse finishes 170 to 270 ms later. That is the row 27 jump, now seen at 1 MB.
- **A test that could not decide:** scrolling up step by step through the tables document gave a few frames of thousands of px of movement with both widgets (3 old, 2 new), because rows are about 78 px against the 33 px estimate. It cannot separate a small difference, so I do not use it as evidence either way.

### Other checks and things I tried

- **Real window:** 50 rows on the first frame, the rest within about 65 ms, content height settles to the same 100,022 px as with the old widget. Opening 5000 px into the table, the settled view is the same as the old widget's (same first visible row); at 9000 px the old widget settled at scrollTop 8982 and the new at 9000, so I do not claim the same scroll position, only the same rows. A real mouse click on row 54 of the undrawn rows landed on source line 112, the expected line, before and after the write-phase change.
- **Tried and removed:** an `IntersectionObserver` that fills at once when the spacer is in view. Measured 1 blank frame against 1 to 2 with idle fill alone, so I removed it with its tests.
- **Mistakes caught:** my first scroll-anchor control was invalid because the page still held the new widget in its module cache; I caught it from the row counts, reloaded after swapping the file, and redid it. A test of mine first checked only that `requestMeasure` was called, which CodeMirror also does by itself; it now looks for the table's own key, and breaking that line fails it.
- **Bug found on a second look, fixed in `9d6f8e9`:** after the write-phase change all tables shared one measure key, and CodeMirror keeps only the last pending request for a key (`requestMeasure` in the view source replaces it). Two big tables asking for their fill in the same idle period would leave the first with its spacer. A unit test with two big tables and a stand-in view that keeps one request per key failed on `2fe9bdf` (first table at 50 rows, expected 170). In the real window I never saw it: a walk down `tables-heavy-1mb.md` (28 stops, 350 ms at each, 29 big tables seen after their fill) found no spacer left, with the fixed code (two walks) and with `2fe9bdf` (one walk). So the effect in practice is unproven, and the fix follows from CodeMirror's contract. The test now fails if the shared key comes back.
- **Known limits:** untested.md rows 27 and 29 to 34.
- **Subagent decisions:** none.

## Row 27 looked at: the jump while a document is still being parsed (2026-11-08)

You asked me to look at untested row 27 before the merge. Everything here is from the debug app (dev JavaScript) with a DevTools script; I changed no code and no release measurement was made.

- **The app cannot reach the big case.** It never calls `forceParsing` (only the perf scenarios do), it does not parse files over 3 MiB, and it does not restore a scroll position: opening or switching a tab calls `view.setState`, which starts at the top, and a switched-to tab is already parsed. So the 199,000 px frame belongs to the perf scenarios, which already wait for the view to settle. To be deep in a document before the background parse finishes, a person has to jump there in the first fraction of a second: Ctrl+End, a scrollbar drag, or the like.
- **What CodeMirror does:** when the parse advances, the block layer adds table and image widgets above the view and the content height changes by tens of thousands of px (for example 195,898 to 158,690 in one step). CodeMirror records an anchor in that update and corrects `scrollTop` at its next measure, about 70 ms later in the run I logged (148,299 to 109,876). So the text mostly stays put.
- **When it does not:** I parked the view with `scrollTop` about 10 ms after open and tracked the document line under the top edge after each painted frame, counting a change only when the new block does not contain the old position. `realistic-1mb`, `code-heavy-1mb`: none. `realistic-3mb` at 150,000 px: one displacement of 198 lines in 23 runs. `tables-heavy-1mb` at 90,000 px: a displacement of 88 lines in both runs I did. At 13,400 px one run and at 40,000 px three runs: no displacement beyond a single-line shift at the first measure in one of them. The shifts happen 140 to 450 ms after open, once, and stay.
- **Cause, not isolated:** in the one run I caught with update logging, the correction ran and still left the view 88 lines off, which fits CodeMirror computing it from height estimates. The table widget's estimate is 33 px a row, and this fixture's rows measure about 78 px, so the estimate error is large above the view. I have not tested that by changing the estimate.
- **Not caused by the two-step table.** The parked probe behaves the same with the old widget. Phase 3 had no block widgets, so no heights changed at parse time; I did not run Phase 3 code.
- **A different thing found while testing, untested.md row 35:** on `tables-heavy-1mb.md` the first Ctrl+End stops 5,268 px short of the bottom at every delay after open (0 to 1,200 ms), even with the caret left alone, and a second press reaches it (1 px short). Realistic documents reach the bottom on the first press. The old widget does the same. Likely the same estimate error; not confirmed.
- **My reading:** low exposure. It needs a deep jump in the first half second after opening a document with many tables or images, or a document of the extreme tables fixture. I would not hold the merge for it, but I have no release-build number and I did not try a fix.
- **If you want it fixed:** the candidate is a better `estimatedHeight` for tables, computed from the column count and the text length of the rows instead of a flat 33 px. It is one function in `widgets.ts` (changing a number that tests pin: "growing with its rows"), and I would check it with the same probes: the parked run on `tables-heavy-1mb.md` at 90,000 px (about 20 runs) and Ctrl+End on the same file. I have not built it.
- **Subagent decisions:** none.

## Code blocks drawn as a container (2026-11-08)

You asked for a styled container around fenced code, like Obsidian, in both themes, written so a Mermaid block can reuse it. Committed as `c85e3c7` (`[P4-T4]`, the code and its tests; the docs follow in the next commit). You said it belongs to P4-T4 and could also be a follow-up task, so tasks.md lists it as a follow-up under P4-T4. Files: `src/editor/livePreview/box.ts` (new), `scan.ts`, `index.ts`, `codeLanguages.ts`, `tests/editor/codeBlock.test.ts` (new), and two existing tests (`inlineCode`, `headings`) that said a fence produces no items. No Cargo, config or dependency change.

- **Answer I used:** fences at the top of the document only; fences in lists and quotes keep the plain look (untested.md row 37). The box is drawn across the whole line, which would cover a list indent or a quote bar.
- **MockupWeave:** I searched its `src/` for code-block styling (code block, `pre`, language label) and found none, so the look comes from your two Obsidian screenshots. If you point me at the file I will compare.
- **How it works:** the block stays real lines, no widget, so the caret, selection and syntax colors are unchanged. `boxLines` gives each visible line a position class (first, mid, last, only) and a `kind` class. The theme draws each line's slice of the border and background with `::before`; the gap to the text around it is padding inside the first and last line, because CodeMirror cannot measure a vertical margin. Colors, radius and spacing are CSS variables on `.cm-md-box` that default to existing tokens (`--syntax-code-background`, `--border`, `--radius`), so there is no new theme token.
- **Rendered and editing:** with no selection touching the block the fences are hidden and the language is a label at the top right (a line attribute drawn by CSS, so it cannot be selected or copied). With the caret in the block, edges included, the fences show and the label goes. The fence lines are lines in both states, so the block is the same height either way.
- **Label text:** the language list's own name once it has loaded (`ts` shows `TypeScript`), the word as typed before that or when the list does not know it, nothing for a fence without a word. `codeLanguages.ts` keeps the name when it loads a language and the re-parse that follows redraws the label; the list is still only loaded lazily (`languages-lazy` passes).
- **For Mermaid later:** call `boxLines` with `kind: 'mermaid'` for the editing state, and give a rendered widget the `cm-md-box cm-md-box-whole` classes. Only the CSS for the second is written.
- **Differs from the plan:** nothing in scope. I added a test for one case the plan did not list (two blocks keep their own labels on the page), after finding that the label decoration could not safely go in the shared cache: labels are free text and that cache is not bounded, so a line with a label is not cached.

**Evidence**

- **Tests:** `tests/editor/codeBlock.test.ts`, 21 tests (positions, hide and reveal with the caret outside, inside and at both edges, selection touching, unknown and missing language, info string, unclosed fence, two blocks, nested fences, indented code, a 5,000-line block, box lines without code, a real view in jsdom). I broke the code seven ways on purpose and each failed a test (listed under ISC-189). Gates on the working tree: `pnpm check`, `check:rust`, `test:web` (828 passed), `test:rust` (102 passed) all exit 0.
- **Real window (debug app, DevTools script):** screenshots in the dark and the light theme, rendered and editing, match your two Obsidian images in structure: bordered rounded box, label at the top right, fences shown muted with no label while editing. Line heights and total height identical with the caret in and out. A selection across the paragraph and into the box shows over the box background. Down-key walk through the block: clean in 14 of 15 runs; see untested.md row 38.

| Scenario (claim) | Limit | Result on a fresh release build of the working tree | |
|---|---|---|---|
| decorations-scale (ISC-63) | 35% | 0.253 worst deviation (was 0.213), same 354 and 334 items at 1 MB and 10 MB | pass |
| scroll-stability (ISC-72) | 2 px | 0.47 px up, 0.25 px down | pass |
| typing-1mb (ISC-7) | 16 ms | p95 7.4 ms (was 6.9) | pass |
| reveal (ISC-58) | 16 ms | p95 4.9 ms (was 4.1) | pass |
| tab-switch p95 (ISC-6) | 50 ms | 20.1 ms (was 18.7), repeatable | pass |
| open-1mb (ISC-5) | 100 ms | 25.3 ms (was 24.6) | pass |
| startup (ISC-4) | 1500 ms | 566.2 ms | pass |

Three runs each, five for startup; every one reported repeatable. The decorations-scale number is higher than before but the work is the same at both sizes (the harness checks that) and the limit is 35%. The small rises elsewhere are inside the run-to-run spread I have seen on this machine; I did not measure them against a build of the commit before this change.

- **Known limits:** untested.md rows 36 to 41.
- **Subagent decisions:** none.