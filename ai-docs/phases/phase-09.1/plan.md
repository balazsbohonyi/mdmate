# Phase 9.1: Polish

**Goal:** the small faults and rough edges the owner finds in daily use are fixed before the release work in Phase 10.

**Why now:** Phases 8 and 9 are done and merged, and Phase 10 ships. Anything that looks wrong in the app today would ship with it. The owner decided on 2026-11-17 to collect these fixes in a decimal phase, as Phase 7.1 did, instead of folding them into Phase 10.

## How the phase runs

- **One fix, one task.** Tasks are `P9.1-T1`, `P9.1-T2` and so on, one commit each, with the subject `[P9.1-Tn] Short imperative description`.
- **Plan first, then add to this file.** The owner writes a small plan for each fix. Its task gets a section below and a line in `ai-docs/tasks.md` before the code changes.
- **Every fix has a claim.** A bug reopens the claim that should have caught it, or adds a new one (`ai-docs/standards/isa.md`). The probe fails on the old code first.
- **Scope stays small.** A fix that grows into a feature moves to Phase 10 or a phase of its own.
- **Order:** T2 to T10 run in order. T10 starts with a spike and may move to Phase 10 (recorded in `ISA.md` Decisions). T11 was added later and touches nothing the others do, so it can run before T9. T12 to T19 were added on 2026-11-21 (owner review) and run in order; each is independent of the others, except that T17 and T18 both add fields to the session snapshot (`src/documents/session.ts`), so they run one after the other.
- **Claims:** a task's claims are added to `ISA.md` in the task's own commit, as P9.1-T1 did. The sections below name the claims a task reopens and the areas where new ones go.
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
