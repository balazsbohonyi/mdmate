# Phase 9 decisions

Choices the plan left open, settled with the owner in a design session on 2026-11-13. Each one lists what was weighed.

## Order

- **Phase 9 runs before Phase 8.** Only paste needs a setting, and a built-in `assets` folder covers it. P8-T1 adds `images.pasteFolder` (ISC-330) and the paste code reads it then. Drop and resize have no dependency on Phase 8.

## Saving a resize

- **A resized `![alt](src)` becomes `<img src alt width>`.** Other formats were weighed: Obsidian's `![alt|300](src)` stays Markdown but only Obsidian reads the size, and Typora's `=300x` makes GitHub and VS Code treat the size as part of the URL. `<img>` renders in every viewer. **Cost:** a resized image is no longer pure Markdown. The owner accepted that; an unresized image is never rewritten (ISC-160).
- **mdmate therefore draws `<img>` tags (P9-T3).** Attributes honoured: `src`, `alt`, `title`, `width`, `height`. The address goes through the same allowlist as a Markdown image. Everything else, including `style` and `on*`, is ignored, and other HTML stays source. This is new attack surface; P10-T2 reviews it.
- **Width only.** The handle writes `width` and the browser scales the height, so the ratio holds. On an `<img>` that already has a `height`, the resize removes it (otherwise the image would distort); no other byte of the tag changes. MarkdownWeave writes both and lets the ratio break; this is deliberately different.

## Selecting

- **A click selects the image and keeps its source hidden.** Today a click puts the cursor at the start of the source. The new selection state shows an outline and the handle. Enter or an arrow key into the image shows the source for editing. Escape or a click elsewhere deselects. Delete or Backspace removes the whole image as one undo step. There is no keyboard resizing in v1.
- **Every loaded image gets a handle**, block or inline, local or `https`. Broken images and the loading placeholder get none. The range is 24 px to the editor content width; upscaling past the natural size is allowed, so a small image can be enlarged.

## Paste and drop

- **Folder and name.** `assets` next to the document, created on the first paste, so the relative link always stays inside the document's folder and passes the image allowlist. The name is `image-YYYYMMDD-HHMMSS.png` and a taken name gets `-2`, `-3`. Rejected: one folder at the workspace root (links climb with `../`, and a document in no workspace has no root) and a folder per document.
- **Drop links in place when it can, copies when it must.** A file inside the document's workspace folder is linked where it is. A file outside it is copied into `assets` and linked there, because an outside path would never load (ISC-180). Dropping outside the text still opens an image tab (ISC-201).
- **An untitled document gets a draft folder per document (P9-T5); until then it refuses.** Pasted and copied images go to `drafts/<key>/assets/` in the app data folder, with the normal relative link, and the first Save As copies them next to the saved file and removes the folder. Closing the tab without saving removes the folder too (after "Don't Save", or at once when nothing changed), but quitting the app keeps it because the session restores the tab. There is no reopen-closed-tab feature in the ISA, so a closed untitled tab never needs its images back. Weighed and rejected: base64 in the text (the session snapshot writes every unsaved buffer, so a 2 MB screenshot would be rewritten each time, and the CSP would need a `data:` exception), a link form that only works in untitled tabs, asking to Save As on the first paste (an interruption), and saving to a default folder (writes somewhere the owner did not choose). Until P9-T5 lands, P9-T1 and P9-T2 refuse in an untitled document with "Save the file first so the image has a folder". To check at the start of P9-T5: that the untitled number in the session stays stable across a restart, so it can key the folder.
- **An undone paste leaves its file.** The text insert is one undo step; the image file stays on disk. mdmate never deletes the owner's files on its own, and deleting on undo would break a redo or an edited link.

## Still to check

- At the start of P9-T5: that the untitled number in the session stays stable across a restart (see above).

## P9-T1: Paste (2026-11-13)

