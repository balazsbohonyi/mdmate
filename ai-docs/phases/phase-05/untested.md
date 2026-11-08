# Phase 5: what was not tested, and how to test it later

Everything below was skipped on purpose or could not be done in the Phase 5 runs. Each entry says why, and how to check it when there is time. The decisions behind them are in [decisions.md](decisions.md).

| # | Gap | Why it was skipped | How to test it |
|---|---|---|---|
| 1 | A relative link through a junction or symlink that points at a share | The guard refuses the resolved path, but `canonicalize` itself has to follow the junction, which contacts the host before the refusal. Only the refusal is tested, with a fake file system. | Make a junction in a document's folder to `\\127.0.0.1\c$`, link to a file through it, and watch port 445 while following the link. |
| 2 | The opener on macOS and Linux | CI only compiles them; no run on either OS. | Follow a web link and a PDF link on each OS. |
| 3 | Internationalized host names | The guard percent-encodes non-ASCII, host included, and no browser was given one. | Follow `https://bücher.example/` and see whether the browser opens it. |
| 4 | Hard links and NTFS alternate names other than the extension | A link may resolve to a name the guard reads as harmless while the file is something else (a hard link named `notes.txt` to a program still opens as text, so it is not run). Only symlinks were modelled, with a fake file system. | Make a hard link `a.pdf` to `calc.exe`, link to it, confirm, and see what opens. |
| 5 | Where a plain click puts the caret, in unit tests | CodeMirror hit-tests with its own function, which jsdom cannot run; the tests only show that a plain click never follows a link. The real window showed the caret land in the link text. | Nothing, unless the gesture code changes. |
| 6 | The scroll of a heading jump | jsdom has no layout; the tests check that the scroll effect is dispatched when the tab is shown. In the real window the documents were too short to scroll. | Ctrl+click a `#heading` link to a heading far down a long document and see it at the top. |
| 7 | Headings inside lists and quotes, and HTML headings (`<h2 id>`) | Not found by the anchor scan on purpose (see decisions). | Link to a heading inside a list item and see the "No heading" notice. |
| 8 | Win+click on Windows | `metaKey` is the Mac gesture; on Windows it is the Win key. | Win+click a link; it follows it. Decide whether that matters. |
| 9 | A link inside a table, an image caption or frontmatter | Tables and frontmatter are widgets until the caret enters them, so their links cannot be Ctrl+clicked while drawn. | Ctrl+click a link in a drawn table; nothing happens until the table shows its source. |
| 10 | The broken style in the light theme | Only the dark theme was looked at. | Switch theme and look at a missing link. |
| 11 | Broken style on a reference link, an anchor or a file's fragment | Not checked on purpose (see decisions). | Write `[x][r]` with `[r]: gone.md`; it is not styled. |
| 12 | History positions after edits | A location's caret is clamped, not mapped through edits made since, so after typing above it Alt+Left lands a little off. | Follow a link, type a paragraph above where you were, press Alt+Left. |
| 13 | Many panes checking links at once | Each visible pane with local links asks every 5 s; not measured with several panes or a slow disk. | Open four panes of link-heavy files and watch the CPU. |
