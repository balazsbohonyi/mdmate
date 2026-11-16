import { settings } from '@/lib/settings'

/**
 * The size cutoff from the P0 measurements: a file above this many bytes opens as plain source,
 * with no Markdown parser, no highlighting and (from Phase 3) no live preview. The parser is what
 * makes typing slow at size, and plain text stays well under the 16 ms budget at 10 MB. "3 MB" is
 * 3 MiB, the unit the fixtures use. Phase 3 measures the real live-preview layer and may lower it.
 * This is the default; `files.largeFileMB` changes it.
 */
export const LARGE_FILE_BYTES = 3 * 1024 * 1024

/** The cutoff in force, in bytes: `files.largeFileMB` from settings.json, 3 MB until it says otherwise. */
export function largeFileBytes(): number {
  return settings.files.largeFileMB * 1024 * 1024
}

/**
 * True when a file of this many bytes opens as plain source. A file of exactly the cutoff does not.
 * The setting is read when a file opens, so a file already open keeps the mode it opened in.
 */
export function isLargeFile(bytes: number): boolean {
  return bytes > largeFileBytes()
}

/** What the pane says about a document that opened as plain source. */
export function largeFileNotice(): string {
  return `Plain text: files above ${String(settings.files.largeFileMB)} MB open without live preview or highlighting, so typing stays fast.`
}
