import type { OutlineHeading } from '@/platform'

/**
 * How the Outline draws its rows (P9.1-T14). Pure, so the rules are tested without a screen.
 *
 * The rows are a virtual list, so the height is one fixed number. It is the value of
 * `--spacing-outline-row` in `src/styles/tokens.css` (a test compares the two), taller than the
 * tree's 24 px because a heading is a line of reading and not a file name.
 */
export const OUTLINE_ROW_HEIGHT = 30

/** Space left of the top rank, as the tree's rows have. */
const BASE_INDENT = 12
/** What each rank is indented more than the one above it. */
const RANK_STEP = 16

/** Font sizes of H1, H2 and H3; H4 to H6 take the H3 size. All fit the row height. */
const H1_SIZE = '0.9375rem'
const H2_SIZE = '0.875rem'
const H3_SIZE = '0.8125rem'

/**
 * The text color classes from the top rank down: the sidebar text, two mixes of it with the muted
 * text (`src/styles/outline.css`), then the muted text. Ranks past the last stay at it.
 */
const INKS = [
  'text-sidebar-foreground',
  'outline-ink-1',
  'outline-ink-2',
  'text-muted-foreground',
] as const

/** The heading levels the document uses, lowest first. A document of H2 and H4 gives [2, 4]. */
export function levelsIn(headings: readonly OutlineHeading[]): number[] {
  return [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b)
}

/**
 * The levels drawn bold (P9.1-T24): the lowest level the document uses, always, also when it is the
 * only one. When that level occurs once (a title, an H2 that stands alone), the next level used is
 * bold too, so a lone title does not leave a bare run of lighter rows under it. One step and no
 * chain: a level that occurs once under the next one does not carry the weight further down.
 */
export function boldLevels(headings: readonly OutlineHeading[]): ReadonlySet<number> {
  const levels = levelsIn(headings)
  const [lowest, next] = levels
  if (lowest === undefined) return new Set()
  const bold = new Set([lowest])
  const lowestCount = headings.filter((heading) => heading.level === lowest).length
  if (lowestCount === 1 && next !== undefined) bold.add(next)
  return bold
}

/** The text color class of a heading's row; a selected row takes its color from the selection. */
export function rowInk(level: number, levels: readonly number[], selected: boolean): string {
  if (selected) return ''
  const rank = Math.max(0, levels.indexOf(level))
  return INKS[Math.min(rank, INKS.length - 1)] ?? INKS[0]
}

/** The inline style of one heading's row: its indent, size and weight. */
export function rowStyle(
  level: number,
  levels: readonly number[],
  bold: ReadonlySet<number>,
): { paddingLeft: string; fontSize: string; fontWeight?: string } {
  const rank = Math.max(0, levels.indexOf(level))
  const style: { paddingLeft: string; fontSize: string; fontWeight?: string } = {
    paddingLeft: `${String(BASE_INDENT + rank * RANK_STEP)}px`,
    fontSize: level <= 1 ? H1_SIZE : level === 2 ? H2_SIZE : H3_SIZE,
  }
  // Which levels are bold is `boldLevels`' rule; sizes, indent and inks do not change with it.
  if (bold.has(level)) style.fontWeight = '700'
  return style
}

/**
 * The heading whose section holds a line: the last heading at or above it, or -1 above the first.
 * The headings are in document order.
 */
export function sectionIndex(headings: readonly OutlineHeading[], line: number): number {
  let low = 0
  let high = headings.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((headings[middle]?.line ?? Infinity) <= line) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}
