// @vitest-environment jsdom
/**
 * P9.1-T11: a table written under a list item is drawn as a table, at the item's indent. Only the
 * list parent stopped it before: the scan walked the top level alone. A table in a quote, and one
 * that starts on the marker line, still stay Markdown, since the widget replaces whole lines and
 * would lose the `>` or the bullet.
 */
import { readFileSync } from 'node:fs'
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { scanBlocks, type TableItem } from '@/editor/livePreview/blocks'
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

function tablesOf(doc: string): TableItem[] {
  const state = blockStateOf(doc)
  return scanBlocks(state, [{ from: 0, to: doc.length }]).filter(
    (item): item is TableItem => item.kind === 'table',
  )
}

const BULLET = '- **Baseline**\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- second\n'
const NUMBERED = '1. one\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n2. two\n'
const NESTED = '- outer\n  - inner\n    | a | b |\n    |---|---|\n    | 1 | 2 |\n'
const AFTER_TEXT = '- item\n\n  more text\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n'
const TWO = '- one\n  | a |\n  |---|\n  | 1 |\n- two\n  | b |\n  |---|\n  | 2 |\n'

describe('a table in a list item is drawn (P9.1-T11)', () => {
  it.each([
    ['a bullet list', BULLET, '  '],
    ['a numbered list', NUMBERED, '   '],
    ['a nested list', NESTED, '    '],
    ['an item with text before it', AFTER_TEXT, '  '],
  ])('in %s, whole lines from the first row to the last, with the indent', (_name, doc, indent) => {
    const tables = tablesOf(doc)
    expect(tables).toHaveLength(1)
    const [table] = tables
    expect(table?.indent).toBe(indent)
    expect(doc.slice(table?.from, table?.to)).toBe(
      `${indent}| a | b |\n${indent}|---|---|\n${indent}| 1 | 2 |`,
    )
    expect(table?.model.head.map((cell) => doc.slice((table.from ?? 0) + cell.offset)[0])).toEqual([
      'a',
      'b',
    ])
  })

  it('draws every table of a list that has several', () => {
    const tables = tablesOf(TWO)
    expect(tables.map((table) => table.indent)).toEqual(['  ', '  '])
    expect(drawn(blockStateOf(TWO)).map((one) => one.split(' ')[0])).toEqual(['table', 'table'])
  })

  it("draws the three tables of Phase 0's decisions.md, which sit under bullets", () => {
    const doc = readFileSync('ai-docs/phases/phase-00/decisions.md', 'utf8').replace(/\r\n/g, '\n')
    const tables = tablesOf(doc)
    expect(tables).toHaveLength(3)
    for (const table of tables) {
      expect(table.indent).toMatch(/^ +$/)
      expect(table.model.head.length).toBeGreaterThan(1)
    }
  })

  it('draws a table at the top level with no indent, whatever its first spaces', () => {
    for (const lead of ['', ' ', '  ', '   ']) {
      const doc = `${lead}| a | b |\n${lead}|---|---|\n${lead}| 1 | 2 |\n`
      const [table] = tablesOf(doc)
      expect(table?.indent, JSON.stringify(lead)).toBe('')
    }
  })
})

describe('what stays Markdown (P9.1-T11)', () => {
  it.each([
    ['a table in a quote', '> | a |\n> |---|\n> | 1 |\n'],
    ['a table in a list in a quote', '> - x\n>   | a |\n>   |---|\n>   | 1 |\n'],
    ['a table that starts on the marker line', '- | a |\n  |---|\n  | 1 |\n'],
    ['a numbered table that starts on the marker line', '1. | a |\n   |---|\n   | 1 |\n'],
    ['a table indented four spaces, which is code', '    | a |\n    |---|\n    | 1 |\n'],
    ['a table indented by a tab, which is code', '\t| a |\n\t|---|\n\t| 1 |\n'],
  ])('%s', (_name, doc) => {
    expect(drawn(blockStateOf(doc))).toEqual([])
  })

  it('leaves a picture in a list item alone', () => {
    expect(drawn(blockStateOf('- ![alt](a.png)\n- text\n'))).toEqual([])
  })

  it('leaves a paragraph, a quote and a top-level table around a list as they were', () => {
    const doc = `top\n\n| x |\n|---|\n| 1 |\n\n${BULLET}\n> quote\n`
    expect(drawn(blockStateOf(doc)).map((one) => one.split(' ')[0])).toEqual(['table', 'table'])
  })
})

