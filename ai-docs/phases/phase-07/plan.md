# Phase 7: Search and outline

**Goal:** jump anywhere in a file or folder without slowing typing.

## P7-T1: Find and replace

Build Ctrl+F and Ctrl+H on `@codemirror/search`, with a shadcn-styled panel and regex and case options.

**Done when:** search tests pass.

## P7-T2: Folder search

Ctrl+Shift+F runs in Rust with the `ignore` and `grep-searcher` crates, streaming results over `Channel`. Each search has an ID and a cancel flag, and a new search stops the old one. Results render virtualized.

**Done when:** typing stays under 16 ms during a search.

## P7-T3: Outline

A Rust heading scan covers the whole file, regardless of CM6 parse progress. Dirty text reaches Rust on a debounce, only while the panel is open.

**Done when:** the outline reaches the last heading of the 10 MB fixture and reflects unsaved edits.
