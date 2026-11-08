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

/** How many characters of keys the pill lists before it stops. */
const KEYS_LIMIT = 48

/**
 * The top-level keys of a frontmatter block, joined by commas, for the pill. Only a plain `key:`
 * at the start of a line counts; nested keys and list items do not. Long lists are cut with an
 * ellipsis. The text is never parsed as YAML: this is a label, and a wrong guess costs nothing.
 */
export function frontmatterKeys(source: string): string {
  const keys: string[] = []
  const lines = source.split('\n')
  // The first and last lines are the fences.
  for (const line of lines.slice(1, -1)) {
    const match = /^([A-Za-z0-9_][A-Za-z0-9_ .-]*?)[ \t]*:(?:[ \t]|$)/.exec(line)
    if (match?.[1] !== undefined) keys.push(match[1])
  }
  let out = ''
  for (const key of keys) {
    const next = out === '' ? key : `${out}, ${key}`
    if (next.length > KEYS_LIMIT) return `${out === '' ? key.slice(0, KEYS_LIMIT) : out}…`
    out = next
  }
  return out
}
