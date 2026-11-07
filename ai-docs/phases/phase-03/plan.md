# Phase 3: Inline preview

**Goal:** the core experience. Markdown renders where you type, and syntax appears only at the caret.

CM6 facts for this phase: only directly provided decorations can change block structure, and only indirectly provided ones can read the viewport.

## P3-T1: Inline layer

Build a `ViewPlugin` in `src/editor/livePreview/` that scans `view.visibleRanges` of the syntax tree. It reruns only when the doc, the viewport, the active block or the tree changes. It emits marks, hidden syntax and line decorations, and starts with headings.

**Done when:** heading tests pass, and decoration time stays flat between 1 MB and 10 MB.

## P3-T2: Emphasis and inline code

**Done when:** bold, italic, strikethrough and inline code render with hidden markers.

## P3-T3: Links, lists, blockquotes, rules

**Done when:** each renders styled, and link targets are hidden.

## P3-T4: Caret reveal

Reveal works per inline element, and per line for block markers. Hidden markers act as atomic ranges, with a transaction filter so selections can't land inside them. A selection spanning hidden syntax includes it.

Arrow keys and mouse clicks both need to land on real text positions.

**Done when:** scripted arrow-key walks over all fixtures never stick, and reveal updates within a frame.

## P3-T5: Source toggle and copy

Add a per-pane raw source toggle through a `Compartment`. Copy always yields raw Markdown.

**Done when:** toggling one pane leaves its sibling unchanged, and copying returns source bytes.

## P3-T6: Speed gate

Rerun all perf scenarios with preview on.

**Done when:** typing (ISC-7) and startup (ISC-4) meet their targets with preview on, and ISC-5 and ISC-6 still do. If one misses, the Speed gate in the ISA applies: stop, report the numbers and the cause, and wait for the owner. The 3 MiB plain-source cutoff is re-measured here too, and any change to it is the owner's call.
