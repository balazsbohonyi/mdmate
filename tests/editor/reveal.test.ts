// @vitest-environment jsdom
/**
 * ISC-57: a caret inside one inline element reveals only that element's syntax. Checked on the
 * scan (what is hidden) and on the page a real view draws (what the reader sees), in the same
 * dispatch that moves the caret, so there is no frame where the old state shows.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { markdownSupport } from '@/editor/markdownSupport'
import { rendered, scanAll, stateOf } from '../helpers/preview'

const views: EditorView[] = []

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function mount(doc: string, caret: number): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, [], { preview: true }))
  view.dispatch({ selection: { anchor: caret } })
  views.push(view)
  return view
}

const TWO = 'Two **bold** words and another **bold** one.\n\nend'
const first = TWO.indexOf('bold') + 2
const second = TWO.lastIndexOf('bold') + 2

describe('one of two bold spans', () => {
  it('reveals the first span only, in the scan', () => {
    const state = stateOf(TWO, first)
    expect(rendered(state, scanAll(state))).toBe('Two **bold** words and another bold one.\n\nend')
  })

  it('reveals the second span only, in the scan', () => {
    const state = stateOf(TWO, second)
    expect(rendered(state, scanAll(state))).toBe('Two bold words and another **bold** one.\n\nend')
  })

  it('reveals a span when the caret is on either edge of it, and not one position away', () => {
    const start = TWO.indexOf('**bold**')
    const end = start + '**bold**'.length
    for (const caret of [start, end]) {
      const state = stateOf(TWO, caret)
      expect(rendered(state, scanAll(state)), `caret at ${String(caret)}`).toBe(
        'Two **bold** words and another bold one.\n\nend',
      )
    }
    for (const caret of [start - 1, end + 1]) {
      const state = stateOf(TWO, caret)
      expect(rendered(state, scanAll(state)), `caret at ${String(caret)}`).toBe(
        'Two bold words and another bold one.\n\nend',
      )
    }
  })

  it('reveals neither with the caret between them', () => {
    const state = stateOf(TWO, TWO.indexOf('words'))
    expect(rendered(state, scanAll(state))).toBe('Two bold words and another bold one.\n\nend')
  })

  it('shows the same on the page, in the dispatch that moves the caret', () => {
    const view = mount(TWO, TWO.length)
    const text = () => view.contentDOM.textContent
    expect(text()).toBe('Two bold words and another bold one.end')

    view.dispatch({ selection: { anchor: first } })
    expect(text()).toBe('Two **bold** words and another bold one.end')

    view.dispatch({ selection: { anchor: second } })
    expect(text()).toBe('Two bold words and another **bold** one.end')

    view.dispatch({ selection: { anchor: TWO.length } })
    expect(text()).toBe('Two bold words and another bold one.end')
  })
})

describe('different kinds of element on one line', () => {
  const doc = 'a *em* b [link](http://x.com) c `code` d ~~gone~~ e\n\nend'

  it.each([
    ['*em*', 'a *em* b link c code d gone e\n\nend'],
    ['[link]', 'a em b [link](http://x.com) c code d gone e\n\nend'],
    ['`code`', 'a em b link c `code` d gone e\n\nend'],
    ['~~gone~~', 'a em b link c code d ~~gone~~ e\n\nend'],
  ])('with the caret in %s, only that one shows', (needle, expected) => {
    const state = stateOf(doc, doc.indexOf(needle) + 1)
    expect(rendered(state, scanAll(state))).toBe(expected)
  })
})

describe('block markers', () => {
  const doc = '# One\n\n## Two\n\n> quote a\n> quote b\n\nend'

  it('show for the caret line only', () => {
    const inTwo = stateOf(doc, doc.indexOf('Two') + 1)
    expect(rendered(inTwo, scanAll(inTwo))).toBe('One\n\n## Two\n\nquote a\nquote b\n\nend')
    const inQuoteB = stateOf(doc, doc.indexOf('quote b') + 1)
    expect(rendered(inQuoteB, scanAll(inQuoteB))).toBe('One\n\nTwo\n\nquote a\n> quote b\n\nend')
  })
})

describe('a selection and several carets', () => {
  it('a selection across both spans reveals both, and what lies between', () => {
    const state = stateOf(TWO, [first, second])
    expect(rendered(state, scanAll(state))).toBe(TWO)
  })

  // The app does not turn on multiple selections yet, so a second caret would be dropped. The scan
  // reads every range, and this keeps it that way for the day the facet is on.
  it('two carets reveal two spans and leave the third hidden', () => {
    const doc = '**a** x **b** y **c**\n\nend'
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([
        EditorSelection.cursor(3),
        EditorSelection.cursor(doc.indexOf('**c**') + 3),
      ]),
      extensions: [markdownSupport(), EditorState.allowMultipleSelections.of(true)],
    })
    ensureSyntaxTree(state, doc.length, 5000)
    expect(state.selection.ranges).toHaveLength(2)
    expect(rendered(state, scanAll(state))).toBe('**a** x b y **c**\n\nend')
  })
})
