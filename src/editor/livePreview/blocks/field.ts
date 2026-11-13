/**
 * The block layer: widgets that replace whole lines (tables, images, the frontmatter pill). CodeMirror lets only directly provided decorations change block structure, so this is a
 * `StateField`, not a plugin.
 *
 * The field keeps one decoration set and edits it instead of rebuilding it:
 *
 * - an edit maps the set through the changes, then rescans only the lines around the change
 *   (widened to the whole table, when one is there);
 * - a selection that moves rescans the blocks the old selection touched and the ones the new one
 *   touches, because a block is drawn only while no selection touches it;
 * - when the parser advances, the stretch it has newly parsed is scanned.
 *
 * Because a block that a selection touches is removed in the same transaction that moved the
 * selection, no selection ever sits inside a replacement, so there is no transaction filter to
 * keep a caret out (ISC-183).
 */
import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  EditorState,
  StateField,
  Transaction,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { scanBlocks, touchesRange, type BlockItem } from './scan'
import { blockTheme } from './theme'
import { FrontmatterWidget, ImageWidget, TableWidget, type BlockWidget } from './widgets'

interface Span {
  from: number
  to: number
}

interface BlockValue {
  readonly set: DecorationSet
  /** How far into the document the blocks have been scanned. The parser may be ahead of it. */
  readonly parsedTo: number
  /** The stretches the last transaction scanned. Kept so a test can see how little that was. */
  readonly scanned: readonly Span[]
}

/** A block as the page draws it, for the tests and the perf probes. */
export interface BlockInfo {
  readonly kind: BlockItem['kind']
  readonly from: number
  readonly to: number
  readonly widget: BlockWidget
  readonly estimatedHeight: number
}

function decorationFor(item: BlockItem): ReturnType<Decoration['range']> {
  if (item.kind === 'frontmatter') {
    return Decoration.replace({
      widget: new FrontmatterWidget(item.source),
      block: true,
    }).range(item.from, item.to)
  }
  if (item.kind === 'image') {
    return Decoration.replace({ widget: new ImageWidget(item), block: item.block }).range(
      item.from,
      item.to,
    )
  }
  return Decoration.replace({
    widget: new TableWidget(item.model, item.source),
    block: true,
  }).range(item.from, item.to)
}

/** Sorts spans and joins the ones that overlap or touch. */
function merge(spans: Span[]): Span[] {
  const sorted = spans.filter((span) => span.to >= span.from).sort((a, b) => a.from - b.from)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.from <= last.to) last.to = Math.max(last.to, span.to)
    else merged.push({ ...span })
  }
  return merged
}

/**
 * `[from, to]` widened to whole lines, `pad` more lines on each side. A table's shape depends on
 * the lines beside it, so an edit next to one has to look at it too. A scan returns a table whole
 * whenever it touches the span, so the span itself need not reach the table's far end.
 */
function widen(state: EditorState, from: number, to: number, pad: number): Span {
  const doc = state.doc
  const first = Math.max(1, doc.lineAt(from).number - pad)
  const last = Math.min(doc.lines, doc.lineAt(to).number + pad)
  return { from: doc.line(first).from, to: doc.line(last).to }
}

/** Removes what overlaps each span and draws again what the scan finds there. */
function rescan(
  state: EditorState,
  set: DecorationSet,
  spans: readonly Span[],
  limit: number,
): { set: DecorationSet; scanned: Span[] } {
  const scanned: Span[] = []
  for (const span of spans) {
    const from = span.from
    const to = Math.min(span.to, limit)
    if (to < from) continue
    scanned.push({ from, to })
    set = set.update({
      // Strict, like the scan: a block that only touches the edge is not part of it. An empty
      // one is what an edit leaves of a block whose whole text it deleted (an undo of a paste);
      // it can sit on that edge, so it goes whatever its place.
      filter: (start, end) => end > start && (end <= from || start >= to),
      filterFrom: from,
      filterTo: to,
    })
    const ranges = state.selection.ranges
    const add = scanBlocks(state, [{ from, to }])
      .filter((item) => !touchesRange(ranges, item.from, item.to))
      .map(decorationFor)
    if (add.length > 0) set = set.update({ add, sort: true })
  }
  return { set, scanned }
}

