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
