import { LINKS_ON_RENAME, type LinksOnRename } from '@/lib/settings'
import { parseMoved, type Moved } from './workspace'

/**
 * Types for rewriting links when a file or folder moves, and the checks on what Rust answers.
 * Mirrors `src-tauri/src/links/flow.rs`.
 */

/** What the user asked for. */
export type RewriteChange =
  | { readonly kind: 'rename'; readonly name: string }
  | { readonly kind: 'move'; readonly into: string }

/** The text of an open document, as the editor holds it now. */
export interface RewriteBuffer {
  readonly id: number
  readonly text: string
}

/** A file and why it was not scanned or not written. */
export interface RewriteProblem {
  readonly path: string
  readonly reason: string
}

/** What the scan found, for the question the page asks. */
export interface RewritePlanned {
  /** Names this plan in `rewriteMove`. Zero when there is nothing to do. */
  readonly token: number
  readonly links: number
  readonly files: number
  readonly scanned: number
  readonly binary: number
  readonly skipped: readonly RewriteProblem[]
  readonly unrelatable: number
  /** The user stopped the scan; nothing was kept. */
  readonly cancelled: boolean
  /** The open documents whose text was counted, so the page must send it again with the move. */
  readonly buffers: readonly number[]
}

/** One change to the text of a document, counted in UTF-16 units from its start. */
export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/** What the rewrite did. */
export interface RewriteDone {
  readonly moved: Moved
  readonly written: readonly string[]
  readonly failed: readonly RewriteProblem[]
  /** Open documents without edits whose file was written: reload them. */
  readonly reload: readonly number[]
  /** Open documents the page held edits in: apply these to their text. */
  readonly edits: readonly { readonly id: number; readonly changes: readonly TextChange[] }[]
  readonly unrelatable: number
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

function count(object: Record<string, unknown>, field: string): number {
  const value = object[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} is not a count`)
  }
  return value
}

function list(object: Record<string, unknown>, field: string): unknown[] {
  const value = object[field]
  if (!Array.isArray(value)) throw new Error(`${field} is not a list`)
  return value as unknown[]
}

function problems(object: Record<string, unknown>, field: string): RewriteProblem[] {
  return list(object, field).map((item) => {
    const entry = record(item)
    return { path: text(entry, 'path'), reason: text(entry, 'reason') }
  })
}

function numbers(object: Record<string, unknown>, field: string): number[] {
  return list(object, field).map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item))
      throw new Error(`${field} holds a non-number`)
    return item
  })
}

/** Checks the answer of `links_on_rename_override`: one of the three values, or null for nothing. */
export function parseLinksOnRename(value: unknown): LinksOnRename | null {
  if (value === null || value === undefined) return null
  const found = LINKS_ON_RENAME.find((mode) => mode === value)
  if (found === undefined) throw new Error('links_on_rename_override: not a setting value')
  return found
}

/** Checks the answer of `rewrite_plan`. */
export function parseRewritePlanned(value: unknown): RewritePlanned {
  const planned = record(value)
  if (typeof planned.cancelled !== 'boolean') throw new Error('cancelled is not a flag')
  return {
    token: count(planned, 'token'),
    links: count(planned, 'links'),
    files: count(planned, 'files'),
    scanned: count(planned, 'scanned'),
    binary: count(planned, 'binary'),
    skipped: problems(planned, 'skipped'),
    unrelatable: count(planned, 'unrelatable'),
    cancelled: planned.cancelled,
    buffers: numbers(planned, 'buffers'),
  }
}

/** Checks the answer of `rewrite_move`. */
export function parseRewriteDone(value: unknown): RewriteDone {
  const done = record(value)
  return {
    moved: parseMoved(done.moved),
    written: list(done, 'written').map((item) => {
      if (typeof item !== 'string') throw new Error('written holds a non-path')
      return item
    }),
    failed: problems(done, 'failed'),
    reload: numbers(done, 'reload'),
    edits: list(done, 'edits').map((item) => {
      const entry = record(item)
      const id = count(entry, 'id')
      return {
        id,
        changes: list(entry, 'changes').map((change) => {
          const one = record(change)
          return { from: count(one, 'from'), to: count(one, 'to'), insert: text(one, 'insert') }
        }),
      }
    }),
    unrelatable: count(done, 'unrelatable'),
  }
}
