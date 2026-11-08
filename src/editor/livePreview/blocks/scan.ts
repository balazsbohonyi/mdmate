/**
 * What the block layer draws, as plain data. `scanBlocks` reads the syntax tree over the ranges it
 * is given and returns one item per block it can draw: its range (whole lines for a block) and
 * what the widget needs. It looks at nothing but the state, so a test reads the answer without a
 * view, and the field and the widgets share one definition of "a table".
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'

type Tree = ReturnType<typeof syntaxTree>
type SyntaxNode = Tree['topNode']

export type Align = 'left' | 'center' | 'right' | null

/** A piece of a table cell, already read from the Markdown. Widgets build DOM from these. */
export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | {
      readonly type: 'strong' | 'em' | 'del' | 'link'
      readonly children: readonly Inline[]
    }

export interface Cell {
  readonly runs: readonly Inline[]
  /** Where the cell's text starts in the document, relative to the start of the table. */
  readonly offset: number
}

export interface TableModel {
  readonly align: readonly Align[]
  readonly head: readonly Cell[]
  readonly rows: readonly (readonly Cell[])[]
}

/** A GFM table drawn as a read-only widget. `from` and `to` are the start and end of its lines. */
export interface TableItem {
  readonly kind: 'table'
  readonly from: number
  readonly to: number
  readonly model: TableModel
  /** The table's own text, which is what makes two widgets for it the same widget. */
  readonly source: string
}

export type BlockItem = TableItem

/** True when any selection range touches `[from, to]`, edges included. */
export function touchesRange(
  ranges: readonly { readonly from: number; readonly to: number }[],
  from: number,
  to: number,
): boolean {
  for (const range of ranges) {
    if (range.from <= to && range.to >= from) return true
  }
  return false
}

/** Appends text to the last text run, so a cell reads as few pieces as it can. */
function pushText(runs: Inline[], text: string): void {
  if (text === '') return
  const last = runs[runs.length - 1]
  if (last?.type === 'text') runs[runs.length - 1] = { type: 'text', text: last.text + text }
  else runs.push({ type: 'text', text })
}

/** `\|` is how a pipe is written inside a cell; a reader sees the pipe. */
function unescapePipes(text: string): string {
  return text.replaceAll('\\|', '|')
}

/** The pieces of `[from, to)` inside `parent`, with the inline nodes it holds turned into runs. */
function inlineRuns(doc: Text, parent: SyntaxNode, from: number, to: number): Inline[] {
  const runs: Inline[] = []
  let at = from
  const text = (a: number, b: number): void => {
    if (b > a) pushText(runs, unescapePipes(doc.sliceString(a, b)))
  }
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue
    text(at, child.from)
    at = child.to
    const inner = innerRange(child)
    switch (child.name) {
      case 'StrongEmphasis':
        runs.push({ type: 'strong', children: inlineRuns(doc, child, inner.from, inner.to) })
        break
      case 'Emphasis':
        runs.push({ type: 'em', children: inlineRuns(doc, child, inner.from, inner.to) })
        break
      case 'Strikethrough':
        runs.push({ type: 'del', children: inlineRuns(doc, child, inner.from, inner.to) })
        break
      case 'InlineCode':
        runs.push({ type: 'code', text: unescapePipes(doc.sliceString(inner.from, inner.to)) })
        break
      case 'Link':
        runs.push({ type: 'link', children: inlineRuns(doc, child, inner.from, inner.to) })
        break
      case 'Image': {
        // An image in a cell is its alt text; the cell is not the place to load a picture.
        pushText(runs, unescapePipes(doc.sliceString(inner.from, inner.to)))
        break
      }
      case 'Autolink':
      case 'URL':
        runs.push({
          type: 'link',
          children: [{ type: 'text', text: doc.sliceString(inner.from, inner.to) }],
        })
        break
      case 'Escape':
        pushText(runs, doc.sliceString(child.from + 1, child.to))
        break
      default:
        text(child.from, child.to)
    }
  }
  text(at, to)
  return runs
}

/** The part of an inline node between its opening mark and its closing mark. */
function innerRange(node: SyntaxNode): { from: number; to: number } {
  const marks: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name.endsWith('Mark') || child.name === 'URL') marks.push(child)
  }
  if (node.name === 'Link' || node.name === 'Image') {
    // `[text](target)`: the text is between the first two marks.
    const open = marks[0]
    const close = marks.find((mark, index) => index > 0 && mark.name === 'LinkMark')
    if (open !== undefined && close !== undefined) return { from: open.to, to: close.from }
    return { from: node.from, to: node.to }
  }
  if (node.name === 'Autolink') {
    const url = node.firstChild?.nextSibling
    return url === null || url === undefined
      ? { from: node.from, to: node.to }
      : { from: url.from, to: url.to }
  }
  const first = marks[0]
  const last = marks[marks.length - 1]
  if (first !== undefined && last !== undefined && first !== last) {
    return { from: first.to, to: last.from }
  }
  return { from: node.from, to: node.to }
}

/** The alignment a delimiter row such as `|:--|:-:|--:|` asks for, one entry per column. */
function alignments(row: string): Align[] {
  const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return cells.map((cell) => {
    const spec = cell.trim()
    const left = spec.startsWith(':')
    const right = spec.endsWith(':')
    if (left && right) return 'center'
    if (left) return 'left'
    if (right) return 'right'
    return null
  })
}

/** The cells of a header or body row, in order. */
function cellsOf(doc: Text, row: SyntaxNode, base: number): Cell[] {
  const cells: Cell[] = []
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'TableCell') continue
    cells.push({ runs: inlineRuns(doc, child, child.from, child.to), offset: child.from - base })
  }
  return cells
}

/** Makes a row exactly `width` cells wide: short rows are padded, extra cells dropped. */
function fit(cells: Cell[], width: number): Cell[] {
  const fitted = cells.slice(0, width)
  while (fitted.length < width) {
    fitted.push({ runs: [], offset: fitted[fitted.length - 1]?.offset ?? 0 })
  }
  return fitted
}

function tableItem(state: EditorState, node: SyntaxNode): TableItem | null {
  const doc = state.doc
  const from = doc.lineAt(node.from).from
  const to = doc.lineAt(node.to).to
  let head: Cell[] = []
  let align: Align[] = []
  const body: Cell[][] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader') head = cellsOf(doc, child, from)
    else if (child.name === 'TableDelimiter')
      align = alignments(doc.sliceString(child.from, child.to))
    else if (child.name === 'TableRow') body.push(cellsOf(doc, child, from))
  }
  if (head.length === 0) return null
  const width = head.length
  return {
    kind: 'table',
    from,
    to,
    model: {
      align: Array.from({ length: width }, (_, i) => align[i] ?? null),
      head: fit(head, width),
      rows: body.map((row) => fit(row, width)),
    },
    source: doc.sliceString(from, to),
  }
}

/**
 * Every block item for the nodes that overlap `ranges`. A node that starts before a range is still
 * returned whole, so a rescan of part of a table gives the whole table.
 */
export function scanBlocks(
  state: EditorState,
  ranges: readonly { readonly from: number; readonly to: number }[],
): BlockItem[] {
  const items: BlockItem[] = []
  const seen = new Set<number>()
  const tree = syntaxTree(state)
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Document') return
        // Blocks are top-level: inside a list or a quote the line prefix would be lost.
        if (node.node.parent?.name !== 'Document') return false
        if (node.name === 'Table') {
          if (!seen.has(node.from)) {
            seen.add(node.from)
            const item = tableItem(state, node.node)
            if (item !== null) items.push(item)
          }
          return false
        }
        return
      },
    })
  }
  return items
}
