# Phase 2 decisions

Deviations from the plan and choices it left open. Numbers carry the OS they came from.

## Checking the UI (all of Phase 2)

- **Same as Phase 1.** Browser checks use Claude in Chrome on `pnpm dev`; real-window checks use `pnpm tauri dev` with real OS input and screenshots over the WebView2 DevTools port (see "Checking the UI" in the Phase 1 decisions).
- **Rust tests never touch real files.** Fixtures are read from the repo and copied into temp folders before anything is saved.

## Dependencies added in Phase 2

| Crate | Version | Why |
|---|---|---|
| `xxhash-rust` (feature `xxh3`) | 0.8.19 | Content hash for own-save detection and the journal. XXH3-128 is fixed by its specification, so a hash written in one session means the same thing in the next. Pure Rust, no network. |
| `serde_json` | 1 | Was a dev-dependency; the document frame header is JSON. Already in the build graph through Tauri. |
| `rfd` (features `common-controls-v6`, `gtk3`) | 0.17.2 | The system open dialog, called from Rust. See "Open dialog" below. |

## P2-T1

- **Rust owns the whole byte transform; the page owns the text.** `open_file` returns one raw frame: a JSON header, the line-ending exceptions as little-endian `u32` pairs, and the text as UTF-8 with `\n` as its only break (BOM stripped, UTF-16 transcoded). `save_file` takes the same frame back. Rust joins the endings, re-encodes with the original BOM and encoding, and writes. This was the advisor's call: the ISC-1 and ISC-2 probes are Rust tests, so the code that touches bytes has to be Rust. The layout is in the header comment of `src-tauri/src/fs/frame.rs`; the page's half (`src/platform/frame.ts`) arrives in T2 and must change with it.
- **Only the breaks that differ from the dominant ending are sent.** A plain CRLF or LF file carries no list; a mixed one carries a short one. The dominant ending is the most common one, the first to appear wins a tie, and `\n` when the file has no breaks. The pairs start on a 4-byte boundary (header padded with zeros) so the page can read them as a `Uint32Array` without copying.
- **A round-trip guard runs at every open.** If decoding, splitting, joining and encoding again would not give the same bytes, the document opens read-only (`not-round-trippable`) and a save is refused. This makes ISC-1 hold for any file, not only the fixtures. With a mutated `join` the fixture test failed and the random-bytes test still passed, because the guard turned the damaged files read-only: that is the guard doing its job.
- **Supported encodings: UTF-8 (with or without BOM), UTF-16 LE and BE (with BOM).** Everything else opens read-only as `unsupported-encoding` with every byte shown as the Latin-1 character of the same number, so nothing is dropped from view. UTF-16 without a BOM is not detected: it would be guessed, and a wrong guess can change bytes. Invalid UTF-16 (a lone surrogate, an odd byte count) is unsupported, since it could not be written back.
- **Atomic save.** A temp file next to the target (`.name.mdmate-<pid>-<n>.tmp`) is written, flushed with `sync_all`, given the original's permissions, then renamed over the target. A failure anywhere removes the temp file and leaves the original as it was. The test hook is a closure called just before the rename (`write_atomic_with`), so ISC-40's failure is injected without any global state. The target is the resolved path, so a symlink stays a symlink.
- **Path policy: the page may only touch files Rust saw the user choose, or files inside an open workspace folder.** `read_file` and `open_file` check every path (`src-tauri/src/access.rs`) against two sets: single files granted one by one, and workspace roots. Paths are compared resolved (symlinks and `..` followed), so a link inside a root cannot lead out of it, and case-folded where the OS ignores case. Network (UNC) paths are refused. Only Rust's own events grant: the open dialog today, a restored session in T6, a folder picker and launch arguments later. The page has no command that grants, because a page that can grant itself access has no limit at all. Phase 2 grants single files only; roots wait for Phase 6, so `grant_root` is built and tested but unused in a normal build (perf builds use it for the fixtures folder).
- **The page saves by a document id, never by a path.** Rust issues the id on `open_file` and remembers the resolved path, the format and the last known hash. Opening the same file again, however spelled, returns the same id (this is also what ISC-174 rests on). A save for an unknown id, a closed one or a read-only one is refused. The id travels in the `x-document-id` header, a plain number, because header values must be ASCII and file names are not.
- **Open dialog: `rfd` directly, not `tauri-plugin-dialog`.** The plugin pulls `tauri-plugin-fs` into the build graph (`cargo tree -i tauri-plugin-fs` shows it under the dialog plugin). It would never be initialized and the page would have no `fs:` permission, but ISC-21 says the crate is absent, and "absent" is the safer reading. `rfd` is what the plugin wraps, with the same feature set. The dialog runs in `spawn_blocking`, parented to the window, and the page gets no `dialog:` permission.
- **Case folding sits behind the platform trait** (`Platform::paths_ignore_case`: true on Windows and macOS, false on Linux), so `check-arch` keeps `target_os` inside `platform/`. macOS volumes can be case-sensitive; the default is assumed.
- **Mutation proofs (the code broken on purpose, then restored):**
  - `join` ignoring the exceptions: `roundtrip_unedited_gives_back_every_byte_of_every_fixture` and `roundtrip_unedited_through_the_file_system_keeps_the_hash` fail.
  - `encode` dropping the UTF-8 BOM: the same two fail.
  - Saving straight to the target instead of through a temp file: `atomic_save_failure_before_the_rename_leaves_the_original_intact` and `atomic_save_failure_leaves_a_missing_file_missing` fail.
  - The restored code passes all 67 Rust tests.
- **ISC-37 is not closed here.** Its probe passes (`save_writes_edits_in_every_supported_encoding`), but the claim says Ctrl+S, and the shortcut does not exist until the Save command is wired in T2. It closes there, as ISC-169 moved from T1 to T3 in Phase 0.
- **ISC-1 closes on the Rust probe.** The page half (the frame codec and the store passing text through unchanged) is covered by a web test in T2. If that finds a gap, ISC-1 reopens.
