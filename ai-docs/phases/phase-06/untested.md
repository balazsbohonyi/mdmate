# Phase 6: what was not tested, and how to test it later

Everything below was skipped on purpose or could not be done in the Phase 6 runs. Each entry says why, and how to check it when there is time. The decisions behind them are in [decisions.md](decisions.md).

| # | Gap | Why it was skipped | How to test it |
|---|---|---|---|
| 1 | The native folder picker behind Open Folder (ISC-192) | The dialog opens from a real Ctrl+Shift+O, but I could not drive it safely: keystrokes from a script go to whichever window has focus, and twice they did not reach the dialog. Rust's grant and the page's handling of the answer are both tested; only the picker itself in the middle is by hand. | In the app press Ctrl+Shift+O, choose a folder, and see it appear in the sidebar; restart and see it come back. Also try Cancel (nothing changes) and a folder on a network drive (refused with a message). |
| 2 | Drop positions at 125% display scale | The real drops ran at 100% (`devicePixelRatio` 1). `toCssPosition` is unit-tested, but a wrong ratio would only show as a drop landing a row off on the tree. | On the laptop screen at 125%, drag a folder from Explorer onto the sidebar's empty area and onto a tree row, and see that the first becomes a root and the second does not. |
| 3 | Network and removable drives as roots | Only local temp folders were used. | Open a folder on a mapped network drive and on a USB stick; see the listing, then pull the stick out and see the tree report the folder instead of crashing. |
| 4 | A symlink or junction inside a root that points outside it | The tree counts a symlink to a folder as a folder and `Access` resolves it before checking, but no test builds one. | Make a junction in a root to a folder outside it, open the junction in the tree, and see that listing is refused with `not-allowed`. |
| 5 | Very deep trees and long names | The 10,000-entry case is one flat folder. | Open a folder with 15 levels and names near 255 characters; check that indentation and the truncated names stay readable. |
| 6 | The watcher after the folder itself is deleted or renamed while open | The folder's own row goes when its parent is listed again, but no real run deleted an open folder. | Open a folder in the tree, delete it in Explorer, and see its row go and nothing report an error. |
| 7 | The macOS and Linux tree | CI compiles them; nothing ran. The path keyer assumes case-insensitive file systems everywhere except Linux. | Open a folder on macOS (case-insensitive by default) and on a case-sensitive volume, and open two folders that differ only in case. |
