---
task: "Build mdmate, a fast inline Markdown editor"
slug: 20261107-mdmate
project: mdmate
phase: climbing
progress: 33/181
started: 2026-11-07T00:30:52Z
updated: 2026-11-07T16:00:09Z
principal_stated_goal: "I want to build a markdown editor that follows the markdown inline editing philosophy from Obsidian and simplicity of SublimeText."
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

## Goal

"Create a markdown editor that follows the inline editing philosophy from Obsidian and the simplicity of SublimeText". mdmate is a desktop app where Markdown renders inline and reveals its syntax at the caret, with tabs, a sidebar and free splits in the SublimeText style. It meets its measured speed targets, keeps files byte-exact, and is built so macOS and Linux need only new platform implementations.

## Not yet specified

- fog: what hot-exit journal interval balances safety and disk writes — needs P2 measurement.

## Test Strategy

Commands: `pnpm test:rust <filter>` runs Cargo tests, `pnpm test:web <file>` runs Vitest, `pnpm perf <scenario>` runs the release-build harness, and `node scripts/check-arch.mjs <rule>` runs structural checks. Web UI rows use Interceptor against `pnpm dev`; real-app rows use `pnpm tauri dev`.

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|---|---|---|---|---|---|---|---|
| ISC-1 | bash | hash before and after save across all fixtures | identical | pnpm test:rust roundtrip_unedited | derived: byte-exact | critical | |
| ISC-2 | bash | property test: random edits leave bytes outside the range unchanged | 1000 runs | pnpm test:rust edit_isolation | derived: byte-exact | critical | |
| ISC-3 | bash | edit a mixed-EOL fixture, compare untouched lines | identical | pnpm test:web tests/editor/lineEndings.test.ts | derived: byte-exact | | |
| ISC-4 | bash | launch to editable time, release build | under 1000 ms | pnpm perf startup | derived: fast | critical | |
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
| ISC-63 | bash | compare decoration time on 1 MB and 10 MB | within 20 percent | pnpm perf decorations-scale | derived: fast | | deep |
| ISC-64 | screenshot | render the GFM table fixture | table shown | Interceptor on pnpm dev | literal | | |
| ISC-65 | bash | caret enters table range | widget removed | pnpm test:web tests/editor/table.test.ts | literal | | |
| ISC-66 | screenshot | render relative image with mock host | image shown | Interceptor on pnpm dev | literal | | |
| ISC-67 | screenshot | render https image | image shown | Interceptor on pnpm dev | literal | | |
| ISC-68 | bash | frontmatter fixture | pill replaces block | pnpm test:web tests/editor/frontmatter.test.ts | literal | | |
| ISC-69 | bash | click checkbox, diff document | one byte | pnpm test:web tests/editor/checkbox.test.ts | derived: byte-exact | | |
| ISC-70 | screenshot | code block fixture | token colors shown | Interceptor on pnpm dev | literal | | |
| ISC-71 | bash | inspect build chunks | no parser in entry | node scripts/check-arch.mjs languages-lazy | derived: fast | | |
| ISC-72 | bash | scroll heavy fixture, track anchor line | drift under 2 px | pnpm perf scroll-stability | derived: fast | | deep |
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
- [ ] ISC-2: Anti: an edit never changes bytes outside its range.
- [ ] ISC-3: Mixed line-ending files keep each untouched line's ending after an edit.
- [ ] ISC-4: The release app is usable within 1000 ms of launch.
- [ ] ISC-5: A 1 MB Markdown file opens within 100 ms.
- [ ] ISC-6: Switching tabs completes within 50 ms.
- [ ] ISC-7: Typing stays under 16 ms per key on the 1 MB fixture.
- [ ] ISC-8: Files above 3 MB open as plain source with a notice.
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
- [ ] ISC-38: Tabs with unsaved edits show a dirty marker.
- [x] ISC-39: Files in unsupported encodings open read-only with a notice.
- [x] ISC-40: Anti: a failed save never damages the original file.
- [ ] ISC-41: An edit in one pane appears in another pane showing that file.
- [ ] ISC-42: Undo from either pane reverts the last edit.
- [ ] ISC-43: Closing a pane keeps the document's undo history.
- [ ] ISC-44: A disk change reloads a clean tab.
- [ ] ISC-45: A disk change on an edited tab raises a conflict choice.
- [ ] ISC-46: Anti: mdmate's own save triggers no reload or conflict.
- [ ] ISC-47: A force-kill loses nothing up to the last journal write.
- [ ] ISC-48: A restart restores tabs and split layout.
- [ ] ISC-49: Anti: closing the app with unsaved edits shows no prompt.
- [x] ISC-174: Opening an already open file focuses its tab.

