# Phase 9.1: Polish

**Goal:** the small faults and rough edges the owner finds in daily use are fixed before the release work in Phase 10.

**Why now:** Phases 8 and 9 are done and merged, and Phase 10 ships. Anything that looks wrong in the app today would ship with it. The owner decided on 2026-11-17 to collect these fixes in a decimal phase, as Phase 7.1 did, instead of folding them into Phase 10.

## How the phase runs

- **One fix, one task.** Tasks are `P9.1-T1`, `P9.1-T2` and so on, one commit each, with the subject `[P9.1-Tn] Short imperative description`.
- **Plan first, then add to this file.** The owner writes a small plan for each fix. Its task gets a section below and a line in `ai-docs/tasks.md` before the code changes.
- **Every fix has a claim.** A bug reopens the claim that should have caught it, or adds a new one (`ai-docs/standards/isa.md`). The probe fails on the old code first.
- **Scope stays small.** A fix that grows into a feature moves to Phase 10 or a phase of its own.
- **Branch:** `feat/phase-09.1-polish`.

## P9.1-T1: Empty table cells keep their column

**The bug:** a table cell with no text is not drawn in place. The cells after it shift left, so the row comes up short and its text sits under the wrong header.

**Cause:** the Markdown parser emits no `TableCell` node for an empty cell, only the pipes around it. `cellsOf` in `src/editor/livePreview/blocks/scan.ts` walked the `TableCell` nodes and nothing else.

**Fix:** `cellsOf` also reads the pipes. A pipe that closes a slot no cell filled stands for an empty cell. A pipe before any cell is the row's leading pipe and stands for nothing. The empty cell's offset is where its slot starts.

**Tests:** two in `tests/editor/table.test.ts`.

- **Positions:** an empty cell first, in the middle, last, and written as `||`, in body rows.
- **Shapes:** an empty cell in a header row, and in rows with no outer pipes.

**Done when:** the two tests fail on the old `cellsOf` and pass on the new one, the rest of the table tests still pass, and `pnpm check` and `pnpm test:web` are green. Closes ISC-554.
