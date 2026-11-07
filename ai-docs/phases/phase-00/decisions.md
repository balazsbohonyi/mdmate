# Phase 0 decisions

Deviations from the plan and choices it left open. Numbers carry the OS they came from.

## P0-T1

- **TypeScript stays on `~6.0.3`, not 7.x.** typescript-eslint 8 requires `<6.1.0`, so 7.x would break the lint gate. Revisit when typescript-eslint supports it.
- **Bundled Inter instead of loading it from Google Fonts.** shadcn-vue added a Google Fonts `@import`, which is a network request that ISC-20 forbids and the CSP would block. `@fontsource-variable/inter` ships the font files inside the app (218 KB across 7 subsets; the browser loads only the subsets a document needs). `--font-sans` falls back to the system stack. Inter is OFL-1.1, so its notice must ship with the installer (recorded in the ISA under Remaining Work).
- **Added `src/lib/` to the layout.** shadcn-vue's `cn` helper lives there.
- **`tauri.conf.json` `backgroundColor` duplicates the dark `--background` token (`#1e1f22`).** The native window paints before any CSS loads, so the value cannot come from a token at runtime. A comment in `tokens.css` names the pair.
- **`tauri-plugin-opener` left out of the scaffold.** Nothing uses it before Phase 5, which adds it with the link guard.
- **The crate builds as `rlib` only.** The template's `staticlib` and `cdylib` exist for mobile, which is out of scope, and they slow builds.
- **ISC-169 closes in P0-T3, not P0-T1.** `LICENSE` is added here, but the claim's probe is `check-arch.mjs license-mit`, which T3 builds.

## P0-T2

- **`pnpm check` is `vue-tsc`, ESLint and Prettier for now.** P0-T3 adds `check-arch` and P0-T4 adds `check-isa` to the same script, as the plan says. ISC-22 stays true only while the whole chain passes, so each later task reruns it.
- **`pnpm check:rust` is `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`.** It passes with no `dist/` folder, so a clean checkout needs no frontend build first.
- **Added `src/env.d.ts`, a `*.vue` shim.** ESLint's TypeScript program cannot read `.vue` files, so `import App from './App.vue'` came through as an error type. `vue-tsc` still checks the real component types.
- **Scripts and config files (`.js`, `.mjs`) lint without type information.** They sit outside `tsconfig.json`.
- **Prettier uses `endOfLine: "auto"`.** Git here has `core.autocrlf=true`, so a fresh checkout is CRLF and a fixed `lf` setting would fail every file.
- **Prettier skips `ai-docs/`, `ISA.md`, `AGENTS.md`, `src-tauri/` and fixtures.** Rust formatting belongs to `cargo fmt`.
- **Proved each gate can fail.** A planted type error in a `.vue` file, an `any` use, bad formatting, a Rust `unwrap` and bad Rust formatting each made the matching gate exit non-zero; the clean tree exits 0.
- **The macOS and Linux platform stubs are not compiled here.** Only the Windows build ran on this machine, so ISC-10 and ISC-11 wait for CI.

## P0-T3

- **All 11 rules are in `scripts/check-arch.mjs` and run in `pnpm check`.** `tests/scripts/checkArch.test.ts` runs the real CLI against temporary trees: each rule accepts a clean tree and fails every planted violation (67 tests). A planted case that only passes because the rule is blind would show as a passing test, so each case also asserts the rule's FAIL line.
- **Closes ISC-9, 12, 13, 21, 24, 73 and 169.** ISC-169 was listed under T1 but its probe is `license-mit`, so it closes here.
- **Rules built now whose claims close later:** `no-hard-coded-colors` (ISC-14, P1-T1), `no-unsafe-html` and `no-network` (ISC-15 and ISC-20, P10-T2), `languages-lazy` (ISC-71, P4-T4). They pass today because there is little code to violate them; the planted tests are what show they can fail.
- **`languages-lazy` reads source, not the build.** It fails on a static import of a language parser. The bundle inspection in ISC-71's probe joins the rule at P4-T4, when parsers exist to inspect.
- **`no-network` reads direct dependencies and the production CSP only.** `Cargo.lock` lists `reqwest` and `hyper`, but `cargo tree -i reqwest` finds nothing for this Windows build. The dev CSP is skipped, because it must allow the Vite dev server. Checking the full graph is under Remaining Work in the ISA.
- **`no-hard-coded-colors` checks hex literals and color functions** (`rgb()`, `oklch()` and the rest). Named colors and Tailwind palette classes are not checked, so a class like `bg-red-500` passes.
- **`no-os-cfg-outside-platform` ignores comments and string literals.** A `'"'` character literal could confuse its string stripping; none exists in the code.
- **`suppressions-have-reasons` skips `scripts/check-arch.mjs` and `tests/scripts/`,** because they contain the suppression syntax as test data.

