/**
 * What live preview does to a stretch of the document, as plain data.
 *
 * `scanPreview` reads the syntax tree over the ranges it is given and returns every mark, hidden
 * range and line style that stretch needs, given where the selection is. It touches nothing but
 * the state, so the decorations (which scan the visible ranges), the atomic ranges and the
 * transaction filter (which scan around the caret) all work from this one definition of "hidden",
 * and a test can read the answer without a view.
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, SelectionRange } from '@codemirror/state'
import { languageName } from '../codeLanguages'
import { boxLines } from './box'
import { frontmatterEnd } from './frontmatter'

/** A node of the syntax tree. `@lezer/common` is not a direct dependency, so the type comes from here. */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolve']>

/** Syntax that is not shown. Never spans a line break. */
export interface HideItem {
  readonly type: 'hide'
  readonly from: number
  readonly to: number
}

/** Styles a stretch of text. */
export interface MarkItem {
  readonly type: 'mark'
  readonly from: number
  readonly to: number
  readonly class: string
}

/** Styles the whole line that starts at `from`. */
export interface LineItem {
  readonly type: 'line'
  readonly from: number
  readonly class: string
  /** Attributes the line carries, such as the label of a container. */
  readonly attributes?: Readonly<Record<string, string>>
}

/** A task marker (`[ ]`, `[x]`) drawn as a checkbox. Shown only while no selection touches it. */
export interface CheckboxItem {
  readonly type: 'checkbox'
  readonly from: number
  readonly to: number
  readonly checked: boolean
}

export type PreviewItem = HideItem | MarkItem | LineItem | CheckboxItem

/** The class names the layer puts on the page. The theme and the tests both read them from here. */
export const classes = {
  heading: (level: number): string => `cm-md-h cm-md-h${String(level)}`,
  setextUnderline: 'cm-md-setext-mark',
  strong: 'cm-md-strong',
  emphasis: 'cm-md-em',
  strike: 'cm-md-strike',
  code: 'cm-md-code',
  link: 'cm-md-link',
  listMark: 'cm-md-list-mark',
  quote: 'cm-md-quote',
  rule: 'cm-md-hr',
  frontmatter: 'cm-md-frontmatter-line',
} as const

/** Nodes that carry their own address, so a URL inside them is not a bare URL. */
const addressed = new Set(['Link', 'Image', 'Autolink', 'LinkReference'])

/** The inline elements that wrap their text in marks, with the node that is each mark. */
const wrapped: Record<string, { class: string; mark: string }> = {
  StrongEmphasis: { class: classes.strong, mark: 'EmphasisMark' },
  Emphasis: { class: classes.emphasis, mark: 'EmphasisMark' },
  Strikethrough: { class: classes.strike, mark: 'StrikethroughMark' },
  InlineCode: { class: classes.code, mark: 'CodeMark' },
}

/** True when any selection range touches `[from, to]`, edges included. */
export function touched(ranges: readonly SelectionRange[], from: number, to: number): boolean {
  for (const range of ranges) {
    if (range.from <= to && range.to >= from) return true
  }
  return false
}

/** The first number in `[from, limit)` after a run of spaces and tabs that starts at `from`. */
function skipBlanks(state: EditorState, from: number, limit: number): number {
  const text = state.doc.sliceString(from, limit)
  let n = 0
  while (n < text.length && (text[n] === ' ' || text[n] === '\t')) n++
  return from + n
}

/** Where the run of spaces and tabs that ends at `to` begins. */
function blanksBefore(state: EditorState, to: number, limit: number): number {
  const text = state.doc.sliceString(limit, to)
  let n = text.length
  while (n > 0 && (text[n - 1] === ' ' || text[n - 1] === '\t')) n--
  return limit + n
}

/** Hides `[from, to]` one line at a time, so no hidden range spans a line break. */
function hideLines(state: EditorState, items: PreviewItem[], from: number, to: number): void {
  for (let at = from; at < to;) {
    const line = state.doc.lineAt(at)
    const end = Math.min(to, line.to)
    if (end > at) items.push({ type: 'hide', from: at, to: end })
    at = line.to + 1
  }
}

