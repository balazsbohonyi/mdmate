# Phase 9.1 decisions

Deviations from `plan.md` and choices it left open. The same decisions are in the Decisions section of `ISA.md`.

## P9.1-T12: Ctrl+Tab cycles the tab-list menu

- **Palette run.** The Cycle Tabs commands run from the command palette have no key press, so there is no release to wait for. They switch to the next or previous tab at once, with no menu. The plan did not say.
- **Focus stays put.** The menu the cycle opens does not take focus: the keys that drive it (Tab, the arrows, Escape, Enter, the release of Ctrl) are read by the page, so the editor keeps its caret and CodeMirror never sees them. Committing puts the caret in the editor of the tab switched to.
- **Ways out.** Besides the release of Ctrl and Escape, the cycle ends with no switch when the window loses focus (a release that never arrives) and when another pane takes the focus. A click outside the menu cancels it too.
- **Open risk (ISC-604).** Whether WebView2 hands Ctrl+Tab to the page was not tried; `disable_browser_keys` is set but nothing has used this chord. The owner checks it in `pnpm tauri dev`.

## P9.1-T13: Space on an outline heading

Done as planned. A held Space acts once, like Enter and like the tree. Space with nothing selected only stops the list scrolling.

## P9.1-T14: Outline layout

- **Muting is not a theme token.** The plan said "tokens in `tokens.css` and the theme files". `tests/styles/themes.test.ts` keeps every color function out of `tokens.css`, and a new theme token reaches the color editor and every custom theme. So the steps are two classes in `src/styles/outline.css` (the arch rule allows color literals only in `src/styles/`) that mix `--sidebar-foreground` with `--muted-foreground` (67%, 33%, then the muted token itself). Both ends are checked by `CONTRAST_PAIRS`, which now also holds `muted-foreground` on `sidebar` and on `sidebar-accent` (the selected row), and a mix lies between them.
- **Selected row.** It keeps the selection color and is not muted.
- **Current section.** A 2 px primary bar on the left edge of the row and `aria-current`; no fill, so it reads beside the selection fill.
- **Row height.** `--spacing-outline-row` (1.875rem) in `tokens.css` and `OUTLINE_ROW_HEIGHT` (30) in `layout.ts`; a test holds them equal. `visibleWindow` takes the row height as an argument (default: the tree's 24).

## P9.1-T15: No error 1412 when the window closes

- **Confirmed cause.** `quit_app` ended the process with `app.exit(0)` while the WebView2 window was alive. Reproduced in `pnpm tauri dev` (stderr to a file, a close message to the window), then removed with `end_app`: destroy the windows, let the event loop leave. Three closes afterwards printed nothing; markers showed `CloseRequested`, `end_app` and `RunEvent::Exit` in order.
- **Fallback.** A stuck page still cannot keep the app open: after the grace period `end_app` runs, and a second grace period later `app.exit(0)` ends it for certain.
- **Open (ISC-611).** The release exe was not run, and a dirty document through the close was not tried, because no key presses could be sent to the window with certainty. The owner checks both.

## P9.1-T16: Line numbers

- **Own gutter, not `lineNumbers()`.** CodeMirror's built-in gutter cannot be switched by a setting without rebuilding the state, and it numbers every block widget it finds, the frontmatter pill included. `src/editor/lineNumbers.ts` is a `gutter` of its own: it reads `editor.lineNumbers` per line, and a refresh effect (sent by `refreshLineNumbers()` when the file changes the setting) makes every open view draw its markers again, as `wordWrap.ts` does. The block widgets are numbered through the gutter's `widgetMarker`, skipping `FrontmatterWidget`.
- **Off takes no room.** The editor carries `cm-lineNumbersOn` while the setting is on; the theme gives `.cm-gutters` `display: none` without it.
- **Placement.** With the gutter on, the wrapped column drops its `margin-inline-start: auto` and the gutter takes it, so the gutter and the column sit as a pair in the middle of the pane, numbers against the text. Without word wrap the column already runs from the left edge, and the gutter sits at the left of the pane.
- **Frontmatter.** No extra work was needed to count its lines: numbers come from the source line of each row, so the first body line after five frontmatter lines is 6 whether the pill is drawn or not.
- **Palette only.** The command "Toggle Line Numbers" is in the View group with no default shortcut and no menu entry, as the plan said.
- **Open (ISC-616).** jsdom draws no layout. The owner checks the look, the centring, the caret and arrow keys, and scrolling a long file in `pnpm tauri dev`.

## P9.1-T17: Remember the window size, position and maximised state

- **Rust remembers the normal bounds.** A maximised window reports the whole screen, so `WindowMemory` keeps the last bounds seen while the window was not maximised, minimised or full screen (`window_state::current`, called on every `Moved` and `Resized` and by `window_geometry`). A maximised window is saved as those bounds plus `maximized: true`. The page does not track the normal size itself.
- **Inner size, outer position.** `set_size` takes the content size and `set_position` the outer position, so the saved value is the pair Tauri takes back. The window has no frame, so the two sizes are the same.
- **Where it is in the file.** `window` sits at the top of the snapshot, beside `workspace`, and is left out until the host has answered once. Old files have none and the version stays 1.
- **Reachable, not inside.** The guard keeps a window that is partly off a monitor while at least 100x50 px of it lie on one (enough to grab the title bar). Entirely off every monitor, or larger than the monitor it mostly lies on, it is centred on the first monitor (the primary), at the saved size reduced to fit. The work area is used, so it does not go under the taskbar. A monitor smaller than the minimum cannot hold the window; it starts at that monitor's corner.
- **Placement order.** Position, size, position: moving a window to a monitor with another scale can resize it, and the last move puts it back.
- **Maximise before show.** `restore` maximises while the window is still hidden. Whether WebView2 keeps it hidden through that was not looked at; the owner watches the start for a blank frame.
- **Known limit.** Dragging a window to the top edge to maximise it moves the window first, so the normal bounds saved are where the drag ended, not where it began. Windows keeps its own record of that, which would need Win32 `GetWindowPlacement`; not done.
- **Open (not part of ISC-617/618).** The look in the real window: size, place, maximised, a second monitor, unplugged monitor. The owner checks it in `pnpm tauri dev`.

## P9.1-T18: Restore the sidebar as it was left

- **The marker already existed.** `expandedPlaces` is always written as an array, so "present" already means "saved", and an empty array means everything was collapsed. No new field was needed for the tree. `restoreWorkspace` opens all roots only when `places` is undefined, which is a first start, a missing or damaged session and a session from before places (those keep the bare `expanded` paths).
- **Existing sessions.** A file written by an earlier build already lists the roots that were open, so the new rule reads it correctly. A root that was collapsed in such a file used to be reopened; now it stays collapsed.
- **Gone folders.** `loadRestored` lists each restored folder, and one that cannot be listed (any error) is closed again with no toast. A root is never dropped: it keeps the reason under it, as before. A folder under two roots is two places, and the listing error removes every non-root place with that path.
- **References becomes Folders.** The References tab exists only while a result is on screen, and the result is not saved. Restoring that panel would draw the folders with no tab pressed. So the snapshot writes `references` as the folders, and `restoreSidebar` reads it as the folders. This is narrower than the wording of ISC-621 ("References").
- **Left out when default.** `sidebarVisible` is written only when false and `sidebarPanel` only for Search and Outline, like `sidebarWidth`, so existing snapshots and tests stay byte-identical.
- **Journal.** It watches the sidebar's visibility and panel along with its width.
- **Open (ISC-622).** The owner restarts `pnpm tauri dev` after collapsing roots, opening folders deep in others and hiding the sidebar.

## P9.1-T19: List markers are drawn as an en dash

- **Width.** The widget is a hidden hyphen that sets the width, with the en dash laid over it (`bullet.ts`). In a monospace font the two glyphs are equally wide. In a proportional body font the dash is wider than a hyphen and overhangs into the space after the marker; the text does not move, so continuation lines of a wrapped item still line up. This was not looked at on screen.
- **A new item type.** The scan returns `bullet` (like `checkbox`) instead of the `mark` for `-`, `*` and `+` when the selection is away. The raw marker with `cm-md-list-mark` is the same as before while it is touched, and ordered markers (`1.`, `2)`) never change.
- **Caret.** The bullet is added to the set the caret steps over (`hiddenFor`), like hidden syntax. Because a selection that touches the marker (edges included) shows the raw marker instead, the caret never sits inside a drawn dash; a walk with the arrow keys visits every position.
- **Click.** The widget ignores no events (`ignoreEvent` false), so a click on the dash puts the caret by the marker, which then shows raw.
- **Copy.** Copying reads the document, so it gives the Markdown text. CodeMirror answers a copy only for a focused editor, so the copy tests focus the view.
- **Open.** There is no manual claim for T19. The plan's "the owner finds the dash right in Dark, Light and Sepia" is the owner's look at the real window.

## P9.1-T20: Line height settings

- **Confirmed first.** CodeMirror's injected CSS has `line-height: 1.4` on `.cm-scroller`, so both defaults are 1.4 and the look is unchanged. The plan's guess held.
- **Heading values dropped.** H1 to H3 had 1.35, 1.4 and 1.45. They now inherit the body value, so a default heading is at most 0.05 off from before (as the plan said).
- **Code box label stays at 1.4.** It is an `::after` that is out of the flow of the lines, so its line height changes only its own box. Tying it to either setting would move its text relative to the box corner. A test pins it.
- **Gutter (new claim ISC-661).** The gutter inherited 1.4 from the scroller, so at a taller body line height each number would sit at the top of its taller cell. Its line height is now `body line height * body size` as a length, which gives the number the same line box as the body text whatever the number's own size is. T21 changes the number size and this keeps working.
- **One key per setting, a row for two.** The text size and code size rows are `pair` rows: the second key has its own spec marked `drawnIn` (so the `settings.json` template still has its note, and "every key has a row" still holds) and no row of its own on screen. Search looks into the row that holds a key, so "lineHeight" and "line height" both find it. Each field has its own caption, reset and error; the row's label shows the changed dot while either field differs, with no reset of its own. Both keys are shown under the description.
- **Field width.** `grid-cols-[repeat(2,minmax(4.5rem,1fr))]` with `gap-2`: each field is about half of the 16rem column, and 4.5rem holds two digits with the padding.
- **Step check.** Steps are counted from 1 with a 1e-9 slack, since 1.45 is not exact in binary. All refusals use one sentence: "Use a number from 1 to 3 in steps of 0.05."
- **Rust.** No change: it holds no `fonts` keys.
- **Widget height estimates stay fixed.** `ROW_HEIGHT` (33), `TABLE_PADDING`, `PILL_HEIGHT` and the image estimates in `blocks/widgets.ts` do not read the font size, the font or now the line height; they are the rough first guess the code already calls one, and CodeMirror measures the real height after the first draw. `refreshDocumentFonts` makes every view measure again on a change, so a live line-height change is corrected there. Scaling only the line-height part would make the estimate follow one input of three. The scroll jump on a long file after a live change was not checked.
- **Probe first.** None of the planned probe files held a line-height test before this task, so the tests were written first: 29 fail on the old sources (12 in `lineHeight.test.ts`, 4 in `settingsFile.test.ts`, 13 in `settingsView.test.ts`). Five more guard what must not change and pass on both (lists, quotes and tables carry no line height of their own; the code box does not read the body property; inline code has no line height; the label stays at 1.4; the heading sizes row is as it was).
- **Open (ISC-629).** The owner looks at the line heights in the real window in the three themes.

## P9.1-T21: Line-number look

- **Probe first.** The planned probes did not exist (the tokens were not there), so the tests were written first; 10 of them fail on the old sources. Three more guard what already held.
- **Colours.** Dark, Light and Sepia have a strip a little darker than the page (contrast against the page 1.05 to 1.12, held between 1.03 and 1.3 by a test) and numbers that read at 4.5:1 or more on it without being the body text. Sepia's numbers are the muted brown the theme already has.
- **0.8 times the code size.** The plan said "0.8 times the code size (`--doc-code-ratio`)". The ratio is code size over text size, so the size is `ratio * text size * 0.8` (11.2 px at 14 over 15). The old `0.85 * text size` was 12.75 px. A test pins that `create.ts` has one use of the ratio and that it is this one.
- **Strip only.** The background is on `.cm-gutters`, which holds the numbers, and nothing wider; with the centred column it sits against the column's left edge as before (T16).
- **Active number.** It keeps `--foreground` on a transparent background, so the strip shows through.
- **Open (ISC-633).** The owner's look in the real window.
- **Probe files.** The Test Strategy rows of ISC-630 and ISC-631 named `themeColors.test.ts` and `colorPairs.test.ts`, which hold none of the new checks (colorPairs scans class pairs in sources). The rows now name `tests/lib/themes.test.ts` and `tests/styles/themes.test.ts`, where the tests are. The claims are as they were.

## P9.1-T22: Line selections

- **Reproduced and measured first.** The cause in the plan is right: CodeMirror measures a whole-line highlight from the content box and insets it by the first line's padding (6 px, 2 px), so the 24 px of content padding was painted (highlight 622.6 to 1562.6 against text from 646.6 and a line box to 1540.6). The owner's 7 px and 50 px did not show as numbers here. The 50 px is the 22 px past the line box plus the ragged end of a wrapped paragraph (about 28 px), because a whole-line highlight runs to the end of the line by design. Nothing beyond the padding is involved, so no scope signal: the gutter, the scroller and the wrap width are not part of it.
- **Fix differs from the plan's preferred one.** The padding is not on `.cm-line`; the room beside the text moved from `.cm-content` to `.cm-scroller`, so the content box is the text column. Padding on the lines would have needed new horizontal room on the quote bar, the rule's border, the code panel (`inset: 0` of the line), the table and image block widgets and the frontmatter pill, which are children of the content and not lines, and a change to the image width code. The scroller keeps every line and widget where it was (the code panel and a table line measured 630 to 1530 before and after).
- **Gutter on.** The gutter has to stay at the pane's edge, so the scroller gives up its left room and the content takes it as a margin (`marginInlineStart`), in every mode. The gutter (595.4 to 616.6) and the text (646.6) measure the same as before.
- **`--doc-content-max` changed meaning.** The room is outside the content box now, so the variable is the column width (`900px`, or `none`), not `calc(width + 2 * 1.5rem)`. The closed claim ISC-443 (the fallback equals the defaults) holds; only the value its Test Strategy row names changed. `contentWidth.test.ts` and `contentPadding.test.ts` were updated for it.
- **Highlight inside a code box or quote.** CodeMirror reads the first line's padding only, so on a quote or a code box the highlight starts at the plain text edge, not at the box's own text. That was already so and is not changed here.
- **Open (ISC-635).** The owner's look in the real window, with Shift+Down and Ctrl+A.
- **Mouse presses in the room.** The room beside the text is outside the content element now, which is where CodeMirror handles presses. Checked in `pnpm dev`: a click left of a line's text puts the caret at that line's start and a drag from there selects whole lines, with line numbers off and on, so no handler was added. The end of a long line without word wrap still has the room in the scrollable width (26 px past the text).

## P9.1-T23: The sidebar cannot be narrower than its tabs

- **Measured first.** Folders 56.6, Search 50.8, Outline 54.4 px, strip padding 12 px each side, gap 12 px: 209.8 px of strip, 210.8 with the frame's border, so 211 after rounding up. With References (80.2 px) and its 20 px close button: 335. The plan's estimates (210 and 330) were close. At the old 192 px the end of OUTLINE stuck out 5.8 px, which is the bug.
- **Minimum is the strip, the fallback is 12rem.** `SIDEBAR_MIN` stays as the value before the frame has measured anything (a window with no sidebar, the unit tests of the pure clamp). Once measured, the minimum is what the strip needs, even if that is under 12rem at a small zoom. The Tailwind `min-w-48` on the frame is gone, replaced by an inline `min-width` of the same measured value, so there is one number.
- **Measured from the items.** The strip's width is read from its padding, the items' own widths, the gaps and the border, not from `scrollWidth`, which is no more than the strip when there is room. The tabs cannot shrink under their text, so their widths are natural. The measure runs on mount, when a font arrives, on a window resize (which is also when browser zoom changes), when `ResizeObserver` sees a tab change size, and after the References tab appears or goes.
- **A width already set below a new minimum is raised, and stays raised.** Opening References lifts a 250 px sidebar to 335; closing it leaves 335. The alternative, remembering the width the user chose and giving it back, is more state for a case that is not in the claims. The default width (no drag) has nothing to raise, since the page holds it up with the same `min-width`.
- **`windowWidth` is reactive now.** It was a snapshot taken at setup and fed the handle's `aria-valuemax` only; it follows the window as it is resized (the same listener as the measure). The clamp itself already read `window.innerWidth` at each use.
- **`aria-valuenow`.** At the default width the handle reported 240 while the page held the frame at the new minimum (335 with References), which is a value under its own `aria-valuemin`. It now reports the larger of the two. Advisor finding, applied.
- **ISC-545** (the error bubble fits a narrow sidebar) was checked at the old 191 px floor. It says the text fits in a narrow sidebar, which a wider floor keeps true; no change.
- **Hidden sidebar.** `AppShell` unmounts the frame with `v-if`, so no zero-width measure can happen while it is hidden; unmounting sets the minimum back to the fallback.
- **Dev page limit.** The References tab could not be made through the dev page (a dynamic import of the store gave a second module instance), so its elements were added to the strip by hand and a resize was fired. The reactive path (`referencesState` to the minimum) is covered by `sidebarFrame.test.ts`.
- **Open (ISC-638).** The owner's look in the real window, with and without References.

## P9.1-T24: Outline bold

- **The `layout.ts:46` diagnostic is the editor's, not the code's.** `tsc --noEmit -p .` and `vue-tsc --noEmit` (what `pnpm check` runs) both report nothing for `layout.ts` and for the other editor-only diagnostic, `treeRestore.test.ts:80`. They use TypeScript 6.0.3, which is the only TypeScript installed, with `strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. The editor's service is another TypeScript version or an inferred project with other options; I did not find which. Line 46 is the signature of `rowStyle`, whose return type had `fontWeight?: string` and a conditional spread, the shape those options disagree on. `rowStyle` is rewritten here for the bold rule, so it now assigns `fontWeight` to a typed object and has no spread: a plain assignment with no spread for versions to disagree about, no `!` or cast. Whether the editor still flags the line is not verified: the LSP tool has no diagnostics call.
- **The rule is `boldLevels(headings)`,** a pure function in `layout.ts` that returns the set of bold levels: the lowest level used, plus the next level used when the lowest occurs exactly once. It counts headings of the lowest level, not rows on screen, so it does not depend on scrolling. `rowStyle(level, levels, bold)` takes the set; `OutlinePanel.vue` computes it next to `levels`.
- **The next level is the next one used.** One H2 with H4 and no H3 bolds H4 (the next level in the document), which follows the planned "the next level used". One step, never chained: one H1 with one H2 and H3 bolds H1 and H2 and not H3.
- **Old tests replaced.** "Top rank bold only when more than one level is present" and "bolds H2 when it is the top of H2 and H4" described the rule this task reverses. The sizes test of ISC-607 stays under its own name.
- **Not changed:** sizes, indent and the muted inks.
