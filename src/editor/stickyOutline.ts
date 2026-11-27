import type { ChangeDesc, Text } from '@codemirror/state'

/**
 * The headings of a document as sticky headings need them, and which of them stand over a given
 * spot. Positions are the starts of the heading lines. `parents` and `ends` are indices into the
 * same lists (or -1), so moving the positions along an edit leaves them right.
 */
export interface Outline {
  readonly positions: readonly number[]
  /** The heading this one is under. */
  readonly parents: readonly number[]
  /** The next heading that ends this one's section: the next of its level or a higher one. */
  readonly ends: readonly number[]
}

export const EMPTY_OUTLINE: Outline = { positions: [], parents: [], ends: [] }

/** Where a line is drawn, as a height in the document. */
export interface LineHeight {
  readonly top: number
  readonly height: number
}

/** The most rows: one for each heading level. */
const LEVELS = 6

export function buildOutline(
  doc: Text,
  headings: readonly { readonly level: number; readonly line: number }[],
): Outline {
  const positions: number[] = []
  const parents: number[] = []
  const ends: number[] = []
  /** The headings whose sections are open, outermost first. */
  const open: { index: number; level: number }[] = []
  for (const { level, line } of headings) {
    if (line < 1 || line > doc.lines) continue
    const index = positions.length
    for (let last = open.at(-1); last !== undefined && last.level >= level; last = open.at(-1)) {
      ends[last.index] = index
      open.pop()
    }
    positions.push(doc.line(line).from)
    parents.push(open.at(-1)?.index ?? -1)
    ends.push(-1)
    open.push({ index, level })
  }
  return { positions, parents, ends }
}

export function mapOutline(outline: Outline, changes: ChangeDesc): Outline {
  if (changes.empty || outline.positions.length === 0) return outline
  return { ...outline, positions: outline.positions.map((pos) => changes.mapPos(pos, 1)) }
}

/** The last heading that passes `before`, which holds for a leading run of them only; or -1. */
function lastWhere(outline: Outline, before: (pos: number) => boolean): number {
  let low = 0
  let high = outline.positions.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (before(outline.positions[middle] ?? 0)) low = middle + 1
    else high = middle
  }
  return low - 1
}

/** A heading and those above it, outermost first. */
function chain(outline: Outline, index: number): number[] {
  const found: number[] = []
  for (let at = index; at >= 0; at = outline.parents[at] ?? -1) found.unshift(at)
  return found
}

/**
 * The headings that stand at the top of a view whose top is at the height `top`. Row by row: a
 * heading takes a row once the middle of its line has passed above the row's top, and gives it up
 * as the next heading of its level reaches the row. So a stack never covers a line that has as many
 * rows' room above it as it has headings over it (`depthAt`), which is what keeps the caret and the
 * target of a jump in sight.
 */
export function stackAt(
  outline: Outline,
  top: number,
  rowHeight: number,
  lineAt: (pos: number) => LineHeight,
): number[] {
  const rows: number[] = []
  for (let row = 0; row < LEVELS; row++) {
    const y = top + row * rowHeight
    const above = lastWhere(outline, (pos) => {
      const line = lineAt(pos)
      return line.top + line.height / 2 < y
    })
    const next = chain(outline, above)[row]
    if (next === undefined) break
    const end = outline.ends[next] ?? -1
    if (end >= 0 && lineAt(outline.positions[end] ?? 0).top < y + rowHeight) break
    rows.push(next)
  }
  return rows
}

/**
 * How many headings can stand over the line from `from` to `to`: the headings it is under, itself
 * left out when it is a heading.
 */
export function depthAt(outline: Outline, from: number, to: number): number {
  const index = lastWhere(outline, (pos) => pos <= to)
  if (index < 0) return 0
  const depth = chain(outline, index).length
  return (outline.positions[index] ?? 0) >= from ? depth - 1 : depth
}
