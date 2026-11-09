# Phase 5 decisions

Deviations from the plan and choices it left open. Numbers carry the OS they came from.

## Checking the UI (all of Phase 5)

- Same two places as Phase 4: Interceptor or Claude in Chrome on `pnpm dev` (mock host), and the real app, `target/debug/mdmate.exe` built with `--features perf` against my own Vite server on port 1420, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, `MDMATE_DATA_DIR` in a temp folder, driven over the DevTools port. Port 1420 was free when I started; I stop the Vite server I started when I am done with it.
- Scripts live in the session scratchpad, not in the repo.

## P5-T1: link guard

**Your answers (2026-11-08), asked before any code:**

| Question | Answer |
|---|---|
| Executable targets (`hostile.md` links `.lnk`, `.hta`, `.bat`, `calc.exe`) | Refuse outright, no prompt |
| Host-less `file:///C:/...` | Refuse, like any other scheme |
| Which files may a link make readable (for P5-T2) | Markdown only, resolved by Rust from its own record of the document, `..` allowed |

**What was built.** `src-tauri/src/links/guard.rs` is the one place that decides what a document-derived target may do, in two steps:

1. `classify` reads the target as text only. Trim, strip `<...>`, refuse control characters, then: `#...` is an anchor; a scheme is allowed only for `http`, `https` (must be `//host`, no backslash, no user name or password) and `mailto`, in any case; a one-letter "scheme" is a drive and refused; anything else is a relative path. For a path the fragment is split off first, then the path is percent-decoded **once**, and only then checked: a leading `/` or `\` is refused (two of them as `network`), any `:` is refused (drive, stream, hidden scheme), names with `< > " | ? *`, a trailing dot or space, or a Windows device name are refused, and the last name's extension is checked against the executable list.
2. `resolve` builds the path from the document's folder by pushing plain names and popping for `..`, never with `Path::join` on target text, then asks the file system through a `FileSystem` trait. The resolved path is checked again for a share (a junction can point at one), for a folder, and for an executable extension after dropping trailing dots and spaces.

`links/mod.rs` turns the result into what the page sees (`describe`) or does (`follow`). Only an `Approved` value reaches the `Opener` trait, and only the guard makes one. Web and mail links and images open at once; another file returns `needs-confirmation` until the page sends `confirmed: true`; a Markdown target is granted through `Access::grant_file` and its path is returned. Two commands, `describe_link(id, href)` and `follow_link(id, href, confirmed)`, take the document id and the target as written; the folder comes from Rust's `DocEntry`.

**Choices the plan left open:**

- **No new crate.** The Windows opener is `ShellExecuteW` declared by hand in `src-tauri/src/platform/windows/mod.rs` (a module-level `allow(unsafe_code)` with a reason, every `unsafe` block with a `SAFETY:` comment), on a fresh thread with `CoInitializeEx(COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)` as Microsoft's docs ask. No parameters are passed, so a target is never read as a command line. macOS uses `open` and Linux `xdg-open` with the target as one argument and no shell; neither is tested here (CI only compiles them). I chose this over `tauri-plugin-opener` (its JS API would give the page an opener of its own) and over the `open` crate (one more dependency for three short functions).
- **Web addresses are re-encoded.** The opener gets plain ASCII: a space, a quote, `<`, `>`, a backslash and non-ASCII characters are percent-encoded. A side effect: an internationalized host name (`https://bücher.example`) is percent-encoded too, which a browser may not accept. Not tried.
- **The executable list** is in `guard.rs` and covers Windows programs, scripts, shortcuts and shell files, installers and mountable images (`.iso`, `.img`, `.vhd`), plus macOS and Linux equivalents, on every OS. I did **not** add HTML, SVG or XML, since you approved refusing executables, not browser-opened documents: they ask first like any other file. SVG is also left out of the image list (which opens with no question), because its default app is usually a browser.
- **Folders are refused** (`folder`). The plan does not say what a link to a folder does; opening Explorer from a document seemed outside "Markdown in a tab, other files after a yes". Easy to change.
- **Missing and unreadable targets are the same answer** (`missing`), which P5-T3 will style as broken.
- **Refusal reasons are stable names** (`scheme`, `network`, `executable`, ...), mirrored in `src/platform/links.ts`, which also validates every reply from Rust.
- **The browser mock has a deliberately small stand-in** for the guard, so links can be followed under `pnpm dev`. It is not the guard and never ships.

