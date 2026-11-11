# Feature Ideas & Research

### Current Understanding & Guardrails

`mdmate` has a very clear identity: **Obsidian's inline live-preview** combined with **Sublime Text's speed, density, and workbench**, built for developers and writers working directly on folders and git repos.

To keep suggestions strictly aligned with `mdmate`'s philosophy, the ideas below:
1. **Exclude what is already planned** in Phases 7–10 (in-file find/replace, streaming folder search, the Rust outline panel, `settings.json`/`keybindings.json`/themes/portable mode, image paste/drop/resize, single-instance CLI).
2. **Respect `Out of Scope` in `ISA.md`** (no vaults, no `[[wikilinks]]`, no visual table editor that reformats untouched bytes, no multi-cursor, no PDF export/plugins/AI).
3. **Preserve architectural invariants**: byte-exact saves (`ISC-1`–`ISC-3`), `<16 ms` typing p95 (`ISC-7`), zero layout shifts when toggling caret reveal (`ISC-188`), and strict separation between Vue chrome and CodeMirror state (`ISC-13`).

---

## Part 1: Initial Feature Suggestions

### 1. Reading & Live Preview (Developer Ergonomics)

#### 1.1 One-Click "Copy Code" on Fenced Code Blocks *(Obsidian / GitHub / Typora)*
* **Problem:** Developers reading `README.md` files or runbooks constantly copy shell commands and snippets. Currently, clicking inside a fenced code block reveals the fences (`fencedCode` in `src/editor/livePreview/scan.ts`) and places the caret inside, requiring manual multi-line selection to avoid copying the ```` ``` ```` lines.
* **Suggestion:** Add a small copy action in the top-right header of `.cm-md-box-code` (next to the `data-box-label` language badge in `src/editor/livePreview/box.ts`) when hovered, plus a palette command `Copy Code Block at Caret`.
* **Why it fits:** It uses the existing container header space, causes zero height change (`ISC-188`), and copies only the inner code lines without moving the editor caret or revealing fences.

#### 1.2 GitHub Flavored Alerts / Callouts (`> [!NOTE]`, `> [!WARNING]`, etc.) *(GitHub / Obsidian)*
* **Problem:** GitHub callouts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) are now standard across developer documentation (including `mdmate`'s own docs). Currently `scanPreview` (`src/editor/livePreview/scan.ts`) styles all `Blockquote` lines with a single `.cm-md-quote` class.
* **Suggestion:** In `scanPreview` (`src/editor/livePreview/scan.ts`), detect when the first line of a `Blockquote` begins with `[!TYPE]`. When the caret is outside that line, apply a semantic line class (`.cm-md-callout-note`, `.cm-md-callout-warning`, etc.) coloring the quote bar and header via theme tokens.
* **Why it fits:** Purely inline `Decoration.line` + `Decoration.mark` over `visibleRanges`—no block widget, no height jump on caret enter/leave, and 100% standard GFM on disk.

#### 1.3 Heading & Code Block Folding *(Sublime Text / Obsidian / Zed)*
* **Problem:** Navigating 1,000+ line specs (like `ISA.md`) is much faster when you can temporarily collapse an `## H2` section or a long code block.
* **Suggestion:** Enable CodeMirror's `@codemirror/language` folding commands (`Fold Section` / `Unfold Section` / `Fold All Headings Level N` via shortcuts and palette), using ATX heading levels and fenced blocks as fold ranges.
* **Why it fits:** Ephemeral view state only (never touches disk bytes), and CM6 automatically unfolds a section if a search jump or link jump lands inside it.

---

### 2. Navigation & Keyboard Flow

#### 2.1 `Go to Heading...` in Quick Open (`Ctrl+P` then `@`, or `Ctrl+R`) *(Sublime Text / Zed)*
* **Problem:** Phase 7 (`P7-T3`) adds a persistent Outline sidebar panel backed by a Rust heading scanner. However, Sublime Text users rely heavily on `Ctrl+R` (or `@` in `Ctrl+P`) to fuzzy-jump to a heading in the current file without keeping a sidebar open.
* **Suggestion:** Add a `headings` mode to `PaletteHost.vue` (`src/features/palette/`) triggered by `Ctrl+R` (or typing `@` at the start of `Ctrl+P`), scored by `src/lib/fuzzy.ts` and jumping via `Follower.reveal`.
* **Why it fits:** Near-zero new code—it combines the lazy palette from `P6-T7` with the Rust heading scanner from `P7-T3`.

