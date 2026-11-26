/**
 * Where live preview draws the lines of a list, as plain facts from the syntax tree. The list text,
 * the tables and the code blocks inside list items all read it, so they move together.
 *
 * Every nesting level is drawn twice as far in as its source indentation. Nothing is rewritten: an
 * invisible copy of the item's own indentation is drawn before each of its lines, which doubles the
 * width in any font and with tabs. A line gets the copy of the marker line of its innermost item,
 * so the text, the tables and the code under an item keep their place under its text.
 *
 * The gap below a whole list is one line of body text. A blank line is already that gap.
 */
import type { syntaxTree } from '@codemirror/language'
import type { Text } from '@codemirror/state'

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

/** One line of body text, as a length: the height of the gap below a list. */
export const LIST_GAP = 'calc(var(--doc-line-height, 1.5) * var(--doc-size, 16px))'

export interface ItemShift {
  /** How many block quotes are around the item. Its indentation starts after their marks. */
  readonly quotes: number
  /** The blanks drawn a second time, empty for an item at the margin. */
  readonly text: string
}

const QUOTE_MARK = /^[ \t]{0,3}>[ \t]?/
/** A line with nothing on it but blanks and quote marks. */
const BLANK = /^[ \t>]*$/

/** How many characters of `line` are the marks of the first `quotes` block quotes around it. */
export function quotePrefix(line: string, quotes: number): number {
  let at = 0
  for (let n = 0; n < quotes; n++) {
    const mark = QUOTE_MARK.exec(line.slice(at))
    if (mark === null) break
    at += mark[0].length
  }
  return at
}

/** The nearest list item at or above `node`, or null. */
export function itemOf(node: SyntaxNode | null): SyntaxNode | null {
  for (let up = node; up !== null; up = up.parent) if (up.name === 'ListItem') return up
  return null
}

/**
 * The shift of the lines of `item`: the blanks before its marker. An item whose marker follows
 * another marker on one line (`- - a`) starts where that line's first item does, so it takes the
 * shift of the item around it.
 */
export function itemShift(doc: Text, item: SyntaxNode): ItemShift {
  let quotes = 0
  for (let up = item.parent; up !== null; up = up.parent) if (up.name === 'Blockquote') quotes++
  // The node of a list indented at the margin can start at its line, so the marker says where.
  const marker = item.getChild('ListMark')?.from ?? item.from
  const line = doc.lineAt(marker)
  const lead = line.text.slice(quotePrefix(line.text, quotes), marker - line.from)
  if (/^[ \t]*$/.test(lead)) return { quotes, text: lead }
  const outer = itemOf(item.parent)
  return { quotes, text: outer === null ? '' : itemShift(doc, outer).text }
}

/** Whether a line has text to move: an empty one keeps the caret where it is typed. */
export function hasText(line: string): boolean {
  return !BLANK.test(line)
}

/** The list around `node` that sits in no other list, or null when `node` is in none. */
export function outermostList(node: SyntaxNode): SyntaxNode | null {
  let found: SyntaxNode | null = null
  for (let up: SyntaxNode | null = node; up !== null; up = up.parent) {
    if (up.name === 'BulletList' || up.name === 'OrderedList') found = up
  }
  return found
}

/**
 * The number of the line that carries the gap below `list`: its last line with text, when other
 * text follows on the very next line. Null when a blank line follows, or nothing does.
 */
export function gapLine(doc: Text, list: SyntaxNode): number | null {
  let n = doc.lineAt(list.to).number
  const first = doc.lineAt(list.from).number
  while (n > first && !hasText(doc.line(n).text)) n--
  return n < doc.lines && hasText(doc.line(n + 1).text) ? n : null
}
