// @vitest-environment jsdom
/**
 * P9.1-T19 (ISC-623, ISC-624): a bullet list marker (`-`, `*`, `+`) is drawn as an en dash while the
 * selection is away from it. The scan is read without a view; the page, the caret walk and the copy
 * go through a real view with live preview. jsdom has no layout, so the dash taking the hyphen's
 * width is checked by the widget's shape and the theme rule, not by measuring.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cursorCharLeft, cursorCharRight } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createState, createView } from '@/editor/create'
import { BulletWidget } from '@/editor/livePreview/bullet'
import { bulletsOf, hidden, markedText, scanAll, stateOf } from '../helpers/preview'

const parents: HTMLElement[] = []
const views: EditorView[] = []

beforeAll(() => {
  const empty = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() }
  Range.prototype.getClientRects = () => empty
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  for (const parent of parents.splice(0)) parent.remove()
})

function mount(doc: string, caret = doc.length): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  parents.push(parent)
  const view = createView(parent, createState(doc, [], { preview: true }))
  views.push(view)
  view.dispatch({ selection: { anchor: caret } })
  return view
}

const dashes = (view: EditorView): string[] =>
  [...view.dom.querySelectorAll('.cm-md-bullet-dash')].map((el) => el.textContent)

/** What a copy puts on the clipboard. CodeMirror answers a copy only for the editor with focus. */
function copyFrom(view: EditorView): string {
  view.focus()
  let copied = ''
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => undefined,
      setData: (_type: string, value: string) => {
        copied = value
      },
    },
  })
  view.contentDOM.dispatchEvent(event)
  return copied
}

describe('which markers become a dash (ISC-623)', () => {
  it('draws -, * and + as dashes and leaves the numbers of an ordered list as they are', () => {
    const doc = '- one\n* two\n+ three\n\n1. first\n2) second\n\nend'
    const state = stateOf(doc)
    const items = scanAll(state)
    expect(bulletsOf(state, items)).toEqual(['-', '*', '+'])
    expect(markedText(state, items)).toEqual(['cm-md-list-mark: 1.', 'cm-md-list-mark: 2)'])
  })

  it('draws the bullets of a nested list, and of a list inside an ordered one', () => {
    const state = stateOf('- a\n  - b\n    * c\n\n1. n\n   - m\n\nend')
    expect(bulletsOf(state, scanAll(state))).toEqual(['-', '-', '*', '-'])
  })

  it('keeps the checkbox of a task item and draws the bullet before it', () => {
    const doc = '- [ ] open\n- [x] done\n\nend'
    const state = stateOf(doc)
    const items = scanAll(state)
    expect(bulletsOf(state, items)).toEqual(['-', '-'])
    expect(items.filter((item) => item.type === 'checkbox')).toHaveLength(2)
  })

  it('changes no text: nothing is hidden and the document is what was typed', () => {
    const doc = '- one\n* two\n\n1. first\n\nend'
    const state = stateOf(doc)
    expect(hidden(scanAll(state))).toEqual([])
    expect(state.doc.toString()).toBe(doc)
  })

  it('does not draw a dash for what is not a bullet', () => {
    for (const doc of [
      'a - b and * c\n\nend',
      '---\n\nend',
      '* * *\n\nend',
      'Title\n-----\n\nend',
      '```\n- code\n```\n\nend',
      '    - indented code\n\nend',
      '`- inline`\n\nend',
    ]) {
      const state = stateOf(doc)
      expect(bulletsOf(state, scanAll(state)), doc).toEqual([])
    }
  })

  it('puts a dash on the page for each bullet, and leaves the marker in the text', () => {
    const view = mount('- one\n* two\n+ three\n\n1. first\n\nend')
    expect(dashes(view)).toEqual(['–', '–', '–'])
    expect(view.state.doc.toString()).toBe('- one\n* two\n+ three\n\n1. first\n\nend')
    expect(view.dom.querySelectorAll('.cm-md-list-mark')).toHaveLength(1)
  })

  it('has the width of the en dash it draws: a hidden dash sets it and the dash is laid over it (ISC-670)', () => {
    const view = mount('- one\n\nend')
    const bullet = view.dom.querySelector('.cm-md-bullet')
    expect(bullet?.children).toHaveLength(2)
    // The same glyph, so in a proportional font the dash fills its box and does not overhang the
    // space after it; in a monospace font the hyphen and the dash are as wide as each other.
    expect(bullet?.querySelector('.cm-md-bullet-width')?.textContent).toBe('\u2013')
    expect(bullet?.querySelector('.cm-md-bullet-width')?.textContent).toBe(
      bullet?.querySelector('.cm-md-bullet-dash')?.textContent,
    )
    const theme = readFileSync(
      join(import.meta.dirname, '../../src/editor/livePreview/theme.ts'),
      'utf8',
    )
    expect(theme).toMatch(/'\.cm-md-bullet-width': \{ visibility: 'hidden' \}/)
    expect(theme).toMatch(/'\.cm-md-bullet-dash': \{ position: 'absolute'/)
    // The marker's colour and weight carry over.
    expect(theme).toMatch(/'\.cm-md-bullet': \{[^}]*--syntax-marker[^}]*'700'/s)
  })

  it('reuses the same widget for every bullet', () => {
    expect(new BulletWidget().eq(new BulletWidget())).toBe(true)
  })
})

