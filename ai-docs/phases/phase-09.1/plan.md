# Phase 9.1: Polish

**Goal:** the small faults and rough edges the owner finds in daily use are fixed before the release work in Phase 10.

**Why now:** Phases 8 and 9 are done and merged, and Phase 10 ships. Anything that looks wrong in the app today would ship with it. The owner decided on 2026-11-17 to collect these fixes in a decimal phase, as Phase 7.1 did, instead of folding them into Phase 10.

## How the phase runs

- **One fix, one task.** Tasks are `P9.1-T1`, `P9.1-T2` and so on, one commit each, with the subject `[P9.1-Tn] Short imperative description`.
- **Plan first, then add to this file.** The owner writes a small plan for each fix. Its task gets a section below and a line in `ai-docs/tasks.md` before the code changes.
- **Every fix has a claim.** A bug reopens the claim that should have caught it, or adds a new one (`ai-docs/standards/isa.md`). The probe fails on the old code first.
- **Scope stays small.** A fix that grows into a feature moves to Phase 10 or a phase of its own.
- **Order:** T2 to T10 run in order. T10 starts with a spike and may move to Phase 10 (recorded in `ISA.md` Decisions). T11 was added later and touches nothing the others do, so it can run before T9. T12 to T19 were added on 2026-11-21 (owner review) and run in order; each is independent of the others, except that T17 and T18 both add fields to the session snapshot (`src/documents/session.ts`), so they run one after the other. T20 to T28 were added on 2026-11-21 (owner review) and run in order: T20, T25 and T26 all add Settings rows, T27 follows T26 (it reads what the tree lists), and T28 follows T27 and T21 (it adds theme tokens the way T21 does). T29 and T30 were added on 2026-11-22 (owner review) and run in order; both touch the live-preview themes. T32 to T35 were added on 2026-11-23 (owner review) and run in order, except that T34 and T35 touch nothing the others do and can go first. T32 and T33 both touch the code box (`box.ts`), so T33 follows T32. The same review gave eight follow-ups to done tasks (below), which are not tasks: each reopens the claim it makes false and is committed under the tag of the task it amends.
- **Claims:** a task's claims are written open in `ISA.md` when the task is planned (as for T12 to T28), and the task's own commit sets them to `[x]`. P9.1-T1 to T11 added theirs in the task's commit; `ai-docs/standards/isa.md` says before code.
- **Branch:** `feat/phase-09.1-polish`.

## P9.1-T1: Empty table cells keep their column

**The bug:** a table cell with no text is not drawn in place. The cells after it shift left, so the row comes up short and its text sits under the wrong header.

**Cause:** the Markdown parser emits no `TableCell` node for an empty cell, only the pipes around it. `cellsOf` in `src/editor/livePreview/blocks/scan.ts` walked the `TableCell` nodes and nothing else.

**Fix:** `cellsOf` also reads the pipes. A pipe that closes a slot no cell filled stands for an empty cell. A pipe before any cell is the row's leading pipe and stands for nothing. The empty cell's offset is where its slot starts.

**Tests:** two in `tests/editor/table.test.ts`.

- **Positions:** an empty cell first, in the middle, last, and written as `||`, in body rows.
- **Shapes:** an empty cell in a header row, and in rows with no outer pipes.

**Done when:** the two tests fail on the old `cellsOf` and pass on the new one, the rest of the table tests still pass, and `pnpm check` and `pnpm test:web` are green. Closes ISC-554.

## P9.1-T2: No browser shortcuts

**The problem:** Ctrl+R reloads the whole app, as in a browser. Other WebView2 defaults (F5, Ctrl+Shift+R, Ctrl+U, F7, zoom with Ctrl+plus, Ctrl+minus, Ctrl+0 and Ctrl+wheel) are also live. Today only keys bound to a command are stopped (`takeShortcut` in `src/workbench/keyboard.ts`), so unbinding a command in `keybindings.json` also brings its browser default back.

**Fix:** turn off WebView2's browser accelerator keys for the window (Rust, behind `src-tauri/src/platform/`, with the unsafe code opted in locally). The app's own shortcuts are handled in the page, so they keep working. F12 keeps working through the `devtools` setting and `devtools_open`, which calls `open_devtools()` and does not need the accelerator.

