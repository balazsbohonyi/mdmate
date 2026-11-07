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
