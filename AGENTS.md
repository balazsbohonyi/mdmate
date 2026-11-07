This file provides guidance to AI coding agents working in this repository.

## Project

**Status: Phase 0, spike and scaffold. See `ai-docs/tasks.md` for what is done.**

mdmate is a fast desktop Markdown editor with Obsidian-style inline editing and a SublimeText look and feel. It ships for Windows first, and is built so macOS and Linux need only new platform implementations.

- What must be true: `ISA.md`
- Why and who for: `ai-docs/project.md`
- Work order: `ai-docs/tasks.md`, `ai-docs/phases/phase-NN/plan.md`
- How it fits together: `ai-docs/architecture/architecture.md`

## Plan Mode

- Make plans extremely concise. Sacrifice grammar for concision.
- End each plan with any unresolved questions.

## Engineering standards

Read the matching standard before writing or reviewing code:

- Rust, Cargo.toml, Tauri commands → `ai-docs/standards/rust.md`
- .vue files, composables, reactive state → `ai-docs/standards/vue.md`
- .ts files, IPC types, tsconfig, ESLint → `ai-docs/standards/typescript.md`
- A new feature, bug, changed requirement or closed claim → `ai-docs/standards/isa.md`

A task is complete when `pnpm check` and `pnpm check:rust` exit 0.

## Working on a task

Tasks use `P{phase}-T{task}` IDs. Phases run in order.

- "Work on P0-T3" means that task.
- "Work on Phase 0" means every open task in that phase, in order.
- "Work on the next task" means the first `[ ]` in `ai-docs/tasks.md`.
- "Where are we?" means report done and open tasks, `progress` and open fog from `ISA.md`, the latest `decisions.md`, and anything blocked.

For each task:

1. Read the task in `ai-docs/tasks.md`, its details in `ai-docs/phases/phase-NN/plan.md`, and any earlier `decisions.md`.
2. Read the claims it closes in `ISA.md`, and run their probes first.
3. Implement, then follow the "Claim closes" and "Task end" rules in `ai-docs/standards/isa.md`.
4. Mark the task `[x]` in `ai-docs/tasks.md` when its "Done when" holds.
5. Record any deviation from the plan in `ai-docs/phases/phase-NN/decisions.md`.
6. When architecture changes, update `ai-docs/architecture/architecture.md` in the same change.

## Architecture rules

- **Vue owns the chrome, CodeMirror owns the text.** `src/editor/` imports no Vue, and editor objects never enter Vue reactivity.
- **The Markdown text is the document.** Display through decorations only, and write only the bytes an edit changes.
- **Rust does the OS work.** All file access goes through our own commands in `src-tauri/src/`. `tauri-plugin-fs` stays out.
- **`@tauri-apps` imports stay inside `src/platform/`.** Its browser mock keeps UI work runnable under `pnpm dev`.
- **OS-specific code lives behind traits in `src-tauri/src/platform/`.**
- **All colors, fonts and spacing come from tokens.**
- **Markdown content is untrusted.** Follow the Security section of the architecture doc.

## Gotchas

- Use padding on `.cm-line` and block widgets. CM6 cannot measure vertical margins, and arrow keys then skip lines.
- Give widgets `eq()` and `estimatedHeight`, and call `requestMeasure()` after async resize. Cache image sizes to avoid scroll jumps.
- Block widgets and decorations that hide line breaks must come from a `StateField`. A `ViewPlugin` can read the viewport, but only for inline decorations.
- `atomicRanges` does not stop programmatic selection from landing inside hidden syntax, so caret reveal needs its own handling.
- CM6 parsing is budgeted and can stop on huge files. Features that need the whole document, such as outline and link scans, run in Rust.
- CM6 normalizes line endings to a newline. Keep each line break's original ending in a state field beside the text and join them back on save. Do not keep the carriage return in the text with a newline `lineSeparator`: it keeps the bytes, but the Markdown parser then misses tables and hard breaks (P0-T9).
- mdmate's own saves fire the file watcher. Record the hash of what we wrote and ignore that event.
- A second launch's `mdmate file.md` resolves against that launch's working directory.
- Tauri drop positions are physical pixels: divide by `devicePixelRatio` before hit-testing. CM6 text drag does not work while native drops are on (P0-T9).
- Keep `dragDropEnabled` at `true`, because native drops carry real file paths. Build tab, tree and split dragging on pointer events, since HTML5 drag needs that setting off on Windows.
- Use `pnpm tauri`; `cargo tauri` is not installed.
- Pin Tauri plugins to major 2 and `notify` to a stable release. crates.io defaults currently resolve to prereleases.
- `tailwind.cssVariables` in `components.json` is set at shadcn-vue init. Changing it later means reinstalling components.
- shadcn-vue: run `add`, never `init`, because `init` rewrites `tokens.css`. Generated files fail `exactOptionalPropertyTypes`, so each carries a `ts-nocheck` line with a reason (P0-T9 decisions).
- Release builds keep `panic = "unwind"`, so a crashed background thread can't lose unsaved typing.

## Verification

- UI work: drive `pnpm dev` with a real browser through the mock host, and check the result on screen.
- Anything touching Rust or WebView2: run `pnpm tauri dev` and take a screenshot.
- Speed: measure release builds with `pnpm perf`, and label numbers with the OS they came from.

## Commits

Commit only when asked. Use one logical change per commit.

```
[P{N}-T{M}] Short imperative description
```

Keep the subject under 72 characters. Use `[P{N}-T{M}..P{N}-T{K}]` with a bullet body for ranges. Non-task commits use a plain subject. Messages carry no attribution lines.