**Spike first (small):** confirm in `pnpm tauri dev` that (a) Ctrl+R, F5 and zoom do nothing (the app's own zoom is P9.1-T3), (b) `Mod+F`, `Mod+P`, copy/paste and F12 (setting on) still work. If WebView2 cannot do (a) from Rust, fall back to a capture-phase key guard in `src/workbench/keyboard.ts` with a list of blocked chords, and say so in `decisions.md`.

**Tests:** a Vitest probe for the guard if it is needed; a Rust unit test for the setting if it can be read back. The real-window check goes in ISA Verification.

**Done when:** Ctrl+R, F5, Ctrl+Shift+R, Ctrl+U, F7 and the zoom keys do nothing in a `pnpm tauri dev` window; F12 still opens devtools when the setting is on; `pnpm check`, `pnpm check:rust` and `pnpm test:web` are green. New claims in F0 or F9.

## P9.1-T3: Zoom the whole window

**The change:** Ctrl+plus, Ctrl+minus and Ctrl+0 zoom in, zoom out and reset, as in VS Code, and Ctrl+wheel zooms too. They do nothing today (the owner checked), and P9.1-T2 turns the browser's own zoom keys off for good, so the app needs its own. The zoom scales the whole window (editor, sidebar, tabs, title bar). The editor font settings are not touched.

**How:** the page owns the keys and the level; the webview does the scaling.

- Three commands in `src/workbench/defaultCommands.ts`: `view.zoomIn` (`Mod+=`, with `Mod+Plus` and the numpad plus as extra chords), `view.zoomOut` (`Mod+-`, numpad minus) and `view.zoomReset` (`Mod+0`). They are rebindable in the keybindings screen and appear in the palette and the View menu.
- Ctrl+wheel in the page steps the level the same way. The tab strip's wheel handler (`TabStrip.vue:90`) ignores Ctrl+wheel already, so it does not scroll the strip.
- The level is a setting, `view.zoom` (percent, 50 to 300, steps of 10, default 100). It is validated in `src/lib/settings.ts` and `settingsFile.ts`, has a row in `src/features/settings/rows.ts`, and is applied at start and live.
- A pure helper steps and clamps the level (`src/lib/zoom.ts`). A `src/platform/` host method calls the Tauri webview zoom, with a no-op in the browser mock.
- A short toast or status-bar note shows the percentage after a change.

**Why the native webview zoom and not CSS `zoom`:** CodeMirror measures text and the tab drag reads DOM geometry, and both stay right when the webview scales the page. The native-drop code already divides by `devicePixelRatio` (`toCssPosition`), so drop positions should stay right when zoomed. **Spike first:** at 150% check CodeMirror caret and selection placement, tab dragging, tree dragging and a file drop. If native zoom breaks one, record it in `decisions.md` and choose again.

**Tests:** the stepping and clamping helper (including off-grid saved values), command registration and default bindings, settings validation and the settings row, and the wheel handler (Ctrl+wheel steps, a plain wheel does not).

**Done when:** the tests pass, zoom in, out, reset and Ctrl+wheel work in a `pnpm tauri dev` window, the level survives a restart, and the checks are green. New claims in F9.

## P9.1-T4: Sidebar toggle in the title bar

**The change:** a button next to the hamburger in `src/shell/TitleBar.vue` that runs `view.toggleSidebar` (`COMMAND_IDS.toggleSidebar`, `Mod+Shift+B`). Build it like the Settings gear: `runCommand`, `shortcutLabel` for the hint, and the shadcn tooltip (no native `title`). The icon comes from `@lucide/vue` (`PanelLeft`) and shows whether the sidebar is open (`sidebarVisible` in `src/workbench/sidebar.ts`).

**Tests:** extend `tests/shell/titleBar.test.ts`: the button exists, a click toggles `sidebarVisible`, and the tooltip carries the current shortcut.

**Done when:** the tests pass, the button works in `pnpm dev` in Dark and Light, and the checks are green. One new claim in F1.

## P9.1-T5: Inline code uses the content size

**The change:** inline code keeps the code font family (`--doc-font-code`) but takes the content font size. `fonts.codeSize` then sizes fenced and multi-line code blocks only.

**Today:** `.cm-md-code` in `src/editor/livePreview/theme.ts:43-49` uses `calc(var(--doc-code-ratio) * 1em)`. The same rule is in `src/editor/livePreview/blocks/theme.ts:99-105` (`.cm-md-table code`). `.cm-md-box-code` in `src/editor/livePreview/box.ts:135-138` styles code blocks and keeps the ratio.

**Fix:** inline code, and inline code in tables, uses `font-size: 1em` so it follows its surroundings, headings included. Code blocks keep the ratio. Reword the `fonts.codeSize` row description in `src/features/settings/rows.ts:90-94` to say "blocks".

**Claims:** this reverses ISC-363 ("`fonts.codeSize` sets the size of code blocks and inline code"). Reopen ISC-363 and give it a `refined:` Decisions row (the owner changed the requirement; the claim is not softened to pass), plus a new inline-code claim. Update `tests/editor/documentFonts.test.ts`: the source regex at line 156 and the ratio tests now cover the block rule only, and a new test shows inline code at `codeSize` 18 stays at the content size.

**Done when:** the new tests fail on the old CSS and pass on the new; inline code is 15 px beside a 15 px body at `codeSize` 18, and a code block is 18 px; the checks are green.

## P9.1-T6: Tab strip look

**The change** (`src/workbench/TabStrip.vue`, `TabStripItem.vue`):

- Remove the 2 px coloured top edge (`border-t-2` and the `border-primary` states).
- Tabs get rounded top corners (top left and top right).
- The strip gets about 8 px of padding above the tabs, so the active tab's shape reads.
- The strip background is a lighter version of the content background (today it is darker). The active tab keeps the content background. Inactive tabs get their own background, different from both.
- A subtle vertical separator sits between two inactive tabs (none next to the active tab).
- Hovering an inactive tab hides the separators on its left and right, and keeps the hover background.

**Tokens:** `color-mix` is banned in `tokens.css` and in user theme files (`tests/styles/themes.test.ts:94`, `src/lib/themeFile.ts:35`), so the shades are picked by hand per theme. Change `--tabstrip` in `dark.css`, `light.css` and `sepia.css`, and add `--tab-inactive` and `--tab-separator`. These change together: the three theme files, the `@theme inline` block in `tokens.css`, `NAMES` in `src/lib/themeTokens.ts`, the sentence in `src/lib/themeTokenUsage.ts`, and `CONTRAST_PAIRS` if text on the new background needs it. `tests/styles/themes.test.ts` and `tests/lib/themeTokenUsage.test.ts` catch a miss.

**Separators:** a pseudo-element on each tab, hidden next to the active tab and on hover through `:hover` and `:has(+ :hover)`, so no script is involved.

**Check:** `--spacing-tabstrip` (2.125rem) and any layout that depends on it grow by the padding. Pointer tab dragging reads its geometry from the DOM (`tabDrag.ts` `readGeometry`), so check that the drop bar still lines up.

**Tests:** `tests/workbench/tabStripItem.test.ts` (no top-border class, rounded classes, separator classes) and the theme tests above. The look itself is a `manual` claim, with screenshots in Dark, Light and Sepia.

**Done when:** the tests pass, the owner reviews the strip in all three themes, and the checks are green.

## P9.1-T7: Pin and unpin tabs

**Behaviour:**

- The tab context menu gets **Pin Tab** and **Unpin Tab** (`src/workbench/tabMenu.ts`, `TabStrip.vue`).
- Pinned tabs are always the first tabs of their pane, in the order they were pinned. Unpinning puts the tab first among the unpinned ones. In the model this is a prefix rule on `pane.tabs`, kept in `src/workbench/splitTree.ts` and `store.ts`.
- **Icon:** a pin icon sits in the 20 px slot where the close X and the dirty dot are today. A dirty pinned tab shows the pin with a smaller dirty dot overlapping its bottom-right corner. Clicking the pin icon unpins the tab, also when it is dirty. Hovering the pin hides the dot, to show that a click unpins. A pinned tab has no X.
- **Close Others, Close to the Right and Close All skip pinned tabs.** Close on a pinned tab closes it (menu item, Ctrl+W, middle-click). Closing the last unpinned tab leaves the pinned ones.
- **Dragging:** a pinned tab stays inside the pinned group of its strip (the drop index clamps), and an unpinned tab cannot land among pinned ones. A drag to another pane keeps the pin.
- **Session:** an optional `pinned` flag on `SnapshotTab` in `src/documents/session.ts`. The session version stays 1, since old files simply lack the flag.

**Tests:** `tests/workbench/tabMenu.test.ts` and `store.test.ts` (the order rule, the three Close actions, Close on a pinned tab), `tabStripItem.test.ts` (icon, dot, hover, click), the `tabDrop*` tests (clamp), and a session round-trip test.

**Done when:** every test fails on the old code and passes on the new, the owner confirms the icon behaviour on screen, and the checks are green. New claims in F1 and F12.

## P9.1-T8: File-type icons in the sidebar

**The change:** file rows in `src/features/tree/FileTree.vue` (`:535-543`) get an icon by file type, as in VS Code. The icon set is **Material Icon Theme** (MIT). Bundle a curated subset (about 60 types: Markdown, text, JSON, YAML and TOML, JS and TS, Vue, HTML and CSS, Rust, Python, shell, images, PDF, archives, lock files, config dotfiles, and a default) as local SVGs, with an extension and filename map in a pure module (`src/features/tree/fileIcons.ts`). Folder rows keep their Lucide icons.

**Constraints:** the CSP allows only local files, so no remote icons. The licence notice ships the way the Inter font's does (the Remaining Work item for the installer and README). The icons are coloured SVGs, so the colour-pair scan (`tests/styles/colorPairs.test.ts`) must pass, and they must read on Dark, Light and Sepia.

**Tests:** a map test (extension to icon, case-insensitive, double extensions like `.d.ts`, filename matches like `package.json`, a default for unknown) and a tree render test that a row carries its icon. A subset script, if there is one, lives in `scripts/`.

**Done when:** the tests pass, the owner reviews the tree in three themes, the bundle growth is noted in the task commit, and the checks are green. New claim in F7 next to ISC-105.

## P9.1-T9: Select several files; delete or move them together

**Selection** (`src/features/tree/store.ts`, `FileTree.vue`, `model.ts`): today there is one `selectedPath`. Add a selection set with an anchor. Ctrl+click toggles, Shift+click selects the range of visible rows, Shift+Up and Shift+Down extend, and a plain click or Escape goes back to one row. A selected folder swallows selected rows inside it. The single `selectedPath` stays as the lead row, so the keyboard code keeps working.

**Batch delete:** the Delete key and the context-menu Delete act on the whole selection. `DeleteDialog.vue` shows one confirmation with the count, the open tabs and the unsaved tabs across all items. Items go to the Recycle Bin one by one through the existing `delete_entry`.

**Batch move:** the pointer drag in `FileTree.vue` (`:307-392`) carries the whole selection when the pressed row is in it, and otherwise selects that row first. `moveProblem` runs per item, and an invalid item is skipped with one summary toast. Moving uses the existing `moveWithLinks` per item and respects `links.onRename`: `never` moves plainly, `update` rewrites links, and `ask` asks once for the whole batch, with its answer used for every item.

**Context menu on several rows:** Delete only. Rename, New File and New Folder need one row.

**Tests:** `tests/features/` for the selection model (pure, in `model.ts`), the delete dialog counts, a move of a selection with one invalid item, and the ask-once rule.

**Done when:** the tests fail on the old code and pass on the new; in `pnpm tauri dev` the owner selects three files, deletes them with one confirmation, and drags them into another folder; the checks are green. New claims in F7 and F12. ISC-102 and ISC-103 stay as they are.

## P9.1-T10: Drag selected files out of the app (spike first)

**Goal:** select files or folders in the sidebar, drag them onto the Desktop (or any Explorer window), and **copies** appear. A dragged folder is copied whole. The source files stay in place.

**Why a spike:** nothing in the app starts a native drag today (`src-tauri/Cargo.toml` has no drag plugin and no OLE, and tree drags are pointer events). Step 1 is a small spike: start a Windows OLE file drag (`CF_HDROP`, copy effect only) from a Rust command, behind the `src-tauri/src/platform/` trait, with either the `drag` crate or raw OLE with locally opted-in unsafe code. The spike decides which one, and how to hand over from the page's pointer drag when the pointer leaves the window.

**Rules for the real task:**

- Only paths inside an open workspace root can be dragged out. The page sends root-relative paths and Rust resolves them. `tauri-plugin-fs` stays out.
- The app's own `DragDrop` handler (`src-tauri/src/lib.rs`, `drops.rs`) must ignore a drop that started in this window, so dropping back on the app never copies a file onto itself.
- Esc cancels, and the cursor shows a copy cursor.

**If the spike fails** (WebView2 cannot hand over a drag, or the work grows past one task): stop, record a `refined:` Decisions row in `ISA.md` and the finding in `decisions.md`, and move the task to Phase 10 as a candidate.

**Tests:** Rust tests for path resolution and the refusals. The drag itself is a `manual` claim, verified in a real window by dropping two files and one folder on the Desktop. Record the numbers and the OS in ISA Verification.

**Done when:** the spike result is recorded. If it passed, a two-file and one-folder drag to the Desktop gives copies, the sources are untouched, and `pnpm check`, `pnpm check:rust` and `pnpm test:rust` are green.

## P9.1-T11: Tables inside list items are drawn as tables

**The problem:** a table written under a list item is shown as raw Markdown. `ai-docs/phases/phase-00/decisions.md` has three, each indented under a `- **Baseline...**` bullet (lines 84, 112 and 137), and none is drawn. Checked on 2026-11-20 with the real block layer: the same table at the top level is drawn, one to three spaces of indent make no difference, and four spaces or a tab make an indented code block, as in CommonMark (not a bug). Only the list parent stops it.

**Cause:** `scanBlocks` (`src/editor/livePreview/blocks/scan.ts`) walks only the top level: any node whose parent is not `Document` returns `false`, so a `BulletList` or `OrderedList` is skipped whole and its `Table` is never reached. The comment there gives the reason: the widget replaces whole lines, so a line prefix would be lost. For a list item the prefix is only the indent, which can be kept.

**Scope.** Drawn: a `Table` whose ancestors up to the document are only `ListItem`, `BulletList` and `OrderedList` (any depth, bullet or numbered), and whose first row line holds nothing but whitespace before the first pipe. Not drawn, and unchanged: a table in a quote or in a list inside a quote (the `>` prefix would be lost), and a table that starts on the marker line (`- | a | b |`, the marker would be lost). Images and every other block in a list stay as they are.

**Fix:**

1. **Scan.** Let `enter` go down through `BulletList`, `OrderedList` and `ListItem` nodes. Inside a list, handle only `Table` and return `false` for everything else, so paragraphs and images in list items are as before. `tableItem` gets the indent: the text between the start of the row's first line and the node. A table with no list ancestor has an empty indent, so a top-level table with one to three spaces of indent is drawn at the margin as it is now. `TableItem` gains `indent: string`.
2. **Widget.** `TableWidget(model, source, indent)`. With an indent, `toDOM` returns a flex container with a first child that holds the indent text itself (`white-space: pre`, invisible, no shrink) and the existing wrapper after it with `min-width: 0`. The gap is the width of the typed whitespace in the editor's own font, so it lines up under the item text for any body font, and a tab follows `tab-size`. With no indent the DOM is exactly what it is now, so top-level tables and their tests do not move. `eq` already compares `source`, which includes the indent.
3. **Field.** No change expected. `enclose` already grows an edit to the whole top-level list, so a rescan reaches every table in it, and a table that stops being one (a deleted pipe, a changed delimiter row) has its old widget cleared with the rest of the list. A test proves that, since it is the part most likely to be wrong.
4. **Clicks and the caret.** A cell's `data-offset` is counted from the start of the line, so it already includes the indent. Pressing a cell puts the caret in it, and a caret or a selection that touches the lines shows the source, as for any table. `view.posAtDOM` is taken on the returned root.

**Not in this task:** tables in quotes, a table starting on the marker line, editing cells in the drawn table, tables whose rows use different indents (the first row's indent is used).

**Claims (new, added to `ISA.md` in the task's commit):**

- **F4:** a table in a list item, bullet or numbered, one level or nested, is drawn as a table at the item's text indent.
- **F4:** a table in a list item behaves like any table: a press on a cell puts the caret there, the caret or a selection on it shows the lines as source, and an edit in the list draws it again or removes it.
- **F4:** what stays source stays source: a table in a quote, one on the marker line, and the images, paragraphs and top-level tables around a list are unchanged.
- **F4, screenshot:** `ai-docs/phases/phase-00/decisions.md` draws its three tables in `pnpm dev`.
- **F4, manual:** the owner finds the tables in lists right in the real window.

**Tests** (`tests/editor/table.test.ts`, with `drawn()` and `mountPreview`):

- **Drawn:** a bullet list, a numbered list, a nested list, a table after a paragraph in the item, and the real `decisions.md` (3 tables).
- **Indent:** the widget carries the indent text, and a top-level table with none renders exactly as before.
- **Not drawn:** a table in a quote, in a list in a quote, on the marker line, and one indented four spaces or by a tab.
- **Edits:** break the delimiter row of a table in a list and the widget goes; fix it and it comes back; type in another item and the other tables stay.
- **Caret:** the caret on a row shows the lines; a press on a cell places the caret in it.
- **Property test:** random lists with tables and paragraphs, scanned whole and edited step by step, always give the same blocks as a scan from scratch (the pattern of `blocks.test.ts`, ISC-183).
- Each new test fails on the old `scan.ts`.

**Done when:** the new tests fail on the old code and pass on the new, `decisions.md` shows its tables in `pnpm dev` (Dark and Light), the owner confirms in the real window, and `pnpm check` and `pnpm test:web` are green.

## P9.1-T12: Ctrl+Tab cycles the tab-list menu

**The change:** Ctrl+Tab and Ctrl+Shift+Tab step through the focused pane's tabs the way VS Code does, through the same menu the chevron next to the tab strip opens.

- Ctrl+Tab opens that menu (`data-tab-list-menu` in `src/workbench/TabStrip.vue`) with the next tab marked. Each further Tab press, or Down, moves the mark on, wrapping after the last tab. Ctrl+Shift+Tab opens it with the previous tab marked and moves back. **Releasing Ctrl switches to the marked tab** and closes the menu. Escape closes it with no switch.
- Order is the strip order the menu already has (pinned tabs first). A pane with one tab does nothing. Only the focused pane is touched.
- Ctrl+PageDown and Ctrl+PageUp select the next and previous tab in strip order at once, with no menu, wrapping at the ends. They are added to `REPEATING` in `src/workbench/keyboard.ts` so a held key repeats.
- All four chords are commands in the 'Tabs & Navigation' group (`COMMAND_IDS` and `registerCommand` in `src/workbench/defaultCommands.ts`), so they show in the palette and the Keyboard screen and can be rebound.

**How:** the menu is a Reka `DropdownMenu`, which commits on Enter or click and not on a key release, so the open state, the marked row and the Ctrl release are driven from our own state: a controlled `open` on the menu in `TabStrip.vue`, a small cycle state in `src/workbench/` (pure, testable: start, step, commit, cancel over a list of tab ids), and a `keyup` listener in `keyboard.ts` that commits when the Ctrl (Mod) key goes up. Use `panesOf`, `selectTab` and the pane's `tabs` from `splitTree.ts` and `store.ts`. A chord rebound to a key without Ctrl commits on the release of its modifier, whichever it is.

**Risks to check first:** that Ctrl+Tab reaches the page in the real WebView2 window. `disable_browser_keys` is set (P9.1-T2) but nothing has tried this chord. While the menu is open the focus is in the menu, so the Tab key must be taken by our handler and not move focus.

**Tests:** `tests/workbench/tabCycle.test.ts` for the cycle state (wrap, backwards, one tab, escape, pinned first, release commits), command registration and default bindings, and `TabStrip` marking the row. The real-window check goes in ISA Verification.

**Done when:** the tests fail on the old code and pass on the new; in `pnpm tauri dev` with four tabs Ctrl+Tab, Tab and release switches tabs, Ctrl+Shift+Tab goes back, Escape cancels, and Ctrl+PageUp and Ctrl+PageDown switch directly; the checks are green. Closes ISC-601 to ISC-604.

## P9.1-T13: Space on an outline heading jumps there

**The change:** in the Outline, Space on the selected heading scrolls the editor to it and leaves focus in the Outline, as Space does on a file in the Folders tree. Enter stays as it is (jump and focus the editor). The arrow keys still only move the selection.

**How:** `OutlinePanel.vue` (key handler, about `:133-165`) calls `openHeading(at, { focusEditor: false })` for Space and calls `preventDefault` so the list does not scroll. Mirror the tree: `keyAction` in `src/features/tree/model.ts:343` returns `focusEditor: false` for Space and `true` for Enter, and repeated Space or Enter is ignored (`FileTree.vue:310`). `reveal` in `src/features/outline/store.ts:145-173` already runs inside `holdingEditorFocus` when `focusEditor` is off, so no new jump code is needed.

**Tests:** `tests/features/outline.test.ts`: Space jumps and focus stays in the list, Enter jumps and focuses the editor, an arrow key does not jump, Space with Ctrl, Alt or Shift passes through.

**Done when:** the test fails on the old code and passes on the new, and the checks are green. Closes ISC-605.

## P9.1-T14: Outline layout

**The change** (`src/features/outline/OutlinePanel.vue`, helpers in `src/features/tree/model.ts` or a new pure `src/features/outline/layout.ts`):

- **Row height:** the Outline has its own fixed row height from a token (about 30 px). The list is virtual, so the height stays constant across levels. Today it shares `ROW_HEIGHT = 24` with the tree, so "the same as the tree" would change nothing.
- **Indent by rank:** a heading is indented by its rank among the levels the document uses, with a bigger step than today's 12 px. A document of H2 and H4 gets two steps, a lone level none.
- **Sizes:** H1, H2 and H3 get three different sizes, and H4 to H6 take the H3 size. All fit in the row height.
- **Bold:** the top-ranked level is bold, and only when the document has more than one level (H2 alone is not bold).
- **Muting:** deeper ranks get a progressively more muted text color, from tokens in `src/styles/tokens.css` and the theme files, and the text keeps its contrast (`tests/styles/colorPairs.test.ts`).
- **Current section:** the row of the section that holds the caret is marked, following the active editor's selection and heading edits. Nothing is marked above the first heading. This needs the outline store to follow the caret of the active tab's follower.

**Not in this task:** collapsing sections of the Outline.

**Tests:** `tests/features/outline.test.ts` (indent by rank for H1 to H3, H2 only, H2 and H4, H1 to H6; sizes; bold rule; row height used by the virtual list; caret section) and the color-pair scan.

**Done when:** the tests fail on the old code and pass on the new, the owner finds the layout right in Dark, Light and Sepia in the real window, and the checks are green. Closes ISC-606 to ISC-610.

## P9.1-T15: No error 1412 when the window closes

**The problem:** closing mdmate prints `[..:ERROR:ui\gfx\win\window_impl.cc:172] Failed to unregister class Chrome_WidgetWin_0. Error = 1412` (1412 is `ERROR_CLASS_HAS_WINDOWS`).

**Where to look:** the close path is `CloseRequested` in `src-tauri/src/lib.rs:64-87` (the session flush, a `CLOSE_GRACE` thread of 3 s, then `app.exit(0)`), the page's `closeRequested` in `src/documents/session.ts:272` and `host.quitApp()` (`app.exit(0)` in `src-tauri/src/commands/mod.rs:465`). The guess, **not yet verified**, is that the process exits while a WebView2 window of that class is still alive, so Chromium cannot unregister it. A fix would destroy or close the window first and leave through the event loop and not through a hard exit, and keep the flush of the session and the index cache (`RunEvent::Exit`, `lib.rs:263-272`).

**Steps:** (1) reproduce in `pnpm tauri dev` and in a release build and record the exact line and the way of closing that shows it (X button, Alt+F4, last tab, File → Exit if there is one); (2) try the smallest change that removes it; (3) check that unsaved work is still saved on every way of closing. If the cause is in WebView2 or Tauri and not in our code, stop and report it, with what was tried, and do not hide the line.

**Tests:** a Rust test for any new ordering logic that can be tested. The line is on stderr of the real process, so the check is `manual` and goes in ISA Verification with the OS and the build.

**Done when:** the line is gone in `pnpm tauri dev` and in the release exe for every way of closing, unsaved work is still saved, and `pnpm check`, `pnpm check:rust` and `pnpm test:rust` are green. Closes ISC-611.

## P9.1-T16: Line numbers

**The change:** an optional line-number gutter.

- **Setting:** `editor.lineNumbers`, off by default. Add it in `src/lib/settings.ts` (`Settings.editor`, `DEFAULT_SETTINGS`, `cloneSettings`), `src/lib/settingsFile.ts` (`SettingValueMap`, `SETTING_DEFS`), a switch row in `src/features/settings/rows.ts` and the live refresh in `src/features/settings/store.ts`. A palette command (no default shortcut) toggles it like Toggle Word Wrap (`defaultCommands.ts`, `quick.ts` `ToggleKey`).
- **Extension:** a live extension modelled on `src/editor/wordWrap.ts` (a setting read per view and a refresh that dispatches to each view), added to `followerBase` and `common` in `src/editor/create.ts`. It applies to all panes.
- **Placement:** all text tabs (Markdown, plain text, JSON). When word wrap centres the column (`frame` theme in `create.ts`, `marginInline: auto`), the gutter sits against the left edge of the column and not at the window edge; otherwise at the left of the pane.
- **Numbers:** source line numbers. A wrapped line shows its number once, on its first row. The line with the caret has its number marked. A block widget (table, image) shows the number of its first source line, and the lines it hides are skipped.
- **Frontmatter:** its lines are counted, so the first body line after a 5-line frontmatter is 6. While the frontmatter pill is shown (`blocks/field.ts:68`, a block replace over the whole range) the pill has no number; with the caret inside, the raw lines show and are numbered 1 to 5. The gutter has to know whether the pill is drawn, so it reads the block field.

**Risks:** the gutter must not disturb the caret, the arrow keys (the `.cm-line` padding rule in AGENTS.md), the centring math of the column or `estimatedHeight` of widgets. Check a long file for scroll jumps.

**Tests:** `tests/editor/lineNumbers.test.ts` (off by default, live toggle, the three file kinds, gutter next to the column, frontmatter counted and pill unnumbered, wrap, block first line, active line) and `tests/lib/settings.test.ts` for validation.

**Done when:** the tests fail on the old code and pass on the new, the owner finds the gutter right in Dark, Light and Sepia in the real window, and the checks are green. Closes ISC-612 to ISC-616.

## P9.1-T17: Remember the window size, position and maximised state

**The change:** mdmate opens with the size, position and maximised state it was closed with. The window is declared at 1100x720 in `src-tauri/tauri.conf.json` and nothing stores its geometry today. There is no window-state plugin and `src-tauri/Cargo.toml` has no plugins, so this is our own code.

**How:** store a `window` value (`{ x, y, width, height, maximized }`, physical pixels with the monitor's scale noted) with the session. The reader in `src/documents/session.ts` (`readSnapshot`) ignores unknown fields, so the version stays 1 and old files still load. The window starts hidden and `App.vue:39` shows it after the restore, so the geometry is applied before `host.showWindow()`. Reading and setting the size and position needs a Rust command (preferred, behind the `src-tauri/src/platform/` trait) or new permissions in `src-tauri/capabilities/default.json`. Save on the close path, together with the session flush, and debounced while the window is resized or moved so a crash keeps the last known size. A maximised window saves its restored (normal) size and the flag.

**Off-screen guard:** if the saved rectangle does not lie on any monitor (a monitor was unplugged), or is larger than the monitor, centre the window on a monitor at the saved size reduced to fit, and never below the minimum size (480x320).

**Tests:** Rust unit tests for the guard (pure: rectangle, monitors, minimum), a session round-trip test, and an old file without the field. The look in the real window is verified by the owner (resize, maximise, move, close, start).

**Done when:** the tests fail on the old code and pass on the new, the real window comes back at the same size and place, and `pnpm check`, `pnpm check:rust`, `pnpm test:rust` and `pnpm test:web` are green. Closes ISC-617 and ISC-618.

## P9.1-T18: Restore the sidebar as it was left

**The problem:** `restoreWorkspace` in `src/features/tree/store.ts` (`:593-623`) always opens every root at start (`for (const root of found) add(root, root)`, line 605), so a root the owner collapsed is open again. The sidebar's visibility and active panel (`src/workbench/sidebar.ts`) are not saved at all.

**The change:**

- **Expansion:** when a saved workspace state exists, restore exactly its `expandedPlaces`, which includes collapsed roots and folders at any depth. When nothing was saved (a first start), or for a root added in this session, open it one level as today. The code must tell "nothing saved" from "everything collapsed", so the saved state carries a marker (for instance an `expandedPlaces` array that is present, even when empty). Old files that only have the bare `expanded` paths keep today's behaviour.
- **Gone folders:** a saved folder that no longer exists is dropped without a message. Each root keeps its own set (a folder under two roots is two places).
- **Panel and visibility:** save whether the sidebar is shown and which panel is active (Folders, Search, Outline, References) in `session.ts` `workspace`, and restore them before the first paint.
- **Out of scope:** the scroll position and the selected row.

**How:** `buildSnapshot` and `readSnapshot` in `src/documents/session.ts` (`workspace`, unknown fields are ignored so the version stays 1), `restoreWorkspace` and `loadFolder` for the lazy reads of the deeper folders, `sidebar.ts` for the two refs. The journal already watches `expandedPlaces`; add the new values to what it watches. Runs after T17 because both change the snapshot.

**Tests:** `tests/features/treeRestore.test.ts` (all collapsed, two of three open, nothing saved, deep folders, a missing folder, a folder under two roots, an old file) and `tests/documents/session.test.ts` (panel and visibility round-trip).

**Done when:** the tests fail on the old code and pass on the new; the owner collapses all roots, opens a few folders deep in others, hides the sidebar, restarts, and finds it as it was; the checks are green. Closes ISC-619 to ISC-622.

## P9.1-T19: List markers are drawn as an en dash

**The change:** a list item written with `-`, `*` or `+` shows an en dash "–" in place of the marker, longer than the hyphen. Ordered lists, task checkboxes and the text are unchanged.

**Today:** `ListMark` in `src/editor/livePreview/scan.ts:288-291` only becomes a `mark` item with `.cm-md-list-mark` (`livePreview/theme.ts:71`), so the source character shows as it was typed.

**How:** replace the mark with a widget, the pattern of `CheckboxWidget` and the `TaskMarker` branch in `scan.ts:293` and `decorationsFor` in `src/editor/livePreview/index.ts:25-61`: a `Decoration.replace` with a small widget that has `eq()` and draws "–" in the `--syntax-marker` color and the bold weight of today's rule. It is shown only when the selection does not touch the marker (`touched`), so the raw marker shows under the caret and the caret never sticks inside it (add it to the atomic set `hiddenFor` the way the checkbox is). Nested lists use the same widget. The widget's width should leave the text where the hyphen left it, or the continuation lines of a wrapped item will not line up: check this with a long wrapped item. Copying gives the Markdown text.

**Tests:** `tests/editor/listMarker.test.ts`: all three markers, nested, with a task item and an ordered list around, the caret on and off the marker, a selection across items, the caret never inside the marker, and copy.

**Done when:** the tests fail on the old code and pass on the new, the owner finds the dash right in Dark, Light and Sepia, and the checks are green. Closes ISC-623 and ISC-624.

## P9.1-T20: Line height settings

**The change:** two settings, `fonts.lineHeight` (body) and `fonts.codeLineHeight` (code blocks), each a unitless number from 1 to 3 in steps of 0.05, filled with today's values. Headings get no field: they inherit the body value, and the hardcoded `lineHeight` of H1 to H3 (`livePreview/theme.ts:20,25,30`, 1.35, 1.4, 1.45) goes, a shift of at most 0.05.

**Today:** no line-height setting exists. The body, lists, tables and H4 to H6 inherit CodeMirror's default on `.cm-scroller`, which I expect to be 1.4 (confirm in the running editor first; the defaults must equal today's look). `tokens.css:44-45` has `--text-editor--line-height: 1.6`, unused.

**How:**
- Settings: `fonts` in `src/lib/settings.ts` (interface, `DEFAULT_SETTINGS`, `cloneSettings`), `SettingValueMap` and `SETTING_DEFS` in `src/lib/settingsFile.ts` (a `numberIn`-style check with the step), `rows.ts`.
- CSS: two variables in `FONT_VARIABLES` (`src/editor/documentFonts.ts`), `--doc-line-height` set on `.cm-content` and `--doc-code-line-height` on `.cm-md-box-code` (`livePreview/box.ts:135-138`); `updateDocumentFonts` already re-measures every view.
- Rows: the "Text size" row and the "Code size" row each hold two fields. One key per setting stays (flat `settings.json`), so `SettingsView.vue` gets a paired control that renders two keys in one row: sizes narrowed to about half, never below two digits, a gap between, each field with its own reset and error. The label and description name the line height. The heading sizes row is unchanged.

**Risks:** `estimatedHeight` of widgets and the scroll jump check on a long file when the line height changes live; table cells and the code box label (`box.ts:129`, 1.4) must not be left on their own value by accident.

**Tests:** `tests/editor/lineHeight.test.ts` (variables, body, list, quote, table, H1 to H6, code block, live change), `tests/lib/settings.test.ts` and `settingsFile.test.ts` (defaults, steps, refusals), `tests/features/settingsView.test.ts` (the two paired rows).

**Done when:** the tests fail on the old code and pass on the new, the owner finds the line heights right in Dark, Light and Sepia, and the checks are green. Closes ISC-625 to ISC-629.

## P9.1-T21: Line-number look

**The change:** the gutter of P9.1-T16 gets a quieter look: smaller numbers, a muted colour that is not the body colour, a subtle background on the gutter, in the code font family, in every theme.

**How:**
- Two tokens, `gutter` (background) and `gutter-foreground` (numbers), in `dark.css`, `light.css`, `sepia.css`, the `@theme inline` block of `tokens.css`, `NAMES` in `src/lib/themeTokens.ts` (editor group), `THEME_TOKEN_USAGE` in `themeTokenUsage.ts`, and a `CONTRAST_PAIRS` entry (4.5). A custom theme that leaves them out takes its base theme's (`themeFile.ts`).
- CSS in the `frame` theme, `create.ts:70-82`: background from the token, number colour from `gutter-foreground`, family `var(--doc-font-code, var(--font-mono))` (already), size `calc(var(--doc-size, 15px) * 0.85)` becomes 0.8 times the code size (`--doc-code-ratio`). The active line number keeps `var(--foreground)`.
- The gutter background is only the strip that holds the numbers. With a centred column it sits against the column's left edge, as before.

**Tests:** `tests/styles/themes.test.ts`, `colorPairs.test.ts`, `tests/lib/themeTokenUsage.test.ts` (the existing scans fail until all five places agree), `tests/editor/lineNumbers.test.ts` (rules).

**Done when:** the tests fail on the old code and pass on the new, the owner finds the numbers right in Dark, Light and Sepia, and the checks are green. Closes ISC-630 to ISC-633.

## P9.1-T22: Line selections

**The bug:** a selected whole line is highlighted into the padding on the left and right of the content area. The owner's screenshot (2026-11-21, line numbers on, a selection from the start of one paragraph to the middle of another, across blank lines and wrapped lines) shows the highlight starting about 7 px left of the text and running about 50 px past the end of the longest line on the right. The right-hand excess is larger than the 24 px padding, so the cause may be more than the padding (the scroller, the gutter, the wrap width); reproduce it in `pnpm dev` first and measure the text edge against the highlight edge before choosing the fix. Blank lines inside the selection are painted full width too.

**Cause (a guess, to confirm):** `.cm-content` has `padding: 1.25rem 1.5rem` (`create.ts:48`). CodeMirror's `drawSelection` measures full-line rectangles against the content box and insets them by the padding of the first `.cm-line` (about 6px and 2px), not by the content's 24px, so the highlight covers the padding.

**Fix:** make the text edge and the measured edge the same. Preferred: move the horizontal padding from `.cm-content` to `.cm-line` (the AGENTS.md gotcha already says to pad `.cm-line`), so CodeMirror's inset matches the text; the box (1em), the quote and the table lines keep their own padding added to it. Fallback: inset or clip the selection layer in CSS. Record the choice in `decisions.md`.

**Risks:** the caret and the arrow keys (`.cm-line` padding rule), the centring math in `documentWidth.ts` (`CONTENT_PADDING_X`, `--doc-content-max`), the gutter's position, and the widths of blocks and images. `tests/editor/contentPadding.test.ts` asserts today's padding and will change with the fix.

**Tests:** `tests/editor/selectionEdge.test.ts` (the padding and selection-layer rules for plain text, a code box, a quote and a table); `contentPadding.test.ts` and `contentWidth.test.ts` updated.

**Done when:** the tests fail on the old code and pass on the new, the owner selects with Shift+Down and Ctrl+A in the real window and finds the highlight lines up with the text, and the checks are green. Closes ISC-634 and ISC-635.

## P9.1-T23: The sidebar cannot be narrower than its tabs

**The bug:** the sidebar can be dragged so narrow that the end of "OUTLINE" leaves the sidebar and overlaps the pane's tab strip.

**The change:** the minimum width is the measured width of the tab strip's tabs (Folders, Search, Outline), plus the References tab and its close button while they are shown. It follows the font and the zoom.

**How:** `SidebarFrame.vue` measures the strip (the strip has no overflow handling, so `scrollWidth` is its natural width) and gives the pure clamp in `src/workbench/sidebar.ts` (`setSidebarWidth`, `SIDEBAR_MIN`) a minimum that can change. The Tailwind `min-w-48` on the `aside` (a second copy of `SIDEBAR_MIN`) goes, or follows the measured value; the drag, the arrow keys (`aria-valuemin`) and the session restore (`session.ts:554`) all use the same minimum. My estimate is about 210 px for three tabs and about 330 px with References; measure the real strip first. `windowWidth` in the frame is a one-time snapshot and is not reactive, so check it does not stale the maximum.

**Tests:** `tests/workbench/sidebar.test.ts` (clamp with a given minimum, restore below the minimum), `tests/shell/sidebarFrame.test.ts` (drag and keys with stubbed widths, References shown and hidden).

**Done when:** the tests fail on the old code and pass on the new, the owner finds no label leaves the sidebar at its narrowest in the three themes, and the checks are green. Closes ISC-636 to ISC-638.

## P9.1-T24: Outline bold

**The change:** in the outline the lowest heading level a document uses is always bold, also when it is the only level (this reverses P9.1-T14's "only with more than one level"). When that level occurs once, the next level used is bold too. One step, no chain. Examples: one H1 and many H2: all H2 bold. One H2, no H1, many H3: all H3 bold. No H1 or H2, only H3: all H3 bold. Many H2: all H2 bold, H3 not.

**How:** `levelsIn` (`src/features/outline/layout.ts:34-36`) returns the distinct levels; add a count of the lowest level (or a small `boldRanks(headings)` helper) and pass it from `OutlinePanel.vue:77` to `rowStyle` (`layout.ts:46-57`, where bold is `rank === 0 && levels.length > 1`). Sizes, indent and the muted inks do not change. ISC-607 loses its bold clause (done at planning); `tests/features/outline.test.ts:704-780` is updated.

**Check first:** `layout.ts:46` shows a TypeScript diagnostic in the editor (`string | undefined` not assignable to `string`); compare it with `pnpm check` before editing.

**Tests:** the cases above and a document with no headings or one heading, in `tests/features/outline.test.ts`.

**Done when:** the tests fail on the old code and pass on the new, and the checks are green. Closes ISC-639 and ISC-640.

## P9.1-T25: Searchable font comboboxes

**The change:** the heading, body and code font fields (a plain text `<Input>` today, `SettingsView.vue:694-715`) become searchable comboboxes over the installed font families, like "Add a language" under Syntax colors. Each option is drawn in its own family. "Built-in" is first and clears the setting. A typed name that is not in the list can still be used, and a saved stack (`Inter, sans-serif`) is shown and kept as it is.

**Font list:** nothing lists fonts today (searched src, `src-tauri`, docs). A Rust command, behind a new `Platform` trait method in `src-tauri/src/platform/` with an Unsupported default, reads the installed families with the `fontdb` crate (pin the version, check its licence, add it to `Cargo.toml`; ask the owner before the dependency goes in), returns them unique and sorted, and is called through `src/platform/host.ts`, `tauri.ts` and `mock.ts` (a short fixed list). Load it lazily when the first combobox opens, as `languageChoices()` does.

**UI:** the structure of lines 839-904 (`Combobox`, `ignore-filter`, own filtering, `ComboboxViewport max-h-60`), a new small component so the three fields share it. The live sample line under each field stays.

**Risks:** hundreds of options each in its own font; render only the filtered, capped part of the list if it is slow.

**Tests:** `pnpm test:rust fonts`, `tests/platform/host.test.ts`, `tests/features/fontPicker.test.ts`, `settingsView.test.ts`.

**Done when:** the tests fail on the old code and pass on the new, the owner picks fonts in the real window, and `pnpm check`, `pnpm check:rust`, `pnpm test:rust` and `pnpm test:web` are green. Closes ISC-641 to ISC-644.

## P9.1-T26: Hide names in the tree

**The problem:** the tree shows every entry (`workspace/tree.rs` `list_dir` filters nothing). The built-in excluded folders (`fs/exclude.rs`, `workspace.excludedFolders`) feed only search and the index, so `.git`, `.idea` and `.vscode` show in the tree.

**The change:** a setting `workspace.hiddenNames`, separate from `workspace.excludedFolders` (reusing it would also hide `node_modules`, `dist` and `target`, which should stay visible and, after T28, muted). Default `.git`, `.idea`, `.vscode`, `.vs`, `.svn`, `.hg`, `.DS_Store`, `Thumbs.db`. Exact names, files and folders, case-insensitive. Other dotfiles (`.env`, `.gitignore`, `.github`) stay visible.

**How:** the plumbing of `workspace.excludedFolders` (`settings.ts`, `settingsFile.ts` with a name check like `checkFolderName`, `store.ts` `assignSettings`, `rows.ts` category `files`, the chips editor in `SettingsView.vue:762-810`, generalised so two lists use it). Filter in `loadFolder` (`src/features/tree/store.ts:264`) after `host.listDir`, and refilter when the setting changes. Rust is not changed: `list_dir` still returns `.git`, which the repository discovery in T27 needs. Never hide a root row.

**Tests:** `tests/lib/settings.test.ts`, `settingsFile.test.ts`, `settingsView.test.ts`, `tests/features/tree.test.ts`; `pnpm test:rust list_dir` for the unchanged listing.

**Done when:** the tests fail on the old code and pass on the new, the owner finds `.git`, `.idea` and `.vscode` gone and `.gitignore` and `.github` still there, and the checks are green. Closes ISC-645 to ISC-648.

## P9.1-T27: Git status backend

**The change:** Rust can tell, for a root, the git status of every path under it, across many repositories. No UI colour yet (T28).

**How:** a new module `src-tauri/src/git/` (find, discover, run, parse, command), a command registered in `commands/mod.rs` with the `access().check` pattern.
- **Find git:** `git.path` when set, else `PATH`, else the standard Windows install folders (`C:\Program Files\Git\cmd\git.exe` and the like). None found: nothing runs, no error.
- **Status:** `git -C <repo> status --porcelain=v2 -z --ignored=matching --no-optional-locks`, parsed into path to status (untracked, added, modified, renamed, conflicted, ignored). The spawn sets `CREATE_NO_WINDOW` (`CommandExt` is already imported in `platform/windows/mod.rs`; keep the unsafe-free route), a timeout, and a small concurrency cap.
- **Discovery:** walk up from the root; scan three levels down skipping `fs/exclude.rs` names; check the children of each listed folder for `.git` (a directory or a file, for worktrees and submodules). The innermost repository decides a path. The depth is a constant.
- **Settings:** `git.enabled` (on) and `git.path` (empty) through the plumbing of T26 and `Applied` in `settings/runtime.rs` (Rust validation mirrors the page's), in the Files category under a new "Git" sub-group (the `group` field of the row spec, `SubGroupHeading`).

**Tests:** Rust unit tests on recorded porcelain output, temp-dir repositories (`git init`, skipped with a note when git is missing), the runner with a fake slow and failing git; `settingsFile.test.ts`, `settingsView.test.ts`, `subGroups.test.ts`.

**Done when:** the tests fail on the old code and pass on the new, and `pnpm check`, `pnpm check:rust`, `pnpm test:rust` and `pnpm test:web` are green. Closes ISC-649 to ISC-654.

## P9.1-T28: Git colours in the tree

**The change:** in the Folders tree, an added (untracked or staged-added) file or folder name is green, a changed one blue, a conflicted one in the destructive colour, an ignored one muted, and everything inside an ignored folder is muted. A folder that holds a change is blue unless it is itself untracked (green). Ignored never colours a parent. No staging section, no tab or title colouring.

**How:**
- Tokens `git-added`, `git-modified`, `git-ignored` in the five places of T21, in the theme editor's `sidebar` group. There is no blue token today. Contrast pairs against `sidebar` and `sidebar-accent` (selected row): 4.5 for added and modified, 3 for ignored.
- `FileTree.vue:568-644`: a class on the name span (the selected row keeps its fill and the colour must stay readable on it).
- The tree store asks T27's command per root, keeps the result, and refreshes on: root open or restore, window focus, mdmate's own create, save, rename, delete and move (`tree/ops.ts`), and the tree-watcher callback (`store.ts:559-573`). Debounced; a stale reply is dropped. `.git/` is not watched, so a commit in a terminal shows up on the next focus.
- A root with several repositories: one request covers the root and the answer holds every repository's paths; a change in one repository refreshes at the next trigger without redrawing the others' rows.
- `git.enabled` off or git missing: no classes, no message.

**Tests:** `tests/features/treeGit.test.ts` with a fake host (states, propagation, refresh triggers, out-of-order replies, two repositories, off); theme scans as for T21. `architecture.md` gets a Git section in the same commit.

**Done when:** the tests fail on the old code and pass on the new, the owner finds the colours right in Dark, Light and Sepia on a root of several repositories (selected row included, and after a commit in a terminal), and the checks are green. Closes ISC-655 to ISC-660.

## P9.1-T29: Table styling

**The change:** table header cells get more vertical padding, the table gets rounded outer corners, and every second body row can take a stripe colour. The stripe is controlled by a new setting `editor.stripedTables` (a switch, on by default).

**Today:** tables are a block widget (`blocks/widgets.ts:81-105`) styled in `src/editor/livePreview/blocks/theme.ts:8-36`: `th, td` padding `0.3em 0.8em`, `border-collapse: collapse`, a `--muted` header fill, no radius and no body-row fill. Nothing stripes. `ROW_HEIGHT = 33` and `TABLE_PADDING = 16` (`widgets.ts:13,25,78`) feed `estimatedHeight`.

**How:**
- Setting: `src/lib/settings.ts` (interface, defaults), `src/lib/settingsFile.ts` (`SettingValueMap`, `SETTING_DEFS`, as `editor.lineNumbers`), `src/features/settings/rows.ts` (Editor category). Live through a `--doc-table-stripe` variable (`var(--table-stripe)` when on, `transparent` when off) in the `documentFonts.ts` machinery, reached from `applySettingsFile` (`src/features/settings/store.ts:162-170`). No Rust change.
- Token `table-stripe` in the five places of T21 (three theme files, `tokens.css`, `themeTokens.ts` editor group, `themeTokenUsage.ts`), with a contrast pair for the text on it (4.5).
- CSS: header padding about `0.55em 0.8em`; `border-collapse: separate; border-spacing: 0` with the outer border and `border-radius: var(--radius)` and corner-cell radii (the wrap scrolls sideways, so check the clip); `tbody tr:nth-child(even) td` takes `var(--doc-table-stripe, transparent)`. The class names `cm-md-table-wrap`, `cm-md-table-indented` and `cm-md-table-indent` stay (ISC-585).
- Update `ROW_HEIGHT` and `TABLE_PADDING` for the taller header.

**Risks:** the scroll jump on a long table, tables inside list items (T11), progressive rows, the caret and selection tests, `--doc-line-height` (ISC-626), inline code in cells (ISC-563, ISC-581).

**Tests:** `tests/editor/tableStyle.test.ts` (padding, radius, stripes on and off, live change, list item), plus the settings, settingsFile, settingsView, themes and usage tests.

**Done when:** the tests fail on the old code and pass on the new, the owner finds the tables right in Dark, Light and Sepia, and the checks are green. Closes ISC-672 to ISC-677.

## P9.1-T30: Colour square before inline hex colours

**The change:** an inline code span whose whole text is a hex colour (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, any case, `#` included) shows a small rounded square of that colour before it, as WebStorm does. It is shown in body text and in table cells, always, with no setting.

**How:**
- `scan.ts:363-373` (the `InlineCode` branch): test the text between the backticks and emit a new `swatch` item at the span's start. `decorationsFor` (`livePreview/index.ts:26-67`) turns it into `Decoration.widget({widget, side: -1})`, a point widget placed before the opening backtick, outside the code, so it shows whether or not the selection touches the span. It is not atomic and replaces nothing. A new `swatch.ts` holds the widget (`eq` compares the colour, `ignoreEvent` is true).
- CSS `.cm-md-swatch` in `livePreview/theme.ts`: inline block, about 0.8em square, `1px solid var(--border)`, small radius, a margin, the colour as an inline background (alpha is drawn plainly over the page). The `.cm-md-code` rules stay as they are (ISC-563 reads them).
- Table cells build their code through `appendRuns` (`blocks/widgets.ts:46`), not `scan.ts`: add the same square there.
- Fenced code, links and spans with more text than the colour get nothing.

**Tests:** `tests/editor/colorSwatch.test.ts` (the four lengths, `#12`, `#ggg`, `red`, extra text, a fenced block, a table cell, the selection on and off, caret walk, copy).

**Done when:** the tests fail on the old code and pass on the new, the owner finds the squares right in Dark, Light and Sepia, and the checks are green. Closes ISC-678 to ISC-681.

## P9.1-T31: Stop touchpad overscroll from shifting the whole window

**The bug:** scrolling with a Windows Precision Touchpad past the top, bottom, left or right edge of a document (including horizontal swipes with word wrap on) shifts the entire window (title bar, tab strip, status bar and editor) inside the OS frame. Does not happen with a mouse wheel.

**Cause:** `html` and `body` in `src/styles/tokens.css` set neither `overflow: hidden` nor `overscroll-behavior: none`, and `.cm-scroller` (`src/editor/create.ts`) and the scrollable chrome panels set no `overscroll-behavior`. Touchpad overscroll chains out to the root viewport and triggers Chromium/WebView2 elastic rubber-banding on the whole page.

**Fix (CSS first, WebView2 fallback only if needed):**
- `src/styles/tokens.css`: lock `html, body` with `overflow: hidden; overscroll-behavior: none;`.
- `src/editor/create.ts`: add `overscrollBehavior: 'none'` on `.cm-scroller`.
- `src/editor/livePreview/blocks/theme.ts`: add `overscrollBehaviorX: 'contain'` on `.cm-md-table-wrap` (X only, so vertical scroll over a table still chains to the document).
- Scrollable chrome (`TabStrip.vue`, `FileTree.vue`, `OutlinePanel.vue`, `SearchPanel.vue`, `ReferencesPanel.vue`, `SettingsView.vue`, `PaletteHost.vue`, `ThemePreview.vue`, `FontPicker.vue`): add `overscroll-none` (`overscroll-x-none` on `TabStrip.vue`).
- If real-touchpad testing in `pnpm tauri dev` still bounces, fall back to `"additionalBrowserArgs": "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,ElasticOverscroll"` in `src-tauri/tauri.conf.json` (preserving wry defaults) and record it in `decisions.md`.

**Tests:** `tests/styles/overscroll.test.ts` (root CSS, `.cm-scroller`, `.cm-md-table-wrap` X-only, scrollable chrome templates).

**Done when:** the tests fail on the old code and pass on the new, the owner tests with a touchpad in `pnpm tauri dev` and sees no window shift on any edge, and `pnpm check`, `pnpm check:rust` and `pnpm test:web` are green. Closes ISC-691 and ISC-692.

## P9.1-T32: Code background and neutral text colours

**The problem:** the code background (`--syntax-code-background`) is too close to the page in every theme, in Dark almost the page itself (about 0.25 against the page's `#1d2027`), so inline code and code blocks barely show. Inline code text is green (`--syntax-code`) and headings are amber (`--syntax-heading`); the owner wants both neutral.

**The change:**
- **One token for both.** Blocks (`box.ts:76`) and inline code (`livePreview/theme.ts:47`, table cells `blocks/theme.ts:135`) already read `syntax-code-background`. Keep that one token, retune its value in `dark.css`, `light.css` and `sepia.css` so it is visibly, but only slightly, different from `--background` in each. It stays in the theme editor, whose usage text (`themeTokenUsage.ts:108`) already says "inline code and code blocks". Pick the values in the real window, using the table stripe (T29) as the reference for "plainly visible, not loud".
- **Inline code text:** `syntax-code` becomes `var(--foreground)` in the three themes. The token and its contrast pair (`themeTokens.ts:173`, 4.5 on the code background) stay, so user themes that set it keep working. The selected-code rule (`cm-md-code-selected`) is unchanged.
- **Headings:** `syntax-heading` becomes `var(--foreground)` in the three themes, H6 included (it drops its own `--syntax-marker` colour, `livePreview/theme.ts:35`). The source view follows the token (`highlight.ts:46`). The toast warning icon also reads `syntax-heading` (`toasts.css:27`, `GalleryPanels.vue:126`) and would lose its colour: move both to `--warning`. Update the usage text of `syntax-heading`, which still mentions the toast icon.
- Headings keep their size and weight; nothing else about them changes.

**Tests:** the theme scans (the three files carry the same tokens, contrast pairs hold), `tests/editor/` rules for heading and inline-code colour, the toast CSS. The probes read token values, so a test also asserts that `syntax-code-background` differs from `background` by a minimum lightness gap in each theme (the number is chosen with the owner's eye, then pinned).

**Done when:** the tests fail on the old code and pass on the new, the owner finds the code background, the inline code and the headings right in Dark, Light and Sepia, and the checks are green. Closes ISC-693 to ISC-697 (the token gap, inline code, headings, the toast icon, the owner's review), written open in `ISA.md` on 2026-11-23.

## P9.1-T33: Code block label and copy button

**The change:** in a fenced code block, the language name moves from the top right to the top left, and a copy button sits at the top right. Clicking it puts the code on the clipboard.

**Today:** the label is CSS only (`box.ts:122-133`, `::after` with `attr(data-box-label)`), so it is not in the DOM and nothing can be clicked. It shows only while the selection is outside the block (`scan.ts:190-199`, fences hidden). A fenced block inside a list or a quote has no container at all, and so no label (`scan.ts:369-372`: the container is drawn across the whole line and would cover the indent or the quote bar).

**Decisions (owner, 2026-11-23):**
- The button shows on **every fenced code block**, also one inside a list or a quote, always visible (muted, full colour on hover), and also while the caret is inside the block and the fences show. The language label stays tied to the container, so it shows only where it shows today, now at the left.
- Copies the text between the fences only: no fence lines, no final line break. The line endings are the document's own (CM6 holds `\n`; the original endings live beside the text, `lineEndings.ts`, so a `\r\n` document copies as it is saved: decide in the spike and test both).
- Feedback: the icon turns into a check mark for about 1.5 s, no toast. A failed write is a toast through `shell/toasts.ts`.
- Indented code blocks are not fenced and get nothing.

**How:**
- Label: move `right: 1em` to `left: 1em` in the `::after` rule. Keep the top offset.
- Button: a real element, so a widget. In a container (`box.ts`) a point widget at the start of the first line with `side: -1` and `position: absolute; top; right: 1em`, in `scan.ts` `fencedCode` as a new item like the swatch (`swatch.ts`): `ignoreEvent` true for the press, `eq` on block start and copy state, `mousedown` default-prevented so the caret does not move. For a block in a list or a quote (`scan.ts:369-372`) emit the same widget with a line class that makes the line `position: relative`, with no container and no background. Look at the first line's right edge in a long first line: the button must not overlap text more than the label does today (the first line has top padding for this).
- Copy: through the host (`writeClipboard` in `src/platform/host.ts`, `tauri.ts:386`, `mock.ts`), since `@tauri-apps` stays in `src/platform/`. The widget reads the block's text from the state at click time (by the block's position, mapped through changes), never from a copy kept in the widget.
- A lucide `Copy` and `Check` icon drawn as inline SVG strings in the widget (no Vue in `src/editor/`). Tooltip: this is CodeMirror DOM, not Vue, so shadcn's tooltip component cannot be used directly; follow the owner's tooltip rule (`OPERATIONAL_RULES`) with the nearest equivalent the editor already uses for hover hints (`hoverHints.ts`) and record the choice in `decisions.md`. No native `title` (a scan test fails the build on one).
- Accessible: `role="button"`, `aria-label="Copy code"`, keyboard reachable is not required (the editor owns the caret); say so in `decisions.md`.
- Read-only and preview mode (`previewMode.ts`): the button works there too, since it only reads. Source mode shows no preview items, so no button.

**Risks:** the caret and arrow-key walk over the first line (the widget must not become a step: not in `hiddenFor`, as the swatch); selection and drag across the block (a press on the button must not start a selection); scroll jump if the widget changes the first line's height (it is absolute, so it must not); the line-number gutter (`lineNumbers.ts`) and folding of the block; a block of 10,000 lines (build the widget only for the visible range, as `boxLines` does).

**Tests:** `tests/editor/codeBlock.test.ts` and a new `tests/editor/codeCopy.test.ts`: label on the left and button on the right in the theme rules; the widget exists with the fences hidden and shown, in a list and in a quote, and not for an indented block; a click writes the text between the fences (with and without a language, empty block, `\r\n` document, longer fence, tilde fence) through a fake host; the check icon returns to the copy icon; a failed write toasts; the caret walk is the same with and without the widget; copy of a selection across the block does not include the button.

**Done when:** the tests fail on the old code and pass on the new, the owner finds label and button right in the real window in Dark, Light and Sepia (in a plain block, a long first line, a block in a list and in a quote), and the checks are green. Closes ISC-698 to ISC-703 (label left, a button on every fenced block, the copied text, feedback, the caret walk and height unchanged, the owner's review), written open in `ISA.md` on 2026-11-23. **Open for the owner:** a block in a list or a quote keeps the plain look (no background), so T32's new background does not reach it. Say if it should (it needs the container drawn from the indent, a bigger change; it would be its own task).

## P9.1-T34: The indexing bar in the primary colour

**The change:** the bar in the status bar that shows how far indexing is (`src/shell/StatusBar.vue:37-50`) is drawn in `bg-primary` instead of `bg-statusbar-foreground`. The track behind it stays (`bg-statusbar-foreground/20`). The label "Indexing" keeps the status bar's text colour. The search panel's bar already uses `bg-primary` (`SearchPanel.vue:448`).

**Check:** primary against the status bar in each theme. Add a contrast pair `['primary', 'statusbar', 3]` to `themeTokens.ts:166` area (3:1, a non-text element) and fix the theme values only if a theme fails it; say so in `decisions.md` if one does.

**Tests:** the existing status bar test (`data-index-bar`) asserts the class; a theme test for the new pair.

**Done when:** the test fails on the old class and passes on the new, the owner sees the bar in the primary colour in Dark, Light and Sepia during an index run, and the checks are green. Closes ISC-704 and ISC-705, written open in `ISA.md` on 2026-11-23.

## P9.1-T35: Open All

**The change:** with two or more files selected in the sidebar, the context menu gets **Open All** (today the menu of a multi-selection holds only Delete, `FileTree.vue:676-681`). It opens every selected file in the active pane (the most recent one when none has focus), as a click on a file does (`activateRow`, `tree/store.ts:531-550`, which calls `openInActivePane`).

**Decisions (owner, 2026-11-23):**
- Shown when the selection holds two or more files. Selected folders are ignored (not opened, not expanded). A selection with fewer than two files shows no Open All.
- Files open in tree order, top to bottom, across roots in the order the tree shows them. The **first** file ends as the active tab, so the owner lands at the top of the list.
- **Enter** on a multi-selection does the same (today it opens only the row with focus, `FileTree.vue:335-337`), through the same function. Double click is unchanged: it works on one row.
- No confirmation, whatever the count. Files already open in the pane just take focus (no duplicate tab); the final active tab is still the first file.
- The opens run in order, one after another, like the single opens do (`opening` in `store.ts:524`), so the editors are not all built at once. A file that fails to open is reported through the toast (`reportError`) and the rest still open.

**How:** a function `openAllSelected()` in `tree/ops.ts` beside `deleteSelected`, using `selectedPlaces` and the tree row order; the menu item in `FileTree.vue` next to Delete in the `manyRows` branch (label "Open All", with the count when it helps, as Delete says "Delete 3 items"); the Enter branch in `onKeydown`. The last step activates the first file's tab. Not a palette command: it needs a selection.

**Risks:** the focus ring and `holdingEditorFocus` (the tree keeps keyboard focus after a menu open); many tabs at once on a small pane; one root that is a file or a missing path.

**Tests:** `tests/features/tree.test.ts` or a new `treeOpenAll.test.ts` with a fake host: two files, files and folders mixed, one file only, across two roots, an already open file, a failing file in the middle, Enter with several selected, the first file active at the end, Delete's menu unchanged.

**Done when:** the tests fail on the old code and pass on the new, the owner opens several files from the menu and with Enter in the real window, and the checks are green. Closes ISC-706 to ISC-709 (the menu item and its rules, order and active tab, Enter, the owner's review), written open in `ISA.md` on 2026-11-23.

## P9.1-T36: Border and padding on inline code

**The request (owner, 2026-11-23, from a screenshot):** inline code looks bigger than the body text; give it a subtle border a little lighter than its background in Dark and a little darker in Light and Sepia, with 2px of padding above and below and 3px to 4px at the sides, so it is easier to see. The code blocks already have a border (`--border`), plain in Light and Sepia and hardly visible in Dark: use the same kind of border there.

**The size question:** inline code is `font-size: 1em` (T5), and the screenshot's computed sizes are equal (15px in the body line and in the span, measured in the dev browser). It looks bigger because the families differ: the body is the generic `monospace` (Consolas on Windows) and the code is `ui-monospace, Cascadia Code, ...` (Cascadia is wider and has a taller x-height at the same size). No change here; an inline-code scale is a separate decision if the owner wants one.

**The change:**
- **Token `syntax-code-border`:** in the three themes, the theme editor's syntax group, `tokens.css`, `themeTokenUsage.ts`. Dark lighter than `syntax-code-background`, Light and Sepia darker, a contrast against it of 1.15 to 1.6 (first values from screenshots; the owner's review may move them).
- **Inline code** (`livePreview/theme.ts` `.cm-md-code`, and `.cm-md-table code` in `blocks/theme.ts`): `border: 1px solid var(--syntax-code-border)`, `padding: 2px 3px`. The selected part (`cm-md-code-selected`) has a transparent border, so a split span shows no broken frame, and keeps its padding so the text does not move.
- **Code blocks** (`box.ts`): `.cm-md-box-code` sets `--box-border` to the token; the base `.cm-md-box` keeps `--border` for other kinds.

**Risks:** horizontal padding makes the span wider, which the caret and click mapping handle for inline marks (check the arrow-key walk and a click on the last character); a span that wraps over two lines (default `box-decoration-break: slice`); the colour swatch before a hex colour (it sits outside the span); 2px vertical padding must not change line heights.

**Tests:** `tests/editor/inlineCodeBorder.test.ts` (rules for text, table cell, selected part, block, other kind), the theme tests for the token.

**Done when:** the tests fail on the old code and pass on the new, the owner finds the borders right in Dark, Light and Sepia, and the checks are green. Closes ISC-710 to ISC-713.

## P9.1-T37: Inline code padding, table cell padding

**The request (owner, 2026-11-23, after T36):** inline code padding `0 2px` (the owner dropped the 1px above and below the same day) instead of `2px 3px`; body cells of a table get top and bottom padding, because inline code sits too close to the row lines (screenshot of a table of colour tokens). The header cells are left out.

**The change:** `.cm-md-code` and `.cm-md-table code` padding `0 2px`; `.cm-md-table td` vertical padding `0.3em` to `0.4em` (the header keeps `0.55em`); `ROW_HEIGHT` and `HEADER_EXTRA` in `widgets.ts` follow the drawn rows (measured, not guessed).

**Tests:** `inlineCodeBorder.test.ts` (padding), `tableStyle.test.ts` (body 0.4em, header 0.55em). **Closes** ISC-714; ISC-711 reworded.

## P9.1-T38: Bundled Google Font presets & balanced inline code

**The change:** keep the non-bundled system monospace defaults (`system` default: `monospace` headings & body, `var(--font-mono)` code) as the 1st preset, alongside 9 Google Fonts shipped locally via `@fontsource*` (zero network, all OFL-1.1) forming 3 curated Markdown typography presets (`editorial`: Montserrat + Lora + JetBrains Mono; `modern`: Raleway + Open Sans + Fira Code; `journal`: Oswald + Merriweather + IBM Plex Mono), selectable via 4 live preview cards in Settings → Appearance → Fonts (`fonts.preset`). Clicking a card atomically sets `fonts.preset` and clears individual `fonts.heading`/`body`/`code` overrides. Inline code scales optically via `--doc-inline-code-scale` (`0.82` for System/monospace, `0.9` for Lora, Open Sans, Merriweather and custom body fonts) while remaining independent of `fonts.codeSize`. Plain-source files (`parser: false`) and Markdown Raw Mode (`previewMode` off) apply `.cm-source-mode` to use `--doc-font-code`, `fonts.codeSize` and `fonts.codeLineHeight`. Default `fonts.size` becomes `16` and `fonts.lineHeight` becomes `1.5`. Bundled font names appear in `FontPicker` with `Preset default (<Font Name>)`. OFL-1.1 notices for Inter and all 9 new fonts are collected in `public/fonts-LICENSE.txt` and tracked in `ISA.md` Remaining Work for Phase 10.

**Tests:** `tests/lib/fontPresets.test.ts`, `tests/editor/sourceModeFonts.test.ts`, updated `documentFonts.test.ts`, `settingsFile.test.ts`, `fontPicker.test.ts`, `settingsView.test.ts`, `subGroups.test.ts`, `lineNumbers.test.ts`, `lineHeight.test.ts`, `commentedFiles.test.ts`.

**Done when:** fail-first tests pass, `pnpm test:web`, `pnpm check`, `pnpm check:rust` and `pnpm build` exit 0, visual checks in `pnpm dev` pass in Dark/Light/Sepia, and the owner reviews ISC-721. Closes ISC-715 to ISC-721.

## P9.1-T39: Per-preset typography sizes & Comfort / Compact density

**The change:** each built-in preset carries default text size & line height, code size & line height, and heading scale (`system`: `16 / 1.5`, `14 / 1.5`; `editorial`: `18 / 1.6`, `14 / 1.5`; `modern`: `17 / 1.6`, `14 / 1.5`; `journal`: `18 / 1.6`, `14 / 1.5`; all heading scale `[1.7, 1.45, 1.25, 1.1, 1, 0.95]`). `fonts.size`, `fonts.lineHeight`, `fonts.codeSize`, `fonts.codeLineHeight`, and `fonts.headingScale` default to `null` (inherit active preset); explicit numbers/arrays remain valid overrides, and picking a preset clears all 8 font & size overrides atomically. New `fonts.density` (`"comfort"` default | `"compact"`) toggle sits below the preset cards: Compact applies `max(10, round(px * 0.86))` to text & code sizes and `max(1.15, lh - 0.1)` (0.05 steps) to both line heights live without mutating stored numbers. Inputs display base Comfort values (with effective readout beside the toggle when Compact is active), and preset card footers show effective text size / line height.

**Done when:** fail-first tests pass, `pnpm test:web`, `pnpm check`, `pnpm check:rust` and `pnpm build` exit 0, visual checks in `pnpm dev` pass, and the owner reviews ISC-727. Closes ISC-722 to ISC-727.

## P9.1-T40: Custom user font presets

**The change:** user-created font presets live as `<data_dir>/font-presets/<stem>.json` (JSONC on read, clean JSON on write; optional `inlineCodeScale`), managed by Rust `FontPresetStore` (sharing `JsonFolderStore` with `ThemeStore`: plain names, 256 KB / 200 files, atomic write, Recycle Bin delete, live watch, open folder). Loaded at app startup (`App.vue`), with missing/broken ids falling back to `system` with a notice. Preset container gains a filter input, contextual `Update preset` / `Save as new` / `New preset` toolbar, inline creation form, capped scrollable 2-col grid (`max-h-[26rem]`), `Built-in` badge on built-in cards, and a card ellipsis (`⋯`) menu (`Duplicate…`, `Reset overrides`, `Update from current`, inline `Rename…`, confirmed `Delete`). Settings → Advanced gains an `Open font presets folder` row aligned with `Open themes folder`.

**Done when:** fail-first Rust & web tests pass, `pnpm test:web`, `pnpm test:rust`, `pnpm check`, `pnpm check:rust` and `pnpm build` exit 0, visual checks pass, and the owner reviews ISC-735. Closes ISC-728 to ISC-735.

## P9.1-T41: Preset & search input polish

**The change:** (1) Hide native `input[type='search']::-webkit-search-cancel-button` globally in `tokens.css` and add the thin Lucide `X` clear button to `Search settings` and `Search shortcuts` matching `FontPresetCards.vue`; (2) make `noticesHeld` reactive in `features/fontPresets/store.ts` so `fontPresetProblem` never flashes a red missing-preset error during active-preset rename; (3) scroll the active preset card into view inside `[data-font-preset-cards]` on mount without scrolling the outer Settings panel; (4) hide `[data-font-preset-cards]` scrollbar thumb at rest and show it only while `data-scrolling="true"`; (5) switch the preset grid to 3 columns on desktop (`@[46rem]:grid-cols-3`) when the app has 6 or more presets.

**Done when:** fail-first tests pass, visual check in `pnpm dev` passes, and `pnpm check` & `pnpm check:rust` exit 0. Closes ISC-736 to ISC-740.

## Follow-ups on done tasks (2026-11-22)

Not tasks. Each one reopens or adds the claim named, fails its probe on the old code first, and is committed as `[P9.1-Tn] ...` with the tag of the task it amends.

| Follow-up | Amends | Claims | Where |
|---|---|---|---|
| Remove "Open settings.json" from the menu; palette and Settings buttons stay | P8-T1c | ISC-347 reworded | `src/shell/menuEntries.ts:73`, `tests/shell/menuEntries.test.ts` |
| README and `.txt` icons draw a black box in Light and Sepia | P9.1-T8 | ISC-578, ISC-579 reopened; ISC-662 | five sprite symbols start with `<path d="M0 0h24v24H0z"/>`; strip it in `scripts/build-file-icons.mjs` and regenerate `public/file-icons.svg` |
| Content width default 1024 | Phase 8 | ISC-682; probe rows of ISC-439, ISC-443 | `src/lib/settings.ts:200`, `rows.ts:211`, `contentWidth.test.ts`, `selectionEdge.test.ts:85`; only the default moves |
| Browse button on the Git program row | P9.1-T27 | ISC-666 to ISC-668 | host `pickExecutable` (`host.ts`, `tauri.ts`, `mock.ts`), Rust `pick_executable` with `rfd` and no file grant, a `path` control kind in `rows.ts`, `SettingsView.vue` |
| Pane handle 1px at rest, 4px on hover and drag, no second line | P1-T4, P8-T6 | ISC-663, ISC-664 | diagnose first (`data-state` against `:hover`); `ResizableHandle.vue`, `SplitNodeView.vue` |
| Font list opens scrolled to the selected font | P9.1-T25 | ISC-665 | `FontPicker.vue`: scroll the selected option into view on open; keep the selected family in the list past the cap of 60 |
| Gutter on the page background, 0.9 of the code size, 10px each side | P9.1-T21 | ISC-632 reworded, ISC-633 reopened; ISC-669 | `--gutter` equal to `--background` in the three themes (the token stays), `create.ts:79-95`, `lineNumbers.test.ts`, `documentFonts.test.ts:178-183`, the subtle-strip check in `themes.test.ts` |
| List marker box as wide as the en dash | P9.1-T19 | ISC-670, ISC-671 | `bullet.ts` and `theme.ts:72-79`; the pinned test `listMarker.test.ts:113-126` changes |

Order: the follow-ups from the smallest up (menu, width, icons, marker, gutter, font list, Browse, pane handle), then T29, then T30.
