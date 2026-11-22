// @vitest-environment jsdom
/**
 * The colour square before an inline code span that is a hex colour (P9.1-T30, ISC-678 to ISC-680).
 * It is a point widget before the opening backtick: it takes no place in the document, so the caret,
 * the selection and a copy never see it. jsdom draws nothing, so the square is read as the element
 * with its colour; the look in the real window is the owner's claim (ISC-681).
 */
import { cursorCharRight } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { hexColor } from '@/editor/livePreview/swatch'
import { valuesOf } from '../helpers/editorRules'
import { mountPreview } from '../helpers/blocks'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

/** A view over `doc` with the caret at `caret` (default: the end, away from the text under test). */
function mount(doc: string, caret = doc.length): EditorView {
  const view = mountPreview(doc, caret)
  views.push(view)
  return view
}
const swatches = (view: EditorView): HTMLElement[] => [
  ...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-swatch'),
]
const colors = (view: EditorView): (string | undefined)[] =>
  swatches(view).map((swatch) => swatch.dataset.color)

describe('which spans are colours (ISC-678)', () => {
  it('takes #rgb, #rgba, #rrggbb and #rrggbbaa, in any case, and gives the text back', () => {
    for (const text of ['#fff', '#ffff', '#ff8800', '#ff880080', '#FFF', '#Ff88aA']) {
      expect(hexColor(text), text).toBe(text)
    }
  })

  it('refuses anything else: wrong length, other digits, words, extra text, no hash, blanks', () => {
    for (const text of [
      '#12',
      '#12345',
      '#1234567',
      '#123456789',
      '#ggg',
      '#ff88zz',
      'red',
      'ff8800',
      '#fff text',
      ' #fff',
      '#fff ',
      '#',
      '',
    ]) {
      expect(hexColor(text), JSON.stringify(text)).toBeNull()
    }
  })
})

describe('the square in body text (ISC-678)', () => {
  it('shows before a span of each of the four lengths, in that colour', () => {
    const view = mount('`#fff` `#ffff` `#ff8800` `#ff880080` end')
    expect(colors(view)).toEqual(['#fff', '#ffff', '#ff8800', '#ff880080'])
    // The colour is also on the element as a custom property, which the rule paints with.
    expect(swatches(view)[2]?.style.getPropertyValue('--swatch')).toBe('#ff8800')
  })

  it('shows nothing for other code, plain text, a fenced block or a span with more in it', () => {
    const doc = [
      'a `#12` b `#ggg` c `red` d `#fff text` e #fff f',
      '',
      '```',
      '#fff',
      '```',
      '',
      '    #fff',
      '',
      'end',
    ].join('\n')
    expect(colors(mount(doc))).toEqual([])
  })

  it('is placed before the opening backtick, outside the code span', () => {
    const view = mount('x `#fff` y')
    const [swatch] = swatches(view)
    const code = view.contentDOM.querySelector('.cm-md-code')
    expect(swatch).toBeDefined()
    expect(code).not.toBeNull()
    // The square comes first in the document order of the line, and is not inside the code.
    expect(code?.contains(swatch ?? null)).toBe(false)
    expect(swatch?.compareDocumentPosition(code as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(swatch?.textContent).toBe('')
  })

  it('takes a double-backtick span too, by the text between the backticks', () => {
    expect(colors(mount('x ``#fff`` y'))).toEqual(['#fff'])
  })
})

describe('the square and the selection (ISC-679)', () => {
  const doc = 'ab `#f80` cd'
  const open = doc.indexOf('`')

  it('shows with the caret away from the span and with the caret in it, edges included', () => {
    for (const caret of [
      0,
      open - 1,
      open,
      open + 1,
      open + 4,
      doc.indexOf('`', open + 1),
      doc.length,
    ]) {
      expect(colors(mount(doc, caret)), `caret at ${String(caret)}`).toEqual(['#f80'])
    }
  })

  it('shows while the span is selected', () => {
    const view = mount(doc, 0)
    view.dispatch({ selection: { anchor: open - 1, head: doc.indexOf('`', open + 1) + 1 } })
    expect(colors(view)).toEqual(['#f80'])
  })

  it('does not change where the arrow keys take the caret: the same steps as for code that is no colour', () => {
    const walk = (text: string): number[] => {
      const view = mount(text, 0)
      const heads = [view.state.selection.main.head]
      for (let step = 0; step < text.length + 2; step++) {
        cursorCharRight(view)
        heads.push(view.state.selection.main.head)
      }
      return heads
    }
    const colour = walk(doc)
    expect(colour).toEqual(walk('ab `#zzz` cd'))
    // It reaches the end and never goes back: no step is lost inside the square.
    expect(colour.at(-1)).toBe(doc.length)
    expect([...colour].sort((a, b) => a - b)).toEqual(colour)
  })

  it('is not part of a copy: the text is the Markdown as typed', () => {
    const view = mount(doc, 0)
    view.dispatch({ selection: { anchor: 0, head: doc.length } })
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      doc,
    )
    expect(view.state.doc.toString()).toBe(doc)
    expect(swatches(view)[0]?.textContent).toBe('')
  })
})

describe('the square in a table cell (ISC-680)', () => {
  const table = ['| name | colour |', '|---|---|', '| sky | `#38bdf8` |', '| other | `#12` |'].join(
    '\n',
  )
  const doc = `${table}\n\nafter\n`

  it('shows in the cell whose code is a colour, and in no other', () => {
    const view = mount(doc, doc.length - 1)
    const inCells = [...view.contentDOM.querySelectorAll<HTMLElement>('td .cm-md-swatch')]
    expect(inCells.map((swatch) => swatch.dataset.color)).toEqual(['#38bdf8'])
    expect(inCells[0]?.style.getPropertyValue('--swatch')).toBe('#38bdf8')
    expect(inCells[0]?.nextElementSibling?.tagName).toBe('CODE')
  })
})

describe('the look of the square', () => {
  it('is a small rounded box with a border, as high as the text, painted with its colour', () => {
    mount('`#fff` end')
    expect(valuesOf('.cm-md-swatch', 'display')).toEqual(['inline-block'])
    expect(valuesOf('.cm-md-swatch', 'background-color')).toEqual(['var(--swatch)'])
    expect(valuesOf('.cm-md-swatch', 'border')).toEqual(['1px solid var(--border)'])
    expect(valuesOf('.cm-md-swatch', 'border-radius')).toEqual(['var(--radius-sm)'])
    expect(valuesOf('.cm-md-swatch', 'width')).toEqual(['0.8em'])
    expect(valuesOf('.cm-md-swatch', 'height')).toEqual(['0.8em'])
  })
})