/**
 * A fenced code block as a container. With no selection touching it the fences are hidden and the
 * language is a label at the top right; with one inside (edges included) the fences show and the
 * label goes. The fence lines are lines either way, so the block is the same height in both states.
 */
function fencedCode(
  state: EditorState,
  items: PreviewItem[],
  node: SyntaxNode,
  visible: { readonly from: number; readonly to: number },
): void {
  const doc = state.doc
  const marks: SyntaxNode[] = []
  let info: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeMark') marks.push(child)
    else if (child.name === 'CodeInfo') info = child
  }
  const shown = touched(state.selection.ranges, node.from, node.to)
  const word = info === null ? '' : (/\S+/.exec(doc.sliceString(info.from, info.to))?.[0] ?? '')
  const label = shown || word === '' ? undefined : (languageName(word) ?? word)
  items.push(...boxLines(doc, node.from, node.to, visible, { kind: 'code', label }))
  if (shown) return
  const open = marks[0]
  // The closing fence is a second mark; a block that runs to the end of the document has none.
  const close = marks.length > 1 ? marks[marks.length - 1] : undefined
  if (open !== undefined && open.to >= visible.from && open.from <= visible.to)
    items.push({ type: 'hide', from: open.from, to: doc.lineAt(open.from).to })
  if (close !== undefined && close.to >= visible.from && close.from <= visible.to)
    items.push({ type: 'hide', from: close.from, to: close.to })
}

/**
 * Every preview item for the nodes that overlap `ranges`, for the selection the state holds.
 * Items come back in no particular order; CodeMirror sorts them when it builds a set.
 */
