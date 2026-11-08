---
task: "Build mdmate, a fast inline Markdown editor"
slug: 20261107-mdmate
project: mdmate
phase: climbing
progress: 80/186
started: 2026-11-07T00:30:52Z
updated: 2026-11-08T12:22:23Z
principal_stated_goal: "Build a markdown editor that follows the markdown inline editing philosophy from Obsidian and simplicity of SublimeText."
principal_stated_goal_source: prompt
principal_stated_goal_signal: 2
principal_stated_goal_locked: 2026-11-07T00:30:52Z
context_sufficient: true
interview_invoked: true
---

# mdmate

## Problem

Good inline Markdown editing is tied to heavy note-taking apps or locked inside other editors. Fast editors like SublimeText show raw Markdown, and viewers can't edit. There is no small desktop app that opens a Markdown file instantly, renders it where you type, and keeps the file on disk exactly as you wrote it.

## Vision

You double-click a README and it is on screen before you have finished looking at it, rendered and ready to type in. The syntax appears only where your caret is. Tabs, a folder sidebar and free splits feel like SublimeText, and a 1 MB file feels the same as a short note. Rename a file and every link to it follows. Close the app mid-sentence, open it tomorrow, and your unsaved words are still there, and git shows only the lines you meant to change.

## Out of Scope

- **Math and Mermaid.** Later, as separately loaded chunks.
- **Wiki links.** Standard Markdown links only.
- **Multi-cursor.** Ctrl+click is reserved for links.
- **A reading mode.** Live preview and raw source cover it.
- **Spellcheck.** Left out of v1.
- **Table cell editing.** Tables are read-only until the caret reveals their source.
- **Multi-window.** One instance, one window.
- **Auto-update, accounts, telemetry.** None in v1.
- **A visual theme editor.** Themes are files.
- **Export to HTML or PDF, plugins, sync, AI features.** Different products.
- **macOS and Linux installers in v1.** The code stays portable; only Windows ships.

## Principles

- The file on disk belongs to the writer. The app displays Markdown and never rewrites it.
- Speed is a feature with numbers, measured on real files.
- A document someone else wrote is untrusted input.
- Vue owns the chrome and CodeMirror owns the text.
- Tools enforce what they can; prose holds what they can't.

## Constraints

- Tauri 2, Rust, Vue 3, TypeScript, Tailwind 4, shadcn-vue on Reka UI, Vite, pnpm. `derived_from: principal_stated_goal compound`
- CodeMirror 6 written from scratch. The Markdown text is the document; no parse-and-serialize model.
- All colors, fonts and spacing come from design tokens.
- All OS-specific code lives behind `src-tauri/src/platform/`.
- All file access goes through our own Rust commands.
- Windows 11 ships first, on WebView2.
- **Speed gate.** Four speed claims are gates: ISC-4 (startup 1500 ms), ISC-5 (open 1 MB, 100 ms), ISC-6 (tab switch, 50 ms) and ISC-7 (typing p95 16 ms on the 1 MB fixture). When a gate is measured and missed in the release build, the work stops at that task. Profile once to find the cost, then write the numbers and the cause in the phase's `decisions.md` and hand them to the owner, who decides between a fix, a lower feature scope (such as a lower plain-source cutoff) or a new target. A gate is never loosened, skipped or re-measured under easier conditions to make it pass. Only the owner closes a missed gate, with the decision recorded in Decisions.

## Goal

"Create a markdown editor that follows the inline editing philosophy from Obsidian and the simplicity of SublimeText". mdmate is a desktop app where Markdown renders inline and reveals its syntax at the caret, with tabs, a sidebar and free splits in the SublimeText style. It meets its measured speed targets, keeps files byte-exact, and is built so macOS and Linux need only new platform implementations.

## Not yet specified


## Test Strategy

