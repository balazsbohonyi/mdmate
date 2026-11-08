// @vitest-environment jsdom
/**
 * ISC-64 and ISC-65: GFM tables render as a read-only widget, and a caret that touches the table
 * puts its raw source back. The data layer is read without a view; the page is read in a jsdom
 * view. Layout and real clicks are checked in the real window (see ai-docs/phases/phase-04).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { blocksOf, scanBlocks, type Inline, type TableItem } from '@/editor/livePreview/blocks'
import { withSourceEndings } from '@/editor/sourceCopy'
import { blockStateOf, drawn, mountPreview } from '../helpers/blocks'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})
function mount(doc: string, caret: number): EditorView {
  const view = mountPreview(doc, caret)
  views.push(view)
  return view
}

const TABLE =
  '| Name | Qty | Note |\n|:-----|:---:|-----:|\n| apple | 3 | **fresh** |\n| pear | 12 | `a\\|b` |'
const DOC = `before\n\n${TABLE}\n\nafter\n`
const TABLE_FROM = DOC.indexOf('| Name')
const TABLE_TO = TABLE_FROM + TABLE.length

/** The text of a run of inline pieces, with their kinds as `kind(text)` for anything styled. */
function flat(runs: readonly Inline[]): string {
  return runs
    .map((run) =>
      run.type === 'text'
        ? run.text
        : `${run.type}(${run.type === 'code' ? run.text : flat(run.children)})`,
    )
    .join('')
}

function tableOf(doc: string): TableItem {
  const state = blockStateOf(doc)
  const items = scanBlocks(state, [{ from: 0, to: doc.length }]).filter(
    (item): item is TableItem => item.kind === 'table',
  )
  const [first] = items
  if (first === undefined) throw new Error('no table found')
  return first
}

describe('the table model', () => {
  it('reads the header, the alignment and every row', () => {
    const table = tableOf(DOC)
    expect(table.model.align).toEqual(['left', 'center', 'right'])
    expect(table.model.head.map((cell) => flat(cell.runs))).toEqual(['Name', 'Qty', 'Note'])
    expect(table.model.rows.map((row) => row.map((cell) => flat(cell.runs)))).toEqual([
      ['apple', '3', 'strong(fresh)'],
      ['pear', '12', 'code(a|b)'],
    ])
  })

  it('covers whole lines, from the first to the last', () => {
    const table = tableOf(DOC)
    expect([table.from, table.to]).toEqual([TABLE_FROM, TABLE_TO])
  })

  it('pads a short row and drops a cell the header does not have', () => {
    const table = tableOf('| a | b |\n|---|---|\n| 1 |\n| 2 | 3 | 4 |\n')
    expect(table.model.rows.map((row) => row.map((cell) => flat(cell.runs)))).toEqual([
      ['1', ''],
      ['2', '3'],
    ])
  })

  it('renders emphasis, strikethrough and links in a cell, and an image as its alt text', () => {
    const table = tableOf('| h |\n|---|\n| *a* ~~b~~ [c](d) ![e](f.png) |\n')
    expect(flat(table.model.rows[0]?.[0]?.runs ?? [])).toBe('em(a) del(b) link(c) e')
  })

  it('records where each cell starts, relative to the table', () => {
    const table = tableOf(DOC)
    const cell = table.model.rows[0]?.[0]
    expect(DOC.slice(table.from + (cell?.offset ?? 0)).startsWith('apple')).toBe(true)
  })

  it('leaves a table inside a list or a quote as source', () => {
    expect(drawn(blockStateOf('- | a |\n  |---|\n  | 1 |\n'))).toEqual([])
    expect(drawn(blockStateOf('> | a |\n> |---|\n> | 1 |\n'))).toEqual([])
  })

  it('draws no table for a header without a delimiter row', () => {
    expect(drawn(blockStateOf('| a | b |\n| 1 | 2 |\n'))).toEqual([])
  })
})