## P0-T4

- **`scripts/check-isa.mjs` runs last in `pnpm check`.** It fails on a wrong `progress` total or closed count, a duplicate claim ID, a duplicate Test Strategy row, a leaf claim with no row, and a row with no leaf claim. `tests/scripts/checkIsa.test.ts` plants each one.
- **A leaf claim is any claim in `## Features` that is not a `[container]` parent or a `[DROPPED ...]` tombstone.** Containers and tombstones need no row and a row for one is an orphan, which matches `ai-docs/standards/isa.md`.
- **The count was checked independently of the script.** `rg` found 179 claim lines, 1 container, 9 checked and 178 rows, which gives the same 178 leaf claims, 9 closed and 178 rows the script reports.
- **Not checked, because the standard does not list it:** that every closed claim has a `## Verification` stub. That stays a rule of the task-end review.
- **No claim closes here.** The task supports ISC-22, so `progress` stays at 9/178.

## P0-T5

- **The workflow is written and committed but T5 stays open.** Its done-when is "all jobs green on a pushed branch", and pushing needs the owner's go-ahead. ISC-10 and ISC-11 stay open with it. After a push, check the run, fix whatever macOS or Linux reports, then tick T5 and close both claims.
- **What was checked locally:** `@action-validator/cli` accepts the workflow against the GitHub Actions schema and rejects a file with an unknown key. That proves the syntax and not the run. The platform stubs for macOS and Linux have never been compiled.
- **Jobs.** `windows` runs `pnpm check`, `pnpm check:rust`, `pnpm test:web` and `pnpm test:rust`. `compile` runs `cargo check` on macOS and Linux. The Linux job installs the package list from the Tauri v2 prerequisites page (verified 2026-11-07), including `libwebkit2gtk-4.1-dev`.
- **Actions are pinned to major tags** (checkout v7, setup-node v7, pnpm/action-setup v6, rust-cache v2, rust-toolchain stable) as of 2026-11-07, with read-only token permissions.
- **Expect CRLF on the Windows runner.** Git there checks out CRLF by default; Prettier, `check-arch`, `check-isa` and `cargo fmt` all accept it, and fixtures are `-text`.
- **Closed after the first push (2026-11-07).** The first pushed run was green on all three jobs (https://github.com/balazsbohonyi/mdmate/actions/runs/42367038816): `windows` ran all four gates in 5 m 26 s, and `cargo check` passed on macOS and Linux. The macOS and Linux platform stubs compiled for the first time there, with no fixes needed. ISC-10 and ISC-11 are closed on that run.

## P0-T6

- **`pnpm fixtures` writes every fixture, and the output is the same bytes on every run.** The script uses a seeded generator (mulberry32) and no clock. `tests/scripts/fixtures.test.ts` generates twice into temp folders and compares hashes.
- **The 8 small fixtures are committed (115 KB in total); the 4 large ones are generated.** The large ones are 1 MB and 10 MB realistic Markdown, a table-heavy 1 MB file and a code-heavy file, all in `tests/fixtures/generated/`, which git ignores. A test checks the committed small files against the generator, so a hand edit shows up as a failure.
- **The code-heavy file is 1.38 MB, not 1.0.** It contains blocks of up to 20,000 lines, and the test requires at least one block of 5,000 lines or more. Perf scenarios that need exactly 1 MB use `realistic-1mb.md`.
- **Realistic structure** means frontmatter, headings 1 to 4, paragraphs with bold, italic, code, strikethrough, relative links, reference links and autolinks, lists, task lists, quotes, tables, fenced code in 8 languages, images, rules and reference definitions. About 17% of words draw from a non-ASCII list.
- **The UTF-8 BOM, UTF-16 LE and UTF-16 BE files hold the same text**, and the test decodes each and compares it. The Latin-1 file uses only characters Latin-1 can encode, and the test confirms it fails strict UTF-8.
- **`hostile.md` names only `.invalid` hosts and `example.com`**, plus one local path (`file:///C:/Windows/System32/calc.exe`) that would open Calculator at worst. A test checks every host. Each script and handler payload sets `document.title`, so a leak would show. Never open this file in a browser.
- **Line endings:** `.gitattributes` marks the folder `-text` (checked with `git check-attr`), and Prettier ignores `tests/fixtures/`.

## P0-T7

- **`pnpm perf <scenario...|all>` builds the release app and measures it on the real WebView2.** It launches the app once per run, the page times itself, Rust writes the result and the app quits. Output goes to `perf-results/` as JSON, labeled Windows, with the CPU, WebView2 version, commit, clock resolution, CPU idle before each launch and every raw sample. Scenarios: `startup`, `open-1mb`, `tab-switch`, `typing-1mb`, plus `typing-1mb-trusted` as a cross-check. Each run has 2 uncounted warm-up launches, then 5 counted ones.
- **Files cross IPC as raw bytes.** `read_file` returns `tauri::ipc::Response` and the page gets an `ArrayBuffer`. Rust tests prove every byte survives (BOM, CRLF, a lone CR, a Latin-1 byte, a NUL) and that a 10 MB file reads. It reads any path until Phase 2 limits it to the open workspace.
- **No perf code ships.** The Rust commands sit behind the Cargo feature `perf`, and the front-end driver and bridge behind `VITE_MDMATE_PERF`. A normal `pnpm build` has 23 modules against 52, no 504 kB CodeMirror chunk and none of the perf command names (searched in `dist/`). `pnpm check:rust` lints both feature sets, so the perf code cannot rot.
- **The repeatability rule was fixed before the first run:** a number repeats when every one of 5 runs is within 10% of the median or within 1 ms of it, whichever is wider. 1 ms is the clock resolution. `tests/scripts/perfStats.test.ts` pins it.
- **What each number means.**
  - *Startup* is process spawn to a frame with the editor in it, on a window that is shown and focused. It is a floor: the shell plus a CodeMirror editor, with no sidebar, tabs or settings.
  - *Open* is the invoke call to the frame after the state is shown: IPC read, decode, build state, show, paint.
  - *Tab switch* is `view.setState` between two 1 MB documents to the frame.
  - *Typing* is the main-thread work one key causes: handling it and updating the editor, plus the next frame's style, layout and paint. Key to frame is printed too, but it adds an idle wait of up to 16.7 ms, so it is never judged.
- **Typing is measured two ways.** In `dispatch` mode the page inserts each character itself. In `trusted` mode real key events arrive through WebView2's DevTools port and the clock starts at the event's own timestamp. I did not use OS-level key injection, because it types into whichever window has focus.
- **Four flaws in my own measurement, fixed before the final runs.**
  1. Keys 50 ms apart are almost exactly three frames, so every key hit the same point of the frame cycle. The gap now has a random extra of up to one frame.
  2. Key to frame included the idle wait for the frame, so it could never go under about 16 ms. The headline is now work per key.
  3. The window-shown time was stamped when the wait ended, not when the window showed. It is now a `performance.mark`.
  4. The runner crashed when Windows could not start PowerShell for cleanup, under memory pressure. It now notes it and carries on.
- **Attempts, all under the same rule.** Attempt 1 (6 opens, 40 switches, 1 warm-up) failed startup (480 ms, runs 431 to 498), open (21 ms, 19 to 29) and tab switch (9.4 ms, 8.7 to 10.7). Attempt 2 raised the samples to 16 opens and 120 switches, and only tab switch failed (8.9 ms, 8.1 to 10.8). Its run 1 was slower across the whole distribution, and startup showed the same slow first run, so launches warm up. Attempt 3 used 2 warm-up launches and tab switch passed (9.4 ms, 8.9 to 9.8). The rule never changed. The other four scenarios were last run with 1 warm-up and pass anyway.
- **Baseline, plain CodeMirror 6 with the Markdown parser and no decorations (Windows 11, Ryzen 7 8840HS, WebView2 156.0.4314.58, 60 Hz, release build):**

  | Scenario | Median of 5 runs | Range | Target | Repeatable |
  |---|---|---|---|---|
  | Startup, launch to editable | 418.9 ms | 410.9 to 445.3 | 500 | yes |
  | Open 1 MB, warm | 17.0 ms | 16.8 to 17.8 | 100 | yes |
  | Open 1 MB, first of the run | 47.0 ms | 45.8 to 51.5 | 100 | |
  | Tab switch, p95 | 9.4 ms | 8.9 to 9.8 | 50 | yes |
  | Typing, work per key, p95 (dispatch) | 4.7 ms | 4.6 to 4.9 | 16 | yes |
  | Typing, work per key, p95 (trusted keys) | 5.0 ms | 4.9 to 5.2 | 16 | yes |

- **Where the time goes.**
  - Startup: spawn to Rust 12 ms, Rust to page start 274 ms (WebView2 starting), page start to app mounted 66 ms, then the window shows after 60 ms and the editor mounts after 52 ms, in parallel. WebView2 is two thirds of the total.
  - Open: IPC read 9.4 ms, decode 1.1, build state 1.4, show 0.5, paint 4.6. The IPC read scales with size, so it would be near 90 ms at 10 MB (not measured).
  - Typing p95: 3.7 ms for the update and 1.3 ms for the frame.
- **What these numbers do not cover.**
  - Paint stops at the main thread. GPU and compositor time after that is not measured.
  - Dispatch mode leaves out the OS and browser input path. Trusted mode includes the DevTools to page hop, not the OS to browser hop.
  - Only a warm WebView2 profile was timed. A first launch on a fresh profile or after a reboot is not, and T9 owns that question.
  - The runs use two flags: `--disable-features=CalculateNativeWinOcclusion`, so a covered window is not throttled, and, for trusted typing only, a DevTools port.
  - Other apps were open (VS Code, the Riftle launcher). CPU was 89% to 98% idle before every counted run, frames arrived every 16.7 ms and no run left a process behind.

## P0-T8

- **Kill rule: did not fire.** With live decorations on, typing on the 1 MB fixture costs 5.0 ms per key at p95 (5.5 ms with real key events), against 16 ms. The slowest single key in any counted run was 10.7 ms. Profiling was not needed, since the rule only asks for it when 16 ms cannot be held. Phase 3 can start on this question.
- **The decorations are throwaway and small** (`src/perf/throwawayDecorations.ts`, switched on with `--set decorations=1`). They style headings by level, mark strong, emphasis and inline code, hide the syntax marks (`#`, `*`, backticks) except where the caret touches, and rebuild on a change to the document, viewport, selection or parse tree, over `visibleRanges` only. They have no block widgets (tables, images, frontmatter, fences), links or lists. The real Phase 3 layer does more, so these numbers show the room it starts with, not what it will cost.
- **They did render.** After each decorated run, a probe reads the page. At the typing caret it found 21 strong, 17 emphasis and 18 code elements and 2 styled heading lines in view, and no strong element still showing its `**`. The `open-1mb` scenario ends at the top of the file, where nothing is formatted, so its decorated number is a lower bound. The probe does not check that marks come back when the caret enters them.
- **Same executable, same protocol.** Plain and decorated runs use one release build and differ only in a runtime switch. Each has 2 uncounted warm-up launches and 5 counted runs, judged by the repeatability rule from P0-T7, unchanged.

  | Scenario (ms, median of 5, range) | Plain | Decorated | Target |
  |---|---|---|---|
  | Startup, launch to editable | 429.3 (398 to 439) | 424.4 (423 to 432) | 500 |
  | Open 1 MB, warm | 16.7 (16.6 to 17.1) | 20.2 (20.0 to 21.1) | 100 |
  | Tab switch, p95 | 7.9 (7.7 to 8.7) | 11.1 (10.7 to 11.3) | 50 |
  | Typing, work per key p95 (dispatch) | 4.8 (4.6 to 5.0) | 5.0 (5.0 to 5.6) | 16 |
  | Typing, work per key p95 (real key events) | 5.2 (4.9 to 5.5) | 5.5 (5.4 to 5.9) | 16 |
  | Open 10 MB, warm | 87.3 (86.8 to 88.5) | 125.3 (117.7 to 126.7) | 100 |
  | Typing 10 MB, work per key p95 | 13.2 (12.4 to 13.7) | 14.4 (13.8 to 14.8) | 16 |

- **The 10 MB open gap is mostly not the decorations.** The extra 38 ms sits in the IPC read stage (57.7 ms plain, 93.7 ms decorated), which decorations never touch, and the runner warned that the CPU was under 85% idle before one run. Read 10 MB open as 90 to 125 ms until it is measured again on a quiet machine.
- **At 10 MB the document size is the cost, not the live preview.** The editor update alone takes 12.1 ms at p95 with no decorations, 12.9 ms with them. Plain p99 is 15.5 ms, decorated 17.5 ms, so some keys pass 16 ms. That is the evidence for the size cutoff question in P0-T9.
- **One attempt failed the repeatability rule.** The first decorated dispatch run (median 5.2 ms, range 4.8 to 6.2) came from a matrix that the system stopped for low memory. The rerun passed (above). I report both because the first one ran under memory pressure, and neither comes near 16 ms.
- **Throwaway code stays for now.** The plan says to throw it away, but the Phase 3 check needs the same scenarios with the real layer, and this file is the hook to swap it into. It lives only under `src/perf` and loads only when `VITE_MDMATE_PERF` is set. A normal `pnpm build` has none of it (searched `dist/` for its class names, the probe and the ready flag). Delete it when the real layer lands.
- **What this does not cover.** Block widgets, which are the likely expensive part. Documents shaped differently from the realistic fixture. GPU time after the main thread. A caret inside a hidden-mark span. Phase 3 measures those against the same scenarios and the same 16 ms.

## P0-T9

Each question below was a `fog:` entry in the ISA. All numbers are Windows 11, Ryzen 7 8840HS, WebView2 156.0.4314.58, release build, medians of 5 runs unless a range is shown.

### Size cutoff: files above 3 MB open as plain source

- **Decision: the cutoff is 3 MB, provisional.** Above it a file opens as plain source: no Markdown parser, no highlighting, no live preview, and a notice. Phase 3 measures the real live-preview layer against the same scenarios and may lower the number.
- **The Markdown parser is the cost, not the decorations.** Typing, with the throwaway decorations on (work per key, ms):

  | Size | p95 | p99 | Slowest key |
  |---|---|---|---|
  | 1 MB | 5.0 | 6.1 | 7.5 |
  | 2 MB | 6.0 | 6.8 | 7.8 |
  | 3 MB | 7.5 | 8.2 | 9.3 |
  | 5 MB | 12.4 and 12.6 | 15.1 and 15.2 | 16.8 and 18.1 |
  | 10 MB | 14.4 | 17.5 | 20.5 |

- **Plain source is cheap at any size measured.** At 10 MB with no parser, typing costs 1.9 ms at p95 (p99 2.1, slowest 2.7), against 13.2 ms with the parser and no decorations. Opening 10 MB without the parser takes 91.3 ms, of which the IPC read is 63.8 ms, so open time starts to break the 100 ms target near 10 MB whatever the mode.
- **Why 3 MB and not 5 MB.** At 3 MB the p99 is 8.2 ms, half the budget, which leaves room for a live-preview layer that does more than the throwaway one. At 5 MB the p99 is already at the budget with nothing left over: plain 5 MB typing is 12.4 ms (12.2 to 13.3, repeatable), and decorated 5 MB failed the repeatability rule twice (12.4 with a range of 12.1 to 13.9, then 12.6 with 12.1 to 16.3). Between 3 and 5 MB the cost rises faster than the size does, which is another reason to stay on the cheap side.
- **`createState` takes `{ parser: false }`** for this mode. The fixture generator now also writes 2, 3 and 5 MB documents, and `pnpm perf typing-3mb` style scenarios exist for 2, 3, 5 and 10 MB. ISC-8 now names the 3 MB cutoff.

### Mixed line endings: normalized text with the endings kept beside it

- **Decision: the text in the editor uses `\n` only, and each line break's original ending (`\r\n`, `\n` or `\r`) lives in a state field that follows every edit.** On save the endings are joined back. Uniform files are the same case with one repeated ending.
- **Rejected: `EditorState.lineSeparator.of("\n")` with the `\r` kept in the text.** It keeps every byte, but the Markdown parser stops seeing tables and hard breaks when a `\r` ends each line, so the document renders wrong. Typing at the end of a CRLF line also lands after the `\r`, which breaks the pair. `tests/editor/lineEndings.test.ts` pins both facts, and the parser one fails on purpose if a parser update ever fixes it.
- **The spike passes 15 tests**: exact bytes back for mixed, all-CRLF, all-LF, old-Mac and empty text; a parser tree for mixed endings equal to the LF tree; the endings above and below an edit unchanged through 500 seeded random edits; and a break made by Enter takes the ending of the line it split. I broke the spike on purpose in a scratch copy and the property test failed, so the test can fail.
- **Known limit for Phase 2:** undoing the deletion of a line break gives the break the neighbour's ending, not its old one. That line was edited, so ISC-3 holds, but a byte-exact undo needs the removed endings stored in the history. ISC-3 stays open until Phase 2 builds the real one; its test row now points at the web test.

### WebView2 cold start: 429 to 475 ms for a bare shell, and ISC-4 is now 1000 ms

- **A bare shell with the editor takes 429 ms to be editable on a warm profile (398 to 439) and 475 ms on the first launch with a fresh profile (458 to 507, five fresh profiles).** One of five first launches passed 500 ms.
- **Most of it is WebView2 starting.** Rust's `main` to page start takes 274 to 339 ms, and the app cannot shorten that. The first launch after install pays the fresh-profile price once.
- **First decision, raised by the owner later the same day (next bullet): ISC-4 keeps 500 ms for now.** The real window adds a sidebar, tabs and settings to this bare shell, so the margin on a first launch was about 25 ms before any of that. A true cold start after a reboot cannot be reproduced on demand, so it is not measured.
- **Revised by the owner: ISC-4 is now 1000 ms.** It is the time from launching the app to a window you can type in, which is what `pnpm perf startup` measures as launch to editable. A bare shell takes 429 to 475 ms and most of that is WebView2 starting, so 1000 ms leaves room for the sidebar, tabs and settings. Phase 3 measures the real UI on a fresh profile; if it does not fit, 1500 ms is the fallback, and I would stop there, because past 1500 ms the number stops catching regressions.

### Asset protocol: the scope grows at runtime, no custom protocol needed

- **Decision: images load through the asset protocol, and opening a workspace calls `app.asset_protocol_scope().allow_directory(folder, true)`.**
- **Tested in the real WebView2** (`pnpm perf asset-scope`): a PNG is blocked before its folder is allowed and loads after, with the same URL. Files with a space and an accent in the name load, so does a nested folder, and a second folder stays blocked until its own call. Calling it twice, for two folders, works.
- **What it needs:** the Cargo feature `protocol-asset` on `tauri` and `assetProtocol` enabled in `tauri.conf.json` with an empty scope. The CSP already allows `asset:` and `http://asset.localhost` for images. The lab used a config override and a perf-only feature so the shipped config did not change.
- **Not tested:** removing a folder from the scope when a workspace closes, and `asset:` for media other than images.

### Generated shadcn-vue components: they fail `exactOptionalPropertyTypes`, so mark them

- **A Sonnet subagent checked in a scratch copy** (shadcn-vue 2.9.0, reka-ui 2.11.0, vue 3.5.45, typescript 6.0.3, vue-tsc 3.3.14). It added button, dialog, dropdown-menu, context-menu, tabs, input, select, switch, tooltip, popover, scroll-area, separator, command and resizable, which came to 106 files. I checked the error counts against its log.
- **`vue-tsc` fails with 69 errors in 69 files, all from `exactOptionalPropertyTypes`** (67 of TS2379, 2 of TS2769). Vue's `defineProps<T>()` turns an optional prop into `x: X | undefined`, and Reka UI's own props are `x?: X`, so passing one to the other is rejected. With only that flag off, `vue-tsc` passes, so `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `erasableSyntaxOnly` are fine.
- **Decision: keep every flag on and mark each generated file with `// @ts-nocheck -- generated by shadcn-vue, fails exactOptionalPropertyTypes`** as the first line of its script block. Turning the flag off project-wide would loosen our own code to suit generated code. Excluding the folder does not work, because a file that is imported is checked anyway (7 errors came back once the app imported a dialog). A line at the top is verified to clear the errors and to satisfy the suppressions-need-reasons rule. It is lost when a component is re-added, so Phase 1 adds a small script that runs `shadcn-vue add` and then restores the line; `pnpm check` fails on a file without it, so a forgotten step shows up.
- **ESLint and Prettier also flag generated files.** 25 ESLint errors in 5 rules (`vue/require-default-prop`, `prefer-optional-chain`, `prefer-function-type`, `no-unnecessary-type-assertion`, `no-base-to-string`) go away by turning those rules off for `src/components/ui/**/*.vue`, and 102 files fail Prettier until `src/components/ui/` is in `.prettierignore`. Both fixes were verified in the scratch copy and survive regeneration. The components alone cause no `check-arch` violation.
- **Never run `shadcn-vue init` in this repo.** It rewrote `tokens.css` with a remote Google Fonts import (which `no-network` rejects), swapped Inter for Geist and turned the dark background into a different color. `add` alone left those files alone. Not verified: whether `add` installs `reka-ui` on its own.

### Text drag in the editor: it does not work while native file drops are on

- **Result (by hand, `pnpm perf lab`, real WebView2 with `dragDropEnabled` left at its default `true`):** pressing on selected text and dragging it fired `dragstart` three times, but `dragenter`, `dragover` and `drop` never reached the page, and the text did not move. The window accepts native file drops, and on Windows that setting swallows the browser's own drag events.
- **First decision, reversed by the owner later the same day (next bullet): v1 has no drag-to-move for selected text.** Cut and paste do the job. If it is wanted later, it gets built on pointer events, the same way tab and tree dragging are. `dragDropEnabled` stays `true`, because native drops carry the real file paths. Dropping files from Explorer is unaffected: it works through Tauri's drop events, tested below.
- **Revised by the owner: drag-to-move for selected text is in v1.** It is built on pointer events, since the browser's own drag cannot work with native drops on. Pressing on a non-empty selection starts it, a drop caret follows the pointer, and releasing moves the text in one undo step. It is planned as P5-T7 and closes ISC-177 to ISC-179. Nothing is built yet; a lab spike can come sooner if wanted.

### Drop positions are physical pixels

- **Result (display at 125%, `devicePixelRatio` 1.25):** a file dropped on box A was reported at (191, 335), and dividing by the pixel ratio hit box A while using the numbers as they came hit another element. A file dropped on box B was reported at (1183, 839), which is outside the 767 px wide page, and dividing hit box B. So the positions are physical pixels.
- **Decision: the platform layer divides drop positions by `devicePixelRatio` before anything hit-tests, so the rest of the app only sees CSS pixels.** Tested at 125% only. Other scales, and a second monitor with a different scale, are not tested.

### Snap layouts: Win+Z and edge snapping work, the hover flyout does not

- **Result (by hand, undecorated window with a custom maximize button):** hovering the button for 2 seconds showed no snap layout flyout. Win+Z showed the snap layouts. Dragging our own title bar (started with `start_dragging`) to the top edge previewed a maximize, and to the left edge previewed a half-screen snap.
- **Decision: ship custom caption buttons without the hover flyout.** Windows only shows it for a button it recognizes as a caption button, which an HTML button inside WebView2 is not. ISC-26 stands (minimize, maximize and close work). Getting the flyout means answering `WM_NCHITTEST` from Rust, which a later phase can take on if the owner wants it.
- **Not verified:** whether `data-tauri-drag-region` behaves like `start_dragging`, and what permission the real title bar needs (the lab used its own Rust command, so it did not touch capabilities).

### What else this task added

- **Lab code, all behind the `perf` feature and `VITE_MDMATE_PERF`:** `pnpm perf asset-scope` (automatic) and `pnpm perf lab` (by hand). A normal build has none of it.
- **The perf runner builds with a config override** (`perf-results/tauri.perf.conf.json`) that turns the asset protocol on for the lab build only. The shipped config is unchanged, and `perf = ["tauri/protocol-asset"]` in `Cargo.toml` is the only feature change.

### Drag-to-move spike (after T9, for P5-T7): it works, and the browser's own drag never starts

The owner put drag-to-move back in v1, so a spike ran in the lab before Phase 5. The extension is `src/editor/textDrag.ts`. Nothing in the app imports it yet, so a normal build contains none of it.

- **How it works.** A `mousedown` handler runs before CodeMirror's and takes the press when it lands on a non-empty single selection (the hit test uses `posAndSideAtCoords`, so the left or right half of an edge character counts correctly). It calls `preventDefault` and `view.focus()`. After 4 px of travel a drag starts and window-level pointer listeners follow it. A caret drawn in a CodeMirror `layer` shows the drop point, so the text DOM is never touched during a drag. Release dispatches one transaction (delete plus insert, `userEvent: "move.drop"`) that selects the moved text.
- **Cancels.** Esc, `pointercancel`, window blur, a move that arrives with no button held (a lost mouse-up), a release outside the editor box, and a drop inside or on the edge of the selection. A press that never moves collapses the selection like a normal click.
- **Unit tests (15, `tests/editor/textDrag.test.ts`).** Hit test halves, forward and backward moves, spans with line breaks, read-only, several ranges, one undo step with an earlier edit left in place, and 400 seeded random moves against plain string arithmetic.
- **Trusted input, in the real WebView2 (`pnpm perf drag-auto`).** The runner sends real mouse and key events through the DevTools port, so no real cursor moves. 11 of 11 cases pass: forward, backward across lines, a span with line breaks, drop inside the selection, click, Esc, release outside the box, lost mouse-up, autoscroll to the bottom edge (scrollTop 896, landed on line 58, exactly where the caret was), and one-step undo. Each move case also checks that the caret showed the place the text landed. The three cancel cases check that a drag really started before it was cancelled.
- **The control shows the limit of that input.** With the extension off, the same input made CodeMirror's native drag work (`dragstart` 1, `dragenter` 1, `dragover` 8, `drop` 1). The owner's real mouse failed that way in P0-T9, so injected input does not reproduce the Windows drop-target problem. The automatic run proves the logic and the geometry. It does not prove ISC-179.
- **By hand (`pnpm perf lab-drag`), 12 steps, all yes.** Same-line move, the drop caret, a move to another line, one Ctrl+Z undoing the whole move, a span across lines, autoscroll at the bottom edge landing where the caret was, Esc, release over the area outside the box, release outside the whole window (the drag is gone when the mouse comes back), click collapsing the selection, and a real file from Explorer dropped on a zone while the extension was active (3 enter and drop pairs, each with one path). It felt smooth, and the owner's note was "everything just worked". The page counted 10 moves and **0** browser drag events.
- **Decision: the approach is confirmed.** ISC-177 to ISC-179 stay open, since the claims close in P5-T7 against the real app. P5-T7 starts from this file.
- **Not covered, and P5-T7 has to handle or decide:**
  - Display scale. The by-hand session ran on the external monitor at scale 1 (`devicePixelRatio` 1), while the T9 lab ran on the laptop screen at 1.25. So fractional scrolling and coordinates at 125% are untested for this extension.
  - Line endings. A move is a deletion plus an insertion, so a moved block of CRLF lines would take its new neighbours' endings in a mixed file. Phase 2's real field has to carry endings with moved text (a unit test pins the shape of the change).
  - Live preview. Dropping into or out of hidden syntax, tables, images and other block widgets is unchecked; it waits on Phases 3 and 4.
  - Large files. Drag cost on a 3 MB document is unmeasured.
  - Not built: Ctrl-drag to copy, dragging between panes or from one window to another, touch and pen, scrolling when the pointer is outside the box, and any screen-reader behavior.
