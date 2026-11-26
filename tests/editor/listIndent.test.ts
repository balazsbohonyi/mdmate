// @vitest-environment jsdom
/**
 * ISC-744 and ISC-745: in live preview each list level is drawn twice as far in as its source
 * indentation, and the text, tables and code of an item move together. It is drawing only: the
 * document keeps its bytes, raw mode has none of it, and no line is lost to the caret.
 */
import { cursorCharRight } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createState, createView } from '@/editor/create'
import { mountPreview } from '../helpers/blocks'
import { valuesOf } from '../helpers/editorRules'
import { scanAll, stateOf } from '../helpers/preview'

const views: EditorView[] = []

beforeAll(() => {
  // jsdom has no layout. CodeMirror asks ranges for their rectangles when it measures.
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function mount(doc: string, caret = doc.length): EditorView {
  const view = mountPreview(doc, caret)
  views.push(view)
  return view
}

/** What is drawn a second time before each line, as `line N: blanks`. */
function shifts(doc: string, caret = doc.length): string[] {
  const state = stateOf(doc, caret)
  return scanAll(state)
    .flatMap((item) => (item.type === 'indent' ? [item] : []))
    .sort((a, b) => a.from - b.from)
    .map((item) => `${String(state.doc.lineAt(item.from).number)}: ${JSON.stringify(item.text)}`)
}

const NESTED = [
  '- top', // 1
  '  more of top', // 2
  '  - second', // 3
  '    more of second', // 4
  '    - third', // 5
  '',
  '  back in top', // 7: not the nested item's any more
  '- last', // 8
  '',
  'end',
].join('\n')

describe('the drawn indent of a list (ISC-744)', () => {
  it('draws the blanks before a nested marker twice, on every line of its item', () => {
    expect(shifts(NESTED)).toEqual(['3: "  "', '4: "  "', '5: "    "'])
  })

  it('moves ordered and task items the same way', () => {
    const doc = '1. one\n   1. two\n      text\n- [ ] a\n  - [x] b\n\nend'
    expect(shifts(doc)).toEqual(['2: "   "', '3: "   "', '5: "  "'])
  })

  it('moves a top-level list that is written indented', () => {
    expect(shifts('  - a\n    text\n\nend')).toEqual(['1: "  "', '2: "  "'])
  })

  it('keeps tabs as tabs, so a tab level is doubled too', () => {
    expect(shifts('- a\n\t- b\n\t\t- c\n\nend')).toEqual(['2: "\\t"', '3: "\\t\\t"'])
  })

  it('moves a fenced block in a nested item with its text, as its container', () => {
    const doc = '- a\n  - b\n\n    ```\n    code\n    ```\n\nend'
    // The container carries the item's two added columns and the four typed ones (box.ts), so its
    // lines get no second copy of their own.
    expect(shifts(doc)).toEqual(['2: "  "'])
    const styles = scanAll(stateOf(doc)).flatMap((item) =>
      item.type === 'line' && item.attributes?.style !== undefined ? [item.attributes.style] : [],
    )
    expect(styles).toEqual(Array(3).fill('--box-columns: 6; --box-lead: 4'))
  })

  it('draws the second copy after the quote marks of a list in a quote', () => {
    const doc = '> - a\n>   - b\n\nend'
    const items = scanAll(stateOf(doc)).filter((one) => one.type === 'indent')
    expect(items).toEqual([{ type: 'indent', from: doc.indexOf('  - b'), text: '  ' }])
  })

  it('takes the shift of the line for a marker that follows another one', () => {
    expect(shifts('- - a\n    text\n\nend')).toEqual([])
  })

  it('puts an invisible copy of the blanks before the line on the page', () => {
    const view = mount(NESTED)
    const lines = [...view.contentDOM.querySelectorAll('.cm-line')]
    expect(lines.map((line) => line.querySelector('.cm-md-indent')?.textContent ?? '')).toEqual([
      '',
      '',
      '  ',
      '  ',
      '    ',
      '',
      '',
      '',
      '',
      '',
    ])
    expect(valuesOf('.cm-md-indent', 'visibility')).toContain('hidden')
    expect(valuesOf('.cm-md-indent', 'white-space')).toContain('pre')
  })

  it('moves a table in a nested item by the same blanks', () => {
    const view = mount('- a\n  - b\n\n    | x |\n    |---|\n    | 1 |\n\nend')
    // The four typed blanks and the two the nested item adds.
    expect(view.contentDOM.querySelector('.cm-md-table-indent')?.textContent).toBe(' '.repeat(6))
  })

  it('follows an edit of the indentation', () => {
    const view = mount('- a\n  - b\n\n    | x |\n    |---|\n    | 1 |\n\nend')
    // The nested item and its table move two columns further in: six typed, four added.
    view.dispatch({
      changes: [2, 4, 5, 6].map((n) => ({ from: view.state.doc.line(n).from, insert: '  ' })),
    })
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    expect(view.contentDOM.querySelector('.cm-md-table-indent')?.textContent).toBe(' '.repeat(10))
  })
})

describe('drawing only (ISC-745)', () => {
  const doc = `${NESTED}\n\n  - x\n    | a |\n    |---|\n    | 1 |\n# H\n`

  it('changes no byte of the document', () => {
    expect(mount(doc).state.doc.toString()).toBe(doc)
  })

  it('draws none of it in raw mode', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, createState(doc, [], { preview: false }))
    views.push(view)
    expect(parent.querySelector('.cm-md-indent, .cm-md-list-end')).toBeNull()
  })

  it('lets the caret walk through every position of every line', () => {
    const view = mount(doc, 0)
    const seen = new Set<number>([1])
    for (let step = 0; step <= doc.length && view.state.selection.main.head < doc.length; step++) {
      const before = view.state.selection.main.head
      cursorCharRight(view)
      expect(view.state.selection.main.head).toBeGreaterThan(before)
      seen.add(view.state.doc.lineAt(view.state.selection.main.head).number)
    }
    expect([...seen]).toEqual(Array.from({ length: view.state.doc.lines }, (_, i) => i + 1))
  })

  it('uses no margin for the layout of a list', () => {
    mount(doc)
    for (const selector of ['.cm-md-indent', '.cm-line.cm-md-list-end']) {
      for (const property of ['margin', 'margin-top', 'margin-bottom']) {
        expect(valuesOf(selector, property), `${selector} ${property}`).toEqual([])
      }
    }
    // The rules are there at all, so the loop above does not pass on an empty page.
    expect(valuesOf('.cm-line.cm-md-list-end', 'padding-bottom')).toHaveLength(1)
  })
})
