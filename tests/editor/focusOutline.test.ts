// @vitest-environment jsdom
/** A focused editor draws no outline: CodeMirror's default dotted one cut across the top of the pane. */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function outlineWhenFocused(options: Parameters<typeof createState>[2]): string {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState('# Title\n\ntext', [], options))
  views.push(view)
  // CodeMirror adds this class while the editor has focus; jsdom has no real focus to give it.
  view.dom.classList.add('cm-focused')
  return getComputedStyle(view.dom).outlineStyle
}

describe('editor focus outline', () => {
  it('is off for a Markdown document with live preview', () => {
    expect(outlineWhenFocused({ preview: true })).toBe('none')
  })

  it('is off for plain source', () => {
    expect(outlineWhenFocused({ parser: false })).toBe('none')
  })
})