describe('the page (P9.1-T11)', () => {
  it('draws the table after an invisible stand-in for the indent', () => {
    const view = mount(BULLET, BULLET.length)
    const shell = view.contentDOM.querySelector('.cm-md-table-indented')
    expect(shell).not.toBeNull()
    const [gap, wrap] = [...(shell?.children ?? [])]
    expect(gap?.className).toBe('cm-md-table-indent')
    expect(gap?.textContent).toBe('  ')
    expect(wrap?.className).toBe('cm-md-table-wrap')
    expect(wrap?.querySelector('table.cm-md-table')).not.toBeNull()
    // None of the source shows.
    expect(view.contentDOM.textContent).not.toContain('|---|')
  })

  it('draws a top-level table as before, with no stand-in', () => {
    const doc = '| a |\n|---|\n| 1 |\n\nend\n'
    const view = mount(doc, doc.length)
    expect(view.contentDOM.querySelector('.cm-md-table-indented')).toBeNull()
    expect(view.contentDOM.querySelector('.cm-md-table-indent')).toBeNull()
    expect(view.contentDOM.querySelector('.cm-md-table-wrap > table.cm-md-table')).not.toBeNull()
  })

  it('shows the lines, indent included, when the caret is on them', () => {
    const view = mount(BULLET, BULLET.indexOf('| 1 | 2 |') + 2)
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    expect(view.contentDOM.textContent).toContain('| 1 | 2 |')
  })

  it('puts the caret in the cell that was pressed, which is counted from the line start', () => {
    const view = mount(BULLET, BULLET.length)
    const cells = [...view.contentDOM.querySelectorAll<HTMLElement>('tbody td')]
    const two = cells.find((cell) => cell.textContent === '2')
    two?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(view.contentDOM.querySelector('.cm-md-table')).toBeNull()
    expect(BULLET.slice(view.state.selection.main.head).startsWith('2 |')).toBe(true)
  })

  it('draws it again when the caret leaves, and keeps the same table while typing elsewhere', () => {
    const view = mount(BULLET, BULLET.indexOf('| 1 | 2 |') + 2)
    view.dispatch({ selection: { anchor: BULLET.length } })
    const before = view.contentDOM.querySelector('table.cm-md-table')
    expect(before).not.toBeNull()
    view.dispatch({
      changes: { from: BULLET.length, insert: 'x' },
      selection: { anchor: BULLET.length + 1 },
    })
    expect(view.contentDOM.querySelector('table.cm-md-table')).toBe(before)
  })
})

describe('an edit in the list (P9.1-T11)', () => {
  it('removes the table when its delimiter row is broken, and draws it when it is mended', () => {
    const view = mount(BULLET, BULLET.length)
    const row = BULLET.indexOf('|---|---|')
    expect(view.contentDOM.querySelector('table.cm-md-table')).not.toBeNull()
    view.dispatch({
      changes: { from: row, to: row + 9, insert: '| x | y |' },
      selection: { anchor: view.state.doc.length },
    })
    expect(view.contentDOM.querySelector('table.cm-md-table')).toBeNull()
    expect(view.contentDOM.querySelector('.cm-md-table-indented')).toBeNull()
    view.dispatch({
      changes: { from: row, to: row + 9, insert: '|---|---|' },
      selection: { anchor: view.state.doc.length },
    })
    expect(view.contentDOM.querySelectorAll('table.cm-md-table')).toHaveLength(1)
  })

  it('keeps the other tables of the list when one is edited', () => {
    // The caret rests in a paragraph after the list, so it touches neither table.
    const doc = `${TWO}
end
`
    const view = mount(doc, doc.length)
    expect(view.contentDOM.querySelectorAll('table.cm-md-table')).toHaveLength(2)
    const at = doc.indexOf('| 1 |')
    view.dispatch({ changes: { from: at + 2, insert: '9' }, selection: { anchor: doc.length + 1 } })
    const cells = [...view.contentDOM.querySelectorAll('tbody td')].map((cell) => cell.textContent)
    expect(cells).toEqual(['91', '2'])
  })

  it('turns a list item that gets its marker back into plain text, and the table with it', () => {
    const view = mount(BULLET, BULLET.length)
    // Taking the bullet off the first line makes the item's lines a paragraph and a code block.
    view.dispatch({
      changes: { from: 0, to: 2 },
      selection: { anchor: view.state.doc.length - 2 },
    })
    const fresh = blockStateOf(view.state.doc.toString(), view.state.selection.main.head)
    expect(drawn(view.state)).toEqual(drawn(fresh))
  })
})

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('the field follows a document of lists and tables (P9.1-T11)', () => {
  it('equals a fresh scan after random edits, with the caret in and out of a table', () => {
    const base =
      'top\n\n- one\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n- two\n  - deep\n    | c |\n    |---|\n    | 3 |\n\n1. n\n   | d |\n   |---|\n\n> | q |\n> |---|\n\n| t |\n|---|\n| 4 |\n'
    const pieces = ['\n', '\n\n', '|', '| a |', '|---|', '  ', '- ', '> ', 'x', '  | 1 | 2 |\n']
    for (const seed of [7, 21, 40]) {
      const next = rng(seed)
      for (let round = 0; round < 250; round++) {
        let state = blockStateOf(base, Math.floor(next() * base.length))
        for (let step = 0; step < 5; step++) {
          const length = state.doc.length
          const from = Math.floor(next() * (length + 1))
          const to = Math.min(length, from + Math.floor(next() * 8))
          const insert = next() < 0.65 ? (pieces[Math.floor(next() * pieces.length)] ?? '') : ''
          const size = length - (to - from) + insert.length
          const caret =
            next() < 0.5 ? Math.min(size, from + insert.length) : Math.floor(next() * (size + 1))
          state = state.update({
            changes: { from, to, insert },
            selection: { anchor: Math.min(caret, size) },
          }).state
          ensureSyntaxTree(state, state.doc.length, 5000)
          state = state.update({}).state
          const fresh = blockStateOf(state.doc.toString(), state.selection.main.head)
          expect(
            drawn(state),
            JSON.stringify({
              seed,
              round,
              step,
              head: state.selection.main.head,
              doc: state.doc.toString(),
            }),
          ).toEqual(drawn(fresh))
        }
      }
    }
  }, 60_000)
})