describe('the page (ISC-64)', () => {
  it('shows the table as a real table, and none of its pipes', () => {
    const view = mount(DOC, 0)
    const table = view.contentDOM.querySelector('table.cm-md-table')
    expect(table).not.toBeNull()
    expect([...(table?.querySelectorAll('th') ?? [])].map((cell) => cell.textContent)).toEqual([
      'Name',
      'Qty',
      'Note',
    ])
    expect([...(table?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent)).toEqual([
      'apple',
      '3',
      'fresh',
      'pear',
      '12',
      'a|b',
    ])
    expect(table?.querySelector('strong')?.textContent).toBe('fresh')
    expect(table?.querySelector('code')?.textContent).toBe('a|b')
    expect(view.contentDOM.textContent).not.toContain('|---')
  })

  it('aligns the columns as the delimiter row says', () => {
    const view = mount(DOC, 0)
    const cells = [...view.contentDOM.querySelectorAll<HTMLElement>('thead th')]
    expect(cells.map((cell) => cell.style.textAlign)).toEqual(['left', 'center', 'right'])
  })

  it('is read-only: nothing in it takes input', () => {
    const view = mount(DOC, 0)
    const wrap = view.contentDOM.querySelector('.cm-md-table-wrap')
    expect(wrap?.querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
  })

  it('leaves the document itself alone', () => {
    const view = mount(DOC, 0)
    for (let pos = 0; pos <= DOC.length; pos += 3) view.dispatch({ selection: { anchor: pos } })
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('tells CodeMirror roughly how tall it is, growing with its rows', () => {
    const smallDoc = '| a |\n|---|\n| 1 |\n'
    const bigDoc = '| a |\n|---|\n| 1 |\n| 2 |\n| 3 |\n| 4 |\n| 5 |\n'
    const small = blocksOf(blockStateOf(smallDoc, smallDoc.length))[0]
    const big = blocksOf(blockStateOf(bigDoc, bigDoc.length))[0]
    expect(small?.estimatedHeight).toBeGreaterThan(40)
    expect(big?.estimatedHeight).toBeGreaterThan((small?.estimatedHeight ?? 0) + 100)
  })

  it('keeps one widget object across an edit elsewhere, so the DOM is reused', () => {
    const state = blockStateOf(DOC)
    const before = blocksOf(state)[0]?.widget
    const next = state.update({ changes: { from: 0, insert: 'x' } }).state
    const after = blocksOf(next)[0]
    expect(after?.from).toBe(TABLE_FROM + 1)
    expect(after?.widget.eq(before as never)).toBe(true)
  })
})

describe('a caret entering the table (ISC-65)', () => {
  it('removes the widget and shows the source', () => {
    const view = mount(DOC, 0)
    expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull()
    view.dispatch({ selection: { anchor: TABLE_FROM + 4 } })
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    expect(view.contentDOM.textContent).toContain('| Name | Qty | Note |')
    expect(view.contentDOM.textContent).toContain('|:-----|:---:|-----:|')
  })

  it('reveals on either edge, and not from the blank lines around it', () => {
    const view = mount(DOC, 0)
    for (const edge of [TABLE_FROM, TABLE_TO]) {
      view.dispatch({ selection: { anchor: edge } })
      expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    }
    for (const near of [TABLE_FROM - 1, TABLE_TO + 1]) {
      view.dispatch({ selection: { anchor: near } })
      expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull()
    }
  })

  it('draws the table again when the caret leaves', () => {
    const view = mount(DOC, TABLE_FROM + 4)
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    view.dispatch({ selection: { anchor: 2 } })
    expect(view.contentDOM.querySelector('.cm-md-table')).not.toBeNull()
  })

  it('reveals when a selection crosses it, though both ends are outside', () => {
    const view = mount(DOC, 0)
    view.dispatch({ selection: { anchor: 1, head: DOC.length - 2 } })
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
  })

  it('reveals the table a clicked cell belongs to, with the caret in that cell', () => {
    const view = mount(DOC, 0)
    const cells = [...view.contentDOM.querySelectorAll<HTMLElement>('tbody td')]
    const pear = cells.find((cell) => cell.textContent === 'pear')
    pear?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    const head = view.state.selection.main.head
    expect(DOC.slice(head).startsWith('pear')).toBe(true)
  })

  it('keeps the table drawn while the caret types elsewhere', () => {
    const view = mount(DOC, DOC.length - 1)
    const before = view.contentDOM.querySelector('table.cm-md-table')
    view.dispatch({
      changes: { from: DOC.length - 1, insert: 'x' },
      selection: { anchor: DOC.length },
    })
    expect(view.contentDOM.querySelector('table.cm-md-table')).toBe(before)
  })
})

describe('copying a table', () => {
  it('copies source bytes, because a selection over the table shows its source', () => {
    const state = blockStateOf(DOC, [TABLE_FROM - 2, TABLE_TO + 2])
    const copied = withSourceEndings(
      state,
      { dominant: 0, at: [], codes: [] },
      state.sliceDoc(TABLE_FROM - 2, TABLE_TO + 2),
    )
    expect(copied).toBe(DOC.slice(TABLE_FROM - 2, TABLE_TO + 2))
    expect(copied).toContain('|:-----|:---:|-----:|')
    expect(drawn(state)).toEqual([])
  })
})
