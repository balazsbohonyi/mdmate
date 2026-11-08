// @vitest-environment jsdom
/** The text never touches the edges of its pane: 1.25rem above and below, 1.5rem each side (jsdom reports px). */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function padding(doc: string, options: Parameters<typeof createState>[2]) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, [], options))
  views.push(view)
  const style = getComputedStyle(view.contentDOM)
  return {
    top: style.paddingTop,
    right: style.paddingRight,
    bottom: style.paddingBottom,
    left: style.paddingLeft,
  }
}

describe('editor content padding', () => {
  it('pads all four sides of a Markdown document with live preview', () => {
    expect(padding('# Title\n\ntext', { preview: true })).toEqual({
      top: '20px',
      right: '24px',
      bottom: '20px',
      left: '24px',
    })
  })

  it('pads plain source the same way', () => {
    expect(padding('text', { parser: false })).toEqual({
      top: '20px',
      right: '24px',
      bottom: '20px',
      left: '24px',
    })
  })
})