#### 2.2 Standard Markdown Link & Anchor Autocomplete (`[text](` and `#`) *(Obsidian / Marksman LSP)*
* **Problem:** `mdmate` intentionally rejects `[[wikilinks]]` in favor of standard relative Markdown links (`[plan](../phases/phase-06/plan.md#p6-t4-link-scanner)`). However, typing relative `../` paths and `#heading-slugs` from memory is friction-heavy.
* **Suggestion:** When typing inside `](...)` in a Markdown link, offer a lightweight autocomplete dropdown:
  * After `](`, suggest relative file paths computed from the Rust file index (`workspace/quick.rs`) relative to the active document's folder.
  * After `#`, suggest heading slugs (using `src/editor/headingSlug.ts` / `P7-T3` outline scan) from the target document (or current document for `[text](#...)`).
* **Why it fits:** Gives `mdmate` the effortless linking speed of Obsidian while producing 100% portable, standard CommonMark/GFM links.

#### 2.3 `Ctrl+Alt+Click` (or `Ctrl+Shift+Click`) to Open Link in a Split Pane *(Obsidian / Zed)*
* **Problem:** `src/editor/links.ts` currently supports `Ctrl+Click` to follow a link in the active pane. When cross-referencing two docs (e.g., reading a plan while checking claims in `ISA.md`), users have to open the link and then manually drag the tab to split.
* **Suggestion:** Allow `Ctrl+Alt+Click` (or `Ctrl+Shift+Click`) on a followable internal link to open the target in a pane to the right (splitting if only one pane exists, or using the adjacent pane).

---

### 3. Fast Markdown Authoring & Editing

#### 3.1 Keyboard Task Toggle (`Ctrl+L` or `Ctrl+Enter`) *(Obsidian / Typora)*
* **Problem:** Clicking a task checkbox toggles `[ ]` ↔ `[x]` (`src/editor/livePreview/checkbox.ts`), and pressing `Enter` on a task line continues the task list (`ISC-91`), but there is no keyboard command in `src/editor/format.ts` or `src/workbench/defaultCommands.ts` to toggle a checkbox from the keyboard.
* **Suggestion:** Add a `Toggle Task Checkbox` command (`Mod+L` or `Mod+Enter`) in `src/editor/format.ts` that toggles `[ ]` ↔ `[x]` on the current line (changing 1 byte), or converts a plain list item `- item` into `- [ ] item`.

#### 3.2 `Tab` / `Shift+Tab` Cell Jumping in Revealed Table Source *(Typora / Obsidian)*
* **Problem:** Visual table editing is out of scope (`ISA.md`) so `mdmate` never rewrites untouched table formatting. However, once the caret enters a table and reveals its raw pipe source (`ISC-65`), pressing `Tab` inserts a literal `\t` character (`tabKeys` in `src/editor/create.ts`).
* **Suggestion:** In the same way `src/editor/lists.ts` overrides `Tab` inside a list, add a small keybinding active only when the caret is inside a GFM `Table` syntax node: `Tab` moves the selection to the next cell's text (between `|` pipes), and `Shift+Tab` moves to the previous cell—**without** reformatting or modifying any bytes in the table.

#### 3.3 Themed Editor Context Menu *(Follow-up to `ISC-251`)*
* **Problem:** In Phase 6 UAT round 3 (`ISC-251`, noted in `ai-docs/phases/phase-06/decisions.md`), the native WebView2 right-click menu was blocked everywhere—including on editor text—to prevent "Inspect" from showing. Right-clicking in the editor currently does nothing.
* **Suggestion:** Add a compact, themed shadcn context menu on the editor view containing `Cut`, `Copy`, `Paste`, formatting toggles (`Bold`, `Italic`, `Inline Code`, `Insert Link`), and—when right-clicking over a link—`Follow Link` and `Copy Link Target`.

