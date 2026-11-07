/**
 * The size cutoff from the P0 measurements: a file above this many bytes opens as plain source,
 * with no Markdown parser, no highlighting and (from Phase 3) no live preview. The parser is what
 * makes typing slow at size, and plain text stays well under the 16 ms budget at 10 MB. "3 MB" is
 * 3 MiB, the unit the fixtures use. Phase 3 measures the real live-preview layer and may lower it.
 */
export const LARGE_FILE_BYTES = 3 * 1024 * 1024

/** True when a file of this many bytes opens as plain source. A file of exactly the cutoff does not. */
export function isLargeFile(bytes: number): boolean {
  return bytes > LARGE_FILE_BYTES
}

/** What the pane says about a document that opened as plain source. */
export const LARGE_FILE_NOTICE =
  'Plain text: files above 3 MB open without live preview or highlighting, so typing stays fast.'