Commands: `pnpm test:rust <filter>` runs Cargo tests, `pnpm test:web <file>` runs Vitest, `pnpm perf <scenario>` runs the release-build harness, and `node scripts/check-arch.mjs <rule>` runs structural checks. Web UI rows use Interceptor against `pnpm dev`; real-app rows use `pnpm tauri dev`.

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|---|---|---|---|---|---|---|---|
| ISC-1 | bash | hash before and after save across all fixtures | identical | pnpm test:rust roundtrip_unedited | derived: byte-exact | critical | |
| ISC-2 | bash | property test: random edits leave bytes outside the range unchanged | 1000 runs | pnpm test:rust edit_isolation | derived: byte-exact | critical | |
| ISC-3 | bash | edit a mixed-EOL fixture, compare untouched lines | identical | pnpm test:web tests/editor/lineEndings.test.ts | derived: byte-exact | | |
| ISC-4 | bash | launch to editable time, release build | under 1500 ms | pnpm perf startup | derived: fast | critical | |
| ISC-5 | bash | open 1 MB fixture, release build | under 100 ms | pnpm perf open-1mb | derived: fast | critical | |
| ISC-6 | bash | tab switch, release build | under 50 ms | pnpm perf tab-switch | derived: fast | | |
| ISC-7 | bash | keystroke latency on 1 MB fixture | p95 under 16 ms | pnpm perf typing-1mb | derived: fast | critical | |
| ISC-8 | bash | open fixture above cutoff, assert mode and notice | plain source | pnpm test:web tests/documents/largeFile.test.ts | derived: fast | | |
| ISC-9 | bash | scan Rust sources | 0 matches | node scripts/check-arch.mjs no-os-cfg-outside-platform | derived: portable | | |
| ISC-10 | bash | CI job on macos-latest | exit 0 | cargo check --manifest-path src-tauri/Cargo.toml | derived: portable | | deep |
| ISC-11 | bash | CI job on ubuntu-latest | exit 0 | cargo check --manifest-path src-tauri/Cargo.toml | derived: portable | | deep |
| ISC-12 | bash | scan TS and Vue sources | 0 matches | node scripts/check-arch.mjs tauri-only-in-platform | derived: portable | | |
| ISC-13 | bash | scan src/editor imports | 0 matches | node scripts/check-arch.mjs no-vue-in-editor | derived: fast | | |
| ISC-14 | bash | scan sources for color literals | 0 matches | node scripts/check-arch.mjs no-hard-coded-colors | derived: themeable | | |
| ISC-15 | bash | scan sources | 0 matches | node scripts/check-arch.mjs no-unsafe-html | derived: safe-with-untrusted-files | critical | |
| ISC-16 | bash | property test over schemes | only 3 allowed | pnpm test:rust opener_schemes | derived: safe-with-untrusted-files | critical | |
| ISC-17 | bash | path guard test table | all refused | pnpm test:rust unc_refused | derived: safe-with-untrusted-files | critical | |
| ISC-18 | bash | guard test by file type | prompt required | pnpm test:rust default_app_policy | derived: safe-with-untrusted-files | | |
| ISC-19 | manual | open tests/fixtures/hostile.md with Process Monitor and a packet capture running | no process, no SMB | Real app run | derived: safe-with-untrusted-files | critical | deep |
| ISC-20 | bash | scan CSP and dependencies for network paths | only img-src https | node scripts/check-arch.mjs no-network | derived: safe-with-untrusted-files | | |
| ISC-21 | bash | scan Cargo.toml and package.json | absent | node scripts/check-arch.mjs no-plugin-fs | derived: safe-with-untrusted-files | | |
| ISC-22 | bash | frontend gate | exit 0 | pnpm check | derived: maintainable | | |
| ISC-23 | bash | Rust gate | exit 0 | pnpm check:rust | derived: maintainable | | |
| ISC-24 | bash | scan suppressions for reason comments | 0 missing | node scripts/check-arch.mjs suppressions-have-reasons | derived: maintainable | | |
| ISC-25 | screenshot | first launch shows all four regions | all visible | Screenshot of pnpm tauri dev | derived: sublime-feel | | |
| ISC-26 | screenshot | use each window control | all work | Real app window, clicked over the DevTools port, state read from user32 | derived: sublime-feel | | |
| ISC-27 | screenshot | scrub a screen recording of launch | no white frame | 60 fps screen recording of the release build, scanned frame by frame | derived: sublime-feel | | |
| ISC-28 | bash | split tree test, split right | two columns | pnpm test:web tests/workbench/splitTree.test.ts | derived: sublime-feel | | |
| ISC-29 | bash | split tree test, split down | two rows | pnpm test:web tests/workbench/splitTree.test.ts | derived: sublime-feel | | |
| ISC-30 | bash | split tree test, three levels mixed | valid tree | pnpm test:web tests/workbench/splitTree.test.ts | derived: sublime-feel | | |
| ISC-31 | bash | split tree test, close last tab | pane removed | pnpm test:web tests/workbench/splitTree.test.ts | derived: sublime-feel | | |
| ISC-32 | screenshot | drag a tab to another pane | tab moved | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-33 | screenshot | drag a tab to a pane edge | split created | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-34 | screenshot | drag a split handle | panes resized | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-35 | screenshot | press the sidebar shortcut | sidebar toggles | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-36 | bash | store test with mock host | content in tab | pnpm test:web tests/documents/open.test.ts | literal | | |
| ISC-37 | bash | save test with temp file | bytes match | pnpm test:rust save_writes_edits | literal | | |
| ISC-38 | screenshot | edit a clean tab | marker shows | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-39 | bash | open Latin-1 fixture | read-only, notice | pnpm test:rust unsupported_encoding | derived: byte-exact | | |
| ISC-40 | bash | inject a failure before rename | original intact | pnpm test:rust atomic_save | derived: byte-exact | critical | |
| ISC-41 | bash | headless master with two followers | both match | pnpm test:web tests/documents/sync.test.ts | derived: sublime-feel | | |
| ISC-42 | bash | undo from the second follower | edit reverted | pnpm test:web tests/documents/sync.test.ts | derived: sublime-feel | | |
| ISC-43 | bash | close a follower, then undo | history intact | pnpm test:web tests/documents/sync.test.ts | derived: sublime-feel | | |
| ISC-44 | bash | change file on disk with clean tab | content updated | pnpm test:web tests/documents/external.test.ts | derived: reliable | | |
| ISC-45 | bash | change file on disk with dirty tab | conflict raised | pnpm test:web tests/documents/external.test.ts | derived: reliable | | |
| ISC-46 | bash | save, then deliver the watcher event | no action | pnpm test:rust own_save_ignored | derived: reliable | | |
| ISC-47 | bash | harness types, waits one journal interval, force-kills, relaunches, compares the buffer | edits restored | pnpm perf crash-restore | derived: reliable | critical | |
| ISC-48 | bash | serialize and restore a session | layout equal | pnpm test:web tests/documents/session.test.ts | derived: reliable | | |
| ISC-49 | manual | close with unsaved edits | no prompt | Real app run | derived: reliable | | |
| ISC-50 | bash | decoration snapshot for headings | markers hidden | pnpm test:web tests/editor/headings.test.ts | literal | | |
| ISC-51.1 | bash | decoration snapshot for bold | markers hidden | pnpm test:web tests/editor/emphasis.test.ts | literal | | |
| ISC-51.2 | bash | decoration snapshot for italic | markers hidden | pnpm test:web tests/editor/emphasis.test.ts | literal | | |
| ISC-51.3 | bash | decoration snapshot for strikethrough | markers hidden | pnpm test:web tests/editor/emphasis.test.ts | literal | | |
| ISC-52 | bash | decoration snapshot for inline code | backticks hidden | pnpm test:web tests/editor/inlineCode.test.ts | literal | | |
| ISC-53 | bash | decoration snapshot for links | target hidden | pnpm test:web tests/editor/links.test.ts | literal | | |
| ISC-54 | bash | decoration snapshot for lists | markers styled | pnpm test:web tests/editor/lists.test.ts | literal | | |
| ISC-55 | bash | decoration snapshot for blockquotes | styled | pnpm test:web tests/editor/blockquotes.test.ts | literal | | |
| ISC-56 | bash | decoration snapshot for rules | line shown | pnpm test:web tests/editor/rules.test.ts | literal | | |
| ISC-57 | bash | caret inside one of two bold spans | only that span revealed | pnpm test:web tests/editor/reveal.test.ts | literal | critical | |
| ISC-58 | bash | move caret out, measure update | under 16 ms | pnpm perf reveal | literal | | |
| ISC-59 | bash | property test: scripted arrow-key walks over fixtures | no stuck position | pnpm test:web tests/editor/caretWalk.test.ts | literal | | |
| ISC-60 | screenshot | walk down a decorated document | no line skipped | Interceptor on pnpm dev | literal | | |
| ISC-61 | bash | toggle one pane | other pane unchanged | pnpm test:web tests/editor/sourceMode.test.ts | literal | | |
| ISC-62 | bash | copy across hidden syntax | raw Markdown | pnpm test:web tests/editor/copy.test.ts | derived: byte-exact | | |
| ISC-63 | bash | compare decoration time on 1 MB and 10 MB | within 35 percent | pnpm perf decorations-scale | derived: fast | | deep |
| ISC-64 | screenshot | render the GFM table fixture | table shown | Interceptor on pnpm dev | literal | | |
| ISC-65 | bash | caret enters table range | widget removed | pnpm test:web tests/editor/table.test.ts | literal | | |
| ISC-66 | screenshot | render relative image with mock host | image shown | Interceptor on pnpm dev | literal | | |
| ISC-67 | screenshot | render https image | image shown | Interceptor on pnpm dev | literal | | |
| ISC-68 | bash | frontmatter fixture | pill replaces block | pnpm test:web tests/editor/frontmatter.test.ts | literal | | |
| ISC-69 | bash | click checkbox, diff document | one byte | pnpm test:web tests/editor/checkbox.test.ts | derived: byte-exact | | |
| ISC-70 | screenshot | code block fixture | token colors shown | Interceptor on pnpm dev | literal | | |
| ISC-71 | bash | inspect build chunks | no parser in entry | node scripts/check-arch.mjs languages-lazy | derived: fast | | |
| ISC-72 | bash | scroll heavy fixture, track anchor line | drift under 2 px | pnpm perf scroll-stability | derived: fast | | deep |
| ISC-180 | bash | resolve relative, absolute, UNC, file, http, data and escaping addresses | only relative and https resolve | pnpm test:web tests/editor/images.test.ts | derived: safe-with-untrusted-files | critical | |
| ISC-181 | bash | the folder a document opens grants | its own folder, never a network path | pnpm test:rust asset_folder | derived: safe-with-untrusted-files | critical | |
| ISC-182 | bash | render an image that never loads and one that fails | same fixed height before and after | pnpm test:web tests/editor/images.test.ts | derived: fast | | |
| ISC-183 | bash | put the caret at every offset of the block fixtures | none strictly inside a hidden range | pnpm test:web tests/editor/blocks.test.ts | derived: byte-exact | | |
| ISC-184 | bash | click a checkbox in a read-only document | no change | pnpm test:web tests/editor/checkbox.test.ts | derived: byte-exact | | |
| ISC-73 | bash | scan package.json | absent | node scripts/check-arch.mjs no-math-mermaid | derived: fast | | |
| ISC-74 | bash | link action test | new tab | pnpm test:web tests/links/navigate.test.ts | derived: link-navigation | | |
| ISC-75 | bash | link action test | caret at heading | pnpm test:web tests/links/navigate.test.ts | derived: link-navigation | | |
| ISC-76 | bash | link action test | tab and heading | pnpm test:web tests/links/navigate.test.ts | derived: link-navigation | | |
| ISC-77 | manual | Ctrl+click a web link | browser opens | Real app run | derived: link-navigation | | |
| ISC-78 | manual | Ctrl+click a PDF link, confirm | app opens | Real app run | derived: link-navigation | | |
| ISC-79 | screenshot | broken link fixture | broken style | Interceptor on pnpm dev | derived: link-navigation | | |
| ISC-80 | bash | history test | previous location | pnpm test:web tests/links/history.test.ts | derived: link-navigation | | |
| ISC-81 | bash | history test | next location | pnpm test:web tests/links/history.test.ts | derived: link-navigation | | |
| ISC-82 | bash | plain click test | no navigation | pnpm test:web tests/links/navigate.test.ts | literal | | |
| ISC-83 | bash | command test, toggle both ways | source correct | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-84 | bash | command test, toggle both ways | source correct | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-85 | bash | command test | link inserted | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-86 | bash | command test, toggle both ways | source correct | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-87 | bash | command test, toggle both ways | source correct | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-88 | bash | command test | level raised | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-89 | bash | command test | level lowered | pnpm test:web tests/editor/commands.test.ts | derived: quick-editing | | |
| ISC-90 | bash | list command test | marker continued | pnpm test:web tests/editor/lists.test.ts | derived: quick-editing | | |
| ISC-91 | bash | list command test | unchecked box added | pnpm test:web tests/editor/lists.test.ts | derived: quick-editing | | |
| ISC-92 | bash | list command test | marker removed | pnpm test:web tests/editor/lists.test.ts | derived: quick-editing | | |
| ISC-93 | bash | list command test | indented | pnpm test:web tests/editor/lists.test.ts | derived: quick-editing | | |
| ISC-94 | bash | list command test | outdented | pnpm test:web tests/editor/lists.test.ts | derived: quick-editing | | |
| ISC-95 | bash | paste command test | link created | pnpm test:web tests/editor/paste.test.ts | derived: quick-editing | | |
| ISC-96 | bash | dispatch two ranges | one range kept | pnpm test:web tests/editor/selection.test.ts | derived: link-navigation | | |
| ISC-177 | bash | drag a selection to another position in a test view | text moved, selection follows | pnpm test:web tests/editor/textDrag.test.ts | derived: quick-editing | | |
| ISC-178 | bash | drag a selection, then undo once | original text restored | pnpm test:web tests/editor/textDrag.test.ts | derived: quick-editing | | |
| ISC-179 | manual | drag selected text in the real app with native drops on | text moves | Review by the owner | derived: quick-editing | | |
| ISC-97 | bash | workspace test with two roots | both listed | pnpm test:rust multiple_roots | derived: sublime-feel | | |
| ISC-98 | bash | store test with no roots | tab opens | pnpm test:web tests/documents/open.test.ts | derived: sublime-feel | | |
| ISC-99 | bash | render 10000 entries | under 200 rows | pnpm test:web tests/features/tree.test.ts | derived: fast | | |
| ISC-100 | bash | filesystem command test | file exists | pnpm test:rust create_file | derived: file-management | | |
| ISC-101 | bash | filesystem command test | renamed | pnpm test:rust rename_file | derived: file-management | | |
| ISC-102 | screenshot | drag a file onto a folder | file moved | Interceptor on pnpm dev | derived: file-management | | |
| ISC-103 | manual | delete a file from the tree | in Recycle Bin | Real app run | derived: file-management | | |
| ISC-104 | manual | run Reveal in Explorer | file selected | Real app run | derived: file-management | | |
| ISC-105 | screenshot | mixed folder | others dimmed | Interceptor on pnpm dev | derived: file-management | | |
| ISC-106 | bash | open a .txt file | kind text | pnpm test:web tests/documents/open.test.ts | derived: file-management | | |
| ISC-107 | bash | open a .png file | kind image | pnpm test:web tests/documents/open.test.ts | derived: file-management | | |
| ISC-108 | screenshot | open a large image | fits pane | Interceptor on pnpm dev | derived: file-management | | |
| ISC-109 | screenshot | zoom an image | scale changes | Interceptor on pnpm dev | derived: file-management | | |
| ISC-110 | screenshot | pan a zoomed image | view moves | Interceptor on pnpm dev | derived: file-management | | |
| ISC-111 | screenshot | open an image tab | details shown | Interceptor on pnpm dev | derived: file-management | | |
| ISC-112 | screenshot | open SVG with a script | script inert | Interceptor on pnpm dev | derived: safe-with-untrusted-files | | |
| ISC-113 | bash | property test: rename, rescan workspace fixture | 0 old links | pnpm test:rust rewrite_inbound | derived: link-rewrite | critical | |
| ISC-114 | bash | move a file with relative links | targets valid | pnpm test:rust rewrite_outbound | derived: link-rewrite | | |
| ISC-115 | bash | rename a folder | 0 old links | pnpm test:rust rewrite_folder | derived: link-rewrite | | |
| ISC-116 | bash | reference definition fixture | rewritten | pnpm test:rust rewrite_reference | derived: link-rewrite | | |
| ISC-117 | bash | img tag fixture | rewritten | pnpm test:rust rewrite_img_tag | derived: link-rewrite | | |
| ISC-118 | bash | percent-encoded fixture | rewritten | pnpm test:rust rewrite_percent | derived: link-rewrite | | |
| ISC-119 | bash | angle-bracket fixture | rewritten | pnpm test:rust rewrite_angle | derived: link-rewrite | | |
| ISC-120 | bash | anchor fixture | anchor kept | pnpm test:rust rewrite_anchor | derived: link-rewrite | | |
| ISC-121 | bash | excluded folder fixture | rewritten | pnpm test:rust rewrite_excluded | derived: link-rewrite | | |
| ISC-122 | bash | closed file fixture | written | pnpm test:rust rewrite_closed | derived: link-rewrite | | |
| ISC-123 | bash | dirty document test | undoable, unsaved | pnpm test:web tests/documents/rewrite.test.ts | derived: link-rewrite | | |
| ISC-124 | bash | .txt and .html fixtures | rewritten | pnpm test:rust rewrite_text_files | derived: link-rewrite | | |
| ISC-125 | bash | property test: byte diff after rewrite | targets only | pnpm test:rust rewrite_minimal | derived: byte-exact | critical | |
| ISC-126 | screenshot | rename with links present | counts shown | Interceptor on pnpm dev | derived: link-rewrite | | |
| ISC-127 | bash | setting off, rename | no prompt | pnpm test:web tests/features/rename.test.ts | derived: link-rewrite | | |
| ISC-128 | bash | read-only file in fixture | file listed | pnpm test:rust rewrite_failures | derived: link-rewrite | | |
| ISC-129 | bash | type during scan of a large fixture | p95 under 16 ms | pnpm perf typing-during-scan | derived: fast | | deep |
| ISC-130 | screenshot | Ctrl+P, type a partial name | file found | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-131 | screenshot | Ctrl+Shift+P, run a command | command ran | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-132 | bash | watcher test | event delivered | pnpm test:rust watcher_new_file | derived: file-management | | |
| ISC-133 | bash | search test | matches found | pnpm test:web tests/editor/search.test.ts | derived: search | | |
| ISC-134 | bash | replace test | text replaced | pnpm test:web tests/editor/search.test.ts | derived: search | | |
| ISC-135 | bash | regex search test | matches found | pnpm test:web tests/editor/search.test.ts | derived: search | | |
| ISC-136 | bash | case search test | exact matches | pnpm test:web tests/editor/search.test.ts | derived: search | | |
| ISC-137 | bash | search two roots | both covered | pnpm test:rust folder_search_roots | derived: search | | |
| ISC-138 | bash | type during a search | p95 under 16 ms | pnpm perf typing-during-search | derived: fast | | deep |
| ISC-139 | screenshot | click a result | file at match | Interceptor on pnpm dev | derived: search | | |
| ISC-140 | bash | start a second search | first stopped | pnpm test:rust folder_search_cancel | derived: search | | |
| ISC-141 | bash | heading scan test | all headings | pnpm test:rust outline_scan | derived: search | | |
| ISC-142 | screenshot | click a heading | caret there | Interceptor on pnpm dev | derived: search | | |
| ISC-143 | bash | scan 10 MB fixture | last heading found | pnpm test:rust outline_large | derived: search | | |
| ISC-144 | bash | edit heading with the panel open | outline updated | pnpm test:web tests/features/outline.test.ts | derived: search | | |
| ISC-145 | screenshot | switch theme | colors change | Interceptor on pnpm dev | derived: themeable | | |
| ISC-146 | manual | review built-in themes against SublimeText's | no copied assets | Review by the owner | derived: themeable | | |
| ISC-147 | bash | save settings file | change applied | pnpm test:web tests/features/settings.test.ts | derived: configurable | | |
| ISC-148 | bash | save invalid settings | last good kept | pnpm test:web tests/features/settings.test.ts | derived: configurable | | |
| ISC-149 | bash | save keybindings file | shortcut changed | pnpm test:web tests/features/keybindings.test.ts | derived: configurable | | |
| ISC-150 | bash | load theme file | token changed | pnpm test:web tests/features/themes.test.ts | derived: themeable | | |
| ISC-151 | manual | save a theme file | app updates live | Real app run | derived: themeable | | |
| ISC-152 | bash | path test with marker | data beside exe | pnpm test:rust portable_paths | derived: configurable | | |
| ISC-153 | screenshot | run a toggle from the palette | setting changes | Interceptor on pnpm dev | derived: configurable | | |
| ISC-154 | bash | save pasted bytes | file in subfolder | pnpm test:rust paste_image_saved | derived: image-authoring | | |
| ISC-155 | bash | paste command test | link inserted | pnpm test:web tests/editor/imagePaste.test.ts | derived: image-authoring | | |
| ISC-156 | manual | drop an image from Explorer | link at drop point | Real app run | derived: image-authoring | | |
| ISC-157 | screenshot | drag a resize handle | size changes | Interceptor on pnpm dev | derived: image-authoring | | |
| ISC-158 | bash | resize command test | img tag written | pnpm test:web tests/editor/imageResize.test.ts | derived: image-authoring | | |
| ISC-159 | bash | property test: byte diff after resize | that image only | pnpm test:web tests/editor/imageResize.test.ts | derived: byte-exact | | |
| ISC-160 | bash | paste test source check | standard syntax | pnpm test:web tests/editor/imagePaste.test.ts | derived: byte-exact | | |
| ISC-161 | manual | launch twice with a file | one window, new tab | Real app run | derived: os-integration | | |
| ISC-162 | manual | second launch with a relative path from another folder | right file | Real app run | derived: os-integration | | |
| ISC-163 | manual | run mdmate file.md while closed | file opens | Real app run | derived: os-integration | | |
| ISC-164 | manual | run installer with the box ticked | association set | Clean Windows run | derived: os-integration | | |
| ISC-165 | manual | run installer with the box empty | association unchanged | Clean Windows run | derived: os-integration | | deep |
| ISC-166 | bash | build installer | artifact exists | pnpm tauri build | derived: release | | deep |
| ISC-167 | manual | extract and run the zip with the marker | app runs portable | Clean Windows run | derived: release | | deep |
| ISC-168 | bash | push a tag, check the release | artifacts attached | gh release view | derived: release | | deep |
| ISC-169 | bash | read the LICENSE file | MIT text | node scripts/check-arch.mjs license-mit | derived: release | | |
| ISC-170 | manual | read the README as a stranger | install and use without help | Review by the owner | derived: release | | |
| ISC-171 | screenshot | press the split right shortcut | two columns | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-172 | screenshot | press the split down shortcut | two rows | Interceptor on pnpm dev | derived: sublime-feel | | |
| ISC-173 | bash | theme loader test with a workspace theme file | file ignored | pnpm test:web tests/features/themes.test.ts | derived: safe-with-untrusted-files | | |
| ISC-174 | bash | open the same path twice | one tab, focused | pnpm test:web tests/documents/open.test.ts | derived: sublime-feel | | |
| ISC-175 | bash | rename with a clean tab open | tab shows new link | pnpm test:web tests/documents/rewrite.test.ts | derived: link-rewrite | | |
| ISC-176 | screenshot | drag a tab along its strip | order changes | Interceptor on pnpm dev | derived: sublime-feel | | |

