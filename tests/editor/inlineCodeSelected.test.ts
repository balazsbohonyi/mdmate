// @vitest-environment jsdom
/**
 * Selected inline code in the editor itself (ISC-506, ISC-507): the part a selection covers is a
 * `cm-md-code-selected` element, and the theme draws it without the span's background, in the text
 * color, so the selection behind it shows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

const DOC = 'use `pnpm dev` now\n\nend of the document'

function open(): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(DOC, [], { preview: true }))
  views.push(view)
  return view
}

/** The style rules CodeMirror injected, as selector and body (spacing taken out). */
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

const bodyOf = (selector: string): string =>
  rules()
    .filter((rule) => rule.selector.endsWith(selector))
    .map((rule) => rule.body)
    .join(';')

describe('the selected part of inline code is drawn as selected text (ISC-506, ISC-507)', () => {
  it('marks the covered part in the page, and takes the mark away when the selection moves off', () => {
    const view = open()
    expect(view.contentDOM.querySelector('.cm-md-code-selected')).toBeNull()
    view.dispatch({ selection: { anchor: 6, head: 10 } })
    const selected = [...view.contentDOM.querySelectorAll('.cm-md-code-selected')]
    expect(selected.map((element) => element.textContent)).toEqual(['npm '])
    // The rest of the span is still inline code with its background.
    expect(
      [...view.contentDOM.querySelectorAll('.cm-md-code:not(.cm-md-code-selected)')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['`p', 'dev`'])
    view.dispatch({ selection: { anchor: 0, head: 3 } })
    expect(view.contentDOM.querySelector('.cm-md-code-selected')).toBeNull()
  })

  it('draws it with no background and the --foreground text color', () => {
    open()
    const selected = bodyOf('.cm-md-code.cm-md-code-selected')
    expect(selected).toContain('color:var(--foreground)')
    expect(selected).toContain('background-color:transparent')
  })

  it('keeps the plain span in --syntax-code on --syntax-code-background', () => {
    open()
    const plain = bodyOf('.cm-md-code')
    expect(plain).toContain('color:var(--syntax-code)')
    expect(plain).toContain('background-color:var(--syntax-code-background)')
  })
})
