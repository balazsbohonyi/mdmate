// @vitest-environment jsdom
/**
 * Line selections (P9.1-T22, ISC-634). CodeMirror draws the highlight of a whole selected line from
 * the content box's own edge, inset only by the padding of a `.cm-line` (6px left, 2px right). With
 * the room beside the text on the content (24px each side), the highlight ran into that room. The
 * room now sits outside the content box, so the box is the text column and the measured edge is the
 * text edge. jsdom draws no layout, so the rules are read; the measured edges in the real page are
 * in the Verification note of ISC-634.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createState, createView } from '@/editor/create'
import type { EditorView } from '@codemirror/view'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { resetSettings } from '@/lib/settings'
import { valuesOf } from '../helpers/editorRules'

const views: EditorView[] = []

beforeEach(() => {
  resetSettings()
})

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
  resetSettingsState()
  resetSettings()
})

const KINDS: Record<string, string> = {
  'plain text': 'one\n\ntwo',
  'a code box': '```ts\nconst a = 1\n```',
  'a quote': '> one\n> two',
  'a table': '| a | b |\n| - | - |\n| 1 | 2 |',
}

function mount(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, [], { preview: true }))
  views.push(view)
  return view
}

const px = (style: CSSStyleDeclaration, ...names: string[]): string[] =>
  names.map((name) => style.getPropertyValue(name))

describe('the highlight of a whole line starts and ends at the text edges (ISC-634)', () => {
  for (const [kind, doc] of Object.entries(KINDS)) {
    it(`has no room inside the content box beside ${kind}`, () => {
      const view = mount(doc)
      const content = getComputedStyle(view.contentDOM)
      expect(px(content, 'padding-left', 'padding-right')).toEqual(['0px', '0px'])
      // Above and below stays as it was.
      expect(px(content, 'padding-top', 'padding-bottom')).toEqual(['20px', '20px'])
    })
  }

  it('leaves only the line own padding between the measured edge and the text', () => {
    const view = mount(KINDS['plain text'] ?? '')
    const line = getComputedStyle(view.contentDOM.querySelector('.cm-line')!)
    expect(px(line, 'padding-left', 'padding-right')).toEqual(['6px', '2px'])
  })

  it('keeps the room beside the text outside the content box, on the scroller', () => {
    const view = mount(KINDS['plain text'] ?? '')
    const scroller = getComputedStyle(view.scrollDOM)
    expect(px(scroller, 'padding-left', 'padding-right')).toEqual(['24px', '24px'])
  })

  it('keeps the gutter at the pane edge with line numbers on, and the room as a margin on the column', () => {
    applySettingsText(JSON.stringify({ editor: { lineNumbers: true } }))
    const view = mount(KINDS['plain text'] ?? '')
    expect(view.dom.classList.contains('cm-lineNumbersOn')).toBe(true)
    expect(valuesOf('.cm-lineNumbersOn .cm-scroller', 'padding-inline-start')).toEqual(['0'])
    expect(valuesOf('.cm-lineNumbersOn .cm-content', 'margin-inline-start')).toEqual(['1.5rem'])
    // The right-hand room stays on the scroller; the content still has none.
    const content = getComputedStyle(view.contentDOM)
    expect(px(content, 'padding-left', 'padding-right')).toEqual(['0px', '0px'])
    expect(px(getComputedStyle(view.scrollDOM), 'padding-right')).toEqual(['24px'])
  })

  it('gives the column the width from settings and no more, since the room is no longer inside it', () => {
    const view = mount(KINDS['plain text'] ?? '')
    expect(valuesOf('.cm-content', 'max-width')).toEqual(['var(--doc-content-max, 1024px)'])
    expect(view.contentDOM.isConnected).toBe(true)
  })
})