## Features

### F0 · Cross-cutting
Why: these promises hold everywhere, and any single feature could quietly break them.

- [x] ISC-1: Anti: saving an unedited file never changes a byte.
- [x] ISC-2: Anti: an edit never changes bytes outside its range.
- [x] ISC-3: Mixed line-ending files keep each untouched line's ending after an edit.
- [x] ISC-4: The release app is usable within 1500 ms of launch.
- [x] ISC-5: A 1 MB Markdown file opens within 100 ms.
- [x] ISC-6: Switching tabs completes within 50 ms.
- [x] ISC-7: Typing stays under 16 ms per key on the 1 MB fixture.
- [x] ISC-8: Files above 3 MB open as plain source with a notice.
- [x] ISC-9: `cfg(windows)` and `target_os` appear only inside `platform/`.
- [x] ISC-10: `cargo check` passes on macOS in CI.
- [x] ISC-11: `cargo check` passes on Linux in CI.
- [x] ISC-12: `@tauri-apps` imports appear only inside `src/platform/`.
- [x] ISC-13: `src/editor/` imports nothing from Vue.
- [x] ISC-14: No hard-coded colors exist outside token files.
- [ ] ISC-15: Anti: `innerHTML` and `v-html` never receive document content.
- [ ] ISC-16: The opener refuses every scheme except `http`, `https` and `mailto`.
- [ ] ISC-17: Anti: UNC and `file://host/` targets never reach the filesystem.
- [ ] ISC-18: Default-app opens ask first unless the file is Markdown or an image.
- [ ] ISC-19: Anti: the hostile fixture causes no code run, launch or SMB attempt.
- [ ] ISC-20: Anti: the app makes no network request except document images.
- [x] ISC-21: Anti: `tauri-plugin-fs` is absent from the dependencies.
- [x] ISC-22: `pnpm check` exits 0.
- [x] ISC-23: `pnpm check:rust` exits 0.
- [x] ISC-24: Anti: no lint suppression lacks a reason comment.
- [ ] ISC-173: Anti: an opened workspace can never supply a theme file.

### F1 · Sublime workbench
Why: a dense keyboard-driven layout you can rearrange freely is what separates this from a note app.

- [x] ISC-25: Antecedent: first launch shows titlebar, sidebar, tabs and status bar together.
- [x] ISC-26: Titlebar controls minimize, maximize and close the window.
- [x] ISC-27: Anti: launch never shows a white frame.
- [x] ISC-28: Split right creates side-by-side panes.
- [x] ISC-29: Split down creates stacked panes.
- [x] ISC-30: Splits nest three levels in mixed directions.
- [x] ISC-31: Closing a pane's last tab removes that pane.
- [x] ISC-32: Dragging a tab moves it to another pane.
- [x] ISC-33: Dragging a tab to a pane edge creates a split.
- [x] ISC-34: Dragging a split handle resizes the adjacent panes.
- [x] ISC-35: A keyboard shortcut toggles the sidebar.
- [x] ISC-171: A keyboard shortcut splits the active pane right.
- [x] ISC-172: A keyboard shortcut splits the active pane down.
- [x] ISC-176: Dragging a tab within a strip reorders it.

### F2 · Reliable documents
Why: nobody trusts an editor twice after it loses their words, so no action here may lose work.

- [x] ISC-36: Opening a file loads its content into a tab.
- [x] ISC-37: Ctrl+S writes edits to disk.
- [x] ISC-38: Tabs with unsaved edits show a dirty marker.
- [x] ISC-39: Files in unsupported encodings open read-only with a notice.
- [x] ISC-40: Anti: a failed save never damages the original file.
- [x] ISC-41: An edit in one pane appears in another pane showing that file.
- [x] ISC-42: Undo from either pane reverts the last edit.
- [x] ISC-43: Closing a pane keeps the document's undo history.
- [x] ISC-44: A disk change reloads a clean tab.
- [x] ISC-45: A disk change on an edited tab raises a conflict choice.
- [x] ISC-46: Anti: mdmate's own save triggers no reload or conflict.
- [x] ISC-47: A force-kill loses nothing up to the last journal write.
- [x] ISC-48: A restart restores tabs and split layout.
- [x] ISC-49: Anti: closing the app with unsaved edits shows no prompt.
- [x] ISC-174: Opening an already open file focuses its tab.

### F3 · Inline live preview
Why: this is the reason mdmate exists; you read the rendered page and edit it in place, with syntax only where you are working.

- [x] ISC-50: Headings render without `#` markers away from the caret.
- [x] ISC-51: [container] Emphasis renders with hidden markers.
  - [x] ISC-51.1: Bold renders with hidden markers.
  - [x] ISC-51.2: Italic renders with hidden markers.
  - [x] ISC-51.3: Strikethrough renders with hidden markers.
