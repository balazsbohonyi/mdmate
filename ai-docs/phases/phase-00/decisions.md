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
