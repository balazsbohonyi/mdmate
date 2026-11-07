# Phase 5: Links and editing

**Goal:** following links and everyday formatting are one gesture each, and a hostile link can do nothing.

## P5-T1: Link guard

One Rust module decides what any document-derived target may do. Only `http`, `https` and `mailto` reach the opener. Default-app opens ask first unless the file is Markdown or an image. UNC and `file://host/` targets are refused before any filesystem call.

The path table includes `\\host\share`, `//host/share`, `\\?\UNC\host\share` and percent-encoded `%5C%5Chost`.

**Done when:** property tests over schemes and the path table pass.

## P5-T2: Navigation

Ctrl+click resolves a target and acts on it: `.md` in a new tab, `#heading` as a jump, web links in the browser. A plain click only places the caret. Heading slugs follow GitHub's algorithm.

**Done when:** every link type behaves as claimed.

## P5-T3: Broken links and history

Check relative targets in the background and style missing ones. Alt+Left and Alt+Right walk location history across tabs.

**Done when:** missing targets show the broken style, and history crosses tabs.

## P5-T4: Format commands

Add commands for bold, italic, link, inline code, strikethrough, and heading up and down, each through the command registry. Toggles work both ways.

**Done when:** command tests pass in both directions.

## P5-T5: List editing

Enter continues lists and checkboxes, Enter on an empty item ends the list, and Tab and Shift+Tab indent. `insertNewlineContinueMarkup` is the starting point.

**Done when:** list tests pass.

## P5-T6: Smart paste and selection

Pasting a URL over a selection creates a link. `allowMultipleSelections` stays off.

**Done when:** paste tests pass, and a second range is never kept.

## P5-T7: Drag selected text

CM6's own text drag does not work while native file drops are on (P0-T9), so build it on pointer events. Pressing on a non-empty selection starts the drag, a drop caret follows the pointer through `posAtCoords`, and releasing moves the text in one transaction with `userEvent: "move.drop"`. Esc cancels, dropping inside the selection does nothing, and the editor scrolls when the pointer nears its edge.

**Done when:** the move and undo tests pass, and a drag works in the real app with native drops on.