### F3 · Inline live preview
Why: this is the reason mdmate exists; you read the rendered page and edit it in place, with syntax only where you are working.

- [ ] ISC-50: Headings render without `#` markers away from the caret.
- [ ] ISC-51: [container] Emphasis renders with hidden markers.
  - [ ] ISC-51.1: Bold renders with hidden markers.
  - [ ] ISC-51.2: Italic renders with hidden markers.
  - [ ] ISC-51.3: Strikethrough renders with hidden markers.
- [ ] ISC-52: Inline code renders with hidden backticks.
- [ ] ISC-53: Links render as text with the target hidden.
- [ ] ISC-54: List markers render styled.
- [ ] ISC-55: Blockquotes render styled.
- [ ] ISC-56: Horizontal rules render as lines.
- [ ] ISC-57: A caret inside an inline element reveals only that element's syntax.
- [ ] ISC-58: Syntax hides again within 16 ms of the caret leaving.
- [ ] ISC-59: Anti: the caret never sticks inside hidden syntax.
- [ ] ISC-60: Anti: vertical arrow keys never skip a line.
- [ ] ISC-61: A per-pane toggle shows raw source.
- [ ] ISC-62: Copying a selection copies raw Markdown.
- [ ] ISC-63: Decoration time stays flat between 1 MB and 10 MB files.

### F4 · Block preview
Why: documents mix prose with tables, images and code, and a page full of raw syntax blocks breaks the illusion.

- [ ] ISC-64: GFM tables render read-only.
- [ ] ISC-65: A caret entering a table reveals its raw source.
- [ ] ISC-66: Local images render inline from relative paths.
- [ ] ISC-67: Remote `https` images render inline.
- [ ] ISC-68: YAML frontmatter collapses to a pill.
- [ ] ISC-69: Clicking a checkbox changes exactly one byte.
- [ ] ISC-70: Fenced code highlights using token colors.
- [ ] ISC-71: Language parsers stay out of the entry bundle.
- [ ] ISC-72: Anti: late-rendering widgets never shift the scroll position.
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

## Remaining Work

- [ ] Ship the Inter font's OFL-1.1 notice with the installer and portable zip, and credit it in the README — the font is bundled from `@fontsource-variable/inter`; waits on P10-T3 to P10-T5.
- [ ] Check the resolved Rust dependency graph for network crates with `cargo tree --target all` — `no-network` reads direct dependencies only, because the lockfile lists `reqwest` and `hyper` although none is in the Windows build graph; waits on P10-T2, where ISC-20 closes.
- [ ] Build the real line-ending state field and make undo restore a deleted line break's old ending, and keep each break's ending when a selection with line breaks is moved by drag — the P0 spike gives such breaks the neighbour's ending; waits on Phase 2, where ISC-3 closes.
- [ ] Turn the asset protocol on for real (the `protocol-asset` feature, `assetProtocol` enabled with an empty scope) and grow its scope with `allow_directory` when a workspace opens, and divide Tauri drop positions by the pixel ratio in the platform layer — both were tested in P0 (drop positions at 125% scale only); waits on the phases that add images and file drops.
- [ ] Re-measure with the real live-preview layer, block widgets included: typing against 16 ms, the 3 MB plain-source cutoff, and startup on a fresh WebView2 profile, against the 1000 ms of ISC-4 (a bare shell takes 475 ms); then delete `src/perf/throwawayDecorations.ts`; waits on Phase 3.
- [ ] Decide whether the Windows 11 snap-layout hover flyout is worth answering `WM_NCHITTEST` from Rust — v1 ships custom caption buttons without it, and Win+Z and edge snapping work; waits on the owner.