#### 3.4 Smart HTML-to-Markdown Paste *(Typora / Obsidian)*
* **Problem:** `src/editor/paste.ts` currently handles pasting a URL over selected text (`ISC-95`). Pasting copied content from a browser (GitHub tables, documentation pages, issue comments) pastes stripped plain text, losing links, inline code, bold spans, and lists.
* **Suggestion:** Parse `clipboardData.getData('text/html')` using an inert `DOMParser` (never touching live DOM or `innerHTML`, keeping `ISC-15` intact) and convert basic semantic tags (`<a href>`, `<strong>`, `<em>`, `<code>`, `<pre>`, `<ul>/<ol>`, `<table>`) into clean Markdown on `Ctrl+V`, while `Ctrl+Shift+V` pastes plain text.

---

### 4. Status Bar & Workspace Polish

#### 4.1 Sublime-Style Status Bar Metadata (Line/Col, Word Count, Encoding, EOL) *(Sublime Text / iA Writer)*
* **Problem:** `src/shell/StatusBar.vue` currently displays only the file path on the left. Meanwhile, `mdmate` tracks exact file encoding (`UTF-8`, `UTF-16 LE/BE`, BOM) and line endings (`LF`, `CRLF`, `Mixed`) in Rust and the master state, and writers frequently need word/character counts.
* **Suggestion:** On the right side of `src/shell/StatusBar.vue`, display compact, read-only indicators for the active tab:
  * Caret position (`Ln 42, Col 8`, or `N chars / M words selected` when a selection is active)
  * Word count (`1,420 words`)
  * Line ending (`LF` / `CRLF` / `Mixed`) and Encoding (`UTF-8`)
* **Why it fits:** Surfaces `mdmate`'s byte-exact guarantees directly in the UI with zero visual clutter.

#### 4.2 Auto-Updating "Backlinks" Pin & Workspace Link Health in References Panel *(Obsidian)*
* **Problem:** `Find File References` (`Shift+F12`, `src-tauri/src/links/references.rs`) already scans the workspace in ~20 ms (after `ISC-253`), but the References panel is currently a one-off snapshot.
* **Suggestion:**
  1. Add a small "Follow active tab" toggle in the References panel header so it automatically refreshes when switching tabs—turning it into a zero-config **Backlinks** panel.
  2. Add a command `Check Workspace Links` that runs `src-tauri/src/links/scan.rs` across all workspace Markdown files and lists any broken relative links in the References panel.
* **Why it fits:** Reuses the Rust scanner and sidebar UI already built in Phase 6 to solve one of the biggest pain points in multi-file Markdown repos (broken documentation links).

### Summary Matrix (Part 1)

| Feature | Primary Benefit | Architectural Touchpoints | Effort |
| :--- | :--- | :--- | :--- |
| **Status Bar Metadata** (`Ln/Col`, Words, EOL, Encoding) | Usability & Trust | `src/shell/StatusBar.vue`, `src/documents/meta.ts` | Low |
| **Fenced Code "Copy" Button** | Reading / DX | `src/editor/livePreview/box.ts`, `src/editor/livePreview/scan.ts` | Low |
| **Toggle Task Shortcut** (`Mod+L` / `Mod+Enter`) | Editing Speed | `src/editor/format.ts`, `src/workbench/defaultCommands.ts` | Low |
| **`Go to Heading` in Palette** (`Ctrl+R` / `@`) | Navigation Speed | `src/features/palette/PaletteHost.vue` + Phase 7 outline scan | Low |
| **GitHub Callouts** (`> [!NOTE]`) | Reading Polish | `src/editor/livePreview/scan.ts`, theme tokens | Low–Med |
| **Table `Tab` / `Shift+Tab` Cell Jump** | Editing Ergonomics | `src/editor/` keymap (when inside `Table` node) | Low–Med |
| **Editor Right-Click Context Menu** | Usability (`ISC-251` follow-up) | `src/workbench/` / shadcn `ContextMenu` | Med |
| **Link & `#heading` Autocomplete** | Authoring DX | `src-tauri/src/workspace/quick.rs`, CM6 autocomplete | Med |

---

## Part 2: 12 Additional Speed-Focused Ideas

Drawn from how developers work in **Sublime Text (`MarkdownEditing`)**, **VS Code (`Markdown All in One`)**, **Marksman LSP**, **Zed**, **Neovim (`render-markdown.nvim`)**, and **Obsidian**, tailored specifically to `mdmate`'s existing Rust + CodeMirror 6 architecture.

