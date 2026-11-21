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