export function scanPreview(
  state: EditorState,
  ranges: readonly { readonly from: number; readonly to: number }[],
): PreviewItem[] {
  const items: PreviewItem[] = []
  const selection = state.selection.ranges
  const doc = state.doc
  const tree = syntaxTree(state)
  // The parser sees a rule and a paragraph there; the frontmatter pill owns that range.
  const frontmatter = frontmatterEnd(doc)
  // While a selection touches it the pill is gone and the YAML shows as plain text. The tree still
  // says "heading" over it, and the highlighter would style it as one, so each line says otherwise.
  const plain = frontmatter !== null && touched(selection, 0, frontmatter)
  /** Starts of the lines a block quote already styled, so a nested quote adds nothing twice. */
  const quoted = new Set<number>()

  for (const { from, to } of ranges) {
    if (frontmatter !== null && plain) {
      const last = doc.lineAt(Math.min(to, frontmatter)).number
      for (let n = doc.lineAt(from).number; n <= last; n++) {
        items.push({ type: 'line', from: doc.line(n).from, class: classes.frontmatter })
      }
    }
    tree.iterate({
      from,
      to,
      enter(node) {
        const name = node.name
        if (frontmatter !== null && name !== 'Document' && node.from < frontmatter) return false

        if (name.startsWith('ATXHeading')) {
          const level = Math.min(6, Number(name.slice('ATXHeading'.length)) || 1)
          const line = doc.lineAt(node.from)
          items.push({ type: 'line', from: line.from, class: classes.heading(level) })
          if (touched(selection, line.from, line.to)) return
          // The marks are the node's own children: one at the start, and an optional closing run.
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name !== 'HeaderMark') continue
            if (child.from === node.from) {
              // The hashes and the blanks after them, unless nothing follows (a bare `#`).
              const end = skipBlanks(state, child.to, line.to)
              if (end < line.to) items.push({ type: 'hide', from: child.from, to: end })
            } else {
              const start = blanksBefore(state, child.from, line.from)
              items.push({ type: 'hide', from: start, to: child.to })
            }
          }
          return
        }

        if (name === 'SetextHeading1' || name === 'SetextHeading2') {
          const level = name === 'SetextHeading1' ? 1 : 2
          const last = doc.lineAt(node.to)
          // The underline is the last line. Its text stays visible, muted, so the lines keep
          // their height and the arrow keys have something to land on.
          for (let n = doc.lineAt(node.from).number; n < last.number; n++) {
            items.push({ type: 'line', from: doc.line(n).from, class: classes.heading(level) })
          }
          items.push({ type: 'line', from: last.from, class: classes.setextUnderline })
          return
        }

        if (name === 'Link') {
          // `[text](target)`, `[text][label]` and `[text]`: the text stays, the rest hides.
          items.push({ type: 'mark', from: node.from, to: node.to, class: classes.link })
          if (touched(selection, node.from, node.to)) return
          // The first mark opens the text, the second closes it; anything after is the target.
          const marks: { from: number; to: number }[] = []
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'LinkMark') marks.push({ from: child.from, to: child.to })
          }
          const [open, close] = marks
          // No text means nothing would be left to see or to put the caret on.
          if (open === undefined || close === undefined || close.from <= open.to) return
          hideLines(state, items, open.from, open.to)
          hideLines(state, items, close.from, node.to)
          return
        }

        if (name === 'Autolink') {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'URL')
              items.push({ type: 'mark', from: child.from, to: child.to, class: classes.link })
          }
          if (touched(selection, node.from, node.to)) return
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === 'LinkMark')
              items.push({ type: 'hide', from: child.from, to: child.to })
          }
          return
        }

        if (name === 'URL') {
          const parent = node.node.parent
          if (parent === null || !addressed.has(parent.name))
            items.push({ type: 'mark', from: node.from, to: node.to, class: classes.link })
          return
        }

        if (name === 'ListMark') {
          items.push({ type: 'mark', from: node.from, to: node.to, class: classes.listMark })
          return
        }

        if (name === 'TaskMarker') {
          if (touched(selection, node.from, node.to)) return
          const marker = doc.sliceString(node.from, node.to)
          // The parser only gives a TaskMarker to `[ ]`, `[x]` and `[X]`; the first is open.
          items.push({
            type: 'checkbox',
            from: node.from,
            to: node.to,
            checked: marker !== '[ ]',
          })
          return
        }

        if (name === 'Blockquote') {
          const last = doc.lineAt(node.to).number
          for (let n = doc.lineAt(node.from).number; n <= last; n++) {
            const from = doc.line(n).from
            // A nested quote covers lines its parent already styled.
            if (!quoted.has(from)) {
              quoted.add(from)
              items.push({ type: 'line', from, class: classes.quote })
            }
          }
          return
        }

        if (name === 'QuoteMark') {
          const line = doc.lineAt(node.from)
          if (touched(selection, line.from, line.to)) return
          const end = skipBlanks(state, node.to, line.to)
          // A marker with nothing after it stays, so the line keeps something to land on.
          if (end < line.to) items.push({ type: 'hide', from: node.from, to: end })
          return
        }

        if (name === 'FencedCode') {
          // Fences inside a list or a quote keep the plain look: the container is drawn across the
          // whole line, which would cover the indent or the quote bar.
          if (node.node.parent?.name !== 'Document') return false
          fencedCode(state, items, node.node, { from, to })
          return false
        }

        if (name === 'HorizontalRule') {
          const line = doc.lineAt(node.from)
          items.push({ type: 'line', from: line.from, class: classes.rule })
          if (!touched(selection, line.from, line.to))
            items.push({ type: 'hide', from: node.from, to: node.to })
          return
        }

        const wrap = wrapped[name]
        if (wrap !== undefined) {
          items.push({ type: 'mark', from: node.from, to: node.to, class: wrap.class })
          // The markers show while the caret is in the element, edges included.
          if (touched(selection, node.from, node.to)) return
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === wrap.mark)
              items.push({ type: 'hide', from: child.from, to: child.to })
          }
        }
      },
    })
  }
  return items
}
