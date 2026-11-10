/**
 * Find File References: the links that lead to one file, and the check on what Rust answers.
 * Mirrors `src-tauri/src/links/references.rs`.
 */

/** One link that leads to the file. */
export interface Reference {
  /** The file the link is written in, as people read the path. */
  readonly path: string
  /** Line of the link, from 1. */
  readonly line: number
  /** UTF-16 units from the start of that line to the start of the link's target. */
  readonly column: number
  /** The line, trimmed and cut, for the list. */
  readonly text: string
}

/** A file whose links were not checked, and why. */
export interface ReferenceProblem {
  readonly path: string
  readonly reason: string
}

/** What a search found. */
export interface ReferencesFound {
  /** By file, then by line. */
  readonly references: readonly Reference[]
  /** How many files hold at least one. */
  readonly files: number
  /** Text files read. */
  readonly scanned: number
  readonly skipped: readonly ReferenceProblem[]
  /** There were more than the limit; the rest are not listed. */
  readonly truncated: boolean
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('not an object')
  }
  return value as Record<string, unknown>
}

function text(object: Record<string, unknown>, field: string): string {
  const value = object[field]
  if (typeof value !== 'string') throw new Error(`${field} is not text`)
  return value
}

function count(object: Record<string, unknown>, field: string, least: number): number {
  const value = object[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < least) {
    throw new Error(`${field} is not a count`)
  }
  return value
}

function list(object: Record<string, unknown>, field: string): unknown[] {
  const value = object[field]
  if (!Array.isArray(value)) throw new Error(`${field} is not a list`)
  return value as unknown[]
}

/** Checks the answer of `find_references`. */
export function parseReferencesFound(value: unknown): ReferencesFound {
  const found = record(value)
  if (typeof found.truncated !== 'boolean') throw new Error('truncated is not a flag')
  return {
    references: list(found, 'references').map((item) => {
      const entry = record(item)
      return {
        path: text(entry, 'path'),
        line: count(entry, 'line', 1),
        column: count(entry, 'column', 0),
        text: text(entry, 'text'),
      }
    }),
    files: count(found, 'files', 0),
    scanned: count(found, 'scanned', 0),
    skipped: list(found, 'skipped').map((item) => {
      const entry = record(item)
      return { path: text(entry, 'path'), reason: text(entry, 'reason') }
    }),
    truncated: found.truncated,
  }
}
