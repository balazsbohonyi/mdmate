// @vitest-environment jsdom
/**
 * The editor's Selection, Caret and handle colors (ISC-500 to ISC-502). The selection and the caret
 * were theme tokens nothing read: the browser drew both in its own colors, so changing them in the
 * color editor did nothing. CodeMirror now draws them (`drawSelection`), and the theme's rules
 * color the drawn parts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { createFollowerState, createState, createView } from '@/editor/create'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

/** The style rules CodeMirror injected, as `selector, body` pairs with the spacing taken out. */
function rules(): { selector: string; body: string }[] {
  const text: string[] = []
  for (const style of document.querySelectorAll('style')) text.push(style.textContent ?? '')
  for (const sheet of document.adoptedStyleSheets)
    for (const rule of sheet.cssRules) text.push(rule.cssText)
  const found: { selector: string; body: string }[] = []
  for (const match of text.join('\n').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({
      selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
      body: (match[2] ?? '').replace(/\s+/g, ''),
    })
  }
  return found
}

/** Whether a rule for `selector` (a part of its selector list) sets `declaration`. */
function sets(selector: string, declaration: string): boolean {
  return rules().some((rule) => rule.selector.includes(selector) && rule.body.includes(declaration))
}

function open(state: EditorState): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, state)
  views.push(view)
  return view
}

const DOC = '# Title\n\nSome text to select.'
const KINDS: [string, () => EditorState][] = [
  ['a Markdown document with live preview', () => createState(DOC, [], { preview: true })],
  ['plain source', () => createState(DOC, [], { parser: false })],
  [
    'a tab of a document (a follower)',
    () => createFollowerState({ doc: EditorState.create({ doc: DOC }).doc }),
  ],
]

describe('the selection and the caret are drawn, in the theme colors (ISC-500, ISC-501)', () => {
  it.each(KINDS)('draws both in %s', (_name, state) => {
    const view = open(state())
    expect(view.dom.querySelector('.cm-selectionLayer')).not.toBeNull()
    expect(view.dom.querySelector('.cm-cursorLayer')).not.toBeNull()
  })

  it('colors the drawn caret from --caret, for the cursor and the drop cursor', () => {
    open(createState(DOC, [], { preview: true }))
    expect(sets('.cm-cursor', 'border-left-color:var(--caret)')).toBe(true)
    expect(sets('.cm-dropCursor', 'border-left-color:var(--caret)')).toBe(true)
  })

  it('colors the drawn selection from --selection, focused or not, and inside a widget', () => {
    open(createState(DOC, [], { preview: true }))
    expect(sets('.cm-selectionBackground', 'background:var(--selection)')).toBe(true)
    expect(
      sets(
        '.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground',
        'background:var(--selection)',
      ),
    ).toBe(true)
    expect(sets('.cm-content ::selection', 'background:var(--selection)')).toBe(true)
  })

  it('leaves the caret to the drawn one: no native caret color is set that would do nothing', () => {
    open(createState(DOC, [], { preview: true }))
    expect(
      rules().some(
        (rule) =>
          rule.selector.endsWith('.cm-content') &&
          rule.body.includes('caret-color:var(--foreground)'),
      ),
    ).toBe(false)
  })
})

describe('a selected image: its outline and its resize handle are --handle-active (ISC-509)', () => {
  it('draws the outline and the handle in --handle-active, in one state', () => {
    open(createState(DOC, [], { preview: true }))
    expect(
      sets('.cm-md-image-selected > .cm-md-image-frame', 'outline:2pxsolidvar(--handle-active)'),
    ).toBe(true)
    expect(sets('.cm-md-image-handle', 'background-color:var(--handle-active)')).toBe(true)
  })

  it('has no other color for the handle: not at rest, not under the pointer or pressed', () => {
    open(createState(DOC, [], { preview: true }))
    const handle = rules().filter((rule) => rule.selector.includes('.cm-md-image-handle'))
    expect(handle.length).toBeGreaterThan(0)
    for (const rule of handle) {
      expect(rule.selector).not.toMatch(/:hover|:active/)
      expect(rule.body).not.toMatch(/var\(--(handle|primary|ring)\)/)
    }
  })
})
