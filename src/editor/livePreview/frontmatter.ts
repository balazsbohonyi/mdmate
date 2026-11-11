/**
 * Where YAML frontmatter is, found from the text and not from the syntax tree.
 *
 * The Markdown parser reads `---` as a rule and the lines under it as a paragraph or a heading,
 * and a parser extension that claimed the block would have to look ahead for the closing line.
 * CodeMirror reuses the parse of an unchanged first line when something is typed further down, so
 * typing the closing `---` would not turn the block on until the document was parsed again from
 * scratch. Reading the text has no such memory: it gives the same answer for the same text.
 *
 * Both live-preview layers ask here and leave this range alone, so nothing in it is styled or
 * drawn as a heading, a table or an image.
 */
import type { Text } from '@codemirror/state'

/** The most lines a frontmatter block may span, closing line included. A longer one is not frontmatter. */
export const FRONTMATTER_MAX_LINES = 200

const OPENING = /^---[ \t]*$/
const CLOSING = /^(?:---|\.\.\.)[ \t]*$/

/**
 * The end of the frontmatter at the very start of `doc` (the end of its closing line), or null
 * when the document does not start with a complete block. The block starts at position 0.
 */
export function frontmatterEnd(doc: Text): number | null {
  if (doc.lines < 2 || !OPENING.test(doc.line(1).text)) return null
  const last = Math.min(doc.lines, FRONTMATTER_MAX_LINES)
  for (let n = 2; n <= last; n++) {
    const line = doc.line(n)
    if (CLOSING.test(line.text)) return line.to
  }
  return null
}
