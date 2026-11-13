# Phase 9: Image authoring

**Goal:** adding a screenshot takes one paste, and resizing touches only that image.

**Order:** this phase runs before Phase 8 (owner's decision, 2026-11-13). The only setting it needs, the paste folder, is a built-in `assets` until P8-T1 adds `images.pasteFolder`. The choices behind each task are in [decisions.md](decisions.md).

## P9-T1: Paste

First a short check in the real WebView2: what a screenshot paste and an Explorer file-copy paste put on the clipboard (`clipboardData.files`, or only a path). The file-copy case is decided from the result and written in the decisions.

A pasted image saves to an `assets` folder next to the document (created on the first paste) as `image-YYYYMMDD-HHMMSS.png`, never overwriting a file (a taken name gets `-2`, `-3`), and inserts `![](assets/image-….png)` at the cursor. A document with no file refuses the paste with a notice and writes nothing until P9-T5 gives it a draft folder. The inserted text is one undo step; the saved file stays on disk after an undo.

**Done when:** the file exists, the link resolves and the image draws, and a pasted image never changes an existing file.

## P9-T2: Drop

Tauri's native drop gives real paths. An image dropped from Explorer onto document text inserts a relative link at the drop point, using the coordinate handling found in P0 (physical pixels divided by `devicePixelRatio`). A file inside the document's workspace folder is linked in place; a file outside it is copied into the same `assets` folder as a paste and linked there, since an outside path would never load (ISC-180). An image dropped outside the text still opens in an image tab (ISC-201). A document with no file refuses a copy with the same notice as a paste until P9-T5.

**Done when:** the link lands where it was dropped, at any display scale, and both the in-place and the copy case draw the image.

## P9-T3: Draw `<img>` tags

mdmate draws only Markdown `![]()` images today. An `<img>` tag with `src`, `alt`, `title`, `width` and `height` draws as an image through the same address allowlist (ISC-180, 181, 232). Any other attribute is ignored, so no `style` and no `on*` handler ever reaches the page, and any other HTML stays source.

**Done when:** an `<img>` draws like a Markdown image at its width, a hostile tag loads nothing and runs nothing, and the hostile fixture still passes.

## P9-T4: Select, resize and delete

A click selects an image (outline and a bottom-right handle) and its source stays hidden. Escape or a click elsewhere deselects; Enter or an arrow key into it shows the source. Every loaded image gets a handle, block or inline, local or `https`; broken images and the loading placeholder get none. Dragging the handle sets the width only, keeps the aspect ratio, and stays between 24 px and the editor content width (upscaling past the natural size is allowed). A resized `![alt](src)` becomes `<img src alt width>`; an existing `<img>` has its `width` set and any `height` removed. Delete or Backspace on a selected image removes it. A resize and a delete are one undo step each. Unresized images stay `![]()`.

**Done when:** byte diffs show only that image's source changed, the drag works in the real window, and a delete and its undo round-trip.

## P9-T5: Images in untitled documents

An untitled document has no folder to put `assets` next to, so each one gets a draft folder in the app data folder (`drafts/<key>/`). A paste or a drop-copy saves into `drafts/<key>/assets/` with the same names and the same normal link as P9-T1, and for image loading that draft folder is the document's folder. The first Save As copies those images into the images folder beside the saved file and removes the draft folder; a name that is taken there gets `-2`, `-3` and its link is updated. Closing the untitled tab removes its draft folder once the close is final: after "Don't Save" in the unsaved-changes question, or at once for a tab with no changes, and through every route that closes a tab (the tab's own close, Close Others, Close All, Close to the Right). Cancel keeps it. Quitting the app keeps it too, since the session restores untitled tabs (ISC-206). If a removal fails, or the app crashes, a start-up sweep removes any draft folder whose untitled tab is not in the session. The key is the untitled number the session already stores (ISC-206), checked at the start of the task. The asset protocol is granted a draft folder only for the tab that owns it.

**Done when:** a pasted image in an untitled tab draws, survives a restart, lands next to the file after Save As with no leftover draft folder, and a closed untitled tab leaves nothing behind.