---

### 1. Instant Keyboard Tab & Split-Pane Cycling *(Sublime Text / Zed)*
* **The Speed Bottleneck:** Looking at `src/workbench/defaultCommands.ts`, `mdmate` has keyboard shortcuts to create splits (`Alt+Shift+2`, `Alt+Shift+8`) and close tabs (`Mod+W`), but **no shortcuts to switch tabs or jump focus between split panes** without touching the mouse or re-opening `Ctrl+P`.
* **The Feature:**
  * **`Ctrl+Tab` / `Ctrl+Shift+Tab`**: Toggle immediately between the two most recently used tabs (MRU), plus `Ctrl+PageDown` / `Ctrl+PageUp` for next/previous tab in strip order.
  * **`Ctrl+1`..`Ctrl+4`** (Sublime style) or **`Alt+1`..`Alt+9`**: Jump focus directly between split panes (or tabs in the active strip).
* **Why it fits:** Tab switching already runs at ~17 ms p95 (`ISC-6`), so keyboard cycling makes side-by-side editing in split panes 100% mouse-free.

---

### 2. Implicit Word-Under-Caret Formatting (No Selection Needed) *(Sublime Text / Zed / VS Code)*
* **The Speed Bottleneck:** In `toggleInline` (`src/editor/format.ts`), if your caret is inside a word (`foo|bar`) with nothing selected and you press `Ctrl+B` or `Ctrl+\``, it inserts empty markers mid-word (`foo**|**bar` or ``foo`|`bar``). To bold or code-format a word you just typed or landed on, you currently have to select it first (`Ctrl+D` or `Ctrl+Shift+Left`) and then format.
* **The Feature:** When `range.empty` is true in `toggleInline` and `insertLink` (`src/editor/format.ts`), check `state.wordAt(range.head)`:
  * If the caret is inside or at the end of a word, wrap that word (`**foobar**`, `` `foobar` ``, `[foobar](|)`) and keep the caret at its relative offset.
  * Only insert empty `****` when the caret is on whitespace or an empty line.
* **Why it fits:** Cuts formatting keystrokes in half during fast typing and editing.

---