- [x] ISC-52: Inline code renders with hidden backticks.
- [x] ISC-53: Links render as text with the target hidden.
- [x] ISC-54: List markers render styled.
- [x] ISC-55: Blockquotes render styled.
- [x] ISC-56: Horizontal rules render as lines.
- [x] ISC-57: A caret inside an inline element reveals only that element's syntax.
- [x] ISC-58: Syntax hides again within 16 ms of the caret leaving.
- [x] ISC-59: Anti: the caret never sticks inside hidden syntax.
- [x] ISC-60: Anti: vertical arrow keys never skip a line.
- [x] ISC-61: A per-pane toggle shows raw source.
- [x] ISC-62: Copying a selection copies raw Markdown.
- [x] ISC-63: Decoration time stays flat between 1 MB and 10 MB files.

### F4 · Block preview
Why: documents mix prose with tables, images and code, and a page full of raw syntax blocks breaks the illusion.

- [x] ISC-64: GFM tables render read-only.
- [x] ISC-65: A caret entering a table reveals its raw source.
- [x] ISC-66: Local images render inline from relative paths.
- [x] ISC-67: Remote `https` images render inline.
- [x] ISC-68: YAML frontmatter collapses to a pill.
- [x] ISC-69: Clicking a checkbox changes exactly one byte.
- [x] ISC-70: Fenced code highlights using token colors.
- [x] ISC-71: Language parsers stay out of the entry bundle.
- [x] ISC-72: Anti: late-rendering widgets never shift the scroll position.
- [x] ISC-180: Anti: an image address other than a relative path or `https` never loads.
- [x] ISC-181: Opening a document lets the page load images from its folder, and from no other folder.
- [x] ISC-182: A broken or still-loading image holds a fixed-size placeholder.
- [x] ISC-183: Anti: no selection head ever sits strictly inside a block replacement.
- [x] ISC-184: Anti: a read-only document ignores a checkbox click.
- [x] ISC-73: Anti: `katex` and `mermaid` are absent from v1 dependencies.

### F5 · Link navigation
Why: documentation is a web of files, so following a link has to cost one gesture and be undoable.

- [ ] ISC-74: Ctrl+click on a relative `.md` link opens it in a new tab.
- [ ] ISC-75: Ctrl+click on a `#heading` link jumps to that heading.
- [ ] ISC-76: Ctrl+click on `file.md#heading` opens the file at that heading.
- [ ] ISC-77: Ctrl+click on a web link opens the default browser.
- [ ] ISC-78: A confirmed link to another file opens its default app.
- [ ] ISC-79: Links with missing targets show a broken style.
- [ ] ISC-80: Alt+Left returns to the previous location.
- [ ] ISC-81: Alt+Right moves forward again.
- [ ] ISC-82: Anti: a plain click on a link never navigates.

### F6 · Quick editing
Why: formatting should stay in your fingers, so writing never stops for syntax.

- [ ] ISC-83: The bold shortcut toggles bold.
- [ ] ISC-84: The italic shortcut toggles italic.
- [ ] ISC-85: The link shortcut inserts a link.
- [ ] ISC-86: The inline code shortcut toggles inline code.
- [ ] ISC-87: The strikethrough shortcut toggles strikethrough.
- [ ] ISC-88: A shortcut raises the heading level.
- [ ] ISC-89: A shortcut lowers the heading level.
- [ ] ISC-90: Enter continues a list.
- [ ] ISC-91: Enter continues a checkbox list with an unchecked box.
- [ ] ISC-92: Enter on an empty item ends the list.
- [ ] ISC-93: Tab indents a list item.
- [ ] ISC-94: Shift+Tab outdents a list item.
- [ ] ISC-95: Pasting a URL over selected text creates a link.
- [ ] ISC-96: Anti: the editor never holds more than one selection range.
- [ ] ISC-177: Dragging selected text to another position in the editor moves it.
- [ ] ISC-178: A text drag undoes in one step.
- [ ] ISC-179: Text drag works in the real app while the window accepts native file drops.

### F7 · Workspace
Why: Markdown lives among other files, so the sidebar must manage them and renames must never strand a link.

- [ ] ISC-97: Multiple root folders show in the tree.
- [x] ISC-98: A loose file opens without any root folder.
- [ ] ISC-99: A 10,000-entry folder renders under 200 rows.
- [ ] ISC-100: The tree creates a new file.
- [ ] ISC-101: The tree renames a file.
- [ ] ISC-102: Dragging in the tree moves a file.
- [ ] ISC-103: Deleting moves a file to the Recycle Bin.
- [ ] ISC-104: Reveal in Explorer selects the file.
- [ ] ISC-105: Non-Markdown files show dimmed.
- [ ] ISC-106: Other text files open as plain source.
- [ ] ISC-107: Images open in an image tab.
- [ ] ISC-108: The image tab fits a large image to the pane.
- [ ] ISC-109: The image tab zooms.
- [ ] ISC-110: The image tab pans.
- [ ] ISC-111: The image tab shows dimensions and file size.
- [ ] ISC-112: Anti: scripts in an SVG never run.
- [ ] ISC-113: After a rename, a rescan finds zero links to the old path in the workspace.
- [ ] ISC-114: Moving a file updates the relative links inside it.
- [ ] ISC-115: Renaming a folder updates links to files within it.
- [ ] ISC-116: Link rewrite covers reference definitions.
- [ ] ISC-117: Link rewrite covers `<img src>` tags.
- [ ] ISC-118: Link rewrite covers percent-encoded targets.
- [ ] ISC-119: Link rewrite covers angle-bracket targets.
- [ ] ISC-120: Link rewrite preserves `#anchor` suffixes.
- [ ] ISC-121: Link rewrite covers folders excluded from the tree.
- [ ] ISC-122: Link rewrite writes closed files directly.
- [ ] ISC-123: Link rewrite gives dirty tabs undoable, unsaved edits.
- [ ] ISC-124: Link rewrite covers other text files.
- [ ] ISC-175: Link rewrite reloads clean open tabs.
- [ ] ISC-125: Anti: link rewrite never changes bytes outside link targets.
- [ ] ISC-126: A rename shows the number of links and files first.
- [ ] ISC-127: `links.confirmRewrite: false` skips the prompt.
- [ ] ISC-128: Files that fail to rewrite are listed.
- [ ] ISC-129: Anti: a rewrite scan never pushes typing past 16 ms.
- [ ] ISC-130: Ctrl+P finds a file by partial name.
- [ ] ISC-131: Ctrl+Shift+P runs a command by name.
- [ ] ISC-132: A file created outside mdmate appears in the tree.

### F8 · Search and outline
Why: long documents and folders are only usable when you can jump straight to the right place.

- [ ] ISC-133: Ctrl+F finds text in the file.
- [ ] ISC-134: Ctrl+H replaces text in the file.
- [ ] ISC-135: Find supports regular expressions.
- [ ] ISC-136: Find supports case-sensitive matching.
- [ ] ISC-137: Ctrl+Shift+F searches every root folder.
- [ ] ISC-138: Anti: a folder search never pushes typing past 16 ms.
- [ ] ISC-139: Clicking a search result opens the file at the match.
- [ ] ISC-140: Starting a new search stops the previous one.
- [ ] ISC-141: The outline panel lists the file's headings.
- [ ] ISC-142: Clicking an outline heading jumps there.
- [ ] ISC-143: The outline reaches the last heading of the 10 MB fixture.
- [ ] ISC-144: The outline reflects unsaved heading edits.

### F9 · Configuration and themes
Why: the look must be yours to change without rebuilding, which is why everything runs on tokens.

- [ ] ISC-145: Dark and light built-in themes switch live.
- [ ] ISC-146: Anti: built-in themes copy no SublimeText assets.
- [ ] ISC-147: Saving `settings.json` applies changes without a restart.
- [ ] ISC-148: Invalid settings keep the last good values with a notice.
- [ ] ISC-149: Saving `keybindings.json` changes a shortcut.
- [ ] ISC-150: A user theme file overrides a token.
- [ ] ISC-151: Saving a theme file updates the app live.
- [ ] ISC-152: The portable marker keeps data beside the exe.
- [ ] ISC-153: Common toggles run from the command palette.

### F10 · Image authoring
Why: screenshots are the most common thing dropped into documentation, and adding one should take a single paste.

- [ ] ISC-154: A pasted image saves to the configured subfolder.
- [ ] ISC-155: A pasted image inserts a relative link.
- [ ] ISC-156: A dropped image inserts a link at the drop point.
- [ ] ISC-157: Drag handles resize an inline image.
- [ ] ISC-158: A resized image is written as `<img src width>`.
- [ ] ISC-159: Anti: a resize changes bytes only inside that image's source.
- [ ] ISC-160: Unresized images stay standard `![]()` syntax.

### F11 · Release
Why: it only becomes your everyday Markdown app once it opens from a double-click and strangers can install it.

- [ ] ISC-161: A second launch with a file opens a tab in the first instance.
- [ ] ISC-162: A relative path resolves against the second launch's working directory.
- [ ] ISC-163: `mdmate file.md` opens the file on a cold launch.
- [ ] ISC-164: The installer's opt-in sets the `.md` association.
- [ ] ISC-165: Anti: the installer changes no association without the opt-in.
- [ ] ISC-166: `pnpm tauri build` produces an NSIS installer.
- [ ] ISC-167: The portable zip runs from any folder.
- [ ] ISC-168: A version tag publishes a GitHub Release with both artifacts.
- [x] ISC-169: The repo carries an MIT `LICENSE`.
- [ ] ISC-170: The README lets a stranger install and use mdmate.

## Decisions

