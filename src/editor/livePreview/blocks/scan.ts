/**
 * What the block layer draws, as plain data. `scanBlocks` reads the syntax tree over the ranges it
 * is given and returns one item per block it can draw: its range (whole lines for a block) and
 * what the widget needs. It looks at nothing but the state, so a test reads the answer without a
 * view, and the field and the widgets share one definition of "a table".
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Text } from '@codemirror/state'
import { frontmatterEnd } from '../frontmatter'
import { imageContext, resolveImageAddress, type ImageAddress } from './image'
import { parseImgTag } from './imageTag'

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

/**
 * An image drawn in place of its Markdown. `block` is true when it is alone on its line, and then
 * `from` and `to` are that whole line; otherwise it is drawn inside the text and the range is
 * the image's own.
 */
export interface ImageItem {
  readonly kind: 'image'
  readonly from: number
  readonly to: number
  readonly block: boolean
  readonly alt: string
  readonly title: string | null
  /** What the address in the document allows. */
  readonly image: ImageAddress
  /** What the webview loads, or null when the address is refused. */
  readonly src: string | null
  /** The Markdown or `<img>` tag the widget stands for. */
  readonly source: string
  /** The `width` of an `<img>` tag, in CSS pixels, or null (always null for `![]()`). */
  readonly width: number | null
  /** The `height` of an `<img>` tag, in CSS pixels, or null (always null for `![]()`). */
  readonly height: number | null
  /** True for an `<img>` tag, false for `![]()`. */
  readonly html: boolean
  /** The address as written (angle brackets of a Markdown image included), before the allowlist. */
  readonly address: string
}

/**
 * The YAML frontmatter at the start of the document, drawn as a pill. It always starts at 0 and
 * ends with its closing line. The pill says only "Frontmatter"; the keys are in the text.
 */
export interface FrontmatterItem {
  readonly kind: 'frontmatter'
  readonly from: 0
  readonly to: number
  /** The block's own text, which is what makes two widgets for it the same widget. */
  readonly source: string
}

export type BlockItem = TableItem | ImageItem | FrontmatterItem

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

/** The text inside the quotes or parentheses of a link title. */
function titleText(raw: string): string {
  return raw.length >= 2 ? raw.slice(1, -1) : raw
}

function imageItem(state: EditorState, node: SyntaxNode): ImageItem | null {
  const doc = state.doc
  let url: SyntaxNode | null = null
  let title: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'URL') url = child
    else if (child.name === 'LinkTitle') title = child
  }
  // `![alt][ref]` has no address of its own; it stays Markdown.
  if (url === null) return null
  const inner = innerRange(node)
  return buildImage(state, node.from, node.to, {
    address: doc.sliceString(url.from, url.to),
    alt: doc.sliceString(inner.from, inner.to),
    title: title === null ? null : titleText(doc.sliceString(title.from, title.to)),
    width: null,
    height: null,
    html: false,
  })
}

/**
 * An `<img>` tag in `[from, to)`, or null when that text is not exactly one tag with an address
 * (any other HTML stays source). Only the allowed attributes are read (`imageTag.ts`).
 */
function imgTagItem(state: EditorState, start: number, end: number): ImageItem | null {
  const text = state.doc.sliceString(start, end)
  const tag = parseImgTag(text)
  if (tag === null) return null
  // An HTML block may carry the spaces after its tag; the image is the tag alone.
  const from = start + (text.length - text.trimStart().length)
  const to = end - (text.length - text.trimEnd().length)
  return buildImage(state, from, to, {
    address: tag.src,
    alt: tag.alt,
    title: tag.title,
    width: tag.width,
    height: tag.height,
    html: true,
  })
}

/**
 * The `<img>` tags drawn from an HTML block `[from, to)`: the whole block when it is one tag, else
 * each line it opens with that is a tag alone. Lines after those stay as they are, ordinary text
 * under the pictures, which is also what another viewer shows for them.
 */
function leadingImgTags(state: EditorState, from: number, to: number): ImageItem[] {
  const whole = imgTagItem(state, from, to)
  if (whole !== null) return [whole]
  const doc = state.doc
  const items: ImageItem[] = []
  for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
    const line = doc.line(n)
    const item = imgTagItem(state, Math.max(line.from, from), Math.min(line.to, to))
    if (item === null) break
    items.push(item)
  }
  return items
}

interface ImageParts {
  readonly address: string
  readonly alt: string
  readonly title: string | null
  readonly width: number | null
  readonly height: number | null
  readonly html: boolean
}

/** The item for an image written in `[nodeFrom, nodeTo)`: a Markdown image or an `<img>` tag. */
function buildImage(
  state: EditorState,
  nodeFrom: number,
  nodeTo: number,
  parts: ImageParts,
): ImageItem {
  const doc = state.doc
  const context = state.facet(imageContext)
  const image = resolveImageAddress(
    parts.address,
    context?.folder() ?? null,
    context?.boundary() ?? null,
  )
  const src =
    image.kind === 'local'
      ? (context?.url(image.path) ?? null)
      : image.kind === 'remote'
        ? image.url
        : null
  const line = doc.lineAt(nodeFrom)
  const alone =
    doc.lineAt(nodeTo).number === line.number &&
    doc.sliceString(line.from, line.to).trim() === doc.sliceString(nodeFrom, nodeTo)
  const from = alone ? line.from : nodeFrom
  const to = alone ? line.to : nodeTo
  return {
    kind: 'image',
    from,
    to,
    block: alone,
    alt: parts.alt,
    title: parts.title,
    image,
    src,
    source: doc.sliceString(from, to),
    width: parts.width,
    height: parts.height,
    html: parts.html,
    address: parts.address,
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
  const frontmatter = frontmatterEnd(state.doc)
  for (const { from, to } of ranges) {
    if (frontmatter !== null && from < frontmatter && !seen.has(0)) {
      seen.add(0)
      const source = state.doc.sliceString(0, frontmatter)
      items.push({
        kind: 'frontmatter',
        from: 0,
        to: frontmatter,
        source,
      })
    }
    // True while inside a top-level paragraph, the only place images are drawn.
    let inParagraph = false
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Document') return
        // The parser sees a rule and a paragraph there; the pill owns that range.
        if (frontmatter !== null && node.from < frontmatter) return false
        if (inParagraph) {
          if (node.name !== 'Image' && node.name !== 'HTMLTag') return
          if (!seen.has(node.from)) {
            seen.add(node.from)
            const item =
              node.name === 'Image'
                ? imageItem(state, node.node)
                : imgTagItem(state, node.from, node.to)
            if (item !== null) items.push(item)
          }
          return false
        }
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
        // A tag alone on its line, with no paragraph before it, is an HTML block to the parser. The
        // block runs to the next blank line, so a line typed right under the tag is part of it.
        if (node.name === 'HTMLBlock') {
          if (!seen.has(node.from)) {
            seen.add(node.from)
            items.push(...leadingImgTags(state, node.from, node.to))
          }
          return false
        }
        if (node.name === 'Paragraph') {
          inParagraph = true
          return
        }
        return false
      },
      leave(node) {
        if (node.name === 'Paragraph' && node.node.parent?.name === 'Document') inParagraph = false
      },
    })
  }
  return items
}
