/**
 * Folder search: what the page asks for, what streams back, and the checks on it. Mirrors
 * `src-tauri/src/search/mod.rs`.
 */

import { count, flag, record, text } from './checks'

/** What the page asks for. */
export interface SearchRequest {
  /** Names this search. A search with a higher id stops the one before it. */
  readonly id: number
  readonly query: string
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  readonly regexp: boolean
}

/** One match. */
export interface SearchHit {
  /** The file, as people read the path. */
  readonly path: string
  /** Line of the match, from 1. */
  readonly line: number
  /** UTF-16 units from the start of the line to the start of the match. */
  readonly column: number
  /** The line, trimmed and cut round the match, for the list. */
  readonly text: string
  /** Where the match starts in `text`, in UTF-16 units. */
  readonly start: number
  /** How long the shown part of the match is, in UTF-16 units. */
  readonly length: number
}

/** What a search found since the last batch. */
export interface SearchBatch {
  readonly id: number
  readonly hits: readonly SearchHit[]
  /** Text files read so far. */
  readonly scanned: number
}

/** How a search ended. */
export interface SearchSummary {
  readonly id: number
  readonly scanned: number
  /** Files with at least one hit. */
  readonly files: number
  readonly hits: number
  /** Files and folders that were not read. */
  readonly skipped: number
  /** There were more than the limit; the rest are not listed. */
  readonly truncated: boolean
  /** Another search began, or this one was cancelled, before it finished. */
  readonly stopped: boolean
  /** Why nothing was searched: a pattern the engine cannot run. */
  readonly error: string | null
}

/** The most hits one search lists. Rust's `MAX_HITS`. */
export const MAX_SEARCH_HITS = 10_000

/** Checks one batch from the channel. */
export function parseSearchBatch(value: unknown): SearchBatch {
  const batch = record(value)
  const hits = batch.hits
  if (!Array.isArray(hits)) throw new Error('hits is not a list')
  return {
    id: count(batch, 'id', 0),
    scanned: count(batch, 'scanned', 0),
    hits: (hits as unknown[]).map((item) => {
      const hit = record(item)
      return {
        path: text(hit, 'path'),
        line: count(hit, 'line', 1),
        column: count(hit, 'column', 0),
        text: text(hit, 'text'),
        start: count(hit, 'start', 0),
        length: count(hit, 'length', 0),
      }
    }),
  }
}

/** Checks the answer of `search_folders`. */
export function parseSearchSummary(value: unknown): SearchSummary {
  const summary = record(value)
  const error = summary.error
  if (error !== null && typeof error !== 'string') throw new Error('error is not text')
  return {
    id: count(summary, 'id', 0),
    scanned: count(summary, 'scanned', 0),
    files: count(summary, 'files', 0),
    hits: count(summary, 'hits', 0),
    skipped: count(summary, 'skipped', 0),
    truncated: flag(summary, 'truncated'),
    stopped: flag(summary, 'stopped'),
    error: error ?? null,
  }
}
