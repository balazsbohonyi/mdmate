# Phase 2: Documents

**Goal:** no action can lose or alter text. Files open, edit, sync, save and survive a crash, in a plain CM6 view with no preview.

## P2-T1: File layer

In `src-tauri/src/fs/`: read raw bytes, detect BOM, UTF-8 validity and dominant EOL. Save writes a temp file in the same folder, then renames. Writes keep the original BOM and encoding.

**Done when:** round-trip tests pass on every fixture, and an injected failure leaves the original intact.

## P2-T2: Open flow

Extend `Host` with file commands, and build the document store in `src/documents/`. Tabs are a `kind` union. Opening a file that is already open focuses its tab.

**Done when:** files open in tabs with or without a root folder.

## P2-T3: Master and followers

One headless master `EditorState` per file owns text and history. Each pane has one `EditorView`, and tab switches use `view.setState`. Followers forward changes with a sync annotation, and undo runs against the master.

**Done when:** sync and undo tests pass with headless states, and tab switching meets its target.

## P2-T4: Edit isolation

Set `EditorState.lineSeparator` from the file, and apply the mixed EOL mechanism chosen in P0.

**Done when:** property tests show edits change only their range.

## P2-T5: Watcher

In `src-tauri/src/workspace/`, run `notify` on a dedicated thread and stream events over `Channel`. Record the hash of each save and ignore that event. A clean tab reloads. An edited tab shows a choice: keep mine or load theirs.

**Done when:** external edits behave as claimed, and Ctrl+S causes no reload.

## P2-T6: Hot exit

Journal dirty buffers to the data folder on a measured interval, using atomic writes. Persist tabs, layout and carets. Restore all of it on launch, and close without prompts.

**Done when:** `pnpm perf crash-restore` shows a force-kill restores everything up to the last journal write, and the interval is recorded in Decisions.

## P2-T7: Large files and open speed

Apply the P0 size cutoff: above it, open plain source with a notice.

**Done when:** `pnpm perf open-1mb` meets its target.
