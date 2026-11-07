# Phase 9: Image authoring

**Goal:** adding a screenshot takes one paste, and resizing touches only that image.

## P9-T1: Paste

A pasted image saves to the configured subfolder with a unique name, and inserts a relative `![]()` link.

**Done when:** the file exists and the link resolves.

## P9-T2: Drop

Tauri's native drop gives real paths. An image dropped from Explorer inserts a relative link at the drop point, using the coordinate handling found in P0.

**Done when:** the link lands where it was dropped, at any display scale.

## P9-T3: Resize

Drag handles on inline images set a width. A resized `![]()` becomes `<img src width>`, and an existing `<img>` updates only its width.

**Done when:** byte diffs show only that image's source changed.
