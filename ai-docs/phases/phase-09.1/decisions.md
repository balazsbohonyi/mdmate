# Phase 9.1 decisions

Deviations from `plan.md` and choices it left open. The same decisions are in the Decisions section of `ISA.md`.

## P9.1-T12: Ctrl+Tab cycles the tab-list menu

- **Palette run.** The Cycle Tabs commands run from the command palette have no key press, so there is no release to wait for. They switch to the next or previous tab at once, with no menu. The plan did not say.
- **Focus stays put.** The menu the cycle opens does not take focus: the keys that drive it (Tab, the arrows, Escape, Enter, the release of Ctrl) are read by the page, so the editor keeps its caret and CodeMirror never sees them. Committing puts the caret in the editor of the tab switched to.
- **Ways out.** Besides the release of Ctrl and Escape, the cycle ends with no switch when the window loses focus (a release that never arrives) and when another pane takes the focus. A click outside the menu cancels it too.
- **Open risk (ISC-604).** Whether WebView2 hands Ctrl+Tab to the page was not tried; `disable_browser_keys` is set but nothing has used this chord. The owner checks it in `pnpm tauri dev`.
