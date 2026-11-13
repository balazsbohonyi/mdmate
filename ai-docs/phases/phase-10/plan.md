# Phase 10: Ship

**Goal:** a stranger can install mdmate, double-click a `.md` file, and trust it with a file someone else wrote.

## P10-T1: Launch handling

`tauri-plugin-single-instance` forwards arguments and working directory to the running app. Paths resolve against the second launch's directory.

**Done when:** launches from another folder with a relative path open the right file.

## P10-T2: Security review

Run `hostile.md` in the real app with Process Monitor and a packet capture. Review capabilities, CSP and every document-derived path, including the `<img>` tags Phase 9 draws (allowed attributes, address allowlist, no script or style from a document) and the paste and drop copy path (a folder inside the document's folder only).

**Done when:** no process starts, no SMB traffic appears, and the only network traffic is document images.

## P10-T3: Installer

Build NSIS with an opt-in `.md` and `.markdown` association.

**Done when:** a clean Windows run confirms the association appears only when ticked.

## P10-T4: Release

Adapt Riftle's `release.yml`: use `packageManager` for the pnpm version, and add the portable zip.

**Done when:** a version tag publishes both artifacts. Tagging needs the owner's go-ahead.

## P10-T5: README and final sweep

Write the README with install steps, features and screenshots. Rerun every probe, close remaining fog, and set `phase: complete` for v1.

**Done when:** all claims are closed on evidence.
