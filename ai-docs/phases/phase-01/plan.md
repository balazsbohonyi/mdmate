# Phase 1: Workbench

**Goal:** the Sublime-style frame works with no document logic: empty tabs can be split, nested, dragged and resized.

## P1-T1: Tokens and themes

Define color, font, spacing, radius and syntax tokens in `src/styles/tokens.css`, mapped to shadcn-vue's variables and Tailwind's `@theme`. Ship original dark and light theme files.

**Done when:** changing one token value restyles chrome everywhere, and `no-hard-coded-colors` passes.

## P1-T2: App shell

Build the thin titlebar with a small app menu and window controls, the sidebar frame and the status bar. The window shows after first paint on a themed background.

**Done when:** all four regions show on first launch with no white frame.

## P1-T3: Split tree model

Write the framework-free `SplitNode` model in `src/workbench/`: split, close, move tab, resize, serialize. Closing collapses empty panes and single-child splits.

**Done when:** model tests cover the ISC-28 to ISC-31 cases, and serialize round-trips.

## P1-T4: Pane rendering

Render the tree recursively with shadcn-vue Resizable. Tab strips stay custom, for density.

**Done when:** three-level nested layouts render, and handles resize with no layout jump.

## P1-T5: Tab dragging

Build dragging on pointer events: a tab can move within a strip, to another pane, or to a pane edge to create a split, with a drop preview.

**Done when:** the drags work in both `pnpm dev` and `pnpm tauri dev`.

## P1-T6: Commands

Add a command registry with default keybindings, so menus, palette and shortcuts share one path. Add split, close tab and toggle sidebar commands.

**Done when:** each command runs from its shortcut.