**Evidence:** see the ISA Verification entries for ISC-16, ISC-17 and ISC-18. Deliberate breaks, each with the number of link tests that failed: any scheme taken as web 3, user name allowed 1, checks on the undecoded path 4, rooted and UNC check removed 4, colon check removed 1, text-level executable check removed 1, forbidden characters 1, device names 1, trailing dots kept 1, share folder not checked 1, resolved path not checked for a share 1, confirmation ignored 1. The control-character check first survived its break (other checks still refused every case), so it now has its own test, which fails when the check is removed.

**Real app, hostile input (2026-11-08, Windows 11, debug build):** `hostile.md` copied to a temp folder with real `run.bat`, `payload.hta`, `installer.lnk` and `spec.pdf` files beside it. All 25 hostile targets came back `refused` from `describe_link`, and a `follow_link` with `confirmed: true` on each came back `link-refused`. While it ran, a monitor polled TCP connections to ports 445 and 139 every 100 ms (none), diffed the process list (only my own shell processes), and read the DNS cache after clearing it (no `*.invalid` entry). `sub/other.md` described as `markdown`, `spec.pdf` as `file`, `missing.md` as `missing`. The opener's positive path (a real browser launch) is checked in P5-T2 (ISC-77, ISC-78).

**Changes outside `src/` and `src-tauri/src/`:** none. No `Cargo.toml`, `tauri.conf.json`, capability or dependency change.

**Subagent decisions:** none.

## P5-T2: navigation