describe('the raw marker under the selection (ISC-624)', () => {
  const doc = '- one\n* two\n+ three\n\nend'

  it('shows the raw marker while the caret touches it, and the dash once the caret leaves', () => {
    // The caret at the start of the line, and just after the marker, touch it.
    for (const caret of [0, 1]) {
      const state = stateOf(doc, caret)
      expect(bulletsOf(state, scanAll(state)), `caret ${String(caret)}`).toEqual(['*', '+'])
      expect(markedText(state, scanAll(state))).toContain('cm-md-list-mark: -')
    }
    // In the item's text, or after its space, the dash is back.
    for (const caret of [2, 3, 5]) {
      const state = stateOf(doc, caret)
      expect(bulletsOf(state, scanAll(state)), `caret ${String(caret)}`).toEqual(['-', '*', '+'])
    }
  })

  it('shows the raw marker and the dash on the page as the caret moves', () => {
    const view = mount(doc, 3)
    expect(dashes(view)).toHaveLength(3)
    view.dispatch({ selection: { anchor: 0 } })
    expect(dashes(view)).toHaveLength(2)
    expect(view.dom.querySelectorAll('.cm-md-list-mark')).toHaveLength(1)
    view.dispatch({ selection: { anchor: 4 } })
    expect(dashes(view)).toHaveLength(3)
  })

  it('shows the raw marker of every item a selection across them touches', () => {
    // From inside the first item to inside the second: both markers are in the selection.
    let state = stateOf(doc, [3, 9])
    expect(bulletsOf(state, scanAll(state))).toEqual(['-', '+'])
    state = stateOf(doc, [0, doc.length])
    expect(bulletsOf(state, scanAll(state))).toEqual([])
    // Inside one item's text only that item's marker is away from the selection.
    state = stateOf(doc, [3, 4])
    expect(bulletsOf(state, scanAll(state))).toEqual(['-', '*', '+'])
  })

  it('never lets the caret land inside the marker, and steps through every position', () => {
    const view = mount(doc, 0)
    const forward: number[] = [view.state.selection.main.head]
    Array.from({ length: doc.length }).forEach(() => {
      cursorCharRight(view)
      forward.push(view.state.selection.main.head)
    })
    expect(forward).toEqual(Array.from({ length: doc.length + 1 }, (_, at) => at))
    const back: number[] = [view.state.selection.main.head]
    Array.from({ length: doc.length }).forEach(() => {
      cursorCharLeft(view)
      back.push(view.state.selection.main.head)
    })
    expect(back).toEqual(Array.from({ length: doc.length + 1 }, (_, at) => doc.length - at))
  })

  it('copies the Markdown text, markers included', () => {
    const view = mount(doc, 0)
    const text = doc.slice(0, doc.indexOf('\n\nend'))
    view.dispatch({ selection: EditorSelection.single(0, text.length) })
    const copied = copyFrom(view)
    expect(copied).toBe(text)
    expect(copied).toContain('- one')
    expect(copied).not.toContain('–')
  })

  it('copies the text of an item whose dash is drawn without the dash', () => {
    const view = mount(doc, 0)
    // The selection ends before the next marker, but the caret's end touches nothing else.
    view.dispatch({ selection: EditorSelection.single(2, 5) })
    expect(dashes(view)).toHaveLength(3)
    expect(copyFrom(view)).toBe('one')
  })
})
