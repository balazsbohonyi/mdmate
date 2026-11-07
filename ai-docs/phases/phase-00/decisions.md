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
