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

- What WebView2 puts on the clipboard for a file copied in Explorer and pasted into the editor. Written here after the P9-T1 check.