**What was built.** `src/editor/links.ts` finds the link under the pointer (`linkAt`: an inline link, a reference or shortcut link with its definition found anywhere in the text, an autolink, a bare GFM URL) and, on Ctrl+click (Cmd+click on a Mac) with the main button and no Shift or Alt, hands the target as written to a callback and keeps the click from moving the caret. Any other click is left to CodeMirror. Each `Document` adds the extension to its tabs through a new `followLink` option, and the store forwards to `src/documents/links.ts`, which asks Rust (`followLink`) and acts on the answer: a heading jump, `openPath` for a Markdown file (so an open file's tab is focused, as ISC-174 wants), nothing for a web link or image, or a question banner in the pane for any other file. A refused or missing target goes to the status bar.

**Choices the plan left open:**

- **Heading anchors are read from the text, not the parse tree** (`src/editor/headingSlug.ts`): ATX and setext headings at the top level, skipping fenced code and frontmatter, because the parser may not have reached the end of a long file. Headings inside lists and quotes are not found. GitHub gives them anchors too; they are rare and the plain text scan cannot tell a list from a paragraph reliably. Each heading's text is parsed with the Markdown parser to drop markers, link targets, images and tags before slugging.
- **Slugs.** GitHub's algorithm (github-slugger): lower case, remove everything but letters, marks, digits, connector punctuation, `-` and space, then spaces to `-`; duplicates get `-1`, `-2`. I wrote it as one Unicode regex instead of adding `github-slugger` as a dependency; the regex is my reading of its character classes, checked on the examples in the test, not against its own test suite.
- **Matching a fragment.** Exact slug first, then the fragment lower-cased (people write `#Intro`), and a leading `user-content-` is dropped (GitHub's HTML ids carry it, and links copied from a rendered page do too). Not in the plan; small and easy to remove.
- **A jump puts the heading's line at the top of the view.** A tab that is not on screen yet (a new tab) keeps the scroll for when it is shown (`Follower.reveal`).
- **Where the question lives.** A banner in the pane, like the close and conflict banners, not a modal: "Open <path> in its default app?" with Open and Cancel. The path is the one Rust resolved, not the text of the link.
- **Win key.** `metaKey` counts as the gesture so Cmd+click works on a Mac; on Windows that means Win+click also follows a link. Harmless, untested.
- `@lezer/common` is not a direct dependency, so the syntax node type is derived from `syntaxTree` as `scan.ts` already does. No dependency, Cargo or config change in T2.

**Evidence.** `tests/links/navigate.test.ts`, 17 tests. Deliberate breaks, each failing at least one test: gesture check skipped (2), gesture without Ctrl (3), inline link target lost (3), references never found (1), reveal forgets the scroll (1), show ignores a pending scroll (1), duplicate slugs not numbered (1), fences not tracked (1), markup kept in the slug (1), punctuation kept in the slug (1), Cancel opening anyway (1), the fragment ignored after opening a file (1), the question skipped (1), the Ctrl+click wiring removed (1). One break survived, an `Image` check in `linkAt` that could never match (an image is its own node); I removed the line.

**Real window (debug app, Windows 11, trusted mouse over the DevTools port, 2026-11-08):** plain click on a link put the caret in it and opened nothing; Ctrl+click opened `sub/other.md` in a new tab; Ctrl+click on `sub/other.md#second-part` focused that tab with the caret on `## Second part`; Ctrl+click on `#lower-down` moved the caret to `## Lower down` in the same tab; Ctrl+click on `https://example.com/` opened Chrome on Example Domain; Ctrl+click on `spec.pdf` showed the banner and started nothing until Open, which started Acrobat Reader with the file. The browser tab and the Acrobat window were left open.

**Subagent decisions:** none.

## P5-T3: broken links and history

**Broken links.** `src/editor/brokenLinks.ts` is a view plugin. It lists the inline links `[text](target)` on screen whose target is a relative path, asks Rust about the ones it has no fresh answer for, 250 ms after the last edit, scroll or focus change, and draws a missing one with `cm-md-link-broken` (the theme's `--destructive` colour and a wavy underline). Rust answers through a new command, `check_links(id, hrefs)`, which runs each target through the same guard as `describe_link` and says only whether it is a missing file (at most 500 per call). Answers are kept per document, shared by its tabs, for 5 s; while a view shows local links it asks again every 5 s, so a file that appears or vanishes is redrawn within about 5 s without any typing. A view with no local links on screen keeps no timer.

- **Not checked:** reference links (finding a definition reads the whole text, too much for every update), anchors inside the same document, the `#fragment` of a file link, links in tables or frontmatter while they are drawn as widgets, and plain-source documents (no parser). Refused targets (UNC, schemes) are not "missing", so they are not styled; following one says so in the status bar.
- **The colour needed `!important`.** The first real-window look showed the wavy underline but the text still link-blue: the link's colour sits on spans inside the mark. A screenshot caught it, not a test; the rule now wins.
- **Cost while typing** is one walk of the visible links per update, no IPC (the check waits 250 ms); measured with the perf set after P5-T6.

**History.** `src/documents/history.ts` keeps up to 100 locations (tab, document, path, caret), recorded when a followed link moves the caret: a heading jump or a Markdown file opened. Tab switches, clicks and searches are not recorded; the claims are about links, so I kept to jumps. Alt+Left and Alt+Right are commands (`navigate.back`, `navigate.forward`) in the registry. Going back first stores where the caret is now in the entry being left, so forward returns there. A location whose tab has closed reopens its file in a new tab; one that cannot be reached is dropped. Positions are clamped, not mapped through later edits.

- **The editor gave up Alt+Left and Alt+Right.** On Windows these are CodeMirror's syntax-wise caret moves (`cursorSyntaxLeft`), and the app's key listener deliberately leaves a key the editor handled alone (a P1 rule pinned by a test). Instead of changing that rule, the follower and standalone keymaps leave out the keys in `APP_KEYS` (`src/editor/create.ts`). Behaviour lost: Alt+Left/Right no longer jump over syntax nodes in the editor.
- `tests/workbench/defaultCommands.test.ts` pins the command list; it now lists the two new commands (10 instead of 8).

**Changes outside `src/`:** `src-tauri/src/commands/mod.rs` and `lib.rs` (the `check_links` command), `src-tauri/src/links/mod.rs` (`missing`, `CHECK_LIMIT`). No dependency, Cargo.toml or config change.

**Evidence.** `tests/links/history.test.ts` (10) and `tests/links/brokenLinks.test.ts` (11), `pnpm test:rust missing_marks_only`. Deliberate breaks, all caught in the end: jump not recorded (6 tests), forward kept after a new jump (1), back stepping forward (6), caret not remembered (1), closed tab not reopened (1), caret not moved (1), Alt+Left not bound (1), editor keeping Alt+Arrow (2), answers never stale (1), no redraw on an answer (2), no recheck after an edit (1), web links checked (2), no batching (1), images counted as links (1), no periodic recheck (1), a timer kept with no links (1). Three survived at first, each because the test was weak (a loop over an empty set, typing before the first check, a timer no test could see); the tests were fixed, not the code.

**Real window and dev page:** see the ISA Verification entries for ISC-79 to ISC-81. Interceptor ran on `pnpm dev` in the test profile (`interceptor-test`, group `mdmate`).

**Subagent decisions:** none.

## P5-T4: format commands

**Your answers (2026-11-08):** bold Ctrl+B, italic Ctrl+I, link Ctrl+K, inline code Ctrl+`; strikethrough Alt+Shift+5; heading raise Ctrl+Shift+Up and lower Ctrl+Shift+Down, where raising a paragraph makes it H6 and lowering an H6 makes it a paragraph again.

**What was built.** `src/editor/format.ts` holds pure functions from a state to the change they make: `toggleInline` (bold, italic, inline code, strikethrough), `insertLink` and `shiftHeading`. Seven commands in the registry (`format.*`) apply them to the active tab's follower, so the change goes to the document's master and undoes as one step.

**Choices the plan left open:**

- **What counts as already formatted is read from the syntax tree**, not from the characters around the selection, so `**` inside inline code is not bold, `***x***` is bold and italic, and `__x__` is bold. A selection counts when its edges are on or inside the span; a caret only when it is strictly inside, so a caret right after `**word**` starts a new pair instead of taking the bold off what was just typed.
- **A caret with no format inserts an empty pair** with the caret between (`**|**`). It does not wrap the word around the caret.
- **The link command** puts selected text in the brackets and the caret in the empty target; a selected web address goes in the target with the caret in the brackets; a caret inserts `[]()`. It does not ask for an address.
- **Heading keys** work on every line the selection touches and leave lines in fenced or indented code, and blank lines, alone. Setext headings (`Title` over `===`) are treated as paragraphs: raising one adds `###### ` and leaves the underline.
- **Ctrl+I** was CodeMirror's "select parent syntax"; it is now in `APP_KEYS` with Alt+Left and Alt+Right, so the editor gives it up.
- `tests/workbench/defaultCommands.test.ts` pinned Ctrl+B as "not a shortcut" (a P1 placeholder saying it was kept for bold); it now uses Ctrl+J for that case, and the list of commands has 17 entries.

**Evidence.** `tests/editor/commands.test.ts`, 34 tests. Deliberate breaks, all caught in the end: never unwrapping (12), unwrapping one marker (16), a misplaced caret in an empty pair (4), a wrap losing the selection (8), the address not detected (1), the caret not in the target (1), raising past H1 (1), H6 not lowered (2), code lines changed (1), a paragraph raised to H1 (3), read-only ignored (1), Ctrl+I left to the editor (1), Ctrl+B unbound (1), a caret counting on the edges (4), a selection required strictly inside (4). Three survived the first round: a branch for a selection that includes the markers was dead (the tree lookup already covers it) and is removed; a second lookup from the left made a caret just after a span take its format off, which I judged wrong and removed; and the code-line test used an H1, which cannot be raised anyway, so it now uses H2.

**Real window:** see the ISA Verification entries. No dependency, Cargo.toml or config change.

**Subagent decisions:** none.

## P5-T5: list editing

**What the probe showed first.** `markdown()` already binds Enter to CodeMirror's `insertNewlineContinueMarkup`, and a probe on the T4 tree showed it continues bullets, numbers, quotes and `- [x]` (as `- [ ]`) already, so ISC-90 and ISC-91 held before any code. Two things did not: Enter on an empty item inserts a blank line and keeps the list going (CodeMirror makes a tight list loose before it ends it, on the second press), so ISC-92 failed; and an empty nested item gave `" \n  - "`, a broken line.

**What was built** (`src/editor/lists.ts`, in every follower and standalone state with the parser, at `Prec.highest`):

- **Enter** on an empty item (only its marker and perhaps a task box, caret at the end): a nested item steps out one level, keeping its marker; a top-level item is removed and, when a list line is right above, a blank line is left so the next text is a paragraph and not a lazy continuation of the last item. Everywhere else, CodeMirror's continuation.
- **Tab** nests the item under the item before it, lined up with that item's text (two spaces under `- `, three under `1. `), and moves every line of the item along, children included. The first item of a list has nothing to nest under: nothing changes, but the key is taken.
- **Shift+Tab** moves a nested item to the indentation of the item it is nested in, children included. A top-level item stays put and the key is taken.

**Choices the plan left open:**

- **Tab and Shift+Tab outside a list** kept the browser's meaning (focus moves) at first; changed on your answer, see "Tab outside a list stays in the editor" below.
- **Numbers are not renumbered** after an indent or outdent; `2.` nested under `1.` stays `2.`, which renders as a list starting at 2.
- **Only the item at the caret** is moved, not every item a selection covers.
- **Tab-indented lists** are shifted with spaces; a line indented with a tab loses up to the same number of characters on Shift+Tab, which may not line up. Not tried in the real window.

**Evidence.** `tests/editor/lists.test.ts`, 11 new tests. Deliberate breaks, all caught in the end: an empty item continuing (2), no blank line after the ended list (1), a nested empty item ending instead of stepping out (1), an empty task item not seen as empty (1), indent ignoring the previous marker's width (2), children left behind (2), the first item indented anyway (1), read-only ignored (1), the keys below CodeMirror's (1), the keys missing from followers (1), and a top-level Shift+Tab giving the key back to the browser (1, after adding a check of what the command returns; the first round could not see it).

No dependency, Cargo.toml or config change.

**Subagent decisions:** none.

## P5-T6: smart paste and one selection

**Probes before code, and what they showed.** ISC-96 already held: CodeMirror keeps only the main range while `allowMultipleSelections` is off, its default, in every state the app builds. I only added a test that fails if any state turns it on. ISC-95 also already held, which I found only after writing my handler, because I did not probe it first: `@codemirror/lang-markdown` 6.5 ships `pasteURLAsLink`, on by default in `markdown()`, and in a test my handler never ran.

**Why mdmate has its own handler anyway.** The package's handler has two faults: it dispatches without checking `readOnly`, so pasting an address over a selection in a document opened read-only (an unsupported encoding) changed its text, which a test shows by turning the package's handler back on; and it accepts any text that starts with `https://`, spaces included. `src/editor/paste.ts` keeps its one good rule (the selection must be plain text that no syntax node starts or ends inside, which also covers selecting an address the parser already marks) and adds the read-only check and a whole-address check (`looksLikeUrl`, shared with the link command: `http`, `https` or `mailto` with no space). `markdownSupport()` now passes `pasteURLAsLink: false`. A consequence of the plain-text rule, the same as the package's: words inside a bold span touch its closing marker, so pasting over them is a plain paste. `www.` addresses (which the package turned into `https://www.`) paste plainly.

**Evidence.** `tests/editor/paste.test.ts` (7) and `tests/editor/selection.test.ts` (2). Deliberate breaks, all caught: any text linked (1), several lines linked (1), the caret left inside (1), read-only ignored (2), the handler not wired (1, once the package's handler was off), the address not trimmed (1), syntax crossing allowed (1), the package's handler back on (1), multiple selections on followers (2) or on the master (2). One survived: a separate check for an address pasted over an address was redundant with the plain-text rule and is removed.

**Real window:** the paste used the real Windows clipboard. I saved its text, set it to the address, pressed Ctrl+V, and wrote the saved text back afterwards.

No dependency, Cargo.toml or config change.

**Subagent decisions:** none.

## P5-T7: drag selected text

**What changed from the spike.** `textDrag()` (`src/editor/textDrag.ts`, from P0) is now in every editor state the app makes: the followers that tabs show, and standalone states with and without the parser. One addition: a drawn block widget (a table, a block image, the frontmatter pill) is never a drop target. Text dropped on a widget's edge would join the first or last line of its source and break the table or the pill, so over a widget the drop caret is not shown and a release does nothing. The spike's comment that the app did not use it is gone.

**What the spike left open, and what I found:**

- **Line endings carried with moved text.** Already handled in P2-T4: the endings field recognizes a move by its shape, one deletion and one insertion of the same text, and carries the endings of the breaks inside it. `tests/editor/lineEndings.test.ts` pins that shape against `moveSelectedText` and its 300 random runs include drags; I changed nothing there.
- **Live-preview hidden syntax.** `posAtCoords` never returns a position strictly inside a replaced range, so a drop lands at the edge of hidden syntax, never inside it. Not looked at for every kind of syntax in the real window.
- **Block widgets:** see above.
- **125% display scale:** the laptop screen runs at `devicePixelRatio` 1.25, and every real-window check here ran at that scale: the drop caret showed, and the text landed where it showed. Only one machine and one scale were tried.
- **Cost on a large file:** measured in the debug app (dev JavaScript, so release would be lower). On `realistic-3mb.md` (opens as plain source, over the cutoff) and `realistic-2mb.md` (with the parser), the work for one pointer move (a hit test plus the caret effect) is 0.3 ms median and 0.5 to 0.6 ms p95 over 60 moves. A drop of a 200-character selection, timed to the end of the next frame, is 16.6 ms median on 3 MB and 15.4 ms on 2 MB, so most of that is the frame wait; the worst of 10 drops on 2 MB took 35.6 ms, one late frame. No gate covers drag.

**Evidence.** `tests/editor/textDrag.test.ts`, now 20 tests (15 from the spike, 5 new in jsdom with stubbed geometry): a pointer drag in a real view of a document's tab moves the text and the selection follows (ISC-177); one undo through the document restores it (ISC-178); standalone plain-source states drag too; a release on a drawn table moves nothing while the same drag onto plain text does. Deliberate breaks, all caught: no drag in followers (3 tests), none in standalone states (1), blocks as drop targets (1, after adding the drag-onto-a-table test; the first round only tested the helper), a widget's edge not counted (1), the move split so it is not one change (12).

**ISC-179** needs a real mouse: P0 showed that injected input does not reproduce the Windows native-drop problem (CodeMirror's own drag works with injected input and fails with a real mouse). Real-window evidence with trusted CDP input is in the ISA for ISC-177 and ISC-178. ISC-179 stays open until you drag by hand with native file drops on; P5-T7 is not ticked until then.

**No dependency, Cargo.toml or config change. Subagent decisions:** none.

## Perf after P5-T4 to P5-T6 (2026-11-08)

Fresh release build of `eca8ca0` (T6; the T7 edits were made after the build had read the sources, and the entry bundle has no drag code), Windows 11, Ryzen 7 8840HS, WebView2 157.0.4341.42, 5 counted runs after 2 warm-ups, the debug app stopped first. I measured once after T6 rather than after each of T4, T5 and T6.

| Scenario (claim) | Limit | Result | Repeatable | Phase 4 end |
|---|---|---|---|---|
| startup (ISC-4) | 1500 ms | 677.7 ms (651.7 to 747.5) | no (10% spread; CPU under 85% idle before every run) | 566.2 ms |
| typing-1mb (ISC-7) | 16 ms | p95 8.4 ms (8.2 to 10.3) | no (one run at 10.3) | 7.4 ms |
| typing-1mb-trusted (ISC-7) | 16 ms | p95 8.3 ms (8.2 to 8.8) | yes | 7.7 ms |
| reveal (ISC-58) | 16 ms | p95 4.6 ms (4.5 to 5.2) | yes | 4.9 ms |

Every gate passes. Startup and typing are higher than at the end of Phase 4 (about 110 ms and 1 ms). I did not bisect the cause: the CPU was busier than in Phase 4 (61 to 84 percent idle before the startup runs), and the margins are 2.2 times and 1.9 times the limit, so I recorded it rather than stopping. Files: `perf-results/startup-20261108-223057.json` and the three after it.

**ISC-179, by hand (2026-11-09):** you dragged selected text with your mouse in the debug app, undid it with Ctrl+Z, dropped a file from Explorer on the window and dragged again; you answered that all of it worked. P5-T7 is done.

## Phase end: speed set on HEAD, and ISC-63 could not be measured (2026-11-09)

Fresh release build of `4988cdf`, Windows 11, Ryzen 7 8840HS, WebView2 157, 5 counted runs after 2 warm-ups, the debug app and my Vite server stopped. **The window ran on the laptop screen at `devicePixelRatio` 1.25**; it was the only display connected. Every passing run of these scenarios in Phases 3 and 4 recorded `devicePixelRatio` 1 (an external monitor).

| Scenario (claim) | Limit | Result | Repeatable |
|---|---|---|---|
| startup (ISC-4) | 1500 ms | 510.6 ms | no |
| open-1mb (ISC-5) | 100 ms | 22.0 ms | no |
| tab-switch p95 (ISC-6) | 50 ms | 16.9 ms | no |
| typing-1mb p95 (ISC-7) | 16 ms | 6.1 ms | yes |
| typing-1mb-trusted p95 (ISC-7) | 16 ms | 7.8 ms | no |
| typing-2mb / 3mb p95 | 16 ms | 6.6 / 8.7 ms | yes |
| reveal p95 (ISC-58) | 16 ms | 5.4 ms | yes |
| scroll-stability (ISC-72) | 2 px | 0.70 px up, 0.15 px down; control 628 px | |
| **decorations-scale (ISC-63)** | 35% | **no number**: the page stopped with "the view did not return to its line after the parse", twice | |

- **ISC-63 is not caused by Phase 5.** Measured: the same failure with the T7 drag wiring taken out (`create.ts`, `textDrag.ts` and the test at `eca8ca0`), and with the Phase 4 code itself (`main` at `99cc99a`, in a temporary worktree, fixtures regenerated, removed afterwards). The difference from the Phase 4 runs is the display scale. Not diagnosed further: `settleOnLine` (the owner-approved settle step) waits for the target line to hold still for three frames and gives up after 5 s, and at 1.25 it never holds still. I did not change the scenario or the limit; that would change how a gate measures.
- **The ISC-71 bundle check** (`node scripts/check-arch.mjs languages-lazy --dist` on a `vite build --sourcemap`): passes. Entry chunk 549.71 kB (196.26 kB gzip), up from 526.01 kB (188.64 kB gzip) at the end of Phase 4: the Phase 5 code.
- **The perf scenarios do not build documents the way the app does.** `typing`, `reveal` and `decorations-scale` use `createState`, and `tab-switch` builds `new Document(...)` without the store's options, so none of them includes the broken-link plugin or Ctrl+click (which the store adds through `followLink` and `checkLinks`). The gate numbers above leave out the broken-link walk of visible links on every edit. Not changed, since it changes what a gate measures.

## Tab outside a list stays in the editor (2026-11-09, your answer)

You asked for Tab outside a list to move the caret within the editor, like other Markdown editors, instead of moving focus. Every editor state now has `Tab` bound to CodeMirror's `insertTab` (a tab at the caret, or the selected lines indented) and `Shift+Tab` to `indentLess`, below the list keys, so a list item still nests and outdents as before. The indent unit is now a tab, as in Obsidian's default, so Shift+Tab removes exactly what Tab added (with the default two-space unit it turned a tab into two spaces, which a test caught). A read-only document still lets the key move focus. Tests: three keydown tests on a real follower view in `tests/editor/lists.test.ts`; removing the Tab keys, the tab unit, or putting the list keys below them each fails a test. Not looked at in the real window.
