# Phase 0: Spike and scaffold

**Goal:** prove the stack can hit the speed targets on real files, and have every gate running before feature work starts.

**Kill rule:** if live decorations cannot hold 16 ms per key on the 1 MB fixture after profiling, stop and bring the numbers to the owner before Phase 3.

## P0-T1: Scaffold

Create the Tauri 2 app with Vue 3, TypeScript, Tailwind 4 and shadcn-vue, using pnpm. Set `packageManager` in `package.json`. Set `tailwind.cssVariables: true` at shadcn-vue init. Add the MIT `LICENSE`.

- Rust layout follows `ai-docs/architecture/architecture.md`, with `platform/` traits and macOS and Linux stubs from the start.
- `src/platform/` has a `Host` interface, a Tauri implementation and a browser mock.
- Tauri deps are pinned to major 2. Window config starts `visible: false`, `decorations: false`.

**Done when:** `pnpm tauri dev` shows an empty themed window, and `pnpm dev` shows the same UI in a browser.

## P0-T2: Gates

Apply the configs in `ai-docs/standards/`. Add `pnpm check`, `pnpm check:rust`, `pnpm test:web` and `pnpm test:rust`.

**Done when:** both gates exit 0 on the scaffold.

## P0-T3: Architecture checks

Build `scripts/check-arch.mjs`, with one named rule per structural claim, and run all rules in `pnpm check`:

`no-os-cfg-outside-platform`, `tauri-only-in-platform`, `no-vue-in-editor`, `no-hard-coded-colors`, `no-unsafe-html`, `no-network`, `no-plugin-fs`, `suppressions-have-reasons`, `languages-lazy`, `no-math-mermaid`, `license-mit`.

**Done when:** each rule passes on the scaffold and fails on a planted violation.

## P0-T4: ISA check

Build `scripts/check-isa.mjs` per `ai-docs/standards/isa.md`.

**Done when:** it passes on `ISA.md` and fails on a planted wrong count, duplicate ID, and orphan claim or row.

## P0-T5: CI

Run both gates on Windows, and `cargo check` on macOS and Linux, on every push. The Linux job installs Tauri's system packages first, including webkit2gtk.

**Done when:** all jobs are green on a pushed branch. Pushing needs the owner's go-ahead.

## P0-T6: Fixtures

A script generates `tests/fixtures/`: 1 MB and 10 MB Markdown with realistic structure, heavy tables, a large code document, LF, CRLF, mixed EOL, UTF-8 BOM, UTF-16 LE and BE, Latin-1, and `hostile.md`.

The hostile fixture holds `<script>`, event attributes, `ms-msdt:` and `search-ms:` links, `.lnk` and `.hta` targets, and UNC image paths.

Large generated files go in `tests/fixtures/generated/`, which git ignores. `.gitattributes` marks `tests/fixtures/**` as `-text`, so git never rewrites their line endings.

**Done when:** the script produces every fixture from a clean checkout.

## P0-T7: Perf harness

`pnpm perf <scenario>` runs a release build, drives the scenario and writes JSON to `perf-results/`. Scenarios start with `startup`, `open-1mb`, `tab-switch` and `typing-1mb`; later phases add theirs. Files arrive through `tauri::ipc::Response`.

**Done when:** each scenario prints a repeatable number across five runs, labeled Windows.

## P0-T8: Baseline

Add throwaway inline decorations for headings and emphasis, scoped to `visibleRanges`, and measure all scenarios. This code gets thrown away.

**Done when:** numbers and the kill-rule verdict are recorded in `decisions.md`.

## P0-T9: Fog

Answer every entry in the ISA's `## Not yet specified` that P0 owns: size cutoff, mixed EOL mechanism, WebView2 cold start, asset protocol scope, CM6 text drag, drop position units, snap layouts, strict flags. Each becomes a claim or a Decisions row.

**Done when:** only the journal interval fog remains.