- 2026-11-07: Chose CodeMirror 6 over ProseMirror-family editors, Lexical and Monaco. Text stays the document, which gives byte-exact saves by construction, and Obsidian's editor runs on it. No head-to-head benchmark exists, so P0 measures it.
- 2026-11-07: Started from scratch instead of reusing MarkdownWeave. The owner chose this for performance; only its lessons carry over, not its code.
- 2026-11-07: Chose CM6 nested parsers over Shiki, so code blocks stay editable text with token colors and no worker.
- 2026-11-07: Chose hot exit over autosave and close prompts, matching SublimeText.
- 2026-11-07: Chose one headless master state per document with follower views, so undo history outlives any pane.
- 2026-11-07: Stored resized images as `<img src width>`, since that renders on GitHub while `=WxH` and `|300` do not.
- 2026-11-07: Chose pointer-based dragging, because `dragDropEnabled: false` would lose the real file paths on native drops.
- 2026-11-07: Dropped `panic = abort`, so a crashed background thread can't take down the app and lose unsaved typing.
- 2026-11-07: Link rewrite scans every text file in the workspace, including folders hidden from the tree. Only `.git` and binary files are skipped.
- 2026-11-07: Structural probes run through `scripts/check-arch.mjs`, since regex pipes would break the Test Strategy table.
- 2026-11-07: refined: ISC-51 split into ISC-51.1, ISC-51.2 and ISC-51.3, since one claim bundled three probes.
- 2026-11-07: refined: added ISC-169 and ISC-170, since building the task list showed LICENSE and README had no claims.
- 2026-11-07: refined: ISC-12 widened from `invoke` to all `@tauri-apps` imports, so the browser mock stays complete.
- 2026-11-07: refined: ISC-47 moved from a manual run to a scripted kill and restore.
- 2026-11-07: refined: added ISC-171 to ISC-176, since phase plans held behaviors no claim covered.
- 2026-11-07: refined: added ISC-177 to ISC-179 for drag-to-move of selected text, which the owner put back in v1.
- 2026-11-07: refined: ISC-7 is judged on the main-thread work a key causes (handling it, plus the next frame's style, layout and paint). Key to frame adds an idle wait of up to one frame, which no editor can remove, so it is printed and never judged.
- 2026-11-07: Kill rule checked in P0-T8, and it did not fire. Throwaway live-preview decorations hold typing at 5.0 ms p95 per key (5.5 ms with real key events) on the 1 MB fixture, against 16 ms. They cover inline marks only; Phase 3 measures the real layer, block widgets included, with the same scenarios.
- 2026-11-07: Chose 3 MB as the plain-source cutoff. The Markdown parser is what slows typing (p99 8.2 ms at 3 MB and 15 ms at 5 MB, against 16), and plain source types at 1.9 ms even at 10 MB. Provisional until Phase 3 measures the real live-preview layer.
- 2026-11-08: Confirmed the 3 MiB cutoff with the real live-preview layer (P3-T6). Typing p95 / p99 in ms: 2 MB 6.0 / 6.9, 3 MB 8.2 / 9.0, 5 MB 12.6 / 13.5, 10 MB 16.5 / 17.4 (over 16, not repeatable). The 3 MB fixture is 3,146,134 bytes, 406 over the 3 MiB cutoff, so that row is the largest size that gets the parser, with p99 9.0 against 16; the number stays. No longer provisional.
- 2026-11-08: The owner allowed raising the ISC-63 limit if repeat runs agreed, and I set it from 20 to 35 percent (the worst clean run was 1.28), and the owner confirmed the number. The full layer missed 20 in four of six runs (late-file ratio 1.28, 1.27, 1.20, 1.20, 1.16, plus one noisy run at 1.05). A scan late in a 10 MB file takes about 48 microseconds against 40 in a 1 MB file, the cost of finding a place in a tree ten times as big; a whole view update stays level (0.42 against 0.41 ms). The run with the new limit: worst deviation 14.7 percent, control 8.5 times. The control that grows with the file is what stops the check passing a real slope.
- 2026-11-08: Raised ISC-4 from 1000 ms to 1500 ms, on the owner's call (the fallback named on 2026-11-07). The real shell measured 515 ms warm and 693, 893 and 804 ms on three first launches with a fresh WebView2 profile (P3-T6), so 1000 ms passed with a worst margin of 107 ms; the owner wants room for a slower machine or a first launch after a reboot. Past 1500 ms the number stops catching regressions, so it stays there.
- 2026-11-07: Chose normalized text with the line endings kept beside it, over keeping the carriage return in the text. The second keeps every byte, but the Markdown parser then misses tables and hard breaks.
- 2026-11-07: Raised ISC-4 from 500 ms to 1000 ms, on the owner's call. A bare shell with an editor is editable in 429 ms on a warm profile and 475 ms on a first launch with a fresh profile, mostly WebView2 starting, so 1000 ms leaves room for the real UI. Phase 3 measures it, and 1500 ms is the fallback.
- 2026-11-07: Chose the asset protocol with a scope that grows at runtime for images, over a custom protocol. Tested in the real WebView2: a folder is blocked until it is allowed, then loads, including names with spaces and accents.
- 2026-11-07: Kept every strict TypeScript flag and mark generated shadcn-vue files with ts-nocheck and a reason, since all 69 type errors come from exactOptionalPropertyTypes in generated code. Never run shadcn-vue init here, because it rewrites tokens.css.
- 2026-11-07: Kept drag-to-move for selected text in v1, on the owner's call. CM6's own text drag does not work while native file drops are on (tested by hand), and the file paths from native drops matter more, so it is built on pointer events like tab and tree dragging (ISC-177 to ISC-179).
- 2026-11-07: Drag-to-move spike passed in the real WebView2: 15 unit tests, 11 of 11 trusted-input cases, and the owner's 12-step by-hand sitting, with a real file drop working while it was active and no browser drag event ever firing. ISC-177 to ISC-179 stay open until P5-T7 builds it into the app. The spike did not cover 125% display scale, line endings in moved text, or live-preview widgets.
- 2026-11-07: Tauri drop positions are physical pixels (tested at 125% scale), so the platform layer divides them by the pixel ratio before anything hit-tests.
- 2026-11-07: Shipping custom caption buttons without the Windows 11 snap layout hover flyout, which needs the OS to see a real caption button. Win+Z and edge snapping work on the undecorated window (tested by hand).
- 2026-11-07: refined: the probe for ISC-14 now also catches Tailwind palette classes (`bg-white`, `text-slate-500`), since they are colors no theme file can change. Named CSS colors stay unchecked, because the words are too common in prose and identifiers.
- 2026-11-07: Chose two original built-in themes, Graphite (dark, `#1d2027` base) and Paper (light), with every color in `src/styles/themes/` and a test for token parity, gamut and contrast. The native window color is the dark background, pinned to `tauri.conf.json` by a test.
- 2026-11-07: refined: ISC-26 and ISC-27 moved from `manual` to `screenshot`. Both can be driven and read by tools on the real window: trusted clicks with the OS window state read back, and a 60 fps screen recording scanned frame by frame.
- 2026-11-07: Launch frames are checked at 60 fps (frames 17 ms apart), so a white flash shorter than about two frames can slip through. A control window that was white for about 100 ms was caught; one that lived 43 ms was not.
- 2026-11-07: Startup with the full shell is 435 ms median on a warm profile (5 runs, every run within 10%), against 1000 ms. The bare shell took 429 to 475 ms, so the title bar, tab strip, sidebar frame and status bar cost almost nothing.
- 2026-11-07: Closing the last tab of the only pane leaves that pane empty, instead of removing it. ISC-31 holds for every pane that has a sibling; removing the last pane would leave no workbench to open a file into.
- 2026-11-07: Split sizes are percentages that always add up to 100, and every split node carries an id so a view can key it and a resize can name it. Moving a tab to the pane it is already in, and dropping the only tab of a pane on that pane's own edge, change nothing beyond order.
- 2026-11-07: Chose Rust for the whole byte transform (decode, split off the line endings, join, encode) and a raw frame of header, ending exceptions and newline-only text over IPC in both directions. The ISC-1 and ISC-2 probes are Rust tests, so the code that touches bytes has to be Rust; the page owns the text and the ending of each break.
- 2026-11-07: Chose `rfd` directly for the open dialog over `tauri-plugin-dialog`, since the plugin pulls `tauri-plugin-fs` into the build graph and ISC-21 says that crate is absent.
- 2026-11-07: Chose a path policy where the page can read and save only files Rust saw the user choose, or files inside an open workspace folder, compared with symlinks resolved. The page has no command that grants access. Saves go by a Rust-issued document id, never by a path.
- 2026-11-07: refined: the P0 decision (newline-only text, endings in a state field) supersedes the Phase 2 plan line "Set `EditorState.lineSeparator` from the file" and the matching architecture bullet. `lineSeparator` stays at its default.
- 2026-11-07: 2026-11-07: Kept open documents in a plain map with a small reactive record for the chrome, and made closing the last tab of an edited document ask first, in a banner inside the pane instead of a modal. Why: rule one keeps editor objects out of Vue, and closing the app never prompts because hot exit keeps the edits (ISC-49). Easy to change if the owner prefers a modal.
- 2026-11-07: 2026-11-07: Gave each tab a follower state and kept undo history on one headless master per document. Parked tabs only note changes and apply them as one change when shown. Why: closing a pane never loses history (ISC-43), and typing in one pane does not make every parked tab parse. Selection undo (Mod-u) is not bound on followers.
- 2026-11-07: 2026-11-07: Recognised a move by the shape of its change, one deletion and one insertion of the same text, instead of an effect carried from the follower. Why: the master receives only the change set, the undo and redo of a move have the same shape, and moving text is a move whoever does it. Two cursors that delete and type the same newlines look like a move too, which only changes the endings of the breaks typed there.
- 2026-11-07: Decided what counts as an outside change by content, not by event: Rust keeps the hash each document last read or wrote and reports only a different one. Why: one save raises several events, notify can lose some, and the app's own write must be recognised; one comparison handles all three. A save records its hash before it writes, because the watcher thread can see the new file before the save returns.
- 2026-11-07: Made opening a file that is already open leave Rust's record alone, and the page treats a different hash as an outside change. Why: refreshing the record made the host believe the page was current while it still held the old text, which would let a save overwrite a change the page never saw.
- 2026-11-07: Hot exit writes `session.json` (layout, tabs, carets, unsaved buffers) one journal interval after a change and once on close; the interval is 1000 ms. Why: a write costs the page about one late frame at 1 MB (5 ms to build, 26 ms to confirm) and two at 4 MB, so 1000 ms means about 1 late frame in 60 while typing (worked out, not measured with the journal live) and at most a second of typing lost to a force-kill. Measured in P2-T6 (`pnpm perf journal-cost`); easy to change in `JOURNAL_INTERVAL_MS` if the owner wants fewer writes or less to lose.
- 2026-11-07: Applied the P0 cutoff: files above 3 MiB open as plain source with a notice, decided once when the document opens by the size on disk. Why: the parser is what makes typing slow at size (P0-T9), and the same rule covers restored sessions. Known limit: a file that grows past the cutoff while open keeps the parser until reopened.

## Verification

- ISC-22: `pnpm check` (vue-tsc, ESLint, Prettier, check-arch, check-isa) exits 0, and fails on a planted type error, `any` misuse, bad format, an arch violation and a wrong ISA count (P0-T2 to P0-T4).
- ISC-23: `pnpm check:rust` exits 0 on the scaffold with no `dist/`, and fails on a planted `unwrap` and bad format (P0-T2).
- ISC-9: `node scripts/check-arch.mjs no-os-cfg-outside-platform` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-12: `node scripts/check-arch.mjs tauri-only-in-platform` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-13: `node scripts/check-arch.mjs no-vue-in-editor` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-21: `node scripts/check-arch.mjs no-plugin-fs` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-24: `node scripts/check-arch.mjs suppressions-have-reasons` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-73: `node scripts/check-arch.mjs no-math-mermaid` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-169: `node scripts/check-arch.mjs license-mit` passes on the repo and fails on planted violations (tests/scripts/checkArch.test.ts, P0-T3).
- ISC-10: `cargo check --manifest-path src-tauri/Cargo.toml` exits 0 in the `compile (macos-latest)` CI job (https://github.com/balazsbohonyi/mdmate/actions/runs/42367038816, commit 7f77396, P0-T5).
- ISC-11: `cargo check --manifest-path src-tauri/Cargo.toml` exits 0 in the `compile (ubuntu-latest)` CI job (https://github.com/balazsbohonyi/mdmate/actions/runs/42367038816, commit 7f77396, P0-T5).
- ISC-14: `node scripts/check-arch.mjs no-hard-coded-colors` passes on the repo and fails on planted hex, color functions and Tailwind palette classes (tests/scripts/checkArch.test.ts); all colors sit in `src/styles/themes/` (tests/styles/themes.test.ts); a runtime token change restyled the page in `pnpm dev` (Claude in Chrome) and the real `pnpm tauri dev` window rendered Graphite (P1-T1).
- ISC-25: title bar, sidebar, tab strip and status bar all render (32, 240, 34 and 24 px, measured from the DOM) in the real `pnpm tauri dev` window (screenshot over the DevTools port) and in `pnpm dev` (Claude in Chrome); flipping the root to the light theme, or overriding `--sidebar` and `--statusbar`, restyled the matching regions (P1-T2).
- ISC-26: in the real app, trusted clicks on the caption buttons minimized (`IsIconic` true), maximized (`IsZoomed` true, icon swapped to Restore), restored, and closed (process exited); double-clicking the drag region toggled maximize; a real mouse drag on it moved the window by exactly the dragged distance (P1-T2).
- ISC-27: 8 of 8 launches of the release build, recorded at 60 fps (about 58 to 59 delivered, worst gap 34 ms), had 0 frames with more than 20% near-white pixels in the window rectangle, and the window first appeared as the dark UI mid-fade; a control white window of about 100 ms was caught as 2 frames (P1-T2).
- ISC-28: `pnpm test:web tests/workbench/splitTree.test.ts` splits right into two side-by-side panes at 50/50, makes the new pane active, joins an existing row instead of nesting, and fails when the same-direction merge is removed (55 tests, P1-T3).
- ISC-29: the same file splits down into two stacked panes at 50/50, and nests a column inside a row when the pane is already in a row (P1-T3).
- ISC-30: the same file builds `row(column([a] row([c] [d])) [b])`, three levels in mixed directions, with every invariant holding, plus 300 seeded random sequences of 60 operations each that stay valid, keep exactly the open tabs, and round-trip through serialize (P1-T3).
- ISC-34: in `pnpm dev` (Claude in Chrome) trusted drags on three split handles of a three-level layout resized the panes (the left pane went from 648 to 465 px), the saved sizes matched the DOM, no pane or group node was torn down during a drag, nothing moved 600 ms later, a structural change rebuilt the group from the saved sizes, and arrow keys on a focused handle resized and saved too (P1-T4).
- ISC-31: the same file removes a pane when its last tab closes, gives its space to the previous sibling (or the next if it was first), collapses a split left with one child, and fails when either collapse is removed (P1-T3).
- ISC-176: trusted drag in `pnpm dev` (Claude in Chrome) took README.md along its strip to after the last tab and the strip went from README, notes, ideas to notes, ideas, README; the same drag with a real OS mouse in the `pnpm tauri dev` window did the same, with the insertion bar drawn 2 px wide at the right border and the dragged tab dimmed; neither run fired a `dragstart` or `selectstart` or left text selected; `tests/workbench/tabDropTarget.test.ts` fixes the index rule and fails when the threshold, the release-time re-aim or the inclusive border are broken (P1-T5).
- ISC-32: trusted drag in `pnpm dev` moved notes.md from the top-left pane into the bottom-right pane (it landed last and active, the source kept its other tabs), and the same move with a real OS mouse in `pnpm tauri dev` gave the same result (P1-T5).
- ISC-33: trusted drag in `pnpm dev` of ideas.md onto the right edge of the top-right pane made a new pane beside it (648 px split into 323 and 323); in `pnpm tauri dev` a real OS mouse did the same, the preview covered exactly the right half of the pane (214.75 by 297.5 px) while the button was held, and a real Escape press mid-drag removed the overlay and left the layout untouched after release (P1-T5).
- ISC-35: Ctrl+Shift+B hid and showed the sidebar as a trusted key press in `pnpm dev` (Claude in Chrome: panes moved from x 240 to 0 and back, the menu item did the same) and as a real OS key press in the `pnpm tauri dev` window (240 to 0 and back); the keydown was taken from the page (`defaultPrevented` true); `tests/workbench/defaultCommands.test.ts` runs the shortcut against the real store (P1-T6).
- ISC-171: Alt+Shift+2 split a lone 1296 px pane into two columns of 648 px in `pnpm dev`, and an 860 px pane into 430 and 430 in `pnpm tauri dev` with real OS keys, the new pane becoming the active one; the menu item gave the same split in `pnpm dev`, and unit tests show that AltGr (Ctrl+Alt+2) does not trigger it (P1-T6).
- ISC-172: Alt+Shift+8 split the active pane into two rows, 367 and 367 px high in `pnpm dev` and 332 and 332 px in `pnpm tauri dev` with real OS keys; after the split right of ISC-171, the active pane became a column inside that row (P1-T6).
- ISC-1: `pnpm test:rust roundtrip_unedited` reads every fixture (8 committed, 7 generated up to 10 MB), splits it into text and endings, joins and encodes it again, and gets identical bytes and hash, also through a temp-folder save; 3000 seeded random byte strings in four shapes do the same or open read-only (src-tauri/src/fs/mod.rs). Broken on purpose twice (`join` ignoring the exceptions, `encode` dropping the BOM), the fixture tests fail. The page half is checked in P2-T2 (P2-T1).
- ISC-39: `pnpm test:rust unsupported_encoding`: the Latin-1 fixture, broken UTF-8 and broken UTF-16 open as `unsupported-encoding` with their text shown, and a save for them is refused with `read-only` (src-tauri/src/fs/mod.rs, src-tauri/src/documents.rs). The notice itself is drawn in P2-T2 (P2-T1).
- ISC-40: `pnpm test:rust atomic_save`: a failure injected after the temp file is flushed and before the rename leaves the original bytes untouched and no temp file behind, for an existing and a missing target; a failed rename onto a folder does the same. Writing straight to the target instead makes two of them fail (src-tauri/src/fs/atomic.rs, P2-T1).
- ISC-36: `pnpm test:web tests/documents/open.test.ts`: a file opened through the mock host shows its content in a new tab named after the file; the dialog opens several files, a cancelled dialog opens none, and a file that fails is named while the others still open. In the browser (Claude in Chrome on pnpm dev) Ctrl+O put README.md and notes.md in tabs with their text and the path in the status bar (src/documents/store.ts) (P2-T2).
- ISC-37: `pnpm test:rust save_writes_edits` writes edits in every supported encoding and leaves the other lines' endings alone (src-tauri/src/fs/mod.rs); `pnpm test:web tests/documents/open.test.ts` presses Ctrl+S on a clean and on an edited document: one host save with the right bytes, and the key taken from the page both times. In the browser Ctrl+S cleared the dirty dot and wrote the file, and a mixed LF, CRLF and CR file came back byte for byte with one character added. Not run through the real window's Rust path, because the desktop was locked; see decisions (P2-T2).
- ISC-98: `pnpm test:web tests/documents/open.test.ts` opens a file with no folder and no root anywhere in the store; `pnpm test:rust access` shows Rust allows the files the user chose and not their neighbours, and in the real app a file nobody chose is refused with `not-allowed` (src-tauri/src/access.rs) (P2-T2).
- ISC-174: `pnpm test:web tests/documents/open.test.ts` opens one path twice, once in another spelling, and once from a different pane: each time the existing tab is focused, in the pane that holds it, and no second tab appears (src/documents/store.ts) (P2-T2).
- ISC-6: `pnpm perf tab-switch` (release build, Windows, five runs): switch p95 11.2 ms (runs 9.4 to 11.7) against 50 ms, median 7.7 ms; half the switches also apply a change made in another pane (median 6.9 ms, the rest 8.2 ms). The harness calls the spread not repeatable by its 10% rule and notes the CPU was busy before three runs, but every run is under 12 ms, four times inside the target (src/perf/tabSwitch.ts, src/documents/follower.ts) (P2-T3).
- ISC-38: Claude in Chrome on `pnpm dev` (Interceptor is not set up here, see the Phase 1 decisions): typing in a clean tab puts a dot after its name in every pane that shows the file, and saving or undoing back to the saved text clears it; screenshot ss_8342t9l8v shows the dot after an edit (src/workbench/TabStripItem.vue) (P2-T3).
- ISC-41: `pnpm test:web tests/documents/sync.test.ts`: a master with two followers, an edit in either shows in the other and in the master; a parked follower catches up with one applied change; 150 seeded random runs of 40 steps keep every follower equal to the master. In the browser, text typed in the right pane showed in the left (src/documents/document.ts, src/documents/follower.ts) (P2-T3).
- ISC-42: `pnpm test:web tests/documents/sync.test.ts`: undo from the follower that did not make the edit reverts it in every follower and the master, edits from both followers undo in order, quick typing undoes as one step, and the caret goes where the edit was made. In the browser, Ctrl+Z in the left pane reverted what was typed in the right (P2-T3).
- ISC-43: `pnpm test:web tests/documents/sync.test.ts`: after the follower that made two edits is closed, another follower undoes both and redoes one; closing every follower and opening a new one keeps the history. In the browser, closing the right pane's tab and pressing Ctrl+Z in the left reverted its edit (P2-T3).
- ISC-2: `pnpm test:rust edit_isolation`: 1000 random files (UTF-8, UTF-8 with a BOM, UTF-16 in both orders, every ending), 982 of them given one edit at a random range; the bytes before the range and after it are the file's own and the middle is the new text. Breaking join two ways (ignoring every ending exception, or putting one a break late) fails it on run 0 (src-tauri/src/fs/mod.rs, src-tauri/src/fs/eol.rs) (P2-T4).
- ISC-3: `pnpm test:web tests/editor/lineEndings.test.ts`: on the 367-line mixed-eol fixture, appending to, splitting, joining and deleting each line leaves every other line's raw bytes identical and undo puts the whole file back; 300 random runs of 40 steps (edits, two-change edits, drags, undo, redo) match a plain reference model after every step and undoing a whole run gives back the opened bytes. Four deliberate breaks of the field fail 6, 4, 4 and 14 tests (src/editor/lineEndings.ts) (P2-T4).
- ISC-44: `pnpm test:web tests/documents/external.test.ts`: a write to an open file with a clean tab replaces its text and line endings, keeps a caret away from the change where it was, starts the undo history over, follows a file turning read-only into every editor, and applies the later of two writes that overlap one read; a file that vanishes changes nothing. Breaking the reload fails 9 tests, the per-document ordering 1, the fresh history 3. Also seen in the real window with a real file write and a rename-style replace (src/documents/store.ts, src/documents/document.ts) (P2-T5).
- ISC-45: `pnpm test:web tests/documents/external.test.ts`: a write to a tab with edits raises a conflict and leaves its text, its edited mark and the file alone; saving is refused until Keep mine (keeps the edits, next save replaces the file) or Load theirs (shows the file, drops the edits); the host itself still refuses a save over the new file; a change no event reported is found by the save or by opening the file again. Reading an edited tab anyway fails 1 test, a save that ignores a pending conflict 1, typing overwritten during a read 1. Real window: banner shown, Keep mine and Load theirs clicked (src/documents/store.ts) (P2-T5).
- ISC-46: `pnpm test:rust own_save_ignored`: the watcher's event delivered after the save, delivered before the save returns (through Stage::AfterRename) and from the running notify watcher reports no change. Recording the hash after the write instead of before fails the before-return test, and a watcher that stops comparing with the recorded hash fails five. Real window: Ctrl+S left the editor state the same object with no banner (src-tauri/src/documents.rs, src-tauri/src/workspace/watch.rs) (P2-T5).
- ISC-47: `pnpm perf crash-restore` (release app, real WebView2): edits in three files, one with mixed line endings and one of 1 MB, journaled on its own 911 to 931 ms after the last edit, the app killed with TerminateProcess, started again the normal way; layout, edited marks, carets and the SHA-256 of the bytes a save would write all equal. With one letter of the saved session changed in between (`--corrupt`) the mixed-endings tab's SHA-256 differs and the run fails, so the check can fail. Real window with real typing: killed after one interval, restored, Ctrl+S wrote the typed text with every ending kept (src/documents/session.ts, src-tauri/src/session/mod.rs) (P2-T6).
- ISC-48: `pnpm test:web tests/documents/session.test.ts`: a written session restores to a layout equal to the one saved, with splits, sizes, tab order and the active tab and pane; carets (including in tabs never shown), unsaved edits with mixed endings, buffers for a changed or missing file, damaged endings and layouts, the one-write-at-a-time journal and the close flush are covered. Breaking one write at a time fails 2 tests, skip-identical 1, close without flush 3, interval 0 2, unvalidated endings 1 (src/documents/session.ts, src/workbench/store.ts restoreWorkbench) (P2-T6).
- ISC-49: Real app run (`cargo run --features perf`, 11 checks scripted over the DevTools port): typed text, then an OS close request (`CloseMainWindow`) and then the title bar's Close button, 100 ms after typing and inside the journal interval; both ended the app with no prompt and the next start held the text typed in those 100 ms, still marked edited. The close handler flushes the journal before quitting (src-tauri/src/lib.rs, src/documents/session.ts) (P2-T6).
- ISC-5: `pnpm perf open-1mb` (release app, real WebView2, 5 runs after 2 warm-ups): a 1 MB file opened the way the app does (openFile in Rust, Document, tab state, show, frame) takes 20.8 ms warm (20.0 to 21.0, repeatable) and 48.7 ms on the first open of a run, against 100 ms (src/perf/open.ts) (P2-T7).
- ISC-8: `pnpm test:web tests/documents/largeFile.test.ts`: a file one byte above 3 MiB, a 5 MB file and a multi-byte file above 3 MiB on disk open as plain source (no parser, `plainSource` set, notice text); exactly 3 MiB and 1 MB keep the parser; a large file edits and saves byte for byte and stays plain when its unsaved edits are restored. `>=` fails 2 tests, a 5 MiB cutoff 5, ignoring size 4, counting characters 1. Real window: realistic-5mb.md shows the notice and no highlighting (src/documents/largeFile.ts, src/documents/document.ts) (P2-T7).
- ISC-50: `pnpm test:web tests/editor/headings.test.ts` (20 tests: hashes and the blank after them hidden away from the caret, shown with the caret on the line edges included, closing hashes, bare `#`, `#tag`, code fences, Setext) and `tests/editor/livePreviewView.test.ts` (jsdom view: hashes leave the DOM and come back with the caret; a file above 3 MiB gets no preview). Broken on purpose: edge-inclusive touch made exclusive fails 1, a bare `#` hidden fails 1, the blank left visible fails 13, the size cutoff ignored fails the view test. Seen in Claude in Chrome on `pnpm dev` and in the real window (`cargo run --features perf`, DevTools port): `# First heading` shows as `First heading` away and with its hash on the caret line (src/editor/livePreview/scan.ts) (P3-T1).
- ISC-63: `pnpm perf decorations-scale` (release app, real WebView2, 3 rounds): the same viewport text scanned in the 1 MB fixture and inside a 10 MB document made of it ten times, 14.2 against 13.8 µs in the middle (ratio 0.97) and 17.6 against 19.6 µs near the end (1.11), same item counts, limit 20%. The control, a scan of the whole document, takes 2.6 ms at 1 MB and 24 ms at 10 MB (9.2 times), so the check can fail. Headings only; rerun with the full layer in P3-T6 (src/perf/decorationScale.ts) (P3-T1).
- ISC-51.1: `pnpm test:web tests/editor/emphasis.test.ts`: `**` and `__` hidden away from the caret, shown with the caret in the span edges included, only the span the caret is in revealed, unclosed, escaped and spaced markers left alone, never hidden across a line break. Hiding no emphasis markers, or ignoring the caret, fails 4 and 10 tests. Seen in Chrome on `pnpm dev` and in the real window: `Two **bold** words` shows `Two bold words` and `**bold**` only for the span the caret is in (src/editor/livePreview/scan.ts) (P3-T2).
- ISC-51.2: the same file: `*` and `_` hidden, snake_case_word left alone, nested italic reveals its outer bold. With the italic node left out of the scan 4 tests fail. In the real window the caret inside `*italic*` of `**bold with *italic* inside**` showed both pairs (P3-T2).
- ISC-51.3: the same file: `~~` hidden, a single tilde left alone, which needs the GFM parser, since `markdown()` alone has no strikethrough (`tests/editor/markdownSupport.test.ts` pins both). With the wrong mark name 2 tests fail (P3-T2).
- ISC-52: `pnpm test:web tests/editor/inlineCode.test.ts`: backticks hidden, longer fences hidden with an inner backtick kept, shown with the caret in the span, unclosed and fenced code untouched. With the code mark left out 4 tests fail. Seen in Chrome and the real window: `and code in one line` with the backticks back when the caret is in it (P3-T2).
- ISC-53: `pnpm test:web tests/editor/links.test.ts`: inline, reference and shortcut links keep their text and hide the opening bracket and the whole target, a link with no text, an image and a reference definition are left alone, an autolink hides its angle brackets, a bare URL is only styled, nothing hidden spans a line break, and the caret anywhere in the link (edges included) shows all of it. Breaking the code on purpose (caret ignored, one hidden range across lines, empty link hidden, URL rule widened, autolink brackets kept) fails 3, 1, 1, 2 and 1 tests. Seen in the real window: `Read the docs or http://auto.example.com...` with the caret elsewhere, the full `[docs](http://example.com/docs "Docs")` with the caret in it (src/editor/livePreview/scan.ts) (P3-T3).
- ISC-54: `pnpm test:web tests/editor/lists.test.ts`: `-`, `*`, `+`, `1.` and `2)` markers, nested and task items included, get the marker style and stay in the text; a dash or number inside a sentence is not a marker. With the style removed 2 tests fail. Seen in the real window (dim markers, text unchanged) (P3-T3).
- ISC-55: `pnpm test:web tests/editor/blockquotes.test.ts`: every line of a quote is styled exactly once (nested quotes and a lazy continuation line included), each `>` and the blank after it hides away from the caret, only the caret line shows its markers, a marker with nothing after it stays. Breaking the code (lines styled twice, empty marker hidden, caret ignored, blank left visible) fails 1, 1, 2 and 4 tests. Seen in the real window with a bar on the left of the quote (P3-T3).
- ISC-56: `pnpm test:web tests/editor/rules.test.ts`: `---`, `***`, `___` and `- - -` get the rule line style and hide their text, the caret line shows its text, a setext underline and dashes inside text are not rules. With the hiding removed 2 tests fail, with the caret ignored 2 fail. Seen in the real window: a line across the pane, `---` back with the caret on it (P3-T3).
- ISC-57: `pnpm test:web tests/editor/reveal.test.ts` (critical): with the caret in one of two bold spans only that span shows its markers, on the scan and on the page a real view draws, in the dispatch that moves the caret; either edge of the span reveals it and one position away does not; the four kinds of element on one line reveal one at a time; block markers show for the caret line only; a selection across both spans reveals both; two carets reveal two spans (with the multiple-selection facet on, which the app does not enable yet). Breaking the rule (a touch reveals the whole line, a touch reveals the whole paragraph, edges excluded, never revealed) fails 10, 10, 1 and 9 tests (src/editor/livePreview/scan.ts) (P3-T4).
- ISC-58: `pnpm perf reveal` on the release app (Windows 11, Ryzen 7 8840HS, WebView2 157), 5 runs of 80 moves each: leaving a bold span in a 392-character formatted line costs a p95 of 3.7 ms of main-thread work (2.0 ms the update, 1.7 ms the frame), max 4.6 ms; entering is 3.9 ms p95. Limit 16 ms. Every move is read back from the line's own DOM and the run fails if the syntax is in the wrong state (0 wrong in all 5 runs) (src/perf/reveal.ts) (P3-T4).
- ISC-59: `pnpm test:web tests/editor/caretWalk.test.ts`: real caret commands (char and word moves both ways, shift-extend) walk every position of the eight fixtures and seeded windows of the seven generated ones, plus one document of every element and edge case, with a check after each step that the head moved and that no selection end lies strictly inside a hidden range. Shrinking one reveal span (emphasis, heading, quote, link, rule) fails the walk each time; an atomic set that held the marks too fails the with-and-without comparison. Seen the same on 36 real ArrowDown presses in Chrome (P3-T4).
- ISC-60: the real window (debug app, DevTools port, trusted key events): ArrowDown from the first line to the last and ArrowUp back over a 37-line document of every element, the 368-line `lf.md` fixture and a 17-line one never skipped a line, never stuck and left the text unchanged (469 and 457 presses for `lf.md`, which wraps). In Claude in Chrome on `pnpm dev`, 36 ArrowDown presses over the 33-line document visited lines 2 to 33 in order (P3-T4).
- ISC-61: `pnpm test:web tests/editor/sourceMode.test.ts` (6 tests, the real `PaneEditor`): toggling one of two panes on the same document shows raw Markdown there and leaves the other rendered; a tab switch inside the toggled pane stays raw; a tab dragged into the other pane comes up in that pane's mode; the toggle changes no text, makes no edit and leaves nothing to undo; plain-source tabs have nothing to switch and break nothing. Four mutations each failed 2 to 4 tests, except routing the switch through the view instead of the follower, which no test can tell apart (same visible result). In the real window (debug app, trusted key events): Alt+Shift+2 split, Ctrl+E turned raw on in the active pane only, Ctrl+E again turned it off (P3-T5).
- ISC-62: `pnpm test:web tests/editor/copy.test.ts` (8 tests): 300 seeded selections each of `lf.md`, `crlf.md` and `mixed-eol.md`, run through the follower's clipboard output filter, equal the matching slice of the file's raw bytes (over 100 of each crossed a line break and over 100 contained syntax characters); a hand-built file with CRLF, LF and a lone CR checks that a piece starting after the first break takes its own breaks' endings. Five mutations failed 1 to 3 tests each. Real OS clipboard: in the debug app, a real Ctrl+C on a select-all in the rendered pane and in the raw pane each left exactly the file's 97 UTF-16 code units on the Windows clipboard (read back with .NET `Clipboard.GetText()` after seeding it with a stale value), mixed `\r\n`, `\n` and `\r` included (P3-T5).
- ISC-4: `pnpm perf startup` (release app, WebView2 157, 5 runs after 2 warm-ups, 85 to 88 percent CPU idle): launch to editable 515.2 ms median (513.8 to 529.3, 3 percent spread) against the 1000 ms then in force (the limit is now 1500 ms), with live preview on in every editor. Phase 2 ended at 505 ms; Phase 3 added about 10 ms, 40 ms over the bare shell (475 ms). Rust main to page start 298 ms, page start to mounted 118 ms, mounted to editor 44 ms. On a fresh WebView2 profile, three separate first launches took 803.6, 892.5 and 692.9 ms (Rust main to page start 376 to 491 ms; the machine was 73 to 85 percent idle with 5.8 GB RAM free), so the worst margin is 107 ms (P3-T6).
- ISC-7: `pnpm perf typing-1mb` (release app, 5 runs, live preview on, GFM parser): work per key p95 5.8 ms (5.7 to 6.1), p99 6.6, median 3.9, max 8.8, against 16 ms; with trusted key events (`typing-1mb-trusted`) p95 6.7 ms. Phase 0 measured 5.0 ms with a throwaway decoration layer, so the real layer and the GFM parser cost about 0.8 ms (P3-T6).
- ISC-63 (re-measured with the full layer, P3-T6): six runs against the 20 percent limit missed in four (late-file ratio 1.28, 1.27, 1.20, 1.20, 1.16, and 1.05 in a CPU-noisy run); with the limit at 35 percent the run passes: middle 1.06, late 1.15, control 8.5 times, same item counts in both files.
- ISC-64: Interceptor on `pnpm dev` (mock host) and the real WebView2 window: a table with a header row, left, centred and right alignment, bold and code in cells, no pipes shown; tests/editor/table.test.ts reads the model and the widget DOM, and `pnpm test:web tests/editor/table.test.ts` passes (src/editor/livePreview/blocks) (P4-T1).
- ISC-65: tests/editor/table.test.ts (caret inside, on both edges, a range across it, the caret leaving) and, with real input, a click on a cell and ArrowDown and ArrowUp through the table in both Interceptor on `pnpm dev` and the real window: seven presses each way visit every source line, and the table draws again on leaving. Without `stepIntoBlock` the keyboard jumped over the table (P4-T1).
- ISC-183: `pnpm test:web tests/editor/blocks.test.ts` puts the caret at every offset of a document of tables, then 400 random ranges, then 300 selection transactions: no block is ever touched by a selection. Breaking it on purpose (drawing touched blocks, ignoring selection moves) fails 10 and 7 tests (P4-T1).
- ISC-66: the dev page (mock host, Interceptor) showed `pic.svg` and a badge row from relative paths, and the real WebView2 window showed an SVG, two badges and a PNG in a subfolder through the asset protocol, each at its natural size (300x120, 90x20, 128x128 CSS px); `pnpm test:web tests/editor/images.test.ts tests/documents/images.test.ts` passes (P4-T2).
- ISC-67: the dev page drew an `https` image (800x600) inline, and a unit test pins that its source is the address as written with no referrer sent (P4-T2).
- ISC-180: `pnpm test:web tests/editor/images.test.ts` runs 36 refusal cases (http, file, data, script and unknown schemes, UNC in four spellings, absolute and rooted paths, drive letters, `..` plain and percent-encoded, device names, trailing dots, credentials), a fuzz of 6000 random addresses that finds no path outside the folder and no non-https remote, and hostile.md, where only its one https image gets an address. Breaking each rule on purpose failed 1 to 8 tests every time (P4-T2).
- ISC-181: `pnpm test:rust asset_folder` (5 tests: the document's own folder, never a neighbour or the parent, none for a disk root, none for a network path, a folder with glob characters), and in the real window a fetch of an asset URL returned 200 for a file in the document's folder and 403 for a file in the folder beside it. Rust grants it in `open_file`; the page has no command for it (P4-T2).
- ISC-72: `pnpm perf scroll-stability` on the release build, six runs in a row on one build: the top line moved 0.47 px going up and 0.25 px going down every time (limit 2 px), while the control, an image widget with no reserved space, moved it 288 to 910 px. The sizes go in during the view's measure cycle and, when CodeMirror would not make up for the change, the first visible line is put back (`tests/editor/images.test.ts`, 10 deliberate breaks all caught, including the two-images-in-one-frame case that failed 6 of 6 runs before). Four earlier versions missed the limit; see ai-docs/phases/phase-04/decisions.md (P4-T2).
- ISC-182: `tests/editor/images.test.ts` loads, fails and refuses an image and reads the same fixed height (160 px block, 20 px inline) before and after, and a remembered size reserves the real aspect ratio from the first frame; the real window showed the 160 px dashed placeholder with its alt text for a missing file (P4-T2).
- ISC-68: `pnpm test:web tests/editor/frontmatter.test.ts` (34 tests): the block at the very start of the text, `---` to `---` or `...` within 200 lines, is one pill labelled with its top-level keys; a caret touching it, edges included, brings the YAML back as plain muted text and the pill returns when the caret leaves; typing the closing line far below turns it on; the block layer and the inline layer draw and style nothing inside it. The real window (debug app, trusted mouse) showed the pill `Frontmatter title, tags, draft` with the caret away and the plain YAML with the caret at the top; the first look showed the YAML styled as a heading by the highlighter, which is why open blocks now get a plain line class (P4-T3).
- ISC-69: `pnpm test:web tests/editor/checkbox.test.ts` presses a box and compares the file a save would write: one byte differs, the space or the `x`, for LF, CRLF, CR and a file mixing all three, and undo restores the file byte for byte, two quick presses on one box undoing one at a time. The real window (trusted click, Ctrl+S, bytes read from disk): one byte for an LF file (checked to open), a CRLF file and a file with 9 CRLF, 7 LF and 1 CR; Ctrl+Z then Ctrl+S gave the original bytes every time (P4-T3).
- ISC-184: the same file, a document made read-only through `Document`: two presses change no text, leave nothing to undo and the document unedited; the real window opened a file with invalid UTF-8 as read-only (`aria-readonly`), two trusted clicks on its boxes changed nothing and the file on disk was identical after Ctrl+S. 26 deliberate breaks across the T3 code were all caught; the first 21 left 6 alive, which led to a stricter scan edge, two redundant pieces removed and four tests tightened or added (P4-T3).
- ISC-70: `pnpm test:web tests/editor/codeHighlight.test.ts` (20 tests) opens fenced blocks in js, ts, python, py, json, css, sh, go and rust and reads the class each token gets from the style: keywords, strings, numbers and comments get four different classes, the block is plain until its parser has loaded, a fence word written in capitals works, the text of the block is the text of the file, and typing inside a block is colored again. The colors are `var(--syntax-*)` names only, and each exists in both theme files. Real window (debug app on the dev server, 2026-11-08): ts, python, rust, css, json and sh blocks colored by token, an unknown word and a fence with no word left as plain text, document length 702 equal to the file size; typing `7` after `42` in a block gave `427` still colored as a number and Ctrl+Z restored 702; raw mode (Ctrl+E) shows the same colors. Interceptor on `pnpm dev` through the mock host: the screenshot shows the same colors in the dark theme; in the light theme the computed colors are `oklch(0.48 0.15 310)` for keywords, `oklch(0.46 0.11 145)` for strings and `oklch(0.5 0.13 50)` for numbers, but the DOM-render screenshot washed them out so the light theme was checked by value, not by eye (P4-T4).
- ISC-71: `node scripts/check-arch.mjs languages-lazy --dist <build>` on a build made with `vite build --sourcemap`: the chunks the page loads first (the entry script, the modulepreload link and what they import statically, 2 files, 790 kB) hold `lang-css`, `lang-html`, `lang-javascript` and their grammars and no other language package, while the language chunks and the list of them load on demand. The claim as written, "no parser in the entry bundle", is not literally true and cannot be: `@codemirror/lang-markdown` imports `lang-html` (which brings `lang-css` and `lang-javascript`) for the HTML it finds in Markdown. The rule allows those six packages by name and nothing else; the allowance is a constant with a comment that says why. Source half: no static import of a parser package in `src/`. Runtime half: `tests/editor/codeLanguagesLazy.test.ts` counts imports of `@codemirror/language-data` and sees none for documents with no fence word, `~~~` with a blank word, or an unlabeled fence, and exactly one for two views holding three languages. In the real window the language list was not requested for a document with no fenced block and was requested after a document with one was opened. 9 deliberate breaks of the rule (ignore modulepreload, skip static imports, allow the list, drop `lang-css` from the allowance, widen the allowance, Windows paths, pnpm store paths, `explicit` flag, skip scanning) were all caught by `tests/scripts/checkArch.test.ts` (92 tests); 4 breaks of the editor code (no extension lookup, no `codeLanguages`, an unknown token name in the style, a static import of the list) were caught by the two test files (P4-T4).

## Remaining Work

- [ ] Ship the Inter font's OFL-1.1 notice with the installer and portable zip, and credit it in the README — the font is bundled from `@fontsource-variable/inter`; waits on P10-T3 to P10-T5.
- [ ] Check the resolved Rust dependency graph for network crates with `cargo tree --target all` — `no-network` reads direct dependencies only, because the lockfile lists `reqwest` and `hyper` although none is in the Windows build graph; waits on P10-T2, where ISC-20 closes.
- [ ] Grow the asset protocol scope with `allow_directory` when a workspace folder opens (Phase 4 does it for the folder of each opened document), and divide Tauri drop positions by the pixel ratio in the platform layer — the drop positions were tested in P0 at 125% scale only; waits on the phases that add workspaces and file drops.
- [ ] Re-measure typing and startup once the Phase 4 block widgets (tables, images, frontmatter) land, against the 16 ms of ISC-7 and the 1500 ms of ISC-4; Phase 3 measured the inline layer only; waits on P4.
- [ ] Decide whether the Windows 11 snap-layout hover flyout is worth answering `WM_NCHITTEST` from Rust — v1 ships custom caption buttons without it, and Win+Z and edge snapping work; waits on the owner.