function update(value: BlockValue, tr: Transaction): BlockValue {
  const selectionMoved = tr.docChanged || !tr.startState.selection.eq(tr.newSelection)
  const treeTo = syntaxTree(tr.state).length
  let { set, parsedTo } = value
  const dirty: Span[] = []

  if (tr.docChanged) {
    set = set.map(tr.changes)
    parsedTo = tr.changes.mapPos(parsedTo, -1)
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      dirty.push(widen(tr.state, fromB, toB, 1))
    })
  }
  if (selectionMoved) {
    const before = tr.docChanged ? tr.startState.selection.map(tr.changes) : tr.startState.selection
    for (const range of [...before.ranges, ...tr.newSelection.ranges]) {
      dirty.push(widen(tr.state, range.from, range.to, 0))
    }
  }
  if (treeTo > parsedTo) dirty.push({ from: parsedTo, to: treeTo })
  parsedTo = Math.min(treeTo, tr.newDoc.length)

  if (dirty.length === 0) return { set, parsedTo, scanned: [] }
  const result = rescan(tr.state, set, merge(dirty), treeTo)
  return { set: result.set, parsedTo, scanned: result.scanned }
}

export const blockField = StateField.define<BlockValue>({
  create(state) {
    const treeTo = syntaxTree(state).length
    const result = rescan(state, Decoration.none, [{ from: 0, to: treeTo }], treeTo)
    return { set: result.set, parsedTo: treeTo, scanned: result.scanned }
  },
  update,
  provide: (field) => EditorView.decorations.from(field, (value) => value.set),
})

/**
 * CodeMirror moves the caret one line down by asking where the pointer would land one line lower,
 * and a block widget has no line of text to land on, so a step from the line above a block ends
 * on the line below it and the block is never entered (found in the real window; jsdom has no
 * layout to show it). This sends such a step into the block instead: down lands on its first line
 * and up on its last, which touches the block and shows its source.
 *
 * It applies only to a single caret moved by the keyboard (`select`, not a click or a search) onto
 * the line just past a drawn block that starts on the very next line.
 */
const stepIntoBlock = EditorState.transactionFilter.of(
  (tr): Transaction | readonly TransactionSpec[] => {
    if (tr.docChanged || tr.selection === undefined) return tr
    if (tr.annotation(Transaction.userEvent) !== 'select') return tr
    const before = tr.startState.selection
    if (before.ranges.length !== 1 || !before.main.empty) return tr
    if (tr.selection.ranges.length !== 1 || !tr.selection.main.empty) return tr
    const blocks = tr.startState.field(blockField, false)
    if (blocks === undefined) return tr
    const doc = tr.startState.doc
    const from = before.main.head
    const to = tr.selection.main.head
    if (to === from) return tr
    const down = to > from
    const probe = down ? doc.lineAt(from).to + 1 : doc.lineAt(from).from - 1
    if (probe < 0 || probe > doc.length) return tr
    let block: { from: number; to: number } | undefined
    blocks.set.between(probe, probe, (start, end) => {
      if (down ? start === probe : end === probe) block = { from: start, to: end }
      return false
    })
    if (block === undefined) return tr
    const past = down ? doc.lineAt(block.to).number + 1 : doc.lineAt(block.from).number - 1
    if (doc.lineAt(to).number !== past) return tr
    return [
      tr,
      {
        selection: EditorSelection.cursor(down ? block.from : block.to),
        scrollIntoView: true,
        userEvent: 'select',
        sequential: true,
      },
    ]
  },
)

/** The block layer and its theme. */
export function blockLayer(): Extension {
  return [blockTheme, blockField, stepIntoBlock]
}

/** The blocks drawn now, in document order. Empty for a state without the layer. */
export function blocksOf(state: EditorState): BlockInfo[] {
  const value = state.field(blockField, false)
  if (value === undefined) return []
  const blocks: BlockInfo[] = []
  value.set.between(0, state.doc.length, (from, to, decoration) => {
    const widget = (decoration.spec as { widget: BlockWidget }).widget
    blocks.push({ kind: widget.kind, from, to, widget, estimatedHeight: widget.estimatedHeight })
  })
  return blocks
}

/** The stretches the last transaction scanned, for the tests. */
export function blockScans(state: EditorState): readonly Span[] {
  return state.field(blockField, false)?.scanned ?? []
}
