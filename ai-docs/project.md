# mdmate: product requirements

Claims live in `../ISA.md`. Stories here cite claim IDs as their acceptance criteria and never restate them.

## Introduction

mdmate is a desktop Markdown viewer and editor. Markdown renders where you type, in the Obsidian live-preview style, and syntax appears only at the caret. The window works like SublimeText, with tabs, a folder sidebar, free splits and command palettes.

It solves a specific gap. Fast editors show raw Markdown, viewers can't edit, and note-taking apps bring vaults and weight. mdmate opens any Markdown file instantly and keeps it byte-exact.

## Goals

- Open and render Markdown fast enough to feel instant (ISC-4 to ISC-7).
- Never change a byte the writer didn't change (ISC-1 to ISC-3).
- Edit inline with syntax revealed only at the caret (F3).
- Feel like SublimeText: dense, keyboard-driven, freely split (F1).
- Change the whole look through design tokens (ISC-14, F9).
- Stay safe with files written by strangers (ISC-15 to ISC-20).
- Add macOS and Linux later by implementing platform traits only (ISC-9 to ISC-13).

## Audience

The first user is the author, who wants a daily Markdown tool. Beyond that, mdmate is for developers and writers who keep Markdown in folders and git repos. It ships as MIT open source through GitHub Releases.

## User stories

**US-001: See a file instantly.** As a writer, I want a Markdown file on screen right after launch, so opening a file never breaks my flow. Acceptance: ISC-4, ISC-5, ISC-27.

**US-002: Edit in place.** As a writer, I want rendered text that I edit directly, so I never switch between source and preview. Acceptance: ISC-50 to ISC-58.

**US-003: Move through text normally.** As a writer, I want the caret to behave as if the syntax weren't hidden, so editing feels natural. Acceptance: ISC-59, ISC-60.

**US-004: See raw source.** As a writer, I want a raw view per pane, so I can inspect exact syntax beside the rendered page. Acceptance: ISC-61, ISC-62.

**US-005: Read rich documents.** As a reader, I want tables, images, frontmatter and code rendered, so real documents look finished. Acceptance: ISC-64 to ISC-72.

**US-006: Trust my files.** As a git user, I want diffs that show only my edits, so the editor never adds noise. Acceptance: ISC-1, ISC-2, ISC-3, ISC-40.

**US-007: Never lose work.** As a writer, I want unsaved edits to survive closing or crashing, so I never think about them. Acceptance: ISC-47, ISC-48, ISC-49.

**US-008: Handle outside changes.** As a git user, I want files changed on disk to update safely, so a pull never overwrites my work. Acceptance: ISC-44, ISC-45, ISC-46.

**US-009: Arrange my workspace.** As a power user, I want free splits and draggable tabs, so I can lay out documents my way. Acceptance: ISC-25, ISC-28 to ISC-34, ISC-171, ISC-172, ISC-174, ISC-176.

**US-010: See one file twice.** As a writer, I want the same file in two panes, staying in sync, so I can read one part while editing another. Acceptance: ISC-41, ISC-42, ISC-43.

**US-011: Follow links.** As a reader, I want Ctrl+click to follow any link and Alt+Left to come back, so documentation reads like a website. Acceptance: ISC-74 to ISC-82.

**US-012: Format quickly.** As a writer, I want shortcuts and smart lists, so formatting stays in my fingers. Acceptance: ISC-83 to ISC-95.

**US-013: Manage files.** As a user, I want to create, rename, move and delete from the sidebar, so I rarely need Explorer. Acceptance: ISC-97 to ISC-105, ISC-132.

**US-014: Keep links intact.** As a user, I want every link in my workspace updated when I rename or move a file, so nothing breaks. Acceptance: ISC-113 to ISC-129, ISC-175.

**US-015: View images.** As a user, I want images to open in their own tab, so I can check assets without leaving. Acceptance: ISC-107 to ISC-112.

**US-016: Find anything.** As a user, I want find, folder search, quick open and an outline, so I can jump anywhere. Acceptance: ISC-130, ISC-131, ISC-133 to ISC-144.

**US-017: Add images.** As a writer, I want to paste, drop and resize images, so screenshots take seconds. Acceptance: ISC-154 to ISC-160.

**US-018: Make it mine.** As a user, I want settings, keybindings and themes as files, so I can change everything without rebuilding. Acceptance: ISC-145 to ISC-153.

**US-019: Open safely.** As a user, I want hostile documents to be harmless, so I can open anything. Acceptance: ISC-15 to ISC-20, ISC-112, ISC-173.

**US-020: Install it.** As a stranger, I want an installer or a portable zip and a double-click that works, so I can start in a minute. Acceptance: ISC-161 to ISC-170.

## Non-goals

See `## Out of Scope` in `../ISA.md`.

## Design considerations

- Density over decoration: thin titlebar, compact tabs, small status bar.
- Original dark and light themes, inspired by SublimeText's feel with no copied assets.
- shadcn-vue covers dialogs, menus, inputs and the palette; tab strips and rows stay custom, for density and speed.

## Technical considerations

See `architecture/architecture.md` and `## Constraints` in `../ISA.md`.

## Success metrics

- All `critical` claims in `../ISA.md` hold on every release.
- Speed targets hold on the 1 MB fixture on the owner's Windows machine.
- The author uses mdmate as their default Markdown app for a full week without opening another editor for Markdown.

## Open questions

Tracked as fog in `## Not yet specified` in `../ISA.md`.
