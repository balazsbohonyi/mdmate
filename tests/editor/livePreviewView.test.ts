// @vitest-environment jsdom
/**
 * The layer as the page shows it: a real view, the decorations it builds, and the tabs that must
 * never get it. The data-level answers are in the per-element tests next to this file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EditorView } from '@codemirror/view'
import { createState, createView } from '@/editor/create'
import { LARGE_FILE_BYTES } from '@/documents/largeFile'
import { followerOfTab, openPath, resetDocuments } from '@/documents/store'
import { resetSession } from '@/documents/session'
import { setHost } from '@/platform'
import { createMockHost } from '@/platform/mock'
import { resetWorkbench, workbenchLayout } from '@/workbench/store'
import { allTabs } from '@/workbench/splitTree'

const views: EditorView[] = []

function mount(doc: string, caret: number): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createView(parent, createState(doc, [], { preview: true }))
  view.dispatch({ selection: { anchor: caret } })
  views.push(view)
  return view
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

describe('the rendered page', () => {
  it('shows a heading without its hashes, and with them when the caret comes back', () => {
    const doc = '# Title\n\nbody text'
    const view = mount(doc, doc.length)
    expect(view.contentDOM.textContent).toBe('Title' + 'body text')
    expect(view.contentDOM.querySelector('.cm-md-h1')).not.toBeNull()

    view.dispatch({ selection: { anchor: 3 } })
    expect(view.contentDOM.textContent).toBe('# Title' + 'body text')

    view.dispatch({ selection: { anchor: doc.length } })
    expect(view.contentDOM.textContent).toBe('Title' + 'body text')
  })

  it('leaves the document itself alone, whatever is hidden', () => {
    const doc = '# One\n## Two ##\n\ntext\n'
    const view = mount(doc, doc.length)
    for (let pos = 0; pos <= doc.length; pos++) view.dispatch({ selection: { anchor: pos } })
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('does not add preview to a state that did not ask for it', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(parent, createState('# Title\n\nbody', [], {}))
    views.push(view)
    expect(view.contentDOM.querySelector('.cm-md-h1')).toBeNull()
    expect(view.contentDOM.textContent).toContain('# Title')
  })

  it('does not add preview to plain source, even when it is asked for', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = createView(
      parent,
      createState('# Title\n\nbody', [], { parser: false, preview: true }),
    )
    views.push(view)
    expect(view.contentDOM.querySelector('.cm-md-h1')).toBeNull()
    expect(view.contentDOM.textContent).toContain('# Title')
  })
})

describe('tabs opened by the store', () => {
  beforeEach(() => {
    resetWorkbench()
    resetDocuments()
    resetSession()
  })

  afterEach(() => {
    resetSession()
    resetWorkbench()
    resetDocuments()
    setHost(undefined)
  })

  async function openFile(path: string, text: string): Promise<EditorView> {
    setHost(createMockHost({ files: { [path]: text } }))
    await openPath(path)
    const tab = allTabs(workbenchLayout.value).at(-1)
    const follower = tab === undefined ? undefined : followerOfTab(tab)
    if (follower === undefined) throw new Error('the file did not open in a tab')
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({ parent })
    follower.show(view)
    views.push(view)
    return view
  }

  it('renders a small Markdown file', async () => {
    const view = await openFile('/notes.md', '# Notes\n\ntext\n')
    view.dispatch({ selection: { anchor: 12 } })
    expect(view.contentDOM.querySelector('.cm-md-h1')).not.toBeNull()
    expect(view.contentDOM.textContent).not.toContain('#')
  })

  it('gives a file above the size cutoff no preview at all', async () => {
    const line = '# A heading with some words in it\n'
    const text = line.repeat(Math.ceil((LARGE_FILE_BYTES + 1) / line.length))
    expect(text.length).toBeGreaterThan(LARGE_FILE_BYTES)
    const view = await openFile('/big.md', text)
    expect(view.contentDOM.querySelector('.cm-md-h')).toBeNull()
    expect(view.contentDOM.textContent).toContain('# A heading')
  })
})
