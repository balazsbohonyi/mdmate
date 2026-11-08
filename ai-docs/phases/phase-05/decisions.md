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
