# Phase 4: Block preview

**Goal:** tables, images, frontmatter, checkboxes and code look finished, with stable scrolling.

Block widgets come from a `StateField`, which maps through edits, rescans only changed ranges, and extends as the parser advances. Widgets are plain DOM with `eq()` and `estimatedHeight`.

## P4-T1: Tables

Render GFM tables as a read-only widget. A caret entering the table reveals its source, and copying selects source.

**Done when:** tables render, and the caret reveals raw source on entry.

## P4-T2: Images

Render local and `https` images. Local paths resolve from the document's folder, through the asset approach chosen in P0. Cache sizes, reserve space, and call `requestMeasure()` after load.

**Done when:** scrolling the heavy fixture shows under 2 px drift.

## P4-T3: Frontmatter and checkboxes

Collapse frontmatter to a pill that expands to source. Checkboxes toggle by changing one byte.

**Done when:** a checkbox click diffs to exactly one byte.

## P4-T4: Code highlighting

Fenced code uses CM6 nested parsers, loaded per language via `@codemirror/language-data`, with a token-based `HighlightStyle`. Code stays editable text.

**Done when:** highlighting uses token colors, and no language parser is in the entry bundle.
