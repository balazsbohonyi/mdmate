/**
 * The outline: what the page asks for and what comes back, with the checks on it. Mirrors
 * `src-tauri/src/outline/mod.rs`.
 */
import { count, flag, record, text } from './checks'

/** What the page asks for: the text of a document with edits not yet saved, or the path of a file. */
export interface OutlineRequest {
  /** Names this scan, so a late answer can be told from the newest. */
  readonly id: number
  readonly text?: string
  readonly path?: string
}

/** A heading. */
export interface OutlineHeading {
  /** 1 to 6. */
  readonly level: number
  /** The line it starts on, from 1. */
  readonly line: number
  /** What it says, as written, without the `#` signs. */
  readonly text: string
}

/** What a scan found. */
export interface OutlineAnswer {
  readonly id: number
  readonly headings: readonly OutlineHeading[]
  /** There were more headings than Rust lists. */
  readonly truncated: boolean
}

/** The most headings one scan lists. Rust's `MAX_HEADINGS`. */
export const MAX_OUTLINE_HEADINGS = 50_000

/** Checks the answer of `outline_scan`. */
export function parseOutlineAnswer(value: unknown): OutlineAnswer {
  const answer = record(value)
  const headings = answer.headings
  if (!Array.isArray(headings)) throw new Error('headings is not a list')
  return {
    id: count(answer, 'id', 0),
    truncated: flag(answer, 'truncated'),
    headings: (headings as unknown[]).map((item) => {
      const heading = record(item)
      const level = count(heading, 'level', 1)
      if (level > 6) throw new Error('level is not a heading level')
      return { level, line: count(heading, 'line', 1), text: text(heading, 'text') }
    }),
  }
}