### 3. Wrap Selection on Typing `*`, `` ` ``, `~`, `[`, `(` *(Sublime Text `MarkdownEditing`)*
* **The Speed Bottleneck:** Developers accustomed to Sublime Text and VS Code select a phrase and press `` ` `` (to wrap in inline code), `[` (to start a link), or `*` (to italicize/bold). Currently, pressing any of those keys overwrites the selected text with a single character.
* **The Feature:** A tiny CM6 `EditorView.inputHandler` that, when a non-empty selection exists, wraps the selection when typing `` ` ``, `*`, `_`, `~`, `[`, or `(` (and keeps the inner text selected so pressing `*` twice yields `**selection**`).

---

### 4. `Ctrl+Click` Links Directly Inside Rendered Tables *(Obsidian / Typora)*
* **The Speed Bottleneck:** In `TableWidget` (`src/editor/livePreview/blocks/widgets.ts`) and `followableElement` (`src/editor/links.ts`), links inside rendered GFM tables are styled with `.cm-md-link`, **but `Ctrl+Click` is ignored on them**. Clicking a link in a rendered table first collapses the table to raw Markdown source and places the caret in the cell, requiring a second `Ctrl+Click` to actually follow the link. Developer docs (like `ai-docs/tasks.md` and `ISA.md`) put dozens of links inside tables.
* **The Feature:** Attach `data-href` to `<span class="cm-md-link">` in `appendRuns` (`src/editor/livePreview/blocks/widgets.ts`) and, inside `TableWidget`'s `mousedown` handler, if `isFollowGesture(event)` is true over `.cm-md-link[data-href]`, invoke `followLink` directly without unrendering the table. Plain clicks still enter cell source as today.

---

### 5. Heading Rename Refactoring (`F2` on a Heading Rewrites `#anchor` Links) *(Marksman LSP / Obsidian)*
* **The Speed Bottleneck:** Phase 6's rewrite engine (`src-tauri/src/links/rewrite.rs`) guarantees that renaming a file updates every link across the workspace (`ISC-113`), preserving `#anchor` suffixes (`ISC-120`). However, renaming a **heading** (e.g., changing `## P6-T4: Link scanner` to `## P6-T4: Fast scanner`) silently breaks every `[link](plan.md#p6-t4-link-scanner)` and same-file `[link](#p6-t4-link-scanner)` in the repo.
* **The Feature:** When the caret is on an ATX heading line and the user runs `Rename Heading...` (or presses `F2` in the editor), compute the old and new GitHub slugs (`githubSlug` in `src/editor/headingSlug.ts`) and run the existing Rust workspace link scanner (`src-tauri/src/links/scan.rs`) to rewrite only the `#fragment` span of links pointing to that file + heading.
* **Why it fits:** Reuses 90% of the Phase 6 rewrite pipeline (`rewrite_plan` / `rewrite_move`, ~20 ms scan time) and keeps byte-exactness outside the `#anchor` span.

---

### 6. Broken `#anchor` Validation in `brokenLinks.ts` *(Marksman LSP / VS Code)*
* **The Speed Bottleneck:** Currently `isLocalTarget` (`src/editor/brokenLinks.ts`) explicitly skips `#anchor` links (`if (target.startsWith('#')) return false`), and Rust's `check_links` only checks whether the target *file* exists on disk—not whether `#heading-slug` actually exists inside the target file.
* **The Feature:**
  1. For same-file `#fragment` links in `visibleRanges`, check against `headingAnchors(doc)` (`src/editor/headingSlug.ts`).
  2. For cross-file `file.md#fragment` links, have Rust's background `check_links` verify the heading slug in the target file and return a distinct tooltip (`"Missing heading #..."` vs `"Missing file"`).

---

### 7. `Ctrl+Click` a Broken Relative `.md` Link to Create It *(Obsidian / Marksman / Zed)*
* **The Speed Bottleneck:** Developers writing RFCs or design docs naturally write links to files before creating them (`See [Architecture](./arch.md)`). Right now `followableElement` (`src/editor/links.ts`) blocks `Ctrl+Click` on `.cm-md-link-broken`. You have to switch to the sidebar, find the parent folder, create the file, type the exact name, and open it.
* **The Feature:** When `Ctrl+Click` lands on a broken relative `.md` link that resolves inside an open workspace root, prompt in the pane banner (`Create "./arch.md"? [Create] [Cancel]`)—or immediately create and open the file in a new tab.

---

### 8. Workspace-Wide Heading Jump (`#` Prefix in `Ctrl+P`, or `Ctrl+T`) *(Sublime Text `Goto Symbol in Project`)*
* **The Speed Bottleneck:** In a multi-file documentation repo, you often know the section name (`Hot exit`, `Link guard`, `P6-T5`) but not which `.md` file contains it. Folder search (`Ctrl+Shift+F`) floods you with every prose occurrence instead of just headings.
* **The Feature:** Because Rust walks all Markdown files in a workspace in ~20 ms (`ISC-253`), add a `#` prefix mode to `Ctrl+P` (or `Ctrl+T` / `Go to Heading in Workspace...`) that fuzzy-matches headings across all workspace `.md` files and opens the matching file directly at that heading line.

---

### 9. Structural Move: Move List Item (with Children) or Section Up/Down (`Alt+Up` / `Alt+Down`) *(Obsidian Outliner / Org-mode)*
* **The Speed Bottleneck:** Moving a single line up/down breaks multi-line list items, nested sub-lists, and heading sections.
* **The Feature:** Context-aware `Move Up` / `Move Down` commands:
  * **On a list item line:** Uses `itemOnLine` (`src/editor/lists.ts`) to swap the entire `ListItem` node (including all indented child items) with the previous/next sibling `ListItem`.
  * **On a heading line:** Swaps the entire heading section (down to the next heading of equal or higher level) with the adjacent sibling section.
* **Why it fits:** Because `mdmate`'s master line-ending state field (`ai-docs/architecture/architecture.md`) already detects moves by their transaction shape (one deletion + one insertion of identical text), original line endings are preserved automatically.

---

### 10. Copy Link to Heading (`path/file.md#slug`) *(GitHub / Obsidian)*
* **The Speed Bottleneck:** Citing a section of one document inside another requires copying the relative path, adding `#`, and manually converting the heading text to GitHub's slug rules.
* **The Feature:** A command `Copy Link to Heading` (in the Command Palette when the caret is inside a section, and in the Phase 7 Outline panel context menu) that uses `githubSlug` (`src/editor/headingSlug.ts`) and `copyRelativePath` (`src/workbench/tabMenu.ts`) to copy `[Heading Text](relative/path.md#slug)` to the clipboard in one action.

---

### 11. Fenced Code Block Auto-Close & Language Completion *(VS Code / Zed)*
* **The Speed Bottleneck:** `src/editor/codeLanguages.ts` already maps fence language names and extensions to lazy-loaded CM6 parsers (`ISC-71`). However, typing ```` ```ts ```` and pressing `Enter` leaves the code block unclosed until you manually type the closing ```` ``` ````—meaning every line below it in the document temporarily reparses as TypeScript code!
* **The Feature:**
  1. Pressing `Enter` after an opening fence line ```` ```lang ```` (when no closing fence exists for that block) automatically inserts `\n\n``` ` with the caret on the middle line.
  2. This not only saves keystrokes, it **prevents whole-document reparse spikes** in large files while typing a new code block.

---

### 12. Blockquote & Callout Continuation on `Enter` *(Sublime Text `MarkdownEditing` / VS Code)*
* **The Speed Bottleneck:** `src/editor/lists.ts` makes `Enter` continue a list and `Enter` on an empty list item exit the list (`ISC-90`, `ISC-92`). Look at blockquotes (`> text`): pressing `Enter` on an empty `>` line in standard `@codemirror/lang-markdown` vs continuing multi-line quotes or nested `> >` quotes should behave identically to lists.
* **The Feature:** Extend `continueList` (`src/editor/lists.ts`) so that pressing `Enter` inside a `Blockquote` continues the `> ` prefix, and pressing `Enter` on an empty `> ` line strips the marker and exits the blockquote cleanly.

---

### Summary Matrix (Part 2)

| # | Feature | Why It's Fast | Key Module to Extend |
| :--- | :--- | :--- | :--- |
| **1** | **`Ctrl+Tab` MRU & `Ctrl+1..4` Pane Focus** | Zero-mouse split/tab switching (<20 ms) | `src/workbench/defaultCommands.ts`, `src/workbench/store.ts` |
| **2** | **Implicit Word-Under-Caret Formatting** | Cuts `Ctrl+B` / `Ctrl+\`` / `Ctrl+K` keystrokes in half | `src/editor/format.ts` |
| **3** | **Selection Wrapping (`*`, `` ` ``, `[`, `(`)** | Instant inline wrapping without shortcuts | `src/editor/` `inputHandler` |
| **4** | **`Ctrl+Click` Links Inside Rendered Tables** | 1-click navigation instead of 2-step table reveal | `src/editor/livePreview/blocks/widgets.ts`, `src/editor/links.ts` |
| **5** | **`F2` Heading Rename Rewrites `#anchors`** | Refactors section links across repo in ~20 ms | `src/editor/headingSlug.ts`, `src-tauri/src/links/rewrite.rs` |
| **6** | **Broken `#anchor` Link Highlighting** | Catches dead section links as you read/type | `src/editor/brokenLinks.ts`, `src/editor/headingSlug.ts` |
| **7** | **`Ctrl+Click` Broken `.md` Link to Create File** | Top-down spec writing without sidebar detours | `src/documents/links.ts` |
| **8** | **Workspace Heading Jump (`#` in `Ctrl+P`)** | Jump to any heading in 8,000 files in ~20 ms | `src/features/palette/PaletteHost.vue`, Rust heading scan |
| **9** | **Copy Link to Heading (`file.md#slug`)** | 1-action cross-doc link generation | `src/editor/headingSlug.ts`, `src/workbench/tabMenu.ts` |
| **10** | **Move List Item / Section Up & Down** | Reorders whole subtrees with EOL preservation | `src/editor/lists.ts` |
| **11** | **Auto-Close Fenced Code Blocks on `Enter`** | Saves typing & prevents whole-doc reparse spikes | `src/editor/` keymap |
| **12** | **Smart Blockquote Exit on Empty `Enter`** | Matches list ergonomics (`ISC-92`) for `>` quotes | `src/editor/lists.ts` |

---

## Part 3: 10 Speed and DX Ideas and 6 Differentiators

Filtered through an advisor review and checked against the code and against competing editors.

**Dropped after the advisor review:**
- **Table sort and row/column commands:** these are table editing, which is Out of Scope.
- **Git gutter and tree badges:** this needs a git dependency or shell-out, and VS Code and Obsidian Git already have it.
- **Diff-scoped formatting:** VS Code already does it ([`formatOnSaveMode: modifications`](https://tosbourn.com/configure-vs-code-to-only-format-changed-lines/), needs source control), and mdmate has no formatter.

### 10 ideas that make navigation or editing faster

| # | Idea | Why / what I checked | Effort |
|---|---|---|---|
| 1 | Quick Open matches the first H1 or frontmatter title | Many files are called `index.md` or `README.md`. Today the index is paths only (`quick.rs`), so this needs the P7-T3 heading index to avoid reading files. | Med |
| 2 | Task palette: every unchecked `- [ ]` in the workspace, Enter jumps, a key toggles it | Your specs are checklist-heavy. It reuses the Rust walk, which now takes about 20 ms. | Med |
| 3 | Hover peek: modifier plus hover on a link shows the target section, with no navigation | Page Preview in Obsidian does the same, so this is not a differentiator. | Med |
| 4 | Drag a tree row into the editor to insert a relative link, or `![]()` for images | The tree drag is custom pointer code, not HTML5 drag (`textDrag.ts` is the precedent), and P9-T2 covers only Explorer drops. So this is new behaviour. | Med |
| 5 | Promote/Demote a heading together with its subtree | The shortcut needs checking: CodeMirror's default keymap binds Shift-Alt-Arrow. | Low–Med |
| 6 | Next/Previous file in the folder | For numbered series like `phase-01` or ADRs. | Low |
| 7 | Expand selection by structure (word, sentence, list item, section) | CodeMirror's `selectParentSyntax` is already in its default keymap on Mod-i, which mdmate filters out for italic (`create.ts`). Binding it to a free key is one line. | Low |
| 8 | Per-file bookmarks: toggle, next, previous, list in the palette | Kept in app data, so no file bytes change. | Low–Med |
| 9 | Resume caret and scroll per file across restarts | A known gap (`untested.md` row 50). Folds only after idea 1.3 lands. | Low |
| 10 | Extract a selection or section to a new file, leaving a link | Obsidian has [Note Composer](https://obsidian.md/help/plugins/note-composer), but links into an extracted heading [reportedly break](https://forum.obsidian.md/t/note-composer-links-to-blocks-and-headers-of-the-source-note-should-be-updated-if-extracted/37534). Your rewrite engine could fix them. | Med |

### 6 differentiators built on your byte-exact state and link engine

| # | Idea | What I found |
|---|---|---|
| A | **Rebase relative links on paste.** Paste a block with relative links or images into a file in another folder and the paths are rewritten so they still resolve. | Strongest. I found no editor that does it, only feature requests in [Obsidian](https://forum.obsidian.md/t/update-relative-paths-in-markdown-style-hyperlinks-when-cutting-and-pasting/47165) and [VS Code](https://lightrun.com/answers/yzhang-gh-vscode-markdown-copypaste-that-ensures-correct-relative-links). |
| B | **Git-free "changed since open" gutter plus a one-key diff vs the file on disk.** | The byte-exact promise made visible. [Markdown Monster and LiveMarkDownEditor](https://markdownmonster.west-wind.com/docs/Common-Tasks/File-Change-Detection-in-the-Editor.html) have a similar diff. I found none in Typora, MarkText or Zettlr. |
| C | **Three-way merge when the disk changes under a dirty tab.** | Typora and Zettlr [lose your edits](https://forum.zettlr.com/d/76-undo-to-revert-changes-of-when-a-file-was-loaded-after-external-changes) on the reload prompt per users' reports. SideMark has a 3-way merge. This fits your never-lose-work story. |
| D | **Move a section to another file with every inbound `#anchor` and link rewritten.** | An extension of idea 10. I did not search for competitors. |
| E | **Quick Open ranks by link proximity**, so files the current doc links to or from come first. | Cheap with the scanner. I did not search for competitors. |
| F | **Orphan report:** files nobody links to. | One line on top of the scanner. I did not search for competitors. |