**Where it was checked.** The real debug window (`target/debug/mdmate.exe`, display scale 150%, `devicePixelRatio` 1.5) against my own Vite server on port 1420, with `MDMATE_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` in temp folders, driven over the DevTools port with trusted key events (`Ctrl+V` with the `paste` editing command) and a clipboard filled from PowerShell (`SetImage`, `SetFileDropList`, which is what Explorer's Copy sets).

**The clipboard check (the open question in the plan).** A `paste` listener on the document read `clipboardData` for each case:

| On the clipboard | `types` | `files` | `text/plain`, `text/html` |
|---|---|---|---|
| A bitmap (a screenshot) | `Files` | one `File`: `image.png`, `image/png`, 1159 bytes (every pixel) | empty |
| One file copied in Explorer (png, jpg, gif) | `Files` | one `File` with the file's **real name**, **real type** and **exact bytes** (734, 907, 1008 bytes: the sizes on disk) | empty |
| Two files (png and jpg) | `Files` | two `File`s, in order | empty |
| A Markdown file | `Files` | one `File`: `note.md`, `text/markdown` | empty; pasting it inserted nothing |

So a file copy needs no path and no special route: **both cases are `clipboardData.files`**, and a pasted file is saved from its bytes like a screenshot. There is no path on the clipboard to refuse. Nothing but the `File`s comes through for a copied file, so the file's own folder is never learned.

**What follows from it.**

- **Text wins over a picture.** A paste with `text/plain` or `text/html` on it is an ordinary paste even when it carries an image file, because a copied spreadsheet range or web page puts a preview bitmap beside its text. Both measured cases have no text.
- **Four types are saved: PNG, JPEG, GIF, WebP.** Rust reads the type from the first bytes, not from the page's word for it, and the extension follows the type. A screenshot is `.png`, as the plan says; a copied photo is `.jpg`. The plan's name `image-YYYYMMDD-HHMMSS.png` named the screenshot case; saving JPEG bytes under `.png` would hand the owner a file that lies about its type. SVG is not saved (it is text, and not what a paste of a picture means); a copied `.md` or `.txt` is left to the paste that was always there.
- **The file keeps the stamp name, not its own name.** A copied `photo.jpg` becomes `image-20261113-174407.jpg`, the same naming as a screenshot. Several files at once get one link each, one under another, as one undo step; two files of one type in one second get `-2`.
- **The time comes from the page and is held to the shape `YYYYMMDD-HHMMSS`.** Rust has no clock for the owner's time zone, and the page does. Anything else (a `/`, `..`, a different length) is refused, so the stamp can never name a path.
- **The name is taken by creating the file.** `create_new(true)` in the `-2`, `-3` loop, so a name another paste or program took a moment ago is never opened for writing (ISC-329). A half-written file under a name this call created is removed.
- **Refused in Rust:** a document with no file (until P9-T5), a document that cannot be edited, an `assets` that is a file, an `assets` that is a link or junction leading out of the document's folder (the image would not load, and the write would reach a place the document does not own), bytes that are not one of the four types, and more than 64 MB. A junction test creates a real junction with `mklink /J` on Windows and fails if it cannot.
- **Link text is written so it reads back.** A name with a space or parenthesis goes in angle brackets, and `%`, `#` and `?` are percent-escaped, because the address reader percent-decodes and treats `#` and `?` as a fragment and a query. A seeded test over 300 names with every awkward character goes through the real Markdown parser and the image allowlist and gets the same file back. It found `#` unescaped the first time it ran. (Today the name is always `assets/image-….png`; the folder becomes a setting in P8-T1 and may then hold such characters, and the drop in P9-T2 links files with any name.)
- **A document that was swapped out while the file was being saved gets no link.** The link goes in only if the view still shows the same tab; otherwise the notice says where the file went.
- **The notice is the status bar's `problem` line**, the same place other failed actions report to.
- **The folder is a constant `assets`** (`images::IMAGES_FOLDER`). P8-T1 will read `images.pasteFolder` at that one place (ISC-330).
- **The image protocol needs nothing new.** `assets` is below the document's folder, which `open_file` already granted recursively; a freshly created `assets` loaded without a restart.

**Evidence, real window.** A screenshot paste saved `image-20261113-174405.png` (1159 bytes, the bytes the clipboard check read) next to the document and inserted `![](assets/image-20261113-174405.png)` at the caret; the image drew at 240 x 140 CSS px natural size (360 x 210 on screen at 150%). A two-file Explorer-style paste saved `image-20261113-174407.jpg` (907 bytes) and `image-20261113-174407.png` (734 bytes), the sizes of the originals, and inserted two links; the jpg drew at 160 x 100 and the last link showed its source because the caret was at its end, which is the existing reveal rule.
