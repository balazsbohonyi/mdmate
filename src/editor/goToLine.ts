import {
  EditorSelection,
  type EditorState,
  type Text,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * A jump to a line, for the Go to line box and for whatever else names a line of a file. Lines are
 * source lines counted from 1, frontmatter included, as in the gutter. A column counts characters
 * from 1. A number out of range means the nearest line or column.
 */

export interface LineTarget {
  readonly line: number
  readonly column: number
}

/** `12` or `12:5` as typed, or null when it is neither. A colon with nothing after it is column 1. */
export function parseLineTarget(text: string): LineTarget | null {
  const match = /^\s*(\d+)\s*(?::\s*(\d*)\s*)?$/.exec(text)
  if (match === null) return null
  const column = match[2]
  return {
    line: Number(match[1]),
    column: column === undefined || column === '' ? 1 : Number(column),
  }
}

/** The document position of a target, clamped into the document. */
export function positionOf(doc: Text, target: LineTarget): number {
  const line = doc.line(Math.max(1, Math.min(doc.lines, target.line)))
  let offset = 0
  let column = 1
  for (const character of line.text) {
    if (column >= target.column) break
    offset += character.length
    column += 1
  }
  return line.from + offset
}

/** The column of a position, counted as `positionOf` counts it. */
export function columnAt(doc: Text, pos: number): number {
  const line = doc.lineAt(pos)
  return [...line.text.slice(0, pos - line.from)].length + 1
}

/** Puts the caret on the target and the line in the middle of the view. */
export function jumpSpec(state: EditorState, target: LineTarget): TransactionSpec {
  const pos = positionOf(state.doc, target)
  return {
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  }
}
